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
});
