import { z } from "zod";
import { createCustomerBookingLinkInputSchema } from "../../shared/bookingFunnel";
import { callBookingQuotePricingSchema } from "./callBookingQuote";

/** The pre-call-confirmation SMS contract. Voice name/city/address confirmation
 * belongs only to the call schema; SMS identity comes from the bound inbound.
 * Keep canonical contact bounds, real calendar dates and strict public pricing.
 * Workflow-time evidence, freshness and identity checks remain with SMS owners. */
export const smsBookingQuoteSendInputSchema = createCustomerBookingLinkInputSchema
  .pick({
    customerName: true,
    customerPhone: true,
    customerEmail: true,
    address: true,
    requestedLocalDate: true,
    requestedLocalTime: true,
    pricing: true,
    notes: true,
  })
  .extend({
    requestedLocalDate: createCustomerBookingLinkInputSchema.shape.requestedLocalDate.refine(value => {
      const date = new Date(`${value}T00:00:00.000Z`);
      return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
    }, "Enter a valid calendar date in YYYY-MM-DD format."),
    pricing: callBookingQuotePricingSchema,
    address: createCustomerBookingLinkInputSchema.shape.address.unwrap(),
    extrasConfirmed: z.literal(true),
    smsNumberConfirmed: z.literal(true),
  })
  .strict();
