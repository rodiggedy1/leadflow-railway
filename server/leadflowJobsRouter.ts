import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import { cleanerPortalJobPhotos, cleanerPortalJobSignoffs, leadflowBookingMessages, leadflowJobs } from "../drizzle/schema";
import { adminAgentProcedure, router } from "./_core/trpc";
import { getDb } from "./db";
import { importLaunch27JobsForDate, importNextThirtyDaysOfLaunch27Jobs, isSameLeadflowJobIdentity, LEADFLOW_JOB_ORIGIN_LAUNCH27, moveServiceDateTimeToBusinessDate, refreshImportedLaunch27JobDetails } from "./leadflowJobsService";
import { broadcastCleanerPortalJobsChanged } from "./cleanerPortalUpdates";

const listInput = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  query: z.string().trim().max(255).optional(),
});

const updateInput = z.object({
  jobId: z.number().int().positive(),
  jobDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  frequency: z.enum(["One time", "Weekly", "Bi-weekly", "Tri-weekly", "Monthly"]).optional(),
}).refine((value) => value.jobDate !== undefined || value.frequency !== undefined, "Choose a date or frequency to update.");
const bookingPhotoReferenceInput = z.object({
  bookingKey: z.string().regex(/^(leadflow|booking|funnel|portal):\d+$/, "Invalid booking reference."),
});

function parseBookingPhotoReference(bookingKey: string) {
  const [source, idValue] = bookingKey.split(":");
  const sourceId = Number.parseInt(idValue, 10);
  if (!source || !Number.isSafeInteger(sourceId) || sourceId < 1) throw new Error("Invalid booking reference.");
  return { source, sourceId };
}

