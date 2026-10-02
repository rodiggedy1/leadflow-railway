import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("../client/src/pages/PayrollSummary.tsx", import.meta.url), "utf8");

describe("Payroll Summary team detail drawer", () => {
  it("uses the isolated legacy detail procedure for the drawer and exports", () => {
    expect(source).toContain("trpc.teamPay.getLegacyPayrollSummary.useQuery({ weekStart })");
    expect(source.match(/trpc\.teamPay\.getLegacyTeamDetail\.useMutation/g)).toHaveLength(3);
    expect(source).not.toMatch(/trpc\.teamPay\.(getPayrollSummary|getTeamDetail)\./);
    expect(source).toContain("loadTeamDetail({ teamName, weekStart })");
  });

  it("renders the approved new-period calculation chain and reconciliation state", () => {
    expect(source).toContain("Job Amount");
    expect(source).toContain("13% Ops");
    expect(source).toContain("Net Amount");
    expect(source).toContain("Manual Adj.");
    expect(source).toContain("Reconciles to Payroll Summary");
  });

  it("keeps the CSV control independent from row-click drawer navigation", () => {
    expect(source).toContain("e.stopPropagation()");
    expect(source).toContain("onClick={() => openTeamDetail(row.teamName)}");
    expect(source).toContain("onKeyDown={(event) => onTeamRowKeyDown(event, row.teamName)}");
  });
});
