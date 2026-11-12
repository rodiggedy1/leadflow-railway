import { createHash } from "node:crypto";
import type { AuditCursor, AuditMessage, AuditThread } from "../shared/dailyActionAudit";
import { ENV } from "./_core/env";
import { normalizePhone } from "./utils/phone";
import { auditBusinessDate, isValidAuditDate } from "./dailyActionAuditEngine";

const API = "https://api.quo.com/messages";
const VERSION = "2026-03-30";
const MAX_RESPONSE_BYTES = 512_000;
const MAX_TEXT = 8_000;
const messageId = /^AC[A-Za-z0-9_-]{1,126}$/;
type ProviderMessage = { id: string; from: string; to: string[]; text: string; phoneNumberId: string | null; direction: "incoming" | "outgoing"; status: string; createdAt: string };
type EvidenceConfig = { apiKey: string; lineIds: string[]; request: typeof fetch; pause?: (milliseconds: number) => Promise<void> };
function config(): EvidenceConfig {
  return { apiKey: ENV.openPhoneApiKey, lineIds: Array.from(new Set([ENV.openPhoneNumberId, ENV.openPhoneCsNumberId, ENV.openPhoneBarkNumberId].filter(Boolean))), request: fetch };
}
function validInstant(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.exec(value);
  return Boolean(match && isValidAuditDate(match[1]) && Number(match[2]) <= 23 && Number(match[3]) <= 59 && Number(match[4]) <= 59 && Number.isFinite(Date.parse(value)));
}
function parseMessage(value: unknown, lineIds: string[]): ProviderMessage | null {
  if (!value || typeof value !== "object") return null;
  const m = value as Record<string, unknown>;
  if (typeof m.id !== "string" || !messageId.test(m.id) || typeof m.phoneNumberId !== "string" || !lineIds.includes(m.phoneNumberId) || typeof m.from !== "string" || !Array.isArray(m.to) || m.to.length !== 1 || typeof m.to[0] !== "string" || typeof m.text !== "string" || m.text.length > MAX_TEXT || !validInstant(m.createdAt) || !["incoming", "outgoing"].includes(String(m.direction)) || typeof m.status !== "string") return null;
  if (!normalizePhone(m.from) || !normalizePhone(m.to[0]) || normalizePhone(m.from) === normalizePhone(m.to[0])) return null;
  return m as unknown as ProviderMessage;
}
async function boundedJson(response: Response): Promise<any> {
  if (!response.ok || !response.body) throw new Error("Provider evidence unavailable");
  const size = Number(response.headers.get("content-length"));
  if (Number.isFinite(size) && size > MAX_RESPONSE_BYTES) throw new Error("Provider evidence too large");
  const reader = response.body.getReader();
  let bytes = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) throw new Error("Provider evidence too large");
      chunks.push(part.value);
    }
  } catch (error) { await reader.cancel().catch(() => undefined); throw error; }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
function toAuditMessage(m: ProviderMessage): AuditMessage {
  const incoming = m.direction === "incoming";
  const customerPhone = normalizePhone(incoming ? m.from : m.to[0])!;
  return {
    key: `provider:${m.id}`, sessionId: null, customerPhone,
    businessPhone: normalizePhone(incoming ? m.to[0] : m.from),
    direction: incoming ? "inbound" : "outbound", text: m.text,
    occurredAt: new Date(m.createdAt).toISOString(), observedAt: null,
    providerMessageId: m.id, timeBasis: "provider",
    delivery: incoming && m.status === "received" ? "received" : !incoming && m.status === "delivered" ? "delivered" : !incoming && m.status === "sent" ? "sent" : "unknown",
    source: "provider",
  };
}

/** One provider page per explicit audit batch. No retry, send, write or auto-loop. */
export async function readAuditProviderPage(input: { start: Date; end: Date; cursor?: AuditCursor }, deps: EvidenceConfig = config()): Promise<{
  messages: AuditMessage[]; warnings: string[]; complete: boolean; lineIndex: number; after: string | null; available: boolean;
}> {
  const index = input.cursor?.providerLineIndex ?? 0;
  const done = (warning?: string) => ({ messages: [] as AuditMessage[], warnings: warning ? [warning] : [], complete: true, lineIndex: index, after: null, available: false });
  if (input.cursor?.providerComplete) return done();
  if (!deps.apiKey || !deps.lineIds.length) return done("Authoritative SMS provider evidence is unavailable because the existing key or business-line configuration is missing; stored timestamps alone cannot prove all audit results.");
  if (index >= deps.lineIds.length) return done();
  try {
    const params = new URLSearchParams({ phoneNumberId: deps.lineIds[index], "createdAt[gt]": new Date(input.start.getTime() - 1).toISOString(), "createdAt[lt]": input.end.toISOString(), limit: "50" });
    if (input.cursor?.providerAfter) params.set("after", input.cursor.providerAfter);
    const response = await deps.request(`${API}?${params}`, {
      method: "GET", headers: { Authorization: deps.apiKey, "Quo-Api-Version": VERSION },
      signal: AbortSignal.timeout(5_000), redirect: "error",
    });
    const json = await boundedJson(response);
    if (!Array.isArray(json.data) || json.data.length > 50 || !(json.nextCursor === null || typeof json.nextCursor === "string") || (typeof json.nextCursor === "string" && json.nextCursor.length > 2_000)) throw new Error("Invalid provider response");
    const messages: AuditMessage[] = [];
    let skipped = 0;
    for (const value of json.data) {
      const m = parseMessage(value, deps.lineIds);
      if (!m || Date.parse(m.createdAt) < input.start.getTime() || Date.parse(m.createdAt) >= input.end.getTime() || !m.text.trim()) { skipped++; continue; }
      messages.push(toAuditMessage(m));
    }
    const after = json.nextCursor || null;
    if (after && after === input.cursor?.providerAfter) throw new Error("Provider cursor did not advance");
    const lineIndex = after ? index : index + 1;
    return { messages, warnings: skipped ? [`${skipped} provider message(s) had unsupported group, identity, text or timestamp evidence and require manual review.`] : [], complete: !after && lineIndex >= deps.lineIds.length, lineIndex, after, available: true };
  } catch {
    return done("The bounded provider message read could not be verified. No retry or system action was performed; start a fresh audit or review missing SMS evidence manually.");
  }
}

