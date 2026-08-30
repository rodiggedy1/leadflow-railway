import { randomBytes } from "crypto";
import { and, asc, desc, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { router, publicProcedure, adminAgentProcedure } from "./_core/trpc";
import { getDb } from "./db";
import { appSettings, bookingSeries, bookings, cardAuthTokens } from "../drizzle/schema";
import { BOOKING_WIDGET_DRAFT_SETTING, DEFAULT_BOOKING_WIDGET_DRAFT, parseBookingWidgetDraft } from "../shared/bookingWidgetConfig";
import { beginBookingPaymentInputSchema, bookingGetInputSchema, bookingListInputSchema, captureBookingLeadInputSchema, prepareBookingInputSchema, updateBookingLeadInputSchema } from "../shared/booking";
import { NativeBookingIdempotencyConflictError, NativeBookingInputError, buildPreparedNativeBooking, prepareNativeBooking, updatePreparedNativeBooking, type PreparedNativeBooking } from "./bookingsService";
import { ENV } from "./_core/env";

const PREPARE_WINDOW_MS = 10 * 60_000;
const PREPARE_LIMIT = 20;
const prepareAttempts = new Map<string, { count: number; resetAt: number }>();

function requestKey(req: { headers: { [key: string]: string | string[] | undefined }; socket?: { remoteAddress?: string | null } }): string {
  const forwarded = req.headers["x-forwarded-for"];
  const firstForwarded = Array.isArray(forwarded) ? forwarded[0] : typeof forwarded === "string" ? forwarded.split(",")[0] : "";
  return String(firstForwarded || req.socket?.remoteAddress || "unknown").trim();
}

export function assertBookingPrepareRateLimit(key: string, nowMs = Date.now()): void {
  const existing = prepareAttempts.get(key);
  if (!existing || existing.resetAt <= nowMs) { prepareAttempts.set(key, { count: 1, resetAt: nowMs + PREPARE_WINDOW_MS }); return; }
  if (existing.count >= PREPARE_LIMIT) throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Too many booking attempts. Please try again shortly." });
  existing.count += 1;
}
export function resetBookingPrepareRateLimitForTests(): void { prepareAttempts.clear(); }

export function isNativeBookingDuplicateEntry(error: unknown): boolean {
  let current: unknown = error;
  const seen = new Set<unknown>();
  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    const candidate = current as { code?: string; errno?: number; message?: string; cause?: unknown };
    if (candidate.code === "ER_DUP_ENTRY" || candidate.errno === 1062 || candidate.message?.includes("Duplicate entry") === true) return true;
    current = candidate.cause;
  }
  return false;
}

async function findBookingByIdempotencyKey(db: Awaited<ReturnType<typeof getDb>>, idempotencyKey: string) {
  if (!db) return undefined;
  const rows = await db.select({ publicBookingNumber: bookings.publicBookingNumber, commandHash: bookings.commandHash }).from(bookings).where(eq(bookings.idempotencyKey, idempotencyKey)).limit(1);
  return rows[0];
}

async function persistPreparedBooking(db: NonNullable<Awaited<ReturnType<typeof getDb>>>, prepared: PreparedNativeBooking) {
  try {
    const booking = await db.transaction(async (tx) => {
      const now = new Date();
      const result = await tx.insert(bookings).values({ publicBookingNumber: prepared.publicBookingNumber, idempotencyKey: prepared.idempotencyKey, commandHash: prepared.commandHash, source: prepared.source, funnelStage: prepared.funnelStage, status: prepared.status, availabilityStatus: prepared.availabilityStatus, assignmentStatus: prepared.assignmentStatus, paymentStatus: prepared.paymentStatus, customerName: prepared.customerName, customerPhone: prepared.customerPhone, customerEmail: prepared.customerEmail, serviceId: prepared.serviceId, serviceName: prepared.serviceName, bedrooms: prepared.bedrooms, bathrooms: prepared.bathrooms, extras: prepared.extras, specialRequestNotes: prepared.specialRequestNotes, address: prepared.address, requestedLocalDate: prepared.requestedLocalDate, requestedLocalTime: prepared.requestedLocalTime, requestedTimeZone: prepared.requestedTimeZone, requestedStartAt: prepared.requestedStartAt, recurrence: prepared.recurrence, recurringIntentStatus: prepared.recurringIntentStatus, pricingVersion: prepared.pricingVersion, firstCleaningTotalCents: prepared.firstCleaningTotalCents, futureVisitTotalCents: prepared.futureVisitTotalCents, priceSnapshot: prepared.priceSnapshot, expiresAt: null, createdAt: now, updatedAt: now });
      const bookingId = Number((result as unknown as { insertId?: number })?.insertId ?? (result as unknown as Array<{ insertId?: number }>)[0]?.insertId);
      if (!Number.isInteger(bookingId) || bookingId < 1) throw new Error("Native booking insert did not return an ID.");
      if (prepared.recurrence !== "one-time" && prepared.futureVisitTotalCents !== null) await tx.insert(bookingSeries).values({ bookingId, status: "intent_pending", frequency: prepared.recurrence, anchorLocalDate: prepared.requestedLocalDate, anchorLocalTime: prepared.requestedLocalTime, timeZone: prepared.requestedTimeZone, firstCleaningTotalCents: prepared.firstCleaningTotalCents, futureVisitTotalCents: prepared.futureVisitTotalCents, createdAt: now, updatedAt: now });
      return { publicBookingNumber: prepared.publicBookingNumber, commandHash: prepared.commandHash };
    });
    return { booking, created: true };
  } catch (error) {
    if (!isNativeBookingDuplicateEntry(error)) throw error;
    const existing = await findBookingByIdempotencyKey(db, prepared.idempotencyKey);
    if (!existing) throw error;
    return { booking: existing, created: false };
  }
}

