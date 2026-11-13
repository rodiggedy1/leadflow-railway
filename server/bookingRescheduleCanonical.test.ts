import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TRPCError } from "@trpc/server";

const mocks = vi.hoisted(() => ({ getDb: vi.fn(), reschedule: vi.fn(), refresh: vi.fn(), broadcast: vi.fn(), external: vi.fn() }));
vi.mock("./db", () => ({ getDb: mocks.getDb }));
vi.mock("./_core/trpc", async () => {
  const { initTRPC, TRPCError } = await import("@trpc/server");
  const t = initTRPC.context<{ agent?: { agentId: number; agentName: string } }>().create();
  return { router: t.router, publicProcedure: t.procedure, bookingsAgentProcedure: t.procedure.use(({ ctx, next }) => {
    if (!ctx.agent) throw new TRPCError({ code: "UNAUTHORIZED" });
    return next({ ctx: { ...ctx, agent: ctx.agent } });
  }) };
});
vi.mock("./_core/env", () => ({ ENV: { cookieSecret: "offline-secret" } }));
vi.mock("./bookingRescheduleService", () => ({ rescheduleOperationalBooking: mocks.reschedule }));
vi.mock("./cleanerPortalUpdates", () => ({ broadcastCleanerPortalJobsChanged: mocks.refresh }));
vi.mock("./sseBroadcast", () => ({ broadcastOpsUpdate: mocks.broadcast }));
vi.mock("./customerPortalService", () => ({ getOrCreateCustomerPortalMagicLink: mocks.external }));
vi.mock("./canonicalBookingPersistence", () => ({ persistCanonicalBooking: mocks.external }));
vi.mock("./bookingCancellationService", () => ({ cancelCanonicalBooking: mocks.external }));
vi.mock("./bookingCompletionNotifications", () => ({ sendBookingCompletionNotifications: mocks.external }));
vi.mock("./bookingLeadCreatedNotifications", () => ({ sendCustomerPortalLeadCreatedCommandChatCard: mocks.external, sendWidgetLeadCreatedNotifications: mocks.external }));
vi.mock("./_core/llm", () => ({ invokeLLM: mocks.external }));
vi.mock("./madisonKnowledgeRetrieval", () => ({ retrieveKnowledge: mocks.external }));
vi.mock("./_core/customerPortalAuth", () => ({ getCustomerPortalSessionFromRequest: mocks.external }));
vi.mock("./unifiedBookingMetrics", () => ({ getUnifiedBookingDetails: mocks.external }));
vi.mock("./bookingUpsellEngine", () => ({ applyCanonicalAdditionalServices: mocks.external, BookingUpsellInputError: class extends Error {} }));
vi.mock("./bookingsService", () => ({ NativeBookingIdempotencyConflictError: class extends Error {}, NativeBookingInputError: class extends Error {}, buildPreparedCanonicalBooking: mocks.external, prepareNativeBooking: mocks.external }));
vi.mock("../drizzle/schema", () => {
  const table = (name: string) => new Proxy({ name }, { get: (target, field: string) => field === "name" ? target.name : { table: name, field } });
  return Object.fromEntries(["bookings", "bookingSeries", "bookingAssignments", "bookingFunnelRecords", "bookingPaymentProfiles", "customerPortalServiceRequests", "leadflowJobs", "appSettings", "cleanerProfiles", "conversationSessions", "schedulingTeams"].map(name => [name, table(name)]));
});
vi.mock("drizzle-orm", () => ({
  eq: (column: Column, value: unknown) => ({ op: "eq", column, value }),
  gt: (column: Column, value: unknown) => ({ op: "gt", column, value }),
  gte: vi.fn(), lt: vi.fn(), inArray: (column: Column, value: unknown[]) => ({ op: "in", column, value }), asc: (column: Column) => column, desc: (column: Column) => column,
  and: (...conditions: Condition[]) => ({ op: "and", conditions }), sql: vi.fn(),
}));

import { bookingsRouter } from "./bookingsRouter";
import { bookingFunnelRouter } from "./bookingFunnelRouter";
import { syncNativeBookingOperationalProjection } from "./bookingLifecycleService";
import { businessLocalDateTimeToUtcMs } from "./utils/businessTime";
import { createPublicBookingPriceSnapshot } from "../shared/publicBookingPricing";

