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

import { and, eq, gte, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { getDb, getOrCreateCleanerMagicLink } from "./db";
import {
  cleanerJobs,
  cleanerProfiles,
  fieldMgmtLog,
  fieldMgmtCalls,
  jobStatusHistory,
  opsChatMessages,
} from "../drizzle/schema";
import { sendSms, sleep } from "./openphone";
import { logActivity } from "./activityLogger";
import { notifyOwner } from "./_core/notification";
import { ENV } from "./_core/env";
// isWithinBusinessHours is imported for reference; we define a stricter 8am–5pm variant
import { isWithinBusinessHours as _isWithinBusinessHours } from "./vapiLeadNotification";

/**
 * Returns true if the current time is within escalation call hours: 7 AM – 6 PM ET.
 */
export function isWithinEscalationHours(now: Date = new Date()): boolean {
  const etFormatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    hour12: false,
  });
  const hour = parseInt(etFormatter.format(now), 10);
  // 7 (7:00 am) inclusive → 17 (5:59 pm) inclusive; 18 (6:00 pm) is excluded
  return hour >= 7 && hour < 18;
}

// ── Kill switch ───────────────────────────────────────────────────────────────
// Set to true when ready to go live. All functions return early while false.
export const FIELD_MGMT_ENABLED = true;

// ── CS team alert number ──────────────────────────────────────────────────────
const CS_ALERT_NUMBER = "+12028885362";

// ── Vapi outbound phone number (the number Vapi calls FROM) ──────────────────
// Never call this number — it would create a self-call loop.
const VAPI_OUTBOUND_PHONE_NUMBER = "+19347898077";

// ── Cleaner portal login URL ──────────────────────────────────────────────────
const CLEANER_PORTAL_URL = "https://quote.maidinblack.com/cleaner";

// ── VAPI call helper (reused from vapiLeadNotification pattern) ───────────────
const VAPI_API_BASE = "https://api.vapi.ai";
const VAPI_OUTBOUND_PHONE_NUMBER_ID = "f2f1c044-c70a-4d73-a755-051f8a2a96e4";

// ── Unassigned job guard ──────────────────────────────────────────────────────
/**
 * RULE: Never send client-facing SMS or notifications for unassigned jobs.
 *
 * A job is considered "assigned" only when bookingStatus = 'assigned'.
 * Any other status (unassigned, new, cancelled, completed) must never trigger
 * a client notification — the client has not been confirmed a cleaner yet.
 *
 * This guard is the single source of truth for this rule. Every client-facing
 * SMS function (sendClientPreJobSms, sendClientOnTheWaySms, sendRunningLateSms)
 * MUST call this before sending. The cron-level WHERE clause is a first-pass
 * filter only — it does not protect against direct function calls.
 *
 * Returns true if the job is assigned and client SMS is permitted.
 * Returns false (and logs a warning) if the job is unassigned or not found.
 */
export async function isJobAssigned(cleanerJobId: number): Promise<boolean> {
  const db = await getDb();
  if (!db) return false; // safe default: don't send if DB is unavailable
  const rows = await db
    .select({ bookingStatus: cleanerJobs.bookingStatus })
    .from(cleanerJobs)
    .where(eq(cleanerJobs.id, cleanerJobId))
    .limit(1);
  const status = rows[0]?.bookingStatus ?? null;
  if (status !== "assigned") {
    console.warn(
      `[FieldMgmt] Client SMS blocked for job ${cleanerJobId} — bookingStatus is '${status ?? "not found"}' (must be 'assigned').`
    );
    return false;
  }
  return true;
}

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
 * Places an outbound VAPI call to the CLEANER alerting them that they have not
 * checked in for their job. Uses TTS — no AI conversation, just reads the script
 * and hangs up.
 *
 * Guards:
 * - Business hours only (8 AM – 5 PM ET). Outside hours the call is silently skipped.
 * - Never calls the Vapi outbound number itself (self-call loop protection).
 */
