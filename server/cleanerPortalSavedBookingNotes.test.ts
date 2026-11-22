import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getDb: vi.fn(), list: vi.fn(), team: vi.fn(), pay: vi.fn() }));
vi.mock("./db", () => ({ getDb: mocks.getDb }));
vi.mock("./cleanerPortalJobResolver", () => ({ listOwnedLeadflowJobs: mocks.list }));
vi.mock("./cleanerPortalOwnership", () => ({ findCleanerPortalTeam: mocks.team }));
vi.mock("./payrollCalculator", () => ({ calculateEffectivePayroll: mocks.pay }));
vi.mock("./teamPayRouter", () => ({ getPayWeekStart: () => new Date("2026-11-08T12:00:00Z") }));
vi.mock("./_core/trpc", async () => {
  const { initTRPC, TRPCError } = await import("@trpc/server");
  const t = initTRPC.context<{ cleaner?: { cleanerId: number } }>().create();
  return { router: t.router, cleanerProcedure: t.procedure.use(({ ctx, next }) => {
    if (!ctx.cleaner) throw new TRPCError({ code: "UNAUTHORIZED" });
    return next({ ctx: { ...ctx, cleaner: ctx.cleaner } });
  }) };
});
vi.mock("../drizzle/schema", () => {
  const table = (name: string) => new Proxy({ name }, { get: (target, field: string) => field === "name" ? target.name : { table: name, field } });
  return Object.fromEntries(["bookings", "leadflowJobs", "cleanerPortalJobProgress", "cleanerProfiles", "schedulingTeams", "teamWorkSchedule"].map(name => [name, table(name)]));
});
vi.mock("../drizzle/leadflowPayrollAdjustments", () => ({ leadflowJobPayrollAdjustments: { name: "adjustments", leadflowJobId: { field: "leadflowJobId" }, amountCents: { field: "amountCents" } } }));
vi.mock("../drizzle/leadflowLaunch27VisitNotes", () => ({ leadflowLaunch27VisitNotes: { name: "visitNotes", launch27BookingId: { field: "launch27BookingId" }, staffNotes: { field: "staffNotes" } } }));
vi.mock("drizzle-orm", () => ({
  and: (...conditions: unknown[]) => ({ conditions }), asc: vi.fn(), eq: vi.fn(), gte: vi.fn(), lte: vi.fn(), ne: vi.fn(), gt: vi.fn(),
  inArray: (column: { field: string }, values: number[]) => ({ column, values }),
}));

import { cleanerPortalReadOnlyRouter } from "./cleanerPortalReadOnlyRouter";

type Row = Record<string, any>;
let canonical: Row[];
let rows: Row[];
let visitNotes: Row[];
let selections: Array<{ table: string; fields: string[]; values: number[] }>;
const operational = (overrides: Row = {}): Row => ({
  id: 701, bookingId: 7, customerName: "Synthetic Customer", customerPhone: "+12025550701", jobAddress: "701 Test Street",
  jobDate: "2026-11-13", serviceDateTime: "2026-11-13T17:30:00Z", bedrooms: 2, bathrooms: 1, extras: "[]", bookingStatus: "assigned",
  jobTotalCents: 19000, customerNotes: "Stale operational note", teamId: 3, origin: "native_booking", launch27BookingId: null, serviceName: "Hourly Cleaning", ...overrides,
});
const procedures = ["getMyJobsToday", "getMyJobsTomorrow", "getMyJobsWeek"] as const;
const caller = () => cleanerPortalReadOnlyRouter.createCaller({ cleaner: { cleanerId: 9 } });
beforeEach(() => {
  vi.clearAllMocks();
  canonical = [{ id: 7, specialRequestNotes: ["Ring the bell", "Dog stays upstairs"], companyNotes: " Use the side entrance ", extras: [] }];
  rows = [{ job: operational(), progress: { jobStatus: "in_progress" }, payPercent: "0.5" }];
  visitNotes = [];
  selections = [];
  const db = { select(fields: Record<string, { field: string }>) {
    let table: string;
    return { from(value: { name: string }) { table = value.name; return this; },
      async where(condition: { column: { field: string }; values: number[] }) {
        selections.push({ table, fields: Object.keys(fields), values: condition.values });
        if (table === "adjustments") return [];
        if (table === "visitNotes") return visitNotes.filter(row => condition.values.includes(row.launch27BookingId)).map(row => Object.fromEntries(Object.entries(fields).map(([name, column]) => [name, row[column.field]])));
        if (table !== "bookings") throw new Error("Unexpected notes query");
        return canonical.filter(row => condition.values.includes(row.id)).map(row => Object.fromEntries(Object.entries(fields).map(([name, column]) => [name, row[column.field]])));
      },
    };
  } };
  mocks.list.mockImplementation(async () => ({ db, team: { cleanerProfileId: 9, payPercent: "0.5" }, jobs: structuredClone(rows) }));
  mocks.pay.mockImplementation(() => ({ finalPay: 80 }));
});

