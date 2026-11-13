import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { drizzle } from "drizzle-orm/mysql2";
import { readFileSync } from "node:fs";
import { normalizePhone } from "./utils/phone";

const mocks = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("./db", () => ({ getDb: mocks.getDb }));
import { readLiveTextContext, readLiveTextFeed } from "./liveTextMonitorData";

type Row = Record<string, any>;
const PHONE = "+17035551234";
const LINE = "+12025551234";
const OTHER = "+13015551234";
const AT = "2026-11-13T15:00:00.000Z";
function capture(id: number, options: Row = {}): Row {
  const { eventType = "message.received", rawPayload, observed = new Date(AT), ...extra } = options;
  const item = { id: `msg-${id}`, from: PHONE, to: [LINE], body: `Text ${id}`, direction: "incoming", createdAt: AT, ...extra };
  return { id, source: "openphone", eventType, eventId: item.id ?? null, fromPhone: item.from, toPhone: Array.isArray(item.to) ? item.to[0] ?? null : item.to,
    rawPayload: rawPayload === undefined ? JSON.stringify({ type: eventType, data: { object: item } }) : rawPayload, createdAt: observed };
}
function session(id: number, leadPhone = PHONE, leadName: string | null = "Customer"): Row { return { id, leadPhone, leadName }; }

/** Only mysql2 is mocked: the installed Drizzle SELECT builder, SQL projection
 * and row mappers execute unchanged. No network-capable transport exists here.
 */
