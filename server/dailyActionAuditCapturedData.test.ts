import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { drizzle } from "drizzle-orm/mysql2";
import { readFileSync } from "node:fs";
import type { AuditCandidate, AuditThread } from "../shared/dailyActionAudit";

const mocks = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("./db", () => ({ getDb: mocks.getDb }));
import { readLeadFlowAuditDay, readLeadFlowAuditRecords } from "./dailyActionAuditData";

type Row = Record<string, any>;
const PHONE = "+17035551234";
const OTHER = "+12025551234";
const AT = "2026-11-11T16:00:00.000Z";
const START = Date.parse("2026-11-11T05:00:00Z");
const END = Date.parse("2026-11-12T05:00:00Z");
const input = { auditDate: "2026-11-11", timeZone: "America/New_York", asOf: "2026-11-13T18:00:00.000Z" };
const envelope = (text: string, ts: unknown = AT, extra: Row = {}) => ({ role: "user", content: text, ts, ...extra });
function session(id: number, history: unknown = [envelope(`request ${id}`)], leadPhone = PHONE, leadName: string | null = "Customer"): Row {
  return { id, leadPhone, leadName, messageHistory: typeof history === "string" ? history : JSON.stringify(history), updatedAt: new Date(input.asOf) };
}
function intake(id: number, fromPhone = PHONE, message = `intake ${id}`, openPhoneMessageId: string | null = null, receivedAt = Date.parse(AT)): Row {
  return { id, fromPhone, toPhone: OTHER, message, openPhoneMessageId, receivedAt };
}
function booking(id: number, customerPhone = PHONE): Row {
  return { id, customerPhone, customerName: "Customer", publicBookingNumber: `LF-${id}`, requestedLocalDate: "2026-11-20", requestedLocalTime: "09:00", requestedTimeZone: "America/New_York", status: "confirmed", address: "Address", serviceName: "Standard", extras: "[]", recurrence: "one-time", paymentStatus: "unpaid" };
}
function job(id: number, customerPhone = PHONE, bookingId: number | null = null): Row {
  return { id, customerPhone, customerName: "Customer", bookingId, bookingSeriesId: null, jobDate: "2026-11-20", serviceDateTime: "2026-11-20T14:00:00Z", bookingStatus: "confirmed", jobAddress: "Address", serviceName: "Standard", extras: "[]", teamName: "Team", frequency: "one-time" };
}
function scope(customerPhone = PHONE, key = "person") {
  const thread: AuditThread = { key, customerPhone, customerName: "Customer", messages: [], truncated: false };
  const candidate: AuditCandidate = { id: `${key}-candidate`, threadKey: key, action: "reschedule", agreement: "requested", anchorMessageKey: "anchor", evidenceKeys: ["anchor"], explanation: "Request", confidence: 1, supersededByMessageKey: null, ambiguous: false,
    expected: { bookingReference: null, date: "2026-11-20", originalDate: null, time: null, timeKind: "unspecified", windowEnd: null, scope: "visit", address: null, serviceName: null, extras: null, teamName: null, amountCents: null } };
  return { thread, candidate };
}

/** Actual installed Drizzle emits and maps every SELECT. Only mysql2 transport is
 * in memory: no network-capable connection, provider, model or database writer.
 * This evaluator accepts just this reader's emitted predicates, not general SQL.
 */
