import { describe, expect, it } from "vitest";
import {
  bookingArrivalPreferenceSchema,
  createBookingArrivalPreference,
  formatBookingArrivalPreference,
  type BookingArrivalPreference,
} from "../shared/bookingArrival";
import { createCanonicalBookingInput, createCanonicalPricingInput, CANONICAL_TIME_SLOTS, type CanonicalBookingDraft } from "../shared/canonicalBooking";
import { calculatePublicBookingPrice, createPublicBookingPriceSnapshot, PUBLIC_BOOKING_PRICING_VERSION, type PublicBookingPricingInput } from "../shared/publicBookingPricing";
import { buildPreparedCanonicalBooking, NativeBookingInputError, type PreparePublicBookingInput } from "./bookingsService";
import { businessLocalDateTimeToUtcMs } from "./utils/businessTime";

const base: PublicBookingPricingInput = {
  pricingMode: "home", serviceId: "standard", bedrooms: 1, bathrooms: 1,
  homeType: "House", condition: 6, maidCount: 2, hourCount: 2,
  extras: [{ id: "inside-fridge", quantity: 2 }], recurrence: "biweekly",
};
const draft: CanonicalBookingDraft = {
  ...base, frequency: base.recurrence, extras: { "inside-fridge": 2 },
  customerName: "Arrival Customer", customerPhone: "2025550182", customerEmail: "arrival@example.com",
  address: "123 Main Street", requestedLocalDate: "2027-01-10", requestedLocalTime: "11:00", specialRequestNotes: [],
};
const options = { nowMs: Date.UTC(2026, 10, 1), timeZone: "America/New_York" };
function bookingInput(pricing: PublicBookingPricingInput, acceptedTotalCents = calculatePublicBookingPrice(pricing).firstCleaningTotalCents): PreparePublicBookingInput {
  return {
    ...createCanonicalBookingInput(draft, {
      idempotencyKey: "11111111-1111-4111-8111-111111111111", surface: "full_page",
      acceptedPricingVersion: PUBLIC_BOOKING_PRICING_VERSION, acceptedTotalCents,
    }), pricing,
  };
}
const preferences = [
  createBookingArrivalPreference("flexible"),
  createBookingArrivalPreference("preferred", "morning"),
  createBookingArrivalPreference("preferred", "afternoon"),
  ...CANONICAL_TIME_SLOTS.map(start => createBookingArrivalPreference("exact", undefined, start)),
];

