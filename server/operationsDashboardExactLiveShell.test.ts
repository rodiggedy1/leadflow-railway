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
    expect(app).toContain('function AdminOperationsDashboardExactLiveRoute()');
    expect(app).toContain('<Route path={"/admin/dashboard"} component={AdminOperationsDashboardExactLiveRoute} />');
    expect(app).toContain('<div className="review-nav-host odr-original-host"><OriginalDashboardWorkspaceNav /><OperationsDashboardExactLive /></div>');
    expect(nav).toContain('label: "Dashboard", href: "/review/operations-dashboard", liveHref: "/admin/dashboard"');
    expect(originalNav).toContain('<strong>Workspaces</strong><small>Review only</small>');
    expect(originalNav).toContain('href: "/admin/command-chat"');
    expect(originalNav).toContain('href: "/admin/leads"');
    expect(originalNavCss).toContain('.odr-original-host .review-workspace-nav{position:sticky');
    expect(originalNavCss).toContain('.odr-original-host .review-workspace-nav.is-expanded{width:232px');
  });

  it("keeps the recovered dashboard composition while binding only live contracts", () => {
    const page = read("client/src/pages/OperationsDashboardExactLive.tsx");
    const css = read("client/src/pages/operations-dashboard-exact-live.css");
    const scheduleMap = read("client/src/components/LeadflowScheduleMap.tsx");
    for (const token of [
      'trpc.leadflowJobs.dashboardOverview.useQuery',
      'trpc.leadflowSchedule.getSchedule.useQuery',
      'trpc.hiring.getPipelineStats.useQuery',
      'trpc.opsChat.searchCustomers.useQuery',
      'Jobs in Progress',
      'Today’s Schedule',
      'Recent Activity',
      'Action Items',
      'Lead Sources',
      'Jobs by Service',
      'Add more services.',
      'LeadflowScheduleMap',
      'darkMode',
      'scheduleMapData',
      'odr-team-popover',
      'odr-donut',
      'dashboard-team-portrait_ee89ad11.jpg',
    ]) expect(page).toContain(token);
    for (const token of ['.odr-dashboard{min-height:100vh', '.odr-map:before,.odr-map:after{display:none}', '.odr-schedule-row', '.odr-donut', '.odr-growth']) expect(css).toContain(token);
    for (const token of ['MapView', 'DARK_MAP_STYLES', 'google.maps.Marker', 'fitBounds(bounds', 'darkMode = false']) expect(scheduleMap).toContain(token);
  });

  it("keeps the overview read-only and on LeadFlow-owned paths", () => {
    const router = read("server/leadflowJobsRouter.ts");
    const page = read("client/src/pages/OperationsDashboardExactLive.tsx");
    expect(router).toContain('dashboardOverview: agentProcedure');
    expect(router).toContain('from(leadflowJobs)');
    expect(router).toContain('cleanerPortalJobProgress');
    expect(router).toContain('jobGeoCache');
    expect(router).toContain('activityLog');
    expect(page).toContain('LeadflowScheduleMap');
  });
});
