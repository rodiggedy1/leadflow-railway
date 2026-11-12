import type Stripe from "stripe";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { bookingCashAppPayments, bookingPaymentProfiles, bookings, cashAppPaymentTokens } from "../drizzle/schema";
import { getStripeClient } from "./stripeClient";
import { bookingPaymentMetadata } from "./bookingPaymentService";
import { assertHandoffCapability, assertUnclaimedHandoffVisit, getHandoffTarget, lookupHandoffToken, updateHandoffPaymentOnly, validateHandoffToken, type HandoffDb, type HandoffTarget, type HandoffCapability, type HandoffTx } from "./internalBookingHandoffContext";
import { handoffConflict } from "./internalBookingHandoffToken";
import { broadcastOpsUpdate } from "./sseBroadcast";

export const CASH_HANDOFF_PURPOSE = "cash_v1";
const cashKey = (token: string) => `leadflow:internal-handoff:cash:${token}`;
export function assertInternalHandoffCashIntent(intent: Stripe.PaymentIntent, target: HandoffTarget, cap: HandoffCapability) {
  if (cap.kind !== "cashapp" || intent.metadata?.internalBookingHandoff !== CASH_HANDOFF_PURPOSE || intent.metadata?.cashAppPaymentToken !== cap.row.token || intent.metadata?.bookingId !== String(target.booking.id) || intent.metadata?.bookingPaymentProfileId !== String(target.profile.id) || intent.metadata?.handoffReviewVersion !== String(cap.scope.version) || intent.metadata?.handoffDate !== target.booking.requestedLocalDate || intent.metadata?.handoffAmountCents !== String(cap.row.amountCents) || intent.metadata?.paymentMethod !== "cashapp" || intent.amount !== cap.row.amountCents || intent.currency !== "usd" || intent.payment_method_types.length !== 1 || intent.payment_method_types[0] !== "cashapp") handoffConflict("Cash App provider identity does not match this first cleaning.");
}
type HandoffCashLink = { customerName: string; amountCents: number; description: string; expiresAt: number };
type HandoffCashStatus = { status: string; amountCents: number; description: string };
export function getInternalHandoffCash(db: HandoffDb, token: string, statusOnly?: false): Promise<HandoffCashLink>;
export function getInternalHandoffCash(db: HandoffDb, token: string, statusOnly: true): Promise<HandoffCashStatus>;
export async function getInternalHandoffCash(db: HandoffDb, token: string, statusOnly = false) {
  const { cap } = await validateHandoffToken(db, "cashapp", token, statusOnly ? { allowUsed: true, allowExpired: true, allowUsedPreviousVersion: true } : {});
  if (cap.kind !== "cashapp") handoffConflict();
  if (!statusOnly && !["open", "payment_started"].includes(cap.row.status)) handoffConflict("This Cash App link needs review.");
  return statusOnly ? { status: cap.row.status, amountCents: cap.row.amountCents, description: cap.row.description }
    : { customerName: cap.row.customerName ?? "", amountCents: cap.row.amountCents, description: cap.row.description, expiresAt: cap.row.expiresAt };
}
async function persistRealCashIntent(tx: HandoffTx, target: HandoffTarget, cap: HandoffCapability, intent: Stripe.PaymentIntent) {
  if (cap.kind !== "cashapp") handoffConflict();
  assertInternalHandoffCashIntent(intent, target, cap);
  if (cap.row.stripePaymentIntentId && cap.row.stripePaymentIntentId !== intent.id) handoffConflict();
  if (target.profile.stripePaymentIntentId && target.profile.stripePaymentIntentId !== intent.id) handoffConflict();
  const [stored] = await tx.select().from(bookingCashAppPayments).where(eq(bookingCashAppPayments.stripePaymentIntentId, intent.id)).limit(1).for("update");
  if (stored) {
    if (stored.bookingId !== target.booking.id || stored.bookingPaymentProfileId !== target.profile.id || stored.attempt !== cap.scope.version || stored.amountCents !== cap.row.amountCents || stored.currency !== "usd" || stored.idempotencyKey !== cashKey(cap.row.token)) handoffConflict();
  } else {
    if (cap.row.status !== "payment_started" || target.profile.paymentStatus !== "charge_pending") handoffConflict("No durable Cash App reservation exists for this provider payment.");
    await tx.insert(bookingCashAppPayments).values({ bookingId: target.booking.id, bookingPaymentProfileId: target.profile.id, attempt: cap.scope.version, stripePaymentIntentId: intent.id, idempotencyKey: cashKey(cap.row.token), returnToken: randomUUID(), amountCents: cap.row.amountCents, currency: "usd", status: "pending", cardBrand: null, cardLast4: null, paidAt: null, failureCode: null, failureMessage: null, createdAt: new Date(), updatedAt: new Date() });
  }
  await tx.update(cashAppPaymentTokens).set({ stripePaymentIntentId: intent.id }).where(eq(cashAppPaymentTokens.id, cap.row.id));
  await tx.update(bookingPaymentProfiles).set({ stripePaymentIntentId: intent.id, updatedAt: new Date() }).where(eq(bookingPaymentProfiles.id, target.profile.id));
}

