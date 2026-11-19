import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { drizzle } from "drizzle-orm/mysql-proxy";
import { leadflowJobs } from "../drizzle/schema";
import type { TrpcContext } from "./_core/context";
import * as portal from "./cleanerPortalOwnership";

const boundary = vi.hoisted(() => ({
  getDb: vi.fn(), getAgentById: vi.fn(), getPool: vi.fn(() => null), auth: vi.fn(),
  refresh: vi.fn(), broadcast: vi.fn(), provider: vi.fn(),
}));
vi.mock("./db", () => ({ getDb: boundary.getDb, getAgentById: boundary.getAgentById, getPool: boundary.getPool }));
vi.mock("./_core/agentAuth", () => ({ getAgentFromRequest: boundary.auth }));
vi.mock("./_core/env", () => ({ ENV: { cookieSecret: "synthetic-offline-secret" } }));
vi.mock("./cleanerPortalUpdates", () => ({ broadcastCleanerPortalJobsChanged: boundary.refresh }));
vi.mock("./sseBroadcast", () => ({ broadcastOpsUpdate: boundary.broadcast }));
vi.mock("./openphone", () => ({ sendSms: boundary.provider }));
vi.mock("./launch27", () => ({ getCompletedBookingsForDate: boundary.provider }));
vi.mock("./stripeClient", () => ({ getStripeClient: boundary.provider }));
vi.mock("./_core/llm", () => ({ invokeLLM: boundary.provider }));

import { repairAprilPortalLink } from "./aprilPortalLinkRepair";
import { bookingsRouter } from "./bookingsRouter";

type Row = Record<string, any>;
type Query = { sql: string; params: unknown[] };
const result = { cleanerProfileId: 300002, schedulingTeamId: 13, launch27TeamId: 41996 };
const confirmation = { confirmation: "LINK_APRIL_300002_TO_41996" } as const;
const stamp = "2026-11-10 13:00:00.000";
const profile = (overrides: Row = {}): Row => ({
  id: 300002, name: "April", isActive: 1, launch27TeamId: null,
  phone: "+12025550101", email: "april@example.invalid", passwordHash: "synthetic-hash",
  payPercent: "0.43", language: "es", createdAt: stamp, updatedAt: stamp, ...overrides,
});
const team = (overrides: Row = {}): Row => ({
  id: 13, name: "April", launch27TeamId: 41996, isActive: 1, isArchived: 0,
  homeAddress: "Synthetic base", homeLat: 38, homeLng: -77, maxHoursPerDay: 6,
  skills: "deep_clean", color: "#123456", minJobs: 2, maxJobs: 3, earliestStartTime: "09:00",
  tag: "Synthetic", regionTags: "DC", createdAt: stamp, updatedAt: stamp, ...overrides,
});

// Real schema, Drizzle SQL, service and portal mapper execute against bounded
// synthetic storage. mysql-proxy has no transactions: this adapter snapshots
// local state only. FOR UPDATE is asserted, NOT a MySQL locking/isolation claim.
// MySQL's automatic April updatedAt behavior is not simulated or asserted here.
class FixtureDb {
  state: Record<string, Row[]> = {
    cleaner_profiles: [profile(), profile({ id: 300003, name: "Other synthetic profile", launch27TeamId: 50003, isActive: 0 })],
    scheduling_teams: [team(), team({ id: 41996, name: "Local ID collision", launch27TeamId: 13 })],
    bookings: [{ id: 7, status: "confirmed", assignmentStatus: "assigned", priceSnapshot: { unchanged: true } }],
    booking_assignments: [{ id: 1, bookingId: 7, teamId: 13, status: "assigned" }],
    booking_payment_profiles: [{ id: 1, bookingId: 7, paymentLast4: "4242" }],
  };
  queries: Query[] = [];
  attempts: Query[] = [];
  writes: Query[] = [];
  transactions = 0;
  rollbacks = 0;
  failSelectAt = 0;
  failUpdate = false;
  dropUpdate = false;
  corruptReadback: Row | "missing" | null = null;
  private selectCount = 0;
  private insideTransaction = false;
  client = drizzle(async (sql, params) => this.execute(sql, params));

