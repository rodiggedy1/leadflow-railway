import type Stripe from "stripe";
import { bookingPaymentIdempotencyKey, bookingPaymentMetadata } from "./bookingPaymentService";

export async function authorizeCanonicalBookingHold(stripe: Stripe, input: { bookingId: number; profileId: number; customerId: string; paymentMethodId: string; amountCents: number; publicBookingNumber: string; agentName: string; attempt: number }) {
  return stripe.paymentIntents.create({ amount: input.amountCents, currency: "usd", customer: input.customerId, payment_method: input.paymentMethodId, capture_method: "manual", confirm: true, off_session: true, description: `LeadFlow booking ${input.publicBookingNumber}`, metadata: { ...bookingPaymentMetadata(input.bookingId, input.profileId), operation: "authorization", createdBy: input.agentName } }, { idempotencyKey: bookingPaymentIdempotencyKey(input.bookingId, "authorization", input.attempt) });
}

export async function captureCanonicalPaymentIntent(stripe: Stripe, paymentIntentId: string, amountCents: number) {
  return stripe.paymentIntents.capture(paymentIntentId, { amount_to_capture: amountCents });
}

export async function cancelCanonicalPaymentIntent(stripe: Stripe, paymentIntentId: string) {
  return stripe.paymentIntents.cancel(paymentIntentId);
}

export async function chargeCanonicalSavedCard(stripe: Stripe, input: { bookingId: number; profileId: number; customerId: string; paymentMethodId: string; amountCents: number; publicBookingNumber: string; agentName: string; profileVersion: number }) {
  return stripe.paymentIntents.create({ amount: input.amountCents, currency: "usd", customer: input.customerId, payment_method: input.paymentMethodId, confirm: true, off_session: true, description: `LeadFlow booking ${input.publicBookingNumber}`, metadata: { ...bookingPaymentMetadata(input.bookingId, input.profileId), operation: "direct_charge", createdBy: input.agentName } }, { idempotencyKey: bookingPaymentIdempotencyKey(input.bookingId, "direct_charge", input.profileVersion) });
}
