import { beforeEach, describe, expect, it, vi } from "vitest";
import { getTableName } from "drizzle-orm";
import { bookings, leadflowJobs, type LeadflowJob } from "../drizzle/schema";
import { rescheduleOperationalBooking, type BookingRescheduleTransaction } from "./bookingRescheduleService";
import { buildRecurringLeadflowJobValues, runEndOfDayLeadflowJobRecurrence } from "./leadflowJobsService";

const mocks = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("./db", () => ({ getDb: mocks.getDb }));
vi.mock("./launch27", () => ({ getCompletedBookingsForDate: vi.fn(() => { throw new Error("Provider access prohibited"); }) }));
vi.mock("drizzle-orm", async (original) => ({
  ...await original<typeof import("drizzle-orm")>(),
  eq: (column: Column, value: unknown) => ({ op: "eq", column, value }),
  lte: (column: Column, value: unknown) => ({ op: "lte", column, value }),
  isNull: (column: Column) => ({ op: "null", column }),
  inArray: (column: Column, value: unknown[]) => ({ op: "in", column, value }),
  and: (...conditions: Condition[]) => ({ op: "and", conditions }),
}));

type Column = { name: string };
type Condition = { op: string; column?: Column; value?: any; conditions?: Condition[] };
type Row = Record<string, any>;
function matches(row: Row, condition?: Condition): boolean {
  if (!condition) return true;
  if (condition.op === "and") return condition.conditions!.every(c => matches(row, c));
  const value = row[condition.column!.name];
  if (condition.op === "eq") return value === condition.value;
  if (condition.op === "null") return value === null;
  if (condition.op === "lte") return value <= condition.value;
  if (condition.op === "in") return condition.value.includes(value);
  throw new Error(`Unexpected condition ${condition.op}`);
}
class MemoryDb {
  rows: Record<string, Row[]> = { leadflow_jobs: [], bookings: [] };
  writes: Array<{ table: string; values: Row }> = [];
  failUpdateId: number | null = null;
  commits = 0;
  adapter(rows = this.rows) {
    const db = this;
    return {
      select(fields?: Record<string, Column>) {
        let name: string; let condition: Condition | undefined; let count = Infinity;
        const chain = {
          from(table: any) { name = getTableName(table); return chain; },
          where(value: Condition) { condition = value; return chain; },
          limit(value: number) { count = value; return chain; },
          for(value: string) { expect(value).toBe("update"); return chain; },
          then(resolve: (rows: Row[]) => unknown, reject: (error: unknown) => unknown) {
            try {
              const selected = rows[name].filter(row => matches(row, condition)).slice(0, count);
              return Promise.resolve(fields ? selected.map(row => Object.fromEntries(Object.entries(fields).map(([key, col]) => [key, row[col.name]]))) : structuredClone(selected)).then(resolve, reject);
            } catch (error) { return Promise.reject(error).then(resolve, reject); }
          },
        };
        return chain;
      },
      update(table: any) {
        const name = getTableName(table);
        return { set(values: Row) { return { async where(condition: Condition) {
          const selected = rows[name].filter(row => matches(row, condition));
          if (selected.some(row => row.id === db.failUpdateId)) throw new Error("Injected update failure");
          db.writes.push({ table: name, values: structuredClone(values) });
          selected.forEach(row => Object.assign(row, structuredClone(values)));
          return [{ affectedRows: selected.length }];
        } }; } };
      },
      insert(table: any) {
        const name = getTableName(table);
        return { async values(values: Row) {
          db.writes.push({ table: name, values: structuredClone(values) });
          const id = Math.max(0, ...rows[name].map(row => row.id)) + 1;
          rows[name].push({ nextOccurrenceCreatedAt: null, ...structuredClone(values), id });
          return [{ insertId: id }];
        } };
      },
    };
  }
  select = (fields?: Record<string, Column>) => this.adapter().select(fields);
  update = (table: any) => this.adapter().update(table);
  insert = (table: any) => this.adapter().insert(table);
  async transaction<T>(callback: (tx: BookingRescheduleTransaction) => Promise<T>): Promise<T> {
    const copy = structuredClone(this.rows);
    const result = await callback(this.adapter(copy) as unknown as BookingRescheduleTransaction);
    this.rows = copy; this.commits++;
    return result;
  }
  get jobs(): LeadflowJob[] { return this.rows.leadflow_jobs as LeadflowJob[]; }
}
function job(overrides: Partial<LeadflowJob> = {}): LeadflowJob {
  return {
    id: 10, origin: "launch27_import", launch27BookingId: 100, bookingId: null, bookingSeriesId: null,
    jobDate: "2026-10-30", serviceDateTime: "2026-10-30T13:00:00.000Z", frequency: "Weekly",
    customerName: "Exact Customer", customerPhone: "+12025550100", customerEmail: "exact@example.com",
    jobAddress: "100 Exact St", serviceName: "Standard cleaning", bookingStatus: "assigned", teamId: 7,
    teamName: "Team snapshot", extras: "[\"oven\"]", bedrooms: 2, bathrooms: 1, customerNotes: "original notes",
    staffNotes: "original staff notes", jobTotalCents: 21500, hasStripeCard: 1, paymentBrand: "Visa", paymentLast4: "4242",
    nextOccurrenceCreatedAt: null, ...overrides,
  } as LeadflowJob;
}
const input = (overrides: Partial<Parameters<typeof rescheduleOperationalBooking>[1]> = {}) => ({
  jobId: 10, previousLocalDate: "2026-10-30", requestedLocalDate: "2026-11-02", requestedLocalTime: "14:30", mode: "visit" as const, ...overrides,
});
let db: MemoryDb;
beforeEach(() => { db = new MemoryDb(); db.rows.leadflow_jobs = [job()]; mocks.getDb.mockResolvedValue(db); });

