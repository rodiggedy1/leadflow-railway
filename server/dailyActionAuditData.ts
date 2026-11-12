import { createHash } from "node:crypto";
import { and, asc, eq, gt, gte, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";
import {
  bookingAssignments, bookingPaymentProfiles, bookings, conversationSessions,
  inboundSms, leadflowJobs,
} from "../drizzle/schema";
import { isValidBookingRescheduleDate, shiftBookingDate } from "../shared/bookingReschedule";
import type {
  AuditCandidate, AuditCoverage, AuditCursor, AuditMessage, AuditRecord, AuditThread,
} from "../shared/dailyActionAudit";
import { getDb } from "./db";
import { normalizePhone } from "./utils/phone";

const EASTERN = "America/New_York";
const SESSION_PAGE = 10;
const INBOUND_PAGE = 20;
const HISTORY_BYTES = 100_000;
const THREAD_MESSAGES = 120;
const THREAD_TEXT = 8_000;
const TOTAL_TEXT = 16_000;
const RECORD_CAP = 1_000;
type Database = NonNullable<Awaited<ReturnType<typeof getDb>>>;
type Reader = Pick<Database, "select">;
type ReaderDatabase = Pick<Database, "select" | "transaction">;

// Offset-less strings, seconds-vs-milliseconds guesses, and rolled calendar dates
// must not silently become source evidence. Stored numeric history ts uses Unix ms.
function instant(value: unknown): number | null {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : null;
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && Number.isFinite(new Date(value).getTime()) ? value : null;
  }
  if (typeof value !== "string") return null;
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match || !isValidBookingRescheduleDate(match[1]) || +match[2] > 23 || +match[3] > 59 || +(match[4] ?? 0) > 59) return null;
  if (match[5] !== "Z" && (+match[5].slice(1, 3) > 23 || +match[5].slice(4) > 59)) return null;
  const at = Date.parse(value);
  return Number.isFinite(at) ? at : null;
}
function formatter(timeZone: string, clock = false) {
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone, year: "numeric", month: "2-digit", day: "2-digit",
      ...(clock ? { hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" as const } : {}),
    });
  } catch { throw new Error("Invalid audit timezone."); }
}
function parts(at: number, timeZone: string, clock = false) {
  const values = formatter(timeZone, clock).formatToParts(at);
  return (type: string) => values.find(value => value.type === type)?.value ?? "";
}
export function businessDate(value: Date | string | number, timeZone = EASTERN): string {
  const at = instant(value);
  if (at === null) throw new Error("Invalid audit timestamp; an explicit offset is required.");
  const get = parts(at, timeZone);
  return `${get("year")}-${get("month")}-${get("day")}`;
}
function midnight(date: string, timeZone: string): Date {
  const target = Date.parse(`${date}T00:00:00.000Z`);
  let at = target;
  for (let attempt = 0; attempt < 6; attempt++) {
    const get = parts(at, timeZone, true);
    const wall = Date.parse(`${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}:${get("second")}.000Z`);
    const correction = target - wall;
    if (!correction) return new Date(at);
    at += correction;
  }
  throw new Error("Audit timezone has an ambiguous or unavailable midnight.");
}
/** Resolve each calendar midnight independently: DST days are not always 24 hours. */
export function auditDayWindow(auditDate: string, timeZone = EASTERN): { start: Date; end: Date } {
  if (!isValidBookingRescheduleDate(auditDate)) throw new Error("Invalid audit date.");
  return { start: midnight(auditDate, timeZone), end: midnight(shiftBookingDate(auditDate, 1), timeZone) };
}
function phone(value: unknown): string | null {
  if (typeof value !== "string" || !/^\+?[\d\s().-]+$/.test(value.trim())) return null;
  return normalizePhone(value.trim());
}
function string(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
function hash(value: string) { return createHash("sha256").update(value).digest("hex").slice(0, 32); }
function threadKey(customerPhone: string) { return `audit-thread:${hash(customerPhone)}`; }
function messageKey(customerPhone: string, direction: AuditMessage["direction"], providerId: string | null, fallback: string) {
  return providerId ? `audit-message:${hash(`${customerPhone}:${direction}:${providerId}`)}` : fallback;
}
async function database(db?: ReaderDatabase): Promise<ReaderDatabase> {
  const result = db ?? await getDb();
  if (!result) throw new Error("Audit database is unavailable; no verification was performed.");
  if (typeof result.transaction !== "function") throw new Error("Audit database cannot provide a read-only snapshot.");
  return result;
}
async function snapshot<T>(db: ReaderDatabase, read: (reader: Reader) => Promise<T>): Promise<T> {
  // Drizzle mysql2 acquires one connection and releases it before resolution.
  // REPEATABLE READ establishes the consistent snapshot at the first SELECT.
  // Do not combine withConsistentSnapshot/accessMode: this installed Drizzle
  // version omits their required SQL comma. READ ONLY itself emits valid SQL.
  try {
    return await db.transaction(tx => read(tx), {
      isolationLevel: "repeatable read", accessMode: "read only",
    });
  } catch {
    // Provider/SQL errors can contain SQL parameters (including customer phones).
    throw new Error("Audit snapshot read failed; no verification was performed.");
  }
}
class Warnings {
  counts = new Map<string, number>();
  add(reason: string) { this.counts.set(reason, (this.counts.get(reason) ?? 0) + 1); }
  list() { return Array.from(this.counts).map(([reason, count]) => `${reason} (${count})`); }
}
type Entry = { message: AuditMessage; at: number; anchor: boolean; providerId: string | null };
type CollectedThread = { thread: AuditThread; entries: Entry[]; anchored: boolean };
export type ReadAuditMessagesInput = {
  auditDate: string; timeZone?: string; asOf: string; cursor?: AuditCursor | null;
  extraPhones?: string[];
};
export type ReadAuditMessagesResult = { threads: AuditThread[]; coverage: AuditCoverage; nextCursor: AuditCursor | null };

export async function readAuditMessages(input: ReadAuditMessagesInput, db?: ReaderDatabase): Promise<ReadAuditMessagesResult> {
  const timeZone = input.timeZone ?? EASTERN;
  const { start, end } = auditDayWindow(input.auditDate, timeZone);
  const cutoff = instant(input.asOf);
  if (cutoff === null) throw new Error("Invalid audit asOf; an explicit offset is required.");
  const asOf = new Date(cutoff).toISOString();
  const cursor = input.cursor;
  if (cursor && (instant(cursor.asOf) !== cutoff || !Number.isSafeInteger(cursor.sessionAfterId) || cursor.sessionAfterId < 0 || !Number.isSafeInteger(cursor.inboundAfterId) || cursor.inboundAfterId < 0)) {
    throw new Error("Invalid audit continuation cursor or changed asOf.");
  }
  const source = await snapshot(await database(db), async reader => {
    const sessions = await reader.select({
      id: conversationSessions.id, leadPhone: conversationSessions.leadPhone, leadName: conversationSessions.leadName,
      // Cap bytes in SQL, not just after transferring a potentially huge history.
      messageHistory: sql<string | null>`case when octet_length(${conversationSessions.messageHistory}) <= ${HISTORY_BYTES} then ${conversationSessions.messageHistory} else null end`,
    }).from(conversationSessions).where(and(
      gte(conversationSessions.updatedAt, start), gt(conversationSessions.id, cursor?.sessionAfterId ?? 0),
    )).orderBy(asc(conversationSessions.id)).limit(SESSION_PAGE + 1);
    const inbound = await reader.select({
      id: inboundSms.id, fromPhone: inboundSms.fromPhone, toPhone: inboundSms.toPhone,
      message: inboundSms.message, openPhoneMessageId: inboundSms.openPhoneMessageId, receivedAt: inboundSms.receivedAt,
    }).from(inboundSms).where(and(
      gte(inboundSms.receivedAt, start.getTime()), lt(inboundSms.receivedAt, end.getTime()),
      lte(inboundSms.receivedAt, cutoff), gt(inboundSms.id, cursor?.inboundAfterId ?? 0),
    )).orderBy(asc(inboundSms.id)).limit(INBOUND_PAGE + 1);
    const phones = Array.from(new Set((input.extraPhones ?? []).map(phone).filter((value): value is string => !!value))).slice(0, 50);
    const context = phones.length ? await reader.select({
      id: conversationSessions.id, leadPhone: conversationSessions.leadPhone, leadName: conversationSessions.leadName,
      messageHistory: sql<string | null>`case when octet_length(${conversationSessions.messageHistory}) <= ${HISTORY_BYTES} then ${conversationSessions.messageHistory} else null end`,
    }).from(conversationSessions).where(phoneMatch(conversationSessions.leadPhone, phones))
      .orderBy(asc(conversationSessions.id)).limit(51) : [];
    return { sessions, inbound, context };
  });
  const moreSessions = source.sessions.length > SESSION_PAGE;
  const moreInbound = source.inbound.length > INBOUND_PAGE;
  const sessions = Array.from(new Map([...source.sessions.slice(0, SESSION_PAGE), ...source.context.slice(0, 50)].map(session => [session.id, session])).values());
  const inbound = source.inbound.slice(0, INBOUND_PAGE);
  const warnings = new Warnings();
  let damaged = false;
  const threads = new Map<string, CollectedThread>();
  const getThread = (customerPhone: string, name: string | null) => {
    let collected = threads.get(customerPhone);
    if (!collected) {
      collected = { thread: { key: threadKey(customerPhone), customerPhone, customerName: name, messages: [], truncated: false }, entries: [], anchored: false };
      threads.set(customerPhone, collected);
    } else if (!collected.thread.customerName && name) collected.thread.customerName = name;
    return collected;
  };
  const gap = (thread: CollectedThread, reason: string) => {
    thread.thread.truncated = true; damaged = true; warnings.add(reason);
  };
  if (source.context.length > 50) {
    for (const value of input.extraPhones ?? []) {
      const customerPhone = phone(value);
      if (customerPhone) gap(getThread(customerPhone, null), "Exact-phone conversation context reached its cap; missing acknowledgements/corrections require manual review");
    }
  }
  const add = (thread: CollectedThread, entry: Entry) => {
    if (entry.at < start.getTime() - 86_400_000 || entry.at > cutoff) return;
    thread.anchored ||= entry.anchor;
    // Deduplication is only this returned view, scoped to this exact customer AND
    // direction. Equal text is never enough. Prefer known provider occurrence time.
    const duplicate = entry.providerId ? thread.entries.findIndex(other => other.providerId === entry.providerId && other.message.direction === entry.message.direction) : -1;
    if (duplicate < 0) thread.entries.push(entry);
    else {
      const previous = thread.entries[duplicate];
      const rank = (message: AuditMessage) => message.timeBasis === "provider" ? 3 : message.timeBasis === "history" ? 2 : 1;
      if (rank(entry.message) > rank(previous.message)) thread.entries[duplicate] = entry;
      warnings.add("Repeated same-customer/direction provider IDs deduplicated in this view only");
    }
  };
  for (const session of sessions) {
    const customerPhone = phone(session.leadPhone);
    if (!customerPhone) { damaged = true; warnings.add("Invalid/non-US session customer phones skipped; no identity guess"); continue; }
    const thread = getThread(customerPhone, string(session.leadName));
    let history: unknown;
    try {
      if (session.messageHistory === null || session.messageHistory === undefined) throw new Error();
      const raw = typeof session.messageHistory === "string" ? session.messageHistory : JSON.stringify(session.messageHistory);
      if (Buffer.byteLength(raw, "utf8") > HISTORY_BYTES) {
        gap(thread, "Oversized conversation history skipped at the 100k-byte cap; no repair"); continue;
      }
      history = JSON.parse(raw);
      if (!Array.isArray(history)) throw new Error();
    } catch { gap(thread, "Missing, malformed, or SQL-size-capped conversation history skipped; no repair"); continue; }
    (history as unknown[]).forEach((raw, index) => {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) { gap(thread, "Malformed history envelope skipped"); return; }
      const item = raw as Record<string, unknown>;
      if (!["user", "customer", "assistant"].includes(String(item.role))) return;
      const direction = item.role === "assistant" ? "outbound" as const : "inbound" as const;
      const text = string(item.content) ?? string(item.text) ?? string(item.body);
      if (!text) { gap(thread, "Missing message text skipped; media-only content is not audited"); return; }
      const providerId = string(item.opMsgId) ?? string(item.openPhoneId);
      // Stored source labels/IDs cannot bind session identity, business line or
      // delivery. Even reconciled histories stay unverified until the provider
      // page/GET proves the exact customer, text, line, ID and occurrence time.
      const at = instant(item.ts) ?? instant(item.timestamp) ?? (item.source === "openphone_reconcile" ? instant(item.createdAt) : null);
      if (at === null) { gap(thread, "Unknown or invalid history timestamp skipped; no date fabricated"); return; }
      if (at < start.getTime() - 86_400_000 || at > cutoff) return;
      const delivery: AuditMessage["delivery"] = direction === "inbound" ? "received" : "unknown";
      warnings.add("Generic history timestamps are processing/history time, not verified provider occurrence time");
      if (delivery === "unknown") warnings.add("Outbound assistant text has no actual sent evidence; it is not confirmation proof");
      add(thread, {
        at, anchor: at >= start.getTime() && at < end.getTime(), providerId,
        message: {
          key: messageKey(customerPhone, direction, providerId, `history:${session.id}:${index}`),
          sessionId: session.id, customerPhone, businessPhone: null, direction, text,
          providerMessageId: providerId,
          occurredAt: new Date(at).toISOString(), observedAt: new Date(at).toISOString(),
          timeBasis: "history", delivery, source: "conversation_history",
        },
      });
    });
  }
  for (const row of inbound) {
    const customerPhone = phone(row.fromPhone);
    if (!customerPhone) { damaged = true; warnings.add("Invalid/non-US inbound customer phones skipped; no identity guess"); continue; }
    const thread = getThread(customerPhone, null);
    const at = instant(row.receivedAt);
    const text = string(row.message);
    if (at === null || !text) { gap(thread, "Malformed inbound intake timestamp/text skipped"); continue; }
    if (at < start.getTime() || at >= end.getTime() || at > cutoff) continue;
    const providerId = string(row.openPhoneMessageId);
    warnings.add("Inbound intake receivedAt is observed time only; it cannot prove the provider occurrence date");
    add(thread, {
      at, anchor: true, providerId,
      message: {
        key: messageKey(customerPhone, "inbound", providerId, `inbound:${row.id}`), sessionId: null,
        customerPhone, businessPhone: phone(row.toPhone), direction: "inbound", text,
        providerMessageId: providerId,
        occurredAt: null, observedAt: new Date(at).toISOString(), timeBasis: "received", delivery: "received", source: "inbound_sms",
      },
    });
  }
  const included = Array.from(threads.values()).filter(value => value.anchored || value.thread.truncated);
  const selected = new Map<CollectedThread, Entry[]>();
  let textLeft = TOTAL_TEXT;
  const retain = (thread: CollectedThread, entry: Entry) => {
    const kept = selected.get(thread)!;
    const room = Math.min(textLeft, THREAD_TEXT - kept.reduce((total, value) => total + value.message.text.length, 0));
    if (kept.length >= THREAD_MESSAGES || room <= 0) { gap(thread, "Thread message/text or overall text cap omitted evidence/context; affected thread cannot be fully verified"); return; }
    if (entry.message.text.length > room) gap(thread, "Message text clipped by thread/overall text cap; affected thread cannot be fully verified");
    const text = entry.message.text.slice(0, room);
    kept.push({ ...entry, message: { ...entry.message, text } });
    textLeft -= text.length;
  };
  // All selected-day anchors are considered before ANY prior/later context,
  // including across threads. Newer 121-message context cannot evict anchors.
  for (const thread of included) {
    selected.set(thread, []);
    thread.entries.sort((a, b) => a.at - b.at || a.message.key.localeCompare(b.message.key));
    for (const entry of thread.entries.filter(value => value.anchor)) retain(thread, entry);
  }
  for (const thread of included) {
    const context = thread.entries.filter(value => !value.anchor).sort((a, b) => {
      const distance = (value: Entry) => value.at < start.getTime() ? start.getTime() - value.at : value.at - end.getTime();
      return distance(a) - distance(b) || a.at - b.at;
    });
    for (const entry of context) retain(thread, entry);
    thread.thread.messages = selected.get(thread)!.sort((a, b) => a.at - b.at || a.message.key.localeCompare(b.message.key)).map(value => value.message);
  }
  const resultThreads = included.map(value => value.thread);
  const nextCursor: AuditCursor | null = moreSessions || moreInbound ? {
    sessionAfterId: source.sessions.slice(0, SESSION_PAGE).at(-1)?.id ?? cursor?.sessionAfterId ?? 0,
    inboundAfterId: inbound.at(-1)?.id ?? cursor?.inboundAfterId ?? 0, asOf,
  } : null;
  if (nextCursor) warnings.add("More qualifying rows remain; continue using nextCursor with the same auditDate/timeZone/asOf");
  return {
    threads: resultThreads, nextCursor,
    coverage: {
      status: "partial", messagesRead: resultThreads.reduce((sum, thread) => sum + thread.messages.length, 0),
      threadsRead: resultThreads.length, threadsAnalyzed: 0, truncated: damaged || !!nextCursor,
      warnings: ["Partial capture only: inbound/outbound provider coverage and histories are not independently reconciled; absence is not proof.", ...warnings.list()],
    },
  };
}