function offlineDb(initial: Record<string, Row[]> = {}) {
  const state: Record<string, Row[]> = { conversation_sessions: [], inbound_sms: [], bookings: [], leadflow_jobs: [], booking_assignments: [], booking_payment_profiles: [], ...structuredClone(initial) };
  const statements: Array<{ sql: string; params: unknown[]; timeout?: number }> = [];
  const release = vi.fn(); const destroy = vi.fn();
  const query = vi.fn(async (options: string | { sql: string; timeout?: number }, values: unknown[] = []) => {
    const querySql = typeof options === "string" ? options : options.sql;
    statements.push({ sql: querySql, params: values, timeout: typeof options === "string" ? undefined : options.timeout });
    if (!/^select /i.test(querySql)) {
      if (!/^(set transaction isolation level repeatable read|begin|commit|rollback)$/i.test(querySql)) throw new Error("Non-reader SQL attempted");
      return [{ affectedRows: 0 }, []];
    }
    const match = /^select (.+) from `([^`]+)`(?: where (.+?))? order by `[^`]+`\.`([^`]+)` asc limit \?$/i.exec(querySql);
    if (!match) throw new Error(`Unexpected emitted SQL: ${querySql}`);
    const [, selected, table, where = "", ordering] = match;
    if (!(table in state)) throw new Error("Unexpected table");
    const prefix = (selected.match(/\?/g) ?? []).length;
    const parameters = values.slice(prefix, -1);
    let index = 0;
    const predicates: Array<(row: Row) => boolean> = [];
    const terms = /regexp_replace\(`[^`]+`\.`([^`]+)`, '\[\^0-9\]', ''\) in \(([^)]+)\)|`[^`]+`\.`([^`]+)` (in \(([^)]+)\)|>=|<=|>|<|=|is null)(?: (\?))?/g;
    for (const term of where.matchAll(terms)) {
      if (term[1]) {
        const count = (term[2].match(/\?/g) ?? []).length;
        const targets = parameters.slice(index, index += count);
        predicates.push(row => typeof row[term[1]] === "string" && targets.includes(row[term[1]].replace(/[^0-9]/g, "")));
      } else {
        const field = term[3]; const operator = term[4];
        if (operator.startsWith("in")) {
          const count = (term[5].match(/\?/g) ?? []).length;
          const targets = parameters.slice(index, index += count);
          predicates.push(row => targets.includes(row[field]));
        } else if (operator === "is null") predicates.push(row => row[field] == null);
        else {
          const target = parameters[index++];
          const comparable = (value: any) => value instanceof Date ? value.getTime() : typeof value === "string" && /^\d{4}-\d{2}-\d{2} /.test(value) ? Date.parse(value.replace(" ", "T") + "Z") : value;
          predicates.push(row => {
            const left = comparable(row[field]); const right = comparable(target);
            return operator === ">=" ? left >= right : operator === "<=" ? left <= right : operator === ">" ? left > right : operator === "<" ? left < right : left === right;
          });
        }
      }
    }
    const any = where.includes(" or ");
    const rows = state[table].filter(row => !predicates.length || (any ? predicates.some(test => test(row)) : predicates.every(test => test(row))))
      .sort((a, b) => a[ordering] - b[ordering]).slice(0, Number(values.at(-1)));
    return [rows.map(row => selected.split(", ").map(expression => {
      if (expression.startsWith("case when")) {
        const field = /octet_length\((?:`[^`]+`\.)?`([^`]+)`\)/.exec(expression)?.[1]!;
        return typeof row[field] === "string" && Buffer.byteLength(row[field], "utf8") <= Number(values[0]) ? row[field] : null;
      }
      const field = [...expression.matchAll(/`([^`]+)`/g)].at(-1)?.[1];
      return field ? row[field] ?? null : null;
    })), []];
  });
  const connection = { query, release, destroy };
  const pool = { getConnection: vi.fn(async () => connection), query: vi.fn(() => { throw new Error("Read outside snapshot"); }) };
  return { db: drizzle(pool as any), pool, connection, query, release, destroy, state, statements };
}

