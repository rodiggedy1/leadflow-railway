import { createHash, randomUUID } from "node:crypto";
import {
  authorizedScopeSchema, evidenceRefSchema, inventoryBoundarySchema, sourceContextSchema,
  sourceInventorySchema, sourcesInputSchema, storedEvidenceSchema, sameEvidenceRef, STAGE1_CAPABILITIES,
  type AuthorizedScope, type Clock, type EvidenceRef, type InventoryBoundary, type OriginalTurn,
  type SourceContext, type SourceInventory, type SourceKind, type SourceReader, type SourceStore,
  type SourcesInput, type StoredEvidence,
} from "../../shared/instinct";
import { createLazyReadDb, safeReadDbError, type InstallationReadScope, type ReadDb, type SelectPort, type SqlRow } from "./readDb";
import { normalizePhone } from "../utils/phone";

/** Verified projections from schema.ts and their source writers. No SELECT *,
 * inferred tenant FK, operational legacy link, provider detail or source write. */
export const SOURCE_COLUMNS: Readonly<Record<SourceStore, readonly string[]>> = Object.freeze({
  conversation_sessions: ["id", "leadPhone", "leadName", "messageHistory", "createdAt", "updatedAt"],
  inbound_sms: ["id", "fromPhone", "toPhone", "message", "openPhoneMessageId", "receivedAt", "createdAt"],
  gmail_thread_meta: ["id", "threadId", "senderName", "senderEmail", "subject", "snippet", "lastMessageAt", "messageCount", "aiHistoryId", "createdAt", "updatedAt"],
  madison_email_drafts: ["id", "threadId", "inboundMessageId", "sessionId", "fromEmail", "replyToEmail", "senderName", "subject", "originalMessage", "status", "createdAt", "updatedAt"],
  openphone_call_recordings: ["id", "sessionId", "openphoneCallId", "callerPhone", "direction", "durationSeconds", "recordingUrl", "status", "callStartedAt", "transcript", "createdAt"],
  voice_calls: ["id", "vapiCallId", "sessionId", "callerPhone", "durationSeconds", "transcript", "summary", "structuredData", "endedReason", "createdAt"],
  call_log: ["id", "vapiCallId", "calledPhone", "calledTarget", "templateId", "templateName", "status", "transcript", "transcriptLanguage", "transcriptEnglish", "firedAt", "completedAt", "durationSeconds", "createdAt", "updatedAt"],
  field_mgmt_calls: ["id", "vapiCallId", "clientStatusInquirySessionId", "step", "calledPhone", "outcome", "transcript", "summary", "completedAt", "createdAt"],
  confirmation_calls: ["id", "vapiCallId", "leadflowJobId", "jobDate", "calledPhone", "status", "transcript", "summary", "firedAt", "completedAt", "durationSeconds", "createdAt", "updatedAt"],
});
const AI_STORES: readonly SourceStore[] = ["voice_calls", "call_log", "field_mgmt_calls", "confirmation_calls"];
const ALL_STORES = Object.keys(SOURCE_COLUMNS) as SourceStore[];
function hash(value: unknown): string { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
function object(value: unknown): Record<string, unknown> | null { return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null; }
function text(value: unknown): string | null { return typeof value === "string" && value.trim() ? value : null; }
function id(value: unknown): string | null {
  const result = typeof value === "bigint" ? value.toString() : typeof value === "number" && Number.isSafeInteger(value) ? String(value) : typeof value === "string" ? value : "";
  return /^[1-9]\d*$/.test(result) ? result : null;
}
function provider(value: unknown): string | null { return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(value) ? value : null; }
/** Numeric source times are milliseconds. Offset-less source strings are not
 * original instants; mysql2 returns Date with a UTC-configured connection. */
export function sourceInstant(value: unknown): string | null {
  let date: Date;
  if (value instanceof Date) date = value;
  else if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) date = new Date(value);
  else if (typeof value === "string" && /^\d+$/.test(value) && Number.isSafeInteger(Number(value)) && Number(value) > 0) date = new Date(Number(value));
  else if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/.test(value)) {
    const day = value.slice(0, 10); const midnight = new Date(`${day}T00:00:00.000Z`);
    if (!Number.isFinite(midnight.getTime()) || midnight.toISOString().slice(0, 10) !== day) return null;
    const clock = value.slice(11, 19).split(":");
    if (Number(clock[0]) > 23 || Number(clock[1]) > 59 || Number(clock[2] ?? 0) > 59) return null;
    date = new Date(value);
  } else return null;
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}
function storesFor(kinds: readonly SourceKind[]): SourceStore[] {
  return ALL_STORES.filter(store => store === "conversation_sessions" || store === "inbound_sms" ? kinds.includes("sms")
    : store === "gmail_thread_meta" || store === "madison_email_drafts" ? kinds.includes("email")
      : store === "openphone_call_recordings" ? kinds.includes("human_call") || kinds.includes("phone_unverified") : kinds.includes("ai_call"));
}
function projection(store: SourceStore): string { return SOURCE_COLUMNS[store].map(column => `\`${column}\``).join(", "); }
function rows(port: SelectPort, store: SourceStore, where: string, params: readonly (string | number | null)[]): Promise<SqlRow[]> {
  return port.select(`SELECT ${projection(store)} FROM \`${store}\` ${where}`, params);
}
/** Inclusive rolling 48h maximum, captured once per traversal. localDay may
 * select conversations inside this slice; it never expands the maximum. */
