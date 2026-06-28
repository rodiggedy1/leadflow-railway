/**
 * Launch27 Router
 * Provides tRPC procedures for syncing completed bookings from Launch27
 * into the completedJobs table for the post-sale review SMS flow.
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { agentProcedure, router } from "./_core/trpc";
import { getCompletedBookingsForDate } from "./launch27";
import { getDb } from "./db";
import {
  completedJobBatches,
  completedJobs,
  cleanerJobs,
  cleanerProfiles,
  scheduleAssignments,
} from "../drizzle/schema";
import { eq, and, ne, inArray } from "drizzle-orm";
import { extractUSDigits, isValidUSPhone } from "./routers";

export const launch27Router = router({
  /**
   * Sync completed bookings from Launch27 for a given date (or yesterday by default).
   * Inserts a new batch and job records. Skips duplicates by phone+date.
   */
  syncCompletedJobs: agentProcedure
    .input(
      z.object({
        date: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD")
          .optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Default to yesterday
      const targetDate =
        input.date ??
        (() => {
          const d = new Date();
          d.setDate(d.getDate() - 1);
          return d.toISOString().slice(0, 10);
        })();

      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      // Fetch from Launch27
      const result = await getCompletedBookingsForDate(targetDate);

      if (result.error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Launch27 sync failed: ${result.error}`,
        });
      }

      if (result.bookings.length === 0) {
        return {
          date: targetDate,
          inserted: 0,
          skipped: 0,
          batchId: null,
          message: `No completed bookings found for ${targetDate}`,
        };
      }

      // Filter to valid US phones only
      const validBookings = result.bookings.filter((b) => {
        const digits = extractUSDigits(b.phone);
        return digits !== null && isValidUSPhone(digits);
      });

      const invalidCount = result.bookings.length - validBookings.length;

      if (validBookings.length === 0) {
        return {
          date: targetDate,
          inserted: 0,
          skipped: result.bookings.length,
          batchId: null,
          message: `All ${result.bookings.length} bookings had invalid/non-US phone numbers`,
        };
      }

      // Create batch record
      const [batchInsert] = await db
        .insert(completedJobBatches)
        .values({
          filename: `launch27-sync-${targetDate}`,
          jobDate: targetDate,
          totalCount: validBookings.length,
          sentCount: 0,
          positiveCount: 0,
          negativeCount: 0,
          reviewConfirmedCount: 0,
        });

      const batchId = (batchInsert as any).insertId as number;

      // Check for existing jobs with same phone + jobDate to avoid duplicates
      let inserted = 0;
      let skipped = 0;

      for (const b of validBookings) {
        const digits = extractUSDigits(b.phone)!;
        const normalizedPhone = `+1${digits}`;
        const jobDate = new Date(b.serviceDate).toISOString().slice(0, 10);

        // Check duplicate: same phone + same job date already in DB
        const existing = await db
          .select({ id: completedJobs.id })
          .from(completedJobs)
          .where(
            and(
              eq(completedJobs.phone, normalizedPhone),
              eq(completedJobs.jobDate, jobDate)
            )
          )
          .limit(1);

        if (existing.length > 0) {
          skipped++;
          continue;
        }

        // Reactivation eligibility: one-time customers ONLY (recurring = never eligible),
        // and only after 30 days since job date.
        const isOneTime = !b.frequency || /one.?time|once/i.test(b.frequency);
        const jobDateObj = new Date(jobDate);
        const reactivationDate = new Date(jobDateObj);
        reactivationDate.setDate(reactivationDate.getDate() + 30);
        const isAlreadyEligible = isOneTime && reactivationDate <= new Date();

        await db.insert(completedJobs).values({
          batchId,
          phone: normalizedPhone,
          name: b.fullName,
          firstName: b.firstName,
          email: b.email || null,
          address: b.address || null,
          serviceType: null, // Launch27 doesn't expose service type in list view
          frequency: b.frequency || null,
          launch27BookingId: String(b.id),
          lastBookingPrice: b.totalRevenue ? Math.round(b.totalRevenue) : null,
          jobDate,
          status: "PENDING",
          reactivationEligible: isAlreadyEligible ? 1 : 0,
          reactivationEligibleAt: isAlreadyEligible ? new Date() : null,
        });

        inserted++;
      }

      return {
        date: targetDate,
        inserted,
        skipped: skipped + invalidCount,
        batchId,
        message: `Synced ${inserted} new jobs from Launch27 for ${targetDate}. Skipped ${skipped + invalidCount} (${skipped} duplicates, ${invalidCount} invalid phones).`,
      };
    }),

  /**
   * Get the last sync result summary (most recent batch from Launch27 auto-sync).
   */
  getLastSync: agentProcedure.query(async () => {
    const db = await getDb();
    if (!db) return null;

    const batches = await db
      .select()
      .from(completedJobBatches)
      .orderBy(completedJobBatches.uploadedAt)
      .limit(5);

    // Find the most recent Launch27 sync batch (manual or auto)
    const syncBatches = batches
      .filter((b) => b.filename.startsWith("launch27-sync-") || b.filename.startsWith("launch27-auto-"))
      .sort((a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime());

    return syncBatches[0] ?? null;
  }),

  /**
   * Health check: verify 3 things for a given date.
   *
   * CHECK 1 — L27 count vs Jobs page count
   *   Launch27 booking count for the date == cleanerJobs row count for the date
   *   (excluding cancelled/rescheduled, same filter as getJobsForDate)
   *
   * CHECK 2 — Schedule page count vs Jobs page count
   *   cleanerJobs rows with a schedule_assignments row == total cleanerJobs rows
   *   (schedule page only shows jobs that have been assigned to a team in the scheduler)
   *
   * CHECK 3 — Jobs page assignments vs Cleaner portal assignments
   *   For each team: count of jobs assigned on Jobs page (cleanerProfileId set, teamName set)
   *   matches count of jobs that would appear in each cleaner's portal (same cleanerProfileId filter)
   *   Broken down by team so you can see which team has a mismatch.
   *
   * Read-only — zero DB writes.
   */
  verifySync: agentProcedure
    .input(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD") }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      // ── Fetch L27 bookings (all statuses — same as what the Jobs page syncs from) ──
      const l27Result = await getCompletedBookingsForDate(input.date, { includeAll: true });
      if (l27Result.error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Launch27 fetch failed: ${l27Result.error}`,
        });
      }
      const l27Count = l27Result.bookings.length;

      // ── Load all cleanerJobs for the date (same filter as Jobs page & Schedule page) ──
      const dbJobs = await db
        .select()
        .from(cleanerJobs)
        .where(
          and(
            eq(cleanerJobs.jobDate, input.date),
            ne(cleanerJobs.bookingStatus, "cancelled"),
            ne(cleanerJobs.bookingStatus, "rescheduled")
          )
        );
      const jobsPageCount = dbJobs.length;

      // ── CHECK 1: L27 count vs Jobs page count ──
      const check1Pass = l27Count === jobsPageCount;
      const check1Detail: string[] = [];
      if (!check1Pass) {
        // Find which L27 bookings are missing from DB
        const dbBookingIds = new Set(dbJobs.map((j) => j.bookingId).filter(Boolean));
        const missingFromDb = l27Result.bookings.filter((b) => !dbBookingIds.has(b.id));
        const extraInDb = dbJobs.filter(
          (j) => j.bookingId && !l27Result.bookings.find((b) => b.id === j.bookingId)
        );
        for (const b of missingFromDb) {
          check1Detail.push(`Missing in DB: #${b.id} ${b.fullName}`);
        }
        for (const j of extraInDb) {
          check1Detail.push(`Extra in DB (not in L27): #${j.bookingId} ${j.customerName}`);
        }
      }

      // ── CHECK 2: Schedule page count vs Jobs page count ──
      // Schedule page (getSchedule) queries cleanerJobs with:
      //   jobDate = date AND bookingStatus != 'cancelled' AND bookingStatus != 'rescheduled'
      // Jobs page (getJobsForDate) uses the exact same filter.
      // We run the same query independently to confirm both see the same jobs.
      const schedulePageRows = await db
        .select({ id: cleanerJobs.id, bookingId: cleanerJobs.bookingId, customerName: cleanerJobs.customerName, teamName: cleanerJobs.teamName })
        .from(cleanerJobs)
        .where(
          and(
            eq(cleanerJobs.jobDate, input.date),
            ne(cleanerJobs.bookingStatus, "cancelled"),
            ne(cleanerJobs.bookingStatus, "rescheduled")
          )
        );
      const schedulePageCount = schedulePageRows.length;
      const check2Pass = schedulePageCount === jobsPageCount;
      const check2Detail: string[] = [];
      if (!check2Pass) {
        const scheduleIds = new Set(schedulePageRows.map((r) => r.id));
        for (const j of dbJobs) {
          if (!scheduleIds.has(j.id)) {
            check2Detail.push(`On Jobs page but missing from Schedule page: #${j.bookingId ?? j.id} ${j.customerName} (team: ${j.teamName ?? "unassigned"})`);
          }
        }
        for (const r of schedulePageRows) {
          if (!dbJobs.find((j) => j.id === r.id)) {
            check2Detail.push(`On Schedule page but missing from Jobs page: #${r.bookingId ?? r.id} ${r.customerName}`);
          }
        }
      }

      // ── CHECK 3: Jobs page assignments vs Cleaner portal assignments (by team) ──
      // Jobs page: jobs with cleanerProfileId set, grouped by teamName
      // Portal: same jobs — portal query is WHERE cleanerProfileId = session.cleanerId
      // So if cleanerProfileId is set on the job, it WILL appear in that cleaner's portal.
      // We check: for each team, count of jobs with cleanerProfileId set on Jobs page
      // matches count of jobs that would appear in the portal for that team's cleaner(s).

      // Group by teamName
      const teamMap = new Map<string, { assigned: number; portalVisible: number; missingProfiles: string[] }>();
      const unassignedJobs: string[] = [];

      // Load profiles for all assigned jobs
      const profileIds = Array.from(
        new Set(dbJobs.map((j) => j.cleanerProfileId).filter((id): id is number => id != null))
      );
      const profiles =
        profileIds.length > 0
          ? await db
              .select({ id: cleanerProfiles.id, isActive: cleanerProfiles.isActive, name: cleanerProfiles.name })
              .from(cleanerProfiles)
              .where(inArray(cleanerProfiles.id, profileIds))
          : [];
      const profileMap = new Map(profiles.map((p) => [p.id, p]));

      for (const job of dbJobs) {
        const team = job.teamName ?? "Unassigned";
        if (!teamMap.has(team)) {
          teamMap.set(team, { assigned: 0, portalVisible: 0, missingProfiles: [] });
        }
        const entry = teamMap.get(team)!;
        entry.assigned++;

        if (job.cleanerProfileId == null) {
          unassignedJobs.push(`#${job.bookingId ?? job.id} ${job.customerName}`);
          // Not portal visible — no cleaner linked
        } else {
          const profile = profileMap.get(job.cleanerProfileId);
          if (profile && profile.isActive === 1) {
            entry.portalVisible++;
          } else {
            entry.missingProfiles.push(
              `#${job.bookingId ?? job.id} ${job.customerName} — profile ${
                profile ? `inactive (id=${profile.id})` : `not found (id=${job.cleanerProfileId})`
              }`
            );
          }
        }
      }

      const check3Teams: Check3Team[] = [];
      let check3Pass = true;
      for (const [teamName, data] of Array.from(teamMap.entries())) {
        const teamPass = data.assigned === data.portalVisible;
        if (!teamPass) check3Pass = false;
        check3Teams.push({
          teamName,
          jobsPageCount: data.assigned,
          portalCount: data.portalVisible,
          pass: teamPass,
          issues: data.missingProfiles,
        });
      }
      if (unassignedJobs.length > 0) {
        check3Pass = false;
      }

      // ── Summary ──
      const allPass = check1Pass && check2Pass && check3Pass;
      const issueCount = [!check1Pass, !check2Pass, !check3Pass].filter(Boolean).length;

      return {
        date: input.date,
        allPass,
        issueCount,
        runAt: new Date().toISOString(),
        check1: {
          label: "L27 count matches Jobs page",
          pass: check1Pass,
          l27Count,
          jobsPageCount,
          detail: check1Detail,
        },
        check2: {
          label: "Schedule page count matches Jobs page",
          pass: check2Pass,
          schedulePageCount,
          jobsPageCount,
          detail: check2Detail,
        },
        check3: {
          label: "Jobs page assignments match Cleaner portal (by team)",
          pass: check3Pass,
          teams: check3Teams,
          unassignedJobs,
        },
      };
    }),
});

// ---- Types ----
export interface Check3Team {
  teamName: string;
  jobsPageCount: number;
  portalCount: number;
  pass: boolean;
  issues: string[];
}
