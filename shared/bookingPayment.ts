import { z } from "zod";

/** Payment state is deliberately separate from appointment/availability state. */
export const bookingPaymentStatusSchema = z.enum([
  "not_started",
  "setup_pending",
  "card_on_file",
  "authorization_pending",
  "authorized",
  "capture_pending",
  "charge_pending",
  "captured",
  "failed",
  "action_required",
  "cancelled",
  "expired",
]);
export type BookingPaymentStatus = z.infer<typeof bookingPaymentStatusSchema>;

export const bookingPaymentOperationSchema = z.enum(["authorization", "direct_charge"]);
export type BookingPaymentOperation = z.infer<typeof bookingPaymentOperationSchema>;

export const BOOKING_PAYMENT_CONSENT_VERSION = "booking-card-on-file-2026-08-30" as const;
export const BOOKING_PAYMENT_CONSENT_TEXT = [
  "I authorize Maids in Black to securely save my card with Stripe to secure this appointment.",
  "My card will be charged only after the cleaning service is completed for the agreed service amount.",
  "I may cancel or reschedule at least 24 hours in advance with no penalty; late cancellations may be subject to a fee.",
].join(" ");

export const bookingPaymentProfilePublicSchema = z.object({
  bookingId: z.number().int().positive(),
  paymentStatus: bookingPaymentStatusSchema,
  cardBrand: z.string().nullable(),
  cardLast4: z.string().nullable(),
  cardExpMonth: z.number().int().nullable(),
  cardExpYear: z.number().int().nullable(),
  authorizationExpiresAt: z.number().int().nullable(),
});
export type BookingPaymentProfilePublic = z.infer<typeof bookingPaymentProfilePublicSchema>;
