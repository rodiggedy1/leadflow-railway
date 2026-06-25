/**
 * gmailGlanceWorker.ts
 *
 * Background AI worker for the "Today at a Glance" email triage panel.
 *
 * Responsibilities:
 *   1. processThread(threadId) — runs a single LLM call to classify + summarize a thread,
 *      stores results in gmail_thread_meta, skips if aiHistoryId matches current historyId.
 *   2. enqueueThread(threadId) — adds a thread to the in-memory queue (deduped).
 *   3. startGlanceWorker() — starts the background interval loop (600ms between items).
 *   4. backfillGlanceQueue() — fetches last 100 inbox threads and enqueues unprocessed ones.
 *
 * Cost controls:
 *   - Cache invalidation keyed on Gmail historyId — never re-runs if nothing changed.
 *   - Only last 3 messages sent to LLM (not full thread).
 *   - Single LLM call per thread produces category + summary + urgency.
 *   - 600ms spacing between calls — ~100 threads processed in ~60s.
 *
 * ZERO impact on existing inbox, SMS, or webhook flows.
 */

import { getDb } from "./db";
import { gmailThreadMeta } from "../drizzle/schema";
import { eq } from "drizzle-orm";
import { invokeLLM } from "./_core/llm";
import { ENV } from "./_core/env";
import { google } from "googleapis";
import { gmailState } from "../drizzle/schema";

// ── Category definitions ──────────────────────────────────────────────────────
export type GlanceCategory =
  | "refund_request"
  | "quote_request"
  | "booking_confirmation"
  | "recurring_cancellation"
  | "payroll_issue"
  | "upset_customer"
  | "revenue_opportunity"
  | "general";

export const GLANCE_CATEGORY_META: Record<GlanceCategory, { label: string; emoji: string; color: string }> = {
  refund_request:        { label: "Waiting for refund",      emoji: "🔴", color: "text-red-600" },
  quote_request:         { label: "Quote requests",          emoji: "🟠", color: "text-orange-500" },
  booking_confirmation:  { label: "Booking confirmations",   emoji: "🟢", color: "text-green-600" },
  recurring_cancellation: { label: "Recurring cancellations", emoji: "🚫", color: "text-rose-600" },
  payroll_issue:         { label: "Payroll issue",           emoji: "⚠️",  color: "text-yellow-600" },
  upset_customer:        { label: "Upset customers",         emoji: "☕", color: "text-amber-700" },
  revenue_opportunity:   { label: "Revenue opportunity",     emoji: "📈", color: "text-blue-600" },
  general:               { label: "General",                 emoji: "📧", color: "text-slate-500" },
};

// ── In-memory queue (deduped by threadId) ─────────────────────────────────────
const _queue = new Set<string>();
let _workerStarted = false;

// ── Backfill cooldown ─────────────────────────────────────────────────────────
// If threads.list gets a 429, persist a cooldown timestamp in gmail_state so
// it survives server restarts and Railway redeploys. Backfill is skipped until
// Date.now() exceeds gmailBackfillCooldownUntil. Does NOT affect Pub/Sub or
// manual inbox actions — only the automatic startup backfill.
const BACKFILL_DEFAULT_COOLDOWN_MS = 6 * 60 * 60 * 1000; // 6 hours fallback if no Retry-After

// ── Instrumentation counters (reset every 60s) ────────────────────────────────
let _threadsGetCount = 0;        // gmail.users.threads.get calls
let _threadsListCount = 0;       // gmail.users.threads.list calls (backfill)
let _count429 = 0;               // 429 responses from Gmail API
let _cacheHitCount = 0;          // processThread: historyId matched, skipped
let _cacheMissCount = 0;         // processThread: historyId changed, processed
let _enqueueTotal = 0;           // total enqueueThread calls (all sources)
let _enqueueDuplicates = 0;      // calls where threadId was already in queue
let _enqueueFromPubSub = 0;      // enqueues from Pub/Sub webhook
let _enqueueFromBackfill = 0;    // enqueues from backfillGlanceQueue
let _enqueueFromManual = 0;      // enqueues from manual/other callers
let _uniqueThreadsProcessed = new Set<string>(); // unique threadIds that hit threads.get
let _queueSizeAtWindowStart = 0; // queue size when the window opened
let _maxQueueSizeInWindow = 0;   // peak queue size seen during the window
let _minuteWindowStart = Date.now();

