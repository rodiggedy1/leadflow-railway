import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { drizzle } from "drizzle-orm/mysql-proxy";
import { getTableColumns } from "drizzle-orm";
import type { TrpcContext } from "./_core/context";
import { bookingAssignments, bookings, cleanerProfiles, leadflowJobs, schedulingTeams } from "../drizzle/schema";

const boundary = vi.hoisted(() => ({
  getDb: vi.fn(), getAgentById: vi.fn(), getPool: vi.fn(() => null), auth: vi.fn(),
  createCleanerCaller: vi.fn(), getMagicLink: vi.fn(), provider: vi.fn(),
  refresh: vi.fn(), broadcast: vi.fn(), customerLink: vi.fn(), accountRepair: vi.fn(),
}));
vi.mock("./db", () => ({ getDb: boundary.getDb, getAgentById: boundary.getAgentById, getPool: boundary.getPool }));
vi.mock("./_core/agentAuth", () => ({ getAgentFromRequest: boundary.auth }));
vi.mock("./_core/env", () => ({ ENV: { cookieSecret: "synthetic-offline-secret" } }));
// The real bookings router/middleware executes. The existing cleaner caller
// is a tripwire: the read-only lookup must never invoke it.
vi.mock("./cleanerRouter", () => ({ cleanerRouter: { createCaller: boundary.createCleanerCaller } }));
vi.mock("./customerPortalService", () => ({ getOrCreateCustomerPortalMagicLink: boundary.customerLink }));
vi.mock("./aprilPortalLinkRepair", () => ({ repairAprilPortalLink: boundary.accountRepair }));
vi.mock("./cleanerPortalUpdates", () => ({ broadcastCleanerPortalJobsChanged: boundary.refresh }));
vi.mock("./sseBroadcast", () => ({ broadcastOpsUpdate: boundary.broadcast }));
vi.mock("./openphone", () => ({ sendSms: boundary.provider }));
vi.mock("./launch27", () => ({ getCompletedBookingsForDate: boundary.provider }));
vi.mock("./stripeClient", () => ({ getStripeClient: boundary.provider }));
vi.mock("./_core/llm", () => ({ invokeLLM: boundary.provider }));

import { bookingsRouter } from "./bookingsRouter";

// Real schema, real Drizzle SQL/parameter generation and result mapping. This
// read-only fixture interprets only equality/IN/AND, ordered SELECT and LIMIT;
// it is not a live MySQL test and makes no claims about isolation/constraints.
// Unknown SQL, other tables, JOINs, writes and profile-token storage fail closed.
type Row = Record<string, unknown>;
type Query = { sql: string; params: unknown[] };
const tables = {
  bookings, booking_assignments: bookingAssignments, scheduling_teams: schedulingTeams,
  leadflow_jobs: leadflowJobs, cleaner_profiles: cleanerProfiles,
};
type TableName = keyof typeof tables;

class ReadOnlyFixtureDb {
  state: Record<TableName, Row[]> = {
    bookings: [], booking_assignments: [], scheduling_teams: [], leadflow_jobs: [], cleaner_profiles: [],
  };
  queries: Query[] = [];
  unsupported: string[] = [];
  failRead: TableName | null = null;
  // Synthetic changed read-view between forward/reverse mapping SELECTs;
  // leaves persisted fixture state untouched and still applies actual WHERE.
  reverseMappingRows: Row[] | null = null;
  client = drizzle(async (sql, params) => this.execute(sql, params));

  private reject(sql: string): never {
    this.unsupported.push(sql);
    throw new Error(`Unsupported read-only fixture SQL: ${sql}`);
  }

