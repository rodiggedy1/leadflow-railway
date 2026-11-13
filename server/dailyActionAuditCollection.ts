import { createHash } from "node:crypto";
import { AUDIT_COLLECTION_FAILURES, type AuditCollectionFailure, type AuditDayCollection, type AuditDaySms, type AuditMessage, type AuditThread } from "../shared/dailyActionAudit";
import { ENV } from "./_core/env";
import { normalizePhone } from "./utils/phone";

const API = "https://api.quo.com/messages";
const VERSION = "2026-03-30";
const MAX_MESSAGES = 10_000;
const MAX_BYTES = 8 * 1024 * 1024;
const MAX_PAGES = 500;
const DEADLINE_MS = 90_000;
const REQUEST_MS = 5_000;
const MAX_ID_LENGTH = 4_096;
const STATUSES = new Set(["queued", "sent", "delivered", "undelivered", "received", "failed"]);

export type AuditCollectionDependencies = {
  apiKey: string;
  request: typeof fetch;
  /** Millisecond clock, injectable for offline deadline tests. */
  now?: () => number;
};
class CollectionError extends Error {
  constructor(readonly failure: AuditCollectionFailure) { super(AUDIT_COLLECTION_FAILURES[failure]); }
}
function fail(code: AuditCollectionFailure): never { throw new CollectionError(code); }
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
// Provider prefixes, not an invented character allowlist: carrier/opaque strings
// are retained verbatim, bounded by the cumulative response budget.
function id(value: unknown, prefix: string): value is string {
  return typeof value === "string" && value.startsWith(prefix) && value.length <= MAX_ID_LENGTH;
}
function instant(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|([+-])(\d{2}):(\d{2}))$/.exec(value);
  if (!match || Number(match[2]) > 23 || Number(match[3]) > 59 || Number(match[4]) > 59
    || Number(match[6] ?? 0) > 23 || Number(match[7] ?? 0) > 59 || !Number.isFinite(Date.parse(value))) return false;
  const date = new Date(`${match[1]}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === match[1];
}
function parseSms(value: unknown): AuditDaySms {
  if (!object(value) || !id(value.id, "AC") || typeof value.from !== "string"
    || !Array.isArray(value.to) || !value.to.every(recipient => typeof recipient === "string")
    || typeof value.text !== "string" || !id(value.conversationId, "CN")
    || (value.phoneNumberId !== undefined && value.phoneNumberId !== null && !id(value.phoneNumberId, "PN"))
    || (value.direction !== "incoming" && value.direction !== "outgoing")
    || typeof value.status !== "string" || !STATUSES.has(value.status)
    || !instant(value.createdAt) || !instant(value.updatedAt) || !Array.isArray(value.media)) fail("RESPONSE");
  const media: AuditDaySms["media"] = value.media.map(attachment => {
    if (!object(attachment) || typeof attachment.url !== "string"
      || (attachment.type !== undefined && attachment.type !== null && typeof attachment.type !== "string")) fail("RESPONSE");
    // URLs are inert evidence only. Never fetch or render attachment contents here.
    return attachment.type === undefined ? { url: attachment.url } : { url: attachment.url, type: attachment.type as string | null };
  });
  return {
    id: value.id, from: value.from, to: [...value.to], text: value.text,
    phoneNumberId: value.phoneNumberId === undefined ? null : value.phoneNumberId as string | null,
    conversationId: value.conversationId, direction: value.direction, status: value.status,
    createdAt: value.createdAt, updatedAt: value.updatedAt, media,
  };
}

async function readJson(response: Response, budget: { bytes: number }, signal: AbortSignal): Promise<unknown> {
  if (!response.body) fail("RESPONSE");
  const length = response.headers.get("content-length");
  if (length !== null && /^\d+$/.test(length) && Number(length) > MAX_BYTES - budget.bytes) {
    void response.body.cancel().catch(() => undefined);
    fail("LIMIT");
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  const cancel = () => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    while (true) {
      const part = await reader.read();
      if (signal.aborted) fail("TIMEOUT");
      if (part.done) break;
      budget.bytes += part.value.byteLength;
      if (budget.bytes > MAX_BYTES) fail("LIMIT");
      chunks.push(part.value);
    }
    // Fatal UTF-8 decoding prevents silently substituting bytes in evidence.
    try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks))); }
    catch { fail("RESPONSE"); }
  } catch (error) {
    void reader.cancel().catch(() => undefined);
    throw error;
  } finally { signal.removeEventListener("abort", cancel); reader.releaseLock(); }
}

/** The timeout covers both headers and streaming body, even for an injected
 * request that ignores AbortSignal. No retries, artificial delays, or error text.
 */
async function page(url: string, deps: AuditCollectionDependencies, budget: { bytes: number }, timeoutMs: number): Promise<unknown> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { controller.abort(); reject(new CollectionError("TIMEOUT")); }, timeoutMs);
  });
  const work = async () => {
    const response = await deps.request(url, {
      method: "GET", headers: { Authorization: deps.apiKey, "Quo-Api-Version": VERSION },
      redirect: "error", signal: controller.signal,
    });
    if (controller.signal.aborted) { void response.body?.cancel().catch(() => undefined); fail("TIMEOUT"); }
    if (!response.ok) {
      void response.body?.cancel().catch(() => undefined);
      if (response.status === 401 || response.status === 403) fail("ACCESS");
      if (response.status === 429) fail("RATE_LIMIT");
      if (response.status === 408 || response.status === 504) fail("TIMEOUT");
      fail("FAILED");
    }
    return readJson(response, budget, controller.signal);
  };
  try { return await Promise.race([work(), timeout]); }
  catch (error) {
    if (error instanceof CollectionError) throw error;
    if (object(error) && (error.name === "AbortError" || error.name === "TimeoutError" || error.code === "ETIMEDOUT")) fail("TIMEOUT");
    fail("FAILED");
  } finally { if (timer !== undefined) clearTimeout(timer); }
}

/** Collect ALL organization SMS in supplied Eastern-day UTC [start,end) bounds.
 * Completeness means a valid explicit null cursor, never eligibility or AI success.
 * Transient GET-only evidence; no SQL, line configuration, persistence or sends.
 */
export async function collectAuditDaySms(input: { start: Date; end: Date }, deps: AuditCollectionDependencies = { apiKey: ENV.openPhoneApiKey, request: fetch }): Promise<AuditDayCollection> {
  const start = input.start.getTime();
  const end = input.end.getTime();
  const result: AuditDayCollection = {
    status: "failed", scope: "organization", start: Number.isFinite(start) ? input.start.toISOString() : "",
    end: Number.isFinite(end) ? input.end.toISOString() : "", messages: [], pagesRead: 0,
    incoming: 0, outgoing: 0, duplicates: 0, outOfWindow: 0, failure: null,
  };
  try {
    if (!deps.apiKey?.trim() || !Number.isFinite(start) || !Number.isFinite(end) || start >= end
      || !Number.isFinite(start - 1)) fail("CONFIGURATION");
    const now = deps.now ?? Date.now;
    const deadline = now() + DEADLINE_MS;
    const budget = { bytes: 0 };
    // IDs are globally unique; this map includes out-of-window rows so a changed
    // binding cannot disappear behind the day-window check.
    const seen = new Map<string, string>();
    const cursors = new Set<string>();
    let after: string | null = null;
    while (true) {
      const remaining = deadline - now();
      if (!Number.isFinite(remaining) || remaining <= 0) fail("TIMEOUT");
      if (result.pagesRead >= MAX_PAGES || seen.size >= MAX_MESSAGES || budget.bytes >= MAX_BYTES) fail("LIMIT");
      const params = new URLSearchParams({
        // The official range is strictly gt; one millisecond includes midnight.
        "createdAt[gt]": new Date(start - 1).toISOString(), "createdAt[lt]": input.end.toISOString(), limit: "50",
      });
      if (after !== null) params.set("after", after);
      const json = await page(`${API}?${params}`, deps, budget, Math.min(REQUEST_MS, remaining));
      result.pagesRead++;
      if (!object(json) || !Array.isArray(json.data) || json.data.length > 50) fail("RESPONSE");
      let newIds = 0;
      for (const raw of json.data) {
        if (now() >= deadline) fail("TIMEOUT");
        const sms = parseSms(raw);
        const fingerprint = JSON.stringify(sms);
        const previous = seen.get(sms.id);
        if (previous !== undefined) {
          if (previous !== fingerprint) fail("RESPONSE");
          result.duplicates++;
          continue;
        }
        if (seen.size >= MAX_MESSAGES) fail("LIMIT");
        seen.set(sms.id, fingerprint);
        newIds++;
        const occurredAt = Date.parse(sms.createdAt);
        if (occurredAt < start || occurredAt >= end) { result.outOfWindow++; continue; }
        result.messages.push(sms);
        if (sms.direction === "incoming") result.incoming++; else result.outgoing++;
      }
      const nextCursor = json.nextCursor;
      if (!(nextCursor === null || (typeof nextCursor === "string" && nextCursor.length > 0 && nextCursor.length <= MAX_ID_LENGTH))) fail("RESPONSE");
      if (now() >= deadline) fail("TIMEOUT");
      if (nextCursor === null) {
        // A repeated non-empty page with an invented terminal cursor is not
        // trustworthy exhaustion. A truly empty terminal page is valid.
        if (json.data.length > 0 && newIds === 0) fail("CURSOR");
        result.status = "complete";
        return result;
      }
      if (cursors.has(nextCursor as string) || nextCursor === after || newIds === 0) fail("CURSOR");
      cursors.add(nextCursor as string);
      after = nextCursor as string;
    }
  } catch (error) {
    result.failure = error instanceof CollectionError ? error.failure : "FAILED";
    return result;
  }
}

// normalizePhone is authoritative, but intentionally accepts formatted strings.
// Guard arbitrary carrier IDs and non-US '+' country codes before calling it;
// otherwise stripping letters or '+44' digits could bind a different person.
function exactUSPhone(value: string): string | null {
  if (!/^[+\d\s().-]+$/.test(value)) return null;
  if (value.trim().startsWith("+") && !/^\s*\+1(?:[\s().-]*\d){10}[\s().-]*$/.test(value)) return null;
  if (value.includes("+") && !/^\s*\+/.test(value)) return null;
  return normalizePhone(value);
}

/** Analysis eligibility is separate from raw collection. No truncation or
 * customer/line guessing; each eligible day SMS enters exactly one thread.
 */
export function prepareAuditDayThreads(collection: AuditDayCollection): { threads: AuditThread[]; unsupportedMessages: number; warnings: string[] } {
  if (collection.status !== "complete" || collection.failure !== null) return {
    threads: [], unsupportedMessages: 0,
    warnings: ["SMS collection is incomplete. No message threads were prepared for analysis."],
  };
  const byIdentity = new Map<string, AuditThread>();
  let unsupportedMessages = 0;
  for (const sms of collection.messages) {
    const from = exactUSPhone(sms.from);
    const to = sms.to.length === 1 ? exactUSPhone(sms.to[0]) : null;
    if (!sms.phoneNumberId || !from || !to || from === to || !sms.text.trim()) { unsupportedMessages++; continue; }
    const incoming = sms.direction === "incoming";
    const customerPhone = incoming ? from : to;
    const identity = JSON.stringify([sms.phoneNumberId, sms.conversationId, customerPhone]);
    let thread = byIdentity.get(identity);
    if (!thread) {
      thread = {
        key: `thread:${createHash("sha256").update(identity).digest("hex")}`,
        customerPhone, customerName: null, messages: [], truncated: false,
      };
      byIdentity.set(identity, thread);
    }
    const delivery: AuditMessage["delivery"] = incoming && sms.status === "received" ? "received"
      : !incoming && sms.status === "sent" ? "sent" : !incoming && sms.status === "delivered" ? "delivered" : "unknown";
    thread.messages.push({
      // The full tuple is hashed so opaque IDs cannot exceed the existing 200-character
      // model source-reference schema. The literal provider ID remains separate below.
      key: `provider:${createHash("sha256").update(JSON.stringify([sms.phoneNumberId, sms.conversationId, sms.id])).digest("hex")}`,
      providerMessageId: sms.id, sessionId: null, customerPhone, businessPhone: incoming ? to : from,
      direction: incoming ? "inbound" : "outbound", text: sms.text,
      occurredAt: new Date(sms.createdAt).toISOString(), observedAt: null,
      timeBasis: "provider", delivery, source: "provider",
    });
  }
  const threads = Array.from(byIdentity.values());
  for (const thread of threads) thread.messages.sort((a, b) => Date.parse(a.occurredAt!) - Date.parse(b.occurredAt!) || a.key.localeCompare(b.key));
  return {
    threads, unsupportedMessages,
    warnings: unsupportedMessages ? [`${unsupportedMessages} collected SMS message(s) have unsupported individual US-customer, business-line, group, or text evidence and require manual review; they remain in the complete raw collection.`] : [],
  };
}
