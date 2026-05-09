/**
 * callCommandCenterCron.ts
 *
 * Heartbeat-triggered endpoint that auto-raises "no_checkin" issues
 * for jobs that are 15+ minutes past their scheduled time with no check-in.
 *
 * Endpoint: POST /api/scheduled/call-center-no-checkin
 *
 * Registered as a project-level Heartbeat cron (runs every 15 minutes during
 * business hours). Does NOT auto-fire calls — it only raises issues so
 * dispatchers see the badge count and can decide to call.
 *
 * Auth: x-manus-cron-task-uid header (set by the Manus platform gateway).
 * The platform restricts /api/scheduled/* to cron callers only.
 */

import type { Express, Request, Response } from "express";
import { getDb } from "./db";
import { cleanerJobs, jobIssues } from "../drizzle/schema";
import { eq, and, isNull } from "drizzle-orm";
import { ENV } from "./_core/env";

const GRACE_MINUTES = 15;

export function registerCallCenterCronRoute(app: Express): void {
  app.post("/api/scheduled/call-center-no-checkin", async (req: Request, res: Response) => {
    try {
      // Validate this is a cron request from the Manus platform
      const cronTaskUid = req.headers["x-manus-cron-task-uid"] as string | undefined;
      // Also accept CRON_SECRET for backward compat / manual triggers
      const cronSecret = req.headers["x-cron-secret"] as string | undefined;

      const isAuthorized =
        !!cronTaskUid || // Manus Heartbeat gateway
        (process.env.CRON_SECRET && cronSecret === process.env.CRON_SECRET); // manual trigger

      if (!isAuthorized) {
        return res.status(403).json({ error: "Unauthorized — cron only" });
      }

      const db = await getDb();
      if (!db) return res.json({ ok: true, raised: 0, skipped: "db_unavailable" });

      const nowMs = Date.now();

      // Determine today's date in business timezone
      const todayStr = new Date().toLocaleDateString("en-CA", {
        timeZone: ENV.businessTimezone,
      }); // YYYY-MM-DD

      // Get all jobs for today that haven't checked in
      const jobs = await db
        .select({
          id: cleanerJobs.id,
          serviceDateTime: cleanerJobs.serviceDateTime,
          jobStatus: cleanerJobs.jobStatus,
          teamName: cleanerJobs.teamName,
          customerName: cleanerJobs.customerName,
          jobDate: cleanerJobs.jobDate,
        })
        .from(cleanerJobs)
        .where(eq(cleanerJobs.jobDate, todayStr));

      let raised = 0;
      let skipped = 0;

      const checkedInStatuses = ["arrived", "in_progress", "finishing_up", "wrapping_up", "completed"];

      for (const job of jobs) {
        if (!job.serviceDateTime) { skipped++; continue; }

        // Skip if already checked in
        if (job.jobStatus && checkedInStatuses.includes(job.jobStatus)) { skipped++; continue; }

        const scheduledMs = new Date(job.serviceDateTime).getTime();
        const minutesPast = (nowMs - scheduledMs) / 60_000;

        if (minutesPast < GRACE_MINUTES) { skipped++; continue; }

        // Check if we already have an open no_checkin issue for this job+date
        const existing = await db
          .select({ id: jobIssues.id })
          .from(jobIssues)
          .where(and(
            eq(jobIssues.cleanerJobId, job.id),
            eq(jobIssues.jobDate, todayStr),
            eq(jobIssues.issueType, "no_checkin"),
            isNull(jobIssues.resolvedAt),
          ))
          .limit(1);

        if (existing.length > 0) { skipped++; continue; }

        await db.insert(jobIssues).values({
          cleanerJobId: job.id,
          jobDate: todayStr,
          issueType: "no_checkin",
          raisedBy: "auto",
          raisedByName: "system",
          raisedAt: nowMs,
          notes: `Auto-raised: no check-in ${Math.round(minutesPast)} min past scheduled time`,
        });
        raised++;

        console.log(
          `[CallCenterCron] Auto-raised no_checkin issue for job ${job.id} ` +
          `(${job.teamName ?? "unknown team"} / ${job.customerName ?? "unknown client"}) ` +
          `— ${Math.round(minutesPast)} min late`
        );
      }

      console.log(`[CallCenterCron] Done. Raised: ${raised}, Skipped: ${skipped}`);
      return res.json({ ok: true, raised, skipped, date: todayStr });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[CallCenterCron] Error:", msg);
      return res.status(500).json({
        error: msg,
        stack: err instanceof Error ? err.stack : undefined,
        context: { url: req.url },
        timestamp: new Date().toISOString(),
      });
    }
  });
}
