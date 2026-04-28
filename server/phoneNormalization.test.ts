/**
 * Phone normalization regression tests.
 *
 * These tests guard against the bug where sessions stored with non-E.164 phones
 * (e.g. "703-727-5500") were silently dropped by the webhook because the lookup
 * used an exact match on the E.164 form (+17037275500).
 *
 * Three layers of protection are tested:
 *   1. normalizeLeadPhone() — the db.ts guard that normalizes before every insert
 *   2. normalizePhone() — the routers.ts helper used at session creation call sites
 *   3. Webhook digit-only fallback — the REGEXP_REPLACE match in webhooks.ts
 */

import { describe, it, expect } from "vitest";
import { normalizeLeadPhone } from "./db";
import { normalizePhone, extractUSDigits } from "./routers";

// ── Layer 1: db.ts insertSession guard ───────────────────────────────────────

describe("normalizeLeadPhone (db.ts insert guard)", () => {
  it("normalizes dashes format", () => {
    expect(normalizeLeadPhone("703-727-5500")).toBe("+17037275500");
  });

  it("normalizes parentheses format", () => {
    expect(normalizeLeadPhone("(703) 727-5500")).toBe("+17037275500");
  });

  it("normalizes 10-digit bare string", () => {
    expect(normalizeLeadPhone("7037275500")).toBe("+17037275500");
  });

  it("normalizes 11-digit with leading 1", () => {
    expect(normalizeLeadPhone("17037275500")).toBe("+17037275500");
  });

  it("passes through already-E.164 phone unchanged", () => {
    expect(normalizeLeadPhone("+17037275500")).toBe("+17037275500");
  });

  it("passes through thumbtack placeholder unchanged", () => {
    expect(normalizeLeadPhone("thumbtack-sms-1234567890")).toBe("thumbtack-sms-1234567890");
  });

  it("passes through bark placeholder unchanged", () => {
    expect(normalizeLeadPhone("bark-sms-1234567890")).toBe("bark-sms-1234567890");
  });

  it("passes through yelp placeholder unchanged", () => {
    expect(normalizeLeadPhone("yelp-jessica-l-backfill")).toBe("yelp-jessica-l-backfill");
  });
});

// ── Layer 2: routers.ts normalizePhone (call-site guard) ─────────────────────

describe("normalizePhone (routers.ts call-site guard)", () => {
  const cases: [string, string][] = [
    ["703-727-5500",    "+17037275500"],
    ["(703) 727-5500",  "+17037275500"],
    ["7037275500",      "+17037275500"],
    ["17037275500",     "+17037275500"],
    ["+17037275500",    "+17037275500"],
    ["240-687-9738",    "+12406879738"],
    ["(863) 510-8836",  "+18635108836"],
    ["562-334-7515",    "+15623347515"],
  ];

  it.each(cases)("normalizePhone(%s) === %s", (input, expected) => {
    expect(normalizePhone(input)).toBe(expected);
  });
});

// ── Layer 3: Webhook digit-only fallback match ────────────────────────────────
//
// The webhook receives E.164 from OpenPhone (+17037275500) and must match
// sessions stored in any format. The SQL uses REGEXP_REPLACE to strip non-digits
// and match the last 10 digits. We test the JS equivalent here.

function webhookDigitMatch(storedPhone: string, incomingE164: string): boolean {
  const incomingDigits = incomingE164.replace(/[^\d]/g, "").slice(-10);
  const storedDigits   = storedPhone.replace(/[^\d]/g, "").slice(-10);
  return storedDigits === incomingDigits;
}

describe("webhook digit-only fallback match", () => {
  it("matches dashes format against E.164", () => {
    expect(webhookDigitMatch("703-727-5500", "+17037275500")).toBe(true);
  });

  it("matches parentheses format against E.164", () => {
    expect(webhookDigitMatch("(703) 727-5500", "+17037275500")).toBe(true);
  });

  it("matches bare 10-digit against E.164", () => {
    expect(webhookDigitMatch("7037275500", "+17037275500")).toBe(true);
  });

  it("matches E.164 against E.164 (already normalized)", () => {
    expect(webhookDigitMatch("+17037275500", "+17037275500")).toBe(true);
  });

  it("does NOT match a different number", () => {
    expect(webhookDigitMatch("703-727-5500", "+12406879738")).toBe(false);
  });

  it("Donnie W: stored '703-727-5500' matches incoming '+17037275500'", () => {
    // This is the exact scenario that caused the bug
    expect(webhookDigitMatch("703-727-5500", "+17037275500")).toBe(true);
  });

  it("Phil a: stored '240-687-9738' matches incoming '+12406879738'", () => {
    expect(webhookDigitMatch("240-687-9738", "+12406879738")).toBe(true);
  });
});
