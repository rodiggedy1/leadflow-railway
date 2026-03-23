/**
 * fieldMgmtRouter.ts
 * Field Management Log — tRPC procedures for the per-job communication timeline.
 *
 * Performance design:
 *   getJobsForDay(date) → 2 DB queries total (jobs + all log rows for those jobs),
 *                         returns jobs with their full timeline pre-embedded.
 *                         Zero per-job round trips needed from the UI.
 *
 *   getJobTimeline(jobId) → kept for backward compat / direct deep-links.
 */

import { z } from "zod";
import { eq, asc, inArray } from "drizzle-orm";
import { router, adminProcedure } from "./_core/trpc";
import { TRPCError } from "@trpc/server";
import { getDb } from "./db";
import { cleanerJobs, fieldMgmtLog, fieldMgmtSteps } from "../drizzle/schema";

// ── Human-readable labels for each step ──────────────────────────────────────

const STEP_LABELS: Record<string, {
  label: string;
  recipient: "cleaner" | "client" | "cs";
  kind: "sms" | "call" | "alert";
}> = {
  pre_job_reminder:    { label: "Pre-Job Reminder",        recipient: "cleaner", kind: "sms" },
  client_pre_job:      { label: "Pre-Job Notification",    recipient: "client",  kind: "sms" },
  client_on_the_way:   { label: "On the Way Notification", recipient: "client",  kind: "sms" },
  client_running_late: { label: "Running Late Alert",       recipient: "client",  kind: "sms" },
  arrived_checkin:     { label: "Arrival Check-In",        recipient: "cleaner", kind: "sms" },
  mid_job_nudge:       { label: "Mid-Job Nudge",           recipient: "cleaner", kind: "sms" },
  completion_flow:     { label: "Completion Checklist",    recipient: "cleaner", kind: "sms" },
  exception_sms:       { label: "No Check-In Alert",       recipient: "cleaner", kind: "sms" },
  exception_call:      { label: "Escalation Call",         recipient: "cleaner", kind: "call" },
  noshow_alert:        { label: "No-Show CS Alert",        recipient: "cs",      kind: "alert" },
};

// ── Human-readable labels for jobStatus values ────────────────────────────────

const STATUS_LABELS: Record<string, string> = {
  on_the_way:        "On the Way",
  arrived:           "Arrived",
  running_late:      "Running Late",
  in_progress:       "In Progress",
  completed:         "Completed",
  issue_at_property: "Issue at Property",
};

// ── Shared type for a single timeline event ───────────────────────────────────

export type TimelineEvent = {
  id: string;
  type: "sms_cleaner" | "sms_client" | "call" | "cs_alert" | "status_change";
  timestamp: Date;
  label: string;
  detail?: string;
  recipient?: string;
  success: boolean;
  errorDetail?: string;
  step?: string;
};

// ── Helper: derive event type from a log row ──────────────────────────────────

function deriveEventType(step: string): TimelineEvent["type"] {
  const meta = STEP_LABELS[step] ?? { recipient: "cleaner" as const, kind: "sms" as const };
  if (meta.recipient === "client") return "sms_client";
  if (meta.kind === "call") return "call";
  if (meta.kind === "alert") return "cs_alert";
  return "sms_cleaner";
}

// ── Helper: build timeline events from log rows + job status ─────────────────

function buildTimeline(
  logRows: Array<{
    id: number;
    step: string;
    success: number;
    smsSent: string | null;
    recipientPhone: string | null;
    errorDetail: string | null;
    firedAt: Date;
  }>,
  job: {
    id: number;
    jobStatus: string | null;
    updatedAt: Date;
    delayMinutes: number | null;
    issueNote: string | null;
  }
): TimelineEvent[] {
  const events: TimelineEvent[] = [];

  // 1. Automated step events from field_mgmt_log
  for (const row of logRows) {
    const meta = STEP_LABELS[row.step] ?? { label: row.step, recipient: "cleaner", kind: "sms" };
    events.push({
      id: `log-${row.id}`,
      type: deriveEventType(row.step),
      timestamp: new Date(row.firedAt),
      label: meta.label,
      detail: row.smsSent ?? undefined,
      recipient: row.recipientPhone ?? undefined,
      success: row.success === 1,
      errorDetail: row.errorDetail ?? undefined,
      step: row.step,
    });
  }

  // 2. Job status change event (synthesized from current status + updatedAt)
  if (job.jobStatus) {
    events.push({
      id: `status-${job.id}`,
      type: "status_change",
      timestamp: new Date(job.updatedAt),
      label: STATUS_LABELS[job.jobStatus] ?? job.jobStatus,
      detail:
        job.jobStatus === "running_late" && job.delayMinutes
          ? `${job.delayMinutes} min delay`
          : job.jobStatus === "issue_at_property" && job.issueNote
          ? job.issueNote
          : undefined,
      success: true,
      step: job.jobStatus,
    });
  }

  // Sort chronologically ascending
  events.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  return events;
}

// ── Router ────────────────────────────────────────────────────────────────────

