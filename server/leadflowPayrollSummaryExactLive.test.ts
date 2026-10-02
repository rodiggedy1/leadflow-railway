import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const read = (relativePath: string) => readFileSync(resolve(root, relativePath), "utf8");
const prohibitedLegacySymbol = ["cleaner", "Jobs"].join("");
const prohibitedLegacyTable = ["cleaner", "jobs"].join("_");

describe("LeadFlow dark Payroll Summary", () => {
  it("uses only LeadFlow jobs, booking-assigned teams, payout profiles, and the adjustment ledger", () => {
    const router = read("server/leadflowJobsRouter.ts");
    const projection = router.slice(router.indexOf("async function leadflowPayrollProjection"), router.indexOf("const DAY_BOARD_STATUS_LABELS"));
    const summary = router.slice(router.indexOf("getPayrollSummary: agentProcedure"), router.indexOf("getPayrollPayoutSummary: agentProcedure"));

    for (const marker of [
      "getPayrollSummary: agentProcedure",
      "getPayrollTeamDetail: agentProcedure",
      "leadflowPayrollProjection",
      'source: "leadflow" as const',
    ]) expect(summary).toContain(marker);

    for (const marker of [
      "leadflowJobs.jobDate",
      "leadflowJobs.teamId",
      "cleanerProfiles.launch27TeamId",
      "leadflowJobPayrollAdjustments",
      "calculateEffectivePayroll",
      'ne(leadflowJobs.bookingStatus, "cancelled")',
      'ne(leadflowJobs.bookingStatus, "rescheduled")',
      'ne(leadflowJobs.bookingStatus, "missing_from_launch27")',
    ]) expect(projection).toContain(marker);

    expect(projection).not.toContain(prohibitedLegacySymbol);
    expect(projection).not.toContain(prohibitedLegacyTable);
  });

  it("keeps the dark page on the isolated source without changing the classic Payroll Summary", () => {
    const page = read("client/src/pages/PayrollSummaryExactLive.tsx");
    const classicPage = read("client/src/pages/PayrollSummary.tsx");

    for (const marker of [
      'data-payroll-source="leadflow"',
      "trpc.leadflowJobs.getPayrollSummary.useQuery({ weekStart })",
      "trpc.leadflowJobs.getPayrollTeamDetail.useQuery",
      "utils.leadflowJobs.getPayrollTeamDetail.fetch",
      "LEADFLOW ONLY",
      "Booking-assigned teams",
      "function leadflowWorkbookRows",
      "function leadflowWorkbookDetails",
      "leadflowWorkbookRows(rows)",
      "leadflowWorkbookDetails(teamDetails)",
    ]) expect(page).toContain(marker);

    expect(page).not.toContain("trpc.teamPay.");
    expect(classicPage).toContain("teamPay");
  });
});
