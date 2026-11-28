import { readFileSync } from "node:fs";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CLEANER_COOKIE_NAME } from "../shared/const";
import { cleanerProfiles, schedulingTeams } from "../drizzle/schema";
import { rankAssessedScores } from "../shared/teamLeaderboardReviewScores";
import type { CleanerPortalTeam } from "./cleanerPortalOwnership";
import type { TeamLeaderboardSnapshot } from "./teamLeaderboardPublication";
import { readTeamLeaderboardPublication, restrictTeamLeaderboardPublication } from "./teamLeaderboardPublication";
import { signCleanerSession } from "./_core/cleanerAuth";
import { teamLeaderboardPublicationRouter } from "./teamLeaderboardPublicationRouter";
import snapshot from "./teamLeaderboardWeeklySnapshot.json";

const mocks = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("./db", () => ({ getDb: mocks.getDb }));

type Profile = { id: number; name: string; isActive: number; launch27TeamId: number | null; payPercent: string | null };
type SchedulingTeam = { id: number; name: string; launch27TeamId: number | null };
let profiles: Profile[];
let teams: SchedulingTeam[];
let reads: Array<{ params: unknown[]; sql: string; joined: boolean }>;
const dialect = new MySqlDialect();
const canonical = (schedulingTeamId: number | null = 4, cleanerProfileId = 9): CleanerPortalTeam => ({
  cleanerProfileId, launch27TeamId: 222, schedulingTeamId, payPercent: "0.45",
});

// The only dependency mock is an in-memory database. Real Drizzle conditions,
// ownership resolution, JWT verification and cleanerProcedure all execute.
beforeEach(() => {
  vi.clearAllMocks();
  profiles = [
    { id: 9, name: "Synthetic identical name", isActive: 1, launch27TeamId: 222, payPercent: "0.45" },
    { id: 21, name: "Synthetic identical name", isActive: 1, launch27TeamId: 333, payPercent: null },
    { id: 22, name: "Inactive", isActive: 0, launch27TeamId: 222, payPercent: null },
    { id: 23, name: "No scheduling mapping", isActive: 1, launch27TeamId: 444, payPercent: null },
    { id: 24, name: "No imported team", isActive: 1, launch27TeamId: null, payPercent: null },
    { id: 25, name: "Mapped but not in snapshot", isActive: 1, launch27TeamId: 555, payPercent: null },
  ];
  teams = [
    { id: 4, name: "Different stored name", launch27TeamId: 222 },
    { id: 360001, name: "Different second name", launch27TeamId: 333 },
    { id: 777, name: "Synthetic new team", launch27TeamId: 555 },
  ];
  reads = [];
  mocks.getDb.mockResolvedValue({
    select(fields: Record<string, any>) {
      let joined = false;
      let params: unknown[] = [];
      return {
        from(table: unknown) { expect(table).toBe(cleanerProfiles); return this; },
        leftJoin(table: unknown, condition: any) {
          expect(table).toBe(schedulingTeams);
          const query = dialect.sqlToQuery(condition);
          expect(query.sql).toContain("`scheduling_teams`.`launch27TeamId` = `cleaner_profiles`.`launch27TeamId`");
          joined = true;
          return this;
        },
        where(condition: any) {
          const query = dialect.sqlToQuery(condition);
          params = query.params;
          reads.push({ params, sql: query.sql, joined });
          return this;
        },
        async limit(count: number) {
          expect(count).toBe(1);
          const matching = profiles.filter(profile => profile.id === params[0] && (params.length === 1 || profile.isActive === params[1]));
          return matching.slice(0, count).map(profile => {
            const team = joined ? teams.find(value => value.launch27TeamId === profile.launch27TeamId) : undefined;
            return Object.fromEntries(Object.entries(fields).map(([key, column]) => [key,
              column.table === schedulingTeams ? (team as any)?.[column.name] ?? null : (profile as any)[column.name],
            ]));
          });
        },
      };
    },
  });
});

