/**
 * phoneFormat.test.ts
 * Verifies phone number normalization handles every common browser autofill
 * and user-input format correctly.
 *
 * Two functions are tested:
 *  1. normalizePhone (server-side, routers.ts) — converts to E.164 (+1XXXXXXXXXX)
 *  2. formatPhoneWidget — mirrors the widget's formatPhone JS function
 *     (server/widgetEmbed.ts) which formats for display as XXX-XXX-XXXX
 */
import { describe, it, expect } from "vitest";
import { normalizePhone } from "./routers";

// ─── Mirror the widget's formatPhone logic for testing ───────────────────────
function formatPhoneWidget(raw: string): string {
  let digits = raw.replace(/\D/g, "");
  // Strip leading country code: 11 digits starting with 1 → remove the 1
  if (digits.length === 11 && digits.charAt(0) === "1") {
    digits = digits.slice(1);
  }
  digits = digits.slice(0, 10);
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
}

// ─── normalizePhone (server-side E.164) ──────────────────────────────────────
describe("normalizePhone (server-side E.164 output)", () => {
  const EXPECTED = "+14016888007";

  const cases: [string, string][] = [
    ["+1 401-688-8007",   "E.164 with space (Chrome/Safari autofill)"],
    ["+14016888007",      "E.164 compact"],
    ["14016888007",       "11-digit with leading 1"],
    ["4016888007",        "raw 10 digits"],
    ["(401) 688-8007",    "US parentheses format"],
    ["401.688.8007",      "dot-separated"],
    ["401-688-8007",      "dash-separated"],
    ["401 688 8007",      "space-separated"],
    ["+1 (401) 688-8007", "E.164 + parentheses"],
    ["1-401-688-8007",    "country code + dashes"],
    ["1 (401) 688-8007",  "country code + parentheses"],
    ["  401-688-8007  ",  "leading/trailing whitespace"],
  ];

  cases.forEach(([input, label]) => {
    it(`handles ${label}: "${input}"`, () => {
      expect(normalizePhone(input)).toBe(EXPECTED);
    });
  });
});

// ─── formatPhoneWidget (display format XXX-XXX-XXXX) ─────────────────────────
describe("formatPhoneWidget (widget display format)", () => {
  const EXPECTED = "401-688-8007";

  const cases: [string, string][] = [
    ["+1 401-688-8007",   "E.164 with space (Chrome/Safari autofill)"],
    ["+14016888007",      "E.164 compact"],
    ["14016888007",       "11-digit with leading 1"],
    ["4016888007",        "raw 10 digits"],
    ["(401) 688-8007",    "US parentheses format"],
    ["401.688.8007",      "dot-separated"],
    ["401-688-8007",      "already formatted"],
    ["401 688 8007",      "space-separated"],
    ["+1 (401) 688-8007", "E.164 + parentheses"],
    ["1-401-688-8007",    "country code + dashes"],
    ["1 (401) 688-8007",  "country code + parentheses"],
    ["  401-688-8007  ",  "leading/trailing whitespace"],
  ];

  cases.forEach(([input, label]) => {
    it(`handles ${label}: "${input}"`, () => {
      expect(formatPhoneWidget(input)).toBe(EXPECTED);
    });
  });

  // Edge cases
  it("returns partial digits for short input", () => {
    expect(formatPhoneWidget("401")).toBe("401");
    expect(formatPhoneWidget("4016")).toBe("401-6");
    expect(formatPhoneWidget("401688")).toBe("401-688");
  });

  it("truncates to 10 digits for overly long input", () => {
    // 12 digits (not starting with 1) — truncates to first 10
    expect(formatPhoneWidget("240168880070")).toBe("240-168-8800");
  });

  it("handles empty string gracefully", () => {
    expect(formatPhoneWidget("")).toBe("");
  });
});

// ─── Cross-check: normalizePhone then formatPhoneWidget round-trip ────────────
describe("round-trip: normalizePhone → formatPhoneWidget", () => {
  it("E.164 output from normalizePhone formats correctly in widget", () => {
    const e164 = normalizePhone("+1 401-688-8007");
    // E.164 "+14016888007" → strip non-digits → "14016888007" (11 digits, starts with 1) → "4016888007" → "401-688-8007"
    expect(formatPhoneWidget(e164)).toBe("401-688-8007");
  });
});
