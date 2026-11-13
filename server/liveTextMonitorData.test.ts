import { beforeEach, describe, expect, it, vi } from "vitest";
import { drizzle } from "drizzle-orm/mysql2";
import { eq } from "drizzle-orm";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { conversationSessions } from "../drizzle/schema";

const mocks = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("./db", () => ({ getDb: mocks.getDb }));
import { readLiveTextContext, readLiveTextFeed } from "./liveTextMonitorData";

type Row = Record<string, any>;
const PHONE = "+17035551234";
const LINE = "+12025551234";
const OTHER = "+13015551234";
const AT = "2026-11-13T15:00:00.000Z";
const MS = Date.parse(AT);
function message(content: unknown = "Actual text", extra: Row = {}): Row { return { role: "user", content, ts: MS, ...extra }; }
function session(id: number, history: unknown = [message()], extra: Row = {}): Row {
  return { id, leadPhone: PHONE, leadName: "Customer", messageHistory: JSON.stringify(history), updatedAt: AT, ...extra };
}

/** Only the mysql2 transport is mocked. Installed Drizzle builders, SQL
 * projections, bound parameters, row mapping and error wrapping execute offline.
 */
function offlineDb(initial: Row[] = []) {
  const state = structuredClone(initial);
  const statements: Array<{ sql: string; params: unknown[]; options: Row }> = [];
  let failure: unknown = null;
  const query = vi.fn(async (options: Row, params: unknown[] = []) => {
    const sql = options.sql as string;
    statements.push({ sql, params, options });
    if (failure) throw failure;
    const match = /^select (.+) from `conversation_sessions`(?: where (.+?))?(?: order by (.+?))? limit \?$/i.exec(sql);
    if (!match) throw new Error(`Unexpected ORM SQL: ${sql}`);
    const [, projection, where, order] = match;
    let rows = state.slice();
    if (where) {
      expect(where).toBe("`conversation_sessions`.`id` = ?");
      rows = rows.filter(row => row.id === params[0]);
    }
    if (order) {
      expect(order).toBe("`conversation_sessions`.`updatedAt` desc, `conversation_sessions`.`id` desc");
      rows.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt) || b.id - a.id);
    }
    rows = rows.slice(0, Number(params.at(-1)));
    const fields = projection.split(", ").map(expression => {
      const field = /^`([^`]+)`$/.exec(expression)?.[1];
      if (!field || !["id", "leadPhone", "leadName", "messageHistory", "updatedAt"].includes(field)) throw new Error("Unexpected projection");
      return field;
    });
    return [rows.map(row => fields.map(field => field === "updatedAt" && row[field]
      ? new Date(row[field]).toISOString().replace("T", " ").replace("Z", "") : row[field] ?? null)), []];
  });
  return { db: drizzle({ query } as any), state, query, statements, fail: (error: unknown) => { failure = error; } };
}

/** Run the ACTUAL read-only AI Team handler body extracted from the protected
 * source, with TypeScript erased and only getDb/Drizzle dependencies injected.
 */
function aiTeamHandler(db: ReturnType<typeof offlineDb>["db"]) {
  const source = readFileSync(new URL("./opsChatRouter.ts", import.meta.url), "utf8");
  const start = source.indexOf("  getSessionConversation: opsChatProcedure");
  expect(start).toBeGreaterThan(0);
  const block = source.slice(start, source.indexOf("\n    }),", start));
  const handler = block.slice(block.indexOf("async ({ input }) => {"));
  const compiled = ts.transpileModule(`const handler = ${handler};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  return new Function("getDb", "conversationSessions", "eq", `${compiled}\nreturn handler;`)(async () => db, conversationSessions, eq) as
    (args: { input: { sessionId: number; limit: number } }) => Promise<Array<{ role: string; content: string; ts: number }>>;
}

beforeEach(() => { mocks.getDb.mockReset(); mocks.getDb.mockResolvedValue(null); });

