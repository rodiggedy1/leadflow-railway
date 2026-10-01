import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./teamPayRouter.ts", import.meta.url), "utf8");
const legacyTableTokens = ["cleaner", "Jobs"].join("");
const legacySqlTokens = ["cleaner", "_jobs"].join("");
function block(from: string, to?: string): string {
  const start = source.indexOf(from);
  const end = to ? source.indexOf(to, start) : source.length;
  if (start < 0 || end < 0) throw new Error(`Unable to locate Team Pay block: ${from}`);
  return source.slice(start, end);
}

describe("LeadFlow-owned Team Pay eligibility", () => {
  it("does not reference the legacy operational table", () => {
    expect(source).not.toContain(legacyTableTokens);
    expect(source).not.toContain(legacySqlTokens);
    expect(source).toContain("from(leadflowJobs)");
    expect(source).toContain("leadflowJobPayrollAdjustments");
    expect(source).toContain("cleanerPortalJobPhotos");
  });

  it("uses one shared loader with uniform inactive-status exclusions", () => {
    const loader = block("async function loadItems", "function payroll");
    expect(loader).toContain('ne(leadflowJobs.bookingStatus, "cancelled")');
    expect(loader).toContain('ne(leadflowJobs.bookingStatus, "rescheduled")');
    for (const surface of ["getTeams", "getPayrollSummary", "getTeamDetail", "getIntegrityCheck"]) {
      expect(source.slice(source.indexOf(`${surface}: agentProcedure`))).toContain("loadItems(db");
    }
  });

  it("uses the LeadFlow job id for complaint mutations", () => {
    const complaint = block("setComplaint: agentProcedure", "getTeamDetail: agentProcedure");
    expect(complaint).toContain("eq(leadflowJobs.id, input.cleanerJobId)");
    expect(complaint).toContain("leadflowJobPayrollAdjustments.leadflowJobId");
    expect(complaint).not.toContain(legacyTableTokens);
    expect(complaint).not.toContain(legacySqlTokens);
  });
});
