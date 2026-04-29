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
import { eq, and, lte, gte, isNull, ne, lt, inArray } from "drizzle-orm";
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
import { nurtureStepScripts } from "../drizzle/schema";

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
          // Has a real phone (not a placeholder)
          sql`${conversationSessions.leadPhone} NOT LIKE 'thumbtack-sms-%'`,
          sql`${conversationSessions.leadPhone} NOT LIKE 'yelp-sms-%'`,
          sql`${conversationSessions.leadPhone} NOT LIKE 'bark-sms-%'`,
          sql`${conversationSessions.leadPhone} NOT LIKE 'newsource-sms-%'`,
          sql`${conversationSessions.leadPhone} LIKE '+1%'`,
          // Exclude internal CS-initiated sessions (team members, not leads)
          ne(conversationSessions.leadSource as any, 'cs_initiated'),
          // Only leads from the last 30 days (prevent re-processing ancient history)
          gte(conversationSessions.createdAt, new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)),
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

        // Recency gate: if the lead sent an inbound message in the last 30 minutes,
        // skip this cycle to avoid overlapping with an active conversation.
        // The enrollment stays active and will be checked again on the next cron tick.
        const RECENCY_GATE_MS = 30 * 60 * 1000; // 30 minutes
        const recentInbound = (session.messageHistory as any[])?.some((msg: any) => {
          if (msg.role !== 'user') return false;
          const ts = msg.timestamp ?? msg.createdAt ?? msg.ts;
          if (!ts) return false;
          return Date.now() - new Date(ts).getTime() < RECENCY_GATE_MS;
        });
        if (recentInbound) {
          // Lead is mid-conversation — hold nurture, check again next tick
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
