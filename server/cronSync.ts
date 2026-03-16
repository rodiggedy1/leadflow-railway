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
import { completedJobs, completedJobBatches } from "../drizzle/schema";
import { eq, and } from "drizzle-orm";
import { extractUSDigits, isValidUSPhone } from "./routers";
import { notifyOwner } from "./_core/notification";

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
}> {
  const date =
    targetDate ??
    (() => {
      const d = new Date();
      d.setDate(d.getDate() - 1);
      return d.toISOString().slice(0, 10);
    })();

  const db = await getDb();
  if (!db) {
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
    return {
      date,
      inserted: 0,
      skipped: 0,
      batchId: null,
      message: `Launch27 error: ${result.error}`,
    };
  }

  if (result.bookings.length === 0) {
    return {
      date,
      inserted: 0,
      skipped: 0,
      batchId: null,
      message: `No completed bookings found for ${date}`,
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

  // Notify owner on success if any new jobs were inserted
  if (inserted > 0) {
    try {
      await notifyOwner({
        title: `Launch27 Nightly Sync — ${inserted} new jobs`,
        content: message,
      });
    } catch {
      // Non-fatal — notification failure should not break the sync
    }
  }

  return { date, inserted, skipped: skipped + invalidCount, batchId, message };
}

/**
 * Register the cron endpoint on the Express app.
 * POST /api/cron/nightly-sync
 * Header: X-Cron-Secret: <value of CRON_SECRET env var>
 */
export function registerCronRoutes(app: Express): void {
  app.post("/api/cron/nightly-sync", async (req: Request, res: Response) => {
    const secret = process.env.CRON_SECRET;

    // If CRON_SECRET is not configured, disable the endpoint
    if (!secret) {
      res.status(503).json({ error: "Cron endpoint is not configured (CRON_SECRET missing)" });
      return;
    }

    const provided = req.headers["x-cron-secret"];
    if (provided !== secret) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    // Optional: allow caller to specify a date override (for backfill)
    const dateOverride = typeof req.body?.date === "string" ? req.body.date : undefined;

    try {
      const result = await runNightlySync(dateOverride);
      res.json({ ok: true, ...result });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ ok: false, error: msg });
    }
  });
}
