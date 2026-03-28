/**
 * trackerRouter — public tRPC procedures for the customer-facing job tracker page.
 *
 * All procedures here are PUBLIC (no auth required) because the tracker page is
 * accessed via a unique token in the URL by the customer on their phone.
 *
 * Procedures:
 *   tracker.getJob                → fetch job details by trackerToken (public)
 *   tracker.submitRating          → submit a star rating + optional comment (public, once per token)
 *   tracker.generateReviewDrafts  → AI-generate 3 personalized Google review drafts (public)
 *   tracker.recordReviewAction    → track which draft was picked / copied (public, analytics)
 *   tracker.sendTodayLinks        → admin-triggered: generate tokens + send SMS for today's jobs
 *   tracker.sendSingleLink        → admin-triggered: send tracker link for a single job
 */

import { z } from "zod";
import { router, publicProcedure, agentProcedure, protectedProcedure } from "./_core/trpc";
import { TRPCError } from "@trpc/server";
import { getDb } from "./db";
import { cleanerJobs, conversationSessions, opsChatMessages } from "../drizzle/schema";
import { eq, and, isNull, isNotNull, desc, gte, lte } from "drizzle-orm";
import { jobSmsReplies } from "../drizzle/schema";
import { randomBytes } from "crypto";
import { sendSms } from "./openphone";
import { notifyOwner } from "./_core/notification";
import { invokeLLM } from "./_core/llm";

const OWNER_ALERT_NUMBER = "+13029816191"; // Owner's personal number for low-rating alerts
const GOOGLE_REVIEW_URL = "https://tinyurl.com/26rjz5jn";

/** Generate a URL-safe random token */
function generateToken(): string {
  return randomBytes(24).toString("base64url");
}

