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
import { eq, and, sql, ne } from "drizzle-orm";
import { extractUSDigits, isValidUSPhone } from "./utils/phone";
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
 * Attempts to normalize phone numbers for all completedJobs rows flagged as phoneInvalid=1.
 *
 * Strategy (applied in order until one produces a valid 10-digit US number):
 *   1. Strip all non-digits — if result is 10 digits with valid NPA/NXX → done.
 *   2. If 11 digits starting with 1 → strip leading 1 → done.
 *   3. If 7 digits → prepend the most common DC/MD/VA area codes in sequence
 *      (202, 301, 240, 703, 571) and take the first valid match.
 *   4. Anything else → leave flagged.
 *
 * Rows that get fixed: phone updated to +1XXXXXXXXXX, phoneInvalid cleared to 0.
 * Rows that can't be fixed: remain phoneInvalid=1 with a server-side warning.
 *
 * Returns counts of { fixed, stillInvalid }.
 */
export async function normalizeInvalidPhones(): Promise<{ fixed: number; stillInvalid: number }> {
  const db = await getDb();
  if (!db) return { fixed: 0, stillInvalid: 0 };

  const flagged = await db
    .select({ id: completedJobs.id, phone: completedJobs.phone, name: completedJobs.name, launch27BookingId: completedJobs.launch27BookingId })
    .from(completedJobs)
    .where(ne(completedJobs.phoneInvalid, 0));

  if (flagged.length === 0) return { fixed: 0, stillInvalid: 0 };

  let fixed = 0;
  let stillInvalid = 0;

  for (const row of flagged) {
    const raw = row.phone ?? "";
    const normalized = tryNormalizePhone(raw);
    if (normalized) {
      await db
        .update(completedJobs)
        .set({ phone: normalized, phoneInvalid: 0 })
        .where(eq(completedJobs.id, row.id));
      console.log(`[PhoneNorm] Fixed booking ${row.launch27BookingId} (${row.name}): "${raw}" → "${normalized}"`);
      fixed++;
    } else {
      console.warn(`[PhoneNorm] Cannot normalize booking ${row.launch27BookingId} (${row.name}): "${raw}" — still flagged`);
      stillInvalid++;
    }
  }

  return { fixed, stillInvalid };
}

/**
 * Tries every normalization strategy on a raw phone string.
 * Returns a valid E.164 US number (+1XXXXXXXXXX) or null.
 */
