import { eq, sql } from "drizzle-orm";
import { bookingPaymentProfiles, bookingFunnelRecords, cardAuthTokens, stripeCustomers } from "../drizzle/schema";
import { getStripeClient } from "./stripeClient";
import { bookingPaymentMetadata } from "./bookingPaymentService";
import { verifyCanonicalCardSetup } from "./bookingPaymentVerification";
import { assertHandoffCapability, getHandoffTarget, lookupHandoffToken, updateHandoffPaymentOnly, validateHandoffToken, type HandoffDb } from "./internalBookingHandoffContext";
import { handoffConflict } from "./internalBookingHandoffToken";

export async function getInternalHandoffCard(db: HandoffDb, token: string) {
  const { target } = await validateHandoffToken(db, "card", token);
  const { booking } = target;
  if (!Number.isSafeInteger(booking.requestedStartAt) || !Number.isFinite(new Date(booking.requestedStartAt).getTime())) handoffConflict("The saved cleaning date needs review.");
  return { customerName: booking.customerName, customerPhone: booking.customerPhone, jobDate: booking.requestedLocalDate, jobAddress: booking.address, bookingId: booking.id, publicBookingNumber: booking.publicBookingNumber, firstCleaningTotalCents: booking.firstCleaningTotalCents, requestedStartAt: booking.requestedStartAt };
}
function assertSetupMetadata(intent: { metadata: Record<string, string> | null; customer: unknown }, token: string, bookingId: number, profileId: number, customerId: string, version: number, date: string) {
  if (intent.customer !== customerId || intent.metadata?.internalBookingHandoff !== "card_v1" || intent.metadata?.cardAuthToken !== token || intent.metadata?.bookingId !== String(bookingId) || intent.metadata?.bookingPaymentProfileId !== String(profileId) || intent.metadata?.handoffReviewVersion !== String(version) || intent.metadata?.handoffDate !== date) handoffConflict("Secure card entry no longer matches this booking.");
}
export async function createInternalHandoffSetup(db: HandoffDb, token: string) {
  // Serialize only this new branch. Real Stripe objects use stable idempotency;
  // no placeholder customer or SetupIntent IDs are ever persisted.
  return db.transaction(async tx => {
    const cap = await lookupHandoffToken(tx, "card", token);
    const target = await getHandoffTarget(tx, cap.scope.bookingId, true);
    assertHandoffCapability(cap, target);
    const { profile, booking } = target;
    if (profile.stripePaymentMethodId || [profile.paymentStatus, booking.paymentStatus].some(value => ["charge_pending", "authorization_pending", "capture_pending", "action_required"].includes(value))) handoffConflict("The current payment or saved card needs review before a new card can be saved.");
    const stripe = getStripeClient();
    const key = `leadflow:internal-handoff:card:${token}`;
    const customer = profile.stripeCustomerId
      ? await stripe.customers.retrieve(profile.stripeCustomerId)
      : await stripe.customers.create({ name: booking.customerName, phone: booking.customerPhone, email: booking.customerEmail || undefined, metadata: bookingPaymentMetadata(booking.id, profile.id) }, { idempotencyKey: `${key}:customer` });
    if ("deleted" in customer && customer.deleted) handoffConflict("The saved payment customer is unavailable.");
    const metadata = { ...bookingPaymentMetadata(booking.id, profile.id), internalBookingHandoff: "card_v1", cardAuthToken: token, handoffReviewVersion: String(cap.scope.version), handoffDate: cap.scope.date };
    const intent = profile.stripeSetupIntentId
      ? await stripe.setupIntents.retrieve(profile.stripeSetupIntentId)
      : await stripe.setupIntents.create({ customer: customer.id, usage: "off_session", payment_method_types: ["card"], metadata }, { idempotencyKey: `${key}:setup` });
    assertSetupMetadata(intent, token, booking.id, profile.id, customer.id, cap.scope.version, cap.scope.date);
    if (!intent.client_secret || intent.status === "canceled") handoffConflict("This secure card entry needs staff review.");
    const status = ["captured", "paid", "authorized"].includes(profile.paymentStatus) ? profile.paymentStatus : "setup_pending";
    await tx.update(bookingPaymentProfiles).set({ stripeCustomerId: customer.id, stripeSetupIntentId: intent.id, paymentStatus: status, updatedAt: new Date() }).where(eq(bookingPaymentProfiles.id, profile.id));
    // Existing native status, assignments, recurrence and notifications untouched.
    if (!["captured", "paid", "authorized"].includes(booking.paymentStatus)) await updateHandoffPaymentOnly(tx, target, status);
    return { clientSecret: intent.client_secret };
  });
}

