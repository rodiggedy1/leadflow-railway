import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { drizzle } from "drizzle-orm/mysql-proxy";
import { eq, getTableColumns } from "drizzle-orm";
import type { TrpcContext } from "./_core/context";
import { bookingAssignments, bookings, leadflowJobs, schedulingTeams } from "../drizzle/schema";
import { bookingServiceIdSchema } from "../shared/booking";

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

import { bookingsRouter } from "./bookingsRouter";
import { businessLocalDateTimeToUtcMs } from "./utils/businessTime";
import { buildRecurringLeadflowJobValues, nextRecurringBusinessDate } from "./leadflowJobsService";

// Real router, real agentPageProcedure, real schema/Drizzle SQL, and the actual
// syncNativeBookingOperationalProjection execute. No successful assignment or
// lifecycle/persistence result is mocked. mysql-proxy itself has no transaction
// support: the fixture supplies snapshot transactions, NOT MySQL isolation,
// locking, constraints, auto-increment gaps, concurrency or trigger semantics.
// This deliberately narrow interpreter accepts only the SQL used by these two
// procedures; any JOIN, profile access, other table, or provider fails closed.
type Row = Record<string, any>;
type Query = { sql: string; params: unknown[] };
const date = "2026-11-19";
const futureDate = "2026-11-26";
const now = new Date("2026-11-19T17:00:00.000Z");
const stamp = "2026-11-19 17:00:00.000";
const oldStamp = "2026-11-10 13:00:00.000";
const sqlTables = { bookings, booking_assignments: bookingAssignments, leadflow_jobs: leadflowJobs, scheduling_teams: schedulingTeams };

