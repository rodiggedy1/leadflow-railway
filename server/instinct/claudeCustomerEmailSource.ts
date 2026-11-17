import { createHash } from "node:crypto";
import type { CustomerEmailBinding, CustomerEmailSnapshot, CustomerEmailTurn } from "./claudeCustomerEmail";

function record(value: unknown): Record<string, any> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("INVALID_RAW_EMAIL");
  return value as Record<string, any>;
}
function actualId(value: unknown): value is string {
  return typeof value === "string" && !!value && !/\s/.test(value) && !/^(?:cs-fallback-|fallback-|synthetic-)/i.test(value);
}
function timestamp(value: unknown): number {
  const number = typeof value === "string" && /^\d+$/.test(value) ? Number(value) : NaN;
  if (!Number.isSafeInteger(number) || number <= 0) throw new Error("INVALID_RAW_EMAIL_DATE");
  return number;
}
function headerValues(headers: Record<string, string>, name: string): string[] {
  return Object.entries(headers).filter(([key]) => key.toLowerCase() === name).map(([, value]) => value);
}
function oneHeader(headers: Record<string, string>, name: string): string | null {
  const values = headerValues(headers, name);
  return values.length === 1 && !/[\r\n]/.test(values[0].replace(/\r\n[ \t]+/g, " "))
    ? values[0].replace(/\r\n[ \t]+/g, " ").trim() : null;
}
const atom = "[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+";
const localPart = `${atom}(?:\\.${atom})*`;
const domain = "[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+";
const addressPattern = new RegExp(`^${localPart}@${domain}$`);
interface Address { email: string; name: string }
/** A conservative mailbox-list parser: no first-address extraction from an
 * ambiguous list, group, malformed angle address or duplicate routing header. */
