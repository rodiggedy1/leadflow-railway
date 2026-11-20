import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { drizzle } from "drizzle-orm/mysql-proxy";
import { AGENT_COOKIE_NAME, CLEANER_COOKIE_NAME } from "../shared/const";
import { rankAssessedScores } from "../shared/teamLeaderboardReviewScores";
import { signAgentSession } from "./_core/agentAuth";
import { signCleanerSession } from "./_core/cleanerAuth";
import * as ownership from "./cleanerPortalOwnership";
import { teamLeaderboardPublicationRouter } from "./teamLeaderboardPublicationRouter";
import { readTeamLeaderboardAdminAccounts } from "./teamLeaderboardAdminAccounts";
import { readTeamLeaderboardAdminPublication, restrictTeamLeaderboardAdminPublication } from "./teamLeaderboardPublication";
import type { TeamLeaderboardSnapshot } from "./teamLeaderboardPublication";
import snapshot from "./teamLeaderboardWeeklySnapshot.json";

const boundary = vi.hoisted(() => ({ getDb: vi.fn(), getAgentById: vi.fn(), getPool: vi.fn(() => null), link: vi.fn(), provider: vi.fn() }));
vi.mock("./db", () => ({ getDb: boundary.getDb, getAgentById: boundary.getAgentById, getPool: boundary.getPool }));
vi.mock("./_core/env", () => ({ ENV: { cookieSecret: "synthetic-offline-admin-leaderboard-secret" } }));
vi.mock("./cleanerRouter", () => ({ cleanerRouter: { createCaller: boundary.link } }));
vi.mock("./openphone", () => ({ sendSms: boundary.provider }));
vi.mock("./launch27", () => ({ getCompletedBookingsForDate: boundary.provider }));

type Row = Record<string, any>;
type TableName = "cleaner_profiles" | "scheduling_teams";
type Query = { sql: string; params: unknown[] };
const allowedColumns: Record<TableName, Set<string>> = {
  cleaner_profiles: new Set(["id", "launch27TeamId", "isActive", "payPercent"]),
  scheduling_teams: new Set(["id", "launch27TeamId", "isActive", "isArchived"]),
};

// Real Drizzle SQL and result mapping execute against synthetic SELECT-only rows.
// Unknown tables, fields, writes, and predicates fail closed; no live DB is used.
class ReadOnlyRoster {
  state: Record<TableName, Row[]> = {
    cleaner_profiles: [
      { id: 9, launch27TeamId: 222, isActive: 1, name: "Identical name", payPercent: "0.45", phone: "SYNTHETIC_PRIVATE_PHONE", passwordHash: "SYNTHETIC_PRIVATE_PASSWORD", token: "SYNTHETIC_PRIVATE_TOKEN" },
      { id: 21, launch27TeamId: 333, isActive: 1, name: "Identical name", payPercent: null },
      { id: 31, launch27TeamId: 999, isActive: 1, name: "Identical name", payPercent: null },
      { id: 4, launch27TeamId: 888, isActive: 1, name: "Identical name", payPercent: null },
    ],
    scheduling_teams: [
      { id: 4, launch27TeamId: 222, isActive: 1, isArchived: 0, name: "Identical name" },
      { id: 360001, launch27TeamId: 333, isActive: 1, isArchived: 0, name: "Different name" },
      { id: 9, launch27TeamId: 999, isActive: 1, isArchived: 0, name: "Identical name" },
      { id: 777, launch27TeamId: 888, isActive: 1, isArchived: 0, name: "Identical name" },
    ],
  };
  queries: Query[] = [];
  unsupported: string[] = [];
  failTable: TableName | null = null;
  resolverRows: Row[] | null = null;
  reverseRows: Row[] | null = null;
  client = drizzle(async (sql, params) => this.execute(sql, params));

  private reject(sql: string): never {
    this.unsupported.push(sql);
    throw new Error(`Unsupported read-only roster SQL: ${sql}`);
  }