/** Merge only exact customer phones and provider IDs; never persist reconciliation. */
export function mergeAuditEvidence(threads: AuditThread[], provider: AuditMessage[]): AuditThread[] {
  const byPhone = new Map<string, AuditThread>();
  for (const thread of threads) {
    const phone = normalizePhone(thread.customerPhone);
    if (!phone) continue;
    const previous = byPhone.get(phone);
    byPhone.set(phone, {
      key: `thread:${createHash("sha256").update(phone).digest("hex").slice(0, 24)}`,
      customerPhone: phone,
      customerName: previous?.customerName ?? thread.customerName,
      truncated: Boolean(previous?.truncated || thread.truncated),
      messages: [...(previous?.messages ?? []), ...thread.messages.map(message => ({ ...message, customerPhone: phone }))],
    });
  }
  for (const message of provider) {
    const phone = normalizePhone(message.customerPhone);
    if (!phone) continue;
    const thread = byPhone.get(phone) ?? { key: `thread:${createHash("sha256").update(phone).digest("hex").slice(0, 24)}`, customerPhone: phone, customerName: null, truncated: false, messages: [] };
    thread.messages.push({ ...message, customerPhone: phone });
    byPhone.set(phone, thread);
  }
  for (const thread of Array.from(byPhone.values())) {
    const unique = new Map<string, AuditMessage>();
    for (const message of thread.messages) {
      const id = message.providerMessageId;
      const key = id && messageId.test(id)
        ? `sms:${createHash("sha256").update(`${thread.customerPhone}|${message.direction}|${id}`).digest("hex").slice(0, 24)}` : message.key;
      const previous = unique.get(key);
      if (!previous || message.timeBasis === "provider") unique.set(key, { ...message, key });
    }
    thread.messages = Array.from(unique.values()).sort((a, b) => Date.parse(a.occurredAt ?? a.observedAt ?? "") - Date.parse(b.occurredAt ?? b.observedAt ?? ""));
  }
  return Array.from(byPhone.values());
}

/** Validate a small number of referenced history messages; never fetch unknown IDs. */
export async function hydrateAuditEvidence(threads: AuditThread[], auditDate: string, timeZone: string, deps: EvidenceConfig = config()): Promise<{ threads: AuditThread[]; warnings: string[] }> {
  if (!deps.apiKey || !deps.lineIds.length) return { threads, warnings: [] };
  const needs = threads.flatMap(thread => thread.messages.filter(message => message.timeBasis !== "provider" && message.providerMessageId && messageId.test(message.providerMessageId)).map(message => ({ thread, message })));
  const day = (m: AuditMessage) => auditBusinessDate(m.occurredAt ?? m.observedAt, timeZone);
  needs.sort((a, b) => Number(day(b.message) === auditDate) - Number(day(a.message) === auditDate));
  const verified: AuditMessage[] = [];
  const seen = new Set<string>();
  let attempts = 0;
  let failed = false;
  for (const { thread, message } of needs) {
    if (attempts >= 12) break;
    const id = message.providerMessageId!;
    if (seen.has(id)) continue;
    if (attempts > 0) await (deps.pause ?? (milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))))(1_000);
    seen.add(id); attempts++;
    try {
      const response = await deps.request(`${API}/${encodeURIComponent(id)}`, { method: "GET", headers: { Authorization: deps.apiKey, "Quo-Api-Version": VERSION }, signal: AbortSignal.timeout(3_000), redirect: "error" });
      const json = await boundedJson(response);
      const m = parseMessage(json.data, deps.lineIds);
      if (!m || m.id !== id) { failed = true; continue; }
      const actual = toAuditMessage(m);
      if (actual.customerPhone !== normalizePhone(thread.customerPhone) || actual.direction !== message.direction || actual.text.replace(/\r\n/g, "\n").trim() !== message.text.replace(/\r\n/g, "\n").trim() || (message.businessPhone && actual.businessPhone !== normalizePhone(message.businessPhone))) { failed = true; continue; }
      verified.push({ ...actual, sessionId: message.sessionId });
    } catch { failed = true; break; } // Includes rate limiting: no automatic retry.
  }
  const remaining = needs.length > attempts;
  return { threads: mergeAuditEvidence(threads, verified), warnings: [
    ...(failed ? ["Some stored SMS evidence could not be bound to the provider's exact customer, business line, text and timestamp; it remains unverified."] : []),
    ...(remaining ? ["The bounded provider-evidence check reached its per-batch limit. Unverified context requires manual review."] : []),
  ] };
}