describe("public-only arrival preference contract", () => {
  it("creates approved broad windows and requires an explicit preferred period", () => {
    expect(preferences.slice(0, 3)).toEqual([
      { mode: "flexible", startLocalTime: "08:30", endLocalTime: "17:00" },
      { mode: "preferred", period: "morning", startLocalTime: "08:00", endLocalTime: "12:00" },
      { mode: "preferred", period: "afternoon", startLocalTime: "12:00", endLocalTime: "17:00" },
    ]);
    expect(() => createBookingArrivalPreference("preferred")).toThrow("preferred arrival period");
    expect(() => createBookingArrivalPreference("exact", undefined, "11:00")).toThrow("exact arrival window");
    expect(() => createBookingArrivalPreference("exact")).toThrow("exact arrival window");
    expect(() => createBookingArrivalPreference("exact", undefined, "toString")).toThrow("exact arrival window");
  });

  it("retains every exact two-hour window, including the last 18:30 end", () => {
    expect(preferences.slice(3).map(value => [value.startLocalTime, value.endLocalTime])).toEqual([
      ["08:30", "10:30"], ["10:30", "12:30"], ["12:30", "14:30"], ["14:30", "16:30"], ["16:30", "18:30"],
    ]);
    expect(formatBookingArrivalPreference(preferences.at(-1)!)).toBe("Exact · 4:30 PM–6:30 PM");
  });

  it.each([
    { mode: "other", startLocalTime: "08:30", endLocalTime: "17:00" },
    { mode: "preferred", startLocalTime: "08:00", endLocalTime: "12:00" },
    { mode: "preferred", period: "morning", startLocalTime: "08:30", endLocalTime: "12:00" },
    { mode: "preferred", period: "afternoon", startLocalTime: "12:00", endLocalTime: "18:00" },
    { mode: "flexible", startLocalTime: "08:00", endLocalTime: "17:00" },
    { mode: "flexible", period: "morning", startLocalTime: "08:30", endLocalTime: "17:00" },
    { mode: "exact", startLocalTime: "16:30", endLocalTime: "17:00" },
    { mode: "exact", startLocalTime: "11:00", endLocalTime: "13:00" },
    { mode: "exact", period: "morning", startLocalTime: "08:30", endLocalTime: "10:30" },
    null,
  ])("rejects malformed or non-approved preference %# at pricing and preparation boundaries", value => {
    const input = { ...base, arrivalPreference: value as BookingArrivalPreference };
    expect(bookingArrivalPreferenceSchema.safeParse(value).success).toBe(false);
    expect(() => calculatePublicBookingPrice(input)).toThrow("supported arrival window");
    expect(() => buildPreparedCanonicalBooking({ ...bookingInput(base), pricing: input }, options)).toThrow(NativeBookingInputError);
  });

  it("forwards explicit preferences, never fabricates one or changes legacy 11:00", () => {
    expect(createCanonicalPricingInput(draft)).toEqual(base);
    expect(createCanonicalPricingInput(draft)).not.toHaveProperty("arrivalPreference");
    const legacy = createCanonicalBookingInput(draft, { idempotencyKey: "11111111-1111-4111-8111-111111111111", surface: "popup", acceptedPricingVersion: PUBLIC_BOOKING_PRICING_VERSION, acceptedTotalCents: 29800 });
    expect(legacy.requestedSchedule.localTime).toBe("11:00");
    for (const preference of preferences) {
      const selected = { ...draft, arrivalPreference: preference };
      expect(createCanonicalPricingInput(selected).arrivalPreference).toEqual(preference);
      expect(createCanonicalBookingInput(selected, { idempotencyKey: legacy.idempotencyKey, surface: "full_page", acceptedPricingVersion: PUBLIC_BOOKING_PRICING_VERSION, acceptedTotalCents: 1 }).requestedSchedule.localTime).toBe(preference.startLocalTime);
    }
  });
});