type Row = Record<string, any>;
type Column = { table: string; field: string };
type Table = { name: string };
type Condition = { op: "eq" | "gt" | "in"; column: Column; value: any } | { op: "and"; conditions: Condition[] };
function matches(row: Row, condition?: Condition): boolean {
  if (!condition) return true;
  if (condition.op === "and") return condition.conditions.every(item => matches(row, item));
  if (condition.op === "in") return condition.value.includes(row[condition.column.field]);
  return condition.op === "eq" ? row[condition.column.field] === condition.value : row[condition.column.field] > condition.value;
}
class MemoryDb {
  state: Record<string, Row[]> = { bookings: [], bookingSeries: [], bookingAssignments: [], bookingFunnelRecords: [], customerPortalServiceRequests: [], leadflowJobs: [] };
  writes: Array<{ table: string; values: Row }> = [];
  attempts: Array<{ table: string; values: Row }> = [];
  transactions = 0;
  failTable: string | null = null;
  select(fields?: Record<string, Column>) {
    let table: Table, condition: Condition | undefined, count = Infinity;
    const chain = {
      from(value: Table) { table = value; return chain; },
      where(value: Condition) { condition = value; return chain; },
      limit(value: number) { count = value; return chain; },
      orderBy() { return chain; }, for() { return chain; },
      then: async (resolve: (rows: Row[]) => unknown) => {
        let rows = this.state[table.name].filter(row => matches(row, condition)).slice(0, count);
        if (fields) rows = rows.map(row => Object.fromEntries(Object.entries(fields).map(([key, column]) => [key, row[column.field]])));
        return resolve(structuredClone(rows));
      },
    };
    return chain;
  }
  update(table: Table) {
    return { set: (values: Row) => ({ where: async (condition: Condition) => {
      this.attempts.push({ table: table.name, values: structuredClone(values) });
      if (this.failTable === table.name) throw new Error("Mock write failure");
      this.writes.push({ table: table.name, values: structuredClone(values) });
      const rows = this.state[table.name].filter(row => matches(row, condition));
      rows.forEach(row => Object.assign(row, structuredClone(values)));
      return [{ affectedRows: rows.length }];
    } }) };
  }
  insert(table: Table) {
    return { values: async (values: Row) => {
      this.attempts.push({ table: table.name, values: structuredClone(values) });
      if (this.failTable === table.name) throw new Error("Mock write failure");
      this.writes.push({ table: table.name, values: structuredClone(values) });
      const rows = this.state[table.name];
      rows.push({ id: rows.length + 1, ...structuredClone(values) });
      return [{ insertId: rows.length }];
    } };
  }
  transaction = async (callback: (tx: MemoryDb) => Promise<any>) => {
    this.transactions++;
    const state = structuredClone(this.state), writes = structuredClone(this.writes);
    try { return await callback(this); } catch (error) { this.state = state; this.writes = writes; throw error; }
  };
}
const date = "2026-11-10", time = "09:00";
function booking(overrides: Row = {}): Row {
  return {
    id: 7, source: "popup", requestedLocalDate: date, requestedLocalTime: time,
    requestedTimeZone: "America/New_York", requestedStartAt: businessLocalDateTimeToUtcMs(date, time, "America/New_York"),
    recurrence: "weekly", firstCleaningTotalCents: 19000, futureVisitTotalCents: 16000,
    extras: [{ id: "custom-extra", label: "Existing", quantity: 1, unitPriceCents: 1000, totalCents: 1000 }],
    specialRequestNotes: ["Keep this customer note"], companyNotes: "Existing company note", priceSnapshot: {},
    customerName: "Local Customer", customerPhone: "2025550101", customerEmail: "offline@example.com", address: "123 Test Street",
    serviceName: "Standard", bedrooms: 2, bathrooms: 1, status: "confirmed", paymentStatus: "card_on_file", paymentMethod: "invoice",
    ...overrides,
  };
}
let db: MemoryDb;
const ctx = { agent: { agentId: 3, agentName: "Offline staff" } };
const native = () => bookingsRouter.createCaller(ctx);
const funnel = () => bookingFunnelRouter.createCaller(ctx);
function seed(overrides: Row = {}) {
  db.state.bookings = [booking(overrides)];
  db.state.bookingSeries = [{ id: 20, bookingId: 7, anchorLocalDate: "2026-11-03", anchorLocalTime: "08:00", frequency: "weekly", futureVisitTotalCents: 16000 }];
  db.state.leadflowJobs = [{ id: 70, bookingId: 7, jobDate: date, serviceDateTime: "2026-11-10T14:00:00.000Z", bookingStatus: "unassigned", frequency: "Weekly", jobTotalCents: 19000 }];
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Network disabled"); }));
  mocks.external.mockImplementation(() => { throw new Error("External provider disabled"); });
  db = new MemoryDb(); mocks.getDb.mockResolvedValue(db); seed();
  mocks.reschedule.mockImplementation(async (tx: MemoryDb, input: Row) => {
    expect(tx).toBe(db);
    const job = tx.state.leadflowJobs.find(row => row.bookingId === input.bookingId && row.jobDate === input.previousLocalDate);
    if (job) {
      job.jobDate = input.requestedLocalDate;
      job.serviceDateTime = new Date(businessLocalDateTimeToUtcMs(input.requestedLocalDate, input.requestedLocalTime, input.requestedTimeZone)).toISOString();
    }
    return { movedCount: job ? 1 : 0, selectedJobId: job?.id ?? null, continuationCreated: false };
  });
});
afterEach(() => {
  expect(mocks.external).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
  vi.unstubAllGlobals(); vi.restoreAllMocks();
});

