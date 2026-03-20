/**
 * Nightly cron handler for Launch27 sync.
 *
 * This module exports:
 *  - `runNightlySync()` — called by the internal cron schedule at 10 PM every night
 *  - `registerCronRoutes(app)` — mounts the /api/cron/nightly-sync endpoint used by the
 *    Manus scheduler (HMAC-signed requests from the platform cron service)
 *
 * Security: requests to /api/cron/nightly-sync must include the header
 *   X-Cron-Secret: <CRON_SECRET env var>
 * If the secret is not set the endpoint is disabled for safety.
 */

import type { Express, Request, Response } from "express";
import { getCompletedBookingsForDate } from "./launch27";
import { getDb } from "./db";
import { completedJobs, completedJobBatches, syncRuns } from "../drizzle/schema";
import { eq, and } from "drizzle-orm";
import { extractUSDigits, isValidUSPhone } from "./routers";
import { notifyOwner } from "./_core/notification";
import { enrollNewlyEligible } from "./alwaysOnEngine";
import { sendAlwaysOnBatch } from "./alwaysOnSend";
import { sendPendingReviewSms } from "./reviewRouter";
import { sendApprovedRatingSms, queueRatingSms } from "./qualityRouter";
import { logActivity } from "./activityLogger";

/**
 * Write a sync run record to the database.
 * Non-fatal — errors here should never break the actual sync.
 */
async function recordSyncRun(
  params: {
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
  }
): Promise<void> {
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
    console.error("[SyncRuns] Failed to record sync run (non-fatal):", err);
  }
}

/**
 * Core sync logic — fetches yesterday's completed bookings from Launch27 and
 * inserts new records into completedJobs (deduplicates by phone + jobDate).
 */
