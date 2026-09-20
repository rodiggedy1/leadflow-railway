import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), "utf8");

describe("Day Board exact live shell", () => {
  it("keeps the approved Day Board composition inside the original shared workspace navigation", () => {
    const app = read("client/src/App.tsx");
    const shell = read("client/src/pages/DayBoardExactLive.tsx");
    const reviewStyles = read("client/src/pages/day-board-crm-review.css");
    const liveStyles = read("client/src/pages/day-board-exact-live.css");

    expect(app).toContain('const DayBoardExactLive = lazy(() => import("./pages/DayBoardExactLive"));');
    expect(app).toContain("function AdminDayBoardExactLiveRoute()");
    expect(app).toContain('<AdminPageGuard pageId="field-management"><ReviewWorkspaceFrame navActivePath="/review/day-board-crm"><DayBoardExactLive /></ReviewWorkspaceFrame></AdminPageGuard>');
    expect(app).toContain('<Route path={"/admin/day-board"} component={AdminDayBoardExactLiveRoute} />');
    expect(app).toContain("function isDayBoardExactLiveRoute(location: string)");
    expect(app).toContain("<DayBoardSafeGlobalOpsChat />");
    expect(app).toContain("<DayBoardSafePollingInstrumentation />");
    expect(app).toContain("<DayBoardSafeRuntimeWatchers />");
    expect(app).toContain('import ReviewWorkspaceNav from "./components/ReviewWorkspaceNav";');

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
    expect(shell).toContain("data-status={status}");
    expect(reviewStyles).toContain(".dbr-board-scroll{min-height:0;flex:1;overflow:auto");
    expect(reviewStyles).toContain(".dbr-drawer-scroll{min-height:0;flex:1;overflow:auto");
    expect(liveStyles).toContain(".dbr-live-shell .dbr-job{background:#202224!important}");
    expect(liveStyles).toContain('.dbr-job[data-status="completed"]{background:#1a392a!important}');
    expect(liveStyles).toContain('.dbr-job[data-status="on_the_way"]{background:linear-gradient');
    expect(liveStyles).toContain('.dbr-job[data-status="arrived"]{background:linear-gradient');
    expect(liveStyles).toContain('.dbr-job[data-status="in_progress"]{background:linear-gradient');
  });

  it("uses the owned Day Board projection, polling, local read state, and explicit customer messaging", () => {
    const shell = read("client/src/pages/DayBoardExactLive.tsx");

    for (const marker of [
      "trpc.leadflowJobs.dayBoard.useQuery({ date }",
      "staleTime: 30_000",
      "refetchInterval: 60_000",
      "trpc.leadflowJobs.dayBoardUnreadReplies.useQuery",
      "staleTime: 55_000",
      "trpc.leadflowJobs.dayBoardMessages.useQuery",
      "refetchInterval: tab === \"Messages\" ? 15_000 : false",
      "trpc.leadflowJobs.sendDayBoardMessage.useMutation",
      "sendSms.mutate({ leadflowJobId: job.id, body: draft.trim() })",
      'localStorage.getItem("dayboard_last_read")',
      'localStorage.setItem("dayboard_last_read"',
      "event.key === \"Escape\"",
    ]) expect(shell).toContain(marker);
  });

  it("stacks only visually overlapping jobs within their existing team lane", () => {
    const shell = read("client/src/pages/DayBoardExactLive.tsx");

    for (const marker of [
      "function allocateOverlapRows(jobs: LiveJob[])",
      "rowEndMinutes.findIndex(rowEnd => rowEnd <= visibleStart)",
      "start + estimateDuration(job)",
      "DAY_BOARD_OVERLAP_ROW_HEIGHT",
      "const placedJobs = allocateOverlapRows(teamJobs)",
      "const laneHeight = DAY_BOARD_LANE_BASE_HEIGHT + (overlapRows - 1) * DAY_BOARD_OVERLAP_ROW_HEIGHT",
      'style={{ minHeight: `${laneHeight}px` }}',
      "overlapRow={overlapRow}",
      'top: `${DAY_BOARD_JOB_TOP + overlapRow * DAY_BOARD_OVERLAP_ROW_HEIGHT}px`',
      'bottom: "auto"',
      'height: `${DAY_BOARD_JOB_HEIGHT}px`',
    ]) expect(shell).toContain(marker);

    expect(shell).toContain("return firstStart - secondStart || first.id - second.id;");
  });

  it("keeps the complete customer name on each timeline job card", () => {
    const shell = read("client/src/pages/DayBoardExactLive.tsx");

    expect(shell).toContain("<Icon size={11} />{job.customerName ?? \"Client\"}</span>");
    expect(shell).not.toContain('(job.customerName ?? "Client").split(" ")[0]');
  });

  it("shows the scheduled time before the address within the fixed job-card detail row", () => {
    const shell = read("client/src/pages/DayBoardExactLive.tsx");
    const gridlessStyles = read("client/src/pages/day-board-crm-gridless.css");

    expect(shell).toContain("const scheduledTime = serviceTime(job);");
    expect(shell).toContain('<time className="dbr-job-time">{scheduledTime}</time>');
    expect(shell).toContain('<span aria-hidden="true"> · </span>{(job.jobAddress ?? "—").split(",")[0]}');
    expect(gridlessStyles).toContain(".dbr-job .dbr-job-time{color:#f0f1f2;font-weight:750;opacity:1}");
  });

  it("reads persisted portal progress without creating statuses or automatic messages", () => {
    const router = read("server/leadflowJobsRouter.ts");
    const dayBoardBlock = router.slice(router.indexOf("dayBoard: dayBoardProcedure"), router.indexOf("list: bookingsAgentProcedure"));

    for (const marker of [
      "dayBoard: dayBoardProcedure.input(dayBoardInput).query",
      "leftJoin(cleanerPortalJobProgress, eq(cleanerPortalJobProgress.leadflowJobId, leadflowJobs.id))",
      "dayBoardStatus(job.bookingStatus, job.progressStatus)",
      "dayBoardMessages: dayBoardProcedure.input",
      "dayBoardUnreadReplies: dayBoardProcedure.input",
      "sendDayBoardMessage: dayBoardProcedure.input(dayBoardMessageInput).mutation",
      'senderRole: "office"',
      "sendSms({ to: job.customerPhone, content: input.body })",
    ]) expect(dayBoardBlock).toContain(marker);

    expect(dayBoardBlock).not.toContain("insert(cleanerPortalJobProgress)");
    expect(dayBoardBlock).not.toContain("update(cleanerPortalJobProgress)");
  });

  it("keeps the Day Board path isolated to LeadFlow-owned job data", () => {
    const router = read("server/leadflowJobsRouter.ts");
    const dayBoardBlock = router.slice(router.indexOf("dayBoard: dayBoardProcedure"), router.indexOf("list: bookingsAgentProcedure"));
    const legacySymbol = ["cleaner", "Jobs"].join("");
    const legacyTable = ["cleaner", "_jobs"].join("");

    expect(dayBoardBlock).toContain("leadflowJobs");
    expect(dayBoardBlock).toContain("leadflowBookingMessages");
    expect(dayBoardBlock).toContain("cleanerPortalJobProgress");
    expect(dayBoardBlock).not.toContain(legacySymbol);
    expect(dayBoardBlock).not.toContain(legacyTable);
  });
});
