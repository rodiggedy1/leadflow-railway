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
 *
 * Test tools (admin only):
 *   fireStep            → manually fire any automation step on a job, all SMS
 *                         overridden to TEST_PHONE (+13029816191). Bypasses kill
 *                         switch and time windows so you can test any time.
 *   simulateStatusChange → set jobStatus on a job and trigger the corresponding
 *                         engine function (on_the_way → client SMS, arrived →
 *                         check-in SMS, etc.), all overridden to TEST_PHONE.
 */

import { z } from "zod";
import { eq, asc, inArray } from "drizzle-orm";
import { router, adminProcedure } from "./_core/trpc";
import { TRPCError } from "@trpc/server";
import { getDb } from "./db";
import { cleanerJobs, cleanerProfiles, fieldMgmtLog, fieldMgmtSteps } from "../drizzle/schema";
import { sendSms } from "./openphone";
import {
  parseServiceDateTime,
  formatTimeET,
  recordStep,
} from "./fieldMgmtEngine";

// ── Test override phone ───────────────────────────────────────────────────────
const TEST_PHONE = "+13029816191";

// Re-export ensureTrackerToken for use in this file (it's not exported from engine)
// We'll inline the token logic here since the engine doesn't export it.
async function getTrackerUrl(cleanerJobId: number): Promise<string> {
  const BASE_URL = "https://quote.maidinblack.com";
  const db = await getDb();
  if (!db) return BASE_URL;
  const rows = await db
    .select({ trackerToken: cleanerJobs.trackerToken })
    .from(cleanerJobs)
    .where(eq(cleanerJobs.id, cleanerJobId))
    .limit(1);
  const token = rows[0]?.trackerToken;
  if (!token) return BASE_URL;
  return `${BASE_URL}/track/${token}`;
}

function firstName(fullName: string | null | undefined): string {
  if (!fullName) return "there";
  return fullName.split(" ")[0] ?? fullName;
}

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

// ── Test-mode step builder ────────────────────────────────────────────────────
// Builds the SMS message for each step, using TEST_PHONE for all recipients.
// Mirrors the engine logic but bypasses kill switch and time windows.

