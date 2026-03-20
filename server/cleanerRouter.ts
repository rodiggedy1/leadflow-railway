/**
 * cleanerRouter.ts — Cleaner portal backend procedures.
 *
 * Cleaners log in with phone + password (bcrypt).
 * Once authenticated, they can view their own jobs, upload photos, and mark jobs complete.
 * Admins can set/reset cleaner passwords from the quality dashboard.
 */
import { TRPCError } from "@trpc/server";
import bcrypt from "bcryptjs";
import { and, desc, eq, gte, inArray, lte } from "drizzle-orm";
import { z } from "zod";
import { cleanerJobs, cleanerProfiles, jobPhotos } from "../drizzle/schema";
import { CLEANER_COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { signCleanerSession, verifyCleanerSession } from "./_core/cleanerAuth";
import { parse as parseCookie } from "cookie";
import { publicProcedure, cleanerProcedure, adminAgentProcedure, router } from "./_core/trpc";
import { getDb } from "./db";
import { storagePut } from "./storage";

// ── Helpers ──────────────────────────────────────────────────────────────────

// ── Router ────────────────────────────────────────────

export const cleanerRouter = router({
  /**
   * cleaner.login — authenticate with email + password, set cleaner session cookie.
   */
  login: publicProcedure
    .input(z.object({
      email: z.string().email(),
      password: z.string().min(1),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const rows = await db
        .select()
        .from(cleanerProfiles)
        .where(eq(cleanerProfiles.email, input.email.toLowerCase().trim()))
        .limit(1);

      const cleaner = rows[0];
      if (!cleaner || !cleaner.isActive || !cleaner.passwordHash) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "Invalid email or password" });
      }

      const valid = await bcrypt.compare(input.password, cleaner.passwordHash);
      if (!valid) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "Invalid email or password" });
      }

      const token = await signCleanerSession({
        cleanerId: cleaner.id,
        cleanerName: cleaner.name,
        cleanerPhone: cleaner.phone ?? "",
      });

      const cookieOpts = getSessionCookieOptions(ctx.req);
      ctx.res.cookie(CLEANER_COOKIE_NAME, token, {
        ...cookieOpts,
        maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
      });

      return {
        success: true,
        cleaner: { id: cleaner.id, name: cleaner.name, email: cleaner.email },
      };
    }),

  /**
   * cleaner.logout — clear the cleaner session cookie.
   */
  logout: publicProcedure.mutation(({ ctx }) => {
    const cookieOpts = getSessionCookieOptions(ctx.req);
    ctx.res.clearCookie(CLEANER_COOKIE_NAME, { ...cookieOpts, maxAge: -1 });
    return { success: true };
  }),

  /**
   * cleaner.me — return the current cleaner from the session cookie, or null.
   */
  me: publicProcedure.query(async ({ ctx }) => {
    const cookieHeader = ctx.req.headers.cookie;
    if (!cookieHeader) return null;
    const token = parseCookie(cookieHeader)[CLEANER_COOKIE_NAME] ?? null;
    const session = await verifyCleanerSession(token);
    if (!session) return null;

    const db = await getDb();
    if (!db) return null;
    const rows = await db
      .select()
      .from(cleanerProfiles)
      .where(eq(cleanerProfiles.id, session.cleanerId))
      .limit(1);
    const cleaner = rows[0];
    if (!cleaner || !cleaner.isActive) return null;
    return { id: cleaner.id, name: cleaner.name, phone: cleaner.phone };
  }),

  /**
   * cleaner.myJobs — get all jobs for the authenticated cleaner on a given date.
   * Returns jobs with pay breakdown, rating, and photo info.
   */
  myJobs: cleanerProcedure
    .input(z.object({ date: z.string() })) // YYYY-MM-DD
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const jobs = await db
        .select()
        .from(cleanerJobs)
        .where(
          and(
            eq(cleanerJobs.cleanerProfileId, ctx.cleaner.cleanerId),
            eq(cleanerJobs.jobDate, input.date)
          )
        )
        .orderBy(cleanerJobs.serviceDateTime);

      // Fetch photos for each job
      const jobIds = jobs.map(j => j.id);
      let photos: typeof jobPhotos.$inferSelect[] = [];
      if (jobIds.length > 0) {
        // Fetch photos for all jobs in one query
        const allPhotos = await db
          .select()
          .from(jobPhotos)
          .where(eq(jobPhotos.cleanerProfileId, ctx.cleaner.cleanerId));
        photos = allPhotos.filter(p => jobIds.includes(p.cleanerJobId));
      }

      return jobs.map(job => ({
        ...job,
        photos: photos.filter(p => p.cleanerJobId === job.id),
      }));
    }),

  /**
   * cleaner.myJobsRange — get jobs for the authenticated cleaner across a date range.
   * Used for weekly earnings summary.
   */
  myJobsRange: cleanerProcedure
    .input(z.object({ from: z.string(), to: z.string() })) // YYYY-MM-DD
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const jobs = await db
        .select()
        .from(cleanerJobs)
        .where(
          and(
            eq(cleanerJobs.cleanerProfileId, ctx.cleaner.cleanerId),
            gte(cleanerJobs.jobDate, input.from),
            lte(cleanerJobs.jobDate, input.to)
          )
        )
        .orderBy(cleanerJobs.jobDate, cleanerJobs.serviceDateTime);

      // Fetch photos for all jobs in one query
      let photos: typeof jobPhotos.$inferSelect[] = [];
      if (jobs.length > 0) {
        const jobIds = jobs.map(j => j.id);
        const allPhotos = await db.select().from(jobPhotos).where(inArray(jobPhotos.cleanerJobId, jobIds));
        photos = allPhotos;
      }

      return jobs.map(job => ({
        ...job,
        photos: photos.filter(p => p.cleanerJobId === job.id),
      }));
    }),

  /**
   * cleaner.uploadPhoto — upload a completion photo for a job.
   * Accepts base64-encoded image data, uploads to S3.
   */
  uploadPhoto: cleanerProcedure
    .input(z.object({
      cleanerJobId: z.number(),
      completedJobId: z.number(),
      filename: z.string().max(255),
      mimeType: z.string().max(50),
      dataBase64: z.string().max(10 * 1024 * 1024), // 10MB base64 limit
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      // Verify the job belongs to this cleaner
      const jobRows = await db
        .select()
        .from(cleanerJobs)
        .where(
          and(
            eq(cleanerJobs.id, input.cleanerJobId),
            eq(cleanerJobs.cleanerProfileId, ctx.cleaner.cleanerId)
          )
        )
        .limit(1);

      if (!jobRows[0]) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Job not found or not yours" });
      }

      // Upload to S3
      const ext = input.filename.split(".").pop() ?? "jpg";
      const randomSuffix = Math.random().toString(36).slice(2, 10);
      const fileKey = `cleaner-photos/${ctx.cleaner.cleanerId}/${input.cleanerJobId}-${randomSuffix}.${ext}`;
      const buffer = Buffer.from(input.dataBase64, "base64");
      const { url } = await storagePut(fileKey, buffer, input.mimeType);

      // Save photo record
      await db.insert(jobPhotos).values({
        cleanerJobId: input.cleanerJobId,
        completedJobId: input.completedJobId,
        cleanerProfileId: ctx.cleaner.cleanerId,
        photoUrl: url,
        photoKey: fileKey,
        filename: input.filename,
      });

      // Mark photoSubmitted on the job
      await db
        .update(cleanerJobs)
        .set({ photoSubmitted: 1 })
        .where(eq(cleanerJobs.id, input.cleanerJobId));

      // If the rating is already set, recalculate pay to apply the photo bonus
      const job = jobRows[0]!;
      if (job.customerRating !== null && job.basePay && job.payPercent) {
        const { calculatePayAdjustments } = await import("./qualityRouter");
        const adj = calculatePayAdjustments({
          jobRevenue: parseFloat(job.jobRevenue ?? "0"),
          payPercent: parseFloat(job.payPercent ?? "0"),
          customerRating: job.customerRating,
          missedSomething: job.missedSomething === 1,
          currentStreakAfterJob: 0, // streak already applied at rating time; don't re-apply
          photoSubmitted: true,
        });
        await db
          .update(cleanerJobs)
          .set({
            photoAdjustment: String(adj.photoAdjustment),
            finalPay: String(adj.finalPay),
          })
          .where(eq(cleanerJobs.id, input.cleanerJobId));
      }

      return { success: true, url };
    }),

  /**
   * cleaner.markComplete — mark a job as completed by the cleaner.
   * Sets bookingStatus to "completed" if it was "assigned".
   */
  markComplete: cleanerProcedure
    .input(z.object({ cleanerJobId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      // Verify ownership
      const jobRows = await db
        .select()
        .from(cleanerJobs)
        .where(
          and(
            eq(cleanerJobs.id, input.cleanerJobId),
            eq(cleanerJobs.cleanerProfileId, ctx.cleaner.cleanerId)
          )
        )
        .limit(1);

      if (!jobRows[0]) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Job not found or not yours" });
      }

      await db
        .update(cleanerJobs)
        .set({ bookingStatus: "completed" })
        .where(eq(cleanerJobs.id, input.cleanerJobId));

      return { success: true };
    }),

  // ── Admin procedures ────────────────────────────────────────────────────────

  /**
   * cleaner.setPassword — admin sets email + password for a cleaner's portal access.
   */
  setPassword: adminAgentProcedure
    .input(z.object({
      cleanerProfileId: z.number(),
      email: z.string().email("Must be a valid email"),
      password: z.string().min(6, "Password must be at least 6 characters"),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const hash = await bcrypt.hash(input.password, 10);
      await db
        .update(cleanerProfiles)
        .set({ email: input.email.toLowerCase().trim(), passwordHash: hash })
        .where(eq(cleanerProfiles.id, input.cleanerProfileId));

      return { success: true };
    }),

  /**
   * cleaner.listProfiles — admin gets all cleaner profiles (for management UI).
   */
  listProfiles: adminAgentProcedure.query(async () => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

    const profiles = await db
      .select({
        id: cleanerProfiles.id,
        name: cleanerProfiles.name,
        phone: cleanerProfiles.phone,
        email: cleanerProfiles.email,
        payPercent: cleanerProfiles.payPercent,
        isActive: cleanerProfiles.isActive,
        hasPassword: cleanerProfiles.passwordHash,
      })
      .from(cleanerProfiles)
      .orderBy(cleanerProfiles.name);

    return profiles.map(p => ({
      ...p,
      hasPassword: !!p.hasPassword, // don't expose the hash
    }));
  }),
});