  private async execute(sql: string, params: unknown[]) {
    this.queries.push({ sql, params: structuredClone(params) });
    const parsed = /^select (.+) from `([^`]+)`(?: where (.*?))?(?: order by (.*?))?(?: limit \?)?$/.exec(sql);
    if (!parsed || !Object.hasOwn(tables, parsed[2])) return this.reject(sql);
    const [, projection, table, where, order] = parsed;
    const tableName = table as TableName;
    const columns = getTableColumns(tables[tableName]);
    const validField = (field: string) => Object.values(columns).some(column => column.name === field);
    const filterParams = sql.endsWith(" limit ?") ? params.slice(0, -1) : params;
    let offset = 0;
    const predicates: Array<(row: Row) => boolean> = [];
    if (where) {
      const termPattern = /`([^`]+)`\.`([^`]+)` (= \?|in \((?:\?(?:, )?)+\))/g;
      const terms = [...where.matchAll(termPattern)];
      // Validate the complete expression, never silently ignore a SQL clause.
      if (!terms.length || where.replace(termPattern, "").replace(/[()\s]/g, "").replace(/and/g, "") !== "") return this.reject(sql);
      for (const term of terms) {
        if (term[1] !== table || !validField(term[2])) return this.reject(sql);
        const count = (term[3].match(/\?/g) ?? []).length;
        const values = filterParams.slice(offset, offset + count);
        offset += count;
        predicates.push(row => row[term[2]] !== null && row[term[2]] !== undefined && values.includes(row[term[2]]));
      }
    }
    if (offset !== filterParams.length) return this.reject(sql);
    const readView = tableName === "scheduling_teams" && where?.includes("`launch27TeamId`") && this.reverseMappingRows !== null
      ? this.reverseMappingRows : this.state[tableName];
    let rows = readView.filter(row => predicates.every(predicate => predicate(row)));
    if (order) {
      const ordering = order.split(", ").map(term => /^`([^`]+)`\.`([^`]+)` (asc|desc)$/.exec(term));
      if (ordering.some(term => !term || term[1] !== table || !validField(term[2]))) return this.reject(sql);
      rows = [...rows].sort((left, right) => {
        for (const term of ordering) {
          const [, , field, direction] = term!;
          const a = left[field] as number | string, b = right[field] as number | string;
          const comparison = a === b ? 0 : a < b ? -1 : 1;
          if (comparison) return direction === "desc" ? -comparison : comparison;
        }
        return 0;
      });
    }
    if (sql.endsWith(" limit ?")) rows = rows.slice(0, Number(params.at(-1)));
    const fields: string[] = [];
    for (const field of projection.split(", ")) {
      const column = /^(?:`([^`]+)`\.)?`([^`]+)`$/.exec(field);
      if (!column || (column[1] && column[1] !== table) || !validField(column[2])) return this.reject(sql);
      fields.push(column[2]);
    }
    if (this.failRead === tableName) throw new Error(`Synthetic ${table} read failure`);
    return { rows: rows.map(row => fields.map(field => structuredClone(row[field] ?? null))) };
  }
}

const agent = { id: 3, name: "Synthetic Bookings staff", email: "staff@example.invalid", isAdmin: 0, isActive: 1, pagePermissions: '["bookings"]' };
const context = { req: { headers: {} }, res: {}, user: null } as TrpcContext;
const origin = "https://staff.example.invalid:8443";
const engineLink = { url: "https://portal.example.invalid/auth/cleaner-callback?token=synthetic-existing-token", cleanerName: "Portal account name" };
const input = { source: "booking" as const, id: 7 };
const importedInput = { source: "leadflow" as const, id: 7 };
const oldStamp = "2026-11-10 13:00:00.000";
const currentStamp = "2026-11-19 17:00:00.000";
function assignment(overrides: Row = {}): Row {
  return { id: 1, bookingId: 7, teamId: 13, teamName: "Assigned team history", status: "assigned", assignedAt: currentStamp, ...overrides };
}
function profile(overrides: Row = {}): Row {
  return { id: 501, launch27TeamId: 41996, isActive: 1, name: "Portal account name", phone: "+12025550101", ...overrides };
}
let fixture: ReadOnlyFixtureDb;
const queriesFor = (table: TableName) => fixture.queries.filter(query => query.sql.includes(` from \`${table}\``));
async function invoke(...args: [] | [Parameters<ReturnType<typeof bookingsRouter.createCaller>["teamPortalProfile"]>[0]]) {
  const value = args.length === 0 ? input : args[0];
  const before = structuredClone(fixture.state);
  try { return await bookingsRouter.createCaller(context).teamPortalProfile(value); }
  finally { expect(fixture.state).toEqual(before); }
}
function expectNoEngine() {
  expect(boundary.createCleanerCaller).not.toHaveBeenCalled();
  expect(boundary.getMagicLink).not.toHaveBeenCalled();
}
function expectEngine(_profileId: number) {
  // Resolving the assigned account must never call the working token engine.
  expectNoEngine();
}
function expectProfileLookup(teamId: number) {
  expect(queriesFor("cleaner_profiles")).toEqual([{
    sql: "select `id`, `isActive` from `cleaner_profiles` where `cleaner_profiles`.`launch27TeamId` = ? limit ?",
    params: [teamId, 2],
  }]);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Network disabled in focused fixture"); }));
  boundary.provider.mockImplementation(() => { throw new Error("External provider disabled"); });
  boundary.customerLink.mockImplementation(() => { throw new Error("Customer account path disabled"); });
  boundary.accountRepair.mockImplementation(() => { throw new Error("Account repair path disabled"); });
  boundary.auth.mockResolvedValue({ agentId: agent.id, agentName: "Synthetic cookie name", agentEmail: agent.email, isAdmin: false });
  boundary.getAgentById.mockResolvedValue(structuredClone(agent));
  boundary.createCleanerCaller.mockReturnValue({ getMagicLink: boundary.getMagicLink });
  boundary.getMagicLink.mockResolvedValue(structuredClone(engineLink));
  fixture = new ReadOnlyFixtureDb();
  fixture.state = {
    bookings: [{ id: 7 }, { id: 8 }],
    booking_assignments: [assignment(), assignment({ id: 2, bookingId: 8, teamId: 41996, teamName: "Other booking" })],
    scheduling_teams: [
      { id: 13, launch27TeamId: 41996, name: "Renamed current directory", isActive: 1, isArchived: 0 },
      { id: 41996, launch27TeamId: 13, name: "Local ID collision", isActive: 1, isArchived: 0 },
    ],
    // Same numerical booking/job ID deliberately identifies different sources.
    leadflow_jobs: [{ id: 7, bookingId: null, launch27BookingId: 70007, origin: "launch27_import", teamId: 13, teamName: "Imported authoritative team" }],
    cleaner_profiles: [profile(), profile({ id: 502, launch27TeamId: 13, name: "Collision profile" })],
  };
  boundary.getDb.mockResolvedValue(fixture.client);
});
afterEach(() => {
  expect(fixture.unsupported).toEqual([]);
  expect(boundary.provider).not.toHaveBeenCalled();
  expect(boundary.customerLink).not.toHaveBeenCalled();
  expect(boundary.accountRepair).not.toHaveBeenCalled();
  expect(boundary.refresh).not.toHaveBeenCalled();
  expect(boundary.broadcast).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("bookings.teamPortalProfile read-only assigned-account lookup (offline)", () => {
  it("maps native local team 13 to Launch27 41996, never the colliding local/profile ID", async () => {
    expect(await invoke()).toEqual({ cleanerProfileId: 501, source: "booking", id: 7, teamName: "Assigned team history" });
    expectEngine(501);
    expectProfileLookup(41996);
    expect(queriesFor("bookings")).toEqual([{ sql: "select `id` from `bookings` where `bookings`.`id` = ? limit ?", params: [7, 1] }]);
    expect(queriesFor("scheduling_teams")).toEqual([
      { sql: "select `launch27TeamId` from `scheduling_teams` where `scheduling_teams`.`id` = ? limit ?", params: [13, 1] },
      { sql: "select `id` from `scheduling_teams` where `scheduling_teams`.`launch27TeamId` = ? limit ?", params: [41996, 2] },
    ]);
    expect(queriesFor("leadflow_jobs")).toEqual([]);
  });
  it("uses imported teamId directly in the Launch27 namespace with no scheduling-team read", async () => {
    expect(await invoke(importedInput)).toEqual({ cleanerProfileId: 502, source: "leadflow", id: 7, teamName: "Imported authoritative team" });
    expectEngine(502);
    expectProfileLookup(13);
    expect(queriesFor("leadflow_jobs")).toEqual([{ sql: "select `bookingId`, `teamId`, `teamName` from `leadflow_jobs` where `leadflow_jobs`.`id` = ? limit ?", params: [7, 1] }]);
    for (const table of ["bookings", "booking_assignments", "scheduling_teams"] as const) expect(queriesFor(table)).toEqual([]);
  });
  it("selects the latest active assignment using actual SQL status/booking filters and descending date/id tie-break", async () => {
    fixture.state.booking_assignments = [
      assignment({ id: 100, teamId: 41996, assignedAt: oldStamp }),
      assignment({ id: 10, teamId: 41996 }),
      assignment({ id: 99, status: "unassigned", assignedAt: "2026-11-20 17:00:00.000" }),
      assignment({ id: 98, status: "cancelled", assignedAt: "2026-11-20 17:00:00.000" }),
      assignment({ id: 97, bookingId: 8, teamId: 41996, assignedAt: "2026-11-20 17:00:00.000" }),
      assignment({ id: 11, teamName: "Latest active authoritative team" }),
    ];
    expect(await invoke()).toEqual({ cleanerProfileId: 501, source: "booking", id: 7, teamName: "Latest active authoritative team" });
    expectEngine(501);
    expect(queriesFor("booking_assignments")).toEqual([{
      sql: "select `bookingId`, `teamId`, `teamName` from `booking_assignments` where (`booking_assignments`.`bookingId` in (?) and `booking_assignments`.`status` = ?) order by `booking_assignments`.`assignedAt` desc, `booking_assignments`.`id` desc",
      params: [7, "assigned"],
    }]);
  });
  it("preserves assigned native team history even when its scheduling directory is now inactive/archived", async () => {
    fixture.state.scheduling_teams[0].isActive = 0;
    fixture.state.scheduling_teams[0].isArchived = 1;
    expect(await invoke()).toEqual({ cleanerProfileId: 501, source: "booking", id: 7, teamName: "Assigned team history" });
    expectEngine(501);
  });
  it.each(["booking", "leadflow"] as const)("returns only the assigned %s account identity, without a URL or token", async source => {
    const result = await invoke({ source, id: 7 });
    expect(result.cleanerProfileId).toBe(source === "booking" ? 501 : 502);
    expect(Object.keys(result).sort()).toEqual(["cleanerProfileId", "id", "source", "teamName"]);
    expectNoEngine();
  });
  it.each(["booking", "leadflow"] as const)("returns null authoritative %s teamName rather than a directory/profile-name fallback", async source => {
    (source === "booking" ? fixture.state.booking_assignments[0] : fixture.state.leadflow_jobs[0]).teamName = null;
    expect(await invoke({ ...input, source })).toEqual({ cleanerProfileId: source === "booking" ? 501 : 502, source, id: 7, teamName: null });
    expectEngine(source === "booking" ? 501 : 502);
  });
});

describe("exact identity and assignment rejection before the token caller", () => {
  it("rejects missing exact native booking despite same-ID imported job and orphan active assignment", async () => {
    fixture.state.bookings = fixture.state.bookings.filter(row => row.id !== 7);
    await expect(invoke()).rejects.toMatchObject({ code: "NOT_FOUND", message: "Booking not found." });
    expect(fixture.queries).toHaveLength(1);
    expectNoEngine();
  });
  it("rejects missing exact imported job despite a native booking and matching Launch27 booking ID elsewhere", async () => {
    fixture.state.leadflow_jobs = [{ ...fixture.state.leadflow_jobs[0], id: 70, launch27BookingId: 7 }];
    await expect(invoke(importedInput)).rejects.toMatchObject({ code: "NOT_FOUND", message: "Imported booking not found." });
    expect(fixture.queries).toHaveLength(1);
    expectNoEngine();
  });
  it.each([7, 8, 0])("rejects imported source when the exact job has non-null native bookingId %s", async bookingId => {
    fixture.state.leadflow_jobs[0].bookingId = bookingId;
    await expect(invoke(importedInput)).rejects.toMatchObject({ code: "NOT_FOUND", message: "Imported booking not found." });
    expect(fixture.queries).toHaveLength(1);
    expectNoEngine();
  });
  it.each(["missing", "unassigned", "cancelled", "null-team"])("rejects native %s assignment without an account/profile fallback", async scenario => {
    fixture.state.booking_assignments = scenario === "missing" ? [] : [assignment(scenario === "null-team" ? { teamId: null } : { status: scenario })];
    await expect(invoke()).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(queriesFor("scheduling_teams")).toEqual([]);
    expect(queriesFor("cleaner_profiles")).toEqual([]);
    expectNoEngine();
  });
  it("rejects missing exact local scheduling team instead of resolving another local team by its Launch27 ID", async () => {
    fixture.state.scheduling_teams = fixture.state.scheduling_teams.filter(row => row.id !== 13);
    await expect(invoke()).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(queriesFor("cleaner_profiles")).toEqual([]);
    expectNoEngine();
  });
  it("does not fall back to an older linked assignment when the latest active team is unlinked", async () => {
    fixture.state.booking_assignments = [assignment({ id: 1, assignedAt: oldStamp }), assignment({ id: 2, teamId: 99 })];
    fixture.state.scheduling_teams.push({ id: 99, launch27TeamId: null });
    await expect(invoke()).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(queriesFor("scheduling_teams")[0].params).toEqual([99, 1]);
    expect(queriesFor("cleaner_profiles")).toEqual([]);
    expectNoEngine();
  });
  it.each([
    ["booking", null], ["booking", 0], ["booking", -1], ["booking", 1.5],
    ["leadflow", null], ["leadflow", 0], ["leadflow", -1], ["leadflow", 1.5],
  ] as const)("rejects %s missing/invalid Launch27 team ID %s before profile/token lookup", async (source, teamId) => {
    if (source === "booking") fixture.state.scheduling_teams[0].launch27TeamId = teamId;
    else fixture.state.leadflow_jobs[0].teamId = teamId;
    await expect(invoke({ ...input, source })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(queriesFor("cleaner_profiles")).toEqual([]);
    expectNoEngine();
  });
  it.each([
    ["missing", []],
    ["unlinked same name/phone", [profile({ launch27TeamId: null })]],
    ["wrong ID same name/phone", [profile({ launch27TeamId: 99999 })]],
    ["inactive", [profile({ isActive: 0 })]],
    ["non-one activity flag", [profile({ isActive: 2 })]],
    ["duplicate active", [profile(), profile({ id: 503 })]],
    ["active plus inactive", [profile(), profile({ id: 503, isActive: 0 })]],
    ["inactive plus active", [profile({ isActive: 0 }), profile({ id: 503 })]],
    ["multiple inactive", [profile({ isActive: 0 }), profile({ id: 503, isActive: 0 })]],
  ] as Array<[string, Row[]]>)("rejects %s exact profile mapping, with no active/name/phone filter hiding ambiguity", async (_scenario, profiles) => {
    fixture.state.cleaner_profiles = profiles;
    await expect(invoke()).rejects.toMatchObject({ code: "CONFLICT" });
    expectProfileLookup(41996);
    expectNoEngine();
  });
  it("rejects an imported team with ambiguous active/inactive profiles, without trying the local ID mapping", async () => {
    fixture.state.cleaner_profiles.push(profile({ id: 503, launch27TeamId: 13, isActive: 0 }));
    await expect(invoke(importedInput)).rejects.toMatchObject({ code: "CONFLICT" });
    expectProfileLookup(13);
    expect(queriesFor("scheduling_teams")).toEqual([]);
    expectNoEngine();
  });
  it("rejects duplicate native directory mappings, including an inactive archived duplicate, before the token caller", async () => {
    fixture.state.scheduling_teams.push({ id: 99, launch27TeamId: 41996, isActive: 0, isArchived: 1 });
    await expect(invoke()).rejects.toMatchObject({ code: "CONFLICT", message: "The assigned team's portal mapping could not be verified." });
    expectProfileLookup(41996);
    expect(queriesFor("scheduling_teams")[1]).toEqual({
      sql: "select `id` from `scheduling_teams` where `scheduling_teams`.`launch27TeamId` = ? limit ?", params: [41996, 2],
    });
    expectNoEngine();
  });
  it.each([
    ["missing", []], ["mismatched local ID", [{ id: 99, launch27TeamId: 41996 }]],
  ] as Array<[string, Row[]]>)("rejects a %s native reverse mapping in a changed read-view before the token caller", async (_scenario, rows) => {
    fixture.reverseMappingRows = rows;
    await expect(invoke()).rejects.toMatchObject({ code: "CONFLICT", message: "The assigned team's portal mapping could not be verified." });
    expectProfileLookup(41996);
    expectNoEngine();
  });
  it("imported identity does not require a local directory mapping, even with duplicate local Launch27 IDs", async () => {
    fixture.state.scheduling_teams = [{ id: 99, launch27TeamId: 13 }, { id: 100, launch27TeamId: 13 }];
    expect(await invoke(importedInput)).toEqual({ cleanerProfileId: 502, source: "leadflow", id: 7, teamName: "Imported authoritative team" });
    expectEngine(502);
    expect(queriesFor("scheduling_teams")).toEqual([]);
  });
});

describe("real Bookings page authorization, strict input and error boundaries", () => {
  it("requires an authenticated agent before the agent lookup, getDb or token caller", async () => {
    boundary.auth.mockResolvedValue(null);
    await expect(invoke()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(boundary.getAgentById).not.toHaveBeenCalled();
    expect(boundary.getDb).not.toHaveBeenCalled();
    expectNoEngine();
  });
  it.each([null, { ...agent, isActive: 0 }])("rejects missing/inactive agent %j before getDb", async value => {
    boundary.getAgentById.mockResolvedValue(value);
    await expect(invoke()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(boundary.getAgentById).toHaveBeenCalledWith(agent.id);
    expect(boundary.getDb).not.toHaveBeenCalled();
    expectNoEngine();
  });
  it.each(['["schedule"]', "[]"])("rejects non-admin without Bookings permission %s before getDb", async pagePermissions => {
    boundary.getAgentById.mockResolvedValue({ ...agent, pagePermissions });
    await expect(invoke()).rejects.toMatchObject({ code: "FORBIDDEN", message: "bookings access required" });
    expect(boundary.getDb).not.toHaveBeenCalled();
    expectNoEngine();
  });
  it.each([
    undefined, {}, { source: "booking" }, { id: 7 },
    { ...input, source: "other" }, { ...input, id: 0 }, { ...input, id: -1 },
    { ...input, id: 1.5 }, { ...input, id: "7" }, { ...input, origin: "https://quote.maidinblack.com" },
    { ...input, cleanerProfileId: 501 }, { ...input, teamId: 13 },
  ])("rejects malformed input or injected target %j before booking DB access", async value => {
    await expect(invoke(value as typeof input)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(boundary.getDb).not.toHaveBeenCalled();
    expectNoEngine();
  });
  it("reports unavailable database without inventing a link", async () => {
    boundary.getDb.mockResolvedValue(null);
    await expect(invoke()).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR", message: "Booking service unavailable." });
    expectNoEngine();
  });
  it.each(["bookings", "booking_assignments", "scheduling_teams", "cleaner_profiles", "leadflow_jobs"] as const)("propagates %s read failure without token invocation or other account actions", async table => {
    fixture.failRead = table;
    await expect(invoke(table === "leadflow_jobs" ? importedInput : input)).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR", cause: { cause: { message: `Synthetic ${table} read failure` } },
    });
    expectNoEngine();
  });
  it("does not execute the existing token caller even if that caller would fail", async () => {
    boundary.getMagicLink.mockRejectedValue(new Error("Token engine must not run during a read"));
    expect(await invoke()).toMatchObject({ cleanerProfileId: 501 });
    expectNoEngine();
  });
});
