import { describe, expect, it } from "vitest";
import {
  createCanonicalBookingInput,
  createCanonicalPricingInput,
  selectedCanonicalExtras,
} from "../shared/canonicalBooking";
import { PUBLIC_BOOKING_PRICING_VERSION } from "../shared/publicBookingPricing";

describe("canonical booking engine contract", () => {
  const draft = {
    serviceId: "standard" as const,
    pricingMode: "home" as const,
    bedrooms: 2,
    bathrooms: 2,
    homeType: "House" as const,
    maidCount: 2,
    hourCount: 2,
    condition: 5,
    frequency: "biweekly" as const,
    extras: { "inside-oven": 1, "inside-cabinets": 2 },
    customerName: "Alex Customer",
    customerPhone: "202-555-0100",
    customerEmail: "alex@example.com",
    address: "100 Main Street, Washington, DC",
    requestedLocalDate: "2026-10-15",
    requestedLocalTime: "11:00",
    specialRequestNotes: ["Please call on arrival"],
  };

  it("normalizes extras identically regardless of object insertion order", () => {
    expect(selectedCanonicalExtras(draft.extras)).toEqual([
      { id: "inside-cabinets", quantity: 2 },
      { id: "inside-oven", quantity: 1 },
    ]);
    expect(
      createCanonicalPricingInput({ ...draft, extras: { "inside-cabinets": 2, "inside-oven": 1 } })
    ).toEqual(createCanonicalPricingInput(draft));
  });

  it("builds one normalized booking input for either surface adapter", () => {
    const input = createCanonicalBookingInput(draft, {
      idempotencyKey: "00000000-0000-4000-8000-000000000001",
      surface: "full_page",
      acceptedPricingVersion: PUBLIC_BOOKING_PRICING_VERSION,
      acceptedTotalCents: 31900,
    });
    expect(input).toMatchObject({
      idempotencyKey: "00000000-0000-4000-8000-000000000001",
      surface: "full_page",
      customer: {
        fullName: "Alex Customer",
        phone: "202-555-0100",
        email: "alex@example.com",
      },
      service: {
        serviceId: "standard",
        bedrooms: 2,
        bathrooms: 2,
        extras: [
          { id: "inside-cabinets", quantity: 2 },
          { id: "inside-oven", quantity: 1 },
        ],
        specialRequestNotes: ["Please call on arrival"],
      },
      acceptedPricing: {
        version: PUBLIC_BOOKING_PRICING_VERSION,
        totalCents: 31900,
      },
    });
  });
});
