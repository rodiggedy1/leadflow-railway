import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, gte, isNull, lte, ne } from "drizzle-orm";
import { z } from "zod";
import { bookingAssignments, bookings, cleanerPortalJobExecutions, cleanerPortalJobPhotos, cleanerProfiles, leadflowJobs, schedulingTeams, teamAvailabilityCheckins, teamWorkSchedule } from "../drizzle/schema";
import { cleanerProcedure, router } from "./_core/trpc";
import { getDb } from "./db";
import { generateThumbnail, storagePut } from "./storage";
import heicConvert from "heic-convert";
import { sendSms } from "./openphone";
import { getOrCreateProxySession } from "./twilioProxy";

type PortalRecordKind = "leadflow" | "direct";
type Execution = typeof cleanerPortalJobExecutions.$inferSelect | null;
type PortalJobSource = {
  recordKind: PortalRecordKind;
  sourceId: number;
  customerName: string;
  customerPhone: string;
  address: string;
  time: string;
  jobDate: string;
  serviceDateTime: string;
  bathrooms: number;
  extras: string[];
  bookingStatus: string;
  customerNotes: string | null;
  staffNotes: string | null;
  revenueCents: number;
  sortKey: string;
};

const ACTIVE_LEADFLOW_FILTER = and(ne(leadflowJobs.bookingStatus, "cancelled"), ne(leadflowJobs.bookingStatus, "rescheduled"));
const ACTIVE_DIRECT_BOOKING_FILTER = and(ne(bookings.status, "cancelled"), ne(bookings.status, "rescheduled"));

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
  const rawTime = value.split(" ")[1] ?? "";
  const [hourRaw, minuteRaw] = rawTime.split(":");
  const hour = Number.parseInt(hourRaw, 10);
  if (!Number.isInteger(hour)) return rawTime;
  return `${hour % 12 || 12}:${String(Number.parseInt(minuteRaw ?? "0", 10)).padStart(2, "0")} ${hour >= 12 ? "PM" : "AM"}`;
}

function localTimeForPortal(value: string) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value);
  if (!match) return value || "";
  const hour = Number.parseInt(match[1], 10);
  return `${hour % 12 || 12}:${match[2]} ${hour >= 12 ? "PM" : "AM"}`;
}

function extrasForPortal(value: unknown) {
  const parsed = typeof value === "string" ? (() => { try { return JSON.parse(value); } catch { return []; } })() : value;
  if (!Array.isArray(parsed)) return [] as string[];
  return parsed.flatMap((item) => typeof item === "string" ? [item] : item && typeof item === "object" && "label" in item && typeof item.label === "string" ? [item.label] : []);
}

function notesForPortal(value: unknown) {
  if (typeof value === "string") return value || null;
  if (!Array.isArray(value)) return null;
  const notes = value.filter((note): note is string => typeof note === "string" && note.trim().length > 0);
  return notes.length ? notes.join("\n") : null;
}

function portalJobKey(recordKind: PortalRecordKind, sourceId: number) { return `${recordKind}:${sourceId}`; }

function parsePortalJobKey(value: string): { recordKind: PortalRecordKind; sourceId: number } {
  const match = /^(leadflow|direct):([1-9]\d*)$/.exec(value);
  if (!match) throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid portal booking reference." });
  return { recordKind: match[1] as PortalRecordKind, sourceId: Number.parseInt(match[2], 10) };
}

function sourceFromLeadflow(job: typeof leadflowJobs.$inferSelect): PortalJobSource {
  return { recordKind: "leadflow", sourceId: job.id, customerName: job.customerName, customerPhone: job.customerPhone ?? "", address: job.jobAddress ?? "", time: timeForPortal(job.serviceDateTime), jobDate: job.jobDate, serviceDateTime: job.serviceDateTime ?? "", bathrooms: job.bathrooms ?? 1, extras: extrasForPortal(job.extras), bookingStatus: job.bookingStatus, customerNotes: job.customerNotes ?? null, staffNotes: null, revenueCents: job.jobTotalCents ?? 0, sortKey: `${job.jobDate} ${job.serviceDateTime ?? "99:99"}` };
}

