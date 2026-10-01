import { and, eq, sql } from "drizzle-orm";
import { bookingFunnelRecords, bookingPaymentProfiles, bookings, stripeCustomers } from "../drizzle/schema";
import { BOOKING_PAYMENT_CONSENT_TEXT, BOOKING_PAYMENT_CONSENT_VERSION } from "../shared/bookingPayment";
import { syncNativeBookingPaymentState } from "./bookingLifecycleService";
import { bookingPaymentIdempotencyKey, bookingPaymentMetadata } from "./bookingPaymentService";
import { getStripeClient } from "./stripeClient";
import { broadcastOpsUpdate } from "./sseBroadcast";
import { sendBookingCompletionNotifications } from "./bookingCompletionNotifications";
import { TRPCError } from "@trpc/server";

type Db = NonNullable<Awaited<ReturnType<typeof import("./db").getDb>>>;
type Profile = typeof bookingPaymentProfiles.$inferSelect;
type CardDetails = { id: string; brand: string | null; last4: string | null; exp_month: number | null; exp_year: number | null };

function affectedRows(result: unknown): number {
  const direct = result as { affectedRows?: number };
  const nested = (result as Array<{ affectedRows?: number }> | undefined)?.[0];
  return Number(direct?.affectedRows ?? nested?.affectedRows ?? 0);
}

export async function startCanonicalCardSetup(db: Db, input: { bookingId: number; customerName: string; profile: Profile }) {
  const { bookingId, customerName, profile } = input;
  if (profile.paymentStatus === "card_on_file") {
    if (profile.cardBrand && profile.cardLast4) await db.transaction(tx => syncNativeBookingPaymentState(tx, { bookingId, paymentStatus: "card_on_file", paymentBrand: profile.cardBrand, paymentLast4: profile.cardLast4 }));
    return { alreadyComplete: true as const, clientSecret: null, setupIntentId: null };
  }
  const stripe = getStripeClient();
  const customer = profile.stripeCustomerId
    ? await stripe.customers.retrieve(profile.stripeCustomerId)
    : await stripe.customers.create({ name: customerName, metadata: bookingPaymentMetadata(bookingId, profile.id) });
  if ("deleted" in customer && customer.deleted) throw new TRPCError({ code: "CONFLICT", message: "Saved payment profile is unavailable. Please contact support." });
  if (profile.stripeSetupIntentId) {
    const existing = await stripe.setupIntents.retrieve(profile.stripeSetupIntentId);
    if (existing.client_secret && existing.status !== "succeeded" && existing.status !== "canceled") {
      await db.transaction(tx => syncNativeBookingPaymentState(tx, { bookingId, paymentStatus: "pending" }));
      broadcastOpsUpdate("booking_funnel_update");
      return { alreadyComplete: false as const, clientSecret: existing.client_secret, setupIntentId: existing.id };
    }
  }
  const setupIntent = await stripe.setupIntents.create({ customer: customer.id, usage: "off_session", payment_method_types: ["card"], metadata: bookingPaymentMetadata(bookingId, profile.id) }, { idempotencyKey: bookingPaymentIdempotencyKey(bookingId, "setup", profile.version) });
  if (!setupIntent.client_secret) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Stripe could not prepare secure card entry." });
  await db.transaction(async tx => {
    const result = await tx.update(bookingPaymentProfiles).set({ paymentStatus: "setup_pending", stripeCustomerId: customer.id, stripeSetupIntentId: setupIntent.id, updatedAt: new Date() }).where(and(eq(bookingPaymentProfiles.id, profile.id), eq(bookingPaymentProfiles.version, profile.version)));
    if (affectedRows(result) !== 1) throw new TRPCError({ code: "CONFLICT", message: "The payment method changed. Please try again." });
    await tx.update(bookings).set({ paymentStatus: "pending", updatedAt: new Date() }).where(eq(bookings.id, bookingId));
    await syncNativeBookingPaymentState(tx, { bookingId, paymentStatus: "pending" });
  });
  broadcastOpsUpdate("booking_funnel_update");
  return { alreadyComplete: false as const, clientSecret: setupIntent.client_secret, setupIntentId: setupIntent.id };
}

