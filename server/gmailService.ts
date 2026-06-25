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
    const _gid0 = Math.random().toString(36).slice(2, 10);
    const _gt0 = Date.now();
    console.log(`[GmailAPI] id=${_gid0} method=users.getProfile caller=getInboxEmailAddress`);
    let profile: any;
    try {
      profile = await gmail.users.getProfile({ userId: "me" });
      console.log(`[GmailAPI] id=${_gid0} SUCCESS duration=${Date.now() - _gt0}ms`);
    } catch (_ge0: any) {
      console.error(`[GmailAPI] id=${_gid0} ERROR status=${_ge0?.response?.status ?? _ge0?.code} reason=${_ge0?.response?.data?.error?.errors?.[0]?.reason ?? _ge0?.message} duration=${Date.now() - _gt0}ms`);
      throw _ge0;
    }
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

// Max simultaneous threads.get calls per listInboxThreads() invocation.
// Keeps Gmail per-user quota pressure low while keeping inbox loads fast.
// Increase to 10 if inbox feels slow; decrease to 3 if 429s persist.
const GMAIL_THREAD_FETCH_CONCURRENCY = 5;

export async function listInboxThreads(opts: {
  pageToken?: string; maxResults?: number; query?: string;
}): Promise<{ threads: GmailThread[]; nextPageToken?: string }> {
  const t0 = Date.now();
  const gmail = await getGmailClient();
  const _gid1 = Math.random().toString(36).slice(2, 10);
  const _gt1 = Date.now();
  console.log(`[GmailAPI] id=${_gid1} method=users.threads.list caller=listInboxThreads`);
  let listRes: any;
  try {
    listRes = await gmail.users.threads.list({
      userId: "me",
      maxResults: opts.maxResults ?? 30,
      pageToken: opts.pageToken,
      q: opts.query ? `in:inbox ${opts.query}` : "in:inbox",
    });
    console.log(`[GmailAPI] id=${_gid1} SUCCESS duration=${Date.now() - _gt1}ms`);
  } catch (_ge1: any) {
    console.error(`[GmailAPI] id=${_gid1} ERROR status=${_ge1?.response?.status ?? _ge1?.code} reason=${_ge1?.response?.data?.error?.errors?.[0]?.reason ?? _ge1?.message} duration=${Date.now() - _gt1}ms`);
    throw _ge1;
  }
  const threadItems = listRes.data.threads ?? [];
  const nextPageToken = listRes.data.nextPageToken ?? undefined;
  if (threadItems.length === 0) return { threads: [], nextPageToken };

  // Fetch thread details with bounded concurrency to avoid Gmail quota bursts.
  // GMAIL_THREAD_FETCH_CONCURRENCY controls max simultaneous threads.get calls.
  const results: (GmailThread | null)[] = new Array(threadItems.length).fill(null);
  for (let i = 0; i < threadItems.length; i += GMAIL_THREAD_FETCH_CONCURRENCY) {
    const batch = threadItems.slice(i, i + GMAIL_THREAD_FETCH_CONCURRENCY);
    const batchResults = await Promise.all(
      batch.map(async (t) => {
        try { return await getThreadDetail(t.id!, "listThreads"); } catch { return null; }
      })
    );
    for (let j = 0; j < batchResults.length; j++) {
      results[i + j] = batchResults[j];
    }
  }

  // Sort by latest message date descending — Gmail's list order is not purely
  // chronological and Promise.all doesn't preserve input order.
  const sorted = (results.filter(Boolean) as GmailThread[]).sort((a, b) => b.date - a.date);
  const durationMs = Date.now() - t0;
  console.log(`[Inbox] threadsReturned=${threadItems.length} threadsFetched=${sorted.length} concurrency=${GMAIL_THREAD_FETCH_CONCURRENCY} duration=${(durationMs / 1000).toFixed(1)}s`);
  return { threads: sorted, nextPageToken };
}