async function caller(cleanerId: number, extraContext: Record<string, unknown> = {}) {
  const token = await signCleanerSession({ cleanerId, cleanerName: "Synthetic cookie name", cleanerPhone: "+12025550199" });
  return teamLeaderboardPublicationRouter.createCaller({
    req: { headers: { cookie: `${CLEANER_COOKIE_NAME}=${token}` } }, res: {}, user: null, ...extraContext,
  } as any);
}

function assertOnlyOwnedFeedback(result: ReturnType<typeof readTeamLeaderboardPublication>) {
  const serialized = JSON.stringify(result);
  for (const incident of snapshot.publication.ownIncidents) {
    if (incident.teamId === result.ownTeamId) continue;
    expect(serialized).not.toContain(incident.summary);
    expect(serialized).not.toContain(incident.outcome);
    expect(serialized).not.toContain(incident.summary.split(":")[0]);
  }
  expect(result.publication.ownIncidents.every(incident => incident.teamId === result.ownTeamId)).toBe(true);
}

describe("approved static publication boundary", () => {
  it("retains approved teams, counts, metric evidence and labels without private review sections", () => {
    expect(Object.keys(snapshot).sort()).toEqual(["details", "period", "publication"]);
    expect(snapshot.publication.teams).toHaveLength(12);
    expect(snapshot.publication.ownIncidents).toHaveLength(8);
    expect(snapshot.publication.publishedLabel).toBe("Week-to-date results");
    expect(snapshot.publication.ownIncidents.every(row => row.sourceLabel === "Reviewed SMS")).toBe(true);
    expect(snapshot.period).toEqual({ weekStart: "2026-11-15", weekEnd: "2026-11-21", weekConvention: "Sunday-start", coverageStart: "2026-11-15", coverageEnd: "2026-11-19" });
    expect(Object.fromEntries(Object.entries(snapshot.details).map(([id, value]) => [id, [value.complaintCases, value.refundRequests, value.confirmedRecoveryCases]])))
      .toEqual({ "300001": [0, 0, 0], "2": [1, 0, 0], "120001": [2, 0, 0], "510002": [0, 0, 0], "4": [1, 1, 0], "5": [1, 1, 0], "510001": [0, 0, 0], "7": [0, 0, 0], "360001": [1, 0, 0], "8": [0, 0, 0], "9": [2, 1, 0], "12": [0, 0, 0] });
    const serialized = JSON.stringify(snapshot);
    expect(serialized).not.toMatch(/"(?:unresolved|groupedServices|mappingNotes|quotes|phone|evidenceId|evidenceRevision|visitId|rejectedCandidates)"/);
    expect(serialized).not.toContain("team-evidence:");
    expect(serialized).not.toMatch(/week-\d+:/);
  });
  it.each(["4", "9", "120001", "360001", "7"])("returns no other team's feedback for scheduling team %s", id => {
    const result = readTeamLeaderboardPublication(canonical(Number(id)), 9);
    expect(result.publication.teams).toEqual(snapshot.publication.teams);
    expect(result.details).toEqual(snapshot.details);
    assertOnlyOwnedFeedback(result);
  });
  it("copies only public fields, does not mutate the publication and cannot mutate it through its response", () => {
    const source = structuredClone(snapshot) as TeamLeaderboardSnapshot & Record<string, any>;
    const secret = "SYNTHETIC_PRIVATE_REVIEW_MARKER";
    (source.publication.teams[0] as any).customer = secret;
    (source.publication.teams[0].metrics.eta as any).quotes = secret;
    (source.details["4"] as any).quotes = secret;
    (source.details["4"].metricDisplay.eta as any).customer = secret;
    (source.publication.ownIncidents[4] as any).phone = secret;
    (source.period as any).review = secret;
    source.unresolved = secret;
    const before = structuredClone(source);
    const result = restrictTeamLeaderboardPublication(source, canonical(), 9);
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(source).toEqual(before);
    result.publication.teams[0].metrics.eta.successful = 999;
    result.details["4"].metricDisplay.eta.value = "changed";
    result.publication.ownIncidents[0].summary = "changed";
    result.period!.coverageEnd = "changed";
    expect(source).toEqual(before);
  });
  it.each([null, 0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])("fails closed for invalid scheduling mapping %s", id => {
    expect(() => restrictTeamLeaderboardPublication(snapshot, canonical(id), 9)).toThrow("Team publication access unavailable.");
  });
  it("validates canonical profile ownership instead of equating profile/imported/scheduling IDs", () => {
    expect(() => readTeamLeaderboardPublication(canonical(4, 21), 9)).toThrow("Team publication access unavailable.");
    expect(readTeamLeaderboardPublication(canonical(4), 9)).toMatchObject({ cleanerProfileId: 9, ownTeamId: "4" });
  });
  it("does not fabricate a row/details/incidents for a valid mapping absent from snapshot", () => {
    const result = readTeamLeaderboardPublication(canonical(777), 9);
    expect(result.ownTeamId).toBe("777");
    expect(result.publication.ownIncidents).toEqual([]);
    expect(result.publication.teams).toEqual(snapshot.publication.teams);
    expect(result.details["777"]).toBeUndefined();
    assertOnlyOwnedFeedback(result);
  });
  it("feeds the unchanged approved scorer all teams/details and never counts requests as completed recovery", () => {
    const result = readTeamLeaderboardPublication(canonical(), 9);
    const scored = rankAssessedScores(result.publication.teams, result.details);
    expect(scored).toEqual(rankAssessedScores(snapshot.publication.teams, snapshot.details));
    // A 1-job team keeps its score but is unranked (3-job minimum); ranked teams come first.
    expect(scored.find(row => row.id === "12")).toMatchObject({ rank: null, totalScore: 100, unrankedReason: "Unranked: fewer than 3 completed jobs" });
    expect(scored[0]).toMatchObject({ rank: 1, totalScore: 97.22, unrankedReason: null });
    expect(scored.find(row => row.id === "4")?.confirmedRecoveryCases).toBe(0);
    expect(scored.find(row => row.id === "2")).toMatchObject({ rank: null, totalScore: null });
  });
});

