import { describe, it, expect } from "vitest";
import { calculatePrice, calculateRecurringPrice, RECURRING_DISCOUNTS } from "./engine/pricing";

describe("wand pricing — deterministic engine", () => {
  it("2BR/2BA standard = $269", () => {
    expect(calculatePrice("2 Bedrooms", "2 Bathrooms", "Standard Cleaning")).toBe(269);
  });

  it("3BR/2BA standard = $289", () => {
    expect(calculatePrice("3 Bedrooms", "2 Bathrooms", "Standard Cleaning")).toBe(289);
  });

  it("3BR/2BA deep clean adds $60 surcharge = $349", () => {
    expect(calculatePrice("3 Bedrooms", "2 Bathrooms", "Deep Cleaning")).toBe(349);
  });

  it("1BR/1BA standard = $149", () => {
    expect(calculatePrice("1 Bedroom", "1 Bathroom", "Standard Cleaning")).toBe(149);
  });

  it("unknown bedrooms defaults to 1BR base ($119)", () => {
    expect(calculatePrice("unknown", "1 Bathroom", "Standard Cleaning")).toBe(149);
  });

  it("biweekly discount is 15% off", () => {
    const base = calculatePrice("2 Bedrooms", "2 Bathrooms", "Standard Cleaning");
    const discounted = calculateRecurringPrice(base, "biweekly");
    expect(discounted).toBe(Math.round(base * 0.85));
  });

  it("weekly discount is 20% off", () => {
    const base = calculatePrice("3 Bedrooms", "2 Bathrooms", "Standard Cleaning");
    const discounted = calculateRecurringPrice(base, "weekly");
    expect(discounted).toBe(Math.round(base * 0.80));
  });

  it("monthly discount is 10% off", () => {
    const base = calculatePrice("2 Bedrooms", "1 Bathroom", "Standard Cleaning");
    const discounted = calculateRecurringPrice(base, "monthly");
    expect(discounted).toBe(Math.round(base * 0.90));
  });

  it("RECURRING_DISCOUNTS has correct pct values", () => {
    expect(RECURRING_DISCOUNTS.weekly.pct).toBe(20);
    expect(RECURRING_DISCOUNTS.biweekly.pct).toBe(15);
    expect(RECURRING_DISCOUNTS.monthly.pct).toBe(10);
  });
});
