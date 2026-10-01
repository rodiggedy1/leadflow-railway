import type { BookingWidgetRecurringFrequency, BookingWidgetServiceId } from "./bookingWidgetConfig";
import { PUBLIC_BOOKING_POST_BOOKING_UPSELLS, PUBLIC_BOOKING_PRICED_EXTRAS } from "./publicBookingPricing";

export const CANONICAL_SERVICE_IDS = ["standard", "deep", "moveout"] as const satisfies readonly BookingWidgetServiceId[];
export const CANONICAL_FREQUENCIES = ["one-time", "weekly", "biweekly", "monthly"] as const satisfies readonly BookingWidgetRecurringFrequency[];
export const CANONICAL_PRICED_EXTRAS = PUBLIC_BOOKING_PRICED_EXTRAS;
export const CANONICAL_POST_BOOKING_UPSELLS = PUBLIC_BOOKING_POST_BOOKING_UPSELLS;
export type CanonicalServiceId = (typeof CANONICAL_SERVICE_IDS)[number];
export type CanonicalFrequency = (typeof CANONICAL_FREQUENCIES)[number];
export type CanonicalUpsellId = keyof typeof CANONICAL_POST_BOOKING_UPSELLS;

export function canonicalUpsellSelections(values: Record<string, number>) {
  return Object.entries(values)
    .filter(([, quantity]) => quantity > 0)
    .map(([id, quantity]) => ({ id, quantity }));
}
