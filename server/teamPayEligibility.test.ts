/**
 * Regression contract for payroll job eligibility.
 *
 * Payroll has four independent queries. All must exclude exactly the same
 * inactive booking statuses, so a rescheduled job cannot reappear in one
 * payroll surface while remaining hidden from the cleaner portal.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./teamPayRouter.ts", import.meta.url), "utf8");

function block(from: string, to: string): string {
  const start = source.indexOf(from);
  const end = source.indexOf(to, start);
  if (start < 0 || end < 0) throw new Error(`Unable to locate payroll query block: ${from}`);
  return source.slice(start, end);
}

function excludedBookingStatuses(queryBlock: string): string[] {
  return Array.from(
    queryBlock.matchAll(/ne\(cleanerJobs\.bookingStatus, "([^"]+)"\)/g),
    (match) => match[1],
  );
}

const payrollSurfaces = {
  "Team Pay dashboard": block("getTeams: agentProcedure", "getPayrollSummary: agentProcedure"),
  "Payroll Summary": block("getPayrollSummary: agentProcedure", "setComplaint: agentProcedure"),
  "Payroll detail drawer and CSV": block("getTeamDetail: agentProcedure", "getIntegrityCheck: agentProcedure"),
  "Payroll integrity check": source.slice(source.indexOf("getIntegrityCheck: agentProcedure")),
};

describe("payroll booking-status eligibility", () => {
  it.each(Object.entries(payrollSurfaces))(
    "%s includes assigned jobs and excludes cancelled and rescheduled jobs",
    (_surface, queryBlock) => {
      const exclusions = excludedBookingStatuses(queryBlock);

      expect(exclusions).not.toContain("assigned");
      expect(exclusions).toContain("cancelled");
      expect(exclusions).toContain("rescheduled");
    },
  );

  it("uses the same eligibility exclusions across all four payroll surfaces", () => {
    const statusSets = Object.values(payrollSurfaces).map((queryBlock) => excludedBookingStatuses(queryBlock));

    expect(statusSets).toEqual([
      ["cancelled", "rescheduled"],
      ["cancelled", "rescheduled"],
      ["cancelled", "rescheduled"],
      ["cancelled", "rescheduled"],
    ]);
  });
});
