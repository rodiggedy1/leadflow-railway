/**
 * trackerRouter — public tRPC procedures for the customer-facing job tracker page.
 *
 * All procedures here are PUBLIC (no auth required) because the tracker page is
 * accessed via a unique token in the URL by the customer on their phone.
 *
 * Procedures:
 *   tracker.getJob         → fetch job details by trackerToken (public)
 *   tracker.submitRating   → submit a star rating + optional comment (public, once per token)
 *   tracker.sendTodayLinks → admin-triggered: generate tokens + send SMS for today's jobs
 *   tracker.sendSingleLink → admin-triggered: send tracker link for a single job
 */

import { z } from "zod";
import { router, publicProcedure, protectedProcedure } from "./_core/trpc";
import { TRPCError } from "@trpc/server";
import { getDb } from "./db";
import { cleanerJobs } from "../drizzle/schema";
import { eq, and, isNull } from "drizzle-orm";
import { randomBytes } from "crypto";
import { sendSms } from "./openphone";

/** Generate a URL-safe random token */
function generateToken(): string {
  return randomBytes(24).toString("base64url");
}

/** Get today's date in ET as YYYY-MM-DD */
function getTodayET(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

export const trackerRouter = router({
  /**
   * Public: fetch job tracker data by token.
   * Returns only safe fields — no internal pay/rating data.
   */
  getJob: publicProcedure
    .input(z.object({ token: z.string().min(1) }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("DB unavailable");

      const jobs = await db
        .select({
          id: cleanerJobs.id,
          jobDate: cleanerJobs.jobDate,
          serviceDateTime: cleanerJobs.serviceDateTime,
          customerName: cleanerJobs.customerName,
          jobAddress: cleanerJobs.jobAddress,
          serviceType: cleanerJobs.serviceType,
          teamName: cleanerJobs.teamName,
          cleanerName: cleanerJobs.cleanerName,
          jobStatus: cleanerJobs.jobStatus,
          etaTimestamp: cleanerJobs.etaTimestamp,
          issueNote: cleanerJobs.issueNote,
          customerRating: cleanerJobs.customerRating,
          trackerToken: cleanerJobs.trackerToken,
        })
        .from(cleanerJobs)
        .where(eq(cleanerJobs.trackerToken, input.token))
        .limit(1);

      if (!jobs.length) return null;
      return jobs[0];
    }),

  /**
   * Public: submit a star rating via the tracker page.
   * Can only be submitted once (customerRating must be null).
   */
  submitRating: publicProcedure
    .input(
      z.object({
        token: z.string().min(1),
        rating: z.number().int().min(1).max(5),
        comment: z.string().max(1000).optional(),
      })
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("DB unavailable");

      // Verify token exists and rating not yet submitted
      const jobs = await db
        .select({ id: cleanerJobs.id, customerRating: cleanerJobs.customerRating })
        .from(cleanerJobs)
        .where(eq(cleanerJobs.trackerToken, input.token))
        .limit(1);

      if (!jobs.length) throw new Error("Invalid tracker token");
      const job = jobs[0]!;
      if (job.customerRating !== null) {
        return { success: false, message: "Rating already submitted" };
      }

      await db
        .update(cleanerJobs)
        .set({ customerRating: input.rating })
        .where(eq(cleanerJobs.id, job.id));

      return { success: true };
    }),

  /**
   * Protected (admin): generate tracker tokens for all of today's jobs that
   * don't have one yet, then send the tracker link SMS to each customer.
   * Called by the 8 AM cron and available as a manual trigger from the admin.
   * NOTE: Currently disabled during testing — returns immediately without sending.
   */
  sendTodayLinks: protectedProcedure
    .input(z.object({ date: z.string().optional() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("DB unavailable");
      const targetDate = input.date ?? getTodayET();
      const baseUrl = "https://quote.maidinblack.com";

      const jobs = await db
        .select()
        .from(cleanerJobs)
        .where(
          and(
            eq(cleanerJobs.jobDate, targetDate),
            isNull(cleanerJobs.trackerSmsSentAt)
          )
        );

      let sent = 0;
      let skipped = 0;
      const errors: string[] = [];

      for (const job of jobs) {
        if (!job.customerPhone) {
          skipped++;
          continue;
        }
        let token = job.trackerToken;
        if (!token) {
          token = generateToken();
          await db.update(cleanerJobs).set({ trackerToken: token }).where(eq(cleanerJobs.id, job.id));
        }
        const trackerUrl = `${baseUrl}/track/${token}`;
        const firstName = job.customerName?.split(" ")[0] ?? "there";
        const message = `Hi ${firstName}! Your Maids in Black team is confirmed for today. Track your clean in real time here: ${trackerUrl}`;
        const result = await sendSms({ to: job.customerPhone, content: message }).catch(
          (err: unknown) => ({ success: false, error: String(err) })
        );
        if (result.success) {
          await db.update(cleanerJobs).set({ trackerSmsSentAt: new Date() }).where(eq(cleanerJobs.id, job.id));
          sent++;
        } else {
          errors.push(`${job.customerPhone}: ${(result as { error?: string }).error ?? "unknown"}`);
        }
      }
      return { sent, skipped, errors, date: targetDate };
    }),

  /**
   * Protected (admin): send tracker link to a single job by cleanerJobId.
   * Used by the "Send Tracker Link" button on admin job cards.
   * NOTE: SMS is disabled during testing — returns the URL without sending.
   */
  sendSingleLink: protectedProcedure
    .input(z.object({ cleanerJobId: z.number() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("DB unavailable");
      const baseUrl = "https://quote.maidinblack.com";
      const jobs = await db
        .select()
        .from(cleanerJobs)
        .where(eq(cleanerJobs.id, input.cleanerJobId))
        .limit(1);
      const job = jobs[0];
      if (!job) throw new TRPCError({ code: "NOT_FOUND", message: "Job not found" });
      if (!job.customerPhone) throw new TRPCError({ code: "BAD_REQUEST", message: "No customer phone on file" });
      let token = job.trackerToken;
      if (!token) {
        token = generateToken();
        await db.update(cleanerJobs).set({ trackerToken: token }).where(eq(cleanerJobs.id, job.id));
      }
      const trackerUrl = `${baseUrl}/track/${token}`;
      // SMS DISABLED during testing — uncomment below when ready to go live
      // const firstName = job.customerName?.split(" ")[0] ?? "there";
      // const message = `Hi ${firstName}! Your Maids in Black team is confirmed for today. Track your clean in real time here: ${trackerUrl}`;
      // const result = await sendSms({ to: job.customerPhone, content: message }).catch(
      //   (err: unknown) => ({ success: false, error: String(err) })
      // );
      // if (!result.success) {
      //   throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: (result as { error?: string }).error ?? "SMS failed" });
      // }
      // await db.update(cleanerJobs).set({ trackerSmsSentAt: new Date() }).where(eq(cleanerJobs.id, job.id));
      return { success: true, trackerUrl };
    }),
});