export async function runNightlySync(targetDate?: string): Promise<{
  date: string;
  inserted: number;
  skipped: number;
  batchId: number | null;
  message: string;
  alwaysOnEnrolled?: Record<string, number>;
}> {
  const startedAt = new Date();
  const date =
    targetDate ??
    (() => {
      // Use Eastern Time for the date calculation so the cron running at
      // 10 PM ET (which is 2-3 AM UTC the next day) always picks up
      // the correct previous calendar day in ET, not UTC.
      const etNow = new Date(
        new Date().toLocaleString("en-US", { timeZone: "America/New_York" })
      );
      etNow.setDate(etNow.getDate() - 1);
      const yyyy = etNow.getFullYear();
      const mm = String(etNow.getMonth() + 1).padStart(2, "0");
      const dd = String(etNow.getDate()).padStart(2, "0");
      return `${yyyy}-${mm}-${dd}`;
    })();

  const db = await getDb();
  if (!db) {
    await recordSyncRun({ runType: "launch27-sync", status: "error", message: "DB unavailable", targetDate: date, startedAt, durationMs: Date.now() - startedAt.getTime() });
    return {
      date,
      inserted: 0,
      skipped: 0,
      batchId: null,
      message: "DB unavailable",
    };
  }

  const result = await getCompletedBookingsForDate(date);

  if (result.error) {
    const msg = `Launch27 error: ${result.error}`;
    await recordSyncRun({ runType: "launch27-sync", status: "error", message: msg, errorDetail: result.error, targetDate: date, startedAt, durationMs: Date.now() - startedAt.getTime() });
    return {
      date,
      inserted: 0,
      skipped: 0,
      batchId: null,
      message: msg,
    };
  }

  if (result.bookings.length === 0) {
    const msg = `No completed bookings found for ${date}`;
    await recordSyncRun({ runType: "launch27-sync", status: "skipped", message: msg, targetDate: date, startedAt, durationMs: Date.now() - startedAt.getTime() });
    return {
      date,
      inserted: 0,
      skipped: 0,
      batchId: null,
      message: msg,
    };
  }

  // Filter to valid US phones only
  const validBookings = result.bookings.filter((b) => {
    const digits = extractUSDigits(b.phone);
    return digits !== null && isValidUSPhone(digits);
  });

  const invalidCount = result.bookings.length - validBookings.length;

  if (validBookings.length === 0) {
    return {
      date,
      inserted: 0,
      skipped: result.bookings.length,
      batchId: null,
      message: `All ${result.bookings.length} bookings had invalid/non-US phone numbers`,
    };
  }

  // Create batch record
  const [batchInsert] = await db.insert(completedJobBatches).values({
    filename: `launch27-auto-${date}`,
    jobDate: date,
    totalCount: validBookings.length,
    sentCount: 0,
    positiveCount: 0,
    negativeCount: 0,
    reviewConfirmedCount: 0,
  });

  const batchId = (batchInsert as any).insertId as number;

  let inserted = 0;
  let skipped = 0;

  for (const b of validBookings) {
    const digits = extractUSDigits(b.phone)!;
    const normalizedPhone = `+1${digits}`;
    const jobDate = new Date(b.serviceDate).toISOString().slice(0, 10);

    // Deduplicate: same phone + same job date
    const existing = await db
      .select({ id: completedJobs.id })
      .from(completedJobs)
      .where(
        and(
          eq(completedJobs.phone, normalizedPhone),
          eq(completedJobs.jobDate, jobDate)
        )
      )
      .limit(1);

    if (existing.length > 0) {
      skipped++;
      continue;
    }

    // Determine reactivation eligibility
    const isOneTime = !b.frequency || /one.?time|once/i.test(b.frequency);
    const jobDateObj = new Date(jobDate);
    const reactivationDate = new Date(jobDateObj);
    reactivationDate.setDate(reactivationDate.getDate() + 30);
    const isAlreadyEligible = isOneTime || reactivationDate <= new Date();

    await db.insert(completedJobs).values({
      batchId,
      phone: normalizedPhone,
      name: b.fullName,
      firstName: b.firstName,
      email: b.email || null,
      address: b.address || null,
      serviceType: null,
      frequency: b.frequency || null,
      launch27BookingId: String(b.id),
      lastBookingPrice: b.totalRevenue ? Math.round(b.totalRevenue) : null,
      jobDate,
      status: "PENDING",
      reactivationEligible: isAlreadyEligible ? 1 : 0,
      reactivationEligibleAt: isAlreadyEligible ? new Date() : null,
    });

    inserted++;
  }

  const message = `Nightly sync for ${date}: inserted ${inserted} new jobs, skipped ${skipped + invalidCount} (${skipped} duplicates, ${invalidCount} invalid phones).`;

  // ── Always-On Campaign enrollment ─────────────────────────────────────────
  // After syncing, enroll any newly eligible contacts into the always-on groups.
  // This runs every night so new completedJobs are picked up as they become eligible.
  let alwaysOnEnrolled: Record<string, number> = {};
  try {
    alwaysOnEnrolled = await enrollNewlyEligible();
    const totalEnrolled = Object.values(alwaysOnEnrolled).reduce((a, b) => a + b, 0);
    if (totalEnrolled > 0) {
      console.log(`[AlwaysOn] Enrolled ${totalEnrolled} contacts:`, alwaysOnEnrolled);
    }
  } catch (enrollErr) {
    console.error("[AlwaysOn] Enrollment error (non-fatal):", enrollErr);
  }

  // ── Record sync run in health log ─────────────────────────────────────────
  const totalSkipped = skipped + invalidCount;
  const syncStatus = inserted > 0 ? "success" : totalSkipped > 0 ? "partial" : "skipped";
  await recordSyncRun({
    runType: "launch27-sync",
    status: syncStatus,
    message,
    recordsInserted: inserted,
    recordsSkipped: totalSkipped,
    enrollmentBreakdown: alwaysOnEnrolled,
    targetDate: date,
    startedAt,
    durationMs: Date.now() - startedAt.getTime(),
  });

  // Log nightly sync activity event
  logActivity({
    eventType: "nightly_sync",
    title: inserted > 0
      ? `✅ Nightly sync: ${inserted} jobs imported (${date})`
      : `⚠️ Nightly sync: no new jobs (${date})`,
    body: message,
    meta: { date, inserted, skipped: skipped + invalidCount, alwaysOnEnrolled, status: syncStatus },
  }).catch(() => {});

  // Notify owner on success if any new jobs were inserted
  if (inserted > 0) {
    const totalEnrolled = Object.values(alwaysOnEnrolled).reduce((a, b) => a + b, 0);
    const enrolledSummary = totalEnrolled > 0
      ? ` Always-On enrolled: ${totalEnrolled} new contacts (new-one-time: ${alwaysOnEnrolled["new-one-time"] ?? 0}, lapsed-one-time: ${alwaysOnEnrolled["lapsed-one-time"] ?? 0}, lapsed-recurring: ${alwaysOnEnrolled["lapsed-recurring"] ?? 0}, dormant: ${alwaysOnEnrolled["dormant"] ?? 0}).`
      : "";
    try {
      await notifyOwner({
        title: `Launch27 Nightly Sync — ${inserted} new jobs`,
        content: message + enrolledSummary,
      });
    } catch {
      // Non-fatal — notification failure should not break the sync
    }
  }

  return { date, inserted, skipped: skipped + invalidCount, batchId, message, alwaysOnEnrolled };
}

/**
 * Register the cron endpoints on the Express app.
 *
 * POST /api/cron/nightly-sync    — 10 PM ET nightly: sync Launch27 + enroll always-on
 * POST /api/cron/always-on-send  — 10 AM ET Mon–Sat: send always-on SMS batch
 *
 * Both require: X-Cron-Secret: <CRON_SECRET env var>
 */
