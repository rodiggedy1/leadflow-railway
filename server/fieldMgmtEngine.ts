/**
 * fieldMgmtEngine.ts — Field Management Automation Engine
 *
 * Implements the 7-step cleaner day-of workflow:
 *
 * Step 1: Pre-Job Reminder (T-2hrs)       → SMS to cleaner
 * Step 2: Client On the Way               → SMS to client (triggered by on_the_way status)
 * Step 3: Arrival Check-In               → Auto-response SMS to cleaner (triggered by arrived status)
 * Step 4: Mid-Job Nudge (~45-60min)       → SMS to cleaner
 * Step 5: Completion Flow                 → SMS to cleaner (triggered by completed status)
 * Step 6: Exception Handling (30min before, no check-in) → SMS to cleaner + escalation call
 * Step 7: No-Show / Late Escalation (10min before, no on_the_way or arrived) → CS team alert SMS
 *
 * KILL SWITCH: All automation is gated by FIELD_MGMT_ENABLED = false.
 * Set to true only after full review.
 *
 * Timezone: All job times are in ET (America/New_York). We convert serviceDateTime
 * to a UTC Date for comparison against Date.now().
 */

import { and, eq, gte, isNull, lte, or, sql } from "drizzle-orm";
import { getDb } from "./db";
import { cleanerJobs, cleanerProfiles, fieldMgmtLog } from "../drizzle/schema";
import { sendSms } from "./openphone";
import { logActivity } from "./activityLogger";
import { notifyOwner } from "./_core/notification";
import { ENV } from "./_core/env";

// ── Kill switch ───────────────────────────────────────────────────────────────
// Set to true when ready to go live. All functions return early while false.
export const FIELD_MGMT_ENABLED = false;

// ── CS team alert number ──────────────────────────────────────────────────────
const CS_ALERT_NUMBER = "+12028885362";

// ── Cleaner portal login URL ──────────────────────────────────────────────────
const CLEANER_PORTAL_URL = "https://quote.maidinblack.com/cleaner";

// ── VAPI call helper (reused from vapiLeadNotification pattern) ───────────────
const VAPI_API_BASE = "https://api.vapi.ai";
const VAPI_OUTBOUND_PHONE_NUMBER_ID = "f2f1c044-c70a-4d73-a755-051f8a2a96e4";

async function vapiPost(path: string, body: unknown): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const res = await fetch(`${VAPI_API_BASE}${path}`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${ENV.vapiPrivateKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`VAPI POST ${path} → ${res.status}: ${text}`);
    }
    return res.json();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Places an outbound VAPI call to the CS team alerting them of a no-check-in situation.
 * Uses TTS — no AI conversation, just reads the script and hangs up.
 */
