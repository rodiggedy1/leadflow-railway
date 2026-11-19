import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getTableName } from "drizzle-orm";
import { type LeadflowJob } from "../drizzle/schema";
import {
  effectiveNativeFutureAmount, effectiveNativeVisitAmount,
  type NativeBookingManualAmounts,
} from "../shared/nativeBookingManualAmounts";
import { syncNativeBookingOperationalProjection } from "./bookingLifecycleService";
import { rescheduleOperationalBooking, type BookingRescheduleTransaction } from "./bookingRescheduleService";
import { buildRecurringLeadflowJobValues, runEndOfDayLeadflowJobRecurrence } from "./leadflowJobsService";

const mocks = vi.hoisted(() => ({ getDb: vi.fn(), provider: vi.fn() }));
vi.mock("./db", () => ({ getDb: mocks.getDb }));
vi.mock("./launch27", () => ({ getCompletedBookingsForDate: mocks.provider }));
vi.mock("drizzle-orm", async (original) => ({
  ...await original<typeof import("drizzle-orm")>(),
  eq: (column: Column, value: unknown) => ({ op: "eq", column, value }),
  gt: (column: Column, value: unknown) => ({ op: "gt", column, value }),
  lte: (column: Column, value: unknown) => ({ op: "lte", column, value }),
  isNull: (column: Column) => ({ op: "null", column }),
  inArray: (column: Column, value: unknown[]) => ({ op: "in", column, value }),
  and: (...conditions: Condition[]) => ({ op: "and", conditions }),
}));