  private execute(sql: string, params: unknown[]) {
    this.queries.push({ sql, params: structuredClone(params) });
    if (sql.includes(" left join ")) {
      const canonical = /^select `cleaner_profiles`\.`id`, `cleaner_profiles`\.`launch27TeamId`, `scheduling_teams`\.`id`, `cleaner_profiles`\.`payPercent` from `cleaner_profiles` left join `scheduling_teams` on `scheduling_teams`\.`launch27TeamId` = `cleaner_profiles`\.`launch27TeamId` where `cleaner_profiles`\.`id` = \? limit \?$/;
      if (!canonical.test(sql) || params.length !== 2 || params[1] !== 1) return this.reject(sql);
      const rows: Row[] = [];
      for (const profile of this.state.cleaner_profiles.filter(row => row.id === params[0])) {
        const teams = profile.launch27TeamId == null ? [] : this.state.scheduling_teams.filter(row => row.launch27TeamId === profile.launch27TeamId);
        for (const team of teams.length ? teams : [null]) rows.push({ cleanerProfileId: profile.id, launch27TeamId: profile.launch27TeamId, schedulingTeamId: team?.id ?? null, payPercent: profile.payPercent });
      }
      const selected = (this.resolverRows ?? rows).slice(0, 1);
      return { rows: selected.map(row => [row.cleanerProfileId, row.launch27TeamId, row.schedulingTeamId, row.payPercent]) };
    }
    const parsed = /^select (.+) from `(cleaner_profiles|scheduling_teams)` where (.+?)(?: limit \?)?$/.exec(sql);
    if (!parsed) return this.reject(sql);
    const [, projection, rawTable, where] = parsed;
    const table = rawTable as TableName;
    const columns = allowedColumns[table];
    const filterParams = sql.endsWith(" limit ?") ? params.slice(0, -1) : params;
    const termPattern = /`([^`]+)`\.`([^`]+)` (= \?|in \((?:\?(?:, )?)+\))/g;
    const terms = Array.from(where.matchAll(termPattern));
    if (!terms.length || where.replace(termPattern, "").replace(/[()\s]/g, "").replace(/and/g, "") !== "") return this.reject(sql);
    let offset = 0;
    const predicates = terms.map(term => {
      if (term[1] !== table || !columns.has(term[2])) return this.reject(sql);
      const count = (term[3].match(/\?/g) ?? []).length;
      const values = filterParams.slice(offset, offset + count);
      offset += count;
      return (row: Row) => row[term[2]] != null && values.includes(row[term[2]]);
    });
    if (offset !== filterParams.length) return this.reject(sql);
    const readView = table === "scheduling_teams" && where.includes("`launch27TeamId`") && this.reverseRows !== null ? this.reverseRows : this.state[table];
    let rows = readView.filter(row => predicates.every(predicate => predicate(row)));
    if (sql.endsWith(" limit ?")) rows = rows.slice(0, Number(params.at(-1)));
    const fields = projection.split(", ").map(field => {
      const column = /^(?:`([^`]+)`\.)?`([^`]+)`$/.exec(field);
      if (!column || (column[1] && column[1] !== table) || !columns.has(column[2])) return this.reject(sql);
      return column[2];
    });
    if (table === this.failTable) throw new Error("Synthetic roster read failure");
    return { rows: rows.map(row => fields.map(field => structuredClone(row[field] ?? null))) };
  }
}

const currentAgent = { id: 42, name: "Current synthetic admin", email: "admin@example.invalid", isActive: 1, isAdmin: 1, pagePermissions: "[]" };
let agent: Row | null;
let roster: ReadOnlyRoster;
const profileForFour = () => roster.state.cleaner_profiles.find(row => row.id === 9)!;
const teamFour = () => roster.state.scheduling_teams.find(row => row.id === 4)!;
const queriesFor = (table: TableName) => roster.queries.filter(query => query.sql.includes(` from \`${table}\``) && !query.sql.includes(" left join "));
const callerWithCookie = (cookie: string, extra: Row = {}) => teamLeaderboardPublicationRouter.createCaller({
  req: { headers: { cookie } }, res: {}, user: null, ...extra,
} as any);
async function staffCaller(overrides: Row = {}, extra: Row = {}, expiresInMs?: number) {
  const token = await signAgentSession({ agentId: 42, agentName: "Stale signed name", agentEmail: "stale@example.invalid", isAdmin: true, ...overrides }, expiresInMs);
  return callerWithCookie(`${AGENT_COOKIE_NAME}=${token}`, extra);
}
async function invoke() {
  const before = structuredClone(roster.state);
  try { return await (await staffCaller()).forAdmin(); }
  finally { expect(roster.state).toEqual(before); }
}

beforeEach(() => {
  vi.clearAllMocks();
  roster = new ReadOnlyRoster();
  agent = structuredClone(currentAgent);
  boundary.getDb.mockResolvedValue(roster.client);
  boundary.getAgentById.mockImplementation(async id => agent?.id === id ? structuredClone(agent) : undefined);
  vi.spyOn(ownership, "findCleanerPortalTeam"); // Call through the unchanged real resolver.
});
afterEach(() => {
  expect(roster.unsupported).toEqual([]);
  expect(boundary.link).not.toHaveBeenCalled();
  expect(boundary.provider).not.toHaveBeenCalled();
  expect(roster.queries.every(query => query.sql.startsWith("select "))).toBe(true);
  vi.restoreAllMocks();
});

describe("forAdmin verified staff JWT and current active admin access", () => {
  it("uses the verified cookie and current record, not stale injected ctx.agent or JWT role", async () => {
    const result = await (await staffCaller({ isAdmin: false }, { agent: { agentId: 987, isAdmin: false } })).forAdmin();
    expect(result.agentId).toBe(42);
    expect(boundary.getAgentById).toHaveBeenCalledWith(42);
    expect(Object.keys(result).sort()).toEqual(["agentId", "details", "period", "publication", "teamAccounts"]);
  });
  it.each(["", `${AGENT_COOKIE_NAME}=invalid`, "unrelated=synthetic"])("rejects missing/invalid staff cookie %s despite OAuth and injected admin", async cookie => {
    await expect(callerWithCookie(cookie, { user: { role: "admin", openId: "owner" }, agent: { agentId: 42, isAdmin: true } }).forAdmin()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(boundary.getAgentById).not.toHaveBeenCalled();
    expect(boundary.getDb).not.toHaveBeenCalled();
  });
  it("rejects a real cleaner JWT in either cookie, with no OAuth bypass", async () => {
    const token = await signCleanerSession({ cleanerId: 9, cleanerName: "Synthetic cleaner", cleanerPhone: "+12025550199" });
    for (const cookieName of [CLEANER_COOKIE_NAME, AGENT_COOKIE_NAME]) {
      await expect(callerWithCookie(`${cookieName}=${token}`, { user: { role: "admin" } }).forAdmin()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    }
    expect(boundary.getAgentById).not.toHaveBeenCalled();
    expect(boundary.getDb).not.toHaveBeenCalled();
  });
  it("rejects expired and tampered real staff JWTs before roster reads", async () => {
    await expect((await staffCaller({}, {}, -60_000)).forAdmin()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    const token = await signAgentSession({ agentId: 42, agentName: "Synthetic", agentEmail: "synthetic@example.invalid", isAdmin: true });
    const [header, payload, signature] = token.split(".");
    const changed = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload, "base64url").toString()), agentId: 999 })).toString("base64url");
    await expect(callerWithCookie(`${AGENT_COOKIE_NAME}=${header}.${changed}.${signature}`).forAdmin()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(boundary.getAgentById).not.toHaveBeenCalled();
    expect(boundary.getDb).not.toHaveBeenCalled();
  });
  it.each([null, { ...currentAgent, isActive: 0 }, { ...currentAgent, isActive: 2 }])("rejects missing/non-active current admin %j", async row => {
    agent = row;
    await expect(invoke()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(boundary.getAgentById).toHaveBeenCalledWith(42);
    expect(boundary.getDb).not.toHaveBeenCalled();
  });
  it.each([null, '["quality"]', "[]", '["bookings"]', "invalid historical JSON"])("rejects a current non-admin with permissions %s even with signed/injected/OAuth admin", async pagePermissions => {
    agent = { ...currentAgent, isAdmin: 0, pagePermissions };
    await expect((await staffCaller({}, { user: { role: "admin" }, agent: { agentId: 42, isAdmin: true } })).forAdmin()).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(boundary.getDb).not.toHaveBeenCalled();
  });
  it("rechecks deactivation, role revocation and deletion after cookie issuance and successful access", async () => {
    const caller = await staffCaller();
    await caller.forAdmin();
    for (const [row, code] of [[{ ...currentAgent, isAdmin: 0 }, "FORBIDDEN"], [{ ...currentAgent, isActive: 0 }, "UNAUTHORIZED"], [null, "UNAUTHORIZED"]] as const) {
      agent = row;
      boundary.getDb.mockClear();
      await expect(caller.forAdmin()).rejects.toMatchObject({ code });
      expect(boundary.getDb).not.toHaveBeenCalled();
    }
  });
  it.each([0, -1, 1.5, 999])("rejects signed nonexistent/invalid agent identity %s", async agentId => {
    await expect((await staffCaller({ agentId })).forAdmin()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(boundary.getDb).not.toHaveBeenCalled();
  });
  it("fails closed when auth lookup fails or roster DB is unavailable", async () => {
    boundary.getAgentById.mockRejectedValueOnce(new Error("Synthetic auth DB failure"));
    await expect(invoke()).rejects.toThrow("Synthetic auth DB failure");
    expect(boundary.getDb).not.toHaveBeenCalled();
    boundary.getDb.mockResolvedValue(null);
    await expect(invoke()).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
    expect(roster.queries).toEqual([]);
  });
});

describe("snapshot scheduling team to stable Launch27 cleaner account mapping", () => {
  it("maps stable IDs despite identical names and colliding numeric namespaces, only for published teams", async () => {
    const result = await invoke();
    expect(result.teamAccounts["4"]).toEqual({ cleanerProfileId: 9 });
    expect(result.teamAccounts["360001"]).toEqual({ cleanerProfileId: 21 });
    expect(result.teamAccounts["9"]).toEqual({ cleanerProfileId: 31 });
    expect(result.teamAccounts["777"]).toBeUndefined();
    expect(Object.keys(result.teamAccounts).sort()).toEqual(snapshot.publication.teams.map(team => team.id).sort());
    const ids = snapshot.publication.teams.map(team => Number(team.id));
    expect(queriesFor("scheduling_teams")[0]).toMatchObject({ params: ids });
    expect(queriesFor("scheduling_teams")[0].sql).toContain("`scheduling_teams`.`id` in (");
    expect(queriesFor("cleaner_profiles")[0].params).toEqual([222, 333, 999]);
    expect(queriesFor("cleaner_profiles")[0].sql).toContain("`cleaner_profiles`.`launch27TeamId` in (");
    expect(queriesFor("scheduling_teams")[1].params).toEqual([222, 333, 999]);
    expect(ownership.findCleanerPortalTeam).toHaveBeenCalledTimes(3);
    for (const profileId of [9, 21, 31]) expect(ownership.findCleanerPortalTeam).toHaveBeenCalledWith(roster.client, profileId);
    expect(JSON.stringify(result)).not.toContain("SYNTHETIC_PRIVATE");
  });
  it.each([
    ["missing scheduling row", "missing_scheduling_team", () => { roster.state.scheduling_teams = roster.state.scheduling_teams.filter(row => row.id !== 4); }],
    ["inactive scheduling row", "inactive_scheduling_team", () => { teamFour().isActive = 0; }],
    ["archived scheduling row", "inactive_scheduling_team", () => { teamFour().isArchived = 1; }],
    ["unmapped scheduling row", "unmapped_team", () => { teamFour().launch27TeamId = null; }],
    ["missing account", "missing_cleaner_account", () => { roster.state.cleaner_profiles = roster.state.cleaner_profiles.filter(row => row.id !== 9); }],
    ["inactive account", "inactive_cleaner_account", () => { profileForFour().isActive = 0; }],
    ["non-one activity flag", "inactive_cleaner_account", () => { profileForFour().isActive = 2; }],
    ["unlinked same name account", "missing_cleaner_account", () => { profileForFour().launch27TeamId = null; }],
    ["wrong stable ID same name account", "missing_cleaner_account", () => { profileForFour().launch27TeamId = 444; }],
    ["duplicate active accounts", "ambiguous_cleaner_accounts", () => { roster.state.cleaner_profiles.push({ ...profileForFour(), id: 90 }); }],
    ["active and inactive accounts", "ambiguous_cleaner_accounts", () => { roster.state.cleaner_profiles.push({ ...profileForFour(), id: 90, isActive: 0 }); }],
    ["duplicate scheduling ID", "ambiguous_team_mapping", () => { roster.state.scheduling_teams.push({ ...teamFour(), launch27TeamId: 555 }); }],
    ["out-of-snapshot duplicate stable scheduling link", "ambiguous_team_mapping", () => { roster.state.scheduling_teams.push({ ...teamFour(), id: 998 }); }],
    ["inactive archived duplicate stable scheduling link", "ambiguous_team_mapping", () => { roster.state.scheduling_teams.push({ ...teamFour(), id: 998, isActive: 0, isArchived: 1 }); }],
  ] as const)("returns explicit unavailable for %s without creating or selecting a guessed account", async (_name, reason, change) => {
    change();
    const result = await invoke();
    expect(result.teamAccounts["4"]).toEqual({ cleanerProfileId: null, reason });
    expect(result.publication.teams).toEqual(snapshot.publication.teams);
    expect(result.details).toEqual(snapshot.details);
    expect(ownership.findCleanerPortalTeam).not.toHaveBeenCalledWith(roster.client, 9);
  });
  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])("fails closed for invalid stable scheduling ID %s", async id => {
    teamFour().launch27TeamId = id;
    expect((await invoke()).teamAccounts["4"]).toEqual({ cleanerProfileId: null, reason: "unmapped_team" });
  });
  it.each([
    { rows: [] }, { rows: [{ cleanerProfileId: 9, launch27TeamId: null, schedulingTeamId: 4, payPercent: null }] },
    { rows: [{ cleanerProfileId: 999, launch27TeamId: 222, schedulingTeamId: 4, payPercent: null }] },
    { rows: [{ cleanerProfileId: 9, launch27TeamId: 999, schedulingTeamId: 4, payPercent: null }] },
    { rows: [{ cleanerProfileId: 9, launch27TeamId: 222, schedulingTeamId: 9, payPercent: null }] },
    { rows: [{ cleanerProfileId: 9, launch27TeamId: 222, schedulingTeamId: null, payPercent: null }] },
  ])("fails closed if the unchanged resolver sees missing or mismatched identity %j", async ({ rows }) => {
    roster.resolverRows = rows;
    expect((await invoke()).teamAccounts["4"]).toEqual({ cleanerProfileId: null, reason: "unavailable_mapping" });
    expect(ownership.findCleanerPortalTeam).toHaveBeenCalledWith(roster.client, 9);
  });
  it("fails closed if reverse mapping disappears between forward and reverse SELECTs", async () => {
    roster.reverseRows = [];
    expect((await invoke()).teamAccounts["4"]).toEqual({ cleanerProfileId: null, reason: "ambiguous_team_mapping" });
    expect(ownership.findCleanerPortalTeam).not.toHaveBeenCalled();
  });
  it("does not cache roster identity across reads", async () => {
    const caller = await staffCaller();
    expect((await caller.forAdmin()).teamAccounts["4"]).toEqual({ cleanerProfileId: 9 });
    profileForFour().isActive = 0;
    expect((await caller.forAdmin()).teamAccounts["4"]).toEqual({ cleanerProfileId: null, reason: "inactive_cleaner_account" });
  });
  it.each(["cleaner_profiles", "scheduling_teams"] as const)("rejects %s read failure instead of fabricating mappings", async table => {
    roster.failTable = table;
    await expect(invoke()).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR", cause: { cause: { message: "Synthetic roster read failure" } } });
  });
  it("returns an empty roster for an empty snapshot without any SQL", async () => {
    expect(await readTeamLeaderboardAdminAccounts(roster.client as any, [])).toEqual({});
    expect(roster.queries).toEqual([]);
  });
});

