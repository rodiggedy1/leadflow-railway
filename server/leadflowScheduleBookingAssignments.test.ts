import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { drizzle } from "drizzle-orm/mysql-proxy";
import type { TrpcContext } from "./_core/context";
import { getAgentFromRequest } from "./_core/agentAuth";
import { makeRequest } from "./_core/map";
import { getDb } from "./db";
import { leadflowScheduleRouter } from "./leadflowScheduleRouter";

// Only external boundaries are mocked; the real router, Drizzle SQL generation,
// booking-assignment reader and display-default generator execute in every call.
vi.mock("./db", () => ({ getDb: vi.fn(), getPool: vi.fn(() => null) }));
vi.mock("./_core/agentAuth", () => ({ getAgentFromRequest: vi.fn() }));
vi.mock("./_core/map", () => ({ makeRequest: vi.fn(() => { throw new Error("Unexpected provider call"); }) }));

const date = "2026-11-19";
const context = { req: {}, res: {}, user: null } as TrpcContext;
const caller = () => leadflowScheduleRouter.createCaller(context);
const authenticatedAgent = { agentId: 1, agentName: "Tester", agentEmail: "test@example.com", isAdmin: false };
type Row = Record<string, unknown>;
type FixtureJob = Row & {
  id: number; bookingId: number | null; teamId: number | null;
  jobDate: string; bookingStatus: string; serviceDateTime: string;
};
type FixtureTeam = Row & { id: number; name: string; launch27TeamId: number | null; isActive: number; isArchived: number };
type FixtureBookingAssignment = Row & { id: number; bookingId: number; teamId: number | null; status: string; assignedAt: string };
type FixtureScheduleAssignment = Row & { id: number; leadflowJobId: number | null; jobDate: string };
type Query = { sql: string; params: unknown[] };
let jobs: FixtureJob[];
let teams: FixtureTeam[];
let bookingRows: FixtureBookingAssignment[];
let scheduleRows: FixtureScheduleAssignment[];
let progressRows: Row[];
let weeklyRows: Row[];
let overrideRows: Row[];
let unavailableRows: Row[];
let queries: Query[];
let failTable: string | null;

function job(values: Partial<FixtureJob> = {}): FixtureJob {
  return {
    id: 1, origin: "leadflow", bookingId: 42, launch27BookingId: null,
    teamId: 9, teamName: "Stale snapshot", jobDate: date, bookingStatus: "assigned",
    serviceDateTime: `${date}T15:00:00Z`, customerName: "Booking customer",
    customerPhone: "+12025550101", customerEmail: "fixture@example.com",
    jobAddress: "100 Fixture Road, Washington, DC 20001", serviceName: "Cleaning",
    bedrooms: 2, bathrooms: 1, frequency: "One-time", extras: "[]",
    jobTotalCents: 20000, hasStripeCard: 1, paymentBrand: "visa", paymentLast4: "4242",
    ...values,
  };
}
function team(values: Partial<FixtureTeam> = {}): FixtureTeam {
  return { id: 9, name: "Canonical local team", launch27TeamId: 700,
    isActive: 1, isArchived: 0, color: "#123456", maxHoursPerDay: 8, ...values };
}
function bookingAssignment(values: Partial<FixtureBookingAssignment> = {}): FixtureBookingAssignment {
  return { id: 1, bookingId: 42, teamId: 9, teamName: "Outdated canonical name",
    status: "assigned", assignedAt: "2026-11-19 12:00:00.000", ...values };
}
function scheduleAssignment(values: Partial<FixtureScheduleAssignment> = {}): FixtureScheduleAssignment {
  return { id: 1, jobDate: date, leadflowJobId: 1, teamId: 99,
    teamName: "Persisted route team", routeOrder: 3, driveTimeSecs: 321,
    estimatedArrivalMs: 1795095000000, estimatedDepartureMs: 1795102200000,
    isManual: 1, rationale: "Operator's existing route", totalDistanceMeters: 12345,
    ...values };
}

// mysql-proxy expects positional arrays, not objects. Decode the real SELECT
// projection (including the router's raw owned-job references) like payroll tests.
function selectedRows(sql: string, rows: Record<string, Row>[]) {
  const fields = sql.slice(7, sql.indexOf(" from ")).split(", ");
  const sourceTable = sql.match(/ from `([^`]+)`/)?.[1];
  return rows.map(row => fields.map(field => {
    const qualified = field.match(/^`([^`]+)`\.(?:`([^`]+)`|([A-Za-z][A-Za-z0-9_]*))$/);
    if (qualified) return row[qualified[1]]?.[qualified[2] ?? qualified[3]] ?? null;
    const column = field.match(/^`([^`]+)`$/)?.[1];
    if (column && sourceTable) return row[sourceTable]?.[column] ?? null;
    throw new Error(`Unexpected projection: ${field}`);
  }));
}

