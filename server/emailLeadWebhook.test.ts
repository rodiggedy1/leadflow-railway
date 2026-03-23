/**
 * Tests for the email lead webhook (emailLeadWebhook.ts)
 * Covers: stripNumericSuffix, parseBedroomCount, parseBathroomCount,
 *         parseCleaningType, parseEmailLeadBody (with email field),
 *         detectEmailType, parseCallNotificationBody,
 *         verifyZapierSecret, verifyMailgunSignature
 */
import { describe, it, expect } from "vitest";
import {
  stripNumericSuffix,
  parseBedroomCount,
  parseBathroomCount,
  parseCleaningType,
  parseEmailLeadBody,
  detectEmailType,
  parseCallNotificationBody,
  verifyZapierSecret,
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
    expect(parseBathroomCount("Five 150")).toBe("5 Bathrooms");
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

// ── parseEmailLeadBody (form submission) ──────────────────────────────────────

describe("parseEmailLeadBody", () => {
  const sampleEmail = `Email: rohan@innclusive.com\nPhone: +1 302 981 6191\nCleaning Type: BiWeekly 0.85\nBedrooms: One 149\nBathrooms: Five 150`;

  it("extracts email address", () => {
    const result = parseEmailLeadBody(sampleEmail);
    expect(result.email).toBe("rohan@innclusive.com");
  });

  it("extracts phone number (raw, not normalized)", () => {
    const result = parseEmailLeadBody(sampleEmail);
    expect(result.phone).toBe("+1 302 981 6191");
  });

  it("extracts bedrooms", () => {
    const result = parseEmailLeadBody(sampleEmail);
    expect(result.bedrooms).toBe("1 Bedroom");
  });

  it("extracts bathrooms", () => {
    const result = parseEmailLeadBody(sampleEmail);
    expect(result.bathrooms).toBe("5 Bathrooms");
  });

  it("extracts serviceType", () => {
    const result = parseEmailLeadBody(sampleEmail);
    expect(result.serviceType).toBe("Standard Cleaning");
  });

  it("extracts frequency", () => {
    const result = parseEmailLeadBody(sampleEmail);
    expect(result.frequency).toBe("Bi-Weekly");
  });

  it("handles email without Email field (legacy format)", () => {
    const body = `Phone: +1 202 365 6619\nCleaning Type: BiWeekly 0.85\nBedrooms: Two 179\nBathrooms: One 30`;
    const result = parseEmailLeadBody(body);
    expect(result.email).toBeNull();
    expect(result.phone).toBe("+1 202 365 6619");
    expect(result.bedrooms).toBe("2 Bedrooms");
    expect(result.bathrooms).toBe("1 Bathroom");
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
    expect(result.email).toBeNull();
    expect(result.bedrooms).toBeNull();
    expect(result.bathrooms).toBeNull();
  });
});

// ── detectEmailType ───────────────────────────────────────────────────────────

describe("detectEmailType", () => {
  it("detects form submission from body content", () => {
    const body = `Email: rohan@innclusive.com\nPhone: +1 302 981 6191\nCleaning Type: BiWeekly 0.85\nBedrooms: One 149\nBathrooms: Five 150`;
    expect(detectEmailType(body)).toBe("form_submission");
  });

  it("detects form submission without email field", () => {
    const body = `Phone: +1 202 365 6619\nCleaning Type: BiWeekly 0.85\nBedrooms: Two 179\nBathrooms: One 30`;
    expect(detectEmailType(body)).toBe("form_submission");
  });

  it("detects phone call notification from body", () => {
    const body = `Hi,\nYou received a call from:\n(858) 776-5144\nat\n2026-03-21 09:57 AM -04:00`;
    expect(detectEmailType(body)).toBe("phone_call");
  });

  it("detects phone call from subject line (missed call)", () => {
    expect(detectEmailType("some body", "Missed call from 555-1234")).toBe("phone_call");
  });

  it("returns unknown for unrecognised emails", () => {
    expect(detectEmailType("Hello, this is a random email with no structure.")).toBe("unknown");
  });

  it("is case-insensitive", () => {
    const body = `YOU RECEIVED A CALL FROM:\n(858) 776-5144`;
    expect(detectEmailType(body)).toBe("phone_call");
  });
});

// ── parseCallNotificationBody ─────────────────────────────────────────────────

describe("parseCallNotificationBody", () => {
  it("parses standard Google Voice/Fi call notification", () => {
    const body = `Hi,\nYou received a call from:\n(858) 776-5144\nat\n2026-03-21 09:57 AM -04:00`;
    const result = parseCallNotificationBody(body);
    expect(result.phone).toBe("(858) 776-5144");
    expect(result.callTime).toBe("2026-03-21 09:57 AM -04:00");
  });

  it("parses call with E.164 phone number", () => {
    const body = `Hi,\nYou received a call from:\n+18587765144\nat\n2026-03-21 10:00 AM -04:00`;
    const result = parseCallNotificationBody(body);
    expect(result.phone).toBe("+18587765144");
  });

  it("handles missing timestamp gracefully", () => {
    const body = `Hi,\nYou received a call from:\n(858) 776-5144`;
    const result = parseCallNotificationBody(body);
    expect(result.phone).toBe("(858) 776-5144");
    expect(result.callTime).toBeNull();
  });

  it("returns null phone for unrecognised format", () => {
    const result = parseCallNotificationBody("Hello, this is a random email.");
    expect(result.phone).toBeNull();
    expect(result.callTime).toBeNull();
  });
});

// ── verifyZapierSecret ────────────────────────────────────────────────────────

describe("verifyZapierSecret", () => {
  it("accepts correct secret", () => {
    expect(verifyZapierSecret("my-secret-token", "my-secret-token")).toBe(true);
  });

  it("rejects wrong secret", () => {
    expect(verifyZapierSecret("wrong-token", "my-secret-token")).toBe(false);
  });

  it("rejects missing header when secret is configured", () => {
    expect(verifyZapierSecret(undefined, "my-secret-token")).toBe(false);
  });

  it("allows all requests when no secret is configured (dev mode)", () => {
    expect(verifyZapierSecret(undefined, "")).toBe(true);
    expect(verifyZapierSecret("anything", "")).toBe(true);
  });
});

// ── verifyMailgunSignature (legacy) ───────────────────────────────────────────

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
