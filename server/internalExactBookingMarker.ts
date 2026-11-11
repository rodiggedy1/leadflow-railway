import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { bookingCashAppPayments, bookingFunnelRecords, bookingPaymentProfiles, bookingSeries, bookings, type Booking, type BookingFunnelRecord, type BookingPaymentProfile, type BookingCashAppPayment } from "../drizzle/schema";
import { bookingArrivalPreferenceSchema } from "../shared/bookingArrival";
import { isPublicBookingPriceSnapshot } from "../shared/publicBookingPricing";
import { BOOKING_PAYMENT_CONSENT_TEXT, BOOKING_PAYMENT_CONSENT_VERSION } from "../shared/bookingPayment";
import type { PreparedNativeBooking } from "./bookingsService";

type Db = NonNullable<Awaited<ReturnType<typeof import("./db").getDb>>>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export type InternalExactMethod = "card" | "cashapp" | "invoice";
export type InternalExactMarker = {
  version: 1;
  creatorId: number;
  creatorName: string;
  idempotencyKey: string;
  commandHash: string;
  paymentMethod: InternalExactMethod;
  withoutPayment: boolean;
  snapshotHash: string;
  detailsHash: string;
};
export type InternalExactOperation = "replay" | "start" | "confirm" | "finalize" | "cash_prepare" | "cash_settle" | "cash_unavailable" | "webhook";
export type InternalExactTarget = { booking: Booking; profile: BookingPaymentProfile; funnel: BookingFunnelRecord; marker: InternalExactMarker; skip: boolean; alreadyComplete: boolean; payment?: BookingCashAppPayment };

export function internalExactHash(value: unknown): string {
  // Stable across JSON database serialization/object key ordering, but not array changes.
  const stable = (v: unknown): unknown => Array.isArray(v) ? v.map(stable)
    : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, stable(item)])) : v;
  return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
}

export function hasInternalExactMarker(snapshot: unknown): boolean {
  return !!snapshot && typeof snapshot === "object" && Object.prototype.hasOwnProperty.call(snapshot, "internalExactForm");
}

export function getInternalExactMarker(snapshot: unknown): InternalExactMarker {
  const marker = (snapshot as { internalExactForm?: InternalExactMarker } | null)?.internalExactForm;
  if (!marker || marker.version !== 1 || !Number.isInteger(marker.creatorId) || marker.creatorId < 1 || typeof marker.creatorName !== "string" || !marker.creatorName || !["card", "cashapp", "invoice"].includes(marker.paymentMethod) || typeof marker.withoutPayment !== "boolean" || marker.withoutPayment !== (marker.paymentMethod === "invoice") || ![marker.commandHash, marker.snapshotHash, marker.detailsHash].every(v => typeof v === "string" && /^[a-f0-9]{64}$/.test(v)) || typeof marker.idempotencyKey !== "string") exactConflict();
  return marker;
}

export function exactConflict(message = "This internal booking can no longer be changed. Please review its current state."): never {
  throw new TRPCError({ code: "CONFLICT", message });
}

const detailFields = ["customerName", "customerPhone", "customerEmail", "serviceId", "serviceName", "bedrooms", "bathrooms", "homeType", "extras", "specialRequestNotes", "address", "requestedLocalDate", "requestedLocalTime", "requestedTimeZone", "requestedStartAt", "recurrence", "pricingVersion", "firstCleaningTotalCents", "futureVisitTotalCents"] as const;
export function internalExactDetailsHash(booking: Pick<Booking, typeof detailFields[number]> | PreparedNativeBooking, companyNotes: string | null): string {
  return internalExactHash({ ...Object.fromEntries(detailFields.map(field => [field, booking[field] ?? null])), companyNotes });
}

