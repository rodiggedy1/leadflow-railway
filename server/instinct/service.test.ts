import { describe, expect, it, vi } from "vitest";
import ts from "typescript";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createInstinctService, resolveInstinctInstallation, safeInstinctFailure, InstinctServiceError,
  type InstinctServiceOptions, type InstinctAsk,
} from "./service";
import { assertReadSelect, ReadDbError, type ReadDb, type SelectPort, type SqlRow, type SqlValue } from "./readDb";
import { createStoredSourceReader } from "./sources";
import { createIssueLedger } from "./issues";
import {
  sourceInventorySchema, checkResultSchema, feedSchema, dayReviewResultSchema, chatAnswerSchema,
  type AuthorizedScope, type ModelCallable, type InstinctInvokeResult, type SourceReader, type SourceInventory,
} from "../../shared/instinct";
export const fixtureAt = "2026-11-13T18:00:00.000Z", fixturePhone = "+13015550123", fixtureLine = "+13015550456";
export const fixtureScope: AuthorizedScope = { installationScope: "installation", sourceAccountKey: "account", authorizationVersion: "v1", actor: { staffId: "1", role: "admin" } };
export function fixtureSession(id = "7", text = "Move my appointment LF-1 to 2026-11-16 at 9 AM", extra: Record<string, unknown> = {}): SqlRow {
  return { id, leadPhone: fixturePhone, leadName: "Offline fixture", messageHistory: JSON.stringify([{ role: "user", content: text, ts: fixtureAt, fromPhone: fixturePhone, toPhone: fixtureLine }]), createdAt: new Date(fixtureAt), updatedAt: new Date(fixtureAt), ...extra };
}
export function fixtureBooking(time = "09:00"): SqlRow {
  return { id: "1", publicBookingNumber: "LF-1", customerPhone: fixturePhone, customerEmail: "fixture@example.test", customerName: "Offline fixture", requestedLocalDate: "2026-11-16", requestedLocalTime: time, requestedTimeZone: "America/New_York", requestedStartAt: String(Date.parse(`2026-11-16T${time === "09:00" ? "14" : "16"}:00:00.000Z`)), status: "confirmed", address: "123 Fixture Way", serviceName: "Cleaning", extras: [], recurrence: "one-time", companyNotes: "Gate 2841", specialRequestNotes: [], priceSnapshot: {}, updatedAt: new Date(fixtureAt) };
}
export function fixtureJob(time = "09:00"): SqlRow {
  return { id: "20", bookingId: "1", launch27BookingId: null, bookingSeriesId: null, customerPhone: fixturePhone, customerEmail: "fixture@example.test", customerName: "Offline fixture", jobDate: "2026-11-16", serviceDateTime: `2026-11-16T${time === "09:00" ? "14" : "16"}:00:00.000Z`, bookingStatus: "confirmed", jobAddress: "123 Fixture Way", serviceName: "Cleaning", extras: [], frequency: "One time", teamName: "Fixture Team", customerNotes: "Gate 2841", updatedAt: new Date(fixtureAt) };
}
/** Exact injected constant-SELECT parser. No driver or concrete URL is opened. */
export class ServiceFakeDb implements ReadDb {
  tables: Record<string, SqlRow[]> = { conversation_sessions: [fixtureSession()], inbound_sms: [], gmail_thread_meta: [], madison_email_drafts: [], openphone_call_recordings: [], voice_calls: [], call_log: [], field_mgmt_calls: [], confirmation_calls: [], bookings: [fixtureBooking()], leadflow_jobs: [fixtureJob()], booking_series: [] };
  calls: { sql: string; params: readonly SqlValue[] }[] = [];
  snapshots = 0;
  fail: string | null = null;
  async select(sql: string, params: readonly SqlValue[] = []): Promise<SqlRow[]> {
    assertReadSelect(sql); this.calls.push({ sql, params });
    const table = /FROM `([a-z_]+)`/.exec(sql)?.[1];
    if (!table || !(table in this.tables)) throw new Error("Fixture SQL table not declared");
    if (this.fail === table) throw Object.assign(new Error("mysql://raw:secret@private-db/raw-schema"), { code: "ER_BAD_FIELD_ERROR" });
    let rows = this.tables[table];
    if (sql.includes("MAX(`id`)")) return [{ throughId: rows.reduce<string | null>((max, row) => !max || BigInt(String(row.id)) > BigInt(max) ? String(row.id) : max, null) }];
    if (sql.includes("`id` > ?")) rows = rows.filter(row => BigInt(String(row.id)) > BigInt(String(params[0])) && BigInt(String(row.id)) <= BigInt(String(params[1]))).slice(0, Number(params.at(-1)));
    else if (sql.includes("REGEXP_REPLACE") || sql.includes("LOWER(TRIM")) {
      const digits = sql.includes("REGEXP_REPLACE") ? String(params[2]) : null, email = sql.includes("LOWER(TRIM") ? String(params.at(-1)) : null;
      rows = rows.filter(row => (digits && String(row.customerPhone ?? "").replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "") === digits) || (email && String(row.customerEmail ?? "").trim().toLowerCase() === email));
    } else { const field = /WHERE `(\w+)` = \?/.exec(sql)?.[1]; if (!field) throw new Error("Unexpected fixture SQL"); rows = rows.filter(row => String(row[field]) === String(params[0])); }
    return [...rows].sort((a, b) => BigInt(String(a.id)) < BigInt(String(b.id)) ? -1 : 1);
  }
  async snapshot<T>(read: (port: SelectPort) => Promise<T>): Promise<T> { this.snapshots++; return read(this); }
}
export function fixtureModel(actions = true): ModelCallable {
  return vi.fn(async params => {
    const payload = JSON.parse(String(params.messages[1].content));
    const text = payload.context.evidence[0].originalText as string;
    return modelResult({ actions: actions && text.includes("Move my appointment") ? [{ action: "reschedule", agreement: "requested", anchorEvidenceIndex: 0,
      citations: [{ evidenceIndex: 0, start: 0, end: text.length, exactQuote: text }], expected: { bookingReference: "LF-1", date: "2026-11-16", originalDate: null, time: "09:00", timeKind: "exact", windowEnd: null, timeZone: "America/New_York", scope: "visit", address: null, serviceName: null, extras: null, extrasMode: "unspecified", teamName: null, amountCents: null, notes: null, notesDestination: "unspecified" },
      explanation: "Requested exact 9 AM", confidence: 0.95, ambiguous: false, missingParameters: [], supersededByEvidenceIndex: null }] : [] });
  });
}
function modelResult(value: unknown): InstinctInvokeResult { return { id: "offline", model: "injected", created: 1, choices: [{ index: 0, message: { role: "assistant", content: JSON.stringify(value) }, finish_reason: "stop" }] }; }
export function serviceHarness(overrides: Partial<InstinctServiceOptions> = {}) {
  const db = new ServiceFakeDb(), clock = { now: () => new Date(fixtureAt) }, model = fixtureModel();
  const options: InstinctServiceOptions = { scope: fixtureScope, db, clock, model, businessLines: [fixtureLine], ...overrides };
  return { db, clock, model, options, service: createInstinctService(options) };
}
export async function firstCheck(h: ReturnType<typeof serviceHarness>) {
  const inventory = await h.service.sources(fixtureScope, { sourceKinds: ["sms"] });
  const input = { sourceRefs: inventory.items.map(item => item.ref), expectedContextRevision: inventory.binding.contextRevision! };
  return { inventory, input, result: await h.service.check(fixtureScope, input) };
}
const selected = (issue: { issueId: string; revision: string }) => ({ issueId: issue.issueId, issueRevision: issue.revision });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }

