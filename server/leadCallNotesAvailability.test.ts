import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DatabaseSync as MemoryDb } from "node:sqlite";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import net from "node:net";
import http from "node:http";
import https from "node:https";
import tls from "node:tls";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import type { SQL } from "drizzle-orm";
import { leadCallNotesAvailabilityInputSchema, type LeadCallNotesAvailabilityInput } from "../shared/leadCallNotesAvailability";
import { createLeadCallNotesAvailabilityReader, getLeadCallNotesAvailability } from "./leadCallNotesAvailability";
import { createLeadCallNotesReader } from "./leadCallNotes";

const applicationDb = vi.hoisted(() => vi.fn());
vi.mock("./db", () => ({ getDb: applicationDb }));
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");
const handles: MemoryDb[] = [];
const network = vi.fn(() => { throw new Error("Network is forbidden in availability tests."); });
beforeEach(() => {
  vi.stubGlobal("fetch", network);
  vi.spyOn(net, "connect").mockImplementation(network);
  vi.spyOn(net, "createConnection").mockImplementation(network);
  vi.spyOn(http, "request").mockImplementation(network);
  vi.spyOn(https, "request").mockImplementation(network);
  vi.spyOn(tls, "connect").mockImplementation(network);
});
afterEach(() => {
  expect(network).not.toHaveBeenCalled();
  handles.splice(0).forEach(db => db.close());
  applicationDb.mockReset(); network.mockClear(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});
const phone = "+17035551234", other = "+17035559876", oldDate = "2001-01-02T03:04:05.000Z";
type Row = Record<string, any>;
type Lead = { key: string; sessionId?: number | null; phone?: string | null };
const input = (...leads: Lead[]) => leadCallNotesAvailabilityInputSchema.parse({ leads });
function harness() {
  const memory = new DatabaseSync(":memory:"); handles.push(memory);
  memory.exec(`CREATE TABLE conversation_sessions (id INTEGER PRIMARY KEY, leadPhone TEXT);
    CREATE TABLE voice_calls (id INTEGER, vapiCallId TEXT, sessionId INTEGER, callerPhone TEXT, durationSeconds INTEGER,
      transcript TEXT, summary TEXT, outcome TEXT, structuredData TEXT, endedReason TEXT, recordingUrl TEXT, createdAt TEXT);
    CREATE TABLE openphone_call_recordings (id INTEGER, sessionId INTEGER, openphoneCallId TEXT, callerPhone TEXT,
      direction TEXT, durationSeconds INTEGER, status TEXT, callStartedAt TEXT, transcript TEXT, scoreData TEXT, recordingUrl TEXT);
    CREATE TABLE call_log (id INTEGER, calledPhone TEXT, calledTarget TEXT, vapiCallId TEXT, transcript TEXT, status TEXT,
      firedAt INTEGER, completedAt INTEGER, durationSeconds INTEGER, notes TEXT, recordingUrl TEXT, createdAt TEXT);
    CREATE TABLE ops_chat_messages (id INTEGER, channel TEXT, quickAction TEXT, sessionId INTEGER, metadata TEXT);`);
  memory.function("UNIX_TIMESTAMP", value => {
    if (value == null) return null;
    const timestamp = new Date(String(value)).getTime() / 1000;
    return Number.isFinite(timestamp) ? timestamp : null;
  });
  memory.function("JSON_VALID", value => { try { JSON.parse(String(value)); return 1; } catch { return 0; } });
  memory.function("JSON_EXTRACT", (value, path) => {
    const selected = String(path).slice(2).split(".").reduce((data, key) => data?.[key], JSON.parse(String(value)));
    return selected === undefined ? null : JSON.stringify(selected);
  });
  memory.function("JSON_UNQUOTE", value => value == null ? null : String(JSON.parse(String(value))));
  const queries: ReturnType<MySqlDialect["sqlToQuery"]>[] = [];
  const returnedCounts: number[] = [];
  const execute = vi.fn(async (statement: SQL) => {
    const query = new MySqlDialect().sqlToQuery(statement); queries.push(query);
    // Only fixture setup can write. Every SQL statement emitted by either reader must be passive.
    expect(query.sql.trim()).toMatch(/^SELECT /);
    expect(query.sql).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|REPLACE)\b/i);
    const rows = memory.prepare(query.sql).all(...query.params as any[]);
    returnedCounts.push(rows.length);
    return [rows, []];
  });
  const getDb = vi.fn(async () => ({ execute }));
  const read = createLeadCallNotesAvailabilityReader(getDb).read;
  const fullRead = createLeadCallNotesReader(getDb).read;
  function insert(table: string, row: Row) {
    const keys = Object.keys(row);
    memory.prepare(`INSERT INTO ${table} (${keys.join(",")}) VALUES (${keys.map(() => "?").join(",")})`).run(...Object.values(row));
  }
  return { memory, queries, returnedCounts, execute, getDb, read, fullRead, insert };
}
const voice = (overrides: Row = {}): Row => ({ id: 1, callerPhone: phone, sessionId: 42, vapiCallId: null,
  summary: null, transcript: null, recordingUrl: null, createdAt: oldDate, ...overrides });
