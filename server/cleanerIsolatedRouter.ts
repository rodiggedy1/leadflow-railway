import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, gte, isNull, lte, ne } from "drizzle-orm";
import { z } from "zod";
import { bookingAssignments, bookings, cleanerPortalJobExecutions, cleanerPortalJobPhotos, cleanerProfiles, leadflowJobs, schedulingTeams, teamWorkSchedule } from "../drizzle/schema";
import { cleanerProcedure, router } from "./_core/trpc";
import { getDb } from "./db";
import { generateThumbnail, storagePut } from "./storage";
import heicConvert from "heic-convert";
import { sendSms } from "./openphone";

type PortalRecordKind = "leadflow" | "direct";

type PortalJobSource = {
  recordKind: PortalRecordKind;
  sourceId: number;
  customerName: string;
  customerPhone: string;
  address: string;
  time: string;
  jobDate: string;
  serviceDateTime: string;
  serviceName: string;
  bedrooms: number;
  bathrooms: number;
  extras: string[];
  bookingStatus: string;
  customerNotes: string | null;
  teamName: string | null;
  jobRevenueCents: number;
  sortAt: number;
};

const ACTIVE_LEADFLOW_FILTER = and(ne(leadflowJobs.bookingStatus, "cancelled"), ne(leadflowJobs.bookingStatus, "rescheduled"));
const ACTIVE_DIRECT_BOOKING_FILTER = and(ne(bookings.status, "cancelled"), ne(bookings.status, "rescheduled"));

function etDate(offsetDays = 0) {
  const raw = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(Date.now() + offsetDays * 86_400_000));
  const [month, day, year] = raw.split("/");
  return `${year}-${month}-${day}`;
}

function timeForPortal(value: string | null) {
  if (!value) return "Time pending";
  const date = new Date(value);
  if (!Number.isNaN(date.getTime())) return date.toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit", hour12: true });
  const time = value.split(" ")[1];
  return time || value;
}

function localTimeForPortal(value: string) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value);
  if (!match) return value || "Time pending";
  const hour = Number.parseInt(match[1], 10);
  const minute = match[2];
  if (!Number.isInteger(hour) || hour > 23) return value;
  return `${hour % 12 || 12}:${minute} ${hour >= 12 ? "PM" : "AM"}`;
}

function extrasForPortal(value: unknown) {
  const parsed = typeof value === "string" ? (() => {
    try { return JSON.parse(value); } catch { return []; }
  })() : value;
  if (!Array.isArray(parsed)) return [] as string[];
  return parsed.flatMap((item) => {
    if (typeof item === "string") return [item];
    if (item && typeof item === "object" && "label" in item && typeof item.label === "string") return [item.label];
    return [];
  });
}

function notesForPortal(value: unknown) {
  if (typeof value === "string") return value || null;
  if (!Array.isArray(value)) return null;
  const notes = value.filter((note): note is string => typeof note === "string" && note.trim().length > 0);
  return notes.length ? notes.join("\n") : null;
}

function portalJobKey(recordKind: PortalRecordKind, sourceId: number) {
  return `${recordKind}:${sourceId}`;
}

function parsePortalJobKey(value: string): { recordKind: PortalRecordKind; sourceId: number } {
  const match = /^(leadflow|direct):([1-9]\d*)$/.exec(value);
  if (!match) throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid portal booking reference." });
  return { recordKind: match[1] as PortalRecordKind, sourceId: Number.parseInt(match[2], 10) };
}

function leadflowSource(job: typeof leadflowJobs.$inferSelect): PortalJobSource {
  const parsedTime = job.serviceDateTime ? new Date(job.serviceDateTime).getTime() : Number.NaN;
  return {
    recordKind: "leadflow",
    sourceId: job.id,
    customerName: job.customerName,
    customerPhone: job.customerPhone ?? "",
    address: job.jobAddress ?? "",
    time: timeForPortal(job.serviceDateTime),
    jobDate: job.jobDate,
    serviceDateTime: job.serviceDateTime ?? "",
    serviceName: job.serviceName ?? "Home cleaning",
    bedrooms: job.bedrooms ?? 0,
    bathrooms: job.bathrooms ?? 0,
    extras: extrasForPortal(job.extras),
    bookingStatus: job.bookingStatus,
    customerNotes: job.customerNotes ?? null,
    teamName: job.teamName ?? null,
    jobRevenueCents: job.jobTotalCents ?? 0,
    sortAt: Number.isFinite(parsedTime) ? parsedTime : Number.MAX_SAFE_INTEGER,
  };
}