function sourceFromDirect(booking: typeof bookings.$inferSelect): PortalJobSource {
  return { recordKind: "direct", sourceId: booking.id, customerName: booking.customerName, customerPhone: booking.customerPhone, address: booking.address, time: localTimeForPortal(booking.requestedLocalTime), jobDate: booking.requestedLocalDate, serviceDateTime: String(booking.requestedStartAt), bathrooms: booking.bathrooms, extras: extrasForPortal(booking.extras), bookingStatus: booking.status, customerNotes: notesForPortal(booking.specialRequestNotes), staffNotes: null, revenueCents: booking.firstCleaningTotalCents, sortKey: `${booking.requestedLocalDate} ${booking.requestedLocalTime}` };
}

function payForSource(source: PortalJobSource, cleaner: { payPercent: string | null }) {
  const percent = Number.parseFloat(cleaner.payPercent ?? "0");
  const basePayCents = Math.round(source.revenueCents * (Number.isFinite(percent) ? percent : 0));
  return { percent: cleaner.payPercent ?? null, basePayCents };
}

function jobForPortal(source: PortalJobSource, execution: Execution, cleaner: { payPercent: string | null }, jobIndex = 1, totalJobsToday = 0) {
  const { basePayCents } = payForSource(source, cleaner);
  return { portalJobKey: portalJobKey(source.recordKind, source.sourceId), customerName: source.customerName, customerPhone: source.customerPhone, address: source.address, time: source.time, jobDate: source.jobDate, serviceDateTime: source.serviceDateTime, bathrooms: source.bathrooms, extras: source.extras, checklistItems: [] as Array<{ text: string; checked: boolean }>, bookingStatus: source.bookingStatus, jobStatus: execution?.jobStatus ?? "assigned", jobIndex, totalJobsToday, basePay: (execution?.finalPayCents ?? basePayCents) / 100, customerNotes: source.customerNotes, staffNotes: source.staffNotes };
}

async function cleanerTeam(cleanerId: number) {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
  const rows = await db.select({ id: cleanerProfiles.id, phone: cleanerProfiles.phone, launch27TeamId: cleanerProfiles.launch27TeamId, payPercent: cleanerProfiles.payPercent }).from(cleanerProfiles).where(eq(cleanerProfiles.id, cleanerId)).limit(1);
  const cleaner = rows[0];
  if (!cleaner?.launch27TeamId) throw new TRPCError({ code: "FORBIDDEN", message: "Your cleaner account has no assigned team." });
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
  const directSeen = new Set<number>();
  const combined = [...leadflowRows.map((row) => ({ source: sourceFromLeadflow(row.job), execution: row.execution })), ...directRows.flatMap((row) => { if (directSeen.has(row.booking.id)) return []; directSeen.add(row.booking.id); return [{ source: sourceFromDirect(row.booking), execution: row.execution }]; })];
  return { cleaner, teamId, jobs: combined.sort((left, right) => left.source.sortKey.localeCompare(right.source.sortKey) || left.source.recordKind.localeCompare(right.source.recordKind) || left.source.sourceId - right.source.sourceId) };
}

async function ownedPortalJob(cleanerId: number, reference: { recordKind: PortalRecordKind; sourceId: number }) {
  const { db, cleaner, teamId } = await cleanerTeam(cleanerId);
  if (reference.recordKind === "leadflow") {
    const rows = await db.select().from(leadflowJobs).where(and(eq(leadflowJobs.id, reference.sourceId), eq(leadflowJobs.teamId, teamId), ACTIVE_LEADFLOW_FILTER)).limit(1);
    if (!rows[0]) throw new TRPCError({ code: "FORBIDDEN", message: "Booking not found for your assigned team." });
    return { db, cleaner, teamId, source: sourceFromLeadflow(rows[0]) };
  }
  const rows = await db.select({ booking: bookings }).from(bookings).innerJoin(bookingAssignments, and(eq(bookingAssignments.bookingId, bookings.id), eq(bookingAssignments.teamId, teamId), eq(bookingAssignments.status, "assigned"), isNull(bookingAssignments.unassignedAt))).where(and(eq(bookings.id, reference.sourceId), ACTIVE_DIRECT_BOOKING_FILTER)).orderBy(desc(bookingAssignments.assignedAt), desc(bookingAssignments.id)).limit(1);
  if (!rows[0]) throw new TRPCError({ code: "FORBIDDEN", message: "Booking not found for your assigned team." });
  return { db, cleaner, teamId, source: sourceFromDirect(rows[0].booking) };
}