interface RecentWindow { start: string; end: string }
function recentWindow(capturedAtUtc: string): RecentWindow {
  return { start: new Date(Date.parse(capturedAtUtc) - 48 * 60 * 60 * 1000).toISOString(), end: capturedAtUtc };
}
function within(at: string | null, window: RecentWindow): boolean { return at !== null && at >= window.start && at <= window.end; }
function occurrence(store: SourceStore, row: SqlRow): string | null {
  return store === "openphone_call_recordings" ? sourceInstant(row.callStartedAt)
    : store === "call_log" || store === "confirmation_calls" ? sourceInstant(row.firedAt) : null;
}
function observation(store: SourceStore, row: SqlRow): string | null {
  return store === "inbound_sms" ? sourceInstant(row.receivedAt) ?? sourceInstant(row.createdAt)
    : store === "gmail_thread_meta" ? sourceInstant(row.lastMessageAt) ?? sourceInstant(row.updatedAt) ?? sourceInstant(row.createdAt)
      : store === "madison_email_drafts" || store === "conversation_sessions" ? sourceInstant(row.updatedAt) ?? sourceInstant(row.createdAt)
        : store === "field_mgmt_calls" ? sourceInstant(row.completedAt) ?? sourceInstant(row.createdAt)
          : sourceInstant(row.updatedAt) ?? sourceInstant(row.createdAt);
}
function recentRow(store: SourceStore, row: SqlRow, window: RecentWindow): boolean {
  return within(occurrence(store, row) ?? observation(store, row), window);
}
/** SQL narrowing precedes history parsing and transcript loading. TIMESTAMP and
 * DATETIME binds use UTC mysql strings; the verified BIGINT columns use Unix ms.
 * A known old original call can never re-enter through a recent update. */
function recentPredicate(store: SourceStore, window: RecentWindow): { sql: string; params: (string | number)[] } {
  const date = (at: string) => at.replace("T", " ").replace("Z", "");
  const dated = (expr: string) => ({ sql: `${expr} >= ? AND ${expr} <= ?`, params: [date(window.start), date(window.end)] });
  const numeric = (expr: string) => ({ sql: `${expr} >= ? AND ${expr} <= ?`, params: [Date.parse(window.start), Date.parse(window.end)] });
  if (store === "inbound_sms" || store === "gmail_thread_meta") {
    const column = store === "inbound_sms" ? "`receivedAt`" : "`lastMessageAt`";
    const original = numeric(column); const fallback = dated("COALESCE(`updatedAt`, `createdAt`)");
    if (store === "inbound_sms") return original;
    return { sql: `((${original.sql}) OR (${column} IS NULL AND ${fallback.sql}))`, params: [...original.params, ...fallback.params] };
  }
  if (store === "call_log" || store === "confirmation_calls") {
    const original = numeric("`firedAt`"); const fallback = dated("COALESCE(`updatedAt`, `createdAt`)");
    return { sql: `((${original.sql}) OR (` + "`firedAt` IS NULL AND " + `${fallback.sql}))`, params: [...original.params, ...fallback.params] };
  }
  if (store === "openphone_call_recordings") return dated("COALESCE(`callStartedAt`, `createdAt`)");
  if (store === "field_mgmt_calls") return dated("COALESCE(`completedAt`, `createdAt`)");
  if (store === "voice_calls") return dated("`createdAt`");
  return dated("COALESCE(`updatedAt`, `createdAt`)");
}
export class SourceReadError extends Error {
  constructor(readonly code: "INVALID_SCOPE" | "INVALID_SOURCE_REFERENCE" | "STALE_CONTEXT" | "SOURCE_UNAVAILABLE") { super(code); this.name = "SourceReadError"; }
}
export interface StoredSourceOptions {
  /** Scope is installation configuration resolved by the server, never API input. */
  readonly scope: InstallationReadScope;
  readonly db?: ReadDb;
  readonly clock?: Clock;
  /** Optional trusted native-link validation; default never claims a workflow
   * owned customer link. No raw legacy field enters this callback. */
  readonly validateWorkflow?: (scope: AuthorizedScope, store: "field_mgmt_calls" | "confirmation_calls", row: SqlRow, port: SelectPort) => Promise<boolean>;
}
interface RowContext { context: SourceContext; canonicalKey: string; primary: StoredEvidence }
interface Traversal {
  originInventoryId: string;
  boundary: InventoryBoundary; sourceKinds: SourceKind[]; localDay?: string;
  familyIndex: number; afterId: string | null; seen: Set<string>;
  revisions: Map<string, string>; prior?: Map<string, string>; phase: "inventory" | "reconciliation";
}
interface BoundState { scopeKey: string; inputKey: string; boundary: InventoryBoundary; localDay?: string; acceptedBoundaries: Set<string>; revisions: Map<string, string> }
const emptyParticipants = () => ({ from: null as string | null, to: [] as string[], cc: [] as string[], replyTo: null as string | null, businessLine: null as string | null, mailbox: null as string | null });

