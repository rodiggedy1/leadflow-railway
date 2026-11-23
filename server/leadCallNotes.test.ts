import { afterEach, describe, expect, it, vi } from "vitest";
import type { DatabaseSync as MemoryDb } from "node:sqlite";
import { createRequire } from "node:module";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { type SQL } from "drizzle-orm";
import { readFileSync } from "node:fs";
import { customerTaskSchema } from "../shared/claudeCustomerTasks";
import { leadCallNotesInputSchema } from "../shared/leadCallNotes";
import { createLeadCallNotesReader, getLeadCallNotes } from "./leadCallNotes";

const applicationDb = vi.hoisted(() => vi.fn());
vi.mock("./db", () => ({ getDb: applicationDb }));
const phone = "+17035551234", other = "+17035559876", now = 1760000000000;
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");
const handles: MemoryDb[] = [];
afterEach(() => { handles.splice(0).forEach(db => db.close()); applicationDb.mockReset(); });
type Row = Record<string, any>;
function harness() {
  const memory = new DatabaseSync(":memory:"); handles.push(memory);
  memory.exec(`CREATE TABLE conversation_sessions (id INTEGER, leadPhone TEXT);
    CREATE TABLE voice_calls (id INTEGER, vapiCallId TEXT, sessionId INTEGER, callerPhone TEXT, durationSeconds INTEGER,
      transcript TEXT, summary TEXT, outcome TEXT, structuredData TEXT, endedReason TEXT, createdAt TEXT);
    CREATE TABLE openphone_call_recordings (id INTEGER, sessionId INTEGER, openphoneCallId TEXT, callerPhone TEXT,
      direction TEXT, durationSeconds INTEGER, status TEXT, callStartedAt TEXT, transcript TEXT, scoreData TEXT);
    CREATE TABLE call_log (id INTEGER, calledPhone TEXT, calledTarget TEXT, vapiCallId TEXT, transcript TEXT, status TEXT,
      firedAt INTEGER, completedAt INTEGER, durationSeconds INTEGER, notes TEXT, createdAt TEXT);
    CREATE TABLE ops_chat_messages (id INTEGER, channel TEXT, quickAction TEXT, sessionId INTEGER, metadata TEXT);`);
  memory.function("JSON_VALID", value => { try { JSON.parse(String(value)); return 1; } catch { return 0; } });
  memory.function("JSON_EXTRACT", (value, path) => {
    const selected = String(path).slice(2).split(".").reduce((data, key) => data?.[key], JSON.parse(String(value)));
    return selected === undefined ? null : JSON.stringify(selected);
  });
  memory.function("JSON_UNQUOTE", value => value == null ? null : String(JSON.parse(String(value))));
  memory.function("UNIX_TIMESTAMP", value => new Date(String(value)).getTime() / 1000);
  const queries: ReturnType<MySqlDialect["sqlToQuery"]>[] = [];
  const execute = vi.fn(async (sql: SQL) => {
    const query = new MySqlDialect().sqlToQuery(sql); queries.push(query);
    return [memory.prepare(query.sql).all(...query.params as any[]), []];
  });
  const getDb = vi.fn(async () => ({ execute }));
  const read = createLeadCallNotesReader(getDb).read;
  function insert(table: string, row: Row) {
    const keys = Object.keys(row);
    memory.prepare(`INSERT INTO ${table} (${keys.join(",")}) VALUES (${keys.map(() => "?").join(",")})`).run(...Object.values(row));
  }
  return { memory, queries, execute, getDb, read, insert };
}
function voice(overrides: Row = {}): Row {
  return { id: 1, vapiCallId: "vapi-1", sessionId: 42, callerPhone: phone, durationSeconds: 65,
    transcript: "Caller: I need a deep clean.", summary: "Customer requested a deep clean.", outcome: "quote_given",
    structuredData: JSON.stringify({ intent: "quote", bedrooms: 2, selectedExtras: ["oven"] }), endedReason: null,
    createdAt: new Date(now).toISOString(), ...overrides };
}
function staff(overrides: Row = {}): Row {
  return { id: 2, sessionId: 42, openphoneCallId: "ACstaff-2", callerPhone: phone, direction: "outgoing",
    durationSeconds: 20, status: "completed", callStartedAt: new Date(now + 1000).toISOString(),
    transcript: '[{"identifier":"opaque-id","content":"Please call Friday.","start":0,"end":2}]',
    scoreData: '{"summary":"Staff discussed a callback."}', ...overrides };
}
function outbound(overrides: Row = {}): Row {
  return { id: 3, calledPhone: phone, calledTarget: "client", vapiCallId: "vapi-3", transcript: "Original outbound words.",
    status: "completed", firedAt: now + 2000, completedAt: now + 2500, durationSeconds: 10,
    notes: "Dispatcher asked to check availability.", createdAt: new Date(now).toISOString(), ...overrides };
}
function task(id = 10, provider = "vapi", overrides: Row = {}): Row {
  return { id, version: 1, kind: "claude_customer_task", sessionId: 42, customerName: "Synthetic", customerPhone: phone,
    sourceMessageId: "call-source", sourceText: "Please call Friday.", receivedAt: now, receivingPhoneNumberId: null,
    receivingPhoneNumber: null, title: "Follow up", items: [
      { id: "item-1", title: "Call Friday", evidenceQuote: "Please call Friday.", completedBy: null, completedAt: null },
      { id: "item-2", title: "Confirm extras", evidenceQuote: "I need the oven.", completedBy: { id: "a", name: "Agent" }, completedAt: now },
    ], status: "unclaimed", owner: null, claimedAt: null, completedAt: null, completedBy: null, completionNote: null,
    reply: { text: "", status: "not_applicable", providerMessageId: null }, activity: [],
    call: provider === "vapi" ? { provider, providerCallId: "vapi-1", voiceCallId: 1,
      transcript: "Please call Friday.", recordingUrl: null, callbackTaskIds: [] }
      : { provider: "openphone", providerCallId: "ACstaff-2", recordingId: 2, transcript: "Please call Friday.",
        recordingUrl: null, businessPhoneNumberId: "PNbusiness", businessPhoneNumber: "+17035550000", staffUserId: null, direction: "outgoing" },
    ...overrides };
}
function taskRow(value: Row, overrides: Row = {}): Row {
  return { id: value.id, channel: "command", quickAction: "claude_customer_task", sessionId: value.sessionId,
    metadata: JSON.stringify({ taskId: value.id, task: value }), ...overrides };
}

