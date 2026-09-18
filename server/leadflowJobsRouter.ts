import { and, asc, desc, eq, or, sql } from "drizzle-orm";
import { z } from "zod";
import { cleanerPortalJobPhotos, cleanerPortalJobSignoffs, conversationSessions, leadflowBookingMessages, leadflowJobs } from "../drizzle/schema";
import { bookingsAgentProcedure, opsChatProcedure, router } from "./_core/trpc";
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
  customerProfile: opsChatProcedure.input(z.object({ phone: z.string().trim().min(7).max(30) })).query(async ({ input }) => {
    const db = await getDb();
    if (!db) throw new Error("DB unavailable");
    const phone = input.phone.replace(/[^\d]/g, "").slice(-10);
    if (phone.length !== 10) return { name: null, email: null, upcoming: null, history: [], payment: null };

    const rows = await db.select({
      id: leadflowJobs.id,
      jobDate: leadflowJobs.jobDate,
      customerName: leadflowJobs.customerName,
      customerEmail: leadflowJobs.customerEmail,
      serviceName: leadflowJobs.serviceName,
      jobAddress: leadflowJobs.jobAddress,
      bookingStatus: leadflowJobs.bookingStatus,
      teamName: leadflowJobs.teamName,
      jobTotalCents: leadflowJobs.jobTotalCents,
      frequency: leadflowJobs.frequency,
      bedrooms: leadflowJobs.bedrooms,
      bathrooms: leadflowJobs.bathrooms,
      customerNotes: leadflowJobs.customerNotes,
      hasStripeCard: leadflowJobs.hasStripeCard,
      paymentBrand: leadflowJobs.paymentBrand,
      paymentLast4: leadflowJobs.paymentLast4,
    }).from(leadflowJobs)
      .where(sql`RIGHT(REGEXP_REPLACE(${leadflowJobs.customerPhone}, '[^0-9]', ''), 10) = ${phone}`)
      .orderBy(desc(leadflowJobs.jobDate), desc(leadflowJobs.id))
      .limit(50);

    const history = rows.map((row) => ({
      id: row.id,
      date: row.jobDate,
      serviceName: row.serviceName,
      address: row.jobAddress,
      status: row.bookingStatus,
      teamName: row.teamName,
      priceCents: row.jobTotalCents,
      frequency: row.frequency,
      bedrooms: row.bedrooms,
      bathrooms: row.bathrooms,
      notes: row.customerNotes,
      paymentBrand: row.paymentBrand,
      paymentLast4: row.paymentLast4,
      hasStripeCard: Boolean(row.hasStripeCard),
    }));
    const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
    const upcoming = history.filter((record) => record.date >= today && !/cancelled/i.test(record.status)).sort((a, b) => a.date.localeCompare(b.date))[0] ?? null;
    const payment = history.find((record) => record.hasStripeCard || record.paymentBrand || record.paymentLast4) ?? null;

    return {
      name: rows[0]?.customerName ?? null,
      email: rows.find((row) => row.customerEmail)?.customerEmail ?? null,
      upcoming,
      history,
      payment: payment ? { hasStripeCard: payment.hasStripeCard, brand: payment.paymentBrand, last4: payment.paymentLast4 } : null,
    };
  }),

  customerConversationSession: opsChatProcedure.input(z.object({ phone: z.string().trim().min(7).max(30) })).query(async ({ input }) => {
    const db = await getDb();
    if (!db) throw new Error("DB unavailable");
    const phone = input.phone.replace(/[^\d]/g, "").slice(-10);
    if (phone.length !== 10) return { sessionId: null };

    const sessions = await db.select({ sessionId: conversationSessions.id })
      .from(conversationSessions)
      .where(and(
        sql`RIGHT(REGEXP_REPLACE(${conversationSessions.leadPhone}, '[^0-9]', ''), 10) = ${phone}`,
        or(
          eq(conversationSessions.leadSource, "cs-inbound"),
          eq(conversationSessions.leadSource, "cs-inbound-cleaner"),
          eq(conversationSessions.leadSource, "cs_initiated")
        )
      ))
      .orderBy(desc(conversationSessions.updatedAt), desc(conversationSessions.id))
      .limit(1);

    return { sessionId: sessions[0]?.sessionId ?? null };
  }),

  customerDirectory: opsChatProcedure.input(z.object({ query: z.string().trim().max(80).default("") })).query(async ({ input }) => {
    const db = await getDb();
    if (!db) throw new Error("DB unavailable");
    const rows = await db.select({
      customerName: leadflowJobs.customerName,
      customerPhone: leadflowJobs.customerPhone,
      customerEmail: leadflowJobs.customerEmail,
      jobDate: leadflowJobs.jobDate,
      serviceName: leadflowJobs.serviceName,
      jobAddress: leadflowJobs.jobAddress,
      bookingStatus: leadflowJobs.bookingStatus,
      teamName: leadflowJobs.teamName,
      frequency: leadflowJobs.frequency,
    }).from(leadflowJobs)
      .orderBy(desc(leadflowJobs.jobDate), desc(leadflowJobs.id))
      .limit(500);

    const query = input.query.toLowerCase();
    const customers = new Map<string, {
      name: string;
      phone: string;
      email: string | null;
      lastServiceDate: string;
      serviceName: string | null;
      address: string | null;
      status: string;
      teamName: string | null;
      frequency: string | null;
    }>();

    for (const row of rows) {
      const phone = (row.customerPhone ?? "").replace(/[^\d]/g, "").slice(-10);
      if (phone.length !== 10) continue;
      const name = row.customerName?.trim() || "Customer";
      const searchable = `${name} ${phone} ${row.customerEmail ?? ""} ${row.jobAddress ?? ""}`.toLowerCase();
      if (query && !searchable.includes(query)) continue;
      const existing = customers.get(phone);
      if (existing) continue;
      customers.set(phone, {
        name,
        phone,
        email: row.customerEmail,
        lastServiceDate: row.jobDate,
        serviceName: row.serviceName,
        address: row.jobAddress,
        status: row.bookingStatus,
        teamName: row.teamName,
        frequency: row.frequency,
      });
    }

    return { customers: Array.from(customers.values()).slice(0, 80) };
  }),

  list: bookingsAgentProcedure.input(listInput).query(async ({ input }) => {
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

  staffPhotos: bookingsAgentProcedure.input(bookingPhotoReferenceInput).query(async ({ input }) => {
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

  staffSignoff: bookingsAgentProcedure.input(bookingPhotoReferenceInput).query(async ({ input }) => {
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

  staffMessages: bookingsAgentProcedure.input(bookingPhotoReferenceInput).query(async ({ input }) => {
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

  importNextThirtyDays: bookingsAgentProcedure.mutation(async () => {
    const result = await importNextThirtyDaysOfLaunch27Jobs();
    if (result.totals.created + result.totals.updated > 0) broadcastCleanerPortalJobsChanged();
    return result;
  }),

  syncDate: bookingsAgentProcedure.input(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) })).mutation(async ({ input }) => {
    const result = await importLaunch27JobsForDate(input.date, { markMissing: true, mergeExistingDuplicates: true });
    if (result.created + result.updated + result.sourceMissing > 0) broadcastCleanerPortalJobsChanged();
    return result;
  }),

  importStatus: bookingsAgentProcedure.query(async () => {
    const db = await getDb();
    if (!db) throw new Error("DB unavailable");
    const existing = await db.select({ id: leadflowJobs.id }).from(leadflowJobs).where(eq(leadflowJobs.origin, LEADFLOW_JOB_ORIGIN_LAUNCH27)).limit(1);
    return { completed: existing.length > 0 };
  }),

  refreshImportedDetails: bookingsAgentProcedure.mutation(async () => {
    const result = await refreshImportedLaunch27JobDetails();
    if (result.refreshed > 0) broadcastCleanerPortalJobsChanged();
    return result;
  }),

  cancel: bookingsAgentProcedure.input(z.object({ jobId: z.number().int().positive() })).mutation(async ({ input }) => {
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

  update: bookingsAgentProcedure.input(updateInput).mutation(async ({ input }) => {
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