describe("AI Team stored text feed", () => {
  it("uses one ordinary Drizzle read of exactly the stored-session projection, without filtering status/source", async () => {
    const text = '<img src=x onerror="alert(1)">\n actual full text ';
    const mock = offlineDb([
      session(1, [message(text), message("Already answered", { role: "assistant", ts: MS + 1 })], {
        stage: "RESOLVED", lastMessageRole: "assistant", leadSource: "import", leadPhone: "(703) 555-1234", leadName: "<script>name</script>",
      }),
      session(2, [message("Imported historical text", { source: "openphone_reconcile", openPhoneId: "import-id" })], { stage: "BOOKED", aiMode: 0 }),
    ]);
    const before = structuredClone(mock.state);
    const feed = await readLiveTextFeed(mock.db);
    expect(feed).toMatchObject({ unavailable: false, partial: false });
    expect(feed).not.toHaveProperty("failure");
    expect(feed.rows).toHaveLength(3);
    expect(feed.rows.find(row => row.message.text === text)).toMatchObject({
      sessionId: 1, customerName: "<script>name</script>", identityAmbiguous: false,
      message: { sessionId: 1, customerPhone: PHONE, businessPhone: null, text, source: "conversation_history", timeBasis: "history", delivery: "received" },
    });
    expect(feed.rows.find(row => row.message.text === "Already answered")?.message.delivery).toBe("unknown");
    expect(feed.rows.every(row => row.key === row.message.key && /^session-text:[a-f0-9]{64}$/.test(row.key) && /^[a-f0-9]{64}$/.test(row.revision))).toBe(true);
    expect(mock.statements).toHaveLength(1);
    expect(mock.statements[0].sql).toBe("select `id`, `leadPhone`, `leadName`, `messageHistory`, `updatedAt` from `conversation_sessions` order by `conversation_sessions`.`updatedAt` desc, `conversation_sessions`.`id` desc limit ?");
    expect(mock.statements[0].params).toEqual([101]);
    expect(mock.statements[0].options).not.toHaveProperty("timeout");
    expect(mock.state).toEqual(before);
    expect(mocks.getDb).not.toHaveBeenCalled();
  });

  it("matches source-extracted AI Team last-20 text projection and chronological array order, not timestamp sorting", async () => {
    const stored = Array.from({ length: 24 }, (_, index) => message(index % 3 ? `Text ${index} ` : index, {
      role: index % 2 ? "assistant" : "user", ts: MS - index, senderName: "Staff",
    }));
    const mock = offlineDb([session(9, stored), session(8, [message("Wrong session")])]);
    const native = await aiTeamHandler(mock.db)({ input: { sessionId: 9, limit: 20 } });
    const feed = await readLiveTextFeed(mock.db);
    const row = feed.rows.find(value => value.sessionId === 9)!;
    const context = await readLiveTextContext(row.sessionId, row.key, mock.db);
    expect(context.messages.map(value => ({ role: value.direction === "outbound" ? "assistant" : "user", content: value.text })))
      .toEqual(native.map(value => ({ role: value.role, content: value.content })));
    expect(context.messages.map(value => value.occurredAt)).toEqual(native.map(value => new Date(value.ts).toISOString()));
    expect(context.messages).toHaveLength(20);
    expect(context.partial).toBe(false);
    expect(feed.partial).toBe(true);
    expect(context.row.revision).toBe(row.revision);
    expect(mock.statements[0]).toMatchObject({ sql: "select `messageHistory` from `conversation_sessions` where `conversation_sessions`.`id` = ? limit ?", params: [9, 1] });
    expect(mock.statements.at(-1)).toMatchObject({ params: [9, 1] });
    expect(mock.statements.at(-1)?.sql).toContain("where `conversation_sessions`.`id` = ?");
  });

  it("slices the stored last 20 before skipping notes/system roles, and keeps content conversion literal", async () => {
    const history = [message("Outside last20"), message("Also outside")].concat([
      message("Keep spaces \n "), message(123), message(false), message({ value: 1 }), message(["a", "b"]),
      message("Customer role", { role: "customer" }),
    ], Array.from({ length: 14 }, (_, index) => message(`Internal ${index}`, { role: index % 2 ? "system" : "note" })));
    const mock = offlineDb([session(1, history)]);
    const feed = await readLiveTextFeed(mock.db);
    const context = await readLiveTextContext(1, feed.rows[0].key, mock.db);
    expect(context.messages.map(value => value.text)).toEqual(["Keep spaces \n ", "123", "false", "[object Object]", "a,b", "Customer role"]);
    expect(context.partial).toBe(false);
    expect(context.messages.every(value => value.direction === "inbound")).toBe(true);
  });

  it("keeps a recent explicit request usable after more than 20 older messages", async () => {
    const old = Array.from({ length: 60 }, (_, index) => message(`Old ${index}`, { ts: MS - 60000 + index }));
    const recent = Array.from({ length: 19 }, (_, index) => message(`Recent ${index}`, { ts: MS + index }));
    const request = message("Please move my cleaning to November 14 at 9 AM.", { ts: MS + 20 });
    const mock = offlineDb([session(1, old.concat(recent, [request]))]);
    const feed = await readLiveTextFeed(mock.db);
    const row = feed.rows.find(value => value.message.text === request.content)!;
    const context = await readLiveTextContext(1, row.key, mock.db);
    expect(feed.partial).toBe(true);
    expect(context.partial).toBe(false);
    expect(context.row.identityAmbiguous).toBe(false);
    expect(context.messages.map(value => value.text)).toEqual(recent.concat([request]).map(value => value.content));
    expect(context.row.message).toEqual(context.messages.at(-1));
    expect(context.row.revision).toBe(row.revision);
  });

  it("preserves long full text with no SQL cap or interpreter clipping", async () => {
    const text = ('漢字😀\\\"\n').repeat(20000);
    const mock = offlineDb([session(1, [message(text), message("Reply", { role: "assistant" })])]);
    const feed = await readLiveTextFeed(mock.db);
    const row = feed.rows.find(value => value.message.text === text)!;
    const context = await readLiveTextContext(1, row.key, mock.db);
    expect(context.row.message.text).toBe(text);
    expect(context.messages.map(value => value.text)).toEqual([text, "Reply"]);
    expect(context.partial).toBe(false);
    expect(mock.statements.every(value => !value.sql.includes("octet_length"))).toBe(true);
  });

  it("keeps every equal text and repeated provider ID entry, including opposite roles and other sessions", async () => {
    const history = [message("Same"), message("Same"), message("Same", { opMsgId: "shared" }),
      message("Same", { opMsgId: "shared" }), message("Same", { role: "assistant", opMsgId: "shared" })];
    const mock = offlineDb([session(1, history), session(2, [message("Same", { opMsgId: "shared" })])]);
    const feed = await readLiveTextFeed(mock.db);
    expect(feed.rows).toHaveLength(6);
    expect(new Set(feed.rows.map(value => value.key)).size).toBe(6);
    for (const row of feed.rows) {
      const context = await readLiveTextContext(row.sessionId, row.key, mock.db);
      expect(context.row.key).toBe(row.key);
      expect(context.row.revision).toBe(row.revision);
      expect(context.messages.filter(value => value.key === row.key)).toHaveLength(1);
      expect(context.messages).toHaveLength(row.sessionId === 1 ? 5 : 1);
    }
    expect((await readLiveTextFeed(mock.db)).rows.map(value => value.key)).toEqual(feed.rows.map(value => value.key));
  });

  it("marks malformed sessions/envelopes skipped but does not turn them into an unavailable database", async () => {
    const mock = offlineDb([
      session(1, [], { messageHistory: "{" }), session(2, { role: "user" }), session(3, null),
      session(4, [], { messageHistory: null }), session(5, [message("Valid"), null, 5, [], {}, message(null), message("   "),
        message("Malformed role", { role: { toString: null } }), message({ toString: null })]),
      session(6, [message("No valid session phone")], { leadPhone: "+447035551234" }),
      session(7, [message("Do not strip arbitrary letters")], { leadPhone: "call 7035551234" }),
    ]);
    const feed = await readLiveTextFeed(mock.db);
    expect(feed).toMatchObject({ partial: true, unavailable: false });
    expect(feed.rows.map(value => value.message.text)).toEqual(["Valid"]);
    expect(feed).not.toHaveProperty("failure");
    await expect(readLiveTextContext(1, feed.rows[0].key, mock.db)).rejects.toThrow("missing");
  });

  it.each([undefined, null, 0, "2026-11-13T15:00:00", "2026-02-30T15:00:00Z", "2026-13-13T15:00:00Z", "2026-11-13T24:00:00Z", "2026-11-13T15:00:00+00:60", "1794582000000"])("keeps full text without fabricating a timestamp for %s", async value => {
    const mock = offlineDb([session(1, [message("Visible without time", { ts: value, createdAt: AT, opMsgId: "provider-id" })])]);
    const feed = await readLiveTextFeed(mock.db);
    expect(feed.rows[0].message).toMatchObject({ text: "Visible without time", occurredAt: null, observedAt: null,
      timeBasis: "unknown", source: "conversation_history", delivery: "received" });
    expect(feed.partial).toBe(true);
  });

  it("keeps ms and imported timestamp fallbacks as history, never provider occurrence", async () => {
    const mock = offlineDb([session(1, [message("ts ms"), message("timestamp", { ts: null, timestamp: "2026-11-13T10:00:00-05:00" }),
      message("Imported createdAt", { ts: null, source: "openphone_reconcile", createdAt: AT, openPhoneId: "import" })])]);
    const feed = await readLiveTextFeed(mock.db);
    expect(feed.rows.every(value => value.message.timeBasis === "history" && value.message.source === "conversation_history"
      && value.message.occurredAt === AT && value.message.observedAt === AT)).toBe(true);
  });

  it("requires explicit real sent/delivered status for assistants, never just opMsgId or import/source", async () => {
    const cases = [
      [{ opMsgId: "m1" }, "unknown"], [{ source: "command_center", openPhoneId: "m2" }, "unknown"],
      [{ source: "openphone_reconcile", openPhoneId: "m3" }, "unknown"], [{ status: "sent" }, "sent"],
      [{ deliveryStatus: "delivered" }, "delivered"], [{ metadata: { status: "sent" } }, "sent"],
      [{ status: "queued" }, "unknown"], [{ status: "failed", deliveryStatus: "delivered" }, "unknown"],
      [{ status: "pending" }, "unknown"], [{ status: "sending" }, "unknown"], [{ status: "undelivered" }, "unknown"],
    ] as const;
    const mock = offlineDb([session(1, cases.map(([extra], index) => message(String(index), { role: "assistant", ...extra })))]);
    const feed = await readLiveTextFeed(mock.db);
    for (const [index, [, expected]] of cases.entries()) {
      expect(feed.rows.find(value => value.message.text === String(index))?.message).toMatchObject({ delivery: expected, source: "conversation_history", timeBasis: "history" });
    }
  });

  it("reads at most 100 sessions plus a sentinel and returns the latest 100 message rows", async () => {
    const mock = offlineDb(Array.from({ length: 115 }, (_, index) => session(index + 1, [message(`Text ${index + 1}`)])));
    const feed = await readLiveTextFeed(mock.db);
    expect(feed.rows).toHaveLength(100);
    expect(feed.rows[0].sessionId).toBe(115);
    expect(feed.rows.at(-1)?.sessionId).toBe(16);
    expect(feed.partial).toBe(true);
    expect(mock.statements).toHaveLength(1);
    expect(mock.statements[0].params).toEqual([101]);
    const many = offlineDb(Array.from({ length: 10 }, (_, index) => session(index + 1,
      Array.from({ length: 20 }, (_, offset) => message(`Text ${index}:${offset}`, { ts: MS + offset })) )));
    const latest = await readLiveTextFeed(many.db);
    expect(latest.rows).toHaveLength(100);
    expect(latest.rows[0].message.text).toBe("Text 9:19");
    expect(latest.rows.at(-1)?.message.text).toBe("Text 0:10");
    expect(latest.partial).toBe(true);
  });

  it("honestly distinguishes complete empty history and exactly 100 sessions from overflow", async () => {
    expect(await readLiveTextFeed(offlineDb().db)).toMatchObject({ rows: [], partial: false, unavailable: false });
    const mock = offlineDb(Array.from({ length: 100 }, (_, index) => session(index + 1, [])));
    expect(await readLiveTextFeed(mock.db)).toMatchObject({ rows: [], partial: false, unavailable: false });
    mock.state.push(session(101, []));
    expect(await readLiveTextFeed(mock.db)).toMatchObject({ rows: [], partial: true, unavailable: false });
  });

  it("freshly overlap-rereads stored sessions without a cursor or cache", async () => {
    const mock = offlineDb([session(10)]);
    const first = await readLiveTextFeed(mock.db);
    mock.state.push(session(9, [message("Late committed text")]));
    const second = await readLiveTextFeed(mock.db);
    expect(first.rows).toHaveLength(1);
    expect(second.rows).toHaveLength(2);
    expect(mock.query).toHaveBeenCalledTimes(2);
    expect(mock.statements[0].sql).toBe(mock.statements[1].sql);
    expect(mock.statements[0].params).toEqual(mock.statements[1].params);
  });
});

