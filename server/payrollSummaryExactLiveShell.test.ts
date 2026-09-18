import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), "utf8");

describe("Payroll Summary exact live shell", () => {
  it("routes the live Payroll Summary through the approved review composition", () => {
    const app = read("client/src/App.tsx");
    const shell = read("client/src/pages/PayrollSummaryExactLive.tsx");

    expect(app).toContain("AdminPayrollSummaryExactReviewRoute");
    expect(app).toContain('<ReviewWorkspaceFrame navActivePath="/review/payroll-summary"><PayrollSummaryExactLive /></ReviewWorkspaceFrame>');
    expect(app).toContain('<Route path={"/admin/payroll-summary"} component={AdminPayrollSummaryExactReviewRoute} />');
    expect(app).not.toContain('<Route path={"/admin/payroll-summary"} component={PayrollSummary} />');
    expect(app).toContain('location === "/admin/payroll-summary"');
    expect(shell).toContain('import "./payroll-summary-review.css"');
    expect(shell).toContain('import "./payroll-summary-exact-live.css"');
    expect(shell).toContain('className="payroll-summary-review payroll-summary-exact-live"');
    expect(shell).toContain('className="psr-header"');
    expect(shell).toContain('className="psr-summary-shell"');
    expect(shell).toContain('className="psr-drawer psr-live-drawer"');
  });

  it("retains all existing live Payroll Summary reads, exports, integrity checks, and team-detail behavior", () => {
    const shell = read("client/src/pages/PayrollSummaryExactLive.tsx");

    expect(shell).toContain('trpc.teamPay.getPayrollSummary.useQuery({ weekStart })');
    expect(shell).toContain("trpc.teamPay.getTeamDetail.useMutation");
    expect(shell).toContain("trpc.teamPay.getIntegrityCheck.useMutation");
    expect(shell).toContain('loadTeamDetail({ teamName, weekStart })');
    expect(shell).toContain('rows.map((row) => loadWorkbookTeamDetail({ teamName: row.teamName, weekStart }))');
    expect(shell).toContain('downloadPayrollWorkbook({ rows, teamDetails, weekStart, weekEnd })');
    expect(shell).toContain('triggerCsvDownload(buildSummaryCsv(rows, weekStart, weekEnd)');
    expect(shell).toContain('downloadDetail({ teamName: team.teamName, weekStart })');
    expect(shell).toContain('onClick={() => runIntegrityCheck({ weekStart })}');
    expect(shell).toContain('onKeyDown={(event) => onTeamRowKeyDown(event, row.teamName)}');
    expect(shell).toContain('event.key === "Escape" && setDetailOpen(false)');
  });

});
