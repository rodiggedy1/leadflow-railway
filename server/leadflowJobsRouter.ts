import { and, asc, desc, eq, gte, inArray, lte, ne, or, sql } from "drizzle-orm";
import { z } from "zod";
import { activityLog, cleanerPortalJobPhotos, cleanerPortalJobProgress, cleanerPortalJobSignoffs, cleanerProfiles, conversationSessions, jobGeoCache, leadflowBookingMessages, leadflowJobs } from "../drizzle/schema";
import { agentPageProcedure, agentProcedure, bookingsAgentProcedure, opsChatProcedure, router } from "./_core/trpc";
import { getDb } from "./db";
import { importLaunch27JobsForDate, importNextThirtyDaysOfLaunch27Jobs, isSameLeadflowJobIdentity, LEADFLOW_JOB_ORIGIN_LAUNCH27, moveServiceDateTimeToBusinessDate, refreshImportedLaunch27JobDetails } from "./leadflowJobsService";
import { broadcastCleanerPortalJobsChanged } from "./cleanerPortalUpdates";
import { leadflowCallMatrixRouter } from "./leadflowCallMatrixRouter";
import { sendSms } from "./openphone";

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

const dayBoardInput = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

const dayBoardJobIdsInput = z.object({
  leadflowJobIds: z.array(z.number().int().positive()).max(500),
  since: z.number().int().positive().optional(),
});

const dayBoardMessageInput = z.object({
  leadflowJobId: z.number().int().positive(),
  body: z.string().trim().min(1).max(1_600),
});
const smsPhoneInput = z.object({ phone: z.string().trim().min(7).max(30) });
const smsPhonesInput = z.object({ phones: z.array(z.string()).max(100) });
const dayBoardProcedure = agentPageProcedure("field-management");

const DAY_BOARD_STATUS_LABELS: Record<string, string> = {
  on_the_way: "On the Way",
  arrived: "Arrived",
  in_progress: "In Progress",
  completed: "Completed",
};

function dayBoardStatus(bookingStatus: string, progressStatus: string | null) {
  return progressStatus ?? (bookingStatus === "completed" ? "completed" : "assigned");
}

function easternBusinessDate() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

function normalizedPhone(phone: string) {
  return phone.replace(/[^\d]/g, "").slice(-10);
}

