import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "..");
const app = readFileSync(path.join(root, "client/src/App.tsx"), "utf8");
const live = readFileSync(path.join(root, "client/src/pages/HiringAdminLive.tsx"), "utf8");
const page = readFileSync(path.join(root, "client/src/pages/HiringAdminReview.tsx"), "utf8");
const styles = readFileSync(path.join(root, "client/src/pages/hiring-admin-review.css"), "utf8");

describe("exact-design Hiring admin release", () => {
  it("routes the live hiring page through the approved design shell instead of the old visual page", () => {
    expect(app).toContain('const HiringAdminLive = lazy(() => import("./pages/HiringAdminLive"));');
    expect(app).toContain('<Route path={"/admin/hiring"} component={HiringAdminLive} />');
    expect(app).not.toContain('<Route path={"/admin/hiring"} component={HiringPipeline} />');
    expect(live).toContain("return <HiringAdminWorkspace live />;");
  });

  it("keeps the approved visual shell intact", () => {
    for (const element of ["hiring-review-sidebar", "hiring-review-header", "hiring-review-kpis", "hiring-review-coverage", "hiring-review-kanban", "hiring-review-drawer"]) {
      expect(page).toContain(element);
    }
    expect(styles).toContain(".hiring-review-sidebar");
    expect(styles).toContain(".hiring-review-drawer");
  });

  it("reuses existing hiring queries and actions rather than adding a separate workflow", () => {
    for (const contract of ["trpc.hiring.getCandidates.useQuery", "trpc.hiring.getPipelineStats.useQuery", "trpc.hiring.updateStage.useMutation", "trpcUtils.hiring.getSessionByPhone.fetch", "trpcUtils.leads.getById.fetch"]) {
      expect(page).toContain(contract);
    }
    expect(page).not.toContain('fetch("/api');
  });

  it("reuses the existing application and AI-interview players in the right-hand detail drawer", () => {
    expect(page).toContain('import { InterviewRecordingCard, VideoInterviewCard } from "./HiringPipeline";');
    expect(page).toContain("videoUrl: candidate.videoUrl ?? null");
    expect(page).toContain("interviewVideoUrl: candidate.interviewVideoUrl ?? null");
    expect(page).toContain("<VideoInterviewCard videoUrl={selectedApplicant.videoUrl} />");
    expect(page).toContain("<InterviewRecordingCard videoUrl={selectedApplicant.interviewVideoUrl} candidateId={selectedApplicant.id} />");
  });

  it("shows a compact card indicator only when an existing application or interview video is available", () => {
    expect(page).toContain("const videoCount = Number(Boolean(applicant.videoUrl)) + Number(Boolean(applicant.interviewVideoUrl));");
    expect(page).toContain("videoCount > 0");
    expect(page).toContain("hiring-review-applicant-video-indicator");
    expect(styles).toContain(".hiring-review-applicant-video-indicator");
    expect(page).toContain("function DraggableApplicantCard");
    expect(page).toContain("<div className=\"hiring-review-chip-row\">");
  });

  it("keeps every service chip inside its own equal-width board lane without clipping card content", () => {
    expect(page).toContain("applicant.tags.map((tag) => <span key={tag}>{tag}</span>)");
    expect(page).not.toContain("applicant.tags.slice");
    expect(page).not.toContain("+N");
    for (const rule of [".hiring-review-kanban,.hiring-review-column,.hiring-review-column__cards,.hiring-review-applicant-card,.hiring-review-chip-row{min-width:0}", ".hiring-review-column__cards{width:100%}", ".hiring-review-applicant-card{width:100%;box-sizing:border-box;min-width:0}", "overflow-wrap:anywhere"]) {
      expect(styles).toContain(rule);
    }
    expect(styles).not.toContain(".hiring-review-column{overflow:hidden}");
    expect(styles).not.toContain(".hiring-review-applicant-card{max-width:100%;overflow:hidden}");
  });

  it("reuses the existing DnD Kit stage workflow with accessible cross-column controls and no new API path", () => {
    for (const contract of ["DndContext", "DragOverlay", "useDraggable", "useDroppable", "MouseSensor", "TouchSensor", "KeyboardSensor", "closestCorners", "requestColumnMove", "commitStageChange", "hiring-review-card-menu__popover"]) {
      expect(page).toContain(contract);
    }
    expect(page).toContain('const REVIEW_STAGE_FOR_COLUMN: Record<ReviewColumn, string>');
    expect(page).toContain('Math.abs(currentIndex - targetIndex) !== 1');
    expect(page).toContain('Math.abs(REVIEW_COLUMN_ORDER.indexOf(applicant.column) - REVIEW_COLUMN_ORDER.indexOf(target)) !== 1');
    expect(page).toContain('disabled: !dragEnabled || !isValidTarget');
    expect(page).toContain('delete next[applicant.id]');
    expect(page).toContain('MessageSquare,');
    expect(page).toContain('<MessageSquare className="w-5 h-5 text-amber-600" />');
    expect(page).toContain('onDragCancel={() => setActiveApplicant(null)}');
    expect(page).toContain('commitStageChange(applicant, smsPending.stage, smsPending.column, false)');
    expect(page).toContain('commitStageChange(applicant, smsPending.stage, smsPending.column, true)');
    expect(page).toContain('>Cancel</button>');
    expect(page).not.toContain('fetch("/api');
    for (const rule of ["touch-action:pan-y", ".hiring-review-column.is-drop-target", ".hiring-review-drag-overlay", "prefers-reduced-motion"]) {
      expect(styles).toContain(rule);
    }
  });
});