function directSource(booking: typeof bookings.$inferSelect, assignment: typeof bookingAssignments.$inferSelect): PortalJobSource {
  return {
    recordKind: "direct",
    sourceId: booking.id,
    customerName: booking.customerName,
    customerPhone: booking.customerPhone,
    address: booking.address,
    time: localTimeForPortal(booking.requestedLocalTime),
    jobDate: booking.requestedLocalDate,
    serviceDateTime: String(booking.requestedStartAt),
    serviceName: booking.serviceName,
    bedrooms: booking.bedrooms,
    bathrooms: booking.bathrooms,
    extras: extrasForPortal(booking.extras),
    bookingStatus: booking.status,
    customerNotes: notesForPortal(booking.specialRequestNotes),
    teamName: assignment.teamName ?? null,
    jobRevenueCents: booking.firstCleaningTotalCents,
    sortAt: booking.requestedStartAt,
  };
}

function jobForPortal(job: PortalJobSource, execution: typeof cleanerPortalJobExecutions.$inferSelect | null, jobIndex?: number, totalJobsToday?: number) {
  return {
    portalJobKey: portalJobKey(job.recordKind, job.sourceId),
    recordKind: job.recordKind,
    sourceId: job.sourceId,
    customerName: job.customerName,
    customerPhone: job.customerPhone,
    address: job.address,
    time: job.time,
    jobDate: job.jobDate,
    serviceDateTime: job.serviceDateTime,
    serviceName: job.serviceName,
    bedrooms: job.bedrooms,
    bathrooms: job.bathrooms,
    extras: job.extras,
    bookingStatus: job.bookingStatus,
    customerNotes: job.customerNotes,
    teamName: job.teamName,
    execution,
    ...(jobIndex ? { jobIndex } : {}),
    ...(totalJobsToday !== undefined ? { totalJobsToday } : {}),
  };
}

function orderedJobs(rows: Array<{ job: PortalJobSource; execution: typeof cleanerPortalJobExecutions.$inferSelect | null }>) {
  return rows.sort((left, right) => left.job.sortAt - right.job.sortAt || left.job.recordKind.localeCompare(right.job.recordKind) || left.job.sourceId - right.job.sourceId);
}

async function cleanerTeam(cleanerId: number) {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
  const rows = await db.select({ id: cleanerProfiles.id, launch27TeamId: cleanerProfiles.launch27TeamId, payPercent: cleanerProfiles.payPercent }).from(cleanerProfiles).where(eq(cleanerProfiles.id, cleanerId)).limit(1);
  const cleaner = rows[0];
  if (!cleaner?.launch27TeamId) throw new TRPCError({ code: "FORBIDDEN", message: "Your cleaner account has no team assignment." });
  return { db, cleaner, teamId: cleaner.launch27TeamId };
}