describe("read-only actual dependency orchestration", () => {
  it("sources/check/feed/evidence/reverify compose actual injected SQL/model and preserve exact identity", async () => {
    const h = serviceHarness(), { inventory, result } = await firstCheck(h);
    expect(sourceInventorySchema.safeParse(inventory).success).toBe(true); expect(checkResultSchema.safeParse(result).success).toBe(true);
    expect(result.issues[0].outcome).toBe("matches_current"); expect(result.issues[0].identity.decision).toBe("verified");
    expect(result.issues[0].target.jobId).toBe("20"); expect(result.coverage).toMatchObject({ read: 1, analyzed: 1, unprocessed: 0, unavailable: 0, partial: false });
    const feed = await h.service.feed(fixtureScope, { filter: "all" }); expect(feedSchema.safeParse(feed).success).toBe(true); expect(feed.totals.requests).toBe(1); expect(feed.coverage.analyzed).toBe(1);
    const evidence = await h.service.evidence(fixtureScope, selected(result.issues[0])); expect(evidence.citations[0].exactQuote).toBe(inventory.items[0].originalText); expect(evidence.snapshot?.records).toHaveLength(2);
    expect(h.db.calls.every(call => call.sql.startsWith("SELECT "))).toBe(true); expect(h.model).toHaveBeenCalledTimes(1);
  });
  it("record 9 to 11 to 9 uses one interpretation, fresh snapshots and stable issue identity", async () => {
    const h = serviceHarness(), { result, input } = await firstCheck(h), original = result.issues[0], before = h.db.snapshots;
    h.db.tables.bookings = [fixtureBooking("11:00")]; h.db.tables.leadflow_jobs = [fixtureJob("11:00")];
    const changed = await h.service.reverify(fixtureScope, selected(original)); expect(changed.issue.outcome).toBe("discrepancy"); expect(changed.issue.issueId).toBe(original.issueId); expect(changed.issue.revision).toBe(original.revision); expect(changed.issue.recordFingerprint).not.toBe(original.recordFingerprint);
    h.db.tables.bookings = [fixtureBooking()]; h.db.tables.leadflow_jobs = [fixtureJob()]; const again = await h.service.check(fixtureScope, input);
    expect(again.issues[0].outcome).toBe("matches_current"); expect(h.model).toHaveBeenCalledTimes(1); expect(h.db.snapshots).toBeGreaterThan(before); expect((await h.service.feed(fixtureScope, { filter: "all" })).totals.requests).toBe(1);
    expect(changed.issue.notification).toBe("unknown"); expect(changed.issue.delivery).toBe("unknown");
  });
  it("repeated check stays on exact retained visit after actual date movement and a new eligible visit arrives", async () => {
    const h = serviceHarness(), { result, input } = await firstCheck(h), prior = result.issues[0];
    h.db.tables.bookings = [{ ...fixtureBooking("11:00"), requestedLocalDate: "2026-11-17", requestedStartAt: String(Date.parse("2026-11-17T16:00:00.000Z")) }];
    h.db.tables.leadflow_jobs = [{ ...fixtureJob("11:00"), jobDate: "2026-11-17", serviceDateTime: "2026-11-17T16:00:00.000Z" },
      { ...fixtureJob(), id: "21", bookingId: null, jobDate: "2026-11-16" }];
    const current = await h.service.check(fixtureScope, input); expect(current.issues[0].target.jobId).toBe("20"); expect(current.issues[0].outcome).toBe("discrepancy"); expect(current.issues[0].issueId).toBe(prior.issueId); expect(h.model).toHaveBeenCalledTimes(1);
  });
  it("feed refresh never calls model/native reads and unavailable review is not invented", async () => {
    const h = serviceHarness(); await firstCheck(h); const before = h.db.calls.length;
    for (let i = 0; i < 7; i++) await h.service.feed(fixtureScope, { filter: "all" });
    const reviewed = await h.service.feed(fixtureScope, { filter: "reviewed" }); expect(reviewed.groups).toEqual([]); expect(reviewed.reviewedUnavailable).toBe(true); expect(h.db.calls).toHaveLength(before); expect(h.model).toHaveBeenCalledTimes(1);
  });
  it("constructor creates no DB/URL/model calls and exposes only seven methods plus read tools/scoped adapter", () => {
    const db = { select: vi.fn(), snapshot: vi.fn() }, model = vi.fn(); const h = serviceHarness({ db, model });
    expect(db.select).not.toHaveBeenCalled(); expect(db.snapshot).not.toHaveBeenCalled(); expect(model).not.toHaveBeenCalled();
    expect(Object.keys(h.service)).toEqual(["sources", "feed", "check", "evidence", "reverify", "dayReview", "ask", "tools", "forScope"]);
    expect(Object.keys(h.service.forScope(fixtureScope))).toEqual(["sources", "feed", "check", "evidence", "reverify", "dayReview", "ask"]);
  });
  it("all 137 sessions and complete 153-entry old history are traversed without a tail cutoff", async () => {
    const h = serviceHarness({ model: fixtureModel(false) }); h.db.tables.conversation_sessions = Array.from({ length: 137 }, (_, i) => fixtureSession(String(i + 1), "Thanks"));
    const history = Array.from({ length: 153 }, (_, i) => ({ role: "user", content: `Original ${i}`, ts: fixtureAt, fromPhone: fixturePhone, toPhone: fixtureLine })); h.db.tables.conversation_sessions[0] = fixtureSession("1", "", { messageHistory: JSON.stringify(history) });
    let cursor: string | undefined, final: SourceInventory | undefined, all = 0; const revisions = new Set<string>();
    do { final = await h.service.sources(fixtureScope, { sourceKinds: ["sms"], ...(cursor ? { cursor } : {}) }); all += final.items.length; final.items.forEach(item => revisions.add(item.ref.contextFingerprint)); cursor = final.continuation ?? undefined; } while (cursor);
    expect(all).toBe(289); expect(revisions.size).toBe(137); expect(final!.coverage).toMatchObject({ read: 289, analyzed: 0, unprocessed: 289, unavailable: 0, continuation: null, partial: true }); expect(h.model).not.toHaveBeenCalled();
    expect((await h.service.feed(fixtureScope, { filter: "all" })).coverage.read).toBe(289);
  });
  it("all-history day review continues all 125 contexts and counts successful informational negatives only", async () => {
    const model = fixtureModel(false), h = serviceHarness({ model }); h.db.tables.conversation_sessions = Array.from({ length: 125 }, (_, i) => fixtureSession(String(i + 1), "Thank you"));
    let cursor: string | undefined, last;
    do { last = await h.service.dayReview(fixtureScope, { localDate: "2026-11-13", timeZone: "America/New_York", sourceKinds: ["sms"], ...(cursor ? { cursor } : {}) }); expect(dayReviewResultSchema.safeParse(last).success).toBe(true); cursor = last.continuation ?? undefined; } while (cursor);
    expect(last!.coverage).toMatchObject({ read: 125, analyzed: 125, unprocessed: 0, unavailable: 0, continuation: null, partial: false }); expect(last!.groups).toHaveLength(1); expect(last!.groups[0].issues).toHaveLength(125); expect(model).toHaveBeenCalledTimes(125); expect(last!.groups.every(group => group.issues.every(issue => issue.outcome === "no_action"))).toBe(true);
  });
  it("four source families retain full original context and phone/email gaps remain honestly partial", async () => {
    const h = serviceHarness({ model: fixtureModel(false) }); h.db.tables.gmail_thread_meta = [{ id: "1", threadId: "thread-1", snippet: "Hello", createdAt: new Date(fixtureAt) }];
    h.db.tables.madison_email_drafts = [{ id: "1", threadId: "thread-1", inboundMessageId: "mail-1", originalMessage: "A stored snapshot", fromEmail: "fixture@example.test", createdAt: new Date(fixtureAt) }];
    h.db.tables.openphone_call_recordings = [{ id: "1", openphoneCallId: "op-1", callerPhone: fixturePhone, direction: "incoming", callStartedAt: new Date(fixtureAt), transcript: JSON.stringify([{ identifier: "speaker", content: "Hello" }]), createdAt: new Date(fixtureAt) }];
    for (const table of ["voice_calls", "call_log", "field_mgmt_calls", "confirmation_calls"]) h.db.tables[table] = [{ id: "1", vapiCallId: "vapi-1", transcript: `Original ${table}`, calledPhone: fixturePhone, calledTarget: "client", firedAt: new Date(fixtureAt), createdAt: new Date(fixtureAt) }];
    let cursor: string | undefined; const items = [];
    do { const page = await h.service.sources(fixtureScope, { sourceKinds: ["sms", "email", "human_call", "ai_call", "phone_unverified"], ...(cursor ? { cursor } : {}) }); items.push(...page.items); cursor = page.continuation ?? undefined; } while (cursor);
    expect(items.filter(item => item.ref.sourceKind === "ai_call")).toHaveLength(1); expect(items.filter(item => item.ref.sourceKind === "human_call")).toHaveLength(0); expect(items.some(item => item.ref.sourceKind === "phone_unverified")).toBe(true);
    for (const revision of new Set(items.map(item => item.ref.contextFingerprint))) { const refs = items.filter(item => item.ref.contextFingerprint === revision).map(item => item.ref); const checked = await h.service.check(fixtureScope, { sourceRefs: refs, expectedContextRevision: revision }); if (refs[0].sourceKind !== "sms") expect(checked.issues.every(issue => issue.outcome !== "no_action")).toBe(true); if (refs[0].sourceKind === "ai_call") expect(checked.issues[0].identity.evidenceRefs).toHaveLength(4); }
    expect((await h.service.feed(fixtureScope, { filter: "all" })).coverage.partial).toBe(true);
  });
  it("real model failure remains unavailable, no automatic feed retry, explicit check retries", async () => {
    let fail = true; const success = fixtureModel(false), model: ModelCallable = vi.fn(async params => { if (fail) throw new Error("raw provider secret"); return success(params); });
    const h = serviceHarness({ model }), { result, input } = await firstCheck(h); expect(result.analysis).toMatchObject({ status: "unavailable", failure: "MODEL_UNAVAILABLE" }); expect(result.issues[0].outcome).toBe("analysis_unavailable"); expect(result.coverage.unavailable).toBe(1); expect(JSON.stringify(result)).not.toContain("secret");
    await h.service.feed(fixtureScope, { filter: "all" }); expect(model).toHaveBeenCalledTimes(1); fail = false;
    const retried = await h.service.check(fixtureScope, input); expect(retried.issues[0].outcome).toBe("no_action"); expect(model).toHaveBeenCalledTimes(2); expect((await h.service.feed(fixtureScope, { filter: "all" })).coverage.analyzed).toBe(1);
  });
  it("same pending check coalesces all verification work and never age-evicts model invocation", async () => {
    const wait = deferred<InstinctInvokeResult>(), entered = deferred<void>(), model = vi.fn(async () => { entered.resolve(); return wait.promise; }); const h = serviceHarness({ model });
    const inventory = await h.service.sources(fixtureScope, { sourceKinds: ["sms"] }), input = { sourceRefs: inventory.items.map(item => item.ref), expectedContextRevision: inventory.binding.contextRevision! };
    const one = h.service.check(fixtureScope, input); await entered.promise; h.clock.now = () => new Date("2036-11-13T18:00:00.000Z"); const two = h.service.check(fixtureScope, input); wait.resolve(modelResult({ actions: [] }));
    expect(await one).toEqual(await two); expect(model).toHaveBeenCalledTimes(1); expect(h.db.calls.filter(call => call.sql.includes("FROM `bookings` WHERE (")).length).toBe(1);
  });
});

