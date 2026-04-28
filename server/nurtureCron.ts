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
import { eq, and, lte, isNull, ne, lt, inArray } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { getDb } from "./db";
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
    const cutoff = new Date(Date.now() - SPEED_TO_LEAD_WINDOW_MS);

    // Find sessions that:
    // 1. Were created more than 15 minutes ago (speed-to-lead window passed)
    // 2. Are not booked
    // 3. Have a real phone number (not a placeholder like "thumbtack-sms-*")
    // 4. Are not on human takeover (aiMode = 0 means AI is active)
    // 5. Do NOT already have an active or paused nurture enrollment
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
          // Speed-to-lead window passed
          lte(conversationSessions.createdAt, cutoff),
          // Not booked
          ne(conversationSessions.stage, "BOOKED" as any),
          // Has a real phone (not a placeholder)
          sql`${conversationSessions.leadPhone} NOT LIKE 'thumbtack-sms-%'`,
          sql`${conversationSessions.leadPhone} NOT LIKE 'yelp-sms-%'`,
          sql`${conversationSessions.leadPhone} NOT LIKE 'bark-sms-%'`,
          sql`${conversationSessions.leadPhone} NOT LIKE 'newsource-sms-%'`,
          sql`${conversationSessions.leadPhone} LIKE '+1%'`,
          // Not on human takeover (aiMode=1 means human has taken over)
          ne(conversationSessions.aiMode as any, 1),
        )
      )
      .limit(100);

    checked = candidates.length;

    for (const session of candidates) {
      try {
        // Check if already enrolled (active, paused, or done within last 30 days)
        const existingEnrollment = await db
          .select({ id: nurtureEnrollments.id, status: nurtureEnrollments.status })
          .from(nurtureEnrollments)
          .where(eq(nurtureEnrollments.sessionId, session.id))
          .limit(1);

        if (existingEnrollment.length > 0) {
          // Already enrolled — skip
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

    // Find active enrollments where nextSendAt <= now
    const due = await db
      .select()
      .from(nurtureEnrollments)
      .where(
        and(
          eq(nurtureEnrollments.status, "active"),
          lte(nurtureEnrollments.nextSendAt, now)
        )
      )
      .limit(50);

    checked = due.length;

    for (const enrollment of due) {
      try {
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

        // Pause: human takeover
        if (session.aiMode === 1) {
          await pauseEnrollment(db, session.id);
          continue;
        }

        // Get the step to send
        const step = STEP_MAP.get(enrollment.nextStep);
        if (!step) {
          // Invalid step — end sequence
          await endEnrollment(db, enrollment.id, "day30");
          ended++;
          continue;
        }

        // Build message
        const ctx = buildNurtureContext({
          leadName: enrollment.leadFirstName,
          serviceType: enrollment.serviceType,
        });
        const messageBody = step.buildMessage(ctx);

        // Send SMS
        const smsResult = await sendSms({
          to: enrollment.leadPhone,
          content: messageBody,
        });

        if (!smsResult.success) {
          console.error(
            `[NurtureSend] SMS failed for enrollment ${enrollment.id} step ${enrollment.nextStep}:`,
            smsResult.error
          );
          errors++;
          // Don't advance — retry on next tick
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
            const leadCreatedAt =
              enrollment.leadCreatedAt instanceof Date
                ? enrollment.leadCreatedAt
                : new Date(enrollment.leadCreatedAt);
            const nextSendAt = nextStep.scheduledAt(leadCreatedAt);

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