describe("authoritative first-cleaning arrival pricing", () => {
  it.each(["home", "hourly"] as const)("discounts first %s total including extras once; future prices do not change", pricingMode => {
    for (const recurrence of ["one-time", "weekly", "biweekly", "monthly"] as const) {
      const input = { ...base, pricingMode, recurrence };
      const legacy = calculatePublicBookingPrice(input);
      for (const preference of preferences) {
        const result = calculatePublicBookingPrice({ ...input, arrivalPreference: preference });
        const percent = preference.mode === "flexible" ? 10 : preference.mode === "preferred" ? 5 : 0;
        const discount = Math.round(legacy.firstCleaningTotalCents * percent / 100);
        expect(result.arrivalDiscountPercent).toBe(percent);
        expect(result.arrivalDiscountCents).toBe(discount);
        expect(result.firstCleaningTotalCents).toBe(legacy.firstCleaningTotalCents - discount);
        expect(result.futureVisitBaseTotalCents).toBe(legacy.futureVisitBaseTotalCents);
        expect(result.futureVisitTotalCents).toBe(legacy.futureVisitTotalCents);
        expect(result.discountPercent).toBe(legacy.discountPercent);
        expect(result.extrasTotalCents).toBe(legacy.extrasTotalCents);
      }
    }
  });

  it("never rewrites custom total quotes or fabricates preference from a manual price", () => {
    const custom = { ...base, customPriceCents: 32123 };
    expect(createCanonicalPricingInput({ ...draft, customPriceCents: 32123 })).toEqual(custom);
    expect(calculatePublicBookingPrice(custom).firstCleaningTotalCents).toBe(32123);
    expect(createPublicBookingPriceSnapshot(custom).input).not.toHaveProperty("arrivalPreference");
    for (const preference of preferences) {
      const result = calculatePublicBookingPrice({ ...custom, arrivalPreference: preference });
      expect(result.firstCleaningTotalCents).toBe(32123);
      expect(result.arrivalDiscountCents).toBe(0);
      expect(result.futureVisitTotalCents).toBe(calculatePublicBookingPrice(custom).futureVisitTotalCents);
    }
  });

  it.each(preferences)("recomputes a JSON snapshot for $mode $startLocalTime and persists/returns the real window", preference => {
    const input = { ...base, arrivalPreference: { ...preference } };
    const snapshot = createPublicBookingPriceSnapshot(input);
    const quote = JSON.parse(JSON.stringify(snapshot));
    quote.breakdown.firstCleaningTotalCents = 1; // Display breakdown is never authoritative.
    const built = buildPreparedCanonicalBooking(bookingInput(quote.input, snapshot.breakdown.firstCleaningTotalCents), options);
    expect(built.type).toBe("ready");
    if (built.type !== "ready") throw new Error("Expected canonical preparation");
    expect(built.prepared.priceSnapshot).toEqual(snapshot);
    expect(built.prepared.firstCleaningTotalCents).toBe(snapshot.breakdown.firstCleaningTotalCents);
    expect(built.prepared.futureVisitTotalCents).toBe(snapshot.breakdown.futureVisitTotalCents);
    expect(built.prepared.requestedLocalTime).toBe(preference.startLocalTime);
    expect(built.prepared.requestedStartAt).toBe(businessLocalDateTimeToUtcMs(draft.requestedLocalDate, preference.startLocalTime, options.timeZone));
    expect(built.prepared.summary.arrivalPreference).toEqual(preference);
    const wrongPrice = buildPreparedCanonicalBooking(bookingInput(quote.input, 1), options);
    expect(wrongPrice).toMatchObject({ type: "price_changed", totalCents: snapshot.breakdown.firstCleaningTotalCents, priceSnapshot: snapshot });
    input.arrivalPreference.endLocalTime = "23:00";
    expect(snapshot.input.arrivalPreference).toEqual(preference);
  });

  it("rehydrates old quotes without preference with identical totals, snapshot shape and 11:00 start", () => {
    for (const pricing of [base, { ...base, customPriceCents: 32123 }]) {
      const snapshot = createPublicBookingPriceSnapshot(pricing);
      const built = buildPreparedCanonicalBooking(bookingInput(JSON.parse(JSON.stringify(snapshot)).input), options);
      expect(built.type).toBe("ready");
      if (built.type !== "ready") throw new Error("Expected legacy preparation");
      expect(built.prepared.priceSnapshot).toEqual(snapshot);
      expect(built.prepared.summary).not.toHaveProperty("arrivalPreference");
      expect(snapshot.breakdown).not.toHaveProperty("arrivalDiscountCents");
      expect(snapshot.input).not.toHaveProperty("arrivalPreference");
      expect(built.prepared.requestedLocalTime).toBe("11:00");
      expect(built.prepared.firstCleaningTotalCents).toBe(pricing.customPriceCents ?? 29800);
    }
  });

  it("hashes the real preference so exact and flexible with the same start are materially different", () => {
    const flexible = { ...base, customPriceCents: 32123, arrivalPreference: preferences[0] };
    const exact = { ...flexible, arrivalPreference: preferences[3] };
    const first = buildPreparedCanonicalBooking(bookingInput(flexible), options);
    const second = buildPreparedCanonicalBooking(bookingInput(exact), options);
    if (first.type !== "ready" || second.type !== "ready") throw new Error("Expected prepared quotes");
    expect(first.prepared.requestedStartAt).toBe(second.prepared.requestedStartAt);
    expect(first.prepared.firstCleaningTotalCents).toBe(second.prepared.firstCleaningTotalCents);
    expect(first.prepared.commandHash).not.toBe(second.prepared.commandHash);
  });
});
