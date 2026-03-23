/**
 * Follow-Up Cron Handlers
 *
 * Two cron jobs:
 *
 * 1. POST /api/cron/silence-followup  — runs every 5 minutes
 *    Finds sessions where the AI sent a message 5+ minutes ago, the lead hasn't replied,
 *    the conversation is still active, and no auto follow-up has been sent yet.
 *    Sends a contextual nudge: "Hey {name}, just circling back. Can we help set this up for you?"
 *
 * 2. POST /api/cron/scheduled-followup  — runs daily at 9 AM ET
 *    Finds sessions with followUpDate = today (ET) and followUpSent = 0.
 *    Sends the editable circle-back message and moves the session back to AVAILABILITY.
 */

import type { Express, Request, Response } from "express";
import { and, eq, isNotNull, lte, ne, or, sql } from "drizzle-orm";
import { getDb } from "./db";
import { conversationSessions } from "../drizzle/schema";
import { sendSms } from "./openphone";
import { invokeLLM } from "./_core/llm";
import { logActivity } from "./activityLogger";

// Stages that are considered "active" — the lead is mid-conversation and hasn't finished.
// REACTIVATION is intentionally excluded: those are first-touch always-on/campaign messages
// that haven't received a reply yet. We don't want to double-nudge someone who just got
// their first outbound SMS and hasn't had a chance to respond.
const ACTIVE_STAGES = [
  "QUOTE_SENT",
  "AVAILABILITY",
  "SLOT_CHOICE",
  "TIME_PREF",
  "ADDRESS",
  "CONFIRMATION",
  "WIDGET_SIZING",
];

// Maximum number of automated silence nudges before a lead is moved to COLD.
// After this many nudges with no customer reply, all automated follow-ups stop.
const MAX_NUDGES_BEFORE_COLD = 2;

const DEFAULT_CIRCLE_BACK_MESSAGE =
  "Hi, just circling back on this. We have some availability and would love to get you scheduled!";

// ─── 5-Minute Silence Follow-Up ──────────────────────────────────────────────