export function markInternalExactPrepared(prepared: PreparedNativeBooking, input: { paymentMethod: InternalExactMethod; withoutPayment: boolean; companyNotes: string | null }, creator: { agentId: number; agentName: string }): PreparedNativeBooking {
  const snapshotHash = internalExactHash(prepared.priceSnapshot);
  const detailsHash = internalExactDetailsHash(prepared, input.companyNotes);
  const commandHash = internalExactHash({ canonicalHash: prepared.commandHash, snapshotHash, detailsHash, creatorId: creator.agentId, creatorName: creator.agentName, paymentMethod: input.paymentMethod, withoutPayment: input.withoutPayment });
  const marker: InternalExactMarker = { version: 1, creatorId: creator.agentId, creatorName: creator.agentName, idempotencyKey: prepared.idempotencyKey, commandHash, paymentMethod: input.paymentMethod, withoutPayment: input.withoutPayment, snapshotHash, detailsHash };
  const priceSnapshot = Object.assign({}, prepared.priceSnapshot, { internalExactForm: marker });
  return { ...prepared, commandHash, priceSnapshot };
}

export function assertInternalExactBinding(booking: Booking, profile: BookingPaymentProfile | undefined, funnel: BookingFunnelRecord | undefined, creatorId?: number): InternalExactMarker {
  const marker = getInternalExactMarker(booking.priceSnapshot);
  if (!profile || !funnel || booking.source !== "popup" || funnel.source !== "internal" || booking.bookedByAgentId !== marker.creatorId || booking.bookedByAgentName !== marker.creatorName || (creatorId !== undefined && creatorId !== marker.creatorId) || profile.bookingId !== booking.id || profile.funnelRecordId !== funnel.id || funnel.bookingId !== booking.id || booking.idempotencyKey !== marker.idempotencyKey || funnel.idempotencyKey !== marker.idempotencyKey || booking.commandHash !== marker.commandHash || funnel.commandHash !== marker.commandHash) exactConflict();
  if (internalExactHash(funnel.priceSnapshot) !== internalExactHash(booking.priceSnapshot)) exactConflict("The stored internal booking price no longer matches its snapshot.");
  const { internalExactForm: _marker, ...snapshot } = booking.priceSnapshot as Record<string, unknown>;
  if (!isPublicBookingPriceSnapshot(snapshot) || internalExactHash(snapshot) !== marker.snapshotHash || !bookingArrivalPreferenceSchema.safeParse(snapshot.input.arrivalPreference).success || snapshot.breakdown.firstCleaningTotalCents !== booking.firstCleaningTotalCents || snapshot.breakdown.futureVisitTotalCents !== booking.futureVisitTotalCents || funnel.firstCleaningTotalCents !== booking.firstCleaningTotalCents || funnel.futureVisitTotalCents !== booking.futureVisitTotalCents || snapshot.input.recurrence !== booking.recurrence || snapshot.input.arrivalPreference?.startLocalTime !== booking.requestedLocalTime || internalExactDetailsHash(booking, booking.companyNotes) !== marker.detailsHash) exactConflict("The stored internal booking price or details no longer match their snapshot.");
  const mirrored = ["customerName", "customerPhone", "customerEmail", "serviceId", "serviceName", "bedrooms", "bathrooms", "specialRequestNotes", "address", "requestedLocalDate", "requestedLocalTime", "requestedTimeZone", "recurrence", "pricingVersion"] as const;
  if (mirrored.some(field => internalExactHash(booking[field]) !== internalExactHash(funnel[field])) || internalExactHash(booking.extras.map(({ id, quantity }) => ({ id, quantity }))) !== internalExactHash((funnel.extras ?? []).map(({ id, quantity }) => ({ id, quantity })))) exactConflict();
  return marker;
}

