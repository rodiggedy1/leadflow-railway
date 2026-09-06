import { and, asc, eq, gte, lte, ne, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { cleanerPortalJobProgress, cleanerProfiles, leadflowJobs, schedulingTeams, teamWorkSchedule } from "../drizzle/schema";
import { cleanerProcedure, router } from "./_core/trpc";
import { getDb } from "./db";
import { sendSms } from "./openphone";

const ACTIVE_LEADFLOW_FILTER = and(ne(leadflowJobs.bookingStatus, "cancelled"), ne(leadflowJobs.bookingStatus, "rescheduled"));

function etDate(offsetDays = 0) {
  const raw = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(Date.now() + offsetDays * 86_400_000));
  const [month, day, year] = raw.split("/");
  return `${year}-${month}-${day}`;
}

function timeForPortal(value: string | null) {
  if (!value) return "";
  if (value.includes("T")) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed.toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit", hour12: true });
  }
  const time = value.split(" ")[1] ?? "";
  const [hourValue, minuteValue] = time.split(":");
  const hour = Number.parseInt(hourValue, 10);
  if (!Number.isInteger(hour)) return time;
  return `${hour % 12 || 12}:${String(Number.parseInt(minuteValue ?? "0", 10)).padStart(2, "0")} ${hour >= 12 ? "PM" : "AM"}`;
}

function extrasForPortal(value: string | null) {
  if (!value) return [] as string[];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [] as string[];
  }
}

async function cleanerTeam(cleanerId: number) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  const rows = await db.select({ id: cleanerProfiles.id, launch27TeamId: cleanerProfiles.launch27TeamId, payPercent: cleanerProfiles.payPercent }).from(cleanerProfiles).where(eq(cleanerProfiles.id, cleanerId)).limit(1);
  const cleaner = rows[0];
  if (!cleaner?.launch27TeamId) throw new Error("Your cleaner account has no assigned team.");
  return { db, cleaner, teamId: cleaner.launch27TeamId };
}

function portalJob(job: typeof leadflowJobs.$inferSelect, payPercent: string | null, progress: typeof cleanerPortalJobProgress.$inferSelect | null, jobIndex = 1, totalJobsToday = 0) {
  const parsedPercent = Number.parseFloat(payPercent ?? "0");
  const basePay = Number.isFinite(parsedPercent) ? (job.jobTotalCents * parsedPercent) / 100 : 0;
  return {
    portalJobKey: `leadflow:${job.id}`,
    customerName: job.customerName,
    customerPhone: job.customerPhone ?? "",
    address: job.jobAddress ?? "",
    time: timeForPortal(job.serviceDateTime),
    jobDate: job.jobDate,
    serviceDateTime: job.serviceDateTime ?? "",
    bathrooms: job.bathrooms ?? 1,
    extras: extrasForPortal(job.extras),
    checklistItems: [] as Array<{ text: string; checked: boolean }>,
    bookingStatus: job.bookingStatus,
    jobStatus: progress?.jobStatus ?? "assigned",
    jobIndex,
    totalJobsToday,
    basePay,
    customerNotes: job.customerNotes ?? null,
    staffNotes: null,
  };
}

async function listOwnedImportedJobs(cleanerId: number, startDate: string, endDate: string) {
  const { db, cleaner, teamId } = await cleanerTeam(cleanerId);
  const jobs = await db.select({ job: leadflowJobs, progress: cleanerPortalJobProgress }).from(leadflowJobs).leftJoin(cleanerPortalJobProgress, eq(cleanerPortalJobProgress.leadflowJobId, leadflowJobs.id)).where(and(eq(leadflowJobs.teamId, teamId), gte(leadflowJobs.jobDate, startDate), lte(leadflowJobs.jobDate, endDate), ACTIVE_LEADFLOW_FILTER)).orderBy(asc(leadflowJobs.jobDate), asc(leadflowJobs.serviceDateTime), asc(leadflowJobs.id));
  return { cleaner, jobs };
}

function parseLeadflowPortalKey(value: string) {
  const match = /^leadflow:([1-9]\d*)$/.exec(value);
  if (!match) throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid portal booking reference." });
  return Number.parseInt(match[1], 10);
}

async function ownedProgressJob(cleanerId: number, portalJobKey: string) {
  const leadflowJobId = parseLeadflowPortalKey(portalJobKey);
  const { db, cleaner, teamId } = await cleanerTeam(cleanerId);
  const rows = await db.select().from(leadflowJobs).where(and(eq(leadflowJobs.id, leadflowJobId), eq(leadflowJobs.teamId, teamId), ACTIVE_LEADFLOW_FILTER)).limit(1);
  const job = rows[0];
  if (!job) throw new TRPCError({ code: "FORBIDDEN", message: "Booking not found for your assigned team." });
  return { db, cleaner, teamId, job };
}

