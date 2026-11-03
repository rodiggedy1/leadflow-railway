import { and, desc, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import {
  bookingFunnelRecords,
  bookingPaymentProfiles,
  bookingSeries,
  bookings,
  type Booking,
  type BookingFunnelRecord,
  type BookingPaymentProfile,
} from "../drizzle/schema";
import { NativeBookingInputError, type PreparedNativeBooking } from "./bookingsService";

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
  /** Default false; personalized customer-link callers only. */
  syncFunnelDetails?: boolean;
  replayCompletedFunnel?: boolean;
  /** Rebuild from the locked quote/booking so a stale route read cannot win. */
  prepareLockedFunnelDetails?: (funnel: BookingFunnelRecord, booking: Booking | undefined) => PreparedNativeBooking;
  /** Personalized payment preparation reuses a bound native target without repersisting it. */
  paymentTargetOnly?: boolean;
  expectedFunnelIdentity?: Pick<BookingFunnelRecord, "publicFunnelNumber" | "idempotencyKey" | "source">;
};

export type CanonicalPersistenceResult = {
  bookingId: number;
  publicBookingNumber: string;
  commandHash: string;
  funnelRecordId: number;
  created: boolean;
  paymentTarget?: { profile: BookingPaymentProfile; totalCents: number; customerName: string };
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

function customerLinkDetailsChanged(booking: Booking, prepared: PreparedNativeBooking): boolean {
  const fields = [
    "customerName", "customerPhone", "customerEmail", "serviceId", "serviceName",
    "bedrooms", "bathrooms", "homeType", "extras", "specialRequestNotes", "address",
    "requestedLocalDate", "requestedLocalTime", "requestedTimeZone", "requestedStartAt",
    "recurrence", "pricingVersion", "firstCleaningTotalCents", "futureVisitTotalCents", "priceSnapshot",
  ] as const;
  return fields.some(field => JSON.stringify(booking[field] ?? null) !== JSON.stringify(prepared[field] ?? null));
}

function customerLinkConflict(): never {
  throw new TRPCError({ code: "CONFLICT", message: "This booking can no longer be changed. Please contact us for help." });
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
  prepared: PreparedNativeBooking | undefined,
  options: CanonicalPersistenceOptions = {},
): Promise<CanonicalPersistenceResult> {
  try {
    return await db.transaction(async tx => {
      const now = new Date();
      let funnelRecordId = options.funnelRecordId;
      let bookingId: number;
      let created = true;
      if (funnelRecordId) {
        const funnelQuery = tx.select().from(bookingFunnelRecords).where(eq(bookingFunnelRecords.id, funnelRecordId)).limit(1);
        const [funnel] = await (options.syncFunnelDetails ? funnelQuery.for("update") : funnelQuery);
        if (!funnel) throw new Error("Canonical booking funnel record not found.");
        if (options.syncFunnelDetails) {
          const expected = options.expectedFunnelIdentity;
          if (expected && (funnel.publicFunnelNumber !== expected.publicFunnelNumber || funnel.idempotencyKey !== expected.idempotencyKey || funnel.source !== expected.source)) {
            throw new TRPCError({ code: "NOT_FOUND", message: "Booking record not found." });
          }
          if (!["customer-booking-link", "madison-quote"].includes(funnel.source) || funnel.stage === "cancelled") {
            throw new TRPCError({ code: "NOT_FOUND", message: "This booking link is no longer available." });
          }
          const [booking] = funnel.bookingId
            ? await tx.select().from(bookings).where(eq(bookings.id, funnel.bookingId)).limit(1).for("update")
            : [];
          // Native cancellation deliberately does not update the funnel stage.
          if (booking?.status === "cancelled") throw new TRPCError({ code: "NOT_FOUND", message: "This booking link is no longer available." });
          if (funnel.bookingId && !booking) throw new TRPCError({ code: "NOT_FOUND", message: "Booking record not found." });
          if (booking && ["completed", "expired"].includes(booking.status)) customerLinkConflict();
          const [profile] = booking
            ? await tx.select().from(bookingPaymentProfiles).where(eq(bookingPaymentProfiles.bookingId, booking.id)).limit(1).for("update")
            : [];
          if (profile && profile.funnelRecordId !== funnelRecordId) customerLinkConflict();
          if (options.paymentTargetOnly && booking) {
            if (!["payment_incomplete", "booked"].includes(funnel.stage) || !profile) customerLinkConflict();
            // Setup cannot safely restart an authorized/captured payment.
            if ([booking.paymentStatus, profile.paymentStatus].some(status => ["authorized", "captured", "paid"].includes(status)) || profile.authorizedAt || profile.capturedAt) customerLinkConflict();
            if (funnel.stage === "booked" && profile.paymentStatus !== "card_on_file") customerLinkConflict();
            return {
              bookingId: booking.id, publicBookingNumber: booking.publicBookingNumber, commandHash: booking.commandHash, funnelRecordId, created: false,
              paymentTarget: { profile, totalCents: booking.firstCleaningTotalCents, customerName: booking.customerName },
            };
          }
          if (funnel.stage === "booked" && booking) {
            if (!options.replayCompletedFunnel) throw new TRPCError({ code: "CONFLICT", message: "This booking can no longer be changed." });
            return { bookingId: booking.id, publicBookingNumber: booking.publicBookingNumber, commandHash: booking.commandHash, funnelRecordId, created: false };
          }
          if (!["lead", "payment_incomplete"].includes(funnel.stage) || (options.paymentTargetOnly && funnel.stage !== "payment_incomplete")) {
            throw new TRPCError({ code: "CONFLICT", message: "This booking can no longer be changed." });
          }
          if (options.prepareLockedFunnelDetails) prepared = options.prepareLockedFunnelDetails(funnel, booking);
          if (!prepared) throw new Error("Canonical booking details were not prepared.");
          if (prepared.idempotencyKey !== funnel.idempotencyKey) throw new Error("Canonical booking must use the original funnel identity.");
          if (booking) {
            const [series] = await tx.select().from(bookingSeries).where(eq(bookingSeries.bookingId, booking.id)).limit(1).for("update");
            const protectedOperations = !["pending_payment", "needs_attention"].includes(booking.status)
              || booking.assignmentStatus !== "unassigned" || booking.availabilityStatus !== "requested"
              || (booking.recurringIntentStatus !== null && booking.recurringIntentStatus !== "intent_pending")
              || (series && series.status !== "intent_pending");
            const committedPayment = [booking.paymentStatus, profile?.paymentStatus].some(status => status && ["authorized", "captured", "paid", "charge_pending"].includes(status))
              || profile?.authorizedAt || profile?.capturedAt || profile?.stripePaymentIntentId;
            if (protectedOperations || committedPayment) {
              if (customerLinkDetailsChanged(booking, prepared)) customerLinkConflict();
              return { bookingId: booking.id, publicBookingNumber: booking.publicBookingNumber, commandHash: booking.commandHash, funnelRecordId, created: false };
            }
            const paymentIdentityExists = profile?.stripeCustomerId || profile?.stripeSetupIntentId || profile?.stripePaymentMethodId || funnel.stripeCustomerId || funnel.stripePaymentMethodId;
            if (paymentIdentityExists && (["customerName", "customerPhone", "customerEmail"] as const).some(field => booking[field] !== prepared![field])) customerLinkConflict();
          }
        }
        if (!prepared) throw new Error("Canonical booking details were not prepared.");
        if (funnel.bookingId) {
          bookingId = funnel.bookingId;
          created = false;
          await tx.update(bookings).set({
            commandHash: prepared.commandHash,
            source: options.bookingSource ?? prepared.source,
            ...(!options.syncFunnelDetails ? {
              status: options.initialBookingStatus ?? "pending_payment",
              availabilityStatus: prepared.availabilityStatus,
              assignmentStatus: prepared.assignmentStatus,
            } : { homeType: prepared.homeType }),
            ...(options.paymentMethod && !options.syncFunnelDetails
              ? { paymentMethod: options.paymentMethod }
              : {}),
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
            ...(options.syncFunnelDetails ? { homeType: prepared.homeType } : {}),
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
          if (!options.syncFunnelDetails) await tx.update(bookingFunnelRecords).set({ bookingId, updatedAt: now }).where(eq(bookingFunnelRecords.id, funnelRecordId));
        }
        if (options.syncFunnelDetails) {
          await tx.update(bookingFunnelRecords).set({
            customerName: prepared.customerName,
            customerPhone: prepared.customerPhone,
            customerEmail: prepared.customerEmail,
            serviceId: prepared.serviceId,
            serviceName: prepared.serviceName,
            bedrooms: prepared.bedrooms,
            bathrooms: prepared.bathrooms,
            extras: prepared.extras.map(({ id, quantity }) => ({ id, quantity })),
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
            bookingId,
            stage: options.funnelStage ?? "payment_incomplete",
            updatedAt: now,
          }).where(eq(bookingFunnelRecords.id, funnelRecordId));
        }
      } else {
        if (!prepared) throw new Error("Canonical booking details were not prepared.");
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
      if (!prepared) throw new Error("Canonical booking details were not prepared.");
      await createOrUpdateSeries(tx, prepared, bookingId, now);
      if (!funnelRecordId) throw new Error("Canonical booking funnel record was not created.");
      let [profile] = await tx.select().from(bookingPaymentProfiles).where(eq(bookingPaymentProfiles.bookingId, bookingId)).limit(1);
      if (!profile) {
        await tx.insert(bookingPaymentProfiles).values({ bookingId, funnelRecordId, paymentStatus: "not_started", version: 1, createdAt: now, updatedAt: now });
        if (options.paymentTargetOnly) [profile] = await tx.select().from(bookingPaymentProfiles).where(eq(bookingPaymentProfiles.bookingId, bookingId)).limit(1);
      }
      const [booking] = await tx.select({ publicBookingNumber: bookings.publicBookingNumber, commandHash: bookings.commandHash }).from(bookings).where(eq(bookings.id, bookingId)).limit(1);
      return {
        bookingId, publicBookingNumber: booking?.publicBookingNumber ?? prepared.publicBookingNumber, commandHash: booking?.commandHash ?? prepared.commandHash, funnelRecordId, created,
        ...(options.paymentTargetOnly && profile ? { paymentTarget: { profile, totalCents: prepared.firstCleaningTotalCents, customerName: prepared.customerName } } : {}),
      };
    });
  } catch (error) {
    if (options.syncFunnelDetails && error instanceof NativeBookingInputError) throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
    if (options.syncFunnelDetails || !prepared || !duplicateEntry(error)) throw error;
    const [existing] = await db.select({ id: bookings.id, publicBookingNumber: bookings.publicBookingNumber, commandHash: bookings.commandHash }).from(bookings).where(eq(bookings.idempotencyKey, prepared.idempotencyKey)).limit(1);
    if (!existing) throw error;
    const [funnel] = await db.select({ id: bookingFunnelRecords.id }).from(bookingFunnelRecords).where(eq(bookingFunnelRecords.bookingId, existing.id)).orderBy(desc(bookingFunnelRecords.id)).limit(1);
    if (!funnel) throw error;
    return { bookingId: existing.id, publicBookingNumber: existing.publicBookingNumber, commandHash: existing.commandHash, funnelRecordId: funnel.id, created: false };
  }
}
