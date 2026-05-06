/**
 * nurtureCron.ts
 *
 * Two exported functions called by internalCron.ts:
 *
 * 1. runNurtureEnrollment() — every 5 minutes
 *    Finds leads eligible for nurture (not booked, speed-to-lead window passed,
 *    not already enrolled) and enrolls them.
 *
 * 2. runNurtureSend() — every 5 minutes
 *    Finds active enrollments with nextSendAt <= now, sends the message,
 *    advances to the next step (or marks done), handles exit conditions.
 */

import { conversationSessions, nurtureEnrollments } from "../drizzle/schema";
import { eq, and, lte, gte, isNull, isNotNull, ne, lt, inArray, notInArray } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { getDb } from "./db";
import { normalizePhone, isValidUSPhone } from "./routers";
import { sendSms } from "./openphone";
import {
  enrollLead,
  endEnrollment,
  pauseEnrollment,
  STEP_MAP,
  buildNurtureContext,
  getNextSendAt,
  NURTURE_STEPS,
} from "./nurtureSequence";
import { nurtureStepScripts } from "../drizzle/schema";

// ── Quiet hours helpers ──────────────────────────────────────────────────────

/** Returns the current hour (0–23) in America/New_York timezone. */
function getEasternHour(date: Date = new Date()): number {
  return parseInt(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      hour: "numeric",
      hour12: false,
    }).format(date),
    10
  );
}

/**
 * Returns true if the current moment is within the quiet window (10pm–8am Eastern).
 */
function isEasternQuietHours(): boolean {
  const h = getEasternHour();
  return h >= 22 || h < 8;
}

/**
 * Returns the next 8:00am Eastern as a UTC Date.
 * Works correctly across DST transitions by iterating forward in 1-minute
 * increments from the current time until we hit 8am Eastern — but that's
 * too slow. Instead we use a direct calculation:
 *   1. Get today's Eastern date parts.
 *   2. Construct a UTC timestamp for 8am Eastern today by binary-searching
 *      the UTC offset at that moment.
 *   3. If that time is already past (or we're past 10pm), add 24h.
 */
function nextEasternSendWindow(): Date {
  const now = new Date();
  const h = getEasternHour(now);

  // Get Eastern date parts for today
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = fmt.formatToParts(now);
  const p: Record<string, string> = {};
  for (const part of parts) p[part.type] = part.value;

  // 8am Eastern:
  //   EDT (UTC-4): 8am ET = 12:00 UTC  → utcHour = 12
  //   EST (UTC-5): 8am ET = 13:00 UTC  → utcHour = 13
  // Try both and pick whichever Intl confirms as Eastern hour 8.
  const dateStr = `${p.year}-${p.month}-${p.day}`;
  let candidate: Date | null = null;
  for (const offsetHours of [4, 5]) {
    const utcHour = 8 + offsetHours;
    const probe = new Date(`${dateStr}T${String(utcHour).padStart(2, "0")}:00:00Z`);
    if (getEasternHour(probe) === 8) {
      candidate = probe;
      break;
    }
  }
  // Fallback: 12:00 UTC = 8am EDT (shouldn't be needed)
  if (candidate === null) {
    candidate = new Date(`${dateStr}T12:00:00Z`);
  }

  // If it's 10pm or later Eastern, push to tomorrow's 8am
  if (h >= 22) {
    candidate = new Date(candidate.getTime() + 24 * 3600 * 1000);
  }

  return candidate;
}

// ── Constants ─────────────────────────────────────────────────────────────────

/**
 * How long after lead submission before we consider the speed-to-lead window
 * "passed" and the lead is eligible for nurture enrollment.
 * Messages 1 and 2 fire at 0 and +12 min. We wait 15 min to be safe.
 */
const SPEED_TO_LEAD_WINDOW_MS = 15 * 60 * 1000; // 15 minutes

/**
 * Opt-out keywords — if the lead's last inbound message contains any of these,
 * end the sequence.
 */
