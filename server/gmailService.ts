/**
 * gmailService.ts — Gmail API integration for the shared inbox
 *
 * Token priority:
 *   1. GMAIL_REFRESH_TOKEN env var (set in Railway for fast startup)
 *   2. gmail_state DB row (written by the OAuth callback)
 *
 * Inbox caching architecture (world-class DB sync pattern):
 *   - gmail_thread_cache table is the single source of truth for the list view
 *   - listInboxThreads() reads from DB — zero Gmail API calls on page load
 *   - syncInboxToDb() fetches from Gmail API and writes to DB (called on startup + Pub/Sub webhook)
 *   - invalidateThreadCache() marks a single thread stale (called by all mutations)
 *   - refreshStaleThreads() re-fetches stale threads in the background (called after invalidation)
 */
import { google } from "googleapis";
import { ENV } from "./_core/env";
import { getDb } from "./db";
import { gmailState, gmailThreadCache } from "../drizzle/schema";
import { eq, desc, inArray } from "drizzle-orm";

// ── Auth helpers ─────────────────────────────────────────────────────────────

// In-memory cache so we don't hit the DB on every API call.
// Cleared when a new token is stored via the OAuth callback.
let _cachedRefreshToken: string | null = null;
let _cachedInboxEmail: string | null = null;

export function clearRefreshTokenCache() {
  _cachedRefreshToken = null;
  _cachedInboxEmail = null;
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
  clearRefreshTokenCache();
  return tokens;
}

// ── Types ─────────────────────────────────────────────────────────────────────

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

// ── Message parsing helpers ───────────────────────────────────────────────────

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

// ── DB Cache helpers ──────────────────────────────────────────────────────────

/**
 * Parse a single Gmail thread from a threads.get(format=METADATA) response
 * into a DB cache row. Only extracts list-view fields — no body, no attachments.
 */
function parseThreadMetadata(
  threadData: any,
  inboxEmail: string | null
): Omit<typeof gmailThreadCache.$inferInsert, "cachedAt" | "updatedAt"> {
  const messages = threadData.messages ?? [];
  const latestMsg = messages[messages.length - 1];
  const firstMsg = messages[0];

  // Parse headers from the latest message for snippet/date
  const latestHeaders: Record<string, string> = {};
  (latestMsg?.payload?.headers ?? []).forEach((h: any) => {
    latestHeaders[h.name.toLowerCase()] = h.value;
  });

  // Parse headers from the first message for subject
  const firstHeaders: Record<string, string> = {};
  (firstMsg?.payload?.headers ?? []).forEach((h: any) => {
    firstHeaders[h.name.toLowerCase()] = h.value;
  });

  // Determine the "other party" — the person who is NOT the inbox address
  // Walk messages in reverse to find the last message from someone else
  let fromName = "";
  let fromEmail = "";
  for (let i = messages.length - 1; i >= 0; i--) {
    const msgHeaders: Record<string, string> = {};
    (messages[i]?.payload?.headers ?? []).forEach((h: any) => {
      msgHeaders[h.name.toLowerCase()] = h.value;
    });
    const rawFrom = msgHeaders["from"] ?? "";
    const emailMatch = rawFrom.match(/<(.+?)>/) ?? rawFrom.match(/(\S+@\S+)/);
    const email = emailMatch?.[1] ?? rawFrom;
    if (!inboxEmail || email.toLowerCase() !== inboxEmail.toLowerCase()) {
      fromEmail = email;
      fromName = rawFrom.replace(/<.+?>/, "").trim() || email;
      break;
    }
  }
  // Fallback: use first message sender
  if (!fromEmail && firstMsg) {
    const rawFrom = firstHeaders["from"] ?? "";
    const emailMatch = rawFrom.match(/<(.+?)>/) ?? rawFrom.match(/(\S+@\S+)/);
    fromEmail = emailMatch?.[1] ?? rawFrom;
    fromName = rawFrom.replace(/<.+?>/, "").trim() || fromEmail;
  }

  const labelIds = latestMsg?.labelIds ?? [];
  const isUnread = messages.some((m: any) => (m.labelIds ?? []).includes("UNREAD")) ? 1 : 0;
  const receivedAt = parseInt(latestMsg?.internalDate ?? "0");
  const subject = firstHeaders["subject"] ?? "(no subject)";
  const snippet = latestMsg?.snippet ?? threadData.snippet ?? "";

  return {
    threadId: threadData.id,
    fromName,
    fromEmail,
    subject,
    snippet,
    isUnread,
    receivedAt,
    labelIds: JSON.stringify(labelIds),
    messageCount: messages.length,
    needsRefresh: 0,
  };
}

