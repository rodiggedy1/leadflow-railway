// Phase 2: background recorders that turn EXISTING detections into quality records. No AI calls, no messages.
// Each is fire-and-forget: the caller's SMS/email/call/rating/sign-off flow has already finished its own work and
// never waits for, or fails because of, these. Saving is idempotent (unique sourceKey), so retries are safe.
import type { Pool } from "mysql2/promise";
import type { SmsQualityComplaint, QualitySeverity } from "../shared/teamQualityIncidents";
import { recordQualitySignal, type QualitySignal } from "./teamQualityIncidents";
import { classifyComplaintText } from "./teamQualityRules";

/** Spaced attempts when the save itself fails (about 6 minutes in total). Once saved, a record is durable: any later
 * processing failure is retried automatically, also after a server restart. */
export const QUALITY_SAVE_ATTEMPTS = 5;
const RETRY_FACTORS = [1, 5, 30, 150];
let poolOverride: (() => Promise<Pool | null>) | null = null;
/** Tests only. */
export function setQualitySignalPoolForTests(resolve: (() => Promise<Pool | null>) | null, delayMs?: number): void {
  poolOverride = resolve; retryDelayMs = delayMs ?? 2000;
}
let retryDelayMs = 2000;
async function qualityPool(): Promise<Pool> {
  if (poolOverride) { const pool = await poolOverride(); if (!pool) throw new Error("QUALITY_DB_UNAVAILABLE"); return pool; }
  const { getDb, getPool } = await import("./db");
  await getDb();
  const pool = getPool();
  if (!pool) throw new Error("QUALITY_DB_UNAVAILABLE");
  return pool;
}

/** Save one signal with a few spaced attempts. Returns a promise for tests; production callers do not await it. */
export function saveQualitySignalInBackground(signal: QualitySignal): Promise<"saved" | "duplicate" | "failed"> {
  return (async () => {
    for (let attempt = 1; ; attempt++) {
      try {
        const saved = await recordQualitySignal(await qualityPool(), signal);
        return saved.duplicate ? "duplicate" as const : "saved" as const;
      } catch (error) {
        const code = error instanceof Error && /^[A-Z_]{3,64}$/.test(error.message) ? error.message
          : (error as { code?: unknown })?.code && /^[A-Z_]{3,64}$/.test(String((error as { code?: unknown }).code)) ? String((error as { code?: unknown }).code) : "QUALITY_SAVE_FAILED";
        if (attempt >= QUALITY_SAVE_ATTEMPTS) {
          console.error(`[quality-incident] could not save ${signal.channel} signal ${signal.sourceKey} after ${attempt} attempts (${code}); customer communication unaffected`);
          return "failed" as const;
        }
        await new Promise(resolve => { const timer = setTimeout(resolve, retryDelayMs * RETRY_FACTORS[Math.min(attempt, RETRY_FACTORS.length) - 1]); timer.unref?.(); });
      }
    }
  })().catch(() => "failed" as const);
}
function background(signal: QualitySignal): void {
  void saveQualitySignalInBackground(signal);
}

/** Claude's optional SMS label (already validated against the current message). */
export function recordSmsQualityComplaintInBackground(complaint: SmsQualityComplaint, binding: {
  providerMessageId: string; fromPhone: string; customerName: string | null; inboundText: string; receivedAt: number; sessionId: number;
}): void {
  try {
    background({
      sourceKey: `sms:${binding.providerMessageId}`, channel: "sms", detector: "claude_sms", reportedAtMs: binding.receivedAt,
      customerPhone: binding.fromPhone, customerName: binding.customerName, evidenceQuote: complaint.evidenceQuotes.join(" … "),
      evidenceText: binding.inboundText, sourceRef: { sessionId: binding.sessionId, providerMessageId: binding.providerMessageId },
      category: complaint.category, severity: complaint.severity, serviceDateHint: complaint.serviceDate,
      recleanRequested: complaint.recleanRequested, refundRequested: complaint.refundRequested,
    });
  } catch { /* never affects the SMS flow */ }
}

/** The voice assistant's existing complaint tool, classified automatically from the stated issue (no AI call).
 * If Claude's call processing labels the same call, its category replaces this one when they merge. */
