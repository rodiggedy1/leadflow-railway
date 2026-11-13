import { createHash } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import { conversationSessions } from "../drizzle/schema";
import type { AuditMessage } from "../shared/dailyActionAudit";
import type { LiveTextContext, LiveTextFeed, LiveTextFeedFailure, LiveTextRow } from "../shared/liveTextMonitor";
import { getDb } from "./db";
import { normalizePhone } from "./utils/phone";

const SESSION_LIMIT = 100;
const HISTORY_LIMIT = 20;
const FEED_LIMIT = 100;
type Database = Pick<NonNullable<Awaited<ReturnType<typeof getDb>>>, "select">;
const fields = {
  id: conversationSessions.id, leadPhone: conversationSessions.leadPhone, leadName: conversationSessions.leadName,
  messageHistory: conversationSessions.messageHistory, updatedAt: conversationSessions.updatedAt,
};
type Session = { id: number; leadPhone: string; leadName: string | null; messageHistory: string; updatedAt: Date };
type Entry = { row: LiveTextRow; index: number; at: number | null };
type History = { session: Session; window: unknown[]; entries: Entry[]; partial: boolean; older: boolean };

class LiveTextReadError extends Error {
  constructor(readonly reason: LiveTextFeedFailure) {
    super(reason === "DB_UNAVAILABLE" ? "Live text database is unavailable." : "Live text database read failed.");
    this.name = "LiveTextReadError";
  }
}
// Inspect exact driver codes (including Drizzle's cause), never SQL, parameters,
// message substrings, or a guessed provider fallback. No retry or custom timeout.
const CODE_FAILURES: Readonly<Record<string, LiveTextFeedFailure>> = {
  ECONNREFUSED: "DB_UNAVAILABLE", ENOTFOUND: "DB_UNAVAILABLE", EAI_AGAIN: "DB_UNAVAILABLE",
  ECONNRESET: "DB_UNAVAILABLE", EPIPE: "DB_UNAVAILABLE", PROTOCOL_CONNECTION_LOST: "DB_UNAVAILABLE",
  ER_ACCESS_DENIED_ERROR: "DB_UNAVAILABLE", ER_CON_COUNT_ERROR: "DB_UNAVAILABLE",
  ER_NO_SUCH_TABLE: "DB_SCHEMA", ER_BAD_FIELD_ERROR: "DB_SCHEMA", ER_BAD_DB_ERROR: "DB_SCHEMA",
  ETIMEDOUT: "DB_TIMEOUT", ER_LOCK_WAIT_TIMEOUT: "DB_TIMEOUT", ER_QUERY_TIMEOUT: "DB_TIMEOUT",
  ER_QUERY_INTERRUPTED: "DB_TIMEOUT", PROTOCOL_SEQUENCE_TIMEOUT: "DB_TIMEOUT",
};
function safeError(error: unknown): LiveTextReadError {
  for (let depth = 0; depth < 5 && error && typeof error === "object"; depth++) {
    if (error instanceof LiveTextReadError) return new LiveTextReadError(error.reason);
    const value = error as { code?: unknown; cause?: unknown };
    if (typeof value.code === "string" && Object.hasOwn(CODE_FAILURES, value.code)) {
      return new LiveTextReadError(CODE_FAILURES[value.code]);
    }
    error = value.cause;
  }
  return new LiveTextReadError("DB_READ_FAILED");
}
async function database(db?: Database): Promise<Database> {
  const result = db ?? await getDb();
  if (!result) throw new LiveTextReadError("DB_UNAVAILABLE");
  return result;
}
function hash(value: unknown): string { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function string(value: unknown): string | null { return typeof value === "string" && value.trim() ? value.trim() : null; }
function phone(value: unknown): string | null {
  return typeof value === "string" && /^\+?[\d\s().-]+$/.test(value.trim()) ? normalizePhone(value.trim()) : null;
}
function validId(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0 && (value as number) <= 2_147_483_647;
}
/** Stored numeric ts/timestamp values are Unix milliseconds, not provider proof.
 * Missing/zero timestamps and invalid or offset-less dates remain unknown.
 */
function instant(value: unknown): number | null {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : null;
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value !== 0 && Number.isFinite(new Date(value).getTime()) ? value : null;
  }
  if (typeof value !== "string") return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match || +match[4] > 23 || +match[5] > 59 || +(match[6] ?? 0) > 59) return null;
  const date = new Date(`${match[1]}-${match[2]}-${match[3]}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.getUTCFullYear() !== +match[1]
    || date.getUTCMonth() + 1 !== +match[2] || date.getUTCDate() !== +match[3]) return null;
  if (match[7] !== "Z" && (+match[7].slice(1, 3) > 23 || +match[7].slice(4) > 59)) return null;
  const at = Date.parse(value);
  return Number.isFinite(at) ? at : null;
}
function envelopes(item: Record<string, unknown>): Record<string, unknown>[] {
  const metadata = object(item.metadata);
  return metadata ? [item, metadata] : [item];
}
function providerIds(item: Record<string, unknown>): string[] {
  return Array.from(new Set(envelopes(item).flatMap(value =>
    [string(value.opMsgId), string(value.openPhoneId), string(value.providerMessageId)].filter((id): id is string => !!id))));
}
function identity(item: Record<string, unknown>, sessionId: number, customerPhone: string, direction: AuditMessage["direction"]) {
  const records = envelopes(item);
  const explicitLines = records.filter(value => value.businessPhone != null).map(value => phone(value.businessPhone));
  const businessPhone = explicitLines.find((value): value is string => value !== null) ?? null;
  let ambiguous = explicitLines.some(value => value === null || value !== businessPhone) || businessPhone === customerPhone;
  const agrees = (value: unknown, expected: string | null) => {
    const values = Array.isArray(value) ? value : [value];
    return values.length === 1 && phone(values[0]) !== null && (expected === null || phone(values[0]) === expected);
  };
  for (const record of records) {
    if (record.sessionId != null && record.sessionId !== sessionId) ambiguous = true;
    if (record.customerPhone != null && !agrees(record.customerPhone, customerPhone)) ambiguous = true;
    if (record.direction != null && record.direction !== direction
      && record.direction !== (direction === "inbound" ? "incoming" : "outgoing")) ambiguous = true;
    for (const name of ["from", "fromPhone", "to", "toPhone"] as const) {
      if (record[name] == null) continue;
      const customerEnd = direction === "inbound" ? name.startsWith("from") : name.startsWith("to");
      if (!agrees(record[name], customerEnd ? customerPhone : businessPhone)) ambiguous = true;
    }
  }
  for (const endpoint of ["from", "to"] as const) {
    const values = records.flatMap(record => [record[endpoint], record[`${endpoint}Phone`]])
      .filter(value => value != null).map(value => phone(Array.isArray(value) ? value[0] : value));
    if (new Set(values).size > 1) ambiguous = true;
    const businessEnd = direction === "inbound" ? endpoint === "to" : endpoint === "from";
    if (businessEnd && values.includes(customerPhone)) ambiguous = true;
  }
  // Endpoint metadata may reveal contradictions, but never supplies a guessed line.
  return { businessPhone, ambiguous };
}
function delivery(item: Record<string, unknown>, direction: AuditMessage["direction"]): AuditMessage["delivery"] {
  if (direction === "inbound") return "received";
  const statuses = Array.from(new Set(envelopes(item).flatMap(value =>
    [string(value.status), string(value.deliveryStatus)].filter((status): status is string => !!status).map(status => status.toLowerCase()))));
  return statuses.length === 1 && (statuses[0] === "sent" || statuses[0] === "delivered") ? statuses[0] : "unknown";
}
function readHistory(session: Session): History {
  const result: History = { session, window: [], entries: [], partial: false, older: false };
  const customerPhone = phone(session.leadPhone);
  if (!validId(session.id) || !customerPhone) { result.partial = true; return result; }
  let history: unknown;
  try { history = JSON.parse(session.messageHistory ?? "[]"); }
  catch { result.partial = true; return result; }
  if (!Array.isArray(history)) { result.partial = true; return result; }
  result.older = history.length > HISTORY_LIMIT;
  result.partial = session.messageHistory == null;
  // Match AI Team getSessionConversation: slice STORED entries first, then use
  // the same content conversion, preserving the original array order and text.
  result.window = history.slice(-HISTORY_LIMIT);
  const duplicates = new Map<string, number>();
  for (const raw of result.window) {
    const item = object(raw);
    if (!item || typeof item.role !== "string" || !["user", "customer", "assistant"].includes(item.role)) continue;
    const id = providerIds(item)[0];
    if (id) { const key = JSON.stringify([item.role, id]); duplicates.set(key, (duplicates.get(key) ?? 0) + 1); }
  }
  result.window.forEach((raw, offset) => {
    const item = object(raw);
    if (!item) { result.partial = true; return; }
    if (typeof item.role !== "string" || !["user", "customer", "assistant"].includes(item.role)) {
      if (!string(item.role)) result.partial = true;
      return; // Notes/system/tool roles are not customer texts.
    }
    let text: string;
    try { text = typeof item.content === "string" ? item.content : String(item.content ?? ""); }
    catch { result.partial = true; return; }
    if (!text.trim()) { result.partial = true; return; }
    const index = history.length - result.window.length + offset;
    const direction = item.role === "assistant" ? "outbound" as const : "inbound" as const;
    const ids = providerIds(item); const providerId = ids[0] ?? null;
    const binding = identity(item, session.id, customerPhone, direction);
    const ambiguous = binding.ambiguous || ids.length > 1;
    const at = instant(item.ts) ?? instant(item.timestamp)
      ?? (item.source === "openphone_reconcile" ? instant(item.createdAt) : null);
    if (at === null || ambiguous) result.partial = true;
    // Repeated same-role provider IDs still keep every stored entry. Equal text
    // never coalesces, and ordinary provider-ID keys survive body/status edits.
    const repeated = providerId && duplicates.get(JSON.stringify([item.role, providerId]))! > 1;
    const key = `session-text:${hash([session.id, item.role, providerId, providerId && !repeated ? null : index])}`;
    const timestamp = at === null ? null : new Date(at).toISOString();
    const message: AuditMessage = {
      key, sessionId: session.id, customerPhone, businessPhone: binding.businessPhone, direction, text,
      providerMessageId: providerId, occurredAt: timestamp, observedAt: timestamp,
      timeBasis: timestamp ? "history" : "unknown", delivery: delivery(item, direction), source: "conversation_history",
    };
    result.entries.push({ index, at, row: { key, sessionId: session.id, revision: "",
      customerName: string(session.leadName), message, identityAmbiguous: ambiguous } });
  });
  return result;
}
function contextFor(history: History, anchor: Entry): LiveTextContext {
  // No phone/name/provider-ID sibling lookup. A known line includes only that
  // explicit line; an unknown line cannot be silently merged with a known one.
  const scoped = history.entries.filter(entry => entry.row.message.businessPhone === anchor.row.message.businessPhone);
  const messages = scoped.map(entry => ({ ...entry.row.message }));
  const partial = history.partial || scoped.length !== history.entries.length;
  const row: LiveTextRow = { ...anchor.row, message: { ...anchor.row.message },
    identityAmbiguous: anchor.row.identityAmbiguous || scoped.some(entry => entry.row.identityAmbiguous) };
  row.revision = hash([row.key, history.session.id, history.session.leadPhone, history.session.leadName,
    history.session.updatedAt, history.window, messages, partial, row.identityAmbiguous]);
  return { row, messages, partial };
}

/** Same ordinary Drizzle stored-history read as AI Team, with a single session
 * overflow sentinel. No stage/source/pending filters or provider dependency.
 */
export async function readLiveTextFeed(db?: Database): Promise<LiveTextFeed> {
  try {
    const reader = await database(db);
    const sessions = await reader.select(fields).from(conversationSessions)
      .orderBy(desc(conversationSessions.updatedAt), desc(conversationSessions.id)).limit(SESSION_LIMIT + 1);
    const histories = sessions.slice(0, SESSION_LIMIT).map(readHistory);
    const entries = histories.flatMap(history => history.entries.map(entry => ({ history, entry })));
    // Latest known history instants first; unknown-time texts remain visible.
    // Session updatedAt is only a sorting fallback, NEVER a message timestamp.
    const orderAt = (value: typeof entries[number]) => value.entry.at ?? instant(value.history.session.updatedAt) ?? 0;
    entries.sort((a, b) => orderAt(b) - orderAt(a)
      || b.history.session.id - a.history.session.id || b.entry.index - a.entry.index);
    const contexts = entries.slice(0, FEED_LIMIT).map(({ history, entry }) => contextFor(history, entry));
    return { rows: contexts.map(context => context.row), checkedAt: new Date().toISOString(),
      partial: sessions.length > SESSION_LIMIT || entries.length > FEED_LIMIT || histories.some(history => history.partial || history.older)
        || contexts.some(context => context.partial), unavailable: false };
  } catch (error) {
    return { rows: [], checkedAt: new Date().toISOString(), partial: true, unavailable: true, failure: safeError(error).reason };
  }
}

/** Re-read one exact server-owned session and find one exact retained key. The
 * caller supplies no text/phone/context, and a missing key never picks a sibling.
 */
export async function readLiveTextContext(sessionId: number, messageKey: string, db?: Database): Promise<LiveTextContext> {
  if (!validId(sessionId)) throw new Error("Invalid live text session ID.");
  if (typeof messageKey !== "string" || !/^session-text:[a-f0-9]{64}$/.test(messageKey)) throw new Error("Invalid live text message key.");
  let sessions: Session[];
  try {
    const reader = await database(db);
    sessions = await reader.select(fields).from(conversationSessions).where(eq(conversationSessions.id, sessionId)).limit(1);
  } catch (error) { throw safeError(error); }
  if (!sessions[0] || sessions[0].id !== sessionId) throw new Error("Live text session is missing.");
  const history = readHistory(sessions[0]);
  const anchor = history.entries.find(entry => entry.row.key === messageKey);
  if (!anchor) throw new Error("Live text message is missing from the retained session history.");
  return contextFor(history, anchor);
}