  constructor() {
    this.client.transaction = (async (callback: (tx: typeof this.client) => Promise<unknown>) => {
      expect(this.insideTransaction).toBe(false);
      this.transactions++;
      const saved = structuredClone(this.state), writes = structuredClone(this.writes);
      this.insideTransaction = true;
      try { return await callback(this.client); }
      catch (error) { this.state = saved; this.writes = writes; this.rollbacks++; throw error; }
      finally { this.insideTransaction = false; }
    }) as typeof this.client.transaction;
  }

  private predicate(where: string, params: unknown[]) {
    const terms = where.match(/`[^`]+`\.`[^`]+` (?:= \?|is null)/g) ?? [];
    expect(where.replace(/`[^`]+`\.`[^`]+` (?:= \?|is null)/g, "").replace(/[()\s]/g, "").replace(/and/g, "")).toBe("");
    let offset = 0;
    const clauses = terms.map(term => {
      const parsed = /^`([^`]+)`\.`([^`]+)` (= \?|is null)$/.exec(term)!;
      expect(["cleaner_profiles", "scheduling_teams"]).toContain(parsed[1]);
      return { field: parsed[2], value: parsed[3] === "is null" ? null : params[offset++] };
    });
    expect(offset).toBe(params.length);
    return (row: Row) => clauses.every(({ field, value }) => row[field] === value);
  }

  private async execute(sql: string, params: unknown[]) {
    expect(this.insideTransaction, "Every storage operation must run inside the transaction").toBe(true);
    const query = { sql, params: structuredClone(params) };
    this.queries.push(query);
    for (const match of sql.matchAll(/\b(?:from|join|update) `([^`]+)`/g)) {
      expect(["cleaner_profiles", "scheduling_teams"]).toContain(match[1]);
    }
    if (sql.startsWith("select ")) {
      this.selectCount++;
      if (this.failSelectAt === this.selectCount) throw new Error("Synthetic SELECT failure");
      const join = sql.includes(" left join ");
      let projection: string, rows: Record<string, Row | null>[];
      if (join) {
        const parsed = /^select (.+) from `cleaner_profiles` left join `scheduling_teams` on `scheduling_teams`\.`launch27TeamId` = `cleaner_profiles`\.`launch27TeamId` where `cleaner_profiles`\.`id` = \? limit \?$/.exec(sql);
        if (!parsed) throw new Error(`Unsupported mapper SQL: ${sql}`);
        expect(params).toEqual([300002, 1]);
        projection = parsed[1];
        rows = this.state.cleaner_profiles.filter(row => row.id === params[0]).flatMap(row => {
          const matches = row.launch27TeamId === null ? [] : this.state.scheduling_teams.filter(candidate => candidate.launch27TeamId === row.launch27TeamId);
          return (matches.length ? matches : [null]).map(candidate => ({ cleaner_profiles: row, scheduling_teams: candidate }));
        }).slice(0, 1);
        if (this.corruptReadback === "missing") rows = [];
      } else {
        const parsed = /^select (.+) from `(cleaner_profiles|scheduling_teams)` where (.+?)(?: limit \?)? for update$/.exec(sql);
        if (!parsed) throw new Error(`Unsupported locked SELECT: ${sql}`);
        projection = parsed[1];
        const filteredParams = sql.includes(" limit ?") ? params.slice(0, -1) : params;
        const selected = this.state[parsed[2]].filter(this.predicate(parsed[3], filteredParams));
        rows = (sql.includes(" limit ?") ? selected.slice(0, Number(params.at(-1))) : selected).map(row => ({ [parsed[2]]: row }));
      }
      const fields = projection.split(", ").map(field => {
        const parsed = /^(?:`([^`]+)`\.)?`([^`]+)`$/.exec(field);
        if (!parsed) throw new Error(`Unsupported projection: ${field}`);
        return { table: parsed[1] ?? / from `([^`]+)`/.exec(sql)![1], field: parsed[2] };
      });
      return { rows: rows.map(row => fields.map(({ table, field }) => {
        const corrupt = join && this.corruptReadback && this.corruptReadback !== "missing" ? this.corruptReadback : null;
        const key = `${table}.${field}`;
        return structuredClone(corrupt && Object.hasOwn(corrupt, key) ? corrupt[key] : row[table]?.[field] ?? null);
      })) };
    }
    const parsed = /^update `cleaner_profiles` set `launch27TeamId` = \? where (.+)$/.exec(sql);
    if (!parsed) throw new Error(`Unauthorized fixture write: ${sql}`);
    this.attempts.push(query);
    if (this.failUpdate) throw new Error("Synthetic UPDATE failure");
    expect(params[0]).toBe(41996);
    const selected = this.state.cleaner_profiles.filter(this.predicate(parsed[1], params.slice(1)));
    if (!this.dropUpdate) selected.forEach(row => { row.launch27TeamId = params[0]; });
    this.writes.push(query);
    return { rows: [{ affectedRows: this.dropUpdate ? 0 : selected.length, insertId: 0 }] };
  }
}