export async function lockInternalExactBooking(tx: Tx, bookingId: number, operation: InternalExactOperation, options: { required?: boolean; creatorId?: number; paymentIntentId?: string; profileId?: number; profileVersion?: number; funnelId?: number } = {}): Promise<InternalExactTarget | null> {
  // Generic engines only enter the new guard for this durable discriminator.
  const [candidate] = await tx.select().from(bookings).where(eq(bookings.id, bookingId)).limit(1);
  if (!candidate || !hasInternalExactMarker(candidate.priceSnapshot)) {
    if (options.required) throw new TRPCError({ code: "NOT_FOUND", message: "Internal booking not found." });
    return null;
  }
  const [booking] = await tx.select().from(bookings).where(eq(bookings.id, bookingId)).limit(1).for("update");
  if (!booking) exactConflict();
  const [profile] = await tx.select().from(bookingPaymentProfiles).where(eq(bookingPaymentProfiles.bookingId, bookingId)).limit(1).for("update");
  const [funnel] = profile ? await tx.select().from(bookingFunnelRecords).where(eq(bookingFunnelRecords.id, profile.funnelRecordId)).limit(1).for("update") : [];
  const marker = assertInternalExactBinding(booking, profile, funnel, options.creatorId);
  if (!profile || !funnel) exactConflict();
  if ((options.profileId !== undefined && options.profileId !== profile.id) || (options.profileVersion !== undefined && options.profileVersion !== profile.version) || (options.funnelId !== undefined && options.funnelId !== funnel.id)) exactConflict("The payment method changed. Please try again.");
  const [series] = await tx.select().from(bookingSeries).where(eq(bookingSeries.bookingId, bookingId)).limit(1).for("update");
  if (booking.recurrence === "one-time" ? !!series : !series || series.frequency !== booking.recurrence || series.firstCleaningTotalCents !== booking.firstCleaningTotalCents || series.futureVisitTotalCents !== booking.futureVisitTotalCents || series.anchorLocalDate !== booking.requestedLocalDate || series.anchorLocalTime !== booking.requestedLocalTime || series.timeZone !== booking.requestedTimeZone) exactConflict();
  const target = { booking, profile, funnel, marker, skip: false, alreadyComplete: false };
  if (operation === "webhook") return target; // Setup events never save/confirm this staff form.
  const closed = !["pending_payment", "needs_attention"].includes(booking.status) || (booking.expiresAt !== null && booking.expiresAt <= Date.now());
  const operational = booking.assignmentStatus !== "unassigned" || booking.availabilityStatus !== "requested" || (booking.recurringIntentStatus !== null && booking.recurringIntentStatus !== "intent_pending") || (series && series.status !== "intent_pending");
  if (operation === "cash_unavailable" && options.paymentIntentId && (closed || operational || profile.paymentStatus === "captured" || booking.paymentStatus === "captured" || !profile.stripePaymentIntentId)) {
    const [payment] = await tx.select().from(bookingCashAppPayments).where(and(eq(bookingCashAppPayments.bookingId, bookingId), eq(bookingCashAppPayments.stripePaymentIntentId, options.paymentIntentId))).limit(1).for("update");
    if (!payment || payment.bookingPaymentProfileId !== profile.id || payment.amountCents !== booking.firstCleaningTotalCents || payment.currency !== "usd") exactConflict("Cash App payment does not belong to this booking.");
    return { ...target, payment, skip: true };
  }
  if (closed || operational || funnel.stage === "cancelled") exactConflict();
  if (marker.withoutPayment) {
    if (operation !== "replay" || booking.status !== "needs_attention" || funnel.stage !== "booked" || booking.paymentMethod !== "invoice" || booking.paymentStatus !== "not_started" || profile.paymentStatus !== "not_started" || profile.stripeCustomerId || profile.stripeSetupIntentId || profile.stripePaymentMethodId || profile.stripePaymentIntentId || profile.authorizedAt || profile.capturedAt) exactConflict();
    return target;
  }
  if ([booking.paymentStatus, profile.paymentStatus].some(state => ["authorized", "paid"].includes(state)) || profile.authorizedAt) exactConflict();
  let cashToCard = false;
  const cardOperation = ["start", "confirm", "finalize"].includes(operation);
  if ((booking.paymentMethod === "cashapp" && cardOperation) || (marker.paymentMethod === "cashapp" && ["card", "apple_pay", "google_pay"].includes(booking.paymentMethod))) {
    const abandoned = await tx.select().from(bookingCashAppPayments).where(eq(bookingCashAppPayments.bookingId, bookingId)).for("update");
    cashToCard = abandoned.length > 0 && abandoned.every(payment => payment.bookingPaymentProfileId === profile.id && payment.amountCents === booking.firstCleaningTotalCents && ["failed", "cancelled"].includes(payment.status));
    if (!cashToCard || profile.stripePaymentIntentId || profile.capturedAt) exactConflict("Finish or safely abandon Cash App before saving a card.");
  }
  const cardPath = cardOperation || (operation === "replay" && ["card", "apple_pay", "google_pay"].includes(booking.paymentMethod));
  if (cardPath) {
    if (profile.stripePaymentIntentId || profile.capturedAt || [booking.paymentStatus, profile.paymentStatus].some(state => ["captured", "charge_pending"].includes(state)) || (!["card", "apple_pay", "google_pay"].includes(booking.paymentMethod) && !cashToCard)) exactConflict();
    const saved = profile.paymentStatus === "card_on_file" && booking.paymentStatus === "card_on_file" && !!profile.stripePaymentMethodId && !!profile.stripeSetupIntentId && !!profile.stripeCustomerId && !!profile.consentAcceptedAt && profile.consentVersion === BOOKING_PAYMENT_CONSENT_VERSION && profile.consentText === BOOKING_PAYMENT_CONSENT_TEXT && funnel.stripeCustomerId === profile.stripeCustomerId && funnel.stripePaymentMethodId === profile.stripePaymentMethodId;
    const completed = saved && funnel.stage === "booked" && booking.status === "needs_attention";
    if (operation === "finalize" && !saved) exactConflict("Add a verified card before confirming this booking.");
    if (operation === "confirm" && completed) exactConflict();
    if (!completed && (funnel.stage !== "payment_incomplete" || booking.status !== "pending_payment")) exactConflict();
    if (!saved && (!(["not_started", "setup_pending", "failed"].includes(profile.paymentStatus)) || !["not_started", "pending", "failed"].includes(booking.paymentStatus))) exactConflict();
    return { ...target, alreadyComplete: completed };
  }
  if (!["replay", "cash_prepare", "cash_settle", "cash_unavailable"].includes(operation) || (booking.paymentMethod !== "cashapp" && !(operation === "cash_prepare" && booking.paymentMethod === "card")) || profile.stripeSetupIntentId || profile.stripePaymentMethodId || profile.consentAcceptedAt || profile.authorizedAt) exactConflict();
  const captured = profile.paymentStatus === "captured" || booking.paymentStatus === "captured" || !!profile.capturedAt;
  if (captured) {
    if (profile.paymentStatus !== "captured" || booking.paymentStatus !== "captured" || !profile.capturedAt || funnel.stage !== "booked" || booking.status !== "needs_attention" || !profile.stripePaymentIntentId || operation === "cash_prepare") exactConflict();
  } else if (funnel.stage !== "payment_incomplete" || booking.status !== "pending_payment" || !["not_started", "charge_pending"].includes(profile.paymentStatus) || !["not_started", "charge_pending"].includes(booking.paymentStatus)) exactConflict();
  const intentId = options.paymentIntentId ?? profile.stripePaymentIntentId;
  const [payment] = intentId ? await tx.select().from(bookingCashAppPayments).where(and(eq(bookingCashAppPayments.bookingId, bookingId), eq(bookingCashAppPayments.stripePaymentIntentId, intentId))).limit(1).for("update") : [];
  if (intentId && (!payment || payment.bookingPaymentProfileId !== profile.id || payment.amountCents !== booking.firstCleaningTotalCents || payment.currency !== "usd" || payment.stripePaymentIntentId !== profile.stripePaymentIntentId || payment.attempt !== profile.version)) exactConflict("Cash App payment does not belong to this booking.");
  if (["cash_settle", "cash_unavailable"].includes(operation) && !payment) exactConflict();
  if (captured && payment?.status !== "paid") exactConflict();
  if (operation === "cash_unavailable" && payment?.status !== "pending") return { ...target, payment, skip: true };
  if (operation === "cash_settle" && !captured && payment?.status !== "pending") exactConflict();
  return { ...target, payment, alreadyComplete: captured };
}
