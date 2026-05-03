/**
 * opsSummaryEngine.ts
 *
 * Posts a daily ops summary card to the "command" channel in Command Chat.
 *
 * Triggers:
 *   1. Immediately when ALL cleaners for tomorrow have confirmed (called from
 *      handleScheduleConfirmReply after each confirmation).
 *   2. At 7 AM ET as a fallback (called by the 7 AM cron regardless of
 *      confirmation status).
 *
 * The card shows:
 *   - Total jobs tomorrow
 *   - Confirmed cleaners ✅ vs unconfirmed ⏳ vs no phone on file
 *   - Any jobs with no cleaner assigned (gaps)
 *   - List of unconfirmed cleaner names
 *
 * Idempotent: a summary is only posted once per date. Uses a DB flag in
 * opsChatMessages (quickAction = "ops_summary", body contains the date) to
 * prevent duplicate posts.
 */

import { and, eq, gte, lt, or } from "drizzle-orm";
import { getDb } from "./db";
import {
  cleanerJobs,
  cleanerProfiles,
  conversationSessions,
  opsChatMessages,
} from "../drizzle/schema";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface OpsSummaryResult {
  posted: boolean;
  alreadyPosted?: boolean;
  date: string;
  totalJobs: number;
  confirmed: number;
  unconfirmed: number;
  missingPhone: number;
  gaps: number; // jobs with no cleaner assigned
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getTomorrowEt(): string {
  const etNow = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
  etNow.setDate(etNow.getDate() + 1);
  return `${etNow.getFullYear()}-${String(etNow.getMonth() + 1).padStart(2, "0")}-${String(etNow.getDate()).padStart(2, "0")}`;
}

export function formatDateLabel(dateStr: string): string {
  try {
    const [y, m, d] = dateStr.split("-").map(Number);
    const dt = new Date(y, m - 1, d);
    return dt.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
  } catch {
    return dateStr;
  }
}

export function formatTime(iso: string | null): string {
  if (!iso) return "TBD";
  try {
    const dt = new Date(iso);
    if (isNaN(dt.getTime())) return "TBD";
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

// ─── Check if all cleaners have confirmed ─────────────────────────────────────

/**
 * Returns true if every cleaner with a phone number on file has confirmed
 * their schedule for the given date.
 */
export async function allCleanersConfirmedForDate(targetDate: string): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;

  // Get all cleanerJobs for the date that have a cleanerProfileId
  const jobs = await db
    .select({
      cleanerProfileId: cleanerJobs.cleanerProfileId,
      scheduleConfirmed: cleanerJobs.scheduleConfirmed,
    })
    .from(cleanerJobs)
    .where(eq(cleanerJobs.jobDate, targetDate));

  if (jobs.length === 0) return false;

  // Filter to jobs that have a cleaner assigned
  const assignedJobs = jobs.filter((j) => j.cleanerProfileId !== null);
  if (assignedJobs.length === 0) return false;

  // Get unique profile IDs
  const profileIds = Array.from(new Set(assignedJobs.map((j) => j.cleanerProfileId!)));

  // Check if all have phones
  const profiles = await db
    .select({ id: cleanerProfiles.id, phone: cleanerProfiles.phone })
    .from(cleanerProfiles)
    .where(
      profileIds.length === 1
        ? eq(cleanerProfiles.id, profileIds[0])
        : or(...profileIds.map((id: number) => eq(cleanerProfiles.id, id)))
    );

  const phoneMap = new Map(profiles.map((p) => [p.id, p.phone]));

  // Only consider cleaners that have a phone (those without phone can't confirm via SMS)
  const cleanersWithPhone = profileIds.filter((id) => phoneMap.get(id));
  if (cleanersWithPhone.length === 0) return false;

  // Check if all jobs for cleaners-with-phone are confirmed
  const jobsForCleanersWithPhone = assignedJobs.filter(
    (j) => j.cleanerProfileId && phoneMap.get(j.cleanerProfileId)
  );

  return jobsForCleanersWithPhone.every((j) => j.scheduleConfirmed === 1);
}

// ─── Check if summary already posted ─────────────────────────────────────────

async function isSummaryAlreadyPosted(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  targetDate: string
): Promise<boolean> {
  const rows = await db
    .select({ id: opsChatMessages.id })
    .from(opsChatMessages)
    .where(
      and(
        eq(opsChatMessages.channel, "command"),
        eq(opsChatMessages.quickAction, "ops_summary" as any)
      )
    )
    .limit(10);

  // Check if any row's metadata contains the target date
  if (rows.length === 0) return false;

  // Re-query with metadata to check date
  const rowsWithMeta = await db
    .select({ id: opsChatMessages.id, metadata: opsChatMessages.metadata })
    .from(opsChatMessages)
    .where(
      and(
        eq(opsChatMessages.channel, "command"),
        eq(opsChatMessages.quickAction, "ops_summary" as any)
      )
    )
    .limit(10);

  return rowsWithMeta.some((r) => {
    try {
      const meta = JSON.parse(r.metadata ?? "{}");
      return meta.summaryDate === targetDate;
    } catch {
      return false;
    }
  });
}

// ─── Build summary data ───────────────────────────────────────────────────────

export interface SummaryData {
  totalJobs: number;
  confirmedCleaners: string[];
  unconfirmedCleaners: string[];
  missingPhoneCleaners: string[];
  gaps: Array<{ customerName: string | null; serviceDateTime: string | null; jobAddress: string | null }>;
}

async function buildSummaryData(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  targetDate: string
): Promise<SummaryData> {
  const jobs = await db
    .select({
      id: cleanerJobs.id,
      cleanerProfileId: cleanerJobs.cleanerProfileId,
      cleanerName: cleanerJobs.cleanerName,
      scheduleConfirmed: cleanerJobs.scheduleConfirmed,
      customerName: cleanerJobs.customerName,
      serviceDateTime: cleanerJobs.serviceDateTime,
      jobAddress: cleanerJobs.jobAddress,
      bookingStatus: cleanerJobs.bookingStatus,
    })
    .from(cleanerJobs)
    .where(eq(cleanerJobs.jobDate, targetDate));

  // Filter out cancelled jobs
  const activeJobs = jobs.filter(
    (j) => j.bookingStatus !== "cancelled" && j.bookingStatus !== "rescheduled"
  );

  const totalJobs = activeJobs.length;

  // Jobs with no cleaner assigned
  const gaps = activeJobs
    .filter((j) => !j.cleanerProfileId)
    .map((j) => ({
      customerName: j.customerName,
      serviceDateTime: j.serviceDateTime,
      jobAddress: j.jobAddress,
    }));

  // Jobs with cleaner assigned — group by profileId
  const assignedJobs = activeJobs.filter((j) => j.cleanerProfileId !== null);
  const profileIds = Array.from(new Set(assignedJobs.map((j) => j.cleanerProfileId!)));

  let phoneMap = new Map<number, string | null>();
  if (profileIds.length > 0) {
    const profiles = await db
      .select({ id: cleanerProfiles.id, phone: cleanerProfiles.phone })
      .from(cleanerProfiles)
      .where(
        profileIds.length === 1
          ? eq(cleanerProfiles.id, profileIds[0])
          : or(...profileIds.map((id: number) => eq(cleanerProfiles.id, id)))
      );
    phoneMap = new Map(profiles.map((p) => [p.id, p.phone ?? null]));
  }

  // Per-cleaner confirmation status (one entry per unique cleaner)
  const seenProfiles = new Set<number>();
  const confirmedCleaners: string[] = [];
  const unconfirmedCleaners: string[] = [];
  const missingPhoneCleaners: string[] = [];

  for (const job of assignedJobs) {
    if (!job.cleanerProfileId || seenProfiles.has(job.cleanerProfileId)) continue;
    seenProfiles.add(job.cleanerProfileId);

    const phone = phoneMap.get(job.cleanerProfileId);
    const name = job.cleanerName ?? `Cleaner #${job.cleanerProfileId}`;

    if (!phone) {
      missingPhoneCleaners.push(name);
    } else if (job.scheduleConfirmed === 1) {
      confirmedCleaners.push(name);
    } else {
      unconfirmedCleaners.push(name);
    }
  }

  return { totalJobs, confirmedCleaners, unconfirmedCleaners, missingPhoneCleaners, gaps };
}

// ─── Build card body ──────────────────────────────────────────────────────────

export function buildSummaryCardBody(dateStr: string, data: SummaryData): string {
  const dateLabel = formatDateLabel(dateStr);
  const allConfirmed =
    data.unconfirmedCleaners.length === 0 && data.missingPhoneCleaners.length === 0;

  const lines: string[] = [];
  lines.push(`📋 Ops Summary — ${dateLabel}`);
  lines.push(`Total jobs: ${data.totalJobs}`);

  if (data.confirmedCleaners.length > 0) {
    lines.push(`✅ Confirmed (${data.confirmedCleaners.length}): ${data.confirmedCleaners.join(", ")}`);
  }

  if (data.unconfirmedCleaners.length > 0) {
    lines.push(`⏳ Unconfirmed (${data.unconfirmedCleaners.length}): ${data.unconfirmedCleaners.join(", ")}`);
  }

  if (data.missingPhoneCleaners.length > 0) {
    lines.push(`📵 No phone on file (${data.missingPhoneCleaners.length}): ${data.missingPhoneCleaners.join(", ")}`);
  }

  if (data.gaps.length > 0) {
    lines.push(`⚠️ Unassigned jobs (${data.gaps.length}):`);
    for (const gap of data.gaps) {
      const time = formatTime(gap.serviceDateTime);
      const client = gap.customerName ?? "Unknown client";
      const addr = gap.jobAddress ?? "No address";
      lines.push(`  • ${time} — ${client}, ${addr}`);
    }
  }

  if (allConfirmed && data.gaps.length === 0) {
    lines.push(`🎉 All cleaners confirmed and all jobs assigned — you're good to go!`);
  }

  return lines.join("\n");
}

// ─── Main post function ───────────────────────────────────────────────────────

/**
 * Posts the ops summary card to the "command" channel.
 * Safe to call multiple times — will not post twice for the same date.
 *
 * @param targetDateOverride  YYYY-MM-DD — defaults to tomorrow in ET
 * @param force               Skip the already-posted check (for testing)
 */
export async function postOpsSummary(
  targetDateOverride?: string,
  force = false
): Promise<OpsSummaryResult> {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");

  const targetDate = targetDateOverride ?? getTomorrowEt();

  // Idempotency check
  if (!force && (await isSummaryAlreadyPosted(db, targetDate))) {
    const data = await buildSummaryData(db, targetDate);
    return {
      posted: false,
      alreadyPosted: true,
      date: targetDate,
      totalJobs: data.totalJobs,
      confirmed: data.confirmedCleaners.length,
      unconfirmed: data.unconfirmedCleaners.length,
      missingPhone: data.missingPhoneCleaners.length,
      gaps: data.gaps.length,
    };
  }

  const data = await buildSummaryData(db, targetDate);
  const body = buildSummaryCardBody(targetDate, data);

  await db.insert(opsChatMessages).values({
    channel: "command",
    authorName: "Ops Bot",
    authorRole: "system",
    body,
    quickAction: "ops_summary" as any,
    metadata: JSON.stringify({
      summaryDate: targetDate,
      totalJobs: data.totalJobs,
      confirmed: data.confirmedCleaners.length,
      unconfirmed: data.unconfirmedCleaners.length,
      missingPhone: data.missingPhoneCleaners.length,
      gaps: data.gaps.length,
      confirmedNames: data.confirmedCleaners,
      unconfirmedNames: data.unconfirmedCleaners,
    }),
  });

  const { broadcastOpsUpdate } = await import("./sseBroadcast");
  broadcastOpsUpdate("new_message", { channel: "command" });

  console.log(`[OpsSummary] ✅ Posted ops summary for ${targetDate}: ${data.totalJobs} jobs, ${data.confirmedCleaners.length} confirmed, ${data.unconfirmedCleaners.length} unconfirmed`);

  return {
    posted: true,
    date: targetDate,
    totalJobs: data.totalJobs,
    confirmed: data.confirmedCleaners.length,
    unconfirmed: data.unconfirmedCleaners.length,
    missingPhone: data.missingPhoneCleaners.length,
    gaps: data.gaps.length,
  };
}
