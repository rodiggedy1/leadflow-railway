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
import { runNurtureEnrollment, runNurtureSend } from "./nurtureCron";
import { runNightlySync } from "./cronSync";
import { runSyncTodayJobs } from "./qualityRouter";
import { runSilenceFollowUp, runScheduledFollowUp, runFollowUpDueAlerts } from "./followUpCron";
import { runFollowUpReminders } from "./followUpsRouter";
import { enrollNewlyEligible } from "./alwaysOnEngine";
import { generatePendingBatches } from "./campaignApproval";
import { sendTrackerLinksForToday } from "./trackerCron";
import { warmAiInsightsCache } from "./commandCenterRouter";
import { warmMetricsAiAlerts } from "./metricsRouter";
import { bootstrapVapiAssistant } from "./vapiService";
import {
  FIELD_MGMT_ENABLED,
  runPreJobReminders,
  runClientPreJobNotifications,
  runMidJobNudges,
  runExceptionHandling,
  runNoShowEscalation,
  runCheckinCalls,
  runCheckinCallsT30,
  runPostStartEscalation,
  sendClientEtaApproachingSms,
} from "./fieldMgmtEngine";
import { getDb } from "./db";
import { syncRuns, cronHeartbeats } from "../drizzle/schema";
import { cleanerJobs } from "../drizzle/schema";
import { runUnclaimedLeadEscalation, purgeEscalationNudges } from "./unclaimedLeadEscalation";
import { runScheduleConfirmSend, runScheduleConfirmNudge } from "./scheduleConfirmEngine";
import { postOpsSummary } from "./opsSummaryEngine";
import { runEscalationCalls } from "./escalationEngine";
import { runMessageIntegrityCheck } from "./messageIntegrityEngine";
import { opsReminders, opsChatMessages, agents, jobAlerts } from "../drizzle/schema";
import { and, eq, isNull, lte, lt, gte, isNotNull, desc, sql } from "drizzle-orm";

async function recordHeartbeat(jobName: string, resultSummary: string, didWork: boolean): Promise<void> {
  try {
    const db = await getDb();
    if (!db) return;
    await db.insert(cronHeartbeats).values({
      jobName,
      resultSummary: resultSummary.slice(0, 500),
      didWork: didWork ? 1 : 0,
      ranAt: new Date(),
    });
    // If this is an error, post a red card to Command Chat so it's never silent.
    // Deduplicate within 30 minutes per job so repeated failures don't spam.
    if (resultSummary.startsWith("error:")) {
      try {
        const THIRTY_MIN_MS = 30 * 60 * 1000;
        const recentCutoff = new Date(Date.now() - THIRTY_MIN_MS);
        const existing = await db
          .select({ id: opsChatMessages.id })
          .from(opsChatMessages)
          .where(
            and(
              eq(opsChatMessages.quickAction as any, "cron_error"),
              gte(opsChatMessages.createdAt, recentCutoff)
            )
          )
          .limit(1);
        // Only check for same job within the window
        const existingForJob = existing.length > 0
          ? await db
              .select({ id: opsChatMessages.id })
              .from(opsChatMessages)
              .where(
                and(
                  eq(opsChatMessages.quickAction as any, "cron_error"),
                  gte(opsChatMessages.createdAt, recentCutoff)
                )
              )
              .limit(1)
          : [];
        // Check specifically for this job name in metadata
        const recentForThisJob = await db
          .select({ id: opsChatMessages.id, metadata: opsChatMessages.metadata })
          .from(opsChatMessages)
          .where(
            and(
              eq(opsChatMessages.quickAction as any, "cron_error"),
              gte(opsChatMessages.createdAt, recentCutoff)
            )
          )
          .limit(20);
        const alreadyPosted = recentForThisJob.some((row) => {
          try { return JSON.parse(row.metadata ?? "{}").jobName === jobName; } catch { return false; }
        });
        if (!alreadyPosted) {
          const errorMsg = resultSummary.replace(/^error:\s*/, "");
          await db.insert(opsChatMessages).values({
            channel: "command",
            authorName: "System",
            authorRole: "system",
            body: `❌ Cron failed: ${jobName} — ${errorMsg}`,
            quickAction: "cron_error",
            metadata: JSON.stringify({ jobName, errorMsg, ranAt: new Date().toISOString() }),
          } as any);
          const { broadcastOpsUpdate } = await import("./sseBroadcast");
          broadcastOpsUpdate("new_message");
          // Also notify owner
          try {
            const { notifyOwner } = await import("./_core/notification");
            await notifyOwner({ title: `❌ Cron failed: ${jobName}`, content: errorMsg });
          } catch { /* non-fatal */ }
        }
      } catch (cardErr) {
        console.error(`[InternalCron] Failed to post cron_error card for ${jobName} (non-fatal):`, cardErr);
      }
    }
  } catch (err) {
    console.error(`[InternalCron] Failed to record heartbeat for ${jobName} (non-fatal):`, err);
  }
}

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

let _cronStarted = false;