function offlineDb(initial: Row[] = [], metadata: Row[] = []) {
  const state = { webhook_events: structuredClone(initial), conversation_sessions: structuredClone(metadata) };
  const statements: Array<{ sql: string; params: unknown[]; timeout?: number }> = [];
  const release = vi.fn(); const destroy = vi.fn();
  let fail: string | null = null;
  const query = vi.fn(async (options: string | { sql: string; timeout?: number }, values: unknown[] = []) => {
    const statement = typeof options === "string" ? options : options.sql;
    statements.push({ sql: statement, params: values, timeout: typeof options === "string" ? undefined : options.timeout });
    if (fail && (fail === "select" ? /^select /i.test(statement) : statement === fail)) throw Object.assign(new Error("confidential SQL +17035551234"), { code: "ER_BAD_FIELD_ERROR" });
    if (!/^select /i.test(statement)) {
      if (!/^(set transaction isolation level repeatable read|begin|commit|rollback)$/i.test(statement)) throw new Error("Unexpected non-reader SQL");
      return [{ affectedRows: 0 }, []];
    }
    const match = /^select (.+) from `([^`]+)`(?: where (.+?))?(?: order by `[^`]+`\.`id` desc)? limit \?$/i.exec(statement);
    if (!match) throw new Error(`Unexpected ORM SQL: ${statement}`);
    const [, selected, table, where = ""] = match;
    if (table !== "webhook_events" && table !== "conversation_sessions") throw new Error("Unexpected table");
    let rows = state[table].slice();
    const prefix = (selected.match(/\?/g) ?? []).length;
    const params = values.slice(prefix, -1);
    if (table === "webhook_events") {
      expect(where).toContain("`source` = ?"); expect(where).toContain("`event_type` like ?");
      expect(params[0]).toBe("openphone"); expect(params[1]).toBe("message.%");
      rows = rows.filter(row => row.source === params[0] && row.eventType?.startsWith("message."));
      if (where.includes("`id` = ?")) rows = rows.filter(row => row.id === params[2]);
      if (where.includes("`id` < ?")) {
        rows = rows.filter(row => row.id < Number(params[2]) && row.id !== params[3]);
        const customer = String(params[5]); const business = String(params[8]);
        rows = rows.filter(row => {
          const from = normalizePhone(row.fromPhone); const to = normalizePhone(row.toPhone);
          return (from === normalizePhone(customer) && to === normalizePhone(business)) || (to === normalizePhone(customer) && from === normalizePhone(business));
        });
      }
    } else {
      expect(where).toContain("regexp_replace");
      const targets = params;
      rows = rows.filter(row => /^\+?[\d ().-]+$/.test(row.leadPhone) && targets.includes(row.leadPhone.replace(/[^0-9]/g, "")));
    }
    rows.sort((a, b) => b.id - a.id);
    rows = rows.slice(0, Number(values.at(-1)));
    // Split SELECT expressions only outside parentheses/quoted literals.
    const expressions: string[] = []; let depth = 0; let quoted = false; let start = 0;
    for (let i = 0; i < selected.length; i++) {
      if (selected[i] === "'") quoted = !quoted;
      if (!quoted) {
        if (selected[i] === "(") depth++; if (selected[i] === ")") depth--;
        if (selected[i] === "," && depth === 0) { expressions.push(selected.slice(start, i).trim()); start = i + 1; }
      }
    }
    expressions.push(selected.slice(start).trim());
    const aliases: Record<string, string> = { event_type: "eventType", event_id: "eventId", from_phone: "fromPhone", to_phone: "toPhone", raw_payload: "rawPayload", created_at: "createdAt" };
    return [rows.map(row => expressions.map(expression => {
      const identifiers = Array.from(expression.matchAll(/`([^`]+)`/g));
      const field = identifiers.at(-1)?.[1]; const value = field ? row[aliases[field] ?? field] ?? null : null;
      if (expression.startsWith("case when")) return typeof value === "string" && Buffer.byteLength(value, "utf8") <= Number(values[0]) ? value : null;
      return value;
    })), []];
  });
  const connection = { query, release, destroy };
  const pool = { getConnection: vi.fn(async () => connection), query: vi.fn(() => { throw new Error("Pool query forbidden"); }) };
  return { db: drizzle(pool as any), state, statements, query, pool, connection, release, destroy, fail: (stage: string) => { fail = stage; } };
}

beforeEach(() => { mocks.getDb.mockReset(); mocks.getDb.mockResolvedValue(null); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe("retained live text feed", () => {
  it("reads a bounded fixed snapshot, caps payload bytes in SQL and preserves plain strings", async () => {
    const text = '<img src=x onerror="alert(1)"> actual text';
    const mock = offlineDb([capture(1, { body: text }), capture(2)], [session(1, "(703) 555-1234", "<script>name</script>")]);
    const before = structuredClone(mock.state);
    const feed = await readLiveTextFeed(mock.db);
    expect(feed).toMatchObject({ partial: false, unavailable: false });
    expect(feed.rows.map(row => row.captureId)).toEqual([2, 1]);
    expect(feed.rows[1]).toMatchObject({ customerName: "<script>name</script>", identityAmbiguous: false, message: { customerPhone: PHONE, businessPhone: LINE, text, source: "provider", delivery: "received", timeBasis: "provider", occurredAt: AT } });
    expect(feed.rows.every(row => row.key.length <= 160 && /^[a-f0-9]{64}$/.test(row.revision))).toBe(true);
    const read = mock.statements.find(item => item.sql.startsWith("select"))!;
    expect(read.sql).toContain("case when octet_length"); expect(read.params[0]).toBe(65536); expect(read.params.at(-1)).toBe(500);
    expect(read.sql).toContain("order by `webhook_events`.`id` desc");
    expect(mock.statements.filter(item => item.sql.startsWith("select")).every(item => item.timeout! > 0 && item.timeout! <= 2000)).toBe(true);
    expect(mock.state).toEqual(before); expect(mock.pool.query).not.toHaveBeenCalled(); expect(mock.release).toHaveBeenCalledOnce();
    expect(mock.statements.at(-1)?.sql).toBe("COMMIT"); expect(mocks.getDb).not.toHaveBeenCalled();
    const context = await readLiveTextContext(1, mock.db);
    expect(context.row.revision).toBe(feed.rows[1].revision);
  });
  it("keeps equal text with different IDs, dedupes retries and aggregates empty delivery bodies", async () => {
    const outgoing = { from: LINE, to: [PHONE], direction: "outgoing", body: "Same", status: "queued" };
    const mock = offlineDb([capture(1, { ...outgoing, id: "m" }), capture(2, { ...outgoing, id: "different" }), capture(3, { ...outgoing, id: "m" }),
      capture(4, { ...outgoing, id: "m", eventType: "message.delivered", body: "", status: "delivered" })]);
    const feed = await readLiveTextFeed(mock.db);
    expect(feed.rows).toHaveLength(2); expect(feed.rows.map(row => row.captureId)).toEqual([2, 1]);
    expect(feed.rows.find(row => row.captureId === 1)?.message).toMatchObject({ text: "Same", delivery: "delivered", source: "provider" });
    expect(feed.rows.find(row => row.captureId === 2)?.message.delivery).toBe("unknown");
    const original = feed.rows.find(row => row.captureId === 1)!;
    mock.state.webhook_events.push(capture(5, { ...outgoing, id: "m", eventType: "message.delivered", body: null, status: "failed" }));
    const failed = (await readLiveTextFeed(mock.db)).rows.find(row => row.key === original.key)!;
    expect(failed.message).toMatchObject({ delivery: "unknown", source: "conversation_history" });
    expect(failed.revision).not.toBe(original.revision); expect(failed.captureId).toBe(original.captureId);
  });
  it("revises queued to failed even when both normalize to unknown", async () => {
    const outgoing = { id: "m", from: LINE, to: [PHONE], direction: "outgoing", body: "Text", status: "queued" };
    const mock = offlineDb([capture(1, outgoing)]);
    const first = (await readLiveTextFeed(mock.db)).rows[0];
    mock.state.webhook_events.push(capture(2, { ...outgoing, body: "", status: "failed", eventType: "message.updated" }));
    const second = (await readLiveTextFeed(mock.db)).rows[0];
    expect(first.message.delivery).toBe("unknown"); expect(second.message.delivery).toBe("unknown");
    expect(first.key).toBe(second.key); expect(first.revision).not.toBe(second.revision);
  });
  it("requires the delivery evidence capture itself to have a valid provider timestamp", async () => {
    const outgoing = { id: "m", from: LINE, to: [PHONE], direction: "outgoing", body: "Text", status: "queued" };
    const mock = offlineDb([capture(1, outgoing), capture(2, { ...outgoing, body: "", status: "delivered", createdAt: undefined, eventType: "message.delivered" })]);
    expect((await readLiveTextFeed(mock.db)).rows[0].message).toMatchObject({ delivery: "delivered", source: "conversation_history" });
  });
  it.each(["queued", "failed", "undelivered", "pending", "sending"])("never treats event_type as sent/delivered for %s", async status => {
    const feed = await readLiveTextFeed(offlineDb([capture(1, { direction: "outgoing", from: LINE, to: PHONE, eventType: "message.delivered", status })]).db);
    expect(feed.rows[0].message).toMatchObject({ delivery: "unknown", source: "conversation_history" });
  });
  it("does not turn an outgoing message.received with no status into proof", async () => {
    const feed = await readLiveTextFeed(offlineDb([capture(1, { direction: "outgoing", from: LINE, to: PHONE })]).db);
    expect(feed.rows[0].message.delivery).toBe("unknown"); expect(feed.rows[0].message.source).toBe("conversation_history");
  });
  it("does not return standalone empty body/status updates", async () => {
    const feed = await readLiveTextFeed(offlineDb([capture(1, { body: "" }), capture(2, { body: "   " }), capture(3, { body: null, eventType: "message.updated", status: "delivered" })]).db);
    expect(feed.rows).toEqual([]); expect(feed.partial).toBe(true);
  });
  it.each([undefined, "2026-11-13T15:00:00", "2026-02-30T15:00:00Z", "2026-13-13T15:00:00Z", "2026-11-13T24:00:00Z", "2026-11-13T15:00:00+00:60", 1794582000000])("falls back to observed time for invalid provider timestamp %s", async createdAt => {
    const feed = await readLiveTextFeed(offlineDb([capture(1, { createdAt })]).db);
    expect(feed.rows[0].message).toMatchObject({ occurredAt: null, observedAt: AT, timeBasis: "received", source: "conversation_history" });
  });
  it("accepts explicit offsets without changing occurrence and leaves missing observation unknown", async () => {
    const feed = await readLiveTextFeed(offlineDb([capture(1, { createdAt: "2026-11-13T10:00:00-05:00" }), capture(2, { createdAt: undefined, observed: null })]).db);
    expect(feed.rows[1].message.occurredAt).toBe(AT);
    expect(feed.rows[0].message).toMatchObject({ occurredAt: null, observedAt: null, timeBasis: "unknown", source: "conversation_history" });
  });
  it("never groups by text, names, phone suffix or just provider ID", async () => {
    const mock = offlineDb([capture(1, { id: "shared" }), capture(2, { id: "shared", from: OTHER }),
      capture(3, { id: "shared", to: [OTHER] }), capture(4, { id: "shared", direction: "outgoing", from: LINE, to: [PHONE] })],
      [session(1, PHONE, "Same Name"), session(2, OTHER, "Same Name"), session(3, "+447035551234", "Imposter")]);
    const feed = await readLiveTextFeed(mock.db); expect(feed.rows).toHaveLength(4);
    expect(new Set(feed.rows.map(row => row.key)).size).toBe(4); expect(feed.rows.every(row => row.customerName === "Same Name")).toBe(true);
    const context = await readLiveTextContext(1, mock.db); expect(context.messages).toHaveLength(2);
    expect(context.messages.every(message => message.customerPhone === PHONE && message.businessPhone === LINE)).toBe(true);
  });
  it("shows the phone when exact normalized metadata conflicts", async () => {
    const feed = await readLiveTextFeed(offlineDb([capture(1)], [session(1, PHONE, "A"), session(2, "703-555-1234", "B")]).db);
    expect(feed.rows[0]).toMatchObject({ customerName: null, identityAmbiguous: true }); expect(feed.partial).toBe(true);
  });
  it("bounds metadata and refuses to guess a name after the sentinel", async () => {
    const mock = offlineDb([capture(1)], Array.from({ length: 60 }, (_, i) => session(i + 1)));
    const feed = await readLiveTextFeed(mock.db); expect(feed.rows[0]).toMatchObject({ customerName: null, identityAmbiguous: false });
    expect(feed.partial).toBe(true);
    const context = await readLiveTextContext(1, mock.db);
    expect(context.partial).toBe(false);
    expect(context.row.message.customerPhone).toBe(PHONE);
    expect(context.row.message.sessionId).toBeNull();
    expect(context.row.message).toEqual(context.messages[0]);
    expect(mock.statements.find(item => item.sql.includes("from `conversation_sessions`"))?.params.at(-1)).toBe(50);
  });
  it("flags conflicting body and projected identity instead of silently asserting a customer", async () => {
    const bad = capture(3); bad.fromPhone = OTHER;
    const feed = await readLiveTextFeed(offlineDb([capture(1, { id: "m", body: "old" }), capture(2, { id: "m", body: "new" }), bad]).db);
    expect(feed.rows.every(row => row.identityAmbiguous)).toBe(true); expect(feed.rows.find(row => row.message.providerMessageId === "m")?.message.text).toBe("new");
  });
  it("rejects multiple to recipients, invalid phones, malformed JSON/direction and oversized SQL projection", async () => {
    const mock = offlineDb([capture(1, { to: [LINE, OTHER] }), capture(2, { to: [LINE, LINE] }), capture(3, { to: [] }),
      capture(4, { rawPayload: "{" }), capture(5, { rawPayload: "[]" }), capture(6, { direction: "unknown" }),
      capture(7, { from: "+447035551234" }), capture(8, { from: "call 7035551234" }), capture(9, { body: "x".repeat(65536) }),
      capture(10, { to: [null] }), capture(11, { to: [{ phone: LINE }] })]);
    const feed = await readLiveTextFeed(mock.db); expect(feed.rows).toEqual([]); expect(feed.partial).toBe(true);
    await expect(readLiveTextContext(1, mock.db)).rejects.toThrow("unidentifiable");
  });
  it("only scans 500 captures and returns the newest 100 texts", async () => {
    const mock = offlineDb(Array.from({ length: 530 }, (_, i) => capture(i + 1)));
    const feed = await readLiveTextFeed(mock.db); expect(feed.rows).toHaveLength(100); expect(feed.rows[0].captureId).toBe(530); expect(feed.rows.at(-1)?.captureId).toBe(431);
    expect(feed.partial).toBe(true); expect(mock.statements.find(item => item.sql.startsWith("select"))?.params.at(-1)).toBe(500);
  });
  it("uses overlap rereads rather than a high-water cursor for late lower-ID commits", async () => {
    const mock = offlineDb([capture(10)]);
    expect((await readLiveTextFeed(mock.db)).rows.map(row => row.captureId)).toEqual([10]);
    mock.state.webhook_events.push(capture(9));
    expect((await readLiveTextFeed(mock.db)).rows.map(row => row.captureId)).toEqual([10, 9]);
    expect(mock.pool.getConnection).toHaveBeenCalledTimes(2);
    expect(mock.statements.filter(item => item.sql.includes("from `webhook_events`")).every(item => !item.sql.includes("`id` >"))).toBe(true);
  });
  it("marks unavailable without leaking driver/SQL details and never retries", async () => {
    const mock = offlineDb([capture(1)]); mock.fail("select");
    expect(await readLiveTextFeed(mock.db)).toMatchObject({ rows: [], partial: true, unavailable: true });
    expect(mock.pool.getConnection).toHaveBeenCalledOnce(); expect(mock.release).toHaveBeenCalledOnce();
    const error = await readLiveTextContext(1, mock.db).catch(error => error);
    expect(error.message).not.toContain("confidential"); expect(error.message).not.toContain(PHONE);
    expect(error).not.toHaveProperty("cause");
  });
  it("uses optional getDb only when no injection is supplied", async () => {
    expect(await readLiveTextFeed()).toMatchObject({ rows: [], partial: true, unavailable: true });
    expect(mocks.getDb).toHaveBeenCalledOnce();
    const mock = offlineDb([capture(1)]); mocks.getDb.mockResolvedValue(mock.db);
    expect((await readLiveTextFeed()).rows).toHaveLength(1);
  });
});

describe("server-anchored live context", () => {
  it.each([0, -1, 1.2, NaN, Infinity, 2147483648, Number.MAX_SAFE_INTEGER, "1", null])("rejects invalid id %s before acquiring anything", async id => {
    const mock = offlineDb(); await expect(readLiveTextContext(id as number, mock.db)).rejects.toThrow("Invalid");
    expect(mock.pool.getConnection).not.toHaveBeenCalled(); expect(mocks.getDb).not.toHaveBeenCalled();
  });
  it("rejects missing exact IDs even when another message exists", async () => {
    await expect(readLiveTextContext(123, offlineDb([capture(1)]).db)).rejects.toThrow("missing");
  });
  it("returns the exact requested retry capture ID without duplicating the provider text", async () => {
    const mock = offlineDb([capture(1, { id: "retry", body: "Same" }), capture(2, { id: "retry", body: "Same" })]);
    const context = await readLiveTextContext(2, mock.db);
    expect(context.row.captureId).toBe(2); expect(context.messages).toHaveLength(1);
    expect(context.row.message).toEqual(context.messages[0]);
  });
  it("selects a clicked anchor outside the feed and keeps it with 30 chronological messages", async () => {
    const rows = [capture(1, { body: "Old anchor", createdAt: "2026-11-12T10:00:00Z" })].concat(Array.from({ length: 510 }, (_, i) => capture(i + 2)));
    const mock = offlineDb(rows); const context = await readLiveTextContext(1, mock.db);
    expect(context.row.captureId).toBe(1); expect(context.messages).toHaveLength(30); expect(context.messages[0].text).toBe("Old anchor"); expect(context.partial).toBe(true);
    expect(mock.statements.some(item => item.sql.includes("`id` = ?") && item.params.at(-2) === 1)).toBe(true);
  });
  it("does not universally label a 500-row scan truncated when older captures belong to other people", async () => {
    const unrelated = Array.from({ length: 520 }, (_, i) => capture(i + 1, { from: OTHER }));
    const mock = offlineDb(unrelated.concat([capture(521)]));
    const context = await readLiveTextContext(521, mock.db);
    expect(context.messages).toHaveLength(1); expect(context.partial).toBe(false);
  });
  it("marks actually omitted older exact-phone/business-line rows partial", async () => {
    const unrelated = Array.from({ length: 520 }, (_, i) => capture(i + 2, { from: OTHER }));
    const mock = offlineDb([capture(1)].concat(unrelated, [capture(522)]));
    const context = await readLiveTextContext(522, mock.db); expect(context.messages).toHaveLength(1); expect(context.partial).toBe(true);
    const feed = await readLiveTextFeed(mock.db);
    expect(feed.rows.find(row => row.captureId === 522)?.revision).toBe(context.row.revision);
    expect(mock.statements.some(item => item.sql.includes("`id` < ?") && item.params.at(-1) === 1)).toBe(true);
  });
  it("bounds serialized interpreter input including escaped text and multibyte characters", async () => {
    const body = ('漢字😀\\\"\n').repeat(4000);
    const mock = offlineDb([capture(1, { body }), capture(2, { body: "small" })]);
    const context = await readLiveTextContext(1, mock.db);
    expect(Buffer.byteLength(JSON.stringify(context.messages), "utf8")).toBeLessThanOrEqual(16000);
    expect(context.row.message.text).toBe(body);
    expect(context.messages.some(message => message.key === context.row.key)).toBe(false);
    expect(context.messages.map(message => message.text)).toEqual(["small"]);
    expect(context.partial).toBe(true);
    const feed = await readLiveTextFeed(mock.db);
    expect(feed.rows.find(row => row.captureId === 1)?.message.text).toBe(body);
    expect(feed.rows.find(row => row.captureId === 1)?.revision).toBe(context.row.revision);
  });
  it("binds context/body/status/name changes into the revision", async () => {
    const mock = offlineDb([capture(1)], [session(1)]);
    const first = await readLiveTextContext(1, mock.db);
    mock.state.webhook_events.push(capture(2, { body: "Correction", createdAt: "2026-11-13T15:01:00Z" }));
    const second = await readLiveTextContext(1, mock.db); expect(second.row.revision).not.toBe(first.row.revision);
    mock.state.conversation_sessions[0].leadName = "Changed";
    const third = await readLiveTextContext(1, mock.db); expect(third.row.revision).not.toBe(second.row.revision);
    mock.state.webhook_events[0] = capture(1, { body: "Changed actual text" });
    const fourth = await readLiveTextContext(1, mock.db); expect(fourth.row.revision).not.toBe(third.row.revision);
  });
  it("marks malformed exact-scope rows missing but ignores malformed unrelated evidence", async () => {
    const malformed = capture(2, { rawPayload: "{" });
    const good = offlineDb([capture(1), { ...malformed, fromPhone: OTHER }]);
    expect((await readLiveTextContext(1, good.db)).partial).toBe(false);
    const bad = offlineDb([capture(1), malformed]); expect((await readLiveTextContext(1, bad.db)).partial).toBe(true);
  });
});

describe("per-request read-only transport bounds", () => {
  it("disposes a late acquisition once without queries or retry", async () => {
    vi.useFakeTimers();
    let resolve!: (value: any) => void;
    const connection = { query: vi.fn(), release: vi.fn(), destroy: vi.fn() };
    const getConnection = vi.fn(() => new Promise(resolveValue => { resolve = resolveValue; }));
    const pending = readLiveTextFeed({ $client: { getConnection } });
    await vi.advanceTimersByTimeAsync(2001);
    expect(await pending).toMatchObject({ unavailable: true });
    resolve(connection); await Promise.resolve(); await Promise.resolve();
    expect(connection.destroy).toHaveBeenCalledOnce(); expect(connection.query).not.toHaveBeenCalled(); expect(getConnection).toHaveBeenCalledOnce();
  });
  it("destroys a stalled query without release or second disposal", async () => {
    vi.useFakeTimers();
    const mock = offlineDb([capture(1)]);
    mock.connection.query.mockImplementationOnce(() => new Promise(() => {}));
    const pending = readLiveTextFeed(mock.db); await vi.advanceTimersByTimeAsync(2001);
    expect(await pending).toMatchObject({ unavailable: true });
    expect(mock.destroy).toHaveBeenCalledOnce(); expect(mock.release).not.toHaveBeenCalled();
    expect(mock.pool.getConnection).toHaveBeenCalledOnce();
  });
  it("bounds a slow request across several queries to five seconds", async () => {
    vi.useFakeTimers();
    const mock = offlineDb([capture(1)], [session(1)]); const query = mock.connection.query.getMockImplementation()!;
    mock.connection.query.mockImplementation(async (...args) => { await new Promise(resolve => setTimeout(resolve, 1500)); return query(...args); });
    const pending = readLiveTextFeed(mock.db); await vi.advanceTimersByTimeAsync(5001);
    expect(await pending).toMatchObject({ unavailable: true }); expect(mock.destroy).toHaveBeenCalledOnce();
    expect(mock.release).not.toHaveBeenCalled(); expect(mock.pool.getConnection).toHaveBeenCalledOnce();
  });
  it("supports callback pools and destroys failed commit/release paths safely", async () => {
    const mock = offlineDb([capture(1)]); const promise = vi.fn(() => mock.pool);
    expect((await readLiveTextFeed({ $client: { promise } })).rows).toHaveLength(1); expect(promise).toHaveBeenCalledOnce();
    const failed = offlineDb([capture(1)]); failed.fail("COMMIT"); expect((await readLiveTextFeed(failed.db)).unavailable).toBe(true);
    expect(failed.destroy).toHaveBeenCalledOnce(); expect(failed.release).not.toHaveBeenCalled();
    const broken = offlineDb([capture(1)]); broken.release.mockImplementation(() => { throw new Error("release failed"); });
    expect((await readLiveTextFeed(broken.db)).unavailable).toBe(true); expect(broken.destroy).toHaveBeenCalledOnce();
  });
  it("contains no SQL data writers, provider/model fallback or mutable cursor", async () => {
    const source = readFileSync(new URL("./liveTextMonitorData.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/\b(?:INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM|CREATE\s+TABLE|ALTER\s+TABLE)\b/i);
    expect(source).not.toMatch(/\.insert\(|\b(?:db|database|reader)\.update\(|\.delete\(|fetch\(|invokeLLM|openPhoneClient|highWater|setInterval/);
    const mock = offlineDb([capture(1)]); await readLiveTextFeed(mock.db); await readLiveTextContext(1, mock.db);
    expect(mock.statements.every(item => /^select |^(set transaction isolation level repeatable read|begin|commit|rollback)$/i.test(item.sql))).toBe(true);
  });
});
