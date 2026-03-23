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
import { notifyOwner } from "./_core/notification";
import { sendClientOnTheWaySms, sendArrivedCheckin, sendCompletionFlow, sendRunningLateSms } from "./fieldMgmtEngine";

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
        maxAge: ONE_YEAR_MS, // 1 year — persist across browser restarts
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
        checklistItems: job.checklistItems
          ? (JSON.parse(job.checklistItems) as Array<{ text: string; checked: boolean }>)
          : null,
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
        checklistItems: job.checklistItems
          ? (JSON.parse(job.checklistItems) as Array<{ text: string; checked: boolean }>)
          : null,
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
        .set({ bookingStatus: "completed", jobStatus: "completed" })
        .where(eq(cleanerJobs.id, input.cleanerJobId));

      // ── Field Management: Completion Flow ───────────────────────────────────────
      // Fire-and-forget: don't block the response
      sendCompletionFlow(input.cleanerJobId).catch(err =>
        console.error("[FieldMgmt] sendCompletionFlow error:", err)
      );

      return { success: true };
    }),

  /**
   * cleaner.updateJobStatus — cleaner updates the status of their job.
   * Auto-transitions: arrived → in_progress
   * Notifications: running_late and issue_at_property alert the owner.
   * etaLabel: human-readable ETA string for running_late (e.g. "30 minutes")
   */
  updateJobStatus: cleanerProcedure
    .input(z.object({
      cleanerJobId: z.number(),
      status: z.enum(["on_the_way", "arrived", "running_late", "in_progress", "completed", "issue_at_property"]),
      issueNote: z.string().max(500).optional(),
      etaLabel: z.string().max(50).optional(), // e.g. "30 minutes", "1 hour", "Don't know"
      delayMinutes: z.number().int().positive().optional(), // minutes late for running_late
    }))
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

      const job = jobRows[0];
      if (!job) throw new TRPCError({ code: "FORBIDDEN", message: "Job not found or not yours" });

      // Auto-transition: arrived → also set in_progress
      const effectiveStatus = input.status === "arrived" ? "in_progress" : input.status;
      const updateData: Record<string, unknown> = { jobStatus: effectiveStatus };

      // Compute absolute ETA timestamp for on_the_way / running_late
      const ETA_MINUTES: Record<string, number | null> = {
        "30 minutes": 30,
        "1 hour": 60,
        "1 hr 30 min": 90,
        "2 hours": 120,
        "Don't know": null,
      };

      if ((input.status === "on_the_way" || input.status === "running_late") && input.etaLabel) {
        const mins = ETA_MINUTES[input.etaLabel] ?? null;
        if (mins !== null) {
          updateData.etaTimestamp = Date.now() + mins * 60 * 1000;
        } else {
          // "Don't know" — clear any previous ETA
          updateData.etaTimestamp = null;
        }
        // Keep issueNote as the human label for cleaner portal display
        updateData.issueNote = input.etaLabel;
      } else if (input.issueNote) {
        updateData.issueNote = input.issueNote;
      }

      if (effectiveStatus === "issue_at_property") updateData.flagged = 1;

      await db
        .update(cleanerJobs)
        .set(updateData)
        .where(eq(cleanerJobs.id, input.cleanerJobId));

      // ── Field Management hooks ─────────────────────────────────────────────────
      // Fire-and-forget: don't let SMS failures block the status update response
      if (input.status === "on_the_way") {
        sendClientOnTheWaySms(input.cleanerJobId).catch(err =>
          console.error("[FieldMgmt] sendClientOnTheWaySms error:", err)
        );
      }
      if (input.status === "arrived") {
        sendArrivedCheckin(input.cleanerJobId).catch(err =>
          console.error("[FieldMgmt] sendArrivedCheckin error:", err)
        );
      }
      if (input.status === "running_late") {
        // Save delayMinutes to DB first so sendRunningLateSms can read it
        if (input.delayMinutes) {
          db.update(cleanerJobs)
            .set({ delayMinutes: input.delayMinutes })
            .where(eq(cleanerJobs.id, input.cleanerJobId))
            .catch(() => {});
        }
        sendRunningLateSms(input.cleanerJobId).catch(err =>
          console.error("[FieldMgmt] sendRunningLateSms error:", err)
        );
      }

      // Send owner notifications for urgent statuses
      const cleanerName = ctx.cleaner.cleanerName;
      const jobLabel = [job.customerName, job.jobAddress].filter(Boolean).join(" — ");

      if (input.status === "running_late") {
        let etaPart = "";
        if (updateData.etaTimestamp) {
          const arrivalTime = new Date(updateData.etaTimestamp as number).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
          etaPart = ` — arrives ~${arrivalTime}`;
        } else if (input.etaLabel === "Don't know") {
          etaPart = " — ETA unknown";
        }
        await notifyOwner({
          title: `⏰ Running Late — ${cleanerName}`,
          content: `${cleanerName} is running late to: ${jobLabel}${etaPart}`,
        }).catch(() => {});
      }

      if (input.status === "issue_at_property") {
        await notifyOwner({
          title: `🚨 Issue at Property — ${cleanerName}`,
          content: `${cleanerName} reported an issue at: ${jobLabel}${input.issueNote ? `\n\nNote: ${input.issueNote}` : ""}`,
        }).catch(() => {});
      }

      return { success: true, status: effectiveStatus };
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
   * cleaner.toggleChecklistItem — toggle a checklist item's checked state for a job.
   * Saves to DB as a permanent audit trail.
   */
  toggleChecklistItem: cleanerProcedure
    .input(z.object({
      jobId: z.number(),
      itemIndex: z.number().int().nonnegative(),
      checked: z.boolean(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      // Verify the job belongs to this cleaner
      const [job] = await db
        .select({ id: cleanerJobs.id, cleanerProfileId: cleanerJobs.cleanerProfileId, checklistItems: cleanerJobs.checklistItems })
        .from(cleanerJobs)
        .where(and(eq(cleanerJobs.id, input.jobId), eq(cleanerJobs.cleanerProfileId, ctx.cleaner.cleanerId)))
        .limit(1);

      if (!job) throw new TRPCError({ code: "NOT_FOUND", message: "Job not found" });
      if (!job.checklistItems) throw new TRPCError({ code: "BAD_REQUEST", message: "No checklist for this job" });

      const items = JSON.parse(job.checklistItems) as Array<{ text: string; checked: boolean }>;
      if (input.itemIndex < 0 || input.itemIndex >= items.length) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid item index" });
      }

      items[input.itemIndex].checked = input.checked;

      await db
        .update(cleanerJobs)
        .set({ checklistItems: JSON.stringify(items) })
        .where(eq(cleanerJobs.id, job.id));

      return { success: true, items };
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