export function registerCronRoutes(app: Express): void {
  // ── Nightly sync (10 PM ET) ────────────────────────────────────────────────
  app.post("/api/cron/nightly-sync", async (req: Request, res: Response) => {
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

    const dateOverride = typeof req.body?.date === "string" ? req.body.date : undefined;

    try {
      const result = await runNightlySync(dateOverride);
      res.json({ ok: true, ...result });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ ok: false, error: msg });
    }
  });

  // ── Always-On SMS send (10 AM ET, Mon–Sat) ────────────────────────────────
  app.post("/api/cron/always-on-send", async (req: Request, res: Response) => {
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

    const sendStartedAt = new Date();
    try {
      const results = await sendAlwaysOnBatch();
      const totalSent = results.reduce((sum, r) => sum + r.sent, 0);
      const totalFailed = results.reduce((sum, r) => sum + r.failed, 0);

      // Build per-group breakdown for health log
      const groupBreakdown: Record<string, { sent: number; failed: number }> = {};
      for (const r of results) {
        groupBreakdown[r.groupType] = { sent: r.sent, failed: r.failed };
      }

      // Record in health log
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

      // Log always_on_batch activity event
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

      // Notify owner if any messages were sent
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

      res.json({ ok: true, totalSent, totalFailed, groups: results });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await recordSyncRun({
        runType: "always-on-send",
        status: "error",
        message: `Always-on send failed: ${msg}`,
        errorDetail: msg,
        startedAt: sendStartedAt,
        durationMs: Date.now() - sendStartedAt.getTime(),
      });
      res.status(500).json({ ok: false, error: msg });
    }
  });

  // ── Review SMS send (10 AM ET daily) ─────────────────────────────────────
  // Sends the post-cleaning feedback SMS to customers whose job was yesterday.
  // Customers receive: "How did your cleaning go?" the morning after service.
  // Positive replies → Google review link + 10% off incentive.
  app.post("/api/cron/review-send", async (req: Request, res: Response) => {
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

    const startedAt = new Date();
    try {
      const sent = await sendPendingReviewSms();

      // Log activity
      logActivity({
        eventType: "review_send",
        title: sent > 0
          ? `⭐ Review SMS: ${sent} sent (10 AM daily)`
          : `Review SMS: no pending jobs`,
        body: sent > 0
          ? `Sent post-cleaning feedback SMS to ${sent} customer${sent !== 1 ? "s" : ""} from yesterday's jobs.`
          : "No jobs with jobDate <= yesterday were pending.",
        meta: { sent, durationMs: Date.now() - startedAt.getTime() },
      }).catch(() => {});

      // Notify owner if any were sent
      if (sent > 0) {
        try {
          await notifyOwner({
            title: `Review SMS — ${sent} sent`,
            content: `Sent post-cleaning feedback SMS to ${sent} customer${sent !== 1 ? "s" : ""} from yesterday's jobs. Positive replies will receive the Google review link + 10% off incentive automatically.`,
          });
        } catch {
          // Non-fatal
        }
      }

      res.json({ ok: true, sent, durationMs: Date.now() - startedAt.getTime() });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[ReviewSend] Cron error:", msg);
      res.status(500).json({ ok: false, error: msg });
    }
  });

  // ── Quality Rating SMS send (7 PM ET daily) ────────────────────────────────
  // Sends all admin-approved rating SMS messages to customers whose job was today.
  // Admin approves in the Quality tab before 7pm; this cron fires the actual sends.
  app.post("/api/cron/rating-sms-send", async (req: Request, res: Response) => {
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
    const startedAt = new Date();
    try {
      const { sent, failed } = await sendApprovedRatingSms();
      logActivity({
        eventType: "rating_sms_send",
        title: sent > 0
          ? `⭐ Rating SMS: ${sent} sent (7 PM ET)`
          : `Rating SMS: no approved messages pending`,
        body: sent > 0
          ? `Sent post-job rating SMS to ${sent} customer${sent !== 1 ? "s" : ""}. Failed: ${failed}.`
          : "No approved rating SMS pending for today.",
        meta: { sent, failed, durationMs: Date.now() - startedAt.getTime() },
      }).catch(() => {});
      if (sent > 0) {
        notifyOwner({
          title: `Quality Rating SMS — ${sent} sent`,
          content: `Sent post-job rating SMS to ${sent} customer${sent !== 1 ? "s" : ""} today. Failed: ${failed}. Replies will be tracked in the Quality dashboard.`,
        }).catch(() => {});
      }
      res.json({ ok: true, sent, failed, durationMs: Date.now() - startedAt.getTime() });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[RatingSend] Cron error:", msg);
      res.status(500).json({ ok: false, error: msg });
    }
  });
}