const staff = (overrides: Row = {}): Row => ({ id: 2, callerPhone: phone, sessionId: 42, openphoneCallId: null,
  status: "no_answer", scoreData: null, transcript: null, recordingUrl: null, callStartedAt: oldDate, ...overrides });
const outbound = (overrides: Row = {}): Row => ({ id: 3, calledPhone: phone, calledTarget: "client", vapiCallId: null,
  status: "no_answer", transcript: null, notes: null, recordingUrl: null, firedAt: null, createdAt: oldDate, ...overrides });

describe("lead call notes availability: exact, batched and passive", () => {
  it("exports the strict agreed schema, defaults and safe positive integer guard without an arbitrary lead cap", () => {
    expect(input({ key: "native" })).toEqual({ leads: [{ key: "native", sessionId: null, phone: null }] });
    expect(input()).toEqual({ leads: [] });
    for (const invalid of [{}, { leads: [], extra: true }, { leads: [{ key: "" }] },
      { leads: [{ key: "x", extra: true }] }, { leads: [{ key: "x", phone: 123 }] },
      ...[0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1].map(sessionId => ({ leads: [{ key: "x", sessionId }] }))]) {
      expect(leadCallNotesAvailabilityInputSchema.safeParse(invalid).success).toBe(false);
    }
    expect(input(...Array.from({ length: 75 }, (_, i) => ({ key: String(i) }))).leads).toHaveLength(75);
    expect(input({ key: "max", sessionId: Number.MAX_SAFE_INTEGER }).leads[0].sessionId).toBe(Number.MAX_SAFE_INTEGER);
    expect(applicationDb).not.toHaveBeenCalled();
  });

  it("empty and entirely invalid sessionless batches neither obtain a DB nor initialize the production adapter", async () => {
    const h = harness();
    expect(await h.read(input())).toEqual({ leads: [] });
    const invalid = [null, "", "invalid", "+447911123456", "1234567890", "5551234"];
    const request = input(...invalid.map((phone, i) => ({ key: String(i), phone })));
    expect((await h.read(request)).leads).toEqual(invalid.map((_, i) => ({ key: String(i), hasCalls: false })));
    expect(await getLeadCallNotesAvailability(request)).toEqual(await h.read(request));
    expect(await getLeadCallNotesAvailability(input())).toEqual({ leads: [] });
    expect(h.getDb).not.toHaveBeenCalled(); expect(h.queries).toHaveLength(0);
    expect(applicationDb).not.toHaveBeenCalled();
  });

  it.each([
    ["voice_calls", voice], ["openphone_call_recordings", staff], ["call_log", outbound],
  ] as const)("counts old %s records without summary, transcript, recording, provider ID, answered or status gates", async (table, seed) => {
    const h = harness(); h.insert(table, seed());
    expect(await h.read(input({ key: "old-call", phone }))).toEqual({ leads: [{ key: "old-call", hasCalls: true }] });
    expect((await h.fullRead({ sessionId: null, phone })).calls).toHaveLength(1);
  });

  it("binds only each exact session's canonical phone and preserves input order and duplicate keys", async () => {
    const h = harness();
    h.insert("conversation_sessions", { id: 42, leadPhone: "(703) 555-1234" });
    h.insert("conversation_sessions", { id: 99, leadPhone: other });
    h.insert("voice_calls", voice({ sessionId: 99 })); // Phone, not the history row's session/provider, controls availability.
    const request = input({ key: "same", sessionId: 42, phone: "17035551234" },
      { key: "same", sessionId: 99 }, { key: "native", phone: "703-555-1234" },
      { key: "same", sessionId: 42, phone: other }, { key: "same", sessionId: 42, phone: "invalid" });
    expect((await h.read(request)).leads).toEqual([
      { key: "same", hasCalls: true }, { key: "same", hasCalls: false }, { key: "native", hasCalls: true },
      { key: "same", hasCalls: null }, { key: "same", hasCalls: null },
    ]);
    expect(h.queries).toHaveLength(4);
    expect(h.queries[0].sql).toMatch(/^SELECT id, leadPhone FROM conversation_sessions WHERE id IN \(\?, \?\)$/);
    expect(h.queries[0].params).toEqual([42, 99]);
  });

  it("uses unknown for absent sessions and mismatches, false for a verified session with a missing/invalid canonical phone", async () => {
    const h = harness();
    h.insert("conversation_sessions", { id: 42, leadPhone: null });
    h.insert("conversation_sessions", { id: 43, leadPhone: "invalid" });
    h.insert("voice_calls", voice());
    expect((await h.read(input({ key: "missing", sessionId: 999 }, { key: "missing-ui", sessionId: 999, phone },
      { key: "null", sessionId: 42 }, { key: "invalid", sessionId: 43 },
      { key: "no-fallback", sessionId: 42, phone }, { key: "invalid-ui", sessionId: 43, phone: "invalid" }))).leads).toEqual([
      { key: "missing", hasCalls: null }, { key: "missing-ui", hasCalls: null }, { key: "null", hasCalls: false },
      { key: "invalid", hasCalls: false }, { key: "no-fallback", hasCalls: null }, { key: "invalid-ui", hasCalls: false },
    ]);
    expect(h.queries).toHaveLength(1);
    expect(h.queries[0].params).toEqual([999, 42, 43]);
  });

  it.each([phone, "17035551234", "7035551234", "(703) 555-1234", "703.555.1234"])("normalizes request form %s with the existing phone helper", async formatted => {
    const h = harness(); h.insert("voice_calls", voice());
    expect((await h.read(input({ key: "formatted", phone: formatted }))).leads[0].hasCalls).toBe(true);
    expect(h.queries).toHaveLength(3);
    for (const query of h.queries) expect(query.params).toEqual([phone, "17035551234", "7035551234"]);
  });

  it.each(["voice_calls", "openphone_call_recordings", "call_log"])("matches only full E164/11/10 digit stored forms in %s", async table => {
    const h = harness();
    const seed = table === "voice_calls" ? voice : table === "openphone_call_recordings" ? staff : outbound;
    const field = table === "call_log" ? "calledPhone" : "callerPhone";
    for (const stored of [phone, "17035551234", "7035551234"]) {
      h.memory.exec(`DELETE FROM ${table}`);
      h.insert(table, seed({ [field]: stored }));
      expect((await h.read(input({ key: stored, phone }))).leads[0].hasCalls).toBe(true);
    }
    h.memory.exec(`DELETE FROM ${table}`);
    for (const stored of [other, "+447035551234", "5551234", "(703) 555-1234", `${phone}99`]) {
      h.insert(table, seed({ [field]: stored }));
    }
    expect((await h.read(input({ key: "wrong-complete-or-suffix", phone }))).leads[0].hasCalls).toBe(false);
  });

  it("does not count wrong-phone history, team-targeted calls, or task-only call evidence", async () => {
    const h = harness();
    h.insert("voice_calls", voice({ callerPhone: other }));
    h.insert("openphone_call_recordings", staff({ callerPhone: other }));
    h.insert("call_log", outbound({ calledPhone: other }));
    h.insert("call_log", outbound({ id: 4, calledTarget: "team" }));
    h.insert("ops_chat_messages", { id: 10, channel: "command", quickAction: "claude_customer_task", sessionId: 42,
      metadata: JSON.stringify({ taskId: 10, task: { customerPhone: phone, call: { provider: "vapi", providerCallId: "task-only" } } }) });
    expect((await h.read(input({ key: "no-real-call", phone }))).leads[0].hasCalls).toBe(false);
    expect(h.queries).toHaveLength(3);
    expect(h.queries.every(query => !/ops_chat_messages|twilio|attempt/i.test(query.sql))).toBe(true);
  });

  it.each([
    ["voice_calls", voice, "createdAt"], ["openphone_call_recordings", staff, "callStartedAt"],
  ] as const)("requires a usable nonnegative %s timestamp rather than mere row existence", async (table, seed, field) => {
    const h = harness();
    for (const timestamp of [null, "", "not-a-date", "0000-00-00 00:00:00", "1960-01-01T00:00:00.000Z"]) {
      h.insert(table, seed({ [field]: timestamp }));
    }
    expect((await h.read(input({ key: "invalid-time", phone }))).leads[0].hasCalls).toBe(false);
    expect((await h.fullRead({ sessionId: null, phone })).calls).toEqual([]);
    h.insert(table, seed({ [field]: "1970-01-01T00:00:00.000Z" }));
    expect((await h.read(input({ key: "epoch", phone }))).leads[0].hasCalls).toBe(true);
  });

  it.each([
    [null, null, false], [-1, "not-a-date", false], [null, "0000-00-00 00:00:00", false],
    [null, oldDate, true], [-1, oldDate, true], [0, null, true], [946684800000, "not-a-date", true],
  ])("matches outbound firedAt=%s / createdAt=%s fallback validity", async (firedAt, createdAt, expected) => {
    const h = harness(); h.insert("call_log", outbound({ firedAt, createdAt }));
    expect((await h.read(input({ key: "fallback", phone }))).leads[0].hasCalls).toBe(expected);
    expect((await h.fullRead({ sessionId: null, phone })).calls.length > 0).toBe(expected);
  });

  it("handles 75 distinct session leads plus native and duplicate-key rows in four queries, not N+1", async () => {
    const h = harness();
    const leads = Array.from({ length: 75 }, (_, i) => ({ key: "duplicate-key", sessionId: i + 1, phone: `+1703555${String(1000 + i)}` }));
    for (let i = 0; i < leads.length; i++) {
      const lead = leads[i];
      h.insert("conversation_sessions", { id: lead.sessionId, leadPhone: lead.phone });
      if (i % 3 === 0) h.insert("voice_calls", voice({ id: i + 1, callerPhone: lead.phone }));
      if (i % 3 === 1) h.insert("openphone_call_recordings", staff({ id: i + 1, callerPhone: lead.phone }));
      if (i % 3 === 2) h.insert("call_log", outbound({ id: i + 1, calledPhone: lead.phone }));
    }
    const request = input(...leads, { key: "native", phone: other }, { key: "duplicate-key", sessionId: 1 });
    const result = await h.read(request);
    expect(result.leads).toHaveLength(77);
    expect(result.leads.slice(0, 75).every(lead => lead.key === "duplicate-key" && lead.hasCalls === true)).toBe(true);
    expect(result.leads.slice(75)).toEqual([{ key: "native", hasCalls: false }, { key: "duplicate-key", hasCalls: true }]);
    expect(h.getDb).toHaveBeenCalledOnce(); expect(h.queries).toHaveLength(4);
    expect(h.queries[0].params).toHaveLength(75);
    expect(h.queries.slice(1).every(query => query.params.length === 228)).toBe(true);
    expect(h.returnedCounts).toEqual([75, 25, 25, 25]);
  });

  it("groups repeated records by requested complete phone and returns only key/availability", async () => {
    const h = harness();
    for (let i = 1; i <= 125; i++) {
      h.insert("voice_calls", voice({ id: i }));
      h.insert("openphone_call_recordings", staff({ id: i }));
      h.insert("call_log", outbound({ id: i }));
    }
    const result = await h.read(input({ key: "a", phone }, { key: "b", phone: "7035551234" }));
    expect(result).toEqual({ leads: [{ key: "a", hasCalls: true }, { key: "b", hasCalls: true }] });
    expect(h.returnedCounts).toEqual([1, 1, 1]);
    for (const query of h.queries) expect(query.params).toHaveLength(3);
  });

  it("keeps SQL parameterized, SELECT-only, phone grouped and limited to lightweight columns", async () => {
    const h = harness(); h.insert("conversation_sessions", { id: 42, leadPhone: phone });
    await h.read(input({ key: "not-an-identity' OR 1=1", sessionId: 42, phone }));
    expect(h.queries).toHaveLength(4);
    const forbidden = new RegExp(["SELECT \\*", "transcript", "summary", "scoreData", "structuredData", "metadata", "recordingUrl",
      "vapiCallId", "openphoneCallId", "durationSeconds", "LIKE", "REGEXP", "RIGHT\\(", "answered", "status", "completedAt", "twilio", "attempt",
      "cleaner" + "_jobs", "cleaner" + "Jobs"].join("|"), "i");
    for (const query of h.queries) {
      expect(query.sql).not.toMatch(forbidden);
      expect(query.sql).not.toContain(phone); expect(query.sql).not.toContain("not-an-identity");
      expect(query.sql).toMatch(/WHERE[\s\S]+IN \(/);
    }
    expect(h.queries.slice(1).map(query => query.sql.split(" FROM ")[0])).toEqual(["SELECT callerPhone", "SELECT callerPhone", "SELECT calledPhone"]);
    for (const query of h.queries.slice(1)) {
      expect(query.sql).toMatch(/GROUP BY (callerPhone|calledPhone)$/);
      expect(query.params).toEqual([phone, "17035551234", "7035551234"]);
    }
    const source = readFileSync(new URL("./leadCallNotesAvailability.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(new RegExp("cleaner" + "_jobs|cleaner" + "Jobs"));
    expect(source).not.toMatch(/getLeadCallNotes\(|createLeadCallNotesReader|from ["']\.\/db["']|cron|setInterval|fetch\(|axios|twilio/i);
    expect(source).toContain('await import("./db")');
  });

  it("throws unavailable DB, initialization errors, query failures and malformed results rather than reporting false", async () => {
    const request = input({ key: "db", phone });
    await expect(createLeadCallNotesAvailabilityReader(async () => null).read(request)).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
    await expect(createLeadCallNotesAvailabilityReader(async () => { throw new Error("initialization failed"); }).read(request)).rejects.toThrow("initialization failed");
    for (const failAt of [1, 2, 3, 4]) {
      const h = harness(); h.insert("conversation_sessions", { id: 42, leadPhone: phone });
      const execute = vi.fn(async (query: SQL) => {
        if (execute.mock.calls.length === failAt) throw new Error(`query ${failAt} failed`);
        return h.execute(query);
      });
      await expect(createLeadCallNotesAvailabilityReader(async () => ({ execute })).read(input({ key: "fail", sessionId: 42 }))).rejects.toThrow(`query ${failAt} failed`);
      expect(execute).toHaveBeenCalledTimes(failAt);
    }
    for (const malformed of [[], {}, null, [null], [{}]]) {
      await expect(createLeadCallNotesAvailabilityReader(async () => ({ execute: async () => malformed })).read(request)).rejects.toThrow("invalid result");
    }
  });

  it("rejects invalid input before obtaining a DB", async () => {
    const h = harness();
    await expect(h.read({ leads: [{ key: "", sessionId: 42, phone }] } as LeadCallNotesAvailabilityInput)).rejects.toThrow();
    expect(h.getDb).not.toHaveBeenCalled();
  });

  it("has the same truth as the unchanged full popup reader on representative multi-source seeded data", async () => {
    const h = harness();
    const phones = Array.from({ length: 8 }, (_, i) => `+1703555${String(2000 + i)}`);
    phones.forEach((leadPhone, i) => h.insert("conversation_sessions", { id: i + 1, leadPhone }));
    h.insert("voice_calls", voice({ callerPhone: phones[0], summary: null }));
    h.insert("openphone_call_recordings", staff({ callerPhone: phones[1].slice(1), status: "no_answer" }));
    h.insert("call_log", outbound({ calledPhone: phones[2].slice(2), vapiCallId: null }));
    h.insert("voice_calls", voice({ callerPhone: phones[3], vapiCallId: "shared-id" }));
    h.insert("call_log", outbound({ calledPhone: phones[3], vapiCallId: "shared-id", firedAt: 0, createdAt: null }));
    h.insert("call_log", outbound({ calledPhone: phones[4], calledTarget: "team" }));
    h.insert("voice_calls", voice({ callerPhone: phones[5], createdAt: "invalid" }));
    h.insert("openphone_call_recordings", staff({ callerPhone: phones[6], callStartedAt: null }));
    const request = input(...phones.map((phone, i) => ({ key: String(i), sessionId: i + 1, phone })));
    const batch = await h.read(request);
    expect(h.queries).toHaveLength(4);
    for (let i = 0; i < request.leads.length; i++) {
      const lead = request.leads[i];
      const popup = await h.fullRead({ sessionId: lead.sessionId, phone: lead.phone });
      expect(batch.leads[i]).toEqual({ key: lead.key, hasCalls: popup.calls.length > 0 });
    }
    expect(batch.leads.map(lead => lead.hasCalls)).toEqual([true, true, true, true, false, false, false, false]);
  });

  it("production exporter lazily delegates to the mocked DB using the same tested availability reader", async () => {
    const h = harness(); h.insert("voice_calls", voice()); applicationDb.mockImplementation(h.getDb);
    expect(await getLeadCallNotesAvailability(input({ key: "production-seam", phone }))).toEqual({ leads: [{ key: "production-seam", hasCalls: true }] });
    expect(applicationDb).toHaveBeenCalledOnce(); expect(h.queries).toHaveLength(3);
  });
});