beforeEach(() => { mocks.getDb.mockReset(); mocks.getDb.mockResolvedValue(null); });
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("readLeadFlowAuditDay captured aggregation", () => {
  it("aggregates beyond ten sessions and twenty inbound before returning on one snapshot", async () => {
    const mock = offlineDb({ conversation_sessions: Array.from({ length: 25 }, (_, i) => session(i + 1)), inbound_sms: Array.from({ length: 43 }, (_, i) => intake(i + 1)) });
    const before = structuredClone(mock.state);
    const result = await readLeadFlowAuditDay(input, mock.db);
    expect(result.threads).toHaveLength(1);
    expect(result.threads[0].messages).toHaveLength(68);
    expect(result.threads[0].messages.map(message => message.text)).toContain("request 25");
    expect(result.threads[0].messages.map(message => message.text)).toContain("intake 43");
    expect(result.localSource).toEqual({ status: "captured", sessionsRead: 25, inboundRead: 43, messagesRead: 68, threadsRead: 1, providerRequests: 0 });
    expect(result.coverage).toMatchObject({ status: "partial", truncated: false });
    expect(mock.pool.getConnection).toHaveBeenCalledTimes(1);
    expect(mock.pool.query).not.toHaveBeenCalled();
    expect(mock.release).toHaveBeenCalledTimes(1);
    expect(mock.statements.at(-1)?.sql).toBe("COMMIT");
    const candidate = mock.statements.filter(value => value.sql.includes("from `conversation_sessions`") && value.sql.includes("updatedAt"));
    expect(candidate.map(value => value.params.at(-2))).toEqual([0, 10, 20]);
    expect(candidate.every(value => value.sql.includes("`id` > ?") && value.params.at(-1) === 11)).toBe(true);
    expect(mock.statements.filter(value => value.sql.startsWith("select")).every(value => value.timeout! > 0 && value.timeout! <= 2000)).toBe(true);
    expect(mock.state).toEqual(before);
    expect(mocks.getDb).not.toHaveBeenCalled();
  });
  it("merges prior/later exact-phone context across pages without outside-day personas", async () => {
    const older = session(100, [envelope("earlier", START - 1000), envelope("too early", START - 86_400_001)], "(703) 555-1234");
    older.updatedAt = new Date("2026-11-10T12:00:00Z");
    const irrelevant = session(101, [envelope("unrelated later", END + 1000)], OTHER);
    const sessions = Array.from({ length: 12 }, (_, i) => session(i + 1));
    sessions[11] = session(12, [envelope("later correction", END + 1000, { role: "assistant", opMsgId: "later" }), envelope("after asOf", Date.parse(input.asOf) + 1)]);
    const result = await readLeadFlowAuditDay(input, offlineDb({ conversation_sessions: [...sessions, older, irrelevant] }).db);
    expect(result.threads).toHaveLength(1);
    expect(result.threads[0].customerPhone).toBe(PHONE);
    const texts = result.threads[0].messages.map(message => message.text);
    expect(texts).toContain("earlier"); expect(texts).toContain("later correction");
    expect(texts).not.toContain("unrelated later"); expect(texts).not.toContain("too early"); expect(texts).not.toContain("after asOf");
    expect(result.threads[0].messages.find(message => message.text === "later correction")).toMatchObject({ timeBasis: "history", delivery: "unknown" });
  });
  it("deduplicates only equivalent same-phone/direction IDs and retains conflicting variants", async () => {
    const mock = offlineDb({ conversation_sessions: [session(1, [envelope("same", AT, { opMsgId: "id" }), envelope("equal without id"), envelope("equal without id")]), session(12, [envelope("same", AT, { openPhoneId: "id" }), envelope("different", AT, { opMsgId: "id" }), envelope("same", AT, { role: "assistant", opMsgId: "id", status: "sent" })]), session(13, [envelope("same", AT, { opMsgId: "id" })], OTHER)], inbound_sms: [intake(1, PHONE, "same", "id")] });
    const result = await readLeadFlowAuditDay(input, mock.db);
    const person = result.threads.find(thread => thread.customerPhone === PHONE)!;
    expect(person.messages).toHaveLength(5);
    expect(person.messages.filter(message => message.text === "equal without id")).toHaveLength(2);
    expect(person.truncated).toBe(true);
    expect(result.coverage.warnings.join(" ")).toContain("Conflicting captured provider ID");
    expect(new Set(person.messages.map(message => message.key)).size).toBe(5);
    expect(result.threads.find(thread => thread.customerPhone === OTHER)?.messages).toHaveLength(1);
    expect(person.messages.some(message => message.timeBasis === "provider" || message.delivery === "sent")).toBe(false);
  });
  it("does not silently merge cross-day provider ID variants", async () => {
    const mock = offlineDb({ conversation_sessions: [session(1, [envelope("same", AT, { opMsgId: "id" }), envelope("same", END + 1000, { opMsgId: "id" })])] });
    const result = await readLeadFlowAuditDay(input, mock.db);
    expect(result.threads[0].messages).toHaveLength(2);
    expect(result.threads[0].truncated).toBe(true);
  });
  it("does not let a null-line history mirror hide conflicting known business lines", async () => {
    const first = intake(1, PHONE, "same", "id");
    const second = { ...intake(2, PHONE, "same", "id"), toPhone: "+13015551234" };
    const mock = offlineDb({ conversation_sessions: [session(1, [envelope("same", AT, { opMsgId: "id" })])], inbound_sms: [first, second] });
    const result = await readLeadFlowAuditDay(input, mock.db);
    expect(result.threads[0].truncated).toBe(true);
    expect(result.coverage.warnings.join(" ")).toContain("Conflicting captured provider ID");
  });
  it("leaves conflicting nonempty names unknown, and never guesses invalid identities", async () => {
    const mock = offlineDb({ conversation_sessions: [session(1, undefined, PHONE, "First"), session(2, undefined, "703-555-1234", "Second"), session(3, undefined, "+447911123456"), session(4, undefined, "customer 7035551234")], inbound_sms: [intake(1, "1234567890")] });
    const result = await readLeadFlowAuditDay(input, mock.db);
    expect(result.threads).toHaveLength(1);
    expect(result.threads[0]).toMatchObject({ customerName: null, truncated: true });
    expect(result.coverage.warnings.join(" ")).toContain("Multiple captured names");
    expect(result.coverage.warnings.join(" ")).not.toContain(PHONE);
  });
  it("includes orphan intake on selected-day observed time, with no invented occurredAt", async () => {
    const mock = offlineDb({ inbound_sms: [intake(1), intake(2, PHONE, "before", null, START - 1), intake(3, PHONE, "after", null, END)] });
    const result = await readLeadFlowAuditDay(input, mock.db);
    expect(result.threads[0]).toMatchObject({ customerName: null, messages: [{ key: "inbound:1", sessionId: null, source: "inbound_sms", timeBasis: "received", occurredAt: null, observedAt: AT }] });
  });
  it("warns on empty/malformed timestamps and SQL-size-capped histories without guessing", async () => {
    const mock = offlineDb({ conversation_sessions: [session(1, [envelope("empty", ""), { role: "user", content: "unknown" }, envelope("local", "2026-11-11T10:00:00"), envelope("impossible", "2026-02-30T12:00:00Z")]), session(2, "not-json"), session(3, "界".repeat(34000))] });
    const result = await readLeadFlowAuditDay(input, mock.db);
    expect(result.threads[0]).toMatchObject({ truncated: true, messages: [] });
    expect(result.localSource.status).toBe("partial");
    expect(result.coverage.warnings.join(" ")).toContain("no date fabricated");
    expect(result.coverage.warnings.join(" ")).toContain("SQL-size-capped");
  });
  it("does not apply a global 16k text clip or damage unrelated people", async () => {
    const phones = [PHONE, OTHER, "+13015551234"];
    const mock = offlineDb({ conversation_sessions: phones.map((value, i) => session(i + 1, [envelope("x".repeat(9000))], value)) });
    const result = await readLeadFlowAuditDay(input, mock.db);
    expect(result.threads.flatMap(thread => thread.messages).reduce((sum, message) => sum + message.text.length, 0)).toBe(27000);
    expect(result.threads.every(thread => !thread.truncated)).toBe(true);
  });
  it("prioritizes selected-day anchors over excess context and does not clip text", async () => {
    const mock = offlineDb({ conversation_sessions: [session(1, [envelope("anchor"), ...Array.from({ length: 121 }, (_, i) => envelope(`later ${i}`, END + i * 1000))]), session(2, [envelope("unaffected")], OTHER)] });
    const result = await readLeadFlowAuditDay(input, mock.db);
    const person = result.threads.find(thread => thread.customerPhone === PHONE)!;
    expect(person.messages).toHaveLength(120); expect(person.messages[0].text).toBe("anchor"); expect(person.truncated).toBe(true);
    expect(result.threads.find(thread => thread.customerPhone === OTHER)?.truncated).toBe(false);
  });
  it("bounds session rows but still independently includes orphan inbound", async () => {
    const mock = offlineDb({ conversation_sessions: Array.from({ length: 1001 }, (_, i) => session(i + 1, [])), inbound_sms: [intake(1, OTHER)] });
    const result = await readLeadFlowAuditDay(input, mock.db);
    expect(result.localSource.sessionsRead).toBe(1000);
    expect(result.localSource.inboundRead).toBe(1);
    expect(result.localSource.status).toBe("partial");
    expect(result.threads[0]).toMatchObject({ customerPhone: OTHER, truncated: true });
    expect(result.coverage.warnings.join(" ")).toContain("session row cap");
  });
  it("bounds inbound rows with an unconsumed sentinel", async () => {
    const mock = offlineDb({ inbound_sms: Array.from({ length: 2001 }, (_, i) => intake(i + 1)) });
    const result = await readLeadFlowAuditDay(input, mock.db);
    expect(result.localSource.inboundRead).toBe(2000);
    expect(result.coverage.warnings.join(" ")).toContain("inbound row cap");
    expect(result.localSource.status).toBe("partial");
    expect(mock.statements.filter(value => value.sql.includes("from `inbound_sms`"))).toHaveLength(100);
  });
  it("bounds total admitted UTF-8 row bytes without a global all-thread text clip", async () => {
    const mock = offlineDb({ conversation_sessions: Array.from({ length: 60 }, (_, i) => session(i + 1, [envelope("界".repeat(30000))])) });
    const result = await readLeadFlowAuditDay(input, mock.db);
    expect(result.localSource.sessionsRead).toBeLessThan(60);
    expect(result.coverage.warnings.join(" ")).toContain("row-byte budget");
    expect(result.threads[0].messages.every(message => message.text.length === 30000)).toBe(true);
    expect(result.localSource.status).toBe("partial");
  });
  it("stops at a fixed elapsed scan budget and closes the lease", async () => {
    const mock = offlineDb({ conversation_sessions: Array.from({ length: 50 }, (_, i) => session(i + 1)) });
    let now = 1000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const original = mock.query.getMockImplementation()!;
    mock.query.mockImplementation(async (options, values) => { const result = await original(options, values); if ((typeof options === "string" ? options : options.sql).startsWith("select")) now += 3500; return result; });
    const result = await readLeadFlowAuditDay(input, mock.db);
    expect(result.localSource.sessionsRead).toBeLessThan(50);
    expect(result.coverage.warnings.join(" ")).toContain("time budget");
    expect(mock.release).toHaveBeenCalledTimes(1);
    expect(mock.statements.at(-1)?.sql).toBe("COMMIT");
  });
  it("destroys a timed-out SELECT connection rather than leaving an indefinite lease", async () => {
    vi.useFakeTimers();
    const mock = offlineDb(); const original = mock.query.getMockImplementation()!;
    mock.query.mockImplementation(async (options, values) => (typeof options === "string" ? options : options.sql).startsWith("select") ? new Promise(() => {}) : original(options, values));
    const read = readLeadFlowAuditDay(input, mock.db);
    const rejected = expect(read).rejects.toMatchObject({ reason: "DB_TIMEOUT" });
    await vi.advanceTimersByTimeAsync(2100);
    await rejected;
    expect(mock.destroy).toHaveBeenCalledTimes(1);
    expect(mock.release).not.toHaveBeenCalled();
  });
  it("disposes a connection that arrives after the acquisition deadline", async () => {
    vi.useFakeTimers();
    const mock = offlineDb();
    let resolve: (value: typeof mock.connection) => void = () => {};
    mock.pool.getConnection.mockImplementation(() => new Promise(done => { resolve = done; }));
    const read = readLeadFlowAuditDay(input, mock.db);
    const rejected = expect(read).rejects.toMatchObject({ reason: "DB_TIMEOUT" });
    await vi.advanceTimersByTimeAsync(2100); await rejected;
    resolve(mock.connection); await vi.advanceTimersByTimeAsync(0);
    expect(mock.destroy).toHaveBeenCalledTimes(1); expect(mock.query).not.toHaveBeenCalled();
  });
  it("rejects invalid date/timezone/asOf before leasing a connection", async () => {
    const mock = offlineDb();
    await expect(readLeadFlowAuditDay({ ...input, auditDate: "2026-02-30" }, mock.db)).rejects.toThrow("Invalid audit date");
    await expect(readLeadFlowAuditDay({ ...input, timeZone: "Unknown/Zone" }, mock.db)).rejects.toThrow("timezone");
    await expect(readLeadFlowAuditDay({ ...input, asOf: "2026-11-13T12:00:00" }, mock.db)).rejects.toThrow("asOf");
    expect(mock.pool.getConnection).not.toHaveBeenCalled();
  });
  it("empty capture remains partial provider coverage and performs no network or model work", async () => {
    const network = vi.fn(() => { throw new Error("Network forbidden"); }); vi.stubGlobal("fetch", network);
    const mock = offlineDb(); const result = await readLeadFlowAuditDay(input, mock.db);
    expect(result).toMatchObject({ threads: [], localSource: { status: "captured", providerRequests: 0 }, coverage: { status: "partial" } });
    expect(result.coverage.warnings.join(" ")).toContain("not proof of absence");
    expect(network).not.toHaveBeenCalled();
    const source = readFileSync(new URL("./dailyActionAuditData.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/\b(fetch|sendSMS|sendEmail|JSON_SEARCH|invokeLLM)\s*\(/);
    expect(source).not.toMatch(/\b(?:db|reader|connection)\.(insert|update|delete|execute)\s*\(/);
    expect(mock.statements.filter(value => value.sql.startsWith("select")).every(value => !/offset|json_search|customerName.*like/i.test(value.sql))).toBe(true);
  });
});

describe("readLeadFlowAuditRecords per-customer independence", () => {
  it("does no pre-extraction/all-person scan when candidates are empty or context-only", async () => {
    const person = scope(); const mock = offlineDb({ bookings: [booking(1)] });
    expect(await readLeadFlowAuditRecords({ threads: [person.thread], candidates: [] }, mock.db)).toEqual({ records: [], warnings: [], truncated: false, incompleteThreadKeys: [] });
    await readLeadFlowAuditRecords({ threads: [person.thread], candidates: [{ ...person.candidate, contextOnly: true }] }, mock.db);
    expect(mock.pool.getConnection).not.toHaveBeenCalled();
  });
  it("scopes each actionable customer independently so one record cap cannot disable another", async () => {
    const first = scope(); const second = scope(OTHER, "second");
    const mock = offlineDb({ bookings: [...Array.from({ length: 1002 }, (_, i) => booking(i + 1)), booking(2000, OTHER)] });
    const result = await readLeadFlowAuditRecords({ threads: [first.thread, second.thread], candidates: [first.candidate, second.candidate] }, mock.db);
    expect(result.incompleteThreadKeys).toEqual([first.thread.key]);
    expect(result.records.some(record => record.bookingId === 2000)).toBe(true);
    expect(result.records).toHaveLength(1001);
    expect(mock.pool.getConnection).toHaveBeenCalledTimes(2);
    const selects = mock.statements.filter(value => value.sql.includes("from `bookings`"));
    expect(selects.map(value => value.params)).toEqual([["7035551234", "17035551234", 1001], ["2025551234", "12025551234", 1001]]);
  });
  it("catches a safe read failure per customer, preserving another person's records", async () => {
    const first = scope(); const second = scope(OTHER, "second");
    const mock = offlineDb({ bookings: [booking(1), booking(2, OTHER)] });
    const original = mock.query.getMockImplementation()!;
    mock.query.mockImplementation(async (options, values) => {
      if ((typeof options === "string" ? options : options.sql).includes("from `bookings`") && values?.includes("7035551234")) throw Object.assign(new Error(`sensitive ${PHONE}`), { code: "ER_QUERY_TIMEOUT" });
      return original(options, values);
    });
    const result = await readLeadFlowAuditRecords({ threads: [first.thread, second.thread], candidates: [first.candidate, second.candidate] }, mock.db);
    expect(result.records.map(record => record.bookingId)).toEqual([2]);
    expect(result.incompleteThreadKeys).toEqual([first.thread.key]);
    expect(result.warnings.join(" ")).toContain("DB_TIMEOUT");
    expect(result.warnings.join(" ")).not.toContain(PHONE);
    expect(result.warnings.join(" ")).toContain("unknown, not evidence of absence");
    expect(mock.release).toHaveBeenCalledTimes(2);
  });
  it("stops new customer acquisitions at the aggregate deadline and preserves completed records", async () => {
    vi.useFakeTimers();
    const start = Date.now();
    const first = scope(); const second = scope(OTHER, "second"); const third = scope("+13015551234", "third");
    const mock = offlineDb({ bookings: [booking(1), booking(2, OTHER), booking(3, third.thread.customerPhone)] });
    const original = mock.query.getMockImplementation()!;
    mock.query.mockImplementation(async (options, values) => {
      const result = await original(options, values);
      if ((typeof options === "string" ? options : options.sql) === "COMMIT") vi.setSystemTime(start + 25_001);
      return result;
    });
    const result = await readLeadFlowAuditRecords({ threads: [first.thread, second.thread, third.thread], candidates: [first.candidate, second.candidate, third.candidate] }, mock.db);
    expect(result.records.map(record => record.bookingId)).toEqual([1]);
    expect(result.incompleteThreadKeys).toEqual([second.thread.key, third.thread.key]);
    expect(result.truncated).toBe(true);
    expect(result.warnings.join(" ")).toContain("budget exhausted");
    expect(result.warnings.join(" ")).toContain("summaries are retained");
    expect(mock.pool.getConnection).toHaveBeenCalledTimes(1);
    expect(mock.release).toHaveBeenCalledTimes(1);
    expect(mock.statements.some(statement => statement.params.includes("2025551234"))).toBe(false);
  });
  it("caps an already-started customer to aggregate remaining time and destroys its expired lease", async () => {
    vi.useFakeTimers();
    const start = Date.now();
    const first = scope(); const second = scope(OTHER, "second"); const third = scope("+13015551234", "third");
    const mock = offlineDb({ bookings: [booking(1), booking(2, OTHER), booking(3, third.thread.customerPhone)] });
    let acquisitions = 0;
    mock.pool.getConnection.mockImplementation(async () => {
      acquisitions++;
      return mock.connection;
    });
    const original = mock.query.getMockImplementation()!;
    let stalledTimeout: number | undefined;
    mock.query.mockImplementation(async (options, values) => {
      if ((typeof options === "string" ? options : options.sql).includes("from `bookings`") && values?.includes("2025551234")) {
        stalledTimeout = typeof options === "string" ? undefined : options.timeout;
        return new Promise(() => {});
      }
      const result = await original(options, values);
      if (acquisitions === 1 && (typeof options === "string" ? options : options.sql) === "COMMIT") vi.setSystemTime(start + 24_500);
      return result;
    });
    const read = readLeadFlowAuditRecords({ threads: [first.thread, second.thread, third.thread], candidates: [first.candidate, second.candidate, third.candidate] }, mock.db);
    await vi.advanceTimersByTimeAsync(0);
    expect(acquisitions).toBe(2);
    await vi.advanceTimersByTimeAsync(501);
    const result = await read;
    expect(result.records.map(record => record.bookingId)).toEqual([1]);
    expect(result.incompleteThreadKeys).toEqual([second.thread.key, third.thread.key]);
    expect(mock.destroy).toHaveBeenCalledTimes(1);
    expect(mock.release).toHaveBeenCalledTimes(1);
    expect(mock.pool.getConnection).toHaveBeenCalledTimes(2);
    expect(stalledTimeout).toBe(500);
    expect(result.warnings.join(" ")).toContain("DB_TIMEOUT");
  });
  it("keeps all linked counterpart identity conflicts visible", async () => {
    const person = scope(); const mock = offlineDb({ bookings: [booking(99, OTHER)], leadflow_jobs: [job(1, PHONE, 99)] });
    const result = await readLeadFlowAuditRecords({ threads: [person.thread], candidates: [person.candidate] }, mock.db);
    expect(result.records.map(record => record.customerPhone)).toEqual([OTHER, PHONE]);
    expect(result.warnings.join(" ")).toContain("different exact customer phone");
  });
  it("marks only the customer whose linked canonical counterpart is missing incomplete", async () => {
    const first = scope(); const second = scope(OTHER, "second");
    const mock = offlineDb({ bookings: [booking(2, OTHER)], leadflow_jobs: [job(1, PHONE, 99)] });
    const result = await readLeadFlowAuditRecords({ threads: [first.thread, second.thread], candidates: [first.candidate, second.candidate] }, mock.db);
    expect(result.incompleteThreadKeys).toEqual([first.thread.key]);
    expect(result.records.some(record => record.bookingId === 2)).toBe(true);
  });
  it("marks missing/ambiguous candidate identities incomplete without any inferred lookup", async () => {
    const person = scope(); const mock = offlineDb();
    const result = await readLeadFlowAuditRecords({ threads: [], candidates: [person.candidate] }, mock.db);
    expect(result.incompleteThreadKeys).toEqual([person.thread.key]); expect(mock.pool.getConnection).not.toHaveBeenCalled();
    const ambiguous = await readLeadFlowAuditRecords({ threads: [person.thread, { ...person.thread, customerPhone: OTHER }], candidates: [person.candidate] }, mock.db);
    expect(ambiguous.truncated).toBe(true); expect(mock.pool.getConnection).not.toHaveBeenCalled();
  });
});