/** Parse only SQL-selected recent rows, normalize only timestamp-eligible SMS.
 * Unknown-time SMS bodies never enter analysis; one unavailable gap accounts
 * for them without importing an unbounded undated historical conversation. */
function normalizeRow(store: SourceStore, row: SqlRow, scope: AuthorizedScope, fallbackAt: string, window: RecentWindow, workflowVerified = false): StoredEvidence[] {
  const rowId = id(row.id); if (!rowId) throw new SourceReadError("SOURCE_UNAVAILABLE");
  const observedAtUtc = observation(store, row) ?? occurrence(store, row) ?? fallbackAt;
  let history: unknown; const selected: { value: unknown; index: number }[] = []; let unknownCount = 0;
  if (store === "conversation_sessions") {
    try { history = typeof row.messageHistory === "string" ? JSON.parse(row.messageHistory) : row.messageHistory; } catch { history = null; }
    if (Array.isArray(history)) history.forEach((value, index) => {
      const entry = object(value); const at = sourceInstant(entry?.ts) ?? sourceInstant(entry?.timestamp);
      if (within(at, window)) selected.push({ value, index });
      else if (!at) unknownCount++;
    });
  }
  const { messageHistory: _history, ...metadata } = row;
  const revision = hash([scope.installationScope, scope.sourceAccountKey, store, store === "conversation_sessions" ? [metadata, selected, unknownCount, Array.isArray(history)] : row]);
  const common = (sourceId: string, sourceKind: SourceKind, providerId: string | null, sessionId: string | null, threadId: string | null, occurredAtUtc: string | null, timeBasis: EvidenceRef["timeBasis"], handlingEvidence: string | null): EvidenceRef => ({
    store, sourceId, sourceKind, providerId, sourceRevision: revision, contextFingerprint: "0".repeat(64),
    sourceAccountKey: scope.sourceAccountKey, sessionId, threadId, occurredAtUtc, observedAtUtc, timeBasis, handlingEvidence,
  });
  const build = (ref: EvidenceRef, originalText: string | null, limitations: string[], additions: Partial<StoredEvidence> = {}): StoredEvidence => ({
    ref, originalText, originalTurns: [], translatedText: null, participants: emptyParticipants(), direction: "unknown",
    contentBasis: originalText === null ? "missing" : "original_full", availability: originalText === null ? "missing" : limitations.length ? "partial" : "complete",
    limitations: [...limitations], ...additions,
  });
  if (store === "conversation_sessions") {
    if (!Array.isArray(history) || !history.length) return [build(common(`session:${rowId}:history`, "sms", null, rowId, null, null, "unknown", null), null,
      [Array.isArray(history) ? "Stored conversation history is empty" : "Stored conversation history is malformed"], { availability: Array.isArray(history) ? "missing" : "malformed" })];
    const providerCounts = new Map<string, number>();
    const entryIds = (entry: Record<string, unknown>): string[] => [...Array.from(new Set([entry, object(entry.metadata)].flatMap(value => value ? [value.opMsgId, value.openPhoneId, value.openPhoneMessageId, value.providerMessageId].map(provider).filter((value): value is string => value !== null) : [])))];
    for (const { value } of selected) { const entry = object(value); if (entry) for (const key of entryIds(entry)) providerCounts.set(key, (providerCounts.get(key) ?? 0) + 1); }
    const evidence = selected.map(({ value, index }) => {
      const entry = object(value); const metadata = object(entry?.metadata); const envelopes = [entry, metadata].filter((value): value is Record<string, unknown> => value !== null);
      const limitations: string[] = []; const originalText = typeof entry?.content === "string" ? entry.content : null;
      const role: OriginalTurn["role"] = entry?.role === "user" || entry?.role === "customer" ? "customer" : entry?.role === "assistant" ? "assistant" : entry?.role === "staff" ? "staff" : "unknown";
      const direction = role === "customer" ? "inbound" : role === "assistant" || role === "staff" ? "outbound" : "unknown";
      const at = sourceInstant(entry?.ts) ?? sourceInstant(entry?.timestamp);
      if (!entry || originalText === null || !originalText.trim()) limitations.push("Stored history entry has no valid original text");
      if (role === "unknown") limitations.push("Stored history entry is not an attributed conversation speaker");
      if (!at) limitations.push("Original message occurrence timestamp is missing or invalid");
      const get = (keys: string[]): string[] => [...Array.from(new Set(envelopes.flatMap(value => keys.flatMap(key => Array.isArray(value[key]) ? value[key] : [value[key]]).filter((value): value is string => typeof value === "string" && !!value).map(value => normalizePhone(value) ?? value))))];
      const from = get(["from", "fromPhone"]); const to = get(["to", "toPhone"]); const lines = get(["businessPhone", "businessLine"]);
      const businessEndpoints = direction === "inbound" ? to : direction === "outbound" ? from : [];
      const businessLine = [...Array.from(new Set([...lines, ...businessEndpoints]))];
      if (!businessLine.length) limitations.push("Historical per-message business line is not stored");
      if (businessLine.length > 1 || from.length > 1 || to.length > 1) limitations.push("Conflicting or grouped message endpoints");
      const customerEndpoint = direction === "inbound" ? from : direction === "outbound" ? to : [];
      const sessionPhone = normalizePhone(text(row.leadPhone));
      const explicitConflict = envelopes.some(value => {
        for (const key of ["from", "fromPhone", "to", "toPhone", "businessPhone", "businessLine", "customerPhone"]) {
          if (value[key] == null) continue;
          const values = Array.isArray(value[key]) ? value[key] : [value[key]];
          if (values.length !== 1 || typeof values[0] !== "string" || !normalizePhone(values[0])) return true;
          if (key === "customerPhone" && normalizePhone(values[0]) !== sessionPhone) return true;
        }
        if (value.cc != null && (!Array.isArray(value.cc) || value.cc.length > 0)) return true;
        return value.direction != null && value.direction !== direction && value.direction !== (direction === "inbound" ? "incoming" : "outgoing");
      });
      if (explicitConflict) limitations.push("Explicit message participants or direction conflict with stored session");
      if (customerEndpoint.some(value => !sessionPhone || normalizePhone(value) !== sessionPhone) || envelopes.some(value => value.sessionId != null && id(value.sessionId) !== rowId)) limitations.push("Message customer/session binding conflicts with stored session");
      const ids = entry ? entryIds(entry) : [];
      if (ids.length > 1 || ids.some(key => (providerCounts.get(key) ?? 0) > 1)) limitations.push("Conflicting or repeated provider message identity; all originals retained");
      const ref = common(`session:${rowId}:message:${index}`, "sms", ids[0] ?? null, rowId, null, at, at ? "history" : "unknown", null);
      const item = build(ref, originalText, limitations, { direction, participants: { ...emptyParticipants(), from: from[0] ?? (direction === "inbound" ? text(row.leadPhone) : null), to: to.length ? to : direction === "outbound" && text(row.leadPhone) ? [row.leadPhone as string] : [], businessLine: businessLine.length === 1 ? businessLine[0] : null } });
      if (originalText !== null) item.originalTurns.push({ turnId: `message:${index}`, speaker: text(entry?.senderName) ?? text(entry?.role), role, text: originalText, start: 0, end: originalText.length, occurredAtUtc: at, timeBasis: at ? "history" : "unknown" });
      if (!entry || originalText === null) item.availability = "malformed";
      return item;
    });
    if (unknownCount) evidence.push(build(common(`session:${rowId}:history`, "sms", null, rowId, null, null, "unknown", null), null,
      [`${unknownCount} stored history entries have missing or invalid original timestamp; two-day membership is unresolved and their text is withheld`], { availability: "missing" }));
    return evidence;
  }
  if (store === "inbound_sms") {
    const ref = common(`sms:${rowId}`, "sms", provider(row.openPhoneMessageId), null, null, null, "received", null);
    const gaps = ["receivedAt is observation, not original message occurrence", "No verified conversation/session linkage"];
    if (!text(row.toPhone)) gaps.push("Business recipient line is missing");
    return [build(ref, text(row.message), gaps, { direction: "inbound", participants: { ...emptyParticipants(), from: text(row.fromPhone), to: text(row.toPhone) ? [row.toPhone as string] : [], businessLine: text(row.toPhone) } })];
  }
  if (store === "gmail_thread_meta" || store === "madison_email_drafts") {
    const draft = store === "madison_email_drafts";
    const gaps = ["Stored email snapshot does not prove complete original body capture", "Original mailbox and recipient/CC headers are not stored", "Original per-message date provenance is not stored"];
    if (!draft) gaps.push("Thread metadata/snippet is not an original message; message ID is missing");
    const ref = common(`${draft ? "draft" : "thread-meta"}:${rowId}`, "email", draft ? provider(row.inboundMessageId) : null, draft ? id(row.sessionId) : null, provider(row.threadId), null, "stored_record", null);
    return [build(ref, text(draft ? row.originalMessage : row.snippet), gaps, { contentBasis: draft ? "stored_snapshot" : "snippet", direction: "unknown", participants: { ...emptyParticipants(), from: text(draft ? row.fromEmail : row.senderEmail), replyTo: draft ? text(row.replyToEmail) : null } })];
  }
  if (store === "openphone_call_recordings") {
    const at = sourceInstant(row.callStartedAt); const gaps = ["OpenPhone provider alone does not verify human handling", "Stored speaker identifiers do not verify customer/staff identity", "Stored session linkage was selected by latest phone match and needs independent corroboration"];
    if (!at) gaps.push("Original call occurrence timestamp is missing");
    const ref = common(`call:${rowId}`, "phone_unverified", provider(row.openphoneCallId), id(row.sessionId), null, at, at ? "call_started" : "unknown", null);
    let dialogue: unknown; try { dialogue = typeof row.transcript === "string" ? JSON.parse(row.transcript) : row.transcript; } catch { dialogue = null; }
    if (!Array.isArray(dialogue) || !dialogue.length) return [build(ref, null, [...gaps, "Original transcript is missing or malformed"], { availability: row.transcript ? "malformed" : "missing" })];
    let originalText = ""; const turns: OriginalTurn[] = [];
    dialogue.forEach((raw, index) => {
      const turn = object(raw);
      if (!turn || typeof turn.content !== "string") { gaps.push(`Malformed transcript turn ${index}; original JSON retained in revision`); return; }
      if (turns.length) originalText += "\n";
      const start = originalText.length; originalText += turn.content;
      // OpenPhone start/end are seconds in the recording, NOT text offsets or UTC.
      // The source writer does not establish an absolute per-turn time, so cite call occurrence.
      turns.push({ turnId: `turn:${index}`, speaker: text(turn.identifier), role: "unknown", text: turn.content, start, end: originalText.length, occurredAtUtc: at, timeBasis: at ? "call_started" : "unknown" });
    });
    return [build(ref, turns.length ? originalText : null, gaps, { originalTurns: turns, direction: row.direction === "incoming" ? "inbound" : row.direction === "outgoing" ? "outbound" : "unknown", participants: { ...emptyParticipants(), from: row.direction === "incoming" ? text(row.callerPhone) : null, to: row.direction === "outgoing" && text(row.callerPhone) ? [row.callerPhone as string] : [] }, availability: turns.length ? "partial" : "malformed" })];
  }
  const sessionId = store === "voice_calls" ? id(row.sessionId) : store === "field_mgmt_calls" ? id(row.clientStatusInquirySessionId) : null;
  const at = store === "call_log" || store === "confirmation_calls" ? sourceInstant(row.firedAt) : null;
  const gaps = ["Stored AI transcript does not independently verify customer speaker identity", "Business call line is not stored", "Transcript finalization/completeness provenance is not stored"];
  if (!at) gaps.push("Record creation/completion is not original call occurrence time");
  if (store === "voice_calls") gaps.push("Caller phone may be forwarding or model-derived; session was matched by latest phone and needs corroboration");
  if (store === "field_mgmt_calls" || store === "confirmation_calls") {
    if (!workflowVerified) gaps.push("Workflow/native customer linkage is not independently validated");
  }
  if (store === "call_log" && row.calledTarget !== "client") gaps.push("Stored call target is not a verified customer");
  const originalText = text(row.transcript); const translatedText = store === "call_log" ? text(row.transcriptEnglish) : null;
  const ref = common(`call:${rowId}`, "ai_call", provider(row.vapiCallId), sessionId, null, at, at ? "call_started" : "stored_record", `Stored Vapi family ${store}${workflowVerified ? "; native workflow link independently validated" : "; workflow/customer attribution unverified"}`);
  const inbound = store === "voice_calls";
  const item = build(ref, originalText, gaps, { translatedText, direction: inbound ? "inbound" : "outbound", participants: { ...emptyParticipants(), from: inbound ? text(row.callerPhone) : null, to: !inbound && text(row.calledPhone) ? [row.calledPhone as string] : [] }, contentBasis: originalText ? "stored_snapshot" : translatedText ? "translation_only" : "missing" });
  if (originalText) item.originalTurns.push({ turnId: "transcript:0", speaker: null, role: "unknown", text: originalText, start: 0, end: originalText.length, occurredAtUtc: at, timeBasis: at ? "call_started" : "unknown" });
  return [item];
}

