import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { getTableName } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { bookingAssignments, bookingFunnelRecords, bookings, cleanerPortalJobProgress, customerPortalAccounts, leadflowJobs } from "../../drizzle/schema";

const mocks = vi.hoisted(() => ({ getDb: vi.fn(), sendSms: vi.fn(), notifyOwner: vi.fn(), invokeLLM: vi.fn() }));
vi.mock("../db", () => ({ getDb: mocks.getDb }));
vi.mock("../openphone", () => ({ sendSms: mocks.sendSms }));
vi.mock("../_core/notification", () => ({ notifyOwner: mocks.notifyOwner }));
vi.mock("../_core/llm", () => ({ invokeLLM: mocks.invokeLLM }));
vi.mock("../_core/env", () => ({ ENV: {} }));
vi.mock("../knowledgeBase", () => ({ MAIDS_IN_BLACK_KNOWLEDGE_BASE: "offline" }));
vi.mock("../engine/pricing", () => ({ calculatePrice: vi.fn(), SERVICE_MULTIPLIERS: {} }));
vi.mock("./callBookingQuote", () => ({ buildCallBookingQuoteToolDefinitions: vi.fn(), callBookingQuoteServerToken: vi.fn(), withCallBookingQuoteInstructions: vi.fn() }));
import { lookupVoiceCustomerBookingContext, readVoiceCustomerBookingContext } from "./voiceCustomerBookingLookup";
import { handleLookupCustomer } from "../vapiService";

const phone = "+13015550123";
const now = new Date("2026-11-17T17:00:00Z");
const names = {
  jobs: getTableName(leadflowJobs), native: getTableName(bookings), accounts: getTableName(customerPortalAccounts),
  funnel: getTableName(bookingFunnelRecords), assignments: getTableName(bookingAssignments), progress: getTableName(cleanerPortalJobProgress),
};
const dialect = new MySqlDialect();
type Rows = Record<string, Array<Record<string, any>>>;
function job(overrides: Record<string, any> = {}) {
  return { id: 1, bookingId: null, customerName: "Synthetic Jane", customerPhone: phone, date: "2026-10-31", serviceDateTime: null,
    serviceName: "Standard Cleaning", address: "123 Synthetic Street", teamName: "Old Team", status: "assigned",
    missingFromSourceAt: null, progressStatus: null, etaTimeStr: null, etaTimestamp: null, ...overrides };
}
function native(overrides: Record<string, any> = {}) {
  return { id: 71, customerName: "Synthetic Jane", customerPhone: phone, date: "2026-11-18", localTime: "09:00",
    timeZone: "America/New_York", startAt: Date.parse("2026-11-18T14:00:00Z"), serviceName: "Native Standard", address: "456 Synthetic Street",
    status: "confirmed", ...overrides };
}

