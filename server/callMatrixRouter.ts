/**
 * callMatrixRouter.ts
 * Provides data for the AI Call Matrix page.
 *
 * Procedures:
 *   getPeople — returns today's customers and cleaners for the call matrix people list.
 */

import { z } from "zod";
import { eq, and, sql, desc, inArray } from "drizzle-orm";
import { router, agentProcedure } from "./_core/trpc";
import { getDb } from "./db";
import {
  cleanerJobs,
  cleanerProfiles,
  scheduleAssignments,
} from "../drizzle/schema";

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Format a serviceDateTime ISO string to "H:MM AM/PM" */
function formatTime(iso: string | null | undefined): string {
  if (!iso) return "TBD";
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "America/New_York" });
  } catch {
    return iso;
  }
}

/** Derive a human-readable ETA label from jobStatus + etaTimestamp + delayMinutes */
function etaLabel(
  jobStatus: string | null | undefined,
  etaTimestamp: number | null | undefined,
  delayMinutes: number | null | undefined,
): string {
  if (jobStatus === "completed") return "Completed";
  if (jobStatus === "in_progress" || jobStatus === "arrived") return "On site";
  if (jobStatus === "finishing_up" || jobStatus === "wrapping_up") return "Finishing up";
  if (etaTimestamp) {
    const now = Date.now();
    const diffMin = Math.round((etaTimestamp - now) / 60000);
    if (diffMin <= 0) return "Arriving now";
    return `~${diffMin} min`;
  }
  if (jobStatus === "running_late") return delayMinutes ? `${delayMinutes} min late` : "Running late";
  if (jobStatus === "on_the_way") return "On the way";
  return "Unknown";
}

/** Derive a risk label for a customer row */
function customerRisk(job: {
  jobStatus: string | null | undefined;
  etaTimestamp: number | null | undefined;
  delayMinutes: number | null | undefined;
  serviceDateTime: string | null | undefined;
  scheduleConfirmed: number;
}): string {
  if (job.jobStatus === "running_late" || job.delayMinutes) return "High impact";
  if (!job.scheduleConfirmed) return "Unconfirmed";
  if (job.etaTimestamp) {
    const diffMin = Math.round((job.etaTimestamp - Date.now()) / 60000);
    if (diffMin < 0) return "High impact";
  }
  return "On track";
}

/** Derive a risk label for a cleaner row */
function cleanerRisk(job: {
  jobStatus: string | null | undefined;
  etaTimestamp: number | null | undefined;
  delayMinutes: number | null | undefined;
  scheduleConfirmed: number;
  photoSubmitted: number;
}): string {
  if (job.jobStatus === "running_late" || job.delayMinutes) return "Urgent";
  if (!job.scheduleConfirmed) return "Schedule risk";
  if (!job.jobStatus || job.jobStatus === null) return "No check-in";
  if (job.jobStatus === "completed" && !job.photoSubmitted) return "QA risk";
  return "On track";
}

// ── Router ────────────────────────────────────────────────────────────────────

