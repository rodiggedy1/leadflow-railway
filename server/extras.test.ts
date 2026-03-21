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
  // New Jade flow: SMS 1 is a greeting + day ask. Price/extras are revealed in SMS 2 (buildJadePriceReveal).
  it("SMS 1: Jade greeting with first name and day ask (no price)", async () => {
    const msg = await generateQuoteMessage({
      leadName: "Jane Smith",
      bedrooms: "2 Bedrooms",
      bathrooms: "2 Bathrooms",
      serviceType: "Standard Cleaning",
      price: "209",
      extras: ["clean_inside_oven", "load_of_laundry"],
    });
    expect(msg).toContain("Jane");
    expect(msg).toContain("Jade");
    expect(msg).toContain("Maids in Black");
    expect(msg).toContain("day");
    // Price is NOT in SMS 1 — revealed in SMS 2
    expect(msg).not.toContain("$209");
    expect(msg).not.toContain("Total:");
  });

  it("SMS 1: no price shown when no extras selected", async () => {
    const msg = await generateQuoteMessage({
      leadName: "John Doe",
      bedrooms: "3 Bedrooms",
      bathrooms: "2 Bathrooms",
      serviceType: "Deep Cleaning",
      price: "319",
      extras: [],
    });
    expect(msg).toContain("John");
    // Price is NOT in SMS 1
    expect(msg).not.toContain("$319");
    expect(msg).not.toContain("Total:");
  });

  it("SMS 1: no total shown when extras is undefined", async () => {
    const msg = await generateQuoteMessage({
      leadName: "Alice",
      bedrooms: "1 Bedroom",
      bathrooms: "1 Bathroom",
      serviceType: "Standard Cleaning",
      price: "179",
    });
    // SMS 1 never shows a total — price is in SMS 2
    expect(msg).not.toContain("Total:");
    expect(msg).not.toContain("$179");
  });

  it("buildJadePriceReveal: calculates grand total correctly for multiple extras", async () => {
    // Price/extras are revealed in SMS 2 via buildJadePriceReveal, not generateQuoteMessage
    const { buildJadePriceReveal } = await import("./aiService");
    const msg = buildJadePriceReveal({
      firstName: "Bob",
      bedrooms: "2 Bedrooms",
      bathrooms: "1 Bathroom",
      price: "209",
      extras: ["clean_inside_cabinets", "green_cleaning", "wash_dishes"],
      day: "Friday",
    });
    // 209 + 30 + 20 + 20 = 279
    expect(msg).toContain("$279");
    expect(msg).toContain("Friday at 9am or 1pm");
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