export function recordVoiceComplaintInBackground(input: { callbackTaskId: number; phone: string | null; callerName: string | null; issue: string | null; bookingDate: string | null; atMs: number }): void {
  try {
    const { category, severity } = classifyComplaintText(input.issue);
    background({
      sourceKey: `call:callback:${input.callbackTaskId}`, channel: "call", detector: "vapi_complaint_tool", reportedAtMs: input.atMs,
      customerPhone: input.phone, customerName: input.callerName, evidenceQuote: null,
      evidenceText: [input.issue ? `Issue: ${input.issue}` : null, input.bookingDate ? `Booking date (as said): ${input.bookingDate}` : null].filter(Boolean).join("\n") || null,
      sourceRef: { callbackTaskId: input.callbackTaskId }, category, severity,
      recleanRequested: /\b(re-?clean|redo|come back)\b/i.test(input.issue ?? ""), refundRequested: /\brefund\b/i.test(input.issue ?? ""),
    });
  } catch { /* never affects the call */ }
}

/** The Gmail glance classifier's existing labels, classified automatically from its summary (no AI call). An
 * upset-customer or refund label with no cleaning/team cause stays a supporting signal and never penalises a team. */
export function recordEmailGlanceInBackground(input: { threadId: string; category: string; senderEmail: string | null; senderName: string | null; summary: string[] | string | null; atMs: number }): void {
  try {
    if (input.category !== "upset_customer" && input.category !== "refund_request") return;
    const summary = Array.isArray(input.summary) ? input.summary.join("\n") : input.summary;
    const { category, severity } = classifyComplaintText(summary);
    background({
      sourceKey: `email:thread:${input.threadId}`, channel: "email", detector: "gmail_glance", reportedAtMs: input.atMs,
      customerEmail: input.senderEmail, customerName: input.senderName, evidenceQuote: null, evidenceText: summary || null,
      sourceRef: { threadId: input.threadId, label: input.category }, category, severity,
      refundRequested: input.category === "refund_request",
    });
  } catch { /* never affects the inbox */ }
}

/** A customer portal rating of 3 or lower. Ratings already score automatically in the ratings metric, so this is a
 * supporting signal: it never counts as a complaint by itself, and joins a complaint about the same visit. */
export function recordLowRatingInBackground(input: { leadflowJobId: number; rating: number; phone: string | null; atMs: number }): void {
  try {
    if (!Number.isInteger(input.rating) || input.rating < 1 || input.rating > 3) return;
    const severity: QualitySeverity = input.rating === 1 ? "high" : input.rating === 2 ? "medium" : "low";
    background({
      sourceKey: `rating:job:${input.leadflowJobId}`, channel: "rating", detector: "portal_rating", reportedAtMs: input.atMs,
      customerPhone: input.phone, evidenceText: `Customer rated the visit ${input.rating} of 5.`, leadflowJobId: input.leadflowJobId,
      sourceRef: { leadflowJobId: input.leadflowJobId, rating: input.rating }, category: "unclassified", severity,
    });
  } catch { /* never affects the rating */ }
}

/** A cleaner's portal sign-off. "issue" = the customer raised a problem with this visit → a cleaning-quality complaint
 * for that job and team, automatically. "touchup" (fixed on the spot) is a supporting signal only. */
export function recordSignoffIssueInBackground(input: { leadflowJobId: number; customerResponse: string | null; customerNotes: string | null; atMs: number }): void {
  try {
    if (input.customerResponse !== "issue" && input.customerResponse !== "touchup") return;
    background({
      sourceKey: `signoff:job:${input.leadflowJobId}`, channel: "signoff", detector: "cleaner_signoff", reportedAtMs: input.atMs,
      evidenceText: [`Sign-off customer response: ${input.customerResponse}`, input.customerNotes ? `Notes: ${input.customerNotes}` : null].filter(Boolean).join("\n"),
      leadflowJobId: input.leadflowJobId, sourceRef: { leadflowJobId: input.leadflowJobId, customerResponse: input.customerResponse },
      category: input.customerResponse === "issue" ? "cleaning_quality" : "unclassified", severity: input.customerResponse === "issue" ? "medium" : "low",
    });
  } catch { /* never affects the sign-off */ }
}

/** Claude's optional label on its existing email/call processing (validated against that email or transcript). */
export function recordAiQualityComplaintInBackground(complaint: SmsQualityComplaint, source: {
  sourceKey: string; channel: "email" | "call"; detector: "claude_email" | "claude_call" | "claude_staff_call"; reportedAtMs: number;
  customerPhone?: string | null; customerEmail?: string | null; customerName?: string | null; evidenceText: string; sourceRef: Record<string, unknown>;
}): void {
  try {
    background({ ...source, evidenceQuote: complaint.evidenceQuotes.join(" … "), evidenceText: source.evidenceText.slice(0, 8000),
      category: complaint.category, severity: complaint.severity, serviceDateHint: complaint.serviceDate,
      recleanRequested: complaint.recleanRequested, refundRequested: complaint.refundRequested });
  } catch { /* never affects the email or call */ }
}