describe("exact session-owned context and metadata", () => {
  it.each([0, -1, 1.2, NaN, Infinity, 2147483648, Number.MAX_SAFE_INTEGER, "1", null])("rejects invalid session ID %s before any read", async id => {
    const mock = offlineDb();
    await expect(readLiveTextContext(id as number, `session-text:${"a".repeat(64)}`, mock.db)).rejects.toThrow("Invalid");
    expect(mock.query).not.toHaveBeenCalled(); expect(mocks.getDb).not.toHaveBeenCalled();
  });

  it.each(["", "live-text:abc", "session-text:abc", `session-text:${"A".repeat(64)}`, `session-text:${"a".repeat(65)}`, null, 1])("rejects invalid message key %s before any read", async key => {
    const mock = offlineDb();
    await expect(readLiveTextContext(1, key as string, mock.db)).rejects.toThrow("Invalid");
    expect(mock.query).not.toHaveBeenCalled(); expect(mocks.getDb).not.toHaveBeenCalled();
  });

  it("never merges same-phone/name/provider-ID siblings or accepts a sibling's message key", async () => {
    const mock = offlineDb([session(1, [message("Exact session", { opMsgId: "shared" })]),
      session(2, [message("Same phone sibling", { opMsgId: "shared" })]),
      session(3, [message("Other phone same name", { opMsgId: "shared" })], { leadPhone: OTHER })]);
    const feed = await readLiveTextFeed(mock.db);
    const row = feed.rows.find(value => value.sessionId === 1)!;
    const context = await readLiveTextContext(1, row.key, mock.db);
    expect(context.messages.map(value => value.text)).toEqual(["Exact session"]);
    expect(context.row.message.customerPhone).toBe(PHONE);
    await expect(readLiveTextContext(2, row.key, mock.db)).rejects.toThrow("missing");
    await expect(readLiveTextContext(999, row.key, mock.db)).rejects.toThrow("missing");
    await expect(readLiveTextContext(1, `session-text:${"a".repeat(64)}`, mock.db)).rejects.toThrow("missing");
  });

  it("finds exact sessions outside the feed but fails closed once the clicked entry leaves last20", async () => {
    const mock = offlineDb(Array.from({ length: 102 }, (_, index) => session(index + 1)));
    const native = await aiTeamHandler(mock.db)({ input: { sessionId: 1, limit: 20 } });
    expect(native).toHaveLength(1);
    const local = offlineDb([session(1)]);
    const row = (await readLiveTextFeed(local.db)).rows[0];
    const context = await readLiveTextContext(1, row.key, mock.db);
    expect(context.row.sessionId).toBe(1);
    mock.state[0].messageHistory = JSON.stringify([message()].concat(Array.from({ length: 20 }, (_, index) => message(`New ${index}`))));
    await expect(readLiveTextContext(1, row.key, mock.db)).rejects.toThrow("missing");
  });

  it("retains explicit per-message business lines and isolates each line without inventing one", async () => {
    const mock = offlineDb([session(1, [message("Line A", { businessPhone: "(202) 555-1234", from: PHONE, to: LINE }),
      message("Reply A", { role: "assistant", metadata: { businessPhone: LINE }, fromPhone: LINE, toPhone: PHONE }),
      message("Line B", { businessPhone: OTHER }), message("Unknown line", { from: PHONE, to: LINE })])]);
    const feed = await readLiveTextFeed(mock.db);
    const a = feed.rows.find(value => value.message.text === "Line A")!;
    expect(a.message.businessPhone).toBe(LINE);
    expect(a.identityAmbiguous).toBe(false);
    const context = await readLiveTextContext(1, a.key, mock.db);
    expect(context.messages.map(value => value.text)).toEqual(["Line A", "Reply A"]);
    expect(context.partial).toBe(true);
    const unknown = feed.rows.find(value => value.message.text === "Unknown line")!;
    expect(unknown.message.businessPhone).toBeNull();
    expect((await readLiveTextContext(1, unknown.key, mock.db)).messages.map(value => value.text)).toEqual(["Unknown line"]);
  });

  it.each([
    { customerPhone: OTHER }, { fromPhone: OTHER }, { to: [LINE, OTHER] },
    { to: LINE, toPhone: OTHER }, { to: PHONE },
    { businessPhone: LINE, metadata: { businessPhone: OTHER } }, { businessPhone: "invalid" },
    { businessPhone: PHONE }, { sessionId: 2 }, { direction: "outgoing" }, { opMsgId: "one", openPhoneId: "two" },
  ])("flags contradictory explicit metadata without changing the canonical session customer: %j", async metadata => {
    const mock = offlineDb([session(1, [message("Still show actual text", metadata)]), session(2, [message("Do not select me")], { leadPhone: OTHER })]);
    const feed = await readLiveTextFeed(mock.db);
    const row = feed.rows.find(value => value.sessionId === 1)!;
    expect(row.identityAmbiguous).toBe(true);
    expect(row.message.customerPhone).toBe(PHONE);
    expect(row.message.text).toBe("Still show actual text");
    expect(feed.partial).toBe(true);
    const context = await readLiveTextContext(1, row.key, mock.db);
    expect(context.row.identityAmbiguous).toBe(true);
    expect(context.messages.map(value => value.text)).toEqual(["Still show actual text"]);
  });

  it("binds text, status metadata, name, phone, line, and stored context changes into fresh revisions", async () => {
    const mock = offlineDb([session(1, [message("Anchor", { role: "assistant", opMsgId: "stable", status: "queued" })])]);
    const row = (await readLiveTextFeed(mock.db)).rows[0];
    let previous = row.revision;
    const checkChanged = async () => {
      const context = await readLiveTextContext(1, row.key, mock.db);
      expect(context.row.key).toBe(row.key);
      expect(context.row.revision).not.toBe(previous);
      expect((await readLiveTextFeed(mock.db)).rows.find(value => value.key === row.key)?.revision).toBe(context.row.revision);
      previous = context.row.revision;
    };
    const updateHistory = (change: (history: Row[]) => void) => {
      const history = JSON.parse(mock.state[0].messageHistory); change(history); mock.state[0].messageHistory = JSON.stringify(history);
    };
    updateHistory(history => { history[0].status = "failed"; }); await checkChanged();
    updateHistory(history => { history[0].content = "Changed full actual text"; }); await checkChanged();
    updateHistory(history => { history.push(message("New context")); }); await checkChanged();
    mock.state[0].leadName = "Changed name"; await checkChanged();
    mock.state[0].leadPhone = "(703) 555-1234"; await checkChanged();
    updateHistory(history => { history[0].businessPhone = LINE; }); await checkChanged();
    updateHistory(history => { history[0].senderName = "New sender metadata"; }); await checkChanged();
    mock.state[0].updatedAt = "2026-11-13T15:00:01.000Z"; await checkChanged();
  });
});

