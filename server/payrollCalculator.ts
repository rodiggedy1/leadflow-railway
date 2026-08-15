/**
 * Single authoritative payroll calculation contract.
 *
 * Sources are deliberately unchanged:
 * - jobRevenue: existing Launch27 booking total snapshot
 * - payPercent: existing job-level team payout snapshot
 * - manualAdjustment: existing signed dollar adjustment
 */

export const NEW_PAYROLL_EFFECTIVE_DATE = "2026-08-16";
export const OPERATIONAL_COST_RATE = 0.13;

export type PayrollMode = "legacy" | "2026-08-16";

export type EffectivePayrollInput = {
  jobDate: string;
  jobRevenue: string | number | null | undefined;
  payPercent: string | number | null | undefined;
  manualAdjustment?: string | number | null | undefined;
  legacyBasePay?: string | number | null | undefined;
  legacyRatingAdjustment?: string | number | null | undefined;
  legacyPhotoAdjustment?: string | number | null | undefined;
  legacyStreakBonus?: string | number | null | undefined;
  legacyRecleanPenalty?: string | number | null | undefined;
  legacyGoogleReviewBonus?: string | number | null | undefined;
  legacyComplaintCharge?: string | number | null | undefined;
};

export type EffectivePayroll = {
  payrollMode: PayrollMode;
  jobRevenue: number;
  operationalCost: number;
  netJobAmount: number;
  payPercent: number;
  basePay: number;
  manualAdjustment: number;
  finalPay: number;
};

export type CleanerJobPayrollFields = {
  jobDate: string;
  jobRevenue: string | number | null;
  payPercent: string | number | null;
  basePay: string | number | null;
  ratingAdjustment: string | number | null;
  photoAdjustment: string | number | null;
  streakBonus: string | number | null;
  manualAdjustment: string | number | null;
  recleanPenalty: string | number | null;
  googleReviewBonus?: string | number | null;
  complaintChargeApplied?: number | null;
};

function asMoney(value: string | number | null | undefined): number {
  const parsed = typeof value === "number" ? value : Number.parseFloat(value ?? "0");
  return Number.isFinite(parsed) ? parsed : 0;
}

export function roundCents(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function isNewPayrollPeriod(jobDate: string): boolean {
  return jobDate >= NEW_PAYROLL_EFFECTIVE_DATE;
}

/**
 * Returns an auditable effective pay result.
 *
 * New-period math is intentionally limited to the approved chain:
 * revenue − 13% operations cost → net amount × existing pay percentage → base;
 * final is base plus the existing signed manual adjustment.
 *
 * Legacy jobs retain their existing additive calculation exactly.
 */
export function calculateEffectivePayroll(input: EffectivePayrollInput): EffectivePayroll {
  const jobRevenue = asMoney(input.jobRevenue);
  const payPercent = asMoney(input.payPercent);
  const manualAdjustment = asMoney(input.manualAdjustment);

  if (isNewPayrollPeriod(input.jobDate)) {
    const operationalCost = roundCents(jobRevenue * OPERATIONAL_COST_RATE);
    const netJobAmount = roundCents(jobRevenue - operationalCost);
    const basePay = roundCents(netJobAmount * (payPercent / 100));
    return {
      payrollMode: "2026-08-16",
      jobRevenue,
      operationalCost,
      netJobAmount,
      payPercent,
      basePay,
      manualAdjustment,
      finalPay: roundCents(basePay + manualAdjustment),
    };
  }

  const basePay = asMoney(input.legacyBasePay);
  const finalPay = roundCents(
    basePay +
      asMoney(input.legacyRatingAdjustment) +
      asMoney(input.legacyPhotoAdjustment) +
      asMoney(input.legacyStreakBonus) +
      manualAdjustment +
      asMoney(input.legacyRecleanPenalty) +
      asMoney(input.legacyGoogleReviewBonus) +
      asMoney(input.legacyComplaintCharge),
  );

  return {
    payrollMode: "legacy",
    jobRevenue,
    operationalCost: 0,
    netJobAmount: jobRevenue,
    payPercent,
    basePay,
    manualAdjustment,
    finalPay,
  };
}

/** Maps the existing cleaner_jobs snapshot directly into the shared calculator. */
export function calculateCleanerJobPayroll(
  job: CleanerJobPayrollFields,
  overrides: Partial<CleanerJobPayrollFields> = {},
): EffectivePayroll {
  const values = { ...job, ...overrides };
  return calculateEffectivePayroll({
    jobDate: values.jobDate,
    jobRevenue: values.jobRevenue,
    payPercent: values.payPercent,
    manualAdjustment: values.manualAdjustment,
    legacyBasePay: values.basePay,
    legacyRatingAdjustment: values.ratingAdjustment,
    legacyPhotoAdjustment: values.photoAdjustment,
    legacyStreakBonus: values.streakBonus,
    legacyRecleanPenalty: values.recleanPenalty,
    legacyGoogleReviewBonus: values.googleReviewBonus,
    legacyComplaintCharge: values.complaintChargeApplied === 1 ? -20 : 0,
  });
}