export async function runSilenceFollowUp(): Promise<{
  checked: number;
  sent: number;
  errors: number;
}> {
  const db = await getDb();
  if (!db) return { checked: 0, sent: 0, errors: 0 };

  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);

  // Find sessions that:
  // - Are in an active stage
  // - Either: AI sent a message 5+ minutes ago (normal flow)
  //   OR: lastAiMessageAt is NULL but createdAt is 5+ minutes ago (lead never replied to SMS 1)
  // - Have NOT had an auto follow-up sent yet
  // - Are in AI mode (aiMode = 1)
  const allSessions = await db
    .select()
    .from(conversationSessions)
    .where(
      and(
        // Active stage only
        or(
          ...ACTIVE_STAGES.map((s) => eq(conversationSessions.stage, s as any))
        ),
        // 5+ minutes of silence: either AI replied 5+ min ago, OR never replied (use createdAt)
        or(
          and(
            isNotNull(conversationSessions.lastAiMessageAt),
            lte(conversationSessions.lastAiMessageAt, fiveMinutesAgo)
          ),
          and(
            sql`${conversationSessions.lastAiMessageAt} IS NULL`,
            lte(conversationSessions.createdAt, fiveMinutesAgo)
          )
        ),
        // No auto follow-up sent yet
        eq(conversationSessions.autoFollowUpSent, 0),
        // AI mode is on
        eq(conversationSessions.aiMode, 1)
      )
    )
    .limit(50); // Safety cap — process at most 50 per run

  // Deduplicate by phone: only nudge the most recent active session per phone number.
  // A lead may have multiple sessions (e.g. re-submitted the form) — we only want
  // to send one nudge to the most recent one, not one per session.
  const seenPhones = new Set<string>();
  const sorted = allSessions.sort((a, b) => b.id - a.id); // most recent first
  const sessions = sorted.filter((s) => {
    if (seenPhones.has(s.leadPhone)) return false;
    seenPhones.add(s.leadPhone);
    return true;
  });

  // Silence older stale sessions for the same phone so they don't keep appearing
  // in the query on every cron tick. Mark them as already nudged.
  const selectedIds = new Set(sessions.map((s) => s.id));
  const staleIds = sorted.filter((s) => !selectedIds.has(s.id)).map((s) => s.id);
  if (staleIds.length > 0) {
    for (const staleId of staleIds) {
      await db
        .update(conversationSessions)
        .set({ autoFollowUpSent: 1 })
        .where(eq(conversationSessions.id, staleId));
    }
    console.log(`[SilenceFollowUp] Silenced ${staleIds.length} stale older session(s) for deduplication.`);
  }

  let sent = 0;
  let errors = 0;

  for (const session of sessions) {
    try {
      // ── Atomic claim: mark autoFollowUpSent=1 BEFORE sending ──────────────────────────────────────────
      // This prevents race conditions when multiple cron instances run simultaneously
      // (e.g. after multiple server restarts in dev). Only the instance that wins the
      // UPDATE (affected rows = 1) will proceed to send the SMS.
      const claimResult = await db
        .update(conversationSessions)
        .set({ autoFollowUpSent: 1 })
        .where(
          and(
            eq(conversationSessions.id, session.id),
            eq(conversationSessions.autoFollowUpSent, 0)  // only claim if not already claimed
          )
        );
      const claimed = (claimResult as any)?.rowsAffected ?? (claimResult as any)?.[0]?.affectedRows ?? 0;
      if (claimed === 0) {
        // Another cron instance already claimed this session — skip it
        console.log(`[SilenceFollowUp] Session ${session.id} already claimed by another instance — skipping.`);
        continue;
      }

      const firstName = session.leadName?.split(" ")[0] ?? session.leadName ?? "there";

      // Generate a contextual nudge using the AI
      let nudgeMessage: string;
      try {
        const history = JSON.parse(session.messageHistory ?? "[]");
        const lastAiMsg = [...history].reverse().find((m: any) => m.role === "assistant")?.content ?? "";

        const llmResult = await invokeLLM({
          messages: [
            {
              role: "system",
              content: `You are a friendly booking assistant for Maids in Black, a professional cleaning service in Washington DC. 
Write a short, warm follow-up SMS (1-2 sentences max) to a lead named ${firstName} who hasn't responded in a few minutes.
The last message we sent them was: "${lastAiMsg}"
Keep it casual and helpful. Do NOT be pushy. Do NOT use emoji. Do NOT include a phone number or URL.
Example: "Hey ${firstName}, just circling back — can we help get this set up for you?"`,
            },
            {
              role: "user",
              content: "Write the follow-up SMS now.",
            },
          ],
        });

        const rawContent = llmResult?.choices?.[0]?.message?.content;
        nudgeMessage =
          (typeof rawContent === "string" ? rawContent.trim() : null) ??
          `Hey ${firstName}, just circling back — can we help set this up for you?`;
      } catch {
        // Fallback if LLM fails
        nudgeMessage = `Hey ${firstName}, just circling back — can we help set this up for you?`;
      }

      // Send the nudge
      const smsResult = await sendSms({ to: session.leadPhone, content: nudgeMessage });

      if (smsResult.success) {
        // Update history and increment nudgeCount
        let history: any[] = [];
        try { history = JSON.parse(session.messageHistory ?? "[]"); } catch { history = []; }
        history.push({ role: "assistant", content: nudgeMessage, ts: Date.now() });
        if (history.length > 20) history = history.slice(-20);

        const newNudgeCount = (session.nudgeCount ?? 0) + 1;
        const goingCold = newNudgeCount >= MAX_NUDGES_BEFORE_COLD;

        // autoFollowUpSent was already set to 1 atomically before sending (race-condition guard above)
        await db
          .update(conversationSessions)
          .set({
            lastAiMessageAt: new Date(),
            messageHistory: JSON.stringify(history),
            nudgeCount: newNudgeCount,
            // Move to COLD when nudge cap is reached — stops all future auto follow-ups
            ...(goingCold ? { stage: "COLD" as any } : {}),
          })
          .where(eq(conversationSessions.id, session.id));

        if (goingCold) {
          console.log(`[SilenceFollowUp] Lead ${session.leadPhone} (session ${session.id}) moved to COLD after ${newNudgeCount} nudges with no reply.`);
          logActivity({
            eventType: "lead_cold",
            title: `${firstName} moved to Cold`,
            body: `Received ${newNudgeCount} automated nudges with no reply. Conversation paused.`,
            meta: { sessionId: session.id, leadPhone: session.leadPhone, leadName: session.leadName, nudgeCount: newNudgeCount },
          }).catch(() => {});
        } else {
          console.log(`[SilenceFollowUp] Sent nudge #${newNudgeCount} to ${session.leadPhone} (session ${session.id}): "${nudgeMessage}"`);
          logActivity({
            eventType: "silence_nudge",
            title: `Auto-nudge #${newNudgeCount} sent to ${firstName}`,
            body: nudgeMessage.length > 120 ? nudgeMessage.slice(0, 120) + "…" : nudgeMessage,
            meta: { sessionId: session.id, leadPhone: session.leadPhone, leadName: session.leadName, stage: session.stage, nudgeCount: newNudgeCount },
          }).catch(() => {});
        }
        sent++;
      } else {
        console.error(`[SilenceFollowUp] Failed to send nudge to ${session.leadPhone}:`, smsResult.error);
        errors++;
      }
    } catch (err) {
      console.error(`[SilenceFollowUp] Error processing session ${session.id}:`, err);
      errors++;
    }
  }

  return { checked: sessions.length, sent, errors };
}