function _snapshotQueueMax() {
  if (_queue.size > _maxQueueSizeInWindow) _maxQueueSizeInWindow = _queue.size;
}

function _logMinuteSummary() {
  const elapsed = ((Date.now() - _minuteWindowStart) / 1000).toFixed(1);
  const quotaUsage = _threadsGetCount + _threadsListCount;
  console.log(
    `[GlanceWorker][Metrics] window=${elapsed}s | quotaUsage=${quotaUsage} (threads.get=${_threadsGetCount} threads.list=${_threadsListCount} labels.get=0) | 429s=${_count429} | cacheHit=${_cacheHitCount} | cacheMiss=${_cacheMissCount} | enqueued=${_enqueueTotal} | duplicates=${_enqueueDuplicates} | fromPubSub=${_enqueueFromPubSub} | fromBackfill=${_enqueueFromBackfill} | fromManual=${_enqueueFromManual} | uniqueThreads=${_uniqueThreadsProcessed.size} | queueStart=${_queueSizeAtWindowStart} | queueEnd=${_queue.size} | maxQueue=${_maxQueueSizeInWindow}`
  );
  // Reset all counters
  _threadsGetCount = 0;
  _threadsListCount = 0;
  _count429 = 0;
  _cacheHitCount = 0;
  _cacheMissCount = 0;
  _enqueueTotal = 0;
  _enqueueDuplicates = 0;
  _enqueueFromPubSub = 0;
  _enqueueFromBackfill = 0;
  _enqueueFromManual = 0;
  _uniqueThreadsProcessed = new Set<string>();
  _queueSizeAtWindowStart = _queue.size;
  _maxQueueSizeInWindow = _queue.size;
  _minuteWindowStart = Date.now();
}

// ── Enqueue with source tagging ───────────────────────────────────────────────
export type EnqueueSource = "pubsub" | "backfill" | "manual";

// Track which threadId is currently being processed by the worker loop
let _currentlyProcessing: string | null = null;

export function enqueueThread(threadId: string, source: EnqueueSource = "manual") {
  _enqueueTotal++;
  if (source === "pubsub") _enqueueFromPubSub++;
  else if (source === "backfill") _enqueueFromBackfill++;
  else _enqueueFromManual++;

  // Determine skip reason before mutating the set
  if (_currentlyProcessing === threadId) {
    _enqueueDuplicates++;
    console.log(`[GlanceWorker][Enqueue][SKIP_ALREADY_PROCESSING] source=${source} threadId=${threadId} queueSize=${_queue.size}`);
    return;
  }

  const sizeBefore = _queue.size;
  _queue.add(threadId);
  _snapshotQueueMax();

  if (_queue.size === sizeBefore) {
    // Duplicate — Set.add was a no-op (already in queue)
    _enqueueDuplicates++;
    console.log(`[GlanceWorker][Enqueue][SKIP_ALREADY_QUEUED] source=${source} threadId=${threadId} queueSize=${_queue.size}`);
  } else {
    console.log(`[GlanceWorker][Enqueue][${source.toUpperCase()}] threadId=${threadId} queueSize=${_queue.size}`);
  }
}

// ── Gmail client (mirrors gmailService pattern without importing it) ──────────
async function getGmailClient() {
  const oauth2Client = new google.auth.OAuth2(
    ENV.gmailClientId,
    ENV.gmailClientSecret,
    ENV.gmailRedirectUri
  );
  // Try env var first, then DB
  let token = ENV.gmailRefreshToken ?? null;
  if (!token) {
    try {
      const db = await getDb();
      if (db) {
        const [state] = await db.select().from(gmailState).where(eq(gmailState.id, 1));
        token = state?.refreshToken ?? null;
      }
    } catch { /* DB not ready */ }
  }
  if (token) oauth2Client.setCredentials({ refresh_token: token });
  return google.gmail({ version: "v1", auth: oauth2Client });
}

