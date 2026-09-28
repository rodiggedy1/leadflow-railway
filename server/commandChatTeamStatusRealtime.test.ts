import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), "utf8");

describe("Command Chat team schedule realtime status", () => {
  it("refreshes the currently open team schedule through the existing operations stream", () => {
    const page = read("client/src/pages/CommandChatExactLive.tsx");
    const scheduleRouter = read("server/leadflowScheduleRouter.ts");
    const streamCallbacks = page.slice(page.indexOf("useOpsStream({"), page.indexOf("}, { enabled: isAuthenticated", page.indexOf("useOpsStream({")));

    expect(streamCallbacks).toContain("onJobUpdate: () => {");
    expect(streamCallbacks).toContain("utils.leadflowSchedule.getSchedule.invalidate({ date: todayDateStr });");
    expect(page).toContain("trpc.leadflowSchedule.getSchedule.useQuery");
    expect(scheduleRouter).toContain(".leftJoin(cleanerPortalJobProgress, eq(cleanerPortalJobProgress.leadflowJobId, leadflowJobs.id))");
    expect(scheduleRouter).toContain("jobStatus: jobStatusById.get(job.id) ?? null");
  });

  it("publishes the existing job update only after portal progress or completion is persisted", () => {
    const progressRouter = read("server/cleanerPortalProgressRouter.ts");
    const signoffRouter = read("server/cleanerPortalSignoffRouter.ts");
    const progressSave = progressRouter.slice(progressRouter.indexOf("async function saveProgress"), progressRouter.indexOf("async function notifyClient"));
    const completion = signoffRouter.slice(signoffRouter.indexOf("completeAfterSignoff:"), signoffRouter.indexOf("return { jobStatus: progress.jobStatus"));

    expect(progressRouter).toContain('import { broadcastOpsUpdate } from "./sseBroadcast";');
    expect(signoffRouter).toContain('import { broadcastOpsUpdate } from "./sseBroadcast";');
    expect(progressSave).toContain('broadcastOpsUpdate("job_update", { jobId: input.leadflowJobId });');
    expect(completion).toContain('broadcastOpsUpdate("job_update", { jobId: job.id });');
    expect(progressSave.indexOf('broadcastOpsUpdate("job_update", { jobId: input.leadflowJobId });')).toBeGreaterThan(progressSave.indexOf("onDuplicateKeyUpdate"));
    expect(completion.indexOf('broadcastOpsUpdate("job_update", { jobId: job.id });')).toBeGreaterThan(completion.indexOf("onDuplicateKeyUpdate"));
  });
});
