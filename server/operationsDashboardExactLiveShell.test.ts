import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");

describe("Operations Dashboard exact-live shell", () => {
  it("uses the all-agent read-only overview from LeadFlow-owned data", () => {
    const router = read("server/leadflowJobsRouter.ts");
    const page = read("client/src/pages/OperationsDashboardExactLive.tsx");
    const legacySymbol = ["cleaner", "Jobs"].join("");
    const legacyTable = ["cleaner", "_jobs"].join("");

    const dashboardBlock = router.slice(router.indexOf("dashboardOverview:"), router.indexOf("dayBoard:"));
    expect(dashboardBlock).toContain("agentProcedure");
    expect(dashboardBlock).toContain("leadflowJobs");
    expect(dashboardBlock).toContain("jobGeoCache");
    expect(dashboardBlock).toContain("activityLog");
    expect(dashboardBlock).not.toContain(".mutation(");
    expect(dashboardBlock).not.toContain(legacySymbol);
    expect(dashboardBlock).not.toContain(legacyTable);

    expect(page).toContain("trpc.leadflowJobs.dashboardOverview.useQuery");
    expect(page).toContain("/admin/day-board");
    expect(page).toContain("/admin/schedule");
    expect(page).toContain("/admin/leads");
    expect(page).toContain("/admin/hiring");
    expect(page).toContain("/admin/quality");
  });

  it("wires the new all-agent dashboard route and Baseboard destination", () => {
    const app = read("client/src/App.tsx");
    const nav = read("client/src/components/ReviewWorkspaceNav.tsx");
    expect(app).toContain('path={"/admin/dashboard"}');
    expect(nav).toContain('liveHref: "/admin/dashboard"');
  });
});
