import { beforeEach, describe, expect, it, vi } from "vitest";
import { AGENT_COOKIE_NAME, CLEANER_COOKIE_NAME } from "../shared/const";
import { signAgentSession } from "./_core/agentAuth";
import { signCleanerSession } from "./_core/cleanerAuth";
import { createTeamLeaderboardHistoryRouter } from "./teamLeaderboardHistoryRouter";
import type { TeamLeaderboardHistoryService } from "./teamLeaderboardHistoryService";
import baseline from "./teamLeaderboardWeeklySnapshot.json";

const boundary = vi.hoisted(() => ({ getDb: vi.fn(), getAgentById: vi.fn(), findTeam: vi.fn(), accounts: vi.fn() }));
vi.mock("./db", () => ({ getDb: boundary.getDb, getAgentById: boundary.getAgentById, getPool: vi.fn() }));
vi.mock("./_core/env", () => ({ ENV: { cookieSecret: "synthetic-offline-history-secret" } }));
vi.mock("./cleanerPortalOwnership", () => ({ findCleanerPortalTeam: boundary.findTeam }));
vi.mock("./teamLeaderboardAdminAccounts", () => ({ readTeamLeaderboardAdminAccounts: boundary.accounts }));
vi.mock("./teamLeaderboardHistoryRuntime", () => ({ teamLeaderboardHistoryService: () => { throw new Error("Live runtime must not be used"); } }));

let agent: any;
let active = true;
let service: any;
let route: ReturnType<typeof createTeamLeaderboardHistoryRouter>;
const id = "c9bd9999-6cd8-4b1b-9b70-31f4938176ed";
const call = (cookie: string, extra: object = {}) => route.createCaller({ req: { headers: { cookie } }, res: {}, user: null, ...extra } as any);
async function staff() {
  const token = await signAgentSession({ agentId: 42, agentName: "Synthetic", agentEmail: "admin@example.invalid", isAdmin: true });
  return call(`${AGENT_COOKIE_NAME}=${token}`);
}
async function cleaner() {
  const token = await signCleanerSession({ cleanerId: 77, cleanerName: "Synthetic", cleanerPhone: "+12025550199" });
  return call(`${CLEANER_COOKIE_NAME}=${token}`);
}
beforeEach(() => {
  vi.clearAllMocks(); active = true;
  agent = { id: 42, name: "Synthetic", email: "admin@example.invalid", isActive: 1, isAdmin: 1, pagePermissions: "[]" };
  boundary.getAgentById.mockImplementation(async () => agent);
  boundary.getDb.mockResolvedValue({ select: () => ({ from: () => ({ where: () => ({ limit: async () => active ? [{ id: 77, isActive: 1 }] : [] }) }) }) });
  boundary.findTeam.mockResolvedValue({ cleanerProfileId: 77, launch27TeamId: 222, schedulingTeamId: 4, payPercent: null });
  boundary.accounts.mockResolvedValue({ "4": { cleanerProfileId: 77 } });
  service = { published: vi.fn(async () => structuredClone(baseline)), weeks: vi.fn(async () => [{ id: "legacy-2026-11-15", weekStart: "2026-11-15", weekEnd: "2026-11-21", coverageEnd: "2026-11-19", publishedAtMs: 0 }]),
    start: vi.fn(async () => ({ id, weekStart: "2026-11-15", status: "reading" })),
    runs: vi.fn(async () => []), draft: vi.fn(async () => ({ id, status: "completed", private: "SYNTHETIC_REVIEW_ONLY" })),
    publish: vi.fn(async () => ({ id, publishedAtMs: 1 })) };
  route = createTeamLeaderboardHistoryRouter({ resolveService: () => service as TeamLeaderboardHistoryService });
});

