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
import { completedJobBatches, completedJobs } from "../drizzle/schema";
import { eq, and } from "drizzle-orm";
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

        // Determine reactivation eligibility:
        // One-time bookings are eligible immediately (no recurring schedule).
        // Recurring bookings become eligible 30 days after the job date.
        const isOneTime = !b.frequency || /one.?time|once/i.test(b.frequency);
        const jobDateObj = new Date(jobDate);
        const reactivationDate = new Date(jobDateObj);
        reactivationDate.setDate(reactivationDate.getDate() + 30);
        const isAlreadyEligible = isOneTime || reactivationDate <= new Date();

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
});
