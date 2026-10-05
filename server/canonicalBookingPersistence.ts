import { and, desc, eq } from "drizzle-orm";
import {
  bookingFunnelRecords,
  bookingPaymentProfiles,
  bookingSeries,
  bookings,
  type BookingFunnelRecord,
} from "../drizzle/schema";
import type { PreparedNativeBooking } from "./bookingsService";

type Db = NonNullable<Awaited<ReturnType<typeof import("./db").getDb>>>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export type CanonicalPersistenceOptions = {
  funnelRecordId?: number;
  funnelSource?: "book-page" | "customer-booking-link" | "internal";
  bookingSource?: PreparedNativeBooking["source"] | "customer-booking-link";
  funnelStage?: "lead" | "payment_incomplete" | "booked";
  paymentMethod?: "card" | "cashapp" | "invoice";
  bookedByAgentId?: number;
  bookedByAgentName?: string;
  companyNotes?: string | null;
  initialBookingStatus?: "pending_payment" | "needs_attention";
};

export type CanonicalPersistenceResult = {
  bookingId: number;
  publicBookingNumber: string;
  commandHash: string;
  funnelRecordId: number;
  created: boolean;
};

function insertId(result: unknown, label: string): number {
  const direct = result as { insertId?: number };
  const nested = (result as Array<{ insertId?: number }> | undefined)?.[0];
  const id = Number(direct?.insertId ?? nested?.insertId);
  if (!Number.isInteger(id) || id < 1) throw new Error(`${label} insert did not return an ID.`);
  return id;
}

function duplicateEntry(error: unknown): boolean {
  const candidate = error as { code?: string; errno?: number; message?: string };
  return candidate.code === "ER_DUP_ENTRY" || candidate.errno === 1062 || candidate.message?.includes("Duplicate entry") === true;
}

async function createOrUpdateSeries(tx: Tx, prepared: PreparedNativeBooking, bookingId: number, now: Date) {
  const [series] = await tx.select().from(bookingSeries).where(eq(bookingSeries.bookingId, bookingId)).limit(1);
  if (prepared.recurrence !== "one-time" && prepared.futureVisitTotalCents !== null) {
    const values = {
      status: "intent_pending" as const,
      frequency: prepared.recurrence,
      anchorLocalDate: prepared.requestedLocalDate,
      anchorLocalTime: prepared.requestedLocalTime,
      timeZone: prepared.requestedTimeZone,
      firstCleaningTotalCents: prepared.firstCleaningTotalCents,
      futureVisitTotalCents: prepared.futureVisitTotalCents,
      updatedAt: now,
    };
    if (series) await tx.update(bookingSeries).set(values).where(eq(bookingSeries.id, series.id));
    else await tx.insert(bookingSeries).values({ bookingId, ...values, createdAt: now });
  } else if (series) {
    await tx.update(bookingSeries).set({ status: "cancelled", updatedAt: now }).where(eq(bookingSeries.id, series.id));
  }
}

async function createInternalFunnel(tx: Tx, prepared: PreparedNativeBooking, bookingId: number, now: Date, options: CanonicalPersistenceOptions): Promise<number> {
  const result = await tx.insert(bookingFunnelRecords).values({
    publicFunnelNumber: `${prepared.publicBookingNumber}-F`,
    idempotencyKey: prepared.idempotencyKey,
    commandHash: prepared.commandHash,
    source: options.funnelSource ?? "internal",
    stage: options.funnelStage ?? "booked",
    bookingId,
    customerName: prepared.customerName,
    customerPhone: prepared.customerPhone,
    customerEmail: prepared.customerEmail,
    serviceId: prepared.serviceId,
    serviceName: prepared.serviceName,
    bedrooms: prepared.bedrooms,
    bathrooms: prepared.bathrooms,
    extras: prepared.extras,
    specialRequestNotes: prepared.specialRequestNotes,
    address: prepared.address,
    requestedLocalDate: prepared.requestedLocalDate,
    requestedLocalTime: prepared.requestedLocalTime,
    requestedTimeZone: prepared.requestedTimeZone,
    recurrence: prepared.recurrence,
    pricingVersion: prepared.pricingVersion,
    firstCleaningTotalCents: prepared.firstCleaningTotalCents,
    futureVisitTotalCents: prepared.futureVisitTotalCents,
    priceSnapshot: prepared.priceSnapshot,
    version: 1,
    createdAt: now,
    updatedAt: now,
  });
  return insertId(result, "Canonical booking funnel record");
}

