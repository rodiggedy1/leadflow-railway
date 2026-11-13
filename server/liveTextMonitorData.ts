import { createHash } from "node:crypto";
import { and, desc, eq, inArray, like, lt, or, sql } from "drizzle-orm";
import { int, mysqlTable, text, timestamp, varchar } from "drizzle-orm/mysql-core";
import { conversationSessions } from "../drizzle/schema";
import type { AuditMessage } from "../shared/dailyActionAudit";
import type { LiveTextContext, LiveTextFeed, LiveTextRow } from "../shared/liveTextMonitor";
import { getDb } from "./db";
import { AuditSnapshotError, readAuditSnapshot } from "./dailyActionAuditSnapshot";
import { normalizePhone } from "./utils/phone";

const EVENT_LIMIT = 500;
const FEED_LIMIT = 100;
const PAYLOAD_BYTES = 64 * 1024;
const SESSION_LIMIT = 50; // Last row is an overflow sentinel, not a guessed identity.
const CONTEXT_LIMIT = 30;
const CONTEXT_BYTES = 16_000;
const QUERY_MS = 2_000;
const REQUEST_MS = 5_000;
type Database = { readonly $client: unknown };

// A private SELECT projection of an existing table, not a schema change.
const captures = mysqlTable("webhook_events", {
  id: int("id").notNull(), source: varchar("source", { length: 50 }),
  eventType: varchar("event_type", { length: 255 }), eventId: varchar("event_id", { length: 255 }),
  fromPhone: varchar("from_phone", { length: 50 }), toPhone: varchar("to_phone", { length: 50 }),
  rawPayload: text("raw_payload"), createdAt: timestamp("created_at"),
});
const fields = {
  id: captures.id, source: captures.source, eventType: captures.eventType, eventId: captures.eventId,
  fromPhone: captures.fromPhone, toPhone: captures.toPhone,
  rawPayload: sql<string | null>`case when octet_length(${captures.rawPayload}) <= ${PAYLOAD_BYTES} then ${captures.rawPayload} else null end`,
  createdAt: captures.createdAt,
};
type Capture = { id: number; source: string | null; eventType: string | null; eventId: string | null;
  fromPhone: string | null; toPhone: string | null; rawPayload: string | null; createdAt: Date | null };
