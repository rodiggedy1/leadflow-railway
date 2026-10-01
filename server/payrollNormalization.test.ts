import { describe, expect, it } from "vitest";
import { normalizePayrollPercent } from "./payrollNormalization";

describe("LeadFlow payroll percentage normalization", () => {
  it("treats stored fractions and whole percentages as the same payout rate", () => {
    expect(normalizePayrollPercent("0.45")).toBe(45);
    expect(normalizePayrollPercent(0.45)).toBe(45);
    expect(normalizePayrollPercent("45")).toBe(45);
    expect(normalizePayrollPercent(45)).toBe(45);
  });

  it("uses an explicit fallback for missing or invalid values", () => {
    expect(normalizePayrollPercent(null, 50)).toBe(50);
    expect(normalizePayrollPercent("not-a-number", 50)).toBe(50);
  });
});
