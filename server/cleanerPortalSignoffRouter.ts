import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { bookings, cleanerPortalJobProgress, cleanerPortalJobSignoffs, leadflowJobs } from "../drizzle/schema";
import { cleanerProcedure, router } from "./_core/trpc";
import { getDb } from "./db";
import { portalJobKeySchema, resolveOwnedLeadflowJob } from "./cleanerPortalJobResolver";
import { storagePut } from "./storage";
import { getOrCreateCustomerPortalMagicLink } from "./customerPortalService";
import { sendSms } from "./openphone";
import { ENV } from "./_core/env";
import { broadcastOpsUpdate } from "./sseBroadcast";

const responseSchema = z.enum(["great", "touchup", "issue"]);

function firstName(value: string) {
  return value.trim().split(/\s+/)[0] || "there";
}

function reviewPortalUrl(portalUrl: string) {
  return `${portalUrl}${portalUrl.includes("?") ? "&" : "?"}view=review`;
}


/**
 * Mirrors the prior completion-review delivery treatment: after completion is
 * saved, send immediately in the background using the established CS sender.
 * The LeadFlow job and reusable My Home Review link replace only the former
 * cleaner-job tracker token destination.
 */
async function sendLeadflowCompletionReviewSms(leadflowJobId: number): Promise<void> {
  const db = await getDb();
  if (!db) return;

  const jobRows = await db.select({
    id: leadflowJobs.id,
    customerName: leadflowJobs.customerName,
    customerPhone: leadflowJobs.customerPhone,
    customerEmail: leadflowJobs.customerEmail,
    teamName: leadflowJobs.teamName,
  }).from(leadflowJobs).where(eq(leadflowJobs.id, leadflowJobId)).limit(1);
  const job = jobRows[0];
  if (!job) return;
  if (!job.customerPhone) {
    console.log(`[LeadflowCompletionReviewSms] No customer phone for job ${leadflowJobId} — skipping`);
    return;
  }

  const portalLink = reviewPortalUrl(await getOrCreateCustomerPortalMagicLink(db, {
    customerName: job.customerName,
    customerPhone: job.customerPhone,
    customerEmail: job.customerEmail,
  }));
  const teamDisplay = job.teamName ?? "your team";
  const body =
    `Hi ${firstName(job.customerName)}! ✨ ${teamDisplay} just finished your clean — your home is sparkling!\n\n` +
    `Leave a 5-star Thumbtack review and we'll add a $50 tip to ${teamDisplay}:`;
  const result = await sendSms({
    to: job.customerPhone,
    content: `${body}\n\nOpen My Home: ${portalLink}`,
    fromNumberId: ENV.openPhoneCsNumberId,
  });

  if (result.success) {
    console.log(`[LeadflowCompletionReviewSms] Sent Review-link SMS for job ${leadflowJobId}`);
  } else {
    console.error(`[LeadflowCompletionReviewSms] Failed Review-link SMS for job ${leadflowJobId}:`, result.error);
  }
}

