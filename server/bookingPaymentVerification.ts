import type Stripe from "stripe";
import { TRPCError } from "@trpc/server";

export async function verifyCanonicalCardSetup(
  stripe: Stripe,
  input: {
    setupIntentId: string;
    paymentMethodId: string;
    bookingId: number;
    bookingPaymentProfileId: number;
    stripeCustomerId: string;
  },
) {
  const setupIntent = await stripe.setupIntents.retrieve(input.setupIntentId);
  const metadata = setupIntent.metadata ?? {};
  if (
    setupIntent.status !== "succeeded" ||
    setupIntent.payment_method !== input.paymentMethodId ||
    metadata.bookingId !== String(input.bookingId) ||
    metadata.bookingPaymentProfileId !== String(input.bookingPaymentProfileId) ||
    setupIntent.customer !== input.stripeCustomerId
  ) {
    throw new TRPCError({ code: "CONFLICT", message: "Stripe did not verify this card for the current booking." });
  }
  const paymentMethod = await stripe.paymentMethods.retrieve(input.paymentMethodId);
  if (
    paymentMethod.type !== "card" ||
    !paymentMethod.card ||
    paymentMethod.customer !== input.stripeCustomerId
  ) {
    throw new TRPCError({ code: "CONFLICT", message: "Stripe card does not belong to this booking." });
  }
  return paymentMethod;
}