async function listPortalJobs(cleanerId: number, startDate: string, endDate: string) {
  const { db, cleaner, teamId } = await cleanerTeam(cleanerId);
  const leadflowRows = await db.select({ job: leadflowJobs, execution: cleanerPortalJobExecutions }).from(leadflowJobs)
    .leftJoin(cleanerPortalJobExecutions, and(eq(cleanerPortalJobExecutions.recordKind, "leadflow"), eq(cleanerPortalJobExecutions.sourceId, leadflowJobs.id)))
    .where(and(eq(leadflowJobs.teamId, teamId), gte(leadflowJobs.jobDate, startDate), lte(leadflowJobs.jobDate, endDate), ACTIVE_LEADFLOW_FILTER));
  const directRows = await db.select({ booking: bookings, assignment: bookingAssignments, execution: cleanerPortalJobExecutions }).from(bookings)
    .innerJoin(bookingAssignments, and(eq(bookingAssignments.bookingId, bookings.id), eq(bookingAssignments.teamId, teamId), eq(bookingAssignments.status, "assigned"), isNull(bookingAssignments.unassignedAt)))
    .leftJoin(cleanerPortalJobExecutions, and(eq(cleanerPortalJobExecutions.recordKind, "direct"), eq(cleanerPortalJobExecutions.sourceId, bookings.id)))
    .where(and(gte(bookings.requestedLocalDate, startDate), lte(bookings.requestedLocalDate, endDate), ACTIVE_DIRECT_BOOKING_FILTER))
    .orderBy(desc(bookingAssignments.assignedAt), desc(bookingAssignments.id));
  const seenDirectBookingIds = new Set<number>();
  const direct = directRows.flatMap((row) => {
    if (seenDirectBookingIds.has(row.booking.id)) return [];
    seenDirectBookingIds.add(row.booking.id);
    return [{ job: directSource(row.booking, row.assignment), execution: row.execution }];
  });
  return { cleaner, teamId, jobs: orderedJobs([...leadflowRows.map((row) => ({ job: leadflowSource(row.job), execution: row.execution })), ...direct]) };
}

async function ownedPortalJob(cleanerId: number, reference: { recordKind: PortalRecordKind; sourceId: number }) {
  const { db, cleaner, teamId } = await cleanerTeam(cleanerId);
  if (reference.recordKind === "leadflow") {
    const rows = await db.select().from(leadflowJobs).where(and(eq(leadflowJobs.id, reference.sourceId), eq(leadflowJobs.teamId, teamId), ACTIVE_LEADFLOW_FILTER)).limit(1);
    if (!rows[0]) throw new TRPCError({ code: "FORBIDDEN", message: "Booking not found for your assigned team." });
    return { db, cleaner, teamId, job: leadflowSource(rows[0]) };
  }
  const rows = await db.select({ booking: bookings, assignment: bookingAssignments }).from(bookings)
    .innerJoin(bookingAssignments, and(eq(bookingAssignments.bookingId, bookings.id), eq(bookingAssignments.teamId, teamId), eq(bookingAssignments.status, "assigned"), isNull(bookingAssignments.unassignedAt)))
    .where(and(eq(bookings.id, reference.sourceId), ACTIVE_DIRECT_BOOKING_FILTER))
    .orderBy(desc(bookingAssignments.assignedAt), desc(bookingAssignments.id)).limit(1);
  if (!rows[0]) throw new TRPCError({ code: "FORBIDDEN", message: "Booking not found for your assigned team." });
  return { db, cleaner, teamId, job: directSource(rows[0].booking, rows[0].assignment) };
}

async function executionForAction(cleanerId: number, portalJobKeyValue: string) {
  const reference = parsePortalJobKey(portalJobKeyValue);
  const { db, cleaner, teamId, job } = await ownedPortalJob(cleanerId, reference);
  const revenue = job.jobRevenueCents;
  const percent = Number.parseFloat(cleaner.payPercent ?? "0");
  const basePay = Math.round(revenue * (Number.isFinite(percent) ? percent : 0));
  await db.insert(cleanerPortalJobExecutions).values({ recordKind: reference.recordKind, sourceId: reference.sourceId, cleanerProfileId: cleanerId, teamId, jobRevenueCents: revenue, payPercent: cleaner.payPercent ?? null, basePayCents: basePay, finalPayCents: basePay }).onDuplicateKeyUpdate({ set: { cleanerProfileId: cleanerId, teamId } });
  const rows = await db.select().from(cleanerPortalJobExecutions).where(and(eq(cleanerPortalJobExecutions.recordKind, reference.recordKind), eq(cleanerPortalJobExecutions.sourceId, reference.sourceId))).limit(1);
  return { db, cleaner, teamId, job, reference, execution: rows[0]! };
}

const jobInput = z.object({ portalJobKey: z.string().regex(/^(leadflow|direct):[1-9]\d*$/) });

