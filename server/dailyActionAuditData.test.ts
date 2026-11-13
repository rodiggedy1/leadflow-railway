import { beforeEach, describe, expect, it, vi } from "vitest";
import { drizzle } from "drizzle-orm/mysql2";
import { readFileSync } from "node:fs";
import type { AuditCandidate, AuditThread } from "../shared/dailyActionAudit";

const mocks = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("./db", () => ({ getDb: mocks.getDb }));
import { auditDayWindow, businessDate, readAuditMessages, readAuditRecords } from "./dailyActionAuditData";
import { AuditSnapshotError } from "./dailyActionAuditSnapshot";

type Row = Record<string, any>;
const DAY = "2026-11-11";
const START = Date.parse("2026-11-11T05:00:00Z");
const END = Date.parse("2026-11-12T05:00:00Z");
const AT = "2026-11-11T16:00:00.000Z";
const AS_OF = "2026-11-13T18:00:00.000Z";
const PHONE = "+17035551234";
const OTHER = "+12025551234";
const input = { auditDate: DAY, timeZone: "America/New_York", asOf: AS_OF };
function session(id = 1, history: unknown = [{ role: "user", content: "Move the cleaning", ts: Date.parse(AT) }], customerPhone = PHONE): Row {
  return { id, leadPhone: customerPhone, leadName: "Test customer", messageHistory: typeof history === "string" ? history : JSON.stringify(history), updatedAt: new Date(AS_OF) };
}
function intake(id = 1, customerPhone = PHONE, at = Date.parse(AT), providerId: string | null = null): Row {
  return { id, fromPhone: customerPhone, toPhone: OTHER, message: "Please move my visit", receivedAt: at, openPhoneMessageId: providerId };
}
function booking(id = 1, customerPhone = PHONE): Row {
  return {
    id, publicBookingNumber: `LF-${id}`, customerPhone, customerName: "Test customer",
    requestedLocalDate: "2026-11-20", requestedLocalTime: "09:00", requestedTimeZone: "America/New_York",
    status: "confirmed", address: "Test address", serviceName: "Standard", extras: [{ id: "oven", label: "Oven", quantity: 1 }],
    recurrence: "one-time", paymentStatus: "captured", firstCleaningTotalCents: 19900,
  };
}
function job(id = 1, customerPhone = PHONE): Row {
  return {
    id, bookingId: null, bookingSeriesId: null, customerPhone, customerName: "Test customer", jobDate: "2026-11-20",
    serviceDateTime: "2026-11-20T14:00:00.000Z", bookingStatus: "confirmed", jobAddress: "Test address",
    serviceName: "Standard", extras: '["oven"]', teamName: "Test Team", frequency: "one-time",
    hasStripeCard: 1, jobTotalCents: 19900, origin: "launch27",
  };
}
function scope(customerPhone = PHONE) {
  const thread: AuditThread = { key: "test-thread", customerPhone, customerName: "Test customer", messages: [], truncated: false };
  const candidate: AuditCandidate = {
    id: "candidate", threadKey: thread.key, action: "reschedule", agreement: "confirmed", anchorMessageKey: "message",
    evidenceKeys: ["message"], explanation: "Test", confidence: 1, supersededByMessageKey: null, ambiguous: false,
    expected: { bookingReference: null, date: "2026-11-20", originalDate: "2026-11-19", time: "09:00", timeKind: "exact", windowEnd: null, scope: "visit", address: null, serviceName: null, extras: null, teamName: null, amountCents: null },
  };
  return { threads: [thread], candidates: [candidate] };
}

/** Real Drizzle query builder and mappers; owned snapshot uses a fake mysql2
 * transport only. This never constructs a network-capable mysql connection.
 * Evaluate just the emitted SELECT clauses used by the narrow reader, not SQL generally.
 */