export async function createInternalHandoffCashIntent(db: HandoffDb, token: string) {
  const reserved = await db.transaction(async tx => {
    const initial = await lookupHandoffToken(tx, "cashapp", token);
    const target = await getHandoffTarget(tx, initial.scope.bookingId, true);
    const cap = await lookupHandoffToken(tx, "cashapp", token, true);
    assertHandoffCapability(cap, target);
    if (cap.kind !== "cashapp" || !["open", "payment_started"].includes(cap.row.status)) handoffConflict();
    await assertUnclaimedHandoffVisit(tx, target, token);
    if (target.profile.paymentStatus === "setup_pending" || (target.profile.stripeSetupIntentId && !target.profile.stripePaymentMethodId)) handoffConflict("Finish or review the current secure card entry first.");
    if (target.profile.paymentStatus === "charge_pending") {
      // Exactly this persisted token is the pre-provider owner. No clock/failed
      // status frees the claim; no second token can reuse an ambiguous outcome.
      if (cap.row.status !== "payment_started") handoffConflict("Another payment attempt owns this first cleaning.");
      if (!cap.row.stripePaymentIntentId && Date.now() - target.profile.updatedAt.getTime() >= 23 * 60 * 60 * 1000) handoffConflict("Cash App outcome is unresolved beyond the provider replay window. Manual review is required; do not create another charge.");
    } else {
      if (cap.row.status !== "open" || cap.row.stripePaymentIntentId) handoffConflict();
      await tx.update(bookingPaymentProfiles).set({ paymentStatus: "charge_pending", failureCode: null, failureMessage: null, updatedAt: new Date() }).where(eq(bookingPaymentProfiles.id, target.profile.id));
      await tx.update(cashAppPaymentTokens).set({ status: "payment_started" }).where(eq(cashAppPaymentTokens.id, cap.row.id));
      await updateHandoffPaymentOnly(tx, target, "charge_pending");
    }
    return { cap, target };
  });
  if (reserved.cap.kind !== "cashapp") handoffConflict();
  const stripe = getStripeClient();
  let intent: Stripe.PaymentIntent;
  try {
    intent = reserved.cap.row.stripePaymentIntentId
      ? await stripe.paymentIntents.retrieve(reserved.cap.row.stripePaymentIntentId)
      : await stripe.paymentIntents.create({ amount: reserved.cap.row.amountCents, currency: "usd", payment_method_types: ["cashapp"], description: reserved.cap.row.description, metadata: { ...bookingPaymentMetadata(reserved.target.booking.id, reserved.target.profile.id), internalBookingHandoff: CASH_HANDOFF_PURPOSE, cashAppPaymentToken: token, handoffReviewVersion: String(reserved.cap.scope.version), handoffDate: reserved.cap.scope.date, handoffAmountCents: String(reserved.cap.row.amountCents), paymentMethod: "cashapp" } }, { idempotencyKey: cashKey(token) });
  } catch {
    // Deliberately retain the pre-provider charge_pending claim even if the
    // transport failed. A timeout is not evidence that no charge can happen.
    handoffConflict("Cash App did not confirm the payment outcome. The existing attempt remains in review to prevent another charge.");
  }
  assertInternalHandoffCashIntent(intent, reserved.target, reserved.cap);
  await db.transaction(async tx => {
    const target = await getHandoffTarget(tx, reserved.target.booking.id, true);
    const cap = await lookupHandoffToken(tx, "cashapp", token, true);
    assertHandoffCapability(cap, target, { allowUsed: true });
    if (cap.kind !== "cashapp") handoffConflict();
    if (cap.row.status === "paid") { if (cap.row.stripePaymentIntentId !== intent.id) handoffConflict(); return; }
    await assertUnclaimedHandoffVisit(tx, target, token);
    await persistRealCashIntent(tx, target, cap, intent);
  });
  if (intent.status === "canceled" || intent.status === "succeeded" || !intent.client_secret) handoffConflict("This payment has completed or needs review. Refresh its status rather than creating a second charge.");
  return { clientSecret: intent.client_secret };
}

export async function confirmInternalHandoffCash(db: HandoffDb, token: string) {
  const { cap, target } = await validateHandoffToken(db, "cashapp", token, { allowExpired: true, allowUsed: true, allowUsedPreviousVersion: true });
  if (cap.kind !== "cashapp" || !cap.row.stripePaymentIntentId) handoffConflict("No durable Cash App payment was found. Review the existing attempt; do not create another charge.");
  const intent = await getStripeClient().paymentIntents.retrieve(cap.row.stripePaymentIntentId);
  if (intent.id !== cap.row.stripePaymentIntentId) handoffConflict();
  assertInternalHandoffCashIntent(intent, target, cap);
  await reconcileInternalHandoffCash(db, intent);
  return getInternalHandoffCash(db, token, true);
}

/** Called after the raw signed webhook and its durable event registration,
 * or a server-verified return using only the exact persisted handoff token/PI.
 * Provider refresh makes late failure/pending events unable to undo success. */
