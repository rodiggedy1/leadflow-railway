/**
 * Tests for the email lead parser (emailLeadWebhook.ts)
 * Covers: stripNumericSuffix, parseBedroomCount, parseBathroomCount,
 *         parseCleaningType, parseEmailLeadBody, verifyMailgunSignature
 */
import { describe, it, expect } from "vitest";
import {
  stripNumericSuffix,
  parseBedroomCount,
  parseBathroomCount,
  parseCleaningType,
  parseEmailLeadBody,
  verifyMailgunSignature,
} from "./emailLeadWebhook";
import crypto from "crypto";

// ── stripNumericSuffix ────────────────────────────────────────────────────────

describe("stripNumericSuffix", () => {
  it("strips trailing decimal multiplier", () => {
    expect(stripNumericSuffix("BiWeekly 0.85")).toBe("BiWeekly");
  });
  it("strips trailing integer price", () => {
    expect(stripNumericSuffix("Two 179")).toBe("Two");
    expect(stripNumericSuffix("One 30")).toBe("One");
  });
  it("leaves plain words unchanged", () => {
    expect(stripNumericSuffix("Standard")).toBe("Standard");
  });
  it("handles extra whitespace", () => {
    expect(stripNumericSuffix("  Deep Clean  45  ")).toBe("Deep Clean");
  });
});

// ── parseBedroomCount ─────────────────────────────────────────────────────────

describe("parseBedroomCount", () => {
  it("maps word-form numbers", () => {
    expect(parseBedroomCount("Two 179")).toBe("2 Bedrooms");
    expect(parseBedroomCount("Three 250")).toBe("3 Bedrooms");
    expect(parseBedroomCount("One 120")).toBe("1 Bedroom");
  });
  it("passes through numeric strings", () => {
    expect(parseBedroomCount("2")).toBe("2 Bedrooms");
    expect(parseBedroomCount("3 bed")).toBe("3 Bedrooms");
  });
  it("handles Studio", () => {
    expect(parseBedroomCount("Studio 99")).toBe("Studio");
  });
  it("returns null for unrecognised values", () => {
    expect(parseBedroomCount("unknown")).toBeNull();
  });
});

// ── parseBathroomCount ────────────────────────────────────────────────────────

describe("parseBathroomCount", () => {
  it("maps word-form numbers", () => {
    expect(parseBathroomCount("One 30")).toBe("1 Bathroom");
    expect(parseBathroomCount("Two 60")).toBe("2 Bathrooms");
  });
  it("passes through numeric strings", () => {
    expect(parseBathroomCount("1.5")).toBe("1.5 Bathrooms");
  });
  it("returns null for unrecognised values", () => {
    expect(parseBathroomCount("unknown")).toBeNull();
  });
});

// ── parseCleaningType ─────────────────────────────────────────────────────────

describe("parseCleaningType", () => {
  it("maps BiWeekly to Standard Cleaning + Bi-Weekly frequency", () => {
    const result = parseCleaningType("BiWeekly 0.85");
    expect(result.serviceType).toBe("Standard Cleaning");
    expect(result.frequency).toBe("Bi-Weekly");
  });
  it("maps Weekly", () => {
    const result = parseCleaningType("Weekly 0.9");
    expect(result.serviceType).toBe("Standard Cleaning");
    expect(result.frequency).toBe("Weekly");
  });
  it("maps Deep Clean", () => {
    const result = parseCleaningType("Deep Clean 1.2");
    expect(result.serviceType).toBe("Deep Cleaning");
    expect(result.frequency).toBeNull();
  });
  it("maps Move-In/Out", () => {
    const result = parseCleaningType("Move-In/Out 1.5");
    expect(result.serviceType).toBe("Move-In/Out Cleaning");
    expect(result.frequency).toBeNull();
  });
  it("defaults to Standard Cleaning for unknown types", () => {
    const result = parseCleaningType("Unknown Type 1.0");
    expect(result.serviceType).toBe("Standard Cleaning");
    expect(result.frequency).toBeNull();
  });
});

// ── parseEmailLeadBody ────────────────────────────────────────────────────────

describe("parseEmailLeadBody", () => {
  const sampleEmail = `Phone: +1 202 365 6619\nCleaning Type: BiWeekly 0.85\nBedrooms: Two 179\nBathrooms: One 30`;

  it("extracts phone number (raw, not normalized)", () => {
    const result = parseEmailLeadBody(sampleEmail);
    // The parser returns the raw phone string from the email.
    // normalizePhone() is called in handleEmailLead when creating the session.
    expect(result.phone).toBe("+1 202 365 6619");
  });

  it("extracts bedrooms", () => {
    const result = parseEmailLeadBody(sampleEmail);
    expect(result.bedrooms).toBe("2 Bedrooms");
  });

  it("extracts bathrooms", () => {
    const result = parseEmailLeadBody(sampleEmail);
    expect(result.bathrooms).toBe("1 Bathroom");
  });

  it("extracts serviceType", () => {
    const result = parseEmailLeadBody(sampleEmail);
    expect(result.serviceType).toBe("Standard Cleaning");
  });

  it("extracts frequency", () => {
    const result = parseEmailLeadBody(sampleEmail);
    expect(result.frequency).toBe("Bi-Weekly");
  });

  it("handles different number formats", () => {
    const body = "Phone: (703) 555-1234\nCleaning Type: Deep Clean 1.2\nBedrooms: 3\nBathrooms: 2";
    const result = parseEmailLeadBody(body);
    expect(result.phone).toBe("(703) 555-1234");
    expect(result.serviceType).toBe("Deep Cleaning");
    expect(result.bedrooms).toBe("3 Bedrooms");
    expect(result.bathrooms).toBe("2 Bathrooms");
  });

  it("returns nulls for missing fields", () => {
    const result = parseEmailLeadBody("No fields here");
    expect(result.phone).toBeNull();
    expect(result.bedrooms).toBeNull();
    expect(result.bathrooms).toBeNull();
  });
});

// ── verifyMailgunSignature ────────────────────────────────────────────────────

describe("verifyMailgunSignature", () => {
  it("accepts a valid signature", () => {
    const signingKey = "test-key-abc123";
    const timestamp = "1234567890";
    const token = "abc123token";
    const expectedSig = crypto
      .createHmac("sha256", signingKey)
      .update(timestamp + token)
      .digest("hex");
    expect(verifyMailgunSignature(timestamp, token, expectedSig, signingKey)).toBe(true);
  });

  it("rejects an invalid signature", () => {
    expect(verifyMailgunSignature("123", "tok", "badsig", "key")).toBe(false);
  });
});