function assertSqlBoundary(sql: string) {
  expect(sql).toMatch(/^(select |update |insert into )/);
  expect(sql).not.toMatch(/\bjoin\b/i);
  expect(sql).not.toContain("cleaner_profiles");
  for (const match of sql.matchAll(/\b(?:from|join|update|into) `([^`]+)`/g)) {
    expect(Object.hasOwn(sqlTables, match[1]), `Unexpected table ${match[1]}`).toBe(true);
  }
}

class FixtureDb {
  state: Record<string, Row[]> = {};
  queries: Query[] = [];
  attempts: Query[] = [];
  writes: Query[] = [];
  transactions = 0;
  failRead: string | null = null;
  failWrite: string | null = null;
  failWriteAt = 1;
  client = drizzle(async (sql, params) => this.execute(sql, params));

  constructor() {
    // This is only a transaction adapter. Every callback still performs actual
    // Drizzle SELECT/UPDATE/INSERT through the same isolated fixture client.
    this.client.transaction = (async (callback: (tx: typeof this.client) => Promise<unknown>) => {
      this.transactions++;
      const saved = structuredClone(this.state), writes = structuredClone(this.writes);
      try { return await callback(this.client); }
      catch (error) { this.state = saved; this.writes = writes; throw error; }
    }) as typeof this.client.transaction;
  }

  private predicate(where: string | undefined, params: unknown[]) {
    if (!where) { expect(params).toEqual([]); return (_row: Row) => true; }
    const terms = where.match(/`[^`]+`\.`[^`]+` (?:=|>) \?/g) ?? [];
    // Never silently drop a condition or invent filter behavior.
    expect(where.replace(/`[^`]+`\.`[^`]+` (?:=|>) \?/g, "").replace(/[()\s]/g, "").replace(/and/g, "")).toBe("");
    expect(terms.length).toBe(params.length);
    const clauses = terms.map((term, index) => {
      const parsed = /^`([^`]+)`\.`([^`]+)` (=|>) \?$/.exec(term)!;
      return { table: parsed[1], field: parsed[2], op: parsed[3], value: params[index] };
    });
    return (row: Row) => clauses.every(clause => clause.op === "=" ? row[clause.field] === clause.value : row[clause.field] > clause.value!);
  }

  private async execute(sql: string, params: unknown[]) {
    const query = { sql, params: structuredClone(params) };
    this.queries.push(query);
    assertSqlBoundary(sql);
    if (sql.startsWith("select ")) {
      const parsed = /^select (.+) from `([^`]+)`(?: where (.*?))?(?: order by `([^`]+)`\.`([^`]+)` asc)?(?: limit \?)?$/.exec(sql);
      if (!parsed) throw new Error(`Unsupported fixture SELECT: ${sql}`);
      const [, projection, table, where, orderTable, orderField] = parsed;
      if (this.failRead === table) throw new Error(`Synthetic read failure: ${table}`);
      const filteredParams = sql.endsWith(" limit ?") ? params.slice(0, -1) : params;
      let rows = this.state[table].filter(this.predicate(where, filteredParams));
      if (orderField) {
        expect(orderTable).toBe(table);
        rows = [...rows].sort((a, b) => String(a[orderField]).localeCompare(String(b[orderField])));
      }
      if (sql.endsWith(" limit ?")) rows = rows.slice(0, Number(params.at(-1)));
      const fields = projection.split(", ").map(field => {
        const column = /^(?:`([^`]+)`\.)?`([^`]+)`$/.exec(field);
        if (!column || (column[1] && column[1] !== table)) throw new Error(`Unsupported projection: ${field}`);
        return column[2];
      });
      return { rows: rows.map(row => fields.map(field => structuredClone(row[field] ?? null))) };
    }

    this.attempts.push(query);
    const table = /^(?:update|insert into) `([^`]+)`/.exec(sql)![1];
    const tableAttempt = this.attempts.filter(attempt => attempt.sql.startsWith(`update \`${table}\``) || attempt.sql.startsWith(`insert into \`${table}\``)).length;
    if (this.failWrite === table && tableAttempt === this.failWriteAt) throw new Error(`Synthetic write failure: ${table}`);
    if (sql.startsWith("update ")) {
      const parsed = /^update `([^`]+)` set (.+) where (.+)$/.exec(sql);
      if (!parsed) throw new Error(`Unsupported fixture UPDATE: ${sql}`);
      const fields = parsed[2].split(", ").map(field => {
        const match = /^`([^`]+)` = \?$/.exec(field);
        if (!match) throw new Error(`Unsupported SET: ${field}`);
        return match[1];
      });
      const rows = this.state[table].filter(this.predicate(parsed[3], params.slice(fields.length)));
      const values = Object.fromEntries(fields.map((field, index) => [field, structuredClone(params[index])]));
      rows.forEach(row => Object.assign(row, values));
      this.writes.push(query);
      return { rows: [{ affectedRows: rows.length, insertId: 0 }] };
    }
    const parsed = /^insert into `([^`]+)` \((.+)\) values \((.+)\)$/.exec(sql);
    if (!parsed) throw new Error(`Unsupported fixture INSERT: ${sql}`);
    const fields = parsed[2].split(", ").map(field => {
      const match = /^`([^`]+)`$/.exec(field);
      if (!match) throw new Error(`Unsupported insert column: ${field}`);
      return match[1];
    });
    const tokens = parsed[3].split(", ");
    expect(tokens.length).toBe(fields.length);
    const columns = getTableColumns(sqlTables[table as keyof typeof sqlTables]);
    const id = Math.max(0, ...this.state[table].map(row => row.id)) + 1;
    let offset = 0;
    const row = Object.fromEntries(fields.map((field, index) => {
      if (tokens[index] === "?") return [field, structuredClone(params[offset++])];
      expect(tokens[index]).toBe("default");
      const column = columns[field as keyof typeof columns] as { default?: unknown };
      return [field, field === "id" ? id : ["createdAt", "updatedAt"].includes(field) ? stamp : column.default ?? null];
    }));
    expect(offset).toBe(params.length);
    this.state[table].push(row);
    this.writes.push(query);
    return { rows: [{ insertId: id, affectedRows: 1 }] };
  }
}