// ── Core: process a single thread ─────────────────────────────────────────────
export async function processThread(threadId: string): Promise<void> {
  try {
    const db = await getDb();
    if (!db) return;

    const gmail = await getGmailClient();

    // Fetch thread from Gmail — minimal format to get historyId + messages
    _threadsGetCount++;
    _uniqueThreadsProcessed.add(threadId);
    _currentlyProcessing = threadId;
    const t0 = Date.now();
    console.log(`[GlanceWorker][API] threads.get threadId=${threadId} queueSize=${_queue.size}`);

    let res: Awaited<ReturnType<typeof gmail.users.threads.get>>;
    try {
      res = await gmail.users.threads.get({ userId: "me", id: threadId, format: "full" });
    } catch (apiErr: any) {
      _currentlyProcessing = null;
      const status = apiErr?.response?.status ?? apiErr?.code;
      const durationMs = Date.now() - t0;
      if (status === 429) {
        _count429++;
        // ── Full 429 diagnostic dump ──────────────────────────────────────────
        // Google error body: contains domain, reason, message for each error
        const errorBody = apiErr?.response?.data ?? null;
        const googleErrors = errorBody?.error?.errors ?? [];
        const googleStatus = errorBody?.error?.status ?? "(none)";
        const googleMessage = errorBody?.error?.message ?? apiErr?.message ?? "(none)";
        // All response headers — includes Retry-After, X-RateLimit-*, X-Quota-*
        const responseHeaders = apiErr?.response?.headers ?? {};
        const retryAfter = responseHeaders["retry-after"] ?? responseHeaders["x-ratelimit-reset"] ?? "(none)";
        console.error(`[GlanceWorker][429][threads.get] threadId=${threadId} duration=${durationMs}ms`);
        console.error(`[GlanceWorker][429][threads.get] HTTP status=${status} google.status=${googleStatus}`);
        console.error(`[GlanceWorker][429][threads.get] google.message=${googleMessage}`);
        console.error(`[GlanceWorker][429][threads.get] retry-after=${retryAfter}`);
        console.error(`[GlanceWorker][429][threads.get] google.errors=${JSON.stringify(googleErrors)}`);
        console.error(`[GlanceWorker][429][threads.get] response.headers=${JSON.stringify(responseHeaders)}`);
        console.error(`[GlanceWorker][429][threads.get] full.error.body=${JSON.stringify(errorBody)}`);
      } else {
        console.error(`[GlanceWorker][APIError] threads.get threadId=${threadId} status=${status} duration=${durationMs}ms`, apiErr?.message);
      }
      return;
    }

    _currentlyProcessing = null;
    const durationMs = Date.now() - t0;
    console.log(`[GlanceWorker][API] threads.get OK threadId=${threadId} duration=${durationMs}ms`);

    const currentHistoryId = String(res.data.historyId ?? "");
    const messages = res.data.messages ?? [];

    // Check cache — skip if historyId unchanged
    const [existing] = await db
      .select({ aiHistoryId: gmailThreadMeta.aiHistoryId, aiCategory: gmailThreadMeta.aiCategory })
      .from(gmailThreadMeta)
      .where(eq(gmailThreadMeta.threadId, threadId));

    if (existing?.aiHistoryId && existing.aiHistoryId === currentHistoryId) {
      // Cache hit — nothing changed; log as SKIP_ALREADY_UP_TO_DATE
      _cacheHitCount++;
      console.log(`[GlanceWorker][SKIP_ALREADY_UP_TO_DATE] threadId=${threadId} historyId=${currentHistoryId}`);
      return;
    }

    _cacheMissCount++;
    console.log(`[GlanceWorker][CacheMiss] threadId=${threadId} oldHistoryId=${existing?.aiHistoryId ?? "none"} newHistoryId=${currentHistoryId}`);

    // Extract last 3 messages for LLM (cost control)
    const lastMsgs = messages.slice(-3);
    const transcript = lastMsgs.map((msg) => {
      const headers: Record<string, string> = {};
      (msg.payload?.headers ?? []).forEach((h: any) => { headers[h.name.toLowerCase()] = h.value; });
      const from = headers["from"] ?? "Unknown";
      const bodyData = findTextBody(msg.payload);
      const text = bodyData.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 400);
      return `From: ${from}\n${text}`;
    }).join("\n\n---\n\n");

    // ── Extract inbox display fields from thread data ─────────────────────────
    // These are written to DB so listThreads can read from DB with zero Gmail calls.
    const subject = (() => {
      const first = messages[0];
      const headers: Record<string, string> = {};
      (first?.payload?.headers ?? []).forEach((h: any) => { headers[h.name.toLowerCase()] = h.value; });
      return headers["subject"] ?? "(no subject)";
    })();

    // snippet: latest message's snippet (Gmail's pre-computed preview)
    const latestMsg = messages[messages.length - 1];
    const snippet = latestMsg?.snippet ?? "";

    // lastMessageAt: internalDate of the latest message (Unix ms)
    const lastMessageAt = parseInt(latestMsg?.internalDate ?? "0") || 0;

    // messageCount: total messages in thread
    const messageCount = messages.length;

    // senderName / senderEmail: the OTHER party (not the inbox)
    // We don't have the inbox email in the worker, so we use a heuristic:
    // find the last message whose From header doesn't look like a sent-by-us address.
    // The worker stores both so the router can display the correct contact.
    // We parse all From headers and pick the last non-empty one from a non-noreply address.
    const allFromHeaders: Array<{ name: string; email: string }> = messages.map((msg: any) => {
      const hdrs: Record<string, string> = {};
      (msg.payload?.headers ?? []).forEach((h: any) => { hdrs[h.name.toLowerCase()] = h.value; });
      const raw = hdrs["from"] ?? "";
      const emailMatch = raw.match(/<(.+?)>/) ?? raw.match(/(\S+@\S+)/);
      const email = emailMatch?.[1] ?? raw;
      const name = raw.replace(/<.+?>/, "").trim() || email;
      return { name, email };
    });
    // Pick the last message from a non-inbox-looking sender as the display contact.
    // If we can't determine, fall back to the first message's From.
    const displayContact = [...allFromHeaders].reverse().find(
      (f) => f.email && !f.email.toLowerCase().includes("noreply") && !f.email.toLowerCase().includes("no-reply")
    ) ?? allFromHeaders[0] ?? { name: "", email: "" };
    const senderName = displayContact.name;
    const senderEmail = displayContact.email;

    // Single LLM call — category + summary + urgency
    const result = await invokeLLM({
      messages: [
        {
          role: "system",
          content: `You are a customer service manager for a residential cleaning business (Maid in Black).
Classify this email thread and summarize it.

OVERRIDE RULE (highest priority, check this first):
If the email body contains the exact text "Cancellation Type: This Booking and all Future Bookings" — you MUST classify it as "recurring_cancellation" regardless of anything else in the email. This is a system notification that a recurring cleaning subscription has been cancelled.

Categories (pick exactly one):
- recurring_cancellation: PRIORITY — use this if the email contains "Cancellation Type: This Booking and all Future Bookings" OR if a customer is cancelling their recurring/subscription cleaning plan
- refund_request: customer asking for refund, credit, or compensation
- quote_request: customer asking for a price quote or estimate
- booking_confirmation: confirming, scheduling, or rescheduling a SINGLE appointment (only use this if there is NO cancellation of future bookings)
- payroll_issue: cleaner or staff pay, hours, or compensation issue
- upset_customer: complaint, dissatisfied customer, negative feedback
- revenue_opportunity: upsell, add-on service, referral, or new revenue potential
- general: anything else

Return ONLY valid JSON. No markdown, no explanation.`,
        },
        {
          role: "user",
          content: `Subject: ${subject}\n\n${transcript}`,
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "thread_classification",
          strict: true,
          schema: {
            type: "object",
            properties: {
              category: {
                type: "string",
                enum: ["refund_request", "quote_request", "booking_confirmation", "recurring_cancellation", "payroll_issue", "upset_customer", "revenue_opportunity", "general"],
              },
              summary: {
                type: "array",
                items: { type: "string" },
                description: "3-6 bullet points of key facts about this thread",
              },
              urgency: {
                type: "string",
                enum: ["high", "medium", "low"],
              },
            },
            required: ["category", "summary", "urgency"],
            additionalProperties: false,
          },
        },
      },
    });

    const raw = result.choices[0]?.message?.content as string ?? "{}";
    let parsed: { category: GlanceCategory; summary: string[]; urgency: string };
    try {
      parsed = JSON.parse(raw);
    } catch {
      console.error(`[GlanceWorker] Failed to parse LLM response for ${threadId}:`, raw);
      return;
    }

    const category = parsed.category as GlanceCategory;
    const summary = JSON.stringify(parsed.summary ?? []);
    const urgency = parsed.urgency ?? "medium";

    // Compute isUnread from Gmail labels — authoritative, always overwrites
    const isUnread = messages.some((m) =>
      (m.labelIds ?? []).includes("UNREAD")
    ) ? 1 : 0;

    // Upsert into gmail_thread_meta — purely additive, never overwrites isIssue/assignment.
    // Inbox display fields (senderName, subject, snippet, lastMessageAt, messageCount) are
    // written here so listThreads can serve the inbox entirely from DB with zero Gmail calls.
    await db
      .insert(gmailThreadMeta)
      .values({
        threadId,
        isIssue: 0,
        isUnread,
        isInInbox: 1,
        senderName,
        senderEmail,
        subject,
        snippet,
        lastMessageAt,
        messageCount,
        aiCategory: category,
        aiSummary: summary,
        aiUrgency: urgency,
        aiHistoryId: currentHistoryId,
        aiProcessedAt: new Date(),
      })
      .onDuplicateKeyUpdate({
        set: {
          isUnread,
          // isInInbox: intentionally NOT updated here — archiveThread sets it to 0.
          // Worker only sets it to 1 on insert (new thread). Existing rows keep their value.
          senderName,
          senderEmail,
          subject,
          snippet,
          lastMessageAt,
          messageCount,
          aiCategory: category,
          aiSummary: summary,
          aiUrgency: urgency,
          aiHistoryId: currentHistoryId,
          aiProcessedAt: new Date(),
          updatedAt: new Date(),
        },
      });

    console.log(`[GlanceWorker] Processed ${threadId} → ${category} (${urgency})`);
  } catch (err) {
    // Never let errors bubble — purely additive
    console.error(`[GlanceWorker] Error processing ${threadId}:`, err);
  }
}

