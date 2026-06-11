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

export function enqueueThread(threadId: string) {
  _queue.add(threadId);
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
    const res = await gmail.users.threads.get({ userId: "me", id: threadId, format: "full" });
    const currentHistoryId = String(res.data.historyId ?? "");
    const messages = res.data.messages ?? [];

    // Check cache — skip if historyId unchanged
    const [existing] = await db
      .select({ aiHistoryId: gmailThreadMeta.aiHistoryId, aiCategory: gmailThreadMeta.aiCategory })
      .from(gmailThreadMeta)
      .where(eq(gmailThreadMeta.threadId, threadId));

    if (existing?.aiHistoryId && existing.aiHistoryId === currentHistoryId) {
      // Cache hit — nothing changed
      return;
    }

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

    const subject = (() => {
      const first = messages[0];
      const headers: Record<string, string> = {};
      (first?.payload?.headers ?? []).forEach((h: any) => { headers[h.name.toLowerCase()] = h.value; });
      return headers["subject"] ?? "(no subject)";
    })();

    // Single LLM call — category + summary + urgency
    const result = await invokeLLM({
      messages: [
        {
          role: "system",
          content: `You are a customer service manager for a residential cleaning business (Maid in Black).
Classify this email thread and summarize it.

Categories (pick exactly one):
- refund_request: customer asking for refund, credit, or compensation
- quote_request: customer asking for a price quote or estimate
- booking_confirmation: confirming, scheduling, or rescheduling a cleaning appointment
- recurring_cancellation: any cancellation of a recurring/subscription cleaning plan — including system-generated notifications from booking software that say "This Booking and all Future Bookings" or "Cancellation Type: This Booking and all Future Bookings". If the cancellation type mentions future bookings, always use this category.
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

    // Upsert into gmail_thread_meta — purely additive, never overwrites isIssue/assignment
    await db
      .insert(gmailThreadMeta)
      .values({
        threadId,
        isIssue: 0,
        aiCategory: category,
        aiSummary: summary,
        aiUrgency: urgency,
        aiHistoryId: currentHistoryId,
        aiProcessedAt: new Date(),
      })
      .onDuplicateKeyUpdate({
        set: {
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
  setInterval(async () => {
    if (_queue.size === 0) return;
    const threadId = _queue.values().next().value as string;
    _queue.delete(threadId);
    await processThread(threadId);
  }, 600);
}

export function startGlanceWorker() {
  if (_workerStarted) return;
  _workerStarted = true;
  startWorkerLoop();
  console.log("[GlanceWorker] Background worker started (600ms interval)");
}

// ── Backfill: enqueue last 100 inbox threads that haven't been processed ──────
export async function backfillGlanceQueue(): Promise<void> {
  try {
    const gmail = await getGmailClient();
    const db = await getDb();
    if (!db) return;

    // Fetch last 100 non-Thumbtack inbox threads (list only — no full fetch)
    const listRes = await gmail.users.threads.list({
      userId: "me",
      maxResults: 100,
      q: "in:inbox -from:thumbtack.com",
    });
    const threadItems = listRes.data.threads ?? [];
    if (threadItems.length === 0) return;

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
        enqueueThread(id);
        enqueued++;
      }
    }

    console.log(`[GlanceWorker] Backfill: ${enqueued} threads enqueued (${threadIds.length - enqueued} already processed)`);
  } catch (err) {
    console.error("[GlanceWorker] Backfill error:", err);
  }
}