function booking(overrides: Row = {}): Row {
  return {
    id: 7, publicBookingNumber: "SYNTHETIC-7", idempotencyKey: "00000000-0000-4000-8000-000000000007", commandHash: "synthetic-hash",
    source: "popup", status: "confirmed", availabilityStatus: "requested", assignmentStatus: "unassigned",
    paymentStatus: "card_on_file", paymentMethod: "invoice", bookedByAgentId: 99, bookedByAgentName: "Original synthetic creator",
    customerName: "Synthetic customer", customerPhone: "+12025550101", customerEmail: "fixture@example.invalid",
    serviceId: "standard", serviceName: "Standard", bedrooms: 2, bathrooms: 1, homeType: "House",
    extras: [{ id: "fixture-extra", label: "Existing extra", quantity: 1, unitPriceCents: 1000, totalCents: 1000 }],
    specialRequestNotes: ["Keep synthetic customer note"], companyNotes: "Existing synthetic company note", address: "100 Synthetic Fixture Road",
    requestedLocalDate: date, requestedLocalTime: "09:00", requestedTimeZone: "America/New_York",
    requestedStartAt: businessLocalDateTimeToUtcMs(date, "09:00", "America/New_York"),
    recurrence: "weekly", recurringIntentStatus: "intent_pending", pricingVersion: "fixture-version",
    firstCleaningTotalCents: 19000, futureVisitTotalCents: 16000, priceSnapshot: { synthetic: true, immutablePrice: 19000 }, expiresAt: null,
    createdAt: oldStamp, updatedAt: oldStamp, ...overrides,
  };
}
function team(overrides: Row): Row {
  return { id: 13, name: "April", launch27TeamId: 41996, isActive: 1, isArchived: 0, skills: null, ...overrides };
}
function job(overrides: Row = {}): Row {
  return {
    id: 70, origin: "native_booking", bookingId: 7, launch27BookingId: null, bookingSeriesId: null,
    jobDate: date, serviceDateTime: `${date}T14:00:00.000Z`, bookingStatus: "assigned",
    customerName: "Synthetic customer", customerPhone: "+12025550101", customerEmail: "fixture@example.invalid",
    jobAddress: "100 Synthetic Fixture Road", serviceName: "Standard", bedrooms: 2, bathrooms: 1,
    extras: '["fixture-extra"]', frequency: "Weekly", teamId: 9, teamName: "Former synthetic team",
    customerNotes: "Keep synthetic customer note\nExisting synthetic company note", jobTotalCents: 19000,
    hasStripeCard: 1, paymentBrand: "visa", paymentLast4: "4242", customerRating: 5,
    nextOccurrenceCreatedAt: oldStamp, createdAt: oldStamp, updatedAt: oldStamp, ...overrides,
  };
}
function assignment(overrides: Row = {}): Row {
  return { id: 1, bookingId: 7, teamId: 9, teamName: "Former synthetic team", status: "assigned",
    assignedByAgentId: 99, assignedAt: oldStamp, unassignedAt: null, createdAt: oldStamp, updatedAt: oldStamp, ...overrides };
}
let fixture: FixtureDb;
const context = { req: {}, res: {}, user: null } as TrpcContext;
const caller = () => bookingsRouter.createCaller(context);
const agent = { id: 3, name: "Synthetic permitted staff", email: "staff@example.invalid", isAdmin: 0, isActive: 1, pagePermissions: '["bookings"]' };
const eligible = [
  team({ id: 13, name: "April", launch27TeamId: 41996 }),
  team({ id: 12, name: "Native only", launch27TeamId: null, skills: "move_out" }),
  team({ id: 14, name: "Inactive profile team", launch27TeamId: 50014, skills: "deep_clean" }),
  team({ id: 15, name: "Unmatched profile team", launch27TeamId: 50015, skills: "standard" }),
  team({ id: 16, name: "Active profile team", launch27TeamId: 50016 }),
  team({ id: 41996, name: "Local ID collision", launch27TeamId: 13 }),
];
const expectedTeams = eligible.map(({ id, name }) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(now);
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Unexpected synthetic network request"); }));
  boundary.provider.mockImplementation(() => { throw new Error("External provider disabled"); });
  boundary.auth.mockResolvedValue({ agentId: 3, agentName: "Synthetic session", agentEmail: agent.email, isAdmin: false });
  boundary.getAgentById.mockResolvedValue(structuredClone(agent));
  fixture = new FixtureDb();
  fixture.state = {
    bookings: [booking(), booking({ id: 8, publicBookingNumber: "SYNTHETIC-8", assignmentStatus: "assigned" })],
    scheduling_teams: [...structuredClone(eligible),
      team({ id: 90, name: "Inactive team", isActive: 0 }),
      team({ id: 91, name: "Archived team", isArchived: 1 }),
      team({ id: 92, name: "Inactive archived team", isActive: 0, isArchived: 1 })],
    // Inert fixtures, never available to the SQL interpreter. April deliberately
    // has no profile; inactive, unmatched and duplicate active profiles cannot
    // filter or multiply eligible teams. No profile data is read or written.
    cleaner_profiles: [
      { id: 1, launch27TeamId: 50014, isActive: 0 },
      { id: 2, launch27TeamId: 999999, isActive: 1 },
      { id: 3, launch27TeamId: 50016, isActive: 1 },
      { id: 4, launch27TeamId: 50016, isActive: 1 },
      { id: 5, launch27TeamId: null, isActive: 1 },
    ],
    booking_assignments: [assignment(), assignment({ id: 2, teamId: 12 }),
      assignment({ id: 3, status: "cancelled" }), assignment({ id: 4, status: "unassigned", unassignedAt: oldStamp }),
      assignment({ id: 5, bookingId: 8 })],
    leadflow_jobs: [job(), job({ id: 71, jobDate: futureDate, serviceDateTime: `${futureDate}T14:00:00.000Z`, jobTotalCents: 16000 }),
      job({ id: 69, jobDate: "2026-11-12", bookingStatus: "completed", jobTotalCents: 9000 }),
      job({ id: 80, bookingId: 8 }), job({ id: 81, bookingId: null, origin: "launch27_import", launch27BookingId: 70081 })],
    booking_series: [{ id: 20, bookingId: 7, status: "intent_pending", frequency: "weekly", anchorLocalDate: date, anchorLocalTime: "09:00", futureVisitTotalCents: 16000 }],
    booking_payment_profiles: [{ id: 30, bookingId: 7, paymentStatus: "card_on_file", stripePaymentMethodId: "synthetic-pm", paymentLast4: "4242" }],
    booking_funnel_records: [{ id: 40, bookingId: 7, stage: "booked", requestedLocalDate: date }],
  };
  boundary.getDb.mockResolvedValue(fixture.client);
});
afterEach(() => {
  fixture.queries.forEach(query => assertSqlBoundary(query.sql));
  expect(boundary.provider).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
  expect(boundary.broadcast).not.toHaveBeenCalled();
  vi.unstubAllGlobals(); vi.useRealTimers(); vi.restoreAllMocks();
});

