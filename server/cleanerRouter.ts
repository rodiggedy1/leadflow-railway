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
import { cleanerJobs, cleanerProfiles, jobPhotos, jobStatusHistory, customPayRules, cleanerJobCustomRules, cleanerStreaks, cleanerMagicLinkTokens, opsChatMessages } from "../drizzle/schema";
import { randomBytes } from "crypto";
import { sendSms } from "./openphone";
import { CLEANER_COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { signCleanerSession, verifyCleanerSession } from "./_core/cleanerAuth";
import { parse as parseCookie } from "cookie";
import { publicProcedure, cleanerProcedure, agentProcedure, opsChatProcedure, router } from "./_core/trpc";
import { getDb } from "./db";
import { storagePut, generateThumbnail } from "./storage";
import { notifyOwner } from "./_core/notification";
import { sendClientOnTheWaySms, sendArrivedCheckin, sendCompletionFlow, sendRunningLateSms } from "./fieldMgmtEngine";
import { sendCompletionReviewSms } from "./trackerReviewSms";
import { getPayRules } from "./settingsRouter";

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

      // Fetch photos and applied custom pay rules for each job
      const jobIds = jobs.map(j => j.id);
      let photos: typeof jobPhotos.$inferSelect[] = [];
      let appliedCustomRules: typeof cleanerJobCustomRules.$inferSelect[] = [];
      if (jobIds.length > 0) {
        // Fetch photos for all jobs in one query
        const allPhotos = await db
          .select()
          .from(jobPhotos)
          .where(eq(jobPhotos.cleanerProfileId, ctx.cleaner.cleanerId));
        photos = allPhotos.filter(p => jobIds.includes(p.cleanerJobId));
        // Fetch applied custom pay rules for all jobs in one query
        appliedCustomRules = await db
          .select()
          .from(cleanerJobCustomRules)
          .where(inArray(cleanerJobCustomRules.cleanerJobId, jobIds));
      }

      return jobs.map(job => ({
        ...job,
        checklistItems: job.checklistItems
          ? (JSON.parse(job.checklistItems) as Array<{ text: string; checked: boolean }>)
          : null,
        photos: photos.filter(p => p.cleanerJobId === job.id),
        customRules: appliedCustomRules
          .filter(r => r.cleanerJobId === job.id)
          .map(r => ({ id: r.id, label: r.appliedLabel, amount: r.appliedAmount, type: r.appliedType })),
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

      // Upload full-resolution photo to S3
      const ext = input.filename.split(".").pop() ?? "jpg";
      const randomSuffix = Math.random().toString(36).slice(2, 10);
      const fileKey = `cleaner-photos/${ctx.cleaner.cleanerId}/${input.cleanerJobId}-${randomSuffix}.${ext}`;
      const buffer = Buffer.from(input.dataBase64, "base64");
      const { url } = await storagePut(fileKey, buffer, input.mimeType);

      // Generate and upload 200px thumbnail
      let thumbnailUrl: string | undefined;
      let thumbnailKey: string | undefined;
      const thumb = await generateThumbnail(buffer, input.mimeType);
      if (thumb) {
        const thumbKey = `cleaner-photos/${ctx.cleaner.cleanerId}/${input.cleanerJobId}-${randomSuffix}-thumb.jpg`;
        const { url: tUrl } = await storagePut(thumbKey, thumb.buffer, thumb.contentType);
        thumbnailUrl = tUrl;
        thumbnailKey = thumbKey;
      }

      // Save photo record
      await db.insert(jobPhotos).values({
        cleanerJobId: input.cleanerJobId,
        completedJobId: input.completedJobId,
        cleanerProfileId: ctx.cleaner.cleanerId,
        photoUrl: url,
        photoKey: fileKey,
        thumbnailUrl: thumbnailUrl ?? null,
        thumbnailKey: thumbnailKey ?? null,
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
        const rules = await getPayRules();
        const adj = calculatePayAdjustments({
          jobRevenue: parseFloat(job.jobRevenue ?? "0"),
          payPercent: parseFloat(job.payPercent ?? "0"),
          customerRating: job.customerRating,
          missedSomething: job.missedSomething === 1,
          currentStreakAfterJob: 0, // streak already applied at rating time; don't re-apply
          photoSubmitted: true,
          rules,
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

      const now = new Date();
      await db
        .update(cleanerJobs)
        .set({ bookingStatus: "completed", jobStatus: "completed", completedAt: now })
        .where(eq(cleanerJobs.id, input.cleanerJobId));

      // ── Field Management: Completion Flow ───────────────────────────────────────
      // Fire-and-forget: don't block the response
      sendCompletionFlow(input.cleanerJobId).catch(err =>
        console.error("[FieldMgmt] sendCompletionFlow error:", err)
      );

      // ── Tracker Review SMS ────────────────────────────────────────────────────
      // Send the tracker link again with a review incentive message
      sendCompletionReviewSms(input.cleanerJobId).catch(err =>
        console.error("[Tracker] sendCompletionReviewSms error:", err)
      );

      return { success: true };
    }),

  /**
   * cleaner.uncompleteJob — cleaner undoes a mistaken completion.
   * Reverts bookingStatus and jobStatus back to "in_progress" so the cleaner
   * can re-complete the job correctly (e.g. upload photos, fix an error).
   * Only allowed within 24 hours of completion.
   */
  uncompleteJob: cleanerProcedure
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
      const job = jobRows[0];
      if (!job) throw new TRPCError({ code: "FORBIDDEN", message: "Job not found or not yours" });
      if (job.bookingStatus !== "completed") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Job is not marked completed" });
      }
      // Only allow within 24 hours of completion
      if (job.completedAt) {
        const hoursAgo = (Date.now() - new Date(job.completedAt).getTime()) / (1000 * 60 * 60);
        if (hoursAgo > 24) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Cannot undo completion after 24 hours" });
        }
      }
      await db
        .update(cleanerJobs)
        .set({
          bookingStatus: "assigned",
          jobStatus: "in_progress",
          completedAt: null,
        })
        .where(eq(cleanerJobs.id, input.cleanerJobId));
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
      status: z.enum(["on_the_way", "arrived", "running_late", "in_progress", "finishing_up", "wrapping_up", "completed", "issue_at_property"]),
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

      // ── Status history audit log ───────────────────────────────────────────────
      // Write both the raw input status (e.g. "on_the_way") and the effective
      // status (e.g. "in_progress" after arrived auto-transition) so the timeline
      // can show exactly what the cleaner tapped.
      db.insert(jobStatusHistory)
        .values({
          cleanerJobId: input.cleanerJobId,
          status: input.status,          // what the cleaner tapped
          source: "cleaner_app",
          changedAt: new Date(),
        })
        .catch(err => console.error("[StatusHistory] insert error:", err));

      // If arrived auto-transitioned to in_progress, log that too
      if (input.status === "arrived") {
        db.insert(jobStatusHistory)
          .values({
            cleanerJobId: input.cleanerJobId,
            status: "in_progress",
            source: "engine",
            changedAt: new Date(Date.now() + 100), // 100ms after to preserve order
          })
          .catch(err => console.error("[StatusHistory] insert error:", err));
      }

      // ── Bidirectional finishing_up / wrapping_up auto-link ─────────────────────
      // When a cleaner taps "finishing_up" on Job A:
      //   → Find their next job that day (same cleaner, next serviceDateTime after Job A)
      //   → Auto-set that job's jobStatus to "wrapping_up" (if not already in a later state)
      // When a cleaner taps "wrapping_up" on Job B:
      //   → Find their previous job that day (same cleaner, last serviceDateTime before Job B)
      //   → Auto-set that job's jobStatus to "finishing_up" (if not already completed)
      // Both are fire-and-forget — they never block the response.
      if (input.status === "finishing_up" || input.status === "wrapping_up") {
        (async () => {
          try {
            if (!job.jobDate) return;
            if (input.status === "finishing_up") {
              // Find the next job for this cleaner on the same day
              const allJobs = await db
                .select({ id: cleanerJobs.id, serviceDateTime: cleanerJobs.serviceDateTime, jobStatus: cleanerJobs.jobStatus, bookingStatus: cleanerJobs.bookingStatus })
                .from(cleanerJobs)
                .where(
                  and(
                    eq(cleanerJobs.cleanerProfileId, ctx.cleaner.cleanerId),
                    eq(cleanerJobs.jobDate, job.jobDate)
                  )
                )
                .orderBy(cleanerJobs.serviceDateTime);
              const currentIdx = allJobs.findIndex(j => j.id === input.cleanerJobId);
              const nextJob = currentIdx >= 0 ? allJobs[currentIdx + 1] : undefined;
              if (
                nextJob &&
                nextJob.bookingStatus !== "completed" &&
                nextJob.bookingStatus !== "cancelled" &&
                nextJob.bookingStatus !== "rescheduled" &&
                nextJob.jobStatus !== "on_the_way" &&
                nextJob.jobStatus !== "arrived" &&
                nextJob.jobStatus !== "in_progress" &&
                nextJob.jobStatus !== "completed"
              ) {
                await db
                  .update(cleanerJobs)
                  .set({ jobStatus: "wrapping_up" })
                  .where(eq(cleanerJobs.id, nextJob.id));
                db.insert(jobStatusHistory)
                  .values({ cleanerJobId: nextJob.id, status: "wrapping_up", source: "engine", changedAt: new Date() })
                  .catch(() => {});
                console.log(`[FinishingUp] Auto-set job ${nextJob.id} to wrapping_up (linked from job ${input.cleanerJobId})`);
              }
            } else {
              // wrapping_up tapped on Job B — find the previous job
              const allJobs = await db
                .select({ id: cleanerJobs.id, serviceDateTime: cleanerJobs.serviceDateTime, jobStatus: cleanerJobs.jobStatus, bookingStatus: cleanerJobs.bookingStatus })
                .from(cleanerJobs)
                .where(
                  and(
                    eq(cleanerJobs.cleanerProfileId, ctx.cleaner.cleanerId),
                    eq(cleanerJobs.jobDate, job.jobDate)
                  )
                )
                .orderBy(cleanerJobs.serviceDateTime);
              const currentIdx = allJobs.findIndex(j => j.id === input.cleanerJobId);
              const prevJob = currentIdx > 0 ? allJobs[currentIdx - 1] : undefined;
              if (
                prevJob &&
                prevJob.bookingStatus !== "completed" &&
                prevJob.jobStatus !== "completed" &&
                prevJob.jobStatus !== "finishing_up"
              ) {
                await db
                  .update(cleanerJobs)
                  .set({ jobStatus: "finishing_up" })
                  .where(eq(cleanerJobs.id, prevJob.id));
                db.insert(jobStatusHistory)
                  .values({ cleanerJobId: prevJob.id, status: "finishing_up", source: "engine", changedAt: new Date() })
                  .catch(() => {});
                console.log(`[WrappingUp] Auto-set job ${prevJob.id} to finishing_up (linked from job ${input.cleanerJobId})`);
              }
            }
          } catch (err) {
            console.error("[FinishingUp/WrappingUp] Auto-link error:", err);
          }
        })();
      }

      // ── Post cleaner status card to CommandChat ─────────────────────────────────────────────
      const CLEANER_STATUS_CARD_STATUSES = new Set(["on_the_way", "arrived", "in_progress", "running_late", "issue_at_property", "completed"]);
      if (CLEANER_STATUS_CARD_STATUSES.has(input.status) || CLEANER_STATUS_CARD_STATUSES.has(effectiveStatus)) {
        (async () => {
          try {
            const statusMeta: Record<string, { emoji: string; label: string }> = {
              on_the_way:       { emoji: "🚗", label: "On the way" },
              arrived:          { emoji: "🟢", label: "Arrived" },
              in_progress:      { emoji: "🧹", label: "In progress" },
              running_late:     { emoji: "⏰", label: "Running late" },
              issue_at_property: { emoji: "🚨", label: "Issue at property" },
              completed:        { emoji: "✅", label: "Completed" },
            };
            const sm = statusMeta[effectiveStatus] ?? statusMeta[input.status];
            const cleanerName = ctx.cleaner.cleanerName;
            const customerPart = job.customerName ? ` — ${job.customerName}` : "";
            const addressPart = job.jobAddress ? ` (${job.jobAddress})` : "";
            let etaPart = "";
            if ((input.status === "on_the_way" || input.status === "running_late") && input.etaLabel) {
              etaPart = ` · ETA ${input.etaLabel}`;
            }
            const body = `${sm.emoji} ${cleanerName} — ${sm.label}${customerPart}${addressPart}${etaPart}`;
            await db.insert(opsChatMessages).values({
              channel: "command",
              authorName: cleanerName,
              authorRole: "cleaner",
              body,
              quickAction: "cleaner_status",
              metadata: JSON.stringify({
                cleanerName,
                status: effectiveStatus,
                label: sm.label,
                emoji: sm.emoji,
                cleanerJobId: input.cleanerJobId,
                customerName: job.customerName ?? null,
                jobAddress: job.jobAddress ?? null,
                etaLabel: input.etaLabel ?? null,
                issueNote: input.issueNote ?? null,
              }),
            });
            const { broadcastOpsUpdate } = await import("./sseBroadcast");
            broadcastOpsUpdate("new_message", { channel: "command" });
            broadcastOpsUpdate("job_update", { jobId: input.cleanerJobId });
          } catch (err) {
            console.error("[updateJobStatus] Failed to post CommandChat card:", err);
          }
        })();
      }

      return { success: true, status: effectiveStatus };
    }),

  // ── Admin procedures ────────────────────────────────────────────────────────

  /**
   * cleaner.setPassword — admin sets email + password for a cleaner's portal access.
   */
  setPassword: agentProcedure
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
   * cleaner.getPayRules — returns current pay rules for display in the cleaner portal.
   * Public so it can be called without a cleaner session (shown on login screen too).
   */
  getPayRules: publicProcedure.query(async () => {
    return getPayRules();
  }),

  /**
   * cleaner.getActiveCustomRules — returns all active custom pay rules for display in the cleaner portal.
   */
  getActiveCustomRules: publicProcedure.query(async () => {
    const db = await getDb();
    if (!db) return [];
    const rules = await db
      .select()
      .from(customPayRules)
      .where(eq(customPayRules.isActive, 1))
      .orderBy(customPayRules.type, customPayRules.label);
    return rules.map(r => ({
      id: r.id,
      label: r.label,
      type: r.type,
      amount: r.amount,
      description: r.description ?? null,
    }));
  }),

  /**
   * cleaner.getStreakInfo — returns the current cleaner's streak count for display in the portal.
   */
  getStreakInfo: cleanerProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) return { currentStreak: 0, bestStreak: 0 };
    const rows = await db
      .select()
      .from(cleanerStreaks)
      .where(eq(cleanerStreaks.cleanerProfileId, ctx.cleaner.cleanerId))
      .limit(1);
    const row = rows[0];
    return {
      currentStreak: row?.currentStreak ?? 0,
      bestStreak: row?.bestStreak ?? 0,
    };
  }),

  /**
   * cleaner.sendMagicLink — admin sends an SMS login link to a cleaner.
   * Generates a secure random token, stores it in the DB, and sends an SMS.
   * Token expires in 30 days and can be used multiple times within that window.
   */
  sendMagicLink: agentProcedure
    .input(z.object({
      cleanerProfileId: z.number().int().positive(),
      /** Frontend origin (e.g. https://quote.maidinblack.com) — used to build the magic link URL */
      origin: z.string().url(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      // Fetch the cleaner profile
      const [cleaner] = await db
        .select({ id: cleanerProfiles.id, name: cleanerProfiles.name, phone: cleanerProfiles.phone, isActive: cleanerProfiles.isActive })
        .from(cleanerProfiles)
        .where(eq(cleanerProfiles.id, input.cleanerProfileId))
        .limit(1);

      if (!cleaner) throw new TRPCError({ code: "NOT_FOUND", message: "Cleaner not found" });
      if (!cleaner.isActive) throw new TRPCError({ code: "BAD_REQUEST", message: "Cleaner is not active" });
      if (!cleaner.phone) throw new TRPCError({ code: "BAD_REQUEST", message: "Cleaner has no phone number on file" });

      // Expire any existing unused tokens for this cleaner (cleanup)
      await db
        .update(cleanerMagicLinkTokens)
        .set({ used: 1 })
        .where(and(
          eq(cleanerMagicLinkTokens.cleanerProfileId, input.cleanerProfileId),
          eq(cleanerMagicLinkTokens.used, 0),
        ));

      // Generate a cryptographically secure token
      const rawToken = randomBytes(32).toString("hex"); // 64-char hex string
      const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days

      await db.insert(cleanerMagicLinkTokens).values({
        cleanerProfileId: cleaner.id,
        token: rawToken,
        expiresAt,
        used: 0,
      });

      // Build the magic link URL using the dedicated auth callback route
      const magicUrl = `${input.origin}/auth/cleaner-callback?token=${rawToken}`;

      // Send the SMS — BEFORE any further DB work (per leadflow-sms skill)
      const firstName = cleaner.name.split(" ")[0];
      const smsText = `Hi ${firstName}! Tap to log into your Maids in Black portal — no password needed:\n${magicUrl}`;
      const smsResult = await sendSms({ to: cleaner.phone, content: smsText });

      if (!smsResult.success) {
        console.error(`[MagicLink] Failed to send SMS to ${cleaner.phone}:`, smsResult.error);
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to send SMS. Check phone number format." });
      }

      console.log(`[MagicLink] Sent login link to ${cleaner.name} (${cleaner.phone}). Token expires ${expiresAt.toISOString()}`);
      return { success: true, phone: cleaner.phone };
    }),

  /**
   * cleaner.verifyMagicLink — exchange a magic link token for a session cookie.
   * Called by the frontend when the cleaner taps the link.
   * Tokens are valid for 30 days and can be used multiple times.
   */
  verifyMagicLink: publicProcedure
    .input(z.object({ token: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      // Look up the token
      const [row] = await db
        .select()
        .from(cleanerMagicLinkTokens)
        .where(eq(cleanerMagicLinkTokens.token, input.token))
        .limit(1);

      if (!row) throw new TRPCError({ code: "UNAUTHORIZED", message: "Invalid login link" });
      if (new Date() > row.expiresAt) throw new TRPCError({ code: "UNAUTHORIZED", message: "This link has expired — please ask your manager to send a new one" });
      // Note: tokens are NOT single-use — cleaners can tap the same link multiple times within 30 days

      // Fetch the cleaner profile
      const [cleaner] = await db
        .select()
        .from(cleanerProfiles)
        .where(eq(cleanerProfiles.id, row.cleanerProfileId))
        .limit(1);

      if (!cleaner || !cleaner.isActive) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "Cleaner account is not active" });
      }

      // Issue a session cookie (same as password login — 1 year)
      const sessionToken = await signCleanerSession({
        cleanerId: cleaner.id,
        cleanerName: cleaner.name,
        cleanerPhone: cleaner.phone ?? "",
      });
      const cookieOpts = getSessionCookieOptions(ctx.req);
      ctx.res.cookie(CLEANER_COOKIE_NAME, sessionToken, {
        ...cookieOpts,
        maxAge: ONE_YEAR_MS,
      });

      console.log(`[MagicLink] Cleaner ${cleaner.name} (id=${cleaner.id}) logged in via magic link`);
      return {
        success: true,
        cleaner: { id: cleaner.id, name: cleaner.name, email: cleaner.email },
      };
    }),

  /**
   * cleaner.getMagicLink — generate (or reuse) a valid magic link for a cleaner and return the URL.
   * Does NOT send an SMS — admin copies the link manually.
   */
  getMagicLink: opsChatProcedure
    .input(z.object({
      cleanerProfileId: z.number().int().positive(),
      origin: z.string().url(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      const [cleaner] = await db
        .select({ id: cleanerProfiles.id, name: cleanerProfiles.name, isActive: cleanerProfiles.isActive })
        .from(cleanerProfiles)
        .where(eq(cleanerProfiles.id, input.cleanerProfileId))
        .limit(1);
      if (!cleaner) throw new TRPCError({ code: "NOT_FOUND", message: "Cleaner not found" });
      // Reuse existing valid token or create a new one (30-day expiry)
      const now = Date.now();
      const existing = await db
        .select({ token: cleanerMagicLinkTokens.token })
        .from(cleanerMagicLinkTokens)
        .where(
          and(
            eq(cleanerMagicLinkTokens.cleanerProfileId, cleaner.id),
            eq(cleanerMagicLinkTokens.used, 0),
            gte(cleanerMagicLinkTokens.expiresAt, new Date(now))
          )
        )
        .orderBy(cleanerMagicLinkTokens.createdAt)
        .limit(1);
      let rawToken: string;
      if (existing[0]) {
        rawToken = existing[0].token;
      } else {
        rawToken = randomBytes(32).toString("hex");
        const expiresAt = new Date(now + 30 * 24 * 60 * 60 * 1000);
        await db.insert(cleanerMagicLinkTokens).values({
          cleanerProfileId: cleaner.id,
          token: rawToken,
          expiresAt,
          used: 0,
        });
      }
      const magicUrl = `${input.origin}/auth/cleaner-callback?token=${rawToken}`;
      return { url: magicUrl, cleanerName: cleaner.name };
    }),

  listProfiles: agentProcedure.query(async () => {
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