// ── Core cache operations ─────────────────────────────────────────────────────

/**
 * Mark a single thread as stale in the DB cache.
 * Called by all mutations (sendReply, markRead, markUnread, archiveThread, etc.)
 * The thread will be re-fetched from Gmail API on the next syncInboxToDb() call.
 */
export async function invalidateThreadCache(threadId: string): Promise<void> {
  try {
    const db = await getDb();
    if (!db) return;
    await db
      .update(gmailThreadCache)
      .set({ needsRefresh: 1 })
      .where(eq(gmailThreadCache.threadId, threadId));
  } catch (err) {
    console.error("[GmailCache] invalidateThreadCache error (non-fatal):", err);
  }
}

/**
 * Re-fetch all stale threads (needsRefresh=1) from Gmail API and update DB.
 * Called after mutations to keep the cache fresh without blocking the mutation response.
 * Uses sequential fetches (not Promise.all) to avoid quota bursts.
 */
export async function refreshStaleThreads(): Promise<void> {
  try {
    const db = await getDb();
    if (!db) return;
    const stale = await db
      .select({ threadId: gmailThreadCache.threadId })
      .from(gmailThreadCache)
      .where(eq(gmailThreadCache.needsRefresh, 1));
    if (stale.length === 0) return;

    const gmail = await getGmailClient();
    const inboxEmail = await getInboxEmailAddress();

    for (const { threadId } of stale) {
      try {
        const res = await gmail.users.threads.get({
          userId: "me",
          id: threadId,
          format: "metadata",
          metadataHeaders: ["From", "Subject", "Date"],
        });
        const row = parseThreadMetadata(res.data, inboxEmail);
        await db
          .insert(gmailThreadCache)
          .values(row)
          .onDuplicateKeyUpdate({ set: { ...row, needsRefresh: 0 } });
      } catch (err) {
        // Thread may have been deleted/archived — remove from cache
        console.warn(`[GmailCache] Thread ${threadId} not found in Gmail, removing from cache`);
        await db.delete(gmailThreadCache).where(eq(gmailThreadCache.threadId, threadId)).catch(() => {});
      }
    }
    console.log(`[GmailCache] Refreshed ${stale.length} stale thread(s)`);
  } catch (err) {
    console.error("[GmailCache] refreshStaleThreads error (non-fatal):", err);
  }
}

/**
 * Full inbox sync — fetches the first page of inbox threads from Gmail API
 * and writes them to the DB cache. Called on server startup and by Pub/Sub webhook.
 *
 * This is the ONLY place that calls threads.list + threads.get in bulk.
 * It fetches sequentially (not Promise.all) to stay well within quota.
 */
export async function syncInboxToDb(opts: { maxResults?: number } = {}): Promise<void> {
  try {
    const db = await getDb();
    if (!db) return;

    const gmail = await getGmailClient();
    const inboxEmail = await getInboxEmailAddress();

    // Step 1: Get the list of thread IDs from Gmail (no body data, just IDs + snippets)
    const listRes = await gmail.users.threads.list({
      userId: "me",
      maxResults: opts.maxResults ?? 50,
      q: "in:inbox",
    });
    const threadItems = listRes.data.threads ?? [];
    if (threadItems.length === 0) return;

    // Step 2: Fetch metadata for each thread sequentially
    // format=METADATA + metadataHeaders limits response to just what we need
    // Sequential to avoid "Queries per minute per user" quota
    const rows: Array<Omit<typeof gmailThreadCache.$inferInsert, "cachedAt" | "updatedAt">> = [];
    for (const item of threadItems) {
      if (!item.id) continue;
      try {
        const res = await gmail.users.threads.get({
          userId: "me",
          id: item.id,
          format: "metadata",
          metadataHeaders: ["From", "Subject", "Date"],
        });
        rows.push(parseThreadMetadata(res.data, inboxEmail));
      } catch (err) {
        console.warn(`[GmailCache] syncInboxToDb: skipping thread ${item.id}:`, err);
      }
    }

    // Step 3: Upsert all rows in one go
    if (rows.length > 0) {
      for (const row of rows) {
        await db
          .insert(gmailThreadCache)
          .values(row)
          .onDuplicateKeyUpdate({ set: { ...row, needsRefresh: 0 } });
      }
      console.log(`[GmailCache] Synced ${rows.length} threads to DB cache`);
    }
  } catch (err) {
    console.error("[GmailCache] syncInboxToDb error:", err);
  }
}

