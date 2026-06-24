/**
 * gmailService.ts — Gmail API integration for the shared inbox
 *
 * Token priority:
 *   1. GMAIL_REFRESH_TOKEN env var (set in Railway for fast startup)
 *   2. gmail_state DB row (written by the OAuth callback)
 */
import { google } from "googleapis";
import { ENV } from "./_core/env";
import { getDb } from "./db";
import { gmailState, gmailThreadMeta } from "../drizzle/schema";
import { eq, and, sql } from "drizzle-orm";

// In-memory cache so we don't hit the DB on every API call.
// Cleared when a new token is stored via the OAuth callback.
let _cachedRefreshToken: string | null = null;
let _cachedInboxEmail: string | null = null;

export function clearRefreshTokenCache() {
  _cachedRefreshToken = null;
  _cachedInboxEmail = null; // also clear inbox email so it re-fetches on next use
}

/**
 * Returns the authenticated Gmail account's email address.
 * Cached in memory after the first call — same lifecycle as the refresh token.
 */
export async function getInboxEmailAddress(): Promise<string | null> {
  if (_cachedInboxEmail) return _cachedInboxEmail;
  try {
    const gmail = await getGmailClient();
    const profile = await gmail.users.getProfile({ userId: "me" });
    _cachedInboxEmail = profile.data.emailAddress ?? null;
    return _cachedInboxEmail;
  } catch {
    return null;
  }
}

async function getRefreshToken(): Promise<string | null> {
  if (ENV.gmailRefreshToken) return ENV.gmailRefreshToken;
  if (_cachedRefreshToken) return _cachedRefreshToken;
  try {
    const db = await getDb();
    if (db) {
      const [state] = await db.select().from(gmailState).where(eq(gmailState.id, 1));
      if (state?.refreshToken) {
        _cachedRefreshToken = state.refreshToken;
        return _cachedRefreshToken;
      }
    }
  } catch { /* DB not ready yet */ }
  return null;
}

async function getOAuth2Client() {
  const oauth2Client = new google.auth.OAuth2(
    ENV.gmailClientId,
    ENV.gmailClientSecret,
    ENV.gmailRedirectUri
  );
  const token = await getRefreshToken();
  if (token) {
    oauth2Client.setCredentials({ refresh_token: token });
  }
  return oauth2Client;
}

async function getGmailClient() {
  return google.gmail({ version: "v1", auth: await getOAuth2Client() });
}

export function getGmailAuthUrl(): string {
  const oauth2Client = new google.auth.OAuth2(
    ENV.gmailClientId,
    ENV.gmailClientSecret,
    ENV.gmailRedirectUri
  );
  return oauth2Client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: ["https://www.googleapis.com/auth/gmail.modify"],
  });
}

export async function exchangeCodeForTokens(code: string) {
  const oauth2Client = new google.auth.OAuth2(
    ENV.gmailClientId,
    ENV.gmailClientSecret,
    ENV.gmailRedirectUri
  );
  const { tokens } = await oauth2Client.getToken(code);
  // Clear cache so next call picks up the new token from DB
  clearRefreshTokenCache();
  return tokens;
}

export interface GmailMessage {
  id: string;
  threadId: string;
  from: string;
  fromEmail: string;
  to: string;
  subject: string;
  snippet: string;
  bodyHtml: string;
  bodyText: string;
  date: number;
  isUnread: boolean;
  attachments: { filename: string; mimeType: string; attachmentId: string }[];
}

export interface GmailThread {
  id: string;
  subject: string;
  snippet: string;
  from: string;
  fromEmail: string;
  date: number;
  isUnread: boolean;
  messageCount: number;
  messages: GmailMessage[];
  /** The authenticated inbox email address — used by clients to identify outbound messages */
  inboxEmail: string | null;
}

function decodeBase64(data: string): string {
  return Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf-8");
}