type Column = { name: string };
type Condition = { op: string; column?: Column; value?: any; conditions?: Condition[] };
type Row = Record<string, any>;
type Event = { kind: "select" | "update" | "insert"; table: string; transaction: boolean; locked?: boolean; ids?: number[]; values?: Row };
function matches(row: Row, condition?: Condition): boolean {
  if (!condition) return true;
  if (condition.op === "and") return condition.conditions!.every(c => matches(row, c));
  const value = row[condition.column!.name];
  if (condition.op === "eq") return value === condition.value;
  if (condition.op === "null") return value === null;
  if (condition.op === "gt") return value > condition.value;
  if (condition.op === "lte") return value <= condition.value;
  if (condition.op === "in") return condition.value.includes(value);
  throw new Error(`Unexpected condition ${condition.op}`);
}
/** The same select/update/insert transaction fixture pattern as bookingRescheduleService.test.ts. */
class MemoryDb {
  rows: Record<string, Row[]> = { leadflow_jobs: [], bookings: [] };
  events: Event[] = [];
  commits = 0;
  rollbacks = 0;
  failInsert = false;
  failAmountId: number | null = null;
  onBookingLock: ((rows: Record<string, Row[]>) => void) | null = null;
  onTransactionStart: (() => void) | null = null;
  adapter(rows = this.rows, transaction = false) {
    const db = this;
    return {
      select(fields?: Record<string, Column>) {
        let table: string; let condition: Condition | undefined; let count = Infinity; let locked = false;
        const chain = {
          from(value: any) { table = getTableName(value); return chain; },
          where(value: Condition) { condition = value; return chain; },
          limit(value: number) { count = value; return chain; },
          for(value: string) { expect(value).toBe("update"); locked = true; return chain; },
          then(resolve: (selected: Row[]) => unknown, reject: (error: unknown) => unknown) {
            try {
              if (table === "bookings" && locked) db.onBookingLock?.(rows);
              const selected = rows[table].filter(row => matches(row, condition)).slice(0, count);
              db.events.push({ kind: "select", table, transaction, locked, ids: selected.map(row => row.id) });
              const values = fields ? selected.map(row => Object.fromEntries(Object.entries(fields).map(([key, col]) => [key, row[col.name]]))) : selected;
              return Promise.resolve(structuredClone(values)).then(resolve, reject);
            } catch (error) { return Promise.reject(error).then(resolve, reject); }
          },
        };
        return chain;
      },
      update(value: any) {
        const table = getTableName(value);
        return { set(values: Row) { return { async where(condition: Condition) {
          const selected = rows[table].filter(row => matches(row, condition));
          db.events.push({ kind: "update", table, transaction, ids: selected.map(row => row.id), values: structuredClone(values) });
          if ("jobTotalCents" in values && selected.some(row => row.id === db.failAmountId)) throw new Error("Injected amount write failure");
          selected.forEach(row => Object.assign(row, structuredClone(values)));
          return [{ affectedRows: selected.length }];
        } }; } };
      },
      insert(value: any) {
        const table = getTableName(value);
        return { async values(values: Row) {
          db.events.push({ kind: "insert", table, transaction, values: structuredClone(values) });
          if (db.failInsert) throw new Error("Injected insert failure");
          const id = Math.max(0, ...rows[table].map(row => row.id)) + 1;
          rows[table].push({ nextOccurrenceCreatedAt: null, ...structuredClone(values), id });
          return [{ insertId: id }];
        } };
      },
    };
  }
  select = (fields?: Record<string, Column>) => this.adapter().select(fields);
  update = (table: any) => this.adapter().update(table);
  insert = (table: any) => this.adapter().insert(table);
  async transaction<T>(callback: (tx: BookingRescheduleTransaction) => Promise<T>): Promise<T> {
    this.onTransactionStart?.();
    const copy = structuredClone(this.rows);
    try {
      const result = await callback(this.adapter(copy, true) as unknown as BookingRescheduleTransaction);
      this.rows = copy; this.commits++; return result;
    } catch (error) { this.rollbacks++; throw error; }
  }
  get jobs(): LeadflowJob[] { return this.rows.leadflow_jobs as LeadflowJob[]; }
  get writes(): Event[] { return this.events.filter(event => event.kind !== "select"); }
}
const NOW = new Date("2026-11-19T23:00:00Z");
const CURRENT = "2026-11-19";
const NEXT = "2026-11-26";
const assignment = { teamId: 7, teamName: "Team snapshot" };
function metadata(overrides: Partial<NativeBookingManualAmounts> = {}): NativeBookingManualAmounts {
  return { version: 1, revision: 0, visits: [], seriesRules: [], history: [], ...overrides };
}
function booking(overrides: Row = {}): Row {
  return {
    id: 88, requestedLocalDate: CURRENT, requestedLocalTime: "09:00", requestedTimeZone: "America/New_York",
    recurrence: "weekly", firstCleaningTotalCents: 21500, futureVisitTotalCents: 17000, manualAmountOverrides: null,
    extras: [{ id: "oven", quantity: 1, totalCents: 1000 }], specialRequestNotes: ["original notes"], companyNotes: "company notes",
    customerName: "Exact Customer", customerPhone: "+12025550100", customerEmail: "exact@example.com", address: "100 Exact St",
    serviceName: "Standard cleaning", bedrooms: 2, bathrooms: 1, status: "confirmed", paymentStatus: "card_on_file",
    ...overrides,
  };
}
function job(overrides: Partial<LeadflowJob> = {}): LeadflowJob {
  return {
    id: 10, origin: "native_booking", launch27BookingId: null, bookingId: 88, bookingSeriesId: null,
    jobDate: CURRENT, serviceDateTime: "2026-11-19T14:00:00.000Z", frequency: "Weekly", nextOccurrenceCreatedAt: null,
    customerName: "Exact Customer", customerPhone: "+12025550100", customerEmail: "exact@example.com", jobAddress: "100 Exact St",
    serviceName: "Standard cleaning", bedrooms: 2, bathrooms: 1, extras: "[\"oven\"]", bookingStatus: "assigned",
    teamId: 7, teamName: "Team snapshot", customerNotes: "original notes", staffNotes: "original staff notes",
    jobTotalCents: 21500, hasStripeCard: 1, paymentBrand: "Visa", paymentLast4: "4242", ...overrides,
  } as LeadflowJob;
}
function seed(amounts: unknown = null) {
  db.rows.bookings = [booking({ manualAmountOverrides: amounts })];
  db.rows.leadflow_jobs = [
    job({ id: 9, jobDate: "2026-11-12", bookingStatus: "completed", jobTotalCents: 14500 }),
    job(), job({ id: 11, jobDate: NEXT, jobTotalCents: 17000 }),
    job({ id: 12, jobDate: "2026-12-03", jobTotalCents: 16500 }),
    job({ id: 13, jobDate: "2026-12-10", jobTotalCents: 17500 }),
    job({ id: 90, bookingId: 99, jobDate: NEXT, jobTotalCents: 9900 }),
  ];
}
const withoutAmounts = (values: Row) => {
  const { jobTotalCents: _amount, ...rest } = values;
  return rest;
};
let db: MemoryDb;
beforeEach(() => {
  vi.clearAllMocks(); vi.useFakeTimers(); vi.setSystemTime(NOW);
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Network access prohibited"); }));
  mocks.provider.mockImplementation(() => { throw new Error("Provider access prohibited"); });
  db = new MemoryDb(); mocks.getDb.mockResolvedValue(db); seed();
});
afterEach(() => {
  expect(mocks.provider).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
  expect(db.writes.every(event => event.table === "leadflow_jobs")).toBe(true);
  vi.unstubAllGlobals(); vi.useRealTimers(); vi.restoreAllMocks();
});
async function project(assignmentValue = assignment, options?: Parameters<typeof syncNativeBookingOperationalProjection>[3]) {
  return db.transaction(tx => syncNativeBookingOperationalProjection(tx, db.rows.bookings[0] as any, assignmentValue, options));
}