/**
 * Sync a specific set of thread IDs to the DB cache.
 * Called by the Pub/Sub webhook when new messages arrive for known threads.
 * Sequential fetches — no Promise.all.
 */
export async function syncThreadsToDb(threadIds: string[]): Promise<void> {
  if (threadIds.length === 0) return;
  try {
    const db = await getDb();
    if (!db) return;
    const gmail = await getGmailClient();
    const inboxEmail = await getInboxEmailAddress();

    for (const threadId of threadIds) {
      try {
        const res = await gmail.users.threads.get({
          userId: "me",
          id: threadId,
          format: "metadata",
          metadataHeaders: ["From", "Subject", "Date"],
        });
        const row = parseThreadMetadata(res.data, inboxEmail);
        await db
          .insert(gmailThreadCache)
          .values(row)
          .onDuplicateKeyUpdate({ set: { ...row, needsRefresh: 0 } });
      } catch (err) {
        console.warn(`[GmailCache] syncThreadsToDb: skipping thread ${threadId}:`, err);
      }
    }
  } catch (err) {
    console.error("[GmailCache] syncThreadsToDb error:", err);
  }
}

// ── listInboxThreads — THE main inbox query ───────────────────────────────────

/**
 * List inbox threads for the UI.
 *
 * WORLD-CLASS PATTERN:
 *   1. Read from DB cache — instant, zero Gmail API calls
 *   2. If DB cache is empty, trigger a background sync and return empty (client will refetch)
 *   3. If forceRefresh=true, trigger a background sync (non-blocking) and return stale data immediately
 *
 * The inbox loads instantly on every page visit after the first sync.
 */
export async function listInboxThreads(opts: {
  pageToken?: string;
  maxResults?: number;
  query?: string;
  forceRefresh?: boolean;
}): Promise<{ threads: GmailThread[]; nextPageToken?: string; fromCache: boolean }> {
  const db = await getDb();

  // ── DB cache read ────────────────────────────────────────────────────────────
  if (db && !opts.query) {
    const limit = opts.maxResults ?? 30;
    const cached = await db
      .select()
      .from(gmailThreadCache)
      .orderBy(desc(gmailThreadCache.receivedAt))
      .limit(limit);

    if (cached.length > 0) {
      // Convert DB rows to GmailThread shape (list-view only — no messages array)
      const inboxEmail = await getInboxEmailAddress();
      const threads: GmailThread[] = cached.map((row) => ({
        id: row.threadId,
        subject: row.subject,
        snippet: row.snippet,
        from: row.fromName,
        fromEmail: row.fromEmail,
        date: row.receivedAt,
        isUnread: row.isUnread === 1,
        messageCount: row.messageCount,
        messages: [], // detail view uses getThreadDetail() separately
        inboxEmail,
      }));

      // Trigger background refresh if forced or if there are stale entries
      if (opts.forceRefresh) {
        setImmediate(() => syncInboxToDb({ maxResults: 50 }).catch(console.error));
      } else {
        // Check for stale threads and refresh them in background
        const hasStale = cached.some((r) => r.needsRefresh === 1);
        if (hasStale) {
          setImmediate(() => refreshStaleThreads().catch(console.error));
        }
      }

      return { threads, fromCache: true };
    }

    // Cache is empty — trigger a sync and return empty (client will refetch via SSE)
    console.log("[GmailCache] Cache empty — triggering background sync");
    setImmediate(() => syncInboxToDb({ maxResults: 50 }).catch(console.error));
    return { threads: [], fromCache: false };
  }

  // ── Search query — always hits Gmail API directly (not cached) ───────────────
  if (opts.query) {
    const gmail = await getGmailClient();
    const listRes = await gmail.users.threads.list({
      userId: "me",
      maxResults: opts.maxResults ?? 20,
      pageToken: opts.pageToken,
      q: `in:inbox ${opts.query}`,
    });
    const threadItems = listRes.data.threads ?? [];
    const nextPageToken = listRes.data.nextPageToken ?? undefined;
    if (threadItems.length === 0) return { threads: [], nextPageToken, fromCache: false };

    const inboxEmail = await getInboxEmailAddress();
    const threads: GmailThread[] = [];
    for (const item of threadItems) {
      if (!item.id) continue;
      try {
        const res = await getGmailClient().then((g) =>
          g.users.threads.get({
            userId: "me",
            id: item.id!,
            format: "metadata",
            metadataHeaders: ["From", "Subject", "Date"],
          })
        );
        const row = parseThreadMetadata(res.data, inboxEmail);
        threads.push({
          id: row.threadId,
          subject: row.subject ?? "(no subject)",
          snippet: row.snippet ?? "",
          from: row.fromName ?? "",
          fromEmail: row.fromEmail ?? "",
          date: row.receivedAt ?? 0,
          isUnread: (row.isUnread ?? 0) === 1,
          messageCount: row.messageCount ?? 1,
          messages: [],
          inboxEmail,
        });
      } catch { /* skip */ }
    }
    return { threads, nextPageToken, fromCache: false };
  }

  // Fallback: no DB available
  return { threads: [], fromCache: false };
}

