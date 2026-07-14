/**
 * reviewRouter.ts
 * Post-cleaning review request flow:
 *  - Upload completed jobs CSV (same format as bookings CSV)
 *  - Send feedback SMS 24h after job date
 *  - Handle positive/negative/review-confirmed replies
 *  - Auto-create reactivation contact when customer confirms they left a review
 */
import { z } from "zod";
import { normalizePhoneLegacy as normalizePhone } from "./utils/phone";
import { and, desc, eq, gte, isNull, lt, ne, sql, count } from "drizzle-orm";
import { router, agentProcedure } from "./_core/trpc";
import { TRPCError } from "@trpc/server";
import { getDb } from "./db";
import {
  completedJobBatches,
  completedJobs,
  conversationSessions,
  reactivationContacts,
  reactivationCampaigns,
  opsChatMessages,
  cleanerJobs,
} from "../drizzle/schema";
import { sendSms } from "./openphone";
import { ENV } from "./_core/env";
import { notifyOwner } from "./_core/notification";
import { getTemplate } from "./messageTemplateRouter";

// ─── Constants ────────────────────────────────────────────────────────────────
export const GOOGLE_REVIEW_URL = "https://share.google/Tm468dywmXkUnBQBL";

/** Feedback SMS sent 24h after cleaning — no link yet, just asking how it went */
export const REVIEW_INITIAL_MESSAGE = (firstName: string) =>
  `Hi ${firstName}! 🏠 How did your cleaning go today? We'd love to hear your feedback — just reply and let us know!`;

/** Sent after a positive reply — Google link + 10% off incentive */
export const REVIEW_POSITIVE_RESPONSE = (firstName: string) =>
  `That's wonderful to hear, ${firstName}! 🎉 Since you're happy with the clean, we'd love if you could leave us a quick Google review — it really helps our small business grow. As a thank-you, we'll give you 10% off your next booking. Here's the link: ${GOOGLE_REVIEW_URL} — once you've left a review, just reply and we'll apply your discount right away!`;

/** Sent after a negative reply — empathetic, routes to manual */
export const REVIEW_NEGATIVE_RESPONSE = (firstName: string) =>
  `We're so sorry to hear that, ${firstName} — that's not the experience we want for you. A member of our team will reach out shortly to make it right. 💛`;

/** Sent after customer confirms they left a review */
export const REVIEW_CONFIRMED_RESPONSE = (firstName: string) =>
  `Thank you so much, ${firstName}! 🌟 Your 10% discount is saved for your next booking — just mention it when you're ready to schedule and we'll take care of you. See you next time!`;

// ─── CSV parsing ──────────────────────────────────────────────────────────────
export interface ParsedCompletedJob {
  phone: string;
  phoneRaw: string;
  name: string;
  firstName: string;
  jobDate: string; // YYYY-MM-DD
  serviceType: string;
}

/**
 * Parse a completed jobs CSV string and return one entry per unique phone number
 * (most recent job date if a customer appears multiple times).
 */
export function parseCompletedJobsCsv(csvText: string): ParsedCompletedJob[] {
  const lines = csvText.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];

  // Parse header
  const headers = lines[0]!.split(",").map((h) => h.trim().replace(/^"|"$/g, ""));

  const customers = new Map<string, ParsedCompletedJob>();

  for (let i = 1; i < lines.length; i++) {
    const values = lines[i]!.split(",").map((v) => v.trim().replace(/^"|"$/g, ""));
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => { row[h] = values[idx] ?? ""; });

    const phoneRaw = row["Phone"] ?? "";
    if (!phoneRaw) continue;

    const phone = normalizePhone(phoneRaw);
    if (phone.length < 10) continue;

    const dateStr = row["Date"] ?? "";
    let date: Date;
    try {
      date = new Date(dateStr);
      if (isNaN(date.getTime())) continue;
    } catch {
      continue;
    }

    const firstName = (row["First Name"] ?? "").trim();
    const lastName = (row["Last Name"] ?? "").trim();
    const fullName = (row["Full Name"] ?? `${firstName} ${lastName}`).trim() || firstName;
    const derivedFirst = firstName || fullName.split(" ")[0] || fullName;
    const frequency = row["Frequency"] ?? "";
    const serviceType = frequency.toLowerCase().includes("deep") ? "Deep Cleaning" : "Standard Cleaning";
    const jobDate = date.toISOString().split("T")[0]!;

    const existing = customers.get(phone);
    if (!existing || jobDate > existing.jobDate) {
      customers.set(phone, { phone, phoneRaw, name: fullName, firstName: derivedFirst, jobDate, serviceType });
    }
  }

  return Array.from(customers.values());
}

