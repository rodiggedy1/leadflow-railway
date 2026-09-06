import { and, eq, ne } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { cleanerPortalJobProgress, cleanerPortalJobSignoffs, cleanerProfiles, leadflowJobs } from "../drizzle/schema";
import { cleanerProcedure, router } from "./_core/trpc";
import { getDb } from "./db";
import { storagePut } from "./storage";

const portalKeySchema = z.string().regex(/^leadflow:\d+$/, "Invalid portal job reference.");
const responseSchema = z.enum(["great", "touchup", "issue"]);

function parseLeadflowJobId(portalJobKey: string) {
  const value = Number.parseInt(portalJobKey.slice("leadflow:".length), 10);
  if (!Number.isSafeInteger(value) || value < 1) throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid portal job reference." });
  return value;
}

async function ownedImportedJob(cleanerId: number, portalJobKey: string) {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Customer sign-off is temporarily unavailable." });
  const cleanerRows = await db.select({ id: cleanerProfiles.id, teamId: cleanerProfiles.launch27TeamId }).from(cleanerProfiles).where(eq(cleanerProfiles.id, cleanerId)).limit(1);
  const cleaner = cleanerRows[0];
  if (!cleaner?.teamId) throw new TRPCError({ code: "FORBIDDEN", message: "Your cleaner account has no assigned team." });
  const leadflowJobId = parseLeadflowJobId(portalJobKey);
  const jobRows = await db.select({ id: leadflowJobs.id }).from(leadflowJobs).where(and(
    eq(leadflowJobs.id, leadflowJobId),
    eq(leadflowJobs.teamId, cleaner.teamId),
    ne(leadflowJobs.bookingStatus, "cancelled"),
    ne(leadflowJobs.bookingStatus, "rescheduled"),
    ne(leadflowJobs.bookingStatus, "missing_from_launch27"),
  )).limit(1);
  const job = jobRows[0];
  if (!job) throw new TRPCError({ code: "FORBIDDEN", message: "This job is not assigned to your team." });
  return { db, cleaner, job };
}

export const cleanerPortalSignoffRouter = router({
  getForJob: cleanerProcedure.input(z.object({ portalJobKey: portalKeySchema })).query(async ({ ctx, input }) => {
    const { db, job } = await ownedImportedJob(ctx.cleaner.cleanerId, input.portalJobKey);
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
    portalJobKey: portalKeySchema,
    signatureBase64: z.string().min(1).max(2 * 1024 * 1024),
    customerResponse: responseSchema,
    customerNotes: z.string().trim().max(2000).optional(),
  })).mutation(async ({ ctx, input }) => {
    const { db, cleaner, job } = await ownedImportedJob(ctx.cleaner.cleanerId, input.portalJobKey);
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

  saveNotHome: cleanerProcedure.input(z.object({ portalJobKey: portalKeySchema })).mutation(async ({ ctx, input }) => {
    const { db, cleaner, job } = await ownedImportedJob(ctx.cleaner.cleanerId, input.portalJobKey);
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

  completeAfterSignoff: cleanerProcedure.input(z.object({ portalJobKey: portalKeySchema })).mutation(async ({ ctx, input }) => {
    const { db, cleaner, job } = await ownedImportedJob(ctx.cleaner.cleanerId, input.portalJobKey);
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
    return { jobStatus: progress.jobStatus, etaTimestamp: progress.etaTimestamp, etaTimeStr: progress.etaTimeStr, completedAt: now };
  }),
});
