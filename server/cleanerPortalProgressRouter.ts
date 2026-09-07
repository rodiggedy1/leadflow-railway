import { TRPCError } from "@trpc/server";
import { and, eq, ne } from "drizzle-orm";
import { z } from "zod";
import { cleanerPortalJobProgress, cleanerProfiles, leadflowJobs } from "../drizzle/schema";
import { cleanerProcedure, router } from "./_core/trpc";
import { getDb } from "./db";
import { sendSms } from "./openphone";
import { getOrCreateCustomerPortalMagicLink } from "./customerPortalService";

const ETA_CHOICES = [10, 20, 30, 45, 60, 75, 90, 120] as const;
const portalKeySchema = z.string().regex(/^leadflow:\d+$/, "Invalid portal job reference.");

function parseLeadflowJobId(portalJobKey: string) {
  const value = Number.parseInt(portalJobKey.slice("leadflow:".length), 10);
  if (!Number.isSafeInteger(value) || value < 1) throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid portal job reference." });
  return value;
}

function firstName(value: string) {
  return value.trim().split(/\s+/)[0] || "there";
}

function formatEtaTime(timestamp: number) {
  return new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" }).format(new Date(timestamp));
}

async function ownedImportedJob(cleanerId: number, portalJobKey: string) {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Portal progress is temporarily unavailable." });
  const cleanerRows = await db.select({ id: cleanerProfiles.id, teamId: cleanerProfiles.launch27TeamId }).from(cleanerProfiles).where(eq(cleanerProfiles.id, cleanerId)).limit(1);
  const cleaner = cleanerRows[0];
  if (!cleaner?.teamId) throw new TRPCError({ code: "FORBIDDEN", message: "Your cleaner account has no assigned team." });
  const leadflowJobId = parseLeadflowJobId(portalJobKey);
  const jobRows = await db.select({
    id: leadflowJobs.id,
    customerName: leadflowJobs.customerName,
    customerPhone: leadflowJobs.customerPhone,
    customerEmail: leadflowJobs.customerEmail,
    jobAddress: leadflowJobs.jobAddress,
  }).from(leadflowJobs).where(and(
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

async function saveProgress(input: {
  cleanerId: number;
  teamId: number;
  leadflowJobId: number;
  jobStatus: "on_the_way" | "arrived" | "in_progress";
  etaTimestamp?: number;
  etaTimeStr?: string;
  arrivedAt?: Date;
  startedAt?: Date;
}) {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Portal progress is temporarily unavailable." });
  const existingRows = await db.select().from(cleanerPortalJobProgress).where(eq(cleanerPortalJobProgress.leadflowJobId, input.leadflowJobId)).limit(1);
  const existing = existingRows[0];
  const now = new Date();
  const record = {
    leadflowJobId: input.leadflowJobId,
    cleanerProfileId: input.cleanerId,
    teamId: input.teamId,
    jobStatus: input.jobStatus,
    etaTimestamp: input.etaTimestamp ?? existing?.etaTimestamp ?? null,
    etaTimeStr: input.etaTimeStr ?? existing?.etaTimeStr ?? null,
    arrivedAt: input.arrivedAt ?? existing?.arrivedAt ?? null,
    startedAt: input.startedAt ?? existing?.startedAt ?? null,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  await db.insert(cleanerPortalJobProgress).values(record).onDuplicateKeyUpdate({ set: {
    cleanerProfileId: record.cleanerProfileId,
    teamId: record.teamId,
    jobStatus: record.jobStatus,
    etaTimestamp: record.etaTimestamp,
    etaTimeStr: record.etaTimeStr,
    arrivedAt: record.arrivedAt,
    startedAt: record.startedAt,
    updatedAt: record.updatedAt,
  } });
  return record;
}

async function notifyClient(input: { db: NonNullable<Awaited<ReturnType<typeof getDb>>>; customerName: string; customerPhone: string | null; customerEmail: string | null; content: string }) {
  if (!input.customerPhone) return { customerNotified: false, notificationError: null as string | null };
  let portalLink: string | null = null;
  try {
    portalLink = await getOrCreateCustomerPortalMagicLink(input.db, {
      customerName: input.customerName,
      customerPhone: input.customerPhone,
      customerEmail: input.customerEmail,
    });
  } catch (error) {
    console.error("[CleanerPortalProgress] Customer portal link generation failed; sending status text without a link.", error);
  }
  const content = portalLink ? `${input.content}\n\nOpen My Home: ${portalLink}` : input.content;
  const result = await sendSms({ to: input.customerPhone, content });
  return { customerNotified: result.success, notificationError: result.success ? null : (result.error ?? "The customer message could not be sent.") };
}

export const cleanerPortalProgressRouter = router({
  getForJob: cleanerProcedure.input(z.object({ portalJobKey: portalKeySchema })).query(async ({ ctx, input }) => {
    const { db, job } = await ownedImportedJob(ctx.cleaner.cleanerId, input.portalJobKey);
    const rows = await db.select({ jobStatus: cleanerPortalJobProgress.jobStatus, etaTimestamp: cleanerPortalJobProgress.etaTimestamp, etaTimeStr: cleanerPortalJobProgress.etaTimeStr, arrivedAt: cleanerPortalJobProgress.arrivedAt, startedAt: cleanerPortalJobProgress.startedAt }).from(cleanerPortalJobProgress).where(eq(cleanerPortalJobProgress.leadflowJobId, job.id)).limit(1);
    return rows[0] ?? null;
  }),
  setEta: cleanerProcedure.input(z.object({ portalJobKey: portalKeySchema, minutes: z.union(ETA_CHOICES.map(value => z.literal(value)) as [z.ZodLiteral<10>, z.ZodLiteral<20>, z.ZodLiteral<30>, z.ZodLiteral<45>, z.ZodLiteral<60>, z.ZodLiteral<75>, z.ZodLiteral<90>, z.ZodLiteral<120>]) })).mutation(async ({ ctx, input }) => {
    const { db, cleaner, job } = await ownedImportedJob(ctx.cleaner.cleanerId, input.portalJobKey);
    const etaTimestamp = Date.now() + input.minutes * 60_000;
    const etaTimeStr = formatEtaTime(etaTimestamp);
    const progress = await saveProgress({ cleanerId: cleaner.id, teamId: cleaner.teamId!, leadflowJobId: job.id, jobStatus: "on_the_way", etaTimestamp, etaTimeStr });
    const notification = await notifyClient({ db, customerName: job.customerName, customerPhone: job.customerPhone, customerEmail: job.customerEmail, content: `Hi ${firstName(job.customerName)}! Your Maids in Black team is on the way and will arrive at ${job.jobAddress ?? "your address"} around ${etaTimeStr}.` });
    return { ...progress, ...notification };
  }),
  markArrived: cleanerProcedure.input(z.object({ portalJobKey: portalKeySchema })).mutation(async ({ ctx, input }) => {
    const { db, cleaner, job } = await ownedImportedJob(ctx.cleaner.cleanerId, input.portalJobKey);
    const progress = await saveProgress({ cleanerId: cleaner.id, teamId: cleaner.teamId!, leadflowJobId: job.id, jobStatus: "arrived", arrivedAt: new Date() });
    const notification = await notifyClient({ db, customerName: job.customerName, customerPhone: job.customerPhone, customerEmail: job.customerEmail, content: `Hi ${firstName(job.customerName)}! Your Maids in Black team has arrived for your cleaning at ${job.jobAddress ?? "your address"}.` });
    return { ...progress, ...notification };
  }),
  startJob: cleanerProcedure.input(z.object({ portalJobKey: portalKeySchema })).mutation(async ({ ctx, input }) => {
    const { cleaner, job } = await ownedImportedJob(ctx.cleaner.cleanerId, input.portalJobKey);
    const progress = await saveProgress({ cleanerId: cleaner.id, teamId: cleaner.teamId!, leadflowJobId: job.id, jobStatus: "in_progress", startedAt: new Date() });
    return { ...progress, customerNotified: false, notificationError: null as string | null };
  }),
});