function extractBody(payload: any): { html: string; text: string } {
  let html = "";
  let text = "";
  function walk(part: any) {
    if (!part) return;
    if (part.mimeType === "text/html" && part.body?.data) html = decodeBase64(part.body.data);
    else if (part.mimeType === "text/plain" && part.body?.data) text = decodeBase64(part.body.data);
    if (part.parts) part.parts.forEach(walk);
  }
  walk(payload);
  return { html, text };
}

function parseMessage(msg: any): GmailMessage {
  const headers: Record<string, string> = {};
  (msg.payload?.headers ?? []).forEach((h: any) => { headers[h.name.toLowerCase()] = h.value; });
  const from = headers["from"] ?? "";
  const fromEmailMatch = from.match(/<(.+?)>/) ?? from.match(/(\S+@\S+)/);
  const fromEmail = fromEmailMatch?.[1] ?? from;
  const fromName = from.replace(/<.+?>/, "").trim() || fromEmail;
  const { html, text } = extractBody(msg.payload);
  const attachments: GmailMessage["attachments"] = [];
  function findAttachments(part: any) {
    if (!part) return;
    if (part.filename && part.body?.attachmentId) {
      attachments.push({ filename: part.filename, mimeType: part.mimeType, attachmentId: part.body.attachmentId });
    }
    if (part.parts) part.parts.forEach(findAttachments);
  }
  findAttachments(msg.payload);
  return {
    id: msg.id, threadId: msg.threadId, from: fromName, fromEmail,
    to: headers["to"] ?? "", subject: headers["subject"] ?? "(no subject)",
    snippet: msg.snippet ?? "", bodyHtml: html, bodyText: text,
    date: parseInt(msg.internalDate ?? "0"),
    isUnread: (msg.labelIds ?? []).includes("UNREAD"),
    attachments,
  };
}

export async function listInboxThreads(opts: {
  pageToken?: string; maxResults?: number; query?: string;
}): Promise<{ threads: GmailThread[]; nextPageToken?: string }> {
  const gmail = await getGmailClient();
  const listRes = await gmail.users.threads.list({
    userId: "me",
    maxResults: opts.maxResults ?? 30,
    pageToken: opts.pageToken,
    q: opts.query ? `in:inbox ${opts.query}` : "in:inbox",
  });
  const threadItems = listRes.data.threads ?? [];
  const nextPageToken = listRes.data.nextPageToken ?? undefined;
  if (threadItems.length === 0) return { threads: [], nextPageToken };
  const threads = await Promise.all(
    threadItems.map(async (t) => {
      try { return await getThreadDetail(t.id!); } catch { return null; }
    })
  );
  // Sort by latest message date descending — Gmail's list order is not purely
  // chronological and Promise.all doesn't preserve input order.
  const sorted = (threads.filter(Boolean) as GmailThread[]).sort((a, b) => b.date - a.date);
  return { threads: sorted, nextPageToken };
}

export async function getThreadDetail(threadId: string): Promise<GmailThread> {
  const gmail = await getGmailClient();
  const res = await gmail.users.threads.get({ userId: "me", id: threadId, format: "full" });
  const messages = (res.data.messages ?? []).map(parseMessage);
  const latest = messages[messages.length - 1];
  const first = messages[0];

  // Get the inbox email address (cached after first call)
  const inboxEmail = await getInboxEmailAddress();

  // The thread's display contact is always the OTHER person — not the inbox.
  // Find the last message sent by someone other than the inbox address.
  // This correctly handles threads where we sent first, replied last, or both.
  const otherParty = inboxEmail
    ? [...messages].reverse().find((m) => m.fromEmail.toLowerCase() !== inboxEmail.toLowerCase())
    : null;

  // Fallback: if somehow every message is from the inbox (shouldn't happen), use first message
  const contactMsg = otherParty ?? first;

  return {
    id: threadId,
    subject: first?.subject ?? "(no subject)",
    snippet: latest?.snippet ?? "",
    from: contactMsg?.from ?? "",
    fromEmail: contactMsg?.fromEmail ?? "",
    date: latest?.date ?? 0,
    isUnread: messages.some((m) => m.isUnread),
    messageCount: messages.length,
    messages,
    inboxEmail,
  };
}

