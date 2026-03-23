/**
 * fieldMgmtRouter.ts
 * Field Management Log — tRPC procedures for the per-job communication timeline.
 *
 * Procedures:
 *   fieldMgmt.getJobsForDay(date)       → jobs list with step-fired summary
 *   fieldMgmt.getJobTimeline(jobId)     → merged, sorted timeline for one job
 */

import { z } from "zod";
import { eq, asc, inArray } from "drizzle-orm";
import { router, adminAgentProcedure } from "./_core/trpc";
import { TRPCError } from "@trpc/server";
import { getDb } from "./db";
import { cleanerJobs, fieldMgmtLog, fieldMgmtSteps } from "../drizzle/schema";

// ── Human-readable labels for each step ──────────────────────────────────────

const STEP_LABELS: Record<string, { label: string; recipient: "cleaner" | "client" | "cs"; kind: "sms" | "call" | "alert" }> = {
  pre_job_reminder:   { label: "Pre-Job Reminder",        recipient: "cleaner", kind: "sms" },
  client_pre_job:     { label: "Pre-Job Notification",    recipient: "client",  kind: "sms" },
  client_on_the_way:  { label: "On the Way Notification", recipient: "client",  kind: "sms" },
  client_running_late:{ label: "Running Late Alert",       recipient: "client",  kind: "sms" },
  arrived_checkin:    { label: "Arrival Check-In",        recipient: "cleaner", kind: "sms" },
  mid_job_nudge:      { label: "Mid-Job Nudge",           recipient: "cleaner", kind: "sms" },
  completion_flow:    { label: "Completion Checklist",    recipient: "cleaner", kind: "sms" },
  exception_sms:      { label: "No Check-In Alert",       recipient: "cleaner", kind: "sms" },
  exception_call:     { label: "Escalation Call",         recipient: "cleaner", kind: "call" },
  noshow_alert:       { label: "No-Show CS Alert",        recipient: "cs",      kind: "alert" },
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

// ── Router ────────────────────────────────────────────────────────────────────

export const fieldMgmtRouter = router({

  /**
   * Returns all cleaner jobs for a given date (YYYY-MM-DD) with:
   *   - job metadata (cleaner, address, service time, status)
   *   - count of field_mgmt_log rows fired for each job
   */
  getJobsForDay: adminAgentProcedure
    .input(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      // Fetch all jobs for the day
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

      // Fetch step counts for all jobs in one query
      const jobIds = jobs.map((j) => j.id);
      const logRows = await db
        .select({
          cleanerJobId: fieldMgmtLog.cleanerJobId,
          step: fieldMgmtLog.step,
          success: fieldMgmtLog.success,
        })
        .from(fieldMgmtLog)
        .where(inArray(fieldMgmtLog.cleanerJobId, jobIds));

      const filteredLog = logRows;

      // Build step count map per job
      const stepCountMap = new Map<number, { total: number; success: number }>();
      for (const row of filteredLog) {
        const existing = stepCountMap.get(row.cleanerJobId) ?? { total: 0, success: 0 };
        existing.total++;
        if (row.success) existing.success++;
        stepCountMap.set(row.cleanerJobId, existing);
      }

      return jobs.map((job) => ({
        ...job,
        stepsFired: stepCountMap.get(job.id)?.total ?? 0,
        stepsSuccess: stepCountMap.get(job.id)?.success ?? 0,
        totalSteps: fieldMgmtSteps.length,
      }));
    }),

  /**
   * Returns the full communication timeline for a single job.
   * Merges field_mgmt_log rows (automated SMS/calls) with jobStatus events.
   * Sorted chronologically ascending.
   */
  getJobTimeline: adminAgentProcedure
    .input(z.object({ cleanerJobId: z.number() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      // Fetch the job
      const jobRows = await db
        .select()
        .from(cleanerJobs)
        .where(eq(cleanerJobs.id, input.cleanerJobId))
        .limit(1);
      const job = jobRows[0];
      if (!job) throw new TRPCError({ code: "NOT_FOUND", message: "Job not found" });

      // Fetch all field_mgmt_log rows for this job
      const logRows = await db
        .select()
        .from(fieldMgmtLog)
        .where(eq(fieldMgmtLog.cleanerJobId, input.cleanerJobId))
        .orderBy(asc(fieldMgmtLog.firedAt));

      // Build timeline events from log rows
      type TimelineEvent = {
        id: string;
        type: "sms_cleaner" | "sms_client" | "call" | "cs_alert" | "status_change";
        timestamp: Date;
        label: string;
        detail?: string;        // SMS content or status note
        recipient?: string;     // phone number
        success: boolean;
        errorDetail?: string;
        step?: string;          // fieldMgmtStep key
      };

      const events: TimelineEvent[] = [];

      // 1. Automated step events from field_mgmt_log
      for (const row of logRows) {
        const meta = STEP_LABELS[row.step] ?? { label: row.step, recipient: "cleaner", kind: "sms" };
        let type: TimelineEvent["type"] = "sms_cleaner";
        if (meta.recipient === "client") type = "sms_client";
        else if (meta.kind === "call") type = "call";
        else if (meta.kind === "alert") type = "cs_alert";

        events.push({
          id: `log-${row.id}`,
          type,
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
      //    We show the current status as a status_change event at updatedAt time,
      //    but only if a status has been set (not null).
      if (job.jobStatus) {
        events.push({
          id: `status-${job.id}`,
          type: "status_change",
          timestamp: new Date(job.updatedAt),
          label: STATUS_LABELS[job.jobStatus] ?? job.jobStatus,
          detail: job.jobStatus === "running_late" && job.delayMinutes
            ? `${job.delayMinutes} min delay`
            : job.jobStatus === "issue_at_property" && job.issueNote
            ? job.issueNote
            : undefined,
          success: true,
          step: job.jobStatus,
        });
      }

      // Sort all events chronologically
      events.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

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
