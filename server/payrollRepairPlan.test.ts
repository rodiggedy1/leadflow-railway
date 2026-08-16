import { describe, expect, it } from "vitest";
import { PAYROLL_REPAIR_TARGETS, buildPayrollRepairPlan, type PayrollRepairSourceRow } from "./payrollRepairPlan";

const legacyRows: PayrollRepairSourceRow[] = PAYROLL_REPAIR_TARGETS.map(target => ({
  id: target.id,
  jobDate: target.jobDate,
  jobRevenue: target.jobRevenue,
  payPercent: target.payPercent,
  manualAdjustment: target.manualAdjustment,
  basePay: target.legacyBasePay,
  finalPay: null,
}));

describe("buildPayrollRepairPlan", () => {
  it("uses the new payroll calculation chain and emits the complete audit fields", () => {
    const plan = buildPayrollRepairPlan(legacyRows);
    expect(plan).toHaveLength(7);
    expect(plan[0]).toMatchObject({
      id: 5370014,
      jobRevenue: "140.00",
      operationalCost: "18.20",
      netJobAmount: "121.80",
      payPercent: "68.00",
      calculatedBasePay: "82.82",
      manualAdjustment: "0.00",
      calculatedFinalPay: "82.82",
      action: "update",
    });
    expect(plan[6].calculatedFinalPay).toBe("133.49");
  });

  it("fails closed when a reviewed calculation input changed", () => {
    const changed = legacyRows.map(row => ({ ...row }));
    changed[1].jobRevenue = "510";
    expect(() => buildPayrollRepairPlan(changed)).toThrow("Reviewed input changed");
  });

  it("skips an already-correct row and rejects a third unexpected payroll state", () => {
    const corrected = legacyRows.map(row => ({ ...row }));
    corrected[0].basePay = "82.82";
    corrected[0].finalPay = "82.82";
    expect(buildPayrollRepairPlan(corrected)[0].action).toBe("already-correct");

    const unexpected = legacyRows.map(row => ({ ...row }));
    unexpected[1].basePay = "200.00";
    expect(() => buildPayrollRepairPlan(unexpected)).toThrow("Unexpected payroll state");
  });
});