describe("cleaner portal reads the same saved notes as Booking CRM (offline)", () => {
  it.each(procedures)("%s reads saved notes rather than the stale operational copy", async procedure => {
    const before = structuredClone(rows);
    const result = await caller()[procedure]();
    expect(result[0]).toMatchObject({ portalJobKey: "leadflow:701", customerNotes: "Ring the bell\nDog stays upstairs\nUse the side entrance", staffNotes: null,
      jobStatus: "in_progress", time: "12:30 PM", address: "701 Test Street", basePay: 80 });
    expect(rows).toEqual(before);
    expect(selections.filter(query => query.table === "bookings")).toEqual([{ table: "bookings", fields: ["id", "specialRequestNotes", "companyNotes", "extras"], values: [7] }]);
    expect(mocks.list).toHaveBeenCalledWith(9, expect.any(String), expect.any(String), expect.any(String));
    expect(mocks.pay).toHaveBeenCalledWith({ jobDate: "2026-11-13", jobRevenue: 190, payPercent: 50, manualAdjustment: 0 });
  });
  it.each(procedures)("%s reflects later saved edits and clearing without resurrecting copied notes", async procedure => {
    await caller()[procedure]();
    canonical[0] = { ...canonical[0], specialRequestNotes: ["Replacement saved request"], companyNotes: "Replacement saved company note" };
    expect((await caller()[procedure]())[0].customerNotes).toBe("Replacement saved request\nReplacement saved company note");
    canonical[0] = { ...canonical[0], companyNotes: null };
    expect((await caller()[procedure]())[0].customerNotes).toBe("Replacement saved request");
    canonical[0] = { ...canonical[0], specialRequestNotes: [], companyNotes: null };
    expect((await caller()[procedure]())[0].customerNotes).toBeNull();
  });
  it("uses only exact booking IDs on owned rows, never another customer's matching phone/name", async () => {
    rows.push({ job: operational({ id: 702, bookingId: 8 }), progress: null, payPercent: "0.5" });
    canonical.push({ id: 8, specialRequestNotes: ["Other owned booking"], companyNotes: null, extras: [] }, { id: 99, specialRequestNotes: ["Unowned customer note"], companyNotes: "Must not leak", extras: [] });
    const result = await caller().getMyJobsToday();
    expect(result[0].customerNotes).toBe("Ring the bell\nDog stays upstairs\nUse the side entrance");
    expect(result[1].customerNotes).toBe("Other owned booking");
    expect(selections.find(query => query.table === "bookings")?.values).toEqual([7, 8]);
    expect(JSON.stringify(result)).not.toContain("Unowned customer note");
  });
  it("shows the same saved booking notes on its subsequent linked visits without date/origin exceptions", async () => {
    rows.push({ job: operational({ id: 702, jobDate: "2026-11-20", origin: "native_booking" }), progress: null, payPercent: "0.5" });
    const result = await caller().getMyJobsWeek();
    expect(result.map(job => job.customerNotes)).toEqual(["Ring the bell\nDog stays upstairs\nUse the side entrance", "Ring the bell\nDog stays upstairs\nUse the side entrance"]);
    expect(selections.find(query => query.table === "bookings")?.values).toEqual([7]);
  });
  it("preserves the job's own stored notes when there is no linked saved booking", async () => {
    rows = [{ job: operational({ bookingId: null, customerNotes: "Own stored CRM job note" }), progress: null, payPercent: "0.5" }];
    expect((await caller().getMyJobsToday())[0].customerNotes).toBe("Own stored CRM job note");
    expect(selections.some(query => query.table === "bookings")).toBe(false);
    rows[0].job.bookingId = 88;
    expect((await caller().getMyJobsToday())[0].customerNotes).toBe("Own stored CRM job note");
  });
  it("requires cleaner authorization before any saved-note read", async () => {
    await expect(cleanerPortalReadOnlyRouter.createCaller({}).getMyJobsToday()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(mocks.list).not.toHaveBeenCalled();
    expect(selections).toEqual([]);
  });
  it.each(procedures)("%s batches imported staff notes by exact stable ID and exposes the actual service without changing native notes", async procedure => {
    rows.push({ job: operational({ id: 702, bookingId: null, origin: "launch27_import", launch27BookingId: 502, customerNotes: "Imported customer instructions" }), progress: null, payPercent: "0.5" });
    rows.push({ job: operational({ id: 703, bookingId: null, origin: "launch27_import", launch27BookingId: 503 }), progress: null, payPercent: "0.5" });
    visitNotes = [{ launch27BookingId: 502, staffNotes: "Exact visit staff note" }, { launch27BookingId: 503, staffNotes: "Other owned visit note" }, { launch27BookingId: 999, staffNotes: "Unowned household note" }];
    const before = structuredClone(rows);
    const result = await caller()[procedure]();
    expect(result[0]).toMatchObject({ serviceName: "Hourly Cleaning", customerNotes: "Ring the bell\nDog stays upstairs\nUse the side entrance", staffNotes: null });
    expect(result[1]).toMatchObject({ serviceName: "Hourly Cleaning", customerNotes: "Imported customer instructions", staffNotes: "Exact visit staff note", basePay: 80 });
    expect(result[2].staffNotes).toBe("Other owned visit note");
    expect(selections.filter(query => query.table === "visitNotes")).toEqual([{ table: "visitNotes", fields: ["launch27BookingId", "staffNotes"], values: [502, 503] }]);
    expect(JSON.stringify(result)).not.toContain("Unowned household note");
    expect(rows).toEqual(before);
    visitNotes[0].staffNotes = null;
    expect((await caller()[procedure]())[1].staffNotes).toBeNull();
  });
  it("does not add any staff-note query to range payout or earnings", async () => {
    rows = [{ job: operational({ bookingId: null, origin: "launch27_import", launch27BookingId: 502 }), progress: null, payPercent: "0.5" }];
    await caller().myJobsRange({ from: "2026-11-13", to: "2026-11-20" });
    await caller().getMyEarnings();
    expect(selections.some(query => query.table === "visitNotes")).toBe(false);
  });
  it.each(procedures)("%s reads added, replaced and cleared saved extras without changing payout or job progress", async procedure => {
    const before = structuredClone(rows);
    for (const ids of [["inside-oven"], ["inside-fridge", "carpet-cleaning"], []]) {
      canonical[0].extras = ids.map(id => ({ id, label: id, quantity: 1, unitPriceCents: 3000, totalCents: 3000 }));
      const result = await caller()[procedure]();
      expect(result[0].extras).toEqual(ids);
      expect(result[0]).toMatchObject({ portalJobKey: "leadflow:701", basePay: 80, jobStatus: "in_progress", time: "12:30 PM", address: "701 Test Street" });
    }
    expect(rows).toEqual(before);
  });
});
