import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), "utf8");

describe("Day Board exact live shell", () => {
  it("replaces the legacy outer frame with the approved review composition", () => {
    const app = read("client/src/App.tsx");
    const shell = read("client/src/pages/DayBoardExactLive.tsx");
    const reviewStyles = read("client/src/pages/day-board-crm-review.css");
    const liveStyles = read("client/src/pages/day-board-exact-live.css");

    expect(app).toContain('const DayBoardExactLive = lazy(() => import("./pages/DayBoardExactLive"));');
    expect(app).toContain("function AdminDayBoardExactLiveRoute()");
    expect(app).toContain('<ReviewWorkspaceFrame navActivePath="/review/day-board-crm"><DayBoardExactLive /></ReviewWorkspaceFrame>');
    expect(app).toContain('<Route path={"/admin/day-board"} component={AdminDayBoardExactLiveRoute} />');
    expect(app).toContain('const isDayBoardWorkspace = location === "/admin/day-board";');

    for (const marker of [
      'import "./day-board-crm-review.css"',
      'import "./day-board-crm-gridless.css"',
      'import "./day-board-leads-cohesion.css"',
      'import "./day-board-exact-live.css"',
      'className="operations-crm-review dbr-shell dbr-live-shell"',
      'className="dbr-page-tabs"',
      'className="dbr-toolbar"',
      'className="dbr-summary"',
      'className="dbr-board-scroll"',
      'className="dbr-timeline-card"',
      'className="dbr-removed"',
      'className="dbr-drawer dbr-live-drawer"',
    ]) expect(shell).toContain(marker);

    expect(shell).not.toContain('from "@/components/DayBoard"');
    expect(shell).not.toContain('from "@/pages/FieldManagement"');
    expect(reviewStyles).toContain(".dbr-board-scroll{min-height:0;flex:1;overflow:auto");
    expect(reviewStyles).toContain(".dbr-drawer-scroll{min-height:0;flex:1;overflow:auto");
    expect(liveStyles).toContain(".dbr-live-shell .dbr-job{background:#202224!important}");
  });

  it("retains Day Board reads, polling, local read state, and action payloads", () => {
    const shell = read("client/src/pages/DayBoardExactLive.tsx");

    for (const marker of [
      "trpc.fieldMgmt.getJobsForDay.useQuery({ date }",
      "staleTime: 30_000",
      "refetchInterval: 60_000",
      "trpc.fieldMgmt.getJobUnreadReplies.useQuery",
      "staleTime: 55_000",
      "trpc.fieldMgmt.getJobMessages.useQuery",
      "refetchInterval: tab === \"Messages\" ? 15_000 : false",
      "trpc.fieldMgmt.getJobCalls.useQuery",
      "trpc.fieldMgmt.sendJobSms.useMutation",
      "trpc.fieldMgmt.voiceAlertCleaner.useMutation",
      "trpc.fieldMgmt.confirmAssignment.useMutation",
      "sendSms.mutate({ cleanerJobId: job.id, to: phone, body: draft.trim() })",
      "voiceAlert.mutate({ cleanerJobId: job.id })",
      "confirmAssignment.mutate({ cleanerJobId: jobId })",
      'localStorage.getItem("dayboard_last_read")',
      'localStorage.setItem("dayboard_last_read"',
      "event.key === \"Escape\"",
      "proxyRecordingUrl(call.recordingUrl)",
    ]) expect(shell).toContain(marker);
  });
});
