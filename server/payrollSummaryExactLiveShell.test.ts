import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), "utf8");

describe("dark Payroll Summary navigation", () => {
  it("keeps the classic summary route and mounts the dark live summary at its own route", () => {
    const app = read("client/src/App.tsx");
    const shell = read("client/src/pages/PayrollSummaryExactLive.tsx");

    expect(app).toContain('const PayrollSummary = lazy(() => import("./pages/PayrollSummary"));');
    expect(app).toContain('const PayrollSummaryExactLive = lazy(() => import("./pages/PayrollSummaryExactLive"));');
    expect(app).toContain('function AdminPayrollSummaryExactLiveRoute()');
    expect(app).toContain('<ReviewWorkspaceFrame navActivePath="/review/payroll-summary"><PayrollSummaryExactLive /></ReviewWorkspaceFrame>');
    expect(app).toContain('<Route path={"/admin/payroll-summary"} component={PayrollSummary} />');
    expect(app).toContain('<Route path={"/admin/payroll-summary-live"} component={AdminPayrollSummaryExactLiveRoute} />');
    expect(shell).toContain('className="payroll-summary-review payroll-summary-exact-live"');
    expect(shell).toContain('trpc.teamPay.getPayrollSummary.useQuery({ weekStart })');
    expect(shell).toContain('trpc.teamPay.getTeamDetail.useMutation');
    expect(shell).toContain('trpc.teamPay.getIntegrityCheck.useMutation');
  });

  it("points both left-navigation variants to the dark summary route", () => {
    const reviewNav = read("client/src/components/ReviewWorkspaceNav.tsx");
    const dashboardNav = read("client/src/components/OriginalDashboardWorkspaceNav.tsx");

    expect(reviewNav).toContain('liveHref: "/admin/payroll-summary-live"');
    expect(dashboardNav).toContain('href: "/admin/payroll-summary-live"');
  });
});
