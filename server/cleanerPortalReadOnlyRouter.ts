import { and, asc, eq, gte, inArray, lte, ne } from "drizzle-orm";
import { z } from "zod";
import { cleanerPortalJobProgress, cleanerProfiles, leadflowJobs, schedulingTeams, teamWorkSchedule } from "../drizzle/schema";
import { leadflowJobPayrollAdjustments } from "../drizzle/leadflowPayrollAdjustments";
import { cleanerProcedure, router } from "./_core/trpc";
import { getDb } from "./db";
import { calculateEffectivePayroll } from "./payrollCalculator";
import { normalizePayrollPercent } from "./payrollNormalization";
import { getPayWeekStart } from "./teamPayRouter";
import { listOwnedLeadflowJobs } from "./cleanerPortalJobResolver";
import { findCleanerPortalTeam } from "./cleanerPortalOwnership";

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

function formatIsoDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addDays(date: Date, days: number) {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

/** Cleaner profiles store 0.45 as 45%; the established calculator receives 45. */
export function payrollPercentFromCleanerProfile(value: string | null) {
  return normalizePayrollPercent(value, 0);
}
/** Uses Team Pay's established ET Sunday-to-Saturday pay-week boundary. */
export function cleanerPortalPayWeeks(now = new Date()) {
  const currentStartDate = getPayWeekStart(now);
  const currentStart = formatIsoDate(currentStartDate);
  const currentEnd = formatIsoDate(addDays(currentStartDate, 6));
  const previousStart = formatIsoDate(addDays(currentStartDate, -7));
  const previousEnd = formatIsoDate(addDays(currentStartDate, -1));
  return { currentStart, currentEnd, previousStart, previousEnd };
}

async function cleanerTeam(cleanerId: number) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  const cleaner = await findCleanerPortalTeam(db, cleanerId);
  if (!cleaner) throw new Error("Your cleaner account has no assigned team.");
  return { db, cleaner, teamId: cleaner.launch27TeamId };
}

function portalJob(job: typeof leadflowJobs.$inferSelect, payPercent: string | null, progress?: typeof cleanerPortalJobProgress.$inferSelect | null, jobIndex = 1, totalJobsToday = 0, adjustmentCents = 0) {
  const payroll = calculateEffectivePayroll({
    jobDate: job.jobDate,
    jobRevenue: job.jobTotalCents / 100,
    payPercent: payrollPercentFromCleanerProfile(payPercent),
    manualAdjustment: adjustmentCents / 100,
  });
  return {
    portalJobKey: `leadflow:${job.id}`,
    customerName: job.customerName,
    customerPhone: job.customerPhone ?? "",
    address: job.jobAddress ?? "",
    time: timeForPortal(job.serviceDateTime),
    jobDate: job.jobDate,
    serviceDateTime: job.serviceDateTime ?? "",
    bedrooms: job.bedrooms,
    bathrooms: job.bathrooms ?? 1,
    extras: extrasForPortal(job.extras),
    checklistItems: [] as Array<{ text: string; checked: boolean }>,
    bookingStatus: job.bookingStatus,
    jobStatus: progress?.jobStatus ?? "assigned",
    jobIndex,
    totalJobsToday,
    basePay: payroll.finalPay,
    customerNotes: job.customerNotes ?? null,
    staffNotes: null,
  };
}

async function adjustmentCentsByJob(db: NonNullable<Awaited<ReturnType<typeof getDb>>>, jobIds: number[]) {
  if (!jobIds.length) return new Map<number, number>();
  const rows = await db.select({
    leadflowJobId: leadflowJobPayrollAdjustments.leadflowJobId,
    amountCents: leadflowJobPayrollAdjustments.amountCents,
  })
    .from(leadflowJobPayrollAdjustments)
    .where(inArray(leadflowJobPayrollAdjustments.leadflowJobId, jobIds));
  const totals = new Map<number, number>();
  for (const row of rows) totals.set(row.leadflowJobId, (totals.get(row.leadflowJobId) ?? 0) + row.amountCents);
  return totals;
}