// ─── Send pending review SMS ──────────────────────────────────────────────────
/**
 * Finds completed jobs that are PENDING and whose jobDate was yesterday or earlier
 * (i.e., the day after the service has arrived), sends the initial feedback SMS,
 * and marks them as SENT.
 *
 * Designed to be called at 10 AM ET daily — customers receive their review request
 * the morning after their cleaning, not the evening of.
 *
 * Returns the number of SMS sent.
 */
export async function sendPendingReviewSms(): Promise<number> {
  const db = await getDb();
  if (!db) return 0;

  // Compute "yesterday" in ET so the cron running at 10 AM ET always targets
  // jobs from the previous calendar day in Eastern Time.
  const etNow = new Date(
    new Date().toLocaleString("en-US", { timeZone: "America/New_York" })
  );
  etNow.setDate(etNow.getDate() - 1);
  const yyyy = etNow.getFullYear();
  const mm = String(etNow.getMonth() + 1).padStart(2, "0");
  const dd = String(etNow.getDate()).padStart(2, "0");
  const yesterday = `${yyyy}-${mm}-${dd}`;

  // Lookback window: only send to jobs within the last 7 days.
  // This prevents old test/placeholder data (e.g. 2020-01-02) from being picked up.
  const lookbackDate = new Date(
    new Date().toLocaleString("en-US", { timeZone: "America/New_York" })
  );
  lookbackDate.setDate(lookbackDate.getDate() - 7);
  const lookback = `${lookbackDate.getFullYear()}-${String(lookbackDate.getMonth() + 1).padStart(2, "0")}-${String(lookbackDate.getDate()).padStart(2, "0")}`;

  // Select PENDING jobs whose jobDate is between 7 days ago and yesterday (inclusive).
  // Lower bound prevents old test data from being sent; upper bound ensures we only
  // send the day AFTER the cleaning (not same-day).
  const pending = await db
    .select()
    .from(completedJobs)
    .where(
      and(
        eq(completedJobs.status, "PENDING"),
        isNull(completedJobs.smsSentAt),
        ne(completedJobs.phoneInvalid, 1),
        sql`${completedJobs.jobDate} <= ${yesterday}`,
        sql`${completedJobs.jobDate} >= ${lookback}`
      )
    )
    .limit(50);

  let sent = 0;
  for (const job of pending) {
    const firstName = job.firstName ?? job.name?.split(" ")[0] ?? "there";
    const message = await getTemplate("review_initial", {
      "[Name]": firstName,
      "[FirstName]": firstName,
    });

    // Create a conversation session for this review flow
    const [sessionInsert] = await db
      .insert(conversationSessions)
      .values({
        leadPhone: job.phone,
        leadName: job.name ?? firstName,
        stage: "REVIEW_REQUESTED",
        leadSource: "review",
        messageHistory: JSON.stringify([{ role: "assistant", content: message, ts: Date.now(), phoneNumberId: ENV.openPhoneCsNumberId }]),
      });

    const sessionId = (sessionInsert as any).insertId as number;

    // Send the SMS
    const smsResult = await sendSms({ to: job.phone, content: message, fromNumberId: ENV.openPhoneCsNumberId });

    if (smsResult.success) {
      await db
        .update(completedJobs)
        .set({ status: "SENT", smsSentAt: new Date(), sessionId })
        .where(eq(completedJobs.id, job.id));

      await db
        .update(completedJobBatches)
        .set({ sentCount: sql`${completedJobBatches.sentCount} + 1` })
        .where(eq(completedJobBatches.id, job.batchId));

      sent++;
    } else {
      console.error(`[ReviewRouter] Failed to send review SMS to ${job.phone}:`, smsResult.error);
    }
  }

  return sent;
}

