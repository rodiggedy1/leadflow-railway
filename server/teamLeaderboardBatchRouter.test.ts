import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

const auth = vi.hoisted(() => ({ getAgentFromRequest: vi.fn() }));
vi.mock("./_core/agentAuth", () => auth);
vi.mock("./db", () => ({ getDb: vi.fn(async () => { throw new Error("Unexpected database acquisition"); }) }));
import { createTeamLeaderboardEvidenceRouter } from "./teamLeaderboardEvidenceRouter";

const admin = { agentId: 7, agentName: "Synthetic Admin", agentEmail: "admin@example.test", isAdmin: true };
const context = () => ({ req: { headers: {} }, res: {}, user: null, agent: null }) as any;
function fixture() {
  const prepare = vi.fn(async () => ({ manifest: {}, read: {} }));
  const analyzeSource = vi.fn(async () => ({ data: { status: "completed", candidates: [] }, mac: "synthetic" }));
  const materialize = vi.fn(() => ({ publication: null, scoreResults: null }));
  const resolveBatchService = vi.fn(() => ({ prepare, analyzeSource, materialize }) as any);
  const readWeek = vi.fn(); const analyzeWeek = vi.fn();
  const resolveService = vi.fn(() => ({ readWeek, analyzeWeek }) as any);
  const caller = createTeamLeaderboardEvidenceRouter({ resolveBatchService, resolveService }).createCaller(context());
  return { caller, prepare, analyzeSource, materialize, resolveBatchService, resolveService, readWeek, analyzeWeek };
}
const sourceInput = { mode: "unpublished_candidates" as const, manifest: {} as any, source: {} as any };
const materializeInput = { mode: "unpublished_candidates" as const, manifest: {} as any, read: {} as any, receipts: [] };
beforeEach(() => { auth.getAgentFromRequest.mockReset(); });

describe("private batch analysis router", () => {
  it.each([null, { ...admin, isAdmin: false }])("rejects non-admin identity before any batch acquisition", async identity => {
    auth.getAgentFromRequest.mockResolvedValue(identity); const f = fixture();
    for (const call of [() => f.caller.prepareBatch({ weekStart: "2026-11-15" }), () => f.caller.analyzeSource(sourceInput), () => f.caller.materializeBatch(materializeInput)])
      await expect(call()).rejects.toMatchObject({ code: identity ? "FORBIDDEN" : "UNAUTHORIZED" });
    expect(f.resolveBatchService).not.toHaveBeenCalled(); expect(f.resolveService).not.toHaveBeenCalled();
  });
  it("uses trusted agentId for preparing a read-only signed snapshot", async () => {
    auth.getAgentFromRequest.mockResolvedValue(admin); const f = fixture();
    await f.caller.prepareBatch({ weekStart: "2026-11-15" });
    expect(f.prepare).toHaveBeenCalledWith(7, { weekStart: "2026-11-15" });
    expect(f.analyzeSource).not.toHaveBeenCalled(); expect(f.materialize).not.toHaveBeenCalled();
  });
  it("uses trusted agentId for one explicit source analysis and materialization", async () => {
    auth.getAgentFromRequest.mockResolvedValue(admin); const f = fixture();
    await f.caller.analyzeSource(sourceInput); await f.caller.materializeBatch(materializeInput);
    expect(f.analyzeSource).toHaveBeenCalledWith(7, sourceInput); expect(f.materialize).toHaveBeenCalledWith(7, materializeInput);
    expect(f.readWeek).not.toHaveBeenCalled(); expect(f.analyzeWeek).not.toHaveBeenCalled();
  });
  it.each([{ ...sourceInput, mode: undefined }, { ...sourceInput, mode: "publish" }, { ...sourceInput, ownerId: 99 }, { ...sourceInput, source: null }, { ...sourceInput, manifest: [] }])("rejects malformed/extra source input before service acquisition", async input => {
    auth.getAgentFromRequest.mockResolvedValue(admin); const f = fixture();
    await expect(f.caller.analyzeSource(input as any)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(f.resolveBatchService).not.toHaveBeenCalled();
  });
  it.each([{ ...materializeInput, mode: undefined }, { ...materializeInput, read: null }, { ...materializeInput, receipts: [null] }, { ...materializeInput, publish: true }])("rejects malformed/extra checkpoint input", async input => {
    auth.getAgentFromRequest.mockResolvedValue(admin); const f = fixture();
    await expect(f.caller.materializeBatch(input as any)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(f.resolveBatchService).not.toHaveBeenCalled();
  });
  it("sanitizes batch validation and runtime errors", async () => {
    auth.getAgentFromRequest.mockResolvedValue(admin); const f = fixture();
    f.analyzeSource.mockRejectedValue(new Error("SECRET source body and database URL"));
    await expect(f.caller.analyzeSource(sourceInput)).rejects.toMatchObject({ code: "PRECONDITION_FAILED", message: "TEAM_EVIDENCE_BATCH_NOT_COMPLETED" });
  });
  it("keeps both existing weekly handler bodies literally present", () => {
    const text = readFileSync(new URL("./teamLeaderboardEvidenceRouter.ts", import.meta.url), "utf8");
    expect(text).toContain('readWeek: adminAgentProcedure.input(teamEvidenceWeekInputSchema).query(({ input }) => safeRead(() => service().readWeek(input)))');
    expect(text).toContain('}).strict()).mutation(({ input }) => safeRead(() => service().analyzeWeek({ weekStart: input.weekStart })))');
    for (const forbidden of ["publishWeek", "sendSms", "generateMagicLink", "scheduleTask", "opsChatProcedure", "cleanerProcedure"])
      expect(text).not.toContain(forbidden);
  });
});
