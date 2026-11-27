import { describe, expect, it, vi } from "vitest";
const boundary = vi.hoisted(() => ({ db: vi.fn(), pool: vi.fn() }));
vi.mock("./db", () => ({ getDb: boundary.db, getPool: boundary.pool }));
import { assertTeamHistoryCountSelect, teamLeaderboardHistoryService } from "./teamLeaderboardHistoryRuntime";

describe("weekly history runtime remains passive and isolated", () => {
  it("constructs the archive service without acquiring a pool or starting a review", () => {
    const service = teamLeaderboardHistoryService();
    expect(service).toHaveProperty("start");
    expect(boundary.db).not.toHaveBeenCalled(); expect(boundary.pool).not.toHaveBeenCalled();
  });
  it.each([
    "SELECT `id`, `name`, `launch27TeamId` FROM `scheduling_teams` WHERE `id` > ? ORDER BY `id` LIMIT ?",
    "SELECT j.`id`, p.`etaTimestamp` FROM `leadflow_jobs` j LEFT JOIN `cleaner_portal_job_progress` p ON p.`leadflowJobId` = j.`id` WHERE j.`jobDate` >= ?",
    "SELECT `id`, `leadflowJobId`, `photoUrl` FROM `cleaner_portal_job_photos` WHERE `id` > ? ORDER BY `id` LIMIT ?",
  ])("allows only owned metric projections: %s", query => { expect(() => assertTeamHistoryCountSelect(query)).not.toThrow(); });
  it.each([
    "UPDATE `leadflow_jobs` SET `teamId` = ?",
    "SELECT `id` FROM `bookings`",
    "SELECT `id` FROM `voice_calls`",
    "SELECT `id` FROM `leadflow_jobs`; DELETE FROM `leadflow_jobs`",
    "SELECT `id` FROM `leadflow_jobs` FOR UPDATE",
    "SELECT `id` FROM `leadflow_jobs` UNION SELECT `id` FROM `bookings`",
    "SELECT `id` FROM `leadflow_jobs` /* hidden */",
  ])("rejects unrelated, unsafe or non-read access: %s", query => { expect(() => assertTeamHistoryCountSelect(query)).toThrow("WEEK_COUNTS_INVALID_QUERY"); });
  it("accepts every query the real count reader sends (including the sign-off completion read)", async () => {
    const { readTeamLeaderboardCounts } = await import("./teamLeaderboardHistoryMetrics");
    const { resolveTeamEvidenceWindow } = await import("./teamLeaderboardEvidenceWindow");
    const sent: string[] = [];
    const port = { select: async (query: string) => { assertTeamHistoryCountSelect(query); sent.push(query); return []; } };
    const counts = await readTeamLeaderboardCounts(port, resolveTeamEvidenceWindow({ weekStart: "2026-11-15" }, new Date("2026-11-20T17:00:00Z")));
    expect(counts.complete).toBe(true);
    expect(sent.some(query => query.includes("FROM `cleaner_portal_job_signoffs`"))).toBe(true);
    expect(sent).toHaveLength(5);
  });
});
