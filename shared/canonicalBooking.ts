import type {
  BookingWidgetRecurringFrequency,
  BookingWidgetServiceId,
} from "./bookingWidgetConfig";
import {
  PUBLIC_BOOKING_PRICED_EXTRAS,
  type PublicBookingHomeType,
  type PublicBookingPricingInput,
  type PublicBookingPricingMode,
} from "./publicBookingPricing";
import type { PrepareBookingInput } from "./booking";

export const CANONICAL_BOOKING_STEPS = [
  "cleaning-type",
  "home-details",
  "home-condition",
  "extras",
  "date-time",
  "customer",
  "payment-method",
  "review",
  "additional-services",
] as const;

export type CanonicalBookingStep = (typeof CANONICAL_BOOKING_STEPS)[number];
export type CanonicalExtraQuantities = Record<string, number>;

export const CANONICAL_SERVICE_IDS: readonly BookingWidgetServiceId[] = [
  "standard",
  "deep",
  "moveout",
] as const;

export const CANONICAL_FREQUENCIES: readonly BookingWidgetRecurringFrequency[] = [
  "one-time",
  "weekly",
  "biweekly",
  "monthly",
] as const;

export const CANONICAL_CONDITION_COPY = [
  "Basically spotless",
  "Just needs a refresh",
  "Normal everyday mess",
  "Definitely lived-in",
  "Pretty lived-in",
  "It’s been a minute",
  "Bring the good gloves",
  "We need the A-team",
  "Send reinforcements",
  "Don’t ask. Just come.",
] as const;

export const CANONICAL_TIME_SLOTS = [
  "08:30",
  "10:30",
  "12:30",
  "14:30",
] as const;

export const CANONICAL_TIME_SLOT_LABELS = [
  "8:30 AM",
  "10:30 AM",
  "12:30 PM",
  "2:30 PM",
] as const;

export type CanonicalBookingDraft = {
  serviceId: BookingWidgetServiceId;
  pricingMode: PublicBookingPricingMode;
  bedrooms: number;
  bathrooms: number;
  homeType: PublicBookingHomeType;
  maidCount: number;
  hourCount: number;
  condition: number;
  frequency: BookingWidgetRecurringFrequency;
  extras: CanonicalExtraQuantities;
  customerName: string;
  customerPhone: string;
  customerEmail: string;
  address: string;
  requestedLocalDate: string;
  requestedLocalTime: string;
  specialRequestNotes: string[];
};

export function selectedCanonicalExtras(
  quantities: CanonicalExtraQuantities
): Array<{ id: string; quantity: number }> {
  return Object.entries(quantities)
    .filter(([, quantity]) => quantity > 0)
    .map(([id, quantity]) => ({ id, quantity }))
    .sort((left, right) => left.id.localeCompare(right.id));
}

export function createCanonicalPricingInput(
  draft: Pick<
    CanonicalBookingDraft,
    | "pricingMode"
    | "serviceId"
    | "bedrooms"
    | "bathrooms"
    | "homeType"
    | "condition"
    | "maidCount"
    | "hourCount"
    | "extras"
    | "frequency"
  >
): PublicBookingPricingInput {
  return {
    pricingMode: draft.pricingMode,
    serviceId: draft.serviceId,
    bedrooms: draft.bedrooms,
    bathrooms: draft.bathrooms,
    homeType: draft.homeType,
    condition: draft.condition,
    maidCount: draft.maidCount,
    hourCount: draft.hourCount,
    extras: selectedCanonicalExtras(draft.extras),
    recurrence: draft.frequency,
  };
}

export function createCanonicalBookingInput<
  Surface extends PrepareBookingInput["surface"],
  PricingVersion extends string,
>(
  draft: CanonicalBookingDraft,
  options: {
    idempotencyKey: string;
    surface: Surface;
    acceptedPricingVersion: PricingVersion;
    acceptedTotalCents: number;
  }
): Omit<PrepareBookingInput, "surface" | "acceptedPricing"> & {
  surface: Surface;
  acceptedPricing: { version: PricingVersion; totalCents: number };
} {
  return {
    idempotencyKey: options.idempotencyKey,
    surface: options.surface,
    customer: {
      fullName: draft.customerName.trim(),
      phone: draft.customerPhone.trim(),
      email: draft.customerEmail.trim(),
    },
    service: {
      serviceId: draft.serviceId,
      bedrooms: draft.bedrooms,
      bathrooms: draft.bathrooms,
      extras: selectedCanonicalExtras(draft.extras),
      specialRequestNotes: draft.specialRequestNotes
        .map(note => note.trim())
        .filter(Boolean),
    },
    address: draft.address.trim(),
    requestedSchedule: {
      localDate: draft.requestedLocalDate,
      localTime: draft.requestedLocalTime,
    },
    recurrence: draft.frequency,
    acceptedPricing: {
      version: options.acceptedPricingVersion,
      totalCents: options.acceptedTotalCents,
    },
  };
}

export function canonicalExtraLabel(id: string): string {
  return PUBLIC_BOOKING_PRICED_EXTRAS[id]?.label ?? id;
}