let fixture: FixtureDb;
const context = { req: {}, res: {}, user: null } as TrpcContext;
const caller = () => bookingsRouter.createCaller(context);
const agent = { id: 3, name: "Synthetic admin", email: "admin@example.invalid", isAdmin: 1, isActive: 1, pagePermissions: '["bookings"]' };
const repair = () => repairAprilPortalLink(fixture.client as any);
const lockedReads = () => fixture.queries.filter(query => query.sql.endsWith(" for update"));
function unchanged(before: Record<string, Row[]>, attemptedWrites = 0) {
  expect(fixture.state).toEqual(before);
  expect(fixture.attempts).toHaveLength(attemptedWrites);
  expect(fixture.writes).toEqual([]);
}
function linkedOnlyApril(before: Record<string, Row[]>) {
  expect(fixture.state).toEqual({ ...before,
    cleaner_profiles: before.cleaner_profiles.map(row => row.id === 300002 ? { ...row, launch27TeamId: 41996 } : row),
  });
  expect(fixture.writes).toEqual([{
    sql: "update `cleaner_profiles` set `launch27TeamId` = ? where (`cleaner_profiles`.`id` = ? and `cleaner_profiles`.`name` = ? and `cleaner_profiles`.`isActive` = ? and `cleaner_profiles`.`launch27TeamId` is null)",
    params: [41996, 300002, "April", 1],
  }]);
  expect(fixture.transactions).toBe(1);
  expect(fixture.rollbacks).toBe(0);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Unexpected network request"); }));
  boundary.provider.mockImplementation(() => { throw new Error("Provider disabled"); });
  boundary.auth.mockResolvedValue({ agentId: 3, agentName: "Synthetic session", agentEmail: agent.email, isAdmin: true });
  boundary.getAgentById.mockResolvedValue(structuredClone(agent));
  fixture = new FixtureDb();
  boundary.getDb.mockResolvedValue(fixture.client);
  vi.spyOn(portal, "findCleanerPortalTeam"); // Call-through, never replace the mapper.
});
afterEach(() => {
  expect(boundary.provider).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
  expect(boundary.refresh).not.toHaveBeenCalled();
  expect(boundary.broadcast).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("April-only portal link repair with real Drizzle SQL (offline)", () => {
  it("changes exactly the null link, locks all candidates, and reuses the canonical mapper/local ownership ID", async () => {
    const before = structuredClone(fixture.state);
    expect(await repair()).toEqual({ ...result, changed: true });
    linkedOnlyApril(before);
    expect(lockedReads()).toHaveLength(3);
    expect(lockedReads()[0]).toEqual({
      sql: "select `id`, `name`, `isActive`, `launch27TeamId` from `cleaner_profiles` where `cleaner_profiles`.`id` = ? for update", params: [300002],
    });
    expect(lockedReads()[1]).toEqual({
      sql: "select `id`, `name`, `isActive`, `isArchived`, `launch27TeamId` from `scheduling_teams` where `scheduling_teams`.`launch27TeamId` = ? for update",
      params: [41996],
    });
    expect(lockedReads()[2]).toEqual({
      sql: "select `id` from `cleaner_profiles` where `cleaner_profiles`.`launch27TeamId` = ? for update", params: [41996],
    });
    expect(portal.findCleanerPortalTeam).toHaveBeenCalledTimes(1);
    expect(portal.findCleanerPortalTeam).toHaveBeenCalledWith(fixture.client, 300002);
    const mapping = await fixture.client.transaction(tx => portal.findCleanerPortalTeam(tx, 300002));
    expect(mapping).toEqual({ ...result, payPercent: "0.43" });
    const ownershipSql = fixture.client.select().from(leadflowJobs).where(portal.cleanerPortalJobOwnership(mapping!)).toSQL();
    expect(ownershipSql.params).toEqual([41996, 13]);
    expect(ownershipSql.sql).toContain("active_assignment.teamId = ?");
    expect(ownershipSql.sql).toContain("active_assignment.status = 'assigned'");
    expect(ownershipSql.sql).toContain("`leadflow_jobs`.`teamId` = ?");
  });
  it("already linked is idempotent, validates mapping, and writes nothing", async () => {
    fixture.state.cleaner_profiles[0].launch27TeamId = 41996;
    const before = structuredClone(fixture.state);
    expect(await repair()).toEqual({ ...result, changed: false });
    unchanged(before);
    expect(portal.findCleanerPortalTeam).toHaveBeenCalledWith(fixture.client, 300002);
    expect(fixture.transactions).toBe(1);
  });
  it.each([
    ["missing", null], ["wrong ID", { id: 300099 }], ["wrong name", { name: "Not April" }],
    ["inactive", { isActive: 0 }], ["non-exact active flag", { isActive: 2 }], ["other link", { launch27TeamId: 50099 }],
  ])("rejects %s April before writes", async (_label, overrides) => {
    if (overrides === null) fixture.state.cleaner_profiles.shift();
    else Object.assign(fixture.state.cleaner_profiles[0], overrides);
    const before = structuredClone(fixture.state);
    await expect(repair()).rejects.toMatchObject({ code: "CONFLICT" });
    unchanged(before);
    expect(fixture.rollbacks).toBe(1);
  });
  it.each([
    ["missing", null], ["wrong local ID", { id: 14 }], ["wrong name", { name: "Not April" }],
    ["inactive", { isActive: 0 }], ["archived", { isArchived: 1 }], ["wrong Launch27 ID", { launch27TeamId: 50099 }],
    ["duplicate active", { duplicate: 1 }], ["duplicate inactive", { duplicate: 0 }],
  ])("rejects %s target rather than substituting another team", async (_label, overrides) => {
    if (overrides === null) fixture.state.scheduling_teams.shift();
    else if ("duplicate" in overrides) fixture.state.scheduling_teams.push(team({ id: 14, isActive: overrides.duplicate }));
    else Object.assign(fixture.state.scheduling_teams[0], overrides);
    const before = structuredClone(fixture.state);
    await expect(repair()).rejects.toMatchObject({ code: "CONFLICT" });
    unchanged(before);
    expect(fixture.rollbacks).toBe(1);
  });
  it.each([
    ["active", 1, "Other owner"], ["inactive", 0, "Other owner"], ["ghost", 0, "April"],
  ])("blocks any %s other owner without changing either account", async (_label, isActive, name) => {
    fixture.state.cleaner_profiles.push(profile({ id: 300004, name, isActive, launch27TeamId: 41996 }));
    const before = structuredClone(fixture.state);
    await expect(repair()).rejects.toMatchObject({ code: "CONFLICT" });
    unchanged(before);
    expect(lockedReads().at(-1)?.sql).toBe("select `id` from `cleaner_profiles` where `cleaner_profiles`.`launch27TeamId` = ? for update");
  });
  it("also rejects an extra inactive owner when April is already linked", async () => {
    fixture.state.cleaner_profiles[0].launch27TeamId = 41996;
    fixture.state.cleaner_profiles.push(profile({ id: 300004, isActive: 0, launch27TeamId: 41996 }));
    const before = structuredClone(fixture.state);
    await expect(repair()).rejects.toMatchObject({ code: "CONFLICT" });
    unchanged(before);
  });
  it.each([1, 2, 3, 4])("SELECT failure at stage %s rolls back (stage 4 is real mapper readback)", async stage => {
    fixture.failSelectAt = stage;
    const before = structuredClone(fixture.state);
    await expect(repair()).rejects.toMatchObject({ cause: { message: "Synthetic SELECT failure" } });
    unchanged(before, stage === 4 ? 1 : 0);
    expect(fixture.rollbacks).toBe(1);
  });
  it("UPDATE failure rolls back without any committed mutation", async () => {
    fixture.failUpdate = true;
    const before = structuredClone(fixture.state);
    await expect(repair()).rejects.toMatchObject({ cause: { message: "Synthetic UPDATE failure" } });
    unchanged(before, 1);
    expect(fixture.rollbacks).toBe(1);
  });
  it.each([
    ["missing", "missing"], ["wrong profile", { "cleaner_profiles.id": 300099 }],
    ["wrong Launch27", { "cleaner_profiles.launch27TeamId": 50099 }],
    ["missing Launch27", { "cleaner_profiles.launch27TeamId": null }],
    ["wrong local team", { "scheduling_teams.id": 41996 }], ["missing local team", { "scheduling_teams.id": null }],
  ])("malformed %s post-update mapping rejects and restores the null link", async (_label, corruption) => {
    fixture.corruptReadback = corruption as Row | "missing";
    const before = structuredClone(fixture.state);
    await expect(repair()).rejects.toMatchObject({ code: "CONFLICT" });
    unchanged(before, 1);
    expect(portal.findCleanerPortalTeam).toHaveBeenCalledTimes(1);
    expect(fixture.rollbacks).toBe(1);
  });
  it("a write that affects no row cannot report success", async () => {
    fixture.dropUpdate = true;
    const before = structuredClone(fixture.state);
    await expect(repair()).rejects.toMatchObject({ code: "CONFLICT" });
    unchanged(before, 1);
    expect(fixture.rollbacks).toBe(1);
  });
});

describe("real bookings caller requires explicit admin confirmation before repair DB access", () => {
  it("authenticated active admin executes the actual helper only on this manual call", async () => {
    expect(fixture.queries).toEqual([]);
    expect(boundary.getDb).not.toHaveBeenCalled();
    const before = structuredClone(fixture.state);
    expect(await caller().repairAprilPortalLink(confirmation)).toEqual({ ...result, changed: true });
    linkedOnlyApril(before);
    expect(boundary.getDb).toHaveBeenCalledTimes(1);
  });
  it.each([undefined, {}, { confirmation: "WRONG" }, { ...confirmation, cleanerProfileId: 300003 }])("rejects missing/wrong/extra repair input %j without repair DB access", async input => {
    const before = structuredClone(fixture.state);
    await expect(caller().repairAprilPortalLink(input as any)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(boundary.getDb).not.toHaveBeenCalled();
    expect(fixture.transactions).toBe(0);
    unchanged(before);
  });
  it.each(["nonadmin", "unauthenticated", "inactive"])("rejects %s before repair DB access despite any session admin claim", async mode => {
    if (mode === "nonadmin") boundary.getAgentById.mockResolvedValue({ ...agent, isAdmin: 0 });
    if (mode === "unauthenticated") boundary.auth.mockResolvedValue(null);
    if (mode === "inactive") boundary.getAgentById.mockResolvedValue({ ...agent, isActive: 0 });
    const before = structuredClone(fixture.state);
    await expect(caller().repairAprilPortalLink(confirmation)).rejects.toMatchObject({ code: mode === "nonadmin" ? "FORBIDDEN" : "UNAUTHORIZED" });
    expect(boundary.getDb).not.toHaveBeenCalled();
    expect(fixture.transactions).toBe(0);
    unchanged(before);
  });
});
