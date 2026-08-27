import { describe, expect, it } from "vitest";
import { hasInsideOvenExtra, isStandardOrRegularCleaning } from "./smartUpsells";

describe("tomorrow inside-oven Smart Upsell qualification", () => {
  it("accepts only Standard or Regular Cleaning service types", () => {
    expect(isStandardOrRegularCleaning("Standard Cleaning")).toBe(true);
    expect(isStandardOrRegularCleaning("Regular Cleaning")).toBe(true);
    expect(isStandardOrRegularCleaning("Deep Clean")).toBe(false);
    expect(isStandardOrRegularCleaning(null)).toBe(false);
  });

  it("recognizes only the canonical inside-oven extra and rejects malformed extras from outreach", () => {
    expect(hasInsideOvenExtra('["clean_inside_oven", "clean_inside_fridge"]')).toBe(true);
    expect(hasInsideOvenExtra('["clean_inside_fridge"]')).toBe(false);
    expect(hasInsideOvenExtra("not valid JSON")).toBeNull();
  });
});