export function createStoredSourceReader(options: StoredSourceOptions): SourceReader {
  const db = options.db ?? createLazyReadDb(); const clock = options.clock ?? { now: () => new Date() };
  const boundaries = new Map<string, BoundState>(); const cursors = new Map<string, { scopeKey: string; traversal: Traversal }>();
  const capturedContexts = new Map<string, { window: RecentWindow; capturedAtUtc: string }>();
  const scopeKey = (scope: AuthorizedScope) => hash([scope.installationScope, scope.sourceAccountKey, scope.authorizationVersion, scope.actor]);
  const authorize = (scope: AuthorizedScope): void => {
    const parsed = authorizedScopeSchema.safeParse(scope);
    if (!parsed.success || scope.installationScope !== options.scope.installationScope || scope.sourceAccountKey !== options.scope.sourceAccountKey || scope.authorizationVersion !== options.scope.authorizationVersion) throw new SourceReadError("INVALID_SCOPE");
  };
  const now = () => clock.now().toISOString();
  const capture = async (scope: AuthorizedScope, input: SourcesInput): Promise<InventoryBoundary> => {
    authorize(scope); sourcesInputSchema.parse(input);
    const capturedAtUtc = now(); const families: InventoryBoundary["families"] = [];
    for (const store of storesFor(input.sourceKinds)) {
      try {
        const recent = recentPredicate(store, recentWindow(capturedAtUtc));
        const result = await db.select(`SELECT MAX(\`id\`) AS \`throughId\` FROM \`${store}\` WHERE ${recent.sql}`, recent.params);
        const upper = result[0]?.throughId; const throughId = upper == null ? null : id(upper);
        if (upper != null && throughId === null) throw new SourceReadError("SOURCE_UNAVAILABLE");
        families.push({ store, throughId, observedAtUtc: capturedAtUtc, availability: "complete", limitations: [] });
      } catch (error) { families.push({ store, throughId: null, observedAtUtc: capturedAtUtc, availability: "missing", limitations: [safeReadDbError(error).reason] }); }
    }
    const boundary = inventoryBoundarySchema.parse({ inventoryId: `inventory:${randomUUID()}`, sourceAccountKey: scope.sourceAccountKey, authorizationVersion: scope.authorizationVersion, sourceKinds: [...input.sourceKinds], families, capturedAtUtc });
    boundaries.set(boundary.inventoryId, { scopeKey: scopeKey(scope), inputKey: hash([input.sourceKinds, input.localDay ?? null]), boundary, localDay: input.localDay, acceptedBoundaries: new Set([hash(boundary)]), revisions: new Map() });
    return boundary;
  };
  const bound = (scope: AuthorizedScope, boundary: InventoryBoundary): BoundState => {
    authorize(scope); inventoryBoundarySchema.parse(boundary);
    const state = boundaries.get(boundary.inventoryId);
    if (!state || state.scopeKey !== scopeKey(scope) || !state.acceptedBoundaries.has(hash(boundary))) throw new SourceReadError("INVALID_SCOPE");
    return state;
  };
  const contextFor = async (scope: AuthorizedScope, store: SourceStore, row: SqlRow, at: string, port: SelectPort, window = recentWindow(at)): Promise<RowContext> => {
    const related: { store: SourceStore; row: SqlRow; verified: boolean }[] = [];
    const gaps: string[] = [];
    const pid = AI_STORES.includes(store) ? provider(row.vapiCallId) : null;
    const thread = store === "gmail_thread_meta" || store === "madison_email_drafts" ? provider(row.threadId) : null;
    if (pid || thread) {
      const families = pid ? AI_STORES : ["gmail_thread_meta", "madison_email_drafts"] as const;
      for (const family of families) {
        try {
          const recent = recentPredicate(family, window);
          const found = await rows(port, family, `WHERE \`${pid ? "vapiCallId" : "threadId"}\` = ? AND (${recent.sql}) ORDER BY \`id\` ASC`, [pid ?? thread, ...recent.params]);
          for (const item of found) {
            if (!recentRow(family, item, window)) continue;
            let verified = false;
            if ((family === "confirmation_calls" || family === "field_mgmt_calls") && options.validateWorkflow) {
              try { verified = await options.validateWorkflow(scope, family, item, port); } catch { gaps.push(`Workflow validation unavailable: ${family}`); }
            }
            related.push({ store: family, row: item, verified });
          }
        } catch (error) { gaps.push(`${family}: ${safeReadDbError(error).reason}`); }
      }
    }
    if (!related.some(item => item.store === store && id(item.row.id) === id(row.id))) related.push({ store, row, verified: false });
    const raw = related.filter(item => recentRow(item.store, item.row, window)).flatMap(item => normalizeRow(item.store, item.row, scope, at, window, item.verified));
    const phones = [...Array.from(new Set(raw.flatMap(item => [item.participants.from, ...item.participants.to]).filter((value): value is string => !!value && value.startsWith("+"))))];
    const originals = [...Array.from(new Set(raw.map(item => item.originalText).filter((value): value is string => value !== null)))];
    if (pid && phones.length > 1) gaps.push("Cross-family Vapi customer contacts conflict; originals retained");
    if (pid && originals.length > 1) gaps.push("Cross-family Vapi original transcripts differ; all versions retained without precedence erasure");
    // Hash only actual slice membership/content/provenance, never the shifting
    // cutoff or capture clock. An unchanged recent refresh does not re-model.
    const contextFingerprint = hash([scope.installationScope, scope.sourceAccountKey, raw, gaps]);
    const evidence = raw.map(item => storedEvidenceSchema.parse({ ...item, ref: { ...item.ref, contextFingerprint }, limitations: [...item.limitations, ...gaps], availability: gaps.length && item.availability === "complete" ? "partial" : item.availability }));
    const limitations = [...Array.from(new Set([...gaps, ...evidence.flatMap(item => item.limitations)]))];
    const canonicalKey = pid ? `vapi:${pid}` : thread ? `email-thread:${thread}` : `${store}:${id(row.id)}`;
    const manifest = { contextId: `context:${hash([scope.sourceAccountKey, canonicalKey])}`, revision: contextFingerprint, contextFingerprint, sourceAccountKey: scope.sourceAccountKey,
      entries: evidence.map((item, ordinal) => ({ ref: item.ref, ordinal, originalTextLength: item.originalText?.length ?? null, turnCount: item.originalTurns.length, availability: item.availability })),
      complete: evidence.every(item => item.availability === "complete") && !limitations.length, continuation: null, capturedAtUtc: at, limitations };
    const context = sourceContextSchema.parse({ manifest, evidence });
    const capturedKey = hash([scopeKey(scope), contextFingerprint]);
    if (evidence.length && !capturedContexts.has(capturedKey)) capturedContexts.set(capturedKey, { window, capturedAtUtc: at });
    // Trusted workflow provenance changes preference, not retained content. A
    // more complete original is never erased: readContext returns every version.
    const ranked = [...evidence].sort((a, b) => {
      const verified = (item: StoredEvidence) => item.ref.handlingEvidence?.includes("independently validated") ? 0 : item.ref.store === "call_log" ? 1 : item.ref.store === "voice_calls" ? 2 : 3;
      return verified(a) - verified(b) || Number(b.originalText !== null) - Number(a.originalText !== null) || (b.originalText?.length ?? 0) - (a.originalText?.length ?? 0) || a.ref.sourceId.localeCompare(b.ref.sourceId);
    });
    return { context, canonicalKey, primary: ranked[0] };
  };
  const exactContext = async (scope: AuthorizedScope, ref: EvidenceRef): Promise<RowContext> => {
    authorize(scope); const parsed = evidenceRefSchema.safeParse(ref);
    if (!parsed.success || ref.sourceAccountKey !== scope.sourceAccountKey) throw new SourceReadError("INVALID_SOURCE_REFERENCE");
    const pattern = ref.store === "conversation_sessions" ? /^session:([1-9]\d*):(?:message:\d+|history)$/ : /^(?:sms|draft|thread-meta|call):([1-9]\d*)$/;
    const rowId = pattern.exec(ref.sourceId)?.[1];
    if (!rowId) throw new SourceReadError("INVALID_SOURCE_REFERENCE");
    const captured = capturedContexts.get(hash([scopeKey(scope), ref.contextFingerprint]));
    if (!captured) throw new SourceReadError("INVALID_SOURCE_REFERENCE");
    return db.snapshot(async port => {
      let found: SqlRow[];
      try { found = await rows(port, ref.store, "WHERE `id` = ?", [rowId]); } catch { throw new SourceReadError("SOURCE_UNAVAILABLE"); }
      if (found.length !== 1) throw new SourceReadError("SOURCE_UNAVAILABLE");
      const result = await contextFor(scope, ref.store, found[0], captured.capturedAtUtc, port, captured.window);
      const actual = result.context.evidence.find(item => item.ref.store === ref.store && item.ref.sourceId === ref.sourceId);
      if (!actual || !sameEvidenceRef(actual.ref, ref)) throw new SourceReadError("STALE_CONTEXT");
      return result;
    });
  };
  const inDay = (context: SourceContext, localDay?: string): boolean => {
    if (!localDay) return true;
    const formatter = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" });
    // Unknown-time records are unavailable/observation evidence, not original
    // day provenance; they remain explicit gaps within the maximum window.
    return context.evidence.some(item => !item.ref.occurredAtUtc || formatter.format(new Date(item.ref.occurredAtUtc)) === localDay);
  };
  const nextPage = async (scope: AuthorizedScope, traversal: Traversal): Promise<SourceInventory> => {
    const items: StoredEvidence[] = []; const exclusions = new Set<string>();
    const readyContexts: NonNullable<SourceInventory["readyContexts"]> = [];
    const families = [...traversal.boundary.families];
    while (traversal.familyIndex < families.length && !items.length) {
      const family = families[traversal.familyIndex];
      family.limitations.forEach(value => exclusions.add(`${family.store}: ${value}`));
      if (!family.throughId || family.availability !== "complete") { traversal.familyIndex++; traversal.afterId = null; continue; }
      try {
        // One conversation is a natural page, not a corpus/message capacity cap.
        // SQL excludes inactive old rows before histories/transcripts are loaded.
        const recent = recentPredicate(family.store, recentWindow(traversal.boundary.capturedAtUtc));
        const found = await rows(db, family.store, `WHERE \`id\` > ? AND \`id\` <= ? AND (${recent.sql}) ORDER BY \`id\` ASC LIMIT ?`, [traversal.afterId ?? "0", family.throughId, ...recent.params, 1]);
        if (!found.length) { traversal.familyIndex++; traversal.afterId = null; continue; }
        const rowId = id(found[0].id);
        if (!rowId || (traversal.afterId !== null && BigInt(rowId) <= BigInt(traversal.afterId)) || BigInt(rowId) > BigInt(family.throughId)) throw new SourceReadError("SOURCE_UNAVAILABLE");
        traversal.afterId = rowId;
        const result = await db.snapshot(port => contextFor(scope, family.store, found[0], traversal.boundary.capturedAtUtc, port));
        if (!result.context.evidence.length) continue;
        if (traversal.seen.has(result.canonicalKey)) continue;
        traversal.seen.add(result.canonicalKey);
        traversal.revisions.set(result.canonicalKey, result.context.manifest.revision);
        if (traversal.phase === "reconciliation" && traversal.prior?.get(result.canonicalKey) === result.context.manifest.revision) continue;
        if (!inDay(result.context, traversal.localDay)) continue;
        if (AI_STORES.includes(family.store)) items.push(result.primary);
        else items.push(...result.context.evidence);
        readyContexts.push({ contextFingerprint: result.context.manifest.contextFingerprint, refs: result.context.evidence.map(item => item.ref) });
      } catch (error) {
        exclusions.add(`${family.store}: ${safeReadDbError(error).reason}`);
        families[traversal.familyIndex] = { ...family, availability: "missing", limitations: [...family.limitations, safeReadDbError(error).reason] };
        traversal.familyIndex++; traversal.afterId = null;
      }
    }
    traversal.boundary = { ...traversal.boundary, families };
    const finished = traversal.familyIndex >= families.length;
    if (finished && traversal.phase === "reconciliation" && traversal.prior) {
      for (const key of Array.from(traversal.prior.keys())) if (!traversal.revisions.has(key)) exclusions.add(`Previously observed source is outside the recent window, missing/deleted or unavailable: ${key}`);
    }
    let continuation: string | null = null;
    if (!finished) { continuation = `cursor:${randomUUID()}`; cursors.set(continuation, { scopeKey: scopeKey(scope), traversal: { ...traversal, seen: new Set(traversal.seen) } }); }
    const checkedAtUtc = now();
    const unavailable = items.filter(item => item.originalText === null || item.availability === "malformed" || item.availability === "missing").length;
    items.flatMap(item => item.limitations).forEach(value => exclusions.add(value));
    if (items.some(item => !item.ref.occurredAtUtc)) exclusions.add("Original two-day occurrence membership is unresolved for observation-only or unavailable evidence; no occurrence time fabricated");
    const state = boundaries.get(traversal.boundary.inventoryId);
    if (state) { state.acceptedBoundaries.add(hash(traversal.boundary)); for (const [key, value] of Array.from(traversal.revisions)) state.revisions.set(key, value); }
    return sourceInventorySchema.parse({
      items, readyContexts, inventory: traversal.boundary, continuation, capabilities: STAGE1_CAPABILITIES, limitations: [...Array.from(exclusions)],
      binding: { requestId: `sources:${randomUUID()}`, contextRevision: items.length && new Set(items.map(item => item.ref.contextFingerprint)).size === 1 ? items[0].ref.contextFingerprint : null, selectedIssueId: null, selectedIssueRevision: null },
      coverage: { receiptId: `coverage:${randomUUID()}`, authorizedScope: scope.installationScope, sourceAccountKey: scope.sourceAccountKey, sourceKinds: traversal.sourceKinds, boundaries: families, continuation,
        read: items.length, analyzed: 0, unprocessed: items.length - unavailable, unavailable, partial: !!continuation || !!items.length || !!exclusions.size || families.some(family => family.availability !== "complete"), exclusions: [...Array.from(exclusions)], checkedAtUtc },
    });
  };
  const resume = (scope: AuthorizedScope, cursor: string, phase: Traversal["phase"]): Traversal => {
    const stored = cursors.get(cursor);
    if (!stored || stored.scopeKey !== scopeKey(scope) || stored.traversal.phase !== phase) throw new SourceReadError("INVALID_SCOPE");
    // Replaying an opaque cursor is read-only and deterministic; do not consume
    // it merely because a HTTP response might be lost.
    return { ...stored.traversal, seen: new Set(stored.traversal.seen), revisions: new Map(stored.traversal.revisions) };
  };
  return Object.freeze({
    captureBoundary: capture,
    inventory: async (scope: AuthorizedScope, input: SourcesInput, boundary: InventoryBoundary) => {
      const state = bound(scope, boundary); sourcesInputSchema.parse(input);
      if (state.inputKey !== hash([input.sourceKinds, input.localDay ?? null])) throw new SourceReadError("INVALID_SCOPE");
      const traversal = input.cursor ? resume(scope, input.cursor, "inventory") : { originInventoryId: boundary.inventoryId, boundary, sourceKinds: [...input.sourceKinds], localDay: input.localDay, familyIndex: 0, afterId: null, seen: new Set<string>(), revisions: new Map<string, string>(), phase: "inventory" as const };
      if (traversal.boundary.inventoryId !== boundary.inventoryId) throw new SourceReadError("INVALID_SCOPE");
      return nextPage(scope, traversal);
    },
    readExact: async (scope: AuthorizedScope, ref: EvidenceRef) => {
      const result = await exactContext(scope, ref);
      return result.context.evidence.find(item => sameEvidenceRef(item.ref, ref))!;
    },
    readContext: async (scope: AuthorizedScope, refs: readonly EvidenceRef[], expectedContextRevision: string) => {
      authorize(scope); if (!refs.length) throw new SourceReadError("INVALID_SOURCE_REFERENCE");
      const result = await exactContext(scope, refs[0]);
      if (result.context.manifest.revision !== expectedContextRevision || refs.some(ref => !result.context.evidence.some(item => sameEvidenceRef(item.ref, ref)))) throw new SourceReadError("STALE_CONTEXT");
      return result.context;
    },
    reconcile: async (scope: AuthorizedScope, boundary: InventoryBoundary, cursor?: string) => {
      const previous = bound(scope, boundary);
      if (cursor) {
        const traversal = resume(scope, cursor, "reconciliation");
        if (traversal.originInventoryId !== boundary.inventoryId && traversal.boundary.inventoryId !== boundary.inventoryId) throw new SourceReadError("INVALID_SCOPE");
        return nextPage(scope, traversal);
      }
      // Reconcile only the fresh rolling 48h slice, including eligible old-ID
      // edits/late finalization and new arrivals, never historical corpus scans.
      const fresh = await capture(scope, { sourceKinds: [...boundary.sourceKinds], localDay: previous.localDay });
      return nextPage(scope, { originInventoryId: boundary.inventoryId, boundary: fresh, sourceKinds: [...boundary.sourceKinds], localDay: previous.localDay, familyIndex: 0, afterId: null, seen: new Set(), revisions: new Map(), prior: new Map(previous.revisions), phase: "reconciliation" });
    },
  });
}
export const createSourceReader = createStoredSourceReader;
