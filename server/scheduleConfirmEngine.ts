/**
 * scheduleConfirmEngine.ts
 *
 * Daily 5 PM ET schedule confirmation SMS flow.
 *
 * Flow:
 *   1. runScheduleConfirmSend(targetDate?) — called by the 5 PM cron.
 *      - Fetches all cleanerJobs for tomorrow (or targetDate) grouped by teamId.
 *      - For each team that has a phone number on file, sends one SMS listing
 *        all their jobs (time, client name, address).
 *      - Creates a conversation_sessions row (stage = SCHEDULE_CONFIRM_SENT).
 *
 *   2. handleScheduleConfirmReply(sessionId, fromPhone, text) — called by the
 *      webhook when an inbound SMS matches a SCHEDULE_CONFIRM_SENT session.
 *      - Detects affirmative replies ("confirm", "yes", "ok", "got it", "👍" …)
 *      - Marks all cleanerJobs for that team/date as scheduleConfirmed = 1.
 *      - Advances session to SCHEDULE_CONFIRM_DONE.
 *      - Returns the reply text to send back.
 */

import { and, eq, gte, lt, or } from "drizzle-orm";
import { getDb } from "./db";
import { cleanerJobs, cleanerProfiles, conversationSessions } from "../drizzle/schema";
import { sendSms } from "./openphone";
import { ENV } from "./_core/env";
import { allCleanersConfirmedForDate, postOpsSummary } from "./opsSummaryEngine";

// ─── Types ────────────────────────────────────────────────────────────────────

interface TeamJob {
  cleanerJobId: number;
  serviceDateTime: string | null;
  customerName: string | null;
  jobAddress: string | null;
}

interface TeamGroup {
  teamId: number | null;
  teamName: string | null;
  cleanerProfileId: number;
  cleanerName: string;
  phone: string; // E.164
  jobs: TeamJob[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Format a serviceDateTime ISO string as "9:00 AM" in ET. */
function formatTime(iso: string | null): string {
  if (!iso) return "TBD";
  try {
    const dt = new Date(iso);
    return dt.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
      timeZone: "America/New_York",
    });
  } catch {
    return "TBD";
  }
}

/** Format a YYYY-MM-DD date string as "Saturday, May 3" */
function formatDate(dateStr: string): string {
  try {
    // Parse as local date to avoid UTC offset shifting the day
    const [y, m, d] = dateStr.split("-").map(Number);
    const dt = new Date(y, m - 1, d);
    return dt.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
  } catch {
    return dateStr;
  }
}

/** Build the schedule SMS body for a team. */
function buildScheduleSms(teamName: string | null, dateStr: string, jobs: TeamJob[]): string {
  const greeting = teamName ? `Hi ${teamName}!` : "Hi Team!";
  const dateLabel = formatDate(dateStr);

  const lines = jobs.map((j, i) => {
    const time = formatTime(j.serviceDateTime);
    const client = j.customerName ?? "Client";
    const address = j.jobAddress ?? "Address on file";
    return `${i + 1}. ${time} — ${client}, ${address}`;
  });

  return (
    `${greeting} Here's your schedule for tomorrow, ${dateLabel}:\n\n` +
    lines.join("\n") +
    `\n\nPlease reply CONFIRM to let us know you're all set! 🧹`
  );
}