export function startInternalCron(): void {
  if (_cronStarted) {
    console.warn("[InternalCron] startInternalCron() called more than once — ignoring duplicate registration.");
    return;
  }
  _cronStarted = true;
  // One-time cleanup: remove all escalation_nudge messages (feature disabled)
  purgeEscalationNudges().catch(() => {});
  // ── Nurture enrollment: every 5 minutes ────────────────────────────────────
  // Finds leads whose speed-to-lead window has passed (15+ min) and enrolls
  // them in the 30-day nurture sequence if not already enrolled.
  cron.schedule("0 */5 * * * *", async () => {
    try {
      const result = await runNurtureEnrollment();
      if (result.enrolled > 0) {
        console.log(`[InternalCron] NurtureEnrollment — checked: ${result.checked}, enrolled: ${result.enrolled}, errors: ${result.errors}`);
      }
      await recordHeartbeat("nurture-enrollment", `checked: ${result.checked}, enrolled: ${result.enrolled}, errors: ${result.errors}`, result.enrolled > 0);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[InternalCron] NurtureEnrollment failed:", msg);
      await recordHeartbeat("nurture-enrollment", `error: ${msg}`, false);
    }
  }, { timezone: "America/New_York" });

  // ── Nurture send: every 5 minutes ────────────────────────────────────────────
  // Fires any nurture messages whose nextSendAt <= now, advances the sequence,
  // and handles exit conditions (booked, opted-out, day30, human takeover).
  cron.schedule("0 */5 * * * *", async () => {
    try {
      const result = await runNurtureSend();
      if (result.sent > 0 || result.ended > 0) {
        console.log(`[InternalCron] NurtureSend — checked: ${result.checked}, sent: ${result.sent}, ended: ${result.ended}, errors: ${result.errors}`);
      }
      await recordHeartbeat("nurture-send", `checked: ${result.checked}, sent: ${result.sent}, ended: ${result.ended}, errors: ${result.errors}`, result.sent > 0);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[InternalCron] NurtureSend failed:", msg);
      await recordHeartbeat("nurture-send", `error: ${msg}`, false);
    }
  }, { timezone: "America/New_York" });

  // ── Silence follow-up: every 5 minutes ──────────────────────────────────────
  // Nudges leads who haven't replied 5+ minutes after the AI sent a message.
  // ── Ops follow-up due-time reminders: every 5 minutes ────────────────────────
  // Sends owner notification + activity log entry when a follow-up hits its dueAt.
  cron.schedule("0 */5 * * * *", async () => {
    try {
      const result = await runFollowUpReminders();
      if (result.sent > 0) {
        console.log(`[InternalCron] FollowUpReminders — checked: ${result.checked}, sent: ${result.sent}`);
      }
      await recordHeartbeat("followup-reminders", `checked: ${result.checked}, sent: ${result.sent}`, result.sent > 0);
    } catch (err) {
      console.error("[InternalCron] FollowUpReminders failed:", err);
    }
  }, { timezone: "America/New_York" });

  cron.schedule("0 */5 * * * *", async () => {
    try {
      const result = await runSilenceFollowUp();
      const summary = `checked: ${result.checked}, sent: ${result.sent}, errors: ${result.errors}`;
      if (result.sent > 0) {
        console.log(`[InternalCron] SilenceFollowUp — ${summary}`);
      }
      await recordHeartbeat("silence-followup", summary, result.sent > 0);
    } catch (err) {
      console.error("[InternalCron] SilenceFollowUp failed:", err);
      await recordHeartbeat("silence-followup", `error: ${err instanceof Error ? err.message : String(err)}`, false);
    }
  }, { timezone: "America/New_York" });

  // ── Follow-up due alerts: 8 AM ET daily ───────────────────────────────────────
  // Creates notification bell alerts for each follow-up due today (1 hr before SMS).
  cron.schedule("0 0 8 * * *", async () => {
    console.log("[InternalCron] Running FollowUpDueAlerts...");
    try {
      const result = await runFollowUpDueAlerts();
      const summary = `checked: ${result.checked}, alerted: ${result.alerted}`;
      console.log(`[InternalCron] FollowUpDueAlerts — ${summary}`);
      await recordHeartbeat("followup-due-alerts", summary, result.alerted > 0);
    } catch (err) {
      console.error("[InternalCron] FollowUpDueAlerts failed:", err);
      await recordHeartbeat("followup-due-alerts", `error: ${err instanceof Error ? err.message : String(err)}`, false);
    }
  }, { timezone: "America/New_York" });

  // ── Scheduled follow-up: 9 AM ET daily ──────────────────────────────────────────
  // Sends circle-back SMS to leads with followUpDate = today.
  cron.schedule("0 0 9 * * *",async () => {
    console.log("[InternalCron] Running ScheduledFollowUp...");
    try {
      const result = await runScheduledFollowUp();
      const summary = `checked: ${result.checked}, sent: ${result.sent}, errors: ${result.errors}`;
      console.log(`[InternalCron] ScheduledFollowUp — ${summary}`);
      await recordHeartbeat("scheduled-followup", summary, result.sent > 0);
    } catch (err) {
      console.error("[InternalCron] ScheduledFollowUp failed:", err);
      await recordHeartbeat("scheduled-followup", `error: ${err instanceof Error ? err.message : String(err)}`, false);
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
      const summary = `date: ${result.date}, inserted: ${result.inserted}, skipped: ${result.skipped}`;
      console.log(`[InternalCron] NightlySync — ${summary}`);
      await recordHeartbeat("nightly-sync", summary, result.inserted > 0);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[InternalCron] NightlySync failed:", msg);
      await recordHeartbeat("nightly-sync", `error: ${msg}`, false);
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

  // ── Tomorrow's schedule sync: 9 PM ET daily ──────────────────────────────
  // Syncs tomorrow's bookings from Launch27 so cleaners see their jobs overnight.
  // Uses the same runNightlySync logic, just called with tomorrow's date.
  cron.schedule("0 0 21 * * *", async () => {
    const etNow = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
    etNow.setDate(etNow.getDate() + 1);
    const yyyy = etNow.getFullYear();
    const mm = String(etNow.getMonth() + 1).padStart(2, "0");
    const dd = String(etNow.getDate()).padStart(2, "0");
    const tomorrowDate = `${yyyy}-${mm}-${dd}`;
    console.log(`[InternalCron] Running TomorrowSync for ${tomorrowDate}...`);
    try {
      const result = await runNightlySync(tomorrowDate);
      const summary = `date: ${result.date}, inserted: ${result.inserted}, skipped: ${result.skipped}`;
      console.log(`[InternalCron] TomorrowSync — ${summary}`);
      await recordHeartbeat("tomorrow-sync", summary, true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[InternalCron] TomorrowSync failed:", msg);
      await recordHeartbeat("tomorrow-sync", `error: ${msg}`, false);
    }
    // Also sync cleanerJobs for tomorrow so the integrity check runs and alerts on any mismatch
    try {
      const qResult = await runSyncTodayJobs(tomorrowDate);
      const qSummary = `date: ${qResult.date}, created: ${qResult.jobsCreated}, updated: ${qResult.jobsUpdated}, mismatches: ${qResult.mismatches.length}`;
      console.log(`[InternalCron] TomorrowSync (cleanerJobs) — ${qSummary}`);
      if (qResult.mismatches.length > 0) {
        console.warn(`[InternalCron] TomorrowSync mismatches: ${qResult.mismatches.join(" | ")}`);
      }
      await recordHeartbeat("tomorrow-sync-jobs", qSummary.slice(0, 500), true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[InternalCron] TomorrowSync (cleanerJobs) failed:", msg);
      await recordHeartbeat("tomorrow-sync-jobs", `error: ${msg}`, false);
    }
  }, { timezone: "America/New_York" });

  // ── Today's schedule sync: every 60 min, 6 AM–8 PM ET ──────────────────────
  // Re-syncs today's bookings hourly to catch reschedules, cancellations, and
  // new bookings added during the day. Same logic as nightly sync, today's date.
  // Starts at 6 AM (was 7 AM) to catch jobs added to Launch27 overnight after
  // the midnight nightly sync — prevents missing jobs in the morning window.
  cron.schedule("0 0 6-20 * * *", async () => {
    const etNow = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
    const yyyy = etNow.getFullYear();
    const mm = String(etNow.getMonth() + 1).padStart(2, "0");
    const dd = String(etNow.getDate()).padStart(2, "0");
    const todayDate = `${yyyy}-${mm}-${dd}`;
    console.log(`[InternalCron] Running TodaySync for ${todayDate}...`);
    const startedAt = new Date();
    try {
      const result = await runNightlySync(todayDate);
      const summary = `date: ${result.date}, inserted: ${result.inserted}, skipped: ${result.skipped}`;
      console.log(`[InternalCron] TodaySync — ${summary}`);
      await recordHeartbeat("today-sync", summary, true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[InternalCron] TodaySync failed:", msg);
      await recordHeartbeat("today-sync", `error: ${msg}`, false);
    }
    // Sync cleanerJobs (Day Board) — picks up new bookings and status changes mid-day
    try {
      const qResult = await runSyncTodayJobs(todayDate);
      const qSummary = `date: ${qResult.date}, created: ${qResult.jobsCreated}, updated: ${qResult.jobsUpdated}, mismatches: ${qResult.mismatches.length}`;
      console.log(`[InternalCron] TodaySync (cleanerJobs) — ${qSummary}`);
      if (qResult.mismatches.length > 0) {
        console.warn(`[InternalCron] Sync mismatches detected: ${qResult.mismatches.join(" | ")}`);
      }
      if (qResult.errors.length > 0) {
        console.warn(`[InternalCron] Sync errors: ${qResult.errors.join(" | ")}`);
      }
      const mismatchNote = qResult.mismatches.length > 0 ? ` | MISMATCHES: ${qResult.mismatches.join("; ")}` : "";
      await recordHeartbeat("today-sync-jobs", (qSummary + mismatchNote).slice(0, 500), qResult.jobsCreated > 0 || qResult.jobsUpdated > 0);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[InternalCron] TodaySync (cleanerJobs) failed:", msg);
      await recordHeartbeat("today-sync-jobs", `error: ${msg}`, false);
    }
  }, { timezone: "America/New_York" });

  // ── Always-On batch generation: 10 AM ET Mon–Sat ───────────────────────────
  // Creates pending approval batches for admin review. Does NOT send SMS directly.
  // Admin must approve each batch in Campaigns → Always-On before SMS goes out.
  // GATED: only groups with isActive=1 in the DB will generate batches.
  cron.schedule("0 0 10 * * 1-6", async () => {
    console.log("[InternalCron] Running AlwaysOn batch generation (approval mode)...");
    const genStartedAt = new Date();
    try {
      const results = await generatePendingBatches();
      const totalRecipients = results.reduce((sum, r) => sum + r.recipientCount, 0);

      const heartbeatSummary = results.length > 0
        ? `generated ${results.length} pending batch(es) — ${totalRecipients} recipients awaiting approval`
        : "no batches generated (all groups inactive or empty)";
      await recordHeartbeat("always-on-send", heartbeatSummary, results.length > 0);

      await recordSyncRun({
        runType: "always-on-send",
        status: "skipped",
        message: results.length > 0
          ? `Generated ${results.length} pending batch(es) for approval — ${totalRecipients} recipients total`
          : "No batches generated (all groups inactive or empty)",
        smsSent: 0,
        smsFailed: 0,
        startedAt: genStartedAt,
        durationMs: Date.now() - genStartedAt.getTime(),
      });

      console.log(`[InternalCron] AlwaysOn batch generation — ${results.length} batch(es) pending approval`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[InternalCron] AlwaysOn batch generation failed:", msg);
      await recordHeartbeat("always-on-send", `error: ${msg}`, false);
    }
  }, { timezone: "America/New_York" });

  // ── Tracker link SMS: 8 AM ET daily ────────────────────────────────────────
  // DISABLED: SMS sending is paused while the tracker page is being tested.
  // To re-enable, uncomment the cron.schedule block below.
  //
  // cron.schedule("0 0 8 * * *", async () => {
  //   console.log("[InternalCron] Running TrackerLinkSend...");
  //   try {
  //     const result = await sendTrackerLinksForToday();
  //     const summary = `date: ${result.date}, sent: ${result.sent}, skipped: ${result.skipped}, errors: ${result.errors.length}`;
  //     console.log(`[InternalCron] TrackerLinkSend — ${summary}`);
  //     await recordHeartbeat("tracker-link-send", summary, result.sent > 0);
  //   } catch (err) {
  //     const msg = err instanceof Error ? err.message : String(err);
  //     console.error("[InternalCron] TrackerLinkSend failed:", msg);
  //     await recordHeartbeat("tracker-link-send", `error: ${msg}`, false);
  //   }
  // }, { timezone: "America/New_York" });
  console.log("[InternalCron] TrackerLinkSend: DISABLED (testing mode)");

  // ── AI Insights cache warm-up: DISABLED (AI Center page hidden, saving LLM tokens) ──
  // cron.schedule("0 0,30 * * * *", async () => { ... }, { timezone: "America/New_York" });
  console.log("[InternalCron] AiCacheWarmUp: DISABLED (AI Center hidden)");

  // ── Field Management: every 5 minutes, 6 AM–10 PM ET ─────────────────────────
  // Runs all time-based field management steps:
  //   - Pre-job reminders (T-2hrs)
  //   - Mid-job nudges (45-60min after arrived)
  //   - Exception handling (30min before, no check-in)
  //   - No-show escalation (10min before, no on_the_way)
  // GATED: FIELD_MGMT_ENABLED must be true in fieldMgmtEngine.ts
  cron.schedule("0 */5 6-22 * * *", async () => {
    if (!FIELD_MGMT_ENABLED) return;
    try {
      const [reminders, clientPreJob, nudges, exceptions, noshow, checkinCalls, checkinCallsT30, postStart] = await Promise.all([
        runPreJobReminders(),
        runClientPreJobNotifications(),
        runMidJobNudges(),
        runExceptionHandling(),
        runNoShowEscalation(),
        runCheckinCalls(),
        runCheckinCallsT30(),
        runPostStartEscalation(),
      ]);
      const summary = [
        `reminders: ${reminders.sent}/${reminders.checked}`,
        `clientPreJob: ${clientPreJob.sent}/${clientPreJob.checked}`,
        `nudges: ${nudges.sent}/${nudges.checked}`,
        `exceptions: ${exceptions.sent}/${exceptions.checked}`,
        `noshow: ${noshow.sent}/${noshow.checked}`,
        `checkinCalls: ${checkinCalls.called}/${checkinCalls.checked}`,
        `checkinCallsT30: ${checkinCallsT30.called}/${checkinCallsT30.checked}`,
        `postStart: ${postStart.acted}/${postStart.checked}`,
      ].join(", ");
      const didWork = reminders.sent + clientPreJob.sent + nudges.sent + exceptions.sent + noshow.sent + checkinCalls.called + checkinCallsT30.called + postStart.acted > 0;
      if (didWork) console.log(`[InternalCron] FieldMgmt — ${summary}`);
      await recordHeartbeat("field-mgmt", summary, didWork);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[InternalCron] FieldMgmt cron failed:", msg);
      await recordHeartbeat("field-mgmt", `error: ${msg}`, false);
    }
  }, { timezone: "America/New_York" });

  // ── Unclaimed lead escalation: DISABLED per user request ────────────────────
  // (was: posts a ⚠️ nudge if a new_lead card sits unclaimed for 5+ min)

  // ── Ops Reminder fire: every minute ────────────────────────────────────────
  // Atomic claim pattern: stamp firedAt FIRST (UPDATE WHERE firedAt IS NULL),
  // check affectedRows — only insert the chat message if we claimed the row.
  // This prevents duplicate fires if a DB flake causes the update to fail after
  // the insert already succeeded, or if two processes race on the same row.
  cron.schedule("0 * * * * *", async () => {
    try {
      const db = await getDb();
      if (!db) return;
      const now = Date.now();
      const due = await db
        .select()
        .from(opsReminders)
        .where(and(lte(opsReminders.triggerAt, now), isNull(opsReminders.firedAt)))
        .limit(20);
      let fired = 0;
      for (const r of due) {
        // Atomic claim: stamp firedAt only if still NULL — safe against races and DB flakes
        const claimResult = await db.execute(
          sql`UPDATE ops_reminders SET firedAt = ${now} WHERE id = ${r.id} AND firedAt IS NULL`
        );
        const claimed = (claimResult as any)?.[0]?.affectedRows ?? (claimResult as any)?.rowsAffected ?? 0;
        if (claimed === 0) continue; // another process already claimed this reminder
        await db.insert(opsChatMessages).values({
          channel: r.channel,
          authorName: r.authorName,
          authorRole: "system",
          body: `⏰ Reminder from ${r.authorName}: ${r.body}`,
          quickAction: "reminder",
          metadata: JSON.stringify({ reminderBody: r.body, setBy: r.authorName }),
        });
        fired++;
      }
      if (fired > 0) {
        console.log(`[InternalCron] OpsReminders fired: ${fired}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[InternalCron] OpsReminders failed:", msg);
    }
  });

  // ── First-run AI warmup: DISABLED (AI Center page hidden, saving LLM tokens) ──
  // setTimeout(async () => { await warmAiInsightsCache(); }, 60_000);
  console.log("[InternalCron] AiCacheWarmUp startup warmup: DISABLED (AI Center hidden)");

  // ── On-call badge TTL: every 5 minutes ─────────────────────────────────────
  // Safety net: clear any on-call badge older than 2 hours.
  // Handles cases where call.completed was missed (server restart, webhook drop).
  cron.schedule("0 */5 * * * *", async () => {
    try {
      const db = await getDb();
      if (!db) return;
      const TWO_HOURS_MS = 2 * 60 * 60 * 1000;
      const cutoff = Date.now() - TWO_HOURS_MS;
      const stale = await db
        .select({ id: agents.id, name: agents.name })
        .from(agents)
        .where(and(isNotNull(agents.onCallSince), lt(agents.onCallSince, cutoff)));
      if (stale.length > 0) {
        await db
          .update(agents)
          .set({ onCallSince: null, onCallCallId: null } as any)
          .where(and(isNotNull(agents.onCallSince), lt(agents.onCallSince, cutoff)));
        const { broadcastOpsUpdate } = await import("./sseBroadcast");
        broadcastOpsUpdate("agent_status");
        console.log(`[InternalCron] OnCallTTL — cleared ${stale.length} stale badge(s): ${stale.map((a: { name: string }) => a.name).join(", ")}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[InternalCron] OnCallTTL failed:", msg);
    }
  });
  // ── Stale ETA check: every 5 minutes ──────────────────────────────────────
  // Posts a stale_eta alert card to CommandChat for on_the_way jobs where ETA has passed.
  // Uses job_alerts table with UNIQUE (cleanerJobId, alertType) + INSERT ON DUPLICATE KEY UPDATE
  // (no-op) to guarantee exactly-once posting regardless of concurrent cron executions.
  cron.schedule("0 */5 * * * *", async () => {
    try {
      const db = await getDb();
      if (!db) return;
      const now = Date.now();
      // Today-only guard: only alert for jobs whose ETA is from today (ET).
      // Prior-day on_the_way jobs are zombie data; the nightly auto-close cron handles them.
      const todayET = new Date(new Date().toLocaleDateString("en-US", { timeZone: "America/New_York" }));
      const todayStartMs = todayET.getTime();
      // Find on_the_way jobs with a passed ETA that started today
      const staleJobs = await db
        .select({ id: cleanerJobs.id, cleanerName: cleanerJobs.cleanerName, customerName: cleanerJobs.customerName, etaTimestamp: cleanerJobs.etaTimestamp })
        .from(cleanerJobs)
        .where(and(
          eq(cleanerJobs.jobStatus, "on_the_way"),
          lte(cleanerJobs.etaTimestamp, now),
          gte(cleanerJobs.etaTimestamp, todayStartMs),
          isNotNull(cleanerJobs.etaTimestamp)
        ));
      for (const job of staleJobs) {
        if (!job.etaTimestamp) continue;
        const cleanerFirst = (job.cleanerName ?? "Team").split(" ")[0];
        const etaStr = new Date(job.etaTimestamp).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "America/New_York" });
        // TiDB-compatible dedup: SELECT first, then INSERT.
        // TiDB returns affectedRows=1 for both first insert AND no-op ON DUPLICATE KEY UPDATE,
        // so we cannot rely on affectedRows to detect duplicates. Instead, check existence
        // before inserting. The UNIQUE constraint still prevents actual duplicate rows.
        const existing = await db
          .select({ id: jobAlerts.id })
          .from(jobAlerts)
          .where(and(eq(jobAlerts.cleanerJobId, job.id), eq(jobAlerts.alertType, "stale_eta")))
          .limit(1);
        if (existing.length > 0) continue; // already alerted for this job
        // First time — insert the job_alerts row to claim this alert
        try {
          await db.insert(jobAlerts)
            .values({ cleanerJobId: job.id, alertType: "stale_eta" })
            .onDuplicateKeyUpdate({ set: { cleanerJobId: job.id } }); // race guard
        } catch {
          continue; // another concurrent tick won the race — skip
        }
        // Re-check after insert to handle the race window between SELECT and INSERT
        const claimed = await db
          .select({ id: jobAlerts.id })
          .from(jobAlerts)
          .where(and(eq(jobAlerts.cleanerJobId, job.id), eq(jobAlerts.alertType, "stale_eta")))
          .limit(1);
        if (claimed.length === 0) continue; // shouldn't happen, but be safe
        // Guard: only post the opsChatMessages if none already exists for this job+action
        const existingMsg = await db
          .select({ id: opsChatMessages.id })
          .from(opsChatMessages)
          .where(and(
            eq(opsChatMessages.cleanerJobId, job.id),
            eq(opsChatMessages.quickAction as any, "stale_eta")
          ))
          .limit(1);
        if (existingMsg.length > 0) continue; // message already posted
        // Post the chat message
        const [msgResult] = await db.insert(opsChatMessages).values({
          channel: "command",
          from: "System",
          authorName: "System",
          authorRole: "system",
          body: `⚠️ ${job.cleanerName ?? "Team"} ETA passed — still on the way${job.customerName ? ` for ${job.customerName}` : ""}`,
          metadata: JSON.stringify({ cleanerJobId: job.id, cleanerName: job.cleanerName, customerName: job.customerName, etaStr }),
          cleanerJobId: job.id,
          quickAction: "stale_eta",
        } as any);
        // Back-fill postedMessageId on the job_alerts row for traceability
        const insertedMsgId = (msgResult as any).insertId;
        if (insertedMsgId) {
          await db.update(jobAlerts)
            .set({ postedMessageId: insertedMsgId })
            .where(and(eq(jobAlerts.cleanerJobId, job.id), eq(jobAlerts.alertType, "stale_eta")));
        }
        const { broadcastOpsUpdate } = await import("./sseBroadcast");
        broadcastOpsUpdate("new_message");
        console.log(`[InternalCron] StaleETA — posted alert for job ${job.id} (${cleanerFirst}, ETA was ${etaStr})`);
      }

      // ── ETA Approaching: fire client SMS 5 min before ETA ─────────────────
      // Finds on_the_way or running_late jobs whose ETA is within the next 5 minutes
      // (i.e. etaTimestamp is between now and now+5min) and sends a warm reassurance
      // SMS to the client. Dedup is handled inside sendClientEtaApproachingSms via
      // tryClaimStep("client_eta_approaching") — fires once per job, never twice.
      if (FIELD_MGMT_ENABLED) {
        const fiveMinMs = 5 * 60 * 1000;
        const approachingJobs = await db
          .select({ id: cleanerJobs.id })
          .from(cleanerJobs)
          .where(and(
            isNotNull(cleanerJobs.etaTimestamp),
            gte(cleanerJobs.etaTimestamp, now),
            lte(cleanerJobs.etaTimestamp, now + fiveMinMs),
            gte(cleanerJobs.etaTimestamp, todayStartMs)
          ));
        for (const aj of approachingJobs) {
          sendClientEtaApproachingSms(aj.id).catch(err =>
            console.error(`[InternalCron] EtaApproaching SMS error for job ${aj.id}:`, err)
          );
        }
        if (approachingJobs.length > 0) {
          console.log(`[InternalCron] EtaApproaching — queued SMS for ${approachingJobs.length} job(s)`);
        }
      }
    } catch (err) {
      console.error("[InternalCron] StaleETA check failed:", err);
    }
  }, { timezone: "America/New_York" });

  // ── Nightly zombie-job cleanup: 11:30 PM ET daily ───────────────────────────
  // Auto-closes any on_the_way jobs from prior days that were never resolved.
  // These are jobs where the cleaner went on_the_way but never marked arrived —
  // typically caused by reschedules or cancellations in Launch27 that the cleaner
  // app never received. Marking them completed prevents stale ETA alerts from
  // firing the next day and keeps field mgmt queries clean.
  cron.schedule("0 30 23 * * *", async () => {
    try {
      const db = await getDb();
      if (!db) return;
      // Midnight ET = start of today
      const todayET = new Date(new Date().toLocaleDateString("en-US", { timeZone: "America/New_York" }));
      const todayStartMs = todayET.getTime();
      // Find all on_the_way jobs whose ETA is before today
      const zombies = await db
        .select({ id: cleanerJobs.id })
        .from(cleanerJobs)
        .where(and(
          eq(cleanerJobs.jobStatus, "on_the_way"),
          lt(cleanerJobs.etaTimestamp, todayStartMs),
          isNotNull(cleanerJobs.etaTimestamp)
        ));
      if (zombies.length === 0) {
        await recordHeartbeat("zombie-job-cleanup", "no zombies found", false);
        return;
      }
      const zombieIds = zombies.map(z => z.id);
      // Close them to 'completed' (safe default — job date has passed)
      await db.execute(
        `UPDATE cleaner_jobs SET jobStatus = 'completed', updatedAt = NOW() WHERE id IN (${zombieIds.join(",")})`
      );
      // Clean up any lingering job_alerts and ops_chat_messages for these jobs
      for (const id of zombieIds) {
        await db.delete(jobAlerts).where(and(eq(jobAlerts.cleanerJobId, id), eq(jobAlerts.alertType, "stale_eta")));
        await db.delete(opsChatMessages).where(and(eq(opsChatMessages.cleanerJobId, id), eq(opsChatMessages.quickAction, "stale_eta")));
      }
      const summary = `closed ${zombies.length} zombie jobs: [${zombieIds.join(",")}]`;
      console.log(`[InternalCron] ZombieJobCleanup — ${summary}`);
      await recordHeartbeat("zombie-job-cleanup", summary, true);
    } catch (err) {
      console.error("[InternalCron] ZombieJobCleanup failed:", err);
    }
  }, { timezone: "America/New_York" });

  // ── Metrics AI alerts pre-generation: every hour ────────────────────────────
  // Pre-generates AI growth alerts for all 5 time ranges (today/7d/30d/90d/12m)
  // and stores them in metrics_ai_alerts so the Metrics page serves from cache.
  cron.schedule("0 0 * * * *", async () => {
    try {
      const result = await warmMetricsAiAlerts();
      const summary = `generated: ${result.generated}, errors: ${result.errors}`;
      console.log(`[InternalCron] MetricsAiAlerts — ${summary}`);
      await recordHeartbeat("metrics-ai-alerts", summary, result.generated > 0);
    } catch (err) {
      console.error("[InternalCron] MetricsAiAlerts failed:", err);
      await recordHeartbeat("metrics-ai-alerts", `error: ${err instanceof Error ? err.message : String(err)}`, false);
    }
  }, { timezone: "America/New_York" });

  // ── Vapi assistant hourly refresh ──────────────────────────────────────────
  // Re-bootstraps the Vapi assistant every hour so the system prompt's
  // current date/time context is never more than 1 hour stale.
  cron.schedule("0 30 * * * *", async () => {
    try {
      const webhookUrl = process.env.VAPI_WEBHOOK_URL ?? "https://quote.maidinblack.com/api/webhooks/vapi";
      await bootstrapVapiAssistant(webhookUrl);
      console.log("[InternalCron] VapiRefresh — assistant prompt refreshed");
      await recordHeartbeat("vapi-refresh", "assistant prompt refreshed", true);
    } catch (err) {
      console.error("[InternalCron] VapiRefresh failed:", err);
      await recordHeartbeat("vapi-refresh", `error: ${err instanceof Error ? err.message : String(err)}`, false);
    }
  }, { timezone: "America/New_York" });

  // ── Sync watchdog: every hour, 6 AM–10 PM ET ──────────────────────────
  // Checks whether today-sync-jobs ran in the last 75 minutes.
  // If not, posts a ⚠️ alert card to Command Chat and notifies the owner.
  // Deduplicates: only posts one alert per stale window (not every tick).
  cron.schedule("0 30 6-22 * * *", async () => {
    try {
      const db = await getDb();
      if (!db) return;
      const STALE_THRESHOLD_MS = 75 * 60 * 1000; // 75 minutes
      const [lastRow] = await db
        .select({ ranAt: cronHeartbeats.ranAt })
        .from(cronHeartbeats)
        .where(eq(cronHeartbeats.jobName, "today-sync-jobs"))
        .orderBy(desc(cronHeartbeats.ranAt))
        .limit(1);
      const lastRanAt = lastRow?.ranAt ? new Date(lastRow.ranAt).getTime() : 0;
      const minutesSince = Math.floor((Date.now() - lastRanAt) / 60_000);
      if (Date.now() - lastRanAt < STALE_THRESHOLD_MS) {
        // Sync is fresh — no alert needed
        await recordHeartbeat("sync-watchdog", `ok: last sync ${minutesSince}m ago`, false);
        return;
      }
      // Sync is stale — check if we already posted an alert in the last 2 hours
      const TWO_HOURS_MS = 2 * 60 * 60 * 1000;
      const recentAlert = await db
        .select({ id: opsChatMessages.id })
        .from(opsChatMessages)
        .where(and(
          eq(opsChatMessages.quickAction as any, "sync_watchdog"),
          gte(opsChatMessages.createdAt, new Date(Date.now() - TWO_HOURS_MS))
        ))
        .limit(1);
      if (recentAlert.length > 0) {
        // Already alerted recently — don't spam
        await recordHeartbeat("sync-watchdog", `stale (${minutesSince}m) but alert already posted`, false);
        return;
      }
      // Post the alert card to Command Chat
      const lastSyncStr = lastRanAt > 0
        ? new Date(lastRanAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "America/New_York" })
        : "never";
      await db.insert(opsChatMessages).values({
        channel: "command",
        from: "System",
        authorName: "System",
        authorRole: "system",
        body: `⚠️ Sync Alert — Today's schedule has not synced in ${minutesSince} minutes (last sync: ${lastSyncStr}). Jobs added to Launch27 since then may be missing from Field Management. Check the server or trigger a manual sync.`,
        metadata: JSON.stringify({ minutesSince, lastSyncStr }),
        quickAction: "sync_watchdog",
      } as any);
      const { broadcastOpsUpdate } = await import("./sseBroadcast");
      broadcastOpsUpdate("new_message");
      // Also notify the owner via push
      try {
        const { notifyOwner } = await import("./_core/notification");
        await notifyOwner({
          title: "⚠️ Schedule Sync Alert",
          content: `Today's schedule has not synced in ${minutesSince} minutes (last sync: ${lastSyncStr}). Jobs added to Launch27 may be missing from Field Management.`,
        });
      } catch (notifErr) {
        console.warn("[InternalCron] SyncWatchdog: owner notification failed (non-fatal):", notifErr);
      }
      console.warn(`[InternalCron] SyncWatchdog — STALE: last sync ${minutesSince}m ago (${lastSyncStr}). Alert posted to Command Chat.`);
      await recordHeartbeat("sync-watchdog", `ALERT: last sync ${minutesSince}m ago (${lastSyncStr})`, true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[InternalCron] SyncWatchdog failed:", msg);
      await recordHeartbeat("sync-watchdog", `error: ${msg}`, false);
    }
  }, { timezone: "America/New_York" });

  // ── Daily 7 AM ET: ops summary card ────────────────────────────────────────
  // Posts the daily ops summary to Command Chat (confirmed / unconfirmed / unassigned).
  // Fires immediately when all cleaners confirm; this 7 AM cron is the fallback.
  cron.schedule("0 0 7 * * *", async () => {
    console.log("[InternalCron] Running OpsSummary (7 AM fallback)...");
    try {
      const result = await postOpsSummary();
      const summary = `posted: ${result.posted}, date: ${result.date}, confirmed: ${result.confirmed}, unconfirmed: ${result.unconfirmed}`;
      console.log(`[InternalCron] OpsSummary — ${summary}`);
      await recordHeartbeat("ops-summary", summary, result.posted);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[InternalCron] OpsSummary failed:", msg);
      await recordHeartbeat("ops-summary", `error: ${msg}`, false);
    }
  }, { timezone: "America/New_York" });

  // ── Daily 6 PM ET: schedule confirmation SMS to cleaners ────────────────────
  // Sends "please confirm your schedule for tomorrow" SMS to all cleaners with jobs.
  cron.schedule("0 0 18 * * *", async () => {
    console.log("[InternalCron] Running ScheduleConfirmSend (6 PM)...");
    try {
      const result = await runScheduleConfirmSend();
      const summary = `teamsSent: ${result.teamsSent}, teamsFailed: ${result.teamsFailed}, missingPhone: ${result.teamsMissingPhone}`;
      console.log(`[InternalCron] ScheduleConfirmSend — ${summary}`);
      await recordHeartbeat("schedule-confirm-send", summary, result.teamsSent > 0);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[InternalCron] ScheduleConfirmSend failed:", msg);
      await recordHeartbeat("schedule-confirm-send", `error: ${msg}`, false);
    }
  }, { timezone: "America/New_York" });

  // ── Daily 8 PM ET: schedule confirmation nudge to still-unconfirmed cleaners ─
  // Re-sends confirmation request to cleaners who haven't replied since the 6 PM SMS.
  cron.schedule("0 0 20 * * *", async () => {
    console.log("[InternalCron] Running ScheduleConfirmNudge (8 PM)...");
    try {
      const result = await runScheduleConfirmNudge();
      const summary = `nudgesSent: ${result.nudgesSent}, alreadyConfirmed: ${result.alreadyConfirmed}, alreadyNudged: ${result.alreadyNudged}, errors: ${result.errors}`;
      console.log(`[InternalCron] ScheduleConfirmNudge — ${summary}`);
      await recordHeartbeat("schedule-confirm-nudge", summary, result.nudgesSent > 0);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[InternalCron] ScheduleConfirmNudge failed:", msg);
      await recordHeartbeat("schedule-confirm-nudge", `error: ${msg}`, false);
    }
  }, { timezone: "America/New_York" });

  // ── Daily 8 PM ET: escalation VAPI calls to unconfirmed cleaners ────────────
  // Places automated calls to any cleaner who still hasn't confirmed by 8 PM.
  // Flags non-responders in Command Chat for manual follow-up.
  cron.schedule("0 0 20 * * *", async () => {
    console.log("[InternalCron] Running ScheduleEscalation (8 PM)...");
    try {
      const result = await runEscalationCalls();
      const summary = `called: ${result.called}, skipped: ${result.skipped}, errors: ${result.errors}`;
      console.log(`[InternalCron] ScheduleEscalation — ${summary}`);
      await recordHeartbeat("schedule-escalation", summary, result.called > 0);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[InternalCron] ScheduleEscalation failed:", msg);
      await recordHeartbeat("schedule-escalation", `error: ${msg}`, false);
    }
  }, { timezone: "America/New_York" });

  // ── Daily 2 AM ET: message integrity check ─────────────────────────────────
  // Compares last-7-days message counts per active session against OpenPhone.
  // Flags sessions where OpenPhone has more messages than the DB (potential gaps).
  cron.schedule("0 0 2 * * *", async () => {
    console.log("[InternalCron] Running MessageIntegrityCheck (2 AM)...");
    try {
      const result = await runMessageIntegrityCheck();
      const summary = `checked: ${result.checked}, gaps: ${result.gaps}, errors: ${result.errors}`;
      console.log(`[InternalCron] MessageIntegrityCheck — ${summary}`);
      await recordHeartbeat("message-integrity", summary, result.gaps > 0);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[InternalCron] MessageIntegrityCheck failed:", msg);
      await recordHeartbeat("message-integrity", `error: ${msg}`, false);
    }
  }, { timezone: "America/New_York" });

  console.log("[InternalCron] All schedules registered:");
  console.log("  - SilenceFollowUp:    every 5 minutes");
  console.log("  - ScheduledFollowUp:  9 AM ET daily");
  console.log("  - NightlySync:        12:00 PM ET daily");
  console.log("  - TomorrowSync:       9:00 PM ET daily");
  console.log("  - TodaySync:          every hour 7 AM–8 PM ET");
  console.log("  - AlwaysOnSend:       10 AM ET Mon-Sat (gated by isActive flag)");
  console.log("  - TrackerLinkSend:    8 AM ET daily");
  console.log("  - AiCacheWarmUp:      every 30 minutes");
  console.log(`  - FieldMgmt:          every 5 min 6AM-10PM ET (ENABLED=${FIELD_MGMT_ENABLED})`);
  console.log("  - MetricsAiAlerts:    every hour (all 5 ranges)");
  console.log("  - VapiRefresh:        every hour at :30 (system prompt time context)");
  console.log("  - OpsSummary:         7 AM ET daily (fallback; also fires when all cleaners confirm)");
  console.log("  - ScheduleConfirm:    5 PM ET daily");
  console.log("  - ScheduleConfirmNudge: 7 PM ET daily");
  console.log("  - ScheduleEscalation: 8 PM ET daily");
}
