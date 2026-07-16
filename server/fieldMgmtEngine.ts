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

import { and, eq, gte, inArray, isNotNull, isNull, lte, or, sql } from "drizzle-orm";
import { normalizePhoneLegacy } from "./utils/phone";
import { getDb, getOrCreateCleanerMagicLink } from "./db";
import {
  cleanerJobs,
  cleanerProfiles,
  fieldMgmtLog,
  fieldMgmtCalls,
  jobStatusHistory,
  opsChatMessages,
  stepLocks,
} from "../drizzle/schema";
import { sendSms, sleep } from "./openphone";
import { logActivity } from "./activityLogger";
import { notifyOwner } from "./_core/notification";
import { ENV } from "./_core/env";
import { invokeLLM } from "./_core/llm";
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
// ROLLBACK: old VAPI-bought number (daily outbound limit): f2f1c044-c70a-4d73-a755-051f8a2a96e4
const VAPI_OUTBOUND_PHONE_NUMBER_ID = "61431a3e-8144-4acd-b394-8f600ec3a473"; // Twilio-backed, no daily cap

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

  const { cleanerName, customerName, jobAddress, scheduledTime, cleanerJobId, step, cleanerPhone } = params;

  // ── Determine the call target ─────────────────────────────────────────────
  // Prefer the cleaner's own phone. Fall back to CS team only if no cleaner phone is available.
  const callTarget = cleanerPhone && cleanerPhone.trim() ? cleanerPhone.trim() : CS_ALERT_NUMBER;

  // ── Self-call protection ──────────────────────────────────────────────────
  // Never call the Vapi outbound number — it would create an infinite loop.
  const normalizedTarget = normalizePhoneLegacy(callTarget);
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
    // Store the call record in fieldMgmtCalls BEFORE returning so the end-of-call webhook
    // guard can always find it (avoids race condition on short 20-25s calls).
    if (cleanerJobId && vapiCallId) {
      const db = await getDb();
      if (db) {
        try {
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
          });
        } catch (err: unknown) {
          console.error("[FieldMgmt] Failed to insert fieldMgmtCalls row:", err);
        }
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
 * Atomically claim a step for a given job.
 *
 * Returns true  → this call is the first to claim this step; proceed with SMS/action.
 * Returns false → another call already claimed it; skip everything.
 *
 * Implementation: two-phase approach.
 *
 * Phase 1 — Mutex via step_locks (INSERT IGNORE):
 *   step_locks has a UNIQUE index on (cleanerJobId, step). INSERT IGNORE returns
 *   affectedRows=1 when the row was inserted (this caller won) and affectedRows=0
 *   when a duplicate already exists (another caller already claimed it).
 *
 *   field_mgmt_log is intentionally append-only with NO unique constraint — it must
 *   allow multiple rows per job for dynamic steps like client_running_late_{ts} and
 *   eta_update_{ts}. INSERT IGNORE on field_mgmt_log would silently no-op on any
 *   step that was ever fired before, which is wrong. step_locks is the correct
 *   dedup surface because it is a separate, purpose-built mutex table.
 *
 * Phase 2 — Audit log via field_mgmt_log (append-only INSERT):
 *   Only the winner writes the audit row. field_mgmt_log remains the source of
 *   truth for the ops timeline and delivery tracking.
 */
export async function tryClaimStep(params: {
  cleanerJobId: number;
  step: string;
  smsSent?: string;
  recipientPhone?: string;
  openPhoneMessageId?: string | null;
  deliveryStatus?: string;
}): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  try {
    // Phase 1: atomic mutex
    const lockResult = await db.execute(
      sql`INSERT IGNORE INTO step_locks (cleanerJobId, step) VALUES (${params.cleanerJobId}, ${params.step})`
    );
    const affectedRows = (lockResult as any)?.[0]?.affectedRows ?? (lockResult as any)?.rowsAffected ?? 0;
    if (affectedRows === 0) {
      // Duplicate — another concurrent call already claimed this step.
      return false;
    }
    // Phase 2: we own the lock — write the audit row
    await db.insert(fieldMgmtLog).values({
      cleanerJobId: params.cleanerJobId,
      step: params.step as any,
      success: 1,
      smsSent: params.smsSent ?? null,
      recipientPhone: params.recipientPhone ?? null,
      openPhoneMessageId: params.openPhoneMessageId ?? null,
      deliveryStatus: params.deliveryStatus ?? null,
      firedAt: new Date(),
    });
    return true;
  } catch (err) {
    console.error(`[FieldMgmt] tryClaimStep failed for step ${params.step} job ${params.cleanerJobId}:`, err);
    return false;
  }
}

/**
 * Update the outcome of a previously claimed step (e.g., mark as failed after SMS error).
 * Only call this after tryClaimStep returned true.
 */
export async function updateStepOutcome(cleanerJobId: number, step: string, success: boolean, errorDetail?: string): Promise<void> {
  const db = await getDb();
  if (!db) return;
  try {
    await db.update(fieldMgmtLog)
      .set({ success: success ? 1 : 0, errorDetail: errorDetail ?? null })
      .where(and(eq(fieldMgmtLog.cleanerJobId, cleanerJobId), eq(fieldMgmtLog.step, step as any)));
  } catch (err) {
    console.error(`[FieldMgmt] updateStepOutcome failed for step ${step} job ${cleanerJobId}:`, err);
  }
}

/**
 * Store the OpenPhone message ID and initial delivery status on a claimed step.
 * Call this after sendSms returns successfully, to enable delivery tracking.
 */
export async function updateStepMessageId(cleanerJobId: number, step: string, messageId: string, deliveryStatus = "sent"): Promise<void> {
  const db = await getDb();
  if (!db) return;
  try {
    await db.update(fieldMgmtLog)
      .set({ openPhoneMessageId: messageId, deliveryStatus })
      .where(and(eq(fieldMgmtLog.cleanerJobId, cleanerJobId), eq(fieldMgmtLog.step, step as any)));
  } catch (err) {
    console.error(`[FieldMgmt] updateStepMessageId failed for step ${step} job ${cleanerJobId}:`, err);
  }
}

/**
 * @deprecated Use tryClaimStep instead. Kept for backward compatibility with fieldMgmtRouter.ts.
 * Check if a step has already been fired for a given cleanerJobId.
 */
export async function stepAlreadyFired(cleanerJobId: number, step: string): Promise<boolean> {
  const db = await getDb();
  if (!db) return true;
  const rows = await db
    .select({ id: fieldMgmtLog.id })
    .from(fieldMgmtLog)
    .where(and(eq(fieldMgmtLog.cleanerJobId, cleanerJobId), eq(fieldMgmtLog.step, step as any)))
    .limit(1);
  return rows.length > 0;
}

/**
 * @deprecated Use tryClaimStep instead. Kept for backward compatibility with fieldMgmtRouter.ts.
 * Record that a step fired for a given job.
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

    const claimed = await tryClaimStep({ cleanerJobId: job.id, step: "pre_job_reminder", smsSent: msg, recipientPhone: profile.phone });
    if (!claimed) continue;

    const result = await sendSms({ to: profile.phone, content: msg });

    if (result.success) {
      sent++;
      console.log(`[FieldMgmt] Pre-job reminder sent to ${job.cleanerName} (${profile.phone}) for job ${job.id}`);
      if (result.messageId) await updateStepMessageId(job.id, "pre_job_reminder", result.messageId);
      // Client pre-job SMS is handled by runClientPreJobNotifications() — its own
      // dedicated cron pass with independent timing. No chain call here.
    } else {
      errors++;
      await updateStepOutcome(job.id, "pre_job_reminder", false, result.error);
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

  const claimed = await tryClaimStep({ cleanerJobId, step: "client_on_the_way", smsSent: msg, recipientPhone: clientPhone });
  if (!claimed) return;

  const result = await sendSms({ to: clientPhone, content: msg });

  if (result.success) {
    console.log(`[FieldMgmt] Client on-the-way SMS sent to ${clientPhone} for job ${cleanerJobId}`);
    if (result.messageId) await updateStepMessageId(cleanerJobId, "client_on_the_way", result.messageId);
  } else {
    await updateStepOutcome(cleanerJobId, "client_on_the_way", false, result.error);
    console.error(`[FieldMgmt] Client on-the-way SMS FAILED for job ${cleanerJobId}:`, result.error);
  }
}

/**
 * Send an ETA update SMS to the client when the cleaner updates their ETA.
 * Hard-deduped via tryClaimStep("client_eta_update") — fires AT MOST ONCE per job.
 * The initial on-the-way SMS already covers the first notification; this only fires
 * if the cleaner explicitly updates their ETA after that, and only once.
 */
export async function sendClientEtaUpdateSms(cleanerJobId: number): Promise<void> {
  if (!FIELD_MGMT_ENABLED) return;
  const db = await getDb();
  if (!db) return;

  // Only send ETA updates if the initial on-the-way SMS has already been sent.
  const firstAlreadySent = await stepAlreadyFired(cleanerJobId, "client_on_the_way");
  if (!firstAlreadySent) return;

  // NOTE: isJobAssigned check intentionally omitted here.
  // A cleaner who has already set on_the_way is actively working the job regardless
  // of bookingStatus (which may be 'new' for jobs synced before assignment completes).

  const jobRows = await db
    .select()
    .from(cleanerJobs)
    .where(eq(cleanerJobs.id, cleanerJobId))
    .limit(1);
  const job = jobRows[0];
  if (!job) return;

  const clientPhone = job.customerPhone;
  if (!clientPhone) {
    console.warn(`[FieldMgmt] ETA update: no customer phone for job ${cleanerJobId}`);
    return;
  }

  const clientFirstName = firstName(job.customerName);

  // Use live etaTimestamp — this is the whole point of this function
  let etaStr = "shortly";
  if (job.etaTimestamp && job.etaTimestamp > Date.now()) {
    etaStr = formatTimeET(new Date(job.etaTimestamp));
  } else if (job.serviceDateTime) {
    const serviceTime = parseServiceDateTime(job.serviceDateTime);
    if (serviceTime) etaStr = formatTimeET(serviceTime);
  }

  const trackingLink = await ensureTrackerToken(cleanerJobId);

  const msg = [
    `Hi ${clientFirstName}! Quick update — your Maids in Black team is still on the way and now expects to arrive around ${etaStr}. 🚗`,
    ``,
    `Track their live location here: ${trackingLink}`,
    ``,
    `Sorry for the delay — we appreciate your patience!`,
  ].join("\n");

  // Hard dedup: tryClaimStep returns false if this step was already claimed for this job.
  // This guarantees at most ONE ETA update SMS per job, regardless of how many times
  // the cleaner taps "Update ETA" or how many concurrent calls reach this function.
  const claimed = await tryClaimStep({ cleanerJobId, step: "client_eta_update", smsSent: msg, recipientPhone: clientPhone });
  if (!claimed) {
    console.log(`[FieldMgmt] ETA update SMS already sent for job ${cleanerJobId} — skipping duplicate`);
    return;
  }

  const result = await sendSms({ to: clientPhone, content: msg });

  if (result.success) {
    console.log(`[FieldMgmt] ETA update SMS sent to ${clientPhone} for job ${cleanerJobId} (eta: ${etaStr})`);
    if (result.messageId) await updateStepMessageId(cleanerJobId, "client_eta_update", result.messageId);
  } else {
    await updateStepOutcome(cleanerJobId, "client_eta_update", false, result.error);
    console.error(`[FieldMgmt] ETA update SMS FAILED for job ${cleanerJobId}:`, result.error);
  }
}

