import { and, eq, isNull, lte } from "drizzle-orm";
import { leadflowJobs, type LeadflowJob } from "../drizzle/schema";
import { getDb } from "./db";
import { getCompletedBookingsForDate, type Launch27Booking } from "./launch27";
import { businessLocalDateTimeToUtcMs } from "./utils/businessTime";

export const LEADFLOW_JOB_IMPORT_DAYS = 30;
export const LEADFLOW_JOB_ORIGIN_LAUNCH27 = "launch27_import";
export const LEADFLOW_JOB_ORIGIN_RECURRENCE = "leadflow_recurrence";

export type LeadflowJobImportDay = {
  date: string;
  fetched: number;
  active: number;
  created: number;
  updated: number;
  alreadyPresent: number;
  error: string | null;
};

function isDuplicateEntry(error: unknown): boolean {
  const candidate = error as { code?: string; errno?: number; message?: string };
  return candidate.code === "ER_DUP_ENTRY" || candidate.errno === 1062 || candidate.message?.includes("Duplicate entry") === true;
}

function dateParts(value: string): [number, number, number] {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new Error("Business date must use YYYY-MM-DD.");
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

export function getEasternBusinessDate(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

export function getConsecutiveBusinessDates(startDate: string, days = LEADFLOW_JOB_IMPORT_DAYS): string[] {
  const [year, month, day] = dateParts(startDate);
  if (!Number.isInteger(days) || days < 1) throw new Error("Import day count must be at least one.");
  return Array.from({ length: days }, (_, offset) => {
    const value = new Date(Date.UTC(year, month - 1, day + offset));
    return value.toISOString().slice(0, 10);
  });
}

export function isActiveLaunch27Booking(booking: Launch27Booking): boolean {
  const status = booking.bookingStatus.trim().toLowerCase();
  return booking.completed !== true && status !== "completed" && status !== "cancelled" && status !== "rescheduled";
}

export function getRecurringInterval(value: string | null): "weekly" | "biweekly" | "triweekly" | "monthly" | null {
  const normalized = value?.toLowerCase().replace(/[–—]/g, "-").trim() ?? "";
  if (normalized.includes("tri-weekly") || normalized.includes("triweekly")) return "triweekly";
  if (normalized.includes("bi-weekly") || normalized.includes("biweekly")) return "biweekly";
  if (normalized.includes("monthly")) return "monthly";
  if (normalized.includes("weekly")) return "weekly";
  return null;
}

export function nextRecurringBusinessDate(currentDate: string, frequency: string | null): string | null {
  const interval = getRecurringInterval(frequency);
  if (!interval) return null;
  const [year, month, day] = dateParts(currentDate);
  const value = new Date(Date.UTC(year, month - 1, day));
  if (interval === "weekly") value.setUTCDate(value.getUTCDate() + 7);
  if (interval === "biweekly") value.setUTCDate(value.getUTCDate() + 14);
  if (interval === "triweekly") value.setUTCDate(value.getUTCDate() + 21);
  if (interval === "monthly") value.setUTCMonth(value.getUTCMonth() + 1);
  return value.toISOString().slice(0, 10);
}

function easternTimeFromServiceDateTime(serviceDateTime: string | null): string | null {
  if (!serviceDateTime || Number.isNaN(new Date(serviceDateTime).getTime())) return null;
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(serviceDateTime));
}

export function moveServiceDateTimeToBusinessDate(serviceDateTime: string | null, jobDate: string): string | null {
  const localTime = easternTimeFromServiceDateTime(serviceDateTime);
  if (!localTime) return null;
  return new Date(businessLocalDateTimeToUtcMs(jobDate, localTime, "America/New_York")).toISOString();
}

export function launch27BookingToLeadflowJob(booking: Launch27Booking, jobDate: string) {
  const firstTeam = booking.teams[0] ?? null;
  return {
    origin: LEADFLOW_JOB_ORIGIN_LAUNCH27,
    launch27BookingId: booking.id,
    bookingSeriesId: null,
    jobDate,
    serviceDateTime: booking.serviceDate || null,
    customerName: booking.fullName || "Customer",
    customerPhone: booking.phone || null,
    customerEmail: booking.email || null,
    jobAddress: booking.address || null,
    serviceName: booking.serviceNames.join(", ") || null,
    bedrooms: booking.bedrooms,
    bathrooms: booking.bathrooms,
    extras: booking.extras.length > 0 ? JSON.stringify(booking.extras) : null,
    frequency: booking.frequency || null,
    bookingStatus: booking.bookingStatus || "assigned",
    teamName: booking.teams.map((team) => team.title).filter(Boolean).join(", ") || null,
    teamId: firstTeam?.id ?? null,
    customerNotes: booking.customerNotes || null,
    jobTotalCents: Math.round(booking.totalRevenue * 100),
    hasStripeCard: booking.hasStripeCard ? 1 : 0,
    paymentBrand: booking.paymentBrand || null,
    paymentLast4: booking.paymentLast4 || null,
  };
}

/**
 * Imports one selected business date into the isolated table only.
 * It deliberately has no stale-row cleanup or delete behavior.
 */
export async function importLaunch27JobsForDate(date: string): Promise<LeadflowJobImportDay> {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  const response = await getCompletedBookingsForDate(date, { includeAll: true });
  if (response.error) {
    return { date, fetched: 0, active: 0, created: 0, updated: 0, alreadyPresent: 0, error: response.error };
  }

  const activeBookings = response.bookings.filter(isActiveLaunch27Booking);
  const seenBookingIds = new Set<number>();
  let created = 0;
  let updated = 0;
  let alreadyPresent = 0;

  for (const booking of activeBookings) {
    if (seenBookingIds.has(booking.id)) continue;
    seenBookingIds.add(booking.id);
    const existing = await db.select({ id: leadflowJobs.id, bookingStatus: leadflowJobs.bookingStatus }).from(leadflowJobs).where(eq(leadflowJobs.launch27BookingId, booking.id)).limit(1);
    const values = launch27BookingToLeadflowJob(booking, date);
    if (existing.length > 0) {
      if (existing[0].bookingStatus.toLowerCase() === "cancelled") {
        alreadyPresent++;
        continue;
      }
      await db.update(leadflowJobs).set(values).where(eq(leadflowJobs.id, existing[0].id));
      updated++;
      continue;
    }
    try {
      await db.insert(leadflowJobs).values(values);
      created++;
    } catch (error) {
      if (!isDuplicateEntry(error)) throw error;
      alreadyPresent++;
    }
  }
  return { date, fetched: response.fetched, active: seenBookingIds.size, created, updated, alreadyPresent, error: null };
}

export async function importNextThirtyDaysOfLaunch27Jobs(now = new Date()): Promise<{
  startDate: string;
  days: LeadflowJobImportDay[];
  totals: { fetched: number; active: number; created: number; updated: number; alreadyPresent: number; errors: number };
}> {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");

  const existingImport = await db
    .select({ id: leadflowJobs.id })
    .from(leadflowJobs)
    .where(eq(leadflowJobs.origin, LEADFLOW_JOB_ORIGIN_LAUNCH27))
    .limit(1);
  if (existingImport.length > 0) {
    throw new Error("The one-time Launch27 import has already completed. LeadFlow will maintain future recurring jobs from this point.");
  }

  const startDate = getEasternBusinessDate(now);
  const dates = getConsecutiveBusinessDates(startDate);
  const days: LeadflowJobImportDay[] = [];

  for (const date of dates) {
    days.push(await importLaunch27JobsForDate(date));
  }

  return {
    startDate,
    days,
    totals: {
      fetched: days.reduce((total, day) => total + day.fetched, 0),
      active: days.reduce((total, day) => total + day.active, 0),
      created: days.reduce((total, day) => total + day.created, 0),
      updated: days.reduce((total, day) => total + day.updated, 0),
      alreadyPresent: days.reduce((total, day) => total + day.alreadyPresent, 0),
      errors: days.filter((day) => day.error !== null).length,
    },
  };
}

/**
 * One-time field enrichment for rows imported before team/card fields existed.
 * It never creates or removes a job and deliberately preserves local dates and frequencies.
 */
export async function refreshImportedLaunch27JobDetails(): Promise<{ checked: number; refreshed: number; dateErrors: number }> {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  const imported = await db.select().from(leadflowJobs).where(eq(leadflowJobs.origin, LEADFLOW_JOB_ORIGIN_LAUNCH27));
  const jobsByDate = new Map<string, LeadflowJob[]>();
  for (const job of imported) jobsByDate.set(job.jobDate, [...(jobsByDate.get(job.jobDate) ?? []), job]);
  let refreshed = 0;
  let dateErrors = 0;

  for (const [jobDate, jobs] of jobsByDate) {
    const response = await getCompletedBookingsForDate(jobDate, { includeAll: true });
    if (response.error) {
      dateErrors++;
      continue;
    }
    const sourceById = new Map(response.bookings.map((booking) => [booking.id, booking]));
    for (const job of jobs) {
      if (job.launch27BookingId === null) continue;
      const source = sourceById.get(job.launch27BookingId);
      if (!source) continue;
      const firstTeam = source.teams[0] ?? null;
      await db.update(leadflowJobs).set({
        teamName: source.teams.map((team) => team.title).filter(Boolean).join(", ") || null,
        teamId: firstTeam?.id ?? null,
        hasStripeCard: source.hasStripeCard ? 1 : 0,
        paymentBrand: source.paymentBrand || null,
        paymentLast4: source.paymentLast4 || null,
      }).where(eq(leadflowJobs.id, job.id));
      refreshed++;
    }
  }
  return { checked: imported.length, refreshed, dateErrors };
}

export function isSameLeadflowJobIdentity(current: LeadflowJob, candidate: LeadflowJob): boolean {
  return candidate.customerPhone === current.customerPhone
    && candidate.customerEmail === current.customerEmail
    && candidate.jobAddress === current.jobAddress
    && candidate.serviceName === current.serviceName;
}

export async function runEndOfDayLeadflowJobRecurrence(now = new Date()): Promise<{ checked: number; created: number; skipped: number; errors: number }> {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  const today = getEasternBusinessDate(now);
  const jobs = await db.select().from(leadflowJobs).where(and(lte(leadflowJobs.jobDate, today), isNull(leadflowJobs.nextOccurrenceCreatedAt)));
  let created = 0;
  let skipped = 0;
  let errors = 0;

  for (const job of jobs) {
    const status = job.bookingStatus.toLowerCase();
    const nextDate = nextRecurringBusinessDate(job.jobDate, job.frequency);
    if (!nextDate || status === "cancelled" || status === "rescheduled") {
      skipped++;
      continue;
    }

    const claimResult = await db.update(leadflowJobs)
      .set({ nextOccurrenceCreatedAt: new Date() })
      .where(and(eq(leadflowJobs.id, job.id), isNull(leadflowJobs.nextOccurrenceCreatedAt)));
    const claim = claimResult as unknown as { affectedRows?: number } | [{ affectedRows?: number }];
    const claimed = Array.isArray(claim) ? claim[0]?.affectedRows : claim.affectedRows;
    if (claimed !== 1) continue;

    try {
      const jobsOnNextDate = await db.select().from(leadflowJobs).where(eq(leadflowJobs.jobDate, nextDate));
      if (jobsOnNextDate.some((candidate) => isSameLeadflowJobIdentity(job, candidate))) {
        skipped++;
        continue;
      }
      await db.insert(leadflowJobs).values({
        origin: LEADFLOW_JOB_ORIGIN_RECURRENCE,
        launch27BookingId: null,
        bookingSeriesId: null,
        jobDate: nextDate,
        serviceDateTime: moveServiceDateTimeToBusinessDate(job.serviceDateTime, nextDate),
        customerName: job.customerName,
        customerPhone: job.customerPhone,
        customerEmail: job.customerEmail,
        jobAddress: job.jobAddress,
        serviceName: job.serviceName,
        bedrooms: job.bedrooms,
        bathrooms: job.bathrooms,
        extras: job.extras,
        frequency: job.frequency,
        bookingStatus: "assigned",
        teamName: job.teamName,
        teamId: job.teamId,
        customerNotes: job.customerNotes,
        jobTotalCents: job.jobTotalCents,
        hasStripeCard: job.hasStripeCard,
        paymentBrand: job.paymentBrand,
        paymentLast4: job.paymentLast4,
      });
      created++;
    } catch (error) {
      errors++;
      await db.update(leadflowJobs).set({ nextOccurrenceCreatedAt: null }).where(eq(leadflowJobs.id, job.id));
      console.error(`[LeadflowJobs] Failed recurrence for job ${job.id}:`, error);
    }
  }
  return { checked: jobs.length, created, skipped, errors };
}