async function buildAndSendTestStep(
  step: string,
  job: {
    id: number;
    cleanerName: string | null;
    teamName: string | null;
    customerName: string | null;
    customerPhone: string | null;
    jobAddress: string | null;
    serviceDateTime: string | null;
    serviceType: string | null;
    delayMinutes: number | null;
    cleanerProfileId: number;
  },
  cleanerEmail: string | null
): Promise<{ success: boolean; smsSent: string; recipientPhone: string; errorDetail?: string }> {
  const CLEANER_PORTAL_URL = "https://quote.maidinblack.com/cleaner";
  const cleanerFirst = firstName(job.cleanerName);
  const clientFirst = firstName(job.customerName);
  const loginEmail = cleanerEmail ?? "your login email";
  const address = job.jobAddress ?? "your address";
  const trackingLink = await getTrackerUrl(job.id);

  let serviceTime: Date | null = null;
  let timeStr = "your scheduled time";
  if (job.serviceDateTime) {
    serviceTime = parseServiceDateTime(job.serviceDateTime);
    if (serviceTime) timeStr = formatTimeET(serviceTime);
  }

  let msg = "";

  switch (step) {
    case "pre_job_reminder":
      msg = [
        `Hey ${cleanerFirst} — reminder for your cleaning at ${timeStr}.`,
        ``,
        `Before you arrive:`,
        `• Review notes: ${CLEANER_PORTAL_URL}`,
        `  (Login: ${loginEmail})`,
        `• Bring full supplies`,
        `• Be ready to check in + upload photos`,
        ``,
        `Set your status to "On the Way" in the app.`,
      ].join("\n");
      break;

    case "client_pre_job":
      msg = [
        `Hey ${clientFirst} — you're all set for your home cleaning today at ${timeStr} 😊`,
        ``,
        `You can follow your cleaning here: ${trackingLink}`,
        ``,
        `We'll update this in real time if anything changes, including arrival timing.`,
      ].join("\n");
      break;

    case "client_on_the_way": {
      let etaStr = timeStr;
      msg = [
        `Hi ${clientFirst}! Your Maids in Black team is on the way and will arrive at ${address} around ${etaStr}. 🚗`,
        ``,
        `Track their arrival in real time here: ${trackingLink}`,
        ``,
        `The best way to make sure everything is perfect is to take a quick look before they head out. A quick 1 minute walkthrough really helps.`,
        `Feel free to point anything out — they're happy to fix it on the spot.`,
        ``,
        `If you have any last-minute notes, reply here.`,
      ].join("\n");
      break;
    }

    case "client_running_late": {
      const delayStr = job.delayMinutes ? `${job.delayMinutes} minutes` : "a bit";
      msg = [
        `Hey ${clientFirst} — quick heads up, the team is running about ${delayStr} behind.`,
        ``,
        `You can follow their updated arrival here: ${trackingLink}`,
        ``,
        `Really appreciate your flexibility, and we do apologize for the delay. Look forward to seeing you soon. 🙏`,
      ].join("\n");
      break;
    }

    case "arrived_checkin":
      msg = [
        `You're checked in ✅`,
        ``,
        `Before starting:`,
        `Take photos of anything broken that you cannot be blamed for.`,
      ].join("\n");
      break;

    case "mid_job_nudge":
      msg = [
        `Quick check — everything going smoothly?`,
        ``,
        `Remember:`,
        `• Kitchens + bathrooms = highest priority`,
        `• Don't miss floors + surfaces`,
        ``,
        `Log in and double check your notes + checklist: ${CLEANER_PORTAL_URL}`,
        `(Login: ${loginEmail})`,
        ``,
        `Reply if any issues.`,
      ].join("\n");
      break;

    case "completion_flow":
      msg = [
        `Before leaving:`,
        ``,
        `1. Upload photos + double check notes + checklist: ${CLEANER_PORTAL_URL}`,
        `   (Login: ${loginEmail})`,
        `2. Confirm:`,
        `   • All rooms completed`,
        `   • Trash removed`,
        `   • Lights off / doors locked`,
        `   • Walk the client around and ask for a review`,
        ``,
        `Reply DONE when finished.`,
      ].join("\n");
      break;

    case "exception_sms":
      msg = `Hey — we haven't received your check-in. Is everything okay?`;
      break;

    case "noshow_alert":
      msg = [
        `🚨 No-Show Alert`,
        `Cleaner: ${job.cleanerName ?? "Unknown"}`,
        `Client: ${job.customerName ?? "Unknown"}`,
        `Address: ${address}`,
        `Scheduled: ${timeStr}`,
        ``,
        `No "On the Way" or "Arrived" received. Please call the cleaner and notify the client.`,
      ].join("\n");
      break;

    default:
      msg = `[Test] Step: ${step} — no message template defined.`;
  }

  const result = await sendSms({ to: TEST_PHONE, content: msg });
  return {
    success: result.success,
    smsSent: msg,
    recipientPhone: TEST_PHONE,
    errorDetail: result.success ? undefined : (result.error ?? "Unknown error"),
  };
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

  /**
   * TEST TOOL — Fire any automation step on a job immediately.
   *
   * Bypasses:
   *   - FIELD_MGMT_ENABLED kill switch
   *   - Time windows (T-2hrs, etc.)
   *   - stepAlreadyFired guard (always fires even if already sent)
   *
   * All SMS recipients are overridden to TEST_PHONE (+13029816191).
   * A new field_mgmt_log row is written with the test result.
   *
   * Admin only.
   */
  fireStep: adminProcedure
    .input(z.object({
      cleanerJobId: z.number(),
      step: z.enum(fieldMgmtSteps as unknown as [string, ...string[]]),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      // Load job
      const jobRows = await db
        .select({
          id: cleanerJobs.id,
          cleanerName: cleanerJobs.cleanerName,
          teamName: cleanerJobs.teamName,
          customerName: cleanerJobs.customerName,
          customerPhone: cleanerJobs.customerPhone,
          jobAddress: cleanerJobs.jobAddress,
          serviceDateTime: cleanerJobs.serviceDateTime,
          serviceType: cleanerJobs.serviceType,
          delayMinutes: cleanerJobs.delayMinutes,
          cleanerProfileId: cleanerJobs.cleanerProfileId,
          trackerToken: cleanerJobs.trackerToken,
        })
        .from(cleanerJobs)
        .where(eq(cleanerJobs.id, input.cleanerJobId))
        .limit(1);
      const job = jobRows[0];
      if (!job) throw new TRPCError({ code: "NOT_FOUND", message: "Job not found" });

      // Load cleaner email for portal login hint
      const profileRows = await db
        .select({ email: cleanerProfiles.email })
        .from(cleanerProfiles)
        .where(eq(cleanerProfiles.id, job.cleanerProfileId))
        .limit(1);
      const cleanerEmail = profileRows[0]?.email ?? null;

      // Build message + send to TEST_PHONE
      const result = await buildAndSendTestStep(input.step, job, cleanerEmail);

      // Log the test fire
      await recordStep({
        cleanerJobId: input.cleanerJobId,
        step: input.step,
        success: result.success,
        smsSent: `[TEST] ${result.smsSent}`,
        recipientPhone: TEST_PHONE,
        errorDetail: result.errorDetail,
      });

      console.log(
        `[FieldMgmt TEST] fireStep: job ${input.cleanerJobId}, step ${input.step} → ${result.success ? "OK" : "FAILED"}`
      );

      return {
        success: result.success,
        step: input.step,
        recipientPhone: TEST_PHONE,
        smsSent: result.smsSent,
        errorDetail: result.errorDetail,
      };
    }),

  /**
   * TEST TOOL — Simulate a cleaner status change.
   *
   * Updates jobStatus on the job row and fires the corresponding engine step
   * with TEST_PHONE overriding all recipients. Simulates exactly what happens
   * when a cleaner taps a button in the app.
   *
   * Status → engine step mapping:
   *   on_the_way   → client_on_the_way SMS (to client)
   *   arrived      → arrived_checkin SMS (to cleaner)
   *   running_late → client_running_late SMS (to client) — also accepts delayMinutes
   *   completed    → completion_flow SMS (to cleaner)
   *   issue_at_property → exception_sms (to cleaner) — also accepts issueNote
   *
   * Admin only.
   */
  simulateStatusChange: adminProcedure
    .input(z.object({
      cleanerJobId: z.number(),
      status: z.enum(["on_the_way", "arrived", "running_late", "completed", "issue_at_property"]),
      delayMinutes: z.number().optional(),
      issueNote: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      // Update job status in DB (mirrors what cleanerRouter.updateJobStatus does)
      await db
        .update(cleanerJobs)
        .set({
          jobStatus: input.status as any,
          ...(input.delayMinutes !== undefined ? { delayMinutes: input.delayMinutes } : {}),
          ...(input.issueNote !== undefined ? { issueNote: input.issueNote } : {}),
        })
        .where(eq(cleanerJobs.id, input.cleanerJobId));

      // Load updated job
      const jobRows = await db
        .select({
          id: cleanerJobs.id,
          cleanerName: cleanerJobs.cleanerName,
          teamName: cleanerJobs.teamName,
          customerName: cleanerJobs.customerName,
          customerPhone: cleanerJobs.customerPhone,
          jobAddress: cleanerJobs.jobAddress,
          serviceDateTime: cleanerJobs.serviceDateTime,
          serviceType: cleanerJobs.serviceType,
          delayMinutes: cleanerJobs.delayMinutes,
          cleanerProfileId: cleanerJobs.cleanerProfileId,
          trackerToken: cleanerJobs.trackerToken,
        })
        .from(cleanerJobs)
        .where(eq(cleanerJobs.id, input.cleanerJobId))
        .limit(1);
      const job = jobRows[0];
      if (!job) throw new TRPCError({ code: "NOT_FOUND", message: "Job not found" });

      const profileRows = await db
        .select({ email: cleanerProfiles.email })
        .from(cleanerProfiles)
        .where(eq(cleanerProfiles.id, job.cleanerProfileId))
        .limit(1);
      const cleanerEmail = profileRows[0]?.email ?? null;

      // Map status → step
      const statusToStep: Record<string, string> = {
        on_the_way:        "client_on_the_way",
        arrived:           "arrived_checkin",
        running_late:      "client_running_late",
        completed:         "completion_flow",
        issue_at_property: "exception_sms",
      };
      const step = statusToStep[input.status];
      if (!step) throw new TRPCError({ code: "BAD_REQUEST", message: `No step mapped for status: ${input.status}` });

      const result = await buildAndSendTestStep(step, job, cleanerEmail);

      await recordStep({
        cleanerJobId: input.cleanerJobId,
        step,
        success: result.success,
        smsSent: `[TEST] ${result.smsSent}`,
        recipientPhone: TEST_PHONE,
        errorDetail: result.errorDetail,
      });

      console.log(
        `[FieldMgmt TEST] simulateStatusChange: job ${input.cleanerJobId}, status ${input.status} → step ${step} → ${result.success ? "OK" : "FAILED"}`
      );

      return {
        success: result.success,
        status: input.status,
        step,
        recipientPhone: TEST_PHONE,
        smsSent: result.smsSent,
        errorDetail: result.errorDetail,
      };
    }),
});