async function persistProgress(input: { cleanerId: number; teamId: number; leadflowJobId: number; jobStatus: "on_the_way" | "arrived" | "in_progress"; etaTimestamp?: number | null; etaTimeStr?: string | null; arrivedAt?: Date | null; startedAt?: Date | null }) {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
  const now = new Date();
  await db.insert(cleanerPortalJobProgress).values({ leadflowJobId: input.leadflowJobId, cleanerProfileId: input.cleanerId, teamId: input.teamId, jobStatus: input.jobStatus, etaTimestamp: input.etaTimestamp ?? null, etaTimeStr: input.etaTimeStr ?? null, arrivedAt: input.arrivedAt ?? null, startedAt: input.startedAt ?? null, createdAt: now, updatedAt: now }).onDuplicateKeyUpdate({ set: {
    cleanerProfileId: input.cleanerId,
    teamId: input.teamId,
    jobStatus: input.jobStatus,
    etaTimestamp: input.etaTimestamp === undefined ? sql`\`etaTimestamp\`` : input.etaTimestamp,
    etaTimeStr: input.etaTimeStr === undefined ? sql`\`etaTimeStr\`` : input.etaTimeStr,
    arrivedAt: input.arrivedAt === undefined ? sql`\`arrivedAt\`` : input.arrivedAt,
    startedAt: input.startedAt === undefined ? sql`\`startedAt\`` : input.startedAt,
    updatedAt: now,
  } });
}

export const cleanerPortalReadOnlyRouter = router({
  getMyJobsToday: cleanerProcedure.query(async ({ ctx }) => {
    const today = etDate();
    const { cleaner, jobs } = await listOwnedImportedJobs(ctx.cleaner.cleanerId, today, today);
    return jobs.map(({ job, progress }, index) => portalJob(job, cleaner.payPercent, progress, index + 1, jobs.length));
  }),
  getMyJobsWeek: cleanerProcedure.query(async ({ ctx }) => {
    const today = etDate();
    const tomorrow = etDate(1);
    const { cleaner, jobs } = await listOwnedImportedJobs(ctx.cleaner.cleanerId, today, etDate(7));
    return jobs.map(({ job, progress }, index) => ({ ...portalJob(job, cleaner.payPercent, progress, index + 1), dateLabel: job.jobDate === today ? "today" : job.jobDate === tomorrow ? "tomorrow" : "week" }));
  }),
  myJobsRange: cleanerProcedure.input(z.object({ from: z.string(), to: z.string() })).query(async ({ ctx, input }) => {
    const { cleaner, jobs } = await listOwnedImportedJobs(ctx.cleaner.cleanerId, input.from, input.to);
    return jobs.map(({ job, progress }) => ({ id: `leadflow:${job.id}`, customerName: job.customerName, jobDate: job.jobDate, bookingStatus: job.bookingStatus, finalPay: portalJob(job, cleaner.payPercent, progress).basePay, basePay: portalJob(job, cleaner.payPercent, progress).basePay }));
  }),
  getMyTeamSchedule: cleanerProcedure.query(async ({ ctx }) => {
    const { db, teamId } = await cleanerTeam(ctx.cleaner.cleanerId);
    const teams = await db.select({ id: schedulingTeams.id, name: schedulingTeams.name }).from(schedulingTeams).where(eq(schedulingTeams.launch27TeamId, teamId)).limit(1);
    const team = teams[0];
    if (!team) return { teamId: null, teamName: null, schedule: null };
    const schedules = await db.select().from(teamWorkSchedule).where(eq(teamWorkSchedule.teamId, team.id)).limit(1);
    const schedule = schedules[0];
    return { teamId: team.id, teamName: team.name, schedule: schedule ? { mon: schedule.mon, tue: schedule.tue, wed: schedule.wed, thu: schedule.thu, fri: schedule.fri, sat: schedule.sat, sun: schedule.sun } : null };
  }),
  setEta: cleanerProcedure.input(z.object({ portalJobKey: z.string(), minutes: z.number().int().refine((value) => [10, 20, 30, 45, 60, 75, 90, 120].includes(value), "Invalid ETA option.") })).mutation(async ({ ctx, input }) => {
    const { cleaner, teamId, job } = await ownedProgressJob(ctx.cleaner.cleanerId, input.portalJobKey);
    const eta = new Date(Date.now() + input.minutes * 60_000);
    const etaTimeStr = eta.toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit", hour12: true });
    await persistProgress({ cleanerId: cleaner.id, teamId, leadflowJobId: job.id, jobStatus: "on_the_way", etaTimestamp: eta.getTime(), etaTimeStr });
    const sms = job.customerPhone ? await sendSms({ to: job.customerPhone, content: `Maids in Black: your cleaning team is on the way and expects to arrive around ${etaTimeStr}.` }) : null;
    return { ok: true, etaTimeStr, clientNotified: sms?.success ?? false };
  }),
  markArrived: cleanerProcedure.input(z.object({ portalJobKey: z.string() })).mutation(async ({ ctx, input }) => {
    const { cleaner, teamId, job } = await ownedProgressJob(ctx.cleaner.cleanerId, input.portalJobKey);
    const now = new Date();
    await persistProgress({ cleanerId: cleaner.id, teamId, leadflowJobId: job.id, jobStatus: "arrived", arrivedAt: now });
    const sms = job.customerPhone ? await sendSms({ to: job.customerPhone, content: "Maids in Black: your cleaning team has arrived." }) : null;
    return { ok: true, clientNotified: sms?.success ?? false };
  }),
  startJob: cleanerProcedure.input(z.object({ portalJobKey: z.string() })).mutation(async ({ ctx, input }) => {
    const { cleaner, teamId, job } = await ownedProgressJob(ctx.cleaner.cleanerId, input.portalJobKey);
    await persistProgress({ cleanerId: cleaner.id, teamId, leadflowJobId: job.id, jobStatus: "in_progress", startedAt: new Date() });
    return { ok: true };
  }),
});