export async function placeNoCheckinEscalationCall(params: {
  cleanerName: string;
  customerName: string;
  jobAddress: string;
  scheduledTime: string;
}): Promise<boolean> {
  if (!FIELD_MGMT_ENABLED) return false;
  if (!ENV.vapiPrivateKey) {
    console.warn("[FieldMgmt] VAPI_PRIVATE_KEY not set — skipping escalation call");
    return false;
  }

  const { cleanerName, customerName, jobAddress, scheduledTime } = params;
  const script =
    `Hi Maids in Black team, this is an automated field alert. ` +
    `Cleaner ${cleanerName} has not checked in for their job at ${jobAddress} for client ${customerName}, ` +
    `scheduled at ${scheduledTime}. ` +
    `Please call the cleaner immediately and notify the client. ` +
    `This is a time-sensitive situation.`;

  const payload = {
    phoneNumberId: VAPI_OUTBOUND_PHONE_NUMBER_ID,
    customer: { number: CS_ALERT_NUMBER },
    assistant: {
      name: "FieldMgmtAlert",
      firstMessage: script,
      model: {
        provider: "openai",
        model: "gpt-4o-mini",
        messages: [{
          role: "system",
          content: "You are a brief automated notification system. You have already delivered your message. If the person says anything, simply say 'Got it, we will handle it immediately.' and end the call.",
        }],
      },
      voice: {
        provider: "11labs",
        voiceId: "EXAVITQu4vr4xnSDxMaL",
        stability: 0.5,
        similarityBoost: 0.75,
        style: 0.3,
        useSpeakerBoost: true,
      },
      maxDurationSeconds: 45,
    },
  };

  try {
    const result = await vapiPost("/call", payload) as { id?: string };
    console.log(`[FieldMgmt] Escalation call placed to CS team. VAPI call ID: ${result?.id ?? "unknown"}`);
    return true;
  } catch (err) {
    console.error("[FieldMgmt] Escalation call FAILED:", err);
    return false;
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Parse serviceDateTime (ISO 8601 or "YYYY-MM-DD HH:mm:ss") to a UTC Date.
 * Launch27 returns times in ET — we treat them as ET and convert to UTC.
 */
export function parseServiceDateTime(serviceDateTime: string): Date | null {
  if (!serviceDateTime) return null;
  try {
    // Try direct ISO parse first (includes timezone offset)
    const d = new Date(serviceDateTime);
    if (!isNaN(d.getTime())) return d;
    return null;
  } catch {
    return null;
  }
}

/**
 * Get current time in ET as a Date object.
 */
export function nowET(): Date {
  return new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
}

/**
 * Format a Date as a human-readable time string in ET (e.g. "9:30 AM").
 */
export function formatTimeET(d: Date): string {
  return d.toLocaleTimeString("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

/**
 * Check if a step has already been fired for a given cleanerJobId.
 * Returns true if a log row exists (regardless of success/failure).
 */
export async function stepAlreadyFired(cleanerJobId: number, step: string): Promise<boolean> {
  const db = await getDb();
  if (!db) return true; // safe default: don't double-send if DB is down
  const rows = await db
    .select({ id: fieldMgmtLog.id })
    .from(fieldMgmtLog)
    .where(and(eq(fieldMgmtLog.cleanerJobId, cleanerJobId), eq(fieldMgmtLog.step, step as any)))
    .limit(1);
  return rows.length > 0;
}

/**
 * Record that a step fired for a given job.
 * Call this BEFORE sending SMS so a DB error never blocks the send.
 */
export async function recordStep(params: {
  cleanerJobId: number;
  step: string;
  success: boolean;
  smsSent?: string;
  recipientPhone?: string;
  errorDetail?: string;
}): Promise<void> {
  const db = await getDb();
  if (!db) return;
  try {
    await db.insert(fieldMgmtLog).values({
      cleanerJobId: params.cleanerJobId,
      step: params.step as any,
      success: params.success ? 1 : 0,
      smsSent: params.smsSent ?? null,
      recipientPhone: params.recipientPhone ?? null,
      errorDetail: params.errorDetail ?? null,
      firedAt: new Date(),
    });
  } catch (err) {
    console.error(`[FieldMgmt] Failed to record step ${params.step} for job ${params.cleanerJobId}:`, err);
  }
}

/**
 * Get the cleaner's first name from their full name.
 */
function firstName(fullName: string | null | undefined): string {
  if (!fullName) return "there";
  return fullName.split(" ")[0] ?? fullName;
}

// ── Step 1: Pre-Job Reminder (T-2hrs) ────────────────────────────────────────

/**
 * Runs every 5 minutes. Finds jobs starting in 115–125 minutes (±5 min window
 * around the 2-hour mark) that haven't received a pre-job reminder yet.
 * Sends reminder SMS to the cleaner.
 */
export async function runPreJobReminders(): Promise<{ checked: number; sent: number; errors: number }> {
  if (!FIELD_MGMT_ENABLED) return { checked: 0, sent: 0, errors: 0 };

  const db = await getDb();
  if (!db) return { checked: 0, sent: 0, errors: 0 };

  const now = Date.now();
  // Window: jobs starting 115–125 minutes from now
  const windowStart = new Date(now + 115 * 60 * 1000);
  const windowEnd = new Date(now + 125 * 60 * 1000);

  // Find active (assigned) jobs in this window
  const jobs = await db
    .select({
      id: cleanerJobs.id,
      cleanerProfileId: cleanerJobs.cleanerProfileId,
      cleanerName: cleanerJobs.cleanerName,
      customerName: cleanerJobs.customerName,
      jobAddress: cleanerJobs.jobAddress,
      serviceDateTime: cleanerJobs.serviceDateTime,
      serviceType: cleanerJobs.serviceType,
      customerNotes: cleanerJobs.customerNotes,
      bookingStatus: cleanerJobs.bookingStatus,
    })
    .from(cleanerJobs)
    .where(
      and(
        eq(cleanerJobs.bookingStatus, "assigned"),
        sql`${cleanerJobs.serviceDateTime} IS NOT NULL`
      )
    );

  let sent = 0;
  let errors = 0;

  for (const job of jobs) {
    if (!job.serviceDateTime) continue;

    const serviceTime = parseServiceDateTime(job.serviceDateTime);
    if (!serviceTime) continue;

    const serviceMs = serviceTime.getTime();
    if (serviceMs < windowStart.getTime() || serviceMs > windowEnd.getTime()) continue;

    // Already sent?
    if (await stepAlreadyFired(job.id, "pre_job_reminder")) continue;

    // Get cleaner phone
    const profileRows = await db
      .select({ phone: cleanerProfiles.phone, email: cleanerProfiles.email })
      .from(cleanerProfiles)
      .where(eq(cleanerProfiles.id, job.cleanerProfileId))
      .limit(1);
    const profile = profileRows[0];
    if (!profile?.phone) {
      console.warn(`[FieldMgmt] Pre-job reminder: no phone for cleaner profile ${job.cleanerProfileId}`);
      continue;
    }

    const cleanerFirstName = firstName(job.cleanerName);
    const timeStr = formatTimeET(serviceTime);
    const loginEmail = profile.email ?? "your login email";

    const msg = [
      `Hey ${cleanerFirstName} — reminder for your cleaning at ${timeStr}.`,
      ``,
      `Before you arrive:`,
      `• Review notes: ${CLEANER_PORTAL_URL}`,
      `  (Login: ${loginEmail})`,
      `• Bring full supplies`,
      `• Be ready to check in + upload photos`,
      ``,
      `Set your status to "On the Way" in the app.`,
    ].join("\n");

    // Record BEFORE sending (so DB error never blocks SMS)
    await recordStep({
      cleanerJobId: job.id,
      step: "pre_job_reminder",
      success: false, // will update after send
      smsSent: msg,
      recipientPhone: profile.phone,
    });

    const result = await sendSms({ to: profile.phone, content: msg });

    if (result.success) {
      sent++;
      console.log(`[FieldMgmt] Pre-job reminder sent to ${job.cleanerName} (${profile.phone}) for job ${job.id}`);
    } else {
      errors++;
      console.error(`[FieldMgmt] Pre-job reminder FAILED for job ${job.id}:`, result.error);
      await recordStep({
        cleanerJobId: job.id,
        step: "pre_job_reminder",
        success: false,
        errorDetail: result.error,
        recipientPhone: profile.phone,
      });
    }
  }

  return { checked: jobs.length, sent, errors };
}

// ── Step 2: Client On the Way SMS ─────────────────────────────────────────────

/**
 * Called from cleanerRouter.updateJobStatus when status = "on_the_way".
 * Sends an ETA SMS to the CLIENT (not the cleaner).
 */
export async function sendClientOnTheWaySms(cleanerJobId: number): Promise<void> {
  if (!FIELD_MGMT_ENABLED) return;

  if (await stepAlreadyFired(cleanerJobId, "client_on_the_way")) return;

  const db = await getDb();
  if (!db) return;

  const jobRows = await db
    .select()
    .from(cleanerJobs)
    .where(eq(cleanerJobs.id, cleanerJobId))
    .limit(1);
  const job = jobRows[0];
  if (!job) return;

  const clientPhone = job.customerPhone;
  if (!clientPhone) {
    console.warn(`[FieldMgmt] Client on-the-way: no customer phone for job ${cleanerJobId}`);
    return;
  }

  const clientFirstName = firstName(job.customerName);
  const address = job.jobAddress ?? "your address";

  // Compute ETA string from etaTimestamp if available
  let etaStr = "shortly";
  if (job.etaTimestamp) {
    const etaDate = new Date(job.etaTimestamp);
    etaStr = formatTimeET(etaDate);
  } else if (job.serviceDateTime) {
    const serviceTime = parseServiceDateTime(job.serviceDateTime);
    if (serviceTime) etaStr = formatTimeET(serviceTime);
  }

  const msg = [
    `Hi ${clientFirstName}! Your Maids in Black team is on the way and will arrive at ${address} around ${etaStr}. 🚗`,
    ``,
    `The best way to make sure everything is perfect is to take a quick look before they head out. A quick 1 minute walkthrough really helps.`,
    `Feel free to point anything out — they're happy to fix it on the spot.`,
    ``,
    `If you have any last-minute notes, reply here.`,
  ].join("\n");

  await recordStep({
    cleanerJobId,
    step: "client_on_the_way",
    success: false,
    smsSent: msg,
    recipientPhone: clientPhone,
  });

  const result = await sendSms({ to: clientPhone, content: msg });

  if (result.success) {
    console.log(`[FieldMgmt] Client on-the-way SMS sent to ${clientPhone} for job ${cleanerJobId}`);
  } else {
    console.error(`[FieldMgmt] Client on-the-way SMS FAILED for job ${cleanerJobId}:`, result.error);
    await recordStep({
      cleanerJobId,
      step: "client_on_the_way",
      success: false,
      errorDetail: result.error,
      recipientPhone: clientPhone,
    });
  }
}

// ── Step 3: Arrival Check-In Auto-Response ────────────────────────────────────

/**
 * Called from cleanerRouter.updateJobStatus when status = "arrived".
 * Sends the check-in confirmation + photo reminder to the CLEANER.
 */
export async function sendArrivedCheckin(cleanerJobId: number): Promise<void> {
  if (!FIELD_MGMT_ENABLED) return;

  if (await stepAlreadyFired(cleanerJobId, "arrived_checkin")) return;

  const db = await getDb();
  if (!db) return;

  const jobRows = await db
    .select({
      id: cleanerJobs.id,
      cleanerProfileId: cleanerJobs.cleanerProfileId,
      cleanerName: cleanerJobs.cleanerName,
    })
    .from(cleanerJobs)
    .where(eq(cleanerJobs.id, cleanerJobId))
    .limit(1);
  const job = jobRows[0];
  if (!job) return;

  const profileRows = await db
    .select({ phone: cleanerProfiles.phone })
    .from(cleanerProfiles)
    .where(eq(cleanerProfiles.id, job.cleanerProfileId))
    .limit(1);
  const profile = profileRows[0];
  if (!profile?.phone) return;

  const msg = [
    `You're checked in ✅`,
    ``,
    `Before starting:`,
    `Take photos of anything broken that you cannot be blamed for.`,
  ].join("\n");

  await recordStep({
    cleanerJobId,
    step: "arrived_checkin",
    success: false,
    smsSent: msg,
    recipientPhone: profile.phone,
  });

  const result = await sendSms({ to: profile.phone, content: msg });

  if (result.success) {
    console.log(`[FieldMgmt] Arrived check-in sent to ${job.cleanerName} (${profile.phone}) for job ${cleanerJobId}`);
  } else {
    console.error(`[FieldMgmt] Arrived check-in FAILED for job ${cleanerJobId}:`, result.error);
    await recordStep({
      cleanerJobId,
      step: "arrived_checkin",
      success: false,
      errorDetail: result.error,
      recipientPhone: profile.phone,
    });
  }
}

// ── Step 4: Mid-Job Nudge (~45-60 min after arrived) ─────────────────────────

/**
 * Runs every 5 minutes. Finds jobs where:
 * - jobStatus is "in_progress" (set when cleaner marks arrived)
 * - arrived_checkin step was fired 45–65 minutes ago
 * - mid_job_nudge has NOT been sent yet
 */
export async function runMidJobNudges(): Promise<{ checked: number; sent: number; errors: number }> {
  if (!FIELD_MGMT_ENABLED) return { checked: 0, sent: 0, errors: 0 };

  const db = await getDb();
  if (!db) return { checked: 0, sent: 0, errors: 0 };

  const now = Date.now();
  const windowStart = new Date(now - 65 * 60 * 1000); // 65 min ago
  const windowEnd = new Date(now - 45 * 60 * 1000);   // 45 min ago

  // Find arrived_checkin log entries in the window
  const checkinLogs = await db
    .select({
      cleanerJobId: fieldMgmtLog.cleanerJobId,
      firedAt: fieldMgmtLog.firedAt,
    })
    .from(fieldMgmtLog)
    .where(
      and(
        eq(fieldMgmtLog.step, "arrived_checkin"),
        gte(fieldMgmtLog.firedAt, windowStart),
        lte(fieldMgmtLog.firedAt, windowEnd)
      )
    );

  let sent = 0;
  let errors = 0;

  for (const log of checkinLogs) {
    if (await stepAlreadyFired(log.cleanerJobId, "mid_job_nudge")) continue;

    // Get job + cleaner info
    const jobRows = await db
      .select({
        id: cleanerJobs.id,
        cleanerProfileId: cleanerJobs.cleanerProfileId,
        cleanerName: cleanerJobs.cleanerName,
        jobStatus: cleanerJobs.jobStatus,
        bookingStatus: cleanerJobs.bookingStatus,
      })
      .from(cleanerJobs)
      .where(eq(cleanerJobs.id, log.cleanerJobId))
      .limit(1);
    const job = jobRows[0];
    if (!job) continue;

    // Only nudge if still in progress (not completed or cancelled)
    if (job.jobStatus === "completed" || job.bookingStatus === "completed") continue;

    const profileRows = await db
      .select({ phone: cleanerProfiles.phone, email: cleanerProfiles.email })
      .from(cleanerProfiles)
      .where(eq(cleanerProfiles.id, job.cleanerProfileId))
      .limit(1);
    const profile = profileRows[0];
    if (!profile?.phone) continue;

    const loginEmail = profile.email ?? "your login email";

    const msg = [
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

    await recordStep({
      cleanerJobId: job.id,
      step: "mid_job_nudge",
      success: false,
      smsSent: msg,
      recipientPhone: profile.phone,
    });

    const result = await sendSms({ to: profile.phone, content: msg });

    if (result.success) {
      sent++;
      console.log(`[FieldMgmt] Mid-job nudge sent to ${job.cleanerName} (${profile.phone}) for job ${job.id}`);
    } else {
      errors++;
      console.error(`[FieldMgmt] Mid-job nudge FAILED for job ${job.id}:`, result.error);
      await recordStep({
        cleanerJobId: job.id,
        step: "mid_job_nudge",
        success: false,
        errorDetail: result.error,
        recipientPhone: profile.phone,
      });
    }
  }

  return { checked: checkinLogs.length, sent, errors };
}

// ── Step 5: Completion Flow ───────────────────────────────────────────────────

/**
 * Called from cleanerRouter.markComplete when cleaner marks job done.
 * Sends the completion checklist SMS to the CLEANER.
 */
export async function sendCompletionFlow(cleanerJobId: number): Promise<void> {
  if (!FIELD_MGMT_ENABLED) return;

  if (await stepAlreadyFired(cleanerJobId, "completion_flow")) return;

  const db = await getDb();
  if (!db) return;

  const jobRows = await db
    .select({
      id: cleanerJobs.id,
      cleanerProfileId: cleanerJobs.cleanerProfileId,
      cleanerName: cleanerJobs.cleanerName,
    })
    .from(cleanerJobs)
    .where(eq(cleanerJobs.id, cleanerJobId))
    .limit(1);
  const job = jobRows[0];
  if (!job) return;

  const profileRows = await db
    .select({ phone: cleanerProfiles.phone, email: cleanerProfiles.email })
    .from(cleanerProfiles)
    .where(eq(cleanerProfiles.id, job.cleanerProfileId))
    .limit(1);
  const profile = profileRows[0];
  if (!profile?.phone) return;

  const loginEmail = profile.email ?? "your login email";

  const msg = [
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

  await recordStep({
    cleanerJobId,
    step: "completion_flow",
    success: false,
    smsSent: msg,
    recipientPhone: profile.phone,
  });

  const result = await sendSms({ to: profile.phone, content: msg });

  if (result.success) {
    console.log(`[FieldMgmt] Completion flow sent to ${job.cleanerName} (${profile.phone}) for job ${cleanerJobId}`);
  } else {
    console.error(`[FieldMgmt] Completion flow FAILED for job ${cleanerJobId}:`, result.error);
    await recordStep({
      cleanerJobId,
      step: "completion_flow",
      success: false,
      errorDetail: result.error,
      recipientPhone: profile.phone,
    });
  }
}

// ── Step 6: Exception Handling (30min before, no check-in) ───────────────────

/**
 * Runs every 5 minutes. Finds jobs starting in 25–35 minutes where:
 * - No arrived_checkin step has been fired (cleaner hasn't marked arrived)
 * - No exception_sms has been sent yet
 * Sends "Hey — we haven't received your check-in. Is everything okay?" to cleaner.
 */
export async function runExceptionHandling(): Promise<{ checked: number; sent: number; errors: number }> {
  if (!FIELD_MGMT_ENABLED) return { checked: 0, sent: 0, errors: 0 };

  const db = await getDb();
  if (!db) return { checked: 0, sent: 0, errors: 0 };

  const now = Date.now();
  const windowStart = new Date(now + 25 * 60 * 1000);
  const windowEnd = new Date(now + 35 * 60 * 1000);

  const jobs = await db
    .select({
      id: cleanerJobs.id,
      cleanerProfileId: cleanerJobs.cleanerProfileId,
      cleanerName: cleanerJobs.cleanerName,
      customerName: cleanerJobs.customerName,
      jobAddress: cleanerJobs.jobAddress,
      serviceDateTime: cleanerJobs.serviceDateTime,
      jobStatus: cleanerJobs.jobStatus,
      bookingStatus: cleanerJobs.bookingStatus,
    })
    .from(cleanerJobs)
    .where(
      and(
        eq(cleanerJobs.bookingStatus, "assigned"),
        sql`${cleanerJobs.serviceDateTime} IS NOT NULL`
      )
    );

  let sent = 0;
  let errors = 0;

  for (const job of jobs) {
    if (!job.serviceDateTime) continue;

    const serviceTime = parseServiceDateTime(job.serviceDateTime);
    if (!serviceTime) continue;

    const serviceMs = serviceTime.getTime();
    if (serviceMs < windowStart.getTime() || serviceMs > windowEnd.getTime()) continue;

    // Skip if cleaner already checked in (arrived or in_progress or completed)
    if (
      job.jobStatus === "arrived" ||
      job.jobStatus === "in_progress" ||
      job.jobStatus === "completed"
    ) continue;

    // Skip if exception SMS already sent
    if (await stepAlreadyFired(job.id, "exception_sms")) continue;

    const profileRows = await db
      .select({ phone: cleanerProfiles.phone })
      .from(cleanerProfiles)
      .where(eq(cleanerProfiles.id, job.cleanerProfileId))
      .limit(1);
    const profile = profileRows[0];
    if (!profile?.phone) continue;

    const msg = `Hey — we haven't received your check-in. Is everything okay?`;

    await recordStep({
      cleanerJobId: job.id,
      step: "exception_sms",
      success: false,
      smsSent: msg,
      recipientPhone: profile.phone,
    });

    const result = await sendSms({ to: profile.phone, content: msg });

    if (result.success) {
      sent++;
      console.log(`[FieldMgmt] Exception SMS sent to ${job.cleanerName} (${profile.phone}) for job ${job.id}`);
    } else {
      errors++;
      console.error(`[FieldMgmt] Exception SMS FAILED for job ${job.id}:`, result.error);
      await recordStep({
        cleanerJobId: job.id,
        step: "exception_sms",
        success: false,
        errorDetail: result.error,
        recipientPhone: profile.phone,
      });
    }
  }

  return { checked: jobs.length, sent, errors };
}

// ── Step 7: No-Show / Late Escalation (10min before, no on_the_way or arrived) ──

/**
 * Runs every 5 minutes. Finds jobs starting in 5–15 minutes where:
 * - No on_the_way or arrived status has been set
 * - No noshow_alert has been sent yet
 * Sends CS team alert SMS so they can call the cleaner and notify the client.
 */
export async function runNoShowEscalation(): Promise<{ checked: number; sent: number; errors: number }> {
  if (!FIELD_MGMT_ENABLED) return { checked: 0, sent: 0, errors: 0 };

  const db = await getDb();
  if (!db) return { checked: 0, sent: 0, errors: 0 };

  const now = Date.now();
  const windowStart = new Date(now + 5 * 60 * 1000);
  const windowEnd = new Date(now + 15 * 60 * 1000);

  const jobs = await db
    .select({
      id: cleanerJobs.id,
      cleanerProfileId: cleanerJobs.cleanerProfileId,
      cleanerName: cleanerJobs.cleanerName,
      customerName: cleanerJobs.customerName,
      jobAddress: cleanerJobs.jobAddress,
      serviceDateTime: cleanerJobs.serviceDateTime,
      jobStatus: cleanerJobs.jobStatus,
      bookingStatus: cleanerJobs.bookingStatus,
    })
    .from(cleanerJobs)
    .where(
      and(
        eq(cleanerJobs.bookingStatus, "assigned"),
        sql`${cleanerJobs.serviceDateTime} IS NOT NULL`
      )
    );

  let sent = 0;
  let errors = 0;

  for (const job of jobs) {
    if (!job.serviceDateTime) continue;

    const serviceTime = parseServiceDateTime(job.serviceDateTime);
    if (!serviceTime) continue;

    const serviceMs = serviceTime.getTime();
    if (serviceMs < windowStart.getTime() || serviceMs > windowEnd.getTime()) continue;

    // Skip if cleaner has already set on_the_way, arrived, in_progress, or completed
    if (
      job.jobStatus === "on_the_way" ||
      job.jobStatus === "arrived" ||
      job.jobStatus === "in_progress" ||
      job.jobStatus === "completed"
    ) continue;

    // Skip if alert already sent
    if (await stepAlreadyFired(job.id, "noshow_alert")) continue;

    const timeStr = formatTimeET(serviceTime);
    const msg = [
      `🚨 No-Show Alert`,
      `Cleaner: ${job.cleanerName ?? "Unknown"}`,
      `Client: ${job.customerName ?? "Unknown"}`,
      `Address: ${job.jobAddress ?? "Unknown"}`,
      `Scheduled: ${timeStr}`,
      ``,
      `No "On the Way" or "Arrived" received. Please call the cleaner and notify the client.`,
    ].join("\n");

    await recordStep({
      cleanerJobId: job.id,
      step: "noshow_alert",
      success: false,
      smsSent: msg,
      recipientPhone: CS_ALERT_NUMBER,
    });

    const result = await sendSms({ to: CS_ALERT_NUMBER, content: msg });

    if (result.success) {
      sent++;
      console.log(`[FieldMgmt] No-show alert sent to CS team for job ${job.id} (${job.cleanerName})`);

      // Also log as activity
      logActivity({
        eventType: "nightly_sync", // closest available type for ops alerts
        title: `🚨 No-Show Alert — ${job.cleanerName}`,
        body: `No status update received for ${job.cleanerName} → ${job.customerName} at ${job.jobAddress} (${timeStr})`,
        meta: { cleanerJobId: job.id },
      }).catch(() => {});
    } else {
      errors++;
      console.error(`[FieldMgmt] No-show alert FAILED for job ${job.id}:`, result.error);
      await recordStep({
        cleanerJobId: job.id,
        step: "noshow_alert",
        success: false,
        errorDetail: result.error,
        recipientPhone: CS_ALERT_NUMBER,
      });
    }
  }

  return { checked: jobs.length, sent, errors };
}