describe("forMe actual cleaner cookie authorization with mocked database only", () => {
  it("selects active profile by verified cookie and reuses canonical scheduling mapping, ignoring injected stale cleaner context", async () => {
    const result = await (await caller(9, { cleaner: { cleanerId: 21 } })).forMe();
    expect(result).toMatchObject({ ownTeamId: "4", cleanerProfileId: 9 });
    expect(reads).toHaveLength(2);
    expect(reads[0]).toMatchObject({ params: [9, 1], joined: false });
    expect(reads[0].sql).toContain("`cleaner_profiles`.`isActive` = ?");
    expect(reads[1]).toMatchObject({ params: [9], joined: true });
    assertOnlyOwnedFeedback(result);
  });
  it("uses each signed cookie identity even when stored names match and a previous response exists", async () => {
    const first = await (await caller(9)).forMe();
    const second = await (await caller(21)).forMe();
    expect(first).toMatchObject({ ownTeamId: "4", cleanerProfileId: 9 });
    expect(second).toMatchObject({ ownTeamId: "360001", cleanerProfileId: 21 });
    assertOnlyOwnedFeedback(first);
    assertOnlyOwnedFeedback(second);
  });
  it.each([22, 99])("rejects inactive/removed profile %s despite a valid cookie", async id => {
    await expect((await caller(id)).forMe()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(reads).toHaveLength(1);
    expect(reads[0]).toMatchObject({ params: [id, 1], joined: false });
  });
  it("rejects an account deactivated or removed after its cookie was issued", async () => {
    const signed = await caller(9);
    profiles[0].isActive = 0;
    await expect(signed.forMe()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    profiles.shift();
    await expect(signed.forMe()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
  it.each([23, 24])("rejects unmapped profile %s without name/phone/equal-ID fallback", async id => {
    teams.push({ id, name: profiles.find(profile => profile.id === id)!.name, launch27TeamId: 99999 });
    await expect((await caller(id)).forMe()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("allows valid scheduling mapping absent from snapshot without invented results", async () => {
    const result = await (await caller(25)).forMe();
    expect(result).toMatchObject({ ownTeamId: "777", cleanerProfileId: 25, publication: { ownIncidents: [] } });
    expect(result.details["777"]).toBeUndefined();
    expect(result.publication.teams).toEqual(snapshot.publication.teams);
  });
  it.each(["", `${CLEANER_COOKIE_NAME}=invalid`, "agent_session_id=synthetic"])("rejects missing/invalid/non-cleaner cookie %s before database reads", async cookie => {
    const unauthorized = teamLeaderboardPublicationRouter.createCaller({ req: { headers: { cookie } }, res: {}, user: { role: "admin" }, cleaner: { cleanerId: 9 } } as any);
    await expect(unauthorized.forMe()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(mocks.getDb).not.toHaveBeenCalled();
  });
  it.each([0, -1, 1.5])("rejects invalid signed profile identity %s before database reads", async id => {
    await expect((await caller(id)).forMe()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(mocks.getDb).not.toHaveBeenCalled();
  });
  it("fails closed when the database is unavailable", async () => {
    mocks.getDb.mockResolvedValue(null);
    await expect((await caller(9)).forMe()).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
    expect(reads).toEqual([]);
  });
  it("preserves both original no-input queries with only the explicitly allowed nested history procedures and no legacy operational dependency", () => {
    const procedures = teamLeaderboardPublicationRouter._def.procedures;
    expect(Object.keys(procedures)).toEqual([
      "history.weeksForAdmin", "history.forAdmin", "history.weeksForMe", "history.forMe",
      "history.startReview", "history.reviewRuns", "history.reviewDraft", "history.publishReview",
      // Phase 2 (owner-approved): saved quality records, admin only.
      "history.qualityRecords", "history.qualityChoices", "history.qualityAction", "history.qualityRetry",
      "history.liveFromRecords", "history.publishFromRecords", "history.importReviewToRecords",
      "forMe", "forAdmin",
    ]);
    expect(Object.keys(procedures).filter(name => !name.startsWith("history."))).toEqual(["forMe", "forAdmin"]);
    for (const name of ["forMe", "forAdmin"] as const) {
      expect(procedures[name]._def.type).toBe("query");
      expect(procedures[name]._def.inputs).toEqual([]);
    }
    const historyMethods = {
      "history.weeksForAdmin": "query", "history.forAdmin": "query",
      "history.weeksForMe": "query", "history.forMe": "query",
      "history.startReview": "mutation", "history.reviewRuns": "query",
      "history.reviewDraft": "query", "history.publishReview": "mutation",
      "history.qualityRecords": "query", "history.qualityChoices": "query", "history.qualityAction": "mutation", "history.qualityRetry": "mutation",
      "history.liveFromRecords": "query", "history.publishFromRecords": "mutation", "history.importReviewToRecords": "mutation",
    } as const;
    for (const [name, type] of Object.entries(historyMethods)) {
      expect(procedures[name as keyof typeof historyMethods]._def.type).toBe(type);
    }
    expect(procedures["history.weeksForAdmin"]._def.inputs).toEqual([]);
    expect(procedures["history.weeksForMe"]._def.inputs).toEqual([]);
    const forbidden = new RegExp(["cleaner", "[_]?", "[jJ]obs"].join(""));
    for (const path of ["../shared/teamLeaderboardPublication.ts", "./teamLeaderboardPublication.ts", "./teamLeaderboardPublicationRouter.ts", "./teamLeaderboardWeeklySnapshot.json", "./teamLeaderboardPublication.test.ts"]) {
      expect(readFileSync(new URL(path, import.meta.url), "utf8")).not.toMatch(forbidden);
    }
  });
});
