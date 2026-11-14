import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import {
  sourceContextSchema, sourceInventorySchema, validateCitation,
  type AuthorizedScope, type EvidenceRef, type InventoryBoundary, type SourceInventory, type SourceKind, type SourceStore,
} from "../../shared/instinct";
import { createStoredSourceReader, SOURCE_COLUMNS, sourceInstant } from "./sources";
import { assertReadSelect, createLazyReadDb, safeReadDbError, type ReadDb, type ReadConnection, type SelectPort, type SqlRow, type SqlValue } from "./readDb";

const at = "2026-11-13T15:00:00.000Z";
const scope: AuthorizedScope = { installationScope: "installation:test", sourceAccountKey: "account:test", authorizationVersion: "auth:1", actor: { staffId: "1", role: "admin" } };
const clock = { now: () => new Date(at) };
const columns = Object.keys(SOURCE_COLUMNS) as SourceStore[];
function session(n: number | string, history: unknown = [{ role: "user", content: "Please move Monday to Tuesday 😀", ts: at, fromPhone: "+12025550123", toPhone: "+12025550999" }]): SqlRow {
  return { id: String(n), leadPhone: "+12025550123", leadName: "Synthetic customer", messageHistory: typeof history === "string" ? history : JSON.stringify(history), createdAt: new Date(at), updatedAt: new Date(at) };
}
function row(n: number | string, extra: Record<string, unknown> = {}): SqlRow { return { id: String(n), createdAt: new Date(at), updatedAt: new Date(at), ...extra }; }
class FakeDb implements ReadDb {
  readonly tables: Record<SourceStore, SqlRow[]> = {
    conversation_sessions: [], inbound_sms: [], gmail_thread_meta: [], madison_email_drafts: [],
    openphone_call_recordings: [], voice_calls: [], call_log: [], field_mgmt_calls: [], confirmation_calls: [],
  };
  readonly statements: { sql: string; params: readonly SqlValue[] }[] = [];
  readonly failures = new Map<SourceStore, unknown>();
  readonly snapshots: number[] = [];
  async select(sql: string, params: readonly SqlValue[] = []): Promise<SqlRow[]> {
    assertReadSelect(sql); this.statements.push({ sql, params });
    const table = /FROM `([a-z_]+)`/.exec(sql)?.[1] as SourceStore;
    expect(columns).toContain(table);
    if (this.failures.has(table)) throw this.failures.get(table);
    const match = /^SELECT (.+) FROM `([a-z_]+)`(?: (.+))?$/.exec(sql);
    if (!match) throw new Error("Unexpected SELECT shape");
    const projection = match[1]; const tail = match[3] ?? "";
    if (projection === "MAX(`id`) AS `throughId`") return [{ throughId: this.tables[table].reduce<string | null>((highest, item) => highest === null || BigInt(String(item.id)) > BigInt(highest) ? String(item.id) : highest, null) }];
    expect(projection).toBe(SOURCE_COLUMNS[table].map(column => `\`${column}\``).join(", "));
    let result = [...this.tables[table]];
    if (tail === "WHERE `id` > ? AND `id` <= ? ORDER BY `id` ASC LIMIT ?") {
      result = result.filter(item => BigInt(String(item.id)) > BigInt(String(params[0])) && BigInt(String(item.id)) <= BigInt(String(params[1])))
        .sort((a, b) => BigInt(String(a.id)) < BigInt(String(b.id)) ? -1 : 1).slice(0, Number(params[2]));
    } else if (tail === "WHERE `id` = ?") result = result.filter(item => String(item.id) === params[0]);
    else if (tail === "WHERE `vapiCallId` = ? ORDER BY `id` ASC") result = result.filter(item => item.vapiCallId === params[0]).sort((a, b) => Number(a.id) - Number(b.id));
    else if (tail === "WHERE `threadId` = ? ORDER BY `id` ASC") result = result.filter(item => item.threadId === params[0]).sort((a, b) => Number(a.id) - Number(b.id));
    else throw new Error(`Unexpected synthetic SELECT clause: ${tail}`);
    return result;
  }
  async snapshot<T>(read: (port: SelectPort) => Promise<T>): Promise<T> { this.snapshots.push(this.snapshots.length + 1); return read({ select: this.select.bind(this) }); }
}
const reader = (db: FakeDb, extra: Partial<Parameters<typeof createStoredSourceReader>[0]> = {}) => createStoredSourceReader({ scope, db, clock, ...extra });
async function scan(source: ReturnType<typeof reader>, kinds: SourceKind[], boundary?: InventoryBoundary, localDay?: string): Promise<{ pages: SourceInventory[]; boundary: InventoryBoundary; items: SourceInventory["items"] }> {
  const captured = boundary ?? await source.captureBoundary(scope, { sourceKinds: kinds, localDay });
  const pages: SourceInventory[] = []; let cursor: string | undefined;
  do {
    const page = await source.inventory(scope, { sourceKinds: kinds, localDay, ...(cursor ? { cursor } : {}) }, captured);
    sourceInventorySchema.parse(page); pages.push(page); cursor = page.continuation ?? undefined;
  } while (cursor);
  return { pages, boundary: captured, items: pages.flatMap(page => page.items) };
}
async function reconcile(source: ReturnType<typeof reader>, boundary: InventoryBoundary): Promise<SourceInventory[]> {
  const pages: SourceInventory[] = []; let cursor: string | undefined;
  do { const page = await source.reconcile(scope, boundary, cursor); pages.push(page); cursor = page.continuation ?? undefined; } while (cursor);
  return pages;
}

