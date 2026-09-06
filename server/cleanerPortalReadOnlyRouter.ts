import { and, asc, eq, gte, lte, ne } from "drizzle-orm";
import { z } from "zod";
import { cleanerProfiles, leadflowJobs, schedulingTeams, teamWorkSchedule } from "../drizzle/schema";
import { cleanerProcedure, router } from "./_core/trpc";
import { getDb } from "./db";

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

function portalJob(job: typeof leadflowJobs.$inferSelect, payPercent: string | null, jobIndex = 1, totalJobsToday = 0) {
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
    jobStatus: "assigned",
    jobIndex,
    totalJobsToday,
    basePay,
    customerNotes: job.customerNotes ?? null,
    staffNotes: null,
  };
}

async function listOwnedImportedJobs(cleanerId: number, startDate: string, endDate: string) {
  const { db, cleaner, teamId } = await cleanerTeam(cleanerId);
  const jobs = await db.select().from(leadflowJobs).where(and(eq(leadflowJobs.teamId, teamId), gte(leadflowJobs.jobDate, startDate), lte(leadflowJobs.jobDate, endDate), ACTIVE_LEADFLOW_FILTER)).orderBy(asc(leadflowJobs.jobDate), asc(leadflowJobs.serviceDateTime), asc(leadflowJobs.id));
  return { cleaner, jobs };
}

export const cleanerPortalReadOnlyRouter = router({
  getMyJobsToday: cleanerProcedure.query(async ({ ctx }) => {
    const today = etDate();
    const { cleaner, jobs } = await listOwnedImportedJobs(ctx.cleaner.cleanerId, today, today);
    return jobs.map((job, index) => portalJob(job, cleaner.payPercent, index + 1, jobs.length));
  }),
  getMyJobsWeek: cleanerProcedure.query(async ({ ctx }) => {
    const today = etDate();
    const tomorrow = etDate(1);
    const { cleaner, jobs } = await listOwnedImportedJobs(ctx.cleaner.cleanerId, today, etDate(7));
    return jobs.map((job, index) => ({ ...portalJob(job, cleaner.payPercent, index + 1), dateLabel: job.jobDate === today ? "today" : job.jobDate === tomorrow ? "tomorrow" : "week" }));
  }),
  myJobsRange: cleanerProcedure.input(z.object({ from: z.string(), to: z.string() })).query(async ({ ctx, input }) => {
    const { cleaner, jobs } = await listOwnedImportedJobs(ctx.cleaner.cleanerId, input.from, input.to);
    return jobs.map((job) => ({ id: `leadflow:${job.id}`, customerName: job.customerName, jobDate: job.jobDate, bookingStatus: job.bookingStatus, finalPay: portalJob(job, cleaner.payPercent).basePay, basePay: portalJob(job, cleaner.payPercent).basePay }));
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
});