async function listOwnedImportedJobs(cleanerId: number, startDate: string, endDate: string) {
  const { db, team, jobs } = await listOwnedLeadflowJobs(cleanerId, startDate, endDate, "Cleaner Portal is temporarily unavailable.");
  const adjustmentCents = await adjustmentCentsByJob(db, jobs.map(({ job }) => job.id));
  return { cleaner: team, jobs, adjustmentCents };
}

export const cleanerPortalReadOnlyRouter = router({
  getMyJobsToday: cleanerProcedure.query(async ({ ctx }) => {
    const today = etDate();
    const { cleaner, jobs, adjustmentCents } = await listOwnedImportedJobs(ctx.cleaner.cleanerId, today, today);
    return jobs.map(({ job, progress }, index) => portalJob(job, cleaner.payPercent, progress, index + 1, jobs.length, adjustmentCents.get(job.id) ?? 0));
  }),
  getMyJobsTomorrow: cleanerProcedure.query(async ({ ctx }) => {
    const tomorrow = etDate(1);
    const { cleaner, jobs, adjustmentCents } = await listOwnedImportedJobs(ctx.cleaner.cleanerId, tomorrow, tomorrow);
    return jobs.map(({ job, progress }, index) => portalJob(job, cleaner.payPercent, progress, index + 1, jobs.length, adjustmentCents.get(job.id) ?? 0));
  }),
  getMyJobsWeek: cleanerProcedure.query(async ({ ctx }) => {
    const today = etDate();
    const tomorrow = etDate(1);
    const { cleaner, jobs, adjustmentCents } = await listOwnedImportedJobs(ctx.cleaner.cleanerId, today, etDate(7));
    return jobs.map(({ job, progress }, index) => ({ ...portalJob(job, cleaner.payPercent, progress, index + 1, jobs.length, adjustmentCents.get(job.id) ?? 0), dateLabel: job.jobDate === today ? "today" : job.jobDate === tomorrow ? "tomorrow" : "week" }));
  }),
  myJobsRange: cleanerProcedure.input(z.object({ from: z.string(), to: z.string() })).query(async ({ ctx, input }) => {
    const { cleaner, jobs, adjustmentCents } = await listOwnedImportedJobs(ctx.cleaner.cleanerId, input.from, input.to);
    return jobs.map(({ job, progress }) => {
      const payout = portalJob(job, cleaner.payPercent, progress, 1, 0, adjustmentCents.get(job.id) ?? 0).basePay;
      return { id: `leadflow:${job.id}`, customerName: job.customerName, jobDate: job.jobDate, bookingStatus: job.bookingStatus, finalPay: payout, basePay: payout };
    });
  }),
  getMyEarnings: cleanerProcedure.query(async ({ ctx }) => {
    const payWeeks = cleanerPortalPayWeeks();
    const { db, team: cleaner, jobs: rows } = await listOwnedLeadflowJobs(ctx.cleaner.cleanerId, payWeeks.previousStart, payWeeks.currentEnd, "Cleaner Portal earnings are temporarily unavailable.");

    const adjustmentCents = await adjustmentCentsByJob(db, rows.map(({ job }) => job.id));
    const projectJob = ({ job, progress }: (typeof rows)[number]) => {
      const payroll = calculateEffectivePayroll({
        jobDate: job.jobDate,
        jobRevenue: job.jobTotalCents / 100,
        payPercent: payrollPercentFromCleanerProfile(cleaner.payPercent),
        manualAdjustment: (adjustmentCents.get(job.id) ?? 0) / 100,
      });
      return {
        id: `leadflow:${job.id}`,
        customerName: job.customerName,
        jobDate: job.jobDate,
        status: progress?.jobStatus ?? "assigned",
        finalPay: payroll.finalPay,
      };
    };

    const summarize = (start: string, end: string) => {
      const jobs = rows.filter(({ job }) => job.jobDate >= start && job.jobDate <= end).map(projectJob);
      return {
        start,
        end,
        totalPay: Math.round(jobs.reduce((total, job) => total + job.finalPay, 0) * 100) / 100,
        completedJobs: jobs.filter(job => job.status === "completed").length,
        jobs,
      };
    };

    return {
      current: summarize(payWeeks.currentStart, payWeeks.currentEnd),
      previous: summarize(payWeeks.previousStart, payWeeks.previousEnd),
    };
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