export async function reconcileInternalHandoffCash(db: HandoffDb, object: Stripe.PaymentIntent) {
  const token = object.metadata?.cashAppPaymentToken;
  if (!token) handoffConflict();
  const initial = await validateHandoffToken(db, "cashapp", token, { allowExpired: true, allowUsed: true, allowUsedPreviousVersion: true });
  assertInternalHandoffCashIntent(object, initial.target, initial.cap);
  const intent = await getStripeClient().paymentIntents.retrieve(object.id);
  if (intent.id !== object.id) handoffConflict();
  assertInternalHandoffCashIntent(intent, initial.target, initial.cap);
  if (intent.status === "succeeded") {
    const pmId = typeof intent.payment_method === "string" ? intent.payment_method : intent.payment_method?.id;
    if (!pmId || intent.amount_received !== initial.target.booking.firstCleaningTotalCents) handoffConflict("Cash App did not verify the full first-cleaning payment.");
    const pm = await getStripeClient().paymentMethods.retrieve(pmId);
    if (pm.id !== pmId || pm.type !== "cashapp") handoffConflict("The confirmed payment was not Cash App.");
  }
  const changed = await db.transaction(async tx => {
    const target = await getHandoffTarget(tx, initial.target.booking.id, true);
    const cap = await lookupHandoffToken(tx, "cashapp", token, true);
    assertHandoffCapability(cap, target, { allowExpired: true, allowUsed: true, allowUsedPreviousVersion: true });
    if (cap.kind !== "cashapp") handoffConflict();
    assertInternalHandoffCashIntent(intent, target, cap);
    if (cap.row.status === "paid") {
      if (cap.row.stripePaymentIntentId !== intent.id || target.profile.stripePaymentIntentId !== intent.id || target.profile.paymentStatus !== "captured") handoffConflict();
      if (intent.status === "succeeded" && target.booking.paymentStatus === "captured" && target.booking.paymentMethod !== "cashapp") {
        await tx.update(bookings).set({ paymentMethod: "cashapp" }).where(eq(bookings.id, target.booking.id));
        return true;
      }
      return false;
    }
    if (cap.row.status === "cancelled") { if (intent.status !== "canceled" || cap.row.stripePaymentIntentId !== intent.id) handoffConflict(); return; }
    await assertUnclaimedHandoffVisit(tx, target, token);
    if (target.profile.paymentStatus !== "charge_pending" || cap.row.status !== "payment_started") handoffConflict();
    await persistRealCashIntent(tx, target, cap, intent);
    const [payment] = await tx.select().from(bookingCashAppPayments).where(eq(bookingCashAppPayments.stripePaymentIntentId, intent.id)).limit(1).for("update");
    if (!payment || payment.status !== "pending") handoffConflict();
    const now = Date.now();
    if (intent.status === "succeeded") {
      await tx.update(bookingCashAppPayments).set({ status: "paid", paidAt: now, failureCode: null, failureMessage: null, updatedAt: new Date() }).where(eq(bookingCashAppPayments.id, payment.id));
      await tx.update(cashAppPaymentTokens).set({ status: "paid", paidAt: now }).where(eq(cashAppPaymentTokens.id, cap.row.id));
      await tx.update(bookingPaymentProfiles).set({ paymentStatus: "captured", capturedAt: now, failureCode: null, failureMessage: null, updatedAt: new Date() }).where(eq(bookingPaymentProfiles.id, target.profile.id));
      await updateHandoffPaymentOnly(tx, target, "captured");
      await tx.update(bookings).set({ paymentMethod: "cashapp" }).where(eq(bookings.id, target.booking.id));
      return true;
    } else if (intent.status === "canceled") {
      // Only verified definitive cancellation releases first-service ownership.
      await tx.update(bookingCashAppPayments).set({ status: "cancelled", failureCode: "payment_cancelled", updatedAt: new Date() }).where(eq(bookingCashAppPayments.id, payment.id));
      await tx.update(cashAppPaymentTokens).set({ status: "cancelled" }).where(eq(cashAppPaymentTokens.id, cap.row.id));
      await tx.update(bookingPaymentProfiles).set({ paymentStatus: "not_started", stripePaymentIntentId: null, version: sql`${bookingPaymentProfiles.version} + 1`, failureCode: "payment_cancelled", updatedAt: new Date() }).where(eq(bookingPaymentProfiles.id, target.profile.id));
      await updateHandoffPaymentOnly(tx, target, "not_started");
    } else {
      // Failed/requires_payment_method remains confirmable; preserve its claim.
      const failure = { failureCode: intent.last_payment_error?.code ?? null, failureMessage: intent.last_payment_error?.message ?? null, updatedAt: new Date() };
      await tx.update(bookingCashAppPayments).set(failure).where(eq(bookingCashAppPayments.id, payment.id));
      await tx.update(bookingPaymentProfiles).set(failure).where(eq(bookingPaymentProfiles.id, target.profile.id));
    }
  });
  if (changed) broadcastOpsUpdate("booking_funnel_update");
}