describe("complete stored inventory and original provenance", () => {
  it("exceeds all old session/history/feed cutoffs and enumerates every original", async () => {
    const db = new FakeDb(); db.tables.conversation_sessions = Array.from({ length: 125 }, (_, index) => session(index + 1,
      Array.from({ length: 27 }, (_, message) => ({ role: message % 2 ? "assistant" : "user", content: `session ${index + 1} original ${message}`, ts: at, businessPhone: "+12025550999" }))));
    const source = reader(db); const result = await scan(source, ["sms"]);
    expect(result.items).toHaveLength(3375); expect(result.items[0].originalText).toBe("session 1 original 0"); expect(result.items.at(-1)?.originalText).toBe("session 125 original 26");
    expect(new Set(result.items.map(item => item.ref.sourceId)).size).toBe(3375);
    expect(result.pages.at(-1)?.continuation).toBeNull();
    expect(result.pages.every(page => page.coverage.analyzed === 0)).toBe(true);
    expect(result.pages.slice(0, -1).every(page => page.coverage.partial)).toBe(true);
  });
  it("returns the complete 150-entry context from one anchor and exact UTF-16 offsets", async () => {
    const db = new FakeDb(); db.tables.conversation_sessions = [session(7, Array.from({ length: 150 }, (_, index) => ({ role: "user", content: `😀 request ${index}`, ts: at, businessPhone: "+12025550999" })))];
    const source = reader(db); const result = await scan(source, ["sms"]); const anchor = result.items[149].ref;
    const context = await source.readContext(scope, [anchor], anchor.contextFingerprint);
    expect(context.evidence).toHaveLength(150); expect(context.manifest.complete).toBe(true); sourceContextSchema.parse(context);
    expect(context.evidence[149].originalTurns[0].end).toBe("😀 request 149".length);
    expect(validateCitation({ ref: anchor, start: 0, end: 2, exactQuote: "😀" }, scope, context.evidence).exactQuote).toBe("😀");
    expect(() => validateCitation({ ref: anchor, start: 0, end: 1, exactQuote: "😀" }, scope, context.evidence)).toThrow();
  });
  it("captures stable upper boundaries and includes later arrivals on reconciliation", async () => {
    const db = new FakeDb(); db.tables.conversation_sessions = [session(1)]; const source = reader(db);
    const boundary = await source.captureBoundary(scope, { sourceKinds: ["sms"] }); db.tables.conversation_sessions.push(session(2));
    expect((await scan(source, ["sms"], boundary)).items.map(item => item.ref.sessionId)).toEqual(["1"]);
    const changed = await reconcile(source, boundary); expect(changed.flatMap(page => page.items).map(item => item.ref.sessionId)).toEqual(["2"]);
  });
  it("detects old history edits even with unchanged updatedAt and rejects stale references", async () => {
    const db = new FakeDb(); db.tables.conversation_sessions = [session(1)]; const source = reader(db); const first = await scan(source, ["sms"]);
    db.tables.conversation_sessions[0] = session(1, [{ role: "user", content: "Changed to Friday", ts: at, businessPhone: "+12025550999" }]);
    expect((await reconcile(source, first.boundary)).flatMap(page => page.items)[0].originalText).toBe("Changed to Friday");
    await expect(source.readExact(scope, first.items[0].ref)).rejects.toMatchObject({ code: "STALE_CONTEXT" });
  });
  it("fingerprints full history, participant metadata, status and timing inputs", async () => {
    const db = new FakeDb(); db.tables.conversation_sessions = [session(1)]; const source = reader(db); const original = (await scan(source, ["sms"])).items[0].ref;
    for (const patch of [{ leadName: "Changed display" }, { leadPhone: "+12025550444" }, { messageHistory: JSON.stringify([{ role: "user", content: "same", ts: at, metadata: { status: "delivered" } }]) }]) {
      db.tables.conversation_sessions[0] = { ...session(1), ...patch }; await expect(source.readExact(scope, original)).rejects.toMatchObject({ code: "STALE_CONTEXT" });
    }
  });
  it("malformed history and invalid entries remain observed coverage, not empty success", async () => {
    const db = new FakeDb(); db.tables.conversation_sessions = [session(1, "broken{"), session(2, [null, { role: "user", content: { forged: "text" } }, { role: "user", content: "valid but time missing" }]), session(3, [])];
    const result = await scan(reader(db), ["sms"]); expect(result.items).toHaveLength(5); expect(result.items.filter(item => item.availability === "malformed")).toHaveLength(3);
    expect(result.items.some(item => item.originalText === "[object Object]")).toBe(false);
    expect(result.pages.reduce((sum, page) => sum + page.coverage.unavailable, 0)).toBe(4);
    expect(result.pages.some(page => page.limitations.some(value => value.includes("timestamp")))).toBe(true);
  });
  it("unknown line/time never uses session updatedAt or latest line metadata as authority", async () => {
    const db = new FakeDb(); db.tables.conversation_sessions = [{ ...session(1, [{ role: "user", content: "Please cancel" }]), lastInboundPhoneNumberId: "latest-line" }];
    const item = (await scan(reader(db), ["sms"])).items[0]; expect(item.ref.occurredAtUtc).toBeNull(); expect(item.participants.businessLine).toBeNull(); expect(item.availability).toBe("partial");
  });
  it("retains repeated provider-ID originals and labels contact/line conflict", async () => {
    const db = new FakeDb(); db.tables.conversation_sessions = [session(1, [{ role: "user", content: "a", ts: at, opMsgId: "OP1", fromPhone: "+12025550444", toPhone: "+12025550999", businessPhone: "+12025550888" }, { role: "user", content: "b", ts: at, openPhoneId: "OP1" }])];
    const result = await scan(reader(db), ["sms"]); expect(result.items.map(item => item.originalText)).toEqual(["a", "b"]); expect(result.items.every(item => item.availability === "partial")).toBe(true);
    expect(result.items[0].limitations.join(" ")).toMatch(/binding conflicts|endpoints/); expect(result.items[1].limitations.join(" ")).toContain("repeated provider");
  });
  it("inbound retained messages preserve exact endpoints and received observation basis", async () => {
    const db = new FakeDb(); db.tables.inbound_sms = [row(1, { fromPhone: "+12025550123", toPhone: "+12025550999", message: "Exact inbound", openPhoneMessageId: "OP22", receivedAt: Date.parse(at) })];
    const item = (await scan(reader(db), ["sms"])).items[0]; expect(item.originalText).toBe("Exact inbound"); expect(item.participants.to).toEqual(["+12025550999"]);
    expect(item.ref.timeBasis).toBe("received"); expect(item.ref.occurredAtUtc).toBeNull(); expect(item.ref.sessionId).toBeNull(); expect(item.availability).toBe("partial");
  });
  it("email thread metadata and draft snapshots never claim original full/body/header/date coverage", async () => {
    const db = new FakeDb(); db.tables.gmail_thread_meta = [row(1, { threadId: "thread1", senderEmail: "real@example.com", snippet: "snippet", lastMessageAt: Date.parse(at), messageCount: 20 })];
    db.tables.madison_email_drafts = [row("9007199254740999", { threadId: "thread1", inboundMessageId: "msg1", sessionId: "7", fromEmail: "original@example.com", replyToEmail: "forwarder@example.com", originalMessage: "Stored body input" })];
    const source = reader(db); const result = await scan(source, ["email"]); expect(result.items).toHaveLength(2);
    const draft = result.items.find(item => item.ref.store === "madison_email_drafts")!; expect(draft.ref.sourceId).toBe("draft:9007199254740999"); expect(draft.ref.providerId).toBe("msg1");
    expect(draft.participants.from).toBe("original@example.com"); expect(draft.participants.replyTo).toBe("forwarder@example.com"); expect(draft.participants.mailbox).toBeNull(); expect(draft.participants.to).toEqual([]);
    expect(result.items.every(item => item.availability === "partial" && item.ref.occurredAtUtc === null)).toBe(true);
    const context = await source.readContext(scope, [draft.ref], draft.ref.contextFingerprint); expect(context.manifest.complete).toBe(false); expect(context.evidence).toHaveLength(2);
  });
  it("bodyless email remains missing and cannot count as analyzed", async () => {
    const db = new FakeDb(); db.tables.gmail_thread_meta = [row(1, { threadId: "thread1", senderEmail: "a@example.com", snippet: null })];
    const result = await scan(reader(db), ["email"]); expect(result.items[0].availability).toBe("missing"); expect(result.pages[0].coverage.unavailable).toBe(1); expect(result.pages[0].coverage.analyzed).toBe(0);
  });
  it("OpenPhone has unknown human handling and exact dialogue offsets, not recording-second offsets", async () => {
    const db = new FakeDb(); db.tables.openphone_call_recordings = [row(1, { sessionId: "7", openphoneCallId: "OPcall1", callerPhone: "+12025550123", direction: "incoming", callStartedAt: new Date(at), transcript: JSON.stringify([{ identifier: "speaker1", content: "😀 Hello", start: 0, end: 2 }, { identifier: "speaker2", content: "Move it", start: 3, end: 7 }]) })];
    const item = (await scan(reader(db), ["human_call"])).items[0]; expect(item.ref.sourceKind).toBe("phone_unverified"); expect(item.ref.handlingEvidence).toBeNull();
    expect(item.originalText).toBe("😀 Hello\nMove it"); expect(item.originalTurns[1]).toMatchObject({ start: 9, end: 16, role: "unknown", occurredAtUtc: at, timeBasis: "call_started" });
    expect(item.availability).toBe("partial");
  });
  it("undiarized one-turn transcript is not attributed to a customer", async () => {
    const db = new FakeDb(); db.tables.openphone_call_recordings = [row(1, { openphoneCallId: "c1", sessionId: 0, transcript: JSON.stringify([{ identifier: "transcript", content: "Cancel", start: 0, end: 2 }]) })];
    const item = (await scan(reader(db), ["phone_unverified"])).items[0]; expect(item.originalTurns[0].role).toBe("unknown"); expect(item.ref.sessionId).toBeNull(); expect(item.ref.occurredAtUtc).toBeNull();
  });
  it("late finalized OpenPhone transcript changes revision under old row ID", async () => {
    const db = new FakeDb(); db.tables.openphone_call_recordings = [row(1, { openphoneCallId: "c1", sessionId: "7", callStartedAt: new Date(at), transcript: null })];
    const source = reader(db); const initial = await scan(source, ["phone_unverified"]); expect(initial.items[0].availability).toBe("missing");
    db.tables.openphone_call_recordings[0] = { ...db.tables.openphone_call_recordings[0], transcript: JSON.stringify([{ identifier: "speaker1", content: "The exact late original", start: 0, end: 4 }]) };
    const changed = (await reconcile(source, initial.boundary)).flatMap(page => page.items); expect(changed).toHaveLength(1); expect(changed[0].originalText).toBe("The exact late original");
  });
  it("canonical Vapi occurrence is counted once across all four families with every original retained", async () => {
    const db = new FakeDb(); const common = { vapiCallId: "vapi1", transcript: "Short original", calledPhone: "+12025550123", callerPhone: "+12025550123" };
    db.tables.voice_calls = [row(1, { ...common, sessionId: "7" })]; db.tables.call_log = [row(2, { ...common, calledTarget: "client", transcript: "Full original with additional important request", transcriptEnglish: "English translation", firedAt: Date.parse(at) })];
    db.tables.field_mgmt_calls = [row(3, { ...common, step: "exception_call" })]; db.tables.confirmation_calls = [row(4, { ...common, leadflowJobId: "8", firedAt: Date.parse(at) })];
    const source = reader(db); const result = await scan(source, ["ai_call"]); expect(result.items).toHaveLength(1); expect(result.items[0].ref.store).toBe("call_log");
    const context = await source.readContext(scope, [result.items[0].ref], result.items[0].ref.contextFingerprint); expect(context.evidence).toHaveLength(4);
    expect(context.evidence.some(item => item.originalText?.includes("additional important request"))).toBe(true); expect(context.evidence.find(item => item.ref.store === "call_log")?.translatedText).toBe("English translation");
    expect(context.manifest.limitations.join(" ")).toContain("transcripts differ"); expect(context.manifest.complete).toBe(false);
  });
  it("retains every duplicate nonunique call-log original and conflicting contacts", async () => {
    const db = new FakeDb(); db.tables.call_log = [row(1, { vapiCallId: "same", calledTarget: "client", calledPhone: "+12025550123", transcript: "one" }), row(2, { vapiCallId: "same", calledTarget: "client", calledPhone: "+12025550444", transcript: "two" })];
    const source = reader(db); const result = await scan(source, ["ai_call"]); expect(result.items).toHaveLength(1);
    const context = await source.readContext(scope, [result.items[0].ref], result.items[0].ref.contextFingerprint); expect(context.evidence.map(item => item.originalText)).toEqual(["one", "two"]); expect(context.manifest.limitations.join(" ")).toContain("contacts conflict");
  });
  it("does not merge AI calls with missing provider ID by similar text/time/phone", async () => {
    const db = new FakeDb(); db.tables.call_log = [row(1, { transcript: "same", calledPhone: "+12025550123" }), row(2, { transcript: "same", calledPhone: "+12025550123" })];
    expect((await scan(reader(db), ["ai_call"])).items).toHaveLength(2);
  });
  it("translation-only evidence cannot become exact original citations", async () => {
    const db = new FakeDb(); db.tables.call_log = [row(1, { vapiCallId: "translation", transcriptEnglish: "Cancel this booking", transcript: null })];
    const source = reader(db); const item = (await scan(source, ["ai_call"])).items[0]; expect(item.originalText).toBeNull(); expect(item.translatedText).toBe("Cancel this booking"); expect(item.contentBasis).toBe("translation_only");
    expect(() => validateCitation({ ref: item.ref, start: 0, end: 6, exactQuote: "Cancel" }, scope, [item])).toThrow();
  });
  it("workflow/native validation is explicitly injected; absent links never get provenance preference", async () => {
    const db = new FakeDb(); db.tables.confirmation_calls = [row(1, { vapiCallId: "workflow", leadflowJobId: "8", calledPhone: "+12025550123", transcript: "workflow original" })];
    db.tables.call_log = [row(2, { vapiCallId: "workflow", calledPhone: "+12025550123", calledTarget: "client", transcript: "complete other original" })];
    const unverified = (await scan(reader(db), ["ai_call"])).items[0]; expect(unverified.ref.store).toBe("call_log");
    const validateWorkflow = vi.fn(async () => true); const verified = (await scan(reader(db, { validateWorkflow }), ["ai_call"])).items[0]; expect(verified.ref.store).toBe("confirmation_calls"); expect(validateWorkflow).toHaveBeenCalled(); expect(verified.ref.handlingEvidence).toContain("independently validated");
  });
  it("Vapi call creation is never falsely original occurrence time", async () => {
    const db = new FakeDb(); db.tables.voice_calls = [row(1, { vapiCallId: "v1", callerPhone: "+12025550123", transcript: "Original" })];
    const item = (await scan(reader(db), ["ai_call"])).items[0]; expect(item.ref.occurredAtUtc).toBeNull(); expect(item.ref.timeBasis).toBe("stored_record");
  });
  it("family missing table/field is safely unavailable, without zeroing other families or leaking SQL", async () => {
    const db = new FakeDb(); db.failures.set("gmail_thread_meta", { code: "ER_BAD_FIELD_ERROR", message: "secret sql credentials" }); db.tables.madison_email_drafts = [row(1, { threadId: "t1", inboundMessageId: "m1", originalMessage: "Stored" })]; db.tables.conversation_sessions = [session(1)];
    const result = await scan(reader(db), ["email", "sms"]); expect(result.items.map(item => item.originalText)).toContain("Stored"); expect(result.items.map(item => item.originalText)).toContain("Please move Monday to Tuesday 😀");
    expect(result.boundary.families.find(family => family.store === "gmail_thread_meta")).toMatchObject({ availability: "missing", limitations: ["DB_SCHEMA"] }); expect(JSON.stringify(result)).not.toContain("secret");
  });
  it("query-stage family failure remains a boundary gap rather than an empty complete result", async () => {
    const db = new FakeDb(); db.tables.conversation_sessions = [session(1)]; const source = reader(db); const boundary = await source.captureBoundary(scope, { sourceKinds: ["sms"] }); db.failures.set("conversation_sessions", { code: "ER_NO_SUCH_TABLE" });
    const page = await source.inventory(scope, { sourceKinds: ["sms"] }, boundary); expect(page.coverage.partial).toBe(true); expect(page.items).toEqual([]); expect(page.coverage.boundaries[0].availability).toBe("missing");
  });
  it("reconciles deletions with explicit prior-source limitations", async () => {
    const db = new FakeDb(); db.tables.conversation_sessions = [session(1)]; const source = reader(db); const first = await scan(source, ["sms"]); db.tables.conversation_sessions = [];
    const pages = await reconcile(source, first.boundary); expect(pages.at(-1)?.limitations.join(" ")).toContain("missing/deleted"); expect(pages.at(-1)?.coverage.partial).toBe(true);
  });
  it("scoped opaque cursor replay preserves complete traversal and disallows forged/account/actor scopes before reads", async () => {
    const db = new FakeDb(); db.tables.conversation_sessions = [session(1), session(2)]; const source = reader(db); const boundary = await source.captureBoundary(scope, { sourceKinds: ["sms"] });
    const first = await source.inventory(scope, { sourceKinds: ["sms"] }, boundary); const cursor = first.continuation!;
    const a = await source.inventory(scope, { sourceKinds: ["sms"], cursor }, boundary); const b = await source.inventory(scope, { sourceKinds: ["sms"], cursor }, boundary); expect(a.items).toEqual(b.items);
    const before = db.statements.length;
    await expect(source.inventory(scope, { sourceKinds: ["sms"], cursor: "cursor:forged" }, boundary)).rejects.toMatchObject({ code: "INVALID_SCOPE" });
    await expect(source.inventory({ ...scope, actor: { staffId: "2", role: "admin" } }, { sourceKinds: ["sms"], cursor }, boundary)).rejects.toMatchObject({ code: "INVALID_SCOPE" });
    await expect(source.captureBoundary({ ...scope, sourceAccountKey: "different" }, { sourceKinds: ["sms"] })).rejects.toMatchObject({ code: "INVALID_SCOPE" }); expect(db.statements).toHaveLength(before);
  });
  it("rejects altered boundaries or source-kind/day scope before queries", async () => {
    const db = new FakeDb(); db.tables.conversation_sessions = [session(1)]; const source = reader(db); const boundary = await source.captureBoundary(scope, { sourceKinds: ["sms"] }); const before = db.statements.length;
    await expect(source.inventory(scope, { sourceKinds: ["sms"] }, { ...boundary, families: boundary.families.map(family => ({ ...family, throughId: "999" })) })).rejects.toMatchObject({ code: "INVALID_SCOPE" });
    await expect(source.inventory(scope, { sourceKinds: ["ai_call"] }, boundary)).rejects.toMatchObject({ code: "INVALID_SCOPE" });
    await expect(source.inventory(scope, { sourceKinds: ["sms"], localDay: "2026-11-13" }, boundary)).rejects.toMatchObject({ code: "INVALID_SCOPE" }); expect(db.statements).toHaveLength(before);
  });
  it("forged account/lookup/provider/offset references never authorize a different source", async () => {
    const db = new FakeDb(); db.tables.conversation_sessions = [session(1), session(2)]; const source = reader(db); const item = (await scan(source, ["sms"])).items[0]; const before = db.statements.length;
    await expect(source.readExact(scope, { ...item.ref, sourceAccountKey: "other" })).rejects.toMatchObject({ code: "INVALID_SOURCE_REFERENCE" }); expect(db.statements).toHaveLength(before);
    for (const change of [{ sourceId: "session:2:message:0" }, { sourceId: "session:1:message:999" }, { providerId: "forged-provider" }, { sessionId: "2" }]) await expect(source.readExact(scope, { ...item.ref, ...change })).rejects.toMatchObject({ code: "STALE_CONTEXT" });
  });
  it("captured-day scan includes complete conversations and unknown timestamps with truthful limitations", async () => {
    const db = new FakeDb(); db.tables.conversation_sessions = [session(1, [{ role: "user", content: "Prior context", ts: "2026-11-12T15:00:00Z", businessPhone: "+12025550999" }, { role: "user", content: "Today correction", ts: at, businessPhone: "+12025550999" }]), session(2, [{ role: "user", content: "Unknown day" }]), session(3, [{ role: "user", content: "Other day", ts: "2026-11-11T15:00:00Z", businessPhone: "+12025550999" }])];
    const result = await scan(reader(db), ["sms"], undefined, "2026-11-13"); expect(result.items.map(item => item.originalText)).toEqual(["Prior context", "Today correction", "Unknown day"]);
    expect(result.pages.flatMap(page => page.limitations).join(" ")).toContain("membership is unresolved");
  });
  it("unchanged full reconciliation returns no new evidence or artificial cap", async () => {
    const db = new FakeDb(); db.tables.conversation_sessions = Array.from({ length: 110 }, (_, index) => session(index + 1)); const source = reader(db); const first = await scan(source, ["sms"]);
    const unchanged = await reconcile(source, first.boundary); expect(unchanged.flatMap(page => page.items)).toEqual([]); expect(unchanged.at(-1)?.continuation).toBeNull();
    expect(db.statements.filter(item => item.sql.includes("`id` > ?")).length).toBeGreaterThan(220);
  });
  it("preserves captured-day scope through reconciliation and rejects mismatched inventory cursor", async () => {
    const db = new FakeDb(); db.tables.conversation_sessions = [session(1)]; const source = reader(db);
    const initial = await scan(source, ["sms"], undefined, "2026-11-13");
    const other = await source.captureBoundary(scope, { sourceKinds: ["sms"] });
    db.tables.conversation_sessions.push(session(2, [{ role: "user", content: "Other day arrival", ts: "2026-11-12T15:00:00Z", businessPhone: "+12025550999" }]), session(3), session(4));
    const first = await source.reconcile(scope, initial.boundary);
    expect(first.items.map(item => item.ref.sessionId)).toEqual(["3"]);
    await expect(source.reconcile(scope, other, first.continuation!)).rejects.toMatchObject({ code: "INVALID_SCOPE" });
    const second = await source.reconcile(scope, initial.boundary, first.continuation!);
    expect(second.items.map(item => item.ref.sessionId)).toEqual(["4"]);
  });
  it("accepts only server-issued returned boundary revisions after a family failure", async () => {
    const db = new FakeDb(); db.tables.conversation_sessions = [session(1)]; const source = reader(db);
    const initial = await source.captureBoundary(scope, { sourceKinds: ["sms"] });
    db.failures.set("conversation_sessions", { code: "ER_BAD_FIELD_ERROR" });
    const page = await source.inventory(scope, { sourceKinds: ["sms"] }, initial);
    expect(page.inventory.families[0].availability).toBe("missing");
    db.failures.clear(); const recovered = await source.reconcile(scope, page.inventory);
    expect(recovered.items).toHaveLength(1);
  });
  it("does not trust a forged observedAt fallback when original row dates are absent", async () => {
    const db = new FakeDb(); db.tables.conversation_sessions = [{ ...session(1), createdAt: null, updatedAt: null }];
    const source = reader(db); const first = await scan(source, ["sms"]); const ref = first.items[0].ref;
    expect((await source.readExact(scope, ref)).originalText).toBe(first.items[0].originalText);
    await expect(source.readExact(scope, { ...ref, observedAtUtc: "2026-11-14T15:00:00.000Z" })).rejects.toMatchObject({ code: "STALE_CONTEXT" });
  });
});

