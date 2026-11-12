import type Stripe from "stripe";
import { eq } from "drizzle-orm";
import { stripeWebhookEvents } from "../drizzle/schema";
import { reconcileInternalHandoffCash } from "./internalBookingHandoffCash";
import { isInternalHandoffToken } from "./internalBookingHandoffToken";
import { lookupHandoffToken, getHandoffTarget, assertHandoffCapability, type HandoffDb } from "./internalBookingHandoffContext";

const cashEvents = new Set(["payment_intent.succeeded", "payment_intent.payment_failed", "payment_intent.canceled", "payment_intent.processing", "payment_intent.requires_action"]);
const cardEvents = new Set(["setup_intent.succeeded", "setup_intent.setup_failed", "setup_intent.canceled", "setup_intent.requires_action"]);
export function isInternalBookingHandoffEvent(event: Stripe.Event): boolean {
  const object = event.data.object;
  if (object.object === "payment_intent" && cashEvents.has(event.type)) return object.metadata?.internalBookingHandoff === "cash_v1" || (typeof object.metadata?.cashAppPaymentToken === "string" && isInternalHandoffToken(object.metadata.cashAppPaymentToken));
  if (object.object === "setup_intent" && cardEvents.has(event.type)) return object.metadata?.internalBookingHandoff === "card_v1" || (typeof object.metadata?.cardAuthToken === "string" && isInternalHandoffToken(object.metadata.cardAuthToken));
  return false;
}
function duplicate(error: unknown) { const value = error as { code?: string; errno?: number }; return value.code === "ER_DUP_ENTRY" || value.errno === 1062; }
export async function reconcileRegisteredInternalHandoffEvent(db: HandoffDb, event: Stripe.Event) {
  const object = event.data.object;
  if (object.object === "payment_intent") return reconcileInternalHandoffCash(db, object);
  if (object.object === "setup_intent") {
    // Customer completion supplies the PM and uses canonical SI proof explicitly.
    // A webhook must not invent consent or invoke initial booking finalization.
    const token = object.metadata?.cardAuthToken;
    if (!token || object.metadata?.internalBookingHandoff !== "card_v1") throw new Error("Invalid internal card event binding");
    const cap = await lookupHandoffToken(db, "card", token);
    const target = await getHandoffTarget(db, cap.scope.bookingId);
    assertHandoffCapability(cap, target, { allowExpired: true, allowUsed: true, allowUsedPreviousVersion: true });
    if (target.profile.stripeSetupIntentId !== object.id || target.profile.stripeCustomerId !== object.customer || object.metadata.bookingId !== String(target.booking.id) || object.metadata.bookingPaymentProfileId !== String(target.profile.id) || object.metadata.handoffReviewVersion !== String(cap.scope.version) || object.metadata.handoffDate !== cap.scope.date) throw new Error("Internal card event does not match stored SetupIntent");
  }
}
/** Invoke only AFTER constructEvent(rawBody, signature, configuredSecret).
 * Ordinary event duplicate semantics are unchanged. Only own recognized event
 * types may retry failed/received rows; event identity is checked byte-for-byte.
 * Ledger row lock serializes concurrent retries. Booking settlement is separately
 * atomic/idempotent, so a crash after settlement before ledger commit is safe. */
export async function processSignedInternalHandoffEvent(db: HandoffDb, event: Stripe.Event) {
  if (!isInternalBookingHandoffEvent(event)) throw new Error("Not an internal handoff event");
  const object = event.data.object;
  if (object.object !== "payment_intent" && object.object !== "setup_intent") throw new Error("Not an internal handoff event");
  const objectId = object.id;
  try {
    await db.insert(stripeWebhookEvents).values({ stripeEventId: event.id, eventType: event.type, objectId: objectId, bookingPaymentProfileId: null, status: "received", errorMessage: null, receivedAt: new Date(), processedAt: null });
  } catch (error) { if (!duplicate(error)) throw error; }
  try {
    return await db.transaction(async tx => {
      const [record] = await tx.select().from(stripeWebhookEvents).where(eq(stripeWebhookEvents.stripeEventId, event.id)).limit(1).for("update");
      if (!record || record.stripeEventId !== event.id || record.eventType !== event.type || record.objectId !== objectId) throw new Error("Handoff event ledger identity mismatch");
      if (record.status === "processed" || record.status === "ignored") return { status: "processed" as const, duplicate: true };
      if (record.status !== "received" && record.status !== "failed") throw new Error("Handoff event requires manual review");
      await reconcileRegisteredInternalHandoffEvent(db, event);
      await tx.update(stripeWebhookEvents).set({ status: "processed", errorMessage: null, processedAt: new Date() }).where(eq(stripeWebhookEvents.id, record.id));
      return { status: "processed" as const };
    });
  } catch (error) {
    await db.transaction(async tx => {
      const [record] = await tx.select().from(stripeWebhookEvents).where(eq(stripeWebhookEvents.stripeEventId, event.id)).limit(1).for("update");
      if (record && record.stripeEventId === event.id && record.eventType === event.type && record.objectId === objectId && record.status !== "processed") await tx.update(stripeWebhookEvents).set({ status: "failed", errorMessage: "Internal handoff reconciliation failed; retry the signed event." }).where(eq(stripeWebhookEvents.id, record.id));
    });
    throw error;
  }
}
