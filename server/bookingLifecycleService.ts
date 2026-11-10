import { TRPCError } from "@trpc/server";
import { and, eq, gt, inArray } from "drizzle-orm";
import {
  bookings,
  leadflowJobs,
  type LeadflowJob,
} from "../drizzle/schema";
import { businessLocalDateTimeToUtcMs } from "./utils/businessTime";
import { getDb } from "./db";

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
type TransactionClient = Parameters<Parameters<Db["transaction"]>[0]>[0];

type BookingRow = typeof bookings.$inferSelect;

type OperationalAssignment = {
  teamId: number;
  teamName: string;
};

export const NATIVE_BOOKING_OPERATIONAL_ORIGIN = "native_booking";

export function nativeBookingFrequency(recurrence: string): string {
  if (recurrence === "weekly") return "Weekly";
  if (recurrence === "biweekly") return "Bi-weekly";
  if (recurrence === "monthly") return "Monthly";
  return "One time";
}

export function nativeBookingServiceDateTime(booking: BookingRow): string {
  return new Date(
    businessLocalDateTimeToUtcMs(
      booking.requestedLocalDate,
      booking.requestedLocalTime,
      booking.requestedTimeZone,
    ),
  ).toISOString();
}

export function nativeBookingExtras(booking: BookingRow): string {
  return JSON.stringify(booking.extras.map((extra) => extra.id));
}

export function nativeBookingCustomerNotes(
  booking: BookingRow,
  companyNotes = booking.companyNotes,
): string | null {
  const notes = [...booking.specialRequestNotes, companyNotes?.trim() ?? ""].filter(Boolean);
  return notes.length > 0 ? notes.join("\n") : null;
}

export function nativeBookingHasCard(paymentStatus: string): 0 | 1 {
  return paymentStatus === "card_on_file" || paymentStatus === "authorized" || paymentStatus === "captured" ? 1 : 0;
}

export async function syncNativeBookingPaymentState(
  tx: TransactionClient,
  input: {
    bookingId: number;
    paymentStatus: string;
    paymentBrand?: string | null;
    paymentLast4?: string | null;
    stripePaymentIntentId?: string | null;
  },
): Promise<void> {
  const now = new Date();
  await tx
    .update(bookings)
    .set({
      paymentStatus: input.paymentStatus as BookingRow["paymentStatus"],
      updatedAt: now,
    })
    .where(eq(bookings.id, input.bookingId));

  const operationalUpdate: Partial<LeadflowJob> & { updatedAt: Date } = {
    hasStripeCard: nativeBookingHasCard(input.paymentStatus),
    updatedAt: now,
  };
  if (input.paymentBrand !== undefined) operationalUpdate.paymentBrand = input.paymentBrand;
  if (input.paymentLast4 !== undefined) operationalUpdate.paymentLast4 = input.paymentLast4;

  await tx
    .update(leadflowJobs)
    .set(operationalUpdate)
    .where(eq(leadflowJobs.bookingId, input.bookingId));
}

export async function syncNativeBookingOperationalProjection(
  tx: TransactionClient,
  booking: BookingRow,
  assignment: OperationalAssignment | null,
  options?: { commercialOnly: boolean; selectedJobId: number | null; futureJobIds: number[] },
): Promise<void> {
  const now = new Date();
  const currentRows = await tx
    .select({ id: leadflowJobs.id, jobDate: leadflowJobs.jobDate })
    .from(leadflowJobs)
    .where(eq(leadflowJobs.bookingId, booking.id));

  const matchingRows = currentRows.filter((row) => row.jobDate === booking.requestedLocalDate);
  if (matchingRows.length > 1 || (matchingRows.length === 0 && currentRows.length > 0)) {
    throw new TRPCError({
      code: "CONFLICT",
      message: "The canonical booking visit cannot be selected safely for operational projection.",
    });
  }
  const current = matchingRows[0];

  if (options?.commercialOnly) {
    if ((current?.id ?? null) !== options.selectedJobId) {
      throw new TRPCError({ code: "CONFLICT", message: "The rescheduled operational visit changed before commercial projection." });
    }
    // Operational rescheduling already selected/moved the old occurrence.
    // Future IDs retain the original boundary even when this visit crosses them.
    if (current) await tx.update(leadflowJobs).set({
      extras: nativeBookingExtras(booking),
      customerNotes: nativeBookingCustomerNotes(booking),
      jobTotalCents: booking.firstCleaningTotalCents,
      updatedAt: now,
    }).where(eq(leadflowJobs.id, current.id));
    if (options.futureJobIds.length) await tx.update(leadflowJobs).set({
      extras: nativeBookingExtras(booking),
      customerNotes: nativeBookingCustomerNotes(booking),
      jobTotalCents: booking.futureVisitTotalCents ?? booking.firstCleaningTotalCents,
      updatedAt: now,
    }).where(and(eq(leadflowJobs.bookingId, booking.id), inArray(leadflowJobs.id, options.futureJobIds)));
    return;
  }

  if (!assignment) {
    await tx
      .update(leadflowJobs)
      .set({
        bookingStatus: booking.status === "cancelled" ? "cancelled" : "unassigned",
        updatedAt: now,
      })
      .where(eq(leadflowJobs.bookingId, booking.id));
    return;
  }

  const operationalJob = {
    bookingId: booking.id,
    jobDate: booking.requestedLocalDate,
    serviceDateTime: nativeBookingServiceDateTime(booking),
    customerName: booking.customerName,
    customerPhone: booking.customerPhone,
    customerEmail: booking.customerEmail,
    jobAddress: booking.address,
    serviceName: booking.serviceName,
    bedrooms: booking.bedrooms,
    bathrooms: booking.bathrooms,
    extras: nativeBookingExtras(booking),
    frequency: nativeBookingFrequency(booking.recurrence),
    teamName: assignment.teamName,
    teamId: assignment.teamId,
    customerNotes: nativeBookingCustomerNotes(booking),
    jobTotalCents: booking.firstCleaningTotalCents,
    hasStripeCard: nativeBookingHasCard(booking.paymentStatus),
  };

  if (current) {
    await tx
      .update(leadflowJobs)
      .set({ ...operationalJob, bookingStatus: "assigned", updatedAt: now })
      .where(eq(leadflowJobs.id, current.id));
  } else {
    await tx.insert(leadflowJobs).values({
      origin: NATIVE_BOOKING_OPERATIONAL_ORIGIN,
      launch27BookingId: null,
      bookingSeriesId: null,
      bookingStatus: "assigned",
      ...operationalJob,
    });
  }

  await tx
    .update(leadflowJobs)
    .set({
      teamName: assignment.teamName,
      teamId: assignment.teamId,
      extras: operationalJob.extras,
      frequency: operationalJob.frequency,
      customerNotes: operationalJob.customerNotes,
      jobTotalCents: booking.futureVisitTotalCents ?? operationalJob.jobTotalCents,
      hasStripeCard: operationalJob.hasStripeCard,
      updatedAt: now,
    })
    .where(
      and(
        eq(leadflowJobs.bookingId, booking.id),
        gt(leadflowJobs.jobDate, booking.requestedLocalDate),
      ),
    );

  if (booking.futureVisitTotalCents === null) {
    await tx
      .update(leadflowJobs)
      .set({ bookingStatus: "cancelled", updatedAt: now })
      .where(
        and(
          eq(leadflowJobs.bookingId, booking.id),
          gt(leadflowJobs.jobDate, booking.requestedLocalDate),
        ),
      );
  }
}