function normalizeAddress(address: string): string {
  return address.toLowerCase().replace(/[.,#-]/g, "").replace(/\s+/g, " ").trim();
}

function easternOffsetMs(utcDate: Date): number {
  const et = utcDate.toLocaleString("en-US", {
    timeZone: "America/New_York",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false,
  });
  const [datePart, timePart] = et.split(", ");
  const [month, day, year] = datePart.split("/");
  return new Date(`${year}-${month}-${day}T${timePart}Z`).getTime() - utcDate.getTime();
}

function easternDayBounds(date: string) {
  const startUtc = new Date(`${date}T00:00:00.000Z`);
  const endUtc = new Date(`${date}T23:59:59.999Z`);
  return {
    start: new Date(startUtc.getTime() - easternOffsetMs(startUtc)),
    end: new Date(endUtc.getTime() - easternOffsetMs(endUtc)),
  };
}

function dateBefore(date: string, days: number) {
  const result = new Date(`${date}T12:00:00`);
  result.setDate(result.getDate() - days);
  return result.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

export const leadflowJobsRouter = router({
  callMatrix: leadflowCallMatrixRouter,

  /**
   * All-agent, read-only Operations Dashboard projection. It combines only
   * LeadFlow-owned jobs with existing activity and lead records; it performs
   * no mutation, notification, scheduling, or message-send work.
   */
  dashboardOverview: agentProcedure.input(z.object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  })).query(async ({ input }) => {
    const db = await getDb();
    if (!db) throw new Error("DB unavailable");

    const { start, end } = easternDayBounds(input.date);
    const trendStart = dateBefore(input.date, 29);
    const trendStartBound = easternDayBounds(trendStart).start;
    const nonLeadSourceFilter = sql`(${conversationSessions.leadSource} IS NULL OR ${conversationSessions.leadSource} NOT IN ('cs-inbound','cs-inbound-cleaner','cs_initiated','hiring_interview','review'))`;
    const [todayRows, trendRows, activityRows, sourceRows, newLeadRows, activeSessions] = await Promise.all([
      db.select({
        id: leadflowJobs.id,
        customerName: leadflowJobs.customerName,
        jobAddress: leadflowJobs.jobAddress,
        serviceName: leadflowJobs.serviceName,
        serviceDateTime: leadflowJobs.serviceDateTime,
        bookingStatus: leadflowJobs.bookingStatus,
        teamName: leadflowJobs.teamName,
        jobTotalCents: leadflowJobs.jobTotalCents,
        customerRating: leadflowJobs.customerRating,
        progressStatus: cleanerPortalJobProgress.jobStatus,
      }).from(leadflowJobs)
        .leftJoin(cleanerPortalJobProgress, eq(cleanerPortalJobProgress.leadflowJobId, leadflowJobs.id))
        .where(and(eq(leadflowJobs.jobDate, input.date), ne(leadflowJobs.bookingStatus, "missing_from_launch27")))
        .orderBy(asc(leadflowJobs.serviceDateTime), asc(leadflowJobs.id)),
      db.select({ jobDate: leadflowJobs.jobDate, jobTotalCents: leadflowJobs.jobTotalCents })
        .from(leadflowJobs)
        .where(and(
          gte(leadflowJobs.jobDate, trendStart),
          lte(leadflowJobs.jobDate, input.date),
          ne(leadflowJobs.bookingStatus, "cancelled"),
          ne(leadflowJobs.bookingStatus, "rescheduled"),
          ne(leadflowJobs.bookingStatus, "missing_from_launch27"),
        )),
      db.select({
        id: activityLog.id,
        eventType: activityLog.eventType,
        title: activityLog.title,
        body: activityLog.body,
        createdAt: activityLog.createdAt,
      }).from(activityLog).orderBy(desc(activityLog.createdAt)).limit(5),
      db.select({ source: conversationSessions.utmSource, count: sql<number>`count(*)` })
        .from(conversationSessions)
        .where(and(gte(conversationSessions.createdAt, trendStartBound), lte(conversationSessions.createdAt, end), nonLeadSourceFilter))
        .groupBy(conversationSessions.utmSource),
      db.select({ count: sql<number>`count(*)` })
        .from(conversationSessions)
        .where(and(gte(conversationSessions.createdAt, start), lte(conversationSessions.createdAt, end), nonLeadSourceFilter)),
      db.select({
        messageHistory: conversationSessions.messageHistory,
        respondedAt: conversationSessions.respondedAt,
      }).from(conversationSessions)
        .where(and(
          sql`${conversationSessions.stage} NOT IN ('BOOKED','COMPLETED','CLOSED','LOST','COLD')`,
          nonLeadSourceFilter,
        ))
        .limit(500),
    ]);

    const addressKeys = todayRows.map(row => row.jobAddress ? normalizeAddress(row.jobAddress) : null)
      .filter((value): value is string => Boolean(value));
    const geoRows = addressKeys.length
      ? await db.select({ addressKey: jobGeoCache.addressKey, lat: jobGeoCache.lat, lng: jobGeoCache.lng })
        .from(jobGeoCache).where(inArray(jobGeoCache.addressKey, addressKeys))
      : [];
    const geoByAddress = new Map(geoRows.map(row => [row.addressKey, row]));

    const activeJobs = todayRows.filter(row => row.bookingStatus !== "cancelled" && row.bookingStatus !== "rescheduled").map(row => {
      const jobStatus = row.progressStatus ?? (row.bookingStatus === "completed" ? "completed" : "assigned");
      const geo = row.jobAddress ? geoByAddress.get(normalizeAddress(row.jobAddress)) : null;
      return {
        id: row.id,
        customerName: row.customerName || "Customer",
        address: row.jobAddress,
        serviceName: row.serviceName,
        serviceDateTime: row.serviceDateTime,
        bookingStatus: row.bookingStatus,
        jobStatus,
        teamName: row.teamName,
        jobTotalCents: row.jobTotalCents ?? 0,
        customerRating: row.customerRating,
        latitude: geo?.lat ?? null,
        longitude: geo?.lng ?? null,
      };
    });

    let unrespondedLeads = 0;
    const now = Date.now();
    for (const session of activeSessions) {
      try {
        const history: Array<{ role: string; ts?: number }> = JSON.parse(session.messageHistory ?? "[]");
        const last = history.at(-1);
        if (!last || (last.role !== "user" && last.role !== "customer")) continue;
        if (session.respondedAt && last.ts && last.ts <= session.respondedAt) continue;
        if (last.ts && now - last.ts > 60 * 60 * 1000) unrespondedLeads += 1;
      } catch {
        // Malformed historical message history cannot be classified as unresponded.
      }
    }

    const trendDates = Array.from({ length: 30 }, (_, index) => dateBefore(input.date, 29 - index));
    const trendCents = new Map<string, number>();
    for (const row of trendRows) trendCents.set(row.jobDate, (trendCents.get(row.jobDate) ?? 0) + (row.jobTotalCents ?? 0));
    const serviceCounts = new Map<string, number>();
    for (const job of activeJobs) {
      const service = job.serviceName?.trim() || "Unspecified service";
      serviceCounts.set(service, (serviceCounts.get(service) ?? 0) + 1);
    }

    const completedJobs = activeJobs.filter(job => job.jobStatus === "completed").length;
    const reviewQueue = activeJobs.filter(job => job.jobStatus === "completed" && job.customerRating === null).length;
    const activeTeamNames = new Set(activeJobs
      .filter(job => ["on_the_way", "arrived", "in_progress", "running_late", "wrapping_up"].includes(job.jobStatus))
      .map(job => job.teamName?.trim())
      .filter((name): name is string => Boolean(name)));
    const routeExceptions = activeJobs.filter(job => ["running_late", "issue_at_property", "no_show"].includes(job.jobStatus)).length;

    return {
      date: input.date,
      jobs: activeJobs,
      metrics: {
        jobsToday: activeJobs.length,
        completedJobs,
        remainingJobs: activeJobs.length - completedJobs,
        scheduledValueCents: activeJobs.reduce((total, job) => total + job.jobTotalCents, 0),
        activeTeams: activeTeamNames.size,
        routeExceptions,
        reviewQueue,
        newLeads: Number(newLeadRows[0]?.count ?? 0),
        unrespondedLeads,
      },
      activities: activityRows,
      sources: sourceRows.map(row => ({ source: row.source?.trim() || "Direct", count: Number(row.count) })).sort((a, b) => b.count - a.count),
      revenueTrend: trendDates.map(date => ({ date, totalCents: trendCents.get(date) ?? 0 })),
      serviceMix: Array.from(serviceCounts.entries()).map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count).slice(0, 6),
    };
  }),

  /**
   * Read-only Day Board projection of LeadFlow-owned jobs and explicit Cleaner
   * Portal progress. No status is inferred from time; every non-neutral state
   * is either persisted portal progress or the imported booking completion.
   */
  dayBoard: dayBoardProcedure.input(dayBoardInput).query(async ({ input }) => {
    const db = await getDb();
    if (!db) throw new Error("DB unavailable");

    const jobs = await db.select({
      id: leadflowJobs.id,
      customerName: leadflowJobs.customerName,
      customerPhone: leadflowJobs.customerPhone,
      jobAddress: leadflowJobs.jobAddress,
      serviceDateTime: leadflowJobs.serviceDateTime,
      serviceName: leadflowJobs.serviceName,
      bedrooms: leadflowJobs.bedrooms,
      bathrooms: leadflowJobs.bathrooms,
      bookingStatus: leadflowJobs.bookingStatus,
      teamName: leadflowJobs.teamName,
      updatedAt: leadflowJobs.updatedAt,
      progressStatus: cleanerPortalJobProgress.jobStatus,
      etaTimestamp: cleanerPortalJobProgress.etaTimestamp,
      etaTimeStr: cleanerPortalJobProgress.etaTimeStr,
      progressCreatedAt: cleanerPortalJobProgress.createdAt,
      progressUpdatedAt: cleanerPortalJobProgress.updatedAt,
    }).from(leadflowJobs)
      .leftJoin(cleanerPortalJobProgress, eq(cleanerPortalJobProgress.leadflowJobId, leadflowJobs.id))
      .where(and(
        eq(leadflowJobs.jobDate, input.date),
        ne(leadflowJobs.bookingStatus, "missing_from_launch27"),
      ))
      .orderBy(asc(leadflowJobs.serviceDateTime), asc(leadflowJobs.id));

    if (!jobs.length) return [];

    const jobIds = jobs.map(job => job.id);
    const messages = await db.select({
      id: leadflowBookingMessages.id,
      leadflowJobId: leadflowBookingMessages.leadflowJobId,
      senderRole: leadflowBookingMessages.senderRole,
      body: leadflowBookingMessages.body,
      notificationStatus: leadflowBookingMessages.notificationStatus,
      notificationError: leadflowBookingMessages.notificationError,
      createdAt: leadflowBookingMessages.createdAt,
    }).from(leadflowBookingMessages)
      .where(inArray(leadflowBookingMessages.leadflowJobId, jobIds))
      .orderBy(asc(leadflowBookingMessages.createdAt), asc(leadflowBookingMessages.id));

    const messagesByJob = new Map<number, typeof messages>();
    for (const message of messages) {
      messagesByJob.set(message.leadflowJobId, [...(messagesByJob.get(message.leadflowJobId) ?? []), message]);
    }

    return jobs.map(job => {
      const jobMessages = messagesByJob.get(job.id) ?? [];
      const status = dayBoardStatus(job.bookingStatus, job.progressStatus);
      const timeline = [
        ...(job.progressStatus && job.progressUpdatedAt ? [{
          id: `progress-${job.id}`,
          type: "status_change" as const,
          status: "status_change" as const,
          timestamp: job.progressUpdatedAt,
          label: DAY_BOARD_STATUS_LABELS[status] ?? status,
          detail: job.etaTimeStr ? `ETA ${job.etaTimeStr}` : undefined,
          success: true,
          step: status,
        }] : []),
        ...jobMessages.map(message => ({
          id: `message-${message.id}`,
          type: (message.senderRole === "customer" ? "sms_client" : "sms_cleaner") as "sms_client" | "sms_cleaner",
          status: (message.notificationStatus === "failed" ? "failed" : "sent") as "failed" | "sent",
          timestamp: message.createdAt,
          label: message.senderRole === "customer" ? "Customer Message" : message.senderRole === "cleaner" ? "Cleaner Message" : "Office Message",
          detail: message.body,
          recipient: message.senderRole,
          success: message.notificationStatus !== "failed",
          errorDetail: message.notificationError ?? undefined,
          step: "booking_message",
        })),
      ].sort((first, second) => first.timestamp.getTime() - second.timestamp.getTime());

      const messageCount = jobMessages.length;
      const deliveredCount = jobMessages.filter(message => message.notificationStatus !== "failed").length;
      return {
        id: job.id,
        cleanerName: null,
        teamName: job.teamName,
        customerName: job.customerName,
        customerPhone: job.customerPhone,
        cleanerPhone: null,
        jobAddress: job.jobAddress,
        serviceDateTime: job.serviceDateTime,
        serviceType: job.serviceName,
        bedrooms: job.bedrooms,
        bathrooms: job.bathrooms,
        jobStatus: status,
        delayMinutes: null,
        issueNote: null,
        etaTimestamp: job.etaTimestamp,
        updatedAt: job.progressUpdatedAt ?? job.updatedAt,
        stepsFired: messageCount,
        stepsSuccess: deliveredCount,
        totalSteps: messageCount,
        timeline,
        bookingStatus: job.bookingStatus,
      };
    });
  }),

  dayBoardMessages: dayBoardProcedure.input(z.object({ leadflowJobId: z.number().int().positive() })).query(async ({ input }) => {
    const db = await getDb();
    if (!db) throw new Error("DB unavailable");
    return db.select({
      id: leadflowBookingMessages.id,
      senderRole: leadflowBookingMessages.senderRole,
      body: leadflowBookingMessages.body,
      notificationStatus: leadflowBookingMessages.notificationStatus,
      notificationError: leadflowBookingMessages.notificationError,
      createdAt: leadflowBookingMessages.createdAt,
    }).from(leadflowBookingMessages)
      .where(eq(leadflowBookingMessages.leadflowJobId, input.leadflowJobId))
      .orderBy(asc(leadflowBookingMessages.createdAt), asc(leadflowBookingMessages.id));
  }),

  dayBoardUnreadReplies: dayBoardProcedure.input(dayBoardJobIdsInput).query(async ({ input }) => {
    if (!input.leadflowJobIds.length) return [];
    const db = await getDb();
    if (!db) throw new Error("DB unavailable");
    const since = new Date(input.since ?? Date.now() - 24 * 60 * 60 * 1000);
    const rows = await db.select({
      leadflowJobId: leadflowBookingMessages.leadflowJobId,
      createdAt: leadflowBookingMessages.createdAt,
    }).from(leadflowBookingMessages)
      .where(and(
        inArray(leadflowBookingMessages.leadflowJobId, input.leadflowJobIds),
        eq(leadflowBookingMessages.senderRole, "customer"),
        gte(leadflowBookingMessages.createdAt, since),
      ))
      .orderBy(desc(leadflowBookingMessages.createdAt));

    const latestByJob = new Map<number, number>();
    for (const row of rows) {
      const latest = row.createdAt.getTime();
      if (!latestByJob.has(row.leadflowJobId)) latestByJob.set(row.leadflowJobId, latest);
    }
    return Array.from(latestByJob.entries()).map(([leadflowJobId, latestReplyAt]) => ({ leadflowJobId, latestReplyAt }));
  }),

  sendDayBoardMessage: dayBoardProcedure.input(dayBoardMessageInput).mutation(async ({ input }) => {
    const db = await getDb();
    if (!db) throw new Error("DB unavailable");
    const jobs = await db.select({
      id: leadflowJobs.id,
      customerPhone: leadflowJobs.customerPhone,
    }).from(leadflowJobs).where(and(
      eq(leadflowJobs.id, input.leadflowJobId),
      ne(leadflowJobs.bookingStatus, "cancelled"),
      ne(leadflowJobs.bookingStatus, "rescheduled"),
      ne(leadflowJobs.bookingStatus, "missing_from_launch27"),
    )).limit(1);
    const job = jobs[0];
    if (!job) throw new Error("Booking not found.");
    if (!job.customerPhone) throw new Error("This booking has no customer phone number.");

    const now = new Date();
    const inserted = await db.insert(leadflowBookingMessages).values({
      leadflowJobId: job.id,
      senderRole: "office",
      body: input.body,
      notificationStatus: "pending",
      createdAt: now,
    });
    const messageId = Number(inserted[0].insertId);
    const result = await sendSms({ to: job.customerPhone, content: input.body });
    await db.update(leadflowBookingMessages).set(result.success
      ? { notificationStatus: "sent", notificationMessageId: result.messageId ?? null, notificationError: null, notificationSentAt: new Date() }
      : { notificationStatus: "failed", notificationError: result.error ?? "SMS send failed" },
    ).where(eq(leadflowBookingMessages.id, messageId));

    if (!result.success) throw new Error(result.error ?? "SMS send failed");
    return { success: true, id: messageId };
  }),

  /**
   * Read-only customer context for the SMS workspace. Every booking field is
   * sourced from LeadFlow-owned jobs and explicit portal progress.
   */
  smsCustomerContext: opsChatProcedure.input(smsPhoneInput).query(async ({ input }) => {
    const db = await getDb();
    if (!db) throw new Error("DB unavailable");
    const phone = normalizedPhone(input.phone);
    if (phone.length !== 10) return null;

    const rows = await db.select({
      id: leadflowJobs.id,
      jobDate: leadflowJobs.jobDate,
      customerName: leadflowJobs.customerName,
      customerPhone: leadflowJobs.customerPhone,
      jobAddress: leadflowJobs.jobAddress,
      serviceDateTime: leadflowJobs.serviceDateTime,
      serviceName: leadflowJobs.serviceName,
      bookingStatus: leadflowJobs.bookingStatus,
      teamName: leadflowJobs.teamName,
      frequency: leadflowJobs.frequency,
      bedrooms: leadflowJobs.bedrooms,
      bathrooms: leadflowJobs.bathrooms,
      jobTotalCents: leadflowJobs.jobTotalCents,
      launch27BookingId: leadflowJobs.launch27BookingId,
      progressStatus: cleanerPortalJobProgress.jobStatus,
    }).from(leadflowJobs)
      .leftJoin(cleanerPortalJobProgress, eq(cleanerPortalJobProgress.leadflowJobId, leadflowJobs.id))
      .where(and(
        sql`RIGHT(REGEXP_REPLACE(${leadflowJobs.customerPhone}, '[^0-9]', ''), 10) = ${phone}`,
        ne(leadflowJobs.bookingStatus, "missing_from_launch27"),
      ))
      .orderBy(desc(leadflowJobs.jobDate), desc(leadflowJobs.serviceDateTime), desc(leadflowJobs.id))
      .limit(50);

    const today = easternBusinessDate();
    const todayRow = rows.find(row => row.jobDate === today) ?? null;
    const recentJobs = rows.slice(0, 6).map(row => ({
      date: row.jobDate,
      address: row.jobAddress,
      serviceType: row.serviceName,
      status: row.progressStatus ?? row.bookingStatus ?? "scheduled",
      price: row.jobTotalCents ? Math.round(row.jobTotalCents / 100) : null,
      source: "leadflow" as const,
      bookingId: row.launch27BookingId ? String(row.launch27BookingId) : null,
    }));
    const averagePrice = rows.length
      ? Math.round(rows.reduce((total, row) => total + (row.jobTotalCents ?? 0), 0) / rows.length / 100)
      : null;

    return {
      name: rows[0]?.customerName ?? null,
      phone: `+1${phone}`,
      address: rows[0]?.jobAddress ?? null,
      frequency: rows[0]?.frequency ?? null,
      totalBookings: rows.length,
      firstBookingDate: rows.length ? rows[rows.length - 1].jobDate : null,
      lastBookingDate: rows[0]?.jobDate ?? null,
      avgPrice: averagePrice,
      todayJob: todayRow ? {
        id: todayRow.id,
        customerName: todayRow.customerName,
        jobAddress: todayRow.jobAddress,
        serviceDateTime: todayRow.serviceDateTime,
        jobDate: todayRow.jobDate,
        serviceType: todayRow.serviceName,
        jobStatus: todayRow.progressStatus,
        bookingStatus: todayRow.bookingStatus,
        issueNote: null,
        delayMinutes: null,
        teamName: todayRow.teamName,
        bookingId: todayRow.launch27BookingId,
        bedrooms: todayRow.bedrooms,
        bathrooms: todayRow.bathrooms,
      } : null,
      recentJobs,
    };
  }),

  /** Read-only owned-job schedule for the selected SMS team conversation. */
  smsTeamTodayJobs: opsChatProcedure.input(z.object({ cleanerProfileId: z.number().int().positive() })).query(async ({ input }) => {
    const db = await getDb();
    if (!db) throw new Error("DB unavailable");
    const profiles = await db.select({ launch27TeamId: cleanerProfiles.launch27TeamId })
      .from(cleanerProfiles)
      .where(and(eq(cleanerProfiles.id, input.cleanerProfileId), eq(cleanerProfiles.isActive, 1)))
      .limit(1);
    const teamId = profiles[0]?.launch27TeamId;
    if (!teamId) return [];

    const jobs = await db.select({
      id: leadflowJobs.id,
      jobDate: leadflowJobs.jobDate,
      serviceDateTime: leadflowJobs.serviceDateTime,
      customerName: leadflowJobs.customerName,
      jobAddress: leadflowJobs.jobAddress,
      serviceType: leadflowJobs.serviceName,
      bookingStatus: leadflowJobs.bookingStatus,
      bedrooms: leadflowJobs.bedrooms,
      bathrooms: leadflowJobs.bathrooms,
      customerNotes: leadflowJobs.customerNotes,
      customerPhone: leadflowJobs.customerPhone,
      bookingId: leadflowJobs.launch27BookingId,
      jobStatus: cleanerPortalJobProgress.jobStatus,
    }).from(leadflowJobs)
      .leftJoin(cleanerPortalJobProgress, eq(cleanerPortalJobProgress.leadflowJobId, leadflowJobs.id))
      .where(and(
        eq(leadflowJobs.teamId, teamId),
        eq(leadflowJobs.jobDate, easternBusinessDate()),
        ne(leadflowJobs.bookingStatus, "missing_from_launch27"),
      ))
      .orderBy(asc(leadflowJobs.serviceDateTime), asc(leadflowJobs.id));

    return jobs.map(job => ({
      ...job,
      staffNotes: null,
      adminNotes: null,
      checklistItems: null,
      issueNote: null,
      delayMinutes: null,
    }));
  }),

  /** Read-only name resolution for SMS cards from profiles and LeadFlow-owned jobs. */
  smsResolveNames: opsChatProcedure.input(smsPhonesInput).query(async ({ input }) => {
    const db = await getDb();
    if (!db) throw new Error("DB unavailable");
    const phones = Array.from(new Set(input.phones.map(normalizedPhone).filter(phone => phone.length === 10)));
    if (!phones.length) return {} as Record<string, string>;

    const result: Record<string, string> = {};
    const profiles = await db.select({ phone: cleanerProfiles.phone, name: cleanerProfiles.name })
      .from(cleanerProfiles)
      .where(inArray(sql`RIGHT(REGEXP_REPLACE(${cleanerProfiles.phone}, '[^0-9]', ''), 10)`, phones));
    for (const profile of profiles) {
      const phone = normalizedPhone(profile.phone ?? "");
      if (phone && profile.name) result[phone] = profile.name;
    }

    const jobRows = await db.select({ customerPhone: leadflowJobs.customerPhone, customerName: leadflowJobs.customerName })
      .from(leadflowJobs)
      .where(and(
        inArray(sql`RIGHT(REGEXP_REPLACE(${leadflowJobs.customerPhone}, '[^0-9]', ''), 10)`, phones),
        ne(leadflowJobs.bookingStatus, "missing_from_launch27"),
      ))
      .orderBy(desc(leadflowJobs.jobDate), desc(leadflowJobs.serviceDateTime), desc(leadflowJobs.id));
    for (const job of jobRows) {
      const phone = normalizedPhone(job.customerPhone ?? "");
      if (phone && job.customerName && !result[phone]) result[phone] = job.customerName;
    }
    return result;
  }),

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