const OPT_OUT_KEYWORDS = ["stop", "unsubscribe", "quit", "cancel", "end", "optout", "opt out", "opt-out"];

/**
 * Kill switch — set to false to disable all nurture SMS sends.
 * Flip to true when the sequence is validated and ready to go live.
 */
const NURTURE_SMS_ENABLED = true;

// ── Enrollment runner ─────────────────────────────────────────────────────────

export async function runNurtureEnrollment(): Promise<{
  checked: number;
  enrolled: number;
  errors: number;
}> {
  const db = await getDb();
  if (!db) return { checked: 0, enrolled: 0, errors: 0 };

  let checked = 0;
  let enrolled = 0;
  let errors = 0;

  try {
    // Find sessions that:
    // 1. Have a real phone number (not a placeholder)
    // 2. Are not CS-initiated (team members)
    // NOTE: No delay, no booked check, no aiMode check — enroll immediately so
    // every lead appears on the nurture page as soon as they come in.
    // Nurture SMS steps still respect the 15-min delay via nextSendAt.
    const candidates = await db
      .select({
        id: conversationSessions.id,
        leadPhone: conversationSessions.leadPhone,
        leadName: conversationSessions.leadName,
        serviceType: conversationSessions.serviceType,
        createdAt: conversationSessions.createdAt,
        stage: conversationSessions.stage,
        aiMode: conversationSessions.aiMode,
        messageHistory: conversationSessions.messageHistory,
      })
      .from(conversationSessions)
      .where(
        and(
          // Mirror the leads page: exclude CS, hiring, and review sessions
          sql`(${conversationSessions.leadSource} IS NULL OR ${conversationSessions.leadSource} NOT IN ('cs-inbound', 'cs-inbound-cleaner', 'cs_initiated', 'hiring_interview', 'review', 'review_rebooking'))`,
          // Only leads created AFTER go-live cutoff (May 03 2026 13:17 UTC)
          // Cutoff updated to prevent retroactive enrollment of existing unenrolled leads.
          sql`${conversationSessions.createdAt} > '2026-05-03 13:17:00'`,
        )
      )
      .orderBy(sql`${conversationSessions.createdAt} DESC`)
      .limit(100);

    checked = candidates.length;

    for (const session of candidates) {
      try {
         // Check if already enrolled (active, paused, done, OR soft-deleted).
        // Soft-deleted rows (deletedAt IS NOT NULL) act as a permanent block —
        // the session must never be re-enrolled even after the record is "deleted".
        const existingEnrollment = await db
          .select({ id: nurtureEnrollments.id, status: nurtureEnrollments.status, deletedAt: nurtureEnrollments.deletedAt })
          .from(nurtureEnrollments)
          .where(eq(nurtureEnrollments.sessionId, session.id))
          .limit(1);
        if (existingEnrollment.length > 0) {
          // Already enrolled (or soft-deleted) — skip
          continue;
        }

        // Check if lead has already booked (double-check via stage)
        if (
          session.stage === "BOOKED" ||
          session.stage === "COMPLETED" ||
          session.stage === "CLOSED"
        ) {
          continue;
        }

        // Check for opt-out in message history
        if (hasOptedOut(session.messageHistory)) {
          continue;
        }

        // Enroll
        const enrollmentId = await enrollLead(db, {
          id: session.id,
          leadPhone: session.leadPhone,
          leadName: session.leadName,
          serviceType: session.serviceType,
          createdAt: session.createdAt instanceof Date ? session.createdAt : new Date(session.createdAt),
        });

        if (enrollmentId !== null) {
          enrolled++;
        }
      } catch (err) {
        errors++;
        console.error(`[NurtureEnroll] Error enrolling session ${session.id}:`, err);
      }
    }
  } catch (err) {
    errors++;
    console.error("[NurtureEnroll] Fatal error:", err);
  }

  return { checked, enrolled, errors };
}

// ── Send runner ───────────────────────────────────────────────────────────────