function addresses(raw: string | null): Address[] | null {
  if (raw === null || !raw.trim() || /[\r\n]/.test(raw)) return null;
  const parts: string[] = [];
  let start = 0, quoted = false, escaped = false, angle = false;
  for (let index = 0; index < raw.length; index++) {
    const char = raw[index];
    if (escaped) { escaped = false; continue; }
    if (quoted && char === "\\") { escaped = true; continue; }
    if (char === '"') { quoted = !quoted; continue; }
    if (quoted) continue;
    if (char === "<") { if (angle) return null; angle = true; }
    else if (char === ">") { if (!angle) return null; angle = false; }
    else if (char === "," && !angle) { parts.push(raw.substring(start, index)); start = index + 1; }
    else if (char === ";" || char === ":" || char === "(" || char === ")") return null;
  }
  if (quoted || escaped || angle) return null;
  parts.push(raw.substring(start));
  const result: Address[] = [];
  for (const part of parts) {
    const value = part.trim();
    const match = value.match(/^(.*?)<([^<>]+)>$/);
    const email = (match ? match[2] : value).trim();
    if (!addressPattern.test(email)) return null;
    let name = match?.[1].trim() ?? "";
    if (name.startsWith('"') && name.endsWith('"')) name = name.substring(1, name.length - 1).replace(/\\([\\"])/g, "$1");
    else if (/["<>@]/.test(name)) return null;
    result.push({ email: email.toLowerCase(), name });
  }
  return result;
}
function singleAddress(raw: string | null): Address | null {
  const list = addresses(raw);
  return list?.length === 1 ? list[0] : null;
}

/** Full MIME text/plain and text/html bodies, never snippets, clipping or
 * whitespace rewriting. Missing external body data fails closed, not fetched. */
function fullBodies(payload: unknown): { text: string; html: string } {
  const text: string[] = [], html: string[] = [];
  function walk(value: unknown) {
    const part = record(value);
    const disposition = (part.headers ?? []).find((header: any) => String(header.name).toLowerCase() === "content-disposition")?.value ?? "";
    if (part.filename || /^attachment\b/i.test(disposition)) return;
    const mime = String(part.mimeType ?? "").toLowerCase();
    if (mime === "text/plain" || mime === "text/html") {
      const body = record(part.body ?? {});
      if (body.attachmentId && !body.data || !body.data && Number(body.size) > 0) throw new Error("EMAIL_BODY_NOT_COMPLETE");
      if (body.data != null) {
        if (typeof body.data !== "string" || !/^[A-Za-z0-9_+\/-]*={0,2}$/.test(body.data)) throw new Error("INVALID_EMAIL_BODY");
        (mime === "text/plain" ? text : html).push(Buffer.from(body.data, "base64url").toString("utf-8"));
      }
    }
    if (part.parts != null) {
      if (!Array.isArray(part.parts)) throw new Error("INVALID_RAW_EMAIL");
      part.parts.forEach(walk);
    }
  }
  walk(payload);
  return { text: text.join("\n"), html: html.join("\n") };
}

export function emailSnapshotFromRawThread(raw: unknown, mailboxEmail: string): CustomerEmailSnapshot {
  const thread = record(raw);
  const mailbox = singleAddress(mailboxEmail);
  if (!mailbox || !actualId(thread.id) || !Array.isArray(thread.messages) || !thread.messages.length) throw new Error("INVALID_RAW_EMAIL_THREAD");
  const messages: CustomerEmailTurn[] = thread.messages.map((value: unknown) => {
    const msg = record(value), payload = record(msg.payload);
    if (!actualId(msg.id) || msg.threadId !== thread.id || !Array.isArray(payload.headers)
      || !Array.isArray(msg.labelIds) || msg.labelIds.some((label: unknown) => typeof label !== "string")) throw new Error("INVALID_RAW_EMAIL_MESSAGE");
    const headers: Record<string, string> = Object.create(null);
    for (const value of payload.headers) {
      const header = record(value);
      if (typeof header.name !== "string" || !/^[A-Za-z0-9-]+$/.test(header.name) || typeof header.value !== "string") throw new Error("INVALID_RAW_EMAIL_HEADER");
      // Preserve original names and complete values. Duplicate same-case fields
      // retain every value, and cannot pass the single routing-header checks.
      headers[header.name] = Object.hasOwn(headers, header.name) ? headers[header.name] + "\n" + header.value : header.value;
    }
    const sender = singleAddress(oneHeader(headers, "from"));
    const replyTo = singleAddress(oneHeader(headers, "reply-to"));
    const bodies = fullBodies(payload);
    return { id: msg.id, threadId: msg.threadId, fromEmail: sender?.email ?? "", fromName: sender?.name ?? "",
      to: headerValues(headers, "to").join("\n"), replyToEmail: replyTo?.email ?? null,
      subject: headerValues(headers, "subject").join("\n"), text: bodies.text, html: bodies.html,
      createdAt: timestamp(msg.internalDate), headers, labelIds: [...msg.labelIds] };
  });
  return { mailboxEmail: mailbox.email, threadId: thread.id, messages };
}

/** Fingerprint immutable evidence only. Reading a message changes UNREAD, not
 * the incoming message, so mutable labels cannot invalidate an owned reply. */
export function emailSnapshotHash(snapshot: CustomerEmailSnapshot): string {
  const canonical = { ...snapshot, messages: snapshot.messages.map(({ labelIds: _labels, ...message }) => ({ ...message,
    headers: Object.fromEntries(Object.entries(message.headers).sort(([a], [b]) => a.localeCompare(b))) })) };
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}
function automated(message: CustomerEmailTurn, sender: string, recipient: string): boolean {
  const headers = message.headers;
  if ([sender, recipient].some(email => /^(?:no[-_.]?reply|do[-_.]?not[-_.]?reply|mailer[-_.]?daemon|postmaster)(?:[+._-]|@)/i.test(email))) return true;
  if (Object.keys(headers).some(name => /^list-/i.test(name))) return true;
  const auto = headerValues(headers, "auto-submitted");
  if (auto.length && (auto.length !== 1 || !/^no(?:\s*;[^\r\n]*)?$/i.test(auto[0].trim()))) return true;
  if (headerValues(headers, "precedence").some(value => /\b(?:bulk|list|junk)\b/i.test(value))) return true;
  if (headerValues(headers, "return-path").some(value => /^\s*<>\s*$/.test(value))) return true;
  if (headerValues(headers, "content-type").some(value => /\b(?:multipart\/report|message\/delivery-status|message\/disposition-notification)\b/i.test(value))) return true;
  return ["x-autoreply", "x-autorespond", "x-auto-response", "x-failed-recipients"].some(name => headerValues(headers, name).length > 0);
}
const rfcMessageIdPattern = new RegExp(`^<${localPart}@(?:${localPart}|\\[[^\\[\\]\\s<>]+\\])>$`);

/** Bind only the unique actual latest inbound message, not a guessed customer
 * role. Directory membership and sender policy are application-owned. */
export function customerEmailBinding(snapshot: CustomerEmailSnapshot, inboundId: string, receivedAt: number): CustomerEmailBinding | null {
  if (!actualId(inboundId) || !actualId(snapshot.threadId) || !Number.isSafeInteger(receivedAt) || receivedAt <= 0
    || !Array.isArray(snapshot.messages) || !snapshot.messages.length) return null;
  const mailbox = singleAddress(snapshot.mailboxEmail);
  if (!mailbox || mailbox.email !== snapshot.mailboxEmail) return null;
  const ids = new Set<string>();
  for (const message of snapshot.messages) {
    if (!actualId(message.id) || ids.has(message.id) || message.threadId !== snapshot.threadId
      || !Number.isSafeInteger(message.createdAt) || message.createdAt <= 0 || message.createdAt > receivedAt
      || typeof message.text !== "string" || typeof message.html !== "string"
      || !message.headers || !Array.isArray(message.labelIds)) return null;
    ids.add(message.id);
  }
  const inbound = snapshot.messages.find(message => message.id === inboundId);
  if (!inbound || snapshot.messages.some(message => message !== inbound && message.createdAt >= inbound.createdAt)
    || !inbound.labelIds.includes("INBOX") || inbound.labelIds.some(label => ["SENT", "DRAFT", "SPAM", "TRASH"].includes(label))) return null;
  const from = singleAddress(oneHeader(inbound.headers, "from"));
  const replyHeaders = headerValues(inbound.headers, "reply-to");
  const replyTo = replyHeaders.length ? singleAddress(oneHeader(inbound.headers, "reply-to")) : null;
  if (!from || from.email !== inbound.fromEmail || from.email === mailbox.email
    || (replyHeaders.length && !replyTo) || (replyTo?.email ?? null) !== inbound.replyToEmail) return null;
  const recipient = replyTo?.email ?? from.email;
  if (recipient === mailbox.email || automated(inbound, from.email, recipient)) return null;
  const routingNames = ["to", "cc", "delivered-to", "x-original-to"];
  let addressedToMailbox = false;
  for (const name of routingNames) {
    const values = headerValues(inbound.headers, name);
    if (!values.length) continue;
    if (values.length !== 1) return null;
    const list = addresses(oneHeader(inbound.headers, name));
    if (!list) return null;
    if (list.some(address => address.email === mailbox.email)) addressedToMailbox = true;
  }
  const rfcMessageId = oneHeader(inbound.headers, "message-id");
  const inboundText = inbound.text.trim() ? inbound.text : inbound.html;
  if (!addressedToMailbox || !rfcMessageId || !rfcMessageIdPattern.test(rfcMessageId) || !inboundText.trim()) return null;
  return { mailboxEmail: mailbox.email, threadId: snapshot.threadId, inboundMessageId: inbound.id,
    fromEmail: from.email, replyToEmail: replyTo?.email ?? null, recipientEmail: recipient,
    senderName: from.name || null, subject: inbound.subject, rfcMessageId,
    createdAt: inbound.createdAt, receivedAt, inboundText, snapshotHash: emailSnapshotHash(snapshot), snapshot };
}