describe("native manual amount operational projection (synthetic transactions only)", () => {
  it.each([null, undefined])("retains exact current/future no-metadata amounts and original assignment write payloads (%s)", async amounts => {
    seed(amounts); const before = structuredClone(db.rows);
    await project();
    expect(db.writes).toEqual([
      { kind: "update", table: "leadflow_jobs", transaction: true, ids: [10], values: {
        bookingId: 88, jobDate: CURRENT, serviceDateTime: "2026-11-19T14:00:00.000Z",
        customerName: "Exact Customer", customerPhone: "+12025550100", customerEmail: "exact@example.com", jobAddress: "100 Exact St",
        serviceName: "Standard cleaning", bedrooms: 2, bathrooms: 1, extras: '["oven"]', frequency: "Weekly",
        teamName: assignment.teamName, teamId: assignment.teamId, customerNotes: "original notes\ncompany notes",
        jobTotalCents: 21500, hasStripeCard: 1, bookingStatus: "assigned", updatedAt: NOW,
      } },
      { kind: "update", table: "leadflow_jobs", transaction: true, ids: [11, 12, 13], values: {
        teamName: assignment.teamName, teamId: assignment.teamId, extras: '["oven"]', frequency: "Weekly",
        customerNotes: "original notes\ncompany notes", jobTotalCents: 17000, hasStripeCard: 1, updatedAt: NOW,
      } },
    ]);
    expect(db.jobs[0]).toEqual(before.leadflow_jobs[0]); expect(db.jobs[5]).toEqual(before.leadflow_jobs[5]);
    expect(db.rows.bookings).toEqual(before.bookings);
  });
  it("preserves an already edited current amount and every materialized future amount without changing original booking totals", async () => {
    seed(metadata({ visits: [{ jobId: 10, date: CURRENT, firstVisit: true, amountCents: 23000, protected: false }] }));
    db.rows.leadflow_jobs[1].jobTotalCents = 23000;
    const before = structuredClone(db.rows.bookings);
    await project();
    expect(db.jobs.map(row => row.jobTotalCents)).toEqual([14500, 23000, 17000, 16500, 17500, 9900]);
    expect(db.rows.bookings).toEqual(before);
  });
  it("preserves already materialized exceptions and series amounts without any future price write", async () => {
    const amounts = metadata({
      visits: [
        { jobId: 9, date: "2026-11-12", firstVisit: false, amountCents: 14500, protected: true },
        { jobId: 10, date: "2026-11-01", firstVisit: true, amountCents: 21500, protected: true },
        { jobId: 12, date: "2026-12-03", firstVisit: false, amountCents: 16500, protected: true },
        { jobId: 13, date: "2026-12-10", firstVisit: false, amountCents: 18100, protected: false },
      ],
      seriesRules: [{ fromDate: CURRENT, amountCents: 22000 }, { fromDate: "2026-12-01", amountCents: 19000 }],
    });
    seed(amounts);
    db.rows.leadflow_jobs[2].jobTotalCents = 22000;
    db.rows.leadflow_jobs[4].jobTotalCents = 18100;
    const before = structuredClone(db.rows);
    await project();
    expect(db.jobs.map(row => row.jobTotalCents)).toEqual([14500, 21500, 22000, 16500, 18100, 9900]);
    expect(db.jobs[0]).toEqual(before.leadflow_jobs[0]); expect(db.jobs[5]).toEqual(before.leadflow_jobs[5]);
    expect(db.rows.bookings).toEqual(before.bookings);
    expect(db.writes.filter(event => (event.ids?.length ?? 0) > 1).every(event => !("jobTotalCents" in event.values!))).toBe(true);
    for (const event of db.writes.filter(event => "jobTotalCents" in event.values!)) {
      expect(event.ids).toHaveLength(1);
      const id = event.ids![0];
      const selected = before.leadflow_jobs.find(row => row.id === id)!;
      expect(id).toBe(10);
      expect(event.values!.jobTotalCents).toBe(selected.jobTotalCents);
    }
    seed(); await project(); const baseline = db.writes.slice(-2);
    expect(withoutAmounts(db.writes[0].values!)).toEqual(withoutAmounts(baseline[0].values!));
    expect(withoutAmounts(db.writes[1].values!)).toEqual(withoutAmounts(baseline[1].values!));
  });
  it("preserves current materialized prices even when the latest earlier-boundary rule differs", async () => {
    seed(metadata({ seriesRules: [{ fromDate: "2026-12-01", amountCents: 19000 }, { fromDate: CURRENT, amountCents: 22100 }] }));
    const before = db.jobs.map(row => row.jobTotalCents);
    await project();
    expect(db.jobs.map(row => row.jobTotalCents)).toEqual(before);
  });
  it("keeps existing non-amount updates to a completed future row while freezing only its protected amount", async () => {
    seed(metadata({ visits: [{ jobId: 12, date: "2026-12-03", firstVisit: false, amountCents: 16500, protected: true }], seriesRules: [{ fromDate: CURRENT, amountCents: 22200 }] }));
    db.rows.leadflow_jobs[3].bookingStatus = "completed";
    await project();
    expect(db.jobs[3]).toMatchObject({ bookingStatus: "completed", jobTotalCents: 16500, teamId: 7, customerNotes: "original notes\ncompany notes" });
  });
  it.each([null, metadata({ seriesRules: [{ fromDate: CURRENT, amountCents: 22200 }] })])("keeps null-assignment status-only payloads and all amounts unchanged (%j)", async amounts => {
    seed(amounts); const before = structuredClone(db.jobs);
    await db.transaction(tx => syncNativeBookingOperationalProjection(tx, db.rows.bookings[0] as any, null));
    expect(db.writes).toEqual([{ kind: "update", table: "leadflow_jobs", transaction: true, ids: [9, 10, 11, 12, 13], values: { bookingStatus: "unassigned", updatedAt: NOW } }]);
    expect(db.jobs.map(row => row.jobTotalCents)).toEqual(before.map(row => row.jobTotalCents));
  });
  it.each([null, metadata()])("retains one-time null-future cancellation behavior (%j)", async amounts => {
    seed(amounts); db.rows.bookings[0].futureVisitTotalCents = null; db.rows.bookings[0].recurrence = "one-time";
    await project();
    expect(db.writes.at(-1)).toEqual({ kind: "update", table: "leadflow_jobs", transaction: true, ids: [11, 12, 13], values: { bookingStatus: "cancelled", updatedAt: NOW } });
    expect(db.jobs.slice(2, 5).map(row => row.jobTotalCents)).toEqual(amounts == null ? [21500, 21500, 21500] : [17000, 16500, 17500]);
  });
  it("creates a missing first owned row with the unchanged financial total while retaining its separate Bookings amount", async () => {
    db.rows.leadflow_jobs = []; db.rows.bookings = [booking({ manualAmountOverrides: metadata({ visits: [{ jobId: null, date: CURRENT, firstVisit: true, amountCents: 23125, protected: false }] }) })];
    const before = structuredClone(db.rows.bookings);
    await project();
    expect(db.jobs[0]).toMatchObject({ origin: "native_booking", bookingId: 88, jobTotalCents: 21500, bookingStatus: "assigned" });
    expect(db.rows.bookings).toEqual(before);
  });
  it("preserves an already edited first row at 23125 instead of reselecting a conflicting date rule", async () => {
    seed(metadata({ seriesRules: [{ fromDate: CURRENT, amountCents: 22200 }] }));
    db.rows.leadflow_jobs[1].jobTotalCents = 23125;
    await project();
    expect(db.jobs[1].jobTotalCents).toBe(23125);
    expect(db.writes[0].values?.jobTotalCents).toBe(23125);
  });
  it("commercial projection preserves retained exact current and future amounts after crossing the date boundary", async () => {
    seed(metadata({ visits: [{ jobId: 10, date: CURRENT, firstVisit: true, amountCents: 23200, protected: false }, { jobId: 12, date: "2026-12-03", firstVisit: false, amountCents: 16500, protected: true }], seriesRules: [{ fromDate: CURRENT, amountCents: 22000 }, { fromDate: "2026-12-01", amountCents: 19000 }] }));
    db.rows.leadflow_jobs[1].jobTotalCents = 23200;
    db.rows.leadflow_jobs[2].jobTotalCents = 22000;
    db.rows.leadflow_jobs[4].jobTotalCents = 19000;
    db.rows.bookings[0].requestedLocalDate = "2026-12-17"; db.rows.leadflow_jobs[1].jobDate = "2026-12-17";
    const past = structuredClone(db.jobs[0]);
    await project(assignment, { commercialOnly: true, selectedJobId: 10, futureJobIds: [11, 12, 13] });
    expect(db.jobs.map(row => row.jobTotalCents)).toEqual([14500, 23200, 22000, 16500, 19000, 9900]);
    expect(db.jobs[0]).toEqual(past);
    for (const event of db.writes) {
      expect(Object.keys(event.values!).sort()).toEqual(["customerNotes", "extras", "updatedAt"]);
    }
  });
  it.each([false, true])("retains paid/invoiced job 12 at 22200 after its 2030-01-09 rule crosses to 2030-01-08 (commercialOnly=%s)", async commercialOnly => {
    const amounts = metadata({ seriesRules: [{ fromDate: "2030-01-09", amountCents: 22200 }] });
    db.rows.bookings = [booking({ id: 7, requestedLocalDate: "2030-01-02", firstCleaningTotalCents: 15000, futureVisitTotalCents: 12000, manualAmountOverrides: amounts })];
    db.rows.leadflow_jobs = [
      job({ id: 11, bookingId: 7, jobDate: "2030-01-02", jobTotalCents: 15000 }),
      job({ id: 12, bookingId: 7, jobDate: "2030-01-09", jobTotalCents: 12000 }),
    ];
    // Staff amount save has already materialized the rule before a later claim.
    db.rows.leadflow_jobs[1].jobTotalCents = 22200;
    const retainedInvoice = { occurrenceKey: "job:12", amountCents: 22200, status: "paid" };
    db.rows.bookings[0].requestedLocalDate = "2030-01-01";
    db.rows.leadflow_jobs[0].jobDate = "2030-01-01";
    db.rows.leadflow_jobs[1].jobDate = "2030-01-08";
    expect(amounts.visits).toEqual([]);
    expect(effectiveNativeVisitAmount(db.rows.bookings[0] as any, "2030-01-08", { jobId: 12, firstVisit: false })).toBe(12000);
    await project(assignment, commercialOnly ? { commercialOnly: true, selectedJobId: 11, futureJobIds: [12] } : undefined);
    expect(db.jobs[1].jobTotalCents).toBe(22200);
    expect(retainedInvoice).toEqual({ occurrenceKey: "job:12", amountCents: 22200, status: "paid" });
    expect(db.writes.filter(event => event.ids?.includes(12)).every(event => !("jobTotalCents" in event.values!))).toBe(true);
    expect(db.events.filter(event => event.kind === "select").map(event => event.table)).toEqual(["leadflow_jobs"]);
    if (commercialOnly) expect(db.writes.every(event => !("jobTotalCents" in event.values!))).toBe(true);
  });
  it.each([[11, 404], [11, 90], [11, 11], [10, 11]].map(futureJobIds => ({ futureJobIds })))("rejects unsafe commercial future IDs $futureJobIds before any writes", async ({ futureJobIds }) => {
    seed(metadata());
    await expect(project(assignment, { commercialOnly: true, selectedJobId: 10, futureJobIds })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(db.writes).toEqual([]); expect(db.commits).toBe(0);
  });
  it("no-metadata commercial projection retains its two original write payloads", async () => {
    await project(assignment, { commercialOnly: true, selectedJobId: 10, futureJobIds: [11, 12] });
    expect(db.writes).toEqual([
      { kind: "update", table: "leadflow_jobs", transaction: true, ids: [10], values: { extras: '["oven"]', customerNotes: "original notes\ncompany notes", jobTotalCents: 21500, updatedAt: NOW } },
      { kind: "update", table: "leadflow_jobs", transaction: true, ids: [11, 12], values: { extras: '["oven"]', customerNotes: "original notes\ncompany notes", jobTotalCents: 17000, updatedAt: NOW } },
    ]);
  });
  it("rolls back projection when the existing current-row assignment update fails", async () => {
    seed(metadata({ seriesRules: [{ fromDate: CURRENT, amountCents: 22200 }] })); const before = structuredClone(db.rows); db.failAmountId = 10;
    await expect(project()).rejects.toThrow("Injected amount");
    expect(db.rows).toEqual(before); expect(db.rollbacks).toBe(1);
  });
  it("retains canonical ambiguity rejection with metadata", async () => {
    seed(metadata()); db.rows.leadflow_jobs.push(job({ id: 14 }));
    await expect(project()).rejects.toMatchObject({ code: "CONFLICT" }); expect(db.writes).toEqual([]);
  });
});

describe("native recurrence locking and amount projection", () => {
  function seedWorker(amounts: unknown = null) { db.rows.bookings = [booking({ manualAmountOverrides: amounts })]; db.rows.leadflow_jobs = [job()]; }
  it.each([null, undefined])("locks native booking before its claim even with no metadata (%s), preserving recurrence payload", async amounts => {
    seedWorker(amounts); const before = structuredClone(db.jobs[0]);
    expect(await runEndOfDayLeadflowJobRecurrence(NOW)).toEqual({ checked: 1, created: 1, skipped: 0, errors: 0 });
    expect(db.events.map(event => [event.kind, event.table, event.transaction, event.locked ?? false])).toEqual([
      ["select", "leadflow_jobs", false, false], ["select", "bookings", true, true],
      ["update", "leadflow_jobs", true, false], ["select", "leadflow_jobs", true, false], ["insert", "leadflow_jobs", true, false],
    ]);
    expect(db.writes.at(-1)?.values).toEqual(buildRecurringLeadflowJobValues(before, NEXT, 17000));
  });
  it("evaluates future amount at next date, not the latest later boundary or any first-visit exception", async () => {
    const amounts = metadata({ visits: [{ jobId: 10, date: CURRENT, firstVisit: true, amountCents: 29000, protected: false }], seriesRules: [{ fromDate: NEXT, amountCents: 22000 }, { fromDate: "2026-12-01", amountCents: 19000 }] });
    seedWorker(amounts);
    await runEndOfDayLeadflowJobRecurrence(NOW);
    expect(db.jobs[1].jobTotalCents).toBe(effectiveNativeFutureAmount(db.rows.bookings[0] as any, NEXT));
    expect(db.jobs[1]).toMatchObject({ jobDate: NEXT, jobTotalCents: 22000, bookingId: 88, frequency: "Weekly", teamId: 7, paymentLast4: "4242", customerNotes: "original notes" });
  });
  it("sees metadata created after the initial job read because even null-metadata native rows take the booking lock", async () => {
    seedWorker();
    db.onBookingLock = rows => { rows.bookings[0].manualAmountOverrides = metadata({ seriesRules: [{ fromDate: NEXT, amountCents: 22100 }] }); };
    await runEndOfDayLeadflowJobRecurrence(NOW);
    expect(db.jobs[1].jobTotalCents).toBe(22100);
    expect(db.events[1]).toMatchObject({ table: "bookings", locked: true, transaction: true });
  });
  it("preserves completed native source amount and uses the future rule only for its continuation", async () => {
    seedWorker(metadata({ visits: [{ jobId: 10, date: CURRENT, firstVisit: true, amountCents: 21500, protected: true }], seriesRules: [{ fromDate: CURRENT, amountCents: 22200 }] }));
    db.rows.leadflow_jobs[0].bookingStatus = "completed";
    await runEndOfDayLeadflowJobRecurrence(NOW);
    expect(db.jobs[0]).toMatchObject({ bookingStatus: "completed", jobTotalCents: 21500 }); expect(db.jobs[1].jobTotalCents).toBe(22200);
  });
  it("closes a duplicate native continuation inside the same transaction without changing its pinned amount", async () => {
    seedWorker(metadata()); db.rows.leadflow_jobs.push(job({ id: 11, jobDate: NEXT, jobTotalCents: 16100 }));
    const future = structuredClone(db.jobs[1]);
    expect(await runEndOfDayLeadflowJobRecurrence(NOW)).toEqual({ checked: 1, created: 0, skipped: 1, errors: 0 });
    expect(db.jobs[1]).toEqual(future); expect(db.jobs[0].nextOccurrenceCreatedAt).toEqual(NOW); expect(db.commits).toBe(1);
  });
  it("retains a lost native claim without insertion, skip inflation or recovery writes", async () => {
    seedWorker(metadata()); const claimedAt = new Date("2026-11-19T22:00:00Z");
    db.onTransactionStart = () => { db.rows.leadflow_jobs[0].nextOccurrenceCreatedAt = claimedAt; };
    expect(await runEndOfDayLeadflowJobRecurrence(NOW)).toEqual({ checked: 1, created: 0, skipped: 0, errors: 0 });
    expect(db.jobs).toHaveLength(1); expect(db.jobs[0].nextOccurrenceCreatedAt).toEqual(claimedAt);
    expect(db.writes).toHaveLength(1); expect(db.writes[0].ids).toEqual([]);
  });
  it("rolls back a failed native insertion and uses the existing one-time claim recovery/error counter", async () => {
    seedWorker(metadata()); db.failInsert = true; vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await runEndOfDayLeadflowJobRecurrence(NOW)).toEqual({ checked: 1, created: 0, skipped: 0, errors: 1 });
    expect(db.jobs).toHaveLength(1); expect(db.jobs[0].nextOccurrenceCreatedAt).toBeNull(); expect(db.rollbacks).toBe(1);
    const recoveries = db.writes.filter(event => event.values?.nextOccurrenceCreatedAt === null);
    expect(recoveries).toHaveLength(1); expect(recoveries[0]).toMatchObject({ transaction: false, ids: [10] });
  });
  it("rejects corrupt metadata without silently inserting baseline prices", async () => {
    seedWorker({ version: 7 }); vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await runEndOfDayLeadflowJobRecurrence(NOW)).toEqual({ checked: 1, created: 0, skipped: 0, errors: 1 });
    expect(db.jobs).toHaveLength(1); expect(db.jobs[0].nextOccurrenceCreatedAt).toBeNull();
  });
  it("keeps the imported claim-before-read/no-transaction pattern and original full recurrence values", async () => {
    db.rows.bookings = []; db.rows.leadflow_jobs = [job({ bookingId: null, origin: "launch27_import", launch27BookingId: 100 })];
    const before = structuredClone(db.jobs[0]);
    expect(await runEndOfDayLeadflowJobRecurrence(NOW)).toEqual({ checked: 1, created: 1, skipped: 0, errors: 0 });
    expect(db.events.map(event => [event.kind, event.table, event.transaction])).toEqual([
      ["select", "leadflow_jobs", false], ["update", "leadflow_jobs", false], ["select", "leadflow_jobs", false], ["insert", "leadflow_jobs", false],
    ]);
    expect(db.writes.at(-1)?.values).toEqual(buildRecurringLeadflowJobValues(before, NEXT, before.jobTotalCents)); expect(db.commits).toBe(0);
  });
});