export async function runNurtureSend(): Promise<{
  checked: number;
  sent: number;
  ended: number;
  errors: number;
}> {
  const db = await getDb();
  if (!db) return { checked: 0, sent: 0, ended: 0, errors: 0 };

  let checked = 0;
  let sent = 0;
  let ended = 0;
  let errors = 0;

  try {
    const now = new Date();

    // Find active enrollments where nextSendAt <= now (exclude soft-deleted rows)
    const due = await db
      .select()
      .from(nurtureEnrollments)
      .where(
        and(
          eq(nurtureEnrollments.status, "active"),
          lte(nurtureEnrollments.nextSendAt, now),
          isNull(nurtureEnrollments.deletedAt)
        )
      )
      .limit(50);

    checked = due.length;

    for (const enrollment of due) {
      try {
        // ── Optimistic claim guard ────────────────────────────────────────────
        // Cloud Run can run multiple instances simultaneously. Both may SELECT
        // the same enrollment row in the same cron tick. We atomically claim the
        // row by doing UPDATE ... WHERE status='active' AND nextStep=<current>.
        // If 0 rows affected, another instance already claimed it — skip.
        const claimResult = await db
          .update(nurtureEnrollments)
          .set({ updatedAt: new Date() })
          .where(
            and(
              eq(nurtureEnrollments.id, enrollment.id),
              eq(nurtureEnrollments.status, "active"),
              eq(nurtureEnrollments.nextStep, enrollment.nextStep),
              isNull(nurtureEnrollments.deletedAt)
            )
          );
        const rowsClaimed =
          (claimResult as any)?.rowsAffected ??
          (claimResult as any)?.[0]?.affectedRows ??
          1; // fallback: assume claimed if we can't read the count
        if (rowsClaimed === 0) {
          // Another instance already processed this enrollment — skip
          console.log(`[NurtureSend] Skipped enrollment ${enrollment.id} step ${enrollment.nextStep} — already claimed by another instance`);
          continue;
        }
        // Fetch the current session to check exit conditions
        const [session] = await db
          .select({
            id: conversationSessions.id,
            leadPhone: conversationSessions.leadPhone,
            leadName: conversationSessions.leadName,
            serviceType: conversationSessions.serviceType,
            stage: conversationSessions.stage,
            aiMode: conversationSessions.aiMode,
            messageHistory: conversationSessions.messageHistory,
          })
          .from(conversationSessions)
          .where(eq(conversationSessions.id, enrollment.sessionId))
          .limit(1);

        if (!session) {
          // Session deleted — end enrollment
          await endEnrollment(db, enrollment.id, "manual");
          ended++;
          continue;
        }

        // Exit: booked
        if (
          session.stage === "BOOKED" ||
          session.stage === "COMPLETED" ||
          session.stage === "CLOSED"
        ) {
          await endEnrollment(db, enrollment.id, "booked");
          ended++;
          continue;
        }

        // Exit: opted out
        if (hasOptedOut(session.messageHistory)) {
          await endEnrollment(db, enrollment.id, "opted_out");
          ended++;
          continue;
        }

        // ── Reply guard ──────────────────────────────────────────────────────
        // If the lead has sent ANY inbound message after the last nurture step
        // was sent (lastSentAt), the sequence must PAUSE — not just skip one tick.
        // A time-window check is not enough: a lead can reply hours later and
        // still be mid-conversation (Jacqueline replied 97 min after last send).
        if (hasReplyAfterLastSend(session.messageHistory as unknown as string, enrollment.lastSentAt)) {
          await pauseEnrollment(db, enrollment.sessionId);
          console.log(
            `[NurtureSend] Paused enrollment ${enrollment.id} (session ${enrollment.sessionId}) — lead replied after lastSentAt`
          );
          continue;
        }
        // No aiMode pause — enrollment only pauses on: book, manual pause from UI, or STOP reply

        // Validate the session phone before attempting to send.
        // isValidUSPhone checks for exactly 10 US digits (area code + exchange both >= 2XX),
        // which correctly rejects Thumbtack placeholders ("thumbtack-XXXXXXXXX"),
        // Bark placeholders ("bark-sms-XXXXXXXXX"), and any other non-US strings —
        // while accepting real phones in any format: "443-202-3031", "(443) 202-3031", "+14432023031".
        const rawPhone = session.leadPhone ?? enrollment.leadPhone;
        if (!rawPhone || !isValidUSPhone(rawPhone)) {
          // Phone still missing or not a real US number — keep enrollment active, retry next tick
          continue;
        }
        // Normalize to E.164 for the actual send
        const currentPhone = normalizePhone(rawPhone);

        // ── Quiet hours guard (10pm–8am Eastern) ──────────────────────────────
        // If we're in the quiet window, reschedule to 8am Eastern and skip.
        // The message is NOT lost — it fires at 8am on the next send tick.
        if (isEasternQuietHours()) {
          const nextWindow = nextEasternSendWindow();
          await db
            .update(nurtureEnrollments)
            .set({ nextSendAt: nextWindow })
            .where(eq(nurtureEnrollments.id, enrollment.id));
          console.log(
            `[NurtureSend] Quiet hours — rescheduled enrollment ${enrollment.id} step ${enrollment.nextStep} to ${nextWindow.toISOString()} (8am ET)`
          );
          continue;
        }

        // Sync normalized phone onto enrollment record if it was missing or different at enrollment time
        if (enrollment.leadPhone !== currentPhone) {
          await db.update(nurtureEnrollments).set({ leadPhone: currentPhone }).where(eq(nurtureEnrollments.id, enrollment.id));
        }
        // Get the step to send
        const step = STEP_MAP.get(enrollment.nextStep);
        if (!step) {
          // Invalid step — end sequence
          await endEnrollment(db, enrollment.id, "day30");
          ended++;
          continue;
        }

        // Build message — check for custom override first
        const [customScript] = await db
          .select({ body: nurtureStepScripts.body })
          .from(nurtureStepScripts)
          .where(eq(nurtureStepScripts.step, enrollment.nextStep))
          .limit(1);
        const ctx = buildNurtureContext({
          leadName: enrollment.leadFirstName,
          serviceType: enrollment.serviceType,
        });
        const messageBody = customScript
          ? customScript.body.replace(/\{\{first_name\}\}/gi, ctx.firstName).replace(/\{\{service\}\}/gi, ctx.serviceType)
          : step.buildMessage(ctx);

        // Send SMS (guarded by kill switch)
        if (!NURTURE_SMS_ENABLED) {
          console.log(`[NurtureSend] SMS DISABLED — would send step ${enrollment.nextStep} to ${enrollment.leadPhone}: ${messageBody.slice(0, 60)}...`);
        }
        const smsResult = NURTURE_SMS_ENABLED
          ? await sendSms({
              to: enrollment.leadPhone,
              content: messageBody,
            })
          : { success: true, error: null };

        if (!smsResult.success) {
          const errStr = smsResult.error ?? "";
          const isOptedOut =
            errStr.includes("opted out") ||
            errStr.includes("Opted Out") ||
            errStr.includes("0201400");
          if (isOptedOut) {
            // Permanently suppress — soft-delete so the cron never retries
            console.warn(
              `[NurtureSend] Lead opted out — suppressing enrollment ${enrollment.id} (session ${enrollment.sessionId})`
            );
            await endEnrollment(db, enrollment.id, "opted_out");
            ended++;
          } else {
            console.error(
              `[NurtureSend] SMS failed for enrollment ${enrollment.id} step ${enrollment.nextStep}:`,
              smsResult.error
            );
            errors++;
            // Don't advance — retry on next tick
          }
          continue;
        }

        // Append to session message history
        const existingHistory = parseMessageHistory(session.messageHistory);
        existingHistory.push({
          role: "assistant",
          content: messageBody,
          ts: Date.now(),
          source: "nurture",
          nurtureStep: enrollment.nextStep,
        });
        await db
          .update(conversationSessions)
          .set({ messageHistory: JSON.stringify(existingHistory) })
          .where(eq(conversationSessions.id, session.id));

        // Advance to next step
        const nextStepNum = enrollment.nextStep + 1;
        const maxStep = Math.max(...NURTURE_STEPS.map((s) => s.step));

        if (nextStepNum > maxStep) {
          // Sequence complete
          await db
            .update(nurtureEnrollments)
            .set({
              status: "done",
              endReason: "day30",
              endedAt: new Date(),
              lastStepSent: enrollment.nextStep,
              lastSentAt: new Date(),
            })
            .where(eq(nurtureEnrollments.id, enrollment.id));
          ended++;
        } else {
          // Find the next valid step (steps are not necessarily consecutive)
          const nextStep = NURTURE_STEPS.find((s) => s.step === nextStepNum)
            ?? NURTURE_STEPS.find((s) => s.step > enrollment.nextStep);

          if (!nextStep) {
            await endEnrollment(db, enrollment.id, "day30");
            ended++;
          } else {
            // Calculate nextSendAt from NOW (not leadCreatedAt) so stale leads
            // don't get multiple past-due steps fired back-to-back.
            // For relative steps (minutesAfter/hoursAfter) this gives the correct
            // delay from the current moment. For absolute etTime steps this gives
            // today's wall-clock time, which is always in the future.
            const nextSendAt = nextStep.scheduledAt(new Date());

            await db
              .update(nurtureEnrollments)
              .set({
                nextStep: nextStep.step,
                nextSendAt,
                lastStepSent: enrollment.nextStep,
                lastSentAt: new Date(),
              })
              .where(eq(nurtureEnrollments.id, enrollment.id));
          }
        }

        sent++;
        console.log(
          `[NurtureSend] Sent step ${enrollment.nextStep} to ${enrollment.leadPhone} (enrollment ${enrollment.id})`
        );
      } catch (err) {
        errors++;
        console.error(`[NurtureSend] Error processing enrollment ${enrollment.id}:`, err);
      }
    }
  } catch (err) {
    errors++;
    console.error("[NurtureSend] Fatal error:", err);
  }

  return { checked, sent, ended, errors };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function hasOptedOut(messageHistoryJson: string | null): boolean {
  if (!messageHistoryJson) return false;
  try {
    const history = JSON.parse(messageHistoryJson) as Array<{ role: string; content: string }>;
    // Check the last 5 inbound messages for opt-out keywords
    const inbound = history
      .filter((m) => m.role === "user" || m.role === "customer")
      .slice(-5);
    for (const msg of inbound) {
      const text = (msg.content ?? "").toLowerCase().trim();
      if (OPT_OUT_KEYWORDS.some((kw) => text === kw || text.startsWith(kw + " ") || text.endsWith(" " + kw))) {
        return true;
      }
    }
  } catch {
    // ignore parse errors
  }
  return false;
}

function parseMessageHistory(json: string | null): any[] {
  if (!json) return [];
  try {
    return JSON.parse(json);
  } catch {
    return [];
  }
}

/**
 * Pure helper — exported for unit tests.
 *
 * Returns true if the lead has sent at least one inbound message whose
 * timestamp is AFTER lastSentAt (the time the last nurture step was sent).
 * When lastSentAt is null (no nurture step has been sent yet), we do NOT
 * pause — the lead may have replied to the initial AI intake message, which
 * is not a nurture message and should not block the sequence from starting.
 */
export function hasReplyAfterLastSend(
  messageHistoryJson: string | null,
  lastSentAt: Date | null
): boolean {
  // No nurture step sent yet — cannot have replied "after" a send that never happened.
  if (!lastSentAt) return false;
  const history = parseMessageHistory(messageHistoryJson);
  const lastSentMs = lastSentAt.getTime();
  return history.some((msg: any) => {
    if (msg.role !== "user") return false;
    const ts = msg.ts ?? msg.timestamp ?? msg.createdAt;
    if (!ts) return false;
    return new Date(ts).getTime() > lastSentMs;
  });
}