// ─── Classify review reply ────────────────────────────────────────────────────
export function classifyReviewReply(
  text: string
): "positive" | "negative" | "review_confirmed" | "opt_out" | "unclear" {
  const lower = text.trim().toLowerCase();

  if (/^\s*(stop|unsubscribe|cancel|quit|end|remove me|opt.?out)\s*$/i.test(lower)) {
    return "opt_out";
  }

  // Review confirmed — they're saying they left the review
  if (
    /\b(left|posted|done|submitted|wrote|just did|just left|just posted|reviewed|review done|did it|completed)\b/i.test(
      lower
    )
  ) {
    return "review_confirmed";
  }

  // Negative sentiment — check BEFORE positive to catch "not happy", "not good", etc.
  if (
    /\b(bad|terrible|awful|horrible|disappointed|unhappy|not happy|not good|not clean|missed|issue|problem|complaint|poor|worst|dirty|mess|wrong|upset|frustrated|not satisfied|not great|could be better)\b/i.test(
      lower
    )
  ) {
    return "negative";
  }

  // Positive sentiment
  if (
    /\b(great|amazing|excellent|wonderful|fantastic|loved|perfect|awesome|good|happy|satisfied|clean|spotless|beautiful|best|5 star|five star|love it|loved it|so good|very good|well done|thank|thanks)\b/i.test(
      lower
    )
  ) {
    return "positive";
  }

  // Short positive-leaning replies
  if (/^(good|great|ok|okay|fine|nice|yes|yep|yeah|sure|👍|🌟|⭐|❤️|😊|😍|🙌|🎉)$/i.test(lower)) {
    return "positive";
  }

  return "unclear";
}

