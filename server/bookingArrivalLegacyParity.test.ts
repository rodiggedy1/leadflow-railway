import { describe, expect, it } from "vitest";
import { calculatePublicBookingPrice, createPublicBookingPriceSnapshot, type PublicBookingPricingInput } from "../shared/publicBookingPricing";
import { createCanonicalPricingInput, createCanonicalBookingInput, type CanonicalBookingDraft } from "../shared/canonicalBooking";
import { buildPreparedCanonicalBooking, buildPreparedNativeBooking } from "./bookingsService";
import { NATIVE_BOOKING_PRICING_VERSION } from "../shared/booking";
import * as controlPricing from "/home/ubuntu/book-official-integration/arrival-control/shared/publicBookingPricing";
import * as controlCanonical from "/home/ubuntu/book-official-integration/arrival-control/shared/canonicalBooking";
import * as controlBookings from "/home/ubuntu/book-official-integration/arrival-control/server/bookingsService";

const options = { nowMs: Date.UTC(2026, 10, 1), timeZone: "America/New_York" };
const base: PublicBookingPricingInput = {
  pricingMode: "home", serviceId: "standard", bedrooms: 1, bathrooms: 1,
  homeType: "House", condition: 5, maidCount: 2, hourCount: 2,
  extras: [], recurrence: "biweekly",
};
const draft: CanonicalBookingDraft = {
  ...base, frequency: base.recurrence, extras: {}, customerName: " Legacy   Customer ",
  customerPhone: "2025550182", customerEmail: "LEGACY@example.com", address: " 123   Main Street ",
  requestedLocalDate: "2027-01-10", requestedLocalTime: "11:00", specialRequestNotes: [" Text first "],
};
const accepted = { idempotencyKey: "11111111-1111-4111-8111-111111111111", surface: "popup" as const, acceptedPricingVersion: "public-book-v2" as const, acceptedTotalCents: 18900 };

// This compact control was copied before edits. Its dependency symlink is reused;
// no runtime/db/provider code is imported. Compare complete serialized contracts,
// not just totals, including command hashes and optional-key omission.
describe("arrival opt-in preserves the real pre-change no-preference contract", () => {
  it("matches legacy home/hourly, condition, extras, recurrence and custom quote bytes", () => {
    for (const pricingMode of ["home", "hourly"] as const)
      for (const serviceId of ["standard", "deep", "moveout"] as const)
        for (const bedrooms of [0, 1, 7])
          for (const bathrooms of [1, 5])
            for (const condition of [1, 5, 6, 10])
              for (const recurrence of ["one-time", "weekly", "biweekly", "monthly"] as const)
                for (const extras of [[], [{ id: "inside-fridge", quantity: 2 }, { id: "interior-windows", quantity: 3 }]])
                  for (const customPriceCents of [undefined, 1, 32123]) {
                    const input = { ...base, pricingMode, serviceId, bedrooms, bathrooms, condition, recurrence, extras,
                      ...(customPriceCents !== undefined ? { customPriceCents } : {}) };
                    expect(JSON.stringify(calculatePublicBookingPrice(input))).toBe(JSON.stringify(controlPricing.calculatePublicBookingPrice(input)));
                    expect(JSON.stringify(createPublicBookingPriceSnapshot(input))).toBe(JSON.stringify(controlPricing.createPublicBookingPriceSnapshot(input)));
                  }
  });

  it("matches canonical adapters, authoritative public preparation and mismatch responses byte-for-byte", () => {
    for (const requestedLocalTime of ["11:00", "08:30", "16:30"])
      for (const customPriceCents of [undefined, 32123]) {
        const current = { ...draft, requestedLocalTime, ...(customPriceCents !== undefined ? { customPriceCents } : {}) };
        const pricing = createCanonicalPricingInput(current);
        expect(JSON.stringify(pricing)).toBe(JSON.stringify(controlCanonical.createCanonicalPricingInput(current)));
        const amount = calculatePublicBookingPrice(pricing).firstCleaningTotalCents;
        const booking = createCanonicalBookingInput(current, { ...accepted, acceptedTotalCents: amount });
        expect(JSON.stringify(booking)).toBe(JSON.stringify(controlCanonical.createCanonicalBookingInput(current, { ...accepted, acceptedTotalCents: amount })));
        const input = { ...booking, pricing };
        expect(JSON.stringify(buildPreparedCanonicalBooking(input, options))).toBe(JSON.stringify(controlBookings.buildPreparedCanonicalBooking(input, options)));
        const wrong = { ...input, acceptedPricing: { version: "public-book-v2" as const, totalCents: 1 } };
        expect(JSON.stringify(buildPreparedCanonicalBooking(wrong, options))).toBe(JSON.stringify(controlBookings.buildPreparedCanonicalBooking(wrong, options)));
      }
  });

  it("matches the native/widget builder byte-for-byte, with no new mode/default or discounts", () => {
    const booking = createCanonicalBookingInput({ ...draft, serviceId: "deep", bedrooms: 2, bathrooms: 2, frequency: "weekly", extras: { "inside-fridge": 1 } }, {
      ...accepted, acceptedPricingVersion: NATIVE_BOOKING_PRICING_VERSION, acceptedTotalCents: 34100,
    });
    expect(JSON.stringify(buildPreparedNativeBooking(booking, options))).toBe(JSON.stringify(controlBookings.buildPreparedNativeBooking(booking, options)));
  });
});