/** Get today's date in ET as YYYY-MM-DD */
function getTodayET(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

/**
 * Returns true if the serviceType string indicates a recurring booking.
 * Recurring types contain keywords like "monthly", "biweekly", "weekly", "bi-weekly", etc.
 * One-time jobs (standard cleans, deep cleans, move-in/out, hourly) return false.
 */
export function isRecurringServiceType(serviceType: string | null | undefined): boolean {
  if (!serviceType) return false;
  const s = serviceType.toLowerCase();
  return (
    s.includes("monthly") ||
    s.includes("biweekly") ||
    s.includes("bi-weekly") ||
    s.includes("bi weekly") ||
    s.includes("weekly") ||
    s.includes("recurring") ||
    s.includes("tri-weekly") ||
    s.includes("triweekly")
  );
}

export const trackerRouter = router({
  /**
   * Public: fetch job tracker data by token.
   * Returns only safe fields — no internal pay/rating data.
   */
  getJob: publicProcedure
    .input(z.object({ token: z.string().min(1) }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("DB unavailable");

      const jobs = await db
        .select({
          id: cleanerJobs.id,
          jobDate: cleanerJobs.jobDate,
          serviceDateTime: cleanerJobs.serviceDateTime,
          customerName: cleanerJobs.customerName,
          jobAddress: cleanerJobs.jobAddress,
          serviceType: cleanerJobs.serviceType,
          teamName: cleanerJobs.teamName,
          cleanerName: cleanerJobs.cleanerName,
          jobStatus: cleanerJobs.jobStatus,
          bookingStatus: cleanerJobs.bookingStatus,
          etaTimestamp: cleanerJobs.etaTimestamp,
          issueNote: cleanerJobs.issueNote,
          customerRating: cleanerJobs.customerRating,
          trackerToken: cleanerJobs.trackerToken,
          bedrooms: cleanerJobs.bedrooms,
          bathrooms: cleanerJobs.bathrooms,
          reviewChipsSelected: cleanerJobs.reviewChipsSelected,
          reviewDraftPicked: cleanerJobs.reviewDraftPicked,
          reviewCopied: cleanerJobs.reviewCopied,
        })
        .from(cleanerJobs)
        .where(eq(cleanerJobs.trackerToken, input.token))
        .limit(1);

      if (!jobs.length) return null;
      return jobs[0];
    }),

  /**
   * Public: submit a star rating via the tracker page.
   * Can only be submitted once (customerRating must be null).
   */
  submitRating: publicProcedure
    .input(
      z.object({
        token: z.string().min(1),
        rating: z.number().int().min(1).max(5),
        comment: z.string().max(1000).optional(),
      })
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("DB unavailable");

      // Verify token exists and rating not yet submitted
      const jobs = await db
        .select({
          id: cleanerJobs.id,
          customerRating: cleanerJobs.customerRating,
          customerName: cleanerJobs.customerName,
          customerPhone: cleanerJobs.customerPhone,
          jobDate: cleanerJobs.jobDate,
          jobAddress: cleanerJobs.jobAddress,
          serviceType: cleanerJobs.serviceType,
        })
        .from(cleanerJobs)
        .where(eq(cleanerJobs.trackerToken, input.token))
        .limit(1);

      if (!jobs.length) throw new Error("Invalid tracker token");
      const job = jobs[0]!;

      // Allow re-rating — customers can update their rating at any time
      await db
        .update(cleanerJobs)
        .set({ customerRating: input.rating })
        .where(eq(cleanerJobs.id, job.id));

      const firstName = (job.customerName ?? "there").split(" ")[0] ?? "there";

      // ── Low-rating owner alert + customer apology (1-3 stars) ──────────────
      if (input.rating <= 3) {
        try {
          const stars = "★".repeat(input.rating) + "☆".repeat(5 - input.rating);
          const alertMsg =
            `⚠️ Low rating alert: ${firstName} left ${input.rating} star${input.rating === 1 ? "" : "s"} ${stars}` +
            (input.comment ? `\nComment: "${input.comment}"` : "") +
            `\nJob: ${job.jobDate ?? "unknown date"} — ${job.jobAddress ?? "no address"}` +
            `\nPhone: ${job.customerPhone ?? "N/A"}`;

          // Owner alert (in-app + SMS to support line)
          await Promise.all([
            notifyOwner({ title: `⚠️ ${input.rating}★ rating — ${firstName}`, content: alertMsg }),
            sendSms({ to: OWNER_ALERT_NUMBER, content: alertMsg }),
          ]);

          // Post to MIB Command Chat so the team sees it immediately
          try {
            const db2 = await getDb();
            if (db2) {
              const stars = "★".repeat(input.rating) + "☆".repeat(5 - input.rating);
              const chatBody = [
                `⚠️ **Low rating — ${input.rating} stars ${stars}**`,
                `👤 Customer: ${firstName}${job.customerPhone ? ` · ${job.customerPhone}` : ""}`,
                `📍 Job: ${job.jobDate ?? "unknown date"} — ${job.jobAddress ?? "no address"}`,
                input.comment ? `💬 Comment: "${input.comment}"` : null,
              ].filter(Boolean).join("\n");
              await db2.insert(opsChatMessages).values({
                cleanerJobId: null,
                channel: "command",
                authorName: "⭐ Rating Alert",
                authorRole: "system",
                body: chatBody,
                metadata: JSON.stringify({ rating: input.rating, customerPhone: job.customerPhone, jobAddress: job.jobAddress }),
              });
            }
          } catch (chatErr) {
            console.error("[Tracker] Failed to post low-rating alert to command chat:", chatErr);
          }

          // Customer apology SMS
          if (job.customerPhone) {
            const apologyMsg =
              `Hi ${firstName}, we're really sorry your experience didn't meet expectations. ` +
              `Our manager will be reaching out to you shortly to make it right. 🙏`;
            await sendSms({ to: job.customerPhone, content: apologyMsg });
          }
        } catch (err) {
          console.error("[Tracker] Failed to send low-rating alert/apology:", err);
        }
      }

      // ── Post-review follow-up SMS (4-5 stars) ──────────────────────────────
      if (input.rating >= 4 && job.customerPhone) {
        try {
          const isRecurring = isRecurringServiceType(job.serviceType);
          let followUpMsg: string;

          if (isRecurring) {
            // Recurring customer — warm thank-you, see you soon
            followUpMsg =
              `Hey ${firstName} 🌟 — really appreciate the review. 🙏\n\n` +
              `We'll see you at the next one!`;
          } else {
            // One-time customer — rebooking pitch
            followUpMsg =
              `Hey ${firstName} 🌟 — really appreciate the review. 🙏\n\n` +
              `Most of our clients lock in a regular spot so they never have to think about cleaning again.\n\n` +
              `Want me to grab you a spot in ~2 weeks?`;
          }

          await sendSms({ to: job.customerPhone, content: followUpMsg });

          // Create a conversation session so inbound replies are routed correctly
          // Use REVIEW_REBOOKING_REQUESTED for one-time (rebooking pitch) or REVIEW_DONE for recurring (thanks)
          const sessionStage = isRecurring ? "REVIEW_DONE" : "REVIEW_REBOOKING_REQUESTED";
          try {
            await db.insert(conversationSessions).values({
              leadPhone: job.customerPhone,
              leadName: job.customerName ?? undefined,
              stage: sessionStage as typeof conversationSessions.$inferInsert["stage"],
              serviceType: job.serviceType ?? undefined,
              leadSource: "review_rebooking",
              messageHistory: JSON.stringify([
                { role: "assistant", content: followUpMsg },
              ]),
            });
          } catch (sessionErr) {
            console.error("[Tracker] Failed to create review rebooking session:", sessionErr);
          }
        } catch (err) {
          console.error("[Tracker] Failed to send post-review follow-up SMS:", err);
        }
      }

      return { success: true };
    }),

  /**
   * Public: generate 3 personalized AI review drafts for the customer.
   * Uses job details (bedrooms, bathrooms, serviceType, teamName) + customer-selected chips
   * to create authentic, varied review options.
   */
  generateReviewDrafts: publicProcedure
    .input(
      z.object({
        token: z.string().min(1),
        chips: z.array(z.string()).max(10),
        freeText: z.string().max(500).optional(),
      })
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("DB unavailable");

      // Fetch job data for personalization
      const jobs = await db
        .select({
          id: cleanerJobs.id,
          customerName: cleanerJobs.customerName,
          teamName: cleanerJobs.teamName,
          cleanerName: cleanerJobs.cleanerName,
          serviceType: cleanerJobs.serviceType,
          bedrooms: cleanerJobs.bedrooms,
          bathrooms: cleanerJobs.bathrooms,
          jobAddress: cleanerJobs.jobAddress,
        })
        .from(cleanerJobs)
        .where(eq(cleanerJobs.trackerToken, input.token))
        .limit(1);

      if (!jobs.length) throw new TRPCError({ code: "NOT_FOUND", message: "Invalid tracker token" });
      const job = jobs[0]!;

      // Save chips selection for analytics
      if (input.chips.length > 0) {
        await db
          .update(cleanerJobs)
          .set({ reviewChipsSelected: input.chips.join(",") })
          .where(eq(cleanerJobs.id, job.id));
      }

      // Build context for the AI
      const teamName = job.teamName ?? job.cleanerName ?? "the team";
      const bedroomStr = job.bedrooms ? `${job.bedrooms} bedroom${job.bedrooms > 1 ? "s" : ""}` : null;
      const bathroomStr = job.bathrooms ? `${job.bathrooms} bathroom${job.bathrooms > 1 ? "s" : ""}` : null;
      const sizeStr = [bedroomStr, bathroomStr].filter(Boolean).join(", ");
      const serviceStr = job.serviceType ?? "cleaning service";
      const chipsStr = input.chips.length > 0 ? input.chips.join(", ") : "great service";
      const extraContext = input.freeText ? `\nCustomer's own words: "${input.freeText}"` : "";

      const systemPrompt = `You are a review-writing assistant for Maids in Black, a premium home cleaning company in Washington DC. 
Your job is to write authentic, heartfelt Google reviews on behalf of satisfied customers.
Each review should:
- Sound natural and human, not like marketing copy
- Be 2-4 sentences (50-100 words)
- Mention specific details about the job when available
- Vary in tone and structure (one enthusiastic, one matter-of-fact, one warm/personal)
- NOT use the word "impeccable", "pristine", "meticulous", or other overused cleaning clichés
- NOT start with "I" — vary the opening
- End on a positive note that encourages others to book`;

      const userPrompt = `Write 3 different Google review drafts for this cleaning job:
- Team: ${teamName}
- Service: ${serviceStr}${sizeStr ? ` (${sizeStr})` : ""}
- What the customer highlighted: ${chipsStr}${extraContext}

Return a JSON object with this exact structure:
{
  "drafts": ["draft1 text here", "draft2 text here", "draft3 text here"]
}`;

      try {
        const response = await invokeLLM({
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "review_drafts",
              strict: true,
              schema: {
                type: "object",
                properties: {
                  drafts: {
                    type: "array",
                    items: { type: "string" },
                    description: "Array of exactly 3 review draft strings",
                  },
                },
                required: ["drafts"],
                additionalProperties: false,
              },
            },
          },
        });

        const rawContent = response.choices?.[0]?.message?.content;
        if (!rawContent) throw new Error("Empty LLM response");
        const content = typeof rawContent === "string" ? rawContent : JSON.stringify(rawContent);

        const parsed = JSON.parse(content) as { drafts: string[] };
        const drafts = parsed.drafts?.slice(0, 3) ?? [];

        if (drafts.length < 3) throw new Error("Insufficient drafts returned");

        return { drafts, googleReviewUrl: GOOGLE_REVIEW_URL };
      } catch (err) {
        console.error("[Tracker] generateReviewDrafts failed:", err);
        // Fallback drafts if AI fails
        const fallback = [
          `${teamName} did an amazing job cleaning my ${sizeStr || "home"}! Everything was spotless and they were so professional. Highly recommend Maids in Black to anyone looking for a reliable cleaning service.`,
          `Really happy with my ${serviceStr} from Maids in Black. ${teamName} was ${chipsStr.toLowerCase()} — exactly what I needed. Will definitely be booking again!`,
          `Five stars for ${teamName}! My ${sizeStr || "place"} looks fantastic. The whole experience from booking to completion was seamless. Maids in Black is the real deal.`,
        ];
        return { drafts: fallback, googleReviewUrl: GOOGLE_REVIEW_URL };
      }
    }),

  /**
   * Public: record which review draft was picked and/or copied (analytics only).
   */
  recordReviewAction: publicProcedure
    .input(
      z.object({
        token: z.string().min(1),
        draftPicked: z.number().int().min(1).max(3).optional(),
        draftText: z.string().max(2000).optional(),
        copied: z.boolean().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) return { success: true }; // Non-fatal

      const updates: Record<string, unknown> = {};
      if (input.draftPicked !== undefined) updates.reviewDraftPicked = input.draftPicked;
      if (input.draftText) updates.reviewDraftText = input.draftText;
      if (input.copied) updates.reviewCopied = 1;

      if (Object.keys(updates).length > 0) {
        await db
          .update(cleanerJobs)
          .set(updates as Parameters<typeof db.update>[0] extends (table: infer T) => { set: (values: infer V) => unknown } ? V : never)
          .where(eq(cleanerJobs.trackerToken, input.token));
      }

      return { success: true };
    }),

  /**
   * Protected (admin): generate tracker tokens for all of today's jobs that
   * don't have one yet, then send the tracker link SMS to each customer.
   * Called by the 8 AM cron and available as a manual trigger from the admin.
   */
  sendTodayLinks: agentProcedure
    .input(z.object({ date: z.string().optional() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("DB unavailable");
      const targetDate = input.date ?? getTodayET();
      const baseUrl = "https://quote.maidinblack.com";

      const jobs = await db
        .select()
        .from(cleanerJobs)
        .where(
          and(
            eq(cleanerJobs.jobDate, targetDate),
            isNull(cleanerJobs.trackerSmsSentAt)
          )
        );

      let sent = 0;
      let skipped = 0;
      const errors: string[] = [];

      for (const job of jobs) {
        if (!job.customerPhone) {
          skipped++;
          continue;
        }
        let token = job.trackerToken;
        if (!token) {
          token = generateToken();
          await db.update(cleanerJobs).set({ trackerToken: token }).where(eq(cleanerJobs.id, job.id));
        }
        const trackerUrl = `${baseUrl}/track/${token}`;
        const firstName = job.customerName?.split(" ")[0] ?? "there";
        const message = `Hi ${firstName}! Your Maids in Black team is confirmed for today. Track your clean in real time here: ${trackerUrl}`;
        const result = await sendSms({ to: job.customerPhone, content: message }).catch(
          (err: unknown) => ({ success: false, error: String(err) })
        );
        if (result.success) {
          await db.update(cleanerJobs).set({ trackerSmsSentAt: new Date() }).where(eq(cleanerJobs.id, job.id));
          sent++;
        } else {
          errors.push(`${job.customerPhone}: ${(result as { error?: string }).error ?? "unknown"}`);
        }
      }
      return { sent, skipped, errors, date: targetDate };
    }),

  /**
   * Protected (admin): fetch review analytics for the Review Tracker page.
   * Returns:
   *   - rows: all cleaner_jobs with customerRating set (joined with SMS replies)
   *   - teamStats: per-team aggregated leaderboard data
   */
  getReviewAnalytics: protectedProcedure
    .input(
      z.object({
        from: z.string().optional(), // YYYY-MM-DD
        to: z.string().optional(),   // YYYY-MM-DD
        teamName: z.string().optional(),
        rating: z.number().int().min(1).max(5).optional(),
      })
    )
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("DB unavailable");

      // Build WHERE conditions
      const conditions = [isNotNull(cleanerJobs.customerRating)];
      if (input.from) conditions.push(gte(cleanerJobs.jobDate, input.from));
      if (input.to) conditions.push(lte(cleanerJobs.jobDate, input.to));
      if (input.teamName) conditions.push(eq(cleanerJobs.teamName, input.teamName));
      if (input.rating) conditions.push(eq(cleanerJobs.customerRating, input.rating));

      // Fetch all rated jobs
      const rows = await db
        .select({
          id: cleanerJobs.id,
          jobDate: cleanerJobs.jobDate,
          customerName: cleanerJobs.customerName,
          customerPhone: cleanerJobs.customerPhone,
          teamName: cleanerJobs.teamName,
          cleanerName: cleanerJobs.cleanerName,
          serviceType: cleanerJobs.serviceType,
          customerRating: cleanerJobs.customerRating,
          reviewChipsSelected: cleanerJobs.reviewChipsSelected,
          reviewDraftPicked: cleanerJobs.reviewDraftPicked,
          reviewDraftText: cleanerJobs.reviewDraftText,
          reviewCopied: cleanerJobs.reviewCopied,
          trackerToken: cleanerJobs.trackerToken,
          jobAddress: cleanerJobs.jobAddress,
          updatedAt: cleanerJobs.updatedAt,
        })
        .from(cleanerJobs)
        .where(and(...conditions))
        .orderBy(desc(cleanerJobs.updatedAt))
        .limit(500);

      // For each job, fetch SMS replies from jobSmsReplies (client messages only)
      const jobIds = rows.map((r) => r.id);
      let repliesByJobId: Record<number, { body: string; receivedAt: Date; senderType: string }[]> = {};

      if (jobIds.length > 0) {
        // Fetch all relevant SMS replies in one query
        const allReplies = await db
          .select({
            cleanerJobId: jobSmsReplies.cleanerJobId,
            body: jobSmsReplies.body,
            receivedAt: jobSmsReplies.receivedAt,
            senderType: jobSmsReplies.senderType,
          })
          .from(jobSmsReplies)
          .where(
            and(
              eq(jobSmsReplies.senderType, "client"),
              // Only fetch replies for jobs in our result set
              // Use a subquery-style filter: cleanerJobId must be in our list
              // Drizzle doesn't have inArray with dynamic arrays cleanly, so we filter post-fetch
              // (max 500 jobs, so this is fine)
            )
          )
          .orderBy(desc(jobSmsReplies.receivedAt));

        // Group by cleanerJobId, filtering to only our job IDs
        const jobIdSet = new Set(jobIds);
        for (const reply of allReplies) {
          if (!jobIdSet.has(reply.cleanerJobId)) continue;
          if (!repliesByJobId[reply.cleanerJobId]) repliesByJobId[reply.cleanerJobId] = [];
          repliesByJobId[reply.cleanerJobId]!.push({
            body: reply.body,
            receivedAt: reply.receivedAt,
            senderType: reply.senderType,
          });
        }
      }

      // Attach replies to each row
      const rowsWithReplies = rows.map((row) => ({
        ...row,
        smsReplies: repliesByJobId[row.id] ?? [],
      }));

      // Build per-team leaderboard stats
      const teamMap = new Map<
        string,
        {
          teamName: string;
          totalJobs: number;
          totalRating: number;
          fiveStarCount: number;
          fourStarCount: number;
          lowRatingCount: number;
          chipsCount: number;
          draftPickedCount: number;
          copiedCount: number;
        }
      >();

      for (const row of rows) {
        const key = row.teamName ?? row.cleanerName ?? "Unknown";
        if (!teamMap.has(key)) {
          teamMap.set(key, {
            teamName: key,
            totalJobs: 0,
            totalRating: 0,
            fiveStarCount: 0,
            fourStarCount: 0,
            lowRatingCount: 0,
            chipsCount: 0,
            draftPickedCount: 0,
            copiedCount: 0,
          });
        }
        const t = teamMap.get(key)!;
        t.totalJobs++;
        t.totalRating += row.customerRating ?? 0;
        if (row.customerRating === 5) t.fiveStarCount++;
        else if (row.customerRating === 4) t.fourStarCount++;
        else if ((row.customerRating ?? 0) <= 3) t.lowRatingCount++;
        if (row.reviewChipsSelected) t.chipsCount++;
        if (row.reviewDraftPicked) t.draftPickedCount++;
        if (row.reviewCopied) t.copiedCount++;
      }

      const teamStats = Array.from(teamMap.values()).map((t) => ({
        ...t,
        avgRating: t.totalJobs > 0 ? Math.round((t.totalRating / t.totalJobs) * 10) / 10 : 0,
        fiveStarPct: t.totalJobs > 0 ? Math.round((t.fiveStarCount / t.totalJobs) * 100) : 0,
        funnelPct: t.totalJobs > 0 ? Math.round((t.copiedCount / t.totalJobs) * 100) : 0,
      }));

      // Sort teams by avg rating desc
      teamStats.sort((a, b) => b.avgRating - a.avgRating);

      return { rows: rowsWithReplies, teamStats };
    }),

  /**
   * Protected (admin): send tracker link to a single job by cleanerJobId.
   * Used by the "Send Tracker Link" button on admin job cards.
   */
  sendSingleLink: agentProcedure
    .input(z.object({ cleanerJobId: z.number() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("DB unavailable");
      const baseUrl = "https://quote.maidinblack.com";
      const jobs = await db
        .select()
        .from(cleanerJobs)
        .where(eq(cleanerJobs.id, input.cleanerJobId))
        .limit(1);
      const job = jobs[0];
      if (!job) throw new TRPCError({ code: "NOT_FOUND", message: "Job not found" });
      if (!job.customerPhone) throw new TRPCError({ code: "BAD_REQUEST", message: "No customer phone on file" });
      let token = job.trackerToken;
      if (!token) {
        token = generateToken();
        await db.update(cleanerJobs).set({ trackerToken: token }).where(eq(cleanerJobs.id, job.id));
      }
      const trackerUrl = `${baseUrl}/track/${token}`;
      // SMS DISABLED during testing — uncomment below when ready to go live
      // const firstName = job.customerName?.split(" ")[0] ?? "there";
      // const message = `Hi ${firstName}! Your Maids in Black team is confirmed for today. Track your clean in real time here: ${trackerUrl}`;
      // const result = await sendSms({ to: job.customerPhone, content: message }).catch(
      //   (err: unknown) => ({ success: false, error: String(err) })
      // );
      // if (!result.success) {
      //   throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: (result as { error?: string }).error ?? "SMS failed" });
      // }
      // await db.update(cleanerJobs).set({ trackerSmsSentAt: new Date() }).where(eq(cleanerJobs.id, job.id));
      return { success: true, trackerUrl };
    }),
});