// ─── Handle review reply ──────────────────────────────────────────────────────
export async function handleReviewReplyForJob(
  sessionId: number,
  fromPhone: string,
  reply: string
): Promise<{ responseText: string; newStage: string; switchToManual: boolean }> {
  const db = await getDb();
  if (!db) return { responseText: "Sorry, something went wrong. Please try again later.", newStage: "REVIEW_REQUESTED", switchToManual: false };
  const sentiment = classifyReviewReply(reply);

  const [job] = await db
    .select()
    .from(completedJobs)
    .where(eq(completedJobs.sessionId, sessionId))
    .limit(1);

  const firstName = job?.firstName ?? job?.name?.split(" ")[0] ?? "there";

  if (sentiment === "opt_out") {
    if (job) {
      await db.update(completedJobs).set({ status: "OPTED_OUT" }).where(eq(completedJobs.id, job.id));
    }
    return {
      responseText: `You've been unsubscribed and won't receive further messages from us. Have a great day! 🏠`,
      newStage: "RESOLVED",
      switchToManual: false,
    };
  }

  if (sentiment === "negative") {
    if (job) {
      await db
        .update(completedJobs)
        .set({ status: "REPLIED_NEGATIVE", repliedAt: new Date() })
        .where(eq(completedJobs.id, job.id));
      await db
        .update(completedJobBatches)
        .set({ negativeCount: sql`${completedJobBatches.negativeCount} + 1` })
        .where(eq(completedJobBatches.id, job.batchId));
    }
    notifyOwner({
      title: "⚠️ Unhappy Customer — Review Flow",
      content: `${job?.name ?? fromPhone} replied negatively to the post-cleaning review SMS. Switch to manual mode and follow up personally.`,
    }).catch(() => {});
    const negativeReply = await getTemplate("review_negative_response", { "[Name]": firstName });
    return {
      responseText: negativeReply,
      newStage: "REVIEW_DONE",
      switchToManual: true,
    };
  }

  if (sentiment === "review_confirmed") {
    if (job) {
      await db
        .update(completedJobs)
        .set({ status: "REVIEW_CONFIRMED", repliedAt: new Date() })
        .where(eq(completedJobs.id, job.id));
      await db
        .update(completedJobBatches)
        .set({ reviewConfirmedCount: sql`${completedJobBatches.reviewConfirmedCount} + 1` })
        .where(eq(completedJobBatches.id, job.batchId));

      // Create a reactivation contact with 10% off for their next booking
      let campaignId: number | null = null;
      const [existingCampaign] = await db
        .select()
        .from(reactivationCampaigns)
        .where(eq(reactivationCampaigns.name, "Review Rewards — Auto"))
        .limit(1);

      if (existingCampaign) {
        campaignId = existingCampaign.id;
        await db
          .update(reactivationCampaigns)
          .set({ totalContacts: sql`${reactivationCampaigns.totalContacts} + 1` })
          .where(eq(reactivationCampaigns.id, campaignId));
      } else {
        const [newCampaign] = await db.insert(reactivationCampaigns).values({
          name: "Review Rewards — Auto",
          messageTemplate:
            "Hi [Name]! Ready to keep that fresh-clean feeling going? Reply YES and we'll get your next clean scheduled with your 10% returning customer discount.",
          segment: "all",
          status: "ACTIVE",
          totalContacts: 1,
        });
        campaignId = (newCampaign as any).insertId as number;
      }

      if (campaignId) {
        await db.insert(reactivationContacts).values({
          campaignId,
          phone: fromPhone,
          name: job.name ?? firstName,
          firstName,
          discountPct: 10,
          status: "PENDING",
        });
      }
    }

    // ── Post review confirmation to MIB Command Chat ────────────────────────────
    try {
      // Look up the cleaner/team and star rating for this job via cleanerJobs.
      // First try by completedJobId; fall back to customer name + job date if not linked.
      let teamDisplay = "";
      let ratingDisplay = "";
      if (job) {
        let cj: { cleanerName: string | null; teamName: string | null; customerRating: number | null } | undefined;

        // Primary: join by completedJobId
        if (job.id) {
          const rows = await db
            .select({ cleanerName: cleanerJobs.cleanerName, teamName: cleanerJobs.teamName, customerRating: cleanerJobs.customerRating })
            .from(cleanerJobs)
            .where(eq(cleanerJobs.completedJobId, job.id))
            .limit(1);
          cj = rows[0];
        }

        // Fallback: match by customer name + job date (handles cases where completedJobId is 0)
        if (!cj && job.name && job.jobDate) {
          const rows = await db
            .select({ cleanerName: cleanerJobs.cleanerName, teamName: cleanerJobs.teamName, customerRating: cleanerJobs.customerRating })
            .from(cleanerJobs)
            .where(and(eq(cleanerJobs.customerName, job.name), eq(cleanerJobs.jobDate, job.jobDate)))
            .orderBy(desc(cleanerJobs.id))
            .limit(1);
          cj = rows[0];
        }

        if (cj) {
          teamDisplay = cj.teamName ? ` · ${cj.teamName}` : cj.cleanerName ? ` · ${cj.cleanerName}` : "";
          if (cj.customerRating !== null && cj.customerRating !== undefined) {
            ratingDisplay = ` · ${"⭐".repeat(cj.customerRating)} ${cj.customerRating}/5`;
          }
        }
      }
      const clientDisplay = job?.name ?? firstName;
      const bodyLines = [
        `⭐ **Review Received** — ${clientDisplay}${teamDisplay}${ratingDisplay}`,
        job?.jobDate ? `📅 Job date: ${job.jobDate}` : null,
      ].filter(Boolean).join("\n");
      await db.insert(opsChatMessages).values({
        cleanerJobId: null,
        channel: "command",
        authorName: "⭐ Review Received",
        authorRole: "office",
        body: bodyLines,
        mediaUrl: null,
        quickAction: "review_confirmed",
      });
    } catch (err) {
      console.error("[ReviewRouter] Failed to post review confirmation to command channel:", err);
    }

    const confirmedReply = await getTemplate("review_confirmed_response", { "[Name]": firstName });
    return {
      responseText: confirmedReply,
      newStage: "REVIEW_DONE",
      switchToManual: false,
    };
  }

  if (sentiment === "positive") {
    if (job) {
      await db
        .update(completedJobs)
        .set({ status: "REPLIED_POSITIVE", repliedAt: new Date() })
        .where(eq(completedJobs.id, job.id));
      await db
        .update(completedJobBatches)
        .set({ positiveCount: sql`${completedJobBatches.positiveCount} + 1` })
        .where(eq(completedJobBatches.id, job.batchId));
    }
    const positiveReply = await getTemplate("review_positive_response", {
      "[Name]": firstName,
      "[GoogleReviewUrl]": GOOGLE_REVIEW_URL,
    });
    return {
      responseText: positiveReply,
      newStage: "REVIEW_REQUESTED", // stay waiting for review confirmation
      switchToManual: false,
    };
  }

  // Unclear — gentle nudge
  return {
    responseText: `Hi ${firstName}! Thanks for getting back to us. 😊 We'd love to hear more — how did the cleaning go overall?`,
    newStage: "REVIEW_REQUESTED",
    switchToManual: false,
  };
}