// ─── Scheduled Follow-Up (Manual Date) ───────────────────────────────────────

export async function runScheduledFollowUp(): Promise<{
  checked: number;
  sent: number;
  errors: number;
}> {
  const db = await getDb();
  if (!db) return { checked: 0, sent: 0, errors: 0 };

  // Get today's date in Eastern Time (YYYY-MM-DD)
  const todayET = new Date()
    .toLocaleString("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" })
    .replace(/(\d+)\/(\d+)\/(\d+)/, "$3-$1-$2");

  // Find sessions with followUpDate = today and followUpSent = 0
  const sessions = await db
    .select()
    .from(conversationSessions)
    .where(
      and(
        eq(conversationSessions.followUpDate, todayET),
        eq(conversationSessions.followUpSent, 0),
        eq(conversationSessions.aiMode, 1)
      )
    )
    .limit(100);

  let sent = 0;
  let errors = 0;

  for (const session of sessions) {
    try {
      const message = session.followUpMessage?.trim() || DEFAULT_CIRCLE_BACK_MESSAGE;

      const smsResult = await sendSms({ to: session.leadPhone, content: message });

      if (smsResult.success) {
        // Update history, mark follow-up sent, move stage back to AVAILABILITY
        let history: any[] = [];
        try { history = JSON.parse(session.messageHistory ?? "[]"); } catch { history = []; }
        history.push({ role: "assistant", content: message, ts: Date.now() });
        if (history.length > 20) history = history.slice(-20);

        await db
          .update(conversationSessions)
          .set({
            followUpSent: 1,
            stage: "AVAILABILITY",
            lastAiMessageAt: new Date(),
            autoFollowUpSent: 0, // Allow a new silence nudge after this
            messageHistory: JSON.stringify(history),
          })
          .where(eq(conversationSessions.id, session.id));

        console.log(`[ScheduledFollowUp] Sent circle-back to ${session.leadPhone} (session ${session.id})`);
        logActivity({
          eventType: "scheduled_followup",
          title: `Scheduled follow-up sent to ${session.leadName ?? session.leadPhone}`,
          body: message.length > 120 ? message.slice(0, 120) + "…" : message,
          meta: { sessionId: session.id, leadPhone: session.leadPhone, leadName: session.leadName, followUpDate: session.followUpDate },
        }).catch(() => {});
        sent++;
      } else {
        console.error(`[ScheduledFollowUp] Failed to send to ${session.leadPhone}:`, smsResult.error);
        errors++;
      }
    } catch (err) {
      console.error(`[ScheduledFollowUp] Error processing session ${session.id}:`, err);
      errors++;
    }
  }

  return { checked: sessions.length, sent, errors };
}

// ─── Follow-Up Due Alerts (8 AM ET) ─────────────────────────────────────────

/**
 * Fires at 8 AM ET — one hour before the scheduled SMS goes out.
 * Creates a notification bell alert for each follow-up due today so the admin
 * can review before the circle-back message is sent.
 */
