import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { drizzle } from "drizzle-orm/mysql-proxy";
import { getTableColumns } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { bookings, bookingSeries, bookingPaymentProfiles, cardAuthTokens, cleanerPortalJobProgress, cleanerPortalJobSignoffs, leadflowJobs, paymentAuthorizations } from "../drizzle/schema";
import { effectiveNativeFutureAmount, effectiveNativeVisitAmount, parseNativeBookingManualAmounts, selectNativeDisplayAmounts, updateNativeBookingManualAmountInputSchema } from "../shared/nativeBookingManualAmounts";
import { updateNativeBookingManualAmount, type NativeBookingManualAmountTx, type UpdateNativeBookingManualAmountInput } from "./nativeBookingManualAmountService";
import { readFileSync } from "node:fs";

// The actual Drizzle schema, SQL construction, bindings and SELECT mapping run.
// This bounded synthetic interpreter has no MySQL isolation/constraint claims.
// Collection records remain in state for preservation checks; reading them fails.
type Row = Record<string, any>;
const tables = { bookings, booking_series: bookingSeries, booking_payment_profiles: bookingPaymentProfiles, card_auth_tokens: cardAuthTokens, cleaner_portal_job_progress: cleanerPortalJobProgress, cleaner_portal_job_signoffs: cleanerPortalJobSignoffs, leadflow_jobs: leadflowJobs, payment_authorizations: paymentAuthorizations };
type TableName = keyof typeof tables;
const dialect = new MySqlDialect();
class Fixture {
  state = Object.fromEntries(Object.keys(tables).map(key => [key, []])) as Record<TableName, Row[]>;
  claims: Row[] = [];
  manual: Row[] = [];
  queries: { sql: string; params: unknown[] }[] = [];
  events: string[] = [];
  failWrite: TableName | null = null;
  failWriteCount: TableName | null = null;
  changeAmountBeforeWrite = false;
  private locked = false;
  private client = drizzle(async (sql, params) => this.query(sql, params));
  private reject(sql: string): never { throw new Error(`Unsupported synthetic SQL: ${sql}`); }
  private async query(sql: string, params: unknown[]) {
    this.queries.push({ sql, params: structuredClone(params) });
    if (sql.startsWith("select")) {
      const parsed = /^select (.+) from `([^`]+)` where (.*?)(?: order by (.*?))?(?: limit \?)? for update$/.exec(sql);
      if (!parsed || !Object.hasOwn(tables, parsed[2])) return this.reject(sql);
      const [, projection, table, where, order] = parsed;
      if (table !== "bookings" && table !== "leadflow_jobs") return this.reject(sql);
      if (table === "bookings") this.locked = true;
      expect(this.locked).toBe(true);
      const columns = getTableColumns(tables[table as TableName]);
      const valid = (name: string) => Object.values(columns).some(col => col.name === name);
      const term = /`([^`]+)`\.`([^`]+)` (= \?|in \((?:\?(?:, )?)+\))/g;
      const terms = [...where.matchAll(term)];
      if (!terms.length || where.replace(term, "").replace(/[()\s]/g, "").replace(/and/g, "")) return this.reject(sql);
      let offset = 0;
      const filters = terms.map(match => {
        if (match[1] !== table || !valid(match[2])) return this.reject(sql);
        const count = (match[3].match(/\?/g) ?? []).length;
        const values = params.slice(offset, offset + count); offset += count;
        return (row: Row) => values.includes(row[match[2]]);
      });
      const limited = sql.includes(" limit ?");
      if (offset !== params.length - Number(limited)) return this.reject(sql);
      let rows = this.state[table as TableName].filter(row => filters.every(filter => filter(row)));
      if (order) {
        const sort = /^`([^`]+)`\.`([^`]+)`$/.exec(order);
        if (!sort || sort[1] !== table || !valid(sort[2])) return this.reject(sql);
        rows = [...rows].sort((a, b) => a[sort[2]] < b[sort[2]] ? -1 : a[sort[2]] === b[sort[2]] ? 0 : 1);
      }
      if (limited) rows = rows.slice(0, Number(params.at(-1)));
      const fields = projection.split(", ").map(field => {
        const match = /^(?:`([^`]+)`\.)?`([^`]+)`$/.exec(field);
        if (!match || match[1] && match[1] !== table || !valid(match[2])) return this.reject(sql);
        return match[2];
      });
      return { rows: rows.map(row => fields.map(name => {
        const value = row[name] ?? null;
        return structuredClone(value);
      })) };
    }
    const update = /^update `(bookings|leadflow_jobs)` set (.+) where (.+)$/.exec(sql);
    if (!update) return this.reject(sql);
    expect(this.locked).toBe(true);
    const [, table, set, where] = update;
    const assignments = set.split(", ").map(part => /^`([^`]+)` = \?$/.exec(part));
    if (assignments.some(part => !part)) return this.reject(sql);
    const fields = assignments.map(part => part![1]);
    expect(fields.sort()).toEqual(table === "bookings" ? ["manualAmountOverrides", "updatedAt"] : ["jobTotalCents", "updatedAt"]);
    const term = /`([^`]+)`\.`([^`]+)` = \?/g;
    const terms = [...where.matchAll(term)];
    if (where.replace(term, "").replace(/[()\s]/g, "").replace(/and/g, "")) return this.reject(sql);
    let offset = assignments.length;
    const predicates = terms.map(match => { const value = params[offset++]; if (match[1] !== table) return this.reject(sql); return (row: Row) => row[match[2]] === value; });
    if (offset !== params.length) return this.reject(sql);
    if (table === "leadflow_jobs") {
      expect(terms.map(match => match[2])).toEqual(["id", "bookingId", "jobTotalCents"]);
      if (this.changeAmountBeforeWrite) this.state.leadflow_jobs.find(row => row.id === params[assignments.length])!.jobTotalCents++;
    }
    const rows = this.state[table as TableName].filter(row => predicates.every(predicate => predicate(row)));
    if (this.failWrite === table) throw new Error("Synthetic write failure");
    if (this.failWriteCount === table) return { rows: [{ affectedRows: 0 }] };
    for (const row of rows) assignments.forEach((part, index) => { row[part![1]] = part![1] === "manualAmountOverrides" ? JSON.parse(String(params[index])) : params[index]; });
    this.events.push(`write:${table}`);
    return { rows: [{ affectedRows: rows.length }] };
  }
  async run(input: UpdateNativeBookingManualAmountInput = command(), actor = staff) {
    const before = structuredClone(this.state);
    this.locked = false;
    const tx = Object.assign(Object.create(this.client), {
      execute: async (query: any) => {
        const compiled = dialect.sqlToQuery(query);
        this.queries.push(compiled);
        expect(this.locked).toBe(true);
        return this.reject(compiled.sql);
      },
    });
    try { const result = await updateNativeBookingManualAmount(tx as NativeBookingManualAmountTx, input, actor); this.events.push("commit"); return result; }
    catch (error) { this.state = before; this.events.push("rollback"); throw error; }
  }
}
const staff = { id: "3", name: "Synthetic staff" };
const requestId = "afbe0054-a50d-4cdd-97b5-90579e34e101";
const command = (overrides: Partial<UpdateNativeBookingManualAmountInput> = {}): UpdateNativeBookingManualAmountInput => ({ bookingId: 7, expectedDate: "2026-11-20", expectedAmountCents: 12000, expectedRevision: 0, amountCents: 15500, scope: "visit", requestId, ...overrides });
const booking = (overrides: Row = {}): Row => ({ id: 7, requestedLocalDate: "2026-11-20", requestedTimeZone: "America/New_York", requestedLocalTime: "09:00", requestedStartAt: 123, recurrence: "weekly", recurringIntentStatus: "intent_pending", firstCleaningTotalCents: 12000, futureVisitTotalCents: 10000, manualAmountOverrides: null, priceSnapshot: { version: "immutable", marker: "keep" }, commandHash: "immutable", status: "needs_attention", paymentMethod: "card", paymentStatus: "card_on_file", customerPhone: "+12025550101", companyNotes: "Keep notes", extras: [{ id: "keep" }], ...overrides });
const job = (id: number, date: string, amount = 10000, overrides: Row = {}): Row => ({ id, bookingId: 7, jobDate: date, bookingStatus: "assigned", jobTotalCents: amount, origin: "native_booking", teamId: 13, teamName: "Keep team", nextOccurrenceCreatedAt: "unchanged", customerNotes: "Keep job notes", extras: "keep", missingFromLaunch27At: null, ...overrides });
let f: Fixture;
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-19T17:00:00Z"));
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Offline test; network forbidden"); }));
  f = new Fixture();
  f.state.bookings = [booking(), booking({ id: 8 })];
  f.state.leadflow_jobs = [job(50, "2026-11-27"), job(10, "2026-11-20", 12000), job(60, "2026-12-04"), job(99, "2026-11-20", 8000, { bookingId: 8 })];
  f.state.booking_payment_profiles = [{ id: 19, bookingId: 7, paymentStatus: "card_on_file", version: 2, stripeCustomerId: "cus_offline", stripePaymentMethodId: "pm_offline" }];
  f.state.booking_series = [{ id: 1, bookingId: 7, frequency: "weekly", status: "intent_pending", futureVisitTotalCents: 10000 }];
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
const amounts = () => f.state.leadflow_jobs.map(row => [row.id, row.jobTotalCents]);
const untouchedRecords = () => structuredClone({
  series: f.state.booking_series, profiles: f.state.booking_payment_profiles,
  authorizations: f.state.payment_authorizations, capabilities: f.state.card_auth_tokens,
  progress: f.state.cleaner_portal_job_progress, signoffs: f.state.cleaner_portal_job_signoffs,
  claims: f.claims, manual: f.manual,
});
const expectOnlyNativeReads = () => {
  const reads = f.queries.filter(query => /^select /i.test(query.sql));
  expect(reads.length).toBeGreaterThan(0);
  for (const { sql } of reads) expect(sql).toMatch(/ from `(?:bookings|leadflow_jobs)` /);
  expect(f.queries.every(query => /^(?:select |update `(?:bookings|leadflow_jobs)` )/i.test(query.sql))).toBe(true);
};
describe("native manual amount transactions", () => {
  it("saves the native booking amount while preserving its original first-cleaning financial source and every other account", async () => {
    const before = structuredClone(f.state);
    const result = await f.run();
    expect(result).toMatchObject({ selectedChanged: true, changedJobCount: 0, manualAmountRevision: 1, futureRuleChanged: false });
    expect(amounts()).toEqual([[50, 10000], [10, 12000], [60, 10000], [99, 8000]]);
    expect(f.state.bookings[0]).toMatchObject({ firstCleaningTotalCents: 12000, futureVisitTotalCents: 10000, priceSnapshot: before.bookings[0].priceSnapshot, commandHash: "immutable" });
    expect(f.state.bookings[1]).toEqual(before.bookings[1]);
    for (const key of ["booking_series", "booking_payment_profiles", "payment_authorizations", "card_auth_tokens"] as const) expect(f.state[key]).toEqual(before[key]);
    const changedJob = f.state.leadflow_jobs.find(row => row.id === 10)!;
    for (const key of ["teamId", "teamName", "nextOccurrenceCreatedAt", "customerNotes", "extras", "jobDate"]) expect(changedJob[key]).toEqual(before.leadflow_jobs.find(row => row.id === 10)![key]);
    expect(selectNativeDisplayAmounts(f.state.bookings[0] as any)).toEqual({ firstCleaningTotalCents: 15500, futureVisitTotalCents: 10000, manualAmountRevision: 1 });
    expect(f.state.leadflow_jobs.find(row => row.id === 10)!.jobTotalCents).toBe(f.state.bookings[0].firstCleaningTotalCents);
    expect(f.queries.filter(query => /^update /.test(query.sql))).toHaveLength(1);
    expect(f.queries[0]).toMatchObject({ params: [7, 1] });
    expect(f.queries[0].sql).toContain("from `bookings`");
    expect(f.queries[1].sql).toContain("order by `leadflow_jobs`.`id` for update");
    expect(f.queries.filter(query => /^select /i.test(query.sql))).toHaveLength(2);
    expectOnlyNativeReads();
  });
  it("keeps an untouched first amount across a future-rule boundary (modeled persisted schedule-only reschedule; actual save/display/hold selectors)", async () => {
    f.state.bookings[0].requestedLocalDate = "2030-01-02";
    f.state.leadflow_jobs = [job(10, "2030-01-02", 12000), job(50, "2030-01-09", 10000)];
    const noOverrideBooking = structuredClone(f.state.bookings[0]);
    const noOverrideFirstJob = structuredClone(f.state.leadflow_jobs[0]);
    const result = await f.run(command({ expectedDate: "2030-01-09", expectedAmountCents: 10000, scope: "subsequent", amountCents: 15500 }));
    const saved = f.state.bookings[0] as any;
    expect(result).toMatchObject({ selectedJobId: 50, selectedChanged: true, selectedAmountCents: 15500, changedJobCount: 1, futureRuleChanged: true });
    expect(saved.manualAmountOverrides.visits).toEqual([]);
    expect(saved.manualAmountOverrides.seriesRules).toEqual([{ fromDate: "2030-01-09", amountCents: 15500 }]);
    expect(selectNativeDisplayAmounts(saved)).toEqual({ firstCleaningTotalCents: 12000, futureVisitTotalCents: 15500, manualAmountRevision: 1 });
    expect(effectiveNativeVisitAmount(saved, saved.requestedLocalDate, { firstVisit: true })).toBe(12000);
    for (const [date, futureAmount] of [["2030-01-08", 10000], ["2030-01-09", 15500], ["2030-01-10", 15500]] as const) {
      expect(selectNativeDisplayAmounts({ ...saved, requestedLocalDate: date }).firstCleaningTotalCents).toBe(12000);
      expect(effectiveNativeVisitAmount(saved, date, { firstVisit: true })).toBe(12000);
      expect(effectiveNativeVisitAmount(saved, date, { jobId: 10, firstVisit: true })).toBe(12000);
      expect(effectiveNativeVisitAmount(saved, date, { firstVisit: false })).toBe(futureAmount);
      expect(effectiveNativeFutureAmount(saved, date)).toBe(futureAmount);
    }
    const beforeMoveBooking = structuredClone(saved), beforeMoveFirstJob = structuredClone(f.state.leadflow_jobs[0]);
    // Model canonical persisted schedule-only state, not live MySQL/router execution.
    // The actual amount update/save above and imported selectors below execute.
    saved.requestedLocalDate = "2030-01-10";
    f.state.leadflow_jobs[0].jobDate = "2030-01-10";
    expect(saved).toEqual({ ...beforeMoveBooking, requestedLocalDate: "2030-01-10" });
    expect(f.state.leadflow_jobs[0]).toEqual({ ...beforeMoveFirstJob, jobDate: "2030-01-10" });
    expect([saved.firstCleaningTotalCents, f.state.leadflow_jobs[0].jobTotalCents]).toEqual([12000, 12000]);
    expect(selectNativeDisplayAmounts(saved)).toEqual({ firstCleaningTotalCents: 12000, futureVisitTotalCents: 15500, manualAmountRevision: 1 });
    expect(effectiveNativeVisitAmount(saved, saved.requestedLocalDate, { firstVisit: true })).toBe(12000);
    expect(effectiveNativeVisitAmount(saved, f.state.leadflow_jobs[0].jobDate, { jobId: 10, firstVisit: true })).toBe(12000);
    expect(effectiveNativeVisitAmount(saved, "2030-01-16", { firstVisit: false })).toBe(15500);
    const control = { ...noOverrideBooking, requestedLocalDate: "2030-01-10" } as any;
    const controlFirstJob = { ...noOverrideFirstJob, jobDate: "2030-01-10" };
    expect(selectNativeDisplayAmounts(control)).toEqual({ firstCleaningTotalCents: 12000, futureVisitTotalCents: 10000, manualAmountRevision: 0 });
    expect(effectiveNativeVisitAmount(control, control.requestedLocalDate, { firstVisit: true })).toBe(12000);
    expect([control.firstCleaningTotalCents, controlFirstJob.jobTotalCents]).toEqual([12000, 12000]);
  });
  it("retains an explicit first-visit 13900 override after future-only 15500 and the same modeled persisted first-date move", async () => {
    f.state.bookings[0].requestedLocalDate = "2030-01-02";
    f.state.leadflow_jobs = [job(10, "2030-01-02", 12000), job(50, "2030-01-09", 10000)];
    await f.run(command({ expectedDate: "2030-01-02", amountCents: 13900 }));
    const explicitFirst = structuredClone(f.state.bookings[0].manualAmountOverrides.visits);
    expect(explicitFirst).toEqual([{ jobId: 10, date: "2030-01-02", firstVisit: true, amountCents: 13900, protected: false }]);
    expect(selectNativeDisplayAmounts(f.state.bookings[0] as any).firstCleaningTotalCents).toBe(13900);
    await f.run(command({ expectedDate: "2030-01-09", expectedAmountCents: 10000, expectedRevision: 1, scope: "subsequent", amountCents: 15500, requestId: "afbe0054-a50d-4cdd-97b5-90579e34e102" }));
    const saved = f.state.bookings[0] as any;
    expect(saved.manualAmountOverrides.visits).toEqual(explicitFirst);
    expect(saved.manualAmountOverrides.seriesRules).toEqual([{ fromDate: "2030-01-09", amountCents: 15500 }]);
    expect(selectNativeDisplayAmounts(saved)).toEqual({ firstCleaningTotalCents: 13900, futureVisitTotalCents: 15500, manualAmountRevision: 2 });
    expect(effectiveNativeVisitAmount(saved, saved.requestedLocalDate, { firstVisit: true })).toBe(13900);
    // Only persisted canonical booking/job dates are modeled; save and selectors are real.
    const beforeMoveBooking = structuredClone(saved), beforeMoveFirstJob = structuredClone(f.state.leadflow_jobs[0]);
    saved.requestedLocalDate = "2030-01-10";
    f.state.leadflow_jobs[0].jobDate = "2030-01-10";
    expect(saved).toEqual({ ...beforeMoveBooking, requestedLocalDate: "2030-01-10" });
    expect(f.state.leadflow_jobs[0]).toEqual({ ...beforeMoveFirstJob, jobDate: "2030-01-10" });
    expect([saved.firstCleaningTotalCents, f.state.leadflow_jobs[0].jobTotalCents]).toEqual([12000, 12000]);
    expect(selectNativeDisplayAmounts(saved)).toEqual({ firstCleaningTotalCents: 13900, futureVisitTotalCents: 15500, manualAmountRevision: 2 });
    expect(effectiveNativeVisitAmount(saved, saved.requestedLocalDate, { firstVisit: true })).toBe(13900);
    for (const [date, futureAmount] of [["2030-01-08", 10000], ["2030-01-09", 15500], ["2030-01-10", 15500]] as const) {
      expect(selectNativeDisplayAmounts({ ...saved, requestedLocalDate: date }).firstCleaningTotalCents).toBe(13900);
      expect(effectiveNativeVisitAmount(saved, date, { firstVisit: true })).toBe(13900);
      expect(effectiveNativeVisitAmount(saved, date, { jobId: 10, firstVisit: true })).toBe(13900);
      expect(effectiveNativeVisitAmount(saved, date, { firstVisit: false })).toBe(futureAmount);
      expect(effectiveNativeFutureAmount(saved, date)).toBe(futureAmount);
    }
  });
  it("intentionally saves first-start subsequent 13900 as an explicit first plus future rule, retaining it after a modeled move and later future-only 15500", async () => {
    f.state.bookings[0].requestedLocalDate = "2030-01-02";
    f.state.leadflow_jobs = [job(10, "2030-01-02", 12000), job(50, "2030-01-09", 10000), job(60, "2030-01-16", 10000)];
    const result = await f.run(command({ expectedDate: "2030-01-02", scope: "subsequent", amountCents: 13900 }));
    const saved = f.state.bookings[0] as any;
    expect(result).toMatchObject({ selectedJobId: 10, selectedChanged: true, selectedAmountCents: 13900, changedJobCount: 2, futureRuleChanged: true });
    const explicitFirst = [{ jobId: 10, date: "2030-01-02", firstVisit: true, amountCents: 13900, protected: false }];
    expect(saved.manualAmountOverrides.visits).toEqual(explicitFirst);
    expect(saved.manualAmountOverrides.seriesRules).toEqual([{ fromDate: "2030-01-02", amountCents: 13900 }]);
    expect(selectNativeDisplayAmounts(saved)).toEqual({ firstCleaningTotalCents: 13900, futureVisitTotalCents: 13900, manualAmountRevision: 1 });
    // Modeled persisted schedule-only reschedule, not full live MySQL/router execution.
    const beforeMoveBooking = structuredClone(saved), beforeMoveFirstJob = structuredClone(f.state.leadflow_jobs[0]);
    saved.requestedLocalDate = "2030-01-10";
    f.state.leadflow_jobs[0].jobDate = "2030-01-10";
    expect(saved).toEqual({ ...beforeMoveBooking, requestedLocalDate: "2030-01-10" });
    expect(f.state.leadflow_jobs[0]).toEqual({ ...beforeMoveFirstJob, jobDate: "2030-01-10" });
    expect(selectNativeDisplayAmounts(saved)).toEqual({ firstCleaningTotalCents: 13900, futureVisitTotalCents: 13900, manualAmountRevision: 1 });
    expect(effectiveNativeVisitAmount(saved, saved.requestedLocalDate, { firstVisit: true })).toBe(13900);
    expect(effectiveNativeVisitAmount(saved, "2030-01-17", { firstVisit: false })).toBe(13900);
    const laterResult = await f.run(command({ expectedDate: "2030-01-16", expectedAmountCents: 13900, expectedRevision: 1, scope: "subsequent", amountCents: 15500, requestId: "afbe0054-a50d-4cdd-97b5-90579e34e102" }));
    const laterSaved = f.state.bookings[0] as any;
    expect(laterResult).toMatchObject({ selectedJobId: 60, selectedChanged: true, changedJobCount: 1, futureRuleChanged: true });
    expect(laterSaved.manualAmountOverrides.visits).toEqual(explicitFirst);
    expect(laterSaved.manualAmountOverrides.seriesRules).toEqual([{ fromDate: "2030-01-02", amountCents: 13900 }, { fromDate: "2030-01-16", amountCents: 15500 }]);
    expect(amounts()).toEqual([[10, 12000], [50, 13900], [60, 15500]]);
    expect(laterSaved.firstCleaningTotalCents).toBe(12000);
    expect(selectNativeDisplayAmounts(laterSaved)).toEqual({ firstCleaningTotalCents: 13900, futureVisitTotalCents: 15500, manualAmountRevision: 2 });
    expect(effectiveNativeVisitAmount(laterSaved, laterSaved.requestedLocalDate, { firstVisit: true })).toBe(13900);
    for (const [date, futureAmount] of [["2030-01-15", 13900], ["2030-01-16", 15500], ["2030-01-17", 15500]] as const) {
      expect(selectNativeDisplayAmounts({ ...laterSaved, requestedLocalDate: date }).firstCleaningTotalCents).toBe(13900);
      expect(effectiveNativeVisitAmount(laterSaved, date, { firstVisit: true })).toBe(13900);
      expect(effectiveNativeVisitAmount(laterSaved, date, { jobId: 10, firstVisit: true })).toBe(13900);
      expect(effectiveNativeVisitAmount(laterSaved, date, { firstVisit: false })).toBe(futureAmount);
      expect(effectiveNativeFutureAmount(laterSaved, date)).toBe(futureAmount);
    }
  });
  it("allows post-booking idle unpaid card without inventing a new payment flow", async () => {
    f.state.bookings[0].paymentStatus = "not_started";
    f.state.booking_payment_profiles[0] = { id: 19, bookingId: 7, paymentStatus: "not_started", version: 1 };
    expect((await f.run()).selectedChanged).toBe(true);
    expect(f.state.booking_payment_profiles[0]).toEqual({ id: 19, bookingId: 7, paymentStatus: "not_started", version: 1 });
  });
  it("edits one future visit only, leaving first price and future baseline unchanged", async () => {
    const result = await f.run(command({ expectedDate: "2026-11-27", expectedAmountCents: 10000 }));
    expect(result).toMatchObject({ selectedJobId: 50, changedJobCount: 1, futureRuleChanged: false });
    expect(amounts()).toEqual([[50, 15500], [10, 12000], [60, 10000], [99, 8000]]);
    expect(effectiveNativeFutureAmount(f.state.bookings[0] as any)).toBe(10000);
  });
  it("saves current/future booking amounts without changing the original first-cleaning financial source or cadence", async () => {
    await f.run(command({ scope: "subsequent" }));
    expect(amounts()).toEqual([[50, 15500], [10, 12000], [60, 15500], [99, 8000]]);
    expect(f.state.bookings[0].manualAmountOverrides.seriesRules).toEqual([{ fromDate: "2026-11-20", amountCents: 15500 }]);
    expect(f.state.booking_series[0].futureVisitTotalCents).toBe(10000);
  });
  it.each(["paid", "captured", "authorized", "pending", "authorization_pending", "setup_pending"])("edits %s first amount to 13900 then 14900 without reading or altering payment records", async status => {
    f.state.bookings[0].paymentStatus = status; f.state.booking_payment_profiles[0].paymentStatus = status;
    Object.assign(f.state.booking_payment_profiles[0], { stripePaymentIntentId: "pi_keep", authorizedAt: 123, capturedAt: 456 });
    f.state.payment_authorizations = [{ id: 70, bookingPaymentProfileId: 19, status, amountCents: 12000, stripePaymentIntentId: "pi_keep", authorizedAt: 123, capturedAt: 456 }];
    const before = structuredClone(f.state), records = untouchedRecords();
    expect(await f.run(command({ amountCents: 13900 }))).toMatchObject({ selectedChanged: true, selectedAmountCents: 13900, changedJobCount: 0, protectedVisitCount: 0, protectedVisits: [] });
    expect(selectNativeDisplayAmounts(f.state.bookings[0] as any).firstCleaningTotalCents).toBe(13900);
    expect(await f.run(command({ amountCents: 14900, expectedAmountCents: 13900, expectedRevision: 1, requestId: "afbe0054-a50d-4cdd-97b5-90579e34e102" }))).toMatchObject({ selectedChanged: true, selectedAmountCents: 14900, changedJobCount: 0, manualAmountRevision: 2, protectedVisitCount: 0, protectedVisits: [] });
    expect(selectNativeDisplayAmounts(f.state.bookings[0] as any)).toEqual({ firstCleaningTotalCents: 14900, futureVisitTotalCents: 10000, manualAmountRevision: 2 });
    expect(f.state.bookings[0]).toEqual({ ...before.bookings[0], manualAmountOverrides: f.state.bookings[0].manualAmountOverrides, updatedAt: bookings.updatedAt.mapToDriverValue(new Date()) });
    expect(f.state.leadflow_jobs).toEqual(before.leadflow_jobs);
    expect(untouchedRecords()).toEqual(records);
    expectOnlyNativeReads();
  });
  it("edits pending creation and in-flight durable payment without changing the existing attempt", async () => {
    f.state.bookings[0].status = "pending_payment";
    f.state.payment_authorizations = [{ id: 70, bookingPaymentProfileId: 19, status: "pending_card", amountCents: 12000 }];
    const records = untouchedRecords();
    expect(await f.run(command({ scope: "subsequent" }))).toMatchObject({ selectedChanged: true, selectedAmountCents: 15500, changedJobCount: 2, protectedVisitCount: 0, protectedVisits: [] });
    expect(await f.run(command({ expectedAmountCents: 15500, expectedRevision: 1, amountCents: 14900, requestId: "afbe0054-a50d-4cdd-97b5-90579e34e102" }))).toMatchObject({ selectedChanged: true, selectedAmountCents: 14900 });
    expect(f.state.bookings[0].status).toBe("pending_payment");
    expect(untouchedRecords()).toEqual(records);
    expectOnlyNativeReads();
  });
  it("retains an active hold unchanged while editing its booking amount", async () => {
    f.state.bookings[0].paymentStatus = "authorized";
    Object.assign(f.state.booking_payment_profiles[0], { paymentStatus: "authorized", stripePaymentIntentId: "pi_active", authorizedAt: 123 });
    f.state.payment_authorizations = [{ id: 70, bookingPaymentProfileId: 19, status: "authorized", amountCents: 12000, stripePaymentIntentId: "pi_active", authorizedAt: 123, capturedAt: null, expiresAt: Date.now() + 50000 }];
    const records = untouchedRecords();
    await f.run(command({ amountCents: 13900 }));
    await f.run(command({ amountCents: 14900, expectedAmountCents: 13900, expectedRevision: 1, requestId: "afbe0054-a50d-4cdd-97b5-90579e34e102" }));
    expect(selectNativeDisplayAmounts(f.state.bookings[0] as any).firstCleaningTotalCents).toBe(14900);
    expect(untouchedRecords()).toEqual(records);
    expect(f.state.payment_authorizations[0]).toMatchObject({ status: "authorized", amountCents: 12000, capturedAt: null, stripePaymentIntentId: "pi_active" });
    expectOnlyNativeReads();
  });
  it("edits through active and used booking-scoped card handoffs without reading or changing capabilities", async () => {
    const bytes = Buffer.alloc(32); [7, 19, 2, 20261120].forEach((value, index) => bytes.writeUInt32BE(value, index * 4));
    f.state.card_auth_tokens = [0, 1].map(used => ({ id: used + 1, customerPhone: "+12025550101", token: "hc1_" + bytes.toString("base64url"), used, expiresAt: Date.now() + 50000 }));
    const records = untouchedRecords();
    expect((await f.run(command({ amountCents: 13900 }))).selectedChanged).toBe(true);
    expect((await f.run(command({ expectedRevision: 1, expectedAmountCents: 13900, scope: "subsequent", requestId: "afbe0054-a50d-4cdd-97b5-90579e34e102" }))).selectedChanged).toBe(true);
    expect(untouchedRecords()).toEqual(records);
    expectOnlyNativeReads();
  });
  it.each(["booking:7:first:2026-11-20", "booking:7:first:2026-11-18", "job:10"])("edits with retained invoice and manual claims %s without reading or altering them", async key => {
    f.claims = [{ occurrenceKey: key, invoiceId: 9, status: "void" }];
    f.manual = [{ occurrenceKey: key, amountCents: 12000 }];
    const records = untouchedRecords();
    expect((await f.run(command({ amountCents: 13900 }))).selectedChanged).toBe(true);
    expect(await f.run(command({ expectedAmountCents: 13900, expectedRevision: 1, amountCents: 14900, scope: "subsequent", requestId: "afbe0054-a50d-4cdd-97b5-90579e34e102" }))).toMatchObject({ selectedChanged: true, changedJobCount: 2, protectedVisitCount: 0, protectedVisits: [] });
    expect(untouchedRecords()).toEqual(records);
    expectOnlyNativeReads();
  });
  it("edits completed/signoff and issued future amounts while preserving progress, signoffs, invoices and manual payments", async () => {
    f.state.cleaner_portal_job_progress = [{ id: 2, leadflowJobId: 50, jobStatus: "completed" }];
    f.state.cleaner_portal_job_signoffs = [{ id: 3, leadflowJobId: 50, signedOffAt: "2026-11-27" }];
    f.claims = [{ occurrenceKey: "job:60", invoiceId: 10 }];
    f.manual = [{ occurrenceKey: "job:50", amountCents: 10000 }];
    const records = untouchedRecords();
    expect((await f.run(command({ expectedDate: "2026-11-27", expectedAmountCents: 10000, amountCents: 13900 }))).selectedChanged).toBe(true);
    const result = await f.run(command({ expectedRevision: 1, scope: "subsequent", requestId: "afbe0054-a50d-4cdd-97b5-90579e34e102" }));
    expect(result).toMatchObject({ selectedChanged: true, changedJobCount: 2, protectedVisitCount: 0, protectedVisits: [] });
    expect(amounts()).toEqual([[50, 15500], [10, 12000], [60, 15500], [99, 8000]]);
    const b = f.state.bookings[0] as any;
    expect(effectiveNativeVisitAmount(b, "2026-11-27", { jobId: 50, firstVisit: false })).toBe(15500);
    expect(effectiveNativeVisitAmount(b, "2027-02-01", { jobId: 60, firstVisit: false })).toBe(15500);
    expect(effectiveNativeFutureAmount(b, "2027-02-01")).toBe(15500);
    expect(untouchedRecords()).toEqual(records);
    expectOnlyNativeReads();
  });
  it.each(["pending", "pending_creation", "pending_payment", "completed", "paused", "cancelled", "missing", "inactive"])("edits a past %s booking and selected visit without changing their status", async status => {
    f.state.bookings[0].requestedLocalDate = "2026-11-17";
    f.state.bookings[0].status = status;
    Object.assign(f.state.leadflow_jobs.find(row => row.id === 10)!, { jobDate: "2026-11-17", bookingStatus: status, missingFromLaunch27At: "2026-11-18" });
    Object.assign(f.state.leadflow_jobs.find(row => row.id === 50)!, { jobDate: "2026-11-18", bookingStatus: status, missingFromLaunch27At: "2026-11-18" });
    const before = structuredClone(f.state);
    expect(await f.run(command({ expectedDate: "2026-11-17", amountCents: 13900 }))).toMatchObject({ selectedChanged: true, selectedAmountCents: 13900, protectedVisitCount: 0, protectedVisits: [] });
    expect(f.state.bookings[0].status).toBe(status);
    expect(f.state.leadflow_jobs).toEqual(before.leadflow_jobs);
    expect(selectNativeDisplayAmounts(f.state.bookings[0] as any).firstCleaningTotalCents).toBe(13900);
    expect(await f.run(command({ expectedDate: "2026-11-18", expectedAmountCents: 10000, amountCents: 14900, expectedRevision: 1, requestId: "afbe0054-a50d-4cdd-97b5-90579e34e102" }))).toMatchObject({ selectedJobId: 50, selectedChanged: true, selectedAmountCents: 14900, changedJobCount: 1, protectedVisitCount: 0, protectedVisits: [] });
    expect(f.state.leadflow_jobs).toEqual(before.leadflow_jobs.map(row => row.id === 50 ? { ...row, jobTotalCents: 14900, updatedAt: leadflowJobs.updatedAt.mapToDriverValue(new Date()) } : row));
    expect(f.state.bookings[0].status).toBe(status);
    expectOnlyNativeReads();
  });
  it("includes all selected past/cancelled/missing/completed/paused visits and has no arbitrary future date cap", async () => {
    f.state.bookings[0].requestedLocalDate = "2026-11-17";
    f.state.leadflow_jobs.find(row => row.id === 10)!.jobDate = "2026-11-17";
    f.state.leadflow_jobs.find(row => row.id === 50)!.bookingStatus = "cancelled";
    f.state.leadflow_jobs.find(row => row.id === 60)!.missingFromLaunch27At = "2026-11-19";
    f.state.leadflow_jobs.push(job(20, "2026-11-18", 10000, { bookingStatus: "completed" }), job(30, "2026-11-21", 10000, { bookingStatus: "paused" }), job(200, "2037-01-20"));
    const before = structuredClone(f.state.leadflow_jobs);
    const result = await f.run(command({ expectedDate: "2026-11-17", scope: "subsequent" }));
    expect(result).toMatchObject({ selectedChanged: true, selectedAmountCents: 15500, changedVisitCount: 6, changedJobCount: 5, protectedVisitCount: 0, protectedVisits: [], futureRuleChanged: true });
    for (const row of f.state.leadflow_jobs) {
      const original = before.find(prior => prior.id === row.id)!;
      expect(row).toEqual(row.bookingId === 7 && row.id !== 10 ? { ...original, jobTotalCents: 15500, updatedAt: leadflowJobs.updatedAt.mapToDriverValue(new Date()) } : original);
    }
    expect(f.state.leadflow_jobs.find(row => row.id === 200)!.jobTotalCents).toBe(15500);
    expect(f.state.bookings[0].manualAmountOverrides.seriesRules).toEqual([{ fromDate: "2026-11-17", amountCents: 15500 }]);
    expect(effectiveNativeFutureAmount(f.state.bookings[0] as any, "2026-11-16")).toBe(10000);
    expect(effectiveNativeFutureAmount(f.state.bookings[0] as any, "2026-11-18")).toBe(15500);
  });
  it.each(["weekly", "biweekly", "monthly"])("writes %s future rules without reading or gating on inactive series or intent", async recurrence => {
    f.state.bookings[0].recurrence = recurrence;
    f.state.bookings[0].recurringIntentStatus = "cancelled";
    Object.assign(f.state.booking_series[0], { status: "paused", frequency: "one-time" });
    const records = untouchedRecords();
    expect(await f.run(command({ scope: "subsequent" }))).toMatchObject({ selectedChanged: true, futureRuleChanged: true, changedJobCount: 2, protectedVisitCount: 0, protectedVisits: [] });
    expect(f.state.bookings[0].manualAmountOverrides.seriesRules).toEqual([{ fromDate: "2026-11-20", amountCents: 15500 }]);
    expect(untouchedRecords()).toEqual(records);
    expectOnlyNativeReads();
  });
  it("writes future rules without a series row or pending recurring intent", async () => {
    f.state.booking_series = [];
    f.state.bookings[0].recurringIntentStatus = "cancelled";
    expect(await f.run(command({ scope: "subsequent" }))).toMatchObject({ selectedChanged: true, futureRuleChanged: true });
    expect(f.state.bookings[0].manualAmountOverrides.seriesRules).toEqual([{ fromDate: "2026-11-20", amountCents: 15500 }]);
    expectOnlyNativeReads();
  });
  it("edits an old frozen first and non-first exception rather than retaining a business edit blocker", async () => {
    f.state.bookings[0].manualAmountOverrides = { version: 1, revision: 0, history: [], seriesRules: [], visits: [
      { jobId: 10, date: "2026-11-20", firstVisit: true, amountCents: 13900, protected: true },
      { jobId: 50, date: "2026-11-27", firstVisit: false, amountCents: 10000, protected: true },
    ] };
    expect(await f.run(command({ expectedAmountCents: 13900, amountCents: 14900 }))).toMatchObject({ selectedChanged: true, selectedAmountCents: 14900, protectedVisitCount: 0, protectedVisits: [] });
    expect(await f.run(command({ expectedDate: "2026-11-27", expectedAmountCents: 10000, expectedRevision: 1, requestId: "afbe0054-a50d-4cdd-97b5-90579e34e102" }))).toMatchObject({ selectedChanged: true, changedJobCount: 1, protectedVisitCount: 0, protectedVisits: [] });
    expect(f.state.bookings[0].manualAmountOverrides.visits).toEqual([
      { jobId: 10, date: "2026-11-20", firstVisit: true, amountCents: 14900, protected: false },
      { jobId: 50, date: "2026-11-27", firstVisit: false, amountCents: 15500, protected: false },
    ]);
    expect(f.state.leadflow_jobs.find(row => row.id === 10)!.jobTotalCents).toBe(12000);
  });
  it("replaces selected-range frozen and editable exceptions while retaining prior-range exceptions and boundaries", async () => {
    const priorFirst = { jobId: 10, date: "2026-11-20", firstVisit: true, amountCents: 12000, protected: true };
    const priorVisit = { jobId: null, date: "2026-11-22", firstVisit: false, amountCents: 9000, protected: true };
    const priorEditable = { jobId: null, date: "2026-11-23", firstVisit: false, amountCents: 9500, protected: false };
    f.state.bookings[0].manualAmountOverrides = { version: 1, revision: 0, history: [], visits: [priorFirst, priorVisit, priorEditable,
      { jobId: 50, date: "2026-11-27", firstVisit: false, amountCents: 10000, protected: true },
      { jobId: 60, date: "2026-12-04", firstVisit: false, amountCents: 10000, protected: false },
      { jobId: null, date: "2027-01-01", firstVisit: false, amountCents: 20000, protected: true },
    ], seriesRules: [{ fromDate: "2026-11-21", amountCents: 11000 }] };
    expect(await f.run(command({ expectedDate: "2026-11-27", expectedAmountCents: 10000, scope: "subsequent" }))).toMatchObject({ selectedChanged: true, changedJobCount: 2, protectedVisitCount: 0, protectedVisits: [] });
    const saved = f.state.bookings[0] as any;
    expect(saved.manualAmountOverrides.visits).toEqual([priorFirst, priorVisit, priorEditable]);
    expect(saved.manualAmountOverrides.seriesRules).toEqual([{ fromDate: "2026-11-21", amountCents: 11000 }, { fromDate: "2026-11-27", amountCents: 15500 }]);
    expect(effectiveNativeVisitAmount(saved, "2026-11-22", { firstVisit: false })).toBe(9000);
    expect(effectiveNativeVisitAmount(saved, "2026-11-23", { firstVisit: false })).toBe(9500);
    expect(effectiveNativeVisitAmount(saved, "2026-12-04", { jobId: 60, firstVisit: false })).toBe(15500);
    expect(effectiveNativeVisitAmount(saved, "2027-01-01", { firstVisit: false })).toBe(15500);
    expect(f.state.leadflow_jobs.find(row => row.id === 10)!.jobTotalCents).toBe(12000);
  });
  it.each([true, false])("replaces the selected job's same-date fallback, including protected = %s, while retaining another date", async protectedAlias => {
    const prior = { jobId: null, date: "2026-11-22", firstVisit: false, amountCents: 9000, protected: true };
    f.state.bookings[0].manualAmountOverrides = { version: 1, revision: 0, history: [], seriesRules: [], visits: [prior,
      { jobId: null, date: "2026-11-27", firstVisit: false, amountCents: 13900, protected: protectedAlias },
    ] };
    f.state.leadflow_jobs.find(row => row.id === 50)!.jobTotalCents = 13900;
    expect(await f.run(command({ expectedDate: "2026-11-27", expectedAmountCents: 13900, amountCents: 14900 }))).toMatchObject({ selectedChanged: true, selectedAmountCents: 14900, protectedVisitCount: 0 });
    const saved = f.state.bookings[0] as any;
    expect(saved.manualAmountOverrides.visits).toEqual([prior,
      { jobId: 50, date: "2026-11-27", firstVisit: false, amountCents: 14900, protected: false },
    ]);
    expect(effectiveNativeVisitAmount(saved, "2026-11-27", { jobId: 50, firstVisit: false })).toBe(14900);
    expect(await f.run(command({ expectedDate: "2026-11-27", expectedAmountCents: 14900, amountCents: 15900, expectedRevision: 1, requestId: "afbe0054-a50d-4cdd-97b5-90579e34e102" }))).toMatchObject({ selectedChanged: true, selectedAmountCents: 15900 });
    expect(effectiveNativeVisitAmount(f.state.bookings[0] as any, "2026-11-27", { jobId: 50, firstVisit: false })).toBe(15900);
    expect(effectiveNativeVisitAmount(f.state.bookings[0] as any, "2026-11-22", { firstVisit: false })).toBe(9000);
    expectOnlyNativeReads();
  });
  it("saves a no-op truthfully even when obsolete historical series prices differ", async () => {
    await f.run(command({ scope: "subsequent", amountCents: 13000 }));
    await f.run(command({ expectedRevision: 1, expectedAmountCents: 13000, scope: "subsequent", requestId: "afbe0054-a50d-4cdd-97b5-90579e34e102" }));
    const result = await f.run(command({ expectedRevision: 2, expectedAmountCents: 15500, scope: "subsequent", requestId: "afbe0054-a50d-4cdd-97b5-90579e34e103" }));
    expect(result).toMatchObject({ selectedChanged: false, selectedAmountCents: 15500, changedVisitCount: 0, changedJobCount: 0, futureRuleChanged: false, manualAmountRevision: 3, protectedVisitCount: 0, protectedVisits: [] });
    expect(f.state.bookings[0].manualAmountOverrides.history).toHaveLength(3);
    expect(f.events.at(-1)).toBe("commit");
  });
  it("supports proven-unpaid invoice and zero linked jobs, but not partially missing selection", async () => {
    f.state.bookings[0].paymentMethod = "invoice"; f.state.bookings[0].paymentStatus = "not_started";
    f.state.booking_payment_profiles = []; f.state.leadflow_jobs = [];
    expect((await f.run()).changedJobCount).toBe(0);
    expect(selectNativeDisplayAmounts(f.state.bookings[0] as any).firstCleaningTotalCents).toBe(15500);
    f.state.leadflow_jobs = [job(50, "2026-11-27")];
    await expect(f.run(command({ expectedAmountCents: 15500, expectedRevision: 1, amountCents: 16000, requestId: "afbe0054-a50d-4cdd-97b5-90579e34e102" }))).rejects.toThrow("unambiguously");
  });
  it("rejects duplicate date selection, stale amounts/revisions, and UUID reuse; exact replay is write-free", async () => {
    f.state.leadflow_jobs.push(job(11, "2026-11-20", 12000));
    await expect(f.run()).rejects.toMatchObject({ code: "CONFLICT" }); f.state.leadflow_jobs.pop();
    await expect(f.run(command({ expectedRevision: 1 }))).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(f.run(command({ expectedAmountCents: 11000 }))).rejects.toMatchObject({ code: "CONFLICT" });
    const first = await f.run(); const before = structuredClone(f.state);
    const writes = f.queries.filter(query => /^update /.test(query.sql)).length;
    expect(await f.run()).toEqual({ ...first, replayed: true }); expect(f.state).toEqual(before);
    expect(f.queries.filter(query => /^update /.test(query.sql))).toHaveLength(writes);
    expect(await f.run(command({ requestId: requestId.toUpperCase() }))).toEqual({ ...first, replayed: true });
    await expect(f.run(command({ amountCents: 20000 }))).rejects.toThrow("UUID");
    await expect(f.run(command(), { id: "4", name: "Other staff" })).rejects.toThrow("UUID");
    await expect(f.run(command(), { id: staff.id, name: "Other staff" })).rejects.toThrow("UUID");
    await f.run(command({ expectedRevision: 1, expectedAmountCents: 15500, amountCents: 17000, requestId: "afbe0054-a50d-4cdd-97b5-90579e34e102" }));
    expect((await f.run()).manualAmountRevision).toBe(1);
    expect(f.state.bookings[0].manualAmountOverrides.history[1]).toMatchObject({ actor: staff, command: { expectedRevision: 1, expectedAmountCents: 15500 }, priorEffective: [{ amountCents: 15500 }], afterEffective: [{ amountCents: 17000 }] });
  });
  it("rejects a late revision or stale non-first amount without adding history or changing records", async () => {
    await f.run(command({ expectedDate: "2026-11-27", expectedAmountCents: 10000, amountCents: 13900 }));
    const before = structuredClone(f.state), writes = f.queries.filter(query => /^update /.test(query.sql)).length;
    await expect(f.run(command({ expectedDate: "2026-11-27", expectedAmountCents: 10000, requestId: "afbe0054-a50d-4cdd-97b5-90579e34e102" }))).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(f.run(command({ expectedDate: "2026-11-27", expectedAmountCents: 10000, expectedRevision: 1, requestId: "afbe0054-a50d-4cdd-97b5-90579e34e102" }))).rejects.toMatchObject({ code: "CONFLICT" });
    expect(f.state).toEqual(before);
    expect(f.queries.filter(query => /^update /.test(query.sql))).toHaveLength(writes);
  });
  it("rejects missing booking/date, missing first identity and duplicate future dates instead of choosing another local booking", async () => {
    const before = structuredClone(f.state);
    await expect(f.run(command({ bookingId: 70 }))).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(f.run(command({ expectedDate: "2026-11-21" }))).rejects.toMatchObject({ code: "CONFLICT" });
    f.state.leadflow_jobs = f.state.leadflow_jobs.filter(row => row.id !== 10);
    await expect(f.run(command({ expectedDate: "2026-11-27", expectedAmountCents: 10000 }))).rejects.toMatchObject({ code: "CONFLICT" });
    f.state = structuredClone(before);
    f.state.leadflow_jobs.push(job(61, "2026-12-04"));
    await expect(f.run(command({ scope: "subsequent" }))).rejects.toMatchObject({ code: "CONFLICT" });
    expect(f.queries.filter(query => /^update /.test(query.sql))).toHaveLength(0);
    f.state.leadflow_jobs = [];
    await expect(f.run(command({ expectedDate: "2026-11-21" }))).rejects.toMatchObject({ code: "CONFLICT" });
  });
  it("allows visit-only scope despite a duplicate unselected future date and never crosses booking IDs", async () => {
    f.state.leadflow_jobs.push(job(61, "2026-12-04"));
    const before = structuredClone(f.state);
    expect(await f.run()).toMatchObject({ selectedJobId: 10, selectedChanged: true, changedJobCount: 0 });
    expect(f.state.leadflow_jobs).toEqual(before.leadflow_jobs);
    expect(f.state.bookings[1]).toEqual(before.bookings[1]);
    expectOnlyNativeReads();
  });
  it("validates cents, dates, local booking ID, scope, revision, UUID and actor before acquiring any locks", async () => {
    for (const input of [
      command({ bookingId: 0 }), command({ bookingId: 1.5 }), command({ bookingId: Number.MAX_SAFE_INTEGER + 1 }),
      command({ scope: "all" as any }), command({ expectedRevision: -1 }), command({ expectedRevision: 0.5 }),
      command({ expectedDate: "2026-02-30" }), command({ requestId: "bad" }),
      command({ amountCents: -1 }), command({ amountCents: 1.5 }), command({ amountCents: 10_000_001 }),
      command({ expectedAmountCents: -1 }), command({ expectedAmountCents: 1.5 }),
      { ...command(), unexpected: true },
    ]) await expect(f.run(input)).rejects.toThrow();
    await expect(f.run(command(), { id: "", name: staff.name })).rejects.toThrow();
    await expect(f.run(command(), { id: staff.id, name: "" })).rejects.toThrow();
    expect(f.queries).toEqual([]);
  });
  it.each([-1, 1.5, 10_000_001])("rejects invalid current linked amount %s without writes", async amount => {
    f.state.leadflow_jobs.find(row => row.id === 50)!.jobTotalCents = amount;
    const before = structuredClone(f.state);
    await expect(f.run(command({ scope: "subsequent" }))).rejects.toMatchObject({ code: "CONFLICT" });
    expect(f.state).toEqual(before);
    expect(f.queries.filter(query => /^update /.test(query.sql))).toHaveLength(0);
  });
  it.each(["booking-write", "job-write", "booking-zero-count", "job-zero-count"])("rolls back all writes on strict %s failure", async failure => {
    const before = structuredClone(f.state);
    if (failure === "booking-write") f.failWrite = "bookings";
    if (failure === "job-write") f.failWrite = "leadflow_jobs";
    if (failure === "booking-zero-count") f.failWriteCount = "bookings";
    if (failure === "job-zero-count") f.failWriteCount = "leadflow_jobs";
    await expect(f.run(command({ scope: "subsequent" }))).rejects.toThrow();
    expect(f.state).toEqual(before); expect(f.events.at(-1)).toBe("rollback");
    if (failure.startsWith("booking-")) expect(f.events.filter(event => event === "write:leadflow_jobs")).toHaveLength(2);
  });
  it("keeps each non-first write expected-amount guarded and rolls back a late row amount mismatch", async () => {
    const before = structuredClone(f.state);
    f.changeAmountBeforeWrite = true;
    await expect(f.run(command({ scope: "subsequent" }))).rejects.toMatchObject({ code: "CONFLICT" });
    expect(f.state).toEqual(before);
    expect(f.events.at(-1)).toBe("rollback");
    const write = f.queries.find(query => /^update `leadflow_jobs`/.test(query.sql))!;
    expect(write.sql).toMatch(/`leadflow_jobs`\.`id` = \?.*`leadflow_jobs`\.`bookingId` = \?.*`leadflow_jobs`\.`jobTotalCents` = \?/);
    expect(write.params.slice(-3)).toEqual([50, 7, 10000]);
  });
  it("does not read any collection, capability, series, progress or signoff table even when populated", async () => {
    f.state.booking_payment_profiles.push({ id: 20, bookingId: 7, paymentStatus: "captured" });
    f.state.payment_authorizations = [{ id: 70, bookingPaymentProfileId: 19, status: "authorized", amountCents: 12000 }];
    f.state.card_auth_tokens = [{ id: 1, customerPhone: "+12025550101", token: "unreadable_active_token", used: 0, expiresAt: Date.now() + 50000 }];
    f.state.cleaner_portal_job_progress = [{ id: 2, leadflowJobId: 10, jobStatus: "completed" }];
    f.state.cleaner_portal_job_signoffs = [{ id: 3, leadflowJobId: 10, signedOffAt: "2026-11-20" }];
    f.claims = [{ occurrenceKey: "booking:7:first:2026-11-20", invoiceId: 9 }];
    f.manual = [{ occurrenceKey: "job:50", amountCents: 10000 }];
    const records = untouchedRecords();
    expect(await f.run(command({ scope: "subsequent" }))).toMatchObject({ selectedChanged: true, protectedVisitCount: 0, protectedVisits: [] });
    expect(untouchedRecords()).toEqual(records);
    expect(f.queries.filter(query => /^select /i.test(query.sql))).toHaveLength(2);
    expectOnlyNativeReads();
  });
  it("allows no-op saves with unchanged amounts, truthful counts, revision/history and write-free replay", async () => {
    const before = structuredClone(f.state);
    const result = await f.run(command({ amountCents: 12000 }));
    expect(result).toMatchObject({ selectedChanged: false, selectedAmountCents: 12000, changedVisitCount: 0, changedJobCount: 0, futureRuleChanged: false, protectedVisitCount: 0, protectedVisits: [], manualAmountRevision: 1, replayed: false });
    expect(f.state.leadflow_jobs).toEqual(before.leadflow_jobs);
    expect(f.state.bookings[0].manualAmountOverrides.history[0]).toMatchObject({ priorEffective: [{ amountCents: 12000 }], afterEffective: [{ amountCents: 12000 }], result });
    expect(f.queries.filter(query => /^update /.test(query.sql))).toHaveLength(1);
    expect(await f.run(command({ amountCents: 12000 }))).toEqual({ ...result, replayed: true });
    expect(f.queries.filter(query => /^update /.test(query.sql))).toHaveLength(1);
    expect(f.events.at(-1)).toBe("commit");
  });
  it("rejects one-time subsequent scope but preserves the visit choice including no-op saves", async () => {
    f.state.bookings[0].recurrence = "one-time";
    await expect(f.run(command({ scope: "subsequent" }))).rejects.toThrow("one-time");
    expect(f.queries.filter(query => /^update /.test(query.sql))).toHaveLength(0);
    expect(await f.run(command({ amountCents: 12000 }))).toMatchObject({ selectedChanged: false, changedVisitCount: 0, changedJobCount: 0, futureRuleChanged: false, manualAmountRevision: 1 });
    expect(await f.run(command({ amountCents: 13900, expectedRevision: 1, requestId: "afbe0054-a50d-4cdd-97b5-90579e34e102" }))).toMatchObject({ selectedChanged: true, selectedAmountCents: 13900, futureRuleChanged: false, manualAmountRevision: 2 });
    expect(selectNativeDisplayAmounts(f.state.bookings[0] as any)).toEqual({ firstCleaningTotalCents: 13900, futureVisitTotalCents: null, manualAmountRevision: 2 });
  });
});
describe("pure selector and input parity", () => {
  it("preserves raw totals without JSON/null and keeps one-time future null", () => {
    expect(selectNativeDisplayAmounts(booking() as any)).toEqual({ firstCleaningTotalCents: 12000, futureVisitTotalCents: 10000, manualAmountRevision: 0 });
    expect(selectNativeDisplayAmounts(booking({ manualAmountOverrides: undefined, recurrence: "one-time" }) as any).futureVisitTotalCents).toBeNull();
    expect(effectiveNativeVisitAmount(booking() as any, "2026-11-27", { firstVisit: false })).toBe(10000);
    const legacy = booking({ requestedLocalDate: "legacy-placeholder", firstCleaningTotalCents: -2, futureVisitTotalCents: 1.5 }) as any;
    expect(selectNativeDisplayAmounts(legacy)).toEqual({ firstCleaningTotalCents: -2, futureVisitTotalCents: 1.5, manualAmountRevision: 0 });
    expect(effectiveNativeVisitAmount(legacy, "legacy-placeholder")).toBe(-2);
    expect(effectiveNativeFutureAmount(legacy, "legacy-placeholder")).toBe(1.5);
  });
  it("keeps first override after date changes and job-bound exception after reschedule/reassignment", async () => {
    await f.run();
    const b = { ...f.state.bookings[0], requestedLocalDate: "2026-12-20" } as any;
    expect(effectiveNativeVisitAmount(b, "2027-01-10", { firstVisit: true })).toBe(15500);
    expect(effectiveNativeVisitAmount(b, "2027-01-10", { jobId: 10, firstVisit: false })).toBe(15500);
    expect(effectiveNativeVisitAmount(b, b.requestedLocalDate, { jobId: 50, firstVisit: false })).toBe(10000);
  });
  it("selects protected exact exception then explicit exception then latest applicable rule then raw", () => {
    const metadata = { version: 1, revision: 0, history: [], visits: [
      { jobId: 10, date: "2026-11-20", firstVisit: true, amountCents: 12000, protected: true },
      { jobId: 50, date: "2026-11-27", firstVisit: false, amountCents: 18000, protected: false },
    ], seriesRules: [{ fromDate: "2026-11-27", amountCents: 14000 }, { fromDate: "2026-12-04", amountCents: 15000 }] };
    const b = booking({ manualAmountOverrides: metadata }) as any;
    expect(effectiveNativeVisitAmount(b, "2026-12-20", { jobId: 10, firstVisit: true })).toBe(12000);
    expect(effectiveNativeVisitAmount(b, "2026-12-20", { jobId: 50, firstVisit: false })).toBe(18000);
    expect(effectiveNativeVisitAmount(b, "2026-11-28", { firstVisit: false })).toBe(14000);
    expect(effectiveNativeVisitAmount(b, "2026-12-20", { firstVisit: false })).toBe(15000);
    expect(effectiveNativeVisitAmount(b, "2026-11-22", { firstVisit: false })).toBe(10000);
  });
  it("rejects poisoned/unknown-version JSON and validates existing cents/UUID/date bounds", () => {
    for (const value of [{ version: 2 }, "{}", {}, { version: 1, revision: 2, visits: [], seriesRules: [], history: [] }]) expect(() => parseNativeBookingManualAmounts(value)).toThrow("need review");
    expect(updateNativeBookingManualAmountInputSchema.safeParse(command({ amountCents: 10_000_000 })).success).toBe(true);
    for (const value of [command({ amountCents: 10_000_001 }), command({ amountCents: -1 }), command({ amountCents: 1.5 }), command({ requestId: "bad" }), command({ expectedDate: "2026-02-30" })]) expect(updateNativeBookingManualAmountInputSchema.safeParse(value).success).toBe(false);
  });
  it("contains no provider calls or forbidden data dependency and writes only owned fields", () => {
    const source = readFileSync(new URL("./nativeBookingManualAmountService.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/cleanerJ(?=obs)|cleaner_j(?=obs)|bookingCashApp|cash_app|invokeLLM|getStripeClient|\.insert\(/);
    expect(source).toContain("leadflowJobs.bookingId");
    expect(source).not.toMatch(/bookingSeries|bookingPaymentProfiles|paymentAuthorizations|cardAuthTokens|cleanerPortalJobProgress|cleanerPortalJobSignoffs|payable_invoice_lines|payable_invoice_manual_payments|\.execute\(/);
    expect([...source.matchAll(/\.from\(([^)]+)\)/g)].map(match => match[1])).toEqual(["bookings", "leadflowJobs"]);
    expect([...source.matchAll(/\.update\(([^)]+)\)/g)].map(match => match[1])).toEqual(["leadflowJobs", "bookings"]);
    expect(source).not.toMatch(/\.update\((?:bookingSeries|bookingPaymentProfiles|paymentAuthorizations|cardAuthTokens)/);
  });
});