// ─── tRPC Router ──────────────────────────────────────────────────────────────
export const reviewRouter = router({
  /** Upload a completed jobs CSV and create a batch */
  upload: agentProcedure
    .input(
      z.object({
        csvText: z.string().min(1),
        filename: z.string().default("completed_jobs.csv"),
        jobDate: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) return { success: false, error: "DB unavailable", batchId: null, count: 0 };
      const jobs = parseCompletedJobsCsv(input.csvText);

      if (jobs.length === 0) {
        return { success: false, error: "No valid contacts found in CSV", batchId: null, count: 0 };
      }

      const jobDate = input.jobDate ?? new Date().toISOString().split("T")[0]!;

      const [batchInsert] = await db.insert(completedJobBatches).values({
        filename: input.filename,
        jobDate,
        totalCount: jobs.length,
      });
      const batchId = (batchInsert as any).insertId as number;

      await db.insert(completedJobs).values(
        jobs.map((j) => ({
          batchId,
          phone: j.phone,
          name: j.name,
          firstName: j.firstName,
          serviceType: j.serviceType,
          jobDate: j.jobDate,
          status: "PENDING" as const,
        }))
      );

      return { success: true, batchId, count: jobs.length, error: null };
    }),

  /** List all batches with stats */
  listBatches: agentProcedure.query(async () => {
    const db = await getDb();
    if (!db) return [];
    return db
      .select()
      .from(completedJobBatches)
      .orderBy(desc(completedJobBatches.uploadedAt))
      .limit(50);
  }),

  /** Get contacts for a specific batch */
  getBatchContacts: agentProcedure
    .input(z.object({ batchId: z.number() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];
      return db
        .select()
        .from(completedJobs)
        .where(eq(completedJobs.batchId, input.batchId))
        .orderBy(desc(completedJobs.createdAt));
    }),

  /** Manually trigger sending pending review SMS */
  sendPendingNow: agentProcedure.mutation(async () => {
    const sent = await sendPendingReviewSms();
    return { sent };
  }),

  /**
   * analytics — Customer happiness metrics for the Reviews Analytics tab.
   * Accepts a date range (days back from today) and returns:
   *  - happinessRate: % of replied customers who were positive/confirmed
   *  - smsSent, responseRate, googleReviews, unhappyCount
   *  - trend: weekly happiness rate over the period
   *  - sentimentBreakdown: counts per status
   *  - serviceTypeBreakdown: happiness rate per service type
   */
  analytics: agentProcedure
    .input(z.object({
      daysBack: z.number().int().min(1).max(365).default(30),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return null;

      const since = new Date();
      since.setDate(since.getDate() - input.daysBack);
      const sinceStr = since.toISOString().split("T")[0]!;

      // ── All jobs in range ────────────────────────────────────────────────
      const jobs = await db
        .select({
          status: completedJobs.status,
          serviceType: completedJobs.serviceType,
          jobDate: completedJobs.jobDate,
        })
        .from(completedJobs)
        .where(
          and(
            sql`${completedJobs.jobDate} >= ${sinceStr}`,
            sql`${completedJobs.status} != 'PENDING'`,
            sql`${completedJobs.status} != 'OPTED_OUT'`,
          )
        );

      // ── Aggregate totals ─────────────────────────────────────────────────
      const smsSent = jobs.length;
      const replied = jobs.filter(j =>
        ["REPLIED_POSITIVE", "REPLIED_NEGATIVE", "REVIEW_CONFIRMED"].includes(j.status)
      ).length;
      const positive = jobs.filter(j =>
        ["REPLIED_POSITIVE", "REVIEW_CONFIRMED"].includes(j.status)
      ).length;
      const googleReviews = jobs.filter(j => j.status === "REVIEW_CONFIRMED").length;
      const unhappy = jobs.filter(j => j.status === "REPLIED_NEGATIVE").length;
      const noReply = jobs.filter(j => j.status === "SENT").length;

      const responseRate = smsSent > 0 ? Math.round((replied / smsSent) * 100) : 0;
      const happinessRate = replied > 0 ? Math.round((positive / replied) * 100) : 0;

      // ── Sentiment breakdown ──────────────────────────────────────────────
      const sentimentBreakdown = [
        { label: "Positive", count: jobs.filter(j => j.status === "REPLIED_POSITIVE").length, color: "#22c55e" },
        { label: "Review Confirmed", count: googleReviews, color: "#f59e0b" },
        { label: "Negative", count: unhappy, color: "#ef4444" },
        { label: "No Reply", count: noReply, color: "#94a3b8" },
      ];

      // ── Service type breakdown ───────────────────────────────────────────
      const serviceMap = new Map<string, { positive: number; replied: number }>();
      for (const j of jobs) {
        const svc = j.serviceType ?? "Unknown";
        const entry = serviceMap.get(svc) ?? { positive: 0, replied: 0 };
        if (["REPLIED_POSITIVE", "REVIEW_CONFIRMED"].includes(j.status)) entry.positive++;
        if (["REPLIED_POSITIVE", "REPLIED_NEGATIVE", "REVIEW_CONFIRMED"].includes(j.status)) entry.replied++;
        serviceMap.set(svc, entry);
      }
      const serviceTypeBreakdown = Array.from(serviceMap.entries())
        .map(([serviceType, s]) => ({
          serviceType,
          happinessRate: s.replied > 0 ? Math.round((s.positive / s.replied) * 100) : 0,
          replied: s.replied,
        }))
        .sort((a, b) => b.replied - a.replied);

      // ── Weekly trend ─────────────────────────────────────────────────────
      // Group jobs by ISO week (YYYY-WW) and compute happiness rate per week
      const weekMap = new Map<string, { positive: number; replied: number; label: string }>();
      for (const j of jobs) {
        if (!j.jobDate) continue;
        const d = new Date(j.jobDate + "T12:00:00Z");
        const weekStart = new Date(d);
        weekStart.setUTCDate(d.getUTCDate() - d.getUTCDay()); // Sunday
        const weekKey = weekStart.toISOString().split("T")[0]!;
        const label = weekStart.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
        const entry = weekMap.get(weekKey) ?? { positive: 0, replied: 0, label };
        if (["REPLIED_POSITIVE", "REVIEW_CONFIRMED"].includes(j.status)) entry.positive++;
        if (["REPLIED_POSITIVE", "REPLIED_NEGATIVE", "REVIEW_CONFIRMED"].includes(j.status)) entry.replied++;
        weekMap.set(weekKey, entry);
      }
      const trend = Array.from(weekMap.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([week, w]) => ({
          week,
          label: w.label,
          happinessRate: w.replied > 0 ? Math.round((w.positive / w.replied) * 100) : 0,
          replied: w.replied,
        }));

      return {
        happinessRate,
        smsSent,
        responseRate,
        googleReviews,
        unhappyCount: unhappy,
        repliedCount: replied,
        sentimentBreakdown,
        serviceTypeBreakdown,
        trend,
        daysBack: input.daysBack,
      };
    }),

  /**
   * conversations — list all review conversation sessions for the Reviews tab.
   * These are sessions with leadSource = 'review', sorted by most recent first.
   */
  conversations: agentProcedure.query(async () => {
    const db = await getDb();
    if (!db) return [];

    const sessions = await db
      .select({
        id: conversationSessions.id,
        leadPhone: conversationSessions.leadPhone,
        leadName: conversationSessions.leadName,
        stage: conversationSessions.stage,
        messageHistory: conversationSessions.messageHistory,
        createdAt: conversationSessions.createdAt,
        updatedAt: conversationSessions.updatedAt,
        aiMode: conversationSessions.aiMode,
        leadSource: conversationSessions.leadSource,
        jobStatus: completedJobs.status,
      })
      .from(conversationSessions)
      .leftJoin(completedJobs, eq(completedJobs.sessionId, conversationSessions.id))
      .where(
        sql`${conversationSessions.leadSource} IN ('review', 'review-test')`
      )
      .orderBy(desc(conversationSessions.createdAt))
      .limit(200);

    return sessions.map((s) => {
      // Extract last customer reply from message history
      let lastCustomerReply: string | null = null;
      let lastReplyAt: number | null = null;
      try {
        const history = JSON.parse(s.messageHistory ?? "[]") as Array<{ role: string; content: string; ts?: number }>;
        const customerMsgs = history.filter((m) => m.role === "user");
        if (customerMsgs.length > 0) {
          const last = customerMsgs[customerMsgs.length - 1];
          lastCustomerReply = last.content;
          lastReplyAt = last.ts ?? null;
        }
      } catch {}

      // Derive sentiment from completed_jobs.status (source of truth)
      // REVIEW_CONFIRMED = customer left a Google review → counts as "confirmed" (most positive outcome)
      // REPLIED_POSITIVE = customer was happy but hasn't confirmed review yet → counts as "positive"
      // Both are happy customers — confirmed is a superset of positive
      const sentiment =
        s.jobStatus === "REVIEW_CONFIRMED" ? "confirmed" :
        s.jobStatus === "REPLIED_POSITIVE" ? "positive" :
        s.jobStatus === "REPLIED_NEGATIVE" ? "negative" :
        s.jobStatus === "SENT" ? "pending" :
        // Fallback: no job row
        s.stage === "REVIEW_DONE" && s.aiMode === 0 ? "negative" :
        "pending";

      // Parse full message history for the thread view
      let messages: Array<{ role: string; content: string; ts: number }> = [];
      try {
        const raw = JSON.parse(s.messageHistory ?? "[]") as Array<{ role: string; content: string; ts?: number }>;
        messages = raw
          .filter(m => m.content && m.content.trim() !== "")
          .map((m, i) => ({ role: m.role, content: m.content, ts: m.ts ?? Date.now() + i }));
      } catch {}

      const replyCount = messages.filter(m => m.role === "user").length;

      return {
        id: s.id,
        leadPhone: s.leadPhone,
        leadName: s.leadName ?? "Unknown",
        stage: s.stage,
        sentiment,
        lastCustomerReply,
        lastReplyAt,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
        isTest: s.leadSource === "review-test",
        messages,
        replyCount,
      };
    });
  }),

  /**
   * pendingApproval — returns jobs eligible for today's review send (yesterday's jobs,
   * not skipped, not yet sent). Used to show the approval card before sending.
   */
  pendingApproval: agentProcedure.query(async () => {
    const db = await getDb();
    if (!db) return { count: 0, jobs: [] };

    // Yesterday in ET
    const etNow = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
    etNow.setDate(etNow.getDate() - 1);
    const yesterday = `${etNow.getFullYear()}-${String(etNow.getMonth() + 1).padStart(2, "0")}-${String(etNow.getDate()).padStart(2, "0")}`;

    const jobs = await db
      .select({
        id: completedJobs.id,
        name: completedJobs.name,
        firstName: completedJobs.firstName,
        phone: completedJobs.phone,
        serviceType: completedJobs.serviceType,
        jobDate: completedJobs.jobDate,
      })
      .from(completedJobs)
      .where(
        and(
          eq(completedJobs.status, "PENDING"),
          isNull(completedJobs.smsSentAt),
          eq(completedJobs.reviewSkipped, 0),
          sql`${completedJobs.jobDate} = ${yesterday}`
        )
      )
      .limit(100);

    return { count: jobs.length, jobs, date: yesterday };
  }),

  /**
   * approveDailyBatch — admin manually approves and sends today's review SMS batch.
   * Only sends to yesterday's jobs that are PENDING, not skipped, not yet sent.
   */
  approveDailyBatch: agentProcedure.mutation(async () => {
    const sent = await sendPendingReviewSms();
    return { sent };
  }),

  /**
   * sendTest — sends a real review SMS to a test phone number and creates a proper
   * conversation session AND a completed_jobs row (in a persistent "test" batch)
   * so the full flow — analytics, notifications, review confirmed counts — fires
   * exactly as it would for a real customer send.
   */
  sendTest: agentProcedure
    .input(
      z.object({
        testPhone: z.string().min(10).max(20),
        firstName: z.string().min(1).max(50).default("there"),
      })
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      // Normalize to E.164
      const digits = input.testPhone.replace(/\D/g, "");
      const e164 = digits.startsWith("1") ? `+${digits}` : `+1${digits}`;

      const message = REVIEW_INITIAL_MESSAGE(input.firstName);

      // Send the SMS
      const result = await sendSms({ to: e164, content: message });
      if (!result.success) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: result.error ?? "Failed to send test SMS",
        });
      }

      // ── Upsert the persistent "test" batch ──────────────────────────────────
      // We use a fixed filename so all test sends share one batch row.
      const TEST_BATCH_FILENAME = "review-test-sends";
      const today = new Date().toISOString().slice(0, 10);

      // Try to find an existing test batch
      const [existingBatch] = await db
        .select({ id: completedJobBatches.id })
        .from(completedJobBatches)
        .where(eq(completedJobBatches.filename, TEST_BATCH_FILENAME))
        .limit(1);

      let batchId: number;
      if (existingBatch) {
        batchId = existingBatch.id;
        // Increment totalCount and sentCount for this new test send
        await db
          .update(completedJobBatches)
          .set({
            sentCount: sql`${completedJobBatches.sentCount} + 1`,
            totalCount: sql`${completedJobBatches.totalCount} + 1`,
            jobDate: today,
          })
          .where(eq(completedJobBatches.id, batchId));
      } else {
        const [inserted] = await db
          .insert(completedJobBatches)
          .values({
            filename: TEST_BATCH_FILENAME,
            jobDate: today,
            totalCount: 1,
            sentCount: 1,
            positiveCount: 0,
            negativeCount: 0,
            reviewConfirmedCount: 0,
          });
        batchId = (inserted as unknown as { insertId: number }).insertId;
      }

      // ── Remove any existing test review session + job for this phone ─────────
      const [existingSession] = await db
        .select({ id: conversationSessions.id })
        .from(conversationSessions)
        .where(
          and(
            eq(conversationSessions.leadPhone, e164),
            eq(conversationSessions.leadSource, "review-test")
          )
        )
        .limit(1);

      if (existingSession) {
        // Remove the old completed_jobs row for this session
        await db
          .delete(completedJobs)
          .where(eq(completedJobs.sessionId, existingSession.id));
        // Remove the old session
        await db
          .delete(conversationSessions)
          .where(eq(conversationSessions.id, existingSession.id));
      }

      // ── Create a real conversation session ───────────────────────────────────
      const [sessionInsert] = await db.insert(conversationSessions).values({
        leadPhone: e164,
        leadName: input.firstName,
        stage: "REVIEW_REQUESTED",
        leadSource: "review-test",
        messageHistory: JSON.stringify([
          { role: "assistant", content: message, ts: Date.now(), phoneNumberId: ENV.openPhoneNumberId },
        ]),
        aiMode: 1,
        isBooked: 0,
      });
      const sessionId = (sessionInsert as unknown as { insertId: number }).insertId;

      // ── Create a completed_jobs row so analytics + notifications fire ─────────
      await db.insert(completedJobs).values({
        batchId,
        phone: e164,
        name: input.firstName,
        firstName: input.firstName,
        jobDate: today,
        status: "SENT",
        smsSentAt: new Date(),
        sessionId,
        reactivationEligible: 0,
        reviewSkipped: 0,
      });

      return { ok: true, message, sentTo: e164 };
    }),
});