function extras(value: unknown, warnings: Warnings): string[] | null {
  if (value === null || value === undefined) return null;
  try {
    const parsed: unknown = typeof value === "string" ? JSON.parse(value) : value;
    if (!Array.isArray(parsed)) throw new Error();
    const values = parsed.map(item => typeof item === "string" ? string(item) : item && typeof item === "object" ? string(item.id) : null);
    if (values.some(value => !value)) throw new Error();
    return values as string[];
  } catch { warnings.add("Malformed persisted extras are unknown, not an empty service list"); return null; }
}
function date(value: unknown): string | null { return typeof value === "string" && isValidBookingRescheduleDate(value) ? value : null; }
function clock(value: unknown): string | null { return typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value) ? value : null; }
/** Read-only metadata equality; supports historical formatting, never fuzzy names. */
function phoneMatch(column: typeof bookings.customerPhone | typeof leadflowJobs.customerPhone | typeof conversationSessions.leadPhone, phones: string[]) {
  const digits = phones.flatMap(value => [value.slice(2), value.slice(1)]);
  return inArray(sql<string>`regexp_replace(${column}, '[^0-9]', '')`, digits);
}
export type ReadAuditRecordsInput = { threads: AuditThread[]; candidates: AuditCandidate[] };
export type ReadAuditRecordsResult = { records: AuditRecord[]; truncated: boolean; warnings: string[] };