const teamQueries = () => fixture.queries.filter(query => query.sql.includes(" from `scheduling_teams`"));
function expectUnchangedBeforeWrites(before: Record<string, Row[]>) {
  expect(fixture.state).toEqual(before);
  expect(fixture.attempts).toEqual([]);
  expect(fixture.writes).toEqual([]);
  expect(boundary.refresh).not.toHaveBeenCalled();
}
function expectedNewAssignment(teamId: number, teamName: string) {
  return { id: 6, bookingId: 7, teamId, teamName, status: "assigned", assignedByAgentId: 3,
    assignedAt: stamp, unassignedAt: null, createdAt: stamp, updatedAt: stamp };
}
function expectSavedProjection(before: Record<string, Row[]>, selected: Row) {
  expect(fixture.state.bookings).toEqual(before.bookings.map(row => row.id === 7 ? { ...row, assignmentStatus: "assigned", updatedAt: stamp } : row));
  expect(fixture.state.booking_assignments).toEqual([
    ...before.booking_assignments.map(row => row.bookingId === 7 && row.status === "assigned" ? { ...row, status: "unassigned", unassignedAt: stamp, updatedAt: stamp } : row),
    expectedNewAssignment(selected.id, selected.name),
  ]);
  expect(fixture.state.leadflow_jobs).toEqual(before.leadflow_jobs.map(row => row.bookingId === 7 && row.jobDate >= date ? {
    ...row, teamId: selected.id, teamName: selected.name, updatedAt: stamp,
  } : row));
  for (const table of ["scheduling_teams", "cleaner_profiles", "booking_series", "booking_payment_profiles", "booking_funnel_records"]) expect(fixture.state[table]).toEqual(before[table]);
  expect(fixture.transactions).toBe(1);
  expect(fixture.writes.map(query => query.sql.match(/^(?:update|insert into) `([^`]+)`/)![1])).toEqual([
    "booking_assignments", "booking_assignments", "bookings", "leadflow_jobs", "leadflow_jobs",
  ]);
  expect(boundary.refresh).toHaveBeenCalledTimes(1);
  expect(boundary.refresh).toHaveBeenCalledWith();
}

describe("bookings.teams uses scheduling-team eligibility without profile linkage (offline)", () => {
  it("returns April once, null Launch27 IDs and all profile states uniformly; excludes inactive/archived teams", async () => {
    const before = structuredClone(fixture.state);
    expect(await caller().teams()).toEqual(expectedTeams);
    expect(teamQueries()).toEqual([{ sql: "select `id`, `name` from `scheduling_teams` where (`scheduling_teams`.`isActive` = ? and `scheduling_teams`.`isArchived` = ?) order by `scheduling_teams`.`name` asc", params: [1, 0] }]);
    expect(fixture.queries).toHaveLength(1);
    expect(fixture.transactions).toBe(0);
    expectUnchangedBeforeWrites(before);
  });
  it("eligibility and order are identical with no profiles at all", async () => {
    fixture.state.cleaner_profiles = [];
    expect(await caller().teams()).toEqual(expectedTeams);
    expect(fixture.attempts).toEqual([]);
  });
  it("returns an empty list instead of substituting inactive or archived teams", async () => {
    fixture.state.scheduling_teams = fixture.state.scheduling_teams.filter(row => !row.isActive || row.isArchived);
    expect(await caller().teams()).toEqual([]);
    expect(fixture.attempts).toEqual([]);
  });
});

describe("bookings.assignTeam persists via actual canonical transaction and lifecycle", () => {
  it("assigns April local ID 13, not Launch27 41996, with exact assignment/current/future projection and preserved commercial data", async () => {
    const before = structuredClone(fixture.state);
    expect(await caller().assignTeam({ bookingId: 7, teamId: 13 })).toEqual({ bookingId: 7, teamId: 13, teamName: "April", assignmentStatus: "assigned" });
    expectSavedProjection(before, eligible[0]);
    expect(teamQueries()[0].params).toEqual([13, 1, 0, 1]);
    expect(teamQueries()[0].sql).toContain("`scheduling_teams`.`id` = ?");
    expect(teamQueries()[0].sql).not.toContain("launch27TeamId");
  });
  it.each(eligible.map(row => [row.id, row.name] as const))("every eligible local team %s (%s) can be assigned irrespective of profiles or skills", async (teamId, teamName) => {
    const before = structuredClone(fixture.state);
    expect(await caller().assignTeam({ bookingId: 7, teamId })).toEqual({ bookingId: 7, teamId, teamName, assignmentStatus: "assigned" });
    expectSavedProjection(before, { id: teamId, name: teamName });
  });
  it.each(bookingServiceIdSchema.options)("April remains eligible for existing service type %s without a skill/profile filter", async serviceId => {
    fixture.state.bookings[0].serviceId = serviceId;
    fixture.state.bookings[0].serviceName = `Synthetic ${serviceId} service`;
    fixture.state.leadflow_jobs.filter(row => row.bookingId === 7 && row.jobDate === date).forEach(row => { row.serviceName = `Synthetic ${serviceId} service`; });
    const before = structuredClone(fixture.state);
    expect(await caller().teams()).toEqual(expectedTeams);
    await caller().assignTeam({ bookingId: 7, teamId: 13 });
    expectSavedProjection(before, eligible[0]);
  });
  it("the existing pure recurrence continuation mapping retains April from the projected future visit when persisted synthetically", async () => {
    const before = structuredClone(fixture.state);
    await caller().assignTeam({ bookingId: 7, teamId: 13 });
    expectSavedProjection(before, eligible[0]);
    const [future] = await fixture.client.select().from(leadflowJobs).where(eq(leadflowJobs.id, 71)).limit(1);
    const nextDate = nextRecurringBusinessDate(future.jobDate, future.frequency);
    expect(nextDate).toBe("2026-12-03");
    const values = buildRecurringLeadflowJobValues(future, nextDate!, 16000);
    expect(values).toEqual({
      origin: "leadflow_recurrence", launch27BookingId: null, bookingSeriesId: null, bookingId: 7,
      jobDate: "2026-12-03", serviceDateTime: "2026-12-03T14:00:00.000Z", bookingStatus: "assigned",
      customerName: "Synthetic customer", customerPhone: "+12025550101", customerEmail: "fixture@example.invalid",
      jobAddress: "100 Synthetic Fixture Road", serviceName: "Standard", bedrooms: 2, bathrooms: 1,
      extras: '["fixture-extra"]', frequency: "Weekly", teamId: 13, teamName: "April",
      customerNotes: "Keep synthetic customer note\nExisting synthetic company note", staffNotes: undefined,
      jobTotalCents: 16000, hasStripeCard: 1, paymentBrand: "visa", paymentLast4: "4242",
    });
    const projected = structuredClone(fixture.state);
    // Explicit finite fixture persistence, NOT a call to or test of the live
    // recurrence worker/claiming/scheduling pipeline and NOT an assign side effect.
    await fixture.client.transaction(async tx => { await tx.insert(leadflowJobs).values(values); });
    expect(fixture.state.leadflow_jobs.slice(0, projected.leadflow_jobs.length)).toEqual(projected.leadflow_jobs);
    const persistedValues = Object.fromEntries(Object.entries(values).filter(([key]) => Object.hasOwn(getTableColumns(leadflowJobs), key)));
    expect(fixture.state.leadflow_jobs.at(-1)).toMatchObject({ id: 82, ...persistedValues, nextOccurrenceCreatedAt: null });
    for (const table of Object.keys(projected).filter(table => table !== "leadflow_jobs")) expect(fixture.state[table]).toEqual(projected[table]);
    expect(boundary.refresh).toHaveBeenCalledTimes(1);
  });
  it("creates the exact owned current projection when this booking has no operational jobs, without inventing recurrence visits", async () => {
    fixture.state.leadflow_jobs = fixture.state.leadflow_jobs.filter(row => row.bookingId !== 7);
    const before = structuredClone(fixture.state);
    await caller().assignTeam({ bookingId: 7, teamId: 12 });
    expect(fixture.state.leadflow_jobs.slice(0, before.leadflow_jobs.length)).toEqual(before.leadflow_jobs);
    const columns = getTableColumns(leadflowJobs);
    const defaults = Object.fromEntries(Object.entries(columns).map(([key, column]) => [key,
      ["createdAt", "updatedAt"].includes(key) ? stamp : column.default ?? null]));
    expect(fixture.state.leadflow_jobs.at(-1)).toEqual({ ...defaults,
      id: 82, origin: "native_booking", launch27BookingId: null, bookingSeriesId: null, bookingId: 7,
      jobDate: date, serviceDateTime: `${date}T14:00:00.000Z`, bookingStatus: "assigned",
      customerName: "Synthetic customer", customerPhone: "+12025550101", customerEmail: "fixture@example.invalid",
      jobAddress: "100 Synthetic Fixture Road", serviceName: "Standard", bedrooms: 2, bathrooms: 1,
      extras: '["fixture-extra"]', frequency: "Weekly", teamId: 12, teamName: "Native only",
      customerNotes: "Keep synthetic customer note\nExisting synthetic company note", jobTotalCents: 19000, hasStripeCard: 1,
    });
    expect(fixture.state.leadflow_jobs).toHaveLength(before.leadflow_jobs.length + 1);
    expect(fixture.state.bookings[0]).toEqual({ ...before.bookings[0], assignmentStatus: "assigned", updatedAt: stamp });
    expect(fixture.state.bookings[1]).toEqual(before.bookings[1]);
    expect(fixture.state.booking_assignments.at(-1)).toEqual(expectedNewAssignment(12, "Native only"));
    expect(fixture.state.booking_series).toEqual(before.booking_series);
    expect(fixture.state.booking_payment_profiles).toEqual(before.booking_payment_profiles);
    expect(fixture.transactions).toBe(1);
    expect(boundary.refresh).toHaveBeenCalledTimes(1);
  });
});

describe("pre-write rejection, real permission middleware and synthetic rollback", () => {
  it.each([90, 91, 92, 999999, 50014])("rejects unavailable/unknown local team %s before any writes (no Launch27 fallback)", async teamId => {
    const before = structuredClone(fixture.state);
    await expect(caller().assignTeam({ bookingId: 7, teamId })).rejects.toMatchObject({ code: "NOT_FOUND", message: "Active team not found." });
    expectUnchangedBeforeWrites(before);
    expect(fixture.transactions).toBe(1);
  });
  it("rejects a missing booking before querying a team or writing", async () => {
    const before = structuredClone(fixture.state);
    await expect(caller().assignTeam({ bookingId: 999, teamId: 13 })).rejects.toMatchObject({ code: "NOT_FOUND", message: "Booking not found." });
    expect(teamQueries()).toEqual([]);
    expectUnchangedBeforeWrites(before);
  });
  it.each([undefined, {}, { bookingId: 7 }, { teamId: 13 }, { bookingId: 0, teamId: 13 }, { bookingId: 7, teamId: -1 }, { bookingId: 7.5, teamId: 13 }, { bookingId: 7, teamId: 13.5 }, { bookingId: "7", teamId: 13 }])("rejects malformed or missing assignment input %j before booking DB access", async input => {
    const before = structuredClone(fixture.state);
    await expect(caller().assignTeam(input as any)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(boundary.getDb).not.toHaveBeenCalled();
    expect(fixture.transactions).toBe(0);
    expectUnchangedBeforeWrites(before);
  });
  const operations = ["teams", "assignTeam"] as const;
  async function invoke(operation: typeof operations[number]) {
    return operation === "teams" ? caller().teams() : caller().assignTeam({ bookingId: 7, teamId: 13 });
  }
  it.each(operations)("%s requires an authenticated agent before any DB resolver or write", async operation => {
    boundary.auth.mockResolvedValue(null);
    const before = structuredClone(fixture.state);
    await expect(invoke(operation)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(boundary.getAgentById).not.toHaveBeenCalled();
    expect(boundary.getDb).not.toHaveBeenCalled();
    expectUnchangedBeforeWrites(before);
  });
  it.each(operations)("%s enforces active-agent bookings page permission before booking DB access", async operation => {
    const before = structuredClone(fixture.state);
    boundary.getAgentById.mockResolvedValue({ ...agent, pagePermissions: '["schedule"]' });
    await expect(invoke(operation)).rejects.toMatchObject({ code: "FORBIDDEN", message: "bookings access required" });
    boundary.getAgentById.mockResolvedValue({ ...agent, isActive: 0 });
    await expect(invoke(operation)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    boundary.getAgentById.mockResolvedValue(null);
    await expect(invoke(operation)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(boundary.getDb).not.toHaveBeenCalled();
    expectUnchangedBeforeWrites(before);
  });
  it.each(operations)("%s propagates auth and permission resolver failure without writes", async operation => {
    const before = structuredClone(fixture.state);
    boundary.auth.mockRejectedValueOnce(new Error("Synthetic auth failure"));
    await expect(invoke(operation)).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR", message: "Synthetic auth failure" });
    boundary.getAgentById.mockRejectedValueOnce(new Error("Synthetic permission DB failure"));
    await expect(invoke(operation)).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR", message: "Synthetic permission DB failure" });
    expect(boundary.getDb).not.toHaveBeenCalled();
    expectUnchangedBeforeWrites(before);
  });
  it.each(operations)("%s propagates unavailable/acquisition-failed DB without fabrication", async operation => {
    const before = structuredClone(fixture.state);
    boundary.getDb.mockResolvedValueOnce(null);
    await expect(invoke(operation)).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR", message: "Booking service unavailable." });
    boundary.getDb.mockRejectedValueOnce(new Error("Synthetic DB acquisition failure"));
    await expect(invoke(operation)).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR", message: "Synthetic DB acquisition failure" });
    expectUnchangedBeforeWrites(before);
  });
  it("teams SELECT failure propagates without reading profiles or writing", async () => {
    fixture.failRead = "scheduling_teams";
    const before = structuredClone(fixture.state);
    await expect(caller().teams()).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
    expectUnchangedBeforeWrites(before);
  });
  it.each(["bookings", "scheduling_teams"])("assignment %s SELECT failure rejects before writes", async table => {
    fixture.failRead = table;
    const before = structuredClone(fixture.state);
    await expect(caller().assignTeam({ bookingId: 7, teamId: 13 })).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
    expectUnchangedBeforeWrites(before);
  });
  it.each(["ambiguous-date", "duplicate-date"])("actual projection %s conflict rolls back previously executed canonical assignment writes", async scenario => {
    if (scenario === "ambiguous-date") fixture.state.leadflow_jobs = fixture.state.leadflow_jobs.filter(row => row.bookingId !== 7 || row.jobDate !== date);
    else fixture.state.leadflow_jobs.push(job({ id: 72 }));
    const before = structuredClone(fixture.state);
    await expect(caller().assignTeam({ bookingId: 7, teamId: 13 })).rejects.toMatchObject({ code: "CONFLICT", message: "The canonical booking visit cannot be selected safely for operational projection." });
    expect(fixture.attempts).toHaveLength(3);
    expect(fixture.state).toEqual(before);
    expect(fixture.writes).toEqual([]);
    expect(fixture.transactions).toBe(1);
    expect(boundary.refresh).not.toHaveBeenCalled();
  });
  it.each(["read", "write"])("projection %s error rolls back retirement, insertion, booking status and jobs; no refresh/send", async failure => {
    if (failure === "read") fixture.failRead = "leadflow_jobs";
    else fixture.failWrite = "leadflow_jobs";
    const before = structuredClone(fixture.state);
    await expect(caller().assignTeam({ bookingId: 7, teamId: 13 })).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
    expect(fixture.attempts.length).toBe(failure === "read" ? 3 : 4);
    expect(fixture.state).toEqual(before);
    expect(fixture.writes).toEqual([]);
    expect(fixture.transactions).toBe(1);
    expect(boundary.refresh).not.toHaveBeenCalled();
  });
  it("a future projection write failure rolls back the already updated current job plus canonical assignment", async () => {
    fixture.failWrite = "leadflow_jobs";
    fixture.failWriteAt = 2;
    const before = structuredClone(fixture.state);
    await expect(caller().assignTeam({ bookingId: 7, teamId: 13 })).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
    expect(fixture.attempts).toHaveLength(5);
    expect(fixture.attempts[3].sql).toContain("where `leadflow_jobs`.`id` = ?");
    expect(fixture.attempts[4].sql).toContain("`leadflow_jobs`.`jobDate` > ?");
    expect(fixture.state).toEqual(before);
    expect(fixture.writes).toEqual([]);
    expect(fixture.transactions).toBe(1);
    expect(boundary.refresh).not.toHaveBeenCalled();
  });
  it("a missing-current projection INSERT failure rolls back canonical assignment with no created job", async () => {
    fixture.state.leadflow_jobs = fixture.state.leadflow_jobs.filter(row => row.bookingId !== 7);
    fixture.failWrite = "leadflow_jobs";
    const before = structuredClone(fixture.state);
    await expect(caller().assignTeam({ bookingId: 7, teamId: 13 })).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
    expect(fixture.attempts).toHaveLength(4);
    expect(fixture.attempts.at(-1)?.sql).toMatch(/^insert into `leadflow_jobs`/);
    expect(fixture.state).toEqual(before);
    expect(fixture.writes).toEqual([]);
    expect(boundary.refresh).not.toHaveBeenCalled();
  });
});
