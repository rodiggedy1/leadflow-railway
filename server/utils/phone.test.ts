import { describe, it, expect } from "vitest";
import {
  extractUSDigits,
  isValidUSPhone,
  normalizePhone,
  normalizePhoneLegacy,
  formatPhoneDisplay,
  formatPhoneDashed,
  stripCountryCode,
} from "./phone";

// ─── extractUSDigits ──────────────────────────────────────────────────────────

describe("extractUSDigits", () => {
  it("extracts 10 digits from a plain 10-digit string", () => {
    expect(extractUSDigits("7035551234")).toBe("7035551234");
  });

  it("strips dashes and returns 10 digits", () => {
    expect(extractUSDigits("703-555-1234")).toBe("7035551234");
  });

  it("strips parentheses and spaces", () => {
    expect(extractUSDigits("(703) 555-1234")).toBe("7035551234");
  });

  it("strips dots", () => {
    expect(extractUSDigits("703.555.1234")).toBe("7035551234");
  });

  it("handles 11-digit string starting with 1", () => {
    expect(extractUSDigits("17035551234")).toBe("7035551234");
  });

  it("handles E.164 +1 prefix", () => {
    expect(extractUSDigits("+17035551234")).toBe("7035551234");
  });

  it("returns null for 9-digit string", () => {
    expect(extractUSDigits("703555123")).toBeNull();
  });

  it("returns null for 12-digit string", () => {
    expect(extractUSDigits("170355512345")).toBeNull();
  });

  it("returns null for non-US country code (+44)", () => {
    expect(extractUSDigits("+447911123456")).toBeNull();
  });

  it("returns null when NPA starts with 0", () => {
    expect(extractUSDigits("0235551234")).toBeNull();
  });

  it("returns null when NPA starts with 1", () => {
    expect(extractUSDigits("1235551234")).toBeNull();
  });

  it("returns null when NXX starts with 0", () => {
    expect(extractUSDigits("7030551234")).toBeNull();
  });

  it("returns null when NXX starts with 1", () => {
    expect(extractUSDigits("7031551234")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(extractUSDigits("")).toBeNull();
  });

  it("returns null for non-numeric string", () => {
    expect(extractUSDigits("not-a-phone")).toBeNull();
  });
});

// ─── isValidUSPhone ───────────────────────────────────────────────────────────

describe("isValidUSPhone", () => {
  it("returns true for valid 10-digit number", () => {
    expect(isValidUSPhone("7035551234")).toBe(true);
  });

  it("returns true for valid E.164 number", () => {
    expect(isValidUSPhone("+17035551234")).toBe(true);
  });

  it("returns false for non-US number", () => {
    expect(isValidUSPhone("+447911123456")).toBe(false);
  });

  it("returns false for invalid number", () => {
    expect(isValidUSPhone("123")).toBe(false);
  });
});

// ─── normalizePhone ───────────────────────────────────────────────────────────

describe("normalizePhone", () => {
  it("normalizes a 10-digit US number to E.164", () => {
    expect(normalizePhone("7035551234")).toBe("+17035551234");
  });

  it("normalizes a formatted number to E.164", () => {
    expect(normalizePhone("(703) 555-1234")).toBe("+17035551234");
    expect(normalizePhone("703-555-1234")).toBe("+17035551234");
    expect(normalizePhone("703.555.1234")).toBe("+17035551234");
  });

  it("passes through an already-normalized E.164 number", () => {
    expect(normalizePhone("+17035551234")).toBe("+17035551234");
  });

  it("normalizes 11-digit number with leading 1", () => {
    expect(normalizePhone("17035551234")).toBe("+17035551234");
  });

  it("returns null for non-US number", () => {
    expect(normalizePhone("+447911123456")).toBeNull();
  });

  it("returns null for invalid number", () => {
    expect(normalizePhone("123")).toBeNull();
  });

  it("returns null for null input", () => {
    expect(normalizePhone(null)).toBeNull();
  });

  it("returns null for undefined input", () => {
    expect(normalizePhone(undefined)).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(normalizePhone("")).toBeNull();
  });

  it("returns null when NPA starts with 0 (invalid NANP)", () => {
    expect(normalizePhone("0235551234")).toBeNull();
  });

  it("returns null when NXX starts with 1 (invalid NANP)", () => {
    expect(normalizePhone("7031551234")).toBeNull();
  });
});

// ─── normalizePhoneLegacy ─────────────────────────────────────────────────────

describe("normalizePhoneLegacy", () => {
  it("normalizes valid US numbers identically to normalizePhone", () => {
    expect(normalizePhoneLegacy("7035551234")).toBe("+17035551234");
    expect(normalizePhoneLegacy("(703) 555-1234")).toBe("+17035551234");
    expect(normalizePhoneLegacy("+17035551234")).toBe("+17035551234");
  });

  it("passes through non-US E.164 numbers (legacy fallback)", () => {
    expect(normalizePhoneLegacy("+447911123456")).toBe("+447911123456");
  });

  it("prepends + to digit-only non-US numbers (legacy fallback)", () => {
    expect(normalizePhoneLegacy("447911123456")).toBe("+447911123456");
  });
});

// ─── formatPhoneDisplay ───────────────────────────────────────────────────────

describe("formatPhoneDisplay", () => {
  it("formats E.164 to (NPA) NXX-XXXX", () => {
    expect(formatPhoneDisplay("+17035551234")).toBe("(703) 555-1234");
  });

  it("formats 10-digit to (NPA) NXX-XXXX", () => {
    expect(formatPhoneDisplay("7035551234")).toBe("(703) 555-1234");
  });

  it("returns non-US number as-is", () => {
    expect(formatPhoneDisplay("+447911123456")).toBe("+447911123456");
  });

  it("returns empty string for null", () => {
    expect(formatPhoneDisplay(null)).toBe("");
  });

  it("returns empty string for undefined", () => {
    expect(formatPhoneDisplay(undefined)).toBe("");
  });
});

// ─── formatPhoneDashed ────────────────────────────────────────────────────────

describe("formatPhoneDashed", () => {
  it("formats E.164 to NPA-NXX-XXXX", () => {
    expect(formatPhoneDashed("+17035551234")).toBe("703-555-1234");
  });

  it("formats 10-digit to NPA-NXX-XXXX", () => {
    expect(formatPhoneDashed("7035551234")).toBe("703-555-1234");
  });

  it("returns non-US number as-is", () => {
    expect(formatPhoneDashed("+447911123456")).toBe("+447911123456");
  });

  it("returns empty string for null", () => {
    expect(formatPhoneDashed(null)).toBe("");
  });
});

// ─── stripCountryCode ─────────────────────────────────────────────────────────

describe("stripCountryCode", () => {
  it("strips +1 from E.164 number", () => {
    expect(stripCountryCode("+17035551234")).toBe("7035551234");
  });

  it("returns 10-digit number unchanged", () => {
    expect(stripCountryCode("7035551234")).toBe("7035551234");
  });

  it("returns non-US number as-is", () => {
    expect(stripCountryCode("+447911123456")).toBe("+447911123456");
  });

  it("returns empty string for null", () => {
    expect(stripCountryCode(null)).toBe("");
  });
});