// Enforce the complete read boundary for every executed query, even when a
// procedure rejects. Concatenated forbidden names keep the scoped source clean.
function assertReadBoundary(sql: string) {
  expect(sql).toMatch(/^select /);
  for (const forbidden of ["cleaner" + "_jobs", "cleaner" + "Jobs", "job_geo_cache"]) {
    expect(sql).not.toContain(forbidden);
  }
  const allowedTables = new Set([
    "leadflow_jobs", "cleaner_portal_job_progress", "scheduling_teams",
    "booking_assignments", "schedule_assignments", "team_work_schedule",
    "team_day_override", "team_day_unavailability",
  ]);
  for (const match of sql.matchAll(/\b(?:from|join) `([^`]+)`/g)) {
    expect(allowedTables.has(match[1]), `Unexpected source ${match[1]}`).toBe(true);
  }
}
const bookingQueries = () => queries.filter(q => q.sql.includes(" from `booking_assignments`"));

beforeEach(() => {
  vi.clearAllMocks();
  jobs = [job()];
  teams = [team(), team({ id: 99, name: "Launch27 ID collision", launch27TeamId: 9 }),
    team({ id: 12, name: "Native-only team", launch27TeamId: null })];
  bookingRows = [bookingAssignment()];
  scheduleRows = []; progressRows = []; weeklyRows = []; overrideRows = []; unavailableRows = [];
  queries = []; failTable = null;
  vi.mocked(getAgentFromRequest).mockResolvedValue(authenticatedAgent);
  vi.spyOn(globalThis, "fetch").mockImplementation(async () => { throw new Error("Unexpected network request"); });
  const db = drizzle(async (sql, params) => {
    queries.push({ sql, params });
    assertReadBoundary(sql);
    const source = sql.match(/ from `([^`]+)`/)?.[1];
    if (source === failTable) throw new Error(`Fixture read failed: ${source}`);
    if (source === "leadflow_jobs") {
      expect(sql).toContain("`leadflow_jobs`.`jobDate` = ?");
      expect(sql).toContain("`leadflow_jobs`.`bookingStatus` not in");
      expect(params.slice(1)).toEqual(["cancelled", "rescheduled", "missing_from_launch27"]);
      const activeJobs = jobs.filter(j => j.jobDate === params[0] && !params.slice(1).includes(j.bookingStatus))
        .sort((a, b) => a.serviceDateTime.localeCompare(b.serviceDateTime) || a.id - b.id);
      return { rows: selectedRows(sql, activeJobs.map(j => ({
        leadflow_jobs: j,
        cleaner_portal_job_progress: progressRows.find(p => p.leadflowJobId === j.id) ?? {},
      }))) };
    }
    if (source === "scheduling_teams") {
      return { rows: selectedRows(sql, [...teams].sort((a, b) => a.name.localeCompare(b.name))
        .map(t => ({ scheduling_teams: t }))) };
    }
    if (source === "booking_assignments") {
      expect(sql).toMatch(/`booking_assignments`\.`bookingId` in \(/);
      expect(sql).toContain("`booking_assignments`.`status` = ?");
      expect(params.at(-1)).toBe("assigned");
      expect(sql).toMatch(/order by `booking_assignments`\.`assignedAt` desc, `booking_assignments`\.`id` desc$/);
      const scoped = bookingRows.filter(a => params.slice(0, -1).includes(a.bookingId) && a.status === params.at(-1))
        .sort((a, b) => b.assignedAt.localeCompare(a.assignedAt) || b.id - a.id);
      return { rows: selectedRows(sql, scoped.map(a => ({ booking_assignments: a }))) };
    }
    if (source === "schedule_assignments") {
      expect(sql).toContain("`schedule_assignments`.leadflowJobId is not null");
      expect(sql).toContain("`schedule_assignments`.leadflowJobId in (");
      return { rows: selectedRows(sql, scheduleRows.filter(a => a.jobDate === params[0]
        && a.leadflowJobId != null && params.slice(1).includes(a.leadflowJobId))
        .map(a => ({ schedule_assignments: a }))) };
    }
    const availabilityRows: Record<string, Row[]> = {
      team_work_schedule: weeklyRows, team_day_override: overrideRows, team_day_unavailability: unavailableRows,
    };
    if (source && source in availabilityRows) {
      const rows = availabilityRows[source].filter(row => source === "team_work_schedule" || row.date === params[0]);
      return { rows: selectedRows(sql, rows.map(row => ({ [source]: row }))) };
    }
    throw new Error(`Unexpected schedule query: ${sql}`);
  });
  vi.mocked(getDb).mockResolvedValue(db as unknown as NonNullable<Awaited<ReturnType<typeof getDb>>>);
});
afterEach(() => {
  queries.forEach(q => assertReadBoundary(q.sql));
  expect(makeRequest).not.toHaveBeenCalled();
  expect(globalThis.fetch).not.toHaveBeenCalled();
  vi.restoreAllMocks();
});