export async function getThreadDetail(threadId: string, parent = "unknown"): Promise<GmailThread> {
  const gmail = await getGmailClient();
  const _gid2 = Math.random().toString(36).slice(2, 10);
  const _gt2 = Date.now();
  console.log(`[GmailAPI] id=${_gid2} parent=${parent} method=users.threads.get caller=getThreadDetail threadId=${threadId}`);
  let res: any;
  try {
    res = await gmail.users.threads.get({ userId: "me", id: threadId, format: "full" });
      console.log(`[GmailAPI] id=${_gid2} parent=${parent} SUCCESS duration=${Date.now() - _gt2}ms`);
  } catch (_ge2: any) {
      console.error(`[GmailAPI] id=${_gid2} parent=${parent} ERROR status=${_ge2?.response?.status ?? _ge2?.code} reason=${_ge2?.response?.data?.error?.errors?.[0]?.reason ?? _ge2?.message} duration=${Date.now() - _gt2}ms`);
    throw _ge2;
  }
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
  const _gid3 = Math.random().toString(36).slice(2, 10);
  const _gt3 = Date.now();
  console.log(`[GmailAPI] id=${_gid3} method=users.messages.send caller=sendGmailReply`);
  let res: any;
  try {
    res = await gmail.users.messages.send({ userId: "me", requestBody: { raw, threadId: opts.threadId } });
    console.log(`[GmailAPI] id=${_gid3} SUCCESS duration=${Date.now() - _gt3}ms`);
  } catch (_ge3: any) {
    console.error(`[GmailAPI] id=${_gid3} ERROR status=${_ge3?.response?.status ?? _ge3?.code} reason=${_ge3?.response?.data?.error?.errors?.[0]?.reason ?? _ge3?.message} duration=${Date.now() - _gt3}ms`);
    throw _ge3;
  }
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

  const _gid4 = Math.random().toString(36).slice(2, 10);
  const _gt4 = Date.now();
  console.log(`[GmailAPI] id=${_gid4} method=users.messages.send caller=sendGmailReplyWithAttachments`);
  let res: any;
  try {
    res = await gmail.users.messages.send({
      userId: "me",
      requestBody: { raw, threadId: opts.threadId },
    });
    console.log(`[GmailAPI] id=${_gid4} SUCCESS duration=${Date.now() - _gt4}ms`);
  } catch (_ge4: any) {
    console.error(`[GmailAPI] id=${_gid4} ERROR status=${_ge4?.response?.status ?? _ge4?.code} reason=${_ge4?.response?.data?.error?.errors?.[0]?.reason ?? _ge4?.message} duration=${Date.now() - _gt4}ms`);
    throw _ge4;
  }
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
  const _gid5 = Math.random().toString(36).slice(2, 10);
  const _gt5 = Date.now();
  console.log(`[GmailAPI] id=${_gid5} method=users.messages.send caller=sendNewGmailEmail`);
  let res: any;
  try {
    res = await gmail.users.messages.send({ userId: "me", requestBody: { raw } });
    console.log(`[GmailAPI] id=${_gid5} SUCCESS duration=${Date.now() - _gt5}ms`);
  } catch (_ge5: any) {
    console.error(`[GmailAPI] id=${_gid5} ERROR status=${_ge5?.response?.status ?? _ge5?.code} reason=${_ge5?.response?.data?.error?.errors?.[0]?.reason ?? _ge5?.message} duration=${Date.now() - _gt5}ms`);
    throw _ge5;
  }
  return { messageId: res.data.id!, threadId: res.data.threadId! };
}

export async function markThreadRead(threadId: string): Promise<void> {
  const gmail = await getGmailClient();
  const _gid6 = Math.random().toString(36).slice(2, 10);
  const _gt6 = Date.now();
  console.log(`[GmailAPI] id=${_gid6} method=users.threads.modify caller=markThreadRead threadId=${threadId}`);
  try {
    await gmail.users.threads.modify({ userId: "me", id: threadId, requestBody: { removeLabelIds: ["UNREAD"] } });
    console.log(`[GmailAPI] id=${_gid6} SUCCESS duration=${Date.now() - _gt6}ms`);
  } catch (_ge6: any) {
    console.error(`[GmailAPI] id=${_gid6} ERROR status=${_ge6?.response?.status ?? _ge6?.code} reason=${_ge6?.response?.data?.error?.errors?.[0]?.reason ?? _ge6?.message} duration=${Date.now() - _gt6}ms`);
    throw _ge6;
  }
}

export async function markThreadUnread(threadId: string): Promise<void> {
  const gmail = await getGmailClient();
  const _gid7 = Math.random().toString(36).slice(2, 10);
  const _gt7 = Date.now();
  console.log(`[GmailAPI] id=${_gid7} method=users.threads.modify caller=markThreadUnread threadId=${threadId}`);
  try {
    await gmail.users.threads.modify({ userId: "me", id: threadId, requestBody: { addLabelIds: ["UNREAD"] } });
    console.log(`[GmailAPI] id=${_gid7} SUCCESS duration=${Date.now() - _gt7}ms`);
  } catch (_ge7: any) {
    console.error(`[GmailAPI] id=${_gid7} ERROR status=${_ge7?.response?.status ?? _ge7?.code} reason=${_ge7?.response?.data?.error?.errors?.[0]?.reason ?? _ge7?.message} duration=${Date.now() - _gt7}ms`);
    throw _ge7;
  }
}