function offlineDb(initial: Record<string, Row[]> = {}) {
  const state: Record<string, Row[]> = {
    conversation_sessions: [], inbound_sms: [], bookings: [], leadflow_jobs: [], booking_assignments: [], booking_payment_profiles: [], ...structuredClone(initial),
  };
  const statements: Array<{ sql: string; params: unknown[] }> = [];
  const release = vi.fn();
  const destroy = vi.fn();
  const query = vi.fn(async (options: string | { sql: string; rowsAsArray?: boolean }, values: unknown[] = []) => {
    const querySql = typeof options === "string" ? options : options.sql;
    statements.push({ sql: querySql, params: values });
    if (!/^select /i.test(querySql)) {
      if (/^start transaction read only$/i.test(querySql)) {
        throw Object.assign(new Error("TiDB rejects READ ONLY"), { code: "ERR_NOT_SUPPORTED_YET", errno: 1235 });
      }
      if (!/^(set transaction isolation level repeatable read|begin|commit|rollback)$/i.test(querySql)) throw new Error("Non-reader SQL attempted");
      return [{ affectedRows: 0 }, []];
    }
    const match = /^select (.+) from `([^`]+)`(?: where (.+?))? order by `[^`]+`\.`([^`]+)` asc limit \?$/i.exec(querySql);
    if (!match) throw new Error(`Unexpected SQL shape: ${querySql}`);
    const [, selected, table, where = "", ordering] = match;
    if (!(table in state)) throw new Error("Table outside audit boundary");
    const prefixParameters = (selected.match(/\?/g) ?? []).length;
    const whereValues = values.slice(prefixParameters, -1);
    let index = 0;
    const predicates: Array<(row: Row) => boolean> = [];
    // Preserve SQL parameter order by collecting equality/range/IN terms together.
    const terms = /regexp_replace\(`[^`]+`\.`([^`]+)`, '\[\^0-9\]', ''\) in \(([^)]+)\)|`[^`]+`\.`([^`]+)` (in \(([^)]+)\)|>=|<=|>|<|=|is null)(?: (\?))?/g;
    for (const term of where.matchAll(terms)) {
      if (term[1]) {
        const count = (term[2].match(/\?/g) ?? []).length;
        const targets = whereValues.slice(index, index += count);
        predicates.push(row => typeof row[term[1]] === "string" && targets.includes(row[term[1]].replace(/[^0-9]/g, "")));
      } else {
        const field = term[3]; const operator = term[4];
        if (operator.startsWith("in")) {
          const count = (term[5].match(/\?/g) ?? []).length;
          const targets = whereValues.slice(index, index += count);
          predicates.push(row => targets.includes(row[field]));
        } else if (operator === "is null") predicates.push(row => row[field] == null);
        else {
          const target = whereValues[index++];
          const comparable = (value: unknown) => value instanceof Date ? value.getTime() : typeof value === "string" && /^\d{4}-\d{2}-\d{2} /.test(value) ? Date.parse(value.replace(" ", "T") + "Z") : value as any;
          predicates.push(row => {
            const left = comparable(row[field]); const right = comparable(target);
            return operator === ">=" ? left >= right : operator === "<=" ? left <= right : operator === ">" ? left > right : operator === "<" ? left < right : left === right;
          });
        }
      }
    }
    const any = where.includes(" or ");
    const limit = Number(values.at(-1));
    const rows = state[table].filter(row => !predicates.length || (any ? predicates.some(test => test(row)) : predicates.every(test => test(row))))
      .sort((a, b) => a[ordering] - b[ordering]).slice(0, limit);
    const expressions = selected.split(", ");
    return [rows.map(row => expressions.map(expression => {
      if (expression.startsWith("case when")) {
        return typeof row.messageHistory === "string" && Buffer.byteLength(row.messageHistory, "utf8") <= Number(values[0]) ? row.messageHistory : null;
      }
      const field = [...expression.matchAll(/`([^`]+)`/g)].at(-1)?.[1];
      return field ? row[field] ?? null : null;
    })), []];
  });
  const connection = { query, release, destroy };
  const pool = { getConnection: vi.fn(async () => connection), query: vi.fn(() => { throw new Error("Read outside snapshot connection"); }) };
  // Cast the transport boundary only; queries are generated by the installed ORM.
  const db = drizzle(pool as any);
  return { db, state, statements, release, destroy, pool, query };
}

beforeEach(() => { mocks.getDb.mockReset(); mocks.getDb.mockResolvedValue(null); });

describe("business-day boundaries", () => {
  it("resolves a normal Eastern day independently at both midnights", () => {
    const bounds = auditDayWindow(DAY);
    expect(bounds.start.toISOString()).toBe("2026-11-11T05:00:00.000Z");
    expect(bounds.end.toISOString()).toBe("2026-11-12T05:00:00.000Z");
    expect(businessDate("2026-11-12T04:59:59Z")).toBe(DAY);
  });
  it("has true 23-hour spring DST bounds", () => {
    const { start, end } = auditDayWindow("2026-03-08");
    expect(start.toISOString()).toBe("2026-03-08T05:00:00.000Z");
    expect(end.toISOString()).toBe("2026-03-09T04:00:00.000Z");
    expect(end.getTime() - start.getTime()).toBe(23 * 60 * 60 * 1000);
  });
  it("has true 25-hour fall DST bounds", () => {
    const { start, end } = auditDayWindow("2026-11-01");
    expect(start.toISOString()).toBe("2026-11-01T04:00:00.000Z");
    expect(end.toISOString()).toBe("2026-11-02T05:00:00.000Z");
    expect(end.getTime() - start.getTime()).toBe(25 * 60 * 60 * 1000);
  });
  it("rejects impossible dates, invalid zones and offset-less instants", () => {
    expect(() => auditDayWindow("2026-02-30")).toThrow("Invalid audit date");
    expect(() => auditDayWindow(DAY, "Unknown/Zone")).toThrow("timezone");
    expect(() => businessDate("2026-11-11T10:00:00")).toThrow("offset");
    expect(() => businessDate("2026-02-30T10:00:00Z")).toThrow();
  });
});

