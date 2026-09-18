import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), "utf8");

describe("Schedule CRM exact live shell", () => {
  it("replaces only the Schedule tab outer shell with the approved Schedule CRM composition", () => {
    const app = read("client/src/App.tsx");
    const shell = read("client/src/pages/ScheduleCRMExactLive.tsx");
    const styles = read("client/src/pages/schedule-crm-exact-live.css");

    expect(app).toContain('const ScheduleCRMExactLive = lazy(() => import("./pages/ScheduleCRMExactLive"));');
    expect(app).toContain("function AdminScheduleCRMExactRoute()");
    expect(app).toContain('<ReviewWorkspaceFrame navActivePath="/review/schedule-crm"><ScheduleCRMExactLive /></ReviewWorkspaceFrame>');
    expect(app).toContain('<Route path={"/admin/schedule"} component={AdminScheduleCRMExactRoute} />');
    expect(app).toContain('location === "/admin/schedule"');
    expect(shell).toContain('import "./schedule-crm-review.css"');
    expect(shell).toContain('className="ocr-shell scr-shell schedule-crm-exact-live"');
    expect(shell).toContain('className="scr-page-head"');
    expect(shell).toContain('className="scr-schedule-main"');
    expect(shell).toContain('className="scr-map-panel"');
    expect(shell).toContain('className="scr-client-drawer"');
    expect(styles).toContain('.schedule-crm-exact-live .scr-schedule-main');
    expect(styles).toContain('.schedule-crm-exact-live .scr-route-stack');
    expect(styles).toContain('flex-direction: column');
    expect(styles).toContain('flex: 0 0 auto');
    expect(styles).toContain('overflow-y: auto');
  });

  it("retains the existing live schedule reads, safe detail surfaces, and action contracts", () => {
    const shell = read("client/src/pages/ScheduleCRMExactLive.tsx");

    for (const marker of [
      "trpc.scheduling.getSchedule.useQuery({ date }",
      "trpc.scheduling.getJobLocks.useQuery({ date })",
      "trpc.scheduling.analyzeSchedule.useQuery({ date }",
      "trpc.calls.getDayIssues.useQuery({ jobDate: date }",
      "trpc.scheduling.suggestSlots.useQuery({ address: suggestAddress, date }",
      "trpc.scheduling.optimizeDay.useMutation",
      "trpc.scheduling.resetOptimization.useMutation",
      "trpc.scheduling.rerunDistances.useMutation",
      "trpc.scheduling.lockJob.useMutation",
      "trpc.scheduling.manualAssign.useMutation",
      "trpc.scheduling.upsertTeam.useMutation",
      "trpc.scheduling.archiveTeam.useMutation",
      "<CallLogPanel",
      "<IssueDialog",
      "<ScheduleMap",
      "useOpsStream({ onJobUpdate:",
    ]) expect(shell).toContain(marker);
  });

  it("keeps the edited client sources free of prohibited booking-data identifiers", () => {
    for (const relativePath of [
      "client/src/pages/ScheduleCRMExactLive.tsx",
      "client/src/pages/schedule-crm-exact-live.css",
      "client/src/components/ReviewWorkspaceNav.tsx",
      "client/src/App.tsx",
    ]) {
      const source = read(relativePath);
      expect(source).not.toMatch(/cleaner[_]?jobs/i);
    }
  });
});