export const fieldMgmtRouter = router({

  /**
   * Returns all cleaner jobs for a given date (YYYY-MM-DD) with:
   *   - job metadata (cleaner, address, service time, status)
   *   - full communication timeline pre-embedded (zero per-job queries needed)
   *   - step count summary
   *
   * Performance: exactly 2 DB queries regardless of job count.
   *   Query 1: SELECT * FROM cleaner_jobs WHERE jobDate = ? (uses idx_cleaner_jobs_job_date)
   *   Query 2: SELECT * FROM field_mgmt_log WHERE cleanerJobId IN (...)
   */
  getJobsForDay: adminProcedure
    .input(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      // Query 1: jobs for the day
      const jobs = await db
        .select({
          id: cleanerJobs.id,
          cleanerName: cleanerJobs.cleanerName,
          teamName: cleanerJobs.teamName,
          customerName: cleanerJobs.customerName,
          customerPhone: cleanerJobs.customerPhone,
          jobAddress: cleanerJobs.jobAddress,
          serviceDateTime: cleanerJobs.serviceDateTime,
          serviceType: cleanerJobs.serviceType,
          jobStatus: cleanerJobs.jobStatus,
          trackerToken: cleanerJobs.trackerToken,
          delayMinutes: cleanerJobs.delayMinutes,
          issueNote: cleanerJobs.issueNote,
          updatedAt: cleanerJobs.updatedAt,
          createdAt: cleanerJobs.createdAt,
        })
        .from(cleanerJobs)
        .where(eq(cleanerJobs.jobDate, input.date))
        .orderBy(cleanerJobs.serviceDateTime, cleanerJobs.cleanerName);

      if (jobs.length === 0) return [];

      // Query 2: all log rows for all jobs in one shot
      const jobIds = jobs.map((j) => j.id);
      const allLogRows = await db
        .select({
          id: fieldMgmtLog.id,
          cleanerJobId: fieldMgmtLog.cleanerJobId,
          step: fieldMgmtLog.step,
          success: fieldMgmtLog.success,
          smsSent: fieldMgmtLog.smsSent,
          recipientPhone: fieldMgmtLog.recipientPhone,
          errorDetail: fieldMgmtLog.errorDetail,
          firedAt: fieldMgmtLog.firedAt,
        })
        .from(fieldMgmtLog)
        .where(inArray(fieldMgmtLog.cleanerJobId, jobIds))
        .orderBy(asc(fieldMgmtLog.firedAt));

      // Group log rows by job ID
      const logsByJob = new Map<number, typeof allLogRows>();
      for (const row of allLogRows) {
        const existing = logsByJob.get(row.cleanerJobId) ?? [];
        existing.push(row);
        logsByJob.set(row.cleanerJobId, existing);
      }

      // Assemble final result: each job carries its timeline
      return jobs.map((job) => {
        const jobLogs = logsByJob.get(job.id) ?? [];
        const timeline = buildTimeline(jobLogs, job);
        const stepsFired = jobLogs.length;
        const stepsSuccess = jobLogs.filter((r) => r.success === 1).length;

        return {
          id: job.id,
          cleanerName: job.cleanerName,
          teamName: job.teamName,
          customerName: job.customerName,
          customerPhone: job.customerPhone,
          jobAddress: job.jobAddress,
          serviceDateTime: job.serviceDateTime,
          serviceType: job.serviceType,
          jobStatus: job.jobStatus,
          trackerToken: job.trackerToken,
          delayMinutes: job.delayMinutes,
          issueNote: job.issueNote,
          updatedAt: job.updatedAt,
          createdAt: job.createdAt,
          stepsFired,
          stepsSuccess,
          totalSteps: fieldMgmtSteps.length,
          timeline,
        };
      });
    }),

  /**
   * Returns the full communication timeline for a single job.
   * Kept for backward compatibility and direct deep-links.
   * The Log tab UI uses getJobsForDay (which pre-embeds timelines) instead.
   */
  getJobTimeline: adminProcedure
    .input(z.object({ cleanerJobId: z.number() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const jobRows = await db
        .select()
        .from(cleanerJobs)
        .where(eq(cleanerJobs.id, input.cleanerJobId))
        .limit(1);
      const job = jobRows[0];
      if (!job) throw new TRPCError({ code: "NOT_FOUND", message: "Job not found" });

      const logRows = await db
        .select()
        .from(fieldMgmtLog)
        .where(eq(fieldMgmtLog.cleanerJobId, input.cleanerJobId))
        .orderBy(asc(fieldMgmtLog.firedAt));

      const events = buildTimeline(logRows, job);

      return {
        job: {
          id: job.id,
          cleanerName: job.cleanerName,
          teamName: job.teamName,
          customerName: job.customerName,
          customerPhone: job.customerPhone,
          jobAddress: job.jobAddress,
          serviceDateTime: job.serviceDateTime,
          serviceType: job.serviceType,
          jobStatus: job.jobStatus,
          trackerToken: job.trackerToken,
          delayMinutes: job.delayMinutes,
          issueNote: job.issueNote,
        },
        events,
        stepsFired: logRows.length,
        stepsSuccess: logRows.filter((r) => r.success === 1).length,
        totalSteps: fieldMgmtSteps.length,
      };
    }),
});
