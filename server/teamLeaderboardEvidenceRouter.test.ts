import { describe, expect, it, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const auth = vi.hoisted(() => ({ getAgentFromRequest: vi.fn() }));
vi.mock("./_core/agentAuth", () => auth);
vi.mock("./db", () => ({ getDb: vi.fn(async () => { throw new Error("Unexpected auth database write/read"); }) }));
import { createTeamLeaderboardEvidenceRouter } from "./teamLeaderboardEvidenceRouter";
import type { TeamEvidenceService } from "./teamLeaderboardEvidenceService";

const agent = { agentId: 1, agentName: "Synthetic Admin", agentEmail: "admin@example.test", isAdmin: true };
const context = () => ({ req: { headers: {} }, res: {}, user: null, agent: null }) as any;
const fixture = () => {
  const readWeek = vi.fn(async (_: { weekStart: string }) => ({ status: "unpublished_read", publication: null, scoreResults: null }));
  const analyzeWeek = vi.fn(async (_: { weekStart: string }) => ({ analysis: { status: "unpublished_candidates" }, publication: null, scoreResults: null }));
  const service = { readWeek, analyzeWeek } as unknown as TeamEvidenceService;
  const resolveService = vi.fn(() => service);
  return { readWeek, analyzeWeek, resolveService, caller: createTeamLeaderboardEvidenceRouter({ resolveService }).createCaller(context()) };
};

beforeEach(() => { auth.getAgentFromRequest.mockReset(); });
describe("private team evidence routes", () => {
  it("blocks unauthenticated callers before service acquisition", async () => {
    auth.getAgentFromRequest.mockResolvedValue(null); const f = fixture();
    await expect(f.caller.readWeek({ weekStart: "2026-11-15" })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(f.resolveService).not.toHaveBeenCalled();
  });
  it("blocks team/cleaner cookies and non-admin staff from customer evidence", async () => {
    auth.getAgentFromRequest.mockResolvedValue({ ...agent, isAdmin: false }); const f = fixture();
    await expect(f.caller.readWeek({ weekStart: "2026-11-15" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(f.caller.analyzeWeek({ weekStart: "2026-11-15", mode: "unpublished_candidates" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(f.resolveService).not.toHaveBeenCalled();
  });
  it("allows an admin retained read without running analysis", async () => {
    auth.getAgentFromRequest.mockResolvedValue(agent); const f = fixture();
    expect(await f.caller.readWeek({ weekStart: "2026-11-15" })).toMatchObject({ publication: null, scoreResults: null });
    expect(f.readWeek).toHaveBeenCalledWith({ weekStart: "2026-11-15" }); expect(f.analyzeWeek).not.toHaveBeenCalled();
  });
  it("requires an explicit unpublished mode for paid analysis", async () => {
    auth.getAgentFromRequest.mockResolvedValue(agent); const f = fixture();
    await expect(f.caller.analyzeWeek({ weekStart: "2026-11-15" } as any)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(f.resolveService).not.toHaveBeenCalled();
  });
  it("allows explicit admin analysis without publishing", async () => {
    auth.getAgentFromRequest.mockResolvedValue(agent); const f = fixture();
    expect(await f.caller.analyzeWeek({ weekStart: "2026-11-15", mode: "unpublished_candidates" })).toMatchObject({ publication: null, scoreResults: null });
    expect(f.analyzeWeek).toHaveBeenCalledWith({ weekStart: "2026-11-15" });
  });
  it.each([{ weekStart: "2026-11-16" }, { weekStart: "2026-02-30" }, { weekStart: "2026-11-15", publish: true }])("rejects invalid or extra read input %j", async input => {
    auth.getAgentFromRequest.mockResolvedValue(agent); const f = fixture();
    await expect(f.caller.readWeek(input as any)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(f.resolveService).not.toHaveBeenCalled();
  });
  it("sanitizes backend errors instead of exposing connection details or customer evidence", async () => {
    auth.getAgentFromRequest.mockResolvedValue(agent); const f = fixture();
    f.readWeek.mockRejectedValue(new Error("DATABASE_URL secret customer transcript"));
    await expect(f.caller.readWeek({ weekStart: "2026-11-15" })).rejects.toMatchObject({ code: "PRECONDITION_FAILED", message: "TEAM_EVIDENCE_READ_UNAVAILABLE" });
  });
  it("contains no publication, SMS, team-link or scheduling mutation", () => {
    const source = readFileSync(resolve("server/teamLeaderboardEvidenceRouter.ts"), "utf8");
    expect(source).toContain("adminAgentProcedure"); expect(source).not.toContain("opsChatProcedure"); expect(source).not.toContain("cleanerProcedure");
    for (const forbidden of ["sendSms", "broadcastOpsUpdate", "generateMagicLink", "scheduleTask", "publishWeek"])
      expect(source).not.toContain(forbidden);
  });
  it("does not connect the private admin evidence API to the team page", () => {
    const page = readFileSync(resolve("client/src/pages/TeamLeaderboard.tsx"), "utf8");
    expect(page).not.toContain("teamEvidence"); expect(page).toContain("publication={null}");
  });
});
