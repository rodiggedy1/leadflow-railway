import { eq } from "drizzle-orm";
import { leadflowJobs } from "../drizzle/schema";
import { getDb } from "./db";
import { getCompletedBookingsForDate, type Launch27Booking } from "./launch27";

export const LEADFLOW_JOB_IMPORT_DAYS = 30;
export const LEADFLOW_JOB_ORIGIN_LAUNCH27 = "launch27_import";

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
    teamName: firstTeam?.title ?? null,
    teamId: firstTeam?.id ?? null,
    customerNotes: booking.customerNotes || null,
    jobTotalCents: Math.round(booking.totalRevenue * 100),
  };
}

export async function importNextThirtyDaysOfLaunch27Jobs(now = new Date()): Promise<{
  startDate: string;
  days: LeadflowJobImportDay[];
  totals: { fetched: number; active: number; created: number; updated: number; alreadyPresent: number; errors: number };
}> {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");

  const startDate = getEasternBusinessDate(now);
  const dates = getConsecutiveBusinessDates(startDate);
  const days: LeadflowJobImportDay[] = [];

  for (const date of dates) {
    const response = await getCompletedBookingsForDate(date, { includeAll: true });
    if (response.error) {
      days.push({ date, fetched: 0, active: 0, created: 0, updated: 0, alreadyPresent: 0, error: response.error });
      continue;
    }

    const activeBookings = response.bookings.filter(isActiveLaunch27Booking);
    const seenBookingIds = new Set<number>();
    let created = 0;
    let updated = 0;
    let alreadyPresent = 0;

    for (const booking of activeBookings) {
      if (seenBookingIds.has(booking.id)) continue;
      seenBookingIds.add(booking.id);

      const existing = await db
        .select({ id: leadflowJobs.id })
        .from(leadflowJobs)
        .where(eq(leadflowJobs.launch27BookingId, booking.id))
        .limit(1);
      const values = launch27BookingToLeadflowJob(booking, date);
      if (existing.length > 0) {
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

    days.push({
      date,
      fetched: response.fetched,
      active: seenBookingIds.size,
      created,
      updated,
      alreadyPresent,
      error: null,
    });
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