describe("lead call notes: passive, scoped existing-analysis reader", () => {
  it("exports the strict agreed schema, safe integer guard and null defaults", () => {
    expect(leadCallNotesInputSchema.parse({})).toEqual({ sessionId: null, phone: null });
    for (const input of [{ sessionId: 0 }, { sessionId: 1.5 }, { sessionId: Number.MAX_SAFE_INTEGER + 1 }, { extra: true }]) {
      expect(leadCallNotesInputSchema.safeParse(input).success).toBe(false);
    }
    expect(applicationDb).not.toHaveBeenCalled();
  });
  it("merges Madison, staff and client outbound calls newest first with honest stored text", async () => {
    const h = harness(); h.insert("voice_calls", voice()); h.insert("openphone_call_recordings", staff()); h.insert("call_log", outbound());
    const result = await h.read({ sessionId: null, phone });
    expect(result.phone).toBe(phone); expect(result.calls.map(c => c.source)).toEqual(["outbound_ai", "staff", "madison"]);
    expect(result.calls[0]).toMatchObject({ summary: null, direction: "outgoing", transcript: "Original outbound words.",
      details: [{ label: "Staff note", value: "Dispatcher asked to check availability." }] });
    expect(result.calls[1].transcript).toBe(staff().transcript);
    expect(result.calls[1].summary).toBe("Staff discussed a callback.");
    expect(result.calls[2].details).toContainEqual({ label: "Bedrooms", value: "2" });
  });
  it("binds the exact session's phone, not a newer same-customer session or corrupt session-only call", async () => {
    const h = harness(); h.insert("conversation_sessions", { id: 42, leadPhone: "(703) 555-1234" });
    h.insert("conversation_sessions", { id: 99, leadPhone: other });
    h.insert("voice_calls", voice({ sessionId: 99 })); h.insert("voice_calls", voice({ id: 9, vapiCallId: "wrong", callerPhone: other }));
    expect((await h.read({ sessionId: 42, phone: "17035551234" })).calls.map(c => c.providerCallId)).toEqual(["vapi-1"]);
    expect(h.queries[0]).toMatchObject({ params: [42] });
    expect(h.queries[0].sql).toMatch(/WHERE id = \? LIMIT 1/);
  });
  it("rejects mismatched UI phone before all history reads", async () => {
    const h = harness(); h.insert("conversation_sessions", { id: 42, leadPhone: phone });
    await expect(h.read({ sessionId: 42, phone: other })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(h.queries).toHaveLength(1);
    await expect(h.read({ sessionId: 42, phone: "invalid" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(h.queries).toHaveLength(2);
  });
  it.each([null, "", "invalid", "+447911123456", "1234567890"])("invalid/no native-card phone %s obtains no DB", async invalid => {
    const h = harness(); expect(await h.read({ sessionId: null, phone: invalid })).toEqual({ phone: null, calls: [] });
    expect(h.getDb).not.toHaveBeenCalled(); expect(h.queries).toHaveLength(0);
  });
  it("missing or invalid session phone does not fall back to UI or unfiltered history", async () => {
    const h = harness(); h.insert("conversation_sessions", { id: 42, leadPhone: "invalid" });
    expect(await h.read({ sessionId: 42, phone: null })).toEqual({ phone: null, calls: [] });
    expect(await h.read({ sessionId: 99, phone: null })).toEqual({ phone: null, calls: [] });
    await expect(h.read({ sessionId: 99, phone })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(h.queries).toHaveLength(3);
  });
  it("native cards need no session and match only complete canonical, 10-digit or 11-digit forms", async () => {
    const h = harness(); [phone, "7035551234", "17035551234", "+447035551234", other].forEach((stored, i) => {
      h.insert("voice_calls", voice({ id: i + 1, vapiCallId: `v${i}`, callerPhone: stored }));
    });
    expect((await h.read({ sessionId: null, phone: "703-555-1234" })).calls).toHaveLength(3);
    expect(h.queries).toHaveLength(4);
  });
  it("never includes team-targeted outbound calls", async () => {
    const h = harness(); h.insert("call_log", outbound({ calledTarget: "team" }));
    expect((await h.read({ sessionId: null, phone })).calls).toEqual([]);
  });
  it("attaches exact canonical call tasks for both providers with done/open item status", async () => {
    const h = harness(); h.insert("voice_calls", voice()); h.insert("openphone_call_recordings", staff());
    for (const value of [task(), task(11, "openphone")]) {
      customerTaskSchema.parse(value); h.insert("ops_chat_messages", taskRow(value));
    }
    const calls = (await h.read({ sessionId: null, phone })).calls;
    for (const call of calls) expect(call.followUps.map(f => [f.title, f.evidenceQuote, f.status])).toEqual([
      ["Call Friday", "Please call Friday.", "open"], ["Confirm extras", "I need the oven.", "done"],
    ]);
  });
  it("keeps completed task items and truthful staff completion notes", async () => {
    const h = harness(); h.insert("voice_calls", voice());
    h.insert("ops_chat_messages", taskRow(task(10, "vapi", { status: "done", completionNote: "Staff confirmed callback." })));
    const [call] = (await h.read({ sessionId: null, phone })).calls;
    expect(call.followUps.map(f => f.status)).toEqual(["done", "done"]);
    expect(call.details).toContainEqual({ label: "Staff completion note", value: "Staff confirmed callback." });
  });
  it("allows null task sessions only when metadata and row agree", async () => {
    const h = harness(); h.insert("voice_calls", voice());
    h.insert("ops_chat_messages", taskRow(task(10, "vapi", { sessionId: null })));
    h.insert("ops_chat_messages", taskRow(task(11), { sessionId: null }));
    h.insert("ops_chat_messages", taskRow(task(12, "vapi", { sessionId: null }), { sessionId: 42 }));
    expect((await h.read({ sessionId: null, phone })).calls[0].followUps.map(f => f.taskId)).toEqual([10, 10]);
  });
  it("excludes wrong provider, call ID, row ID, phone, envelope ID, session, malformed and non-call tasks", async () => {
    const h = harness(); h.insert("voice_calls", voice()); h.insert("openphone_call_recordings", staff());
    const wrongRows = [
      taskRow(task(10, "openphone", { call: { ...task(10, "openphone").call, providerCallId: "ACwrong" } })),
      taskRow(task(11, "vapi", { call: { ...task().call, providerCallId: "ACstaff-2" } })),
      taskRow(task(12, "vapi", { call: { ...task().call, voiceCallId: 999 } })),
      taskRow(task(13, "vapi", { customerPhone: other })),
      taskRow(task(14), { metadata: JSON.stringify({ taskId: 999, task: task(14) }) }),
      taskRow(task(15), { id: 999 }), taskRow(task(16), { sessionId: 99 }),
      taskRow(task(17), { metadata: "{broken" }), taskRow(task(18), { channel: "general" }),
      taskRow(task(19), { quickAction: "other" }),
      taskRow(task(20, "openphone", { call: { ...task(20, "openphone").call, recordingId: 999 } })),
    ];
    const sms = task(21); delete sms.call;
    Object.assign(sms, { receivingPhoneNumberId: "PNb", receivingPhoneNumber: "+17035550000",
      reply: { text: "SMS only", status: "sent", providerMessageId: "SM1" } });
    const email = { ...sms, id: 22, sessionId: null, customerPhone: null, receivingPhoneNumberId: null, receivingPhoneNumber: null,
      email: { mailboxEmail: "office@example.com", threadId: "thread", fromEmail: "customer@example.com", replyToEmail: null,
        recipientEmail: "office@example.com", subject: "Call", rfcMessageId: "id" } };
    customerTaskSchema.parse(sms); customerTaskSchema.parse(email);
    for (const row of [...wrongRows, taskRow(sms), taskRow(email)]) h.insert("ops_chat_messages", row);
    expect((await h.read({ sessionId: null, phone })).calls.every(c => c.followUps.length === 0)).toBe(true);
  });
  it("does not invent summaries, needs, coaching facts or speaker roles from malformed analysis", async () => {
    const h = harness(); h.insert("voice_calls", voice({ summary: null, structuredData: "{broken" }));
    h.insert("openphone_call_recordings", staff({ scoreData: '{"coachingTips":["Offer a discount"]}', transcript: "Whisper original words." }));
    const calls = (await h.read({ sessionId: null, phone })).calls;
    expect(calls.every(c => c.summary === null && c.details.length === 0)).toBe(true);
    expect(calls[0].transcript).toBe("Whisper original words.");
  });
  it("whitelists scalar structured analysis without exposing arbitrary objects", async () => {
    const h = harness(); h.insert("voice_calls", voice({ structuredData: JSON.stringify({ intent: "quote", bedrooms: 0,
      address: { guessed: "not a fact" }, preferredDate: "Friday", secret: "no", selectedExtras: ["oven", { guessed: "no" }] }) }));
    const [call] = (await h.read({ sessionId: null, phone })).calls;
    expect(call.details).toEqual([{ label: "Intent", value: "quote" }, { label: "Bedrooms", value: "0" },
      { label: "Preferred date", value: "Friday" }, { label: "Selected extras", value: "oven" }]);
  });
  it("deduplicates shared Vapi IDs, prefers full voice analysis and preserves outbound transcript/direction", async () => {
    const h = harness(); h.insert("voice_calls", voice()); h.insert("call_log", outbound({ vapiCallId: "vapi-1" }));
    h.insert("call_log", outbound({ id: 4, vapiCallId: "different", firedAt: now - 1000 }));
    h.insert("ops_chat_messages", taskRow(task()));
    const calls = (await h.read({ sessionId: null, phone })).calls;
    expect(calls).toHaveLength(2); expect(calls[0]).toMatchObject({ source: "outbound_ai", direction: "outgoing",
      summary: voice().summary, transcript: outbound().transcript, startedAt: now + 2000 });
    expect(calls[0].followUps).toHaveLength(2);
  });
  it("limits each source and final merged history to the newest 100 calls with proper date conversion", async () => {
    const h = harness(); for (let i = 1; i <= 105; i++) h.insert("voice_calls", voice({ id: i, vapiCallId: `v${i}`, createdAt: new Date(now + i).toISOString() }));
    h.insert("call_log", outbound({ firedAt: null, createdAt: new Date(now + 2000).toISOString() }));
    const calls = (await h.read({ sessionId: null, phone })).calls;
    expect(calls).toHaveLength(100); expect(calls[0].startedAt).toBe(now + 2000); expect(calls[1].providerCallId).toBe("v105");
    expect(calls.at(-1)?.providerCallId).toBe("v7");
    for (const query of h.queries) expect(query.sql).toMatch(/ORDER BY[\s\S]+LIMIT 100/);
  });
  it("uses bounded SELECT-only exact phone SQL without broad matching or operational columns", async () => {
    const h = harness(); await h.read({ sessionId: null, phone });
    const forbidden = new RegExp(["cleaner" + "_jobs", "cleaner" + "Jobs", "cleanerJobId", "teamId", "jobDate", "LIKE", "UPDATE", "INSERT", "DELETE", "recordingUrl"].join("|"), "i");
    for (const query of h.queries) {
      expect(query.sql.trim()).toMatch(/^SELECT /); expect(query.sql).not.toMatch(/SELECT \*/); expect(query.sql).not.toMatch(forbidden);
      expect(query.params).toContain(phone); expect(query.sql).toMatch(/WHERE[\s\S]+IN \(/);
    }
    expect(h.queries[3].sql).toContain("$.task.customerPhone"); expect(h.queries[3].sql).toContain("$.task.call.provider");
    const source = readFileSync(new URL("./leadCallNotes.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(new RegExp("cleaner" + "_jobs|cleaner" + "Jobs"));
  });
  it("throws DB absence and query failures instead of returning misleading empty history", async () => {
    await expect(createLeadCallNotesReader(async () => null).read({ sessionId: null, phone })).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
    const execute = vi.fn(async () => { throw new Error("offline database failure"); });
    await expect(createLeadCallNotesReader(async () => ({ execute })).read({ sessionId: null, phone })).rejects.toThrow("offline database failure");
    await expect(createLeadCallNotesReader(async () => ({ execute: async () => [] })).read({ sessionId: null, phone })).rejects.toThrow("invalid result");
  });
  it("production exporter lazily uses existing getDb with the same tested SQL reader", async () => {
    const h = harness(); h.insert("voice_calls", voice()); applicationDb.mockImplementation(h.getDb);
    expect((await getLeadCallNotes({ sessionId: null, phone })).calls).toHaveLength(1);
    expect(applicationDb).toHaveBeenCalledOnce(); expect(h.queries).toHaveLength(4);
  });
});