function mapAdminBooking(row: typeof bookings.$inferSelect) {
  return { id: row.id, publicBookingNumber: row.publicBookingNumber, funnelStage: row.funnelStage, status: row.status, availabilityStatus: row.availabilityStatus, assignmentStatus: row.assignmentStatus, paymentStatus: row.paymentStatus, customerName: row.customerName, customerPhone: row.customerPhone, customerEmail: row.customerEmail, serviceId: row.serviceId, serviceName: row.serviceName, bedrooms: row.bedrooms, bathrooms: row.bathrooms, extras: row.extras, specialRequestNotes: row.specialRequestNotes, address: row.address, requestedLocalDate: row.requestedLocalDate, requestedLocalTime: row.requestedLocalTime, requestedTimeZone: row.requestedTimeZone, requestedStartAt: row.requestedStartAt, recurrence: row.recurrence, recurringIntentStatus: row.recurringIntentStatus, pricingVersion: row.pricingVersion, firstCleaningTotalCents: row.firstCleaningTotalCents, futureVisitTotalCents: row.futureVisitTotalCents, stripeCustomerId: row.stripeCustomerId, stripePaymentMethodId: row.stripePaymentMethodId, cardBrand: row.cardBrand, cardLast4: row.cardLast4, cardExpMonth: row.cardExpMonth, cardExpYear: row.cardExpYear, cardSavedAt: row.cardSavedAt, expiresAt: row.expiresAt, createdAt: row.createdAt, updatedAt: row.updatedAt };
}

async function translateBookingError<T>(work: () => Promise<T>): Promise<T> {
  try { return await work(); }
  catch (error) {
    if (error instanceof NativeBookingIdempotencyConflictError) throw new TRPCError({ code: "CONFLICT", message: "IDEMPOTENCY_CONFLICT" });
    if (error instanceof NativeBookingInputError || error instanceof RangeError) throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
    throw error;
  }
}