describe("getSchedule native booking defaults through the actual tRPC router", () => {
  it("uses canonical local team ID, not another team's colliding Launch27 ID", async () => {
    const result = await caller().getSchedule({ date });
    expect(result.jobs[0].assignment).toEqual({
      leadflowJobId: 1, teamId: 9, teamName: "Canonical local team", routeOrder: 999,
      driveTimeSecs: null, estimatedArrivalMs: null, estimatedDepartureMs: null,
      isManual: 0, rationale: null, source: "booking_default",
    });
    expect(result.hasAssignments).toBe(false);
    expect(bookingQueries()).toHaveLength(1);
    expect(bookingQueries()[0].params).toEqual([42, "assigned"]);
  });

  it("canonical booking reassignment supersedes the job's stale team ID and name", async () => {
    jobs[0].teamName = "Canonical local team";
    bookingRows[0].teamId = 12;
    const result = await caller().getSchedule({ date });
    expect(result.jobs[0].assignment).toMatchObject({ teamId: 12, teamName: "Native-only team", source: "booking_default" });
    expect(jobs[0].teamId).toBe(9);
  });

  it("uses newest assignedAt before highest ID, and highest ID breaks timestamp ties", async () => {
    bookingRows = [
      bookingAssignment({ id: 900, teamId: 9, assignedAt: "2026-11-18 18:00:00.000" }),
      bookingAssignment({ id: 2, teamId: 99, assignedAt: "2026-11-19 13:00:00.000" }),
      bookingAssignment({ id: 3, teamId: 12, assignedAt: "2026-11-19 13:00:00.000" }),
      bookingAssignment({ id: 901, teamId: 9, status: "cancelled", assignedAt: "2026-11-19 23:00:00.000" }),
      bookingAssignment({ id: 902, teamId: 9, status: "unassigned", assignedAt: "2026-11-19 23:00:00.000" }),
    ];
    expect((await caller().getSchedule({ date })).jobs[0].assignment).toMatchObject({ teamId: 12 });
  });

  it.each(["absent", "cancelled", "unassigned"])("%s canonical assignment does not use stale ID or name matching", async status => {
    jobs[0].teamName = "Canonical local team";
    bookingRows = status === "absent" ? [] : [bookingAssignment({ status })];
    expect((await caller().getSchedule({ date })).jobs[0].assignment).toBeNull();
    expect(bookingQueries()).toHaveLength(1);
  });

  it("latest active row with a null team cannot resurrect an older assignment or stale snapshot", async () => {
    bookingRows.push(bookingAssignment({ id: 2, teamId: null, assignedAt: "2026-11-19 13:00:00.000" }));
    expect((await caller().getSchedule({ date })).jobs[0].assignment).toBeNull();
  });

  it("unknown local canonical team does not fall back to a matching Launch27 ID or team name", async () => {
    bookingRows[0].teamId = 700;
    jobs[0].teamName = "Canonical local team";
    expect((await caller().getSchedule({ date })).jobs[0].assignment).toBeNull();
  });

  it("native canonical assignment remains displayed for an inactive or archived team", async () => {
    teams[0].isActive = 0;
    teams[0].isArchived = 1;
    const result = await caller().getSchedule({ date });
    expect(result.jobs[0].assignment).toMatchObject({ teamId: 9, teamName: "Canonical local team" });
    expect(result.teams.find(t => t.id === 9)).toMatchObject({ available: false, isActive: 0, isArchived: 1 });
  });

  it("links assignments only by exact booking ID even when customers share a name and phone", async () => {
    jobs.push(job({ id: 2, bookingId: 43, teamId: 12 }), job({ id: 3, bookingId: 44 }));
    bookingRows.push(bookingAssignment({ id: 2, bookingId: 43, teamId: 12 }),
      bookingAssignment({ id: 3, bookingId: 999, teamId: 99, assignedAt: "2026-11-19 23:00:00.000" }));
    const result = await caller().getSchedule({ date });
    expect(result.jobs.map(j => j.assignment?.teamId ?? null)).toEqual([9, 12, null]);
    expect(bookingQueries()[0].params).toEqual([42, 43, 44, "assigned"]);
  });

  it("deduplicates booking IDs and excludes other dates, inactive jobs and imported booking identities", async () => {
    jobs.push(job({ id: 2 }), job({ id: 3, bookingId: 43, jobDate: "2026-11-20" }),
      job({ id: 4, bookingId: 44, bookingStatus: "cancelled" }),
      job({ id: 5, bookingId: 45, bookingStatus: "rescheduled" }),
      job({ id: 6, bookingId: 46, bookingStatus: "missing_from_launch27" }),
      job({ id: 7, origin: "launch27", bookingId: null, launch27BookingId: 555, teamId: 700 }));
    const result = await caller().getSchedule({ date });
    expect(result.jobs.map(j => j.id)).toEqual([1, 2, 7]);
    expect(result.jobs.map(j => j.assignment?.teamId)).toEqual([9, 9, 9]);
    expect(bookingQueries()[0].params).toEqual([42, "assigned"]);
  });

  it("per-day persisted assignment wins and preserves all route, time, drive and manual fields", async () => {
    bookingRows[0].teamId = 12;
    scheduleRows = [scheduleAssignment(), scheduleAssignment({ id: 2, leadflowJobId: 1, jobDate: "2026-11-20", teamId: 12 }),
      scheduleAssignment({ id: 3, leadflowJobId: 999, teamId: 12 }), scheduleAssignment({ id: 4, leadflowJobId: null, teamId: 12 })];
    const result = await caller().getSchedule({ date });
    expect(result.jobs[0].assignment).toEqual({ leadflowJobId: 1, teamId: 99, teamName: "Persisted route team",
      routeOrder: 3, driveTimeSecs: 321, estimatedArrivalMs: 1795095000000,
      estimatedDepartureMs: 1795102200000, isManual: 1, rationale: "Operator's existing route", source: "schedule" });
    expect(result.hasAssignments).toBe(true);
    expect(queries.find(q => q.sql.includes(" from `schedule_assignments`"))?.params).toEqual([date, 1]);
  });

  it("a persisted per-day assignment still wins when no canonical booking assignment is active", async () => {
    bookingRows = [];
    scheduleRows = [scheduleAssignment()];
    expect((await caller().getSchedule({ date })).jobs[0].assignment).toMatchObject({ teamId: 99, source: "schedule" });
  });

  it("preserves progress, customer/payment projection and day-specific availability without geocoding", async () => {
    progressRows = [{ leadflowJobId: 1, jobStatus: "en_route", etaTimestamp: 1795095000000 }];
    weeklyRows = [{ id: 1, teamId: 9, mon: 1, tue: 1, wed: 1, thu: 0, fri: 1, sat: 0, sun: 0, note: "Thursday off" }];
    overrideRows = [{ id: 1, teamId: 9, date, isAvailable: 1, note: "Special booking" }];
    unavailableRows = [{ id: 1, teamId: 12, date }];
    const result = await caller().getSchedule({ date });
    expect(result.jobs[0]).toMatchObject({ id: 1, leadflowJobId: 1, customerName: "Booking customer",
      jobStatus: "en_route", etaTimestamp: 1795095000000, jobTotalCents: 20000,
      hasStripeCard: 1, paymentBrand: "visa", paymentLast4: "4242", isNewClient: false, isRecurring: false });
    expect(result.teams.find(t => t.id === 9)).toMatchObject({ available: true, overrideIsAvailable: 1,
      overrideNote: "Special booking", weeklyNote: "Thursday off", schedule: { thu: 0 } });
    expect(result.teams.find(t => t.id === 12)).toMatchObject({ available: false, explicitlyUnavailable: true });
    expect(result.jobs[0].assignment).toMatchObject({ teamId: 9, source: "booking_default" });
  });
});