// ── getThreadDetail — full thread with all messages (detail view only) ────────

export async function getThreadDetail(threadId: string): Promise<GmailThread> {
  const gmail = await getGmailClient();
  const res = await gmail.users.threads.get({ userId: "me", id: threadId, format: "full" });
  const messages = (res.data.messages ?? []).map(parseMessage);
  const latest = messages[messages.length - 1];
  const first = messages[0];

  const inboxEmail = await getInboxEmailAddress();

  const otherParty = inboxEmail
    ? [...messages].reverse().find((m) => m.fromEmail.toLowerCase() !== inboxEmail.toLowerCase())
    : null;
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

// ── Send / modify operations ──────────────────────────────────────────────────

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

  const attachmentBuffers = await Promise.all(
    opts.attachments.map(async (att) => {
      const res = await fetch(att.url);
      if (!res.ok) throw new Error(`Failed to fetch attachment: ${att.filename}`);
      const buf = Buffer.from(await res.arrayBuffer());
      return { ...att, buf };
    })
  );

  const bodyPart =
    `--${boundary}\r\n` +
    `Content-Type: text/html; charset=utf-8\r\n` +
    `Content-Transfer-Encoding: 7bit\r\n` +
    `\r\n` +
    `${opts.bodyHtml}\r\n`;

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
    const messages: GmailMessage[] = [];
    for (const id of Array.from(messageIds)) {
      try {
        const msgRes = await gmail.users.messages.get({ userId: "me", id, format: "full" });
        messages.push(parseMessage(msgRes.data));
      } catch { /* skip */ }
    }
    return messages;
  } catch { return []; }
}

/**
 * Fetch a single attachment's raw bytes from Gmail API.
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
  const data = (res.data.data ?? "").replace(/-/g, "+").replace(/_/g, "/");
  const size = res.data.size ?? 0;
  return { data, size };
}

/** Return the count of unread threads in the Conversations tab (non-Thumbtack).
 * Uses 2 Gmail API calls total:
 *   1. labels.get("INBOX") → exact threadsUnread count for the whole inbox
 *   2. threads.list(q="is:unread from:thumbtack.com") → subtract Thumbtack unread threads
 */
export async function getConversationsUnreadCount(): Promise<number> {
  const gmail = await getGmailClient();
  const [labelRes, thumbtackRes] = await Promise.all([
    gmail.users.labels.get({ userId: "me", id: "INBOX" }),
    gmail.users.threads.list({
      userId: "me",
      maxResults: 500,
      q: "in:inbox is:unread from:thumbtack.com",
    }),
  ]);
  const totalUnread = labelRes.data.threadsUnread ?? 0;
  const thumbtackUnread = (thumbtackRes.data.threads ?? []).length;
  return Math.max(0, totalUnread - thumbtackUnread);
}