/** Synthetic SELECT rows use the adapter's actual aliases, not a router or a database connection. */
function storage(rows: Rows = {}, failTable?: string) {
  const queries: Array<{ table: string; fields: string[]; where?: ReturnType<MySqlDialect["sqlToQuery"]>; order: string[]; joins: string[] }> = [];
  const forbidden = () => { throw new Error("Writes and row limits are forbidden in booking lookup"); };
  const db: any = { insert: vi.fn(forbidden), update: vi.fn(forbidden), delete: vi.fn(forbidden) };
  db.select = vi.fn((projection: Record<string, any>) => ({
    from(table: any) {
      const name = getTableName(table);
      expect([names.jobs, names.native, names.accounts, names.funnel, names.assignments]).toContain(name);
      const query = { table: name, fields: Object.keys(projection), order: [] as string[], joins: [] as string[], where: undefined as ReturnType<MySqlDialect["sqlToQuery"]> | undefined };
      queries.push(query);
      const chain: any = {
        leftJoin(joined: any, on: any) { expect(name).toBe(names.jobs); expect(getTableName(joined)).toBe(names.progress); query.joins.push(getTableName(joined)); expect(dialect.sqlToQuery(on).sql).toContain("leadflowJobId"); return chain; },
        where(condition: any) { query.where = dialect.sqlToQuery(condition); return chain; },
        orderBy(...conditions: any[]) { query.order = conditions.map(value => dialect.sqlToQuery(value).sql); return chain; },
        limit: vi.fn(forbidden), insert: vi.fn(forbidden), update: vi.fn(forbidden), delete: vi.fn(forbidden),
        then(resolve: any, reject: any) {
          return Promise.resolve().then(() => {
            if (name === failTable) throw new Error("synthetic SELECT failure");
            let selected = rows[name] ?? [];
            if (name === names.assignments) {
              const params = query.where!.params;
              expect(params.at(-1)).toBe("assigned");
              const ids = params.slice(0, -1);
              selected = selected.filter(row => ids.includes(row.bookingId) && row.status === "assigned")
                .sort((a, b) => b.assignedAt - a.assignedAt || b.id - a.id);
            }
            // Other tables intentionally ignore WHERE: the pure projection must still reject foreign phones.
            return selected.map(row => Object.fromEntries(query.fields.map(key => [key, row[key]])));
          }).then(resolve, reject);
        },
      };
      return chain;
    },
  }));
  return { db, queries };
}
function assertReadOnly(h: ReturnType<typeof storage>) {
  for (const method of ["insert", "update", "delete"]) expect(h.db[method]).not.toHaveBeenCalled();
  expect(mocks.sendSms).not.toHaveBeenCalled();
  expect(mocks.notifyOwner).not.toHaveBeenCalled();
  expect(mocks.invokeLLM).not.toHaveBeenCalled();
}
beforeEach(() => { vi.clearAllMocks(); vi.useFakeTimers(); vi.setSystemTime(now); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe("voice customer booking SELECT adapter — offline", () => {
  it("recognizes an October 31 assigned-only customer without turning history into a November 17 appointment", async () => {
    const h = storage({ [names.jobs]: [job()] });
    const result = await readVoiceCustomerBookingContext(h.db, phone, now);
    expect(result).toMatchObject({ found: true, hasUpcomingBooking: false, upcomingBooking: null, currentLocalDate: "2026-11-17", previousBooking: { id: 1, jobDate: "2026-10-31", timing: "historical" } });
    expect(result.jobDate).toBeUndefined();
    expect(h.queries.map(q => q.table).sort()).toEqual([names.jobs, names.native, names.accounts, names.funnel].sort());
    expect(h.queries.find(q => q.table === names.jobs)!.joins).toEqual([names.progress]);
    for (const q of h.queries) expect(q.where!.params).toEqual([q.table === names.jobs ? "3015550123" : phone]);
    assertReadOnly(h);
  });
  it("finds the nearest verified future booking after more than fifty older records, without a SQL limit", async () => {
    const history = Array.from({ length: 75 }, (_, id) => job({ id: id + 1 }));
    const h = storage({ [names.jobs]: [...history, job({ id: 99, date: "2026-11-20" }), job({ id: 100, date: "2026-11-18" })] });
    const result = await readVoiceCustomerBookingContext(h.db, phone, now);
    expect(result).toMatchObject({ found: true, hasUpcomingBooking: true, upcomingBooking: { id: 100, jobDate: "2026-11-18" } });
    expect(h.queries.find(q => q.table === names.jobs)!.order).toHaveLength(3);
    assertReadOnly(h);
  });
  it("projects native confirmed schedules with their row ID and the latest active assigned team only", async () => {
    const h = storage({ [names.native]: [native()], [names.assignments]: [
      { id: 1, bookingId: 71, status: "assigned", assignedAt: 1, teamName: "Earlier Team" },
      { id: 2, bookingId: 71, status: "assigned", assignedAt: 2, teamName: "Latest Assigned Team" },
      { id: 3, bookingId: 71, status: "cancelled", assignedAt: 3, teamName: "Cancelled Team" },
      { id: 4, bookingId: 999, status: "assigned", assignedAt: 4, teamName: "Foreign Team" },
    ] });
    const result = await readVoiceCustomerBookingContext(h.db, phone, now);
    expect(result).toMatchObject({ found: true, hasUpcomingBooking: true, serviceTime: "09:00", teamName: "Latest Assigned Team", upcomingBooking: { source: "native_booking", id: 71, bookingId: 71, jobDate: "2026-11-18" } });
    const assignment = h.queries.find(q => q.table === names.assignments)!;
    expect(assignment.where!.params).toEqual([71, "assigned"]);
    expect(assignment.where!.sql).toContain(" in ");
    expect(assignment.order).toEqual(["`booking_assignments`.`assignedAt` desc", "`booking_assignments`.`id` desc"]);
    assertReadOnly(h);
  });
  it.each(["pending", "cancelled"])("does not promote native %s records or quote-only contacts into active appointments", async status => {
    const h = storage({ [names.native]: [native({ status })], [names.funnel]: [{ id: 8, customerName: "Synthetic Jane", customerPhone: phone }] });
    const result = await readVoiceCustomerBookingContext(h.db, phone, now);
    expect(result).toMatchObject({ found: true, hasUpcomingBooking: false, upcomingBooking: null });
    assertReadOnly(h);
  });
  it("recognizes account and unfinished quote contacts independently of booking existence", async () => {
    for (const table of [names.accounts, names.funnel]) {
      const h = storage({ [table]: [{ id: 8, customerName: "Synthetic Jane", customerPhone: phone }] });
      expect(await readVoiceCustomerBookingContext(h.db, phone, now)).toMatchObject({ found: true, customerName: "Synthetic Jane", hasUpcomingBooking: false, upcomingBooking: null, previousBooking: null });
      assertReadOnly(h);
    }
  });
  it("completed progress closes an imported future appointment", async () => {
    const h = storage({ [names.jobs]: [job({ date: "2026-11-18", progressStatus: "completed" })] });
    expect(await readVoiceCustomerBookingContext(h.db, phone, now)).toMatchObject({ found: true, hasUpcomingBooking: false, upcomingBooking: null });
    assertReadOnly(h);
  });
  it("rejects unrelated future records and same-name different-phone contacts even when storage ignores WHERE", async () => {
    const otherPhone = "+13015550999";
    const h = storage({ [names.jobs]: [job({ customerPhone: otherPhone, date: "2026-11-18" })],
      [names.native]: [native({ customerPhone: otherPhone })],
      [names.accounts]: [{ id: 1, customerName: "Synthetic Jane", customerPhone: otherPhone }],
      [names.funnel]: [{ id: 2, customerName: "Synthetic Jane", customerPhone: otherPhone }] });
    expect(await readVoiceCustomerBookingContext(h.db, phone, now)).toMatchObject({ found: false, hasUpcomingBooking: false, upcomingBooking: null, previousBooking: null });
    assertReadOnly(h);
  });
  it("does not leak a same-name foreign appointment onto a recognized caller", async () => {
    const h = storage({ [names.accounts]: [{ id: 1, customerName: "Synthetic Jane", customerPhone: phone }],
      [names.jobs]: [job({ customerPhone: "+13015550999", date: "2026-11-18", address: "Foreign Address" })] });
    const result = await readVoiceCustomerBookingContext(h.db, phone, now);
    expect(result).toMatchObject({ found: true, hasUpcomingBooking: false, upcomingBooking: null });
    expect(result.address).toBeUndefined();
    assertReadOnly(h);
  });
  it("invalid phone inputs never acquire a DB or execute a SELECT", async () => {
    const h = storage();
    expect(await lookupVoiceCustomerBookingContext("invalid")).toMatchObject({ lookupAvailable: false, found: false, hasUpcomingBooking: false });
    expect(await readVoiceCustomerBookingContext(h.db, "invalid", now)).toMatchObject({ found: false, hasUpcomingBooking: false });
    expect(mocks.getDb).not.toHaveBeenCalled(); expect(h.db.select).not.toHaveBeenCalled(); assertReadOnly(h);
  });
  it("DB absence returns an explicitly unavailable lookup rather than proof of no appointment", async () => {
    mocks.getDb.mockResolvedValue(null);
    const result = await lookupVoiceCustomerBookingContext(phone);
    expect(result).toMatchObject({ lookupAvailable: false, upcomingBooking: null });
    expect(result.message).toContain("does not establish whether");
    expect(result.message).not.toBe("No matching customer was found.");
  });
  it("query failure fails closed and does not expose an absence claim", async () => {
    const h = storage({}, names.native); mocks.getDb.mockResolvedValue(h.db);
    vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await lookupVoiceCustomerBookingContext(phone);
    expect(result).toMatchObject({ lookupAvailable: false, found: false, hasUpcomingBooking: false, upcomingBooking: null });
    expect(result.message).toContain("Do not treat this as confirmation"); assertReadOnly(h);
  });
  it("executes the real exported Vapi handler and delegates to this read-only lookup", async () => {
    const h = storage({ [names.native]: [native()] }); mocks.getDb.mockResolvedValue(h.db);
    expect(await handleLookupCustomer({ phone })).toMatchObject({ lookupAvailable: true, found: true, hasUpcomingBooking: true, upcomingBooking: { bookingId: 71 } });
    expect(mocks.getDb).toHaveBeenCalledTimes(1); assertReadOnly(h);
  });
  it("preserves the entire voice service against the immutable parent except the three authorized lookup blocks", () => {
    const original = execFileSync("git", ["show", "dd40d73242d004d0855022c7c96126964b1df8be:server/vapiService.ts"], { encoding: "utf8", maxBuffer: 5_000_000 });
    let candidate = readFileSync("server/vapiService.ts", "utf8");
    const blocks = [
      /(?<=## Existing customer detection[^\n]*\n)[\s\S]*?(?=## PRICING)/g,
      /(?<=        name: "lookupCustomer",\n        )description: "[^\n]*",/g,
      /\/\*\*(?:(?!\/\*\*|\*\/)[\s\S])*\*\/\nexport async function handleLookupCustomer[\s\S]*?(?=\/\*\* Handle a reschedule request)/g,
    ];
    for (const block of blocks) {
      const prior = original.match(block); expect(prior).toHaveLength(1); expect(candidate.match(block)).toHaveLength(1);
      candidate = candidate.replace(block, () => prior![0]);
    }
    expect(candidate).toBe(original);
  });
});
