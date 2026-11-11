import { eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { bookings } from "../drizzle/schema";
import { BOOKING_TIME_ZONE } from "../shared/easternTime";
import { buildPreparedCanonicalBooking, NativeBookingInputError, type PreparePublicBookingInput } from "./bookingsService";
import { persistCanonicalBooking } from "./canonicalBookingPersistence";
import { startCanonicalCardSetup, finalizeCanonicalCardOnFile, finalizeCanonicalBooking } from "./bookingPaymentEngine";
import { createOrReuseCashAppPaymentIntent, settleSucceededCashAppPayment, abandonCashAppPayment } from "./bookingCashAppEngine";
import { verifyCanonicalCardSetup } from "./bookingPaymentVerification";
import { getStripeClient } from "./stripeClient";
import { broadcastOpsUpdate } from "./sseBroadcast";
import { broadcastCleanerPortalJobsChanged } from "./cleanerPortalUpdates";
import { sendBookingCompletionNotifications } from "./bookingCompletionNotifications";
import { exactConflict, lockInternalExactBooking, markInternalExactPrepared, type InternalExactMethod, type InternalExactOperation } from "./internalExactBookingMarker";

type Db = NonNullable<Awaited<ReturnType<typeof import("./db").getDb>>>;
type Agent = { agentId: number; agentName: string };
export type PrepareInternalExactInput = { idempotencyKey: string; paymentMethod: InternalExactMethod; withoutPayment: boolean; companyNotes: string | null; booking: Omit<PreparePublicBookingInput, "idempotencyKey"> };

export async function prepareInternalExact(db: Db, input: PrepareInternalExactInput, agent: Agent) {
  if (input.withoutPayment !== (input.paymentMethod === "invoice")) throw new TRPCError({ code: "BAD_REQUEST", message: "Book without payment requires the unpaid invoice option." });
  const [existing] = await db.select({ id: bookings.id }).from(bookings).where(eq(bookings.idempotencyKey, input.idempotencyKey)).limit(1);
  const built = buildPreparedCanonicalBooking({ ...input.booking, idempotencyKey: input.idempotencyKey }, { nowMs: existing ? 0 : Date.now(), timeZone: BOOKING_TIME_ZONE });
  if (built.type === "price_changed") throw new NativeBookingInputError("The booking price changed. Please review the displayed total.");
  const prepared = markInternalExactPrepared(built.prepared, input, agent);
  const result = await db.transaction(async tx => {
    let created = false;
    let bookingId = existing?.id;
    if (!bookingId) {
      // A real Drizzle nested transaction/savepoint: persistence has no notifications.
      // Home type joins native/funnel/profile/series creation in the outer commit.
      const persisted = await persistCanonicalBooking(tx as unknown as Db, prepared, {
        paymentMethod: input.paymentMethod,
        funnelSource: "internal",
        bookingSource: "popup",
        funnelStage: input.withoutPayment ? "booked" : "payment_incomplete",
        initialBookingStatus: input.withoutPayment ? "needs_attention" : "pending_payment",
        bookedByAgentId: agent.agentId,
        bookedByAgentName: agent.agentName,
        companyNotes: input.companyNotes,
      });
      created = persisted.created;
      bookingId = persisted.bookingId;
      if (created) await tx.update(bookings).set({ homeType: prepared.homeType }).where(eq(bookings.id, bookingId));
    }
    const target = await lockInternalExactBooking(tx, bookingId, "replay", { required: true, creatorId: agent.agentId });
    if (!target || target.booking.commandHash !== prepared.commandHash || target.marker.paymentMethod !== input.paymentMethod || target.marker.withoutPayment !== input.withoutPayment) exactConflict("IDEMPOTENCY_CONFLICT");
    return {
      bookingId: target.booking.id,
      publicBookingNumber: target.booking.publicBookingNumber,
      publicFunnelNumber: target.funnel.publicFunnelNumber,
      stage: target.funnel.stage as "payment_incomplete" | "booked",
      version: target.funnel.version,
      created,
      totalCents: target.booking.firstCleaningTotalCents,
      firstCleaningTotalCents: target.booking.firstCleaningTotalCents,
      futureVisitTotalCents: target.booking.futureVisitTotalCents,
      paymentMethod: target.marker.paymentMethod,
      paymentStatus: target.booking.paymentStatus,
      unpaid: target.marker.withoutPayment,
    };
  });
  if (result.created) {
    broadcastCleanerPortalJobsChanged();
    broadcastOpsUpdate("booking_funnel_update");
    if (result.unpaid) void sendBookingCompletionNotifications(result.bookingId).catch(error => console.error("[InternalExactBooking] Booking completion notifications failed:", error));
  }
  return result;
}

async function targetFor(db: Db, bookingId: number, agent: Agent, operation: InternalExactOperation, paymentIntentId?: string) {
  const target = await db.transaction(tx => lockInternalExactBooking(tx, bookingId, operation, { required: true, creatorId: agent.agentId, paymentIntentId }));
  if (!target) exactConflict();
  return target;
}

export async function startInternalExactSetup(db: Db, bookingId: number, agent: Agent) {
  const target = await targetFor(db, bookingId, agent, "start");
  const setup = await startCanonicalCardSetup(db, { bookingId, customerName: target.booking.customerName, profile: target.profile, internalExact: true });
  return { ...setup, bookingId, portalAccessCode: null, directPortalSessionReady: false as const };
}

export async function confirmInternalExactSetup(db: Db, input: { bookingId: number; paymentMethodId: string; consentAccepted: true; deferConfirmation: true; wallet?: "apple_pay" | "google_pay" }, agent: Agent) {
  const target = await targetFor(db, input.bookingId, agent, "confirm");
  if (!target.profile.stripeSetupIntentId || !target.profile.stripeCustomerId) exactConflict("Start secure card entry before confirming it.");
  const method = await verifyCanonicalCardSetup(getStripeClient(), {
    setupIntentId: target.profile.stripeSetupIntentId,
    paymentMethodId: input.paymentMethodId,
    bookingId: input.bookingId,
    bookingPaymentProfileId: target.profile.id,
    stripeCustomerId: target.profile.stripeCustomerId,
    wallet: input.wallet,
  });
  if (target.profile.paymentStatus === "card_on_file") {
    if (target.profile.stripePaymentMethodId !== method.id || target.booking.paymentMethod !== (input.wallet ?? "card")) exactConflict();
  } else {
    await finalizeCanonicalCardOnFile(db, {
      bookingId: input.bookingId, profileId: target.profile.id, profileVersion: target.profile.version, funnelId: target.funnel.id,
      stripeCustomerId: target.profile.stripeCustomerId, customerName: target.booking.customerName, customerPhone: target.booking.customerPhone,
      paymentMethod: { id: method.id, brand: method.card.brand, last4: method.card.last4, exp_month: method.card.exp_month, exp_year: method.card.exp_year },
      wallet: input.wallet, deferConfirmation: true,
      internalExactSetupIntentId: target.profile.stripeSetupIntentId,
    });
    broadcastOpsUpdate("booking_funnel_update");
  }
  return { bookingId: input.bookingId, cardBrand: method.card.brand, cardLast4: method.card.last4, finalizationRequired: true as const };
}

export async function finalizeInternalExact(db: Db, bookingId: number, agent: Agent) {
  const target = await targetFor(db, bookingId, agent, "finalize");
  await finalizeCanonicalBooking(db, { bookingId, funnelId: target.funnel.id, internalExact: true });
  return { bookingId, paymentStatus: "card_on_file" as const, cardBrand: target.profile.cardBrand, cardLast4: target.profile.cardLast4, directPortalSessionReady: false as const };
}

export async function prepareInternalExactCashApp(db: Db, bookingId: number, agent: Agent) {
  const target = await targetFor(db, bookingId, agent, "cash_prepare");
  return createOrReuseCashAppPaymentIntent(db, { bookingId, funnelId: target.funnel.id, profile: target.profile, amountCents: target.booking.firstCleaningTotalCents, publicBookingNumber: target.booking.publicBookingNumber, internalExact: true });
}

export async function settleInternalExactCashApp(db: Db, input: { bookingId: number; paymentIntentId: string }, agent: Agent) {
  // Verify the exact native/profile/ledger binding before any provider retrieval.
  await targetFor(db, input.bookingId, agent, "cash_settle", input.paymentIntentId);
  const intent = await getStripeClient().paymentIntents.retrieve(input.paymentIntentId);
  const result = await settleSucceededCashAppPayment(db, intent);
  if (!result || result.bookingId !== input.bookingId) exactConflict();
  return { ...result, paymentMethod: "cashapp" as const };
}

export async function abandonInternalExactCashApp(db: Db, input: { bookingId: number; paymentIntentId: string }, agent: Agent) {
  await targetFor(db, input.bookingId, agent, "cash_unavailable", input.paymentIntentId);
  return abandonCashAppPayment(db, { ...input, internalExact: true });
}