export async function confirmInternalHandoffCard(db: HandoffDb, token: string, paymentMethodId: string) {
  const { target: before, cap: original } = await validateHandoffToken(db, "card", token, { allowUsed: true, allowUsedPreviousVersion: true });
  const stripe = getStripeClient();
  if (!before.profile.stripeSetupIntentId || !before.profile.stripeCustomerId) handoffConflict("No booking-bound secure card entry was found.");
  const stripeCustomerId = before.profile.stripeCustomerId;
  const setup = await stripe.setupIntents.retrieve(before.profile.stripeSetupIntentId);
  assertSetupMetadata(setup, token, before.booking.id, before.profile.id, before.profile.stripeCustomerId, original.scope.version, original.scope.date);
  // This unchanged primitive proves succeeded SI, exact returned PM, customer and
  // canonical booking/profile metadata. No attach shortcut or raw card inputs.
  const pm = await verifyCanonicalCardSetup(stripe, { setupIntentId: before.profile.stripeSetupIntentId, paymentMethodId, bookingId: before.booking.id, bookingPaymentProfileId: before.profile.id, stripeCustomerId: before.profile.stripeCustomerId });
  await db.transaction(async tx => {
    const target = await getHandoffTarget(tx, before.booking.id, true);
    const cap = await lookupHandoffToken(tx, "card", token, true);
    assertHandoffCapability(cap, target, { allowUsed: true, allowUsedPreviousVersion: true });
    if (cap.kind !== "card" || target.profile.stripeSetupIntentId !== before.profile.stripeSetupIntentId || target.profile.stripeCustomerId !== before.profile.stripeCustomerId) handoffConflict();
    if (cap.row.used) {
      if (target.profile.stripePaymentMethodId !== paymentMethodId) handoffConflict();
      return;
    }
    if (target.profile.stripePaymentMethodId && target.profile.stripePaymentMethodId !== paymentMethodId) handoffConflict();
    if ([target.profile.paymentStatus, target.booking.paymentStatus].some(value => ["charge_pending", "authorization_pending", "capture_pending", "action_required"].includes(value))) handoffConflict();
    const now = Date.now();
    const preserved = [target.profile.paymentStatus, target.booking.paymentStatus].find(value => ["captured", "paid", "authorized"].includes(value));
    const paymentStatus = preserved ?? "card_on_file";
    const details = { stripePaymentMethodId: pm.id, cardBrand: pm.card.brand, cardLast4: pm.card.last4, cardExpMonth: pm.card.exp_month, cardExpYear: pm.card.exp_year };
    await tx.update(bookingPaymentProfiles).set({ ...details, paymentStatus, version: sql`${bookingPaymentProfiles.version} + 1`, updatedAt: new Date() }).where(eq(bookingPaymentProfiles.id, target.profile.id));
    // The existing CardAuth page does not display canonical booking consent.
    // Deliberately leave all canonical consent fields unchanged.
    await tx.update(bookingFunnelRecords).set({ stripeCustomerId: target.profile.stripeCustomerId, stripePaymentMethodId: pm.id, paymentBrand: pm.card.brand, paymentLast4: pm.card.last4, updatedAt: new Date() }).where(eq(bookingFunnelRecords.id, target.funnel.id));
    await updateHandoffPaymentOnly(tx, target, paymentStatus, { brand: pm.card.brand, last4: pm.card.last4 });
    const customer = { phone: target.booking.customerPhone, name: target.booking.customerName, stripeCustomerId, ...details, cardSavedAt: now };
    await tx.insert(stripeCustomers).values(customer).onDuplicateKeyUpdate({ set: customer });
    await tx.update(cardAuthTokens).set({ used: 1, completedAt: now }).where(eq(cardAuthTokens.id, cap.row.id));
  });
  return { success: true, cardBrand: pm.card.brand, cardLast4: pm.card.last4, cardExpMonth: pm.card.exp_month, cardExpYear: pm.card.exp_year };
}