export const cleanerIsolatedRouter = router({
  getMyJobsToday: cleanerProcedure.query(async ({ ctx }) => {
    const today = etDate();
    const { jobs } = await listPortalJobs(ctx.cleaner.cleanerId, today, today);
    return jobs.map(({ job, execution }, index) => jobForPortal(job, execution, index + 1, jobs.length));
  }),
  getMyJobsWeek: cleanerProcedure.query(async ({ ctx }) => {
    const today = etDate();
    const { jobs } = await listPortalJobs(ctx.cleaner.cleanerId, today, etDate(7));
    return jobs.map(({ job, execution }, index) => ({ ...jobForPortal(job, execution, index + 1), dateLabel: job.jobDate === today ? "today" : job.jobDate === etDate(1) ? "tomorrow" : "week" }));
  }),
  setEta: cleanerProcedure.input(jobInput.extend({ minutes: z.number().int().min(1).max(120) })).mutation(async ({ ctx, input }) => {
    const { db, job, execution } = await executionForAction(ctx.cleaner.cleanerId, input.portalJobKey);
    const eta = new Date(Date.now() + input.minutes * 60_000);
    const etaTimeStr = eta.toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit", hour12: true });
    await db.update(cleanerPortalJobExecutions).set({ jobStatus: "on_the_way", etaTimestamp: eta.getTime(), etaTimeStr, delayMinutes: input.minutes }).where(eq(cleanerPortalJobExecutions.id, execution.id));
    if (job.customerPhone) await sendSms({ to: job.customerPhone, content: `Maids in Black: your cleaning team is on the way and expects to arrive around ${etaTimeStr}.` });
    return { ok: true, portalJobKey: input.portalJobKey, etaTimeStr };
  }),
  markArrived: cleanerProcedure.input(jobInput).mutation(async ({ ctx, input }) => {
    const { db, job, execution } = await executionForAction(ctx.cleaner.cleanerId, input.portalJobKey);
    await db.update(cleanerPortalJobExecutions).set({ jobStatus: "arrived", arrivedAt: new Date() }).where(eq(cleanerPortalJobExecutions.id, execution.id));
    if (job.customerPhone) await sendSms({ to: job.customerPhone, content: "Maids in Black: your cleaning team has arrived." });
    return { ok: true };
  }),
  markStarted: cleanerProcedure.input(jobInput).mutation(async ({ ctx, input }) => {
    const { db, execution } = await executionForAction(ctx.cleaner.cleanerId, input.portalJobKey);
    await db.update(cleanerPortalJobExecutions).set({ jobStatus: "in_progress", startedAt: new Date() }).where(eq(cleanerPortalJobExecutions.id, execution.id));
    return { ok: true };
  }),
  saveSignature: cleanerProcedure.input(jobInput.extend({ signatureBase64: z.string().min(1).max(2 * 1024 * 1024), customerResponse: z.enum(["great", "touchup", "issue"]), customerNotes: z.string().max(2000).optional() })).mutation(async ({ ctx, input }) => {
    const { db, reference, execution } = await executionForAction(ctx.cleaner.cleanerId, input.portalJobKey);
    const { url } = await storagePut(`cleaner-portal-signatures/${ctx.cleaner.cleanerId}/${reference.recordKind}-${reference.sourceId}-${Date.now()}.png`, Buffer.from(input.signatureBase64, "base64"), "image/png");
    await db.update(cleanerPortalJobExecutions).set({ signatureUrl: url, customerResponse: input.customerResponse, ...(input.customerNotes !== undefined ? { customerNotes: input.customerNotes } : {}) }).where(eq(cleanerPortalJobExecutions.id, execution.id));
    return { ok: true, signatureUrl: url };
  }),
  uploadPhoto: cleanerProcedure.input(jobInput.extend({ base64Data: z.string().min(1).max(12 * 1024 * 1024), filename: z.string().max(255), mimeType: z.string().max(100), photoType: z.enum(["before", "after", "general"]) })).mutation(async ({ ctx, input }) => {
    const { db, reference, execution } = await executionForAction(ctx.cleaner.cleanerId, input.portalJobKey);
    const raw = Buffer.from(input.base64Data, "base64");
    const isHeic = /heic|heif/i.test(input.mimeType) || /\.hei[cf]$/i.test(input.filename);
    const buffer = isHeic ? Buffer.from(await heicConvert({ buffer: raw, format: "JPEG", quality: 0.9 })) : raw;
    const mimeType = isHeic ? "image/jpeg" : input.mimeType;
    const ext = isHeic ? "jpg" : input.filename.split(".").pop() || "jpg";
    const key = `cleaner-portal-photos/${ctx.cleaner.cleanerId}/${reference.recordKind}-${reference.sourceId}-${Date.now()}.${ext}`;
    const { url } = await storagePut(key, buffer, mimeType);
    const thumb = await generateThumbnail(buffer, mimeType);
    const thumbResult = thumb ? await storagePut(`${key}-thumb.jpg`, thumb.buffer, thumb.contentType) : null;
    await db.insert(cleanerPortalJobPhotos).values({ recordKind: reference.recordKind, sourceId: reference.sourceId, cleanerPortalJobExecutionId: execution.id, cleanerProfileId: ctx.cleaner.cleanerId, photoUrl: url, photoKey: key, thumbnailUrl: thumbResult?.url ?? null, thumbnailKey: thumbResult?.key ?? null, filename: input.filename, photoType: input.photoType });
    return { ok: true, url };
  }),
  getPhotos: cleanerProcedure.input(jobInput).query(async ({ ctx, input }) => {
    const reference = parsePortalJobKey(input.portalJobKey);
    const { db } = await ownedPortalJob(ctx.cleaner.cleanerId, reference);
    return db.select().from(cleanerPortalJobPhotos).where(and(eq(cleanerPortalJobPhotos.recordKind, reference.recordKind), eq(cleanerPortalJobPhotos.sourceId, reference.sourceId))).orderBy(asc(cleanerPortalJobPhotos.createdAt));
  }),
  markCustomerNotHome: cleanerProcedure.input(jobInput).mutation(async ({ ctx, input }) => {
    const { db, execution } = await executionForAction(ctx.cleaner.cleanerId, input.portalJobKey);
    await db.update(cleanerPortalJobExecutions).set({ customerNotHome: 1, jobStatus: "customer_not_home" }).where(eq(cleanerPortalJobExecutions.id, execution.id));
    return { ok: true };
  }),
  markComplete: cleanerProcedure.input(jobInput).mutation(async ({ ctx, input }) => {
    const { db, execution } = await executionForAction(ctx.cleaner.cleanerId, input.portalJobKey);
    await db.update(cleanerPortalJobExecutions).set({ jobStatus: "completed", completedAt: new Date() }).where(eq(cleanerPortalJobExecutions.id, execution.id));
    return { ok: true, finalPayCents: execution.finalPayCents };
  }),
  getTeamSchedule: cleanerProcedure.query(async ({ ctx }) => {
    const { db, teamId } = await cleanerTeam(ctx.cleaner.cleanerId);
    const team = await db.select().from(schedulingTeams).where(eq(schedulingTeams.launch27TeamId, teamId)).limit(1);
    if (!team[0]) return { teamId: null, teamName: null, schedule: null };
    const schedule = await db.select().from(teamWorkSchedule).where(eq(teamWorkSchedule.teamId, team[0].id)).limit(1);
    return { teamId: team[0].id, teamName: team[0].name, schedule: schedule[0] ?? null };
  }),
  updateTeamSchedule: cleanerProcedure.input(z.object({ mon: z.number().int().min(0).max(1), tue: z.number().int().min(0).max(1), wed: z.number().int().min(0).max(1), thu: z.number().int().min(0).max(1), fri: z.number().int().min(0).max(1), sat: z.number().int().min(0).max(1), sun: z.number().int().min(0).max(1), note: z.string().max(500).optional() })).mutation(async ({ ctx, input }) => {
    const { db, teamId } = await cleanerTeam(ctx.cleaner.cleanerId);
    const team = await db.select({ id: schedulingTeams.id }).from(schedulingTeams).where(eq(schedulingTeams.launch27TeamId, teamId)).limit(1);
    if (!team[0]) throw new TRPCError({ code: "FORBIDDEN", message: "No scheduling team found for your account." });
    await db.insert(teamWorkSchedule).values({ teamId: team[0].id, ...input, note: input.note ?? null }).onDuplicateKeyUpdate({ set: { ...input, note: input.note ?? null } });
    return { ok: true };
  }),
});
