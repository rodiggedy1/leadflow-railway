import Stripe from "stripe";
import { TRPCError } from "@trpc/server";
import { ENV } from "./_core/env";

/** Shared server-only Stripe client. Raw card data never reaches LeadFlow. */
export function getStripeClient(): Stripe {
  if (!ENV.stripeSecretKey) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Stripe is not configured (missing STRIPE_SECRET_KEY)",
    });
  }
  return new Stripe(ENV.stripeSecretKey, { apiVersion: "2026-05-27.dahlia" });
}