describe("actor, cursor and exact-source authority", () => {
  it.each(["installation", "account", "version", "nonadmin", "badstaff"])("invalid %s scope rejected before DB/model", async kind => {
    const h = serviceHarness(), scope = structuredClone(fixtureScope);
    if (kind === "installation") Object.assign(scope, { installationScope: "foreign" }); if (kind === "account") Object.assign(scope, { sourceAccountKey: "foreign" }); if (kind === "version") Object.assign(scope, { authorizationVersion: "foreign" }); if (kind === "nonadmin") Object.assign(scope.actor, { role: "staff" }); if (kind === "badstaff") Object.assign(scope.actor, { staffId: "0" });
    await expect(h.service.sources(scope, { sourceKinds: ["sms"] })).rejects.toThrow("INVALID_SCOPE"); expect(h.db.calls).toHaveLength(0); expect(h.model).not.toHaveBeenCalled();
  });
  it.each(["actor", "account", "id", "revision", "observation", "provider"])("unissued/forged %s reference rejected before source/native read", async kind => {
    const h = serviceHarness(), inventory = await h.service.sources(fixtureScope, { sourceKinds: ["sms"] }), refs = structuredClone(inventory.items.map(item => item.ref)); let scope = fixtureScope;
    if (kind === "actor") scope = { ...scope, actor: { staffId: "2", role: "admin" } }; if (kind === "account") refs[0] = { ...refs[0], sourceAccountKey: "foreign" }; if (kind === "id") refs[0] = { ...refs[0], sourceId: "session:999:message:0" }; if (kind === "revision") refs[0] = { ...refs[0], sourceRevision: "forged" }; if (kind === "observation") refs[0] = { ...refs[0], observedAtUtc: "2026-11-13T19:00:00.000Z" }; if (kind === "provider") refs[0] = { ...refs[0], providerId: "forged" };
    const before = h.db.calls.length; await expect(h.service.check(scope, { sourceRefs: refs, expectedContextRevision: inventory.binding.contextRevision! })).rejects.toThrow("INVALID_SOURCE_REFERENCE"); expect(h.db.calls).toHaveLength(before); expect(h.model).not.toHaveBeenCalled();
  });
  it.each(["actor", "day", "kinds", "mode", "forged"])("cursor %s cannot expand scope or start an unrelated scan", async kind => {
    const h = serviceHarness(), inventory = await h.service.sources(fixtureScope, { sourceKinds: ["sms"] }), before = h.db.calls.length;
    const input = { sourceKinds: ["sms" as const], cursor: inventory.continuation! };
    let request: Promise<unknown>;
    if (kind === "actor") request = h.service.sources({ ...fixtureScope, actor: { staffId: "2", role: "admin" } }, input);
    else if (kind === "day") request = h.service.sources(fixtureScope, { ...input, localDay: "2026-11-12" });
    else if (kind === "kinds") request = h.service.sources(fixtureScope, { ...input, sourceKinds: ["email"] });
    else if (kind === "mode") request = h.service.dayReview(fixtureScope, { ...input, localDate: "2026-11-13", timeZone: "America/New_York" });
    else request = h.service.sources(fixtureScope, { ...input, cursor: "forged:cursor" });
    await expect(request).rejects.toThrow("INVALID_SCOPE"); expect(h.db.calls).toHaveLength(before);
  });
  it("cursor replay retains a lost-response page and fresh service rejects old process cursor", async () => {
    const h = serviceHarness(); h.db.tables.conversation_sessions.push(fixtureSession("8", "Thanks")); const first = await h.service.sources(fixtureScope, { sourceKinds: ["sms"] });
    const one = await h.service.sources(fixtureScope, { sourceKinds: ["sms"], cursor: first.continuation! }), two = await h.service.sources(fixtureScope, { sourceKinds: ["sms"], cursor: first.continuation! });
    expect(one.items).toEqual(two.items); expect(one.coverage.read).toBe(two.coverage.read);
    await expect(createInstinctService(h.options).sources(fixtureScope, { sourceKinds: ["sms"], cursor: first.continuation! })).rejects.toThrow("INVALID_SCOPE");
  });
  it("old source edit rejects check before model/native and new inventory invalidates retained proof", async () => {
    const h = serviceHarness(), { input, result } = await firstCheck(h); h.db.tables.conversation_sessions = [fixtureSession("7", "Actually 11 AM")]; const before = h.db.calls.length;
    await expect(h.service.check(fixtureScope, input)).rejects.toThrow("STALE_CONTEXT"); expect(h.db.calls.slice(before).every(call => call.sql.includes("conversation_sessions"))).toBe(true); expect(h.model).toHaveBeenCalledTimes(1);
    await h.service.sources(fixtureScope, { sourceKinds: ["sms"] }); const feed = await h.service.feed(fixtureScope, { filter: "all" }); expect(feed.groups[0].issues[0].outcome).toBe("review"); expect(feed.groups[0].issues[0].verification).toBeNull(); expect(feed.coverage.unprocessed).toBe(1);
    await expect(h.service.evidence(fixtureScope, selected(result.issues[0]))).rejects.toThrow("STALE_CONTEXT");
  });
  it("source changes during pending extraction cannot publish old analysis", async () => {
    const wait = deferred<InstinctInvokeResult>(), entered = deferred<void>(), model = vi.fn(async () => { entered.resolve(); return wait.promise; }); const h = serviceHarness({ model });
    const inv = await h.service.sources(fixtureScope, { sourceKinds: ["sms"] }); const pending = h.service.check(fixtureScope, { sourceRefs: inv.items.map(item => item.ref), expectedContextRevision: inv.binding.contextRevision! }); await entered.promise;
    h.db.tables.conversation_sessions = [fixtureSession("7", "Changed")]; wait.resolve(modelResult({ actions: [] })); await expect(pending).rejects.toThrow("STALE_CONTEXT"); expect((await h.service.feed(fixtureScope, { filter: "all" })).groups).toEqual([]);
  });
  it("missing family/schema is not successful zero and unrelated sources continue", async () => {
    const h = serviceHarness(); h.db.fail = "gmail_thread_meta"; let cursor: string | undefined, last;
    do { last = await h.service.sources(fixtureScope, { sourceKinds: ["sms", "email"], ...(cursor ? { cursor } : {}) }); cursor = last.continuation ?? undefined; } while (cursor);
    expect(last!.coverage.partial).toBe(true); expect(last!.coverage.exclusions.join(" ")).toContain("DB_SCHEMA"); expect(JSON.stringify(last)).not.toContain("secret"); expect(last!.coverage.read).toBe(1);
  });
  it("missing native schema preserves analyzed originals with record unavailable, not false match or model failure", async () => { const h = serviceHarness(); h.db.fail = "bookings"; const { result } = await firstCheck(h); expect(result.analysis.status).toBe("complete"); expect(result.issues[0].outcome).toBe("record_unavailable"); expect(result.coverage).toMatchObject({ read: 1, analyzed: 1, unprocessed: 0, unavailable: 0, partial: true }); expect((await h.service.feed(fixtureScope, { filter: "all" })).coverage).toMatchObject({ analyzed: 1, unprocessed: 0, unavailable: 0, partial: true }); expect(JSON.stringify(result)).not.toContain("secret"); });
  it("nonselected actor cannot retrieve issue or issue-selected chat before reads", async () => { const h = serviceHarness(), { result } = await firstCheck(h), before = h.db.calls.length, other = { ...fixtureScope, actor: { staffId: "2", role: "admin" as const } }; await expect(h.service.evidence(other, selected(result.issues[0]))).rejects.toThrow("STALE_ISSUE"); await expect(h.service.ask(other, { threadId: "thread", requestId: "request", question: "Why?", selectedIssueId: result.issues[0].issueId, selectedIssueRevision: result.issues[0].revision })).rejects.toThrow("STALE_ISSUE"); expect(h.db.calls).toHaveLength(before); });
  it("deleted old source retains finding but cannot leave analyzed/current proof or successful zero", async () => {
    const h = serviceHarness(); await firstCheck(h); h.db.tables.conversation_sessions = [];
    const inventory = await h.service.sources(fixtureScope, { sourceKinds: ["sms"] }); expect(inventory.items).toEqual([]); expect(inventory.coverage.partial).toBe(true);
    const feed = await h.service.feed(fixtureScope, { filter: "all" }); expect(feed.coverage).toMatchObject({ read: 1, analyzed: 0, unavailable: 1, partial: true }); expect(feed.groups[0].issues[0].outcome).toBe("review"); expect(feed.groups[0].issues[0].verification).toBeNull();
  });
  it("Vapi primary-family change does not inflate cumulative occurrence counts", async () => {
    const h = serviceHarness({ model: fixtureModel(false) }); h.db.tables.voice_calls = [{ id: "1", vapiCallId: "vapi-1", transcript: "Initial", createdAt: new Date(fixtureAt) }];
    let cursor: string | undefined;
    do { const page = await h.service.sources(fixtureScope, { sourceKinds: ["ai_call"], ...(cursor ? { cursor } : {}) }); cursor = page.continuation ?? undefined; } while (cursor);
    h.db.tables.call_log = [{ id: "1", vapiCallId: "vapi-1", transcript: "Complete later original", calledPhone: fixturePhone, calledTarget: "client", firedAt: new Date(fixtureAt), createdAt: new Date(fixtureAt) }];
    do { const page = await h.service.sources(fixtureScope, { sourceKinds: ["ai_call"], ...(cursor ? { cursor } : {}) }); cursor = page.continuation ?? undefined; } while (cursor);
    expect((await h.service.feed(fixtureScope, { filter: "all" })).coverage.read).toBe(1);
  });
  it("narrow later source scan cannot erase unavailable earlier-family coverage", async () => {
    const h = serviceHarness(); h.db.fail = "gmail_thread_meta";
    let cursor: string | undefined;
    do { const page = await h.service.sources(fixtureScope, { sourceKinds: ["sms", "email"], ...(cursor ? { cursor } : {}) }); cursor = page.continuation ?? undefined; } while (cursor);
    h.db.fail = null; await h.service.sources(fixtureScope, { sourceKinds: ["sms"] });
    const feed = await h.service.feed(fixtureScope, { filter: "all" }); expect(feed.coverage.boundaries.find(boundary => boundary.store === "gmail_thread_meta")?.availability).toBe("missing"); expect(feed.coverage.partial).toBe(true);
  });
  it("source edit during awaited verifier rejects publication even with unchanged client refs", async () => {
    const wait = deferred<void>(), entered = deferred<void>(); const h = serviceHarness();
    const { createRequestVerifier } = await import("./verify"); const { createNativeRecordReader } = await import("./nativeRecords");
    const nativeRecords = createNativeRecordReader({ db: h.db, clock: h.clock, authorizeScope: () => true }); const base = createRequestVerifier({ nativeRecords, clock: h.clock });
    const service = createInstinctService({ ...h.options, verifier: { verify: async (...args) => { const proof = await base.verify(...args); entered.resolve(); await wait.promise; return proof; } } });
    const inventory = await service.sources(fixtureScope, { sourceKinds: ["sms"] }); const pending = service.check(fixtureScope, { sourceRefs: inventory.items.map(item => item.ref), expectedContextRevision: inventory.binding.contextRevision! });
    await entered.promise; h.db.tables.conversation_sessions = [fixtureSession("7", "Changed")]; wait.resolve(); await expect(pending).rejects.toThrow("STALE_CONTEXT"); expect((await service.feed(fixtureScope, { filter: "all" })).groups).toEqual([]);
  });
});

