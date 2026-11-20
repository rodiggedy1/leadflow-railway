import { beforeEach, describe, expect, it, vi } from "vitest";
const auth = vi.hoisted(() => ({ getAgentFromRequest: vi.fn() }));
vi.mock("./_core/agentAuth", () => auth);
vi.mock("./db", () => ({ getDb: vi.fn(async () => { throw new Error("Unexpected database access"); }) }));
import { createTeamLeaderboardEvidenceRouter } from "./teamLeaderboardEvidenceRouter";
const admin = { agentId: 7, agentName: "Synthetic admin", agentEmail: "admin@example.test", isAdmin: true };
const reviewId = "98bf7a53-2263-40a3-bd21-c8e791084cf8";
const context = () => ({ req: { headers: {} }, res: {}, user: null, agent: null }) as any;
const input = { weekStart: "2026-11-15", mode: "unpublished_candidates" as const };
function fixture() {
  const start = vi.fn(() => ({ reviewId, status: "reading", weekStart: input.weekStart }));
  const status = vi.fn(() => ({ reviewId, status: "reviewing", publication: null, scoreResults: null }));
  const resolveWeeklyService = vi.fn(() => ({ start, status }) as any);
  const resolveService = vi.fn(); const resolveBatchService = vi.fn();
  return { start, status, resolveWeeklyService, resolveService, resolveBatchService, caller: createTeamLeaderboardEvidenceRouter({ resolveWeeklyService, resolveService, resolveBatchService }).createCaller(context()) };
}
beforeEach(() => { auth.getAgentFromRequest.mockReset(); });
describe("private weekly communication review routes", () => {
  it.each([null, { ...admin, isAdmin: false }])("refuses unauthenticated/non-admin access before acquiring the worker", async who => {
    auth.getAgentFromRequest.mockResolvedValue(who); const f = fixture();
    await expect(f.caller.startWeeklyReview(input)).rejects.toMatchObject({ code: who ? "FORBIDDEN" : "UNAUTHORIZED" });
    await expect(f.caller.weeklyReviewStatus({ reviewId })).rejects.toMatchObject({ code: who ? "FORBIDDEN" : "UNAUTHORIZED" });
    expect(f.resolveWeeklyService).not.toHaveBeenCalled();
  });
  it("returns the started review ID and supplies the trusted staff identity", async () => {
    auth.getAgentFromRequest.mockResolvedValue(admin); const f = fixture();
    expect(await f.caller.startWeeklyReview(input)).toEqual({ reviewId, status: "reading", weekStart: input.weekStart });
    expect(f.start).toHaveBeenCalledWith(7, input); expect(f.resolveService).not.toHaveBeenCalled(); expect(f.resolveBatchService).not.toHaveBeenCalled();
  });
  it("supplies the trusted owner to the small review-status read", async () => {
    auth.getAgentFromRequest.mockResolvedValue(admin); const f = fixture();
    await f.caller.weeklyReviewStatus({ reviewId }); expect(f.status).toHaveBeenCalledWith(7, reviewId); expect(f.start).not.toHaveBeenCalled();
  });
  it.each([{ weekStart: "2026-11-15" }, { ...input, mode: "publish" }, { ...input, ownerId: 99 }, { ...input, weekStart: "2026-11-16" }])("refuses malformed/extra start input before worker acquisition", async value => {
    auth.getAgentFromRequest.mockResolvedValue(admin); const f = fixture();
    await expect(f.caller.startWeeklyReview(value as any)).rejects.toMatchObject({ code: "BAD_REQUEST" }); expect(f.resolveWeeklyService).not.toHaveBeenCalled();
  });
  it.each([{ reviewId: "arbitrary" }, { reviewId, ownerId: 99 }])("refuses malformed/extra status input", async value => {
    auth.getAgentFromRequest.mockResolvedValue(admin); const f = fixture();
    await expect(f.caller.weeklyReviewStatus(value as any)).rejects.toMatchObject({ code: "BAD_REQUEST" }); expect(f.resolveWeeklyService).not.toHaveBeenCalled();
  });
  it("sanitizes missing/wrong-owner review errors without customer evidence", async () => {
    auth.getAgentFromRequest.mockResolvedValue(admin); const f = fixture(); f.status.mockImplementation(() => { throw new Error("private customer data"); });
    await expect(f.caller.weeklyReviewStatus({ reviewId })).rejects.toMatchObject({ code: "PRECONDITION_FAILED", message: "TEAM_EVIDENCE_BATCH_NOT_COMPLETED" });
  });
});