describe("canonical BookingCRM schedule saves through real routers (offline)", () => {
  it("persists and returns changed date and time, selects the old unassigned linked visit", async () => {
    const saved = await native().updateDetails({ bookingId: 7, requestedLocalDate: "2026-11-12", requestedLocalTime: "13:30", rescheduleMode: "visit" });
    expect(saved).toMatchObject({ requestedLocalDate: "2026-11-12", requestedLocalTime: "13:30" });
    expect(db.state.bookings[0]).toMatchObject({ requestedLocalDate: "2026-11-12", requestedLocalTime: "13:30", requestedTimeZone: "America/New_York", requestedStartAt: businessLocalDateTimeToUtcMs("2026-11-12", "13:30", "America/New_York") });
    expect(mocks.reschedule).toHaveBeenCalledWith(db, expect.objectContaining({ bookingId: 7, previousLocalDate: date, previousLocalTime: time, mode: "visit", allowMissingOperationalJob: true }));
    expect(db.state.leadflowJobs[0]).toMatchObject({ jobDate: "2026-11-12", bookingStatus: "unassigned" });
    expect(db.state.bookingSeries[0]).toMatchObject({ anchorLocalDate: "2026-11-03", anchorLocalTime: "08:00" });
    expect(db.writes.map(row => row.table)).not.toContain("leadflowJobs");
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });
  it.each(["popup", "full_page", "imported"])("requires recurring choice for date/time and time-only edits regardless %s origin", async source => {
    seed({ source });
    for (const change of [{ requestedLocalDate: "2026-11-12" }, { requestedLocalTime: "10:00" }]) {
      await expect(native().updateDetails({ bookingId: 7, ...change })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    }
    expect(db.attempts).toHaveLength(0); expect(mocks.reschedule).not.toHaveBeenCalled();
  });
  it("persists time-only edits and defaults one-time changes to visit", async () => {
    seed({ recurrence: "one-time", futureVisitTotalCents: null });
    expect(await native().updateDetails({ bookingId: 7, requestedLocalTime: "15:15" })).toMatchObject({ requestedLocalDate: date, requestedLocalTime: "15:15" });
    expect(mocks.reschedule).toHaveBeenCalledWith(db, expect.objectContaining({ previousLocalDate: date, requestedLocalDate: date, requestedLocalTime: "15:15", mode: "visit" }));
    expect(db.state.bookings[0].requestedStartAt).toBe(businessLocalDateTimeToUtcMs(date, "15:15", "America/New_York"));
  });
  it("date-only returns preserved time; recurring time-only returns the new saved time", async () => {
    expect(await native().updateDetails({ bookingId: 7, requestedLocalDate: "2026-11-12", rescheduleMode: "visit" })).toMatchObject({ requestedLocalDate: "2026-11-12", requestedLocalTime: time });
    seed();
    expect(await native().updateDetails({ bookingId: 7, requestedLocalTime: "12:30", rescheduleMode: "visit" })).toMatchObject({ requestedLocalDate: date, requestedLocalTime: "12:30" });
    expect(db.state.bookingSeries[0]).toMatchObject({ anchorLocalDate: "2026-11-03", anchorLocalTime: "08:00" });
  });
  it("subsequent shifts the existing anchor by delta rather than replacing it with selected date", async () => {
    await native().updateDetails({ bookingId: 7, requestedLocalDate: "2026-11-12", requestedLocalTime: "13:30", rescheduleMode: "subsequent" });
    expect(db.state.bookingSeries[0]).toMatchObject({ anchorLocalDate: "2026-11-05", anchorLocalTime: "13:30" });
  });
  it("visit without series initializes original cadence; subsequent time-only preserves anchor date", async () => {
    db.state.bookingSeries = [];
    await native().updateDetails({ bookingId: 7, requestedLocalDate: "2026-11-12", requestedLocalTime: "13:30", rescheduleMode: "visit" });
    expect(db.state.bookingSeries[0]).toMatchObject({ anchorLocalDate: date, anchorLocalTime: time });
    seed();
    await native().updateDetails({ bookingId: 7, requestedLocalTime: "12:00", rescheduleMode: "subsequent" });
    expect(db.state.bookingSeries[0]).toMatchObject({ anchorLocalDate: "2026-11-03", anchorLocalTime: "12:00" });
  });
  it("commercial-only saves preserve canonical schedule, existing anchor, payment and extras behavior", async () => {
    const before = structuredClone(db.state.bookings[0]);
    await native().updateDetails({ bookingId: 7, companyNotes: " Updated note ", firstCleaningTotalCents: 22500 });
    expect(db.state.bookings[0]).toMatchObject({ ...before, companyNotes: "Updated note", firstCleaningTotalCents: 22500, recurringIntentStatus: "intent_pending" });
    expect(db.state.bookingSeries[0]).toMatchObject({ anchorLocalDate: "2026-11-03", anchorLocalTime: "08:00", frequency: "weekly" });
    expect(mocks.reschedule).not.toHaveBeenCalled();
  });
  it.each(["popup", "full_page", "imported"])("projects saved CRM notes for an assigned %s booking through the existing portal refresh path", async source => {
    seed({ source });
    db.state.bookingAssignments = [{ bookingId: 7, status: "assigned", teamId: 3, teamName: "Test team" }];
    db.state.leadflowJobs[0] = { ...db.state.leadflowJobs[0], teamId: 3, teamName: "Test team", bookingStatus: "assigned", hasStripeCard: 1 };
    db.state.leadflowJobs.push({ id: 99, bookingId: 99, jobDate: date, customerNotes: "Another customer's note", jobTotalCents: 8000 });
    const before = structuredClone(db.state);
    const saved = await native().updateDetails({ bookingId: 7, companyNotes: " Use the side entrance\nDog stays upstairs " });
    expect(saved.companyNotes).toBe("Use the side entrance\nDog stays upstairs");
    expect(db.state.bookings[0]).toMatchObject({
      specialRequestNotes: before.bookings[0].specialRequestNotes,
      paymentStatus: before.bookings[0].paymentStatus,
      firstCleaningTotalCents: before.bookings[0].firstCleaningTotalCents,
      futureVisitTotalCents: before.bookings[0].futureVisitTotalCents,
      requestedLocalDate: date, requestedLocalTime: time,
    });
    expect(db.state.leadflowJobs[0]).toMatchObject({
      customerNotes: "Keep this customer note\nUse the side entrance\nDog stays upstairs",
      jobDate: date, serviceDateTime: before.leadflowJobs[0].serviceDateTime,
      jobTotalCents: before.leadflowJobs[0].jobTotalCents,
      teamId: 3, teamName: "Test team", bookingStatus: "assigned", hasStripeCard: 1,
    });
    expect(db.state.leadflowJobs[1]).toEqual(before.leadflowJobs[1]);
    expect(db.state.bookingAssignments).toEqual(before.bookingAssignments);
    expect(mocks.reschedule).not.toHaveBeenCalled();
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });
  it.each([{ specialRequestNotes: [] }, { specialRequestNotes: ["Keep this customer note"] }])("clears CRM company notes without deleting customer special requests %j", async ({ specialRequestNotes }) => {
    seed({ specialRequestNotes });
    db.state.bookingAssignments = [{ bookingId: 7, status: "assigned", teamId: 3, teamName: "Test team" }];
    await native().updateDetails({ bookingId: 7, companyNotes: null });
    expect(db.state.bookings[0].companyNotes).toBeNull();
    expect(db.state.bookings[0].specialRequestNotes).toEqual(specialRequestNotes);
    expect(db.state.leadflowJobs[0].customerNotes).toBe(specialRequestNotes.length ? "Keep this customer note" : null);
    expect(mocks.reschedule).not.toHaveBeenCalled();
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });
  it("combined commercial and schedule saves project selected details without any extra date/time/frequency write", async () => {
    db.state.bookingAssignments = [{ bookingId: 7, status: "assigned", teamId: 3, teamName: "Test team" }];
    db.state.leadflowJobs.push({ id: 71, bookingId: 7, jobDate: "2026-11-17", frequency: "Weekly", serviceDateTime: "2026-11-17T14:00:00.000Z", jobTotalCents: 16000 });
    await native().updateDetails({ bookingId: 7, requestedLocalDate: "2026-11-12", requestedLocalTime: "13:30", rescheduleMode: "visit", companyNotes: "Updated", firstCleaningTotalCents: 22000, extras: [{ id: "custom-extra", quantity: 2 }] });
    expect(db.state.leadflowJobs[0]).toMatchObject({ jobDate: "2026-11-12", jobTotalCents: 22000, extras: '["custom-extra"]', customerNotes: "Keep this customer note\nUpdated" });
    expect(db.state.leadflowJobs[1]).toMatchObject({ jobDate: "2026-11-17", serviceDateTime: "2026-11-17T14:00:00.000Z", frequency: "Weekly" });
    for (const write of db.writes.filter(row => row.table === "leadflowJobs")) {
      for (const field of ["jobDate", "serviceDateTime", "frequency", "nextOccurrenceCreatedAt"]) expect(write.values).not.toHaveProperty(field);
    }
  });
  it("service collision fails before canonical writes and database failure rolls back the operational move", async () => {
    const before = structuredClone(db.state);
    mocks.reschedule.mockRejectedValueOnce(new TRPCError({ code: "CONFLICT", message: "Collision" }));
    await expect(native().updateDetails({ bookingId: 7, requestedLocalDate: "2026-11-12", rescheduleMode: "visit" })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(db.attempts).toHaveLength(0); expect(db.state).toEqual(before);
    db.failTable = "bookingSeries";
    await expect(native().updateDetails({ bookingId: 7, requestedLocalDate: "2026-11-12", rescheduleMode: "visit" })).rejects.toThrow("Mock write failure");
    expect(db.state).toEqual(before); expect(db.writes).toHaveLength(0); expect(mocks.refresh).not.toHaveBeenCalled();
  });
  it.each(["2026-12-01", "2026-11-01"])("combined commercial projection retains original future IDs when visit moves across dates to %s", async target => {
    db.state.leadflowJobs.push(
      { id: 69, bookingId: 7, jobDate: "2026-11-05", bookingStatus: "completed", customerNotes: "Past note", jobTotalCents: 9000 },
      { id: 71, bookingId: 7, jobDate: "2026-11-17", customerNotes: "Future note", jobTotalCents: 16000 },
    );
    await native().updateDetails({ bookingId: 7, requestedLocalDate: target, requestedLocalTime: "12:00", rescheduleMode: "visit", companyNotes: "Updated" });
    expect(db.state.leadflowJobs.find(row => row.id === 69)).toMatchObject({ customerNotes: "Past note", jobTotalCents: 9000 });
    expect(db.state.leadflowJobs.find(row => row.id === 71)).toMatchObject({ customerNotes: "Keep this customer note\nUpdated", jobTotalCents: 16000 });
  });
  it("unchanged footer fields do not reprice or commercially project during reschedule", async () => {
    db.state.bookings[0].futureVisitTotalCents = 12345;
    db.state.bookings[0].priceSnapshot = createPublicBookingPriceSnapshot({
      pricingMode: "home", serviceId: "standard", bedrooms: 2, bathrooms: 1,
      homeType: "House", condition: 6, maidCount: 2, hourCount: 2,
      extras: [], recurrence: "weekly",
    });
    db.state.leadflowJobs.push({ id: 71, bookingId: 7, jobDate: "2026-11-17", jobTotalCents: 12345, customerNotes: "Distinct future note" });
    await native().updateDetails({ bookingId: 7, requestedLocalDate: "2026-11-12", requestedLocalTime: "12:00", rescheduleMode: "visit", extras: [{ id: "custom-extra", quantity: 1 }], firstCleaningTotalCents: 19000, companyNotes: "Existing company note" });
    expect(db.state.bookings[0].futureVisitTotalCents).toBe(12345);
    expect(db.state.leadflowJobs[1]).toMatchObject({ jobTotalCents: 12345, customerNotes: "Distinct future note" });
    expect(db.writes.filter(row => row.table === "leadflowJobs")).toHaveLength(0);
  });
  it.each([{ requestedLocalDate: "2026-02-30" }, { requestedLocalTime: "24:00" }, { rescheduleMode: "all" }])("rejects malformed schedule input %j before DB access", async invalid => {
    await expect(native().updateDetails({ bookingId: 7, ...invalid } as any)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(mocks.getDb).not.toHaveBeenCalled();
  });
  it("rejects impossible timezone wall time before service/writes", async () => {
    await expect(native().updateDetails({ bookingId: 7, requestedLocalDate: "2027-03-14", requestedLocalTime: "02:30", rescheduleMode: "visit" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(mocks.reschedule).not.toHaveBeenCalled(); expect(db.attempts).toHaveLength(0);
  });
  it("requires staff authorization at both real router boundaries", async () => {
    await expect(bookingsRouter.createCaller({}).updateDetails({ bookingId: 7, requestedLocalTime: "12:00", rescheduleMode: "visit" })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(bookingFunnelRouter.createCaller({}).updateSchedule({ id: 5, requestedLocalDate: date, requestedLocalTime: time })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(mocks.getDb).not.toHaveBeenCalled();
  });
});

describe("linked funnel and unlinked portal request boundaries", () => {
  it("linked funnel delegates to canonical and operational save in exactly one transaction", async () => {
    db.state.bookingFunnelRecords = [{ id: 5, bookingId: 7, requestedLocalDate: date, requestedLocalTime: time, recurrence: "weekly" }];
    const result = await funnel().updateSchedule({ id: 5, requestedLocalDate: "2026-11-12", requestedLocalTime: "13:30", rescheduleMode: "subsequent" });
    expect(result).toMatchObject({ requestedLocalDate: "2026-11-12", requestedLocalTime: "13:30" });
    expect(db.transactions).toBe(1); expect(mocks.reschedule).toHaveBeenCalledTimes(1);
    expect(db.state.bookings[0]).toMatchObject(resultWithoutId(result));
    expect(db.state.bookingFunnelRecords[0]).toMatchObject(result);
    expect(db.state.bookingSeries[0]).toMatchObject({ anchorLocalDate: "2026-11-05", anchorLocalTime: "13:30" });
    expect(mocks.broadcast).toHaveBeenCalledWith("booking_funnel_update");
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ id: 5, requestedLocalDate: "2026-11-12", requestedLocalTime: "13:30" });
  });
  it("linked funnel rejects omission and rolls back canonical + operational on funnel write failure", async () => {
    db.state.bookingFunnelRecords = [{ id: 5, bookingId: 7, requestedLocalDate: date, requestedLocalTime: time, recurrence: "weekly" }];
    const before = structuredClone(db.state);
    await expect(funnel().updateSchedule({ id: 5, requestedLocalDate: date, requestedLocalTime: "12:00" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    db.failTable = "bookingFunnelRecords";
    await expect(funnel().updateSchedule({ id: 5, requestedLocalDate: "2026-11-12", requestedLocalTime: "12:00", rescheduleMode: "visit" })).rejects.toThrow("Mock write failure");
    expect(db.state).toEqual(before); expect(db.writes).toHaveLength(0); expect(mocks.broadcast).not.toHaveBeenCalled();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
  it("unlinked recurring pending funnel requires choice, updates only its record and invents no future jobs", async () => {
    db.state.bookingFunnelRecords = [{ id: 5, bookingId: null, recurrence: "weekly", requestedLocalDate: date, requestedLocalTime: time }];
    await expect(funnel().updateSchedule({ id: 5, requestedLocalDate: "2026-11-12", requestedLocalTime: "12:00" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const before = structuredClone(db.state.bookings);
    await funnel().updateSchedule({ id: 5, requestedLocalDate: "2026-11-12", requestedLocalTime: "12:00", rescheduleMode: "subsequent" });
    expect(db.state.bookings).toEqual(before); expect(mocks.reschedule).not.toHaveBeenCalled();
    expect(db.writes.map(row => row.table)).toEqual(["bookingFunnelRecords"]);
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
  it("portal request has no verified booking link and changes only existing request; nested mysql affectedRows works", async () => {
    db.state.customerPortalServiceRequests = [{ id: 8, requestedLocalDate: date, requestedLocalTime: time, customerPhone: db.state.bookings[0].customerPhone }];
    const before = structuredClone(db.state.bookings);
    expect(await native().updateStaffRequestSchedule({ id: 8, requestedLocalDate: "2026-11-12", requestedLocalTime: "12:00", rescheduleMode: "subsequent" })).toEqual({ id: 8, requestedLocalDate: "2026-11-12", requestedLocalTime: "12:00" });
    expect(db.state.bookings).toEqual(before); expect(mocks.reschedule).not.toHaveBeenCalled();
    expect(db.writes.map(row => row.table)).toEqual(["customerPortalServiceRequests"]);
    await expect(native().updateStaffRequestSchedule({ id: 999, requestedLocalDate: date, requestedLocalTime: time })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
function resultWithoutId(result: { id: number; requestedLocalDate: string; requestedLocalTime: string }) { return { requestedLocalDate: result.requestedLocalDate, requestedLocalTime: result.requestedLocalTime }; }

describe("minimal projection exact-occurrence selection", () => {
  it.each([false, true])("fails closed rather than retarget another occurrence (assigned=%s)", async assigned => {
    db.state.leadflowJobs = [{ id: 71, bookingId: 7, jobDate: "2026-11-17" }, { id: 72, bookingId: 7, jobDate: "2026-11-24" }];
    await expect(syncNativeBookingOperationalProjection(db as any, booking() as any, assigned ? { teamId: 3, teamName: "Test team" } : null)).rejects.toMatchObject({ code: "CONFLICT" });
    expect(db.attempts).toHaveLength(0);
  });
  it("refuses duplicate exact occurrences instead of arbitrary deduplication", async () => {
    db.state.leadflowJobs.push({ id: 71, bookingId: 7, jobDate: date });
    await expect(syncNativeBookingOperationalProjection(db as any, booking() as any, { teamId: 3, teamName: "Test team" })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(db.attempts).toHaveLength(0);
  });
  it("commercial-only ambiguous projection rolls the native details save back", async () => {
    db.state.leadflowJobs = [{ id: 71, bookingId: 7, jobDate: "2026-11-17" }];
    const before = structuredClone(db.state);
    await expect(native().updateDetails({ bookingId: 7, companyNotes: "New" })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(db.state).toEqual(before); expect(db.writes).toHaveLength(0);
  });
});
