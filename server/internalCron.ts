/**
 * Internal Cron Scheduler
 *
 * Runs all scheduled jobs directly inside the server process using node-cron.
 * This is more reliable than depending on an external HTTP-based scheduler
 * because it survives redeploys without needing to re-register anything.
 *
 * Schedules (all times in ET via timezone option):
 *  - silence-followup  : every 5 minutes (active lead nudge)
 *  - scheduled-followup: 9 AM ET daily (circle-back SMS)
 *  - nightly-sync      : 12:00 PM ET daily (Launch27 → DB sync)
 *  - always-on-send    : 10 AM ET Mon–Sat (campaign SMS batch)
 *
 * Note: always-on groups are gated by their isActive flag in the DB.
 * No campaign messages will be sent unless a group is explicitly activated
 * in the admin UI (Campaigns → Always-On).
 */

import cron from "node-cron";
import { runNightlySync } from "./cronSync";
import { runSilenceFollowUp, runScheduledFollowUp } from "./followUpCron";
import { enrollNewlyEligible } from "./alwaysOnEngine";
import { sendAlwaysOnBatch } from "./alwaysOnSend";
import { logActivity } from "./activityLogger";
import { notifyOwner } from "./_core/notification";
import { getDb } from "./db";
import { syncRuns } from "../drizzle/schema";

async function recordSyncRun(params: {
  runType: "launch27-sync" | "always-on-send";
  status: "success" | "partial" | "error" | "skipped";
  message?: string;
  errorDetail?: string;
  recordsInserted?: number;
  recordsSkipped?: number;
  smsSent?: number;
  smsFailed?: number;
  groupBreakdown?: Record<string, { sent: number; failed: number }>;
  enrollmentBreakdown?: Record<string, number>;
  targetDate?: string;
  durationMs?: number;
  startedAt: Date;
}): Promise<void> {
  try {
    const db = await getDb();
    if (!db) return;
    await db.insert(syncRuns).values({
      runType: params.runType,
      status: params.status,
      message: params.message ?? null,
      errorDetail: params.errorDetail ?? null,
      recordsInserted: params.recordsInserted ?? 0,
      recordsSkipped: params.recordsSkipped ?? 0,
      smsSent: params.smsSent ?? 0,
      smsFailed: params.smsFailed ?? 0,
      groupBreakdown: params.groupBreakdown ? JSON.stringify(params.groupBreakdown) : null,
      enrollmentBreakdown: params.enrollmentBreakdown ? JSON.stringify(params.enrollmentBreakdown) : null,
      targetDate: params.targetDate ?? null,
      durationMs: params.durationMs ?? null,
      startedAt: params.startedAt,
      completedAt: new Date(),
    });
  } catch (err) {
    console.error("[InternalCron] Failed to record sync run (non-fatal):", err);
  }
}