describe("native manual amount reschedule continuation", () => {
  it("retains pinned moved price and original cadence while selecting continuation-date future amount", async () => {
    db.rows.bookings = [booking({ manualAmountOverrides: metadata({
      visits: [{ jobId: 10, date: CURRENT, firstVisit: true, amountCents: 23200, protected: false }],
      seriesRules: [{ fromDate: NEXT, amountCents: 22200 }, { fromDate: "2026-12-01", amountCents: 19000 }],
    }) })];
    db.rows.leadflow_jobs = [job({ jobTotalCents: 23200 })]; const before = structuredClone(db.rows);
    await db.transaction(tx => rescheduleOperationalBooking(tx, {
      bookingId: 88, jobId: 10, previousLocalDate: CURRENT, previousLocalTime: "09:00",
      requestedLocalDate: "2026-12-02", requestedLocalTime: "14:30", mode: "visit",
    }));
    expect(db.jobs[0]).toEqual({ ...before.leadflow_jobs[0], jobDate: "2026-12-02", serviceDateTime: "2026-12-02T19:30:00.000Z", nextOccurrenceCreatedAt: NOW });
    expect(db.jobs[1]).toMatchObject({ jobDate: NEXT, serviceDateTime: "2026-11-26T14:00:00.000Z", jobTotalCents: 22200, frequency: "Weekly", paymentLast4: "4242" });
    expect(db.writes.filter(event => event.kind === "update").every(event => !("jobTotalCents" in event.values!))).toBe(true);
    expect(db.rows.bookings).toEqual(before.bookings);
    // Canonical reschedule caller owns its date update; reproduce that already
    // verified state before asking the existing commercial projection to run.
    db.rows.bookings[0].requestedLocalDate = "2026-12-02";
    await project(assignment, { commercialOnly: true, selectedJobId: 10, futureJobIds: [11] });
    expect(db.jobs[0].jobTotalCents).toBe(23200); expect(db.jobs[1].jobTotalCents).toBe(22200);
  });
  it("leaves an already established future occurrence untouched and never reselects its price", async () => {
    seed(metadata({ seriesRules: [{ fromDate: CURRENT, amountCents: 22200 }] }));
    const future = structuredClone(db.jobs.slice(2));
    await db.transaction(tx => rescheduleOperationalBooking(tx, { jobId: 10, bookingId: 88, previousLocalDate: CURRENT, requestedLocalDate: "2026-11-20", requestedLocalTime: "10:00", mode: "visit" }));
    expect(db.jobs.slice(2)).toEqual(future); expect(db.writes).toHaveLength(1); expect(db.writes[0].values).not.toHaveProperty("jobTotalCents");
  });
});