describe("getSchedule unchanged imported and booking-link-missing behavior", () => {
  it("maps imported Launch27 snapshot IDs as before without querying canonical booking assignments", async () => {
    jobs = [job({ origin: "launch27", bookingId: null, launch27BookingId: 42, teamId: 700 }),
      job({ id: 2, origin: "launch27", bookingId: null, launch27BookingId: 43, teamId: 9 })];
    const result = await caller().getSchedule({ date });
    expect(result.jobs.map(j => j.assignment?.teamId)).toEqual([9, 99]);
    expect(result.hasAssignments).toBe(false);
    expect(bookingQueries()).toEqual([]);
  });

  it.each(["missing", "inactive", "archived", "ambiguous"])("leaves %s imported snapshot unassigned, without new name guesses", async condition => {
    jobs = [job({ origin: "launch27", bookingId: null, teamId: condition === "missing" ? null : 700, teamName: "Canonical local team" })];
    if (condition === "inactive") teams[0].isActive = 0;
    if (condition === "archived") teams[0].isArchived = 1;
    if (condition === "ambiguous") teams.push(team({ id: 88, name: "Duplicate imported mapping" }));
    expect((await caller().getSchedule({ date })).jobs[0].assignment).toBeNull();
    expect(bookingQueries()).toEqual([]);
  });

  it("does not guess native local IDs from origin when the stable booking link is null", async () => {
    jobs = [job({ bookingId: null, origin: "leadflow", teamId: 700, teamName: "Native-only team" }),
      job({ id: 2, bookingId: null, origin: "leadflow", teamId: 12, teamName: "Native-only team" })];
    const result = await caller().getSchedule({ date });
    expect(result.jobs.map(j => j.assignment?.teamId ?? null)).toEqual([9, null]);
    expect(bookingQueries()).toEqual([]);
  });

  it("null booking link with an ambiguous imported snapshot stays unassigned regardless of native origin/name", async () => {
    jobs = [job({ bookingId: null, origin: "leadflow", teamId: 700, teamName: "Canonical local team" })];
    teams.push(team({ id: 88, name: "Second mapping" }));
    expect((await caller().getSchedule({ date })).jobs[0].assignment).toBeNull();
    expect(bookingQueries()).toEqual([]);
  });

  it("returns empty jobs without canonical booking or persisted-assignment queries", async () => {
    jobs = [];
    const result = await caller().getSchedule({ date });
    expect(result.jobs).toEqual([]);
    expect(result.hasAssignments).toBe(false);
    expect(result.teams).toHaveLength(3);
    expect(bookingQueries()).toEqual([]);
    expect(queries.some(q => q.sql.includes(" from `schedule_assignments`"))).toBe(false);
    expect(queries).toHaveLength(5);
  });
});