describe("lazy isolated read database", () => {
  it("construction and denied statement never acquire driver, read environment or connect", async () => {
    const url = vi.fn(() => "unused"); const driver = vi.fn(); const db = createLazyReadDb({ databaseUrl: url, driver });
    expect(url).not.toHaveBeenCalled(); expect(driver).not.toHaveBeenCalled(); await expect(db.select("UPDATE `bookings` SET `status` = ?", ["x"])).rejects.toMatchObject({ reason: "DB_READ_FAILED" });
    expect(url).not.toHaveBeenCalled(); expect(driver).not.toHaveBeenCalled();
  });
  it.each(["SELECT * FROM `users`", "SELECT 1; DELETE FROM `bookings`", "SELECT `id` FROM `bookings` FOR UPDATE", "SELECT `id` FROM `bookings` INTO OUTFILE x", "SELECT SLEEP(2) FROM `bookings`", "SELECT `id` FROM `bookings` UNION SELECT 1", "SELECT `id` FROM `bookings` -- escape", "SELECT `id` FROM bookings"])("rejects unallowlisted SQL: %s", sql => { expect(() => assertReadSelect(sql)).toThrow(); });
  it("returns only SELECT port inside an isolated repeatable read snapshot and closes it after use", async () => {
    const controls: string[] = []; const released = vi.fn(); const destroyed = vi.fn(); let retained: SelectPort | undefined;
    const connection: ReadConnection = { query: async (sql) => { controls.push(sql); return [sql.startsWith("SELECT") ? [{ id: "9007199254740999" }] : [], []]; }, release: released, destroy: destroyed };
    const driver = vi.fn(async () => ({ query: connection.query, getConnection: async () => connection, end: async () => {} }));
    const db = createLazyReadDb({ databaseUrl: () => "synthetic-only", driver });
    const value = await db.snapshot(async port => { retained = port; expect(Object.keys(port)).toEqual(["select"]); return port.select("SELECT `id` FROM `bookings` WHERE `id` = ?", ["9007199254740999"]); });
    expect(value[0].id).toBe("9007199254740999"); expect(controls).toEqual(["SET TRANSACTION ISOLATION LEVEL REPEATABLE READ", "BEGIN", "SELECT `id` FROM `bookings` WHERE `id` = ?", "COMMIT"]); expect(released).toHaveBeenCalledOnce(); expect(destroyed).not.toHaveBeenCalled();
    await expect(retained!.select("SELECT `id` FROM `bookings`")).rejects.toMatchObject({ reason: "DB_READ_FAILED" });
  });
  it("rolls back failed read, destroys uncertain setup/commit and redacts errors", async () => {
    const controls: string[] = []; const release = vi.fn(); const destroy = vi.fn();
    const connection: ReadConnection = { query: async sql => { controls.push(sql); if (sql.startsWith("SELECT")) throw { code: "ER_BAD_FIELD_ERROR", message: "private customer SQL" }; return [[], []]; }, release, destroy };
    const db = createLazyReadDb({ databaseUrl: () => "synthetic", driver: async () => ({ query: connection.query, getConnection: async () => connection, end: async () => {} }) });
    await expect(db.snapshot(port => port.select("SELECT `id` FROM `bookings`"))).rejects.toMatchObject({ message: "DB_SCHEMA", reason: "DB_SCHEMA" }); expect(controls.at(-1)).toBe("ROLLBACK"); expect(release).toHaveBeenCalledOnce();
    connection.query = async sql => { if (sql === "COMMIT") throw { code: "ECONNRESET", message: "private" }; return [[], []]; };
    await expect(db.snapshot(async () => 1)).rejects.toMatchObject({ reason: "DB_UNAVAILABLE" }); expect(destroy).toHaveBeenCalledOnce();
  });
  it("missing DATABASE_URL is lazy honest unavailable and retryable on the next explicit read", async () => {
    const databaseUrl = vi.fn<() => string | undefined>().mockReturnValueOnce(undefined).mockReturnValue("synthetic"); const driver = vi.fn(async () => ({ query: async () => [[{ id: "1" }], []] as const, getConnection: vi.fn(), end: async () => {} }));
    const db = createLazyReadDb({ databaseUrl, driver }); await expect(db.select("SELECT `id` FROM `bookings`")).rejects.toMatchObject({ reason: "DB_UNAVAILABLE" });
    expect(driver).not.toHaveBeenCalled(); expect(await db.select("SELECT `id` FROM `bookings`")).toEqual([{ id: "1" }]);
  });
  it("maps nested/cyclic error causes without secret messages", () => {
    expect(safeReadDbError({ cause: { code: "ETIMEDOUT", message: "secret" } }).reason).toBe("DB_TIMEOUT"); const cyclic: { cause?: unknown } = {}; cyclic.cause = cyclic; expect(safeReadDbError(cyclic).message).toBe("DB_READ_FAILED");
  });
  it("new source modules have only closed shared/node/readDb imports and no application bootstrap", () => {
    const source = readFileSync(new URL("./sources.ts", import.meta.url), "utf8"); const dbSource = readFileSync(new URL("./readDb.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/from ["'].*(?:routers|webhooks|internalCron|Concierge|gmailService|vapiService|\/db["'])/);
    expect(dbSource).not.toMatch(/from ["'].*(?:routers|internalCron|_core|drizzle\/schema)/);
    expect(source).not.toMatch(/fetch\(|transcribe|sendSMS\(/); expect(source).not.toMatch(/\.slice\(-|HISTORY_LIMIT|SESSION_LIMIT|FEED_LIMIT/);
  });
  it.each(["2026-02-30T12:00:00Z", "2026-11-13 15:00:00", "2026-11-13T25:00:00Z", 0, Number.MAX_SAFE_INTEGER + 1, null])("rejects invalid or observation-ambiguous original timestamps %s", value => { expect(sourceInstant(value)).toBeNull(); });
});