// ── Helper: extract plain text from Gmail message payload ─────────────────────
function findTextBody(payload: any): string {
  if (!payload) return "";
  if (payload.mimeType === "text/plain" && payload.body?.data) {
    return Buffer.from(payload.body.data.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf-8");
  }
  if (payload.mimeType === "text/html" && payload.body?.data) {
    return Buffer.from(payload.body.data.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf-8");
  }
  for (const part of payload.parts ?? []) {
    const found = findTextBody(part);
    if (found) return found;
  }
  return "";
}

// ── Worker loop ───────────────────────────────────────────────────────────────
function startWorkerLoop() {
  // Snapshot queue size at window start
  _queueSizeAtWindowStart = _queue.size;
  _maxQueueSizeInWindow = _queue.size;

  // Per-minute metrics summary
  setInterval(() => { _logMinuteSummary(); }, 60_000);

  setInterval(async () => {
    if (_queue.size === 0) return;
    _snapshotQueueMax();
    const threadId = _queue.values().next().value as string;
    _queue.delete(threadId);
    _currentlyProcessing = threadId;
    await processThread(threadId);
    _currentlyProcessing = null;
  }, 600);
}

export function startGlanceWorker() {
  if (_workerStarted) return;
  _workerStarted = true;
  startWorkerLoop();
  console.log("[GlanceWorker] Background worker started (600ms interval)");
}

// ── Backfill: enqueue last 100 inbox threads that haven't been processed ──────
export async function clearBackfillCooldown(): Promise<void> {
  try {
    const db = await getDb();
    if (!db) return;
    await db.update(gmailState).set({ gmailBackfillCooldownUntil: 0 }).where(eq(gmailState.id, 1));
    console.log("[GlanceWorker] Backfill cooldown cleared on startup.");
  } catch (e) {
    console.error("[GlanceWorker] Failed to clear backfill cooldown:", e);
  }
}

export async function backfillGlanceQueue(): Promise<void> {
  try {
    const db = await getDb();
    if (!db) return;

    // Read persistent cooldown from DB — survives redeploys
    const [stateRow] = await db.select({ gmailBackfillCooldownUntil: gmailState.gmailBackfillCooldownUntil }).from(gmailState).where(eq(gmailState.id, 1));
    const cooldownUntil = stateRow?.gmailBackfillCooldownUntil ?? 0;
    if (Date.now() < cooldownUntil) {
      const remainingMin = Math.ceil((cooldownUntil - Date.now()) / 60_000);
      console.log(`[GlanceWorker] Backfill skipped — cooldown active (${remainingMin}m remaining, last threads.list got 429)`);
      return;
    }

    const gmail = await getGmailClient();

    // Fetch last 100 non-Thumbtack inbox threads (list only — no full fetch)
    _threadsListCount++;
    const t0 = Date.now();
    console.log(`[GlanceWorker][API] threads.list (backfill start)`);

    let listRes: Awaited<ReturnType<typeof gmail.users.threads.list>>;
    try {
      listRes = await gmail.users.threads.list({
        userId: "me",
        maxResults: 100,
        q: "in:inbox -from:thumbtack.com",
      });
    } catch (apiErr: any) {
      const status = apiErr?.response?.status ?? apiErr?.code;
      const durationMs = Date.now() - t0;
      if (status === 429) {
        _count429++;
        // ── Full 429 diagnostic dump ──────────────────────────────────────────
        // Google error body: contains domain, reason, message for each error
        const errorBody = apiErr?.response?.data ?? null;
        const googleErrors = errorBody?.error?.errors ?? [];
        const googleStatus = errorBody?.error?.status ?? "(none)";
        const googleMessage = errorBody?.error?.message ?? apiErr?.message ?? "(none)";
        // All response headers — includes Retry-After, X-RateLimit-*, X-Quota-*
        const responseHeaders = apiErr?.response?.headers ?? {};
        const rawRetryAfter = responseHeaders["retry-after"] ?? responseHeaders["x-ratelimit-reset"] ?? null;
        // Use Google's Retry-After header if present (seconds); otherwise default to 6 hours
        const cooldownMs = rawRetryAfter
          ? parseInt(String(rawRetryAfter), 10) * 1000
          : BACKFILL_DEFAULT_COOLDOWN_MS;
        const newCooldownUntil = Date.now() + cooldownMs;
        const cooldownUntilStr = new Date(newCooldownUntil).toISOString();
        // Persist to DB so the cooldown survives Railway redeploys
        db.update(gmailState)
          .set({ gmailBackfillCooldownUntil: newCooldownUntil })
          .where(eq(gmailState.id, 1))
          .catch((e) => console.error("[GlanceWorker] Failed to persist backfill cooldown:", e));
        console.error(`[GlanceWorker][429][threads.list] duration=${durationMs}ms — backfill cooldown persisted until ${cooldownUntilStr}`);
        console.error(`[GlanceWorker][429][threads.list] HTTP status=${status} google.status=${googleStatus}`);
        console.error(`[GlanceWorker][429][threads.list] google.message=${googleMessage}`);
        console.error(`[GlanceWorker][429][threads.list] retry-after=${rawRetryAfter ?? "(none)"}`);
        console.error(`[GlanceWorker][429][threads.list] google.errors=${JSON.stringify(googleErrors)}`);
        console.error(`[GlanceWorker][429][threads.list] response.headers=${JSON.stringify(responseHeaders)}`);
        console.error(`[GlanceWorker][429][threads.list] full.error.body=${JSON.stringify(errorBody)}`);
      } else {
        console.error(`[GlanceWorker][APIError] threads.list status=${status} duration=${durationMs}ms`, apiErr?.message);
      }
      return;
    }

    const durationMs = Date.now() - t0;
    const threadItems = listRes.data.threads ?? [];
    console.log(`[GlanceWorker][API] threads.list OK count=${threadItems.length} duration=${durationMs}ms`);

    if (threadItems.length === 0) {
      console.log(`[GlanceWorker] Backfill: 0 threads returned from Gmail`);
      return;
    }

    const threadIds = threadItems.map((t) => t.id!).filter(Boolean);

    // Find which ones are already processed (have aiHistoryId)
    const existingRows = await db
      .select({ threadId: gmailThreadMeta.threadId, aiHistoryId: gmailThreadMeta.aiHistoryId })
      .from(gmailThreadMeta);

    const processedIds = existingRows.filter((r) => r.aiHistoryId).map((r) => r.threadId);
    const processedSet = new Set<string>(processedIds);

    let enqueued = 0;
    for (const id of threadIds) {
      if (!processedSet.has(id)) {
        enqueueThread(id, "backfill");
        enqueued++;
      }
    }

    console.log(`[GlanceWorker] Backfill: ${enqueued} threads enqueued (${threadIds.length - enqueued} already processed) totalInbox=${threadIds.length} totalInDB=${existingRows.length} processedInDB=${processedSet.size}`);
  } catch (err) {
    console.error("[GlanceWorker] Backfill error:", err);
  }
}