export function startInternalCron(): void {
  // ── Silence follow-up: every 5 minutes ──────────────────────────────────────
  // Nudges leads who haven't replied 5+ minutes after the AI sent a message.
  cron.schedule("0 */5 * * * *", async () => {
    try {
      const result = await runSilenceFollowUp();
      if (result.sent > 0) {
        console.log(`[InternalCron] SilenceFollowUp — checked: ${result.checked}, sent: ${result.sent}, errors: ${result.errors}`);
      }
    } catch (err) {
      console.error("[InternalCron] SilenceFollowUp failed:", err);
    }
  }, { timezone: "America/New_York" });

  // ── Scheduled follow-up: 9 AM ET daily ──────────────────────────────────────
  // Sends circle-back SMS to leads with followUpDate = today.
  cron.schedule("0 0 9 * * *", async () => {
    console.log("[InternalCron] Running ScheduledFollowUp...");
    try {
      const result = await runScheduledFollowUp();
      console.log(`[InternalCron] ScheduledFollowUp — checked: ${result.checked}, sent: ${result.sent}, errors: ${result.errors}`);
    } catch (err) {
      console.error("[InternalCron] ScheduledFollowUp failed:", err);
    }
  }, { timezone: "America/New_York" });

  // ── Nightly Launch27 sync: 12:00 PM ET daily ────────────────────────────────
  // Syncs yesterday's completed bookings from Launch27 into the DB.
  // Runs at noon so all morning jobs have had time to be marked complete.
  cron.schedule("0 0 12 * * *", async () => {
    console.log("[InternalCron] Running NightlySync...");
    const startedAt = new Date();
    try {
      const result = await runNightlySync();
      console.log(`[InternalCron] NightlySync — date: ${result.date}, inserted: ${result.inserted}, skipped: ${result.skipped}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[InternalCron] NightlySync failed:", msg);
      // recordSyncRun is already called inside runNightlySync on error,
      // but if runNightlySync itself throws before reaching that, record here.
      await recordSyncRun({
        runType: "launch27-sync",
        status: "error",
        message: `Internal cron: NightlySync threw: ${msg}`,
        errorDetail: msg,
        startedAt,
        durationMs: Date.now() - startedAt.getTime(),
      });
    }
  }, { timezone: "America/New_York" });

  // ── Always-On SMS send: 10 AM ET Mon–Sat ────────────────────────────────────
  // Sends the daily always-on campaign batch.
  // GATED: only groups with isActive=1 in the DB will send messages.
  // All groups are currently isActive=0 — no messages will go out until
  // explicitly enabled in the admin UI (Campaigns → Always-On).
  cron.schedule("0 0 10 * * 1-6", async () => {
    console.log("[InternalCron] Running AlwaysOnSend...");
    const sendStartedAt = new Date();
    try {
      const results = await sendAlwaysOnBatch();
      const totalSent = results.reduce((sum, r) => sum + r.sent, 0);
      const totalFailed = results.reduce((sum, r) => sum + r.failed, 0);

      const groupBreakdown: Record<string, { sent: number; failed: number }> = {};
      for (const r of results) {
        groupBreakdown[r.groupType] = { sent: r.sent, failed: r.failed };
      }

      const sendStatus = totalSent > 0 ? (totalFailed > 0 ? "partial" : "success") : "skipped";
      await recordSyncRun({
        runType: "always-on-send",
        status: sendStatus,
        message: totalSent > 0
          ? `Sent ${totalSent} messages (${totalFailed} failed) across ${results.filter(r => r.sent > 0).length} groups`
          : "No messages sent (all groups inactive, empty, or outside TCPA window)",
        smsSent: totalSent,
        smsFailed: totalFailed,
        groupBreakdown,
        startedAt: sendStartedAt,
        durationMs: Date.now() - sendStartedAt.getTime(),
      });

      logActivity({
        eventType: "always_on_batch",
        title: totalSent > 0
          ? `📤 Always-On batch: ${totalSent} SMS sent`
          : `Always-On batch: no messages sent`,
        body: totalSent > 0
          ? `Sent ${totalSent} messages (${totalFailed} failed) across ${results.filter(r => r.sent > 0).length} groups`
          : "All groups inactive, empty, or outside TCPA window",
        meta: { totalSent, totalFailed, groupBreakdown },
      }).catch(() => {});

      if (totalSent > 0) {
        const summary = results
          .filter((r) => r.sent > 0)
          .map((r) => `${r.groupType}: ${r.sent} sent`)
          .join(", ");
        try {
          await notifyOwner({
            title: `Always-On SMS — ${totalSent} messages sent`,
            content: `Daily always-on batch complete. ${summary}. Failed: ${totalFailed}.`,
          });
        } catch {
          // Non-fatal
        }
      }

      console.log(`[InternalCron] AlwaysOnSend — sent: ${totalSent}, failed: ${totalFailed}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[InternalCron] AlwaysOnSend failed:", msg);
      await recordSyncRun({
        runType: "always-on-send",
        status: "error",
        message: `Internal cron: AlwaysOnSend threw: ${msg}`,
        errorDetail: msg,
        startedAt: sendStartedAt,
        durationMs: Date.now() - sendStartedAt.getTime(),
      });
    }
  }, { timezone: "America/New_York" });

  console.log("[InternalCron] All schedules registered:");
  console.log("  - SilenceFollowUp:    every 5 minutes");
  console.log("  - ScheduledFollowUp:  9 AM ET daily");
  console.log("  - NightlySync:        12:00 PM ET daily");
  console.log("  - AlwaysOnSend:       10 AM ET Mon-Sat (gated by isActive flag)");
}