describe("historical leaderboard authorization and privacy", () => {
  it.each([{ weekStart: "2026-11-15" }, { summary: true }])("admin receives all reviewed complaints for %j", async selection => {
    const result = await (await staff()).forAdmin(selection);
    expect(result.agentId).toBe(42);
    expect(result.publication.ownIncidents).toEqual(baseline.publication.ownIncidents);
    expect(service.published).toHaveBeenCalledWith(selection);
    expect(result.selectionKey).toBe(selection.summary ? "summary" : "2026-11-15");
    expect(result).not.toHaveProperty("private");
    expect(service.start).not.toHaveBeenCalled(); expect(service.publish).not.toHaveBeenCalled();
  });
  it.each([{ weekStart: "2026-11-15" }, { summary: true }])("ordinary team sees only its own incident fields for %j", async selection => {
    const result = await (await cleaner()).forMe(selection);
    expect(result.ownTeamId).toBe("4"); expect(result.cleanerProfileId).toBe(77);
    expect(result.publication.teams).toEqual(baseline.publication.teams);
    expect(result.publication.ownIncidents).toEqual(baseline.publication.ownIncidents.filter(incident => incident.teamId === "4"));
    for (const incident of baseline.publication.ownIncidents.filter(incident => incident.teamId !== "4"))
      expect(JSON.stringify(result)).not.toContain(incident.summary);
    expect(result).not.toHaveProperty("teamAccounts"); expect(result).not.toHaveProperty("agentId");
    expect(service.start).not.toHaveBeenCalled();
  });
  it.each([{ weekStart: "2026-11-15" }, { summary: true }])("strips persisted private review/count metadata from both public projections for %j", async selection => {
    service.published.mockResolvedValue({ ...structuredClone(baseline),
      reviewMetadata: { countsComplete: true, warnings: ["SYNTHETIC_PRIVATE_SOURCE_WARNING"], unmatchedWarnings: ["SYNTHETIC_PRIVATE_MATCH"],
        incidents: [{ id: "week-123:4", teamId: "4", includeComplaint: true, completedRecovery: false, refundRequest: false }] },
      rawRead: "SYNTHETIC_PRIVATE_RAW_BODY" });
    for (const result of [await (await staff()).forAdmin(selection), await (await cleaner()).forMe(selection)]) {
      expect(result).not.toHaveProperty("reviewMetadata"); expect(result).not.toHaveProperty("rawRead");
      expect(JSON.stringify(result)).not.toContain("SYNTHETIC_PRIVATE");
      for (const incident of result.publication.ownIncidents)
        expect(Object.keys(incident).sort()).toEqual(["id", "teamId", "date", "sourceLabel", "summary", "outcome"].sort());
    }
  });
  it("never exposes draft/write/history-admin procedures to a cleaner or OAuth-only owner", async () => {
    const team = await cleaner(); const owner = call("", { user: { role: "admin" }, agent: { isAdmin: true } });
    for (const caller of [team, owner]) {
      await expect(caller.weeksForAdmin()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
      await expect(caller.forAdmin({ summary: true })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
      await expect(caller.reviewDraft({ reviewId: id })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
      await expect(caller.reviewRuns({ weekStart: "2026-11-15" })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
      await expect(caller.startReview({ requestId: id, weekStart: "2026-11-15" })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
      await expect(caller.publishReview({ reviewId: id, expectedPublicationId: null, decisions: [], acknowledgeLimitations: true })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    }
    expect(service.start).not.toHaveBeenCalled(); expect(service.draft).not.toHaveBeenCalled(); expect(service.publish).not.toHaveBeenCalled();
  });
  it("rechecks current role and deactivation after issuing a real admin cookie", async () => {
    const caller = await staff(); await caller.weeksForAdmin();
    agent.isAdmin = 0;
    await expect(caller.startReview({ requestId: id, weekStart: "2026-11-15" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    agent.isAdmin = 1; agent.isActive = 0;
    await expect(caller.reviewDraft({ reviewId: id })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(service.start).not.toHaveBeenCalled(); expect(service.draft).not.toHaveBeenCalled();
  });
  it("fails closed for inactive or missing team mapping across weekly and Summary reads", async () => {
    active = false;
    await expect((await cleaner()).forMe({ summary: true })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    active = true; boundary.findTeam.mockResolvedValue(null);
    await expect((await cleaner()).weeksForMe()).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(service.published).not.toHaveBeenCalled(); expect(service.weeks).not.toHaveBeenCalled();
  });
  it("returns only public week metadata to teams and starts work only on the explicit admin mutation", async () => {
    const metadata = await (await cleaner()).weeksForMe();
    expect(metadata.cleanerProfileId).toBe(77); expect(metadata.weeks).toHaveLength(1);
    expect(service.start).not.toHaveBeenCalled();
    const result = await (await staff()).startReview({ requestId: id, weekStart: "2026-11-15" });
    expect(result.agentId).toBe(42);
    expect(service.start).toHaveBeenCalledWith(42, { requestId: id, weekStart: "2026-11-15" });
  });
  it("requires strict valid input and an explicit reviewed-limitations acknowledgment", async () => {
    const caller = await staff();
    await expect(caller.startReview({ requestId: id, weekStart: "2026-11-16" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(caller.publishReview({ reviewId: id, expectedPublicationId: null, decisions: [], acknowledgeLimitations: false } as any)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(caller.publishReview({ reviewId: id, expectedPublicationId: null, acknowledgeLimitations: true,
      decisions: [{ visitId: 1, teamId: 4, includeComplaint: true, completedRecovery: true, outcomeNote: "" }] })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(service.start).not.toHaveBeenCalled(); expect(service.publish).not.toHaveBeenCalled();
  });
  it("sanitizes storage failures rather than exposing source text or SQL", async () => {
    service.draft.mockRejectedValue(new Error("SELECT private_original_customer_text FROM private_storage"));
    await expect((await staff()).reviewDraft({ reviewId: id })).rejects.toMatchObject({ code: "PRECONDITION_FAILED", message: "The weekly review could not be completed. Previous published results are unchanged." });
  });
});