describe("readAuditMessages", () => {
  it("uses only selected columns and bounded indexed candidate queries", async () => {
    const mock = offlineDb({ conversation_sessions: [session()], inbound_sms: [intake()] });
    const result = await readAuditMessages(input, mock.db);
    const selects = mock.statements.filter(value => value.sql.startsWith("select"));
    expect(selects).toHaveLength(2);
    expect(selects[0].params.at(-1)).toBe(11);
    expect(selects[1].params.at(-1)).toBe(21);
    expect(selects[0].sql).toContain("octet_length");
    expect(selects[0].sql).toContain("`updatedAt` >= ?");
    expect(selects[0].sql).not.toContain("`updatedAt` <=");
    expect(selects[0].sql).not.toContain("JSON_SEARCH");
    expect(selects[0].sql).not.toContain("quotedPrice");
    expect(selects[1].params).toEqual([START, END, Date.parse(AS_OF), 0, 21]);
    expect(selects[1].sql).not.toContain("processingStatus");
    expect(result.coverage.status).toBe("partial");
    expect(result.nextCursor).toBeNull();
  });
  it("reads bounded exact-phone context for provider customers without using fuzzy names", async () => {
    const older = session(99, [{ role: "user", content: "Tomorrow at 9am", ts: Date.parse(AT), opMsgId: "ACknown" }], "(703) 555-1234");
    older.updatedAt = new Date("2026-11-10T12:00:00Z");
    const unrelated = session(100, [{ role: "user", content: "Wrong household", ts: Date.parse(AT) }], OTHER);
    unrelated.updatedAt = older.updatedAt;
    const mock = offlineDb({ conversation_sessions: [older, unrelated] });
    const result = await readAuditMessages({ ...input, extraPhones: [PHONE] }, mock.db);
    expect(result.threads).toHaveLength(1);
    expect(result.threads[0].customerPhone).toBe(PHONE);
    expect(result.threads[0].messages[0].text).toBe("Tomorrow at 9am");
    const selects = mock.statements.filter(value => value.sql.startsWith("select"));
    expect(selects).toHaveLength(3);
    expect(selects[2].params.at(-1)).toBe(51);
    expect(selects[2].sql).toContain("regexp_replace");
    expect(selects[2].sql).not.toContain("leadName` like");
  });
  it("does not advance the session pagination cursor using supplemental context IDs", async () => {
    const sessions = Array.from({ length: 11 }, (_, i) => session(i + 1));
    const context = session(99, [{ role: "user", content: "Context", ts: Date.parse(AT) }]);
    context.updatedAt = new Date("2026-11-10T12:00:00Z");
    const mock = offlineDb({ conversation_sessions: [...sessions, context] });
    const result = await readAuditMessages({ ...input, extraPhones: [PHONE] }, mock.db);
    expect(result.nextCursor?.sessionAfterId).toBe(10);
  });
  it("reads one SELECT-only consistent connection with TiDB-supported BEGIN and releases before returning", async () => {
    const mock = offlineDb({ conversation_sessions: [session()] });
    await readAuditMessages(input, mock.db);
    expect(mock.pool.getConnection).toHaveBeenCalledTimes(1);
    expect(mock.pool.query).not.toHaveBeenCalled();
    expect(mock.statements[0].sql).toBe("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
    expect(mock.statements[1].sql).toBe("BEGIN");
    expect(mock.statements.at(-1)?.sql).toBe("COMMIT");
    expect(mock.release).toHaveBeenCalledTimes(1);
    expect(mock.destroy).not.toHaveBeenCalled();
  });
  it("keeps generic processing ts as history, not invented provider timing", async () => {
    const mock = offlineDb({ conversation_sessions: [session(1, [{ role: "customer", text: "Move visit", timestamp: AT, opMsgId: "actual-id", createdAt: AT }])] });
    const result = await readAuditMessages(input, mock.db);
    expect(result.threads[0].messages[0]).toMatchObject({ occurredAt: AT, observedAt: AT, timeBasis: "history", delivery: "received" });
    expect(result.coverage.warnings.join(" ")).toContain("processing/history");
  });
  it("does not trust reconcile labels, IDs or historical sent claims without provider identity/delivery proof", async () => {
    const mock = offlineDb({ conversation_sessions: [session(1, [
      { role: "assistant", body: "Confirmed", ts: Date.parse(AT), openPhoneId: "ACreconcile", source: "openphone_reconcile", status: "failed" },
      { role: "assistant", content: "Mirror", ts: Date.parse(AT), opMsgId: "ACmirror", status: "sent" },
      { role: "assistant", content: "Queued", ts: Date.parse(AT), opMsgId: "ACqueued", source: "openphone_reconcile", status: "queued" },
    ])] });
    const result = await readAuditMessages(input, mock.db);
    for (const message of result.threads[0].messages) expect(message).toMatchObject({ timeBasis: "history", delivery: "unknown", observedAt: AT });
    expect(result.threads[0].messages.map(message => message.providerMessageId).sort()).toEqual(["ACmirror", "ACqueued", "ACreconcile"]);
  });
  it("does not treat arbitrary assistant output as sent confirmation", async () => {
    const mock = offlineDb({ conversation_sessions: [session(1, [{ role: "assistant", content: "I confirmed the change", ts: Date.parse(AT) }])] });
    const result = await readAuditMessages(input, mock.db);
    expect(result.threads[0].messages[0].delivery).toBe("unknown");
    expect(result.threads[0].messages[0].providerMessageId).toBeNull();
    expect(result.coverage.warnings.join(" ")).toContain("not confirmation proof");
  });
  it("flags missing/invalid timestamps without fabricating source dates", async () => {
    const mock = offlineDb({ conversation_sessions: [session(1, [
      { role: "user", content: "No date" },
      { role: "assistant", content: "Local date", ts: "2026-11-11T10:00:00" },
      { role: "user", content: "createdAt is not known provenance", createdAt: AT },
      { role: "user", content: "Impossible", timestamp: "2026-02-30T12:00:00Z" },
    ])] });
    const result = await readAuditMessages(input, mock.db);
    expect(result.threads[0]).toMatchObject({ messages: [], truncated: true });
    expect(result.coverage.warnings.join(" ")).toContain("no date fabricated");
  });
  it("flags malformed and oversized histories without healing or logging PII", async () => {
    const mock = offlineDb({ conversation_sessions: [session(1, "not json"), session(2, { messages: [] }), session(3, "x".repeat(100_001))] });
    const result = await readAuditMessages(input, mock.db);
    expect(result.coverage.truncated).toBe(true);
    expect(result.coverage.warnings.join(" ")).toContain("SQL-size-capped");
    expect(result.coverage.warnings.join(" ")).not.toContain(PHONE);
    expect(result.threads[0].messages).toHaveLength(0);
    expect(mock.state.conversation_sessions[0].messageHistory).toBe("not json");
  });
  it("caps history by UTF-8 bytes, not merely character length", async () => {
    const mock = offlineDb({ conversation_sessions: [session(1, [{ role: "user", content: "界".repeat(34_000), ts: Date.parse(AT) }])] });
    const result = await readAuditMessages(input, mock.db);
    expect(result.threads[0].messages).toHaveLength(0);
    expect(result.coverage.truncated).toBe(true);
  });
  it("builds orphan threads with intake observation time and no fake occurredAt", async () => {
    const mock = offlineDb({ inbound_sms: [intake()] });
    const result = await readAuditMessages(input, mock.db);
    expect(result.threads).toHaveLength(1);
    expect(result.threads[0].customerName).toBeNull();
    expect(result.threads[0].messages[0]).toMatchObject({ source: "inbound_sms", sessionId: null, occurredAt: null, observedAt: AT, timeBasis: "received" });
    expect(result.threads[0].key).not.toContain("7035551234");
  });
  it("deduplicates provider IDs only within the same customer and direction", async () => {
    const history = [
      { role: "user", content: "same text", ts: Date.parse(AT), openPhoneId: "repeated", source: "openphone_reconcile" },
      { role: "user", content: "duplicate", ts: Date.parse(AT), opMsgId: "repeated" },
      { role: "assistant", content: "same text", ts: Date.parse(AT), opMsgId: "repeated" },
      { role: "user", content: "same text", ts: Date.parse(AT) },
      { role: "user", content: "same text", ts: Date.parse(AT) },
    ];
    const mock = offlineDb({ conversation_sessions: [session(1, history), session(2, [history[0]], OTHER)], inbound_sms: [intake(1, PHONE, Date.parse(AT), "repeated")] });
    const before = structuredClone(mock.state);
    const result = await readAuditMessages(input, mock.db);
    expect(result.threads.find(thread => thread.customerPhone === PHONE)?.messages).toHaveLength(4);
    expect(result.threads.find(thread => thread.customerPhone === OTHER)?.messages).toHaveLength(1);
    const messages = result.threads.flatMap(thread => thread.messages);
    expect(new Set(messages.map(value => value.key)).size).toBe(5);
    expect(messages.some(value => value.timeBasis === "provider")).toBe(false);
    expect(messages.filter(value => value.timeBasis === "history").every(value => value.occurredAt === AT && value.observedAt === AT)).toBe(true);
    expect(mock.state).toEqual(before);
  });
  it("continues stable IDs without consuming sentinel records", async () => {
    const mock = offlineDb({ conversation_sessions: Array.from({ length: 12 }, (_, i) => session(i + 1)), inbound_sms: Array.from({ length: 22 }, (_, i) => intake(i + 1)) });
    const first = await readAuditMessages(input, mock.db);
    expect(first.nextCursor).toEqual({ sessionAfterId: 10, inboundAfterId: 20, asOf: AS_OF });
    expect(first.coverage.truncated).toBe(true);
    const second = await readAuditMessages({ ...input, cursor: first.nextCursor }, mock.db);
    expect(second.nextCursor).toBeNull();
    expect(second.threads[0].messages.map(message => message.key)).toContain("history:11:0");
    expect(second.threads[0].messages.map(message => message.key)).toContain("inbound:21");
    expect(second.threads[0].messages).toHaveLength(4);
  });
  it("does not incorrectly stop one source when only the other has more rows", async () => {
    const mock = offlineDb({ inbound_sms: Array.from({ length: 22 }, (_, i) => intake(i + 1)) });
    const first = await readAuditMessages(input, mock.db);
    expect(first.nextCursor?.sessionAfterId).toBe(0);
    const second = await readAuditMessages({ ...input, cursor: first.nextCursor }, mock.db);
    expect(second.threads[0].messages).toHaveLength(2);
    expect(second.nextCursor).toBeNull();
  });
  it("rejects changed asOf and invalid cursors before opening a connection", async () => {
    const mock = offlineDb();
    await expect(readAuditMessages({ ...input, cursor: { sessionAfterId: 10, inboundAfterId: 20, asOf: AT } }, mock.db)).rejects.toThrow("cursor");
    await expect(readAuditMessages({ ...input, cursor: { sessionAfterId: -1, inboundAfterId: 0, asOf: AS_OF } }, mock.db)).rejects.toThrow("cursor");
    expect(mock.pool.getConnection).not.toHaveBeenCalled();
  });
  it("includes prior 24h and later through asOf even if session updated after selected day", async () => {
    const entries = [
      { role: "user", content: "too early", ts: START - 86_400_001 },
      { role: "user", content: "prior", ts: START - 86_400_000 },
      { role: "user", content: "anchor", ts: START },
      { role: "assistant", content: "later correction", ts: END + 1000, opMsgId: "later" },
      { role: "assistant", content: "asOf inclusive", ts: Date.parse(AS_OF), opMsgId: "cutoff" },
      { role: "assistant", content: "after asOf", ts: Date.parse(AS_OF) + 1, opMsgId: "future" },
    ];
    const mock = offlineDb({ conversation_sessions: [session(1, entries)] });
    const result = await readAuditMessages(input, mock.db);
    expect(result.threads[0].messages.map(value => value.text)).toEqual(["prior", "anchor", "later correction", "asOf inclusive"]);
  });
  it("keeps selected-day anchors when 121 later messages require context truncation", async () => {
    const history = [
      { role: "user", content: "selected-day anchor", ts: Date.parse(AT) },
      ...Array.from({ length: 121 }, (_, index) => ({ role: "assistant", content: `later ${index}`, ts: END + index * 1000, opMsgId: `later-${index}` })),
    ];
    const mock = offlineDb({ conversation_sessions: [session(1, history)] });
    const result = await readAuditMessages(input, mock.db);
    expect(result.threads[0].messages).toHaveLength(120);
    expect(result.threads[0].messages[0].text).toBe("selected-day anchor");
    expect(result.threads[0].truncated).toBe(true);
    expect(result.coverage.warnings.join(" ")).toContain("cannot be fully verified");
  });
  it("caps thread text at 8k and total text at 16k with affected-thread warnings", async () => {
    const mock = offlineDb({ conversation_sessions: [PHONE, OTHER, "+13015551234"].map((customerPhone, index) => session(index + 1, [{ role: "user", content: "a".repeat(9000), ts: Date.parse(AT) }], customerPhone)) });
    const result = await readAuditMessages(input, mock.db);
    expect(result.threads.every(thread => thread.messages.reduce((sum, message) => sum + message.text.length, 0) <= 8000)).toBe(true);
    expect(result.threads.flatMap(thread => thread.messages).reduce((sum, message) => sum + message.text.length, 0)).toBe(16000);
    expect(result.threads.every(thread => thread.truncated)).toBe(true);
  });
  it("filters intake on [day start,day end) and observation asOf", async () => {
    const mock = offlineDb({ inbound_sms: [intake(1, PHONE, START - 1), intake(2, PHONE, START), intake(3, PHONE, END - 1), intake(4, PHONE, END)] });
    const result = await readAuditMessages({ ...input, asOf: new Date(START + 1).toISOString() }, mock.db);
    expect(result.threads[0].messages.map(value => value.key)).toEqual(["inbound:2"]);
  });
  it("skips invalid/non-US phones instead of misidentifying customers", async () => {
    const mock = offlineDb({ conversation_sessions: [session(1, undefined, "+447911123456"), session(2, undefined, "customer 7035551234")], inbound_sms: [intake(1, "+256772123456"), intake(2, "1234567890")] });
    const result = await readAuditMessages(input, mock.db);
    expect(result.threads).toHaveLength(0);
    expect(result.coverage.truncated).toBe(true);
    expect(result.coverage.warnings.join(" ")).toContain("Invalid/non-US");
    expect(result.coverage.warnings.join(" ")).not.toContain("447911123456");
  });
  it("never reports complete coverage even when no rows qualify", async () => {
    const mock = offlineDb();
    const result = await readAuditMessages(input, mock.db);
    expect(result).toMatchObject({ threads: [], nextCursor: null, coverage: { status: "partial" } });
    expect(result.coverage.warnings.join(" ")).toContain("absence is not proof");
  });
});

describe("readAuditRecords", () => {
  it("maps canonical and linked operational state without card/quoted-price payment proof", async () => {
    const mock = offlineDb({
      bookings: [booking()], leadflow_jobs: [{ ...job(), bookingId: 1 }],
      booking_assignments: [{ id: 1, bookingId: 1, status: "assigned", teamName: "Test Team", unassignedAt: null }],
      booking_payment_profiles: [{ id: 1, bookingId: 1, paymentStatus: "captured" }],
    });
    const result = await readAuditRecords(scope(), mock.db);
    expect(result.truncated).toBe(false);
    expect(result.records).toHaveLength(2);
    expect(result.records[0]).toMatchObject({ source: "bookings", publicBookingNumber: "LF-1", date: "2026-11-20", time: "09:00", status: "confirmed", paymentStatus: "captured", paidAmountCents: null, extras: ["oven"], teamName: "Test Team" });
    expect(result.records[1]).toMatchObject({ source: "leadflow_jobs", bookingId: 1, publicBookingNumber: "LF-1", time: "09:00", timeZone: "America/New_York", paymentStatus: null, paidAmountCents: null });
    expect(result.warnings.join(" ")).toContain("quoted totals are not capture amounts");
    expect(mock.release).toHaveBeenCalledTimes(1);
    expect(mock.pool.getConnection).toHaveBeenCalledTimes(1);
  });
  it("matches exact normalized historical phone formats only, without name or date cutoff", async () => {
    const mock = offlineDb({ bookings: [booking(1, "(703) 555-1234"), booking(2, "17035551234"), booking(3, OTHER)], leadflow_jobs: [{ ...job(1, "703-555-1234"), jobDate: "2020-01-01" }, { ...job(2, PHONE), jobDate: "2040-12-31" }] });
    const result = await readAuditRecords(scope(), mock.db);
    expect(result.records).toHaveLength(4);
    expect(result.records.every(record => record.customerPhone === PHONE)).toBe(true);
    expect(result.records.filter(record => record.source === "leadflow_jobs").map(record => record.date)).toEqual(["2020-01-01", "2040-12-31"]);
    const selects = mock.statements.filter(value => value.sql.startsWith("select"));
    expect(selects[0].sql).toContain("regexp_replace");
    expect(selects[0].params).toEqual(["7035551234", "17035551234", 1001]);
    for (const query of selects) {
      const where = query.sql.split(" where ")[1];
      expect(where).not.toContain("customerName");
      expect(where).not.toContain("jobDate");
      expect(where).not.toContain("requestedLocalDate");
    }
  });
  it("treats imported and native origins identically", async () => {
    const mock = offlineDb({ leadflow_jobs: [{ ...job(1), origin: "launch27" }, { ...job(2), origin: "native" }] });
    const result = await readAuditRecords(scope(), mock.db);
    expect(result.records.map(record => record.jobId)).toEqual([1, 2]);
    expect(mock.statements.filter(value => value.sql.startsWith("select")).every(value => !value.sql.includes("origin"))).toBe(true);
  });
  it("converts only offset-qualified service timestamps to Eastern clocks", async () => {
    const mock = offlineDb({ leadflow_jobs: [
      { ...job(1), serviceDateTime: "2026-11-20T09:00:00-05:00" },
      { ...job(2), serviceDateTime: "2026-11-20T09:00:00" },
      { ...job(3), serviceDateTime: "2026-11-20T14:00:00Z" },
    ] });
    const result = await readAuditRecords(scope(), mock.db);
    expect(result.records.map(record => record.time)).toEqual(["09:00", null, "09:00"]);
    expect(result.records[1].timeZone).toBeNull();
    expect(result.warnings.join(" ")).toContain("lacks an explicit offset");
  });
  it("uses exactly one active not-unassigned canonical assignment; ambiguity is unknown", async () => {
    const mock = offlineDb({ bookings: [booking(1), booking(2), booking(3)], booking_assignments: [
      { id: 1, bookingId: 1, status: "assigned", teamName: "Old Team", unassignedAt: new Date() },
      { id: 2, bookingId: 1, status: "assigned", teamName: "Current Team", unassignedAt: null },
      { id: 3, bookingId: 2, status: "assigned", teamName: "First Team", unassignedAt: null },
      { id: 4, bookingId: 2, status: "assigned", teamName: "Second Team", unassignedAt: null },
      { id: 5, bookingId: 3, status: "unassigned", teamName: "Inactive Team", unassignedAt: null },
    ] });
    const result = await readAuditRecords(scope(), mock.db);
    expect(result.records.map(record => record.teamName)).toEqual(["Current Team", null, null]);
    expect(result.warnings.join(" ")).toContain("Multiple active assignments");
    const select = mock.statements.find(value => value.sql.includes("from `booking_assignments`"))!;
    expect(select.sql).toContain("`unassignedAt` is null");
    expect(select.params).toContain("assigned");
  });
  it("preserves authoritative canonical capture status despite stale card profile, never deriving amount", async () => {
    const mock = offlineDb({ bookings: [booking()], booking_payment_profiles: [{ id: 1, bookingId: 1, paymentStatus: "card_on_file" }] });
    const result = await readAuditRecords(scope(), mock.db);
    expect(result.records[0]).toMatchObject({ paymentStatus: "captured", paidAmountCents: null });
    expect(result.warnings.join(" ")).toContain("canonical status is preserved");
    const selects = mock.statements.filter(value => value.sql.startsWith("select"));
    for (const select of selects) {
      expect(select.sql).not.toContain("stripePaymentMethodId");
      expect(select.sql).not.toContain("firstCleaningTotalCents");
      expect(select.sql).not.toContain("hasStripeCard");
      expect(select.sql).not.toContain("jobTotalCents");
    }
  });
  it("flags the global 1000-record cap using one extra sentinel across sources", async () => {
    const mock = offlineDb({ bookings: Array.from({ length: 600 }, (_, i) => booking(i + 1)), leadflow_jobs: Array.from({ length: 405 }, (_, i) => job(i + 1)) });
    const result = await readAuditRecords(scope(), mock.db);
    expect(result.records).toHaveLength(1000);
    expect(result.truncated).toBe(true);
    expect(result.warnings.join(" ")).toContain("cannot_verify");
    expect(mock.statements.find(value => value.sql.includes("from `leadflow_jobs`"))?.params.at(-1)).toBe(401);
  });
  it("does not scan additional operational rows after a canonical sentinel reaches the global cap", async () => {
    const mock = offlineDb({ bookings: Array.from({ length: 1002 }, (_, i) => booking(i + 1)), leadflow_jobs: [job()] });
    const result = await readAuditRecords(scope(), mock.db);
    expect(result.records).toHaveLength(1000);
    expect(result.truncated).toBe(true);
    expect(mock.statements.some(value => value.sql.includes("from `leadflow_jobs`"))).toBe(false);
  });
  it("includes linked mismatched-customer rows so linkage conflicts cannot appear clean", async () => {
    const mock = offlineDb({ bookings: [booking(1, OTHER)], leadflow_jobs: [{ ...job(1), bookingId: 1 }] });
    const result = await readAuditRecords(scope(), mock.db);
    expect(result.records.find(record => record.source === "bookings")?.customerPhone).toBe(OTHER);
    expect(result.records.find(record => record.source === "leadflow_jobs")?.customerPhone).toBe(PHONE);
    expect(result.warnings.join(" ")).toContain("different exact customer phone");
  });
  it("includes linked operational mismatches even when job phone no longer matches", async () => {
    const mock = offlineDb({ bookings: [booking()], leadflow_jobs: [{ ...job(1, OTHER), bookingId: 1 }] });
    const result = await readAuditRecords(scope(), mock.db);
    expect(result.records).toHaveLength(2);
    expect(result.warnings.join(" ")).toContain("different exact customer phone");
  });
  it("does not query invalid phones or infer identities from missing candidate threads", async () => {
    const mock = offlineDb();
    const result = await readAuditRecords(scope("+447911123456"), mock.db);
    expect(result).toMatchObject({ records: [], truncated: true });
    expect(mock.statements).toHaveLength(0);
    const missing = scope(); missing.threads = [];
    const absent = await readAuditRecords(missing, mock.db);
    expect(absent.warnings.join(" ")).toContain("Candidate thread is missing");
    expect(mock.statements).toHaveLength(0);
  });
  it("maps malformed extras to unknown instead of falsely empty service evidence", async () => {
    const mock = offlineDb({ leadflow_jobs: [{ ...job(1), extras: "bad-json" }, { ...job(2), extras: '["oven"]' }] });
    const result = await readAuditRecords(scope(), mock.db);
    expect(result.records.map(record => record.extras)).toEqual([null, ["oven"]]);
    expect(result.warnings.join(" ")).toContain("Malformed persisted extras");
  });
  it("only scopes customers from candidates, not unrelated thread contacts", async () => {
    const mock = offlineDb({ bookings: [booking(1), booking(2, OTHER)] });
    const request = scope();
    request.threads.push({ ...request.threads[0], key: "unrelated", customerPhone: OTHER });
    const result = await readAuditRecords(request, mock.db);
    expect(result.records.map(record => record.bookingId)).toEqual([1]);
  });
  it("reads all supplied thread phones before interpretation when candidates are empty", async () => {
    const mock = offlineDb({ bookings: [booking(1), booking(2, OTHER)] });
    const request = scope(); request.candidates = [];
    const result = await readAuditRecords(request, mock.db);
    expect(result.records.map(record => record.bookingId)).toEqual([1]);
    expect(mock.release).toHaveBeenCalledTimes(1);
  });
  it("preserves a persisted empty extras array as empty rather than missing", async () => {
    const mock = offlineDb({ bookings: [{ ...booking(), extras: [] }], leadflow_jobs: [{ ...job(), extras: "[]" }] });
    const result = await readAuditRecords(scope(), mock.db);
    expect(result.records.map(record => record.extras)).toEqual([[], []]);
  });
  it("flags a missing linked canonical counterpart instead of verifying incomplete state", async () => {
    const mock = offlineDb({ leadflow_jobs: [{ ...job(), bookingId: 999 }] });
    const result = await readAuditRecords(scope(), mock.db);
    expect(result.truncated).toBe(true);
    expect(result.warnings.join(" ")).toContain("Linked canonical counterpart is missing");
  });
  it("flags a stored jobDate/serviceDateTime day mismatch without rewriting the date", async () => {
    const mock = offlineDb({ leadflow_jobs: [{ ...job(), jobDate: "2026-11-19" }] });
    const result = await readAuditRecords(scope(), mock.db);
    expect(result.records[0].date).toBe("2026-11-19");
    expect(result.truncated).toBe(true);
    expect(result.warnings.join(" ")).toContain("cannot_verify");
  });
  it("warns and returns unknown for invalid persisted schedule values", async () => {
    const mock = offlineDb({ bookings: [{ ...booking(), requestedLocalDate: "2026-02-30", requestedLocalTime: "25:00", requestedTimeZone: null }] });
    const result = await readAuditRecords(scope(), mock.db);
    expect(result.records[0]).toMatchObject({ date: null, time: null, timeZone: null });
    expect(result.warnings.join(" ")).toContain("no scheduled value is invented");
  });
});

describe("reader fail-closed and source boundaries", () => {
  it("throws a safe missing-database error rather than clean empty data", async () => {
    await expect(readAuditMessages(input)).rejects.toThrow("unavailable");
    await expect(readAuditRecords(scope())).rejects.toThrow("unavailable");
    await expect(readAuditMessages(input)).rejects.toBeInstanceOf(AuditSnapshotError);
    await expect(readAuditRecords(scope())).rejects.toMatchObject({ reason: "DB_UNAVAILABLE" });
  });
  it("uses getDb by default but never invokes it for injected offline readers", async () => {
    const mock = offlineDb();
    mocks.getDb.mockResolvedValue(mock.db);
    await readAuditMessages(input);
    expect(mocks.getDb).toHaveBeenCalledTimes(1);
    mocks.getDb.mockClear();
    await readAuditMessages(input, mock.db);
    await readAuditRecords(scope(), mock.db);
    expect(mocks.getDb).not.toHaveBeenCalled();
  });
  it("releases and rolls back a failed reader and hides SQL/customer details", async () => {
    const mock = offlineDb();
    const original = mock.query.getMockImplementation()!;
    mock.query.mockImplementation(async (options, values) => {
      const querySql = typeof options === "string" ? options : options.sql;
      if (querySql.startsWith("select")) throw new Error(`SQL sensitive failure ${PHONE}`);
      return original(options, values);
    });
    await expect(readAuditMessages(input, mock.db)).rejects.toThrow("Audit snapshot read failed; no verification was performed.");
    expect(mock.statements.at(-1)?.sql).toBe("ROLLBACK");
    expect(mock.release).toHaveBeenCalledTimes(1);
    expect(mock.destroy).not.toHaveBeenCalled();
  });
  it("has no write/action/network APIs, full-history JSON search, or unapproved data sources", () => {
    const source = readFileSync(new URL("./dailyActionAuditData.ts", import.meta.url), "utf8");
    // crypto.createHash().update() is not a database mutation. All emitted SQL
    // is independently constrained by the actual-Drizzle offline transport.
    expect(source).not.toMatch(/\b(?:db|tx|reader|connection)\s*\.(insert|update|delete|execute)\s*\(/);
    expect(source).not.toMatch(/\.for\s*\(/);
    expect(source).not.toMatch(/\b(fetch|sendSMS|sendEmail|JSON_SEARCH)\s*\(/);
    expect(source).not.toContain("./routers");
    const referenced = [...source.matchAll(/\.from\((\w+)\)/g)].map(value => value[1]);
    expect(new Set(referenced)).toEqual(new Set(["conversationSessions", "inboundSms", "bookings", "leadflowJobs", "bookingAssignments", "bookingPaymentProfiles"]));
  });
});