export async function archiveThread(threadId: string): Promise<void> {
  const gmail = await getGmailClient();
  const _gid8 = Math.random().toString(36).slice(2, 10);
  const _gt8 = Date.now();
  console.log(`[GmailAPI] id=${_gid8} method=users.threads.modify caller=archiveThread threadId=${threadId}`);
  try {
    await gmail.users.threads.modify({ userId: "me", id: threadId, requestBody: { removeLabelIds: ["INBOX"] } });
    console.log(`[GmailAPI] id=${_gid8} SUCCESS duration=${Date.now() - _gt8}ms`);
  } catch (_ge8: any) {
    console.error(`[GmailAPI] id=${_gid8} ERROR status=${_ge8?.response?.status ?? _ge8?.code} reason=${_ge8?.response?.data?.error?.errors?.[0]?.reason ?? _ge8?.message} duration=${Date.now() - _gt8}ms`);
    throw _ge8;
  }
}

export async function setupGmailWatch(topicName: string): Promise<{ historyId: string; expiration: string }> {
  const gmail = await getGmailClient();
  const _gid9 = Math.random().toString(36).slice(2, 10);
  const _gt9 = Date.now();
  console.log(`[GmailAPI] id=${_gid9} method=users.watch caller=setupGmailWatch`);
  let res: any;
  try {
    res = await gmail.users.watch({ userId: "me", requestBody: { topicName, labelIds: ["INBOX"] } });
    console.log(`[GmailAPI] id=${_gid9} SUCCESS duration=${Date.now() - _gt9}ms`);
  } catch (_ge9: any) {
    console.error(`[GmailAPI] id=${_gid9} ERROR status=${_ge9?.response?.status ?? _ge9?.code} reason=${_ge9?.response?.data?.error?.errors?.[0]?.reason ?? _ge9?.message} duration=${Date.now() - _gt9}ms`);
    throw _ge9;
  }
  return { historyId: res.data.historyId!, expiration: res.data.expiration! };
}

export async function getNewMessagesSince(startHistoryId: string): Promise<GmailMessage[]> {
  const gmail = await getGmailClient();
  try {
    const _gid10 = Math.random().toString(36).slice(2, 10);
    const _gt10 = Date.now();
    console.log(`[GmailAPI] id=${_gid10} method=users.history.list caller=getNewMessagesSince`);
    let res: any;
    try {
      res = await gmail.users.history.list({
        userId: "me", startHistoryId, historyTypes: ["messageAdded"], labelId: "INBOX",
      });
      console.log(`[GmailAPI] id=${_gid10} SUCCESS duration=${Date.now() - _gt10}ms`);
    } catch (_ge10: any) {
      console.error(`[GmailAPI] id=${_gid10} ERROR status=${_ge10?.response?.status ?? _ge10?.code} reason=${_ge10?.response?.data?.error?.errors?.[0]?.reason ?? _ge10?.message} duration=${Date.now() - _gt10}ms`);
      throw _ge10;
    }
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
          const _gid11 = Math.random().toString(36).slice(2, 10);
          const _gt11 = Date.now();
          console.log(`[GmailAPI] id=${_gid11} method=users.messages.get caller=getNewMessagesSince msgId=${id}`);
          let msgRes: any;
          try {
            msgRes = await gmail.users.messages.get({ userId: "me", id, format: "full" });
            console.log(`[GmailAPI] id=${_gid11} SUCCESS duration=${Date.now() - _gt11}ms`);
          } catch (_ge11: any) {
            console.error(`[GmailAPI] id=${_gid11} ERROR status=${_ge11?.response?.status ?? _ge11?.code} reason=${_ge11?.response?.data?.error?.errors?.[0]?.reason ?? _ge11?.message} duration=${Date.now() - _gt11}ms`);
            throw _ge11;
          }
          return parseMessage(msgRes.data);
        } catch { return null; }
      })
    );
    return messages.filter(Boolean) as GmailMessage[];
  } catch { return []; }
}

export interface HistoryEvents {
  /** Full GmailMessage objects for newly added inbox messages (requires messages.get) */
  newMessages: GmailMessage[];
  /** Thread IDs where UNREAD label was removed (user read the thread) */
  markRead: Set<string>;
  /** Thread IDs where UNREAD label was added */
  markUnread: Set<string>;
  /** Thread IDs where INBOX label was removed (archived) */
  markArchived: Set<string>;
  /** Thread IDs where INBOX label was added (moved back to inbox) */
  markInboxed: Set<string>;
}

/**
 * Fetch all history events since startHistoryId.
 * Returns new messages AND label changes (UNREAD / INBOX) in one call.
 * Label changes are returned as Sets of threadIds — no threads.get needed.
 */