export const leadflowJobsRouter = router({
  list: adminAgentProcedure.input(listInput).query(async ({ input }) => {
    const db = await getDb();
    if (!db) throw new Error("DB unavailable");
    const search = input.query?.toLowerCase();
    const rows = await db
      .select()
      .from(leadflowJobs)
      .where(eq(leadflowJobs.jobDate, input.date))
      .orderBy(asc(leadflowJobs.serviceDateTime), asc(leadflowJobs.id));
    return rows.filter((row) => !search || `${row.customerName} ${row.customerPhone ?? ""} ${row.customerEmail ?? ""} ${row.jobAddress ?? ""} ${row.launch27BookingId ?? ""}`.toLowerCase().includes(search));
  }),

  staffPhotos: adminAgentProcedure.input(bookingPhotoReferenceInput).query(async ({ input }) => {
    const db = await getDb();
    if (!db) throw new Error("DB unavailable");
    const { source, sourceId } = parseBookingPhotoReference(input.bookingKey);
    // The Booking detail has one source-agnostic gallery. Existing isolated uploads
    // are keyed to LeadFlow jobs; other booking sources correctly return no photos
    // until their cleaner portal upload path is introduced.
    if (source !== "leadflow") return [];
    return db
      .select({
        id: cleanerPortalJobPhotos.id,
        photoUrl: cleanerPortalJobPhotos.photoUrl,
        thumbnailUrl: cleanerPortalJobPhotos.thumbnailUrl,
        filename: cleanerPortalJobPhotos.filename,
        photoType: cleanerPortalJobPhotos.photoType,
        createdAt: cleanerPortalJobPhotos.createdAt,
      })
      .from(cleanerPortalJobPhotos)
      .where(eq(cleanerPortalJobPhotos.leadflowJobId, sourceId))
      .orderBy(asc(cleanerPortalJobPhotos.createdAt), asc(cleanerPortalJobPhotos.id));
  }),

  staffSignoff: adminAgentProcedure.input(bookingPhotoReferenceInput).query(async ({ input }) => {
    const db = await getDb();
    if (!db) throw new Error("DB unavailable");
    const { source, sourceId } = parseBookingPhotoReference(input.bookingKey);
    if (source !== "leadflow") return null;
    const rows = await db.select({
      signatureUrl: cleanerPortalJobSignoffs.signatureUrl,
      customerResponse: cleanerPortalJobSignoffs.customerResponse,
      customerNotes: cleanerPortalJobSignoffs.customerNotes,
      customerNotHome: cleanerPortalJobSignoffs.customerNotHome,
      signedOffAt: cleanerPortalJobSignoffs.signedOffAt,
    }).from(cleanerPortalJobSignoffs).where(eq(cleanerPortalJobSignoffs.leadflowJobId, sourceId)).limit(1);
    return rows[0] ?? null;
  }),

  staffMessages: adminAgentProcedure.input(bookingPhotoReferenceInput).query(async ({ input }) => {
    const db = await getDb();
    if (!db) throw new Error("DB unavailable");
    const { source, sourceId } = parseBookingPhotoReference(input.bookingKey);
    if (source !== "leadflow") return [];
    return db.select({
      id: leadflowBookingMessages.id,
      senderRole: leadflowBookingMessages.senderRole,
      body: leadflowBookingMessages.body,
      notificationStatus: leadflowBookingMessages.notificationStatus,
      notificationError: leadflowBookingMessages.notificationError,
      createdAt: leadflowBookingMessages.createdAt,
    }).from(leadflowBookingMessages).where(eq(leadflowBookingMessages.leadflowJobId, sourceId)).orderBy(asc(leadflowBookingMessages.createdAt), asc(leadflowBookingMessages.id));
  }),

  importNextThirtyDays: adminAgentProcedure.mutation(async () => {
    const result = await importNextThirtyDaysOfLaunch27Jobs();
    if (result.totals.created + result.totals.updated > 0) broadcastCleanerPortalJobsChanged();
    return result;
  }),

  syncDate: adminAgentProcedure.input(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) })).mutation(async ({ input }) => {
    const result = await importLaunch27JobsForDate(input.date, { markMissing: true });
    if (result.created + result.updated + result.sourceMissing > 0) broadcastCleanerPortalJobsChanged();
    return result;
  }),

  importStatus: adminAgentProcedure.query(async () => {
    const db = await getDb();
    if (!db) throw new Error("DB unavailable");
    const existing = await db.select({ id: leadflowJobs.id }).from(leadflowJobs).where(eq(leadflowJobs.origin, LEADFLOW_JOB_ORIGIN_LAUNCH27)).limit(1);
    return { completed: existing.length > 0 };
  }),

  refreshImportedDetails: adminAgentProcedure.mutation(async () => {
    const result = await refreshImportedLaunch27JobDetails();
    if (result.refreshed > 0) broadcastCleanerPortalJobsChanged();
    return result;
  }),

  cancel: adminAgentProcedure.input(z.object({ jobId: z.number().int().positive() })).mutation(async ({ input }) => {
    const db = await getDb();
    if (!db) throw new Error("DB unavailable");
    const existing = await db.select({ id: leadflowJobs.id, bookingStatus: leadflowJobs.bookingStatus }).from(leadflowJobs).where(eq(leadflowJobs.id, input.jobId)).limit(1);
    const job = existing[0];
    if (!job) throw new Error("LeadFlow job not found.");
    if (job.bookingStatus.toLowerCase() === "cancelled") return { id: job.id, bookingStatus: "cancelled" };
    await db.update(leadflowJobs).set({
      bookingStatus: "cancelled",
      nextOccurrenceCreatedAt: new Date(),
    }).where(eq(leadflowJobs.id, job.id));
    broadcastCleanerPortalJobsChanged();
    return { id: job.id, bookingStatus: "cancelled" };
  }),

  update: adminAgentProcedure.input(updateInput).mutation(async ({ input }) => {
    const db = await getDb();
    if (!db) throw new Error("DB unavailable");
    const existing = await db.select().from(leadflowJobs).where(eq(leadflowJobs.id, input.jobId)).limit(1);
    const job = existing[0];
    if (!job) throw new Error("LeadFlow job not found.");
    const jobDate = input.jobDate ?? job.jobDate;
    if (input.jobDate && jobDate !== job.jobDate) {
      const jobsOnTargetDate = await db.select().from(leadflowJobs).where(eq(leadflowJobs.jobDate, jobDate));
      if (jobsOnTargetDate.some((candidate) => candidate.id !== job.id && isSameLeadflowJobIdentity(job, candidate))) {
        throw new Error("A matching LeadFlow job already exists on that date.");
      }
    }
    await db.update(leadflowJobs).set({
      ...(input.jobDate ? { jobDate, serviceDateTime: moveServiceDateTimeToBusinessDate(job.serviceDateTime, jobDate) } : {}),
      ...(input.frequency ? { frequency: input.frequency } : {}),
    }).where(eq(leadflowJobs.id, job.id));
    broadcastCleanerPortalJobsChanged();
    return { id: job.id, jobDate, frequency: input.frequency ?? job.frequency };
  }),
});
