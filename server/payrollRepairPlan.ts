import { calculateEffectivePayroll } from "./payrollCalculator";

export const PAYROLL_REPAIR_TARGETS = [
  { id: 5370014, jobDate: "2026-08-16", jobRevenue: "140", payPercent: "68", manualAdjustment: null, legacyBasePay: "95.20" },
  { id: 5370015, jobDate: "2026-08-16", jobRevenue: "495", payPercent: "56", manualAdjustment: null, legacyBasePay: "277.20" },
  { id: 5370016, jobDate: "2026-08-16", jobRevenue: "152.15", payPercent: "68", manualAdjustment: null, legacyBasePay: "103.46" },
  { id: 5370017, jobDate: "2026-08-16", jobRevenue: "255.6", payPercent: "56", manualAdjustment: null, legacyBasePay: "143.14" },
  { id: 5370018, jobDate: "2026-08-16", jobRevenue: "350", payPercent: "56", manualAdjustment: null, legacyBasePay: "196.00" },
  { id: 5370019, jobDate: "2026-08-16", jobRevenue: "149", payPercent: "68", manualAdjustment: null, legacyBasePay: "101.32" },
  { id: 5400001, jobDate: "2026-08-16", jobRevenue: "274", payPercent: "56", manualAdjustment: null, legacyBasePay: "153.44" },
] as const;

export type PayrollRepairSourceRow = {
  id: number;
  jobDate: string;
  jobRevenue: string | null;
  payPercent: string | null;
  manualAdjustment: string | null;
  basePay: string | null;
  finalPay: string | null;
};

export type PayrollRepairPlanItem = {
  id: number;
  jobDate: string;
  jobRevenue: string;
  operationalCost: string;
  netJobAmount: string;
  payPercent: string;
  calculatedBasePay: string;
  manualAdjustment: string;
  calculatedFinalPay: string;
  currentBasePay: string | null;
  currentFinalPay: string | null;
  action: "update" | "already-correct";
};

function toMoney(value: string | number | null | undefined): string | null {
  if (value == null) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`Expected monetary value, received ${String(value)}`);
  return parsed.toFixed(2);
}

function sameExpectedInput(
  row: PayrollRepairSourceRow,
  expected: (typeof PAYROLL_REPAIR_TARGETS)[number],
): boolean {
  return (
    row.jobDate === expected.jobDate &&
    toMoney(row.jobRevenue) === toMoney(expected.jobRevenue) &&
    toMoney(row.payPercent) === toMoney(expected.payPercent) &&
    row.manualAdjustment === expected.manualAdjustment
  );
}

/**
 * Builds the only permitted repair plan. It performs no database writes.
 * A stale row is accepted only when it still matches the reviewed source
 * inputs and legacy state. A previously corrected row is skipped.
 */
export function buildPayrollRepairPlan(rows: PayrollRepairSourceRow[]): PayrollRepairPlanItem[] {
  if (rows.length !== PAYROLL_REPAIR_TARGETS.length) {
    throw new Error(`Expected ${PAYROLL_REPAIR_TARGETS.length} rows; found ${rows.length}`);
  }

  const rowsById = new Map(rows.map(row => [row.id, row]));
  if (rowsById.size !== PAYROLL_REPAIR_TARGETS.length) {
    throw new Error("Duplicate cleaner_jobs IDs returned; refusing repair");
  }

  return PAYROLL_REPAIR_TARGETS.map(expected => {
    const row = rowsById.get(expected.id);
    if (!row) throw new Error(`Missing cleaner_jobs.id ${expected.id}`);
    if (!sameExpectedInput(row, expected)) {
      throw new Error(`Reviewed input changed for cleaner_jobs.id ${expected.id}; refusing repair`);
    }

    const calculated = calculateEffectivePayroll({
      jobDate: row.jobDate,
      jobRevenue: row.jobRevenue,
      payPercent: row.payPercent,
      manualAdjustment: row.manualAdjustment,
    });

    if (calculated.payrollMode !== "2026-08-16") {
      throw new Error(`New payroll mode was not selected for cleaner_jobs.id ${expected.id}; refusing repair`);
    }

    const calculatedBasePay = toMoney(calculated.basePay)!;
    const calculatedFinalPay = toMoney(calculated.finalPay)!;
    const currentBasePay = toMoney(row.basePay);
    const currentFinalPay = toMoney(row.finalPay);
    const alreadyCorrect =
      currentBasePay === calculatedBasePay && currentFinalPay === calculatedFinalPay;
    const expectedLegacyState =
      currentBasePay === toMoney(expected.legacyBasePay) && currentFinalPay === null;

    if (!alreadyCorrect && !expectedLegacyState) {
      throw new Error(`Unexpected payroll state for cleaner_jobs.id ${expected.id}; refusing repair`);
    }

    return {
      id: row.id,
      jobDate: row.jobDate,
      jobRevenue: toMoney(calculated.jobRevenue)!,
      operationalCost: toMoney(calculated.operationalCost)!,
      netJobAmount: toMoney(calculated.netJobAmount)!,
      payPercent: toMoney(calculated.payPercent)!,
      calculatedBasePay,
      manualAdjustment: toMoney(calculated.manualAdjustment)!,
      calculatedFinalPay,
      currentBasePay,
      currentFinalPay,
      action: alreadyCorrect ? "already-correct" : "update",
    };
  });
}