describe("transactional operational rescheduling", () => {
  it("extracts exactly the old worker mapping without retaining its source series ID", () => {
    const source = job({ bookingId: 88, bookingSeriesId: 55, bookingStatus: "unassigned" });
    expect(buildRecurringLeadflowJobValues(source, "2026-11-06", 17000)).toEqual({
      origin: "leadflow_recurrence", launch27BookingId: null, bookingSeriesId: null, bookingId: 88,
      jobDate: "2026-11-06", serviceDateTime: "2026-11-06T14:00:00.000Z",
      customerName: source.customerName, customerPhone: source.customerPhone, customerEmail: source.customerEmail,
      jobAddress: source.jobAddress, serviceName: source.serviceName, bedrooms: source.bedrooms, bathrooms: source.bathrooms,
      extras: source.extras, frequency: source.frequency, bookingStatus: "assigned", teamName: source.teamName,
      teamId: source.teamId, customerNotes: source.customerNotes, staffNotes: source.staffNotes,
      jobTotalCents: 17000, hasStripeCard: source.hasStripeCard, paymentBrand: source.paymentBrand, paymentLast4: source.paymentLast4,
    });
  });
  it.each(["native_booking", "launch27_import", "leadflow_recurrence"])("requires explicit recurring choice uniformly for %s", async origin => {
    db.rows.leadflow_jobs = [job({ origin })];
    await expect(db.transaction(tx => rescheduleOperationalBooking(tx, input({ mode: undefined })))).rejects.toThrow("Choose Move only this visit or Shift subsequent visits");
    expect(db.writes).toEqual([]);
  });
  it("moves one sparse one-time job by exact ID without linking all-null neighbors", async () => {
    db.rows.leadflow_jobs = [job({ frequency: "One time", customerPhone: null, customerEmail: null, jobAddress: null, serviceName: null }), job({ id: 11, jobDate: "2026-11-02", customerPhone: null, customerEmail: null, jobAddress: null, serviceName: null })];
    const other = structuredClone(db.jobs[1]);
    const result = await db.transaction(tx => rescheduleOperationalBooking(tx, input({ mode: undefined })));
    expect(result).toEqual({ movedCount: 1, selectedJobId: 10, continuationCreated: false });
    expect(db.jobs[1]).toEqual(other);
    expect(db.jobs[0].serviceDateTime).toBe("2026-11-02T19:30:00.000Z");
  });
  it("materializes the original next visit with original local time, snapshots and unassigned status", async () => {
    db.rows.leadflow_jobs = [job({ bookingStatus: "unassigned" })];
    const before = structuredClone(db.jobs[0]);
    const result = await db.transaction(tx => rescheduleOperationalBooking(tx, input()));
    expect(result).toEqual({ movedCount: 1, selectedJobId: 10, continuationCreated: true });
    expect(db.jobs[0]).toEqual({ ...before, jobDate: "2026-11-02", serviceDateTime: "2026-11-02T19:30:00.000Z", nextOccurrenceCreatedAt: expect.any(Date) });
    expect(db.jobs[1]).toMatchObject({ jobDate: "2026-11-06", serviceDateTime: "2026-11-06T14:00:00.000Z", bookingStatus: "unassigned", teamId: 7, jobTotalCents: 21500, hasStripeCard: 1, paymentLast4: "4242", extras: before.extras });
    await runEndOfDayLeadflowJobRecurrence(new Date("2026-11-02T23:00:00Z"));
    expect(db.jobs).toHaveLength(2);
    expect(db.jobs.some(row => row.jobDate === "2026-11-09")).toBe(false);
    await runEndOfDayLeadflowJobRecurrence(new Date("2026-11-06T23:00:00Z"));
    expect(db.jobs.map(row => row.jobDate)).toContain("2026-11-13");
  });
  it("uses native future-visit pricing only for the new continuation, never rewrites selected price", async () => {
    db.rows.leadflow_jobs = [job({ bookingId: 88, origin: "native_booking" })];
    db.rows.bookings = [{ id: 88, futureVisitTotalCents: 17000 }];
    await db.transaction(tx => rescheduleOperationalBooking(tx, input()));
    expect(db.jobs[0].jobTotalCents).toBe(21500);
    expect(db.jobs[1]).toMatchObject({ bookingId: 88, jobTotalCents: 17000 });
  });
  it.each([null, new Date("2026-10-30T23:00:00Z")])("preserves an already established future row and existing claim %s", async nextOccurrenceCreatedAt => {
    db.rows.leadflow_jobs = [job({ nextOccurrenceCreatedAt }), job({ id: 11, jobDate: "2026-11-06", serviceDateTime: "2026-11-06T15:00:00Z", jobTotalCents: 17100, teamId: 8 })];
    const future = structuredClone(db.jobs[1]);
    await db.transaction(tx => rescheduleOperationalBooking(tx, input()));
    expect(db.jobs).toHaveLength(2);
    expect(db.jobs[1]).toEqual(future);
    expect(db.jobs[0].nextOccurrenceCreatedAt).toEqual(nextOccurrenceCreatedAt ?? expect.any(Date));
  });
  it("refuses an already-claimed visit when original continuation cannot be proven", async () => {
    db.rows.leadflow_jobs = [job({ nextOccurrenceCreatedAt: new Date() })];
    await expect(db.transaction(tx => rescheduleOperationalBooking(tx, input()))).rejects.toThrow("already claimed");
    expect(db.writes).toEqual([]);
  });
  it.each([null, 88])("repeat visit-only edits preserve the established continuation and claim (bookingId=%s)", async bookingId => {
    db.rows.leadflow_jobs = [job({ bookingId })];
    if (bookingId !== null) db.rows.bookings = [{ id: bookingId, futureVisitTotalCents: 17000 }];
    await db.transaction(tx => rescheduleOperationalBooking(tx, input()));
    const continuation = structuredClone(db.jobs[1]);
    const claim = structuredClone(db.jobs[0].nextOccurrenceCreatedAt);
    for (const [previousLocalDate, requestedLocalDate, requestedLocalTime] of [
      ["2026-11-02", "2026-11-02", "15:00"],
      ["2026-11-02", "2026-11-10", "16:00"],
      ["2026-11-10", "2026-11-03", "12:30"],
    ]) {
      const result = await db.transaction(tx => rescheduleOperationalBooking(tx, input({ previousLocalDate, requestedLocalDate, requestedLocalTime })));
      expect(result).toEqual({ movedCount: 1, selectedJobId: 10, continuationCreated: false });
      expect(db.jobs).toHaveLength(2);
      expect(db.jobs[1]).toEqual(continuation);
      expect(db.jobs[0].nextOccurrenceCreatedAt).toEqual(claim);
    }
    expect(db.jobs[1].jobDate).toBe("2026-11-06");
    expect(db.jobs.some(row => row.jobDate === "2026-11-09")).toBe(false);
  });
  it.each(["inactive", "other-booking", "other-identity", "different-frequency"])("claimed visit refuses unproven %s continuation without writes", async kind => {
    db.rows.leadflow_jobs = [job({ nextOccurrenceCreatedAt: new Date() }), job({ id: 11, jobDate: "2026-11-06",
      ...(kind === "inactive" ? { bookingStatus: "cancelled" } : {}),
      ...(kind === "other-booking" ? { bookingId: 99 } : {}),
      ...(kind === "other-identity" ? { customerEmail: "other@example.com" } : {}),
      ...(kind === "different-frequency" ? { frequency: "Monthly" } : {}),
    })];
    await expect(db.transaction(tx => rescheduleOperationalBooking(tx, input()))).rejects.toThrow();
    expect(db.writes).toEqual([]);
  });
  it("shifts exact linked active rows across DST, preserving all non-schedule fields and claims", async () => {
    db.rows.leadflow_jobs = [job({ bookingId: 88 }), job({ id: 11, bookingId: 88, jobDate: "2026-11-06", jobTotalCents: 17000, nextOccurrenceCreatedAt: new Date() }), job({ id: 12, bookingId: 88, jobDate: "2026-11-13", bookingStatus: "completed" }), job({ id: 13, bookingId: 88, jobDate: "2026-11-20", bookingStatus: "cancelled" }), job({ id: 14, bookingId: 99, jobDate: "2026-11-27", customerPhone: "+12025550999" })];
    const before = structuredClone(db.jobs);
    const result = await db.transaction(tx => rescheduleOperationalBooking(tx, input({ mode: "subsequent" })));
    expect(result.movedCount).toBe(2);
    expect(db.jobs[0]).toEqual({ ...before[0], jobDate: "2026-11-02", serviceDateTime: "2026-11-02T19:30:00.000Z" });
    expect(db.jobs[1]).toEqual({ ...before[1], jobDate: "2026-11-09", serviceDateTime: "2026-11-09T19:30:00.000Z" });
    expect(db.jobs.slice(2)).toEqual(before.slice(2));
  });
  it("uses exact unlinked identity, never phone-only, names or fuzzy addresses", async () => {
    db.rows.leadflow_jobs = [job(), job({ id: 11, jobDate: "2026-11-06" }), job({ id: 12, jobDate: "2026-11-06", jobAddress: "100 Exact Street" }), job({ id: 13, jobDate: "2026-11-06", customerEmail: "other@example.com" })];
    const before = structuredClone(db.jobs);
    await db.transaction(tx => rescheduleOperationalBooking(tx, input({ mode: "subsequent" })));
    expect(db.jobs[1].jobDate).toBe("2026-11-09");
    expect(db.jobs.slice(2)).toEqual(before.slice(2));
  });
  it("supports the exact bookingSeriesId key without identity fallback", async () => {
    db.rows.leadflow_jobs = [job({ bookingSeriesId: 55, customerPhone: null, customerEmail: null, jobAddress: null }), job({ id: 11, bookingSeriesId: 55, jobDate: "2026-11-06" })];
    await db.transaction(tx => rescheduleOperationalBooking(tx, input({ mode: "subsequent" })));
    expect(db.jobs[1].jobDate).toBe("2026-11-09");
  });
  it.each([7, -7])("orders overlapping series moves for a %s calendar-day shift without temporary dates", async days => {
    db.rows.leadflow_jobs = [job({ bookingSeriesId: 55 }), job({ id: 11, bookingSeriesId: 55, jobDate: "2026-11-06" })];
    await db.transaction(tx => rescheduleOperationalBooking(tx, input({ mode: "subsequent", requestedLocalDate: days > 0 ? "2026-11-06" : "2026-10-23" })));
    expect(db.writes.map(write => write.values.jobDate)).toEqual(days > 0 ? ["2026-11-13", "2026-11-06"] : ["2026-10-23", "2026-10-30"]);
  });
  it("rejects duplicate original occurrence dates even for stable booking IDs before shifting anything", async () => {
    db.rows.leadflow_jobs = [job({ bookingId: 88 }), job({ id: 11, bookingId: 88, jobDate: "2026-11-06" }), job({ id: 12, bookingId: 88, jobDate: "2026-11-06" })];
    await expect(db.transaction(tx => rescheduleOperationalBooking(tx, input({ mode: "subsequent" })))).rejects.toThrow("Multiple or inconsistent visits");
    expect(db.writes).toEqual([]);
  });
  it.each(["duplicate", "different-frequency", "linked-other-series", "missing-contact"])("rejects unsafe recurring identity: %s", async kind => {
    if (kind === "duplicate") db.rows.leadflow_jobs.push(job({ id: 11 }));
    if (kind === "different-frequency") db.rows.leadflow_jobs.push(job({ id: 11, jobDate: "2026-11-06", frequency: "Monthly" }));
    if (kind === "linked-other-series") db.rows.leadflow_jobs.push(job({ id: 11, jobDate: "2026-11-06", bookingId: 99 }));
    if (kind === "missing-contact") db.rows.leadflow_jobs = [job({ customerPhone: null, customerEmail: null })];
    await expect(db.transaction(tx => rescheduleOperationalBooking(tx, input({ mode: "subsequent" })))).rejects.toThrow();
    expect(db.writes).toEqual([]);
  });
  it("selects only the original canonical date and rejects duplicate or stale original selection", async () => {
    db.rows.leadflow_jobs = [job({ bookingId: 88 }), job({ id: 11, bookingId: 88, jobDate: "2026-11-06" })];
    await expect(db.transaction(tx => rescheduleOperationalBooking(tx, input({ jobId: undefined, bookingId: 88, previousLocalDate: "2026-11-02" })))).rejects.toThrow("original operational visit");
    expect(db.writes).toEqual([]);
    db.rows.leadflow_jobs.push(job({ id: 12, bookingId: 88 }));
    await expect(db.transaction(tx => rescheduleOperationalBooking(tx, input({ jobId: undefined, bookingId: 88 })))).rejects.toThrow("ambiguous");
    expect(db.writes).toEqual([]);
  });
  it("permits explicitly unassigned canonical records only when no operational rows exist", async () => {
    db.rows.leadflow_jobs = [];
    expect(await db.transaction(tx => rescheduleOperationalBooking(tx, input({ jobId: undefined, bookingId: 88, allowMissingOperationalJob: true })))).toEqual({ movedCount: 0, selectedJobId: null, continuationCreated: false });
    db.rows.leadflow_jobs = [job({ bookingId: 88, jobDate: "2026-11-06" })];
    await expect(db.transaction(tx => rescheduleOperationalBooking(tx, input({ jobId: undefined, bookingId: 88, allowMissingOperationalJob: true })))).rejects.toThrow();
  });
  it.each(["target", "continuation", "terminal-target"])("rejects %s collision before every write", async kind => {
    const date = kind === "continuation" ? "2026-11-06" : "2026-11-02";
    db.rows.leadflow_jobs = [job({ bookingId: 88 })];
    db.rows.leadflow_jobs.push(job({ id: 11, bookingId: 999, jobDate: date, bookingStatus: kind === "terminal-target" ? "completed" : "assigned" }));
    const before = structuredClone(db.jobs);
    await expect(db.transaction(tx => rescheduleOperationalBooking(tx, input()))).rejects.toMatchObject({ code: "CONFLICT" });
    expect(db.writes).toEqual([]); expect(db.jobs).toEqual(before);
  });
  it("rolls back both continuation and move when a write fails", async () => {
    const before = structuredClone(db.jobs); db.failUpdateId = 10;
    await expect(db.transaction(tx => rescheduleOperationalBooking(tx, input()))).rejects.toThrow("Injected");
    expect(db.jobs).toEqual(before); expect(db.commits).toBe(0);
  });
  it.each(["completed", "cancelled", "canceled", "rescheduled", "missing_from_launch27"])("does not mutate selected %s visits", async bookingStatus => {
    db.rows.leadflow_jobs = [job({ bookingStatus })];
    await expect(db.transaction(tx => rescheduleOperationalBooking(tx, input()))).rejects.toThrow("inactive"); expect(db.writes).toEqual([]);
  });
  it("rejects invalid local spring-forward time, malformed date/time and stale time without writes", async () => {
    db.rows.leadflow_jobs = [job({ frequency: "One time" })];
    await expect(db.transaction(tx => rescheduleOperationalBooking(tx, input({ requestedLocalDate: "2027-03-14", requestedLocalTime: "02:30" })))).rejects.toThrow("does not exist");
    await expect(db.transaction(tx => rescheduleOperationalBooking(tx, input({ requestedLocalDate: "2026-02-30" })))).rejects.toThrow();
    await expect(db.transaction(tx => rescheduleOperationalBooking(tx, input({ requestedLocalTime: "25:00" })))).rejects.toThrow();
    await expect(db.transaction(tx => rescheduleOperationalBooking(tx, input({ previousLocalTime: "10:00" })))).rejects.toThrow("time has changed");
    expect(db.writes).toEqual([]);
  });
  it("returns a no-op without claiming recurrence when schedule is unchanged", async () => {
    expect(await db.transaction(tx => rescheduleOperationalBooking(tx, input({ requestedLocalDate: "2026-10-30", requestedLocalTime: "09:00", mode: undefined })))).toEqual({ movedCount: 0, selectedJobId: 10, continuationCreated: false });
    expect(db.writes).toEqual([]);
  });
});
