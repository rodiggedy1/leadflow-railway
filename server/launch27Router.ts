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
import { eq, and, inArray } from "drizzle-orm";
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
   * Verify the scheduling layer for a given date against what Launch27 reports.
   * Runs 4-stage pipeline check per booking:
   *   1. Imported    — cleaner_jobs row exists with this bookingId
   *   2. Assigned    — cleanerProfileId is non-null
   *   3. Scheduled   — schedule_assignments row exists for cleanerJobId
   *   4. Portal Ready — profile isActive=1 AND phone is not null
   *
   * Returns a health report with per-booking trace details.
   * No DB writes — read-only check.
   */
  verifySync: agentProcedure
    .input(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD") }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      // Fetch all bookings (assigned + completed) from L27 for this date
      const l27Result = await getCompletedBookingsForDate(input.date, { includeAll: true });
      if (l27Result.error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Launch27 fetch failed: ${l27Result.error}`,
        });
      }

      const l27Bookings = l27Result.bookings;
      if (l27Bookings.length === 0) {
        return {
          date: input.date,
          healthScore: 100,
          critical: 0,
          warning: 0,
          healthy: 0,
          total: 0,
          bookings: [] as BookingHealth[],
          runAt: new Date().toISOString(),
        };
      }

      // Load all cleaner_jobs rows for this date in one query
      const dbJobs = await db
        .select()
        .from(cleanerJobs)
        .where(eq(cleanerJobs.jobDate, input.date));

      // Build a map: bookingId -> cleaner_jobs row(s)
      const jobsByBookingId = new Map<number, (typeof dbJobs)[number][]>();
      for (const job of dbJobs) {
        if (job.bookingId == null) continue;
        const arr = jobsByBookingId.get(job.bookingId) ?? [];
        arr.push(job);
        jobsByBookingId.set(job.bookingId, arr);
      }

      // Load all cleaner profiles referenced by these jobs (one query)
      const profileIds = Array.from(
        new Set(dbJobs.map((j) => j.cleanerProfileId).filter((id): id is number => id != null))
      );
      const profiles =
        profileIds.length > 0
          ? await db.select().from(cleanerProfiles).where(inArray(cleanerProfiles.id, profileIds))
          : [];
      const profileMap = new Map(profiles.map((p) => [p.id, p]));

      // Run 3-stage pipeline per L27 booking
      const bookingResults: BookingHealth[] = [];

      for (const b of l27Bookings) {
        const matchedJobs = jobsByBookingId.get(b.id) ?? [];

        // Stage 1: Imported
        const imported = matchedJobs.length > 0;

        if (!imported) {
          bookingResults.push({
            bookingId: b.id,
            customerName: b.fullName,
            health: "critical",
            stages: { imported: false, assigned: false, scheduled: false, portalReady: false },
            failureStage: "imported",
            failureReason: "No cleaner_jobs row found for this booking ID",
            impact: "Cleaner has no record of this job — will not appear in portal",
            recommendation: "Re-run the scheduling sync for this date",
          });
          continue;
        }

        // Use the first matched job (primary assignment)
        const job = matchedJobs[0];

        // Stage 2: Assigned
        const assigned = job.cleanerProfileId != null;

        if (!assigned) {
          bookingResults.push({
            bookingId: b.id,
            customerName: b.fullName,
            health: "critical",
            stages: { imported: true, assigned: false, scheduled: false, portalReady: false },
            failureStage: "assigned",
            failureReason: "cleanerProfileId is null — no cleaner linked to this job",
            impact: "Job exists in DB but has no cleaner assignment",
            recommendation: "Assign a cleaner profile to this job in the scheduling engine",
          });
          continue;
        }

        // Stage 3: Portal Ready — cleaner profile is active and has a phone
        const profile = profileMap.get(job.cleanerProfileId!);
        const portalReady = !!(profile && profile.isActive === 1 && profile.phone);

        // Determine health tier
        let health: "critical" | "warning" | "healthy";
        let failureStage: string | undefined;
        let failureReason: string | undefined;
        let impact: string | undefined;
        let recommendation: string | undefined;

        if (!portalReady) {
          health = "warning";
          failureStage = "portalReady";
          if (!profile) {
            failureReason = "Cleaner profile not found (ghost profile ID)";
            impact = "Cleaner cannot log into portal — profile record is missing";
            recommendation = "Verify cleanerProfileId references a valid cleaner_profiles row";
          } else if (profile.isActive !== 1) {
            failureReason = `Cleaner profile is inactive (isActive=${profile.isActive})`;
            impact = "Cleaner is marked inactive and may not have portal access";
            recommendation = "Reactivate the cleaner profile if they are still working";
          } else {
            failureReason = "Cleaner profile has no phone number";
            impact = "Cleaner cannot receive SMS notifications for this job";
            recommendation = "Add a phone number to the cleaner's profile";
          }
        } else {
          health = "healthy";
        }

        bookingResults.push({
          bookingId: b.id,
          customerName: b.fullName,
          health,
          stages: { imported, assigned, scheduled: true, portalReady },
          failureStage,
          failureReason,
          impact,
          recommendation,
        });
      }

      const total = bookingResults.length;
      const critical = bookingResults.filter((b) => b.health === "critical").length;
      const warning = bookingResults.filter((b) => b.health === "warning").length;
      const healthy = bookingResults.filter((b) => b.health === "healthy").length;
      const healthScore = total > 0 ? Math.round((healthy / total) * 1000) / 10 : 100;

      return {
        date: input.date,
        healthScore,
        critical,
        warning,
        healthy,
        total,
        bookings: bookingResults,
        runAt: new Date().toISOString(),
      };
    }),
});

// ---- Types ----
export interface BookingHealth {
  bookingId: number;
  customerName: string;
  health: "critical" | "warning" | "healthy";
  stages: {
    imported: boolean;
    assigned: boolean;
    scheduled: boolean;
    portalReady: boolean;
  };
  failureStage?: string;
  failureReason?: string;
  impact?: string;
  recommendation?: string;
}