export async function sendGmailReply(opts: {
  threadId: string; to: string; subject: string; bodyHtml: string; inReplyToMessageId?: string;
}): Promise<{ messageId: string; threadId: string }> {
  const gmail = await getGmailClient();
  const subject = opts.subject.startsWith("Re:") ? opts.subject : `Re: ${opts.subject}`;
  const headers = [
    `To: ${opts.to}`, `Subject: ${subject}`,
    `Content-Type: text/html; charset=utf-8`, `MIME-Version: 1.0`,
    ...(opts.inReplyToMessageId
      ? [`In-Reply-To: ${opts.inReplyToMessageId}`, `References: ${opts.inReplyToMessageId}`]
      : []),
  ].join("\r\n");
  const raw = Buffer.from(`${headers}\r\n\r\n${opts.bodyHtml}`).toString("base64url");
  const res = await gmail.users.messages.send({ userId: "me", requestBody: { raw, threadId: opts.threadId } });
  return { messageId: res.data.id!, threadId: res.data.threadId! };
}

/**
 * Send a Gmail reply with one or more file attachments.
 * Builds a proper multipart/mixed MIME message so attachments are delivered
 * as real email attachments (not inline images or links).
 */
export async function sendGmailReplyWithAttachments(opts: {
  threadId: string;
  to: string;
  subject: string;
  bodyHtml: string;
  inReplyToMessageId?: string;
  attachments: { url: string; filename: string; mimeType: string }[];
}): Promise<{ messageId: string; threadId: string }> {
  const gmail = await getGmailClient();
  const subject = opts.subject.startsWith("Re:") ? opts.subject : `Re: ${opts.subject}`;
  const boundary = `----=_Part_${Date.now()}_${Math.random().toString(36).slice(2)}`;

  // Fetch all attachment buffers in parallel
  const attachmentBuffers = await Promise.all(
    opts.attachments.map(async (att) => {
      const res = await fetch(att.url);
      if (!res.ok) throw new Error(`Failed to fetch attachment: ${att.filename}`);
      const buf = Buffer.from(await res.arrayBuffer());
      return { ...att, buf };
    })
  );

  // Part 1: HTML body
  const bodyPart =
    `--${boundary}\r\n` +
    `Content-Type: text/html; charset=utf-8\r\n` +
    `Content-Transfer-Encoding: 7bit\r\n` +
    `\r\n` +
    `${opts.bodyHtml}\r\n`;

  // Part 2+: Attachments
  const attachmentParts = attachmentBuffers.map((att) => {
    const b64 = att.buf.toString("base64");
    const b64Lines = b64.match(/.{1,76}/g)?.join("\r\n") ?? b64;
    return (
      `--${boundary}\r\n` +
      `Content-Type: ${att.mimeType}; name="${att.filename}"\r\n` +
      `Content-Transfer-Encoding: base64\r\n` +
      `Content-Disposition: attachment; filename="${att.filename}"\r\n` +
      `\r\n` +
      `${b64Lines}\r\n`
    );
  });

  const headers = [
    `To: ${opts.to}`,
    `Subject: ${subject}`,
    `MIME-Version: 1.0`,
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    ...(opts.inReplyToMessageId
      ? [`In-Reply-To: ${opts.inReplyToMessageId}`, `References: ${opts.inReplyToMessageId}`]
      : []),
  ].join("\r\n");

  const rawBody = `${headers}\r\n\r\n${bodyPart}${attachmentParts.join("")}\r\n--${boundary}--`;
  const raw = Buffer.from(rawBody).toString("base64url");

  const res = await gmail.users.messages.send({
    userId: "me",
    requestBody: { raw, threadId: opts.threadId },
  });
  return { messageId: res.data.id!, threadId: res.data.threadId! };
}