function tryNormalizePhone(raw: string): string | null {
  if (!raw) return null;
  const digits = raw.replace(/[^\d]/g, "");

  // Strategy 1 & 2: standard 10- or 11-digit US number
  const direct = extractUSDigits(raw);
  if (direct) return `+1${direct}`;

  // Strategy 3: 7-digit local number — try common area codes
  if (digits.length === 7) {
    const areaCodes = ["202", "301", "240", "703", "571", "410", "443", "667"];
    for (const areaCode of areaCodes) {
      const candidate = extractUSDigits(areaCode + digits);
      if (candidate) return `+1${candidate}`;
    }
  }

  return null;
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

  // For future dates (today or tomorrow), we need ALL bookings (assigned, active, etc.)
  // not just "completed" ones — jobs won't be marked completed until after they happen.
  // For past dates (nightly sync), we only want completed jobs.
  const etNow = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
  const todayET = `${etNow.getFullYear()}-${String(etNow.getMonth() + 1).padStart(2, "0")}-${String(etNow.getDate()).padStart(2, "0")}`;
  const isFutureOrToday = date >= todayET;
  const result = await getCompletedBookingsForDate(date, isFutureOrToday ? { includeAll: true } : undefined);

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
    const msg = isFutureOrToday ? `No bookings found for ${date}` : `No completed bookings found for ${date}`;
    await recordSyncRun({ runType: "launch27-sync", status: "skipped", message: msg, targetDate: date, startedAt, durationMs: Date.now() - startedAt.getTime() });
    return {
      date,
      inserted: 0,
      skipped: 0,
      batchId: null,
      message: msg,
    };
  }

  // Include ALL bookings — jobs with invalid phones are flagged (phoneInvalid=1) instead of dropped.
  // This ensures every job appears in field management and reports.
  // SMS flows (review, reactivation, always-on) skip phoneInvalid=1 rows.
  const allBookings = result.bookings;
  let invalidCount = 0;

  // Create batch record
  const [batchInsert] = await db.insert(completedJobBatches).values({
    filename: `launch27-auto-${date}`,
    jobDate: date,
    totalCount: allBookings.length,
    sentCount: 0,
    positiveCount: 0,
    negativeCount: 0,
    reviewConfirmedCount: 0,
  });

  const batchId = (batchInsert as any).insertId as number;

  let inserted = 0;
  let skipped = 0;

  for (const b of allBookings) {
    const digits = extractUSDigits(b.phone);
    const isPhoneValid = digits !== null && isValidUSPhone(digits);
    const normalizedPhone = isPhoneValid ? `+1${digits!}` : (b.phone?.trim() || "invalid");
    if (!isPhoneValid) invalidCount++;
    const jobDate = new Date(b.serviceDate).toISOString().slice(0, 10);

    // Deduplicate by launch27BookingId + jobDate (phone may be invalid/missing)
    const existing = await db
      .select({ id: completedJobs.id })
      .from(completedJobs)
      .where(
        and(
          eq(completedJobs.launch27BookingId, String(b.id)),
          eq(completedJobs.jobDate, jobDate)
        )
      )
      .limit(1);

    if (existing.length > 0) {
      skipped++;
      continue;
    }

    // Reactivation eligibility: one-time customers ONLY (recurring customers are NEVER eligible),
    // and only after 30 days since job date (they need time to rebook on their own first).
    const isOneTime = !b.frequency || /one.?time|once/i.test(b.frequency);
    const jobDateObj = new Date(jobDate);
    const reactivationDate = new Date(jobDateObj);
    reactivationDate.setDate(reactivationDate.getDate() + 30);
    const isAlreadyEligible = isPhoneValid && isOneTime && reactivationDate <= new Date();

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
      bedrooms: b.bedrooms ?? null,
      bathrooms: b.bathrooms ?? null,
      lastBookingPrice: b.totalRevenue ? Math.round(b.totalRevenue) : null,
      jobDate,
      status: "PENDING",
      reactivationEligible: isAlreadyEligible ? 1 : 0,
      reactivationEligibleAt: isAlreadyEligible ? new Date() : null,
      phoneInvalid: isPhoneValid ? 0 : 1,
    });

    if (!isPhoneValid) {
      console.warn(`[NightlySync] Invalid phone for booking ${b.id} (${b.fullName}): "${b.phone}" — stored with phoneInvalid=1, excluded from SMS flows`);
    }

    inserted++;
  }

  // ── Phone normalization pass ────────────────────────────────────────────────
  // Attempt to fix any phoneInvalid=1 rows just inserted (and any pre-existing ones).
  // Runs only when there were flagged phones to avoid unnecessary DB round-trips.
  let phoneFixed = 0;
  let phoneStillInvalid = 0;
  if (invalidCount > 0) {
    try {
      const normResult = await normalizeInvalidPhones();
      phoneFixed = normResult.fixed;
      phoneStillInvalid = normResult.stillInvalid;
      if (phoneFixed > 0) {
        console.log(`[NightlySync] Phone normalization: fixed ${phoneFixed}, still invalid ${phoneStillInvalid}`);
      }
    } catch (normErr) {
      console.error("[NightlySync] Phone normalization error (non-fatal):", normErr);
    }
  }

  const message = `Nightly sync for ${date}: inserted ${inserted} new jobs (${invalidCount} flagged invalid phone, ${phoneFixed} auto-fixed), skipped ${skipped} duplicates.`;

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

  // Log nightly sync activity event — only when jobs were actually inserted to avoid feed spam
  if (inserted > 0) {
    logActivity({
      eventType: "nightly_sync",
      title: `✅ Nightly sync: ${inserted} jobs imported (${date})`,
      body: message,
      meta: { date, inserted, skipped: skipped + invalidCount, alwaysOnEnrolled, status: syncStatus },
    }).catch(() => {});
  }

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
  // ── TEMPORARILY DISABLED — review SMS paused to prevent sends to sample/test accounts ──
  app.post("/api/cron/review-send", (_req: Request, res: Response) => {
    res.status(503).json({ ok: false, error: "Review SMS cron is temporarily disabled." });
  });

  // ── Quality Rating SMS send (7 PM ET daily) ────────────────────────────────
  // Sends all admin-approved rating SMS messages to customers whose job was today.
  // Admin approves in the Quality tab before 7pm; this cron fires the actual sends.
  // ── TEMPORARILY DISABLED — rating SMS paused to prevent sends to sample/test accounts ──
  app.post("/api/cron/rating-sms-send", (_req: Request, res: Response) => {
    res.status(503).json({ ok: false, error: "Rating SMS cron is temporarily disabled." });
  });

  // ── Debug: dump cleaner_status cards ───────────────────────────────────────────────
  app.get("/api/cron/heartbeat-status", async (req: Request, res: Response) => {
    const secret = process.env.CRON_SECRET;
    if (!secret || req.headers["x-cron-secret"] !== secret) { res.status(401).json({ error: "Unauthorized" }); return; }
    try {
      const db = await getDb();
      if (!db) { res.status(503).json({ error: "DB unavailable" }); return; }
      const rows = await db.execute(sql.raw(`
        SELECT job_name, ran_at, result_summary
        FROM cron_heartbeats
        WHERE job_name IN ('field-mgmt', 'eta-call-trigger', 'today-sync-jobs', 'sync-watchdog')
        ORDER BY ran_at DESC
        LIMIT 20
      `));
      res.json(rows[0]);
    } catch (err) { res.status(500).json({ error: String(err) }); }
  });

  app.get("/api/cron/debug-cleaner-status", async (req: Request, res: Response) => {
    const secret = process.env.CRON_SECRET;
    if (!secret || req.headers["x-cron-secret"] !== secret) { res.status(401).json({ error: "Unauthorized" }); return; }
    try {
      const db = await getDb();
      if (!db) { res.status(503).json({ error: "DB unavailable" }); return; }
      const rows = await db.execute(sql.raw(`
        SELECT id, cleanerJobId, quickAction,
               JSON_UNQUOTE(JSON_EXTRACT(metadata, '$.cleanerName')) as cleanerName,
               JSON_UNQUOTE(JSON_EXTRACT(metadata, '$.status')) as status,
               JSON_UNQUOTE(JSON_EXTRACT(metadata, '$.cleanerJobId')) as metaJobId,
               createdAt
        FROM ops_chat_messages
        WHERE quickAction = 'cleaner_status'
        ORDER BY createdAt DESC
        LIMIT 20
      `));
      res.json(rows);
    } catch (err) { res.status(500).json({ error: String(err) }); }
  });
  // ── Daily 5 PM ET: schedule confirmation SMS to cleaner teams ──────────────
  app.post("/api/cron/schedule-confirm", async (req: Request, res: Response) => {
    const secret = process.env.CRON_SECRET;
    if (!secret) { res.status(503).json({ error: "CRON_SECRET missing" }); return; }
    if (req.headers["x-cron-secret"] !== secret) { res.status(401).json({ error: "Unauthorized" }); return; }
    const dateOverride = typeof req.body?.date === "string" ? req.body.date : undefined;
    try {
      const { runScheduleConfirmSend } = await import("./scheduleConfirmEngine");
      const result = await runScheduleConfirmSend(dateOverride);
      res.json({ ok: true, ...result });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ ok: false, error: msg });
    }
  });

  // ── Daily 7 PM ET: nudge unconfirmed cleaner teams ─────────────────────
  app.post("/api/cron/schedule-confirm-nudge", async (req: Request, res: Response) => {
    const secret = process.env.CRON_SECRET;
    if (!secret) { res.status(503).json({ error: "CRON_SECRET missing" }); return; }
    if (req.headers["x-cron-secret"] !== secret) { res.status(401).json({ error: "Unauthorized" }); return; }
    const dateOverride = typeof req.body?.date === "string" ? req.body.date : undefined;
    try {
      const { runScheduleConfirmNudge } = await import("./scheduleConfirmEngine");
      const result = await runScheduleConfirmNudge(dateOverride);
      res.json({ ok: true, ...result });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ ok: false, error: msg });
    }
  });

  // ── Daily 7 AM ET: post ops summary if not already posted ─────────────────
  app.post("/api/cron/ops-summary", async (req: Request, res: Response) => {
    const secret = process.env.CRON_SECRET;
    if (!secret) { res.status(503).json({ error: "CRON_SECRET missing" }); return; }
    if (req.headers["x-cron-secret"] !== secret) { res.status(401).json({ error: "Unauthorized" }); return; }
    try {
      const { postOpsSummary } = await import("./opsSummaryEngine");
      const result = await postOpsSummary();
      res.json({ ok: true, ...result });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[cron/ops-summary] Error:", msg);
      res.status(500).json({ ok: false, error: msg });
    }
  });

  // ── Daily 8 PM ET: escalation calls to unconfirmed cleaners ─────────────
  app.post("/api/cron/schedule-escalation", async (req: Request, res: Response) => {
    const secret = process.env.CRON_SECRET;
    if (!secret) { res.status(503).json({ error: "CRON_SECRET missing" }); return; }
    if (req.headers["x-cron-secret"] !== secret) { res.status(401).json({ error: "Unauthorized" }); return; }
    try {
      const { runEscalationCalls } = await import("./escalationEngine");
      const result = await runEscalationCalls();
      res.json({ ok: true, ...result });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[cron/schedule-escalation] Error:", msg);
      res.status(500).json({ ok: false, error: msg });
    }
  });

  // ── Nurture send: triggered externally every 5 min to work around Cloud Run idle scaling ──
  app.post("/api/cron/nurture-send", async (req: Request, res: Response) => {
    const secret = process.env.CRON_SECRET;
    if (!secret) { res.status(503).json({ error: "CRON_SECRET missing" }); return; }
    if (req.headers["x-cron-secret"] !== secret) { res.status(401).json({ error: "Unauthorized" }); return; }
    try {
      const { runNurtureSend } = await import("./nurtureCron");
      const result = await runNurtureSend();
      res.json({ ok: true, ...result });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ ok: false, error: msg });
    }
  });

  // ── One-shot: backfill cleanerJobId on existing cleaner_status cards ────────────────
  app.post("/api/cron/backfill-cleaner-job-id", async (req: Request, res: Response) => {
    const secret = process.env.CRON_SECRET;
    if (!secret) { res.status(503).json({ error: "CRON_SECRET missing" }); return; }
    if (req.headers["x-cron-secret"] !== secret) { res.status(401).json({ error: "Unauthorized" }); return; }
    try {
      const db = await getDb();
      if (!db) { res.status(503).json({ error: "DB unavailable" }); return; }
      const result = await db.execute(sql.raw(`
        UPDATE ops_chat_messages
        SET cleanerJobId = CAST(JSON_UNQUOTE(JSON_EXTRACT(metadata, '$.cleanerJobId')) AS UNSIGNED)
        WHERE quickAction = 'cleaner_status'
          AND cleanerJobId IS NULL
          AND JSON_EXTRACT(metadata, '$.cleanerJobId') IS NOT NULL
          AND JSON_UNQUOTE(JSON_EXTRACT(metadata, '$.cleanerJobId')) != 'null'
          AND JSON_UNQUOTE(JSON_EXTRACT(metadata, '$.cleanerJobId')) != '0'
      `));
      const rowsUpdated = (result as any)?.rowsAffected ?? (result as any)?.[0]?.affectedRows ?? 0;
      res.json({ ok: true, rowsUpdated });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });
}