export async function finalizeCanonicalCardOnFile(db: Db, input: { bookingId: number; profileId: number; profileVersion: number; funnelId: number; stripeCustomerId: string; customerName: string; customerPhone: string; paymentMethod: CardDetails; deferConfirmation?: boolean }) {
  const now = new Date();
  await db.transaction(async tx => {
    const profileUpdate = await tx.update(bookingPaymentProfiles).set({ paymentStatus: "card_on_file", stripeCustomerId: input.stripeCustomerId, stripePaymentMethodId: input.paymentMethod.id, cardBrand: input.paymentMethod.brand, cardLast4: input.paymentMethod.last4, cardExpMonth: input.paymentMethod.exp_month, cardExpYear: input.paymentMethod.exp_year, consentVersion: BOOKING_PAYMENT_CONSENT_VERSION, consentText: BOOKING_PAYMENT_CONSENT_TEXT, consentAcceptedAt: Date.now(), version: sql`${bookingPaymentProfiles.version} + 1`, updatedAt: now }).where(and(eq(bookingPaymentProfiles.id, input.profileId), eq(bookingPaymentProfiles.version, input.profileVersion)));
    if (affectedRows(profileUpdate) !== 1) throw new TRPCError({ code: "CONFLICT", message: "The payment method changed. Please try again." });
    await tx.update(bookings).set({ status: input.deferConfirmation ? "pending_payment" : "needs_attention", paymentStatus: "card_on_file", updatedAt: now }).where(eq(bookings.id, input.bookingId));
    await syncNativeBookingPaymentState(tx, { bookingId: input.bookingId, paymentStatus: "card_on_file", paymentBrand: input.paymentMethod.brand, paymentLast4: input.paymentMethod.last4 });
    await tx.update(bookingFunnelRecords).set({ stripeCustomerId: input.stripeCustomerId, stripePaymentMethodId: input.paymentMethod.id, paymentBrand: input.paymentMethod.brand, paymentLast4: input.paymentMethod.last4, updatedAt: now }).where(eq(bookingFunnelRecords.id, input.funnelId));
    await tx.insert(stripeCustomers).values({ phone: input.customerPhone, name: input.customerName, stripeCustomerId: input.stripeCustomerId, stripePaymentMethodId: input.paymentMethod.id, cardBrand: input.paymentMethod.brand, cardLast4: input.paymentMethod.last4, cardExpMonth: input.paymentMethod.exp_month, cardExpYear: input.paymentMethod.exp_year, cardSavedAt: Date.now() }).onDuplicateKeyUpdate({ set: { name: input.customerName, stripeCustomerId: input.stripeCustomerId, stripePaymentMethodId: input.paymentMethod.id, cardBrand: input.paymentMethod.brand, cardLast4: input.paymentMethod.last4, cardExpMonth: input.paymentMethod.exp_month, cardExpYear: input.paymentMethod.exp_year, cardSavedAt: Date.now() } });
  });
}

export async function reuseCanonicalSavedCard(db: Db, input: { bookingId: number; profile: Profile; funnelId: number; customerName: string; customerPhone: string; savedCard: { stripeCustomerId: string; stripePaymentMethodId: string; brand: string | null; last4: string | null; expMonth: number | null; expYear: number | null }; deferConfirmation?: boolean }) {
  await finalizeCanonicalCardOnFile(db, { bookingId: input.bookingId, profileId: input.profile.id, profileVersion: input.profile.version, funnelId: input.funnelId, stripeCustomerId: input.savedCard.stripeCustomerId, customerName: input.customerName, customerPhone: input.customerPhone, paymentMethod: { id: input.savedCard.stripePaymentMethodId, brand: input.savedCard.brand, last4: input.savedCard.last4, exp_month: input.savedCard.expMonth, exp_year: input.savedCard.expYear }, deferConfirmation: input.deferConfirmation });
  broadcastOpsUpdate("booking_funnel_update");
  if (!input.deferConfirmation) void sendBookingCompletionNotifications(input.bookingId).catch(error => console.error("[BookingPaymentEngine] Booking completion notifications failed:", error));
  return { bookingId: input.bookingId, paymentStatus: "card_on_file" as const, cardBrand: input.savedCard.brand ?? "Card", cardLast4: input.savedCard.last4 ?? "saved", finalizationRequired: input.deferConfirmation === true };
}

export async function finalizeCanonicalBooking(db: Db, input: { bookingId: number; funnelId: number }) {
  await db.transaction(async tx => {
    await tx.update(bookings).set({ status: "needs_attention", paymentStatus: "card_on_file", updatedAt: new Date() }).where(eq(bookings.id, input.bookingId));
    await tx.update(bookingFunnelRecords).set({ stage: "booked", updatedAt: new Date() }).where(eq(bookingFunnelRecords.id, input.funnelId));
    await syncNativeBookingPaymentState(tx, { bookingId: input.bookingId, paymentStatus: "card_on_file" });
  });
  broadcastOpsUpdate("booking_funnel_update");
  void sendBookingCompletionNotifications(input.bookingId).catch(error => console.error("[BookingPaymentEngine] Booking completion notifications failed:", error));
}