describe("honest fixed database failures and read-only boundaries", () => {
  it.each([
    ["ER_BAD_FIELD_ERROR", "DB_SCHEMA"], ["ER_NO_SUCH_TABLE", "DB_SCHEMA"], ["ER_BAD_DB_ERROR", "DB_SCHEMA"],
    ["ETIMEDOUT", "DB_TIMEOUT"], ["ER_QUERY_TIMEOUT", "DB_TIMEOUT"], ["ER_LOCK_WAIT_TIMEOUT", "DB_TIMEOUT"],
    ["ECONNREFUSED", "DB_UNAVAILABLE"], ["ER_ACCESS_DENIED_ERROR", "DB_UNAVAILABLE"],
    ["ER_PARSE_ERROR", "DB_READ_FAILED"], ["unknown", "DB_READ_FAILED"],
  ])("returns %s as %s through actual Drizzle cause wrapping, with one read and no detail leaks", async (code, expected) => {
    const mock = offlineDb([session(1)]);
    mock.fail(Object.assign(new Error(`confidential SQL ${PHONE}`), { code }));
    const feed = await readLiveTextFeed(mock.db);
    expect(feed).toMatchObject({ rows: [], partial: true, unavailable: true, failure: expected });
    expect(JSON.stringify(feed)).not.toContain("confidential");
    expect(mock.query).toHaveBeenCalledOnce();
    const error = await readLiveTextContext(1, `session-text:${"a".repeat(64)}`, mock.db).catch(value => value);
    expect(error.reason).toBe(expected);
    expect(error.message).not.toContain(PHONE); expect(error.message).not.toContain("confidential");
    expect(error).not.toHaveProperty("cause");
    expect(mock.query).toHaveBeenCalledTimes(2);
  });

  it("does not classify by message substrings and handles nested/cyclic causes without retry", async () => {
    const mock = offlineDb([session(1)]);
    mock.fail(new Error("ER_BAD_FIELD_ERROR ETIMEDOUT confidential"));
    expect((await readLiveTextFeed(mock.db)).failure).toBe("DB_READ_FAILED");
    mock.fail({ cause: { cause: { code: "ETIMEDOUT" } } });
    expect((await readLiveTextFeed(mock.db)).failure).toBe("DB_TIMEOUT");
    const cyclic: Row = {}; cyclic.cause = cyclic; mock.fail(cyclic);
    expect((await readLiveTextFeed(mock.db)).failure).toBe("DB_READ_FAILED");
    expect(mock.query).toHaveBeenCalledTimes(3);
  });

  it("only uses the existing getDb when injection is absent, and reports unavailable honestly", async () => {
    expect(await readLiveTextFeed()).toMatchObject({ rows: [], partial: true, unavailable: true, failure: "DB_UNAVAILABLE" });
    expect(mocks.getDb).toHaveBeenCalledOnce();
    await expect(readLiveTextContext(1, `session-text:${"a".repeat(64)}`)).rejects.toMatchObject({ reason: "DB_UNAVAILABLE" });
    const mock = offlineDb([session(1)]); mocks.getDb.mockResolvedValue(mock.db);
    expect((await readLiveTextFeed()).rows).toHaveLength(1);
    mocks.getDb.mockRejectedValue({ cause: { code: "ETIMEDOUT" } });
    expect((await readLiveTextFeed()).failure).toBe("DB_TIMEOUT");
  });

  it("has no provider/capture/snapshot/timeout/cache/writer path; all executed SQL is ordinary SELECT", async () => {
    const source = readFileSync(new URL("./liveTextMonitorData.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/webhook_events|rawPayload|captureId|readAuditSnapshot|AuditSnapshotError|\$client|setTimeout|Promise\.race|setInterval|fetch\(|invokeLLM|openPhoneClient|highWater|new Map.*cache/i);
    expect(source).not.toMatch(/\.insert\(|\b(?:db|database|reader)\.update\(|\.delete\(|\.transaction\(|\b(?:INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM|CREATE\s+TABLE|ALTER\s+TABLE)\b/i);
    const mock = offlineDb([session(1)]);
    const row = (await readLiveTextFeed(mock.db)).rows[0]; await readLiveTextContext(1, row.key, mock.db);
    expect(mock.statements).toHaveLength(2);
    expect(mock.statements.every(value => /^select /i.test(value.sql) && value.sql.includes("from `conversation_sessions`") && !value.options.timeout)).toBe(true);
  });
});