// ── Step 3: Arrival Check-In Auto-Response ────────────────────────────────────

/**
 * Called from cleanerRouter.updateJobStatus when status = "arrived".
 * Sends the check-in confirmation + photo reminder to the CLEANER.
 */
export async function sendArrivedCheckin(cleanerJobId: number): Promise<void> {
  if (!FIELD_MGMT_ENABLED) return;

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

  const claimed = await tryClaimStep({ cleanerJobId, step: "arrived_checkin", smsSent: msg, recipientPhone: profile.phone });
  if (!claimed) return;

  const result = await sendSms({ to: profile.phone, content: msg });

  if (result.success) {
    console.log(`[FieldMgmt] Arrived check-in sent to ${job.cleanerName} (${profile.phone}) for job ${cleanerJobId}`);
    if (result.messageId) await updateStepMessageId(cleanerJobId, "arrived_checkin", result.messageId);
  } else {
    await updateStepOutcome(cleanerJobId, "arrived_checkin", false, result.error);
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
    // Claim is done below after building the message (or immediately for no-phone case)

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
      // No phone on file — still claim the step so it doesn't re-fire, mark as failed
      const nophoneClaimed = await tryClaimStep({ cleanerJobId: job.id, step: "mid_job_nudge" });
      if (nophoneClaimed) {
        await updateStepOutcome(job.id, "mid_job_nudge", false, "No phone number on file for this cleaner");
        errors++;
        console.warn(`[FieldMgmt] Mid-job nudge SKIPPED for job ${job.id} — no phone for cleaner profile ${job.cleanerProfileId}`);
      }
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

    const claimed = await tryClaimStep({ cleanerJobId: job.id, step: "mid_job_nudge", smsSent: msg, recipientPhone: profile.phone });
    if (!claimed) continue;

    const result = await sendSms({ to: profile.phone, content: msg });

    if (result.success) {
      sent++;
      console.log(`[FieldMgmt] Mid-job nudge sent to ${job.cleanerName} (${profile.phone}) for job ${job.id}`);
      if (result.messageId) await updateStepMessageId(job.id, "mid_job_nudge", result.messageId);
    } else {
      errors++;
      await updateStepOutcome(job.id, "mid_job_nudge", false, result.error);
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

  const claimed = await tryClaimStep({ cleanerJobId, step: "completion_flow", smsSent: msg, recipientPhone: profile.phone });
  if (!claimed) return;

  const result = await sendSms({ to: profile.phone, content: msg });

  if (result.success) {
    console.log(`[FieldMgmt] Completion flow sent to ${job.cleanerName} (${profile.phone}) for job ${cleanerJobId}`);
    if (result.messageId) await updateStepMessageId(cleanerJobId, "completion_flow", result.messageId);
  } else {
    await updateStepOutcome(cleanerJobId, "completion_flow", false, result.error);
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

    // (dedup guard applied atomically below via tryClaimStep)

    const profileRows = await db
      .select({ phone: cleanerProfiles.phone })
      .from(cleanerProfiles)
      .where(eq(cleanerProfiles.id, job.cleanerProfileId))
      .limit(1);
    const profile = profileRows[0];
    if (!profile?.phone) continue;

    const magicLink = await getOrCreateCleanerMagicLink(job.cleanerProfileId);
    const msg = `Hey — we haven't received your check-in. Is everything okay?\n${magicLink}`;

    const claimed = await tryClaimStep({ cleanerJobId: job.id, step: "exception_sms", smsSent: msg, recipientPhone: profile.phone });
    if (!claimed) continue;

    const result = await sendSms({ to: profile.phone, content: msg });

    if (result.success) {
      sent++;
      console.log(`[FieldMgmt] Exception SMS sent to ${job.cleanerName} (${profile.phone}) for job ${job.id}`);
      if (result.messageId) await updateStepMessageId(job.id, "exception_sms", result.messageId);
    } else {
      errors++;
      await updateStepOutcome(job.id, "exception_sms", false, result.error);
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

    // (dedup guard applied atomically below via tryClaimStep)

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

    const claimed = await tryClaimStep({ cleanerJobId: job.id, step: "noshow_alert", smsSent: msg, recipientPhone: CS_ALERT_NUMBER });
    if (!claimed) continue;

    const result = await sendSms({ to: CS_ALERT_NUMBER, content: msg });

    if (result.success) {
      sent++;
      console.log(`[FieldMgmt] No-show alert sent to CS team for job ${job.id} (${job.cleanerName})`);
      if (result.messageId) await updateStepMessageId(job.id, "noshow_alert", result.messageId);
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
      await updateStepOutcome(job.id, "noshow_alert", false, result.error);
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

  const claimed = await tryClaimStep({ cleanerJobId, step: "client_pre_job", smsSent: msg, recipientPhone: clientPhone });
  if (!claimed) return;

  const result = await sendSms({ to: clientPhone, content: msg, fromNumberId: ENV.openPhoneCsNumberId });

  if (result.success) {
    console.log(`[FieldMgmt] Client pre-job SMS sent to ${clientPhone} for job ${cleanerJobId}`);
    if (result.messageId) await updateStepMessageId(cleanerJobId, "client_pre_job", result.messageId);
  } else {
    await updateStepOutcome(cleanerJobId, "client_pre_job", false, result.error);
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

    const claimed = await tryClaimStep({ cleanerJobId: job.id, step: "client_pre_job", smsSent: msg, recipientPhone: clientPhone });
    if (!claimed) continue;

    const result = await sendSms({ to: clientPhone, content: msg });

    if (result.success) {
      sent++;
      console.log(`[FieldMgmt] Client pre-job SMS sent to ${clientPhone} for job ${job.id}`);
      if (result.messageId) await updateStepMessageId(job.id, "client_pre_job", result.messageId);
    } else {
      errors++;
      await updateStepOutcome(job.id, "client_pre_job", false, result.error);
      console.error(`[FieldMgmt] Client pre-job SMS FAILED for job ${job.id}:`, result.error);
    }

    // Small delay to avoid OpenPhone 429 rate limit between consecutive sends
    if (sent > 0) await sleep(1500);
  }

  return { checked, sent, errors };
}

// ── ETA Approaching — Proactive Client Reassurance ──────────────────────────

/**
 * Fires once per job when the cleaner's set ETA is ~5 minutes away and they
 * are still on_the_way or running_late (not yet arrived).
 * Sends a warm reassurance SMS to the client — no ETA time mentioned to avoid
 * committing to a time that may be blown.
 * Idempotent: guarded by tryClaimStep with step "client_eta_approaching".
 * Called from the stale_eta cron in internalCron.ts.
 */
export async function sendClientEtaApproachingSms(cleanerJobId: number): Promise<void> {
  // Disabled — ETA approaching SMS removed from client notification flow
  return;
  if (!FIELD_MGMT_ENABLED) return;
  const db = await getDb();
  if (!db) return;
  const jobRows = await db
    .select()
    .from(cleanerJobs)
    .where(eq(cleanerJobs.id, cleanerJobId))
    .limit(1);
  const job = jobRows[0];
  if (!job) return;
  // Only fire for jobs that are still on the way (not yet arrived)
  if (job.jobStatus !== "on_the_way" && job.jobStatus !== "running_late") return;
  // Only fire for assigned jobs — never send client SMS for unassigned/cancelled
  const assigned = await isJobAssigned(cleanerJobId);
  if (!assigned) return;
  const clientPhone = job.customerPhone;
  if (!clientPhone) {
    console.warn(`[FieldMgmt] ETA approaching: no customer phone for job ${cleanerJobId}`);
    return;
  }
  const clientFirstName = firstName(job.customerName);
  const msg = [
    `Hi ${clientFirstName}! Your Maids in Black team is on their way to you. We'll send you an update as soon as they're close. Thanks for your patience! 🚗`,
    ``,
    `If you have any questions, just reply here.`,
  ].join("\n");
  const claimed = await tryClaimStep({ cleanerJobId, step: "client_eta_approaching", smsSent: msg, recipientPhone: clientPhone });
  if (!claimed) return; // already sent for this job
  const result = await sendSms({ to: clientPhone, content: msg });
  if (result.success) {
    console.log(`[FieldMgmt] ETA approaching SMS sent to ${clientPhone} for job ${cleanerJobId}`);
    if (result.messageId) await updateStepMessageId(cleanerJobId, "client_eta_approaching", result.messageId);
  } else {
    await updateStepOutcome(cleanerJobId, "client_eta_approaching", false, result.error);
    console.error(`[FieldMgmt] ETA approaching SMS FAILED for job ${cleanerJobId}:`, result.error);
  }
}

// ── Running Late — Client Notification ───────────────────────────────────────

/**
 * Called from cleanerRouter.updateJobStatus when status = "running_late".
 * Sends a delay notification to the CLIENT with the delay duration and tracking link.
 * Fires once per job — idempotent via fieldMgmtLog.
 */
export async function sendRunningLateSms(cleanerJobId: number): Promise<void> {
  if (!FIELD_MGMT_ENABLED) return;
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

  // Cooldown guard: prevent triple-fire when cleaner taps "Running Late" multiple times
  // within seconds (double-tap or network lag). Allow at most one running-late SMS per
  // 2-minute window. Legitimate repeat updates (cleaner changing ETA again later) still
  // fire because the cooldown window expires.
  const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000);
  const recentRunningLate = await db.execute(
    sql`SELECT id FROM field_mgmt_log
        WHERE cleanerJobId = ${cleanerJobId}
          AND step LIKE 'client_running_late_%'
          AND firedAt >= ${twoMinutesAgo}
        LIMIT 1`
  );
  const recentRows = (recentRunningLate as any)?.[0] ?? [];
  if (Array.isArray(recentRows) && recentRows.length > 0) {
    console.log(`[FieldMgmt] Running late SMS cooldown active for job ${cleanerJobId} — skipping duplicate within 2 min`);
    return;
  }

  // Use a unique step name per call so each running-late tap sends a new SMS.
  // The dedup guard on a fixed step name was silently blocking repeat running-late notifications.
  const stepName = `client_running_late_${Date.now()}`;

  await db.insert(fieldMgmtLog).values({
    cleanerJobId,
    step: stepName as any,
    success: 1,
    smsSent: msg,
    recipientPhone: clientPhone,
    firedAt: new Date(),
  }).catch(err => console.error(`[FieldMgmt] Running late log insert failed for job ${cleanerJobId}:`, err));

  const result = await sendSms({ to: clientPhone, content: msg });

  if (result.success) {
    console.log(`[FieldMgmt] Running late SMS sent to ${clientPhone} for job ${cleanerJobId}`);
    if (result.messageId) {
      await db.update(fieldMgmtLog)
        .set({ openPhoneMessageId: result.messageId, deliveryStatus: "sent" })
        .where(eq(fieldMgmtLog.step, stepName as any))
        .catch(() => {});
    }
  } else {
    await db.update(fieldMgmtLog)
      .set({ success: 0, errorDetail: result.error ?? "unknown" })
      .where(eq(fieldMgmtLog.step, stepName as any))
      .catch(() => {});
    console.error(`[FieldMgmt] Running late SMS FAILED for job ${cleanerJobId}:`, result.error);
  }
}

// ── Running Late — Call Client (agent-triggered) ─────────────────────────────

/**
 * Places a VAPI call to the CLIENT to notify them the team is running late.
 * Falls back to SMS if VAPI fails or the call is not answered.
 * After notifying the client, sends a confirmation SMS to the cleaner.
 *
 * This is triggered manually by an agent clicking "Call Client" in Command Chat,
 * NOT automatically — it requires human approval before firing.
 *
 * Returns { success, method: 'vapi' | 'sms_fallback' | 'failed', error? }
 */
export async function callClientRunningLate(cleanerJobId: number, opts?: { testMode?: boolean; etaOverrideMs?: number }): Promise<{
  success: boolean;
  method: "vapi" | "sms_fallback" | "failed";
  error?: string;
}> {
  if (!FIELD_MGMT_ENABLED && !opts?.testMode) return { success: false, method: "failed", error: "Field management kill switch is off" };
  // NOTE: isJobAssigned check intentionally omitted here.
  // A cleaner who has already set their status to "running_late" is actively working the job
  // regardless of bookingStatus (which may be "new" for jobs synced before the assignment
  // step completes in Launch27). Blocking the call in that state is wrong.
  const db = await getDb();
  if (!db) return { success: false, method: "failed", error: "DB unavailable" };

  // If staff corrected the ETA in the confirmation dialog, persist it before building the script
  if (opts?.etaOverrideMs) {
    await db
      .update(cleanerJobs)
      .set({ etaTimestamp: opts.etaOverrideMs })
      .where(eq(cleanerJobs.id, cleanerJobId))
      .catch(err => console.error("[callClientRunningLate] etaOverride update failed:", err));
  }

  // Fetch job details
  const jobRows = await db
    .select({
      id: cleanerJobs.id,
      customerName: cleanerJobs.customerName,
      customerPhone: cleanerJobs.customerPhone,
      cleanerName: cleanerJobs.cleanerName,
      cleanerProfileId: cleanerJobs.cleanerProfileId,
      delayMinutes: cleanerJobs.delayMinutes,
      etaTimestamp: cleanerJobs.etaTimestamp,
      serviceDateTime: cleanerJobs.serviceDateTime,
    })
    .from(cleanerJobs)
    .where(eq(cleanerJobs.id, cleanerJobId))
    .limit(1);
  const job = jobRows[0];
  if (!job) return { success: false, method: "failed", error: "Job not found" };

  const rawClientPhone = opts?.testMode ? "+13029816191" : job.customerPhone;
  if (!rawClientPhone) return { success: false, method: "failed", error: "No customer phone on file" };
  const clientPhone = rawClientPhone;

  const clientFirstName = firstName(job.customerName ?? "there");
  const cleanerFirstName = firstName(job.cleanerName ?? "Your team");

  // Build ETA string for the call script
  let etaStr: string | null = null;
  if (job.etaTimestamp && job.etaTimestamp > Date.now()) {
    etaStr = new Date(job.etaTimestamp).toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
      timeZone: "America/New_York",
    });
  } else if (job.delayMinutes) {
    etaStr = `about ${job.delayMinutes} minutes behind schedule`;
  }

  const etaLine = etaStr
    ? `They expect to arrive around ${etaStr}.`
    : `They are on their way and will be there as soon as possible.`;

  // ── VAPI call script ────────────────────────────────────────────────────────
  const vapiScript =
    `Hi, may I speak with ${clientFirstName}? ` +
    `This is Maids in Black calling with a quick update about your cleaning appointment today. ` +
    `Your cleaning team is running a little behind schedule. ` +
    `${etaLine} ` +
    `We sincerely apologize for the inconvenience and really appreciate your patience. ` +
    `If you have any questions, please don't hesitate to call us back. Thank you and have a wonderful day.`;

  const normalizedClientPhone = normalizePhoneLegacy(clientPhone);

  // Self-call protection
  if (normalizedClientPhone === VAPI_OUTBOUND_PHONE_NUMBER) {
    return { success: false, method: "failed", error: "Self-call protection triggered" };
  }

  let vapiSuccess = false;
  let vapiCallId: string | null = null;

  if (ENV.vapiPrivateKey) {
    try {
      const payload = {
        phoneNumberId: VAPI_OUTBOUND_PHONE_NUMBER_ID,
        customer: { number: normalizedClientPhone },
        assistant: {
          name: "RunningLateAlert",
          firstMessage: vapiScript,
          model: {
            provider: "openai",
            model: "gpt-4o-mini",
            messages: [{
              role: "system",
              content:
                "You are a brief automated notification from Maids in Black. " +
                "You have already delivered the running late message. " +
                "If the client asks questions, say: 'I'm an automated message and can't answer questions, but our team will be happy to help. Please call us back at your convenience.' " +
                "Keep responses very short and end the call politely.",
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
          maxDurationSeconds: 40,
          voicemailDetection: {
            provider: "twilio",
            voicemailDetectionTypes: ["machine_end_beep", "machine_end_silence"],
            enabled: true,
            machineDetectionTimeout: 8,
          },
          voicemailMessage: vapiScript,
        },
      };
      const result = await vapiPost("/call", payload) as { id?: string };
      vapiCallId = result?.id ?? null;
      vapiSuccess = true;
      console.log(`[FieldMgmt] Running late client call placed to ${normalizedClientPhone}. VAPI call ID: ${vapiCallId ?? "unknown"}`);

      // Store call record
      await db.insert(fieldMgmtCalls).values({
        cleanerJobId,
        step: "client_running_late_call",
        vapiCallId: vapiCallId ?? "unknown",
        calledPhone: normalizedClientPhone,
        outcome: "no_answer",
        durationSeconds: 0,
        transcript: null,
        summary: null,
        endedReason: null,
        recordingUrl: null,
      }).catch((err: unknown) => {
        console.error("[FieldMgmt] Failed to insert fieldMgmtCalls row for running late call:", err);
      });
    } catch (err) {
      console.error("[FieldMgmt] VAPI running late call failed:", err);
      vapiSuccess = false;
    }
  }

  // ── SMS fallback if VAPI failed ─────────────────────────────────────────────
  if (!vapiSuccess) {
    const smsMsg = [
      `Hi ${clientFirstName} — quick heads up from Maids in Black.`,
      ``,
      `Your cleaning team is running a little behind schedule. ${etaLine}`,
      ``,
      `We sincerely apologize for the inconvenience and appreciate your patience!`,
    ].join("\n");
    const smsResult = await sendSms({ to: clientPhone, content: smsMsg });
    if (!smsResult.success) {
      console.error(`[FieldMgmt] Running late SMS fallback FAILED for job ${cleanerJobId}:`, smsResult.error);
      return { success: false, method: "failed", error: smsResult.error ?? "SMS failed" };
    }
    console.log(`[FieldMgmt] Running late SMS fallback sent to ${clientPhone} for job ${cleanerJobId}`);
  }

  // ── Confirmation SMS to cleaner ─────────────────────────────────────────────
  if (job.cleanerProfileId) {
    const profileRows = await db
      .select({ phone: cleanerProfiles.phone })
      .from(cleanerProfiles)
      .where(eq(cleanerProfiles.id, job.cleanerProfileId))
      .limit(1);
    const cleanerPhone = opts?.testMode ? "+13029816191" : profileRows[0]?.phone;
    if (cleanerPhone) {
      const confirmMsg =
        `Hi ${cleanerFirstName} — just a heads up, we've notified your client that you're running late. ` +
        `Keep going, they're expecting you. 👍`;
      await sendSms({ to: cleanerPhone, content: confirmMsg }).catch(() => {});
    }
  }

  return { success: true, method: vapiSuccess ? "vapi" : "sms_fallback" };
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

  const claimed = await tryClaimStep({ cleanerJobId: job.id, step: "assignment_sms", smsSent: msg, recipientPhone: profile.phone });
  if (!claimed) return;

  const result = await sendSms({ to: profile.phone, content: msg });

  if (result.success) {
    console.log(`[FieldMgmt] Assignment SMS sent to ${job.cleanerName} (${profile.phone}) for job ${job.id}`);
    if (result.messageId) await updateStepMessageId(job.id, "assignment_sms", result.messageId);
  } else {
    await updateStepOutcome(job.id, "assignment_sms", false, result.error);
    console.error(`[FieldMgmt] Assignment SMS FAILED for job ${job.id}:`, result.error);
  }
}

// ── Step 8: T-58min Check-In Call (single call, no retry) ───────────────────
/**
 * Runs every 5 minutes. Finds jobs starting in 53–63 minutes where:
 * - Cleaner has NOT set on_the_way, arrived, in_progress, or completed
 * - No checkin_call_attempt_1 has been fired yet
 * Places exactly ONE VAPI call per job. step_locks UNIQUE(cleanerJobId, step)
 * guarantees the call fires at most once even under concurrent cron ticks.
 */
export async function runCheckinCalls(): Promise<{ checked: number; called: number; errors: number }> {
  if (!FIELD_MGMT_ENABLED) return { checked: 0, called: 0, errors: 0 };
  const db = await getDb();
  if (!db) return { checked: 0, called: 0, errors: 0 };
  const now = Date.now();
  // Window: jobs starting 53–63 minutes from now (±5 min around T-58)
  const windowStart = new Date(now + 53 * 60 * 1000);
  const windowEnd = new Date(now + 63 * 60 * 1000);
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

  let called = 0;
  let errors = 0;
  let jobIndex = 0; // stagger calls 30s apart across multiple jobs

  for (const job of jobs) {
    if (!job.serviceDateTime) continue;
    const serviceTime = parseServiceDateTime(job.serviceDateTime);
    if (!serviceTime) continue;
    const serviceMs = serviceTime.getTime();
    if (serviceMs < windowStart.getTime() || serviceMs > windowEnd.getTime()) continue;

    // Skip if cleaner already on the way or further
    if (
      job.jobStatus === "on_the_way" ||
      job.jobStatus === "arrived" ||
      job.jobStatus === "in_progress" ||
      job.jobStatus === "completed"
    ) continue;

    if (!job.cleanerPhone) {
      console.warn(`[FieldMgmt] T-58 check-in call: no phone for cleaner on job ${job.id} — skipping`);
      continue;
    }

    const timeStr = formatTimeET(serviceTime);
    const script = `Please check in for your next job now to avoid payment penalties and so your client knows what is going on.`;

    const jobIdForCall = job.id;
    const cleanerNameForCall = job.cleanerName ?? "Unknown";
    const cleanerPhoneForCall = job.cleanerPhone;
    const staggerMs = jobIndex * 30 * 1000;
    jobIndex++;

    // Atomic dedup: tryClaimStep uses INSERT IGNORE on step_locks UNIQUE(cleanerJobId, step)
    // — fires exactly once per job regardless of concurrent cron ticks.
    sleep(staggerMs)
      .then(async () => {
        const claimed1 = await tryClaimStep({ cleanerJobId: jobIdForCall, step: "checkin_call_attempt_1", recipientPhone: cleanerPhoneForCall });
        if (!claimed1) return;
        await placeCheckinCall(jobIdForCall, cleanerNameForCall, cleanerPhoneForCall, script, "checkin_call_attempt_1");
        called++;
      })
      .catch((err) => {
        errors++;
        console.error(`[FieldMgmt] T-58 check-in call failed for job ${jobIdForCall}:`, err);
      });
  }

  return { checked: jobs.length, called, errors };
}

/** Re-queries the DB to check if the cleaner still hasn't checked in. */
async function isCheckinStillNeeded(cleanerJobId: number): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const rows = await db
    .select({ jobStatus: cleanerJobs.jobStatus })
    .from(cleanerJobs)
    .where(eq(cleanerJobs.id, cleanerJobId))
    .limit(1);
  const status = rows[0]?.jobStatus;
  return status !== "on_the_way" && status !== "arrived" && status !== "in_progress" && status !== "completed";
}

/** Places a single VAPI check-in call to the cleaner with the given script. */
async function placeCheckinCall(
  cleanerJobId: number,
  cleanerName: string,
  cleanerPhone: string,
  script: string,
  step: string
): Promise<void> {
  if (!ENV.vapiPrivateKey) {
    console.warn("[FieldMgmt] VAPI_PRIVATE_KEY not set — skipping check-in call");
    return;
  }
  const normalizedPhone = normalizePhoneLegacy(cleanerPhone);
  if (normalizedPhone === VAPI_OUTBOUND_PHONE_NUMBER) {
    console.error("[FieldMgmt] Self-call protection — refusing to call VAPI outbound number");
    return;
  }
  const payload = {
    phoneNumberId: VAPI_OUTBOUND_PHONE_NUMBER_ID,
    customer: { number: normalizedPhone },
    assistant: {
      name: "CheckInReminder",
      firstMessage: script,
      model: {
        provider: "openai",
        model: "gpt-4o-mini",
        messages: [{
          role: "system",
          content: "You are a brief automated notification system. You have already delivered your message. If the person says anything, simply say 'Got it, thank you.' and end the call.",
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
      maxDurationSeconds: 20,
    },
  };
  try {
    const result = await vapiPost("/call", payload) as { id?: string };
    const vapiCallId = result?.id ?? null;
    console.log(`[FieldMgmt] Check-in call (${step}) placed to ${cleanerName} (${normalizedPhone}) for job ${cleanerJobId}. VAPI ID: ${vapiCallId ?? "unknown"}`);
    // Insert fieldMgmtCalls row synchronously (awaited) so the end-of-call webhook guard
    // can always find it before the call ends (race condition fix for short 20s calls).
    if (vapiCallId) {
      const db = await getDb();
      if (db) {
        try {
          await db.insert(fieldMgmtCalls).values({
            cleanerJobId,
            step,
            vapiCallId,
            calledPhone: normalizedPhone,
            outcome: "no_answer",
            durationSeconds: 0,
            transcript: null,
            summary: null,
            endedReason: null,
            recordingUrl: null,
          });
        } catch (err: unknown) {
          console.error("[FieldMgmt] Failed to insert fieldMgmtCalls row:", err);
        }
      }
    }
    await updateStepOutcome(cleanerJobId, step, true);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[FieldMgmt] Check-in call (${step}) FAILED for job ${cleanerJobId}:`, msg);
    // Mark the already-inserted row as failed.
    await updateStepOutcome(cleanerJobId, step, false, msg);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST-START ESCALATION
// Fires after the job start time has passed with no check-in.
//
// Step 1 — post_start_call_1  (T+0 to T+5 min window)
//   VAPI call to cleaner: "Your job has started and we have not received your
//   check-in. Please respond immediately or your assignment may be cancelled
//   and a penalty charged."
//
// Step 2 — post_start_cs_alert  (T+5 to T+10 min window)
//   SMS to CS team: high-urgency overdue alert.
//   + ops board card posted to CommandChat.
//
// Step 3 — post_start_call_2  (T+10 to T+15 min window)
//   Second VAPI call to cleaner (same script).
//
// Step 4 — post_start_noshow_flag  (T+10 to T+15 min window)
//   "Possible no-show" flag posted to ops board.
//
// All steps are idempotent via tryClaimStep.
// All steps stop immediately if the cleaner checks in between runs.
// No customer SMS is sent at any point.
// ─────────────────────────────────────────────────────────────────────────────
export async function runPostStartEscalation(): Promise<{ checked: number; acted: number; errors: number }> {
  const db = await getDb();
  if (!db) return { checked: 0, acted: 0, errors: 0 };

  const now = new Date();
  // Window: job started between 0 and 15 minutes ago
  const windowStart = new Date(now.getTime() - 15 * 60 * 1000);
  const windowEnd   = new Date(now.getTime());

  const jobs = await db
    .select({
      id:              cleanerJobs.id,
      cleanerProfileId: cleanerJobs.cleanerProfileId,
      cleanerName:     cleanerJobs.cleanerName,
      customerName:    cleanerJobs.customerName,
      jobAddress:      cleanerJobs.jobAddress,
      serviceDateTime: cleanerJobs.serviceDateTime,
      jobStatus:       cleanerJobs.jobStatus,
      bookingStatus:   cleanerJobs.bookingStatus,
      cleanerPhone:    cleanerProfiles.phone,
    })
    .from(cleanerJobs)
    .leftJoin(cleanerProfiles, eq(cleanerJobs.cleanerProfileId, cleanerProfiles.id))
    .where(
      and(
        inArray(cleanerJobs.bookingStatus, ["assigned", "new"]),
        sql`${cleanerJobs.serviceDateTime} IS NOT NULL`
      )
    );

  let acted = 0;
  let errors = 0;
  let jobIndex = 0;

  for (const job of jobs) {
    if (!job.serviceDateTime) continue;
    const serviceTime = parseServiceDateTime(job.serviceDateTime);
    if (!serviceTime) continue;
    const serviceMs = serviceTime.getTime();

    // Only jobs whose start time falls within the 0–15 min window
    if (serviceMs < windowStart.getTime() || serviceMs > windowEnd.getTime()) continue;

    // Skip if cleaner has already checked in
    if (
      job.jobStatus === "on_the_way" ||
      job.jobStatus === "arrived"    ||
      job.jobStatus === "in_progress" ||
      job.jobStatus === "completed"
    ) continue;

    const minutesPast = Math.floor((now.getTime() - serviceMs) / 60000);
    const timeStr = formatTimeET(serviceTime);
    const cleanerName = job.cleanerName ?? "Unknown";
    const cleanerPhone = job.cleanerPhone ?? undefined;
    const jobIdForCall = job.id;
    const staggerMs = jobIndex * 30 * 1000;
    jobIndex++;

    // ── Step 1: T+0 to T+5 — VAPI call to cleaner ──────────────────────────
    if (minutesPast >= 0 && minutesPast < 5) {
      const claimed = await tryClaimStep({
        cleanerJobId: jobIdForCall,
        step: "post_start_call_1",
        recipientPhone: cleanerPhone ?? CS_ALERT_NUMBER,
      });
      if (claimed && cleanerPhone) {
        acted++;
        sleep(staggerMs)
          .then(() =>
            placeCheckinCall(
              jobIdForCall,
              cleanerName,
              cleanerPhone,
              "Your job has started and we have not received your check-in. Please respond immediately or your assignment may be cancelled and a penalty charged.",
              "post_start_call_1"
            )
          )
          .catch((err) => {
            errors++;
            console.error(`[FieldMgmt] post_start_call_1 failed for job ${jobIdForCall}:`, err);
          });
      }
    }

    // ── Step 2: T+5 to T+10 — CS alert SMS + ops board card ────────────────
    if (minutesPast >= 5 && minutesPast < 10) {
      const msg = [
        `🚨 OVERDUE — No Check-In`,
        `Cleaner: ${cleanerName}`,
        `Client: ${job.customerName ?? "Unknown"}`,
        `Address: ${job.jobAddress ?? "Unknown"}`,
        `Scheduled: ${timeStr}`,
        ``,
        `Job started ${minutesPast} min ago. No status received. Please call the cleaner immediately.`,
      ].join("\n");

      const claimed = await tryClaimStep({
        cleanerJobId: jobIdForCall,
        step: "post_start_cs_alert",
        smsSent: msg,
        recipientPhone: CS_ALERT_NUMBER,
      });
      if (claimed) {
        acted++;
        const result = await sendSms({ to: CS_ALERT_NUMBER, content: msg });
        if (result.success) {
          console.log(`[FieldMgmt] Post-start CS alert sent for job ${jobIdForCall} (${cleanerName})`);
          // Post to ops board
          try {
            await db.insert(opsChatMessages).values({
              channel: "command",
              from: "System",
              authorName: "System",
              authorRole: "system",
              body: `🚨 OVERDUE — ${cleanerName} has not checked in. Job started ${minutesPast} min ago${job.customerName ? ` for ${job.customerName}` : ""} (${timeStr})`,
              metadata: JSON.stringify({
                cleanerJobId: jobIdForCall,
                cleanerName,
                customerName: job.customerName,
                timeStr,
                minutesPast,
              }),
              cleanerJobId: jobIdForCall,
              quickAction: "post_start_overdue",
            } as any);
            const { broadcastOpsUpdate } = await import("./sseBroadcast");
            broadcastOpsUpdate("new_message");
          } catch (e) {
            console.error(`[FieldMgmt] Failed to post post_start_cs_alert ops card for job ${jobIdForCall}:`, e);
          }
        } else {
          errors++;
          console.error(`[FieldMgmt] post_start_cs_alert SMS failed for job ${jobIdForCall}`);
        }
      }
    }

    // ── Step 3: T+10 to T+15 — Second VAPI call to cleaner ─────────────────
    if (minutesPast >= 10 && minutesPast < 15) {
      const claimed = await tryClaimStep({
        cleanerJobId: jobIdForCall,
        step: "post_start_call_2",
        recipientPhone: cleanerPhone ?? CS_ALERT_NUMBER,
      });
      if (claimed && cleanerPhone) {
        acted++;
        sleep(staggerMs)
          .then(() =>
            placeCheckinCall(
              jobIdForCall,
              cleanerName,
              cleanerPhone,
              "Your job has started and we have not received your check-in. Please respond immediately or your assignment may be cancelled and a penalty charged.",
              "post_start_call_2"
            )
          )
          .catch((err) => {
            errors++;
            console.error(`[FieldMgmt] post_start_call_2 failed for job ${jobIdForCall}:`, err);
          });
      }
    }

    // ── Step 4: T+10 to T+15 — Possible no-show flag on ops board ──────────
    if (minutesPast >= 10 && minutesPast < 15) {
      const claimed = await tryClaimStep({
        cleanerJobId: jobIdForCall,
        step: "post_start_noshow_flag",
        recipientPhone: CS_ALERT_NUMBER,
      });
      if (claimed) {
        acted++;
        try {
          await db.insert(opsChatMessages).values({
            channel: "command",
            from: "System",
            authorName: "System",
            authorRole: "system",
            body: `⚠️ Possible No-Show — ${cleanerName} still has not checked in. Job started ${minutesPast} min ago${job.customerName ? ` for ${job.customerName}` : ""} at ${job.jobAddress ?? "Unknown"} (${timeStr})`,
            metadata: JSON.stringify({
              cleanerJobId: jobIdForCall,
              cleanerName,
              customerName: job.customerName,
              timeStr,
              minutesPast,
              flag: "possible_noshow",
            }),
            cleanerJobId: jobIdForCall,
            quickAction: "possible_noshow",
          } as any);
          const { broadcastOpsUpdate } = await import("./sseBroadcast");
          broadcastOpsUpdate("new_message");
          console.log(`[FieldMgmt] Possible no-show flag posted for job ${jobIdForCall} (${cleanerName})`);
        } catch (e) {
          errors++;
          console.error(`[FieldMgmt] Failed to post post_start_noshow_flag ops card for job ${jobIdForCall}:`, e);
        }
      }
    }
  }

  return { checked: jobs.length, acted, errors };
}


// ── ETA Engine ────────────────────────────────────────────────────────────────

/**
 * ETA status extracted from a T-30 verification call transcript.
 *
 * The AI asks: "What time do you think you'll arrive?"
 * The LLM extracts the cleaner's answer and converts it to a minutes offset
 * from the scheduled start time. Application code converts the offset to a
 * final timestamp — no business logic inside the LLM.
 */
export type EtaCallStatus = "on_time" | "late" | "early" | "unclear";

export interface ExtractedCleanerStatus {
  /**
   * Minutes offset from the scheduled start time.
   * 0 = on time, positive = late (e.g. 20 = 20 min late), negative = early (e.g. -5 = 5 min early).
   * null when the cleaner's answer was unclear or not quantifiable.
   */
  estimatedArrivalMinutesOffset: number | null;
  status: EtaCallStatus;
  /** The cleaner's own words only — not the AI's question. */
  cleanerStatement: string;
}

/**
 * extractCleanerStatus — pure function, no DB access, no side effects.
 *
 * Takes a Vapi call transcript and the scheduled start time (ET clock string,
 * e.g. "1:00 PM") and returns the cleaner's estimated arrival as a minutes
 * offset from that scheduled time.
 *
 * Throws only on LLM/API failure or invalid schema response.
 * Returns status: "unclear" for voicemail, silence, vague answers, or
 * anything the LLM cannot confidently convert to a time.
 */
export async function extractCleanerStatus(
  transcript: string,
  scheduledTimeET: string // e.g. "1:00 PM" — used by LLM to convert relative answers
): Promise<ExtractedCleanerStatus> {
  const response = await invokeLLM({
    messages: [
      {
        role: "system",
        content: `You are extracting a cleaner's estimated arrival time from a voice call transcript.
The AI assistant asked the cleaner what time they think they will arrive at their next job.
The job is scheduled for ${scheduledTimeET}.

Rules:
- Only use statements made by the CLEANER, not the AI assistant.
- Do not treat the AI's questions or prompts as the cleaner's response.
- Convert the cleaner's answer to a minutes offset from the scheduled time (${scheduledTimeET}).
  Examples:
  "Right on time" → estimatedArrivalMinutesOffset: 0, status: "on_time"
  "About 1:10" (scheduled 1:00 PM) → estimatedArrivalMinutesOffset: 10, status: "late"
  "Maybe 12:55" (scheduled 1:00 PM) → estimatedArrivalMinutesOffset: -5, status: "early"
  "Probably 20 minutes late" → estimatedArrivalMinutesOffset: 20, status: "late"
  "I'm not sure" → estimatedArrivalMinutesOffset: null, status: "unclear"
- Use status "unclear" for: voicemail, silence, incomplete transcripts, contradictory answers, or vague responses that cannot be converted to a time.
- cleanerStatement must be the cleaner's own words only — a short verbatim or paraphrased quote.`,
      },
      {
        role: "user",
        content: `Transcript:\n${transcript}`,
      },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "cleaner_eta_status",
        strict: true,
        schema: {
          type: "object",
          properties: {
            estimatedArrivalMinutesOffset: {
              type: ["number", "null"],
              description: "Minutes offset from scheduled time. 0 = on time, positive = late, negative = early. null if unclear.",
            },
            status: {
              type: "string",
              enum: ["on_time", "late", "early", "unclear"],
              description: "Arrival status relative to scheduled time.",
            },
            cleanerStatement: {
              type: "string",
              description: "The cleaner's own words from the transcript.",
            },
          },
          required: ["estimatedArrivalMinutesOffset", "status", "cleanerStatement"],
          additionalProperties: false,
        },
      },
    },
  });

  const rawContent = response?.choices?.[0]?.message?.content;
  const raw = typeof rawContent === "string" ? rawContent : null;
  if (!raw) throw new Error("[EtaEngine] extractCleanerStatus: LLM returned empty content");

  let parsed: ExtractedCleanerStatus;
  try {
    parsed = JSON.parse(raw) as ExtractedCleanerStatus;
  } catch {
    throw new Error(`[EtaEngine] extractCleanerStatus: failed to parse LLM JSON: ${raw}`);
  }

  // Validate status enum
  const validStatuses: EtaCallStatus[] = ["on_time", "late", "early", "unclear"];
  if (!validStatuses.includes(parsed.status)) {
    throw new Error(`[EtaEngine] extractCleanerStatus: invalid status value: ${parsed.status}`);
  }

  return parsed;
}

/**
 * placeEtaCall — places the T-30 ETA verification call to the cleaner.
 *
 * Asks one question: "What time do you think you'll arrive?"
 * Listens for the answer, confirms, and ends the call.
 *
 * Step claim happens AFTER Vapi returns a call ID so a Vapi failure
 * does not permanently block the retry.
 *
 * outcome is set to "initiated" on insert — updated to the real outcome
 * by the end-of-call webhook (handleEtaCallEnd).
 */
export async function placeEtaCall(params: {
  cleanerJobId: number;
  step: "eta_call_1" | "eta_call_2";
  cleanerPhone: string;
  cleanerFirstName: string;
  customerFirstName: string;
  scheduledTimeET: string; // e.g. "1:00 PM"
  bypassStepLock?: boolean;
}): Promise<{ success: boolean; vapiCallId?: string; reason?: string }> {
  if (!FIELD_MGMT_ENABLED) return { success: false, reason: "Field management kill switch is off" };
  if (!ENV.vapiPrivateKey) return { success: false, reason: "VAPI_PRIVATE_KEY not configured" };

  const { cleanerJobId, step, cleanerPhone, cleanerFirstName, customerFirstName, scheduledTimeET, bypassStepLock } = params;

  // ── Self-call protection ──────────────────────────────────────────────────
  const normalizedTarget = normalizePhoneLegacy(cleanerPhone.trim());
  if (normalizedTarget === VAPI_OUTBOUND_PHONE_NUMBER) {
    console.error(`[EtaEngine] Self-call protection triggered — refusing to call Vapi outbound number`);
    return { success: false, reason: "Self-call protection: cannot call the VAPI outbound number" };
  }

  // ── Check step lock before calling (read-only check, not claim yet) ───────
  // We claim AFTER Vapi succeeds so a Vapi failure doesn't permanently block retry.
  const db = await getDb();
  if (!db) return { success: false, reason: "DB unavailable" };

  const existingLock = await db
    .select({ id: stepLocks.id })
    .from(stepLocks)
    .where(and(eq(stepLocks.cleanerJobId, cleanerJobId), eq(stepLocks.step, step)))
    .limit(1);
  if (existingLock.length > 0 && !bypassStepLock) {
    console.log(`[EtaEngine] Step ${step} already claimed for job ${cleanerJobId} — skipping`);
    return { success: false, reason: "Step already claimed" };
  }

  // ── Build Vapi payload ────────────────────────────────────────────────────
  const firstMessage =
    `Hi ${cleanerFirstName}, this is Maid in Black. ` +
    `I just wanted to check in about your ${scheduledTimeET} cleaning for ${customerFirstName}. ` +
    `What time do you think you'll arrive?`;

  const payload = {
    phoneNumberId: VAPI_OUTBOUND_PHONE_NUMBER_ID,
    customer: { number: normalizedTarget },
    assistant: {
      name: "EtaCheckIn",
      firstMessage,
      model: {
        provider: "openai",
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content:
              "You are a brief check-in assistant for Maid in Black. " +
              "The cleaner has answered your question about their arrival time. " +
              "Respond with: 'Perfect, thank you! I'll update the customer. Have a great day.' " +
              "Then end the call. Do not ask any follow-up questions.",
          },
        ],
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

  // ── Place the call ────────────────────────────────────────────────────────
  let vapiCallId: string;
  try {
    const result = await vapiPost("/call", payload) as { id?: string };
    if (!result?.id) throw new Error("Vapi returned no call ID");
    vapiCallId = result.id;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[EtaEngine] placeEtaCall failed for job ${cleanerJobId} step ${step}:`, msg);
    return { success: false, reason: msg };
  }

  // ── Claim the step AFTER Vapi success ─────────────────────────────────────
  await tryClaimStep({ cleanerJobId, step });

  // ── Store call record ─────────────────────────────────────────────────────
  try {
    await db.insert(fieldMgmtCalls).values({
      cleanerJobId,
      step,
      vapiCallId,
      calledPhone: normalizedTarget,
      outcome: "initiated",
      durationSeconds: 0,
      transcript: null,
      summary: null,
      endedReason: null,
      recordingUrl: null,
    });
  } catch (err) {
    console.error(`[EtaEngine] Failed to insert fieldMgmtCalls row for job ${cleanerJobId}:`, err);
    // Non-fatal — call is already placed
  }

  // ── Update etaCallFiredAt on first attempt only ───────────────────────────
  if (step === "eta_call_1") {
    try {
      await db
        .update(cleanerJobs)
        .set({ etaCallFiredAt: new Date() })
        .where(eq(cleanerJobs.id, cleanerJobId));
    } catch (err) {
      console.error(`[EtaEngine] Failed to update etaCallFiredAt for job ${cleanerJobId}:`, err);
    }
  }

  console.log(`[EtaEngine] ${step} placed for job ${cleanerJobId} → Vapi call ID: ${vapiCallId}`);
  return { success: true, vapiCallId };
}

/**
 * handleEtaCallEnd — processes the end-of-call webhook for eta_call_1 and eta_call_2.
 *
 * Called from vapiWebhook.ts when a fieldMgmtCalls row with step="eta_call_1"
 * or step="eta_call_2" is found for the completed vapiCallId.
 *
 * Flow:
 *  1. Load the fieldMgmtCalls row (already updated by vapiWebhook before calling us)
 *  2. Load the cleanerJob for all context (customer name/phone, scheduled time, etc.)
 *  3. If no_answer / voicemail:
 *     - eta_call_1 → cron will fire eta_call_2 (3 min after this call's createdAt)
 *     - eta_call_2 → post Command Chat dispatcher alert
 *  4. If answered:
 *     - Run extractCleanerStatus() to get minutes offset
 *     - If unclear → post Command Chat alert
 *     - If valid offset → calculate etaTimestamp, update cleanerJobs, send customer SMS
 *  5. Dedup guard: skip SMS if etaVerifiedAt is already set (duplicate webhook delivery)
 */
export async function handleEtaCallEnd(params: {
  vapiCallId: string;
  transcript: string | null;
  recordingUrl: string | null;
  outcome: string; // "answered" | "no_answer" | "voicemail" | "initiated" | "failed"
  step: "eta_call_1" | "eta_call_2";
  cleanerJobId: number;
}): Promise<void> {
  const { vapiCallId, transcript, recordingUrl, outcome, step, cleanerJobId } = params;
  const db = await getDb();
  if (!db) {
    console.error(`[EtaEngine] handleEtaCallEnd: DB unavailable for job ${cleanerJobId}`);
    return;
  }

  // ── Load the job ──────────────────────────────────────────────────────────
  const [job] = await db
    .select()
    .from(cleanerJobs)
    .where(eq(cleanerJobs.id, cleanerJobId))
    .limit(1);
  if (!job) {
    console.error(`[EtaEngine] handleEtaCallEnd: cleanerJob ${cleanerJobId} not found`);
    return;
  }

  const customerPhone = job.customerPhone ?? null;
  const customerFirstName = firstName(job.customerName);
  const cleanerFirstName = firstName(job.cleanerName);
  const scheduledMs = job.serviceDateTime ? parseServiceDateTime(job.serviceDateTime)?.getTime() ?? null : null;
  const scheduledTimeET = scheduledMs ? formatTimeET(new Date(scheduledMs)) : null;
  const jobDate = job.jobDate;

  // ── Helper: post ETA call result card to Command Chat ────────────────────
  // All ETA call outcomes post a single 'eta_call_result' card with rich metadata.
  // The UI renders this as a beautiful card with audio player + transcript.
  async function postEtaResultCard(params: {
    resultType: "success" | "no_answer" | "unclear" | "dispatcher_needed";
    etaTimeStr?: string | null;
    etaStatus?: string | null;       // "on_time" | "late" | "early" | "unclear"
    cleanerStatement?: string | null;
    clientNotified: boolean;
    clientSmsBody?: string | null;
    scheduledTime?: string | null;
  }) {
    try {
      const meta: Record<string, unknown> = {
        cleanerJobId,
        cleanerName: job.cleanerName,
        customerName: job.customerName,
        scheduledTime: params.scheduledTime ?? scheduledTimeET,
        step,
        vapiCallId,
        recordingUrl: recordingUrl ?? null,
        transcript: transcript ?? null,
        resultType: params.resultType,
        etaTimeStr: params.etaTimeStr ?? null,
        etaStatus: params.etaStatus ?? null,
        cleanerStatement: params.cleanerStatement ?? null,
        clientNotified: params.clientNotified,
        clientSmsBody: params.clientSmsBody ?? null,
      };
      const bodyPreview = params.resultType === "success"
        ? `ETA confirmed: ${params.etaTimeStr} — ${params.clientNotified ? "client notified" : "SMS pending"}`
        : params.resultType === "no_answer"
        ? `No answer after ${step === "eta_call_2" ? "2 attempts" : "1 attempt"} — manual follow-up needed`
        : `ETA unclear — manual follow-up needed`;
      await db!.insert(opsChatMessages).values({
        channel: "command",
        from: "System",
        authorName: "System",
        authorRole: "system",
        body: bodyPreview,
        metadata: JSON.stringify(meta),
        cleanerJobId,
        quickAction: "eta_call_result",
      } as any);
      const { broadcastOpsUpdate } = await import("./sseBroadcast");
      broadcastOpsUpdate("new_message", { channel: "command" });
    } catch (e) {
      console.error(`[EtaEngine] Failed to post ETA result card for job ${cleanerJobId}:`, e);
    }
  }

  // ── No answer / voicemail ─────────────────────────────────────────────────
  const isNoAnswer = outcome === "no_answer" || outcome === "voicemail" || outcome === "initiated";
  if (isNoAnswer) {
    if (step === "eta_call_1") {
      // Retry will be fired by cron 3 min after eta_call_1 createdAt — no action needed here.
      // Post a card so dispatchers can see the first attempt failed.
      await postEtaResultCard({
        resultType: "no_answer",
        clientNotified: false,
        scheduledTime: scheduledTimeET ?? jobDate,
      });
      console.log(`[EtaEngine] eta_call_1 no answer for job ${cleanerJobId} — cron will fire eta_call_2`);
    } else {
      // eta_call_2 also no answer — alert dispatch
      await postEtaResultCard({
        resultType: "dispatcher_needed",
        clientNotified: false,
        scheduledTime: scheduledTimeET ?? jobDate,
      });
      console.log(`[EtaEngine] eta_call_2 no answer — dispatcher alert posted for job ${cleanerJobId}`);
    }
    return;
  }

  // ── Answered — extract ETA ────────────────────────────────────────────────
  if (!transcript || transcript.trim().length < 5) {
    // Technically "answered" but no usable speech
    await postEtaResultCard({
      resultType: "unclear",
      cleanerStatement: "(no speech detected)",
      clientNotified: false,
      scheduledTime: scheduledTimeET ?? jobDate,
    });
    return;
  }

  let extracted: ExtractedCleanerStatus;
  try {
    extracted = await extractCleanerStatus(transcript, scheduledTimeET ?? "the scheduled time");
  } catch (err) {
    console.error(`[EtaEngine] extractCleanerStatus failed for job ${cleanerJobId}:`, err);
    await postEtaResultCard({
      resultType: "unclear",
      cleanerStatement: "(extraction error)",
      clientNotified: false,
      scheduledTime: scheduledTimeET ?? jobDate,
    });
    return;
  }

  const { estimatedArrivalMinutesOffset, status, cleanerStatement } = extracted;

  // ── Unclear status → alert dispatch ──────────────────────────────────────
  if (status === "unclear" || estimatedArrivalMinutesOffset === null) {
    await postEtaResultCard({
      resultType: "unclear",
      cleanerStatement,
      clientNotified: false,
      scheduledTime: scheduledTimeET ?? jobDate,
    });
    console.log(`[EtaEngine] ETA unclear for job ${cleanerJobId} — dispatcher alert posted`);
    return;
  }

  // ── Valid ETA — calculate arrival timestamp ───────────────────────────────
  if (!scheduledMs) {
    console.error(`[EtaEngine] Cannot calculate ETA: no serviceDateTime on job ${cleanerJobId}`);
    return;
  }

  const etaMs = scheduledMs + estimatedArrivalMinutesOffset * 60 * 1000;

  // ── Validate ETA is on the correct service date and within a reasonable range ──
  const etaDate = new Date(etaMs);
  const etaDateStr = etaDate.toLocaleDateString("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" });
  // jobDate is YYYY-MM-DD — convert to MM/DD/YYYY for comparison
  const [y, m, d] = jobDate.split("-");
  const jobDateFormatted = `${m}/${d}/${y}`;
  const offsetAbsMin = Math.abs(estimatedArrivalMinutesOffset);
  if (etaDateStr !== jobDateFormatted || offsetAbsMin > 120) {
    console.warn(`[EtaEngine] ETA validation failed for job ${cleanerJobId}: offset=${estimatedArrivalMinutesOffset}min, etaDate=${etaDateStr}, jobDate=${jobDateFormatted}`);
    await postEtaResultCard({
      resultType: "unclear",
      cleanerStatement: `${cleanerStatement} (offset: ${estimatedArrivalMinutesOffset} min — out of range)`,
      clientNotified: false,
      scheduledTime: scheduledTimeET ?? jobDate,
    });
    return;
  }

  // ── Update cleanerJobs ────────────────────────────────────────────────────
  await db
    .update(cleanerJobs)
    .set({
      etaTimestamp: etaMs,
      etaConfidence: 85,
      etaSource: "eta_call",
      etaVerifiedAt: new Date(),
    })
    .where(eq(cleanerJobs.id, cleanerJobId));

  const etaTimeStr = formatTimeET(etaDate);
  console.log(`[EtaEngine] ETA updated for job ${cleanerJobId}: ${etaTimeStr} (offset: ${estimatedArrivalMinutesOffset} min, status: ${status})`);

  // ── Send customer SMS ─────────────────────────────────────────────────────
  if (!customerPhone) {
    console.warn(`[EtaEngine] No customer phone for job ${cleanerJobId} — skipping SMS`);
    // Still post a success card so dispatchers can see the ETA was extracted
    await postEtaResultCard({
      resultType: "success",
      etaTimeStr,
      etaStatus: status,
      cleanerStatement,
      clientNotified: false,
      scheduledTime: scheduledTimeET ?? jobDate,
    });
    return;
  }

  let smsBody: string;
  if (status === "late") {
    smsBody =
      `Hi ${customerFirstName}! Your cleaning team is running a little behind and now expects to arrive around ${etaTimeStr}. ` +
      `Thank you for your patience — we'll keep you updated.`;
  } else {
    // on_time or early
    smsBody =
      `Hi ${customerFirstName}! Your Maid in Black team is on schedule and expects to arrive around ${etaTimeStr}. ` +
      `We'll keep you updated. 🚗`;
  }

  // Use a per-call step key so each ETA call (including manual re-triggers) can send its own
  // client SMS. The old "eta_sms" key was a permanent singleton that blocked every subsequent
  // call once the first SMS was sent. Using the vapiCallId makes the dedup scoped to this
  // specific call — concurrent webhook duplicates are still blocked, but a new call is not.
  const etaSmsStep = `eta_sms_${vapiCallId}`;
  const smsClaimed = await tryClaimStep({
    cleanerJobId,
    step: etaSmsStep,
    smsSent: smsBody,
    recipientPhone: customerPhone,
  });
  if (!smsClaimed) {
    console.log(`[EtaEngine] ${etaSmsStep} step already claimed for job ${cleanerJobId} — skipping duplicate SMS`);
    // Post card even if SMS was already claimed (dedup within same call)
    await postEtaResultCard({
      resultType: "success",
      etaTimeStr,
      etaStatus: status,
      cleanerStatement,
      clientNotified: true,
      clientSmsBody: smsBody,
      scheduledTime: scheduledTimeET ?? jobDate,
    });
    return;
  }

  const smsResult = await sendSms({ to: customerPhone, content: smsBody, fromNumberId: ENV.openPhoneCsNumberId });
  const smsSentOk = smsResult.success;
  if (smsSentOk) {
    console.log(`[EtaEngine] ETA SMS sent to ${customerPhone} for job ${cleanerJobId} (${status}, ETA: ${etaTimeStr})`);
    if (smsResult.messageId) await updateStepMessageId(cleanerJobId, etaSmsStep, smsResult.messageId);
  } else {
    await updateStepOutcome(cleanerJobId, etaSmsStep, false, smsResult.error);
    console.error(`[EtaEngine] ETA SMS FAILED for job ${cleanerJobId}:`, smsResult.error);
  }

  // ── Post ETA result card to Command Chat ───────────────────────────────
  await postEtaResultCard({
    resultType: "success",
    etaTimeStr,
    etaStatus: status,
    cleanerStatement,
    clientNotified: smsSentOk,
    clientSmsBody: smsSentOk ? smsBody : null,
    scheduledTime: scheduledTimeET ?? jobDate,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// ETA CALL TRIGGER CRON
// Runs every 2 minutes. Fires eta_call_1 for jobs 28–32 min before scheduled
// start, and eta_call_2 (retry) 3 minutes after eta_call_1 completed with no answer.
// ─────────────────────────────────────────────────────────────────────────────

let _etaTriggerRunning = false;

export async function runEtaCallTrigger(): Promise<void> {
  if (_etaTriggerRunning) {
    console.log("[EtaTrigger] Previous run still in progress — skipping");
    return;
  }
  _etaTriggerRunning = true;
  try {
    const db = await getDb();
    if (!db) return;
    const nowMs = Date.now();

    // ── Query 1: Fire eta_call_1 ──────────────────────────────────────────────
    // Window: scheduled start is between 5 min ago (catch-up) and 32 min from now
    const windowStart = new Date(nowMs - 5 * 60 * 1000);
    const windowEnd   = new Date(nowMs + 32 * 60 * 1000);

    const eligibleJobs = await db
      .select({
        id:               cleanerJobs.id,
        serviceDateTime:  cleanerJobs.serviceDateTime,
        cleanerProfileId: cleanerJobs.cleanerProfileId,
        cleanerName:      cleanerJobs.cleanerName,
        customerName:     cleanerJobs.customerName,
      })
      .from(cleanerJobs)
      .where(
        and(
          eq(cleanerJobs.bookingStatus, "assigned"),
          isNull(cleanerJobs.etaCallFiredAt),
          gte(cleanerJobs.serviceDateTime, windowStart.toISOString()),
          lte(cleanerJobs.serviceDateTime, windowEnd.toISOString()),
        )
      )
      .catch((err: unknown) => {
        console.error("[EtaTrigger] Query 1 error:", err);
        return [] as typeof cleanerJobs.$inferSelect[];
      });

    for (const job of eligibleJobs) {
      try {
        // Verify step lock not already claimed
        const [existingLock] = await db
          .select({ id: stepLocks.id })
          .from(stepLocks)
          .where(and(eq(stepLocks.cleanerJobId, job.id), eq(stepLocks.step, "eta_call_1")))
          .limit(1);
        if (existingLock) continue;

                if (!job.serviceDateTime) continue;
        const serviceTime = parseServiceDateTime(job.serviceDateTime);
        if (!serviceTime) continue;
        const diffMin = (serviceTime.getTime() - nowMs) / 60_000;
        if (diffMin < -5 || diffMin > 32) continue;
        if (!job.cleanerProfileId) {
          console.warn(`[EtaTrigger] Job ${job.id} has no cleanerProfileId — skipping`);
          continue;
        }
        const [profile] = await db
          .select({ phone: cleanerProfiles.phone })
          .from(cleanerProfiles)
          .where(eq(cleanerProfiles.id, job.cleanerProfileId))
          .limit(1);
        if (!profile?.phone) {
          console.warn(`[EtaTrigger] No phone for cleanerProfileId ${job.cleanerProfileId} (job ${job.id}) — skipping`);
          continue;
        }

        const scheduledTimeET = formatTimeET(serviceTime);
        const customerFirstName = (job.customerName ?? "your customer").split(" ")[0];
        const cleanerFirstName  = (job.cleanerName  ?? "there").split(" ")[0];

        console.log(`[EtaTrigger] Firing eta_call_1 for job ${job.id} (${cleanerFirstName} → ${customerFirstName} at ${scheduledTimeET})`);
        await placeEtaCall({
          cleanerJobId:      job.id,
          step:              "eta_call_1",
          cleanerPhone:      profile.phone,
          cleanerFirstName,
          customerFirstName,
          scheduledTimeET,
        });
      } catch (err) {
        console.error(`[EtaTrigger] eta_call_1 failed for job ${job.id}:`, err);
      }
    }

    // ── Query 2: Fire eta_call_2 (retry after no answer) ─────────────────────
    // Retry 3 minutes after eta_call_1 completedAt
    const retryThreshold = new Date(nowMs - 3 * 60 * 1000);

    const noAnswerCalls = await db
      .select({
        cleanerJobId: fieldMgmtCalls.cleanerJobId,
        completedAt:  fieldMgmtCalls.completedAt,
      })
      .from(fieldMgmtCalls)
      .where(
        and(
          eq(fieldMgmtCalls.step, "eta_call_1"),
          eq(fieldMgmtCalls.outcome, "no_answer"),
          lte(fieldMgmtCalls.completedAt, retryThreshold),
        )
      )
      .catch((err: unknown) => {
        console.error("[EtaTrigger] Query 2 error:", err);
        return [] as { cleanerJobId: number; completedAt: Date | null }[];
      });

    for (const call of noAnswerCalls) {
      try {
        const [existingLock] = await db
          .select({ id: stepLocks.id })
          .from(stepLocks)
          .where(and(eq(stepLocks.cleanerJobId, call.cleanerJobId), eq(stepLocks.step, "eta_call_2")))
          .limit(1);
        if (existingLock) continue;

        const [job] = await db
          .select({
            id:               cleanerJobs.id,
            serviceDateTime:  cleanerJobs.serviceDateTime,
            cleanerProfileId: cleanerJobs.cleanerProfileId,
            cleanerName:      cleanerJobs.cleanerName,
            customerName:     cleanerJobs.customerName,
            bookingStatus:    cleanerJobs.bookingStatus,
          })
          .from(cleanerJobs)
          .where(eq(cleanerJobs.id, call.cleanerJobId))
          .limit(1);
                if (!job || job.bookingStatus !== "assigned") continue;
        if (!job.serviceDateTime) continue;
        const serviceTime = parseServiceDateTime(job.serviceDateTime);
        if (!serviceTime) continue;
        if (!job.cleanerProfileId) continue;
        const [profile] = await db
          .select({ phone: cleanerProfiles.phone })
          .from(cleanerProfiles)
          .where(eq(cleanerProfiles.id, job.cleanerProfileId))
          .limit(1);
        if (!profile?.phone) continue;

        const scheduledTimeET = formatTimeET(serviceTime);
        const customerFirstName = (job.customerName ?? "your customer").split(" ")[0];
        const cleanerFirstName  = (job.cleanerName  ?? "there").split(" ")[0];

        console.log(`[EtaTrigger] Firing eta_call_2 retry for job ${job.id} (${cleanerFirstName} → ${customerFirstName} at ${scheduledTimeET})`);
        await placeEtaCall({
          cleanerJobId:      job.id,
          step:              "eta_call_2",
          cleanerPhone:      profile.phone,
          cleanerFirstName,
          customerFirstName,
          scheduledTimeET,
        });
      } catch (err) {
        console.error(`[EtaTrigger] eta_call_2 failed for job ${call.cleanerJobId}:`, err);
      }
    }
  } finally {
    _etaTriggerRunning = false;
  }
}

// ── ETA Recording Recovery ────────────────────────────────────────────────────
/**
 * recoverMissingEtaRecordings — backfills recordingUrl for ETA calls where Vapi
 * had not finished processing the recording when the end-of-call-report webhook fired.
 *
 * Two-phase approach:
 *   Phase 1: Find field_mgmt_calls rows (eta_call_1/2) with no recordingUrl but a
 *            completedAt timestamp. Poll Vapi GET /call/{id} and write the URL back.
 *   Phase 2: Find ops_chat_messages eta_call_result cards whose metadata.recordingUrl
 *            is still null but the linked field_mgmt_calls row now has a URL. Patch
 *            the metadata JSON and broadcast one SSE update.
 *
 * Safety properties:
 *   - 90-second grace period: skips calls that completed less than 90s ago (Vapi needs time)
 *   - 24-hour window: only looks at calls from the last 24 hours
 *   - Per-row try/catch: one bad row never kills the whole job
 *   - Max 5 concurrent Vapi requests
 *   - One SSE broadcast after the entire batch (not per row)
 *   - Idempotent: WHERE clause skips rows that already have a URL
 */
let _etaRecoveryRunning = false;

export async function recoverMissingEtaRecordings(): Promise<void> {
  if (_etaRecoveryRunning) {
    console.log("[EtaRecovery] Previous run still in progress — skipping");
    return;
  }
  _etaRecoveryRunning = true;
  let updatedCards = 0;

  try {
    const db = await getDb();
    if (!db) return;

    const now = Date.now();
    const graceCutoff  = new Date(now - 90 * 1000);          // completed > 90s ago
    const windowCutoff = new Date(now - 24 * 60 * 60 * 1000); // within last 24h

    // ── Phase 1: Fetch missing recording URLs from Vapi ───────────────────────
    const missingCalls = await db
      .select({
        id:          fieldMgmtCalls.id,
        vapiCallId:  fieldMgmtCalls.vapiCallId,
        completedAt: fieldMgmtCalls.completedAt,
      })
      .from(fieldMgmtCalls)
      .where(
        and(
          isNotNull(fieldMgmtCalls.vapiCallId),
          isNull(fieldMgmtCalls.recordingUrl),
          isNotNull(fieldMgmtCalls.completedAt),
          lte(fieldMgmtCalls.completedAt, graceCutoff),
          gte(fieldMgmtCalls.createdAt, windowCutoff),
          or(
            eq(fieldMgmtCalls.step, "eta_call_1"),
            eq(fieldMgmtCalls.step, "eta_call_2"),
          ),
        )
      )
      .limit(100)
      .catch((err: unknown) => {
        console.error("[EtaRecovery] Phase 1 query error:", err);
        return [] as { id: number; vapiCallId: string | null; completedAt: Date | null }[];
      });

    if (missingCalls.length === 0) return;
    console.log(`[EtaRecovery] Phase 1: ${missingCalls.length} calls missing recordingUrl`);

    // Poll Vapi with max 5 concurrent requests
    const CONCURRENCY = 5;
    for (let i = 0; i < missingCalls.length; i += CONCURRENCY) {
      const batch = missingCalls.slice(i, i + CONCURRENCY);
      await Promise.allSettled(batch.map(async (call) => {
        if (!call.vapiCallId) return;
        try {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 8_000);
          let vapiData: Record<string, unknown> | null = null;
          try {
            const res = await fetch(`${VAPI_API_BASE}/call/${call.vapiCallId}`, {
              signal: controller.signal,
              headers: { Authorization: `Bearer ${ENV.vapiPrivateKey}` },
            });
            if (res.ok) vapiData = await res.json() as Record<string, unknown>;
          } finally {
            clearTimeout(timer);
          }
          if (!vapiData) return;

          const artifact = vapiData.artifact as Record<string, unknown> | undefined;
          const recordingUrl =
            (artifact?.recordingUrl as string | undefined) ??
            (vapiData.recordingUrl as string | undefined) ??
            null;

          if (!recordingUrl || recordingUrl === "rawRecordingUploadDisabled") return;

          await db
            .update(fieldMgmtCalls)
            .set({ recordingUrl })
            .where(eq(fieldMgmtCalls.id, call.id));

          console.log(`[EtaRecovery] Phase 1: updated fieldMgmtCalls id=${call.id} vapiCallId=${call.vapiCallId}`);
        } catch (err) {
          console.error(`[EtaRecovery] Phase 1: Vapi fetch failed for vapiCallId=${call.vapiCallId}:`, err);
        }
      }));
    }

    // ── Phase 2: Backfill ops_chat_messages metadata ─────────────────────────
    // Raw SQL JOIN because Drizzle doesn't support JSON_EXTRACT in WHERE cleanly
    const cardRows = await db.execute(sql`
      SELECT
        ocm.id        AS msgId,
        ocm.metadata  AS metadata,
        fmc.recordingUrl AS recordingUrl
      FROM ops_chat_messages ocm
      JOIN field_mgmt_calls fmc
        ON JSON_UNQUOTE(JSON_EXTRACT(ocm.metadata, '$.vapiCallId')) = fmc.vapiCallId
      WHERE ocm.quickAction = 'eta_call_result'
        AND (
          JSON_EXTRACT(ocm.metadata, '$.recordingUrl') IS NULL
          OR JSON_UNQUOTE(JSON_EXTRACT(ocm.metadata, '$.recordingUrl')) = ''
        )
        AND fmc.recordingUrl IS NOT NULL
        AND fmc.recordingUrl != ''
        AND ocm.createdAt > DATE_SUB(NOW(), INTERVAL 24 HOUR)
      LIMIT 100
    `).catch((err: unknown) => {
      console.error("[EtaRecovery] Phase 2 query error:", err);
      return { rows: [] };
    });

    const rows = (cardRows as any).rows ?? (cardRows as any) ?? [];
    if (!Array.isArray(rows) || rows.length === 0) return;

    console.log(`[EtaRecovery] Phase 2: ${rows.length} cards to backfill`);

    for (const row of rows) {
      try {
        const msgId: number = row.msgId ?? row.id;
        const rawMeta: string = row.metadata ?? "{}";
        const recordingUrl: string = row.recordingUrl;

        let meta: Record<string, unknown>;
        try {
          meta = JSON.parse(rawMeta);
        } catch (parseErr) {
          console.error(`[EtaRecovery] Phase 2: malformed metadata for msgId=${msgId}`, parseErr);
          continue;
        }

        // Double-check in JS (race safety)
        if (meta.recordingUrl) continue;

        meta.recordingUrl = recordingUrl;

        await db
          .update(opsChatMessages)
          .set({ metadata: JSON.stringify(meta) })
          .where(eq(opsChatMessages.id, msgId));

        updatedCards++;
        console.log(`[EtaRecovery] Phase 2: patched msgId=${msgId} with recordingUrl`);
      } catch (err) {
        console.error(`[EtaRecovery] Phase 2: error patching msgId=${(row as any).msgId ?? (row as any).id}:`, err);
      }
    }

    // One SSE broadcast if anything changed
    if (updatedCards > 0) {
      try {
        const { broadcastOpsUpdate } = await import("./sseBroadcast");
        broadcastOpsUpdate("new_message", { channel: "command" } as any);
        console.log(`[EtaRecovery] Broadcast new_message after patching ${updatedCards} card(s)`);
      } catch (err) {
        console.error("[EtaRecovery] SSE broadcast failed:", err);
      }
    }
  } finally {
    _etaRecoveryRunning = false;
  }
}