type Session = { id: number; leadPhone: string; leadName: string | null };
const messageFilter = () => and(eq(captures.source, "openphone"), like(captures.eventType, "message.%"));
function hash(value: unknown): string { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
function phone(value: unknown): string | null {
  return typeof value === "string" && /^\+?[\d\s().-]+$/.test(value.trim()) ? normalizePhone(value.trim()) : null;
}
function nonempty(value: unknown): string | null { return typeof value === "string" && value.trim() ? value : null; }
function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function validId(value: unknown): value is number { return Number.isSafeInteger(value) && (value as number) > 0 && (value as number) <= 2_147_483_647; }

/** Provider instants must be real ISO calendar dates with an explicit offset.
 * SQL Date objects represent observation time only, never provider occurrence.
 */
function providerInstant(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match || +match[4] > 23 || +match[5] > 59 || +match[6] > 59) return null;
  const date = new Date(`${match[1]}-${match[2]}-${match[3]}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.getUTCFullYear() !== +match[1]
    || date.getUTCMonth() + 1 !== +match[2] || date.getUTCDate() !== +match[3]) return null;
  if (match[7] !== "Z" && (+match[7].slice(1, 3) > 23 || +match[7].slice(4) > 59)) return null;
  const at = Date.parse(value);
  return Number.isFinite(at) ? new Date(at).toISOString() : null;
}
function observedInstant(value: unknown): string | null {
  return value instanceof Date && Number.isFinite(value.getTime()) ? value.toISOString() : providerInstant(value);
}
function scopeOf(customerPhone: string, businessPhone: string): string { return `${customerPhone}|${businessPhone}`; }
function projectionMatches(row: Capture, customerPhone: string, businessPhone: string): boolean {
  const from = phone(row.fromPhone); const to = phone(row.toPhone);
  return (from === customerPhone && to === businessPhone) || (to === customerPhone && from === businessPhone);
}
type Event = { capture: Capture; key: string; scope: string; customerPhone: string; businessPhone: string;
  direction: AuditMessage["direction"]; providerId: string | null; text: string | null;
  occurredAt: string | null; observedAt: string | null; delivery: AuditMessage["delivery"] | null;
  rawStatus: string | null; ambiguous: boolean };
function parse(row: Capture): Event | null {
  if (!validId(row.id) || row.source !== "openphone" || !row.eventType?.startsWith("message.")
    || typeof row.rawPayload !== "string" || Buffer.byteLength(row.rawPayload, "utf8") > PAYLOAD_BYTES) return null;
  let root: Record<string, unknown> | null;
  try { root = object(JSON.parse(row.rawPayload)); } catch { return null; }
  if (!root || root.type !== row.eventType) return null;
  const item = object(object(root.data)?.object);
  if (!item || (item.direction !== "incoming" && item.direction !== "outgoing")) return null;
  // Inspect ALL recipients. The captured to_phone is only a projection of to[0].
  const recipients = Array.isArray(item.to) ? item.to : [item.to];
  if (recipients.length !== 1) return null;
  const from = phone(item.from); const to = phone(recipients[0]);
  if (!from || !to || from === to) return null;
  const direction = item.direction === "incoming" ? "inbound" : "outbound";
  const customerPhone = direction === "inbound" ? from : to;
  const businessPhone = direction === "inbound" ? to : from;
  const providerId = nonempty(item.id);
  if (providerId !== null && (providerId.length > 512 || providerId.trim() !== providerId)) return null;
  // Missing provider IDs cannot attach delivery updates to any other capture.
  const key = `live-text:${hash([customerPhone, businessPhone, direction, providerId ?? `capture:${row.id}`])}`;
  const status = typeof item.status === "string" ? item.status.toLowerCase() : null;
  let delivery: Event["delivery"] = null;
  if (status !== null) {
    delivery = direction === "inbound" && status === "received" ? "received"
      : direction === "outbound" && status === "delivered" ? "delivered"
      : direction === "outbound" && status === "sent" ? "sent" : "unknown";
  } else if (direction === "inbound" && row.eventType === "message.received") delivery = "received";
  else if (row.eventType !== "message.received") delivery = "unknown";
  return {
    capture: row, key, scope: scopeOf(customerPhone, businessPhone), customerPhone, businessPhone, direction,
    providerId, text: nonempty(item.body) ?? (item.body == null ? nonempty(item.text) : null),
    occurredAt: providerInstant(item.createdAt), observedAt: observedInstant(row.createdAt), delivery, rawStatus: status,
    ambiguous: (row.eventId !== null && row.eventId !== providerId)
      || (row.fromPhone !== null && phone(row.fromPhone) !== from)
      || (row.toPhone !== null && phone(row.toPhone) !== to),
  };
}
type Entry = { row: LiveTextRow; scope: string; latestId: number; rawBinding: string; damaged: boolean };
function collect(rows: Capture[]): { entries: Entry[]; damaged: Capture[] } {
  const groups = new Map<string, Event[]>(); const damaged: Capture[] = [];
  for (const capture of rows) {
    const event = parse(capture);
    if (!event) { damaged.push(capture); continue; }
    const group = groups.get(event.key) ?? []; group.push(event); groups.set(event.key, group);
  }
  const entries: Entry[] = [];
  for (const events of Array.from(groups.values())) {
    events.sort((a, b) => b.capture.id - a.capture.id);
    const bodies = events.filter(event => event.text !== null);
    if (!bodies.length) { damaged.push(events[0].capture); continue; }
    const latestBody = bodies[0];
    // Stable anchor within the retained snapshot: equal-content retries/updates
    // do not create another text. Newer conflicting body is shown, never guessed away.
    const anchor = bodies.filter(event => event.text === latestBody.text).at(-1)!;
    const ambiguous = events.some(event => event.ambiguous) || bodies.some(event => event.text !== latestBody.text);
    const statusEvent = events.find(event => event.delivery !== null);
    const delivery = statusEvent?.delivery ?? "unknown";
    const occurrence = anchor.occurredAt ?? latestBody.occurredAt;
    const observed = anchor.observedAt;
    const evidenced = delivery !== "unknown" && !!occurrence && !!statusEvent?.occurredAt && !ambiguous;
    const message: AuditMessage = {
      key: anchor.key, sessionId: null, customerPhone: anchor.customerPhone, businessPhone: anchor.businessPhone,
      direction: anchor.direction, text: latestBody.text!, providerMessageId: anchor.providerId,
      occurredAt: occurrence, observedAt: observed,
      timeBasis: occurrence ? "provider" : observed ? "received" : "unknown",
      delivery, source: evidenced ? "provider" : "conversation_history",
    };
    entries.push({ scope: anchor.scope, latestId: anchor.capture.id,
      rawBinding: hash([latestBody.text, delivery, statusEvent?.rawStatus, statusEvent?.occurredAt, evidenced, occurrence, observed, ambiguous]), damaged: ambiguous,
      row: { key: anchor.key, captureId: anchor.capture.id, revision: "", customerName: null, message, identityAmbiguous: ambiguous } });
  }
  entries.sort((a, b) => b.latestId - a.latestId);
  return { entries, damaged };
}

// Narrow per-request adaptation of the existing safe snapshot pattern. Timeout
// destruction affects only this lease; late acquisitions are disposed once.
async function bounded<T>(work: Promise<T>, deadline: number, expire: () => void = () => {}): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([work, new Promise<never>((_, reject) => {
      timer = setTimeout(() => { try { expire(); } finally { reject(new AuditSnapshotError("DB_TIMEOUT")); } },
        Math.max(1, Math.min(QUERY_MS, deadline - Date.now())));
    })]);
  } finally { if (timer) clearTimeout(timer); }
}
function timedDatabase(db: Database, deadline: number): Database {
  type Lease = { query: (options: unknown, values?: unknown[]) => Promise<unknown>; release: () => void; destroy: () => void };
  type Pool = { getConnection?: () => Promise<Lease>; promise?: () => Pool };
  const client = db.$client as Pool | undefined;
  const pool = typeof client?.promise === "function" ? client.promise() : client;
  if (typeof pool?.getConnection !== "function") throw new AuditSnapshotError("DB_UNSUPPORTED");
  return { $client: { getConnection: async () => {
    if (Date.now() >= deadline) throw new AuditSnapshotError("DB_TIMEOUT");
    let abandoned = false;
    const acquired = pool.getConnection!().then(lease => {
      if (abandoned) { try { lease.destroy(); } catch { /* Disposal attempted once. */ } throw new AuditSnapshotError("DB_TIMEOUT"); }
      return lease;
    });
    const owned = await bounded(acquired, deadline, () => { abandoned = true; });
    let disposed = false;
    const destroy = () => { if (!disposed) { disposed = true; try { owned.destroy(); } catch { /* Never retried. */ } } };
    return {
      query: async (options: string | { sql: string }, values?: unknown[]) => {
        if (disposed || Date.now() >= deadline) { destroy(); throw new AuditSnapshotError("DB_TIMEOUT"); }
        const timeout = Math.max(1, Math.min(QUERY_MS, deadline - Date.now()));
        return bounded(owned.query({ ...(typeof options === "string" ? { sql: options } : options), timeout }, values), deadline, destroy);
      },
      release: () => { if (!disposed) { owned.release(); disposed = true; } }, destroy,
    };
  } } };
}
function exactPhones(column: typeof conversationSessions.leadPhone | typeof captures.fromPhone | typeof captures.toPhone, phones: string[]) {
  // SQL narrows candidates; canonical JS validation remains authoritative.
  return and(sql`${column} regexp '^[+0-9 ().-]+$'`, inArray(sql<string>`regexp_replace(${column}, '[^0-9]', '')`,
    phones.flatMap(value => [value.slice(2), value.slice(1)])));
}
type Snapshot = { recent: Capture[]; anchor: Capture | null; sessions: Session[]; older: boolean };
async function snapshot(captureId: number | null, db?: Database): Promise<Snapshot> {
  const deadline = Date.now() + REQUEST_MS;
  const database = db ?? await bounded(getDb(), deadline);
  if (!database) throw new AuditSnapshotError("DB_UNAVAILABLE");
  return readAuditSnapshot(timedDatabase(database, deadline), async reader => {
    // Always overlap-reread the same last-500 window on a NEW fixed snapshot.
    // No monotonic cursor: a smaller ID committed late remains visible next poll.
    const recent = await reader.select(fields).from(captures).where(messageFilter()).orderBy(desc(captures.id)).limit(EVENT_LIMIT);
    const anchors = captureId === null ? [] : await reader.select(fields).from(captures)
      .where(and(messageFilter(), eq(captures.id, captureId))).limit(1);
    const anchor = anchors[0] ?? null;
    const events = recent.map(parse).filter((value): value is Event => !!value);
    const anchored = anchor ? parse(anchor) : null;
    const phones = Array.from(new Set(events.concat(anchored ? [anchored] : []).map(event => event.customerPhone)));
    const sessions = phones.length ? await reader.select({ id: conversationSessions.id, leadPhone: conversationSessions.leadPhone, leadName: conversationSessions.leadName })
      .from(conversationSessions).where(exactPhones(conversationSessions.leadPhone, phones)).orderBy(desc(conversationSessions.id)).limit(SESSION_LIMIT) : [];
    // A bounded existence probe, with no body transfer, marks a REAL older exact
    // endpoint boundary. Unrelated older captures never mark this context capped.
    const oldest = recent.at(-1)?.id;
    const older = anchored && oldest && recent.length === EVENT_LIMIT ? await reader.select({ id: captures.id }).from(captures).where(and(
      messageFilter(), lt(captures.id, oldest), sql`${captures.id} <> ${captureId}`,
      or(and(exactPhones(captures.fromPhone, [anchored.customerPhone]), exactPhones(captures.toPhone, [anchored.businessPhone])),
        and(exactPhones(captures.fromPhone, [anchored.businessPhone]), exactPhones(captures.toPhone, [anchored.customerPhone]))),
    )).orderBy(desc(captures.id)).limit(1) : [];
    return { recent, anchor, sessions, older: older.length > 0 };
  });
}
function applyNames(entries: Entry[], sessions: Session[]): boolean {
  const capped = sessions.length === SESSION_LIMIT;
  for (const entry of entries) {
    const matched = sessions.slice(0, SESSION_LIMIT - 1).filter(session => phone(session.leadPhone) === entry.row.message.customerPhone);
    const names = Array.from(new Set(matched.map(session => nonempty(session.leadName)?.trim()).filter((value): value is string => !!value)));
    entry.row.customerName = !capped && names.length === 1 ? names[0] : null;
    // An incomplete display-name lookup is not an identity collision. Exact
    // captured phone/line binding and fresh native records still verify actions.
    entry.row.identityAmbiguous ||= names.length > 1;
    entry.damaged ||= names.length > 1;
    entry.row.message.sessionId = !capped && matched.length === 1 ? matched[0].id : null;
  }
  return capped;
}
function chronology(a: Entry, b: Entry): number {
  const time = (entry: Entry) => {
    const instant = entry.row.message.occurredAt ?? entry.row.message.observedAt;
    return instant ? Date.parse(instant) : 0;
  };
  return time(a) - time(b) || a.latestId - b.latestId;
}
function contextFor(anchor: Entry, entries: Entry[], damaged: Capture[], older = false): LiveTextContext {
  const scoped = entries.filter(entry => entry.scope === anchor.scope);
  let partial = older || scoped.some(entry => entry.damaged)
    || damaged.some(row => projectionMatches(row, anchor.row.message.customerPhone, anchor.row.message.businessPhone!));
  // Reserve the clicked text before any other messages, including old anchors.
  const priority = [anchor].concat(scoped.filter(entry => entry !== anchor));
  const selected: Array<{ entry: Entry; message: AuditMessage }> = [];
  for (const entry of priority) {
    if (selected.length >= CONTEXT_LIMIT) { partial = true; continue; }
    const message = { ...entry.row.message };
    const fits = (candidate: AuditMessage) => Buffer.byteLength(JSON.stringify(selected.map(value => value.message).concat([candidate])), "utf8") <= CONTEXT_BYTES;
    if (!fits(message)) {
      partial = true;
      // Keep the actual text intact on its row. A missing full anchor makes the
      // service return Review; partial request text must never be interpreted.
      continue;
    }
    selected.push({ entry, message });
  }
  selected.sort((a, b) => chronology(a.entry, b.entry));
  const messages = selected.map(value => value.message);
  const row: LiveTextRow = { ...anchor.row, message: { ...anchor.row.message } };
  // Bind full text, latest delivery, exact metadata and interpreter
  // input/context. Changes outside the displayed byte cap also invalidate checks.
  row.revision = hash([row.key, row.captureId, row.customerName, row.identityAmbiguous, anchor.rawBinding,
    scoped.map(entry => [entry.row.key, entry.rawBinding, entry.row.message.sessionId]), messages]);
  return { row, messages, partial };
}

/** Retained captured texts only. partial describes missing/capped/ambiguous
 * retained evidence, NOT provider or organization-wide completeness.
 */
export async function readLiveTextFeed(db?: Database): Promise<LiveTextFeed> {
  try {
    const data = await snapshot(null, db);
    const collected = collect(data.recent);
    const namesCapped = applyNames(collected.entries, data.sessions);
    const selected = collected.entries.slice(0, FEED_LIMIT).map(entry => contextFor(entry, collected.entries, collected.damaged));
    return { rows: selected.map(context => context.row), checkedAt: new Date().toISOString(),
      partial: namesCapped || collected.damaged.length > 0 || collected.entries.length > FEED_LIMIT || selected.some(context => context.partial), unavailable: false };
  } catch {
    return { rows: [], checkedAt: new Date().toISOString(), partial: true, unavailable: true };
  }
}

/** The server loads the exact capture; callers cannot supply a phone, body or
 * fabricated context. Missing/unidentifiable anchors fail closed.
 */
export async function readLiveTextContext(captureId: number, db?: Database): Promise<LiveTextContext> {
  if (!validId(captureId)) throw new Error("Invalid live text capture ID.");
  const data = await snapshot(captureId, db);
  const event = data.anchor ? parse(data.anchor) : null;
  if (!event?.text) throw new Error("Live text capture is missing or unidentifiable.");
  const rows = data.recent.slice();
  if (!rows.some(row => row.id === captureId)) rows.push(data.anchor!);
  const collected = collect(rows);
  applyNames(collected.entries, data.sessions);
  const entry = collected.entries.find(value => value.row.key === event.key);
  if (!entry) throw new Error("Live text capture is missing or unidentifiable.");
  entry.row.captureId = captureId;
  return contextFor(entry, collected.entries, collected.damaged, data.older);
}