export async function getHistoryEvents(startHistoryId: string): Promise<HistoryEvents> {
  const empty: HistoryEvents = {
    newMessages: [],
    markRead: new Set(),
    markUnread: new Set(),
    markArchived: new Set(),
    markInboxed: new Set(),
  };

  const gmail = await getGmailClient();
  const _gid = Math.random().toString(36).slice(2, 10);
  const _gt = Date.now();
  console.log(`[GmailAPI] id=${_gid} method=users.history.list caller=getHistoryEvents startHistoryId=${startHistoryId}`);

  let res: any;
  try {
    res = await gmail.users.history.list({
      userId: "me",
      startHistoryId,
      // Request all three event types in one call
      historyTypes: ["messageAdded", "labelAdded", "labelRemoved"],
      labelId: "INBOX",
    });
    console.log(`[GmailAPI] id=${_gid} SUCCESS duration=${Date.now() - _gt}ms`);
  } catch (_ge: any) {
    console.error(`[GmailAPI] id=${_gid} ERROR status=${_ge?.response?.status ?? _ge?.code} reason=${_ge?.response?.data?.error?.errors?.[0]?.reason ?? _ge?.message} duration=${Date.now() - _gt}ms`);
    return empty;
  }

  const history = res.data.history ?? [];
  const newMessageIds = new Set<string>();
  const markRead = new Set<string>();
  const markUnread = new Set<string>();
  const markArchived = new Set<string>();
  const markInboxed = new Set<string>();

  for (const h of history) {
    // New messages added to inbox
    for (const m of h.messagesAdded ?? []) {
      if (m.message?.id) newMessageIds.add(m.message.id);
    }
    // Labels removed
    for (const m of h.labelsRemoved ?? []) {
      const labels: string[] = m.labelIds ?? [];
      const tid = m.message?.threadId;
      if (!tid) continue;
      if (labels.includes("UNREAD")) markRead.add(tid);
      if (labels.includes("INBOX")) markArchived.add(tid);
    }
    // Labels added
    for (const m of h.labelsAdded ?? []) {
      const labels: string[] = m.labelIds ?? [];
      const tid = m.message?.threadId;
      if (!tid) continue;
      if (labels.includes("UNREAD")) markUnread.add(tid);
      if (labels.includes("INBOX")) markInboxed.add(tid);
    }
  }

  // Fetch full message objects only for newly added messages
  let newMessages: GmailMessage[] = [];
  if (newMessageIds.size > 0) {
    const results = await Promise.all(
      Array.from(newMessageIds).map(async (id) => {
        try {
          const _gid2 = Math.random().toString(36).slice(2, 10);
          const _gt2 = Date.now();
          console.log(`[GmailAPI] id=${_gid2} method=users.messages.get caller=getHistoryEvents msgId=${id}`);
          let msgRes: any;
          try {
            msgRes = await gmail.users.messages.get({ userId: "me", id, format: "full" });
            console.log(`[GmailAPI] id=${_gid2} SUCCESS duration=${Date.now() - _gt2}ms`);
          } catch (_ge2: any) {
            console.error(`[GmailAPI] id=${_gid2} ERROR status=${_ge2?.response?.status ?? _ge2?.code} reason=${_ge2?.response?.data?.error?.errors?.[0]?.reason ?? _ge2?.message} duration=${Date.now() - _gt2}ms`);
            throw _ge2;
          }
          return parseMessage(msgRes.data);
        } catch { return null; }
      })
    );
    newMessages = results.filter(Boolean) as GmailMessage[];
  }

  return { newMessages, markRead, markUnread, markArchived, markInboxed };
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
  const _gid12 = Math.random().toString(36).slice(2, 10);
  const _gt12 = Date.now();
  console.log(`[GmailAPI] id=${_gid12} method=users.messages.attachments.get caller=getAttachmentData msgId=${messageId} attachmentId=${attachmentId}`);
  let res: any;
  try {
    res = await gmail.users.messages.attachments.get({
      userId: "me",
      messageId,
      id: attachmentId,
    });
    console.log(`[GmailAPI] id=${_gid12} SUCCESS duration=${Date.now() - _gt12}ms`);
  } catch (_ge12: any) {
    console.error(`[GmailAPI] id=${_gid12} ERROR status=${_ge12?.response?.status ?? _ge12?.code} reason=${_ge12?.response?.data?.error?.errors?.[0]?.reason ?? _ge12?.message} duration=${Date.now() - _gt12}ms`);
    throw _ge12;
  }
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
        eq(gmailThreadMeta.isInInbox, 1),
        eq(gmailThreadMeta.isActionable, 1)
      )
    );
  return Number(row?.count ?? 0);
}