describe("getSchedule read-only rejection boundaries", () => {
  it("requires a valid authenticated agent before any database read", async () => {
    vi.mocked(getAgentFromRequest).mockResolvedValue(null);
    await expect(caller().getSchedule({ date })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(getDb).not.toHaveBeenCalled();
    expect(queries).toEqual([]);
  });

  it.each(["wrong", "2026-1-19", "19-11-2026", "2026-11-19T12:00:00Z"])("rejects malformed date %s before reading", async invalidDate => {
    await expect(caller().getSchedule({ date: invalidDate })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(getDb).not.toHaveBeenCalled();
    expect(queries).toEqual([]);
  });

  it("reports unavailable DB without reading or fabricating assignments", async () => {
    vi.mocked(getDb).mockResolvedValue(null);
    await expect(caller().getSchedule({ date })).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
    expect(queries).toEqual([]);
  });

  it("propagates DB acquisition failure", async () => {
    vi.mocked(getDb).mockRejectedValue(new Error("Fixture DB acquisition failed"));
    await expect(caller().getSchedule({ date })).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR", message: "Fixture DB acquisition failed" });
    expect(queries).toEqual([]);
  });

  it("propagates the real canonical SELECT failure instead of silently using the stale job snapshot", async () => {
    failTable = "booking_assignments";
    await expect(caller().getSchedule({ date })).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
    expect(bookingQueries()).toHaveLength(1);
    expect(bookingQueries()[0].params).toEqual([42, "assigned"]);
  });

  it("propagates the initial jobs SELECT failure before canonical assignment reads", async () => {
    failTable = "leadflow_jobs";
    await expect(caller().getSchedule({ date })).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
    expect(bookingQueries()).toEqual([]);
  });
});