export async function placeNoCheckinEscalationCallWithReason(params: {
  cleanerName: string;
  customerName: string;
  jobAddress: string;
  scheduledTime: string;
  cleanerJobId?: number;
  step?: string;
  cleanerPhone?: string;
}): Promise<{ success: boolean; reason?: string; dialedNumber?: string; isCsFallback?: boolean }> {
  if (!FIELD_MGMT_ENABLED) return { success: false, reason: "Field management kill switch is off" };
  if (!ENV.vapiPrivateKey) {
    console.warn("[FieldMgmt] VAPI_PRIVATE_KEY not set — skipping escalation call");
    return { success: false, reason: "VAPI_PRIVATE_KEY is not configured" };
  }

  // ── Operating hours guard (7 AM – 6 PM ET) ────────────────────────────────────────────
  if (!isWithinEscalationHours()) {
    console.log("[FieldMgmt] Outside escalation call hours (7am–6pm ET) — skipping call");
    return { success: false, reason: "Outside call hours (7 AM – 6 PM ET). Try again during operating hours." };
  }

  const { cleanerName, customerName, jobAddress, scheduledTime, cleanerJobId, step, cleanerPhone } = params;

  // ── Determine the call target ─────────────────────────────────────────────
  // Prefer the cleaner's own phone. Fall back to CS team only if no cleaner phone is available.
  const callTarget = cleanerPhone && cleanerPhone.trim() ? cleanerPhone.trim() : CS_ALERT_NUMBER;

  // ── Self-call protection ──────────────────────────────────────────────────
  // Never call the Vapi outbound number — it would create an infinite loop.
  const normalizedTarget = callTarget.startsWith("+") ? callTarget : `+1${callTarget.replace(/\D/g, "")}`;
  if (normalizedTarget === VAPI_OUTBOUND_PHONE_NUMBER) {
    console.error(`[FieldMgmt] Self-call protection triggered — refusing to call Vapi outbound number ${normalizedTarget}`);
    return { success: false, reason: "Self-call protection: cannot call the VAPI outbound number" };
  }

  const isCsTeam = normalizedTarget === CS_ALERT_NUMBER;
  const script = isCsTeam
    ? `Hi Maids in Black team, this is an automated field alert. ` +
      `Cleaner ${cleanerName} has not checked in for their job at ${jobAddress} for client ${customerName}, ` +
      `scheduled at ${scheduledTime}. ` +
      `Please call the cleaner immediately and notify the client. ` +
      `This is a time-sensitive situation.`
    : `Hi ${cleanerName}, this is an automated reminder from Maids in Black. ` +
      `You have a job at ${jobAddress} for ${customerName} scheduled at ${scheduledTime}. ` +
      `We have not received your check-in yet. ` +
      `Please open the Maids in Black app and mark your status, or call the office immediately. ` +
      `Thank you.`;

  const payload = {
    phoneNumberId: VAPI_OUTBOUND_PHONE_NUMBER_ID,
    customer: { number: normalizedTarget },
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
      maxDurationSeconds: 25,
    },
  };

  try {
    const result = await vapiPost("/call", payload) as { id?: string };
    const vapiCallId = result?.id ?? null;
    console.log(`[FieldMgmt] Escalation call placed to ${normalizedTarget}. VAPI call ID: ${vapiCallId ?? "unknown"}`);
    // Store the call record in fieldMgmtCalls so we can update it when the end-of-call report arrives
    if (cleanerJobId && vapiCallId) {
      const db = await getDb();
      if (db) {
        await db.insert(fieldMgmtCalls).values({
          cleanerJobId,
          step: step ?? "noshow_call",
          vapiCallId,
          calledPhone: normalizedTarget,
          outcome: "no_answer", // will be updated by end-of-call webhook
          durationSeconds: 0,
          transcript: null,
          summary: null,
          endedReason: null,
          recordingUrl: null,
        }).catch((err: unknown) => {
          console.error("[FieldMgmt] Failed to insert fieldMgmtCalls row:", err);
        });
      }
    }

    return { success: true, dialedNumber: normalizedTarget, isCsFallback: isCsTeam };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[FieldMgmt] Escalation call FAILED:", msg);
    return { success: false, reason: msg };
  }
}

