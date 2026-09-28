import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const page = fs.readFileSync(path.join(root, "client/src/pages/CleanerPortalConnected.tsx"), "utf8");
const router = fs.readFileSync(path.join(root, "server/cleanerPortalReadOnlyRouter.ts"), "utf8");

describe("Cleaner Portal daily team-payment total", () => {
  it("sums the existing adjusted per-job payout beside the assigned-job count", () => {
    expect(router).toContain("manualAdjustment: adjustmentCents / 100");
    expect(router).toContain("basePay: payroll.finalPay");
    expect(page).toContain("const dailyTeamPayment");
    expect(page).toContain("jobs.reduce((total, job) => total +");
    expect(page).toContain("job.basePay ?? 0");
    expect(page).toContain("formatMoney(dailyTeamPayment)");
    expect(page).toContain("Assigned jobs");
    expect(page).toContain("Today’s total");
  });
});