/** Detect if an inbound text is an affirmative confirmation. */
export function isConfirmationReply(text: string): boolean {
  const t = text.trim().toLowerCase();
  const patterns = [
    /^confirm(ed)?[.!]?$/,
    /^yes[.!]?$/,
    /^yep[.!]?$/,
    /^yup[.!]?$/,
    /^ok[.!]?$/,
    /^okay[.!]?$/,
    /^got it[.!]?$/,
    /^got them[.!]?$/,
    /^received[.!]?$/,
    /^sounds good[.!]?$/,
    /^sure[.!]?$/,
    /^will do[.!]?$/,
    /^👍/,
    /^✅/,
    /^confirmed/,
    /^yes.*confirm/,
    /^confirm.*yes/,
    /i('ll| will) be there/,
    /on it[.!]?$/,
    /noted[.!]?$/,
  ];
  return patterns.some((p) => p.test(t));
}

// ─── Main send function ───────────────────────────────────────────────────────

export interface ScheduleConfirmResult {
  date: string;
  teamsFound: number;
  teamsSent: number;
  teamsFailed: number;
  teamsMissingPhone: number;
  details: Array<{
    teamName: string | null;
    cleanerName: string;
    phone: string;
    jobCount: number;
    sent: boolean;
    error?: string;
    sessionId?: number;
  }>;
}

/**
 * Fetch next-day jobs grouped by team, send one schedule SMS per team.
 * @param targetDate YYYY-MM-DD override (defaults to tomorrow in ET)
 */
export async function runScheduleConfirmSend(targetDate?: string): Promise<ScheduleConfirmResult> {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");

  // Determine the target date (tomorrow in ET)
  const dateStr = targetDate ?? (() => {
    const now = new Date();
    // Get tomorrow in ET
    const etNow = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
    etNow.setDate(etNow.getDate() + 1);
    const y = etNow.getFullYear();
    const m = String(etNow.getMonth() + 1).padStart(2, "0");
    const d = String(etNow.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  })();

  console.log(`[ScheduleConfirm] Running for date: ${dateStr}`);

  // Fetch all cleanerJobs for the target date (non-cancelled)
  const jobs = await db
    .select({
      id: cleanerJobs.id,
      cleanerProfileId: cleanerJobs.cleanerProfileId,
      cleanerName: cleanerJobs.cleanerName,
      teamId: cleanerJobs.teamId,
      teamName: cleanerJobs.teamName,
      serviceDateTime: cleanerJobs.serviceDateTime,
      customerName: cleanerJobs.customerName,
      jobAddress: cleanerJobs.jobAddress,
      bookingStatus: cleanerJobs.bookingStatus,
    })
    .from(cleanerJobs)
    .where(eq(cleanerJobs.jobDate, dateStr));

  // Filter out cancelled jobs
  const activeJobs = jobs.filter(
    (j) => j.bookingStatus !== "cancelled" && j.bookingStatus !== "rescheduled"
  );

  if (activeJobs.length === 0) {
    console.log(`[ScheduleConfirm] No active jobs found for ${dateStr}`);
    return {
      date: dateStr,
      teamsFound: 0,
      teamsSent: 0,
      teamsFailed: 0,
      teamsMissingPhone: 0,
      details: [],
    };
  }

  // Group by cleanerProfileId (each cleaner gets their own SMS)
  const byProfile = new Map<number, { cleanerName: string; teamId: number | null; teamName: string | null; jobs: TeamJob[] }>();
  for (const j of activeJobs) {
    const existing = byProfile.get(j.cleanerProfileId);
    const jobEntry: TeamJob = {
      cleanerJobId: j.id,
      serviceDateTime: j.serviceDateTime,
      customerName: j.customerName,
      jobAddress: j.jobAddress,
    };
    if (existing) {
      existing.jobs.push(jobEntry);
    } else {
      byProfile.set(j.cleanerProfileId, {
        cleanerName: j.cleanerName,
        teamId: j.teamId,
        teamName: j.teamName,
        jobs: [jobEntry],
      });
    }
  }

  // Fetch phone numbers for all cleanerProfileIds
  const profileIds = Array.from(byProfile.keys());
  const profiles = await db
    .select({ id: cleanerProfiles.id, phone: cleanerProfiles.phone })
    .from(cleanerProfiles)
    .where(
      profileIds.length === 1
        ? eq(cleanerProfiles.id, profileIds[0])
        : or(...profileIds.map((id) => eq(cleanerProfiles.id, id)))
    );

  const phoneMap = new Map(profiles.map((p) => [p.id, p.phone]));

  const csNumberId = ENV.openPhoneCsNumberId;
  const result: ScheduleConfirmResult = {
    date: dateStr,
    teamsFound: byProfile.size,
    teamsSent: 0,
    teamsFailed: 0,
    teamsMissingPhone: 0,
    details: [],
  };

  for (const [profileId, group] of Array.from(byProfile.entries())) {
    const rawPhone = phoneMap.get(profileId);
    if (!rawPhone) {
      console.warn(`[ScheduleConfirm] No phone on file for cleaner ${group.cleanerName} (profileId=${profileId})`);
      result.teamsMissingPhone++;
      result.details.push({
        teamName: group.teamName,
        cleanerName: group.cleanerName,
        phone: "(none)",
        jobCount: group.jobs.length,
        sent: false,
        error: "No phone number on file",
      });
      continue;
    }

    // Dedup guard: skip if a schedule_confirm SMS was already sent to this cleaner today.
    // Prevents duplicate sends when Railway runs multiple instances during a rolling deploy.
    const etMidnight = new Date();
    etMidnight.setHours(0, 0, 0, 0); // start of today local (server is ET)
    const [existingSession] = await db
      .select({ id: conversationSessions.id })
      .from(conversationSessions)
      .where(
        and(
          eq(conversationSessions.leadPhone, rawPhone),
          eq(conversationSessions.leadSource, "schedule_confirm"),
          gte(conversationSessions.createdAt, etMidnight)
        )
      )
      .limit(1);
    if (existingSession) {
      console.log(`[ScheduleConfirm] Already sent today for ${group.cleanerName} (${rawPhone}) — skipping duplicate.`);
      result.details.push({
        teamName: group.teamName,
        cleanerName: group.cleanerName,
        phone: rawPhone,
        jobCount: group.jobs.length,
        sent: false,
        error: "Already sent today (dedup)",
      });
      continue;
    }

    // Sort jobs by serviceDateTime
    const sortedJobs = [...group.jobs].sort((a, b) => {
      if (!a.serviceDateTime) return 1;
      if (!b.serviceDateTime) return -1;
      return a.serviceDateTime.localeCompare(b.serviceDateTime);
    });

    const smsBody = buildScheduleSms(group.teamName, dateStr, sortedJobs);

    // Create session BEFORE sending SMS (per skill rules)
    let sessionId: number | undefined;
    try {
      const [ins] = await db.insert(conversationSessions).values({
        leadPhone: rawPhone,
        leadName: group.cleanerName,
        stage: "SCHEDULE_CONFIRM_SENT" as any,
        leadSource: "schedule_confirm",
        aiMode: 1,
        messageHistory: JSON.stringify([
          { role: "assistant", content: smsBody, ts: Date.now() },
        ]),
      });
      sessionId = (ins as any).insertId as number;
    } catch (err) {
      console.error(`[ScheduleConfirm] Failed to create session for ${group.cleanerName}:`, err);
      result.teamsFailed++;
      result.details.push({
        teamName: group.teamName,
        cleanerName: group.cleanerName,
        phone: rawPhone,
        jobCount: sortedJobs.length,
        sent: false,
        error: `Session creation failed: ${err instanceof Error ? err.message : String(err)}`,
      });
      continue;
    }

    // Send SMS
    const smsResult = await sendSms({
      to: rawPhone,
      content: smsBody,
      ...(csNumberId ? { fromNumberId: csNumberId } : {}),
    });

    if (smsResult.success) {
      result.teamsSent++;
      result.details.push({
        teamName: group.teamName,
        cleanerName: group.cleanerName,
        phone: rawPhone,
        jobCount: sortedJobs.length,
        sent: true,
        sessionId,
      });
      console.log(`[ScheduleConfirm] ✅ Sent to ${group.cleanerName} (${rawPhone}), ${sortedJobs.length} job(s)`);
    } else {
      result.teamsFailed++;
      result.details.push({
        teamName: group.teamName,
        cleanerName: group.cleanerName,
        phone: rawPhone,
        jobCount: sortedJobs.length,
        sent: false,
        error: smsResult.error ?? "SMS send failed",
        sessionId,
      });
      console.error(`[ScheduleConfirm] ❌ Failed to send to ${group.cleanerName}: ${smsResult.error}`);
    }
  }

  console.log(
    `[ScheduleConfirm] Done. Sent: ${result.teamsSent}, Failed: ${result.teamsFailed}, Missing phone: ${result.teamsMissingPhone}`
  );
  return result;
}

// ─── Reply handler ────────────────────────────────────────────────────────────

/**
 * Handle a cleaner's reply to a schedule confirmation SMS.
 * Called from the webhook when session.stage === "SCHEDULE_CONFIRM_SENT".
 */
export async function handleScheduleConfirmReply(
  sessionId: number,
  fromPhone: string,
  text: string,
  cleanerName: string | null,
  targetDate: string | null
): Promise<{ responseText: string; newStage: string; confirmed: boolean }> {
  const db = await getDb();
  if (!db) {
    return {
      responseText: "Sorry, we couldn't process your reply. Please try again.",
      newStage: "SCHEDULE_CONFIRM_SENT",
      confirmed: false,
    };
  }

  if (isConfirmationReply(text)) {
    // Mark all cleanerJobs for this cleaner on the target date as confirmed
    if (targetDate) {
      // Find the cleanerProfile by phone
      const { or } = await import("drizzle-orm");
      const profileRows = await db
        .select({ id: cleanerProfiles.id })
        .from(cleanerProfiles)
        .where(eq(cleanerProfiles.phone, fromPhone));

      if (profileRows.length > 0) {
        const profileId = profileRows[0].id;
        await db
          .update(cleanerJobs)
          .set({ scheduleConfirmed: 1 })
          .where(
            and(
              eq(cleanerJobs.cleanerProfileId, profileId),
              eq(cleanerJobs.jobDate, targetDate)
            )
          );
        console.log(
          `[ScheduleConfirm] ✅ Confirmed ${targetDate} jobs for cleaner profileId=${profileId} (${fromPhone})`
        );
      } else {
        console.warn(`[ScheduleConfirm] Could not find cleanerProfile for phone ${fromPhone}`);
      }
    }

    const firstName = cleanerName?.split(" ")[0] ?? "there";

    // Check if ALL cleaners have now confirmed — if so, post the ops summary immediately
    if (targetDate) {
      allCleanersConfirmedForDate(targetDate).then((allDone) => {
        if (allDone) {
          postOpsSummary(targetDate).catch((err) =>
            console.error("[ScheduleConfirm] Failed to post ops summary after all confirmed:", err)
          );
        }
      }).catch(() => { /* non-critical */ });
    }

    return {
      responseText: `Got it, ${firstName}! ✅ You're all confirmed for tomorrow. See you then! 🧹`,
      newStage: "SCHEDULE_CONFIRM_DONE",
      confirmed: true,
    };
  }

  // Non-confirmation reply — acknowledge and ask again
  return {
    responseText: `Hi! Just reply CONFIRM when you've reviewed your schedule for tomorrow. Thanks! 🧹`,
    newStage: "SCHEDULE_CONFIRM_SENT",
    confirmed: false,
  };
}

// ─── 7 PM Nudge ───────────────────────────────────────────────────────────────

/**
 * runScheduleConfirmNudge(targetDate?)
 *
 * Called by the 7 PM cron. Finds all SCHEDULE_CONFIRM_SENT sessions for
 * tomorrow (or targetDate) that have NOT yet advanced to SCHEDULE_CONFIRM_DONE,
 * and sends a single reminder SMS to each unconfirmed cleaner.
 *
 * Idempotent: uses a metadata flag `nudgeSent` on the session to prevent
 * double-nudging if the cron fires twice.
 */
export async function runScheduleConfirmNudge(targetDateOverride?: string): Promise<{
  nudgesSent: number;
  alreadyNudged: number;
  alreadyConfirmed: number;
  errors: number;
}> {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");

  // Determine target date (tomorrow in ET)
  let targetDate: string;
  if (targetDateOverride) {
    targetDate = targetDateOverride;
  } else {
    const now = new Date();
    const etNow = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
    etNow.setDate(etNow.getDate() + 1);
    targetDate = `${etNow.getFullYear()}-${String(etNow.getMonth() + 1).padStart(2, "0")}-${String(etNow.getDate()).padStart(2, "0")}`;
  }

  // Date window for session createdAt: today in ET (sessions created by 5 PM cron today)
  const etToday = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
  const startOfToday = new Date(etToday);
  startOfToday.setHours(0, 0, 0, 0);
  const endOfToday = new Date(etToday);
  endOfToday.setHours(23, 59, 59, 999);

  // Find all SCHEDULE_CONFIRM_SENT sessions created today (by the 5 PM cron)
  const pendingSessions = await db
    .select()
    .from(conversationSessions)
    .where(
      and(
        eq(conversationSessions.stage, "SCHEDULE_CONFIRM_SENT" as any),
        gte(conversationSessions.createdAt, startOfToday),
        lt(conversationSessions.createdAt, endOfToday)
      )
    );

  const result = { nudgesSent: 0, alreadyNudged: 0, alreadyConfirmed: 0, errors: 0 };
  const csNumberId = ENV.openPhoneCsNumberId;

  for (const session of pendingSessions) {
    try {
      // Parse internalNotes JSON to check nudgeSent flag
      let meta: Record<string, unknown> = {};
      try { meta = JSON.parse(session.internalNotes ?? "{}"); } catch { /* ignore */ }

      if (meta.nudgeSent) {
        result.alreadyNudged++;
        continue;
      }

      // Get cleaner's phone from the session's leadPhone
      const toPhone = session.leadPhone;
      if (!toPhone) {
        console.warn(`[ScheduleConfirmNudge] Session ${session.id} has no leadPhone, skipping`);
        result.errors++;
        continue;
      }

      // Look up cleaner name
      const cleanerName = session.leadName ?? null;
      const firstName = cleanerName?.split(" ")[0] ?? "there";

      const nudgeText = `Hey ${firstName}! Just a reminder to confirm your schedule for tomorrow. Reply CONFIRM when you're all set! 🧹`;

      // Send SMS FIRST (per skill rules — before DB update)
      const smsResult = await sendSms({
        to: toPhone,
        content: nudgeText,
        ...(csNumberId ? { fromNumberId: csNumberId } : {}),
      });

      if (!smsResult.success) {
        console.error(`[ScheduleConfirmNudge] Failed to send nudge to ${toPhone}:`, smsResult.error);
        result.errors++;
        continue;
      }

      // Mark nudgeSent in session internalNotes JSON
      meta.nudgeSent = true;
      meta.nudgeSentAt = new Date().toISOString();
      await db
        .update(conversationSessions)
        .set({ internalNotes: JSON.stringify(meta) })
        .where(eq(conversationSessions.id, session.id));

      console.log(`[ScheduleConfirmNudge] Nudge sent to ${toPhone} (session ${session.id})`);
      result.nudgesSent++;
    } catch (err) {
      console.error(`[ScheduleConfirmNudge] Error processing session ${session.id}:`, err);
      result.errors++;
    }
  }

  console.log(`[ScheduleConfirmNudge] Done for ${targetDate}: ${JSON.stringify(result)}`);
  return result;
}
