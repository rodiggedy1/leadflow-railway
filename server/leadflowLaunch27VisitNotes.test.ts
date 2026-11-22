import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getTableColumns } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql-proxy";
import { leadflowLaunch27VisitNotes } from "../drizzle/leadflowLaunch27VisitNotes";
import { staffNotesByLaunch27BookingIds, saveLaunch27StaffNotes, withLaunch27StaffNotes } from "./leadflowLaunch27VisitNotes";
import { importLaunch27JobsForDate } from "./leadflowJobsService";
import { leadflowJobsRouter } from "./leadflowJobsRouter";
import type { Launch27Booking } from "./launch27";

const mocks = vi.hoisted(() => ({ getDb: vi.fn(), getAgentById: vi.fn(), auth: vi.fn(), source: vi.fn() }));
vi.mock("./db", () => ({ getDb: mocks.getDb, getAgentById: mocks.getAgentById, getPool: () => null }));
vi.mock("./_core/agentAuth", () => ({ getAgentFromRequest: mocks.auth }));
vi.mock("./openphone", () => ({ sendSms: vi.fn() }));
vi.mock("./launch27", () => ({ getCompletedBookingsForDate: mocks.source }));

type Job = Record<string, any>;
type Query = { sql: string; params: unknown[] };
let jobs: Job[];
let notes: Job[];
let queries: Query[];
let db: NonNullable<Awaited<ReturnType<typeof import("./db").getDb>>>;
const job = (overrides: Job = {}): Job => ({
  id: 41, origin: "launch27_import", launch27BookingId: 701, bookingId: null,
  jobDate: "2026-11-13", customerName: "Synthetic Customer", customerPhone: "+12025550123", customerEmail: "test@example.test",
  jobAddress: "Synthetic Address", serviceName: "Hourly Cleaning", bookingStatus: "assigned", customerNotes: "Owned customer note", ...overrides,
});
const source = (id: number, overrides: Partial<Launch27Booking> = {}): Launch27Booking => ({
  id, phone: "+12025550123", firstName: "Synthetic", lastName: "Customer", fullName: "Synthetic Customer", email: "test@example.test",
  serviceDate: "2026-11-13T14:00:00Z", frequency: "Weekly", address: "Synthetic Address", city: "Washington", state: "DC", zip: "20001",
  totalRevenue: 100, baseRevenue: 100, bookingStatus: "assigned", completed: false, teams: [], serviceNames: ["Hourly Cleaning"], bedrooms: 2,
  bathrooms: 1, extras: [], customerNotes: `Customer ${id}`, staffNotes: `Staff ${id}`, requestedTeam: null, hasStripeCard: false,
  stripeCustomerId: null, paymentBrand: null, paymentLast4: null, chargesOnHoldCents: 0, chargesOutstandingCents: 0, ...overrides,
});
function selectedRows(sql: string, rows: Job[]) {
  const fields = sql.slice(7, sql.indexOf(" from ")).split(", ");
  return rows.map(row => fields.map(field => row[field.match(/`([^`]+)`$/)?.[1] ?? ""] ?? null));
}
const caller = () => leadflowJobsRouter.createCaller({ req: {}, res: {}, user: null } as any);
beforeEach(() => {
  vi.clearAllMocks();
  jobs = [job()]; notes = []; queries = [];
  mocks.auth.mockResolvedValue({ agentId: 9, agentName: "Synthetic Agent", agentEmail: "agent@example.test", isAdmin: false });
  mocks.getAgentById.mockResolvedValue({ id: 9, name: "Synthetic Agent", email: "agent@example.test", isActive: 1, isAdmin: 0, pagePermissions: '["bookings"]' });
  db = drizzle(async (sql, params) => {
    queries.push({ sql, params });
    if (sql.startsWith("select ") && sql.includes(" from `leadflow_launch27_visit_notes`")) return { rows: selectedRows(sql, notes) };
    if (sql.startsWith("select ") && sql.includes(" from `leadflow_jobs`")) {
      if (params.includes("leadflow_recurrence")) return { rows: [] };
      const rows = sql.includes("`leadflow_jobs`.`launch27BookingId` = ?")
        ? jobs.filter(row => row.launch27BookingId === params[0])
        : jobs.filter(row => row.jobDate === params[0]);
      return { rows: selectedRows(sql, rows) };
    }
    if (/^(insert into|update) `leadflow_(jobs|launch27_visit_notes)`/.test(sql)) return { rows: [{ insertId: 99, affectedRows: 1 }] };
    throw new Error(`Offline test rejected SQL: ${sql}`);
  }) as unknown as typeof db;
  mocks.getDb.mockResolvedValue(db);
  mocks.source.mockResolvedValue({ date: "2026-11-13", fetched: 2, bookings: [source(701), source(702)] });
});

describe("owned Launch27 visit staff notes (offline)", () => {
  it("owns exactly stable ID and nullable staff notes, with no duplicated customer notes or timestamps", () => {
    const columns = getTableColumns(leadflowLaunch27VisitNotes);
    expect(Object.keys(columns)).toEqual(["launch27BookingId", "staffNotes"]);
    expect(columns.launch27BookingId.primary).toBe(true);
    expect(columns.launch27BookingId.getSQLType()).toBe("int");
    expect(columns.staffNotes.notNull).toBe(false);
    expect(columns.staffNotes.getSQLType()).toBe("text");
  });
  it("deduplicates exact lookup IDs and filters unexpected rows without any contact/date matching", async () => {
    notes = [{ launch27BookingId: 701, staffNotes: "Correct" }, { launch27BookingId: 999, staffNotes: "Wrong visit" }];
    expect(await staffNotesByLaunch27BookingIds(db, [701, 701])).toEqual(new Map([[701, "Correct"]]));
    expect(queries).toHaveLength(1);
    expect(queries[0].params).toEqual([701]);
    expect(queries[0].sql).toMatch(/where `leadflow_launch27_visit_notes`.`launch27BookingId` in \(\?\)$/);
  });
  it("a missing stable-ID note returns null instead of falling back to another visit and performs no writes", async () => {
    notes = [{ launch27BookingId: 999, staffNotes: "Another visit" }];
    expect((await withLaunch27StaffNotes(db, [job()]))[0].staffNotes).toBeNull();
    expect(queries.every(query => query.sql.startsWith("select "))).toBe(true);
  });
  it("rejects invalid persistence IDs before any write", async () => {
    await expect(saveLaunch27StaffNotes(db, [{ launch27BookingId: 0, staffNotes: "Invalid" }])).rejects.toThrow("stable booking ID");
    expect(queries).toEqual([]);
  });
  it("attaches notes only to genuine imported stable IDs, never native linked or unbound same-household rows", async () => {
    notes = [{ launch27BookingId: 701, staffNotes: "Exact staff detail" }, { launch27BookingId: 702, staffNotes: "Another visit" }];
    const values = [job(), job({ id: 42, bookingId: 88 }), job({ id: 43, launch27BookingId: null }), job({ id: 44, origin: "native_booking", launch27BookingId: 702 })];
    const before = structuredClone(values);
    expect((await withLaunch27StaffNotes(db, values)).map(row => row.staffNotes)).toEqual(["Exact staff detail", null, null, null]);
    expect(queries[0].params).toEqual([701]);
    expect(values).toEqual(before);
  });
  it("empty lookups and native-only lists do not issue any notes query", async () => {
    expect(await staffNotesByLaunch27BookingIds(db, [])).toEqual(new Map());
    expect((await withLaunch27StaffNotes(db, [job({ bookingId: 88 })]))[0].staffNotes).toBeNull();
    expect(queries).toEqual([]);
  });
  it("upserts only the supplied staff notes and supports clearing", async () => {
    await saveLaunch27StaffNotes(db, [{ launch27BookingId: 701, staffNotes: "Current" }, { launch27BookingId: 702, staffNotes: "" }]);
    expect(queries[0]).toEqual({
      sql: "insert into `leadflow_launch27_visit_notes` (`launch27BookingId`, `staffNotes`) values (?, ?), (?, ?) on duplicate key update `staffNotes` = VALUES(staffNotes)",
      params: [701, "Current", 702, null],
    });
  });
  it("ordinary date imports persist staff notes separately for updated and new exact source IDs", async () => {
    await expect(importLaunch27JobsForDate("2026-11-13")).resolves.toMatchObject({ created: 1, updated: 1, error: null });
    const noteWrites = queries.filter(query => query.sql.startsWith("insert into `leadflow_launch27_visit_notes`"));
    expect(noteWrites.map(query => query.params)).toEqual([[701, "Staff 701"], [702, "Staff 702"]]);
    const jobWrites = queries.filter(query => /^(update|insert into) `leadflow_jobs`/.test(query.sql));
    expect(jobWrites).toHaveLength(2);
    for (const query of jobWrites) { expect(query.sql).toContain("`customerNotes`"); expect(query.sql).not.toContain("`staffNotes`"); }
    expect(queries.filter(query => query.sql.startsWith("select ") && query.sql.includes("launch27BookingId` = ?")).map(query => query.params)).toEqual([[701, 1], [702, 1]]);
  });
  it("ordinary import provider failure performs no DB reads or writes", async () => {
    mocks.source.mockResolvedValue({ date: "2026-11-13", fetched: 0, bookings: [], error: "Synthetic provider failure" });
    expect(await importLaunch27JobsForDate("2026-11-13")).toMatchObject({ created: 0, updated: 0, error: "Synthetic provider failure" });
    expect(queries).toEqual([]);
  });
  it("CRM list batches staff notes only for its returned imported IDs and makes no provider read", async () => {
    jobs.push(job({ id: 42, bookingId: 88 }), job({ id: 43, launch27BookingId: 702 }));
    notes = [{ launch27BookingId: 701, staffNotes: "Staff 701" }, { launch27BookingId: 702, staffNotes: "Staff 702" }, { launch27BookingId: 999, staffNotes: "Unowned" }];
    const result = await caller().list({ date: "2026-11-13" });
    expect(result.map(row => row.staffNotes)).toEqual(["Staff 701", null, "Staff 702"]);
    expect(result[0]).toMatchObject({ serviceName: "Hourly Cleaning", customerNotes: "Owned customer note" });
    expect(queries.filter(query => query.sql.includes(" from `leadflow_launch27_visit_notes`"))).toHaveLength(1);
    expect(queries.at(-1)?.params).toEqual([701, 702]);
    expect(mocks.source).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain("Unowned");
    expect(leadflowJobsRouter._def.procedures).not.toHaveProperty("refreshLaunch27VisitNotes");
  });
  it("CRM list retains bookings page authorization before notes reads", async () => {
    mocks.auth.mockResolvedValue(null);
    await expect(caller().list({ date: "2026-11-13" })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(queries).toEqual([]);
    mocks.auth.mockResolvedValue({ agentId: 9 });
    mocks.getAgentById.mockResolvedValue({ id: 9, isActive: 1, isAdmin: 0, pagePermissions: '["field-management"]' });
    await expect(caller().list({ date: "2026-11-13" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(queries).toEqual([]);
  });
  it("keeps the complete scoped backend free of forbidden operational dependencies and manual refresh", () => {
    const forbidden = new RegExp(["cleaner", "Jobs"].join("") + "|" + ["cleaner", "_jobs"].join(""));
    for (const path of ["../drizzle/leadflowLaunch27VisitNotes.ts", "./leadflowLaunch27VisitNotes.ts", "./leadflowJobsService.ts", "./leadflowJobsRouter.ts", "./cleanerPortalReadOnlyRouter.ts", "./liveTextMonitorSyncRepository.ts"]) {
      const text = readFileSync(new URL(path, import.meta.url), "utf8");
      expect(text).not.toMatch(forbidden);
      expect(text).not.toContain("refreshLaunch27VisitNotes");
    }
  });
});