export const cleanerPortalSignoffRouter = router({
  getForJob: cleanerProcedure.input(z.object({ portalJobKey: portalJobKeySchema })).query(async ({ ctx, input }) => {
    const { db, job } = await resolveOwnedLeadflowJob(ctx.cleaner.cleanerId, input.portalJobKey, "Customer sign-off is temporarily unavailable.");
    const rows = await db.select({
      signatureUrl: cleanerPortalJobSignoffs.signatureUrl,
      customerResponse: cleanerPortalJobSignoffs.customerResponse,
      customerNotes: cleanerPortalJobSignoffs.customerNotes,
      customerNotHome: cleanerPortalJobSignoffs.customerNotHome,
      signedOffAt: cleanerPortalJobSignoffs.signedOffAt,
    }).from(cleanerPortalJobSignoffs).where(eq(cleanerPortalJobSignoffs.leadflowJobId, job.id)).limit(1);
    return rows[0] ?? null;
  }),

  saveSignature: cleanerProcedure.input(z.object({
    portalJobKey: portalJobKeySchema,
    signatureBase64: z.string().min(1).max(2 * 1024 * 1024),
    customerResponse: responseSchema,
    customerNotes: z.string().trim().max(2000).optional(),
  })).mutation(async ({ ctx, input }) => {
    const { db, cleaner, job } = await resolveOwnedLeadflowJob(ctx.cleaner.cleanerId, input.portalJobKey, "Customer sign-off is temporarily unavailable.");
    const buffer = Buffer.from(input.signatureBase64, "base64");
    if (!buffer.length) throw new TRPCError({ code: "BAD_REQUEST", message: "The signature could not be read. Please sign again." });
    const suffix = Math.random().toString(36).slice(2, 10);
    const uploaded = await storagePut(`cleaner-signatures/${cleaner.id}/leadflow-${job.id}-${suffix}.png`, buffer, "image/png");
    const signatureUrl = uploaded.url;
    const now = new Date();
    await db.insert(cleanerPortalJobSignoffs).values({
      leadflowJobId: job.id,
      cleanerProfileId: cleaner.id,
      teamId: cleaner.teamId,
      signatureUrl,
      customerResponse: input.customerResponse,
      customerNotes: input.customerNotes || null,
      customerNotHome: false,
      signedOffAt: now,
      createdAt: now,
      updatedAt: now,
    }).onDuplicateKeyUpdate({ set: {
      cleanerProfileId: cleaner.id,
      teamId: cleaner.teamId,
      signatureUrl,
      customerResponse: input.customerResponse,
      customerNotes: input.customerNotes || null,
      customerNotHome: false,
      signedOffAt: now,
      updatedAt: now,
    } });
    return { signatureUrl, customerResponse: input.customerResponse, customerNotes: input.customerNotes || null, customerNotHome: false, signedOffAt: now };
  }),

  saveNotHome: cleanerProcedure.input(z.object({ portalJobKey: portalJobKeySchema })).mutation(async ({ ctx, input }) => {
    const { db, cleaner, job } = await resolveOwnedLeadflowJob(ctx.cleaner.cleanerId, input.portalJobKey, "Customer sign-off is temporarily unavailable.");
    const now = new Date();
    await db.insert(cleanerPortalJobSignoffs).values({
      leadflowJobId: job.id,
      cleanerProfileId: cleaner.id,
      teamId: cleaner.teamId,
      signatureUrl: null,
      customerResponse: null,
      customerNotes: null,
      customerNotHome: true,
      signedOffAt: now,
      createdAt: now,
      updatedAt: now,
    }).onDuplicateKeyUpdate({ set: {
      cleanerProfileId: cleaner.id,
      teamId: cleaner.teamId,
      signatureUrl: null,
      customerResponse: null,
      customerNotes: null,
      customerNotHome: true,
      signedOffAt: now,
      updatedAt: now,
    } });
    return { signatureUrl: null, customerResponse: null, customerNotes: null, customerNotHome: true, signedOffAt: now };
  }),

  completeAfterSignoff: cleanerProcedure.input(z.object({ portalJobKey: portalJobKeySchema })).mutation(async ({ ctx, input }) => {
    const { db, cleaner, job } = await resolveOwnedLeadflowJob(ctx.cleaner.cleanerId, input.portalJobKey, "Customer sign-off is temporarily unavailable.");
    const signoffRows = await db.select({ signatureUrl: cleanerPortalJobSignoffs.signatureUrl, customerNotHome: cleanerPortalJobSignoffs.customerNotHome }).from(cleanerPortalJobSignoffs).where(eq(cleanerPortalJobSignoffs.leadflowJobId, job.id)).limit(1);
    const signoff = signoffRows[0];
    if (!signoff || (!signoff.signatureUrl && !signoff.customerNotHome)) throw new TRPCError({ code: "BAD_REQUEST", message: "Customer sign-off or not-home confirmation is required before completing this job." });

    const existingRows = await db.select().from(cleanerPortalJobProgress).where(eq(cleanerPortalJobProgress.leadflowJobId, job.id)).limit(1);
    const existing = existingRows[0];
    const now = new Date();
    const progress = {
      leadflowJobId: job.id,
      cleanerProfileId: cleaner.id,
      teamId: cleaner.teamId,
      jobStatus: "completed" as const,
      etaTimestamp: existing?.etaTimestamp ?? null,
      etaTimeStr: existing?.etaTimeStr ?? null,
      arrivedAt: existing?.arrivedAt ?? null,
      startedAt: existing?.startedAt ?? null,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    await db.insert(cleanerPortalJobProgress).values(progress).onDuplicateKeyUpdate({ set: {
      cleanerProfileId: progress.cleanerProfileId,
      teamId: progress.teamId,
      jobStatus: progress.jobStatus,
      etaTimestamp: progress.etaTimestamp,
      etaTimeStr: progress.etaTimeStr,
      arrivedAt: progress.arrivedAt,
      startedAt: progress.startedAt,
      updatedAt: progress.updatedAt,
    } });
    if (job.bookingId !== null) {
      await db.update(bookings).set({ status: "completed", updatedAt: now }).where(eq(bookings.id, job.bookingId));
    }
    broadcastOpsUpdate("job_update", { jobId: job.id });
    sendLeadflowCompletionReviewSms(job.id).catch(error =>
      console.error("[LeadflowCompletionReviewSms] Unhandled completion-review delivery error:", error)
    );
    return { jobStatus: progress.jobStatus, etaTimestamp: progress.etaTimestamp, etaTimeStr: progress.etaTimeStr, completedAt: now };
  }),
});