describe("public-only admin projection and exact existing cleaner boundary", () => {
  it("preserves approved teams/details/period and unchanged scores without private incidents or fake own identity", async () => {
    const result = await invoke();
    expect(result.publication).toEqual({ ...snapshot.publication, ownIncidents: [] });
    expect(result.details).toEqual(snapshot.details);
    expect(result.period).toEqual(snapshot.period);
    expect(rankAssessedScores(result.publication.teams, result.details)).toEqual(rankAssessedScores(snapshot.publication.teams, snapshot.details));
    expect(result).not.toHaveProperty("ownTeamId");
    expect(result).not.toHaveProperty("cleanerProfileId");
    const serialized = JSON.stringify(result);
    for (const incident of snapshot.publication.ownIncidents) {
      expect(serialized).not.toContain(incident.summary);
      expect(serialized).not.toContain(incident.outcome);
    }
    expect(serialized).not.toMatch(/"(?:phone|passwordHash|payPercent|token|url|quotes|evidenceId|rejectedCandidates)"/);
  });
  it("copies explicit public fields without private review metadata, mutation or sharing references", () => {
    const source = structuredClone(snapshot) as TeamLeaderboardSnapshot & Row;
    const secret = "SYNTHETIC_PRIVATE_REVIEW";
    source.unresolved = secret;
    (source.publication as any).token = secret;
    (source.publication.teams[0] as any).private = secret;
    (source.publication.teams[0].metrics.eta as any).quotes = secret;
    (source.details["4"] as any).quotes = secret;
    (source.details["4"].metricDisplay.eta as any).private = secret;
    source.details["unpublished"] = { ...source.details["4"], metricNotes: secret } as any;
    (source.period as any).private = secret;
    const before = structuredClone(source);
    const result = restrictTeamLeaderboardAdminPublication(source);
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(source).toEqual(before);
    result.publication.teams[0].metrics.eta.successful = 999;
    result.details["4"].metricDisplay.eta.value = "changed";
    result.details["4"].metricNotes.eta = "changed";
    result.period!.coverageEnd = "changed";
    result.publication.ownIncidents.push({ id: "synthetic", teamId: "4", date: "2026-11-20", summary: "synthetic", outcome: "synthetic", sourceLabel: "synthetic" });
    expect(source).toEqual(before);
    expect(readTeamLeaderboardAdminPublication()).toEqual({ ...snapshot, publication: { ...snapshot.publication, ownIncidents: [] } });
  });
  it("omits optional period and does not invent missing public team details", () => {
    const source = structuredClone(snapshot) as TeamLeaderboardSnapshot;
    delete source.period;
    delete source.details["4"];
    const result = restrictTeamLeaderboardAdminPublication(source);
    expect(result).not.toHaveProperty("period");
    expect(result.details["4"]).toBeUndefined();
    expect(result.publication.teams).toEqual(snapshot.publication.teams);
  });
  it("leaves forMe cookie-owned identity and private feedback isolation unchanged, never exposing teamAccounts", async () => {
    const token = await signCleanerSession({ cleanerId: 9, cleanerName: "Synthetic cleaner", cleanerPhone: "+12025550199" });
    const result = await callerWithCookie(`${CLEANER_COOKIE_NAME}=${token}`).forMe();
    expect(result).toMatchObject({ cleanerProfileId: 9, ownTeamId: "4" });
    expect(result).not.toHaveProperty("teamAccounts");
    expect(result).not.toHaveProperty("agentId");
    expect(result.publication.ownIncidents).toEqual(snapshot.publication.ownIncidents.filter(row => row.teamId === "4"));
    expect(boundary.getAgentById).not.toHaveBeenCalled();
  });
  it("adds only a no-input read query; scoped sources have no writes, sends, link generation or forbidden legacy references", () => {
    const procedure = teamLeaderboardPublicationRouter._def.procedures.forAdmin;
    expect(procedure._def.type).toBe("query");
    expect(procedure._def.inputs).toEqual([]);
    const routerSource = readFileSync(new URL("./teamLeaderboardPublicationRouter.ts", import.meta.url), "utf8");
    expect(routerSource).toContain('forAdmin: agentPageProcedure("quality").query');
    expect(routerSource).toContain("if (!ctx.agent.isAdmin)");
    expect(readFileSync(new URL("./leadflowJobsRouter.ts", import.meta.url), "utf8")).toContain("leaderboard: teamLeaderboardPublicationRouter");
    const legacy = new RegExp(["cleaner", "[_]?", "[jJ]obs"].join(""));
    for (const path of ["./teamLeaderboardPublicationRouter.ts", "./teamLeaderboardPublication.ts", "./teamLeaderboardAdminAccounts.ts", "./teamLeaderboardAdminAccess.test.ts"]) {
      const source = readFileSync(new URL(path, import.meta.url), "utf8");
      expect(source).not.toMatch(legacy);
      if (path.endsWith(".test.ts")) continue;
      expect(source).not.toMatch(/\.\s*(?:insert|update|delete|mutation)\s*\(|\b(?:sendSms|generateMagicLink|getMagicLink|opsChatProcedure|invokeLLM|fetch|setInterval|scheduleTask)\b/);
    }
  });
});
