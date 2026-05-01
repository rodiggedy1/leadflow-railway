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
import { eq, asc, desc, gte, gt, inArray, notInArray, and } from "drizzle-orm";
import { router, agentProcedure } from "./_core/trpc";
import { TRPCError } from "@trpc/server";
import { getDb } from "./db";
import { cleanerJobs, cleanerProfiles, fieldMgmtLog, fieldMgmtSteps, jobStatusHistory, jobSmsReplies, fieldMgmtCalls, cleanerMagicLinkTokens } from "../drizzle/schema";
import { sendSms } from "./openphone";
import {
  parseServiceDateTime,
  formatTimeET,
  recordStep,
  placeNoCheckinEscalationCall,
  placeNoCheckinEscalationCallWithReason,
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
  noshow_call:         { label: "No-Show CS Call",         recipient: "cs",      kind: "call" },
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
  logId?: number;  // numeric DB row ID — present for field_mgmt_log events, absent for synthetic status_change events
  type: "sms_cleaner" | "sms_client" | "call" | "cs_alert" | "status_change";
  status: "sent" | "failed" | "pending" | "status_change";  // display state
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

// ── Ordered step sequence with expected fire times ───────────────────────────
// Each entry defines: step key, human label, recipient, kind, and a function
// that computes the expected fire time from serviceDateTime.
// Status-triggered steps (on_the_way, arrived, completed, etc.) have no
// predictable time — they show as "pending" until the status fires them.

const STEP_SEQUENCE: Array<{
  step: string;
  label: string;
  recipient: "cleaner" | "client" | "cs";
  kind: "sms" | "call" | "alert";
  // Returns expected fire time, or null if time is status-triggered (unpredictable)
  expectedTime: (serviceDateTime: Date) => Date | null;
}> = [
  {
    step: "pre_job_reminder",
    label: "Pre-Job Reminder",
    recipient: "cleaner",
    kind: "sms",
    expectedTime: (t) => new Date(t.getTime() - 2 * 60 * 60 * 1000), // T-2hrs
  },
  {
    step: "client_pre_job",
    label: "Pre-Job Notification",
    recipient: "client",
    kind: "sms",
    expectedTime: (t) => new Date(t.getTime() - 2 * 60 * 60 * 1000 + 90 * 1000), // T-2hrs + 90s (after cleaner reminder)
  },
  {
    step: "client_on_the_way",
    label: "On the Way Notification",
    recipient: "client",
    kind: "sms",
    expectedTime: () => null, // status-triggered: on_the_way
  },
  {
    step: "arrived_checkin",
    label: "Arrival Check-In",
    recipient: "cleaner",
    kind: "sms",
    expectedTime: () => null, // status-triggered: arrived
  },
  {
    step: "mid_job_nudge",
    label: "Mid-Job Nudge",
    recipient: "cleaner",
    kind: "sms",
    expectedTime: (t) => new Date(t.getTime() + 45 * 60 * 1000), // ~T+45min (after arrived)
  },
  {
    step: "completion_flow",
    label: "Completion Checklist",
    recipient: "cleaner",
    kind: "sms",
    expectedTime: () => null, // status-triggered: completed
  },
  {
    step: "exception_sms",
    label: "No Check-In Alert",
    recipient: "cleaner",
    kind: "sms",
    expectedTime: (t) => new Date(t.getTime() - 30 * 60 * 1000), // T-30min (if no arrived)
  },
  {
    step: "exception_call",
    label: "Escalation Call",
    recipient: "cleaner",
    kind: "call",
    expectedTime: (t) => new Date(t.getTime() - 30 * 60 * 1000), // same window as exception_sms
  },
  {
    step: "noshow_alert",
    label: "No-Show CS Alert",
    recipient: "cs",
    kind: "alert",
    expectedTime: (t) => new Date(t.getTime() - 10 * 60 * 1000), // T-10min
  },
  {
    step: "client_running_late",
    label: "Running Late Alert",
    recipient: "client",
    kind: "sms",
    expectedTime: () => null, // status-triggered: running_late
  },
  {
    step: "noshow_call",
    label: "No-Show CS Call",
    recipient: "cs",
    kind: "call",
    expectedTime: (t) => new Date(t.getTime() - 0 * 60 * 1000), // T (10min after noshow_alert)
  },
];

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
    serviceDateTime: string | null;
    delayMinutes: number | null;
    issueNote: string | null;
  },
  statusHistory: Array<{
    id: number;
    status: string;
    source: string;
    changedAt: Date;
  }> = []
): TimelineEvent[] {
  const events: TimelineEvent[] = [];

  // Index log rows by step for O(1) lookup
  const logByStep = new Map<string, typeof logRows[0]>();
  for (const row of logRows) {
    // Keep the most recent row per step (in case of retries)
    const existing = logByStep.get(row.step);
    if (!existing || new Date(row.firedAt) > new Date(existing.firedAt)) {
      logByStep.set(row.step, row);
    }
  }

  const serviceTime = job.serviceDateTime ? parseServiceDateTime(job.serviceDateTime) : null;
  const now = new Date();

  // ── Step classification ───────────────────────────────────────────────────
  // TIME-BASED: always expected to fire at a specific time relative to serviceDateTime.
  //   If the window has passed and no log row exists → show as "failed" (red).
  // STATUS-TRIGGERED: only fire when cleaner taps a button (on_the_way, arrived, etc.).
  //   Never "failed" if not fired — only show if a log row exists.
  // CONDITIONAL: only fire if something went wrong (no check-in, no-show).
  //   Only show if a log row exists.
  const TIME_BASED_STEPS = new Set(["pre_job_reminder", "client_pre_job"]);

  // 1. Process each step in the defined sequence
  for (const stepDef of STEP_SEQUENCE) {
    const row = logByStep.get(stepDef.step);
    const type = deriveEventType(stepDef.step);

    if (row) {
      // Step fired — show real result (sent or failed)
      events.push({
        id: `log-${row.id}`,
        logId: row.id,
        type,
        status: row.success === 1 ? "sent" : "failed",
        timestamp: new Date(row.firedAt),
        label: stepDef.label,
        detail: row.smsSent ?? undefined,
        recipient: row.recipientPhone ?? undefined,
        success: row.success === 1,
        errorDetail: row.errorDetail ?? undefined,
        step: stepDef.step,
      });
    } else if (TIME_BASED_STEPS.has(stepDef.step)) {
      // Time-based step that didn't fire — only show if its window has passed
      const expectedTs = serviceTime ? stepDef.expectedTime(serviceTime) : null;
      if (expectedTs && expectedTs <= now) {
        // Window passed, never fired — show as failed
        events.push({
          id: `missed-${stepDef.step}-${job.id}`,
          type,
          status: "failed",
          timestamp: expectedTs,
          label: stepDef.label,
          errorDetail: "Step was not fired by the engine",
          success: false,
          step: stepDef.step,
        });
      }
      // Future time-based step — hide entirely
    }
    // Status-triggered and conditional steps: only show if log row exists (handled above)
    // If no log row → skip entirely, never show as pending or failed
  }

  // 2. Status change events — from jobStatusHistory audit log
  // Each row is a distinct status tap by the cleaner (or engine auto-transition).
  // These show as trigger events BEFORE the resulting SMS in the timeline.
  const STATUS_TRIGGER_LABELS: Record<string, string> = {
    on_the_way: "Cleaner set On the Way in app",
    arrived: "Cleaner checked in at property",
    in_progress: "Job marked In Progress",
    running_late: "Cleaner marked Running Late",
    completed: "Cleaner marked Completed",
    issue_at_property: "Cleaner reported issue at property",
  };

  if (statusHistory.length > 0) {
    // Use the rich history log — one event per status tap
    for (const h of statusHistory) {
      events.push({
        id: `sh-${h.id}`,
        type: "status_change",
        status: "status_change",
        timestamp: new Date(h.changedAt),
        label: STATUS_TRIGGER_LABELS[h.status] ?? h.status,
        detail:
          h.status === "running_late" && job.delayMinutes
            ? `${job.delayMinutes} min delay`
            : h.status === "issue_at_property" && job.issueNote
            ? job.issueNote
            : undefined,
        success: true,
        step: h.status,
      });
    }
  } else if (job.jobStatus) {
    // Fallback for jobs before history logging was added: show current status with updatedAt
    events.push({
      id: `status-${job.id}`,
      type: "status_change",
      status: "status_change",
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

    case "checkin_call_attempt_1":
    case "checkin_call_attempt_2":
    case "checkin_call_attempt_3": {
      // VAPI call — not an SMS. Place the actual call to TEST_PHONE.
      const attemptNum = step === "checkin_call_attempt_1" ? 1 : step === "checkin_call_attempt_2" ? 2 : 3;
      const callResult = await placeNoCheckinEscalationCallWithReason({
        cleanerName: job.cleanerName ?? "Test Cleaner",
        customerName: job.customerName ?? "Test Client",
        jobAddress: address,
        scheduledTime: timeStr,
        cleanerJobId: job.id,
        step,
        cleanerPhone: TEST_PHONE,
      });
      return {
        success: callResult.success,
        smsSent: `[VAPI Call] T-${58 - (attemptNum - 1) * 2}min check-in call attempt ${attemptNum} → ${TEST_PHONE}`,
        recipientPhone: TEST_PHONE,
        errorDetail: callResult.success ? undefined : (callResult.reason ?? "VAPI call failed"),
      };
    }
    case "post_start_call_1":
    case "post_start_call_2": {
      const callResult = await placeNoCheckinEscalationCallWithReason({
        cleanerName: job.cleanerName ?? "Test Cleaner",
        customerName: job.customerName ?? "Test Client",
        jobAddress: address,
        scheduledTime: timeStr,
        cleanerJobId: job.id,
        step,
        cleanerPhone: TEST_PHONE,
      });
      return {
        success: callResult.success,
        smsSent: `[VAPI Call] ${step === "post_start_call_1" ? "T+0–5min" : "T+10–15min"} post-start call → ${TEST_PHONE}`,
        recipientPhone: TEST_PHONE,
        errorDetail: callResult.success ? undefined : (callResult.reason ?? "VAPI call failed"),
      };
    }
    case "post_start_cs_alert":
      msg = [
        `🚨 OVERDUE — No Check-In`,
        `Cleaner: ${job.cleanerName ?? "Unknown"}`,
        `Client: ${job.customerName ?? "Unknown"} at ${address}`,
        `Scheduled: ${timeStr}`,
        ``,
        `Job started ~5 min ago. No status received. Please call the cleaner immediately.`,
      ].join("\n");
      break;
    case "post_start_noshow_flag":
      // This step posts a Command Chat card — send an SMS summary to TEST_PHONE for test purposes
      msg = `[Test] post_start_noshow_flag — In production this posts a Command Chat card (quickAction: possible_noshow) for ${job.cleanerName ?? "Unknown"} / ${job.customerName ?? "Unknown"} at ${address}.`;
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
  getJobsForDay: agentProcedure
    .input(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      // Query 1: jobs for the day (left-join cleanerProfiles to get cleaner phone)
      const jobs = await db
        .select({
          id: cleanerJobs.id,
          cleanerName: cleanerJobs.cleanerName,
          teamName: cleanerJobs.teamName,
          customerName: cleanerJobs.customerName,
          customerPhone: cleanerJobs.customerPhone,
          cleanerPhone: cleanerProfiles.phone,
          jobAddress: cleanerJobs.jobAddress,
          serviceDateTime: cleanerJobs.serviceDateTime,
          serviceType: cleanerJobs.serviceType,
          bedrooms: cleanerJobs.bedrooms,
          bathrooms: cleanerJobs.bathrooms,
          jobStatus: cleanerJobs.jobStatus,
          trackerToken: cleanerJobs.trackerToken,
          delayMinutes: cleanerJobs.delayMinutes,
          issueNote: cleanerJobs.issueNote,
          etaTimestamp: cleanerJobs.etaTimestamp,
          updatedAt: cleanerJobs.updatedAt,
          createdAt: cleanerJobs.createdAt,
          bookingStatus: cleanerJobs.bookingStatus,
          cleanerProfileId: cleanerJobs.cleanerProfileId,
        })
        .from(cleanerJobs)
        .leftJoin(cleanerProfiles, eq(cleanerJobs.cleanerProfileId, cleanerProfiles.id))
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

      // Query 3: all status history rows for all jobs in one shot
      const allStatusHistory = await db
        .select({
          id: jobStatusHistory.id,
          cleanerJobId: jobStatusHistory.cleanerJobId,
          status: jobStatusHistory.status,
          source: jobStatusHistory.source,
          changedAt: jobStatusHistory.changedAt,
        })
        .from(jobStatusHistory)
        .where(inArray(jobStatusHistory.cleanerJobId, jobIds))
        .orderBy(asc(jobStatusHistory.changedAt));

      // Query 4: fetch valid magic link tokens for all cleaners in today's jobs
      const cleanerProfileIds = Array.from(new Set(jobs.map(j => j.cleanerProfileId).filter((id): id is number => id != null)));
      const magicTokenMap = new Map<number, string>();
      if (cleanerProfileIds.length > 0) {
        const now = new Date();
        const tokens = await db
          .select({ cleanerProfileId: cleanerMagicLinkTokens.cleanerProfileId, token: cleanerMagicLinkTokens.token })
          .from(cleanerMagicLinkTokens)
          .where(
            and(
              inArray(cleanerMagicLinkTokens.cleanerProfileId, cleanerProfileIds),
              eq(cleanerMagicLinkTokens.used, 0),
              gt(cleanerMagicLinkTokens.expiresAt, now)
            )
          )
          .orderBy(asc(cleanerMagicLinkTokens.createdAt));
        for (const t of tokens) {
          if (!magicTokenMap.has(t.cleanerProfileId)) {
            magicTokenMap.set(t.cleanerProfileId, t.token);
          }
        }
      }

      // Group log rows by job ID
      const logsByJob = new Map<number, typeof allLogRows>();
      for (const row of allLogRows) {
        const existing = logsByJob.get(row.cleanerJobId) ?? [];
        existing.push(row);
        logsByJob.set(row.cleanerJobId, existing);
      }

      // Group status history rows by job ID
      const statusHistoryByJob = new Map<number, typeof allStatusHistory>();
      for (const row of allStatusHistory) {
        const existing = statusHistoryByJob.get(row.cleanerJobId) ?? [];
        existing.push(row);
        statusHistoryByJob.set(row.cleanerJobId, existing);
      }

      // Assemble final result: each job carries its timeline
      return jobs.map((job) => {
        const jobLogs = logsByJob.get(job.id) ?? [];
        const statusHistory = statusHistoryByJob.get(job.id) ?? [];
        const timeline = buildTimeline(jobLogs, job, statusHistory);
        const stepsFired = jobLogs.length;
        const stepsSuccess = jobLogs.filter((r) => r.success === 1).length;

        return {
          id: job.id,
          cleanerName: job.cleanerName,
          teamName: job.teamName,
          customerName: job.customerName,
          customerPhone: job.customerPhone,
          cleanerPhone: job.cleanerPhone ?? null,
          jobAddress: job.jobAddress,
          serviceDateTime: job.serviceDateTime,
          serviceType: job.serviceType,
          bedrooms: job.bedrooms,
          bathrooms: job.bathrooms,
          jobStatus: job.jobStatus,
          trackerToken: job.trackerToken,
          delayMinutes: job.delayMinutes,
          issueNote: job.issueNote,
          etaTimestamp: job.etaTimestamp,
          updatedAt: job.updatedAt,
          createdAt: job.createdAt,
          stepsFired,
          stepsSuccess,
          totalSteps: fieldMgmtSteps.length,
          timeline,
          bookingStatus: job.bookingStatus,
          cleanerProfileId: job.cleanerProfileId,
          magicLinkToken: job.cleanerProfileId != null ? (magicTokenMap.get(job.cleanerProfileId) ?? null) : null,
        };
      });
    }),

  /**
   * Returns the full communication timeline for a single job.
   * Kept for backward compatibility and direct deep-links.
   * The Log tab UI uses getJobsForDay (which pre-embeds timelines) instead.
   */
  getJobTimeline: agentProcedure
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
  fireStep: agentProcedure
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
  /**
   * RETRY — Re-fires a failed automation step using the real recipient phone number.
   *
   * Unlike fireStep (which always uses TEST_PHONE), retryStep:
   *   - Looks up the original log row by ID to get the real recipientPhone and smsSent
   *   - Sends to the REAL phone number (not TEST_PHONE)
   *   - Writes a new log row with the retry result (does NOT update the original row)
   *   - Only allowed on rows where success = 0
   *
   * Admin only.
   */
  retryStep: agentProcedure
    .input(z.object({
      logId: z.number(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      // Load the original failed log row
      const logRows = await db
        .select()
        .from(fieldMgmtLog)
        .where(eq(fieldMgmtLog.id, input.logId))
        .limit(1);
      const logRow = logRows[0];
      if (!logRow) throw new TRPCError({ code: "NOT_FOUND", message: "Log entry not found" });
      if (logRow.success === 1) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "This step already succeeded — retry not needed" });
      }
      if (!logRow.smsSent) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "No message body stored — cannot retry" });
      }
      if (!logRow.recipientPhone) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "No recipient phone stored — cannot retry" });
      }

      // Re-send to the REAL recipient phone (normalizePhone is called inside sendSms)
      const result = await sendSms({
        to: logRow.recipientPhone,
        content: logRow.smsSent,
      });

      // Write a new log row for the retry attempt
      await recordStep({
        cleanerJobId: logRow.cleanerJobId,
        step: logRow.step,
        success: result.success,
        smsSent: logRow.smsSent,
        recipientPhone: logRow.recipientPhone,
        errorDetail: result.success ? undefined : result.error,
      });

      console.log(
        `[FieldMgmt] retryStep: logId ${input.logId}, step ${logRow.step}, job ${logRow.cleanerJobId} → ${result.success ? "OK" : "FAILED"}`
      );

      return {
        success: result.success,
        step: logRow.step,
        recipientPhone: logRow.recipientPhone,
        errorDetail: result.success ? undefined : result.error,
      };
    }),

  simulateStatusChange: agentProcedure
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

  /**
   * Manually confirm a job assignment when Launch27 returns bookingStatus='new'
   * but the job is already on the cleaner's schedule. Sets bookingStatus to
   * 'assigned' so the automation engine picks it up for pre-job reminders etc.
   */
  /**
   * Returns all SMS messages (outbound + inbound replies) for a job.
   * Used by the Messages tab in the job detail panel.
   */
  getJobMessages: agentProcedure
    .input(z.object({ cleanerJobId: z.number() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      // Outbound SMS from field_mgmt_log
      const outbound = await db
        .select({
          id: fieldMgmtLog.id,
          step: fieldMgmtLog.step,
          smsSent: fieldMgmtLog.smsSent,
          recipientPhone: fieldMgmtLog.recipientPhone,
          firedAt: fieldMgmtLog.firedAt,
          success: fieldMgmtLog.success,
        })
        .from(fieldMgmtLog)
        .where(and(eq(fieldMgmtLog.cleanerJobId, input.cleanerJobId), eq(fieldMgmtLog.success, 1)))
        .orderBy(asc(fieldMgmtLog.firedAt));

      // Inbound replies from job_sms_replies
      const inbound = await db
        .select({
          id: jobSmsReplies.id,
          senderPhone: jobSmsReplies.senderPhone,
          body: jobSmsReplies.body,
          receivedAt: jobSmsReplies.receivedAt,
          senderType: jobSmsReplies.senderType,
        })
        .from(jobSmsReplies)
        .where(eq(jobSmsReplies.cleanerJobId, input.cleanerJobId))
        .orderBy(asc(jobSmsReplies.receivedAt));

      // Merge into a unified thread sorted by timestamp
      type Message = {
        id: number;
        direction: "outbound" | "inbound";
        body: string;
        phone: string;
        label: string;
        timestamp: number;
        success?: boolean;
      };

      const thread: Message[] = [
        ...outbound
          .filter((r) => r.smsSent)
          .map((r) => ({
            id: r.id,
            direction: "outbound" as const,
            body: r.smsSent!,
            phone: r.recipientPhone ?? "",
            label: r.step,
            timestamp: r.firedAt ? new Date(r.firedAt).getTime() : 0,
            success: r.success === 1,
          })),
        ...inbound.map((r) => ({
          id: r.id,
          direction: "inbound" as const,
          body: r.body,
          phone: r.senderPhone,
          label: r.senderType === "cleaner" ? "Cleaner Reply" : "Client Reply",
          timestamp: r.receivedAt ? new Date(r.receivedAt).getTime() : 0,
        })),
      ].sort((a, b) => a.timestamp - b.timestamp);

      return thread;
    }),

  /**
   * Returns all field mgmt calls (VAPI escalation/reminder calls) for a job.
   * Used by the Calls tab in the job detail panel.
   */
  getJobCalls: agentProcedure
    .input(z.object({ cleanerJobId: z.number() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const calls = await db
        .select()
        .from(fieldMgmtCalls)
        .where(eq(fieldMgmtCalls.cleanerJobId, input.cleanerJobId))
        .orderBy(asc(fieldMgmtCalls.createdAt));

      return calls;
    }),

  /**
   * Send a manual SMS from the job detail panel.
   */
  sendJobSms: agentProcedure
    .input(z.object({
      cleanerJobId: z.number(),
      to: z.string(),
      body: z.string().min(1).max(1600),
    }))
    .mutation(async ({ input }) => {
      const result = await sendSms({ to: input.to, content: input.body });
      if (!result.success) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: result.error ?? "SMS send failed" });
      }
      // Log it as an outbound step
      await recordStep({
        cleanerJobId: input.cleanerJobId,
        step: "manual_sms",
        success: true,
        smsSent: input.body,
        recipientPhone: input.to,
      });
      return { success: true };
    }),

  /**
   * Manually trigger a VAPI check-in alert call to the cleaner for a specific job.
   * Reuses the same placeNoCheckinEscalationCall used by the automation engine.
   */
  voiceAlertCleaner: agentProcedure
    .input(z.object({ cleanerJobId: z.number() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const rows = await db
        .select({
          id: cleanerJobs.id,
          cleanerName: cleanerJobs.cleanerName,
          teamName: cleanerJobs.teamName,
          customerName: cleanerJobs.customerName,
          jobAddress: cleanerJobs.jobAddress,
          serviceDateTime: cleanerJobs.serviceDateTime,
          cleanerProfileId: cleanerJobs.cleanerProfileId,
          // Fetch cleaner phone so the call goes to the cleaner, not the office
          cleanerPhone: cleanerProfiles.phone,
        })
        .from(cleanerJobs)
        .leftJoin(cleanerProfiles, eq(cleanerJobs.cleanerProfileId, cleanerProfiles.id))
        .where(eq(cleanerJobs.id, input.cleanerJobId))
        .limit(1);

      const job = rows[0];
      if (!job) throw new TRPCError({ code: "NOT_FOUND", message: "Job not found" });

      const scheduledTime = job.serviceDateTime
        ? new Date(job.serviceDateTime).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "America/New_York" })
        : "scheduled time";

      const callResult = await placeNoCheckinEscalationCallWithReason({
        cleanerName: job.cleanerName ?? job.teamName ?? "the cleaner",
        customerName: job.customerName ?? "the client",
        jobAddress: job.jobAddress ?? "the job address",
        scheduledTime,
        cleanerJobId: input.cleanerJobId,
        step: "manual_voice_alert",
        cleanerPhone: job.cleanerPhone ?? undefined,
      });

      if (!callResult.success) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: callResult.reason ?? "Failed to place call — check VAPI credentials or kill switch" });
      }

      return {
        success: true,
        dialedNumber: callResult.dialedNumber,
        isCsFallback: callResult.isCsFallback ?? false,
      };
    }),

  /**
   * Returns the latest inbound reply timestamp for each job in a given list.
   * Used by the Day Board to show unread badges on job cards.
   */
  getJobUnreadReplies: agentProcedure
    .input(z.object({ cleanerJobIds: z.array(z.number()), since: z.number().optional() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];
      if (input.cleanerJobIds.length === 0) return [];

      const since = input.since ? new Date(input.since) : new Date(Date.now() - 24 * 60 * 60 * 1000);

      const rows = await db
        .select({
          cleanerJobId: jobSmsReplies.cleanerJobId,
          latestReplyAt: jobSmsReplies.receivedAt,
        })
        .from(jobSmsReplies)
        .where(
          and(
            inArray(jobSmsReplies.cleanerJobId, input.cleanerJobIds),
            gte(jobSmsReplies.receivedAt, since)
          )
        )
        .orderBy(desc(jobSmsReplies.receivedAt));

      // Return the latest reply timestamp per job
      const latestByJob = new Map<number, number>();
      for (const row of rows) {
        const ts = row.latestReplyAt ? new Date(row.latestReplyAt).getTime() : 0;
        const existing = latestByJob.get(row.cleanerJobId) ?? 0;
        if (ts > existing) latestByJob.set(row.cleanerJobId, ts);
      }

      return Array.from(latestByJob.entries()).map(([cleanerJobId, latestReplyAt]) => ({
        cleanerJobId,
        latestReplyAt,
      }));
    }),

  confirmAssignment: agentProcedure
    .input(z.object({ cleanerJobId: z.number() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const rows = await db
        .select({ id: cleanerJobs.id, bookingStatus: cleanerJobs.bookingStatus, cleanerName: cleanerJobs.cleanerName })
        .from(cleanerJobs)
        .where(eq(cleanerJobs.id, input.cleanerJobId))
        .limit(1);

      const job = rows[0];
      if (!job) throw new TRPCError({ code: "NOT_FOUND", message: "Job not found" });
      if (job.bookingStatus === "assigned") {
        return { success: true, alreadyAssigned: true, cleanerName: job.cleanerName, lateSmsFired: false };
      }

      const previousStatus = job.bookingStatus;

      await db
        .update(cleanerJobs)
        .set({ bookingStatus: "assigned" })
        .where(eq(cleanerJobs.id, input.cleanerJobId));

      console.log(`[FieldMgmt] Manually confirmed assignment for job ${input.cleanerJobId} (${job.cleanerName})`);

      // Fire late-assignment SMS immediately if the job starts within 2 hours
      // (the normal T-2hr cron window will have already passed)
      const { maybeTriggerLateAssignmentSms } = await import("./fieldMgmtEngine");
      const lateResult = await maybeTriggerLateAssignmentSms(input.cleanerJobId, previousStatus);
      if (lateResult.triggered) {
        console.log(`[FieldMgmt] Late-assignment SMS triggered for job ${input.cleanerJobId}: ${lateResult.reason}`);
      }

      return { success: true, alreadyAssigned: false, cleanerName: job.cleanerName, lateSmsFired: lateResult.triggered };
    }),
});