export const callMatrixRouter = router({
  /**
   * getPeople
   * Returns two lists — customers and cleaners — for today's (or a given date's) jobs.
   * Each customer row = one job. Each cleaner row = one team (deduplicated by teamName).
   */
  getPeople: agentProcedure
    .input(z.object({ date: z.string() })) // YYYY-MM-DD
    .query(async ({ input }) => {
      const db = await getDb();

      // ── 1. Load all non-cancelled jobs for the date ──────────────────────────
      const jobs = await db.select().from(cleanerJobs)
        .where(and(
          eq(cleanerJobs.jobDate, input.date),
          sql`${cleanerJobs.bookingStatus} != 'cancelled'`,
        ));

      if (jobs.length === 0) {
        return { customers: [], cleaners: [] };
      }

      // ── 2. Load schedule assignments for these jobs ──────────────────────────
      const jobIds = jobs.map(j => j.id);
      const assignments = jobIds.length > 0
        ? await db.select().from(scheduleAssignments)
            .where(inArray(scheduleAssignments.cleanerJobId, jobIds))
        : [];

      const assignmentByJobId = new Map(assignments.map(a => [a.cleanerJobId, a]));

      // ── 3. Build customer rows (one per job) ─────────────────────────────────
      const customers = jobs.map(j => {
        const assignment = assignmentByJobId.get(j.id);
        const assignedTeam = assignment?.teamName ?? j.teamName ?? "Unassigned";
        const eta = etaLabel(j.jobStatus, j.etaTimestamp ?? undefined, j.delayMinutes ?? undefined);
        const risk = customerRisk({
          jobStatus: j.jobStatus,
          etaTimestamp: j.etaTimestamp ?? undefined,
          delayMinutes: j.delayMinutes ?? undefined,
          serviceDateTime: j.serviceDateTime,
          scheduleConfirmed: j.scheduleConfirmed,
        });

        return {
          cleanerJobId: j.id,
          name: j.customerName ?? "Unknown Customer",
          phone: j.customerPhone ?? null,
          meta: [j.serviceType, j.jobAddress].filter(Boolean).join(" · "),
          jobTime: formatTime(j.serviceDateTime),
          eta,
          pay: "Card on file", // no card-on-file field in DB yet — placeholder
          access: j.staffNotes ? j.staffNotes.slice(0, 60) : (j.customerNotes ? j.customerNotes.slice(0, 60) : "No notes"),
          risk,
          assignedTeam,
          jobAddress: j.jobAddress ?? "",
          serviceType: j.serviceType ?? "",
          customerNotes: j.customerNotes ?? "",
          staffNotes: j.staffNotes ?? "",
          jobStatus: j.jobStatus ?? null,
          scheduleConfirmed: j.scheduleConfirmed,
        };
      });

      // ── 4. Build cleaner rows (one per unique team assigned today) ───────────
      // Collect unique team names from assignments + job.teamName
      const teamMap = new Map<string, {
        teamName: string;
        jobCount: number;
        jobIds: number[];
        hasNoCheckIn: boolean;
        hasGpsStale: boolean;
        hasUnconfirmed: boolean;
        hasPhotoMissing: boolean;
        phone: string | null;
      }>();

      for (const j of jobs) {
        const assignment = assignmentByJobId.get(j.id);
        const teamName = assignment?.teamName ?? j.teamName;
        if (!teamName) continue;

        const existing = teamMap.get(teamName);
        const noCheckIn = !j.jobStatus;
        const photoMissing = j.jobStatus === "completed" && !j.photoSubmitted;
        const unconfirmed = !j.scheduleConfirmed;

        if (existing) {
          existing.jobCount++;
          existing.jobIds.push(j.id);
          if (noCheckIn) existing.hasNoCheckIn = true;
          if (photoMissing) existing.hasPhotoMissing = true;
          if (unconfirmed) existing.hasUnconfirmed = true;
        } else {
          teamMap.set(teamName, {
            teamName,
            jobCount: 1,
            jobIds: [j.id],
            hasNoCheckIn: noCheckIn,
            hasGpsStale: false, // etaTimestamp staleness not tracked in DB yet
            hasUnconfirmed: unconfirmed,
            hasPhotoMissing: photoMissing,
            phone: null,
          });
        }
      }

      // Look up cleaner phone numbers by team name
      const teamNames = Array.from(teamMap.keys());
      if (teamNames.length > 0) {
        const profiles = await db.select({
          name: cleanerProfiles.name,
          phone: cleanerProfiles.phone,
        }).from(cleanerProfiles)
          .where(inArray(cleanerProfiles.name, teamNames));

        for (const p of profiles) {
          const entry = teamMap.get(p.name);
          if (entry && p.phone) entry.phone = p.phone;
        }
      }

      const cleaners = Array.from(teamMap.values()).map(t => {
        // Build meta string
        const flags: string[] = [];
        if (t.hasNoCheckIn) flags.push("no check-in");
        if (t.hasUnconfirmed) flags.push("unconfirmed");
        if (t.hasPhotoMissing) flags.push("photos missing");

        const meta = `Assigned: ${t.jobCount} job${t.jobCount !== 1 ? "s" : ""} today${flags.length ? " · " + flags.join(", ") : ""}`;

        let risk = "On track";
        if (t.hasNoCheckIn) risk = "No check-in";
        else if (t.hasUnconfirmed) risk = "Schedule risk";
        else if (t.hasPhotoMissing) risk = "QA risk";

        return {
          teamName: t.teamName,
          phone: t.phone,
          meta,
          jobCount: t.jobCount,
          risk,
          hasNoCheckIn: t.hasNoCheckIn,
          hasUnconfirmed: t.hasUnconfirmed,
          hasPhotoMissing: t.hasPhotoMissing,
        };
      });

      return { customers, cleaners };
    }),
});
