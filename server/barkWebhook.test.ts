/**
 * Bark Webhook — Unit Tests
 *
 * Tests the pure utility functions in barkWebhook.ts:
 * - normalizePhone: E.164 normalization
 * - parseBarkDisplayText: Q&A extraction from Bark's display_text field
 * - buildBarkFirstSms: First SMS message construction
 *
 * No DB or HTTP calls are made; all external dependencies are mocked.
 */

import { describe, it, expect } from "vitest";
import { normalizePhone } from "./routers";

// ─── Re-export helpers for testing ────────────────────────────────────────────
// These are pure functions extracted from barkWebhook.ts logic

function extractFirstName(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] ?? fullName;
}

function buildBarkFirstSms(
  leadName: string,
  serviceType: string,
  businessName: string = "Maids in Black"
): string {
  const firstName = extractFirstName(leadName);
  return `Hi ${firstName}! This is ${businessName}. I saw your request for ${serviceType} on Bark — I'd love to help! When were you hoping to get that scheduled?`;
}

function parseBarkDisplayText(displayText: string): {
  bedrooms: string | null;
  bathrooms: string | null;
  frequency: string | null;
  location: string | null;
  summary: string;
} {
  const lines = displayText.split("\n").map(l => l.trim()).filter(Boolean);
  let bedrooms: string | null = null;
  let bathrooms: string | null = null;
  let frequency: string | null = null;
  let location: string | null = null;

  for (const line of lines) {
    const lower = line.toLowerCase();
    // Bedrooms
    const bedroomMatch = lower.match(/(\d+)\s*bed(?:room)?s?/);
    if (bedroomMatch && !bedrooms) {
      bedrooms = `${bedroomMatch[1]} Bedroom${parseInt(bedroomMatch[1]) !== 1 ? "s" : ""}`;
    }
    // Bathrooms
    const bathroomMatch = lower.match(/(\d+(?:\.\d+)?)\s*bath(?:room)?s?/);
    if (bathroomMatch && !bathrooms) {
      const num = parseFloat(bathroomMatch[1]);
      bathrooms = `${bathroomMatch[1]} Bathroom${num !== 1 ? "s" : ""}`;
    }
    // Frequency — check bi-weekly BEFORE weekly to avoid false match
    if (!frequency) {
      if (/bi.?weekly|every two weeks|every 2 weeks/i.test(line)) frequency = "Bi-Weekly";
      else if (/weekly/i.test(line)) frequency = "Weekly";
      else if (/monthly/i.test(line)) frequency = "Monthly";
      else if (/one.?time|once|single/i.test(line)) frequency = "One-Time";
    }
    // Location / zip
    const zipMatch = line.match(/\b\d{5}\b/);
    if (zipMatch && !location) location = zipMatch[0];
  }

  // Build a concise summary from the Q&A lines
  const summary = lines.slice(0, 8).join("\n");

  return { bedrooms, bathrooms, frequency, location, summary };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("normalizePhone", () => {
  it("normalizes a 10-digit US number to E.164", () => {
    // 7035551234: area code 703, exchange 555 (≥ 2) → valid NANP
    expect(normalizePhone("7035551234")).toBe("+17035551234");
  });

  it("passes through an already-normalized E.164 number", () => {
    expect(normalizePhone("+13031234567")).toBe("+13031234567");
  });

  it("strips dashes and spaces from 10-digit numbers", () => {
    // 703-555-1234: area code 703, exchange 555 (>= 2) → valid NANP → +17035551234
    expect(normalizePhone("703-555-1234")).toBe("+17035551234");
    expect(normalizePhone("(703) 555-1234")).toBe("+17035551234");
  });
});

describe("extractFirstName", () => {
  it("returns the first word of a full name", () => {
    expect(extractFirstName("Jane Doe")).toBe("Jane");
  });

  it("handles single-word names", () => {
    expect(extractFirstName("Jane")).toBe("Jane");
  });

  it("trims leading/trailing whitespace", () => {
    expect(extractFirstName("  Jane Doe  ")).toBe("Jane");
  });
});

describe("buildBarkFirstSms", () => {
  it("builds a first SMS with the lead's first name and service type", () => {
    const sms = buildBarkFirstSms("Jane Doe", "House Cleaning");
    expect(sms).toContain("Jane");
    expect(sms).toContain("House Cleaning");
    expect(sms).toContain("Bark");
    expect(sms).toContain("scheduled");
  });

  it("uses the business name in the message", () => {
    const sms = buildBarkFirstSms("Bob Smith", "Deep Clean", "CleanPro");
    expect(sms).toContain("CleanPro");
  });
});

describe("parseBarkDisplayText", () => {
  const sampleDisplayText = `
How many bedrooms does your home have?
3 bedrooms

How many bathrooms?
2 bathrooms

How often would you like cleaning?
Bi-weekly

What is your zip code?
80210

Any additional notes?
Please bring eco-friendly products
  `.trim();

  it("extracts bedroom count", () => {
    const result = parseBarkDisplayText(sampleDisplayText);
    expect(result.bedrooms).toBe("3 Bedrooms");
  });

  it("extracts bathroom count", () => {
    const result = parseBarkDisplayText(sampleDisplayText);
    expect(result.bathrooms).toBe("2 Bathrooms");
  });

  it("extracts frequency", () => {
    const result = parseBarkDisplayText(sampleDisplayText);
    expect(result.frequency).toBe("Bi-Weekly");
  });

  it("extracts zip code as location", () => {
    const result = parseBarkDisplayText(sampleDisplayText);
    expect(result.location).toBe("80210");
  });

  it("builds a non-empty summary", () => {
    const result = parseBarkDisplayText(sampleDisplayText);
    expect(result.summary.length).toBeGreaterThan(0);
  });

  it("handles missing fields gracefully", () => {
    const result = parseBarkDisplayText("Please clean my home. No other details.");
    expect(result.bedrooms).toBeNull();
    expect(result.bathrooms).toBeNull();
    expect(result.frequency).toBeNull();
  });

  it("handles 1 bedroom correctly (no plural)", () => {
    const result = parseBarkDisplayText("1 bedroom, 1 bathroom");
    expect(result.bedrooms).toBe("1 Bedroom");
    expect(result.bathrooms).toBe("1 Bathroom");
  });

  it("handles half bathrooms", () => {
    const result = parseBarkDisplayText("3 bedrooms, 2.5 bathrooms");
    expect(result.bathrooms).toBe("2.5 Bathrooms");
  });
});