export async function readAuditRecords(input: ReadAuditRecordsInput, db?: ReaderDatabase): Promise<ReadAuditRecordsResult> {
  const connection = await database(db);
  const warnings = new Warnings();
  // The orchestrator reads/releases current state before LLM interpretation, so
  // candidates may intentionally be empty. Supplied threads remain exact scope.
  const keys = new Set(input.candidates.length ? input.candidates.map(candidate => candidate.threadKey) : input.threads.map(thread => thread.key));
  const phones = Array.from(new Set(input.threads.filter(thread => keys.has(thread.key)).map(thread => phone(thread.customerPhone)).filter((value): value is string => !!value)));
  let truncated = false;
  if (input.threads.some(thread => keys.has(thread.key) && !phone(thread.customerPhone))) {
    warnings.add("Invalid/non-US scoped customer phones skipped; no fuzzy-name lookup"); truncated = true;
  }
  if (input.candidates.some(candidate => !input.threads.some(thread => thread.key === candidate.threadKey))) {
    warnings.add("Candidate thread is missing; no inferred customer lookup"); truncated = true;
  }
  if (!phones.length) return { records: [], truncated, warnings: warnings.list() };
  const data = await snapshot(connection, async reader => {
    const canonicalFields = {
      id: bookings.id, publicBookingNumber: bookings.publicBookingNumber, customerPhone: bookings.customerPhone,
      customerName: bookings.customerName, date: bookings.requestedLocalDate, time: bookings.requestedLocalTime,
      timeZone: bookings.requestedTimeZone, status: bookings.status, address: bookings.address,
      serviceName: bookings.serviceName, extras: bookings.extras, recurrence: bookings.recurrence, paymentStatus: bookings.paymentStatus,
    };
    const canonical = await reader.select(canonicalFields).from(bookings).where(phoneMatch(bookings.customerPhone, phones)).orderBy(asc(bookings.id)).limit(RECORD_CAP + 1);
    let scanned = canonical.length;
    const ids = canonical.slice(0, RECORD_CAP).map(row => row.id);
    const jobs = scanned <= RECORD_CAP ? await reader.select({
      id: leadflowJobs.id, bookingId: leadflowJobs.bookingId, seriesId: leadflowJobs.bookingSeriesId,
      customerPhone: leadflowJobs.customerPhone, customerName: leadflowJobs.customerName, date: leadflowJobs.jobDate,
      serviceDateTime: leadflowJobs.serviceDateTime, status: leadflowJobs.bookingStatus, address: leadflowJobs.jobAddress,
      serviceName: leadflowJobs.serviceName, extras: leadflowJobs.extras, teamName: leadflowJobs.teamName, recurrence: leadflowJobs.frequency,
    }).from(leadflowJobs).where(or(phoneMatch(leadflowJobs.customerPhone, phones), ids.length ? inArray(leadflowJobs.bookingId, ids) : undefined))
      .orderBy(asc(leadflowJobs.id)).limit(RECORD_CAP + 1 - scanned) : [];
    scanned += jobs.length;
    const missingIds = Array.from(new Set(jobs.map(row => row.bookingId).filter((id): id is number => id !== null && !ids.includes(id))));
    // Also expose the canonical counterpart of exact-phone jobs, so a stale or
    // cross-customer linkage cannot be mistaken for a clean operational match.
    const linked = missingIds.length && scanned <= RECORD_CAP ? await reader.select(canonicalFields).from(bookings)
      .where(inArray(bookings.id, missingIds)).orderBy(asc(bookings.id)).limit(RECORD_CAP + 1 - scanned) : [];
    scanned += linked.length;
    const native = [...canonical, ...linked].slice(0, RECORD_CAP);
    const nativeIds = native.map(row => row.id);
    const assignments = nativeIds.length ? await reader.select({ bookingId: bookingAssignments.bookingId, teamName: bookingAssignments.teamName })
      .from(bookingAssignments).where(and(inArray(bookingAssignments.bookingId, nativeIds), eq(bookingAssignments.status, "assigned"), isNull(bookingAssignments.unassignedAt)))
      .orderBy(asc(bookingAssignments.id)).limit(RECORD_CAP + 1) : [];
    const payments = nativeIds.length ? await reader.select({ bookingId: bookingPaymentProfiles.bookingId, paymentStatus: bookingPaymentProfiles.paymentStatus })
      .from(bookingPaymentProfiles).where(inArray(bookingPaymentProfiles.bookingId, nativeIds)).orderBy(asc(bookingPaymentProfiles.id)).limit(RECORD_CAP + 1) : [];
    return { canonical: native, jobs, assignments, payments, scanned };
  });
  if (data.scanned > RECORD_CAP || data.assignments.length > RECORD_CAP || data.payments.length > RECORD_CAP) {
    truncated = true; warnings.add("Record/assignment/payment scan cap reached; caller must mark results cannot_verify");
  }
  const assignmentComplete = data.assignments.length <= RECORD_CAP;
  const paymentComplete = data.payments.length <= RECORD_CAP;
  const canonicalById = new Map(data.canonical.map(row => [row.id, row]));
  const records: AuditRecord[] = [];
  for (const row of data.canonical) {
    const customerPhone = phone(row.customerPhone);
    if (!customerPhone) { truncated = true; warnings.add("Invalid linked canonical phone skipped; linkage cannot be verified"); continue; }
    if (!phones.includes(customerPhone)) warnings.add("Linked canonical record has a different exact customer phone; linkage is not identity proof");
    if (!date(row.date) || !clock(row.time) || !string(row.timeZone)) warnings.add("Canonical requested date/time/timezone is missing or invalid; no scheduled value is invented");
    const active = data.assignments.filter(value => value.bookingId === row.id);
    const profiles = data.payments.filter(value => value.bookingId === row.id);
    if (active.length > 1) warnings.add("Multiple active assignments are ambiguous; canonical teamName is unknown");
    const paymentStatus = string(row.paymentStatus);
    if (profiles.length > 1 || profiles.some(profile => string(profile.paymentStatus) !== paymentStatus)) {
      warnings.add("Payment-profile status disagrees or is ambiguous; canonical status is preserved, not card-on-file proof");
    }
    if (!paymentComplete) warnings.add("Payment-profile coverage is truncated; canonical status alone cannot prove an amount");
    records.push({
      key: `booking:${row.id}`, source: "bookings", bookingId: row.id, jobId: null,
      publicBookingNumber: row.publicBookingNumber, seriesId: null, customerPhone, customerName: string(row.customerName),
      date: date(row.date), time: clock(row.time), timeZone: string(row.timeZone), status: string(row.status),
      address: string(row.address), serviceName: string(row.serviceName), extras: extras(row.extras, warnings),
      teamName: assignmentComplete && active.length === 1 ? string(active[0].teamName) : null,
      recurrence: string(row.recurrence), paymentStatus, paidAmountCents: null,
    });
  }
  for (const row of data.jobs) {
    if (records.length >= RECORD_CAP) break;
    const customerPhone = phone(row.customerPhone);
    if (!customerPhone) { truncated = true; warnings.add("Invalid/non-US operational phone skipped; linkage cannot be verified"); continue; }
    if (!phones.includes(customerPhone)) warnings.add("Linked operational record has a different exact customer phone; linkage is not identity proof");
    if (!date(row.date)) warnings.add("Operational jobDate is missing or invalid; no visit date is invented");
    if (row.bookingId !== null && !canonicalById.has(row.bookingId)) {
      truncated = true; warnings.add("Linked canonical counterpart is missing from the snapshot; caller must mark results cannot_verify");
    }
    const at = instant(row.serviceDateTime);
    let time: string | null = null;
    if (at !== null) {
      const get = parts(at, EASTERN, true); time = `${get("hour")}:${get("minute")}`;
      if (date(row.date) !== businessDate(at, EASTERN)) {
        truncated = true; warnings.add("Operational jobDate differs from offset-qualified serviceDateTime's Eastern date; caller must mark results cannot_verify");
      }
    } else warnings.add("Operational serviceDateTime is missing/invalid or lacks an explicit offset; scheduled clock is unknown");
    records.push({
      key: `job:${row.id}`, source: "leadflow_jobs", bookingId: row.bookingId, jobId: row.id,
      publicBookingNumber: row.bookingId === null ? null : canonicalById.get(row.bookingId)?.publicBookingNumber ?? null,
      seriesId: row.seriesId === null ? null : String(row.seriesId), customerPhone, customerName: string(row.customerName),
      date: date(row.date), time, timeZone: at === null ? null : EASTERN, status: string(row.status),
      address: string(row.address), serviceName: string(row.serviceName), extras: extras(row.extras, warnings),
      teamName: string(row.teamName), recurrence: string(row.recurrence), paymentStatus: null, paidAmountCents: null,
    });
  }
  if (records.some(record => record.paymentStatus === "captured" || record.paymentStatus === "paid")) warnings.add("Persisted paid/captured status has no paid amount in these sources; quoted totals are not capture amounts");
  return { records, truncated, warnings: warnings.list() };
}
