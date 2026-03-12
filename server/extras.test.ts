/**
 * Tests for the extras feature:
 * 1. EXTRAS_LIST in QuoteForm has exactly 20 items with unique keys
 * 2. generateQuoteMessage includes extras in the SMS when provided
 * 3. generateQuoteMessage omits extras note when none selected
 * 4. normalizePhone utility still works correctly
 */

import { describe, expect, it } from "vitest";
import { generateQuoteMessage } from "./aiService";
import { normalizePhone } from "./routers";
import { EXTRAS_LIST } from "../client/src/components/QuoteForm";

describe("EXTRAS_LIST", () => {
  it("has exactly 20 items", () => {
    expect(EXTRAS_LIST).toHaveLength(20);
  });

  it("all items have unique keys", () => {
    const keys = EXTRAS_LIST.map((e) => e.key);
    const uniqueKeys = new Set(keys);
    expect(uniqueKeys.size).toBe(20);
  });

  it("all items have a label and icon URL", () => {
    for (const item of EXTRAS_LIST) {
      expect(item.label.length).toBeGreaterThan(0);
      expect(item.icon).toMatch(/^https?:\/\//);
    }
  });
});

describe("generateQuoteMessage", () => {
  it("includes extras note when extras are provided", async () => {
    const msg = await generateQuoteMessage({
      leadName: "Jane Smith",
      bedrooms: "2 Bedrooms",
      bathrooms: "2 Bathrooms",
      serviceType: "Standard Cleaning",
      price: "180",
      extras: ["clean_inside_oven", "load_of_laundry"],
    });
    expect(msg).toContain("Jane");
    expect(msg).toContain("$180");
    expect(msg).toContain("clean inside oven");
    expect(msg).toContain("load of laundry");
  });

  it("omits extras note when no extras are selected", async () => {
    const msg = await generateQuoteMessage({
      leadName: "John Doe",
      bedrooms: "3 Bedrooms",
      bathrooms: "2 Bathrooms",
      serviceType: "Deep Cleaning",
      price: "250",
      extras: [],
    });
    expect(msg).toContain("John");
    expect(msg).toContain("$250");
    expect(msg).not.toContain("extras");
  });

  it("omits extras note when extras is undefined", async () => {
    const msg = await generateQuoteMessage({
      leadName: "Alice",
      bedrooms: "1 Bedroom",
      bathrooms: "1 Bathroom",
      serviceType: "Standard Cleaning",
      price: "120",
    });
    expect(msg).not.toContain("extras");
  });
});

describe("normalizePhone", () => {
  it("normalizes 10-digit US number", () => {
    expect(normalizePhone("2025551234")).toBe("+12025551234");
  });

  it("normalizes formatted number with dashes", () => {
    expect(normalizePhone("202-555-1234")).toBe("+12025551234");
  });

  it("normalizes 11-digit number starting with 1", () => {
    expect(normalizePhone("12025551234")).toBe("+12025551234");
  });

  it("preserves already-formatted E.164 number", () => {
    expect(normalizePhone("+12025551234")).toBe("+12025551234");
  });
});