async function executionForAction(cleanerId: number, portalJobKeyValue: string) {
  const reference = parsePortalJobKey(portalJobKeyValue);
  const { db, cleaner, teamId, source } = await ownedPortalJob(cleanerId, reference);
  const pay = payForSource(source, cleaner);
  await db.insert(cleanerPortalJobExecutions).values({ recordKind: reference.recordKind, sourceId: reference.sourceId, cleanerProfileId: cleanerId, teamId, jobRevenueCents: source.revenueCents, payPercent: pay.percent, basePayCents: pay.basePayCents, finalPayCents: pay.basePayCents }).onDuplicateKeyUpdate({ set: { cleanerProfileId: cleanerId, teamId } });
  const rows = await db.select().from(cleanerPortalJobExecutions).where(and(eq(cleanerPortalJobExecutions.recordKind, reference.recordKind), eq(cleanerPortalJobExecutions.sourceId, reference.sourceId))).limit(1);
  return { db, cleaner, source, reference, execution: rows[0]! };
}

const jobInput = z.object({ portalJobKey: z.string().regex(/^(leadflow|direct):[1-9]\d*$/) });

export const cleanerIsolatedRouter = router({
  getMyJobsToday: cleanerProcedure.query(async ({ ctx }) => {
    const today = etDate(); const { cleaner, jobs } = await listPortalJobs(ctx.cleaner.cleanerId, today, today);
    return jobs.map(({ source, execution }, index) => jobForPortal(source, execution, cleaner, index + 1, jobs.length));
  }),
  getMyJobsWeek: cleanerProcedure.query(async ({ ctx }) => {
    const today = etDate(); const { cleaner, jobs } = await listPortalJobs(ctx.cleaner.cleanerId, today, etDate(7));
    return jobs.map(({ source, execution }, index) => ({ ...jobForPortal(source, execution, cleaner, index + 1), dateLabel: source.jobDate === today ? "today" : source.jobDate === etDate(1) ? "tomorrow" : "week" }));
  }),
  myJobsRange: cleanerProcedure.input(z.object({ from: z.string(), to: z.string() })).query(async ({ ctx, input }) => {
    const { cleaner, jobs } = await listPortalJobs(ctx.cleaner.cleanerId, input.from, input.to);
    return jobs.map(({ source, execution }) => { const { basePayCents } = payForSource(source, cleaner); const payCents = execution?.finalPayCents ?? basePayCents; return { id: portalJobKey(source.recordKind, source.sourceId), customerName: source.customerName, jobDate: source.jobDate, bookingStatus: execution?.jobStatus === "completed" ? "completed" : source.bookingStatus, finalPay: (execution?.finalPayCents ?? payCents) / 100, basePay: basePayCents / 100 }; });
  }),
  getNotesForLanguage: cleanerProcedure.input(jobInput.extend({ lang: z.enum(["en", "es", "pt"]) })).query(async ({ ctx, input }) => {
    const reference = parsePortalJobKey(input.portalJobKey); const { source } = await ownedPortalJob(ctx.cleaner.cleanerId, reference);
    return { customerNotes: source.customerNotes, staffNotes: source.staffNotes };
  }),
  getChecklistForLanguage: cleanerProcedure.input(jobInput.extend({ lang: z.enum(["en", "es", "pt"]) })).query(async ({ ctx, input }) => { await ownedPortalJob(ctx.cleaner.cleanerId, parsePortalJobKey(input.portalJobKey)); return { items: [] as Array<{ text: string; checked: boolean }>, sourceLang: "en", translated: false }; }),
  toggleChecklistItem: cleanerProcedure.input(jobInput.extend({ itemIndex: z.number().int().min(0), checked: z.boolean() })).mutation(async ({ ctx, input }) => { await executionForAction(ctx.cleaner.cleanerId, input.portalJobKey); return { ok: true }; }),
  getProxyNumber: cleanerProcedure.input(jobInput).mutation(async ({ ctx, input }) => {
    const { cleaner, source } = await executionForAction(ctx.cleaner.cleanerId, input.portalJobKey);
    if (source.jobDate !== etDate()) throw new TRPCError({ code: "BAD_REQUEST", message: "Call Client is only available for today's jobs." });
    if (!source.customerPhone) throw new TRPCError({ code: "BAD_REQUEST", message: "No client phone number is on file for this booking." });
    if (!cleaner.phone) throw new TRPCError({ code: "BAD_REQUEST", message: "Your profile has no phone number on file." });
    return { proxyNumber: await getOrCreateProxySession(input.portalJobKey, cleaner.phone, source.customerPhone) };
  }),
  setEta: cleanerProcedure.input(jobInput.extend({ minutes: z.number().int().min(1).max(120) })).mutation(async ({ ctx, input }) => {
    const { db, source, execution } = await executionForAction(ctx.cleaner.cleanerId, input.portalJobKey); const eta = new Date(Date.now() + input.minutes * 60_000); const etaTimeStr = eta.toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit", hour12: true });
    await db.update(cleanerPortalJobExecutions).set({ jobStatus: "on_the_way", etaTimestamp: eta.getTime(), etaTimeStr, delayMinutes: input.minutes }).where(eq(cleanerPortalJobExecutions.id, execution.id));
    if (source.customerPhone) await sendSms({ to: source.customerPhone, content: `Maids in Black: your cleaning team is on the way and expects to arrive around ${etaTimeStr}.` });
    return { ok: true, etaTimeStr };
  }),
  markArrived: cleanerProcedure.input(jobInput).mutation(async ({ ctx, input }) => { const { db, source, execution } = await executionForAction(ctx.cleaner.cleanerId, input.portalJobKey); await db.update(cleanerPortalJobExecutions).set({ jobStatus: "arrived", arrivedAt: new Date() }).where(eq(cleanerPortalJobExecutions.id, execution.id)); if (source.customerPhone) await sendSms({ to: source.customerPhone, content: "Maids in Black: your cleaning team has arrived." }); return { ok: true }; }),
  markStarted: cleanerProcedure.input(jobInput).mutation(async ({ ctx, input }) => { const { db, execution } = await executionForAction(ctx.cleaner.cleanerId, input.portalJobKey); await db.update(cleanerPortalJobExecutions).set({ jobStatus: "in_progress", startedAt: new Date() }).where(eq(cleanerPortalJobExecutions.id, execution.id)); return { ok: true }; }),
  uploadPhoto: cleanerProcedure.input(jobInput.extend({ base64Data: z.string().min(1).max(12 * 1024 * 1024), filename: z.string().max(255), mimeType: z.string().max(100), photoType: z.enum(["before", "after", "general"]) })).mutation(async ({ ctx, input }) => {
    const { db, reference, execution } = await executionForAction(ctx.cleaner.cleanerId, input.portalJobKey); const raw = Buffer.from(input.base64Data, "base64"); const isHeic = /heic|heif/i.test(input.mimeType) || /\.hei[cf]$/i.test(input.filename); const buffer = isHeic ? Buffer.from(await heicConvert({ buffer: raw, format: "JPEG", quality: 0.9 })) : raw; const mimeType = isHeic ? "image/jpeg" : input.mimeType; const ext = isHeic ? "jpg" : input.filename.split(".").pop() || "jpg"; const key = `cleaner-portal-photos/${ctx.cleaner.cleanerId}/${reference.recordKind}-${reference.sourceId}-${Date.now()}.${ext}`; const { url } = await storagePut(key, buffer, mimeType); const thumb = await generateThumbnail(buffer, mimeType); const thumbResult = thumb ? await storagePut(`${key}-thumb.jpg`, thumb.buffer, thumb.contentType) : null;
    await db.insert(cleanerPortalJobPhotos).values({ recordKind: reference.recordKind, sourceId: reference.sourceId, cleanerPortalJobExecutionId: execution.id, cleanerProfileId: ctx.cleaner.cleanerId, photoUrl: url, photoKey: key, thumbnailUrl: thumbResult?.url ?? null, thumbnailKey: thumbResult?.key ?? null, filename: input.filename, photoType: input.photoType }); return { ok: true, url };
  }),
  saveSignature: cleanerProcedure.input(jobInput.extend({ signatureBase64: z.string().min(1).max(2 * 1024 * 1024), customerResponse: z.enum(["great", "touchup", "issue"]), customerNotes: z.string().max(2000).optional() })).mutation(async ({ ctx, input }) => { const { db, reference, execution } = await executionForAction(ctx.cleaner.cleanerId, input.portalJobKey); const { url } = await storagePut(`cleaner-portal-signatures/${ctx.cleaner.cleanerId}/${reference.recordKind}-${reference.sourceId}-${Date.now()}.png`, Buffer.from(input.signatureBase64, "base64"), "image/png"); await db.update(cleanerPortalJobExecutions).set({ signatureUrl: url, customerResponse: input.customerResponse, ...(input.customerNotes !== undefined ? { customerNotes: input.customerNotes } : {}) }).where(eq(cleanerPortalJobExecutions.id, execution.id)); return { ok: true, signatureUrl: url }; }),
  saveNotHome: cleanerProcedure.input(jobInput).mutation(async ({ ctx, input }) => { const { db, execution } = await executionForAction(ctx.cleaner.cleanerId, input.portalJobKey); await db.update(cleanerPortalJobExecutions).set({ customerNotHome: 1, jobStatus: "customer_not_home" }).where(eq(cleanerPortalJobExecutions.id, execution.id)); return { ok: true }; }),
  markComplete: cleanerProcedure.input(jobInput).mutation(async ({ ctx, input }) => { const { db, execution } = await executionForAction(ctx.cleaner.cleanerId, input.portalJobKey); await db.update(cleanerPortalJobExecutions).set({ jobStatus: "completed", completedAt: new Date() }).where(eq(cleanerPortalJobExecutions.id, execution.id)); return { ok: true, finalPay: execution.finalPayCents / 100 }; }),
  portalData: cleanerProcedure.query(async ({ ctx }) => { const { db } = await cleanerTeam(ctx.cleaner.cleanerId); const rows = await db.select({ id: teamAvailabilityCheckins.id }).from(teamAvailabilityCheckins).where(and(eq(teamAvailabilityCheckins.cleanerProfileId, ctx.cleaner.cleanerId), eq(teamAvailabilityCheckins.availabilityDate, etDate(1)))).limit(1); return { streakInfo: { currentStreak: 0, bestStreak: 0 }, tomorrowAvailability: { submitted: rows.length > 0, tomorrowDate: etDate(1) } }; }),
  getMyTeamSchedule: cleanerProcedure.query(async ({ ctx }) => { const { db, teamId } = await cleanerTeam(ctx.cleaner.cleanerId); const team = await db.select({ id: schedulingTeams.id, name: schedulingTeams.name }).from(schedulingTeams).where(eq(schedulingTeams.launch27TeamId, teamId)).limit(1); if (!team[0]) return { teamId: null, teamName: null, schedule: null }; const rows = await db.select().from(teamWorkSchedule).where(eq(teamWorkSchedule.teamId, team[0].id)).limit(1); const schedule = rows[0]; return { teamId: team[0].id, teamName: team[0].name, schedule: schedule ? { mon: schedule.mon, tue: schedule.tue, wed: schedule.wed, thu: schedule.thu, fri: schedule.fri, sat: schedule.sat, sun: schedule.sun } : null }; }),
  submitWeeklySchedule: cleanerProcedure.input(z.object({ mon: z.number().int().min(0).max(1), tue: z.number().int().min(0).max(1), wed: z.number().int().min(0).max(1), thu: z.number().int().min(0).max(1), fri: z.number().int().min(0).max(1), sat: z.number().int().min(0).max(1), sun: z.number().int().min(0).max(1), note: z.string().max(500).nullable() })).mutation(async ({ ctx, input }) => { const { db, teamId } = await cleanerTeam(ctx.cleaner.cleanerId); const team = await db.select({ id: schedulingTeams.id }).from(schedulingTeams).where(eq(schedulingTeams.launch27TeamId, teamId)).limit(1); if (!team[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Team not found." }); await db.insert(teamWorkSchedule).values({ teamId: team[0].id, ...input }).onDuplicateKeyUpdate({ set: input }); await db.insert(teamAvailabilityCheckins).values({ cleanerProfileId: ctx.cleaner.cleanerId, submittedForDate: etDate(), availabilityDate: etDate(1), isAvailable: input.mon || input.tue || input.wed || input.thu || input.fri || input.sat || input.sun ? 1 : 0, maxJobs: null, note: input.note, submittedAt: Date.now() }); return { ok: true }; }),
});
