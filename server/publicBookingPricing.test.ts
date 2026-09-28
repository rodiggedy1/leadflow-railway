import { describe, expect, it } from "vitest";
import {
  PUBLIC_BOOKING_PRICING_VERSION,
  calculatePublicBookingPrice,
  createPublicBookingPriceSnapshot,
} from "../shared/publicBookingPricing";

const input = {
  pricingMode: "home" as const,
  serviceId: "standard" as const,
  bedrooms: 1,
  bathrooms: 1,
  homeType: "House" as const,
  condition: 5,
  maidCount: 2,
  hourCount: 2,
  extras: [],
  recurrence: "biweekly" as const,
};

describe("approved public booking pricing", () => {
  it("uses the approved one-bedroom, one-bath base and recurring discount", () => {
    const result = calculatePublicBookingPrice(input);
    expect(result.firstCleaningTotalCents).toBe(18_900);
    expect(result.futureVisitTotalCents).toBe(16_100);
    expect(result.discountPercent).toBe(15);
  });

  it("applies condition only to the first visit and excludes extras from future visits", () => {
    const result = calculatePublicBookingPrice({
      ...input,
      condition: 6,
      extras: [{ id: "inside-fridge", quantity: 2 }],
    });
    expect(result.conditionAdjustmentCents).toBe(1_900);
    expect(result.extrasTotalCents).toBe(9_000);
    expect(result.firstCleaningTotalCents).toBe(29_800);
    expect(result.futureVisitTotalCents).toBe(16_100);
  });

  it("uses the approved $70 per maid-hour calculation and recurring discount", () => {
    const result = calculatePublicBookingPrice({
      ...input,
      pricingMode: "hourly",
      maidCount: 2,
      hourCount: 2,
    });
    expect(result.firstCleaningTotalCents).toBe(28_000);
    expect(result.futureVisitTotalCents).toBe(23_800);
  });

  it("persists an immutable versioned snapshot for server verification", () => {
    const snapshot = createPublicBookingPriceSnapshot(input);
    expect(snapshot.version).toBe(PUBLIC_BOOKING_PRICING_VERSION);
    expect(snapshot.breakdown.firstCleaningTotalCents).toBe(18_900);
    expect(snapshot.input.extras).toEqual([]);
  });
});