export async function persistCanonicalBooking(
  db: Db,
  prepared: PreparedNativeBooking,
  options: CanonicalPersistenceOptions = {},
): Promise<CanonicalPersistenceResult> {
  try {
    return await db.transaction(async tx => {
      const now = new Date();
      let funnelRecordId = options.funnelRecordId;
      let bookingId: number;
      let created = true;
      if (funnelRecordId) {
        const [funnel] = await tx.select().from(bookingFunnelRecords).where(eq(bookingFunnelRecords.id, funnelRecordId)).limit(1);
        if (!funnel) throw new Error("Canonical booking funnel record not found.");
        if (funnel.bookingId) {
          bookingId = funnel.bookingId;
          created = false;
          await tx.update(bookings).set({
            commandHash: prepared.commandHash,
            source: options.bookingSource ?? prepared.source,
            status: options.initialBookingStatus ?? "pending_payment",
            availabilityStatus: prepared.availabilityStatus,
            assignmentStatus: prepared.assignmentStatus,
            ...(options.paymentMethod
              ? { paymentMethod: options.paymentMethod }
              : {}),
            customerName: prepared.customerName,
            customerPhone: prepared.customerPhone,
            customerEmail: prepared.customerEmail,
            serviceId: prepared.serviceId,
            serviceName: prepared.serviceName,
            bedrooms: prepared.bedrooms,
            bathrooms: prepared.bathrooms,
            homeType: prepared.homeType,
            extras: prepared.extras,
            specialRequestNotes: prepared.specialRequestNotes,
            address: prepared.address,
            requestedLocalDate: prepared.requestedLocalDate,
            requestedLocalTime: prepared.requestedLocalTime,
            requestedTimeZone: prepared.requestedTimeZone,
            requestedStartAt: prepared.requestedStartAt,
            recurrence: prepared.recurrence,
            recurringIntentStatus: prepared.recurringIntentStatus,
            pricingVersion: prepared.pricingVersion,
            firstCleaningTotalCents: prepared.firstCleaningTotalCents,
            futureVisitTotalCents: prepared.futureVisitTotalCents,
            priceSnapshot: prepared.priceSnapshot,
            updatedAt: now,
          }).where(eq(bookings.id, bookingId));
        } else {
          const result = await tx.insert(bookings).values({
            publicBookingNumber: prepared.publicBookingNumber,
            idempotencyKey: prepared.idempotencyKey,
            commandHash: prepared.commandHash,
            source: options.bookingSource ?? prepared.source,
            status: options.initialBookingStatus ?? "pending_payment",
            availabilityStatus: prepared.availabilityStatus,
            assignmentStatus: prepared.assignmentStatus,
            paymentStatus: prepared.paymentStatus,
            paymentMethod: options.paymentMethod ?? "card",
            bookedByAgentId: options.bookedByAgentId,
            bookedByAgentName: options.bookedByAgentName,
            customerName: prepared.customerName,
            customerPhone: prepared.customerPhone,
            customerEmail: prepared.customerEmail,
            serviceId: prepared.serviceId,
            serviceName: prepared.serviceName,
            bedrooms: prepared.bedrooms,
            bathrooms: prepared.bathrooms,
            homeType: prepared.homeType,
            extras: prepared.extras,
            specialRequestNotes: prepared.specialRequestNotes,
            address: prepared.address,
            requestedLocalDate: prepared.requestedLocalDate,
            requestedLocalTime: prepared.requestedLocalTime,
            requestedTimeZone: prepared.requestedTimeZone,
            requestedStartAt: prepared.requestedStartAt,
            recurrence: prepared.recurrence,
            recurringIntentStatus: prepared.recurringIntentStatus,
            pricingVersion: prepared.pricingVersion,
            firstCleaningTotalCents: prepared.firstCleaningTotalCents,
            futureVisitTotalCents: prepared.futureVisitTotalCents,
            priceSnapshot: prepared.priceSnapshot,
            companyNotes: options.companyNotes ?? null,
            expiresAt: null,
            createdAt: now,
            updatedAt: now,
          });
          bookingId = insertId(result, "Canonical native booking");
          await tx.update(bookingFunnelRecords).set({ bookingId, updatedAt: now }).where(eq(bookingFunnelRecords.id, funnelRecordId));
        }
      } else {
        const result = await tx.insert(bookings).values({
          publicBookingNumber: prepared.publicBookingNumber,
          idempotencyKey: prepared.idempotencyKey,
          commandHash: prepared.commandHash,
          source: options.bookingSource ?? prepared.source,
          status: options.initialBookingStatus ?? "needs_attention",
          availabilityStatus: prepared.availabilityStatus,
          assignmentStatus: prepared.assignmentStatus,
          paymentStatus: prepared.paymentStatus,
          paymentMethod: options.paymentMethod ?? "card",
          bookedByAgentId: options.bookedByAgentId,
          bookedByAgentName: options.bookedByAgentName,
          customerName: prepared.customerName,
          customerPhone: prepared.customerPhone,
          customerEmail: prepared.customerEmail,
          serviceId: prepared.serviceId,
          serviceName: prepared.serviceName,
          bedrooms: prepared.bedrooms,
          bathrooms: prepared.bathrooms,
          homeType: prepared.homeType,
          extras: prepared.extras,
          specialRequestNotes: prepared.specialRequestNotes,
          address: prepared.address,
          requestedLocalDate: prepared.requestedLocalDate,
          requestedLocalTime: prepared.requestedLocalTime,
          requestedTimeZone: prepared.requestedTimeZone,
          requestedStartAt: prepared.requestedStartAt,
          recurrence: prepared.recurrence,
          recurringIntentStatus: prepared.recurringIntentStatus,
          pricingVersion: prepared.pricingVersion,
          firstCleaningTotalCents: prepared.firstCleaningTotalCents,
          futureVisitTotalCents: prepared.futureVisitTotalCents,
          priceSnapshot: prepared.priceSnapshot,
          companyNotes: options.companyNotes ?? null,
          expiresAt: null,
          createdAt: now,
          updatedAt: now,
        });
        bookingId = insertId(result, "Canonical native booking");
        funnelRecordId = await createInternalFunnel(tx, prepared, bookingId, now, options);
      }
      await createOrUpdateSeries(tx, prepared, bookingId, now);
      if (!funnelRecordId) throw new Error("Canonical booking funnel record was not created.");
      const [profile] = await tx.select().from(bookingPaymentProfiles).where(eq(bookingPaymentProfiles.bookingId, bookingId)).limit(1);
      if (!profile) {
        await tx.insert(bookingPaymentProfiles).values({ bookingId, funnelRecordId, paymentStatus: "not_started", version: 1, createdAt: now, updatedAt: now });
      }
      const [booking] = await tx.select({ publicBookingNumber: bookings.publicBookingNumber, commandHash: bookings.commandHash }).from(bookings).where(eq(bookings.id, bookingId)).limit(1);
      return { bookingId, publicBookingNumber: booking?.publicBookingNumber ?? prepared.publicBookingNumber, commandHash: booking?.commandHash ?? prepared.commandHash, funnelRecordId, created };
    });
  } catch (error) {
    if (!duplicateEntry(error)) throw error;
    const [existing] = await db.select({ id: bookings.id, publicBookingNumber: bookings.publicBookingNumber, commandHash: bookings.commandHash }).from(bookings).where(eq(bookings.idempotencyKey, prepared.idempotencyKey)).limit(1);
    if (!existing) throw error;
    const [funnel] = await db.select({ id: bookingFunnelRecords.id }).from(bookingFunnelRecords).where(eq(bookingFunnelRecords.bookingId, existing.id)).orderBy(desc(bookingFunnelRecords.id)).limit(1);
    if (!funnel) throw error;
    return { bookingId: existing.id, publicBookingNumber: existing.publicBookingNumber, commandHash: existing.commandHash, funnelRecordId: funnel.id, created: false };
  }
}