describe("grounded chat seam and runtime scope", () => {
  it("unwired chat honestly returns unavailable with exact question/thread/selection binding", async () => {
    const h = serviceHarness(), { result } = await firstCheck(h), issue = result.issues[0]; const answer = await h.service.ask(fixtureScope, { threadId: "thread", requestId: "request", selectedIssueId: issue.issueId, selectedIssueRevision: issue.revision, question: "Explain" });
    expect(chatAnswerSchema.safeParse(answer).success).toBe(true); expect(answer.status).toBe("unavailable"); expect(answer.failure?.code).toBe("MODEL_UNAVAILABLE"); expect(answer.binding).toMatchObject({ requestId: "request", contextRevision: issue.analysis.contextRevision, selectedIssueId: issue.issueId }); expect(h.model).toHaveBeenCalledTimes(1);
  });
  it("injected chat gets exact read tools and transient ledger context, response binding enforced", async () => {
    let called = false; const ask: InstinctAsk = async (scope, input, tools, context) => {
      called = true; expect(Object.keys(tools)).toContain("readExactCustomerRecords"); expect(context.store.capabilities.durableStoreAvailable).toBe(false);
      const evidence = await tools.readScopedEvidence(scope, { issueId: input.selectedIssueId!, issueRevision: input.selectedIssueRevision! });
      return { binding: { ...evidence.binding, requestId: input.requestId }, coverage: evidence.coverage, capabilities: evidence.capabilities, limitations: evidence.limitations,
        threadId: input.threadId, status: "answered", answer: "The stored request is quoted below.", citations: evidence.citations, recordCitations: [], comparison: evidence.issue.verification, failure: null };
    };
    const h = serviceHarness({ ask }), { result } = await firstCheck(h); const response = await h.service.ask(fixtureScope, { threadId: "thread", requestId: "request", question: "Explain", selectedIssueId: result.issues[0].issueId, selectedIssueRevision: result.issues[0].revision }); expect(called).toBe(true); expect(response.status).toBe("answered");
    expect(chatAnswerSchema.safeParse({ ...response, untrusted: "extra" }).success).toBe(false);
  });
  it("issued original record citation remains valid across fresh observation times with same semantic fingerprint", async () => {
    const ask: InstinctAsk = async (scope, input, tools) => {
      const result = await tools.readScopedEvidence(scope, { issueId: input.selectedIssueId!, issueRevision: input.selectedIssueRevision! }); const snapshot = result.snapshot!, record = snapshot.records.find(record => record.jobId === "20")!;
      return { binding: { ...result.binding, requestId: input.requestId }, coverage: result.coverage, capabilities: result.capabilities, limitations: result.limitations,
        threadId: input.threadId, status: "answered", answer: "Current local time is 09:00.", citations: result.citations,
        recordCitations: [{ snapshotId: snapshot.snapshotId, recordKey: record.key, recordFingerprint: record.fingerprint, field: "localTime", checkedAtUtc: snapshot.checkedAtUtc }], comparison: null, failure: null };
    };
    const h = serviceHarness({ ask }), { result } = await firstCheck(h); let instant = Date.parse(fixtureAt); h.clock.now = () => new Date(instant++);
    const answer = await h.service.ask(fixtureScope, { threadId: "thread", requestId: "request", question: "When?", selectedIssueId: result.issues[0].issueId, selectedIssueRevision: result.issues[0].revision }); expect(answer.status).toBe("answered"); expect(answer.recordCitations).toHaveLength(1);
  });
  it.each(["thread", "request", "quote", "record"])("chat forged %s is rejected rather than displayed", async kind => {
    const ask: InstinctAsk = async (scope, input, tools) => {
      const result = await tools.readScopedEvidence(scope, { issueId: input.selectedIssueId!, issueRevision: input.selectedIssueRevision! });
      return { binding: { ...result.binding, requestId: kind === "request" ? "forged" : input.requestId }, coverage: result.coverage, capabilities: result.capabilities, limitations: [],
        threadId: kind === "thread" ? "forged" : input.threadId, status: "answered", answer: "Untrusted", citations: kind === "quote" ? [{ ...result.citations[0], exactQuote: "X".repeat(result.citations[0].exactQuote.length) }] : result.citations,
        recordCitations: kind === "record" ? [{ snapshotId: "fake-snapshot", recordKey: "booking:999", recordFingerprint: "a".repeat(64), field: "localTime", checkedAtUtc: fixtureAt }] : [], comparison: null, failure: null };
    };
    const h = serviceHarness({ ask }), { result } = await firstCheck(h);
    await expect(h.service.ask(fixtureScope, { threadId: "thread", requestId: "request", question: "Explain", selectedIssueId: result.issues[0].issueId, selectedIssueRevision: result.issues[0].revision })).rejects.toThrow();
  });
  it.each([new Error("mysql://password@secret/sql"), new ReadDbError("DB_SCHEMA"), new InstinctServiceError("STALE_CONTEXT")])("error classes are safe and never include raw secret strings", error => { const value = safeInstinctFailure(error); expect(JSON.stringify(value)).not.toMatch(/password|secret|sql|mysql/); });
  it("installation/source IDs use nonsecret DB identity, not credentials, and secrets rotate without scope drift", () => {
    const env = { DATABASE_URL: "mysql://user:secret@db.example.test:3306/fixture", VITE_APP_ID: "fixture", OPENPHONE_PHONE_NUMBER_ID: "PN-fixture", GMAIL_CLIENT_ID: "mail-fixture" };
    const one = resolveInstinctInstallation(env), two = resolveInstinctInstallation({ ...env, DATABASE_URL: "mysql://newuser:newsecret@db.example.test:3306/fixture" }); expect(one).toEqual(two); expect(JSON.stringify(one)).not.toMatch(/secret|user|db.example|fixture/); expect(resolveInstinctInstallation({ ...env, DATABASE_URL: "mysql://user:secret@db.example.test/other" })).not.toEqual(one);
  });
  it.each(["", "not-a-url", "https://db.example.test/fixture", "mysql://db.example.test/"])("invalid runtime DB identity fails closed without connecting: %s", value => { expect(() => resolveInstinctInstallation({ DATABASE_URL: value })).toThrow("INVALID_SCOPE"); });
  it("no user-configured arbitrary installation/account can enter strict endpoint schemas", async () => { const h = serviceHarness(); await expect(h.service.sources(fixtureScope, Object.assign({ sourceKinds: ["sms" as const] }, { sourceAccountKey: "foreign" }))).rejects.toThrow(); expect(h.db.calls).toHaveLength(0); });
  it("owned service/router implementations and tests compile strictly against actual dependencies", () => {
    const root = path.dirname(fileURLToPath(import.meta.url)), options: ts.CompilerOptions = { noEmit: true, strict: true, skipLibCheck: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, esModuleInterop: true, baseUrl: path.resolve(root, "../.."), paths: { "@shared/*": ["shared/*"] } };
    const program = ts.createProgram([path.join(root, "service.ts"), path.join(root, "service.test.ts")], options);
    expect(ts.getPreEmitDiagnostics(program).map(d => `${d.file?.fileName}:${ts.flattenDiagnosticMessageText(d.messageText, "\n")}`)).toEqual([]);
  });
  it("read-only service source imports no operational dispatch and has no invented quotas or timers", () => {
    const source = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "service.ts"), "utf8"); expect(source).not.toMatch(/localStorage|setInterval|setTimeout|\.send\(|\.sync\(|maxTokens|max_tokens|\bLIMIT\b/);
    expect([...source.matchAll(/from\s+["']([^"']+)["']/g)].map(match => match[1])).not.toContain("../db");
  });
});