export async function sendNewGmailEmail(opts: {
  to: string; subject: string; bodyHtml: string;
}): Promise<{ messageId: string; threadId: string }> {
  const gmail = await getGmailClient();
  const headers = [
    `To: ${opts.to}`, `Subject: ${opts.subject}`,
    `Content-Type: text/html; charset=utf-8`, `MIME-Version: 1.0`,
  ].join("\r\n");
  const raw = Buffer.from(`${headers}\r\n\r\n${opts.bodyHtml}`).toString("base64url");
  const res = await gmail.users.messages.send({ userId: "me", requestBody: { raw } });
  return { messageId: res.data.id!, threadId: res.data.threadId! };
}

export async function markThreadRead(threadId: string): Promise<void> {
  const gmail = await getGmailClient();
  await gmail.users.threads.modify({ userId: "me", id: threadId, requestBody: { removeLabelIds: ["UNREAD"] } });
}

export async function markThreadUnread(threadId: string): Promise<void> {
  const gmail = await getGmailClient();
  await gmail.users.threads.modify({ userId: "me", id: threadId, requestBody: { addLabelIds: ["UNREAD"] } });
}

export async function archiveThread(threadId: string): Promise<void> {
  const gmail = await getGmailClient();
  await gmail.users.threads.modify({ userId: "me", id: threadId, requestBody: { removeLabelIds: ["INBOX"] } });
}

export async function setupGmailWatch(topicName: string): Promise<{ historyId: string; expiration: string }> {
  const gmail = await getGmailClient();
  const res = await gmail.users.watch({ userId: "me", requestBody: { topicName, labelIds: ["INBOX"] } });
  return { historyId: res.data.historyId!, expiration: res.data.expiration! };
}

export async function getNewMessagesSince(startHistoryId: string): Promise<GmailMessage[]> {
  const gmail = await getGmailClient();
  try {
    const res = await gmail.users.history.list({
      userId: "me", startHistoryId, historyTypes: ["messageAdded"], labelId: "INBOX",
    });
    const history = res.data.history ?? [];
    const messageIds = new Set<string>();
    for (const h of history) {
      for (const m of h.messagesAdded ?? []) {
        if (m.message?.id) messageIds.add(m.message.id);
      }
    }
    if (messageIds.size === 0) return [];
    const messages = await Promise.all(
      Array.from(messageIds).map(async (id) => {
        try {
          const msgRes = await gmail.users.messages.get({ userId: "me", id, format: "full" });
          return parseMessage(msgRes.data);
        } catch { return null; }
      })
    );
    return messages.filter(Boolean) as GmailMessage[];
  } catch { return []; }
}

/**
 * Fetch a single attachment's raw bytes from Gmail API.
 * Returns base64url-encoded data (convert to standard base64 for data URLs).
 */
export async function getAttachmentData(
  messageId: string,
  attachmentId: string
): Promise<{ data: string; size: number }> {
  const gmail = await getGmailClient();
  const res = await gmail.users.messages.attachments.get({
    userId: "me",
    messageId,
    id: attachmentId,
  });
  // Gmail returns base64url — convert to standard base64 for data URLs
  const data = (res.data.data ?? "").replace(/-/g, "+").replace(/_/g, "/");
  const size = res.data.size ?? 0;
  return { data, size };
}

/** Return the count of unread threads in the Conversations tab (non-Thumbtack).
 * Reads from gmail_thread_meta.isUnread — zero Gmail API calls.
 * isUnread is kept authoritative by processThread (worker), markRead/markUnread mutations,
 * and the one-time backfill script (scripts/backfill-isunread.mjs).
 * COALESCE handles NULL aiCategory rows (threads not yet processed by worker). */
export async function getConversationsUnreadCount(): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const [row] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(gmailThreadMeta)
    .where(
      and(
        eq(gmailThreadMeta.isUnread, 1),
        sql`COALESCE(${gmailThreadMeta.aiCategory}, '') != 'thumbtack'`
      )
    );
  return Number(row?.count ?? 0);
}
