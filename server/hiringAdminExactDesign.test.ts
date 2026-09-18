import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "..");
const app = readFileSync(path.join(root, "client/src/App.tsx"), "utf8");
const nav = readFileSync(path.join(root, "client/src/components/ReviewWorkspaceNav.tsx"), "utf8");
const live = readFileSync(path.join(root, "client/src/pages/HiringAdminLive.tsx"), "utf8");
const shell = readFileSync(path.join(root, "client/src/pages/HiringAdminExactLive.tsx"), "utf8");
const styles = readFileSync(path.join(root, "client/src/pages/hiring-admin-dashboard-review.css"), "utf8");
const liveStyles = readFileSync(path.join(root, "client/src/pages/hiring-admin-exact-live.css"), "utf8");

// The review shell is intentionally copied before live behavior is attached.
describe("exact-design Hiring Admin release", () => {
  it("routes the live page through the review workspace frame and exact adapter", () => {
    expect(app).toContain('function AdminHiringAdminExactReviewRoute() { return <ReviewWorkspaceFrame navActivePath="/review/hiring-admin"><HiringAdminLive /></ReviewWorkspaceFrame>; }');
    expect(app).toContain('<Route path={"/admin/hiring"} component={AdminHiringAdminExactReviewRoute} />');
    expect(app).toContain('location === "/admin/hiring"');
    expect(live).toContain('import HiringAdminExactLive from "./HiringAdminExactLive";');
    expect(live).toContain("return <HiringAdminExactLive />;");
    expect(nav).toContain('{ label: "Hiring Admin", href: "/review/hiring-admin", liveHref: "/admin/hiring", icon: UserRoundCheck }');
  });

  it("starts from the approved dashboard shell instead of preserving the legacy outer layout", () => {
    for (const element of ["hadr-page", "hadr-utility", "hadr-intro", "hadr-notice", "hadr-kpis", "hadr-coverage", "hadr-pipeline", "hadr-board", "hadr-drawer"]) {
      expect(shell).toContain(element);
    }
    expect(styles).toContain(".hadr-utility");
    expect(styles).toContain(".hadr-board");
    expect(styles).toContain(".hadr-drawer");
    expect(shell).not.toContain("hiring-review-sidebar");
  });

  it("preserves the existing live candidate queries and stage-change semantics", () => {
    for (const contract of [
      "trpc.hiring.getCandidates.useQuery",
      "trpc.hiring.getPipelineStats.useQuery",
      "trpc.hiring.updateStage.useMutation",
      "trpcUtils.hiring.getSessionByPhone.fetch",
      "trpcUtils.leads.getById.fetch",
      "sendSmsNotification",
      "commitStageChange",
      "requestColumnMove",
      "window.confirm(`Reject ${drawerApplicant.name}?`)",
    ]) {
      expect(shell).toContain(contract);
    }
    expect(shell).not.toContain('fetch("/api');
  });

  it("keeps the existing confirmation, message drawer, and media workflow in matching review slots", () => {
    for (const contract of [
      "setSmsPending",
      ">Yes, send SMS</button>",
      ">Skip</button>",
      ">Cancel</button>",
      "<ConversationDrawer",
      "<VideoInterviewCard videoUrl={drawerApplicant.applicationVideoUrl} />",
      "<InterviewRecordingCard videoUrl={drawerApplicant.interviewVideoUrl} candidateId={drawerApplicant.id} />",
    ]) {
      expect(shell).toContain(contract);
    }
  });

  it("retains accessible existing drag and adjacent-column movement controls", () => {
    for (const contract of ["DndContext", "DragOverlay", "useDraggable", "useDroppable", "MouseSensor", "TouchSensor", "KeyboardSensor", "closestCorners", "canMoveBetween", "hadr-card-menu-popover"]) {
      expect(shell).toContain(contract);
    }
    expect(shell).toContain('onDragCancel={() => setActiveApplicant(null)}');
    expect(styles).toContain("touch-action:pan-y");
    expect(styles).toContain(".hadr-column.is-drop-target");
  });

  it("keeps every real candidate row inside the review-sized lane rather than lengthening the page", () => {
    expect(liveStyles).toContain(".hadr-live-page .hadr-column{height:clamp(500px,58vh,640px);min-height:0;display:flex;flex-direction:column}");
    expect(liveStyles).toContain(".hadr-live-page .hadr-column-cards{min-height:0;flex:1 1 auto;overflow-y:auto");
    expect(liveStyles).toContain("scrollbar-gutter:stable");
  });
});