describe("foreground completion and cumulative coverage", () => {
  it("completed analysis with unresolved customer remains analyzed, review, and partially verified", async () => {
    const h = serviceHarness(); h.db.tables.bookings.push({ ...fixtureBooking(), id: "2", customerEmail: "other@example.test" });
    const { result } = await firstCheck(h); expect(result.analysis.status).toBe("complete"); expect(result.issues[0].identity.decision).toBe("ambiguous"); expect(result.issues[0].outcome).toBe("review");
    const feed = await h.service.feed(fixtureScope, { filter: "all" }); expect(feed.coverage).toMatchObject({ read: 1, analyzed: 1, unprocessed: 0, unavailable: 0, partial: true }); expect(feed.totals.verifiedCustomers).toBe(0); expect(feed.totals.outcomes.matches_current).toBe(0);
  });
  it("successful partial-source interpretation counts usable original and never claims No-action", async () => {
    const h = serviceHarness({ model: fixtureModel(false) }); h.db.tables.gmail_thread_meta = [{ id: "1", threadId: "thread-1", snippet: "Thanks", createdAt: new Date(fixtureAt) }];
    h.db.tables.madison_email_drafts = [{ id: "1", threadId: "thread-1", inboundMessageId: "mail-1", originalMessage: "Stored original body", fromEmail: "fixture@example.test", createdAt: new Date(fixtureAt) }];
    let cursor: string | undefined; const items = [];
    do { const page = await h.service.sources(fixtureScope, { sourceKinds: ["email"], ...(cursor ? { cursor } : {}) }); items.push(...page.items); cursor = page.continuation ?? undefined; } while (cursor);
    for (const revision of new Set(items.map(item => item.ref.contextFingerprint))) {
      const refs = items.filter(item => item.ref.contextFingerprint === revision).map(item => item.ref), result = await h.service.check(fixtureScope, { sourceRefs: refs, expectedContextRevision: revision });
      expect(result.analysis).toMatchObject({ status: "partial", completedSegments: result.analysis.totalSegments, reductionComplete: true, failure: "PARTIAL_CONTEXT" }); expect(result.issues.every(issue => issue.outcome === "review")).toBe(true);
    }
    const feed = await h.service.feed(fixtureScope, { filter: "all" }); expect(feed.coverage).toMatchObject({ read: items.length, analyzed: items.length, unprocessed: 0, unavailable: 0, partial: true }); expect(feed.totals.outcomes.no_action).toBe(0);
  });
  it.each([
    { status: "partial" as const, totalSegments: 2, completedSegments: 1, reductionComplete: false, failure: "PARTIAL_CONTEXT" as const },
    { status: "partial" as const, totalSegments: 2, completedSegments: 2, reductionComplete: false, failure: "PARTIAL_CONTEXT" as const },
    { status: "unavailable" as const, totalSegments: 2, completedSegments: 1, reductionComplete: false, failure: "MODEL_TIMEOUT" as const },
  ])("segment/reduction failure remains unprocessed or unavailable: %j", async receipt => {
    const interpreter = { interpret: vi.fn(async (_scope, request) => ({ ...receipt, contextRevision: request.context.manifest.revision, contextFingerprint: request.context.manifest.contextFingerprint, actions: [], limitations: ["Incomplete interpretation"] })) } satisfies NonNullable<InstinctServiceOptions["interpreter"]>;
    const h = serviceHarness({ interpreter }), { result } = await firstCheck(h), failed = receipt.status === "unavailable";
    expect(result.coverage).toMatchObject({ read: 1, analyzed: 0, unprocessed: failed ? 0 : 1, unavailable: failed ? 1 : 0, partial: true });
    expect((await h.service.feed(fixtureScope, { filter: "all" })).coverage).toMatchObject({ analyzed: 0, unprocessed: failed ? 0 : 1, unavailable: failed ? 1 : 0, partial: true }); expect(h.model).not.toHaveBeenCalled();
  });
  it("feed completion can refresh during an in-flight inventory page without resetting cursor or accumulated counts", async () => {
    const h = serviceHarness({ model: fixtureModel(false) }); h.db.tables.conversation_sessions.push(fixtureSession("8", "Thanks"));
    const base = createStoredSourceReader({ scope: fixtureScope, db: h.db, clock: h.clock }), wait = deferred<void>(), entered = deferred<void>();
    const sources: SourceReader = { ...base, inventory: async (...args) => { if (args[1].cursor) { entered.resolve(); await wait.promise; } return base.inventory(...args); } };
    const service = createInstinctService({ ...h.options, sources }), first = await service.sources(fixtureScope, { sourceKinds: ["sms"] });
    const continuing = service.sources(fixtureScope, { sourceKinds: ["sms"], cursor: first.continuation! }); await entered.promise;
    await service.check(fixtureScope, { sourceRefs: first.items.map(item => item.ref), expectedContextRevision: first.items[0].ref.contextFingerprint });
    expect((await service.feed(fixtureScope, { filter: "all" })).coverage).toMatchObject({ read: 1, analyzed: 1, unprocessed: 0, continuation: first.continuation });
    wait.resolve(); const second = await continuing; expect(second.coverage).toMatchObject({ read: 2, analyzed: 1, unprocessed: 1 });
    const third = await service.sources(fixtureScope, { sourceKinds: ["sms"], cursor: second.continuation! }); expect(third.coverage).toMatchObject({ read: 2, analyzed: 1, unprocessed: 1 });
    expect((await service.feed(fixtureScope, { filter: "all" })).coverage).toMatchObject({ read: 2, analyzed: 1, unprocessed: 1 }); expect(h.options.model).toHaveBeenCalledTimes(1);
  });
  it("ready work unit registers exact cross-family originals before pagination ends, without duplicate observations", async () => {
    const h = serviceHarness({ model: fixtureModel(false) });
    for (const table of ["voice_calls", "call_log"]) h.db.tables[table] = [{ id: "1", vapiCallId: "vapi-1", transcript: `Original ${table}`, calledPhone: fixturePhone, calledTarget: "client", firedAt: new Date(fixtureAt), createdAt: new Date(fixtureAt) }];
    const base = createStoredSourceReader({ scope: fixtureScope, db: h.db, clock: h.clock });
    const sources: SourceReader = { ...base, inventory: async (...args) => {
      const result = await base.inventory(...args);
      if (!result.items.length) return result;
      const context = await base.readContext(args[0], result.items.map(item => item.ref), result.items[0].ref.contextFingerprint);
      return { ...result, readyContexts: [{ contextFingerprint: context.manifest.contextFingerprint, refs: context.evidence.map(item => item.ref) }] };
    } };
    const service = createInstinctService({ ...h.options, sources }), page = await service.sources(fixtureScope, { sourceKinds: ["ai_call"] });
    expect(page.continuation).not.toBeNull(); expect(page.items).toHaveLength(1); expect(page.readyContexts![0].refs).toHaveLength(2);
    const ready = page.readyContexts![0], result = await service.check(fixtureScope, { sourceRefs: ready.refs, expectedContextRevision: ready.contextFingerprint });
    expect(result.analysis.completedSegments).toBe(result.analysis.totalSegments); expect(result.coverage).toMatchObject({ read: 2, analyzed: 2, unprocessed: 0, unavailable: 0, partial: true });
    expect((await service.feed(fixtureScope, { filter: "all" })).coverage).toMatchObject({ read: 1, analyzed: 1, unprocessed: 0, unavailable: 0, partial: true });
    await expect(service.check({ ...fixtureScope, actor: { staffId: "2", role: "admin" } }, { sourceRefs: ready.refs, expectedContextRevision: ready.contextFingerprint })).rejects.toThrow("INVALID_SOURCE_REFERENCE");
    let cursor = page.continuation; while (cursor) { const next = await service.sources(fixtureScope, { sourceKinds: ["ai_call"], cursor }); cursor = next.continuation; }
    expect((await service.feed(fixtureScope, { filter: "all" })).coverage).toMatchObject({ read: 1, analyzed: 1 }); expect(h.options.model).toHaveBeenCalledTimes(1);
  });
  it("same-account forged cross-context ready ref is never issued when absent from trusted reader context", async () => {
    const h = serviceHarness(), base = createStoredSourceReader({ scope: fixtureScope, db: h.db, clock: h.clock });
    let forged: SourceInventory["items"][number]["ref"] | undefined, revision = "";
    const sources: SourceReader = { ...base, inventory: async (...args) => {
      const result = await base.inventory(...args); revision = result.items[0].ref.contextFingerprint;
      forged = { ...result.items[0].ref, sourceId: "session:999:message:0", sessionId: "999" };
      return { ...result, readyContexts: [{ contextFingerprint: revision, refs: [result.items[0].ref, forged] }] };
    } };
    const service = createInstinctService({ ...h.options, sources });
    await expect(service.sources(fixtureScope, { sourceKinds: ["sms"] })).rejects.toThrow("STALE_CONTEXT"); const before = h.db.calls.length;
    await expect(service.check(fixtureScope, { sourceRefs: [forged!], expectedContextRevision: revision })).rejects.toThrow("INVALID_SOURCE_REFERENCE"); expect(h.db.calls).toHaveLength(before); expect((await service.feed(fixtureScope, { filter: "all" })).coverage.read).toBe(0); expect(h.options.model).not.toHaveBeenCalled();
  });
});
