import { z } from "zod";
import type {
  BookingWidgetPriceBreakdown,
  BookingWidgetRecurringFrequency,
  BookingWidgetServiceId,
} from "./bookingWidgetConfig";

export const NATIVE_BOOKING_PRICING_VERSION = "booking-widget-v1" as const;

export const bookingSurfaceSchema = z.enum(["popup", "full_page"]);
export const bookingRecurringFrequencySchema = z.enum(["one-time", "weekly", "biweekly", "monthly"]);
export const bookingServiceIdSchema = z.enum(["standard", "deep", "moveout"]);

export const prepareBookingExtraSchema = z.object({
  id: z.string().trim().min(1).max(64),
  quantity: z.number().int().min(1).max(50),
});

export const prepareBookingInputSchema = z.object({
  idempotencyKey: z.string().uuid(),
  surface: bookingSurfaceSchema,
  customer: z.object({
    fullName: z.string().trim().min(2).max(255),
    phone: z.string().trim().min(7).max(40),
    email: z.string().trim().email().max(320),
  }),
  service: z.object({
    serviceId: bookingServiceIdSchema,
    bedrooms: z.number().int().min(0).max(7),
    bathrooms: z.number().int().min(0).max(20),
    extras: z.array(prepareBookingExtraSchema).max(20).default([]),
    specialRequestNotes: z.array(z.string().trim().min(1).max(1_000)).max(20).default([]),
  }),
  address: z.string().trim().min(5).max(500),
  requestedSchedule: z.object({
    localDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    localTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  }),
  recurrence: bookingRecurringFrequencySchema.default("one-time"),
  acceptedPricing: z.object({
    version: z.string().trim().min(1).max(64),
    totalCents: z.number().int().min(0).max(10_000_000),
  }),
});

export const bookingListInputSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  status: z.enum(["needs_attention", "pending_payment", "confirmed", "completed", "cancelled", "expired"]).optional(),
  query: z.string().trim().max(120).optional(),
  limit: z.number().int().min(1).max(250).default(200),
});

export const bookingGetInputSchema = z.object({ id: z.number().int().positive() });

export type PrepareBookingInput = z.infer<typeof prepareBookingInputSchema>;
export type BookingSurface = z.infer<typeof bookingSurfaceSchema>;
export type NativeBookingStatus = "needs_attention" | "pending_payment" | "confirmed" | "completed" | "cancelled" | "expired";
export type NativePaymentStatus = "not_started" | "pending" | "card_on_file" | "failed";
export type NativeAvailabilityStatus = "requested" | "approved" | "unavailable";
export type NativeAssignmentStatus = "unassigned" | "assigned";
export type NativeRecurringIntentStatus = "intent_pending" | "active" | "paused" | "cancelled";

export type BookingPriceSnapshot = {
  version: typeof NATIVE_BOOKING_PRICING_VERSION;
  serviceId: BookingWidgetServiceId;
  serviceName: string;
  bedrooms: number;
  bathrooms: number;
  extras: Array<{ id: string; label: string; quantity: number; unitPriceCents: number; totalCents: number }>;
  breakdown: BookingWidgetPriceBreakdown;
  firstCleaningTotalCents: number;
  recurringFrequency: BookingWidgetRecurringFrequency;
  futureVisitTotalCents: number | null;
};

export type SafePreparedBookingSummary = {
  customerName: string;
  serviceName: string;
  homeSummary: string;
  address: string;
  requestedLocalDate: string;
  requestedLocalTime: string;
  requestedTimeZone: string;
  totalCents: number;
  recurrence: BookingWidgetRecurringFrequency;
  futureVisitTotalCents: number | null;
};

export type PrepareBookingResult =
  | {
      type: "price_changed";
      pricingVersion: typeof NATIVE_BOOKING_PRICING_VERSION;
      totalCents: number;
      priceSnapshot: BookingPriceSnapshot;
    }
  | {
      type: "prepared";
      publicBookingNumber: string;
      status: "needs_attention";
      created: boolean;
      replayed: boolean;
      summary: SafePreparedBookingSummary;
    };
