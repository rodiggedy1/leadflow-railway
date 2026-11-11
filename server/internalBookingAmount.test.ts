import { describe, expect, it } from "vitest";
import { parseInternalBookingAmount } from "../shared/internalBookingAmount";
import { calculatePublicBookingPrice, createPublicBookingPriceSnapshot, type PublicBookingPricingInput } from "../shared/publicBookingPricing";
import { createBookingArrivalPreference } from "../shared/bookingArrival";
import { CANONICAL_TIME_SLOTS } from "../shared/canonicalBooking";

const base: PublicBookingPricingInput = {
  pricingMode: "home", serviceId: "standard", bedrooms: 2, bathrooms: 2,
  homeType: "House", condition: 6, maidCount: 2, hourCount: 3,
  extras: [{ id: "inside-fridge", quantity: 2 }], recurrence: "biweekly",
};
const preferences = [
  createBookingArrivalPreference("flexible"),
  createBookingArrivalPreference("preferred", "morning"),
  createBookingArrivalPreference("preferred", "afternoon"),
  ...CANONICAL_TIME_SLOTS.map(time => createBookingArrivalPreference("exact", undefined, time)),
];

describe("staff final amount uses existing canonical override, never new pricing logic", () => {
  it.each(["", "  ", "\t"])("blank %j restores unadjusted calculated pricing", value => {
    expect(parseInternalBookingAmount(value)).toEqual({ valid: true, customPriceCents: undefined, error: "" });
  });
  it.each([
    ["0.01", 1], [".01", 1], [".5", 50], ["1", 100], ["1.", 100],
    ["1.2", 120], ["1.23", 123], [" 001.23 ", 123], ["123.45", 12345],
    ["10000", 1000000], ["10000.00", 1000000], ["19.99", 1999],
  ] as const)("parses %s into exactly %i integer cents", (value, cents) => {
    expect(parseInternalBookingAmount(value)).toEqual({ valid: true, customPriceCents: cents, error: "" });
  });
  it.each(["0", "0.00", "10000.01", "-1", "+1", "1e2", "1,000", "$50", "1.234", "1.2.3", ".", "NaN", "Infinity", "99999999999999999999999999"])("rejects invalid/unsupported final total %j", value => {
    expect(parseInternalBookingAmount(value)).toMatchObject({ valid: false, error: expect.any(String) });
  });
  it("preserves every cent without binary floating point rounding", () => {
    for (let cents = 1; cents <= 1000; cents++) {
      const raw = `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
      expect(parseInternalBookingAmount(raw)).toEqual({ valid: true, customPriceCents: cents, error: "" });
    }
  });
  it.each(["home", "hourly"] as const)("keeps exact final override through %s arrivals, extras, snapshots and recurrence", pricingMode => {
    for (const recurrence of ["one-time", "weekly", "biweekly", "monthly"] as const) {
      for (const arrivalPreference of preferences) {
        const input = { ...base, pricingMode, recurrence, arrivalPreference };
        const ordinary = calculatePublicBookingPrice(input);
        for (const customPriceCents of [1, 12345, ordinary.firstCleaningTotalCents, 1000000]) {
          const override = { ...input, customPriceCents };
          const actual = calculatePublicBookingPrice(override);
          const snapshot = createPublicBookingPriceSnapshot(override);
          expect(actual.firstCleaningTotalCents).toBe(customPriceCents);
          expect(actual.arrivalDiscountCents).toBe(0);
          expect(actual.futureVisitTotalCents).toBe(ordinary.futureVisitTotalCents);
          expect(actual.futureVisitBaseTotalCents).toBe(ordinary.futureVisitBaseTotalCents);
          expect(actual.discountPercent).toBe(ordinary.discountPercent);
          expect(actual.extrasTotalCents).toBe(ordinary.extrasTotalCents);
          expect(snapshot.input.customPriceCents).toBe(customPriceCents);
          expect(snapshot.input.arrivalPreference).toEqual(arrivalPreference);
          expect(snapshot.breakdown.firstCleaningTotalCents).toBe(customPriceCents);
          expect(snapshot.breakdown.futureVisitTotalCents).toBe(ordinary.futureVisitTotalCents);
          expect(calculatePublicBookingPrice({ ...snapshot.input, customPriceCents: undefined })).toEqual(ordinary);
        }
      }
    }
  });
});