export const bookingsRouter = router({
  getPublicWidgetConfig: publicProcedure.query(async () => { const db = await getDb(); if (!db) return DEFAULT_BOOKING_WIDGET_DRAFT; const rows = await db.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, BOOKING_WIDGET_DRAFT_SETTING.key)).limit(1); return parseBookingWidgetDraft(rows[0]?.value); }),
  prepare: publicProcedure.input(prepareBookingInputSchema).mutation(async ({ ctx, input }) => { assertBookingPrepareRateLimit(requestKey(ctx.req)); const db = await getDb(); if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Booking service unavailable." }); return translateBookingError(() => prepareNativeBooking(input, { nowMs: Date.now(), timeZone: ENV.businessTimezone, persist: (prepared) => persistPreparedBooking(db, prepared) })); }),
  captureLead: publicProcedure.input(captureBookingLeadInputSchema).mutation(async ({ ctx, input }) => { assertBookingPrepareRateLimit(requestKey(ctx.req)); const db = await getDb(); if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Booking service unavailable." }); return translateBookingError(() => prepareNativeBooking(input, { nowMs: Date.now(), timeZone: ENV.businessTimezone, persist: (prepared) => persistPreparedBooking(db, prepared) }, { funnelStage: "lead", requireCompleteCustomer: false })); }),
  updateLead: publicProcedure.input(updateBookingLeadInputSchema).mutation(async ({ ctx, input }) => { assertBookingPrepareRateLimit(requestKey(ctx.req)); const db = await getDb(); if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Booking service unavailable." }); const rows = await db.select().from(bookings).where(and(eq(bookings.idempotencyKey, input.idempotencyKey), eq(bookings.publicBookingNumber, input.publicBookingNumber))).limit(1); const booking = rows[0]; if (!booking) throw new TRPCError({ code: "NOT_FOUND", message: "Booking not found." }); const update = updatePreparedNativeBooking({ customerEmail: booking.customerEmail, address: booking.address }, input); await db.update(bookings).set({ ...update, updatedAt: new Date() }).where(eq(bookings.id, booking.id)); return { publicBookingNumber: booking.publicBookingNumber, funnelStage: booking.funnelStage }; }),
  beginPayment: publicProcedure.input(beginBookingPaymentInputSchema).mutation(async ({ ctx, input }) => { assertBookingPrepareRateLimit(requestKey(ctx.req)); const db = await getDb(); if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Booking service unavailable." }); const rows = await db.select().from(bookings).where(and(eq(bookings.idempotencyKey, input.idempotencyKey), eq(bookings.publicBookingNumber, input.publicBookingNumber))).limit(1); const booking = rows[0]; if (!booking) throw new TRPCError({ code: "NOT_FOUND", message: "Booking not found." }); const built = buildPreparedNativeBooking(input, { nowMs: Date.now(), timeZone: ENV.businessTimezone, funnelStage: "pending_payment" }); if (built.type === "price_changed") return built.result; const prepared = built.prepared; const token = booking.stripeCardAuthToken || randomBytes(32).toString("hex"); if (!booking.stripeCardAuthToken) await db.insert(cardAuthTokens).values({ token, customerPhone: prepared.customerPhone, customerName: prepared.customerName, jobDate: prepared.requestedLocalDate, jobAddress: prepared.address, nativeBookingId: booking.id, used: 0, expiresAt: Date.now() + 30 * 60_000 }); await db.update(bookings).set({ funnelStage: "pending_payment", status: "pending_payment", paymentStatus: "pending", customerEmail: prepared.customerEmail, address: prepared.address, commandHash: prepared.commandHash, serviceId: prepared.serviceId, serviceName: prepared.serviceName, bedrooms: prepared.bedrooms, bathrooms: prepared.bathrooms, extras: prepared.extras, specialRequestNotes: prepared.specialRequestNotes, requestedLocalDate: prepared.requestedLocalDate, requestedLocalTime: prepared.requestedLocalTime, requestedTimeZone: prepared.requestedTimeZone, requestedStartAt: prepared.requestedStartAt, recurrence: prepared.recurrence, recurringIntentStatus: prepared.recurringIntentStatus, pricingVersion: prepared.pricingVersion, firstCleaningTotalCents: prepared.firstCleaningTotalCents, futureVisitTotalCents: prepared.futureVisitTotalCents, priceSnapshot: prepared.priceSnapshot, stripeCardAuthToken: token, updatedAt: new Date() }).where(eq(bookings.id, booking.id)); return { type: "payment_ready" as const, publicBookingNumber: booking.publicBookingNumber, cardAuthToken: token, totalCents: prepared.firstCleaningTotalCents }; }),
  list: adminAgentProcedure.input(bookingListInputSchema.optional()).query(async ({ input }) => { const db = await getDb(); if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Booking service unavailable." }); const conditions = [input?.date ? eq(bookings.requestedLocalDate, input.date) : undefined, input?.status ? eq(bookings.status, input.status) : undefined].filter(Boolean) as ReturnType<typeof eq>[]; const query = db.select().from(bookings); const rows = conditions.length ? await query.where(and(...conditions)).orderBy(asc(bookings.requestedLocalTime), desc(bookings.createdAt)).limit(input?.limit ?? 200) : await query.orderBy(asc(bookings.requestedLocalDate), asc(bookings.requestedLocalTime), desc(bookings.createdAt)).limit(input?.limit ?? 200); const search = input?.query?.trim().toLowerCase(); return rows.filter((row) => !search || `${row.customerName} ${row.customerPhone} ${row.customerEmail} ${row.address} ${row.publicBookingNumber}`.toLowerCase().includes(search)).map(mapAdminBooking); }),
  get: adminAgentProcedure.input(bookingGetInputSchema).query(async ({ input }) => { const db = await getDb(); if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Booking service unavailable." }); const rows = await db.select().from(bookings).where(eq(bookings.id, input.id)).limit(1); if (!rows[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Booking not found." }); return mapAdminBooking(rows[0]); }),
});