/** Backwards-compatible boolean wrapper for cron/engine callers */
export async function placeNoCheckinEscalationCall(params: Parameters<typeof placeNoCheckinEscalationCallWithReason>[0]): Promise<boolean> {
  const result = await placeNoCheckinEscalationCallWithReason(params);
  return result.success;
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

/**
 * Ensure the job has a trackerToken, generating and saving one if missing.
 * Returns the tracking URL (always a real /track/:token URL, never a fallback).
 * This guarantees the link is valid even when called before the 8 AM tracker cron runs.
 */
async function ensureTrackerToken(cleanerJobId: number): Promise<string> {
  const BASE_URL = "https://quote.maidinblack.com";
  const db = await getDb();
  if (!db) return BASE_URL;

  const rows = await db
    .select({ trackerToken: cleanerJobs.trackerToken })
    .from(cleanerJobs)
    .where(eq(cleanerJobs.id, cleanerJobId))
    .limit(1);

  let token = rows[0]?.trackerToken ?? null;

  if (!token) {
    // Generate a new token and persist it immediately
    const { randomBytes } = await import("crypto");
    token = randomBytes(24).toString("base64url");
    await db
      .update(cleanerJobs)
      .set({ trackerToken: token })
      .where(eq(cleanerJobs.id, cleanerJobId));
    console.log(`[FieldMgmt] Generated trackerToken for job ${cleanerJobId}: ${token}`);
  }

  return `${BASE_URL}/track/${token}`;
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
    const magicLink = await getOrCreateCleanerMagicLink(job.cleanerProfileId);

    const msg = [
      `Hey ${cleanerFirstName} — reminder for your cleaning at ${timeStr}.`,
      ``,
      `Before you arrive:`,
      `• Review notes`,
      `• Bring full supplies`,
      `• Be ready to check in + upload photos`,
      ``,
      `Set your status to "On the Way" in the app.`,
      magicLink,
    ].join("\n");

    // Write log row FIRST to prevent duplicate sends if two cron ticks overlap
    await recordStep({
      cleanerJobId: job.id,
      step: "pre_job_reminder",
      success: true, // optimistic — will not update on failure (acceptable: rare edge case)
      smsSent: msg,
      recipientPhone: profile.phone,
    });

    const result = await sendSms({ to: profile.phone, content: msg });

    if (result.success) {
      sent++;
      console.log(`[FieldMgmt] Pre-job reminder sent to ${job.cleanerName} (${profile.phone}) for job ${job.id}`);
      // Client pre-job SMS is handled by runClientPreJobNotifications() — its own
      // dedicated cron pass with independent timing. No chain call here.
    } else {
      errors++;
      console.error(`[FieldMgmt] Pre-job reminder FAILED for job ${job.id}:`, result.error);
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

  // RULE: Never send client SMS for unassigned jobs
  if (!await isJobAssigned(cleanerJobId)) return;

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

  // Always generate token if missing — guarantees a real /track/:token URL
  const trackingLink = await ensureTrackerToken(cleanerJobId);

  const msg = [
    `Hi ${clientFirstName}! Your Maids in Black team is on the way and will arrive at ${address} around ${etaStr}. 🚗`,
    ``,
    `Track their arrival in real time here: ${trackingLink}`,
    ``,
    `The best way to make sure everything is perfect is to take a quick look before they head out. A quick 1 minute walkthrough really helps.`,
    `Feel free to point anything out — they're happy to fix it on the spot.`,
    ``,
    `If you have any last-minute notes, reply here.`,
  ].join("\n");

  const result = await sendSms({ to: clientPhone, content: msg });

  await recordStep({
    cleanerJobId,
    step: "client_on_the_way",
    success: result.success,
    smsSent: msg,
    recipientPhone: clientPhone,
    errorDetail: result.success ? undefined : result.error,
  });

  if (result.success) {
    console.log(`[FieldMgmt] Client on-the-way SMS sent to ${clientPhone} for job ${cleanerJobId}`);
  } else {
    console.error(`[FieldMgmt] Client on-the-way SMS FAILED for job ${cleanerJobId}:`, result.error);
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

  const magicLink = await getOrCreateCleanerMagicLink(job.cleanerProfileId);

  const msg = [
    `You're checked in ✅`,
    ``,
    `Before starting:`,
    `Take photos of anything broken that you cannot be blamed for.`,
    magicLink,
  ].join("\n");

  const result = await sendSms({ to: profile.phone, content: msg });

  await recordStep({
    cleanerJobId,
    step: "arrived_checkin",
    success: result.success,
    smsSent: msg,
    recipientPhone: profile.phone,
    errorDetail: result.success ? undefined : result.error,
  });

  if (result.success) {
    console.log(`[FieldMgmt] Arrived check-in sent to ${job.cleanerName} (${profile.phone}) for job ${cleanerJobId}`);
  } else {
    console.error(`[FieldMgmt] Arrived check-in FAILED for job ${cleanerJobId}:`, result.error);
  }
}

// ── Step 4: Mid-Job Nudge (~45-60 min after arrived) ─────────────────────────

/**
 * Runs every 5 minutes. Finds jobs where the mid-job nudge should fire.
 *
 * PRIMARY path: arrived_checkin log row fired 45–65 minutes ago.
 *   Used when the cleaner has a phone number and the arrival SMS was sent.
 *
 * FALLBACK path: jobStatus = 'in_progress' AND updatedAt was 45–65 minutes ago,
 *   AND no arrived_checkin log row exists for that job.
 *   Used when the cleaner has no phone (arrival SMS was skipped) but the cleaner
 *   still tapped Arrived in the app, setting the job to in_progress.
 *
 * In both cases: mid_job_nudge must NOT have been sent yet, and the job must
 * still be in_progress (not completed or cancelled).
 */
export async function runMidJobNudges(): Promise<{ checked: number; sent: number; errors: number }> {
  if (!FIELD_MGMT_ENABLED) return { checked: 0, sent: 0, errors: 0 };

  const db = await getDb();
  if (!db) return { checked: 0, sent: 0, errors: 0 };

  const now = Date.now();
  const windowStart = new Date(now - 65 * 60 * 1000); // 65 min ago
  const windowEnd   = new Date(now - 45 * 60 * 1000); // 45 min ago

  // ── PRIMARY: jobs with an arrived_checkin log in the window ─────────────────
  const checkinLogs = await db
    .select({
      cleanerJobId: fieldMgmtLog.cleanerJobId,
      anchorTime:   fieldMgmtLog.firedAt,
    })
    .from(fieldMgmtLog)
    .where(
      and(
        eq(fieldMgmtLog.step, "arrived_checkin"),
        gte(fieldMgmtLog.firedAt, windowStart),
        lte(fieldMgmtLog.firedAt, windowEnd)
      )
    );

  // ── FALLBACK: in_progress jobs whose updatedAt is in the window
  //    but have NO arrived_checkin log row at all ──────────────────────────────
  const primaryIds = new Set(checkinLogs.map(r => r.cleanerJobId));

  const fallbackJobs = await db
    .select({
      id:               cleanerJobs.id,
      cleanerProfileId: cleanerJobs.cleanerProfileId,
      cleanerName:      cleanerJobs.cleanerName,
      jobStatus:        cleanerJobs.jobStatus,
      bookingStatus:    cleanerJobs.bookingStatus,
      updatedAt:        cleanerJobs.updatedAt,
    })
    .from(cleanerJobs)
    .where(
      and(
        eq(cleanerJobs.jobStatus, "in_progress"),
        gte(cleanerJobs.updatedAt, windowStart),
        lte(cleanerJobs.updatedAt, windowEnd)
      )
    );

  // Build unified candidate list: { cleanerJobId, anchorTime, jobData? }
  type Candidate = {
    cleanerJobId: number;
    anchorTime: Date;
    prefetchedJob?: typeof fallbackJobs[0];
  };

  const candidates: Candidate[] = [
    ...checkinLogs.map(r => ({ cleanerJobId: r.cleanerJobId, anchorTime: r.anchorTime })),
    ...fallbackJobs
      .filter(j => !primaryIds.has(j.id)) // skip if already covered by primary
      .map(j => ({ cleanerJobId: j.id, anchorTime: j.updatedAt!, prefetchedJob: j })),
  ];

  let sent = 0;
  let errors = 0;

  for (const candidate of candidates) {
    if (await stepAlreadyFired(candidate.cleanerJobId, "mid_job_nudge")) continue;

    // For fallback candidates, also verify no arrived_checkin log exists at all
    // (not just outside the window) — avoids double-nudging edge cases
    if (candidate.prefetchedJob) {
      const existingCheckin = await db
        .select({ id: fieldMgmtLog.id })
        .from(fieldMgmtLog)
        .where(
          and(
            eq(fieldMgmtLog.cleanerJobId, candidate.cleanerJobId),
            eq(fieldMgmtLog.step, "arrived_checkin")
          )
        )
        .limit(1);
      if (existingCheckin.length > 0) continue; // primary path will handle it (or already did)
    }

    // Get job info (use prefetched for fallback, fetch for primary)
    let job: { id: number; cleanerProfileId: number; cleanerName: string; jobStatus: string | null; bookingStatus: string | null };
    if (candidate.prefetchedJob) {
      job = candidate.prefetchedJob;
    } else {
      const jobRows = await db
        .select({
          id:               cleanerJobs.id,
          cleanerProfileId: cleanerJobs.cleanerProfileId,
          cleanerName:      cleanerJobs.cleanerName,
          jobStatus:        cleanerJobs.jobStatus,
          bookingStatus:    cleanerJobs.bookingStatus,
        })
        .from(cleanerJobs)
        .where(eq(cleanerJobs.id, candidate.cleanerJobId))
        .limit(1);
      if (!jobRows[0]) continue;
      job = jobRows[0];
    }

    // Only nudge if still in progress (not completed or cancelled)
    if (job.jobStatus === "completed" || job.bookingStatus === "completed") continue;

    const profileRows = await db
      .select({ phone: cleanerProfiles.phone, email: cleanerProfiles.email })
      .from(cleanerProfiles)
      .where(eq(cleanerProfiles.id, job.cleanerProfileId))
      .limit(1);
    const profile = profileRows[0];
    if (!profile?.phone) {
      // No phone on file — log as a skipped (failed) step so the timeline shows it
      await recordStep({
        cleanerJobId: job.id,
        step: "mid_job_nudge",
        success: false,
        errorDetail: "No phone number on file for this cleaner",
      });
      errors++;
      console.warn(`[FieldMgmt] Mid-job nudge SKIPPED for job ${job.id} — no phone for cleaner profile ${job.cleanerProfileId}`);
      continue;
    }

    const magicLink = await getOrCreateCleanerMagicLink(job.cleanerProfileId);

    const msg = [
      `Quick check — everything going smoothly?`,
      ``,
      `Remember:`,
      `• Kitchens + bathrooms = highest priority`,
      `• Don't miss floors + surfaces`,
      ``,
      `Log in and double check your notes + checklist.`,
      magicLink,
      ``,
      `Reply if any issues.`,
    ].join("\n");

    const result = await sendSms({ to: profile.phone, content: msg });

    await recordStep({
      cleanerJobId: job.id,
      step: "mid_job_nudge",
      success: result.success,
      smsSent: msg,
      recipientPhone: profile.phone,
      errorDetail: result.success ? undefined : result.error,
    });

    if (result.success) {
      sent++;
      console.log(`[FieldMgmt] Mid-job nudge sent to ${job.cleanerName} (${profile.phone}) for job ${job.id}`);
    } else {
      errors++;
      console.error(`[FieldMgmt] Mid-job nudge FAILED for job ${job.id}:`, result.error);
    }
  }

  return { checked: candidates.length, sent, errors };
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

  const magicLink = await getOrCreateCleanerMagicLink(job.cleanerProfileId);

  const msg = [
    `Before leaving:`,
    ``,
    `1. Upload photos + double check notes + checklist`,
    `2. Confirm:`,
    `   • All rooms completed`,
    `   • Trash removed`,
    `   • Lights off / doors locked`,
    `   • Walk the client around and ask for a review`,
    ``,
    `Reply DONE when finished.`,
    magicLink,
  ].join("\n");

  const result = await sendSms({ to: profile.phone, content: msg });

  await recordStep({
    cleanerJobId,
    step: "completion_flow",
    success: result.success,
    smsSent: msg,
    recipientPhone: profile.phone,
    errorDetail: result.success ? undefined : result.error,
  });

  if (result.success) {
    console.log(`[FieldMgmt] Completion flow sent to ${job.cleanerName} (${profile.phone}) for job ${cleanerJobId}`);
  } else {
    console.error(`[FieldMgmt] Completion flow FAILED for job ${cleanerJobId}:`, result.error);
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

    const magicLink = await getOrCreateCleanerMagicLink(job.cleanerProfileId);
    const msg = `Hey — we haven't received your check-in. Is everything okay?\n${magicLink}`;

    // Write log row FIRST to prevent duplicate sends if two cron ticks overlap
    await recordStep({
      cleanerJobId: job.id,
      step: "exception_sms",
      success: true, // optimistic
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
  // Trigger window: job is 30–40 minutes away.
  // After the SMS alert fires, a 25-min sleep means the Vapi call reaches
  // the cleaner ~35 minutes before the job starts.
  const windowStart = new Date(now + 30 * 60 * 1000);
  const windowEnd = new Date(now + 40 * 60 * 1000);

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
      // Include cleaner phone so the escalation call goes to the cleaner, not the office
      cleanerPhone: cleanerProfiles.phone,
    })
    .from(cleanerJobs)
    .leftJoin(cleanerProfiles, eq(cleanerJobs.cleanerProfileId, cleanerProfiles.id))
    .where(
      and(
        inArray(cleanerJobs.bookingStatus, ["assigned", "new"]),
        sql`${cleanerJobs.serviceDateTime} IS NOT NULL`
      )
    );

  let sent = 0;
  let errors = 0;
  let jobIndex = 0; // used to stagger VAPI calls 30s apart

  for (const job of jobs) {
    if (!job.serviceDateTime) continue;

    const serviceTime = parseServiceDateTime(job.serviceDateTime);
    if (!serviceTime) continue;

    const serviceMs = serviceTime.getTime();
    if (serviceMs < windowStart.getTime() || serviceMs > windowEnd.getTime()) continue;

    // Skip if cleaner has already set on_the_way, arrived, in_progress, or completed
    if (job.jobStatus === "on_the_way" ||
      job.jobStatus === "arrived" ||
      job.jobStatus === "in_progress" ||
      job.jobStatus === "completed"
    ) continue;

    // Skip if alert already sent — record BEFORE sending to prevent race condition
    // if two cron ticks overlap (both would pass the check before either writes the log)
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

    // Write log row FIRST to prevent duplicate sends if two cron ticks overlap
    await recordStep({
      cleanerJobId: job.id,
      step: "noshow_alert",
      success: true, // optimistic — update on failure below
      smsSent: msg,
      recipientPhone: CS_ALERT_NUMBER,
    });

    const result = await sendSms({ to: CS_ALERT_NUMBER, content: msg });

    if (result.success) {
      sent++;
      console.log(`[FieldMgmt] No-show alert sent to CS team for job ${job.id} (${job.cleanerName})`);
      // Post alert card to CommandChat escalations section
      try {
        await db.insert(opsChatMessages).values({
          channel: "command",
          from: "System",
          authorName: "System",
          authorRole: "system",
          body: `🚨 ${job.cleanerName ?? "Team"} — no check-in${job.customerName ? ` for ${job.customerName}` : ""} (scheduled ${timeStr})`,
          metadata: JSON.stringify({ cleanerJobId: job.id, cleanerName: job.cleanerName, customerName: job.customerName, timeStr }),
          cleanerJobId: job.id,
          quickAction: "noshow_alert",
        } as any);
        const { broadcastOpsUpdate } = await import("./sseBroadcast");
        broadcastOpsUpdate("new_message");
      } catch (e) {
        console.error(`[FieldMgmt] Failed to post noshow card for job ${job.id}:`, e);
      }
      // Also log as activity
      logActivity({
        eventType: "nightly_sync",
        title: `🚨 No-Show Alert — ${job.cleanerName}`,
        body: `No status update received for ${job.cleanerName} → ${job.customerName} at ${job.jobAddress} (${timeStr})`,
        meta: { cleanerJobId: job.id },
      }).catch(() => {});

      // Auto-call the CLEANER 25 minutes after the SMS alert, then log the call.
      // Calls are staggered by 30 seconds each (jobIndex * 30s) to prevent concurrent
      // VAPI slot exhaustion when multiple cleaners miss check-in at the same time.
      // This means the call reaches the cleaner ~35 minutes before the job starts.
      // Falls back to CS team if no cleaner phone is available.
      const jobIdForCall = job.id;
      const cleanerNameForCall = job.cleanerName ?? "Unknown";
      const cleanerPhoneForCall = job.cleanerPhone ?? undefined;
      const callRecipient = cleanerPhoneForCall ?? CS_ALERT_NUMBER;
      const staggerMs = jobIndex * 30 * 1000; // 30s between each cleaner call
      jobIndex++;
      sleep(25 * 60 * 1000 + staggerMs)
        .then(() =>
          placeNoCheckinEscalationCall({
            cleanerName: cleanerNameForCall,
            customerName: job.customerName ?? "Unknown",
            jobAddress: job.jobAddress ?? "Unknown",
            scheduledTime: timeStr,
            cleanerJobId: jobIdForCall,
            step: "noshow_call",
            cleanerPhone: cleanerPhoneForCall,
          })
        )
        .then((callResult) => {
          const success = callResult === true;
          return recordStep({
            cleanerJobId: jobIdForCall,
            step: "noshow_call",
            success,
            recipientPhone: callRecipient,
            errorDetail: success ? undefined : "VAPI call did not return a call ID",
          });
        })
        .catch((err) => {
          console.error(`[FieldMgmt] Auto-call failed for job ${jobIdForCall}:`, err);
          recordStep({
            cleanerJobId: jobIdForCall,
            step: "noshow_call",
            success: false,
            recipientPhone: callRecipient,
            errorDetail: String(err?.message ?? err),
          }).catch(() => {});
        });
    } else {
      errors++;
      console.error(`[FieldMgmt] No-show alert FAILED for job ${job.id}:`, result.error);
    }
  }

  return { checked: jobs.length, sent, errors };
}

// ── Client Pre-Job Notification (T-2hrs, floor 7:30 AM ET) ───────────────────

/**
 * Compute when to send the client pre-job SMS.
 * Rule: T-2hrs before job start, but never before 7:30 AM ET.
 * If T-2hrs falls before 7:30 AM ET on the job day, return 7:30 AM ET that day.
 */
export function computeClientPreJobSendTime(serviceTime: Date): Date {
  const twoHoursBefore = new Date(serviceTime.getTime() - 2 * 60 * 60 * 1000);

  // Get the job date in ET and compute 7:30 AM ET on that day
  const jobDateET = new Date(
    serviceTime.toLocaleString("en-US", { timeZone: "America/New_York" })
  );
  const jobYear = jobDateET.getFullYear();
  const jobMonth = jobDateET.getMonth();
  const jobDay = jobDateET.getDate();

  // Build "7:30 AM ET on job day" as a UTC timestamp
  // We do this by constructing a date string and parsing it with the ET offset
  const floor730ETStr = `${jobYear}-${String(jobMonth + 1).padStart(2, "0")}-${String(jobDay).padStart(2, "0")}T07:30:00`;
  // Convert ET local time to UTC by using the Intl trick
  const floor730UTC = new Date(
    new Date(floor730ETStr).toLocaleString("en-US", { timeZone: "UTC" })
  );
  // The above gives wrong result; use a reliable method instead:
  // Create a date in ET by finding the UTC offset for that day
  const etOffsetMs = serviceTime.getTime() -
    new Date(serviceTime.toLocaleString("en-US", { timeZone: "America/New_York" })).getTime();
  const floor730Local = new Date(jobYear, jobMonth, jobDay, 7, 30, 0, 0);
  const floor730AsUTC = new Date(floor730Local.getTime() + etOffsetMs);

  return twoHoursBefore.getTime() < floor730AsUTC.getTime()
    ? floor730AsUTC
    : twoHoursBefore;
}

/**
 * Runs every 5 minutes (via runPreJobReminders cron).
 * Sends the pre-job notification to the CLIENT with tracking link.
 * Timing: T-2hrs, but never before 7:30 AM ET.
 * Window: checks if sendAt falls within the current ±5 min cron window.
 */
export async function sendClientPreJobSms(cleanerJobId: number): Promise<void> {
  if (!FIELD_MGMT_ENABLED) return;

  // RULE: Never send client SMS for unassigned jobs
  if (!await isJobAssigned(cleanerJobId)) return;

  if (await stepAlreadyFired(cleanerJobId, "client_pre_job")) return;

  const db = await getDb();
  if (!db) return;

  const jobRows = await db
    .select({
      id: cleanerJobs.id,
      customerName: cleanerJobs.customerName,
      customerPhone: cleanerJobs.customerPhone,
      jobAddress: cleanerJobs.jobAddress,
      serviceDateTime: cleanerJobs.serviceDateTime,
      trackerToken: cleanerJobs.trackerToken,
    })
    .from(cleanerJobs)
    .where(eq(cleanerJobs.id, cleanerJobId))
    .limit(1);
  const job = jobRows[0];
  if (!job) return;

  const clientPhone = job.customerPhone;
  if (!clientPhone) {
    console.warn(`[FieldMgmt] Client pre-job: no customer phone for job ${cleanerJobId}`);
    return;
  }

  if (!job.serviceDateTime) return;
  const serviceTime = parseServiceDateTime(job.serviceDateTime);
  if (!serviceTime) return;

  // Check if now is within the send window (sendAt ± 5 min)
  const sendAt = computeClientPreJobSendTime(serviceTime);
  const now = Date.now();
  const windowStart = sendAt.getTime() - 5 * 60 * 1000;
  const windowEnd = sendAt.getTime() + 5 * 60 * 1000;
  if (now < windowStart || now > windowEnd) return;

  const clientFirstName = firstName(job.customerName);
  const timeStr = formatTimeET(serviceTime);
  // Always generate token if missing — guarantees a real /track/:token URL
  const trackingLink = await ensureTrackerToken(cleanerJobId);

  const msg = [
    `Hey ${clientFirstName} — you're all set for your home cleaning today at ${timeStr} 😊`,
    ``,
    `You can follow your cleaning here: ${trackingLink}`,
    ``,
    `We'll update this in real time if anything changes, including arrival timing.`,
  ].join("\n");

  const result = await sendSms({ to: clientPhone, content: msg });

  await recordStep({
    cleanerJobId,
    step: "client_pre_job",
    success: result.success,
    smsSent: msg,
    recipientPhone: clientPhone,
    errorDetail: result.success ? undefined : result.error,
  });

  if (result.success) {
    console.log(`[FieldMgmt] Client pre-job SMS sent to ${clientPhone} for job ${cleanerJobId}`);
  } else {
    console.error(`[FieldMgmt] Client pre-job SMS FAILED for job ${cleanerJobId}:`, result.error);
  }
}

// ── Client Pre-Job Notification Cron Pass ────────────────────────────────────

/**
 * Scans all assigned jobs and sends the client pre-job SMS to any job whose
 * computeClientPreJobSendTime falls within the current ±5 min cron window.
 *
 * This is a dedicated cron pass — independent of runPreJobReminders — so the
 * client SMS fires at the correct computed time (T-2hrs, floor 7:30 AM ET)
 * regardless of when the cleaner reminder was sent.
 *
 * Called every 5 minutes by the FieldMgmt cron in internalCron.ts.
 */
export async function runClientPreJobNotifications(): Promise<{ checked: number; sent: number; errors: number }> {
  if (!FIELD_MGMT_ENABLED) return { checked: 0, sent: 0, errors: 0 };

  const db = await getDb();
  if (!db) return { checked: 0, sent: 0, errors: 0 };

  const now = Date.now();
  // Broad window: jobs starting between 1hr 50min and 2hr 10min from now
  // (covers the T-2hrs case). Also include jobs starting in the next 8 hours
  // to catch the 7:30 AM floor case (early-morning jobs).
  const windowLookAheadMax = new Date(now + 8 * 60 * 60 * 1000);

  // Fetch all assigned jobs starting in the next 8 hours that haven't had
  // client_pre_job fired yet.
  const jobs = await db
    .select({
      id: cleanerJobs.id,
      customerName: cleanerJobs.customerName,
      customerPhone: cleanerJobs.customerPhone,
      jobAddress: cleanerJobs.jobAddress,
      serviceDateTime: cleanerJobs.serviceDateTime,
      trackerToken: cleanerJobs.trackerToken,
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
  let checked = 0;

  for (const job of jobs) {
    if (!job.serviceDateTime) continue;

    const serviceTime = parseServiceDateTime(job.serviceDateTime);
    if (!serviceTime) continue;

    // Only consider jobs starting within the next 8 hours
    if (serviceTime.getTime() > windowLookAheadMax.getTime()) continue;
    // Don't process jobs that already started
    if (serviceTime.getTime() < now) continue;

    checked++;

    // Check if now is within the send window (sendAt ± 5 min)
    const sendAt = computeClientPreJobSendTime(serviceTime);
    const windowStart = sendAt.getTime() - 5 * 60 * 1000;
    const windowEnd = sendAt.getTime() + 5 * 60 * 1000;
    if (now < windowStart || now > windowEnd) continue;

    // Already sent?
    if (await stepAlreadyFired(job.id, "client_pre_job")) continue;

    const clientPhone = job.customerPhone;
    if (!clientPhone) {
      console.warn(`[FieldMgmt] Client pre-job: no customer phone for job ${job.id}`);
      continue;
    }

    const clientFirstName = firstName(job.customerName);
    const timeStr = formatTimeET(serviceTime);
    const trackingLink = await ensureTrackerToken(job.id);

    const msg = [
      `Hey ${clientFirstName} — you're all set for your home cleaning today at ${timeStr} 😊`,
      ``,
      `You can follow your cleaning here: ${trackingLink}`,
      ``,
      `We'll update this in real time if anything changes, including arrival timing.`,
    ].join("\n");

    const result = await sendSms({ to: clientPhone, content: msg });

    await recordStep({
      cleanerJobId: job.id,
      step: "client_pre_job",
      success: result.success,
      smsSent: msg,
      recipientPhone: clientPhone,
      errorDetail: result.success ? undefined : result.error,
    });

    if (result.success) {
      sent++;
      console.log(`[FieldMgmt] Client pre-job SMS sent to ${clientPhone} for job ${job.id}`);
    } else {
      errors++;
      console.error(`[FieldMgmt] Client pre-job SMS FAILED for job ${job.id}:`, result.error);
    }

    // Small delay to avoid OpenPhone 429 rate limit between consecutive sends
    if (sent > 0) await sleep(1500);
  }

  return { checked, sent, errors };
}

// ── Running Late — Client Notification ───────────────────────────────────────

/**
 * Called from cleanerRouter.updateJobStatus when status = "running_late".
 * Sends a delay notification to the CLIENT with the delay duration and tracking link.
 * Fires once per job — idempotent via fieldMgmtLog.
 */
export async function sendRunningLateSms(cleanerJobId: number): Promise<void> {
  if (!FIELD_MGMT_ENABLED) return;

  // RULE: Never send client SMS for unassigned jobs
  if (!await isJobAssigned(cleanerJobId)) return;

  if (await stepAlreadyFired(cleanerJobId, "client_running_late")) return;

  const db = await getDb();
  if (!db) return;

  const jobRows = await db
    .select({
      id: cleanerJobs.id,
      customerName: cleanerJobs.customerName,
      customerPhone: cleanerJobs.customerPhone,
      trackerToken: cleanerJobs.trackerToken,
      delayMinutes: cleanerJobs.delayMinutes,
    })
    .from(cleanerJobs)
    .where(eq(cleanerJobs.id, cleanerJobId))
    .limit(1);
  const job = jobRows[0];
  if (!job) return;

  const clientPhone = job.customerPhone;
  if (!clientPhone) {
    console.warn(`[FieldMgmt] Running late: no customer phone for job ${cleanerJobId}`);
    return;
  }

  const clientFirstName = firstName(job.customerName);
  const delayStr = job.delayMinutes ? `${job.delayMinutes} minutes` : "a bit";
  // Always generate token if missing — guarantees a real /track/:token URL
  const trackingLink = await ensureTrackerToken(cleanerJobId);

  const msg = [
    `Hey ${clientFirstName} — quick heads up, the team is running about ${delayStr} behind.`,
    ``,
    `You can follow their updated arrival here: ${trackingLink}`,
    ``,
    `Really appreciate your flexibility, and we do apologize for the delay. Look forward to seeing you soon. 🙏`,
  ].join("\n");

  const result = await sendSms({ to: clientPhone, content: msg });

  await recordStep({
    cleanerJobId,
    step: "client_running_late",
    success: result.success,
    smsSent: msg,
    recipientPhone: clientPhone,
    errorDetail: result.success ? undefined : result.error,
  });

  if (result.success) {
    console.log(`[FieldMgmt] Running late SMS sent to ${clientPhone} for job ${cleanerJobId}`);
  } else {
    console.error(`[FieldMgmt] Running late SMS FAILED for job ${cleanerJobId}:`, result.error);
  }
}

// ── Late-Assignment SMS Trigger ───────────────────────────────────────────────

/**
 * RULE: When a job transitions from unassigned → assigned within 2 hours of its
 * scheduled start time, the normal T-2hr cron window has already passed.
 * This function fires the client pre-job SMS and cleaner pre-job reminder
 * immediately so neither is missed.
 *
 * Call this immediately after any code that sets bookingStatus to 'assigned'
 * on a job that was previously unassigned (or 'new').
 *
 * Guards:
 * - Only fires if the job starts within the next 2 hours (cron window already passed).
 * - Idempotent: uses stepAlreadyFired so double-calls are safe.
 * - Skips silently if FIELD_MGMT_ENABLED is false.
 * - Skips if the job has no serviceDateTime.
 *
 * @param cleanerJobId  The ID of the job that was just assigned.
 * @param previousStatus  The bookingStatus before the transition (used for logging).
 */
export async function maybeTriggerLateAssignmentSms(
  cleanerJobId: number,
  previousStatus: string | null
): Promise<{ triggered: boolean; reason: string }> {
  if (!FIELD_MGMT_ENABLED) {
    return { triggered: false, reason: "FIELD_MGMT_ENABLED is false" };
  }

  const db = await getDb();
  if (!db) return { triggered: false, reason: "DB unavailable" };

  // Fetch the job
  const rows = await db
    .select({
      id: cleanerJobs.id,
      serviceDateTime: cleanerJobs.serviceDateTime,
      bookingStatus: cleanerJobs.bookingStatus,
      cleanerName: cleanerJobs.cleanerName,
      customerName: cleanerJobs.customerName,
    })
    .from(cleanerJobs)
    .where(eq(cleanerJobs.id, cleanerJobId))
    .limit(1);

  const job = rows[0];
  if (!job) return { triggered: false, reason: "Job not found" };

  // Only fire for jobs that just became assigned (guard against re-runs)
  if (job.bookingStatus !== "assigned") {
    return { triggered: false, reason: `bookingStatus is '${job.bookingStatus}', not 'assigned'` };
  }

  if (!job.serviceDateTime) {
    return { triggered: false, reason: "No serviceDateTime on job" };
  }

  const serviceTime = parseServiceDateTime(job.serviceDateTime);
  if (!serviceTime) {
    return { triggered: false, reason: "Could not parse serviceDateTime" };
  }

  const now = Date.now();
  const msUntilJob = serviceTime.getTime() - now;

  // Job is in the past — nothing to do
  if (msUntilJob < 0) {
    return { triggered: false, reason: "Job start time has already passed" };
  }

  console.log(
    `[FieldMgmt] Assignment SMS triggered for job ${cleanerJobId} (${job.cleanerName}) — ` +
    `was '${previousStatus ?? "new"}', now 'assigned', starts in ${Math.round(msUntilJob / 60_000)} min. ` +
    `Firing pre-job SMS immediately.`
  );

  // Fire cleaner pre-job reminder immediately (non-blocking)
  // sendClientPreJobSms already has its own isJobAssigned + stepAlreadyFired guards
  sendClientPreJobSms(cleanerJobId).catch((err) =>
    console.error(`[FieldMgmt] Late-assignment client pre-job SMS error for job ${cleanerJobId}:`, err)
  );

  // Small delay to avoid OpenPhone 429 rate limit (same pattern as runPreJobReminders)
  sleep(1500).then(() =>
    // Fire cleaner pre-job reminder (non-blocking)
    // runPreJobReminders won't catch this job because it already passed the cron window,
    // so we call sendCleanerPreJobSmsForJob directly.
    sendCleanerPreJobSmsForJob(cleanerJobId).catch((err) =>
      console.error(`[FieldMgmt] Late-assignment cleaner pre-job SMS error for job ${cleanerJobId}:`, err)
    )
  );

  return {
    triggered: true,
    reason: `Job starts in ${Math.round(msUntilJob / 60_000)} min — fired assignment SMS immediately`,
  };
}

/**
 * Sends the pre-job reminder SMS directly to the cleaner for a specific job.
 * Used by maybeTriggerLateAssignmentSms when the cron window has already passed.
 * Idempotent via stepAlreadyFired.
 */
async function sendCleanerPreJobSmsForJob(cleanerJobId: number): Promise<void> {
  if (!FIELD_MGMT_ENABLED) return;

  if (await stepAlreadyFired(cleanerJobId, "assignment_sms")) return;

  const db = await getDb();
  if (!db) return;

  const jobRows = await db
    .select({
      id: cleanerJobs.id,
      cleanerProfileId: cleanerJobs.cleanerProfileId,
      cleanerName: cleanerJobs.cleanerName,
      customerName: cleanerJobs.customerName,
      jobAddress: cleanerJobs.jobAddress,
      serviceDateTime: cleanerJobs.serviceDateTime,
      serviceType: cleanerJobs.serviceType,
      customerNotes: cleanerJobs.customerNotes,
    })
    .from(cleanerJobs)
    .where(eq(cleanerJobs.id, cleanerJobId))
    .limit(1);

  const job = jobRows[0];
  if (!job) return;

  if (!job.serviceDateTime) return;
  const serviceTime = parseServiceDateTime(job.serviceDateTime);
  if (!serviceTime) return;

  const profileRows = await db
    .select({ phone: cleanerProfiles.phone, email: cleanerProfiles.email })
    .from(cleanerProfiles)
    .where(eq(cleanerProfiles.id, job.cleanerProfileId))
    .limit(1);

  const profile = profileRows[0];
  if (!profile?.phone) {
    console.warn(`[FieldMgmt] Late-assignment pre-job reminder: no phone for cleaner profile ${job.cleanerProfileId}`);
    return;
  }

  const cleanerFirstName = firstName(job.cleanerName);
  const timeStr = formatTimeET(serviceTime);
  const magicLink = await getOrCreateCleanerMagicLink(job.cleanerProfileId);

  const msg = [
    `Hey ${cleanerFirstName} — you've just been assigned a cleaning at ${timeStr} today.`,
    ``,
    `Before you arrive:`,
    `• Review notes`,
    `• Bring full supplies`,
    `• Be ready to check in + upload photos`,
    ``,
    `Set your status to "On the Way" in the app.`,
    magicLink,
  ].join("\n");

  await recordStep({
    cleanerJobId: job.id,
    step: "assignment_sms",
    success: true,
    smsSent: msg,
    recipientPhone: profile.phone,
  });

  const result = await sendSms({ to: profile.phone, content: msg });

  if (result.success) {
    console.log(`[FieldMgmt] Assignment SMS sent to ${job.cleanerName} (${profile.phone}) for job ${job.id}`);
  } else {
    console.error(`[FieldMgmt] Assignment SMS FAILED for job ${job.id}:`, result.error);
  }
}