export async function runFollowUpDueAlerts(): Promise<{ checked: number; alerted: number }> {
  const db = await getDb();
  if (!db) return { checked: 0, alerted: 0 };

  // Get today's date in Eastern Time (YYYY-MM-DD)
  const todayET = new Date()
    .toLocaleString('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' })
    .replace(/(\d+)\/(\d+)\/(\d+)/, '$3-$1-$2');

  // Find sessions with followUpDate = today and followUpSent = 0
  const sessions = await db
    .select()
    .from(conversationSessions)
    .where(
      and(
        eq(conversationSessions.followUpDate, todayET),
        eq(conversationSessions.followUpSent, 0)
      )
    )
    .limit(100);

  let alerted = 0;
  for (const session of sessions) {
    const firstName = session.leadName?.split(' ')[0] ?? session.leadName ?? 'Lead';
    const message = session.followUpMessage?.trim() || DEFAULT_CIRCLE_BACK_MESSAGE;
    logActivity({
      eventType: 'followup_due',
      title: `Follow-up due today — ${session.leadName ?? session.leadPhone}`,
      body: `Scheduled circle-back for ${firstName}: "${message.slice(0, 80)}${message.length > 80 ? '…' : ''}"`,
      meta: { sessionId: session.id, leadPhone: session.leadPhone, leadName: session.leadName, followUpDate: session.followUpDate },
    }).catch(() => {});
    alerted++;
  }

  return { checked: sessions.length, alerted };
}

// ─── Route Registration ───────────────────────────────────────────────────────

export function registerFollowUpCronRoutes(app: Express) {
  /**
   * POST /api/cron/silence-followup
   * Runs every 5 minutes via Manus scheduler.
   * Sends a contextual nudge to leads who haven't replied in 5 minutes.
   */
  app.post("/api/cron/silence-followup", async (req: Request, res: Response) => {
    const secret = process.env.CRON_SECRET;
    if (!secret) {
      res.status(503).json({ error: "Cron endpoint is not configured (CRON_SECRET missing)" });
      return;
    }
    const provided = req.headers["x-cron-secret"];
    if (provided !== secret) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    res.status(200).json({ received: true });

    try {
      const result = await runSilenceFollowUp();
      console.log(`[SilenceFollowUp] Done — checked: ${result.checked}, sent: ${result.sent}, errors: ${result.errors}`);
    } catch (err) {
      console.error("[SilenceFollowUp] Cron failed:", err);
    }
  });

  /**
   * POST /api/cron/scheduled-followup
   * Runs daily at 9 AM ET via Manus scheduler.
   * Sends circle-back SMS to leads with followUpDate = today.
   */
  app.post("/api/cron/scheduled-followup", async (req: Request, res: Response) => {
    const secret = process.env.CRON_SECRET;
    if (!secret) {
      res.status(503).json({ error: "Cron endpoint is not configured (CRON_SECRET missing)" });
      return;
    }
    const provided = req.headers["x-cron-secret"];
    if (provided !== secret) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    res.status(200).json({ received: true });

    try {
      const result = await runScheduledFollowUp();
      console.log(`[ScheduledFollowUp] Done — checked: ${result.checked}, sent: ${result.sent}, errors: ${result.errors}`);
    } catch (err) {
      console.error("[ScheduledFollowUp] Cron failed:", err);
    }
  });

  /**
   * POST /api/cron/followup-due-alerts
   * Runs daily at 8 AM ET — 1 hour before the SMS fires.
   * Creates notification bell alerts for each follow-up due today.
   */
  app.post("/api/cron/followup-due-alerts", async (req: Request, res: Response) => {
    const secret = process.env.CRON_SECRET;
    if (!secret) {
      res.status(503).json({ error: "Cron endpoint is not configured (CRON_SECRET missing)" });
      return;
    }
    const provided = req.headers["x-cron-secret"];
    if (provided !== secret) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    res.status(200).json({ received: true });

    try {
      const result = await runFollowUpDueAlerts();
      console.log(`[FollowUpDueAlerts] Done — checked: ${result.checked}, alerted: ${result.alerted}`);
    } catch (err) {
      console.error("[FollowUpDueAlerts] Cron failed:", err);
    }
  });
}
