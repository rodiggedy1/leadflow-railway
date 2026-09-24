import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), "utf8");

describe("exact live Operations Dashboard", () => {
  it("mounts the dashboard at the live route and points Baseboard there", () => {
    const app = read("client/src/App.tsx");
    const nav = read("client/src/components/ReviewWorkspaceNav.tsx");
    const originalNav = read("client/src/components/OriginalDashboardWorkspaceNav.tsx");
    const originalNavCss = read("client/src/components/original-dashboard-workspace-nav.css");
    expect(app).toContain('const OperationsDashboardExactLive = lazy(() => import("./pages/OperationsDashboardExactLive"));');
    expect(app).toContain("function AdminOperationsDashboardExactLiveRoute()");
    expect(app).toContain('<Route path={"/admin/dashboard"} component={AdminOperationsDashboardExactLiveRoute} />');
    expect(app).toContain('<div className="review-nav-host odr-original-host"><OriginalDashboardWorkspaceNav /><OperationsDashboardExactLive /></div>');
    expect(nav).toContain('label: "Dashboard", href: "/review/operations-dashboard", liveHref: "/admin/dashboard"');
    expect(originalNav).toContain('<strong>Workspaces</strong><small>Review only</small>');
    expect(originalNav).toContain('href: "/admin/command-chat"');
    expect(originalNav).toContain('href: "/admin/leads"');
    expect(originalNavCss).toContain('.odr-original-host .review-workspace-nav{position:sticky');
    expect(originalNavCss).toContain('.odr-original-host .review-workspace-nav.is-expanded{width:232px');
  });

  it("replaces only the failed field map surface with the approved live Route Board", () => {
    const page = read("client/src/pages/OperationsDashboardExactLive.tsx");
    const css = read("client/src/pages/operations-dashboard-exact-live.css");
    for (const token of [
      "trpc.leadflowJobs.dashboardOverview.useQuery",
      "routeRows",
      "routeStatus",
      "Today’s Route Board",
      "Teams, next stops, and route load",
      "Selected route",
      "Open route",
      "Today’s Schedule",
      "Recent Activity",
      "Action Items",
      "Lead Sources",
      "Jobs by Service",
      "Add more services.",
    ]) expect(page).toContain(token);
    expect(page).not.toContain("LeadflowScheduleMap");
    expect(page).not.toContain("leadflowSchedule.getSchedule.useQuery");
    expect(page).not.toContain("Map display selector");
    for (const token of [".odr-route-board-card", ".odr-route-board-summary", ".odr-route-row", ".odr-route-focus", ".odr-route-board-legend"]) expect(css).toContain(token);
    expect(css).toContain("@media (min-width:721px) and (max-width:1600px)");
    expect(css).toContain("grid-template-columns:repeat(2,minmax(0,1fr))");
    expect(css).toContain(".odr-attention-rail{align-items:stretch}");
  });

  it("keeps the route board read-only and on LeadFlow-owned data paths", () => {
    const router = read("server/leadflowJobsRouter.ts");
    const page = read("client/src/pages/OperationsDashboardExactLive.tsx");
    const forbiddenTerms = ["cleaner" + "Jobs", "cleaner" + "_jobs"];
    expect(router).toContain("dashboardOverview: agentProcedure");
    expect(router).toContain("from(leadflowJobs)");
    expect(page).toContain("trpc.leadflowJobs.dashboardOverview.useQuery");
    for (const term of forbiddenTerms) expect(page).not.toContain(term);
  });
});
