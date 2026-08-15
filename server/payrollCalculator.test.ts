import { describe, expect, it } from "vitest";
import {
  NEW_PAYROLL_EFFECTIVE_DATE,
  calculateEffectivePayroll,
  isNewPayrollPeriod,
} from "./payrollCalculator";

describe("effective-dated payroll calculator", () => {
  it("keeps August 15 jobs in legacy additive payroll mode", () => {
    const result = calculateEffectivePayroll({
      jobDate: "2026-08-15",
      jobRevenue: "200",
      payPercent: "55",
      legacyBasePay: "110",
      legacyRatingAdjustment: "10",
      legacyPhotoAdjustment: "5",
      legacyStreakBonus: "50",
      legacyRecleanPenalty: "-30",
      manualAdjustment: "-10",
    });

    expect(result.payrollMode).toBe("legacy");
    expect(result.basePay).toBe(110);
    expect(result.operationalCost).toBe(0);
    expect(result.finalPay).toBe(135);
  });

  it("uses the approved August 16 operational-cost chain and cents sequence", () => {
    const result = calculateEffectivePayroll({
      jobDate: NEW_PAYROLL_EFFECTIVE_DATE,
      jobRevenue: "200.00",
      payPercent: "55",
      manualAdjustment: "-10.00",
      legacyRatingAdjustment: "10",
      legacyPhotoAdjustment: "5",
      legacyStreakBonus: "50",
      legacyRecleanPenalty: "-30",
    });

    expect(result).toMatchObject({
      payrollMode: "2026-08-16",
      operationalCost: 26,
      netJobAmount: 174,
      basePay: 95.7,
      finalPay: 85.7,
    });
  });

  it("allows a manual payment for a zero-revenue new-period job", () => {
    const result = calculateEffectivePayroll({
      jobDate: "2026-08-16",
      jobRevenue: "0",
      payPercent: "55",
      manualAdjustment: "25",
    });

    expect(result).toMatchObject({
      operationalCost: 0,
      netJobAmount: 0,
      basePay: 0,
      finalPay: 25,
    });
  });

  it("uses jobDate, not today or a later adjustment timestamp, as the boundary", () => {
    expect(isNewPayrollPeriod("2026-08-15")).toBe(false);
    expect(isNewPayrollPeriod("2026-08-16")).toBe(true);
  });
});
