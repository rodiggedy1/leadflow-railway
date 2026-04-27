import { COOKIE_NAME, AGENT_COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, protectedProcedure, adminAgentProcedure, agentProcedure, opsChatProcedure, router } from "./_core/trpc";
import { TRPCError } from "@trpc/server";
import { messageTemplateRouter } from "./messageTemplateRouter";
import { signAgentSession, verifyAgentSession } from "./_core/agentAuth";
import { z } from "zod";
import { and, desc, eq, gte, inArray, isNull, isNotNull, lte, ne, notInArray, or, sql, SQL } from "drizzle-orm";
import { getDb, getAgentByEmail, getAgentById, getAllAgents, createAgent, setAgentActive } from "./db";
import { quoteLeads, conversationSessions, leadCallLogs, callOutcomes, pageViews, voiceCalls, completedJobs, openphoneCallRecordings, opsChatMessages, agents, cleanerJobs, cleanerProfiles } from "../drizzle/schema";
import { sendSms, estimatePrice } from "./openphone";
import { generateQuoteMessage, generatePricingFollowUp, handleOffScriptReply, handlePostBookingReply, buildMadisonQuoteMessage } from "./aiService";
import bcrypt from "bcryptjs";
import { parse as parseCookie } from "cookie";
import { calculateExtrasTotal } from "../shared/extras";
import { campaignRouter, markReactivationContactBooked } from "./campaignRouter";
import { logActivity } from "./activityLogger";
import { reviewRouter } from "./reviewRouter";
import { launch27Router } from "./launch27Router";
import { alwaysOnRouter } from "./alwaysOnRouter";
import { syncHealthRouter } from "./syncHealthRouter";
import { campaignApprovalRouter } from "./campaignApprovalRouter";
import { activityRouter } from "./activityRouter";
import { voiceRouter } from "./voiceRouter";
import { qualityRouter } from "./qualityRouter";
import { cleanerRouter } from "./cleanerRouter";
import { trackerRouter } from "./trackerRouter";
import { settingsRouter } from "./settingsRouter";
import { commandCenterRouter } from "./commandCenterRouter";
import { metricsRouter } from "./metricsRouter";
import { fieldMgmtRouter } from "./fieldMgmtRouter";
import { opsChatRouter } from "./opsChatRouter";
import { followUpsRouter } from "./followUpsRouter";
import { notifyNewLeadViaCall } from "./vapiLeadNotification";
import { invokeLLM } from "./_core/llm";
import { createHash } from "crypto";
import { sendPushToAgent, sendPushToAll } from "./webPush";
import { pushSubscriptions } from "../drizzle/schema";
import { hiringRouter } from "./hiringRouter";
import { teamPayRouter } from "./teamPayRouter";
// CS_SUPPORT_NUMBER: customer service line that receives new lead alerts
const CS_SUPPORT_NUMBER = "+12028885362";

// In-memory typing presence store: sessionId -> { agentName, agentId, expiresAt }
// Ephemeral — cleared on server restart. No DB needed for real-time typing indicators.
const typingPresence = new Map<string, { agentName: string; agentId: number; expiresAt: number }>();
// In-process dedup lock for manual sendMessage: prevents double-sends from rapid
// double-clicks or React StrictMode double-invocations. Key = "sessionId:message".
const sendMessageDedup = new Map<string, number>();
// SECONDARY_ALERT_NUMBER: additional number to receive new lead SMS alerts
const SECONDARY_ALERT_NUMBER = "+13029816191";

// Zod schema for the quote form submission
const quoteFormSchema = z.object({
  name: z.string().min(1, "Name is required").max(255),
  email: z.string().email("Invalid email").max(320),
  phone: z.string().min(7, "Phone is required").max(30),
  serviceType: z.string().min(1).max(100),
  bedrooms: z.string().min(1).max(50),
  bathrooms: z.string().min(1).max(50),
  extras: z.array(z.string().max(64)).max(20).optional().default([]),
  // UTM attribution (optional, passed from frontend URL params)
  utmSource: z.string().max(100).optional(),
  utmMedium: z.string().max(100).optional(),
  utmCampaign: z.string().max(255).optional(),
  utmContent: z.string().max(255).optional(),
  gclid: z.string().max(255).optional(),
});

export const appRouter = router({
  system: systemRouter,

  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),

  /**
   * leads.list — lists all conversation sessions for the admin dashboard
   * leads.stats — funnel breakdown counts by stage
   * Both accept optional dateFrom / dateTo (ISO date strings) for filtering.
   */
  leads: router({
    list: publicProcedure
      .input(
        z.object({
          dateFrom: z.string().optional(), // ISO date string e.g. "2026-03-01"
          dateTo: z.string().optional(),   // ISO date string e.g. "2026-03-31"
        }).optional()
      )
      .query(async ({ input }) => {
        const db = await getDb();
        if (!db) return [];
        const dateConditions = buildDateConditions(input?.dateFrom, input?.dateTo);

        // Leads page visibility rule — simple and reliable:
        //   1. Never show review-flow sessions (they belong in the Reviews tab)
        //   2. Organic/form leads (no leadSource): show immediately
        //   3. Campaign sessions (always-on, reactivation, command-center, campaign:*):
        //      show ONLY if the customer has sent at least one inbound reply
        //      (messageHistory contains a role:"user" entry)
        //      This works regardless of stage — auto-replies being off means stage
        //      stays at REACTIVATION even after a reply, so we check the message log.
        const sourceFilter = and(
          // Never show CS inbox sessions or hiring sessions in the lead list
          sql`(${conversationSessions.leadSource} IS NULL OR ${conversationSessions.leadSource} NOT IN ('cs-inbound', 'cs-inbound-cleaner', 'cs_initiated', 'hiring_interview'))`,
          // Never show pure review-flow sessions in the lead list
          sql`(${conversationSessions.leadSource} IS NULL OR ${conversationSessions.leadSource} != 'review')`,
          or(
            // Organic / form leads — show immediately (no leadSource)
            sql`${conversationSessions.leadSource} IS NULL`,
            // Non-campaign sources (not always-on, not reactivation, not command-center, not campaign:*, not review_rebooking)
            // — show immediately
            sql`(
              ${conversationSessions.leadSource} IS NOT NULL AND
              ${conversationSessions.leadSource} NOT LIKE 'always-on%' AND
              ${conversationSessions.leadSource} NOT LIKE 'campaign:%' AND
              ${conversationSessions.leadSource} NOT IN ('reactivation', 'command-center', 'review', 'review_rebooking')
            )`,
            // Campaign sessions — show ONLY if customer has replied
            // Check messageHistory JSON for any role:"user" entry
            sql`(
              (
                ${conversationSessions.leadSource} LIKE 'always-on%' OR
                ${conversationSessions.leadSource} LIKE 'campaign:%' OR
                ${conversationSessions.leadSource} IN ('reactivation', 'command-center')
              ) AND
              JSON_SEARCH(${conversationSessions.messageHistory}, 'one', 'user', NULL, '$[*].role') IS NOT NULL
            )`,
            // Review rebooking sessions — show ONLY if customer has replied
            sql`(
              ${conversationSessions.leadSource} = 'review_rebooking' AND
              JSON_SEARCH(${conversationSessions.messageHistory}, 'one', 'user', NULL, '$[*].role') IS NOT NULL
            )`
          )
        );

        const conditions = dateConditions
          ? and(dateConditions, sourceFilter)
          : sourceFilter;

        const sessions = await db
          .select()
          .from(conversationSessions)
          .where(conditions)
          // Fetch without a specific order; we'll sort by lastActivityAt below
          // after deriving it from messageHistory / lastCalledAt. Sorting by
          // updatedAt here would cause leads to jump around whenever any
          // background write (cron, notes save, stage update) touches the row.
          .orderBy(desc(conversationSessions.createdAt))
          .limit(500);

        // Derive lastActivity from messageHistory (most recent SMS) or lastCalledAt.
        // TWO separate timestamps are tracked:
        //   lastActivityAt  — the most recent message of ANY kind (shown in the UI "Last Activity" column)
        //   lastCustomerReplyAt — the most recent INBOUND (role:"user") message (used for sort order)
        //
        // Automated follow-up messages (role:"assistant") update lastActivityAt so the
        // "Last Activity" column shows the nudge text, but they do NOT update
        // lastCustomerReplyAt — so they cannot bump a lead to the top of the list.
        const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

        const mapped = sessions.map(s => {
          let lastActivityText: string | null = null;
          let lastActivityAt: Date | null = null;
          let lastActivityType: "sms" | "call" | null = null;
          let lastCustomerReplyAt: Date | null = null; // sort key — inbound only

          // Parse message history
          try {
            const history: Array<{ role: string; content: string; ts?: number }> =
              JSON.parse(s.messageHistory ?? "[]");
            if (history.length > 0) {
              // ── Last activity (any message — for display) ──────────────────
              const last = history[history.length - 1];
              lastActivityText = typeof last.content === "string"
                ? last.content.slice(0, 100)
                : null;
              if (last.ts) {
                const sessionUpdatedMs = s.updatedAt instanceof Date
                  ? s.updatedAt.getTime()
                  : new Date(s.updatedAt as string).getTime();
                const tsDiff = sessionUpdatedMs - last.ts;
                lastActivityAt = tsDiff > THIRTY_DAYS_MS
                  ? s.updatedAt  // ts is suspiciously old — use session updatedAt
                  : new Date(last.ts);
              } else {
                lastActivityAt = s.updatedAt;
              }
              lastActivityType = "sms";

              // ── Last CUSTOMER reply (role:"user" only — for sort order) ───
              // Walk backwards to find the most recent inbound message.
              // Automated follow-ups (role:"assistant") are intentionally skipped
              // so they cannot bump a lead to the top of the list.
              for (let i = history.length - 1; i >= 0; i--) {
                const msg = history[i];
                if (msg.role === "user" && msg.ts) {
                  const sessionUpdatedMs = s.updatedAt instanceof Date
                    ? s.updatedAt.getTime()
                    : new Date(s.updatedAt as string).getTime();
                  const tsDiff = sessionUpdatedMs - msg.ts;
                  lastCustomerReplyAt = tsDiff > THIRTY_DAYS_MS
                    ? null  // suspiciously old — treat as no reply
                    : new Date(msg.ts);
                  break;
                }
              }
            }
          } catch {
            // ignore parse errors
          }

          // If the most recent call log is newer than the last SMS, prefer it for display
          if (s.lastCalledAt && (!lastActivityAt || s.lastCalledAt > lastActivityAt)) {
            lastActivityText = `Call: ${s.lastCalledByAgentName ?? "agent"}`;
            lastActivityAt = s.lastCalledAt;
            lastActivityType = "call";
            // Calls are inbound interactions — also update the sort key
            if (!lastCustomerReplyAt || s.lastCalledAt > lastCustomerReplyAt) {
              lastCustomerReplyAt = s.lastCalledAt;
            }
          }

          return { ...s, lastActivityText, lastActivityAt, lastActivityType, lastCustomerReplyAt };
        });

        // Sort by the most recent "significant action" descending:
        //   - lastCustomerReplyAt: inbound SMS or call (customer engagement)
        //   - bookedAt: staff marks lead as booked — also counts as a bump
        //   - falls back to createdAt for new leads with no activity yet.
        // Automated follow-up messages (role:"assistant") do NOT change sort position.
        const toMs = (d: Date | string | null | undefined): number =>
          d ? (d instanceof Date ? d.getTime() : new Date(d as string).getTime()) : 0;
        mapped.sort((a, b) => {
          const aTime = Math.max(
            toMs(a.lastCustomerReplyAt),
            toMs(a.bookedAt),
          ) || toMs(a.createdAt);
          const bTime = Math.max(
            toMs(b.lastCustomerReplyAt),
            toMs(b.bookedAt),
          ) || toMs(b.createdAt);
          return bTime - aTime;
        });

        // ── Enrich campaign leads with bedrooms/bathrooms/serviceType from completed_jobs ──
        // Campaign sessions don't have serviceType/bedrooms/bathrooms on the session row.
        // Do a single batch lookup by phone to avoid N+1 queries.
        const CAMPAIGN_SOURCES = ['reactivation', 'command-center'];
        const isCampaignLead = (s: { leadSource: string | null }) =>
          s.leadSource != null && (
            s.leadSource.startsWith('campaign:') ||
            s.leadSource.startsWith('always-on') ||
            CAMPAIGN_SOURCES.includes(s.leadSource)
          );

        const campaignPhones = Array.from(new Set(
          mapped.filter(s => isCampaignLead(s) && s.leadPhone).map(s => s.leadPhone!)
        ));

        // Map phone -> most recent completed_job info (frequency, price, date)
        const jobInfoMap = new Map<string, { frequency: string | null; lastBookingPrice: string | null; lastJobDate: string | null }>();
        if (campaignPhones.length > 0) {
          const jobRows = await db
            .select({
              phone: completedJobs.phone,
              frequency: completedJobs.frequency,
              lastBookingPrice: completedJobs.lastBookingPrice,
              jobDate: completedJobs.jobDate,
            })
            .from(completedJobs)
            .where(inArray(completedJobs.phone, campaignPhones))
            .orderBy(desc(completedJobs.jobDate));

          // Keep only the most recent row per phone
          for (const row of jobRows) {
            if (!jobInfoMap.has(row.phone)) {
              jobInfoMap.set(row.phone, {
                frequency: row.frequency ?? null,
                lastBookingPrice: row.lastBookingPrice != null ? String(row.lastBookingPrice) : null,
                lastJobDate: row.jobDate ?? null,
              });
            }
          }
        }

        const enriched = mapped.map(s => {
          if (!isCampaignLead(s) || !s.leadPhone) return s;
          const info = jobInfoMap.get(s.leadPhone);
          if (!info) return s;
          return {
            ...s,
            // Show frequency as serviceType for campaign leads that have no serviceType
            serviceType: s.serviceType ?? info.frequency ?? s.serviceType,
            lastJobPrice: info.lastBookingPrice,
            lastJobDate: info.lastJobDate,
            jobFrequency: info.frequency,
          };
        });

        // ── Batch AI summary generation ────────────────────────────────────────
        // Compute a hash for each lead based on stage + lastActivityText.
        // Only call the LLM for leads whose hash has changed (stale or new).
        const summaryInputs = enriched.map(s => ({
          id: s.id,
          hash: createHash('sha256').update(`${s.stage ?? ''}|${s.lastActivityText ?? ''}`).digest('hex'),
          stage: s.stage ?? '',
          lastActivityText: s.lastActivityText ?? '',
          cachedHash: s.aiSummaryHash ?? null,
          cachedSummary: s.aiSummary ?? null,
        }));

        const stale = summaryInputs.filter(x => x.hash !== x.cachedHash);

        // ── Background AI summary regeneration (non-blocking) ──────────────────
        // Return the list immediately with cached summaries. Stale summaries are
        // regenerated in the background and written to DB — the next 30s poll
        // picks up the fresh values. This eliminates the 2-8s LLM blocking delay.
        if (stale.length > 0) {
          void (async () => {
            try {
              const prompt = stale.map((x, i) =>
                `${i + 1}. Stage: ${x.stage}. Last message: ${x.lastActivityText || 'none'}`
              ).join('\n');
              const llmResult = await invokeLLM({
                messages: [
                  { role: 'system', content: 'You are a CRM assistant. For each lead below, write a 4-5 word status phrase that summarizes what is happening. Be specific and actionable. Examples: "Quote sent, awaiting reply", "New lead, respond fast", "Called twice, no answer", "Interested, needs follow-up". Return a JSON array of strings, one per lead, in the same order. No punctuation at the end.' },
                  { role: 'user', content: prompt },
                ],
                response_format: { type: 'json_schema', json_schema: { name: 'summaries', strict: true, schema: { type: 'object', properties: { summaries: { type: 'array', items: { type: 'string' } } }, required: ['summaries'], additionalProperties: false } } },
              });
              const parsed = JSON.parse(llmResult.choices[0].message.content as string) as { summaries: string[] };
              const summaries = parsed.summaries;
              // Write back to DB in parallel
              const db2 = await getDb();
              if (db2) {
                await Promise.all(stale.map((x, i) => {
                  const summary = summaries[i] ?? x.cachedSummary ?? '';
                  return db2.update(conversationSessions)
                    .set({ aiSummary: summary, aiSummaryHash: x.hash })
                    .where(eq(conversationSessions.id, x.id));
                }));
              }
            } catch {
              // Silent — stale summaries stay, next poll will retry
            }
          })();
        }

        return enriched;
      }),
    stats: publicProcedure
      .input(
        z.object({
          dateFrom: z.string().optional(),
          dateTo: z.string().optional(),
        }).optional()
      )
      .query(async ({ input }) => {
        const db = await getDb();
        const emptyBreakdown = { total: 0, byStage: {} as Record<string,number>, bookedCount: 0, bookedRevenue: 0, conversionRate: 0 };
        if (!db) return {
          total: 0, byStage: {} as Record<string,number>, bookedCount: 0, bookedRevenue: 0, conversionRate: 0,
          revenueBySource: { form: 0, widget: 0, reactivation: 0 },
          organic: emptyBreakdown,
          campaign: emptyBreakdown,
          bookedList: [] as Array<{ leadName: string; bookedByAgentName: string | null; amount: number; bookedAt: number | null }>,
        };
        const conditions = buildDateConditions(input?.dateFrom, input?.dateTo);
        const bookedConditions = buildBookedDateConditions(input?.dateFrom, input?.dateTo);
        // ── Visibility filters ────────────────────────────────────────────────────
        // Organic: null source OR non-campaign sources (form, widget, voice, bark…))
        const organicFilter = and(
          sql`(${conversationSessions.leadSource} IS NULL OR ${conversationSessions.leadSource} NOT IN ('cs-inbound', 'cs-inbound-cleaner', 'review'))`,
          sql`(${conversationSessions.leadSource} IS NULL OR ${conversationSessions.leadSource} NOT IN ('cs-inbound', 'cs-inbound-cleaner'))`,
          or(
            sql`${conversationSessions.leadSource} IS NULL`,
            sql`(
              ${conversationSessions.leadSource} IS NOT NULL AND
              ${conversationSessions.leadSource} NOT LIKE 'always-on%' AND
              ${conversationSessions.leadSource} NOT LIKE 'campaign:%' AND
              ${conversationSessions.leadSource} NOT IN ('reactivation', 'command-center', 'review', 'review_rebooking')
            )`
          )
        );
        // Campaign: always-on/campaign:/reactivation/command-center — only if customer replied
        const campaignFilter = and(
          or(
            sql`${conversationSessions.leadSource} LIKE 'always-on%'`,
            sql`${conversationSessions.leadSource} LIKE 'campaign:%'`,
            sql`${conversationSessions.leadSource} IN ('reactivation', 'command-center')`
          ),
          sql`JSON_SEARCH(${conversationSessions.messageHistory}, 'one', 'user', NULL, '$[*].role') IS NOT NULL`
        );
        // Review rebooking: show only if customer replied
        const reviewRebookingFilter = and(
          sql`${conversationSessions.leadSource} = 'review_rebooking'`,
          sql`JSON_SEARCH(${conversationSessions.messageHistory}, 'one', 'user', NULL, '$[*].role') IS NOT NULL`
        );
        // Combined (what the leads list shows)
        const listVisibilityFilter = and(
          sql`(${conversationSessions.leadSource} IS NULL OR ${conversationSessions.leadSource} NOT IN ('cs-inbound', 'cs-inbound-cleaner', 'review'))`,
          or(organicFilter, campaignFilter, reviewRebookingFilter)
        );

        // Helper: run stage-count query for a given filter
        async function stageBreakdown(filter: SQL<unknown> | undefined) {
          const rows = await db!
            .select({ stage: conversationSessions.stage, count: sql<number>`count(*)` })
            .from(conversationSessions)
            .where(conditions ? and(conditions, filter) : filter)
            .groupBy(conversationSessions.stage);
          const byStage: Record<string,number> = {};
          let total = 0;
          for (const r of rows) { byStage[r.stage] = Number(r.count); total += Number(r.count); }
          return { byStage, total };
        }

        // Helper: run booked-revenue query for a given filter
        async function bookedBreakdown(filter: SQL<unknown> | undefined) {
          const baseWhere = bookedConditions ? and(bookedConditions, filter, eq(conversationSessions.stage, "BOOKED"))
                                             : and(filter, eq(conversationSessions.stage, "BOOKED"));
          const rows = await db!
            .select({
              leadSource: conversationSessions.leadSource,
              quotedPrice: conversationSessions.quotedPrice,
              extras: conversationSessions.extras,
              bookedAmount: conversationSessions.bookedAmount,
              reactivationLastPrice: conversationSessions.reactivationLastPrice,
              reactivationDiscountPct: conversationSessions.reactivationDiscountPct,
              leadName: conversationSessions.leadName,
              bookedByAgentName: conversationSessions.bookedByAgentName,
              assignedAgentName: conversationSessions.assignedAgentName,
              bookedAt: conversationSessions.bookedAt,
            })
            .from(conversationSessions)
            .where(baseWhere);
          const bookedCount = rows.length;
          const bookedRevenue = rows.reduce((s, r) => s + calcBookedRevenue(r), 0);
          return { bookedCount, bookedRevenue, rows };
        }

        // Run all queries in parallel
        const [
          organicStages, campaignStages,
          organicBooked, campaignBooked,
          allBooked,
        ] = await Promise.all([
          stageBreakdown(organicFilter),
          stageBreakdown(campaignFilter),
          bookedBreakdown(organicFilter),
          bookedBreakdown(campaignFilter),
          // legacy combined booked for revenueBySource + per-booking detail list
          (async () => {
            const baseWhere = conditions
              ? and(conditions, listVisibilityFilter, eq(conversationSessions.stage, "BOOKED"))
              : and(listVisibilityFilter, eq(conversationSessions.stage, "BOOKED"));
            return db!.select({
              leadSource: conversationSessions.leadSource,
              quotedPrice: conversationSessions.quotedPrice,
              extras: conversationSessions.extras,
              bookedAmount: conversationSessions.bookedAmount,
              reactivationLastPrice: conversationSessions.reactivationLastPrice,
              reactivationDiscountPct: conversationSessions.reactivationDiscountPct,
              leadName: conversationSessions.leadName,
              bookedByAgentName: conversationSessions.bookedByAgentName,
              assignedAgentName: conversationSessions.assignedAgentName,
              bookedAt: conversationSessions.bookedAt,
            }).from(conversationSessions).where(baseWhere);
          })(),
        ]);

        // Build organic breakdown
        const organic = {
          ...organicStages,
          ...organicBooked,
          conversionRate: organicStages.total > 0 ? Math.round((organicBooked.bookedCount / organicStages.total) * 100) : 0,
        };
        // Build campaign breakdown
        const campaign = {
          ...campaignStages,
          ...campaignBooked,
          conversionRate: campaignStages.total > 0 ? Math.round((campaignBooked.bookedCount / campaignStages.total) * 100) : 0,
        };

        // Combined totals (legacy fields kept for backward compat)
        const total = organic.total + campaign.total;
        const byStage = { ...organic.byStage };
        for (const [k, v] of Object.entries(campaign.byStage)) {
          byStage[k] = (byStage[k] ?? 0) + v;
        }
        const bookedCount = organic.bookedCount + campaign.bookedCount;
        const bookedRevenue = organic.bookedRevenue + campaign.bookedRevenue;
        const conversionRate = total > 0 ? Math.round((bookedCount / total) * 100) : 0;

        const revenueBySource = { form: 0, widget: 0, reactivation: 0 } as Record<string, number>;
        for (const r of allBooked) {
          const src = r.leadSource ?? 'form';
          revenueBySource[src] = (revenueBySource[src] ?? 0) + calcBookedRevenue(r);
        }

        // Build per-booking detail list — same rows that make up bookedRevenue total
        const bookedList = [...organicBooked.rows, ...campaignBooked.rows].map(r => ({
          leadName: r.leadName ?? 'Unknown',
          bookedByAgentName: r.bookedByAgentName ?? r.assignedAgentName ?? null,
          amount: calcBookedRevenue(r),
          bookedAt: r.bookedAt instanceof Date ? r.bookedAt.getTime() : r.bookedAt ? new Date(r.bookedAt as string).getTime() : null,
        })).sort((a, b) => (b.bookedAt ?? 0) - (a.bookedAt ?? 0));

        return { total, byStage, bookedCount, bookedRevenue, conversionRate, revenueBySource, organic, campaign, bookedList };
      }),

    /**
     * leads.sourceBreakdown — returns lead count grouped by utmSource.
     * "direct" is used for leads with no utmSource.
     */
    sourceBreakdown: adminAgentProcedure
      .input(
        z.object({
          dateFrom: z.string().optional(),
          dateTo: z.string().optional(),
        }).optional()
      )
      .query(async ({ input }) => {
        const db = await getDb();
        if (!db) return [];
        const conditions = buildDateConditions(input?.dateFrom, input?.dateTo);

        // Lead counts per source (from form submissions)
        const leadRows = await db
          .select({
            utmSource: conversationSessions.utmSource,
            count: sql<number>`count(*)`,
          })
          .from(conversationSessions)
          .where(conditions)
          .groupBy(conversationSessions.utmSource);

        // Visitor counts per source (from page_views table)
        // Use COUNT(DISTINCT sessionKey) to deduplicate any rows that slipped in before
        // the UNIQUE constraint was added to the sessionKey column.
        // Bot filter: only count sessions where timeOnPage >= 8s, or NULL (rows before this column was added).
        const BOT_FILTER_SECONDS = 8;
        const visitorRows = await db
          .select({
            utmSource: pageViews.utmSource,
            count: sql<number>`count(distinct ${pageViews.sessionKey})`,
          })
          .from(pageViews)
          .where(
            and(
              input?.dateFrom ? gte(pageViews.createdAt, new Date(input.dateFrom)) : undefined,
              input?.dateTo   ? lte(pageViews.createdAt, new Date(input.dateTo))   : undefined,
              or(
                isNull(pageViews.timeOnPage),
                gte(pageViews.timeOnPage, BOT_FILTER_SECONDS),
              ),
            )
          )
          .groupBy(pageViews.utmSource);

        // Merge both into a single map keyed by source
        const map = new Map<string, { visitors: number; leads: number }>();

        for (const r of visitorRows) {
          const src = r.utmSource ?? "direct";
          map.set(src, { visitors: Number(r.count), leads: 0 });
        }
        for (const r of leadRows) {
          const src = r.utmSource ?? "direct";
          const existing = map.get(src) ?? { visitors: 0, leads: 0 };
          map.set(src, { ...existing, leads: Number(r.count) });
        }

        return Array.from(map.entries()).map(([source, { visitors, leads }]) => ({
          source,
          visitors,
          leads,
          // keep count for backwards compat with any existing consumers
          count: leads,
        }));
      }),

    /**
     * leads.trackPageView — called once per quote form page load.
     * Uses a sessionKey (random ID from browser sessionStorage) to deduplicate
     * refreshes so each browser session counts as one visitor.
     */
    trackPageView: publicProcedure
      .input(z.object({
        sessionKey: z.string().max(64),
        utmSource: z.string().max(100).optional(),
        utmMedium: z.string().max(100).optional(),
        utmCampaign: z.string().max(255).optional(),
        /** Seconds from page mount to first real interaction — used as bot filter */
        timeOnPage: z.number().int().min(0).max(3600).optional(),
      }))
      .mutation(async ({ input }) => {
        const db = await getDb();
        if (!db) return { ok: false };
        // Upsert — ignore if this sessionKey already exists (UNIQUE constraint on sessionKey)
        try {
          await db.insert(pageViews).ignore().values({
            sessionKey: input.sessionKey,
            utmSource: input.utmSource ?? null,
            utmMedium: input.utmMedium ?? null,
            utmCampaign: input.utmCampaign ?? null,
            timeOnPage: input.timeOnPage ?? null,
          });
        } catch {
          // Silently ignore duplicate key errors
        }
        return { ok: true };
      }),

    /**
     * leads.visitorStats — returns visitor count, lead count, and booked count
     * for the given date range, used to build the conversion funnel in the admin dashboard.
     */
    visitorStats: adminAgentProcedure
      .input(z.object({
        dateFrom: z.string().optional(),
        dateTo: z.string().optional(),
      }).optional())
      .query(async ({ input }) => {
        const db = await getDb();
        if (!db) return { visitors: 0, leads: 0, booked: 0 };

        const conditions = buildDateConditions(input?.dateFrom, input?.dateTo);

        // Visitor count from page_views table
        // Use COUNT(DISTINCT sessionKey) to deduplicate any rows that slipped in before
        // the UNIQUE constraint was added to the sessionKey column.
        // Bot filter: only count sessions where timeOnPage >= 8s, or NULL (rows before this column was added).
        const BOT_FILTER_SECONDS = 8;
        const [visitorRow] = await db
          .select({ count: sql<number>`count(distinct ${pageViews.sessionKey})` })
          .from(pageViews)
          .where(
            and(
              input?.dateFrom ? gte(pageViews.createdAt, new Date(input.dateFrom)) : undefined,
              input?.dateTo ? lte(pageViews.createdAt, new Date(input.dateTo)) : undefined,
              or(
                isNull(pageViews.timeOnPage),
                gte(pageViews.timeOnPage, BOT_FILTER_SECONDS),
              ),
            )
          );

        // Lead count from conversation_sessions
        const [leadRow] = await db
          .select({ count: sql<number>`count(*)` })
          .from(conversationSessions)
          .where(conditions);

        // Booked count
        const [bookedRow] = await db
          .select({ count: sql<number>`count(*)` })
          .from(conversationSessions)
          .where(and(conditions, eq(conversationSessions.isBooked, 1)));

        return {
          visitors: Number(visitorRow?.count ?? 0),
          leads: Number(leadRow?.count ?? 0),
          booked: Number(bookedRow?.count ?? 0),
        };
      }),

    /**
     * leads.dailyTrend — returns the last 7 days of daily counts for visitors, leads, and booked.
     * Used to render sparkline bar charts on the summary cards.
     * Each entry: { date: "YYYY-MM-DD", visitors: number, leads: number, booked: number }
     */
    dailyTrend: adminAgentProcedure.query(async () => {
      const db = await getDb();
      // Build last 7 calendar days (UTC) as YYYY-MM-DD strings
      const days: string[] = [];
      for (let i = 6; i >= 0; i--) {
        const d = new Date();
        d.setUTCDate(d.getUTCDate() - i);
        days.push(d.toISOString().slice(0, 10));
      }

      if (!db) return days.map(date => ({ date, visitors: 0, leads: 0, booked: 0 }));

      const sevenDaysAgo = new Date();
      sevenDaysAgo.setUTCDate(sevenDaysAgo.getUTCDate() - 6);
      sevenDaysAgo.setUTCHours(0, 0, 0, 0);

      // Daily visitor counts
      // Use COUNT(DISTINCT sessionKey) to deduplicate any rows that slipped in before
      // the UNIQUE constraint was added to the sessionKey column.
      // Bot filter: only count sessions where timeOnPage >= 8s, or NULL (rows before this column was added).
      // NOTE: Raw SQL with explicit table.column names to avoid TiDB only_full_group_by error
      // (Drizzle interpolates column refs differently in SELECT vs GROUP BY)
      const BOT_FILTER_SECONDS = 8;
      const visitorRaw = await db.execute(
        sql`SELECT LEFT(page_views.createdAt, 10) as day, COUNT(DISTINCT page_views.sessionKey) as count
            FROM page_views
            WHERE page_views.createdAt >= ${sevenDaysAgo}
              AND (page_views.timeOnPage IS NULL OR page_views.timeOnPage >= ${BOT_FILTER_SECONDS})
            GROUP BY LEFT(page_views.createdAt, 10)`
      );
      const visitorRows = ((visitorRaw as unknown as Array<unknown>)[0] as Array<{day: string; count: number}>);

      // Daily lead counts
      const leadRaw = await db.execute(
        sql`SELECT LEFT(conversation_sessions.createdAt, 10) as day, COUNT(*) as count
            FROM conversation_sessions
            WHERE conversation_sessions.createdAt >= ${sevenDaysAgo}
            GROUP BY LEFT(conversation_sessions.createdAt, 10)`
      );
      const leadRows = ((leadRaw as unknown as Array<unknown>)[0] as Array<{day: string; count: number}>);

      // Daily booked counts
      const bookedRaw = await db.execute(
        sql`SELECT LEFT(conversation_sessions.bookedAt, 10) as day, COUNT(*) as count
            FROM conversation_sessions
            WHERE conversation_sessions.bookedAt >= ${sevenDaysAgo}
              AND conversation_sessions.isBooked = 1
            GROUP BY LEFT(conversation_sessions.bookedAt, 10)`
      );
      const bookedRows = ((bookedRaw as unknown as Array<unknown>)[0] as Array<{day: string; count: number}>);

      // Build lookup maps
      const visitorMap = new Map(visitorRows.map(r => [r.day, Number(r.count)]));
      const leadMap = new Map(leadRows.map(r => [r.day, Number(r.count)]));
      const bookedMap = new Map(bookedRows.map(r => [r.day, Number(r.count)]));

      return days.map(date => ({
        date,
        visitors: visitorMap.get(date) ?? 0,
        leads: leadMap.get(date) ?? 0,
        booked: bookedMap.get(date) ?? 0,
      }));
    }),

    /**
     * leads.adminUpdateStage — admin overrides the stage of any lead.
     */
    adminUpdateStage: adminAgentProcedure
      .input(z.object({
        sessionId: z.number().int().positive(),
        stage: z.enum([
          "WIDGET_SIZING",
          "QUOTE_SENT",
          "AVAILABILITY",
          "SLOT_CHOICE",
          "TIME_PREF",
          "ADDRESS",
          "CONFIRMATION",
          "CALL_SCHEDULED",
          "DONE",
          "UNHANDLED",
          "BOOKED",
          "FOLLOW_UP_SCHEDULED",
          "VOICEMAIL",
          "COLD",
          "LOST",
          "YELP_CONTACTED",
        ]),
      }))
      .mutation(async ({ input, ctx }) => {
        const db = await getDb();
        if (!db) throw new Error("Database unavailable");
        const stageUpdates: Record<string, unknown> = { stage: input.stage };
        if (input.stage === "BOOKED") {
          // Always sync isBooked flag when stage is set to BOOKED
          stageUpdates.isBooked = 1;
          stageUpdates.bookedAt = new Date();
        } else {
          // Moving away from BOOKED — clear the flag
          stageUpdates.isBooked = 0;
        }
        await db
          .update(conversationSessions)
          .set(stageUpdates)
          .where(eq(conversationSessions.id, input.sessionId));
        // If marking as BOOKED, increment campaign bookedCount for reactivation leads
        if (input.stage === "BOOKED") {
          await markReactivationContactBooked(input.sessionId).catch(console.error);
          // Auto-fire booking announcement into the command channel
          try {
            const [session] = await db
              .select({
                leadName: conversationSessions.leadName,
                quotedPrice: conversationSessions.quotedPrice,
                serviceType: conversationSessions.serviceType,
                bookedAmount: conversationSessions.bookedAmount,
              })
              .from(conversationSessions)
              .where(eq(conversationSessions.id, input.sessionId))
              .limit(1);
            const personName = session?.leadName ?? "Lead";
            const rawAmount = session?.bookedAmount
              ? `$${session.bookedAmount}`
              : session?.quotedPrice ?? null;
            const note = session?.serviceType ?? null;
            const authorName = ctx.agent.agentName;
            const meta = JSON.stringify({
              personName,
              amount: rawAmount ?? undefined,
              note: note ?? undefined,
            });
            const body = rawAmount
              ? `🎉 New booking! ${personName} — ${rawAmount}${note ? ` · ${note}` : ""}`
              : `🎉 New booking! ${personName}${note ? ` · ${note}` : ""}`;
            await db.insert(opsChatMessages).values({
              channel: "command",
              authorName,
              authorRole: "office",
              body,
              quickAction: "announce_booking",
              metadata: meta,
            });
          } catch (err) {
            console.error("[adminUpdateStage] Failed to post booking announcement:", err);
          }
        }
        return { success: true };
      }),

    /**
     * leads.agentUpdateStage — any logged-in agent can update outcome-level stages.
     * Mirrors adminUpdateStage but uses agentProcedure (no isAdmin required).
     * Restricted to outcome stages only — mid-conversation AI stages are excluded.
     */
    agentUpdateStage: agentProcedure
      .input(z.object({
        sessionId: z.number().int().positive(),
        stage: z.enum([
          "BOOKED",
          "FOLLOW_UP_SCHEDULED",
          "VOICEMAIL",
          "COLD",
          "LOST",
          "YELP_CONTACTED",
        ]),
        lostReason: z.string().max(100).optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const db = await getDb();
        if (!db) throw new Error("Database unavailable");
        const stageUpdates: Record<string, unknown> = { stage: input.stage };
        if (input.stage === "BOOKED") {
          stageUpdates.isBooked = 1;
          stageUpdates.bookedAt = new Date();
        } else {
          stageUpdates.isBooked = 0;
        }
        if (input.stage === "LOST") {
          stageUpdates.lostReason = input.lostReason ?? null;
        }
        await db
          .update(conversationSessions)
          .set(stageUpdates)
          .where(eq(conversationSessions.id, input.sessionId));
        if (input.stage === "BOOKED") {
          await markReactivationContactBooked(input.sessionId).catch(console.error);
          // Auto-fire booking announcement into the command channel
          try {
            const [session] = await db
              .select({
                leadName: conversationSessions.leadName,
                quotedPrice: conversationSessions.quotedPrice,
                serviceType: conversationSessions.serviceType,
                bookedAmount: conversationSessions.bookedAmount,
              })
              .from(conversationSessions)
              .where(eq(conversationSessions.id, input.sessionId))
              .limit(1);
            const personName = session?.leadName ?? "Lead";
            const rawAmount = session?.bookedAmount
              ? `$${session.bookedAmount}`
              : session?.quotedPrice ?? null;
            const note = session?.serviceType ?? null;
            const authorName = ctx.agent.agentName;
            const meta = JSON.stringify({
              personName,
              amount: rawAmount ?? undefined,
              note: note ?? undefined,
            });
            const body = rawAmount
              ? `🎉 New booking! ${personName} — ${rawAmount}${note ? ` · ${note}` : ""}`
              : `🎉 New booking! ${personName}${note ? ` · ${note}` : ""}`;
            await db.insert(opsChatMessages).values({
              channel: "command",
              authorName,
              authorRole: "office",
              body,
              quickAction: "announce_booking",
              metadata: meta,
            });
          } catch (err) {
            console.error("[agentUpdateStage] Failed to post booking announcement:", err);
          }
        }
        return { success: true };
      }),

    /**
     * leads.adminSetFollowUp — set or clear a scheduled follow-up date and message.
     * Setting a date moves the session to FOLLOW_UP_SCHEDULED stage.
     * Clearing (date = null) reverts to AVAILABILITY.
     */
    adminSetFollowUp: adminAgentProcedure
      .input(z.object({
        sessionId: z.number().int().positive(),
        followUpDate: z.string().nullable(), // YYYY-MM-DD or null to clear
        followUpMessage: z.string().nullable(),
      }))
      .mutation(async ({ input }) => {
        const db = await getDb();
        if (!db) throw new Error("Database unavailable");
        if (input.followUpDate) {
          await db
            .update(conversationSessions)
            .set({
              followUpDate: input.followUpDate,
              followUpMessage: input.followUpMessage ?? "Hi, just circling back on this. We have some availability and would love to get you scheduled!",
              followUpSent: 0,
              stage: "FOLLOW_UP_SCHEDULED",
            })
            .where(eq(conversationSessions.id, input.sessionId));
        } else {
          // Clear the follow-up
          await db
            .update(conversationSessions)
            .set({
              followUpDate: null,
              followUpMessage: null,
              followUpSent: 0,
              stage: "AVAILABILITY",
            })
            .where(eq(conversationSessions.id, input.sessionId));
        }
        return { success: true };
      }),

    /**
     * leads.adminAssignAgent — admin assigns or unassigns a lead to any agent.
     * Pass agentId: null to unassign.
     */
    adminAssignAgent: adminAgentProcedure
      .input(z.object({
        sessionId: z.number().int().positive(),
        agentId: z.number().int().positive().nullable(),
      }))
       .mutation(async ({ input }) => {
        const db = await getDb();
        if (!db) throw new Error("Database unavailable");
        if (input.agentId === null) {
          await db
            .update(conversationSessions)
            .set({ assignedAgentId: null, assignedAgentName: null })
            .where(eq(conversationSessions.id, input.sessionId));
          await syncClaimToOpsChatMessage(db, input.sessionId, null, null);
          const { broadcastOpsUpdate: bcast1 } = await import("./sseBroadcast");
          bcast1("lead_update");
          return { success: true };
        }
        const agent = await getAgentById(input.agentId);
        if (!agent) throw new Error("Agent not found");
        await db
          .update(conversationSessions)
          .set({ assignedAgentId: agent.id, assignedAgentName: agent.name })
          .where(eq(conversationSessions.id, input.sessionId));
        await syncClaimToOpsChatMessage(db, input.sessionId, agent.name, Date.now());
        const { broadcastOpsUpdate: bcast2 } = await import("./sseBroadcast");
        bcast2("lead_update");
        return { success: true };
      }),
    /**
     * leads.updateBookedAmount — admin sets the actual invoiced/booked dollar amount.
     * Pass null to clear the override and revert to quotedPrice + extras.
     */
    updateBookedAmount: adminAgentProcedure
      .input(z.object({
        sessionId: z.number().int().positive(),
        bookedAmount: z.number().int().min(0).nullable(),
      }))
      .mutation(async ({ input }) => {
        const db = await getDb();
        if (!db) throw new Error("Database unavailable");
        await db
          .update(conversationSessions)
          .set({ bookedAmount: input.bookedAmount })
          .where(eq(conversationSessions.id, input.sessionId));
        return { success: true };
      }),

    /**
     * leads.updateLeadName — any agent sets/updates the name for a lead.
     * Used when a lead comes in with no name (e.g. voice/SMS with no form submission).
     */
    updateLeadName: agentProcedure
      .input(z.object({
        sessionId: z.number().int().positive(),
        leadName: z.string().min(1).max(255).trim(),
      }))
      .mutation(async ({ input }) => {
        const db = await getDb();
        if (!db) throw new Error("Database unavailable");
        await db
          .update(conversationSessions)
          .set({ leadName: input.leadName })
          .where(eq(conversationSessions.id, input.sessionId));
        return { success: true, leadName: input.leadName };
      }),
    /**
     * leads.updateLeadPhone — any agent sets/updates the phone number for a lead.
     * Used when a call-assistant booking comes in with no phone or an incorrect phone.
     */
    updateLeadPhone: agentProcedure
      .input(z.object({
        sessionId: z.number().int().positive(),
        leadPhone: z.string().min(1).max(30).trim(),
      }))
      .mutation(async ({ input }) => {
        const db = await getDb();
        if (!db) throw new Error("Database unavailable");
        await db
          .update(conversationSessions)
          .set({ leadPhone: input.leadPhone })
          .where(eq(conversationSessions.id, input.sessionId));
        return { success: true, leadPhone: input.leadPhone };
      }),

    /**
     * leads.sendMessage — agent or admin sends an outbound SMS to a lead from the app.
     * Stores the message in messageHistory and sends via OpenPhone.
     */
    sendMessage: publicProcedure
      .input(z.object({
        sessionId: z.number().int().positive(),
        message: z.string().min(1).max(1600),
        fromNumberId: z.string().optional(), // Optional override for CS line replies
      }))
      .mutation(async ({ input, ctx }) => {
        const agentSession = await getAgentSessionFromCtx(ctx);
        const db = await getDb();
        if (!db) throw new Error("Database unavailable");

        // ── Atomic in-process dedup lock ─────────────────────────────────────────
        // The old guard (read history → check duplicate → write) had a race condition:
        // two concurrent calls both read history before either writes, both find no
        // duplicate, both send SMS. Fix: use a process-level Map as an atomic lock.
        // The key is sessionId:message. First call claims the key; second call sees
        // it already claimed and returns immediately. TTL of 15s auto-clears stale keys.
        const dedupKey = `${input.sessionId}:${input.message}`;
        if (sendMessageDedup.has(dedupKey)) {
          console.warn(`[sendMessage] Duplicate blocked by in-process lock for session ${input.sessionId}.`);
          return { success: true, smsSent: false, duplicate: true };
        }
        sendMessageDedup.set(dedupKey, Date.now());
        setTimeout(() => sendMessageDedup.delete(dedupKey), 15_000);

        // Fetch the session to get the lead's phone and current history
        const [session] = await db
          .select()
          .from(conversationSessions)
          .where(eq(conversationSessions.id, input.sessionId))
          .limit(1);
        if (!session) throw new Error("Session not found");

        // Parse and update history
        let history: Array<{ role: string; content: string; ts?: number; senderName?: string }> = [];
        try { history = JSON.parse(session.messageHistory ?? "[]"); } catch { history = []; }

        const now = Date.now();
        history.push({ role: "assistant", content: input.message, ts: now, senderName: agentSession.agentName });


        // Save to DB first, then send SMS
        await db
          .update(conversationSessions)
          .set({ messageHistory: JSON.stringify(history) })
          .where(eq(conversationSessions.id, input.sessionId));

        // Send via OpenPhone (use fromNumberId override for CS line replies)
        const smsResult = await sendSms({ to: session.leadPhone, content: input.message, ...(input.fromNumberId ? { fromNumberId: input.fromNumberId } : {}) });
        if (!smsResult.success) {
          console.error(`[sendMessage] Failed to send SMS to ${session.leadPhone}:`, smsResult.error);
          // Don't throw — message is already stored in history
        }

        console.log(`[sendMessage] Agent ${agentSession.agentName} sent to ${session.leadPhone}: "${input.message}"`);
        return { success: true, smsSent: smsResult.success };
      }),

    /**
     * leads.setTyping — agent signals they are typing (or stopped) in a conversation.
     * Uses an in-memory store with 5-second TTL. No DB needed — ephemeral state.
     */
    setTyping: publicProcedure
      .input(z.object({
        sessionId: z.number().int().positive(),
        isTyping: z.boolean(),
      }))
      .mutation(async ({ input, ctx }) => {
        const agentSession = await getAgentSessionFromCtx(ctx);
        const key = `${input.sessionId}`;
        if (input.isTyping) {
          typingPresence.set(key, {
            agentName: agentSession.agentName,
            agentId: agentSession.agentId,
            expiresAt: Date.now() + 5_000,
          });
        } else {
          // Only clear if this agent set it
          const existing = typingPresence.get(key);
          if (existing?.agentId === agentSession.agentId) {
            typingPresence.delete(key);
          }
        }
        return { success: true };
      }),

    /**
     * leads.getTyping — returns who (if anyone) is currently typing in a session.
     * Polled every 2s by the drawer. Expired entries are cleaned up on read.
     */
    getTyping: publicProcedure
      .input(z.object({ sessionId: z.number().int().positive() }))
      .query(async ({ input, ctx }) => {
        const agentSession = await getAgentSessionFromCtx(ctx);
        const key = `${input.sessionId}`;
        const entry = typingPresence.get(key);
        if (!entry) return { typingAgentName: null };
        // Expired?
        if (Date.now() > entry.expiresAt) {
          typingPresence.delete(key);
          return { typingAgentName: null };
        }
        // Don't show your own typing indicator back to yourself
        if (entry.agentId === agentSession.agentId) return { typingAgentName: null };
        return { typingAgentName: entry.agentName };
      }),

    /**
     * leads.setAiMode — toggle AI auto-reply on/off for a lead.
     * aiMode=1 means AI handles replies; aiMode=0 means agent handles manually.
     * Accessible by any authenticated agent or admin.
     */
    setAiMode: publicProcedure
      .input(z.object({
        sessionId: z.number().int().positive(),
        aiMode: z.number().int().min(0).max(1),
      }))
      .mutation(async ({ input, ctx }) => {
        await getAgentSessionFromCtx(ctx);
        const db = await getDb();
        if (!db) throw new Error("Database unavailable");
        await db
          .update(conversationSessions)
          .set({ aiMode: input.aiMode })
          .where(eq(conversationSessions.id, input.sessionId));
        return { success: true };
      }),

    /**
     * leads.deleteLead — permanently delete a lead and all associated call logs.
     * Admin only.
     */
    deleteLead: adminAgentProcedure
      .input(z.object({ sessionId: z.number().int().positive() }))
      .mutation(async ({ input }) => {
        const db = await getDb();
        if (!db) throw new Error("Database unavailable");
        // Delete related call logs first (FK constraint)
        await db
          .delete(leadCallLogs)
          .where(eq(leadCallLogs.sessionId, input.sessionId));
        // Delete the session itself
        await db
          .delete(conversationSessions)
          .where(eq(conversationSessions.id, input.sessionId));
        // Remove the hot lead card from the command channel tray.
        // new_lead cards store sessionId in their JSON metadata field.
        try {
          const hotLeadMsgs = await db
            .select({ id: opsChatMessages.id, metadata: opsChatMessages.metadata })
            .from(opsChatMessages)
            .where(eq(opsChatMessages.quickAction, "new_lead"));
          const toDelete = hotLeadMsgs
            .filter(m => {
              try { return JSON.parse(m.metadata ?? "{}").sessionId === input.sessionId; }
              catch { return false; }
            })
            .map(m => m.id);
          if (toDelete.length > 0) {
            await db.delete(opsChatMessages).where(inArray(opsChatMessages.id, toDelete));
          }
        } catch (err) {
          console.error("[deleteLead] Failed to remove hot lead card:", err);
        }
        return { success: true };
      }),

    /**
     * leads.revenueAttribution — full revenue attribution report.
     * Powers the Revenue Attribution Dashboard.
     * Returns:
     *  - summary: totalRevenue, totalJobs, avgJobValue, softwareCost, roiMultiple
     *  - byChannel: revenue + jobs per lead source (form, widget, reactivation, voice)
     *  - byMonth: last 6 months of revenue + job counts
     *  - voice: calls handled, avg duration, booked via voice
     *  - topJobs: top 5 booked jobs by revenue
     */
    revenueAttribution: adminAgentProcedure
      .input(z.object({
        months: z.number().int().min(1).max(12).default(6),
        softwareCost: z.number().min(0).default(500),
      }).optional())
      .query(async ({ input }) => {
        const db = await getDb();
        const months = input?.months ?? 6;
        const softwareCost = input?.softwareCost ?? 500;

        const empty = {
          summary: { totalRevenue: 0, totalJobs: 0, avgJobValue: 0, softwareCost, roiMultiple: 0, roiDollars: 0 },
          byChannel: [] as Array<{ channel: string; label: string; revenue: number; jobs: number; avgValue: number }>,
          byMonth: [] as Array<{ month: string; label: string; revenue: number; jobs: number }>,
          voice: { totalCalls: 0, bookedViaCalls: 0, avgDurationSeconds: 0, callConversionRate: 0 },
          topJobs: [] as Array<{ id: number; name: string; phone: string; revenue: number; bookedAt: Date | null; channel: string }>,
        };
        if (!db) return empty;

        // ── Date range: start of (now - months) ──────────────────────────────
        const since = new Date();
        since.setUTCMonth(since.getUTCMonth() - months);
        since.setUTCDate(1);
        since.setUTCHours(0, 0, 0, 0);

        // ── Booked sessions in range ─────────────────────────────────────────
        const bookedSessions = await db
          .select({
            id: conversationSessions.id,
            leadName: conversationSessions.leadName,
            leadPhone: conversationSessions.leadPhone,
            leadSource: conversationSessions.leadSource,
            quotedPrice: conversationSessions.quotedPrice,
            extras: conversationSessions.extras,
            bookedAmount: conversationSessions.bookedAmount,
            reactivationLastPrice: conversationSessions.reactivationLastPrice,
            reactivationDiscountPct: conversationSessions.reactivationDiscountPct,
            bookedAt: conversationSessions.bookedAt,
          })
          .from(conversationSessions)
          .where(
            and(
              eq(conversationSessions.stage, "BOOKED"),
              gte(conversationSessions.createdAt, since),
            )
          )
          .orderBy(desc(conversationSessions.bookedAt));

        // ── Revenue helpers ──────────────────────────────────────────────────
        const channelLabel: Record<string, string> = {
          form: "Quote Form",
          widget: "Embedded Widget",
          reactivation: "Reactivation",
          voice: "Voice / Phone",
        };

        const channelMap = new Map<string, { revenue: number; jobs: number }>();
        let totalRevenue = 0;

        for (const s of bookedSessions) {
          const rev = calcBookedRevenue(s);
          totalRevenue += rev;
          const ch = s.leadSource ?? "form";
          const existing = channelMap.get(ch) ?? { revenue: 0, jobs: 0 };
          channelMap.set(ch, { revenue: existing.revenue + rev, jobs: existing.jobs + 1 });
        }

        const totalJobs = bookedSessions.length;
        const avgJobValue = totalJobs > 0 ? Math.round(totalRevenue / totalJobs) : 0;
        const roiDollars = totalRevenue - softwareCost * months;
        const roiMultiple = softwareCost > 0 ? parseFloat((totalRevenue / (softwareCost * months)).toFixed(1)) : 0;

        const byChannel = Array.from(channelMap.entries()).map(([channel, { revenue, jobs }]) => ({
          channel,
          label: channelLabel[channel] ?? channel,
          revenue,
          jobs,
          avgValue: jobs > 0 ? Math.round(revenue / jobs) : 0,
        })).sort((a, b) => b.revenue - a.revenue);

        // ── Monthly breakdown ────────────────────────────────────────────────
        const monthMap = new Map<string, { revenue: number; jobs: number }>();
        // Pre-fill all months with 0 so empty months still appear
        for (let i = months - 1; i >= 0; i--) {
          const d = new Date();
          d.setUTCMonth(d.getUTCMonth() - i);
          const key = d.toISOString().slice(0, 7); // "YYYY-MM"
          monthMap.set(key, { revenue: 0, jobs: 0 });
        }
        for (const s of bookedSessions) {
          const at = s.bookedAt ?? s.bookedAt;
          if (!at) continue;
          const key = (at instanceof Date ? at : new Date(at as string)).toISOString().slice(0, 7);
          if (!monthMap.has(key)) continue;
          const rev = calcBookedRevenue(s);
          const existing = monthMap.get(key)!;
          monthMap.set(key, { revenue: existing.revenue + rev, jobs: existing.jobs + 1 });
        }

        const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
        const byMonth = Array.from(monthMap.entries()).map(([month, { revenue, jobs }]) => {
          const [, mm] = month.split("-");
          return { month, label: monthNames[parseInt(mm, 10) - 1], revenue, jobs };
        });

        // ── Voice stats ──────────────────────────────────────────────────────
        const [voiceTotals] = await db
          .select({
            totalCalls: sql<number>`COUNT(*)`,
            avgDuration: sql<number>`AVG(durationSeconds)`,
            bookedViaCalls: sql<number>`SUM(CASE WHEN outcome = 'booked' THEN 1 ELSE 0 END)`,
          })
          .from(voiceCalls)
          .where(gte(voiceCalls.createdAt, since));

        const totalCalls = Number(voiceTotals?.totalCalls ?? 0);
        const bookedViaCalls = Number(voiceTotals?.bookedViaCalls ?? 0);
        const avgDurationSeconds = Math.round(Number(voiceTotals?.avgDuration ?? 0));
        const callConversionRate = totalCalls > 0 ? Math.round((bookedViaCalls / totalCalls) * 100) : 0;

        // ── Top 5 jobs by revenue ────────────────────────────────────────────
        const topJobs = bookedSessions
          .map(s => ({
            id: s.id,
            name: s.leadName ?? "Unknown",
            phone: s.leadPhone,
            revenue: calcBookedRevenue(s),
            bookedAt: s.bookedAt,
            channel: channelLabel[s.leadSource ?? "form"] ?? s.leadSource ?? "form",
          }))
          .sort((a, b) => b.revenue - a.revenue)
          .slice(0, 5);

        return {
          summary: { totalRevenue, totalJobs, avgJobValue, softwareCost, roiMultiple, roiDollars },
          byChannel,
          byMonth,
          voice: { totalCalls, bookedViaCalls, avgDurationSeconds, callConversionRate },
          topJobs,
        };
      }),

    /**
     * leads.yesterdayRecap — returns a summary of yesterday's lead activity.
     * Used by the DailyRecapModal on the admin dashboard.
     */
    yesterdayRecap: adminAgentProcedure.query(async () => {
      const db = await getDb();
      if (!db) return null;

      // Yesterday's date range in UTC
      const now = new Date();
      const yesterdayStart = new Date(now);
      yesterdayStart.setUTCDate(now.getUTCDate() - 1);
      yesterdayStart.setUTCHours(0, 0, 0, 0);
      const yesterdayEnd = new Date(yesterdayStart);
      yesterdayEnd.setUTCHours(23, 59, 59, 999);

      // All sessions created yesterday (excluding review and CS inbox sessions)
      const sessions = await db
        .select()
        .from(conversationSessions)
        .where(
          and(
            gte(conversationSessions.createdAt, yesterdayStart),
            lte(conversationSessions.createdAt, yesterdayEnd),
            ne(conversationSessions.leadSource, "review"),
            sql`(${conversationSessions.leadSource} IS NULL OR ${conversationSessions.leadSource} NOT IN ('cs-inbound', 'cs-inbound-cleaner'))`
          )
        );

      const totalLeads = sessions.length;

      // Booked sessions
      const booked = sessions.filter(s => s.stage === "BOOKED");
      const bookedCount = booked.length;

      // Revenue from booked sessions
      const bookedRevenue = booked.reduce((sum, s) => {
        const base = parseFloat(String(s.quotedPrice ?? 0));
        let extras = 0;
        try {
          const e = JSON.parse(s.extras ?? "[]");
          extras = Array.isArray(e) ? calculateExtrasTotal(e) : 0;
        } catch { /* ignore */ }
        return sum + base + extras;
      }, 0);

      // Stage breakdown
      const stageCounts: Record<string, number> = {};
      for (const s of sessions) {
        stageCounts[s.stage] = (stageCounts[s.stage] ?? 0) + 1;
      }

      // Source breakdown
      const sourceCounts: Record<string, number> = {};
      for (const s of sessions) {
        const src = s.utmSource ?? s.leadSource ?? "Direct";
        sourceCounts[src] = (sourceCounts[src] ?? 0) + 1;
      }
      const topSource = Object.entries(sourceCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

      // Agent leaderboard — who booked the most yesterday
      const agentBookings: Record<string, { name: string; count: number; revenue: number }> = {};
      for (const s of booked) {
        if (!s.lastCalledByAgentName) continue;
        const name = s.lastCalledByAgentName;
        if (!agentBookings[name]) agentBookings[name] = { name, count: 0, revenue: 0 };
        agentBookings[name].count++;
        const base = parseFloat(String(s.quotedPrice ?? 0));
        let extras = 0;
        try {
          const e = JSON.parse(s.extras ?? "[]");
          extras = Array.isArray(e) ? calculateExtrasTotal(e) : 0;
        } catch { /* ignore */ }
        agentBookings[name].revenue += base + extras;
      }
      const agentLeaderboard = Object.values(agentBookings).sort((a, b) => b.count - a.count).slice(0, 5);

      // Pending follow-ups from yesterday still needing action
      const pendingFollowUps = sessions
        .filter(s => ["FOLLOW_UP", "AVAILABILITY", "QUOTE_SENT"].includes(s.stage))
        .slice(0, 5)
        .map(s => ({
          id: s.id,
          name: s.leadName ?? "Unknown",
          phone: s.leadPhone ?? "",
          stage: s.stage,
          service: s.serviceType ?? null,
          quotedPrice: s.quotedPrice ? parseFloat(String(s.quotedPrice)) : null,
        }));

      // Conversion rate
      const conversionRate = totalLeads > 0 ? Math.round((bookedCount / totalLeads) * 100) : 0;

      return {
        date: yesterdayStart.toISOString().split("T")[0],
        totalLeads,
        bookedCount,
        bookedRevenue: Math.round(bookedRevenue),
        conversionRate,
        stageCounts,
        topSource,
        agentLeaderboard,
        pendingFollowUps,
      };
    }),

    /**
     * leads.getById — fetch a single conversation session by its ID.
     * Used by the activity feed to open the drawer for a specific lead.
     */
    getById: publicProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .query(async ({ input }) => {
        const db = await getDb();
        if (!db) return null;
        const rows = await db
          .select()
          .from(conversationSessions)
          .where(eq(conversationSessions.id, input.id))
          .limit(1);
        return rows[0] ?? null;
      }),

    getCustomerHistory: publicProcedure
      .input(z.object({ phone: z.string() }))
      .query(async ({ input }) => {
        const db = await getDb();
        if (!db) return null;
        // Find the most recent completed job for this phone
        const rows = await db
          .select({
            id: completedJobs.id,
            name: completedJobs.name,
            firstName: completedJobs.firstName,
            address: completedJobs.address,
            lastBookingPrice: completedJobs.lastBookingPrice,
            jobDate: completedJobs.jobDate,
            serviceType: completedJobs.serviceType,
            frequency: completedJobs.frequency,
            bedrooms: completedJobs.bedrooms,
            bathrooms: completedJobs.bathrooms,
          })
          .from(completedJobs)
          .where(eq(completedJobs.phone, input.phone))
          .orderBy(desc(completedJobs.jobDate))
          .limit(1);
        return rows[0] ?? null;
      }),

    /**
     * leads.markAsLost — agent marks a lead as lost/dead via the 3-dot menu.
     * Sets stage to LOST, turns off AI mode, and logs activity.
     */
    markAsLost: agentProcedure
      .input(z.object({
        sessionId: z.number().int().positive(),
        lostReason: z.enum(["price", "timing", "no_response", "competitor", "other"]).optional(),
      }))
      .mutation(async ({ input }) => {
        const db = await getDb();
        if (!db) throw new Error("Database unavailable");
        // Fetch session for logging
        const rows = await db
          .select({ leadName: conversationSessions.leadName, leadPhone: conversationSessions.leadPhone })
          .from(conversationSessions)
          .where(eq(conversationSessions.id, input.sessionId))
          .limit(1);
        const session = rows[0];
        await db
          .update(conversationSessions)
          .set({ stage: "LOST" as any, aiMode: 0, isBooked: 0, lostReason: input.lostReason ?? null })
          .where(eq(conversationSessions.id, input.sessionId));
        const reasonLabel = input.lostReason
          ? { price: "Price", timing: "Timing", no_response: "No Response", competitor: "Competitor", other: "Other" }[input.lostReason]
          : "Unknown";
        logActivity({
          eventType: "lead_lost",
          title: `${session?.leadName ?? session?.leadPhone ?? "Lead"} marked as Lost`,
          body: `Reason: ${reasonLabel}. Marked via pipeline card menu.`,
          meta: { sessionId: input.sessionId, leadPhone: session?.leadPhone, leadName: session?.leadName, lostReason: input.lostReason },
        }).catch(() => {});
        return { success: true };
      }),

    /**
     * leads.restoreFromLost — restore a LOST lead back to FOLLOW_UP_SCHEDULED.
     */
    restoreFromLost: adminAgentProcedure
      .input(z.object({ sessionId: z.number().int().positive() }))
      .mutation(async ({ input }) => {
        const db = await getDb();
        if (!db) throw new Error("Database unavailable");
        const rows = await db
          .select({ leadName: conversationSessions.leadName, leadPhone: conversationSessions.leadPhone })
          .from(conversationSessions)
          .where(eq(conversationSessions.id, input.sessionId))
          .limit(1);
        const session = rows[0];
        await db
          .update(conversationSessions)
          .set({ stage: "FOLLOW_UP_SCHEDULED" as any })
          .where(eq(conversationSessions.id, input.sessionId));
        logActivity({
          eventType: "new_lead",
          title: `${session?.leadName ?? session?.leadPhone ?? "Lead"} restored from Lost`,
          body: "Lead restored to Follow-Up Scheduled via pipeline card menu.",
          meta: { sessionId: input.sessionId, leadPhone: session?.leadPhone, leadName: session?.leadName },
        }).catch(() => {});
        return { success: true };
      }),

    /**
     * leads.getTodayFollowUps — returns leads whose followUpDate is today (YYYY-MM-DD)
     * and followUpSent = 0. Used to drive the follow-up reminder toast in the dashboard.
     */
    getTodayFollowUps: adminAgentProcedure
      .query(async () => {
        const db = await getDb();
        if (!db) return [];
        const today = new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD in local time
        const rows = await db
          .select({
            id: conversationSessions.id,
            leadName: conversationSessions.leadName,
            leadPhone: conversationSessions.leadPhone,
            followUpDate: conversationSessions.followUpDate,
            followUpMessage: conversationSessions.followUpMessage,
            stage: conversationSessions.stage,
          })
          .from(conversationSessions)
          .where(
            and(
              eq(conversationSessions.followUpDate, today),
              eq(conversationSessions.followUpSent, 0)
            )
          );
        return rows;
      }),

    /**
     * leads.dismissFollowUp — marks a follow-up as seen (followUpSent = 1).
     * Called when an agent dismisses or opens a follow-up reminder toast.
     * The server will no longer return this lead in getTodayFollowUps.
     */
    dismissFollowUp: adminAgentProcedure
      .input(z.object({ sessionId: z.number().int().positive() }))
      .mutation(async ({ input }) => {
        const db = await getDb();
        if (!db) return { ok: false };
        await db
          .update(conversationSessions)
          .set({ followUpSent: 1 })
          .where(eq(conversationSessions.id, input.sessionId));
        return { ok: true };
      }),

    /**
     * leads.getCallRecordings — returns all call recordings for a session.
     * Sorted by callStartedAt ascending so they appear in chronological order
     * when merged into the conversation thread.
     */
    getCallRecordings: adminAgentProcedure
      .input(z.object({ sessionId: z.number().int().positive() }))
      .query(async ({ input }) => {
        const db = await getDb();
        if (!db) return [];
        return db
          .select()
          .from(openphoneCallRecordings)
          .where(eq(openphoneCallRecordings.sessionId, input.sessionId))
          .orderBy(openphoneCallRecordings.callStartedAt);
      }),
    /**
     * leads.getLatestCallDebrief — returns the most recent AI post-call debrief
     * for a session. Used to show the debrief card in the CS inbox chat thread.
     */
    getLatestCallDebrief: adminAgentProcedure
      .input(z.object({ sessionId: z.number().int().positive() }))
      .query(async ({ input }) => {
        const db = await getDb();
        if (!db) return null;
        const rows = await db
          .select({
            id: openphoneCallRecordings.id,
            callDebrief: openphoneCallRecordings.callDebrief,
            recordingUrl: openphoneCallRecordings.recordingUrl,
          })
          .from(openphoneCallRecordings)
          .where(eq(openphoneCallRecordings.sessionId, input.sessionId))
          .orderBy(desc(openphoneCallRecordings.id))
          .limit(10);
        const withDebrief = rows.find((r) => r.callDebrief);
        if (!withDebrief?.callDebrief) return null;
        try {
          const parsed = JSON.parse(withDebrief.callDebrief as string);
          const recordingUrl = withDebrief.recordingUrl as string | null;
          // Exclude synthetic backfill placeholder URLs
          const audioUrl = recordingUrl && !recordingUrl.includes('synthetic-backfill') ? recordingUrl : null;
          return {
            grade: (parsed.grade as string) || null,
            wentWell: parsed.wentWell as string,
            improve: parsed.improve as string,
            nextLine: parsed.nextLine as string,
            generatedAt: parsed.generatedAt as number,
            audioUrl,
          };
        } catch {
          return null;
        }
      }),
    /**
     * leads.getRecentCallRecordings — returns the most recent call recordings across all sessions.
     * Used by CommandChat to show call debrief cards without depending on live webhooks.
     */
    getRecentCallRecordings: adminAgentProcedure
      .input(z.object({ limit: z.number().int().positive().max(50).default(20) }))
      .query(async ({ input }) => {
        const db = await getDb();
        if (!db) return [];
        return db
          .select()
          .from(openphoneCallRecordings)
          .orderBy(desc(openphoneCallRecordings.callStartedAt))
          .limit(input.limit);
      }),
    /**
     * leads.getSessionsWithRecordingss — returns a map of sessionId → { hasRecording, hasTranscript, callScore }
     * Used to show call/transcript indicator badges on lead list rows without a heavy JOIN.
     */
    getSessionsWithRecordings: adminAgentProcedure
      .query(async () => {
        const db = await getDb();
        if (!db) return {};
        const rows = await db
          .select({
            sessionId: openphoneCallRecordings.sessionId,
            transcript: openphoneCallRecordings.transcript,
            callScore: openphoneCallRecordings.callScore,
          })
          .from(openphoneCallRecordings);
        // Aggregate per session: any recording = hasRecording, any non-null transcript = hasTranscript
        const map: Record<number, { hasRecording: boolean; hasTranscript: boolean; callScore: number | null }> = {};
        for (const row of rows) {
          const existing = map[row.sessionId];
          if (!existing) {
            map[row.sessionId] = {
              hasRecording: true,
              hasTranscript: !!row.transcript,
              callScore: row.callScore ?? null,
            };
          } else {
            existing.hasTranscript = existing.hasTranscript || !!row.transcript;
            if (row.callScore != null && (existing.callScore == null || row.callScore > existing.callScore)) {
              existing.callScore = row.callScore;
            }
          }
        }
        return map;
      }),

    /**
     * leads.scoreCall — AI-powered call scoring against a home services sales rubric.
     *
     * Evaluates the transcript against best-in-class home services sales strategies,
     * returns a score out of 100 with category breakdowns and coaching tips.
     * Caches result in callScore + scoreData columns.
     */
    scoreCall: adminAgentProcedure
      .input(z.object({ recordingId: z.number().int().positive() }))
      .mutation(async ({ input }) => {
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
        const rows = await db
          .select()
          .from(openphoneCallRecordings)
          .where(eq(openphoneCallRecordings.id, input.recordingId))
          .limit(1);
        const recording = rows[0];
        if (!recording) throw new TRPCError({ code: "NOT_FOUND", message: "Recording not found" });
        if (!recording.transcript) throw new TRPCError({ code: "BAD_REQUEST", message: "No transcript available for this call" });

        // Parse transcript — supports both dialogue array and raw text
        let transcriptText = "";
        try {
          const parsed = JSON.parse(recording.transcript) as Array<{ identifier?: string; content?: string; speaker?: string; text?: string }>;
          if (Array.isArray(parsed)) {
            transcriptText = parsed.map(t => {
              const speaker = t.identifier || t.speaker || "Speaker";
              const text = t.content || t.text || "";
              return `${speaker}: ${text}`;
            }).join("\n");
          } else {
            transcriptText = recording.transcript;
          }
        } catch {
          transcriptText = recording.transcript;
        }

        const scoringPrompt = `You are a world-class sales coach specializing in home services (cleaning, HVAC, plumbing, landscaping). You have studied thousands of the highest-converting home services sales calls.

Score the following phone call transcript against the best home services sales professionals. Use this rubric:

1. **Opening & Pattern Interrupt** (0-15 pts)
   - Did the rep create immediate rapport and curiosity?
   - Did they avoid a generic opener?
   - Did they establish credibility quickly?

2. **Needs Discovery & Pain Amplification** (0-20 pts)
   - Did they ask open-ended questions to uncover the real need?
   - Did they dig into urgency, timeline, and emotional drivers?
   - Did they let the customer talk and actively listen?

3. **Value Anchoring Before Price** (0-15 pts)
   - Did they build value BEFORE mentioning price?
   - Did they tie the service to the customer's specific situation?
   - Did they use social proof or specific outcomes?

4. **Objection Handling** (0-20 pts)
   - Did they handle objections with empathy and confidence?
   - Did they use the Feel/Felt/Found or similar framework?
   - Did they turn objections into reasons to buy?

5. **Assumptive Closing & Urgency** (0-15 pts)
   - Did they use assumptive language ("When we come out..." vs "If you decide...")
   - Did they create real urgency without being pushy?
   - Did they ask for the booking confidently?

6. **Follow-Through & Next Steps** (0-15 pts)
   - Did they secure a clear next action (booking, callback, etc.)?
   - Did they leave the door open professionally if not closed?
   - Did they end on a positive, memorable note?

TRANSCRIPT:
${transcriptText}

Respond with ONLY valid JSON in this exact format:
{
  "overallScore": <number 0-100>,
  "categories": [
    { "name": "Opening & Pattern Interrupt", "score": <0-15>, "maxScore": 15, "feedback": "<specific feedback referencing the call>" },
    { "name": "Needs Discovery & Pain Amplification", "score": <0-20>, "maxScore": 20, "feedback": "<specific feedback>" },
    { "name": "Value Anchoring Before Price", "score": <0-15>, "maxScore": 15, "feedback": "<specific feedback>" },
    { "name": "Objection Handling", "score": <0-20>, "maxScore": 20, "feedback": "<specific feedback>" },
    { "name": "Assumptive Closing & Urgency", "score": <0-15>, "maxScore": 15, "feedback": "<specific feedback>" },
    { "name": "Follow-Through & Next Steps", "score": <0-15>, "maxScore": 15, "feedback": "<specific feedback>" }
  ],
  "strengths": ["<specific strength from this call>", "<another strength>"],
  "improvements": ["<specific improvement with example of what to say instead>", "<another improvement>"],
  "coachingTips": ["<actionable tip for next call>", "<another tip>", "<third tip>"],
  "summary": "<2-3 sentence overall assessment of this call>"
}`;

        const llmResult = await invokeLLM({
          messages: [
            { role: "system", content: "You are a world-class home services sales coach. Always respond with valid JSON only, no markdown, no explanation." },
            { role: "user", content: scoringPrompt },
          ],
          response_format: { type: "json_object" },
        });

        const rawContentRaw = llmResult?.choices?.[0]?.message?.content;
        const rawContent = typeof rawContentRaw === "string" ? rawContentRaw : "{}";
        let scoreResult: {
          overallScore: number;
          categories: Array<{ name: string; score: number; maxScore: number; feedback: string }>;
          strengths: string[];
          improvements: string[];
          coachingTips: string[];
          summary: string;
        };
        try {
          scoreResult = JSON.parse(rawContent);
        } catch {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "AI returned invalid JSON" });
        }

        // Store in DB
        await db
          .update(openphoneCallRecordings)
          .set({
            callScore: scoreResult.overallScore,
            scoreData: JSON.stringify(scoreResult),
          })
          .where(eq(openphoneCallRecordings.id, input.recordingId));

        return scoreResult;
      }),

    /**
     * leads.getObjectionRebuttal — AI-powered live call objection rebuttal.
     * Used by the CallGuide widget. Takes the customer's objection text and returns
     * a ready-to-say rebuttal script based on home services sales best practices.
     */
    getObjectionRebuttal: adminAgentProcedure
      .input(z.object({ objection: z.string().min(1).max(500) }))
      .mutation(async ({ input }) => {
        const prompt = `You are a world-class home services sales coach. An agent is on a live call right now and the customer just said:

"${input.objection}"

Write a single, ready-to-say rebuttal script the agent can use immediately. Requirements:
- 2-4 sentences max
- Empathize first, then redirect
- Natural, conversational tone (not robotic)
- Based on highest-converting home services sales techniques
- Do NOT use bullet points or headers — just the script they say out loud
- Start with an empathy phrase, then pivot to value or urgency

Return ONLY the script text, nothing else.`;
        const llmResult = await invokeLLM({
          messages: [
            { role: "system", content: "You are a world-class home services sales coach. Return only the rebuttal script, no explanation." },
            { role: "user", content: prompt },
          ],
        });
        const rebuttalRaw = llmResult?.choices?.[0]?.message?.content;
        const rebuttal = (typeof rebuttalRaw === "string" ? rebuttalRaw : "").trim() || "I understand — let me address that for you.";
        return { rebuttal };
      }),

    /**
     * leads.getClosingRecommendation — AI-powered closing recommendation.
     *
     * Analyzes the full conversation history, detects the objection type,
     * and returns a world-class SMS closing strategy based on top-closer frameworks.
     */
    getClosingRecommendation: adminAgentProcedure
      .input(z.object({ sessionId: z.number().int().positive() }))
      .query(async ({ input }) => {
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
        const rows = await db
          .select()
          .from(conversationSessions)
          .where(eq(conversationSessions.id, input.sessionId))
          .limit(1);
        const session = rows[0];
        if (!session) throw new TRPCError({ code: "NOT_FOUND", message: "Session not found" });
        // Parse conversation history
        let messages: Array<{ role: string; content: string; ts?: number }> = [];
        try { messages = JSON.parse(session.messageHistory ?? "[]"); } catch { messages = []; }
        const currentMsgLen = (session.messageHistory ?? "").length;
        // ── Cache hit check ──────────────────────────────────────────────────
        // Return cached recommendation if message history hasn't changed since last analysis
        if (
          session.aiClosingRecCache &&
          session.aiClosingRecMsgLen === currentMsgLen
        ) {
          try {
            const cached = JSON.parse(session.aiClosingRecCache) as {
              objectionType: string; objectionSummary: string; primaryMove: string;
              primaryMoveRationale: string; suggestedMessage: string;
              alternativeMoves: string[]; urgencyLevel: string; confidence: number;
            };
            return { success: true as const, ...cached };
          } catch { /* cache corrupted — fall through to LLM */ }
        }

        // Build a compact conversation transcript for the LLM (last 20 messages)
        const transcript = messages
          .filter(m => m.role === "user" || m.role === "assistant")
          .slice(-20)
          .map(m => `${m.role === "user" ? "CUSTOMER" : "AGENT"}: ${m.content}`)
          .join("\n");

        const leadContext = [
          session.leadName ? `Lead name: ${session.leadName}` : null,
          session.quotedPrice ? `Quoted price: $${session.quotedPrice}` : null,
          session.serviceType ? `Service: ${session.serviceType}` : null,
          session.followUpDate ? `Follow-up date: ${session.followUpDate}` : null,
          session.stage ? `Current stage: ${session.stage}` : null,
          session.leadSource ? `Lead source: ${session.leadSource}` : null,
        ].filter(Boolean).join("\n");

        const systemPrompt = `You are an elite SMS sales closer who has studied the top 1% of home services closers.
You specialize in converting warm leads who have gone quiet or raised objections via SMS.
Your recommendations are based on proven frameworks used by top closers:
- Pattern interrupt: break the lead's inertia with an unexpected angle
- Soft lock: create a low-pressure commitment that's easy to say yes to
- Social proof urgency: "we're filling up" without being pushy
- Discount fill: use a schedule gap as a natural reason to offer value
- Assumptive close: act as if the booking is happening, just confirming details
- Re-engagement: for cold leads, a curiosity-driven opener that gets a reply

Always write SMS messages that sound like a real human, not a bot. Short, warm, direct.`;

        const userPrompt = `LEAD CONTEXT:
${leadContext}

CONVERSATION TRANSCRIPT (most recent 20 messages):
${transcript || "(no messages yet — lead just submitted the form)"}

Analyze this conversation and return a JSON object with exactly these fields:
- objectionType: one of ["timing", "price", "not_ready", "trust", "competitor", "no_response", "needs_info", "none"]
- objectionSummary: 4-5 word phrase capturing where the conversation left off (e.g. "Said okay for now", "Waiting until May", "Needs price confirmation", "Booked, service confirmed")
- primaryMove: the single best closing action right now (8 words max, action-oriented, e.g. "Soft-lock a May date now")
- primaryMoveRationale: why this specific move works for this objection (1-2 sentences, name the framework)
- suggestedMessage: the exact SMS to send — personalized to the lead's first name, conversational, no emojis, under 160 chars, sounds like a real person not a script
- alternativeMoves: array of exactly 3 alternative action labels (4-6 words each)
- alternativeMessages: array of exactly 3 SMS messages — one for each alternativeMove, same rules as suggestedMessage (personalized, conversational, no emojis, under 160 chars, sounds like a real person)
- urgencyLevel: one of ["low", "medium", "high"] based on how close this lead is to going cold forever
- confidence: integer 0-100 representing confidence in this recommendation`;

        try {
          const response = await invokeLLM({
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: userPrompt },
            ],
            response_format: {
              type: "json_schema",
              json_schema: {
                name: "closing_recommendation",
                strict: true,
                schema: {
                  type: "object",
                  properties: {
                    objectionType: { type: "string" },
                    objectionSummary: { type: "string" },
                    primaryMove: { type: "string" },
                    primaryMoveRationale: { type: "string" },
                    suggestedMessage: { type: "string" },
                    alternativeMoves: { type: "array", items: { type: "string" } },
                    alternativeMessages: { type: "array", items: { type: "string" } },
                    urgencyLevel: { type: "string" },
                    confidence: { type: "number" },
                  },
                  required: ["objectionType", "objectionSummary", "primaryMove", "primaryMoveRationale", "suggestedMessage", "alternativeMoves", "alternativeMessages", "urgencyLevel", "confidence"],
                  additionalProperties: false,
                },
              },
            },
          });
          const rawContent = response.choices?.[0]?.message?.content;
          const content = typeof rawContent === "string" ? rawContent : null;
          if (!content) throw new Error("Empty LLM response");
          const rec = JSON.parse(content) as {
            objectionType: string;
            objectionSummary: string;
            primaryMove: string;
            primaryMoveRationale: string;
            suggestedMessage: string;
            alternativeMoves: string[];
            alternativeMessages: string[];
            urgencyLevel: string;
            confidence: number;
          };
          // ── Write to cache ────────────────────────────────────────────────
          try {
            await db
              .update(conversationSessions)
              .set({
                aiClosingRecCache: JSON.stringify(rec),
                aiClosingRecCachedAt: new Date(),
                aiClosingRecMsgLen: currentMsgLen,
              })
              .where(eq(conversationSessions.id, input.sessionId));
          } catch { /* cache write failure is non-fatal */ }
          return { success: true as const, ...rec };
        } catch {
          // Graceful fallback — never crash the drawer
          return {
            success: false as const,
            objectionType: "unknown",
            objectionSummary: "Could not analyze conversation",
            primaryMove: "Send a follow-up message",
            primaryMoveRationale: "Keep the conversation warm.",
            suggestedMessage: "",
            alternativeMoves: ["Soft check-in", "Offer discount", "Set reminder"],
            alternativeMessages: ["", "", ""],
            urgencyLevel: "medium",
            confidence: 0,
          };
        }
      }),

    /**
     * leads.getLiveCallSuggestions — AI-powered real-time call coaching.
     *
     * Takes the current sales stage, recent transcript lines typed by the agent,
     * and optional lead context. Returns the single best thing for the agent to say
     * right now, based on world-class home service sales technique.
     */
    getLiveCallSuggestions: opsChatProcedure
      .input(z.object({
        stage: z.string().min(1),
        transcript: z.string().max(6000),
        leadName: z.string().optional(),
        serviceType: z.string().optional(),
        quotedPrice: z.string().optional(),
        recurringPrice: z.string().optional(),
        lastCustomerLine: z.string().max(1000).optional(),
        context: z.string().max(500).optional(),
        isOutbound: z.boolean().optional(),
        knownFields: z.string().max(300).optional(),
      }))
      .mutation(async ({ input }) => {

          const systemPrompt = `You are a live sales coach feeding the next line to a phone agent at Maids in Black — a professional home cleaning company in Washington DC/MD/VA.

YOUR ONLY JOB: Read the full conversation transcript. Figure out exactly where things stand right now. Give the agent the single best next line to say — adapted from the script below to fit this specific moment.

━━━ THE MOST IMPORTANT RULE ━━━
THE CONVERSATION IS THE GROUND TRUTH.
Before you write a single word, read every line of the transcript.
Anything already said is already known. NEVER ask for it again. Not once. Not "just to confirm."
If the customer said "3 bedrooms" — bedrooms = 3. Done. Move on.
If they said "next Friday" — date = next Friday. Done. Move on.
If you ask for something that's already in the transcript, you have failed.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

THE CALL SCRIPT — follow this flow in order. Adapt the exact language to what the customer just said, but stay close to these words:

CONTEXT: The agent has ALREADY delivered the opener AND the warm acknowledgment ("Perfect. I just want to say — thank you so much for considering us..."). The customer has confirmed they're available and agreed to answer a couple questions. DO NOT repeat either of those lines. Start directly from STEP 3.

STEP 3 — HOME DETAILS (ask ONE at a time — never combine):
"Tell me a little about your place — is it a house, condo, apartment? And roughly how many bedrooms and bathrooms are we looking at?"

STEP 4 — MOTIVATION (why are they looking now):
"What's prompting you to look for a cleaning service right now — is this your first time using one, or are you looking to switch from someone?"

STEP 5 — FREQUENCY INTENT:
"What would a perfect cleaning situation look like for you — are you thinking a one-time deep clean, or would you love something recurring so you never have to think about it again?"

STEP 6 — DATE/TIMELINE:
"Is there a specific date you're hoping to have it done by — like an event, guests coming, or just as soon as possible?"

STEP 7 — RECAP (mirror back everything they said, bridge to value):
"Okay, so here's what I'm hearing — you have a [X-bed, Y-bath home], you want [recurring/one-time service], and ideally you'd have this locked in by [their date]. That's totally doable for us. Let me tell you a little about how we're different, and then I'll give you a number that actually makes sense for your situation."

STEP 8 — VALUE PITCH (deliver this before any price):
"A few things our clients love about us: every cleaner is background-checked and trained — these aren't day-labor hires. We use eco-friendly products, so it's safe for kids and pets. We're fully insured. And our biggest thing? We have a 100% re-clean guarantee — if you're not happy, we come back within 24 hours, no charge, no questions. A lot of people come to us after being burned by someone who just... disappeared."

STEP 9 — PRICE (only after value pitch, with confidence):
"Based on everything you've told me, for your [home size] I'd put you in at [price] for the first deep clean to get everything to our standard, and then [recurring price] every [frequency] after that. That first clean is more thorough because we're starting fresh — after that it's maintenance and stays at the lower rate."

STEP 10 — CLOSE (assume the booking, offer two time slots):
"I actually have [Tuesday at 10am] and [Thursday at 2pm] open this week — which of those works better for you?"

STEP 11 — BOOKING CONFIRMATION:
"Perfect. I'm going to grab your address and I'll send you a confirmation text and email right now. You'll get a reminder the day before, and you'll get a text message with a link — with one click you'll see when the team is on their way. You won't have to wonder about anything."

STEP 12 — PERSONAL TOUCH (say this once, then immediately move to STEP 13):
Template: "And [First Name] — I'm going to put a personal note on your file so your cleaner knows [DETAIL]. We want this to feel like we've been taking care of your home for years, even on the first visit."
CRITICAL: Replace [DETAIL] with something SPECIFIC the customer actually mentioned in the conversation — a pet name, that they have guests coming, that it's been a while, that they have a newborn, that they're moving out, etc. NEVER output the literal placeholder text. If nothing specific was mentioned, use "exactly how you like things done".
IMPORTANT: After delivering STEP 12, move IMMEDIATELY to STEP 13. Do NOT wait for a response. Do NOT repeat STEP 12.
STEP 13 — CARD COLLECTION (say this right after STEP 12, no pause needed):
"Perfect, you're all set — I just need a card to secure the booking. Nothing gets charged until after your clean, so no worries there. What card works best for you?"
STEP 14 — CLOSING (after they give the card):
"You're all set! Your cleaner will be there [day] at [time] — you don't have to do a thing. We'll send a reminder the day before and a text with your link to get updates when they're on their way. You're going to love coming home. Thanks again and we'll see you soon."
━━━ OBJECTION HANDLING ━━━━
When the customer pushes back, use these exact responses (adapted naturally to what they said):

OBJECTION: "That's too expensive" / price concern:
"I totally hear you — and I'd rather you feel great about this than pressured. Can I ask — too expensive compared to what? ...If it's compared to doing it yourself, I'd love to show you how our recurring rate breaks down per hour. Most of our clients tell us it's the first thing they'd cut last, because getting that time back is priceless. Would it help if we started with just one clean so you can see what you're getting before committing?"
If they compare to a cheaper option: "Totally fair to shop around. What we can promise is insured, vetted cleaners and a satisfaction guarantee — if something's missed, we come back. Does that matter to you?"
If budget is genuine: "Let me check if there's a lighter package that fits. What rooms absolutely have to be done?"

OBJECTION: "I need to think about it" / "I need to talk to my spouse":
"Completely makes sense — this is your home and it should be a comfortable decision. Quick question: is there anything specific you're unsure about that I can help clear up right now, or is it more just the timing? ...What I can do is hold that slot for you for 24 hours — if you haven't heard from me by tomorrow at noon, I'll release it. Would that take the pressure off?"

OBJECTION: "I already have someone":
"That's great — it sounds like keeping a clean home matters to you. Can I ask, is there anything about your current person that you wish were a little different? ...A lot of our best clients came from situations where their old cleaner was fine — just not consistent, or communication was hard, or they kept sending different people. If any of that rings true, I'd love to earn a shot. Even just a one-time deep clean as a comparison — no commitment."

OBJECTION: "Can you do it cheaper?":
"I wish I could just say yes — but here's the thing: the reason our clients stay with us is because we don't cut corners to win the job and then disappoint. What I can do is offer a slightly smaller scope or adjust frequency to bring it into your budget while keeping the quality exactly the same. Want me to run those numbers real quick?"

OBJECTION: "I'm not ready yet" / "bad timing":
"No problem at all — timing is everything. When would be a better time? ...What if I reached back out in two weeks? In the meantime, I'll send you our info and a few reviews so when you're ready, you're not starting from scratch. Fair?"

OBJECTION: "I'm getting a few quotes" / shopping around:
"Smart — you absolutely should. Here's what I'd suggest comparing: not just price, but whether they're insured, whether they background-check, what their re-clean policy is if something's missed, and whether you'll always get the same cleaner. A lot of companies look the same until something goes wrong. We're happy to stand up to that comparison. Would you like me to send you a quick checklist of what to ask the others?"
If they want time: "Of course! Want me to hold a slot for 48 hours? No charge, zero obligation."

OBJECTION: "I don't know you" / trust concern:
"That's completely fair — you're letting someone into your home. Every cleaner on our team is background-checked, interviewed in person, and insured. We're not a gig app — these are our people, and we stand behind their work. We've cleaned hundreds of homes in your zip code. What would make you feel most comfortable — seeing reviews, or knowing our satisfaction guarantee covers you?"
If they want references: "I'll text you three verified Google reviews from clients in your neighborhood right now."
If still hesitant: "We offer a full refund on your first clean if you're not happy — no questions. Does that take the risk off the table?"

OBJECTION: Not sure about date:
"Totally get it — calendars can be tricky! What I can do is lock in your spot tentatively — no stress, no penalty if life happens. We just ask for 24 hours' notice to shift it. Which time window feels roughly right — mornings or afternoons? Let's start there and we'll nail down the exact day together."
If they hesitate: "I can hold that spot for 24 hours while you check — no card needed yet. Want me to do that?"

OBJECTION: Had a bad experience:
"I'm really sorry that happened — honestly, it's way too common. That's exactly why we built things differently. Our cleaners aren't random — they're trained, rated after every job, and you get the same person each time so they know your home. If anything's ever off, we fix it within 24 hours, free. What specifically went wrong before? I want to make sure we address it directly."
If they mention no-shows: "We have a 99.2% on-time record and send a 30-min heads-up text every time. That's a promise."
If they mention damage: "We're fully insured — any accidental damage is covered."

OBJECTION: Won't be home / access concern:
"Super common — most of our clients aren't home during the clean! A lot of people leave a key in a lockbox, use a door code, or have a neighbor let us in. You'll get a text when the cleaner arrives and when they leave, with photos. How do you currently handle access for other services like deliveries? We can likely work the same way."

OBJECTION: More questions:
"Absolutely, ask me anything — I want you to feel completely informed." [Answer their question clearly and briefly, then:] "Does that answer it fully? Great — so the only thing left is picking a time that works for you. What does your week look like?"
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

--- MAIDS IN BLACK COMPANY KNOWLEDGE ---
Use this to answer any customer question naturally and confidently. Never say "I don't know" — you know everything about this company.

COMPANY:
- Professional home cleaning company serving Washington DC and the entire DMV (DC, Maryland, Virginia)
- Phone: 202-888-5362 | Email: support@maidsinblacksupport.com
- Address: 5028 Wisconsin Ave #109, Washington DC
- Service areas: All of DC (Georgetown, Capitol Hill, Dupont Circle, Adams Morgan, etc.), Maryland (Bethesda, Silver Spring, Rockville, Germantown, Bowie, etc.), Virginia (Arlington, Alexandria, Fairfax, McLean, Reston, Tysons Corner, etc.)

SERVICES:
- Standard Cleaning: dusting, vacuuming, mopping, bathroom & kitchen cleaning, surface wiping. Best for homes already well-maintained.
- Deep Cleaning: everything in standard + scrubbing baseboards, inside appliances (on request), detailed bathroom scrubbing, built-up grime. Recommended for first-time clients, seasonal refreshes, or if it's been a while.
- Move-In / Move-Out Cleaning: full deep clean including inside cabinets, drawers, all appliances (oven, fridge, microwave, dishwasher), floors, walls, baseboards. Takes 4-8 hours.
- Post-Construction / Renovation Cleaning: heavy-duty cleaning after construction work.
- Airbnb / Short-Term Rental Cleaning: full property reset, linen changes, restocking essentials, same-day turnover available.
- Office / Commercial Cleaning: dusting, vacuuming, disinfecting high-touch surfaces, restrooms, breakrooms, common areas.
- Event Cleaning: pre-event and post-event, indoor and outdoor venues, same-day/overnight available.
- Spring Cleaning: seasonal deep clean.
- Senior Cleaning: specialized service for seniors.

WHAT'S INCLUDED (all services):
- Professional-grade eco-friendly cleaning products (green/safe for kids and pets)
- All supplies and equipment brought by the team — customer provides nothing
- Fully insured and bonded
- Background-checked, screened, and interviewed team members
- Two-person teams for most jobs
- Same team assigned for recurring services (consistency)

PRICING & PAYMENT:
- Instant quotes available online or by phone based on home size and service type
- No hidden fees, upfront pricing
- Card charged ONLY after service is completed — never before
- No deposit required to book — just a valid card on file to hold the spot
- Accepts all major credit and debit cards (no cash or checks)
- Tips optional, appreciated — cash or added to card after service
- Recurring discounts: 10% off monthly, 15% off biweekly

SCHEDULING & CANCELLATION:
- Book online in 60 seconds or by phone
- Same-day service available based on availability
- Cancel or reschedule with at least 24 hours notice — no fee
- Late cancellations may incur a fee
- Confirmation email sent after booking

GUARANTEE:
- 200% Satisfaction Guarantee: if not happy, contact within 24 hours and they'll return to re-clean at no cost
- Re-clean scheduled within 1-2 business days
- Customer must be present for re-clean to sign off
- Guarantee covers all service types

TEAM:
- One of the lowest turnover rates in the industry
- All background-checked, multi-interview screening process
- Fully insured to enter your home
- Above-average pay — motivated, cared-for teams
- 15 office support staff backing the field teams

DAY OF SERVICE (what to tell customers who ask what happens after they book):
- They'll receive a text message with real-time updates as the cleaner is on the way
- They can track and communicate with the team directly from their phone
- After the service, they'll get a text to rate their cleaner from their phone
- Rating helps them find their perfect fit and ensures consistency on future visits
- Confirmation email sent right after booking with all service details

FAQs:
- Do I need to be home? No — just provide access instructions. Many clients leave a key.
- How long does it take? Standard: 2-4 hours. Deep/move-out: 4-8 hours. Depends on home size.
- Do you clean inside appliances on standard? No — add it as an extra. Included in move-out.
- Do you bring supplies? Yes, everything. Customer provides nothing.
- Are you insured? Yes, fully bonded and insured.
- Do you offer gift cards? Yes.
- Can I rate my cleaner? Yes — you'll get a text after service to rate right from your phone.
- What happens after I book? You'll get a confirmation email, then a text on the day with real-time updates as the cleaner heads your way.
--- END COMPANY KNOWLEDGE ---

INFORMATION NEEDED TO QUOTE:
To give a price, you need: bedrooms, bathrooms, service type (standard/deep/move-out). Address is also needed to confirm we service their area.
If the customer asks for a price before you have this info, don't ignore the question and don't just skip to price either. Acknowledge it, then get what you need in a natural way:
- "We can absolutely get you a number — I just need to know the size of your place so I'm not guessing. How many bedrooms?"
- "Happy to give you a price — real quick, what's the address? Pricing can vary a little by area."
Once you have what you need, give the price confidently and move to booking.

THE NATURAL FLOW (not a rigid script — a guide):
1. OPENER — Warm, human, makes them feel they called/were called by the right place.
   INBOUND (customer called us): They reached out — they want something. Match their energy. Quick, warm, get them talking.
   Example: "Maids in Black, this is [name] — how can I help you today?"
   OUTBOUND (agent called the customer): They didn't expect this call. Earn their attention fast. Be warm, specific, and give them a reason to stay on the line.
   Example: "Hey [name], this is [agent] from Maids in Black — you filled out a quote request earlier and I just wanted to make sure you got taken care of. Do you have two minutes?"
   Either way: make them feel like they're talking to a person, not a call center.

2. DISCOVERY — Get beds, baths, address, service type, preferred date. Conversational, not a form.
   ONE QUESTION PER TURN — ABSOLUTE RULE: Ask exactly ONE question per suggestion. Never combine two questions in the same line. Not "How many bedrooms and what type of cleaning?" — just "How many bedrooms?" Then wait. Then ask the next thing.
   This is the most important rule in discovery. Customers hang up or get confused when they're hit with multiple questions at once. One at a time, every time.
   CHOICE QUESTIONS: If the question offers options (e.g. service type), phrase it as a single sentence ending with one question mark. Do NOT list options as separate sub-questions. Good: "Are you thinking a standard clean, a deep clean, or a move-out?" — one sentence, one question mark, done.
   CRITICAL: If the customer already gave you a piece of info (date, address, beds, etc.), NEVER ask for it again. Accept it and move on.
   Example: if they say "next Monday" — that IS the date. Confirm it and move forward. Do NOT ask "do you have a specific date in mind?"
3. VALUE — This step is MANDATORY. You MUST deliver the value pitch before giving any price. No exceptions. No skipping.
   One punchy pitch covering ALL of these in ONE message: same team every time, all background-checked, they bring all supplies, 200% satisfaction guarantee. End with one question.
   If you skip this step and jump straight to price, you are failing the call.
4. RECAP — One sentence mirroring their details, then bridge to the price: "Sound about right? Let me pull up your total."
5. CLOSE — Give the price confidently. Assume the booking. Date is already known from discovery — do NOT ask for it again.
   MANDATORY CARD ASK: When asking for the card, you MUST ask for the full name on the card AND the best callback number in the same message. Every time. No exceptions.
   Example: "I just need a card on file to hold your spot — we don't charge until after the team is done and you're happy. Can I get the full name on the card, and what's the best number to reach you?"
   Then collect the card details in this exact sequence — one ask per turn:
   Step 1 (same message as name/phone ask): Full name on card + best callback number
   Step 2: Card number
   Step 3: Expiration date
   Step 4: The 3-digit security code on the back of the card (say "the 3 numbers on the back" — not CVV, not security code)
   Never ask for all card details at once. One field per turn. Always in this order.
   After the card is collected (or as you're wrapping up), always give them a confidence close — tell them what to expect on the day: they'll get a text as the team is on the way with real-time updates, and after the service they'll get a text to rate their cleaner right from their phone. Keep it brief and warm — it's the last thing they hear and it should make them feel great about the decision they just made.
6. UPSELL — Two types of upsells, both done naturally:

   A) RECURRING DISCOUNT — After giving the one-time price, offer the recurring option:
   - Monthly cleaning: 10% off every clean
   - Biweekly cleaning: 15% off every clean
   Example: "By the way — a lot of our clients do biweekly and save 15% every time. On your place that'd bring it down to $X. Want me to set that up instead?"
   Calculate the discounted price on the spot. Pitch once, don't repeat.

   B) EXTRAS — This is MANDATORY. You MUST pitch at least one extra after the card is collected.
   If the context shows add-ons are already selected, include them in the quoted price naturally.
   If no extras are selected yet: once the card is given, BEFORE the confidence close, you MUST offer one relevant extra. No exceptions. Pick based on the home:
   - Has pets → "One thing a lot of clients with pets add is our pet add-on for just $X — it helps with hair and dander. Want me to throw that in?"
   - Move-out → "A lot of move-out clients add inside oven for $X — landlords always check that. Want me to include it?"
   - First-time or standard → "One popular add-on is inside fridge for $X — takes it from clean to spotless. Worth adding?"
   If they say yes, confirm the updated total. If they say no, move straight to the confidence close.
   Never list all extras. One at a time. Never skip this step.

7. OBJECTION — Acknowledge, reframe, reduce risk, close again.

HOW TO HANDLE ANYTHING OFF-SCRIPT:
- Customer asks for price early → acknowledge it, get the missing info naturally, then give the price
- Customer asks a question → answer it briefly, then move the sale forward
- Customer hesitates → find out if it's timing or price, then address that specific thing
- Customer goes quiet → create gentle urgency around the open slot
- Customer mentions a competitor → don't trash them, just highlight what makes Maids in Black different

HOW TO WRITE THE SUGGESTION:
CRITICAL: When the script gives you an exact line to say, deliver it WORD FOR WORD. Do NOT shorten, summarize, or cut any part of it. Script lines are written exactly as they must be said.
STYLE RULES:
- Sound like a real person talking, not a script being read
- ZERO filler words: never start with "Absolutely!", "Great!", "Of course!", "Certainly!", "Sure!"
- ONE QUESTION per suggestion. One. Not "How many bedrooms and what type of cleaning?" — just "How many bedrooms?" Period.
- End almost every line with a question that moves things forward
- Never repeat back the customer's exact words
- Be specific to what they actually said — not generic

GOOD vs BAD EXAMPLES:
❌ BAD: "Great! I'd be happy to help you with that. What kind of cleaning were you looking for?"
✅ GOOD: "We can definitely take care of that — how many bedrooms?"

❌ BAD: "Absolutely! We offer standard, deep, and move-out cleaning. Which one are you interested in?"
✅ GOOD: "Is this more of a regular maintenance clean or has it been a while — like a deep clean situation?"

❌ BAD: "Perfect, we can help with that! To get started, how many bedrooms does your home have?"
✅ GOOD: "What's the size of the place — how many bedrooms?"

❌ BAD: "Thank you for that information. Now let me tell you about our services."
✅ GOOD: "3-bed, 2-bath in Bethesda — we're out there all the time. You thinking a standard clean or a deep clean?"

When they give you personal info (new puppy, just moved in, it's a disaster in here): acknowledge it like a human would in ONE brief phrase, then immediately move forward. "Oh nice, congrats on the new place — how many bedrooms?"

EMPATHY RULE — CRITICAL:
Before EVERY discovery question, you MUST acknowledge what the customer just said with ONE specific, genuine phrase tied to what they actually said. Not generic. Not "great" or "perfect" or "awesome". Specific to their words.
Examples:
- They say "first time using a cleaning service" → "First time is always the best — you're going to wonder why you waited."
- They say "want to clean before Easter" → "Easter is the perfect deadline — nothing like walking into a clean home when guests arrive."
- They say "it's been a while" → "Totally get it — that's exactly what we're here for."
- They say "I know what you mean, tough industry" → "Exactly — that's why we built things differently from day one."
NEVER skip the acknowledgment. Never jump straight to the next question without it.

ADDRESS CONFIRMATION RULE:
When the customer gives you their address, ALWAYS confirm it back verbatim before moving on. Example: "Got it — 1501 Canyon Ledge Court. Perfect." Then continue to STEP 12.`;

         const contextBlock = [
          input.isOutbound  ? `CALL TYPE: OUTBOUND — the agent called the customer. Do NOT ask for any fields already known from the form or the conversation.` : `CALL TYPE: INBOUND — the customer called us.`,
          input.knownFields ? `ALREADY KNOWN FROM FORM (do not re-ask these): ${input.knownFields}` : null,
          input.leadName    ? `Customer name: ${input.leadName}` : null,
          input.context     ? `FIELDS COLLECTED SO FAR:\n${input.context}` : null,
          input.quotedPrice ? `First clean price: $${input.quotedPrice}` : null,
          input.recurringPrice ? `Recurring price (after first clean): $${input.recurringPrice}/clean` : null,
        ].filter(Boolean).join("\n");
        const userPrompt = [
          contextBlock ? `CONTEXT:\n${contextBlock}` : null,
          input.transcript ? `CONVERSATION (this is the ground truth — everything said here is already known):\n${input.transcript}` : null,
          input.lastCustomerLine ? `CUSTOMER JUST SAID: "${input.lastCustomerLine}"` : null,
          `What does the agent say next? Return JSON with:\n- suggestion: the exact next line for the agent to say — if the script provides a specific line for this moment, reproduce it verbatim in full, do NOT shorten or summarize it\n- extracted: any NEW details you can confidently extract from the conversation so far (null if not mentioned). For addExtras: if the customer just agreed to an extra, return the matching key(s) from this list: clean_inside_cabinets, clean_inside_empty_fridge, clean_inside_full_fridge, clean_inside_oven, clean_interior_windows, clean_finished_basement, green_cleaning, move_in_move_out, two_hours_organizing, load_of_laundry, i_have_pets, wipe_walls, sweep_garage, balcony_sweep, home_concierge, same_day_booking, clean_inside_microwave, shed_pool_house, wash_dishes, pool_deck. Otherwise return null.`,
        ].filter(Boolean).join("\n\n");

        try {
          const response = await invokeLLM({
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user",   content: userPrompt },
            ],
            response_format: {
              type: "json_schema",
              json_schema: {
                name: "live_call_suggestion",
                strict: true,
                schema: {
                  type: "object",
                  properties: {
                    suggestion:   { type: "string" },
                    extracted: {
                      type: "object",
                      properties: {
                        customerName:  { type: ["string", "null"] },
                        phone:         { type: ["string", "null"] },
                        address:       { type: ["string", "null"] },
                        bedrooms:      { type: ["string", "null"] },
                        bathrooms:     { type: ["string", "null"] },
                        serviceType:   { type: ["string", "null"] },
                        preferredDate: { type: ["string", "null"] },
                        addExtras:     { type: ["array", "null"], items: { type: "string" } },
                      },
                      required: ["customerName", "phone", "address", "bedrooms", "bathrooms", "serviceType", "preferredDate", "addExtras"],
                      additionalProperties: false,
                    },
                  },
                  required: ["suggestion", "extracted"],
                  additionalProperties: false,
                },
              },
            },
          });
          const rawContent = response.choices?.[0]?.message?.content;
          const content = typeof rawContent === "string" ? rawContent : null;
          if (!content) throw new Error("Empty LLM response");
          const result = JSON.parse(content) as { suggestion: string; extracted: { customerName: string|null; phone: string|null; address: string|null; bedrooms: string|null; bathrooms: string|null; serviceType: string|null; preferredDate: string|null; addExtras: string[]|null } };
          return { success: true as const, suggestion: result.suggestion, currentStage: input.stage, extracted: result.extracted };
        } catch {
          return {
            success: false as const,
            currentStage: input.stage,
            suggestion: "What else can you tell me about the place?",
          };
        }
      }),

    /**
     * leads.extractBookingDetails — parse a call transcript and extract structured booking info.
     * Called when agent clicks "Complete Booking" to pre-fill the modal.
     */
    extractBookingDetails: adminAgentProcedure
      .input(z.object({
        transcript: z.string().max(8000),
      }))
      .mutation(async ({ input }) => {
        try {
          const response = await invokeLLM({
            messages: [
              {
                role: "system",
                content: `You extract booking details from a phone call transcript between a cleaning company agent and a customer. Return only what was explicitly mentioned. If something wasn't mentioned, return null for that field.`,
              },
              {
                role: "user",
                content: `Extract the booking details from this call transcript:\n\n${input.transcript}\n\nReturn JSON with these fields:\n- customerName: string | null\n- address: string | null\n- bedrooms: string | null (e.g. "3 Bedrooms")\n- bathrooms: string | null (e.g. "2 Bathrooms")\n- serviceType: string | null (e.g. "Standard Cleaning", "Deep Cleaning", "Move-In / Move-Out Cleaning")\n- preferredDate: string | null\n- price: string | null (just the number, e.g. "229")`,
              },
            ],
            response_format: {
              type: "json_schema",
              json_schema: {
                name: "booking_details",
                strict: true,
                schema: {
                  type: "object",
                  properties: {
                    customerName:  { type: ["string", "null"] },
                    address:       { type: ["string", "null"] },
                    bedrooms:      { type: ["string", "null"] },
                    bathrooms:     { type: ["string", "null"] },
                    serviceType:   { type: ["string", "null"] },
                    preferredDate: { type: ["string", "null"] },
                    price:         { type: ["string", "null"] },
                  },
                  required: ["customerName", "address", "bedrooms", "bathrooms", "serviceType", "preferredDate", "price"],
                  additionalProperties: false,
                },
              },
            },
          });
          const rawContent = response.choices?.[0]?.message?.content;
          const content = typeof rawContent === "string" ? rawContent : null;
          if (!content) throw new Error("Empty LLM response");
          return { success: true as const, ...JSON.parse(content) };
        } catch {
          return { success: false as const, customerName: null, address: null, bedrooms: null, bathrooms: null, serviceType: null, preferredDate: null, price: null };
        }
      }),

    /**
     * leads.saveCallLead — create a lead + conversation session from a completed call.
     * Called automatically when the agent clicks "Clear Call".
     * If the call reached the close stage (card given), the session is marked BOOKED.
     */
    saveCallLead: agentProcedure
      .input(z.object({
        name:         z.string().min(1).max(255),
        phone:        z.string().max(30).default("Unknown"),
        address:      z.string().max(500).optional(),
        bedrooms:     z.string().max(50).default("Unknown"),
        bathrooms:    z.string().max(50).default("Unknown"),
        serviceType:  z.string().max(100).default("Standard Cleaning"),
        preferredDate:z.string().max(100).optional(),
        quotedPrice:  z.string().max(20).optional(),
        extras:       z.array(z.string()).optional(),
        isBooked:      z.boolean().default(false),
        notInterested: z.boolean().default(false),
        isFollowUp:    z.boolean().default(false),
        followUpDate:  z.string().max(20).optional(),
        agentId:       z.number().optional(),
        agentName:     z.string().max(255).optional(),
        transcript:    z.string().max(8000).optional(),
      }))
      .mutation(async ({ input }) => {
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

        const extrasJson = input.extras && input.extras.length > 0
          ? JSON.stringify(input.extras)
          : null;

        // 1. Insert into quote_leads
        const [leadResult] = await db.insert(quoteLeads).values({
          name:        input.name,
          phone:       input.phone,
          serviceType: input.serviceType,
          bedrooms:    input.bedrooms,
          bathrooms:   input.bathrooms,
          extras:      extrasJson,
          smsSent:     0,
        });
        const leadId = (leadResult as { insertId: number }).insertId;

        // 2. Insert conversation session
        const stage = input.isBooked ? "BOOKED" : input.notInterested ? "NOT_INTERESTED" : input.isFollowUp ? "FOLLOW_UP_SCHEDULED" : "CALL_SCHEDULED";
        const [sessionResult] = await db.insert(conversationSessions).values({
          leadPhone:          input.phone,
          leadName:           input.name,
          stage,
          quotedPrice:        input.quotedPrice ?? null,
          serviceType:        input.serviceType,
          bedrooms:           input.bedrooms,
          bathrooms:          input.bathrooms,
          address:            input.address ?? null,
          selectedSlot:       input.preferredDate ?? null,
          quoteLeadId:        leadId,
          leadSource:         "call",
          messageHistory:     "[]",
          extras:             extrasJson,
          assignedAgentId:    input.agentId ?? null,
          assignedAgentName:  input.agentName ?? null,
          ...(input.isFollowUp && input.followUpDate ? { followUpDate: input.followUpDate } : {}),
          ...(input.isBooked ? {
            isBooked:         1,
            bookedAt:         new Date(),
            bookedByAgentId:  input.agentId ?? null,
            bookedByAgentName:input.agentName ?? null,
            bookedAmount:     input.quotedPrice ? Math.round(parseFloat(input.quotedPrice)) : null,
          } : {}),
        });
        const sessionId = (sessionResult as { insertId: number }).insertId;

        console.log(`[CallAssist] Lead saved: sessionId=${sessionId}, name=${input.name}, booked=${input.isBooked}`);
        return { success: true as const, leadId, sessionId };
      }),

    /**
     * leads.appendCallToSession — append an outbound call transcript to an existing lead session.
     * Used by Outbound Call Assist when the agent calls a lead from the drawer.
     * Does NOT create a new lead — updates the existing conversation_session in place.
     */
    appendCallToSession: agentProcedure
      .input(z.object({
        sessionId:     z.number().int().positive(),
        transcript:    z.string().max(8000),
        quotedPrice:   z.string().max(20).optional(),
        preferredDate: z.string().max(100).optional(),
        extras:        z.array(z.string()).optional(),
        isBooked:      z.boolean().default(false),
        notInterested: z.boolean().default(false),
        isFollowUp:    z.boolean().default(false),
        followUpDate:  z.string().max(20).optional(),
        agentId:       z.number().optional(),
        agentName:     z.string().max(255).optional(),
        bedrooms:      z.string().max(50).optional(),
        bathrooms:     z.string().max(50).optional(),
        address:       z.string().max(500).optional(),
      }))
      .mutation(async ({ input }) => {
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

        const [existing] = await db
          .select()
          .from(conversationSessions)
          .where(eq(conversationSessions.id, input.sessionId))
          .limit(1);
        if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "Session not found" });

        // Append call transcript as a system message in the message history
        let messages: { role: string; content: string; ts?: number }[] = [];
        try { messages = JSON.parse(existing.messageHistory || "[]"); } catch { messages = []; }
        messages.push({
          role: "system",
          content: `[OUTBOUND CALL${input.agentName ? ` by ${input.agentName}` : ""}]\n${input.transcript}`,
          ts: Date.now(),
        });

        // Determine new stage from outcome
        const newStage = input.isBooked
          ? "BOOKED"
          : input.notInterested
          ? "NOT_INTERESTED"
          : input.isFollowUp
          ? "FOLLOW_UP_SCHEDULED"
          : existing.stage;

        const extrasJson = input.extras && input.extras.length > 0
          ? JSON.stringify(input.extras)
          : (existing.extras ?? null);

        await db
          .update(conversationSessions)
          .set({
            messageHistory:    JSON.stringify(messages),
            stage:             newStage as typeof existing.stage,
            quotedPrice:       input.quotedPrice ?? existing.quotedPrice,
            selectedSlot:      input.preferredDate ?? existing.selectedSlot,
            extras:            extrasJson,
            bedrooms:          input.bedrooms ?? existing.bedrooms,
            bathrooms:         input.bathrooms ?? existing.bathrooms,
            address:           input.address ?? existing.address,
            lastCalledAt:      new Date(), // surface in pipeline (sort key)
            assignedAgentId:   input.agentId ?? existing.assignedAgentId,
            assignedAgentName: input.agentName ?? existing.assignedAgentName,
            ...(input.isFollowUp && input.followUpDate ? { followUpDate: input.followUpDate } : {}),
            ...(input.isBooked ? {
              isBooked:          1,
              bookedAt:          new Date(),
              bookedByAgentId:   input.agentId ?? existing.bookedByAgentId,
              bookedByAgentName: input.agentName ?? existing.bookedByAgentName,
              bookedAmount:      input.quotedPrice ? Math.round(parseFloat(input.quotedPrice)) : existing.bookedAmount,
            } : {}),
          })
          .where(eq(conversationSessions.id, input.sessionId));

        console.log(`[OutboundCallAssist] Appended call to sessionId=${input.sessionId}, stage=${newStage}`);
        return { success: true as const, sessionId: input.sessionId };
      }),
    /**
     * leads.markYelpContacted — mark a Yelp lead as contacted via Yelp Biz.
     * Sets stage to DONE and turns off AI mode (no SMS to send).
     */
    markYelpContacted: adminAgentProcedure
      .input(z.object({ sessionId: z.number().int().positive() }))
      .mutation(async ({ input }) => {
        const db = await getDb();
        if (!db) throw new Error("Database unavailable");
        const rows = await db
          .select({ leadName: conversationSessions.leadName, leadPhone: conversationSessions.leadPhone })
          .from(conversationSessions)
          .where(eq(conversationSessions.id, input.sessionId))
          .limit(1);
        const sess = rows[0];
        await db
          .update(conversationSessions)
          .set({ stage: "DONE" as any, aiMode: 0 })
          .where(eq(conversationSessions.id, input.sessionId));
        logActivity({
          eventType: "new_lead",
          title: `${sess?.leadName ?? "Yelp Lead"} contacted via Yelp Biz`,
          body: "Agent marked this Yelp lead as contacted via Yelp Biz.",
          meta: { sessionId: input.sessionId, leadName: sess?.leadName, source: "yelp" },
        }).catch(() => {});
        return { success: true };
      }),

    /**
     * leads.createManual — create a manual lead from the admin UI.
     * Inserts quoteLeads + conversationSession, posts a new_lead card to CommandChat,
     * and auto-claims it for the calling agent.
     */
    createManual: agentProcedure
      .input(z.object({
        name:        z.string().min(1).max(255),
        phone:       z.string().min(7).max(30),
        email:       z.string().optional(),
        serviceType: z.string().max(100).default("Standard Cleaning"),
        notes:       z.string().max(2000).optional(),
        amount:      z.number().int().min(0).optional(),
        status:      z.string().max(50).default("QUOTE_SENT"),
        source:      z.enum(["yelp", "google", "thumbtack", "bark", "phone", "other"]).default("phone"),
      }))
      .mutation(async ({ input, ctx }) => {
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
        const agentName = ctx.agent.agentName;
        const agentId   = ctx.agent.agentId;
        // 1. Insert quote_leads row (bedrooms/bathrooms not collected for manual leads)
        const [leadResult] = await db.insert(quoteLeads).values({
          name:        input.name,
          phone:       input.phone,
          email:       input.email || null,
          serviceType: input.serviceType,
          bedrooms:    "",
          bathrooms:   "",
          smsSent:     0,
        } as any);
        const leadId = (leadResult as any).insertId as number;
        // 2. Insert conversation_session row
        const stage = (input.status as any) ?? "QUOTE_SENT";
        const BOOKED_STAGES_SET = ["BOOKED", "BOOKING_CONFIRMED", "BOOKING_COMPLETE"];
        const isBookedFlag = BOOKED_STAGES_SET.includes(stage) ? 1 : 0;
        const [sessionResult] = await db.insert(conversationSessions).values({
          leadPhone:          input.phone,
          leadName:           input.name,
          stage,
          serviceType:        input.serviceType,
          leadSource:         input.source,
          messageHistory:     "[]",
          internalNotes:      input.notes ?? null,
          bookedAmount:       input.amount ?? null,
          isBooked:           isBookedFlag,
          bookedAt:           isBookedFlag ? new Date() : null,
          assignedAgentId:    agentId,
          assignedAgentName:  agentName,
          quoteLeadId:        leadId,
          aiMode:             0,
        } as any);
        const sessionId = (sessionResult as any).insertId as number;
        // 3. Post new_lead card to CommandChat
        const sourceLabel: Record<string, string> = {
          yelp: "Yelp", google: "Google", thumbtack: "Thumbtack",
          bark: "Bark", phone: "Phone", other: "Manual",
        };
        const amountDisplay = input.amount ? ` · **$${input.amount}**` : "";
        const leadBody = `📋 **${input.serviceType}** · ${sourceLabel[input.source] ?? input.source}${amountDisplay}`;
        const metadata = JSON.stringify({
          leadName:    input.name,
          leadPhone:   input.phone,
          serviceType: input.serviceType,
          source:      input.source,
          price:       input.amount ?? "",
          sessionId,
          arrivedAt:   Date.now(),
          claimedBy:   agentName,
          claimedAt:   Date.now(),
        });
        await db.insert(opsChatMessages).values({
          cleanerJobId: null,
          channel:      "command",
          authorName:   "📋 Manual Lead",
          authorRole:   "system",
          body:         leadBody,
          mediaUrl:     null,
          quickAction:  "new_lead",
          metadata,
        } as any);
        // 4. If status indicates a booking, also post a booking announcement card
        const BOOKED_STAGES = ["BOOKED", "BOOKING_CONFIRMED", "BOOKING_COMPLETE"];
        if (BOOKED_STAGES.includes(stage) && input.amount) {
          const bookingMeta = JSON.stringify({
            personName: input.name,
            amount:     `$${input.amount}`,
            note:       input.notes ?? null,
          });
          await db.insert(opsChatMessages).values({
            cleanerJobId: null,
            channel:      "command",
            authorName:   agentName,
            authorRole:   "agent",
            body:         `🎉 New booking: ${input.name} · $${input.amount}`,
            mediaUrl:     null,
            quickAction:  "announce_booking",
            metadata:     bookingMeta,
          } as any);
        }
        // 5. Broadcast so all agents see the new lead card immediately
        const { broadcastOpsUpdate } = await import("./sseBroadcast");
        broadcastOpsUpdate("lead_update");
        return { success: true, leadId, sessionId };
      }),

    /**
     * listCsInbox — list all sessions that came in via the CS line (202-888-5362).
     * Accessible to all agents and admins.
     */
    listCsInbox: opsChatProcedure
      .input(z.object({ showResolved: z.boolean().optional().default(false) }))
      .query(async ({ input }) => {
        const db = await getDb();
        if (!db) throw new Error("Database unavailable");
        const sourceFilter = or(
          eq(conversationSessions.leadSource, "cs-inbound"),
          eq(conversationSessions.leadSource, "cs-inbound-cleaner"),
          eq(conversationSessions.leadSource, "cs_initiated")
        );
        const resolvedFilter = input.showResolved
          ? undefined  // show all
          : isNull(conversationSessions.csResolvedAt); // only open
        const sessions = await db
          .select()
          .from(conversationSessions)
          .where(resolvedFilter ? and(sourceFilter, resolvedFilter) : sourceFilter)
          .orderBy(desc(conversationSessions.updatedAt))
          .limit(100);

        // Augment and sort by last message ts in messageHistory.
        // We cannot rely on updatedAt because MySQL ON UPDATE CURRENT_TIMESTAMP fires
        // on every .set() call (including agent replies), which bumps replied threads
        // to the top and breaks recency order.
        type HistoryEntry = { role: string; ts?: number };
        const augmented = sessions.map((s) => {
          let history: HistoryEntry[] = [];
          try { history = JSON.parse(s.messageHistory ?? "[]"); } catch { /* ignore */ }
          const lastEntry = history[history.length - 1];
          const lastMsgTs = lastEntry?.ts ?? s.updatedAt.getTime();
          // Skip note/system roles — only user/assistant count for unanswered detection
          const lastRealEntry = [...history].reverse().find((e) => e.role === "user" || e.role === "assistant");
          const hasUnanswered = !!lastRealEntry && lastRealEntry.role === "user";
          const lastSenderRole: "user" | "assistant" | null = lastRealEntry?.role === "user" ? "user" : lastRealEntry?.role === "assistant" ? "assistant" : null;
          return { ...s, lastMsgTs, hasUnanswered, lastSenderRole };
        });

        // Sort: most recent last message first
        augmented.sort((a, b) => b.lastMsgTs - a.lastMsgTs);

        // One phone = one card. Group all sessions by phone, merge their message
        // histories in chronological order, and keep the most recent session's metadata.
        type AugmentedSession = typeof augmented[number];
        const phoneGroups = new Map<string, AugmentedSession[]>();
        for (const s of augmented) {
          const phone = s.leadPhone?.trim() || "__no_phone__";
          if (!phoneGroups.has(phone)) phoneGroups.set(phone, []);
          phoneGroups.get(phone)!.push(s);
        }
        const deduped = Array.from(phoneGroups.values()).map((group) => {
          // group is already sorted desc by lastMsgTs — first entry is most recent
          const primary = group[0];
          if (group.length === 1) return primary;
          // Merge all message histories across sessions for this phone
          type MsgEntry = { role: string; content: string; ts?: number; senderName?: string; opMsgId?: string };
          const allMsgs: MsgEntry[] = [];
          for (const s of group) {
            let hist: MsgEntry[] = [];
            try { hist = JSON.parse(s.messageHistory ?? "[]"); } catch { /* ignore */ }
            allMsgs.push(...hist);
          }
          // Deduplicate by opMsgId then by content+ts proximity, sort chronologically
          const seenMsgIds = new Set<string>();
          const merged: MsgEntry[] = [];
          for (const m of allMsgs) {
            if (m.opMsgId && seenMsgIds.has(m.opMsgId)) continue;
            if (m.opMsgId) seenMsgIds.add(m.opMsgId);
            // Content+ts dedup: skip if identical content within 15s already present
            const isDup = merged.some(
              (x) => x.role === m.role && x.content === m.content && Math.abs((x.ts ?? 0) - (m.ts ?? 0)) < 15_000
            );
            if (isDup) continue;
            merged.push(m);
          }
          merged.sort((a, b) => (a.ts ?? 0) - (b.ts ?? 0));
          const lastMerged = merged[merged.length - 1];
          const mergedLastMsgTs = lastMerged?.ts ?? primary.lastMsgTs;
          const lastRealMerged = [...merged].reverse().find((e) => e.role === "user" || e.role === "assistant");
          return {
            ...primary,
            messageHistory: JSON.stringify(merged),
            lastMsgTs: mergedLastMsgTs,
            hasUnanswered: !!lastRealMerged && lastRealMerged.role === "user",
            lastSenderRole: (lastRealMerged?.role === "user" ? "user" : lastRealMerged?.role === "assistant" ? "assistant" : null) as "user" | "assistant" | null,
          };
        });
        // Re-sort after merge (lastMsgTs may have changed)
        deduped.sort((a, b) => b.lastMsgTs - a.lastMsgTs);

        // Batch-augment with jobCount (VIP = 3+) and hasTodayJob (Today badge)
        const phones = deduped.map((s) => s.leadPhone?.trim()).filter(Boolean) as string[];
        const digits10 = (p: string) => p.replace(/[^\d]/g, "").slice(-10);

        // Build jobCount map: phone10 → count from cleanerJobs (covers all jobs)
        const jobCountMap = new Map<string, number>();
        const todayJobMap = new Map<string, boolean>();

        if (phones.length > 0) {
          // cleanerJobs stores customerPhone in various formats — normalize to 10-digit
          const d10Phones = phones.map((p) => digits10(p)).filter(Boolean);
          if (d10Phones.length > 0) {
            const jobCountRows = await db
              .select({ customerPhone: cleanerJobs.customerPhone, cnt: sql<number>`COUNT(*)` })
              .from(cleanerJobs)
              .where(sql`REGEXP_REPLACE(${cleanerJobs.customerPhone}, '[^0-9]', '') IN (${sql.raw(d10Phones.map((p) => `'${p}'`).join(','))})`)
              .groupBy(cleanerJobs.customerPhone);
            for (const row of jobCountRows) {
              const d10 = digits10(row.customerPhone ?? "");
              if (d10) jobCountMap.set(d10, (jobCountMap.get(d10) ?? 0) + Number(row.cnt));
            }
          }

          // cleanerJobs uses (xxx) xxx-xxxx format — check for today's date
          const nowET = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
          const todayET = nowET.toISOString().slice(0, 10);
          const todayJobRows = await db
            .select({ customerPhone: cleanerJobs.customerPhone })
            .from(cleanerJobs)
            .where(
              sql`${cleanerJobs.jobDate} = ${todayET} AND REGEXP_REPLACE(${cleanerJobs.customerPhone}, '[^0-9]', '') IN (${sql.raw(phones.map((p) => `'${digits10(p)}'`).join(','))})`
            )
            .limit(phones.length);
          for (const row of todayJobRows) {
            const d10 = digits10(row.customerPhone ?? "");
            if (d10) todayJobMap.set(d10, true);
          }
        }

        const result = deduped.map((s) => {
          const d10 = digits10(s.leadPhone?.trim() ?? "");
          return {
            ...s,
            jobCount: jobCountMap.get(d10) ?? 0,
            hasTodayJob: todayJobMap.get(d10) ?? false,
          };
        });

        // Fire async LLM status scoring for stale sessions — never blocks the response
        // Import inline to avoid circular deps at module load time
        import("./csStatusScorer").then(({ scoreAndCacheStatus }) => {
          for (const s of result) {
            let hist: Array<{ role: string; content: string; ts?: number }> = [];
            try { hist = JSON.parse(s.messageHistory ?? "[]"); } catch { /* ignore */ }
            const msgLen = hist.length;
            const isTeam = s.leadSource === "cs-inbound-cleaner";
            // Only score if stale (msgLen changed since last score)
            if (s.csStatusMsgLen !== msgLen) {
              scoreAndCacheStatus(
                s.id,
                isTeam,
                hist,
                msgLen,
                s.csStatusTier ?? null,
                s.csStatusMsgLen ?? null
              ).catch(() => { /* silent — scoring is best-effort */ });
            }
          }
        }).catch(() => { /* silent */ });

        return result;
      }),
    /**
     * getCsUnreadCount — returns count of CS sessions updated after lastSeenTs.
     * Used to show the red badge on the CS tab.
     */
    getCsUnreadCount: opsChatProcedure
      .input(z.object({ lastSeenTs: z.number() }))
      .query(async ({ input }) => {
        const db = await getDb();
        if (!db) return { count: 0 };
        const sourceFilter = or(
          eq(conversationSessions.leadSource, "cs-inbound"),
          eq(conversationSessions.leadSource, "cs-inbound-cleaner"),
          eq(conversationSessions.leadSource, "cs_initiated")
        );
        const sessions = await db
          .select({ id: conversationSessions.id, updatedAt: conversationSessions.updatedAt })
          .from(conversationSessions)
          .where(and(sourceFilter, isNull(conversationSessions.csResolvedAt)))
          .orderBy(desc(conversationSessions.updatedAt))
          .limit(200);
        const count = sessions.filter((s) => {
          const ts = s.updatedAt instanceof Date ? s.updatedAt.getTime() : new Date(s.updatedAt as string).getTime();
          return ts > input.lastSeenTs;
        }).length;
        return { count };
      }),
    /**
     * resolveSession — marks a CS inbox session as resolved (archived).
     * Sets csResolvedAt to the current timestamp.
     */
    resolveSession: opsChatProcedure
      .input(z.object({ sessionId: z.number() }))
      .mutation(async ({ input }) => {
        const db = await getDb();
        if (!db) throw new Error("Database unavailable");
        await db
          .update(conversationSessions)
          .set({ csResolvedAt: Date.now() } as any)
          .where(eq(conversationSessions.id, input.sessionId));
        return { success: true };
      }),
    /**
     * getCsPriorityQueue — returns top 3 AI-prioritized CS sessions.
     * Uses cached csPriorityTag if set, otherwise runs AI analysis on recent open sessions.
     * Only returns sessions whose last CUSTOMER message arrived within the last 24h.
     * Dismissed sessions are permanently excluded (no expiry).
     */
    getCsPriorityQueue: opsChatProcedure
      .query(async () => {
        const db = await getDb();
        if (!db) throw new Error("Database unavailable");

        const now = Date.now();
        // Hard cutoff: only surface issues that arose AFTER this timestamp.
        // Nothing from before this point will ever appear in the priority queue.
        const PRIORITY_QUEUE_EPOCH = 1775176265846; // Apr 3 2026 ~00:10 ET
        const sessions = await db
          .select()
          .from(conversationSessions)
          .where(
            and(
              or(
                eq(conversationSessions.leadSource, "cs-inbound"),
                eq(conversationSessions.leadSource, "cs-inbound-cleaner")
              ),
              isNull(conversationSessions.csResolvedAt),
              // Only sessions updated after the hard epoch cutoff
              sql`${conversationSessions.updatedAt} > FROM_UNIXTIME(${Math.floor(PRIORITY_QUEUE_EPOCH / 1000)})`
            )
          )
          .orderBy(desc(conversationSessions.updatedAt))
          .limit(30);

        if (sessions.length === 0) return [];

        // Build summaries — apply two additional filters:
        //   1. Skip permanently dismissed sessions (csPriorityDismissedAt is set, no expiry).
        //   2. Skip sessions whose last CUSTOMER message is older than 24h.
        //      This prevents stale conversations from being resurrected even if an agent
        //      touched the row recently (e.g. added a note or changed a field).
        const summaries = sessions
          .map((s) => {
            // Permanently dismissed — never show again
            const dismissedAt = (s as any).csPriorityDismissedAt ?? 0;
            if (dismissedAt) return null;
            let msgs: Array<{ role: string; content: string; ts?: number }> = [];
            try { msgs = JSON.parse(s.messageHistory ?? "[]"); } catch { msgs = []; }
            if (msgs.length === 0) return null;
            // Find the last inbound (customer) message
            const lastCustomerMsg = [...msgs].reverse().find((m) => m.role === "user");
            const lastCustomerTs = lastCustomerMsg?.ts ?? 0;
            // Skip if the last customer message arrived before the hard epoch cutoff
            // This ensures only genuinely new issues surface, never historical ones
            if (!lastCustomerTs || lastCustomerTs < PRIORITY_QUEUE_EPOCH) return null;
            // Skip if the last message in the thread is from the agent — the issue is already
            // being handled. Only surface conversations where the customer/cleaner has the last word.
            const lastMsg = msgs[msgs.length - 1];
            if (lastMsg && lastMsg.role !== "user") return null;
            const isCleaner = s.leadSource === "cs-inbound-cleaner";
            const senderLabel = isCleaner ? "Team member" : "Customer";
            const recent = msgs.slice(-6).map((m) => `${m.role === "user" ? senderLabel : "Agent"}: ${m.content}`).join("\n");
            const typeLabel = isCleaner ? "[TEAM — cleaner/staff]" : "[CUSTOMER]";
            return { id: s.id, name: s.leadName || s.leadPhone || "Unknown", recent, msgCount: msgs.length, lastTs: lastCustomerTs, typeLabel };
          })
          .filter(Boolean) as Array<{ id: number; name: string; recent: string; msgCount: number; lastTs: number; typeLabel: string }>;

        if (summaries.length === 0) return [];

        // Ask AI to identify top 3 priority conversations
        const { invokeLLM } = await import("./_core/llm");
        const prompt = `You are a CS manager reviewing ${summaries.length} conversations for a cleaning company. Identify the top 3 that need IMMEDIATE human attention.
IMPORTANT: Some conversations are from TEAM members (cleaners/staff), not customers. They are labeled [TEAM — cleaner/staff]. Treat them accordingly — a team member saying they can't enter a home is an operational issue, not an angry customer.
Priority criteria (in order):
1. angry — customer is upset, frustrated, or threatening to leave
2. cancel — customer wants to cancel or reschedule
3. booking — customer is trying to book or has a strong purchase intent
4. urgent — any other time-sensitive situation (including team operational issues like access problems, no-shows, or safety concerns)
Conversations:
${summaries.map((s, i) => `[${i + 1}] ID:${s.id} Name:${s.name} ${(s as any).typeLabel}\n${s.recent}`).join("\n\n")}
Return ONLY a JSON array of up to 3 objects. Each object must have:
- id: number (the conversation ID)
- tag: one of "angry" | "cancel" | "booking" | "urgent"
- reason: string (max 8 words, plain text, no punctuation at end, e.g. "wants to cancel tomorrow's cleaning")
If fewer than 3 conversations need attention, return fewer. Return [] if none are urgent.`;
        let priorityItems: Array<{ id: number; tag: string; reason: string }> = [];
        try {
          const res = await invokeLLM({
            messages: [{ role: "user", content: prompt }],
            response_format: {
              type: "json_schema",
              json_schema: {
                name: "priority_queue",
                strict: true,
                schema: {
                  type: "object",
                  properties: {
                    items: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          id: { type: "number" },
                          tag: { type: "string" },
                          reason: { type: "string" },
                        },
                        required: ["id", "tag", "reason"],
                        additionalProperties: false,
                      },
                    },
                  },
                  required: ["items"],
                  additionalProperties: false,
                },
              },
            },
          });
          const raw = res?.choices?.[0]?.message?.content ?? "{}";
          const parsed = JSON.parse(typeof raw === "string" ? raw : JSON.stringify(raw));
          priorityItems = (parsed.items ?? []).slice(0, 3);
        } catch (e) {
          console.warn("[CsPriority] AI analysis failed:", e);
          return [];
        }

        // Persist tags to DB and build response
        // Note: `now` is already declared above; dismissed sessions were already
        // filtered out in the summaries step, so no second check needed here.
        const result = [];
        for (const item of priorityItems) {
          const session = sessions.find((s) => s.id === item.id);
          if (!session) continue;
          // Persist tag
          await db
            .update(conversationSessions)
            .set({ csPriorityTag: item.tag, csPriorityReason: item.reason, csPriorityTaggedAt: now } as any)
            .where(eq(conversationSessions.id, item.id));
          result.push({
            id: item.id,
            name: session.leadName || session.leadPhone || "Unknown",
            tag: item.tag,
            reason: item.reason,
            taggedAt: now,
          });
        }
        return result;
      }),

    /**
     * dismissCsPriority — agent dismisses a session from the priority queue.
     * Sets csPriorityDismissedAt permanently — dismissed sessions NEVER reappear,
     * even if the customer sends a new message. The only way a session re-enters
     * the queue is if a new inbound session is created after PRIORITY_QUEUE_EPOCH.
     */
    dismissCsPriority: opsChatProcedure
      .input(z.object({ sessionId: z.number() }))
      .mutation(async ({ input }) => {
        const db = await getDb();
        if (!db) throw new Error("Database unavailable");
        await db
          .update(conversationSessions)
          .set({ csPriorityDismissedAt: Date.now() } as any)
          .where(eq(conversationSessions.id, input.sessionId));
        return { success: true };
      }),

    /**
     * updateCsName — update the display name for a CS inbox session.
     */
    updateCsName: opsChatProcedure
      .input(z.object({ sessionId: z.number(), name: z.string().trim() }))
      .mutation(async ({ input }) => {
        const db = await getDb();
        if (!db) throw new Error("Database unavailable");
        await db
          .update(conversationSessions)
          .set({ leadName: input.name || null } as any)
          .where(eq(conversationSessions.id, input.sessionId));
        return { success: true };
      }),
    /**
     * updateCsQueue — assign a CS inbox session to a queue label.
     */
    updateCsQueue: opsChatProcedure
      .input(z.object({ sessionId: z.number(), queue: z.string() }))
      .mutation(async ({ input }) => {
        const db = await getDb();
        if (!db) throw new Error("Database unavailable");
        await db
          .update(conversationSessions)
          .set({ csQueue: input.queue } as any)
          .where(eq(conversationSessions.id, input.sessionId));
        return { success: true };
      }),
    /**
     * backfillCsNames — one-shot admin procedure to resolve leadName for all CS sessions
     * that currently have a null leadName. Checks cleanerProfiles, completedJobs,
     * cleanerJobs, quoteLeads, and other sessions with the same phone.
     */
    backfillCsNames: opsChatProcedure
      .mutation(async () => {
        const db = await getDb();
        if (!db) throw new Error("Database unavailable");
        const digits10 = (p: string) => p.replace(/[^\d]/g, "").slice(-10);

        // Fetch all CS sessions with no name
        const sessions = await db
          .select({ id: conversationSessions.id, leadPhone: conversationSessions.leadPhone })
          .from(conversationSessions)
          .where(
            and(
              or(
                eq(conversationSessions.leadSource, "cs-inbound"),
                eq(conversationSessions.leadSource, "cs-inbound-cleaner")
              ),
              sql`(${conversationSessions.leadName} IS NULL OR ${conversationSessions.leadName} = '')`
            )
          );

        let fixed = 0;
        for (const session of sessions) {
          const phone = session.leadPhone ?? "";
          if (!phone) continue;
          const p10 = digits10(phone);
          let name: string | null = null;

          // 1. cleanerProfiles
          if (!name) {
            const [r] = await db.select({ name: cleanerProfiles.name }).from(cleanerProfiles).where(eq(cleanerProfiles.phone, p10)).limit(1);
            if (r?.name) name = r.name;
          }
          // 2. completedJobs (E.164)
          if (!name) {
            const [r] = await db.select({ name: completedJobs.name }).from(completedJobs).where(eq(completedJobs.phone, phone)).limit(1);
            if (r?.name) name = r.name;
          }
          // 3. cleanerJobs.customerName
          if (!name) {
            const [r] = await db.select({ customerName: cleanerJobs.customerName }).from(cleanerJobs).where(sql`REGEXP_REPLACE(${cleanerJobs.customerPhone}, '[^0-9]', '') = ${p10}`).limit(1);
            if (r?.customerName) name = r.customerName;
          }
          // 4. quoteLeads
          if (!name) {
            const [r] = await db.select({ name: quoteLeads.name }).from(quoteLeads).where(sql`REGEXP_REPLACE(${quoteLeads.phone}, '[^0-9]', '') LIKE ${'%' + p10}`).limit(1);
            if (r?.name) name = r.name;
          }
          // 5. Other sessions with same phone that have a name
          if (!name) {
            const [r] = await db
              .select({ leadName: conversationSessions.leadName })
              .from(conversationSessions)
              .where(and(
                eq(conversationSessions.leadPhone, phone),
                sql`${conversationSessions.leadName} IS NOT NULL AND ${conversationSessions.leadName} != ''`
              ))
              .orderBy(desc(conversationSessions.updatedAt))
              .limit(1);
            if (r?.leadName) name = r.leadName;
          }

          if (name) {
            await db.update(conversationSessions).set({ leadName: name } as any).where(eq(conversationSessions.id, session.id));
            fixed++;
          }
        }
        return { total: sessions.length, fixed };
      }),
    /**
     * backfillCleanerJobId — one-shot: set cleanerJobId DB column on existing cleaner_status
     * cards that were inserted before the column was populated on insert.
     */
    backfillCleanerJobId: opsChatProcedure
      .mutation(async () => {
        const db = await getDb();
        if (!db) throw new Error("Database unavailable");
        const [result] = await (db as any).$client.execute(`
          UPDATE ops_chat_messages
          SET cleanerJobId = CAST(JSON_UNQUOTE(JSON_EXTRACT(metadata, '$.cleanerJobId')) AS UNSIGNED)
          WHERE quickAction = 'cleaner_status'
            AND cleanerJobId IS NULL
            AND JSON_EXTRACT(metadata, '$.cleanerJobId') IS NOT NULL
            AND JSON_UNQUOTE(JSON_EXTRACT(metadata, '$.cleanerJobId')) != 'null'
            AND JSON_UNQUOTE(JSON_EXTRACT(metadata, '$.cleanerJobId')) != '0'
        `);
        return { rowsUpdated: result.affectedRows ?? 0 };
      }),
    /**
     * getCleanerTodayJobs — returns all cleanerJobs for a given cleanerProfileId on today's date.
     * Used by the Teams right panel in CsInbox.
     */
    getCleanerTodayJobs: opsChatProcedure
      .input(z.object({ cleanerProfileId: z.number() }))
      .query(async ({ input }) => {
        const db = await getDb();
        if (!db) throw new Error("Database unavailable");
        // Use Eastern Time date (business operates in DC/MD/VA)
        const nowET = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
        const todayET = nowET.toISOString().slice(0, 10);
        const jobs = await db
          .select({
            id: cleanerJobs.id,
            jobDate: cleanerJobs.jobDate,
            serviceDateTime: cleanerJobs.serviceDateTime,
            customerName: cleanerJobs.customerName,
            jobAddress: cleanerJobs.jobAddress,
            serviceType: cleanerJobs.serviceType,
            bookingStatus: cleanerJobs.bookingStatus,
            jobStatus: cleanerJobs.jobStatus,
            bedrooms: cleanerJobs.bedrooms,
            bathrooms: cleanerJobs.bathrooms,
            customerNotes: cleanerJobs.customerNotes,
            staffNotes: cleanerJobs.staffNotes,
            adminNotes: cleanerJobs.adminNotes,
            checklistItems: cleanerJobs.checklistItems,
            issueNote: cleanerJobs.issueNote,
            delayMinutes: cleanerJobs.delayMinutes,
            customerPhone: cleanerJobs.customerPhone,
            bookingId: cleanerJobs.bookingId,
            jobRevenue: cleanerJobs.jobRevenue,
          })
          .from(cleanerJobs)
          .where(
            and(
              eq(cleanerJobs.cleanerProfileId, input.cleanerProfileId),
              eq(cleanerJobs.jobDate, todayET)
            )
          )
          .orderBy(cleanerJobs.serviceDateTime);
        return jobs;
      }),
    /**
     * getCleanerProfileByPhone — looks up a cleanerProfile by 10-digit phone.
     * Used by the Teams right panel to resolve cleanerProfileId from the session phone.
     */
    getCleanerProfileByPhone: opsChatProcedure
      .input(z.object({ phone: z.string() }))
      .query(async ({ input }) => {
        const db = await getDb();
        if (!db) throw new Error("Database unavailable");
        // Normalize to 10 digits
        const digits = input.phone.replace(/^\+1/, "").replace(/[^\d]/g, "");
        const [profile] = await db
          .select({ id: cleanerProfiles.id, name: cleanerProfiles.name, phone: cleanerProfiles.phone })
          .from(cleanerProfiles)
          .where(eq(cleanerProfiles.phone, digits))
          .limit(1);
        return profile ?? null;
      }),
    /**
     * getClientProfile — resolves a client's name + booking history from their phone number.
     * Searches completedJobs (5yr history, E.164 format), cleanerJobs (recent + today, (xxx) format),
     * and quoteLeads (mixed format). All normalized to 10 digits before lookup.
     */
    getClientProfile: opsChatProcedure
      .input(z.object({ phone: z.string() }))
      .query(async ({ input }) => {
        const db = await getDb();
        if (!db) throw new Error("Database unavailable");
        // Universal normalizer: strip everything non-digit, take last 10
        const digits10 = (p: string) => p.replace(/[^\d]/g, "").slice(-10);
        const phone10 = digits10(input.phone);
        if (!phone10 || phone10.length < 10) return null;

        // E.164 format used by completedJobs
        const e164 = `+1${phone10}`;

        // 1. Lookup in completedJobs (5yr history)
        const historyRows = await db
          .select({
            name: completedJobs.name,
            address: completedJobs.address,
            frequency: completedJobs.frequency,
            jobDate: completedJobs.jobDate,
            serviceType: completedJobs.serviceType,
            lastBookingPrice: completedJobs.lastBookingPrice,
            launch27BookingId: completedJobs.launch27BookingId,
          })
          .from(completedJobs)
          .where(eq(completedJobs.phone, e164))
          .orderBy(desc(completedJobs.jobDate))
          .limit(20);

        // 2. Lookup in cleanerJobs by customerPhone (stored as (xxx) xxx-xxxx)
        // We normalize DB values on the fly using REGEXP_REPLACE in SQL
        const nowET = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
        const todayET = nowET.toISOString().slice(0, 10);
        const cleanerJobRows = await db
          .select({
            id: cleanerJobs.id,
            customerName: cleanerJobs.customerName,
            jobAddress: cleanerJobs.jobAddress,
            serviceDateTime: cleanerJobs.serviceDateTime,
            jobDate: cleanerJobs.jobDate,
            serviceType: cleanerJobs.serviceType,
            jobStatus: cleanerJobs.jobStatus,
            bookingStatus: cleanerJobs.bookingStatus,
            issueNote: cleanerJobs.issueNote,
            delayMinutes: cleanerJobs.delayMinutes,
            teamName: cleanerJobs.teamName,
            bookingId: cleanerJobs.bookingId,
          })
          .from(cleanerJobs)
          .where(
            sql`REGEXP_REPLACE(${cleanerJobs.customerPhone}, '[^0-9]', '') = ${phone10}`
          )
          .orderBy(desc(cleanerJobs.serviceDateTime))
          .limit(10);

        // 3. Fallback name from quoteLeads if not found above
        const [leadRow] = await db
          .select({ name: quoteLeads.name, phone: quoteLeads.phone })
          .from(quoteLeads)
          .where(
            sql`REGEXP_REPLACE(${quoteLeads.phone}, '[^0-9]', '') LIKE ${'%' + phone10}`
          )
          .limit(1);

        // Resolve best name: completedJobs > cleanerJobs > quoteLeads
        const resolvedName =
          historyRows[0]?.name ||
          cleanerJobRows[0]?.customerName ||
          leadRow?.name ||
          null;

        // Today's job from cleanerJobs
        const todayJob = cleanerJobRows.find((j) => j.jobDate === todayET) ?? null;

        // Recent jobs: last 5 from cleanerJobs + last 5 from completedJobs, sorted by date desc
        const recentFromCleaner = cleanerJobRows.slice(0, 5).map((j) => ({
          date: j.jobDate,
          address: j.jobAddress,
          serviceType: j.serviceType,
          status: j.jobStatus ?? j.bookingStatus ?? "scheduled",
          price: null as number | null,
          source: "live" as const,
          bookingId: j.bookingId ? String(j.bookingId) : null,
        }));
        const recentFromHistory = historyRows.slice(0, 5).map((j) => ({
          date: j.jobDate,
          address: j.address,
          serviceType: j.serviceType,
          status: "completed",
          price: j.lastBookingPrice,
          source: "history" as const,
          bookingId: j.launch27BookingId ?? null,
        }));
        const recentJobs = [...recentFromCleaner, ...recentFromHistory]
          .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""))
          .slice(0, 6);

        // Lifetime stats from completedJobs
        const totalBookings = historyRows.length;
        const firstBookingDate = historyRows.length > 0 ? historyRows[historyRows.length - 1].jobDate : null;
        const lastBookingDate = historyRows.length > 0 ? historyRows[0].jobDate : null;
        const latestFrequency = historyRows[0]?.frequency ?? null;
        const latestAddress = historyRows[0]?.address ?? cleanerJobRows[0]?.jobAddress ?? null;
        const avgPrice = historyRows.length > 0
          ? Math.round(historyRows.reduce((s, r) => s + (r.lastBookingPrice ?? 0), 0) / historyRows.length)
          : null;

        return {
          name: resolvedName,
          phone: e164,
          address: latestAddress,
          frequency: latestFrequency,
          totalBookings,
          firstBookingDate,
          lastBookingDate,
          avgPrice,
          todayJob,
          recentJobs,
        };
      }),
    /**
     * csQuickReply — generates a context-aware draft message for a CS inbox quick-reply button.
     * Reads the conversation history + client name and tailors the message to the tone.
     */
    csQuickReply: opsChatProcedure
      .input(z.object({
        action: z.enum(["send_quote", "make_it_right", "refer_friend", "running_late", "on_the_way", "review_rebook", "ai_suggest"]),
        clientName: z.string().optional(),
        messageHistory: z.string().optional(),
        queue: z.string().optional(), // "Teams" = cleaner conversation, otherwise client
      }))
      .mutation(async ({ input }) => {
        const firstName = input.clientName?.split(" ")[0] ?? "there";
        const isTeams = input.queue === "Teams";
        const allMessages: Array<{ role: string; content: string }> = (() => {
          try { return JSON.parse(input.messageHistory ?? "[]"); } catch { return []; }
        })();
        const recentMessages = allMessages.slice(-6);
        const conversationSnippet = recentMessages
          .map((m) => `${m.role === "user" ? (isTeams ? "Cleaner" : "Client") : "Agent"}: ${m.content}`)
          .join("\n");

        // ── System prompts ────────────────────────────────────────────────────
        const systemPrompt = isTeams
          ? `You are a field operations manager for Maids in Black, a premium home cleaning company in the DC/MD/VA area. You are texting one of your cleaning team members named ${firstName}. You write short, direct, supportive SMS messages. Never use emojis. Never sound corporate. Sound like a real manager who has their team's back and gets things done quickly. Common situations: access issues (can't get into the job), job size questions (bigger than expected), callouts (can't make it to work), field management questions (supplies, parking, timing), and requests for larger or better jobs.`
          : `You are a customer service agent for Maids in Black, a premium home cleaning company in the DC/MD/VA area. You’re good at your job — warm, confident, and direct. You text like a real person, not a hype bot. Clients trust you because you’re genuine, not because you’re over-the-top.
You have been trained on real examples of SMS conversations from this company. Match the voice and techniques exactly:
---
EXAMPLE 1 — New lead / pricing inquiry:
Client: Hi, how much do you charge for a house clean? 3 bed 2 bath.
Agent: Hey! 👋 A 3-bed/2-bath deep clean typically runs between $149–$189 depending on current condition. We also have recurring plans starting at $119/visit. Are you looking for a one-time clean or something more regular?
Client: Probably just a one-time for now.
Agent: Got it. A one-time deep clean covers all bathrooms, kitchen, living areas, and bedrooms — supplies included, no surprises. I have Saturday morning or Tuesday afternoon open. Which works better? 📅
EXAMPLE 2 — Price objection:
Client: That’s more than I was expecting honestly. I’ve seen ads for $80 cleans.
Agent: Fair — there’s a wide range out there. The difference with us: fully insured, background-checked team, hospital-grade products. Those $80 services usually send one person with basic supplies, and a lot of clients end up calling us to redo it. Do you have any flexibility on date? I sometimes have mid-week openings with a discount I can apply. 🗓️
Client: Yeah I’m flexible on date.
Agent: I can get you on Wednesday or Thursday and apply a $20 new-client discount — so you’d be at $149 for the full deep clean. Same quality, same guarantee. Want me to lock that in? 💪
EXAMPLE 3 — Anxious first-time customer:
Client: I’ve never hired cleaners before. I’m a little nervous about having strangers in my house honestly.
Agent: That’s completely understandable — it’s your home. Every cleaner on our team is background-checked, fully insured and bonded, and you can read reviews from real local clients on our site. A lot of our regulars felt the same way before their first clean. Would it help if I walked you through how the first visit works? 🏠
Client: Yeah that would actually help a lot.
Agent: On day one, a team lead does a quick walkthrough with you before starting — you show them anything specific and confirm your preferences. No one goes through drawers or private spaces unless you ask. You can be home or not — totally up to you. Want to try a first clean this week? 😊
EXAMPLE 4 — Complaint / quality issue:
Client: I just got home and the bathrooms look like they were barely touched. I’m really disappointed.
Agent: I’m really sorry — that’s not the standard we hold ourselves to and I completely understand why you’re frustrated. 😔 Can you send me a quick photo so I can document it and flag it to the team lead? I want to make this right.
Agent: I’ll have a crew back to you within 48 hours at zero charge to redo the bathrooms properly — and I’ll personally follow up after to make sure it’s done right. 💯
EXAMPLE 5 — Stall / "I need to think about it":
Client: I think I need to think about it a little more.
Agent: Of course — no rush. Mind if I ask what part you’re still weighing? Sometimes I can clear something up in 30 seconds, and if not, totally fine to take your time. 😊
Client: I guess I’m just not sure it’s worth the money right now.
Agent: That’s a fair thing to think through. Most clients say the thing they didn’t expect was how much time they got back — not just a clean house, but actual free hours on weekends. 🕐 We also have a 100% satisfaction guarantee: if anything isn’t right, we come back free. The risk is on us. I can hold your spot until tomorrow morning if that helps.
EXAMPLE 6 — Move-out urgency:
Client: I need a move-out clean ASAP. I have to be out by Friday and I want my deposit back.
Agent: I’ve got you — move-out cleans are our specialty and we know exactly what landlords look for. 🚀 We have Thursday available (day before your deadline). Our move-out package covers: ✅ Full appliance clean-out ✅ Baseboards + inside cabinets ✅ Bathrooms deep-scrubbed ✅ Deposit-focused checklist. Want me to lock Thursday in?
EXAMPLE 7 — Referral lead:
Client: Hey, my friend Sarah recommended you guys. She said you’re great.
Agent: Sarah’s a great client — glad she sent you our way! 😊 Since you came from a referral, I can give you $20 off your first clean and Sarah gets a thank-you credit too. What does your place look like — how many beds/baths? I’ll get you a quick quote.
EXAMPLE 8 — Happy client upsell to recurring:
Client: You guys did a great job last week. Really happy with it!
Agent: Really glad to hear it — thank you! 🙌 Quick thought: we have a bi-weekly plan that keeps your home at that level all the time, not just after a deep clean. Most clients say it takes the stress out of the week knowing it’s handled. Because you’re already in our system, I’d lock you in at our recurring rate of [Recurring Rate]/visit. Want me to set that up automatically?
EXAMPLE 9 — Lost lead re-engagement:
Agent: Hey [Name]! 👋 Just checking in — we quoted you a deep clean a couple weeks ago and wanted to see if you’re still interested or if your plans changed. No pressure at all.
Client: Oh yeah sorry I just forgot to follow up. Still interested.
Agent: No worries at all. I can apply our welcome-back promo and get you $15 off the original quote. Want to grab [Day 1] at 10am or [Day 2] at 2pm? I’ll hold a spot for the next hour. 🕐
EXAMPLE 10 — Post-clean review request:
Agent: Hi [Name]! Hope the clean went well today. If you have 60 seconds, an honest Google review would mean a lot to our team — it’s the main way families in [City] find us. 👉 [Review Link] And if anything wasn’t perfect, reply here first — I want to make it right before anything else.
Client: Loved it! Just left you 5 stars 😊
Agent: Thank you so much — that genuinely helps us. 🙏 As a small thank-you, your next booking gets $15 off automatically — no code needed. See you next time!
---
CRITICAL RULES (never break these):
- NEVER invent or guess prices, totals, or dollar amounts. If pricing is needed, write [Total Amount] as a placeholder for the agent to fill in.
- NEVER use hollow filler or cringe phrases: no "Awesome!", "Great news!", "Thanks for clarifying!", "We’re all set!", "Happy to help!", "Get you sparkling!", "Sounds great!", "Win-win!", "You’re in great hands!", "Let’s get you that feeling!", "You are the BEST!!", "So glad it hit the mark", "Love that!", "That makes our whole team’s day"
- Always use the client’s actual first name — never write [Client Name] or any placeholder for the name.
- Keep responses concise — under 3 sentences unless a bullet list is genuinely needed (like a move-out package or trust signals for an anxious client).
- Sound like a real person who is good at their job — warm and direct, not a hype bot.`;

        // ── AI Suggest: analyze conversation and pick best action + write draft ─
        if (input.action === "ai_suggest") {
          if (isTeams) {
            // Teams: operational response — short, direct, action-oriented (internal ops, not customer-facing)
            const result = await invokeLLM({
              messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: `You are a field operations manager responding to a text from your cleaner ${firstName}. Read the conversation below and write the ideal next SMS reply. This is an INTERNAL operational message — be direct, action-oriented, and concise. Examples of the right tone: "Tell them to wait outside, I'll call the client now.", "Finish what you can and head out — I'll handle the client.", "Go ahead and skip it, I'll reschedule.", "Call me when you're done with the first room.". Keep it to 1-2 sentences. No emojis. No "Hey [name]," opener — just the action. IMPORTANT: use the actual name "${firstName}" only if you naturally address them, never write [Name] or any placeholder.\n\nConversation:\n${conversationSnippet || "(no messages yet)"}` },
              ],
            });
            const draft = ((result.choices?.[0]?.message?.content as string) ?? "").trim();
            return { draft, suggestedAction: null };
          }
          // Client: pick best action + write draft
          const result = await invokeLLM({
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: `Analyze this customer service conversation for a home cleaning company. The client's name is "${firstName}".

Your job:
1. Read the FULL conversation to understand their intent and emotional state — not just the last message.
2. If they've already committed to booking, treat it as done. Move forward: confirm the detail they asked about, then advance to the next practical step (entry access, address confirmation, etc.). Do NOT re-ask decisions they've already made.
3. If they're frustrated or something went wrong, lead with acknowledgment before solving.
4. Choose the single best next action: send_quote, make_it_right, refer_friend, running_late, on_the_way, review_rebook.
5. Write the SMS draft. Start with "Hey ${firstName},". Max 2 sentences. Sound like a real person texting — confident, warm, direct.
6. CRITICAL: Never invent prices or dollar amounts. If pricing is needed, write [Total Amount] as a placeholder.
7. CRITICAL: Use the actual name "${firstName}" — never write [Client Name] or any placeholder.

Conversation:\n${conversationSnippet || "(no messages yet)"}

Respond in this exact JSON format: {"action": "<action_key>", "draft": "<sms message>"}` },
            ],
            response_format: {
              type: "json_schema",
              json_schema: {
                name: "ai_suggest_result",
                strict: true,
                schema: {
                  type: "object",
                  properties: {
                    action: { type: "string", description: "One of: send_quote, make_it_right, refer_friend, running_late, on_the_way, review_rebook" },
                    draft: { type: "string", description: "The SMS draft message" },
                  },
                  required: ["action", "draft"],
                  additionalProperties: false,
                },
              },
            },
          });
          try {
            const parsed = JSON.parse((result.choices?.[0]?.message?.content as string) ?? "{}");
            return { draft: parsed.draft ?? "", suggestedAction: parsed.action ?? null };
          } catch {
            return { draft: "", suggestedAction: null };
          }
        }

        // ── Named quick-reply actions ─────────────────────────────────────────
        // Teams gets its own set of field-management action prompts
        const teamsActionPrompts: Record<string, string> = {
          send_quote: `Write a brief SMS to a cleaner named ${firstName} acknowledging their request for bigger or better jobs. Start with "Hey ${firstName},". Let them know you'll keep them in mind for larger jobs and appreciate their initiative. Keep it to 2 sentences. No emojis. IMPORTANT: use the actual name "${firstName}" — never write [Name] or any placeholder.`,
          make_it_right: `Write a brief SMS to a cleaner named ${firstName} who is having an access issue at a job site. Start with "Hey ${firstName},". Acknowledge the problem and give them a clear next step (e.g., try the lockbox, call the client, wait a few minutes). Keep it to 2 sentences. No emojis. IMPORTANT: use the actual name "${firstName}" — never write [Name] or any placeholder.`,
          refer_friend: `Write a brief SMS to a cleaner named ${firstName} encouraging them to refer another cleaner to join the team. Start with "Hey ${firstName},". Mention there's a referral bonus and keep it friendly. Keep it to 2 sentences. No emojis. IMPORTANT: use the actual name "${firstName}" — never write [Name] or any placeholder.`,
          running_late: `Write a brief SMS to a cleaner named ${firstName} who is running late to a job. Start with "Hey ${firstName},". Acknowledge the delay and remind them to text the client directly if they haven't already. Keep it to 1-2 sentences. No emojis. IMPORTANT: use the actual name "${firstName}" — never write [Name] or any placeholder.`,
          on_the_way: `Write a brief SMS to a cleaner named ${firstName} confirming they should head to their next job. Start with "Hey ${firstName},". Give a quick heads-up about the job (e.g., client is expecting them, check the notes). Keep it to 1 sentence. No emojis. IMPORTANT: use the actual name "${firstName}" — never write [Name] or any placeholder.`,
          review_rebook: `Write a brief SMS to a cleaner named ${firstName} following up after a job. Start with "Hey ${firstName},". Thank them for their work today and let them know about their next scheduled job or that you'll be in touch. Keep it to 2 sentences. No emojis. IMPORTANT: use the actual name "${firstName}" — never write [Name] or any placeholder.`,
        };
        const clientActionPrompts: Record<string, string> = {
          send_quote: `Write a friendly, confident SMS quote message for a home cleaning service. The client's name is "${firstName}" — start the message with "Hey ${firstName},". Based on the conversation, craft a natural price/availability message. If no specific details are known, write a warm message offering to send a custom quote. Keep it under 2 sentences. No emojis. Sound human, not corporate. IMPORTANT: use the actual name "${firstName}" — never write [Client Name] or any placeholder.`,
          make_it_right: `Write a sincere, empathetic de-escalation SMS for a home cleaning service. The client's name is "${firstName}" — start the message with "Hey ${firstName},". Acknowledge the issue without being defensive, and offer to make it right. Keep it under 3 sentences. No emojis. Sound genuine and caring. IMPORTANT: use the actual name "${firstName}" — never write [Client Name] or any placeholder.`,
          refer_friend: `Write a warm, natural referral ask SMS for a home cleaning service. The client's name is "${firstName}" — start the message with "Hey ${firstName},". Invite them to refer a friend and mention they'll both benefit. Keep it under 2 sentences. No emojis. Sound appreciative, not salesy. IMPORTANT: use the actual name "${firstName}" — never write [Client Name] or any placeholder.`,
          running_late: `Write a brief, apologetic SMS letting a client know their cleaner is running behind. The client's name is "${firstName}" — start the message with "Hey ${firstName},". Be specific that it's a short delay and reassure them the team is on the way. Keep it to 1-2 sentences. No emojis. Sound professional and caring. IMPORTANT: use the actual name "${firstName}" — never write [Client Name] or any placeholder.`,
          on_the_way: `Write a brief, upbeat SMS letting a client know their cleaner is on the way. The client's name is "${firstName}" — start the message with "Hey ${firstName},". Keep it to 1 sentence. No emojis. Sound warm and professional. IMPORTANT: use the actual name "${firstName}" — never write [Client Name] or any placeholder.`,
          review_rebook: `Write a warm post-job SMS asking for a review and offering to rebook. The client's name is "${firstName}" — start the message with "Hey ${firstName},". Naturally ask for a Google review and mention scheduling the next clean. Keep it under 3 sentences. No emojis. Sound genuine, not scripted. IMPORTANT: use the actual name "${firstName}" — never write [Client Name] or any placeholder.`,
        };
        const actionPrompts = isTeams ? teamsActionPrompts : clientActionPrompts;
        const userPrompt = conversationSnippet
          ? `Recent conversation:\n${conversationSnippet}\n\n${actionPrompts[input.action]}`
          : actionPrompts[input.action];
        const result = await invokeLLM({
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
        });
        const draft = ((result.choices?.[0]?.message?.content as string) ?? "").trim();
        return { draft, suggestedAction: null };
      }),

    /**
     * getCsConvInsight — MOVED to opsChatRouter.ts
     * @deprecated use trpc.opsChat.getCsConvInsight instead
     */
    // getCsConvInsight removed — see opsChatRouter.ts

    /**
     * getUpsellOpportunity — detects upsell signals in a CS conversation and
     * returns a structured upsell prompt when a customer has booked a standard
     * clean but signals (large home, first-time, move-in, pet owner, etc.)
     * suggest they'd benefit from a deep clean or specific add-ons.
     * Returns null when no upsell opportunity is detected.
     */
    getUpsellOpportunity: opsChatProcedure
      .input(z.object({
        sessionId: z.number(),
        messageHistory: z.string(),
        clientName: z.string().optional(),
        clientProfile: z.string().optional(),
        serviceType: z.string().optional(),
        bedrooms: z.string().optional(),
        bathrooms: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const messages: Array<{ role: string; content: string }> = (() => {
          try { return JSON.parse(input.messageHistory); } catch { return []; }
        })();
        if (messages.length === 0) return { upsell: null };
        // Skip only if explicitly a deep clean already booked
        const service = (input.serviceType ?? "").toLowerCase();
        if (service.includes("deep clean")) return { upsell: null };
        const recent = messages.slice(-16);
        const snippet = recent
          .map((m) => `${m.role === "user" ? "Client" : "Agent"}: ${m.content}`)
          .join("\n");
        const profileCtx = input.clientProfile
          ? `\n\nCLIENT HISTORY:\n${input.clientProfile}`
          : "";
        const sizeCtx = (input.bedrooms || input.bathrooms)
          ? `\nHome size: ${input.bedrooms ?? "?"} / ${input.bathrooms ?? "?"}`
          : "";
        const serviceCtx = service ? `\nBooked service: ${service}` : "";
        const systemPrompt = `You are a senior sales coach for Maids in Black, a premium home cleaning company in DC/MD/VA. Analyze this CS conversation and determine if there is a genuine upsell opportunity for one of our add-on services.

SIGNAL TO ADD-ON MAPPING (pick the single best match):
- First-time customer / long gap since last clean / post-reno / dirty home -> Deep Cleaning upgrade
- Move-in or move-out -> Move-In/Move-Out package (+$60) OR Inside Cabinets (+$30)
- Customer mentions oven, cooking, baking -> Clean Inside Oven (+$30)
- Customer mentions fridge, moving out, fresh start -> Clean Inside Fridge (+$25 empty / +$40 full)
- Customer mentions pets or pet hair -> I Have Pets add-on (+$15)
- Customer mentions dirty windows, natural light -> Clean Interior Windows (+$40)
- Customer mentions basement -> Clean Finished Basement (+$60)
- Customer mentions eco-friendly, green, allergies, chemical-sensitive -> Green Cleaning (+$20)
- Customer mentions clutter, disorganized, overwhelmed -> 2 Hours of Organizing (+$80)
- Customer mentions laundry piling up, busy family -> Load of Laundry (+$20)
- Customer mentions dirty walls, kids drawing on walls -> Wipe Walls (+$35)
- Customer mentions garage -> Sweep Garage (+$25)
- Customer mentions balcony, patio, outdoor space -> Balcony Sweep (+$20)
- Customer mentions microwave -> Clean Inside Microwave (+$15)
- Customer mentions dishes in sink -> Wash Dishes (+$20)
- Customer mentions pool deck -> Pool Deck (+$45)
- Customer mentions shed, pool house -> Shed/Pool House (+$50)
- Customer seems price-sensitive but engaged -> Recurring biweekly plan (saves 15%)

IMPORTANT: You MUST respond with valid JSON only. No explanation, no markdown, just JSON.

If you detect a clear upsell signal, respond EXACTLY like this example:
{"detected": true, "signal": "Customer mentioned their oven needs attention", "pitch": "By the way, we also offer an inside oven cleaning for just $30 — want us to add that to your booking today?", "upsellType": "Clean Inside Oven (+$30)"}

If no clear signal exists in the conversation, respond EXACTLY like this:
{"detected": false}

Be somewhat generous — if there is any reasonable signal, flag it. Only respond with detected:false if the conversation has no upsell signals at all.${profileCtx}${sizeCtx}${serviceCtx}`;
        const result = await invokeLLM({
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: `CONVERSATION:\n${snippet}\n\nRespond with JSON only.` },
          ],
        });
        const rawContent = result.choices?.[0]?.message?.content;
        let raw = typeof rawContent === "string" ? rawContent.trim() : "";
        // Strip markdown code fences if present
        raw = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
        try {
          const parsed = JSON.parse(raw);
          if (!parsed.detected) return { upsell: null };
          return {
            upsell: {
              signal: (parsed.signal as string) || "",
              pitch: (parsed.pitch as string) || "",
              upsellType: (parsed.upsellType as string) || "Upgrade",
            },
          };
        } catch (e) {
          console.error("[getUpsellOpportunity] JSON parse failed:", raw);
          return { upsell: null };
        }
      }),
    /**
     * batchResolveNames — given an array of raw phone strings, returns a map of
     * { normalizedPhone10 -> resolvedName } in a single round-trip.
     * Priority: cleanerProfiles > completedJobs > cleanerJobs.customerName > quoteLeads
     */
    batchResolveNames: opsChatProcedure
      .input(z.object({ phones: z.array(z.string()).max(100) }))
      .query(async ({ input }) => {
        const db = await getDb();
        if (!db) throw new Error("Database unavailable");
        const digits10 = (p: string) => p.replace(/[^\d]/g, "").slice(-10);
        const normalized = input.phones.map(digits10).filter((p) => p.length === 10);
        if (normalized.length === 0) return {} as Record<string, string>;

        const result: Record<string, string> = {};

        // 1. cleanerProfiles (exact match on 10-digit phone)
        const cleanerRows = await db
          .select({ phone: cleanerProfiles.phone, name: cleanerProfiles.name })
          .from(cleanerProfiles)
          .where(inArray(cleanerProfiles.phone, normalized));
        for (const r of cleanerRows) {
          if (r.phone && r.name) result[r.phone] = r.name;
        }

        // 2. completedJobs (phone stored as E.164 +1xxxxxxxxxx)
        const e164List = normalized.filter((p) => !result[p]).map((p) => `+1${p}`);
        if (e164List.length > 0) {
          const histRows = await db
            .select({ phone: completedJobs.phone, name: completedJobs.name })
            .from(completedJobs)
            .where(inArray(completedJobs.phone, e164List))
            .groupBy(completedJobs.phone, completedJobs.name)
            .limit(e164List.length * 2);
          for (const r of histRows) {
            if (!r.phone || !r.name) continue;
            const p10 = digits10(r.phone);
            if (!result[p10]) result[p10] = r.name;
          }
        }

        // 3. cleanerJobs.customerName (phone stored as (xxx) xxx-xxxx, normalize via SQL)
        const stillMissing = normalized.filter((p) => !result[p]);
        if (stillMissing.length > 0) {
          for (const p10 of stillMissing) {
            const [cj] = await db
              .select({ customerName: cleanerJobs.customerName })
              .from(cleanerJobs)
              .where(sql`REGEXP_REPLACE(${cleanerJobs.customerPhone}, '[^0-9]', '') = ${p10}`)
              .limit(1);
            if (cj?.customerName) result[p10] = cj.customerName;
          }
        }

        // 4. quoteLeads fallback
        const stillMissing2 = normalized.filter((p) => !result[p]);
        if (stillMissing2.length > 0) {
          for (const p10 of stillMissing2) {
            const [ql] = await db
              .select({ name: quoteLeads.name })
              .from(quoteLeads)
              .where(sql`REGEXP_REPLACE(${quoteLeads.phone}, '[^0-9]', '') LIKE ${'%' + p10}`)
              .limit(1);
            if (ql?.name) result[p10] = ql.name;
          }
        }

        return result;
      }),
    /**
     * addCsNote — saves an internal note to a CS conversation's messageHistory. (internal)
     * Notes use role="note" so they are never sent to the customer via SMS.
     * They appear in the thread as amber sticky-note bubbles visible only to agents.
     */
    addCsNote: opsChatProcedure
      .input(z.object({
        sessionId: z.number().int().positive(),
        note: z.string().min(1).max(2000),
      }))
      .mutation(async ({ input, ctx }) => {
        const agentSession = await getAgentSessionFromCtx(ctx);
        const db = await getDb();
        if (!db) throw new Error("Database unavailable");
        const [session] = await db
          .select()
          .from(conversationSessions)
          .where(eq(conversationSessions.id, input.sessionId))
          .limit(1);
        if (!session) throw new Error("Session not found");
        let history: Array<{ role: string; content: string; ts?: number; senderName?: string }> = [];
        try { history = JSON.parse(session.messageHistory ?? "[]"); } catch { history = []; }
        history.push({ role: "note", content: input.note, ts: Date.now(), senderName: agentSession.agentName });
        await db
          .update(conversationSessions)
          .set({ messageHistory: JSON.stringify(history) })
          .where(eq(conversationSessions.id, input.sessionId));
        return { success: true };
      }),
  }),
  /**
   * agents — agent auth + lead action procedures..
   *
   * Agents authenticate with email + password (no Manus account needed).
   * Their session is stored in a separate "agent_session_id" cookie.
   * The agentSession is read from the cookie on each request.
   */
  agents: router({
    /**
     * agents.login — authenticate with email + password, set agent session cookie.
     */
    login: publicProcedure
      .input(z.object({
        email: z.string().email(),
        password: z.string().min(1),
      }))
      .mutation(async ({ input, ctx }) => {
        const agent = await getAgentByEmail(input.email.toLowerCase().trim());
        if (!agent || !agent.isActive) {
          throw new Error("Invalid email or password");
        }
        const valid = await bcrypt.compare(input.password, agent.passwordHash);
        if (!valid) {
          throw new Error("Invalid email or password");
        }
        const token = await signAgentSession({
          agentId: agent.id,
          agentName: agent.name,
          agentEmail: agent.email,
          isAdmin: agent.isAdmin === 1,
        });
        const cookieOpts = getSessionCookieOptions(ctx.req);
        ctx.res.cookie(AGENT_COOKIE_NAME, token, {
          ...cookieOpts,
          maxAge: ONE_YEAR_MS, // 1 year — persist across browser restarts
        });
        return { success: true, agent: { id: agent.id, name: agent.name, email: agent.email, isAdmin: agent.isAdmin === 1 } };
      }),

    /**
     * agents.logout — clear the agent session cookie.
     */
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOpts = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(AGENT_COOKIE_NAME, { ...cookieOpts, maxAge: -1 });
      return { success: true };
    }),

    /**
     * agents.previewAsAgent — admin-only: set an agent session cookie using the admin's
     * own identity so they can preview the /agent workspace without a separate login.
     * The session is valid for 2 hours.
     */
    previewAsAgent: adminAgentProcedure.mutation(async ({ ctx }) => {
      // Read the admin's current agent session to get their identity
      const cookieHeader = ctx.req.headers.cookie;
      const adminToken = cookieHeader ? parseCookie(cookieHeader)[AGENT_COOKIE_NAME] ?? null : null;
      const adminSession = await verifyAgentSession(adminToken);
      if (!adminSession) throw new TRPCError({ code: "UNAUTHORIZED", message: "No admin session found" });

      // Issue a short-lived agent session (2 hours) with the admin's identity
      const TWO_HOURS_MS = 2 * 60 * 60 * 1000;
      const previewToken = await signAgentSession(
        {
          agentId: adminSession.agentId,
          agentName: adminSession.agentName,
          agentEmail: adminSession.agentEmail,
          isAdmin: true, // keep admin flag so they can switch back
        },
        TWO_HOURS_MS
      );
      const cookieOpts = getSessionCookieOptions(ctx.req);
      ctx.res.cookie(AGENT_COOKIE_NAME, previewToken, {
        ...cookieOpts,
        maxAge: TWO_HOURS_MS,
      });
      return { success: true };
    }),

    /**
     * agents.me — return the current agent from the session cookie, or null.
     */
    me: publicProcedure.query(async ({ ctx }) => {
      const session = await verifyAgentSession(
        (() => {
          const cookieHeader = ctx.req.headers.cookie;
          if (!cookieHeader) return null;
          return parseCookie(cookieHeader)[AGENT_COOKIE_NAME] ?? null;
        })()
      );
      if (!session) return null;
      const agent = await getAgentById(session.agentId);
      if (!agent || !agent.isActive) return null;
      // Parse pagePermissions: null = unrestricted, string = JSON array of page IDs
      let pagePermissions: string[] | null = null;
      if (agent.pagePermissions !== null && agent.pagePermissions !== undefined) {
        try { pagePermissions = JSON.parse(agent.pagePermissions as string); } catch { pagePermissions = null; }
      }
      return { id: agent.id, name: agent.name, email: agent.email, isActive: agent.isActive, isAdmin: agent.isAdmin === 1, pagePermissions, awayStatus: agent.awayStatus ?? null };
    }),

    /**
     * agents.claimLead — assign a lead to the calling agent.
     */
    claimLead: publicProcedure
      .input(z.object({ sessionId: z.number().int().positive() }))
      .mutation(async ({ input, ctx }) => {
        const agentSession = await getAgentSessionFromCtx(ctx);
        const db = await getDb();
        if (!db) throw new Error("Database unavailable");
        const [session] = await db
          .select()
          .from(conversationSessions)
          .where(eq(conversationSessions.id, input.sessionId))
          .limit(1);
        if (!session) throw new Error("Lead not found");
        if (session.assignedAgentId && session.assignedAgentId !== agentSession.agentId) {
          throw new Error("This lead is already claimed by another agent");
        }
        await db
          .update(conversationSessions)
          .set({ assignedAgentId: agentSession.agentId, assignedAgentName: agentSession.agentName })
          .where(eq(conversationSessions.id, input.sessionId));
        // Sync claim to the matching new_lead opsChatMessage so the HotLeadsTray reflects it
        await syncClaimToOpsChatMessage(db, input.sessionId, agentSession.agentName, Date.now());
        const { broadcastOpsUpdate } = await import("./sseBroadcast");
        broadcastOpsUpdate("lead_update");
        return { success: true };
      }),
    /**
     * agents.unclaimLead — release a lead back to unassigned.
     */
    unclaimLead: publicProcedure
      .input(z.object({ sessionId: z.number().int().positive() }))
      .mutation(async ({ input, ctx }) => {
        const agentSession = await getAgentSessionFromCtx(ctx);
        const db = await getDb();
        if (!db) throw new Error("Database unavailable");
        const [session] = await db
          .select()
          .from(conversationSessions)
          .where(eq(conversationSessions.id, input.sessionId))
          .limit(1);
        if (!session) throw new Error("Lead not found");
        if (session.assignedAgentId !== agentSession.agentId) {
          throw new Error("You can only unclaim leads assigned to you");
        }
         await db
          .update(conversationSessions)
          .set({ assignedAgentId: null, assignedAgentName: null })
          .where(eq(conversationSessions.id, input.sessionId));
        // Clear claim from the matching new_lead opsChatMessage
        await syncClaimToOpsChatMessage(db, input.sessionId, null, null);
        const { broadcastOpsUpdate } = await import("./sseBroadcast");
        broadcastOpsUpdate("lead_update");
        return { success: true };
      }),
    /**
     * agents.logCall — record a call attempt with outcome and optional notes.
     */
    logCall: publicProcedure
      .input(z.object({
        sessionId: z.number().int().positive(),
        outcome: z.enum(callOutcomes as unknown as [string, ...string[]]),
        notes: z.string().max(1000).optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const agentSession = await getAgentSessionFromCtx(ctx);
        const db = await getDb();
        if (!db) throw new Error("Database unavailable");
        const now = new Date();
        await db.insert(leadCallLogs).values({
          sessionId: input.sessionId,
          agentId: agentSession.agentId,
          agentName: agentSession.agentName,
          outcome: input.outcome,
          notes: input.notes ?? null,
          calledAt: now,
        });
        const updates: Record<string, unknown> = {
          lastCalledAt: now,
          lastCalledByAgentId: agentSession.agentId,
          lastCalledByAgentName: agentSession.agentName,
        };
        if (input.outcome === "BOOKED") {
          updates.isBooked = 1;
          updates.bookedAt = now;
          updates.bookedByAgentId = agentSession.agentId;
          updates.bookedByAgentName = agentSession.agentName;
        }
        await db
          .update(conversationSessions)
          .set(updates)
          .where(eq(conversationSessions.id, input.sessionId));
        return { success: true };
      }),

    /**
     * agents.markBooked — explicitly mark a lead as booked.
     */
    markBooked: publicProcedure
      .input(z.object({ sessionId: z.number().int().positive() }))
      .mutation(async ({ input, ctx }) => {
        const agentSession = await getAgentSessionFromCtx(ctx);
        const db = await getDb();
        if (!db) throw new Error("Database unavailable");
        const now = new Date();
        await db
          .update(conversationSessions)
          .set({
            isBooked: 1,
            stage: "BOOKED",   // sync stage so admin metrics pick it up
            bookedAt: now,
            bookedByAgentId: agentSession.agentId,
            bookedByAgentName: agentSession.agentName,
          })
          .where(eq(conversationSessions.id, input.sessionId));
        // Increment campaign bookedCount if this is a reactivation lead
        await markReactivationContactBooked(input.sessionId).catch(console.error);
        return { success: true };
      }),

    /**
     * agents.markUnbooked — revert a booked lead back to a specified stage.
     * Any authenticated agent can call this.
     */
    markUnbooked: publicProcedure
      .input(z.object({
        sessionId: z.number().int().positive(),
        stage: z.enum(["FOLLOW_UP", "AVAILABILITY", "QUOTE_SENT", "LOST"]).default("FOLLOW_UP"),
      }))
      .mutation(async ({ input, ctx }) => {
        await getAgentSessionFromCtx(ctx); // require agent auth
        const db = await getDb();
        if (!db) throw new Error("Database unavailable");
        await db
          .update(conversationSessions)
          .set({
            isBooked: 0,
            stage: input.stage,
            bookedAt: null,
          })
          .where(eq(conversationSessions.id, input.sessionId));
        return { success: true };
      }),

    /**
     * agents.setBookedAmount — agent sets the actual invoiced/booked dollar amount.
     * Any authenticated agent can set this on any session.
     */
    setBookedAmount: publicProcedure
      .input(z.object({
        sessionId: z.number().int().positive(),
        bookedAmount: z.number().int().min(0).nullable(),
      }))
      .mutation(async ({ input, ctx }) => {
        await getAgentSessionFromCtx(ctx); // require agent auth
        const db = await getDb();
        if (!db) throw new Error("Database unavailable");
        await db
          .update(conversationSessions)
          .set({ bookedAmount: input.bookedAmount })
          .where(eq(conversationSessions.id, input.sessionId));
        return { success: true };
      }),

    /**
     * agents.markNotInterested — mark a lead as not interested (sets stage to NOT_INTERESTED).
     * Any authenticated agent can call this.
     */
    markNotInterested: publicProcedure
      .input(z.object({ sessionId: z.number().int().positive() }))
      .mutation(async ({ input, ctx }) => {
        await getAgentSessionFromCtx(ctx); // require agent auth
        const db = await getDb();
        if (!db) throw new Error("Database unavailable");
        await db
          .update(conversationSessions)
          .set({ stage: "NOT_INTERESTED" })
          .where(eq(conversationSessions.id, input.sessionId));
        return { success: true };
      }),

    /**
     * agents.getCallLogs — get all call log entries for a specific session.
     */
    getCallLogs: publicProcedure
      .input(z.object({ sessionId: z.number().int().positive() }))
      .query(async ({ input, ctx }) => {
        await getAgentSessionFromCtx(ctx); // require auth
        const db = await getDb();
        if (!db) return [];
        return db
          .select()
          .from(leadCallLogs)
          .where(eq(leadCallLogs.sessionId, input.sessionId))
          .orderBy(desc(leadCallLogs.calledAt));
      }),

    /**
     * agents.myLeads — get all leads assigned to the current agent.
     */
    myLeads: publicProcedure.query(async ({ ctx }) => {
      const agentSession = await getAgentSessionFromCtx(ctx);
      const db = await getDb();
      if (!db) return [];
      return db
        .select()
        .from(conversationSessions)
        .where(eq(conversationSessions.assignedAgentId, agentSession.agentId))
        .orderBy(desc(conversationSessions.updatedAt))
        .limit(500);
    }),

    // ── Admin-only agent management ────────────────────────────────────────────

    /**
     * agents.create — admin creates a new agent account.
     * Requires admin agent session (isAdmin=true in agent cookie).
     */
    create: adminAgentProcedure
      .input(z.object({
        name: z.string().min(1).max(255),
        email: z.string().email().max(320),
        password: z.string().min(6).max(128),
      }))
      .mutation(async ({ input }) => {
        const existing = await getAgentByEmail(input.email.toLowerCase().trim());
        if (existing) throw new Error("An agent with this email already exists");
        const passwordHash = await bcrypt.hash(input.password, 12);
        await createAgent({
          name: input.name,
          email: input.email.toLowerCase().trim(),
          passwordHash,
        });
        return { success: true };
      }),

    /**
     * agents.list — admin lists all agent accounts.
     */
    list: adminAgentProcedure.query(async () => {
      const all = await getAllAgents();
      // Never return passwordHash to the client
      return all.map(a => {
        let pagePermissions: string[] | null = null;
        if (a.pagePermissions !== null && a.pagePermissions !== undefined) {
          try { pagePermissions = JSON.parse(a.pagePermissions as string); } catch { pagePermissions = null; }
        }
        return {
          id: a.id,
          name: a.name,
          email: a.email,
          isActive: a.isActive,
          isAdmin: a.isAdmin,
          pagePermissions,
          createdAt: a.createdAt,
        };
      });
    }),

    /**
     * agents.setActive — admin activates or deactivates an agent.
     */
    setActive: adminAgentProcedure
      .input(z.object({ agentId: z.number().int().positive(), isActive: z.boolean() }))
      .mutation(async ({ input }) => {
        await setAgentActive(input.agentId, input.isActive ? 1 : 0);
        return { success: true };
      }),

    /**
     * agents.resetPassword — admin resets an agent's password.
     */
    resetPassword: adminAgentProcedure
      .input(z.object({ agentId: z.number().int().positive(), newPassword: z.string().min(6) }))
      .mutation(async ({ input }) => {
        const db = await getDb();
        if (!db) throw new Error("Database unavailable");
        const { agents: agentsTable } = await import("../drizzle/schema");
        const passwordHash = await bcrypt.hash(input.newPassword, 12);
        await db.update(agentsTable).set({ passwordHash }).where(eq(agentsTable.id, input.agentId));
        return { success: true };
      }),

    /**
     * agents.setPagePermissions — admin sets which admin pages an agent can access.
     * Pass pagePermissions: null to remove all restrictions (agent sees everything).
     * Pass pagePermissions: [] to block all pages.
     * Pass pagePermissions: ["leads", "pipeline"] to allow specific pages.
     */
    setPagePermissions: adminAgentProcedure
      .input(z.object({
        agentId: z.number().int().positive(),
        pagePermissions: z.array(z.string()).nullable(),
      }))
      .mutation(async ({ input }) => {
        const db = await getDb();
        if (!db) throw new Error("Database unavailable");
        const { agents: agentsTable } = await import("../drizzle/schema");
        const permValue = input.pagePermissions === null ? null : JSON.stringify(input.pagePermissions);
        await db.update(agentsTable).set({ pagePermissions: permValue }).where(eq(agentsTable.id, input.agentId));
        return { success: true };
      }),

    /**
     * agents.updateNotes — save or update internal notes for a lead session.
     * Accessible by any authenticated agent (or admin agent).
     */
    updateNotes: publicProcedure
      .input(z.object({
        sessionId: z.number().int().positive(),
        notes: z.string().max(5000),
      }))
      .mutation(async ({ input, ctx }) => {
        await getAgentSessionFromCtx(ctx); // require agent auth
        const db = await getDb();
        if (!db) throw new Error("Database unavailable");
        await db
          .update(conversationSessions)
          .set({ internalNotes: input.notes })
          .where(eq(conversationSessions.id, input.sessionId));
        return { success: true };
      }),

    /**
     * agents.getNotes — fetch internal notes for a lead session.
     */
    getNotes: publicProcedure
      .input(z.object({ sessionId: z.number().int().positive() }))
      .query(async ({ input, ctx }) => {
        await getAgentSessionFromCtx(ctx); // require agent auth
        const db = await getDb();
        if (!db) return { notes: null };
        const [row] = await db
          .select({ internalNotes: conversationSessions.internalNotes })
          .from(conversationSessions)
          .where(eq(conversationSessions.id, input.sessionId))
          .limit(1);
        return { notes: row?.internalNotes ?? null };
      }),

    /**
     * agents.performance — per-agent leaderboard stats.
     * Returns for each active agent:
     *   callsThisWeek, bookingsThisWeek, totalAssigned, bookingsAllTime, conversionRate
     */
    performance: adminAgentProcedure.query(async () => {
      const db = await getDb();
      if (!db) return [];

      const { agents: agentsTable } = await import("../drizzle/schema");

      const allAgents = await db
        .select({ id: agentsTable.id, name: agentsTable.name, email: agentsTable.email, isActive: agentsTable.isActive })
        .from(agentsTable)
        .where(eq(agentsTable.isActive, 1));

      // Start of this week (Monday 00:00:00 UTC)
      const now = new Date();
      const dayOfWeek = now.getUTCDay();
      const daysToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
      const weekStart = new Date(now);
      weekStart.setUTCDate(now.getUTCDate() - daysToMonday);
      weekStart.setUTCHours(0, 0, 0, 0);

      const callsThisWeek = await db
        .select({ agentId: leadCallLogs.agentId, count: sql<number>`count(*)`.as("count") })
        .from(leadCallLogs)
        .where(gte(leadCallLogs.calledAt, weekStart))
        .groupBy(leadCallLogs.agentId);

      const bookingsThisWeek = await db
        .select({ agentId: conversationSessions.bookedByAgentId, count: sql<number>`count(*)`.as("count") })
        .from(conversationSessions)
        .where(and(eq(conversationSessions.isBooked, 1), gte(conversationSessions.bookedAt, weekStart)))
        .groupBy(conversationSessions.bookedByAgentId);

      const totalAssigned = await db
        .select({ agentId: conversationSessions.assignedAgentId, count: sql<number>`count(*)`.as("count") })
        .from(conversationSessions)
        .where(sql`${conversationSessions.assignedAgentId} IS NOT NULL`)
        .groupBy(conversationSessions.assignedAgentId);

      const bookingsAllTime = await db
        .select({ agentId: conversationSessions.bookedByAgentId, count: sql<number>`count(*)`.as("count") })
        .from(conversationSessions)
        .where(eq(conversationSessions.isBooked, 1))
        .groupBy(conversationSessions.bookedByAgentId);

      // Revenue closed per agent: sum of bookedAmount ?? quotedPrice for booked sessions
      const revenuePerAgent = await db
        .select({
          agentId: conversationSessions.bookedByAgentId,
          revenue: sql<number>`SUM(COALESCE(${conversationSessions.bookedAmount}, CAST(${conversationSessions.quotedPrice} AS UNSIGNED), 0))`.as("revenue"),
        })
        .from(conversationSessions)
        .where(eq(conversationSessions.isBooked, 1))
        .groupBy(conversationSessions.bookedByAgentId);

      // Avg response time per agent: avg minutes from session.createdAt to agent's first call
      // Uses a raw SQL subquery to avoid Drizzle join chain limitations in test mocks
      const responseTimeRows = await db.execute(
        sql`SELECT cl.agentId,
               ROUND(AVG(TIMESTAMPDIFF(MINUTE, cs.createdAt, cl.calledAt))) AS avgMinutes
            FROM lead_call_logs cl
            INNER JOIN conversation_sessions cs ON cs.id = cl.sessionId
            WHERE cl.calledAt = (
              SELECT MIN(cl2.calledAt) FROM lead_call_logs cl2
              WHERE cl2.sessionId = cl.sessionId AND cl2.agentId = cl.agentId
            )
            GROUP BY cl.agentId`
);
      // MySQL2 execute() returns [rows, fields]; rows is the first element
      const rtRows = (Array.isArray(responseTimeRows) ? responseTimeRows[0] : []) as Array<{ agentId: number; avgMinutes: number | null }>;

      const callsMap = new Map(callsThisWeek.map(r => [r.agentId, Number(r.count)]));
      const bookingsWeekMap = new Map(bookingsThisWeek.map(r => [r.agentId, Number(r.count)]));
      const assignedMap = new Map(totalAssigned.map(r => [r.agentId, Number(r.count)]));
      const bookingsAllTimeMap = new Map(bookingsAllTime.map(r => [r.agentId, Number(r.count)]));
      const revenueMap = new Map(revenuePerAgent.map(r => [r.agentId, Number(r.revenue)]));
      const responseTimeMap = new Map(
        rtRows.map((r) =>
          [Number(r.agentId), r.avgMinutes !== null ? Math.round(Number(r.avgMinutes)) : null]
        )
      );

      return allAgents.map(agent => {
        const assigned = assignedMap.get(agent.id) ?? 0;
        const bookedAllTime = bookingsAllTimeMap.get(agent.id) ?? 0;
        const conversionRate = assigned > 0 ? Math.round((bookedAllTime / assigned) * 100) : 0;
        return {
          id: agent.id,
          name: agent.name,
          email: agent.email,
          callsThisWeek: callsMap.get(agent.id) ?? 0,
          bookingsThisWeek: bookingsWeekMap.get(agent.id) ?? 0,
          totalAssigned: assigned,
          bookingsAllTime: bookedAllTime,
          conversionRate,
          revenueBooked: revenueMap.get(agent.id) ?? 0,
          avgResponseTimeMinutes: responseTimeMap.get(agent.id) ?? null,
        };
      });
    }),

    /**
     * agents.myStats — personal performance stats for the calling agent.
     * Accepts optional dateFrom / dateTo (ISO date strings) for filtering.
     * Returns: leadsAssigned, bookedCount, bookedRevenue, conversionRate
     */
    myStats: publicProcedure
      .input(z.object({
        dateFrom: z.string().optional(),
        dateTo: z.string().optional(),
      }).optional())
      .query(async ({ ctx, input }) => {
        const agentSession = await getAgentSessionFromCtx(ctx);
        const db = await getDb();
        if (!db) return { leadsAssigned: 0, bookedCount: 0, bookedRevenue: 0, conversionRate: 0 };

        const conditions = buildDateConditions(input?.dateFrom, input?.dateTo);

        // All leads assigned to this agent in the date range
        const assignedRows = await db
          .select({ id: conversationSessions.id })
          .from(conversationSessions)
          .where(and(eq(conversationSessions.assignedAgentId, agentSession.agentId), conditions ?? sql`1=1`));
        const leadsAssigned = assignedRows.length;

        // Booked leads by this agent in the date range
        const bookedRows = await db
          .select({
            bookedAmount: conversationSessions.bookedAmount,
            quotedPrice: conversationSessions.quotedPrice,
            extras: conversationSessions.extras,
            reactivationLastPrice: conversationSessions.reactivationLastPrice,
            reactivationDiscountPct: conversationSessions.reactivationDiscountPct,
          })
          .from(conversationSessions)
          .where(and(
            eq(conversationSessions.bookedByAgentId, agentSession.agentId),
            eq(conversationSessions.isBooked, 1),
            conditions ?? sql`1=1`
          ));

        const bookedCount = bookedRows.length;
        const bookedRevenue = bookedRows.reduce((sum, row) => sum + calcBookedRevenue(row), 0);

         const conversionRate = leadsAssigned > 0 ? Math.round((bookedCount / leadsAssigned) * 100) : 0;

        // Call Assist stats — sessions created via Call Assist (leadSource = 'call') by this agent
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);
        const callAssistTodayRows = await db
          .select({ id: conversationSessions.id })
          .from(conversationSessions)
          .where(and(
            eq(conversationSessions.assignedAgentId, agentSession.agentId),
            eq(conversationSessions.leadSource, "call"),
            gte(conversationSessions.createdAt, todayStart)
          ));
        const callAssistToday = callAssistTodayRows.length;

        return { leadsAssigned, bookedCount, bookedRevenue, conversionRate, callAssistToday };
      }),
    /**
     * agents.callAssistStats — per-agent Call Assist conversion stats.
     * Used by the Team page to show call leads, call bookings, and call conversion rate per agent.
     * Admin-only.
     */
    callAssistStats: adminAgentProcedure.query(async () => {
      const db = await getDb();
      if (!db) return [];
      const { agents: agentsTable } = await import("../drizzle/schema");
      const allAgents = await db
        .select({ id: agentsTable.id, name: agentsTable.name, email: agentsTable.email })
        .from(agentsTable)
        .where(eq(agentsTable.isActive, 1));

      // Today boundaries
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const todayEnd = new Date();
      todayEnd.setHours(23, 59, 59, 999);

      // All call-assist sessions per agent (leadSource = 'call')
      const callLeadsAll = await db
        .select({ agentId: conversationSessions.assignedAgentId, count: sql<number>`count(*)`.as("count") })
        .from(conversationSessions)
        .where(and(
          eq(conversationSessions.leadSource, "call"),
          sql`${conversationSessions.assignedAgentId} IS NOT NULL`
        ))
        .groupBy(conversationSessions.assignedAgentId);

      // Call-assist sessions today per agent
      const callLeadsToday = await db
        .select({ agentId: conversationSessions.assignedAgentId, count: sql<number>`count(*)`.as("count") })
        .from(conversationSessions)
        .where(and(
          eq(conversationSessions.leadSource, "call"),
          sql`${conversationSessions.assignedAgentId} IS NOT NULL`,
          gte(conversationSessions.createdAt, todayStart),
          lte(conversationSessions.createdAt, todayEnd)
        ))
        .groupBy(conversationSessions.assignedAgentId);

      // Booked call-assist sessions per agent
      const callBookingsAll = await db
        .select({ agentId: conversationSessions.bookedByAgentId, count: sql<number>`count(*)`.as("count") })
        .from(conversationSessions)
        .where(and(
          eq(conversationSessions.leadSource, "call"),
          eq(conversationSessions.isBooked, 1),
          sql`${conversationSessions.bookedByAgentId} IS NOT NULL`
        ))
        .groupBy(conversationSessions.bookedByAgentId);

      // Revenue from call-assist bookings per agent
      const callRevenueAll = await db
        .select({
          agentId: conversationSessions.bookedByAgentId,
          revenue: sql<number>`SUM(COALESCE(${conversationSessions.bookedAmount}, CAST(${conversationSessions.quotedPrice} AS UNSIGNED), 0))`.as("revenue"),
        })
        .from(conversationSessions)
        .where(and(
          eq(conversationSessions.leadSource, "call"),
          eq(conversationSessions.isBooked, 1),
          sql`${conversationSessions.bookedByAgentId} IS NOT NULL`
        ))
        .groupBy(conversationSessions.bookedByAgentId);

      const callLeadsAllMap = new Map(callLeadsAll.map(r => [r.agentId, Number(r.count)]));
      const callLeadsTodayMap = new Map(callLeadsToday.map(r => [r.agentId, Number(r.count)]));
      const callBookingsAllMap = new Map(callBookingsAll.map(r => [r.agentId, Number(r.count)]));
      const callRevenueAllMap = new Map(callRevenueAll.map(r => [r.agentId, Number(r.revenue)]));

      return allAgents.map(agent => {
        const totalCalls = callLeadsAllMap.get(agent.id) ?? 0;
        const callsToday = callLeadsTodayMap.get(agent.id) ?? 0;
        const callBookings = callBookingsAllMap.get(agent.id) ?? 0;
        const callRevenue = callRevenueAllMap.get(agent.id) ?? 0;
        const callConversionRate = totalCalls > 0 ? Math.round((callBookings / totalCalls) * 100) : 0;
        return { id: agent.id, name: agent.name, email: agent.email, totalCalls, callsToday, callBookings, callRevenue, callConversionRate };
      });
    }),
    /**
     * agents.leaderboard — admin-only ranked leaderboard for all active agents..
     * Accepts optional dateFrom / dateTo (ISO date strings) for filtering.
     * Returns per-agent: leadsAssigned, bookedCount, bookedRevenue, conversionRate
     * sorted by bookedRevenue descending.
     */
    leaderboard: adminAgentProcedure
      .input(z.object({
        dateFrom: z.string().optional(),
        dateTo: z.string().optional(),
      }).optional())
      .query(async ({ input }) => {
        const db = await getDb();
        if (!db) return [];
        const { agents: agentsTable } = await import("../drizzle/schema");
        const allAgents = await db
          .select({ id: agentsTable.id, name: agentsTable.name, email: agentsTable.email })
          .from(agentsTable)
          .where(eq(agentsTable.isActive, 1));
        const conditions = buildDateConditions(input?.dateFrom, input?.dateTo);
        // Assigned leads per agent in date range
        const assignedRows = await db
          .select({ agentId: conversationSessions.assignedAgentId, count: sql<number>`count(*)`.as("count") })
          .from(conversationSessions)
          .where(and(sql`${conversationSessions.assignedAgentId} IS NOT NULL`, conditions ?? sql`1=1`))
          .groupBy(conversationSessions.assignedAgentId);
        // Booked rows per agent in date range (for revenue + count)
        const bookedRows = await db
          .select({
            agentId: conversationSessions.bookedByAgentId,
            bookedAmount: conversationSessions.bookedAmount,
            quotedPrice: conversationSessions.quotedPrice,
            extras: conversationSessions.extras,
            reactivationLastPrice: conversationSessions.reactivationLastPrice,
            reactivationDiscountPct: conversationSessions.reactivationDiscountPct,
          })
          .from(conversationSessions)
          .where(and(eq(conversationSessions.isBooked, 1), conditions ?? sql`1=1`));
        const assignedMap = new Map(assignedRows.map(r => [r.agentId, Number(r.count)]));
        // Group booked rows by agent
        const bookedByAgent = new Map<number, typeof bookedRows>();
        for (const row of bookedRows) {
          if (row.agentId === null || row.agentId === undefined) continue;
          if (!bookedByAgent.has(row.agentId)) bookedByAgent.set(row.agentId, []);
          bookedByAgent.get(row.agentId)!.push(row);
        }
        const result = allAgents.map(agent => {
          const leadsAssigned = assignedMap.get(agent.id) ?? 0;
          const agentBookedRows = bookedByAgent.get(agent.id) ?? [];
          const bookedCount = agentBookedRows.length;
          const bookedRevenue = agentBookedRows.reduce((sum, row) => sum + calcBookedRevenue(row), 0);
          const conversionRate = leadsAssigned > 0 ? Math.round((bookedCount / leadsAssigned) * 100) : 0;
          return { id: agent.id, name: agent.name, email: agent.email, leadsAssigned, bookedCount, bookedRevenue, conversionRate };
        });
        // Sort by bookedRevenue descending, then bookedCount
        result.sort((a, b) => b.bookedRevenue - a.bookedRevenue || b.bookedCount - a.bookedCount);
        return result;
      }),
    /**
     * agents.getNotifications — returns recent activity events relevant to the calling agent.
     * Shows: new leads assigned to them, replies from their leads, bookings they closed.
     * Accessible by any logged-in agent (not admin-only).
     */
    getNotifications: publicProcedure
      .input(z.object({ limit: z.number().int().min(1).max(100).default(30) }).optional())
      .query(async ({ ctx, input }) => {
        const agentSession = await getAgentSessionFromCtx(ctx);
        const db = await getDb();
        if (!db) return { notifications: [], unreadCount: 0 };
        const limit = input?.limit ?? 30;
        // Get sessions assigned to this agent
        const mySessionIds = await db
          .select({ id: conversationSessions.id })
          .from(conversationSessions)
          .where(eq(conversationSessions.assignedAgentId, agentSession.agentId))
          .limit(200);
        const sessionIdList = mySessionIds.map(s => s.id);
        // Build notifications from recent activity on their leads + their bookings
        const notifications: Array<{
          id: string;
          type: string;
          title: string;
          body: string;
          createdAt: Date;
          sessionId: number | null;
          leadName: string | null;
        }> = [];
        // Recent leads assigned to this agent
        const recentAssigned = await db
          .select({
            id: conversationSessions.id,
            leadName: conversationSessions.leadName,
            leadPhone: conversationSessions.leadPhone,
            serviceType: conversationSessions.serviceType,
            createdAt: conversationSessions.createdAt,
            stage: conversationSessions.stage,
            isBooked: conversationSessions.isBooked,
            bookedAt: conversationSessions.bookedAt,
            updatedAt: conversationSessions.updatedAt,
          })
          .from(conversationSessions)
          .where(eq(conversationSessions.assignedAgentId, agentSession.agentId))
          .orderBy(desc(conversationSessions.updatedAt))
          .limit(limit);
        for (const s of recentAssigned) {
          if (s.isBooked && s.bookedAt) {
            notifications.push({
              id: `booking-${s.id}`,
              type: 'booking',
              title: '🎉 Booking Confirmed',
              body: `${s.leadName ?? 'Lead'} booked${s.serviceType ? ` — ${s.serviceType}` : ''}`,
              createdAt: s.bookedAt instanceof Date ? s.bookedAt : new Date(s.bookedAt),
              sessionId: s.id,
              leadName: s.leadName,
            });
          } else {
            notifications.push({
              id: `assigned-${s.id}`,
              type: 'new_lead',
              title: '📋 Lead Assigned',
              body: `${s.leadName ?? s.leadPhone}${s.serviceType ? ` — ${s.serviceType}` : ''}`,
              createdAt: s.createdAt instanceof Date ? s.createdAt : new Date(s.createdAt),
              sessionId: s.id,
              leadName: s.leadName,
            });
          }
        }
        // Sort by date descending and limit
        notifications.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        const trimmed = notifications.slice(0, limit);
        // Unread = notifications in the last 24 hours
        const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
        const unreadCount = trimmed.filter(n => n.createdAt > oneDayAgo).length;
        return { notifications: trimmed, unreadCount };
      }),

    /**
     * agents.setAwayStatus — set or clear the current agent's away status.
     * Pass null to mark as available (I'm Back).
     * Valid values: "priority" | "new" | "active" | "resolved" | "teams" | null
     */
    setAwayStatus: publicProcedure
      .input(z.object({ status: z.enum(["away_sec", "lunch", "back15", "eod"]).nullable() }))
      .mutation(async ({ ctx, input }) => {
        const agentSession = await getAgentSessionFromCtx(ctx);
        const db = await getDb();
        if (!db) throw new Error("Database unavailable");
        await db
          .update(agents)
          .set({
            awayStatus: input.status,
            // Record when the status was set (null when clearing)
            awaySetAt: input.status ? new Date() : null,
          })
          .where(eq(agents.id, agentSession.agentId));
        return { ok: true };
      }),

    /**
     * agents.getStatuses — return id + name + awayStatus + profilePhotoUrl for all active agents.
     * Used by OpsChat sidebar to render coloured status dots.
     */
    getStatuses: publicProcedure.query(async () => {
      const db = await getDb();
      if (!db) return [];
      const rows = await db
        .select({
          id: agents.id,
          name: agents.name,
          awayStatus: agents.awayStatus,
          awaySetAt: agents.awaySetAt,
          profilePhotoUrl: agents.profilePhotoUrl,
        })
        .from(agents)
        .where(eq(agents.isActive, 1))
        .orderBy(agents.name);
      return rows;
    }),
    /**
     * agents.getPhotoMap — name→photoUrl map covering all known name variants.
     * Mirrors opsChat.getAllAgentPhotoMap: emits both the short agent name AND any
     * full-name aliases from the users table so lookups work regardless of how
     * assignedAgentName was stored (e.g. "Diane" vs "Diane Ruiz", "Rohan G" vs "Rohan Gupta").
     */
    getPhotoMap: adminAgentProcedure.query(async () => {
      const db = await getDb();
      if (!db) return { photos: {} as Record<string, string | null> };
      const { users } = await import("../drizzle/schema");
      const agentRows = await db
        .select({ id: agents.id, name: agents.name, profilePhotoUrl: agents.profilePhotoUrl })
        .from(agents);
      const photos: Record<string, string | null> = {};
      for (const row of agentRows) {
        photos[row.name] = row.profilePhotoUrl ?? null;
      }
      const userRows = await db
        .select({ name: users.name, profilePhotoUrl: users.profilePhotoUrl })
        .from(users);
      for (const userRow of userRows) {
        if (!userRow.name) continue;
        const firstName = userRow.name.split(/\s+/)[0].toLowerCase();
        const matchingAgent = agentRows.find(
          r => r.name.toLowerCase().startsWith(firstName) || firstName.startsWith(r.name.toLowerCase())
        );
        if (matchingAgent) {
          const photo = matchingAgent.profilePhotoUrl ?? userRow.profilePhotoUrl ?? null;
          photos[matchingAgent.name] = photo;
          photos[userRow.name] = photo;
        }
      }
      return { photos };
    }),
  }),

  /**
   * quotes.submit — public procedure
   *
   * Returns IMMEDIATELY to the user with a success response.
   * All AI generation, SMS sending, and DB writes happen in the background
   * via a fire-and-forget async task so the form never hangs.
   */
  quotes: router({
    submit: publicProcedure
      .input(quoteFormSchema)
      .mutation(async ({ input }) => {
        // ── 1. Calculate price synchronously (instant, no network call) ────────
        const price = estimatePrice({
          bedrooms: input.bedrooms,
          bathrooms: input.bathrooms,
          serviceType: input.serviceType,
        });

        // ── 2. Fire-and-forget: AI generation + SMS + DB in background ─────────
        // We do NOT await this — the form gets an instant response
        processQuoteInBackground(input, price).catch(err => {
          console.error("[submitQuote] Background processing error:", err);
        });

        // ── 3. Return immediately ──────────────────────────────────────────────
        return {
          success: true,
          smsSent: true, // optimistic — background will handle actual sending
          message: "Quote sent! Check your phone for your personalized quote.",
        };
      }),

    /**
     * quotes.submitWidgetLead — called by the floating chat widget on maidsinblack.com.
     * Accepts only name + phone (no service/room info yet).
     * Sends a sizing question SMS and creates a WIDGET_SIZING session so the
     * conversation engine can extract room counts on the next reply and send a quote.
     */
    submitWidgetLead: publicProcedure
      .input(
        z.object({
          name: z.string().min(1).max(100),
          phone: z.string().min(10).max(20),
          utmSource: z.string().max(100).optional(),
          utmMedium: z.string().max(100).optional(),
          utmCampaign: z.string().max(255).optional(),
          utmContent: z.string().max(255).optional(),
          gclid: z.string().max(255).optional(),
        })
      )
      .mutation(async ({ input }) => {
        // Server-side US phone validation — rejects international numbers
        if (!isValidUSPhone(input.phone)) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Please enter a valid US phone number (10 digits, US area code).",
          });
        }
        processWidgetLeadInBackground(input).catch(err => {
          console.error("[submitWidgetLead] Background processing error:", err);
        });
        return { success: true };
      }),
  }),

  /**
   * simulator.chat — live SMS simulator for admin/agent testing
   * Calls the real AI engine with configurable lead context.
   * No SMS is sent; responses come back immediately over tRPC.
   */
  campaigns: campaignRouter,
  completedJobs: reviewRouter,
  messageTemplates: messageTemplateRouter,
  launch27: launch27Router,
  alwaysOn: alwaysOnRouter,
  syncHealth: syncHealthRouter,
  campaignApproval: campaignApprovalRouter,
  activity: activityRouter,
  voice: voiceRouter,
  quality: qualityRouter,
  cleaner: cleanerRouter,
  tracker: trackerRouter,
  settings: settingsRouter,
  commandCenter: commandCenterRouter,
  metrics: metricsRouter,
  fieldMgmt: fieldMgmtRouter,
  opsChat: opsChatRouter,
  followUps: followUpsRouter,
  teamPay: teamPayRouter,

  tools: router({
    generateFirstMessage: agentProcedure
      .input(
        z.object({
          bookingDetails: z.string().min(1).max(4000),
        })
      )
      .mutation(async ({ input }) => {
        const template = `Hi [Name]! 👋 This is [Your Name] from [Business]. I just saw your request and wanted to reach out right away — I know finding a reliable cleaner can be stressful.

A little about us: we're fully insured, background-checked, and we've served [X] homes right here in [City]. Every clean comes with a satisfaction guarantee — if anything's off, we come back at no charge.

For your [home size / job type], I'm estimating [X]–[X]. That includes [list 2-3 specific things they'll get].

I have availability as soon as [specific day, e.g., 'this Thursday or Saturday morning']. Want me to lock in a time for you?

Either way, feel free to ask me anything — happy to help! 😊`;

        const llmResult = await invokeLLM({
          messages: [
            {
              role: "system",
              content: `You are a professional cleaning business representative for Maid in Black, a premium home cleaning service in the Washington DC metro area (DC/MD/VA). You write warm, confident, and concise first outreach messages to new leads.

Your job: fill in the following message template using the booking details provided. Rules:
- Replace [Name] with the lead's first name only
- Replace [Your Name] with "Madison"
- Replace [Business] with "Maid in Black"
- Replace [X] homes with a realistic number like "hundreds of"
- Replace [City] with the city from the booking details
- Replace [home size / job type] with a natural description based on the details (e.g., "3-bedroom home", "carpet cleaning", etc.)
- Replace the price estimate with a realistic range based on the job type and size. For house cleaning: standard 3BR is $180–$220, deep clean adds 30–40%. For carpet cleaning, specialty jobs: use a reasonable range.
- Replace the 2-3 specific things with relevant items for the job type (e.g., for house cleaning: "all rooms, kitchen deep clean, and bathroom sanitization"; for carpet cleaning: "all carpeted rooms, stairs, and spot treatment")
- Replace the availability with "this week" or "early next week" unless specific dates are mentioned in the details
- Keep the tone warm, human, and professional — not salesy
- Output ONLY the message text, no preamble, no quotes around it`,
            },
            {
              role: "user",
              content: `Template:\n${template}\n\nBooking details:\n${input.bookingDetails}`,
            },
          ],
        });

        const raw = llmResult?.choices?.[0]?.message?.content;
        const message = typeof raw === "string" ? raw : "";
        if (!message) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "AI did not return a message" });
        return { message: message.trim() };
      }),
  }),

  push: router({
    /** Return the VAPID public key so the client can subscribe */
    getVapidPublicKey: agentProcedure.query(() => {
      return { publicKey: process.env.VAPID_PUBLIC_KEY ?? "" };
    }),

    /** Register or update a push subscription for the current agent */
    subscribe: agentProcedure
      .input(z.object({
        agentKey: z.string().min(1).max(128),
        endpoint: z.string().url(),
        p256dh: z.string(),
        auth: z.string(),
      }))
      .mutation(async ({ input }) => {
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
        // Upsert: if endpoint already exists, update keys; otherwise insert
        const existing = await db.select({ id: pushSubscriptions.id })
          .from(pushSubscriptions)
          .where(eq(pushSubscriptions.endpoint, input.endpoint))
          .limit(1);
        if (existing.length > 0) {
          await db.update(pushSubscriptions)
            .set({ agentKey: input.agentKey, keys: JSON.stringify({ p256dh: input.p256dh, auth: input.auth }), lastUsedAt: new Date() })
            .where(eq(pushSubscriptions.endpoint, input.endpoint));
        } else {
          await db.insert(pushSubscriptions).values({
            agentKey: input.agentKey,
            endpoint: input.endpoint,
            keys: JSON.stringify({ p256dh: input.p256dh, auth: input.auth }),
          });
        }
        return { ok: true };
      }),

    /** Remove a push subscription (called when agent logs out or revokes permission) */
    unsubscribe: agentProcedure
      .input(z.object({ endpoint: z.string().url() }))
      .mutation(async ({ input }) => {
        const db = await getDb();
        if (!db) return { ok: true };
        await db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, input.endpoint));
        return { ok: true };
      }),
  }),

  simulator: router({
    chat: publicProcedure
      .input(
        z.object({
          message: z.string().min(1).max(500),
          history: z.array(
            z.object({
              role: z.enum(["assistant", "user"]),
              content: z.string(),
            })
          ).max(20).default([]),
          // Lead context
          leadName: z.string().default("Test Lead"),
          serviceType: z.string().default("Standard Cleaning"),
          quotedPrice: z.string().default("209"),
          bedrooms: z.string().default("2"),
          bathrooms: z.string().default("1"),
          extras: z.array(z.string()).default([]),
          stage: z.enum(["WIDGET_SIZING", "QUOTE_SENT", "AVAILABILITY", "SLOT_CHOICE", "CONFIRMATION", "ADDRESS", "DONE", "CALL_SCHEDULED"]).default("AVAILABILITY"),
          selectedSlot: z.string().nullable().default(null),
        })
      )
      .mutation(async ({ input }) => {
        const { message, history, leadName, serviceType, quotedPrice, extras, stage, selectedSlot } = input;
        const extrasContext = extras.length > 0 ? extras.join(", ") : null;

        let reply: string;

        if (stage === "DONE" || stage === "CALL_SCHEDULED") {
          reply = await handlePostBookingReply({
            stage,
            leadName,
            quotedPrice,
            serviceType,
            selectedSlot,
            address: null,
            messageHistory: history,
            leadReply: message,
            extrasContext,
          });
        } else {
          const result = await handleOffScriptReply({
            stage,
            leadName,
            quotedPrice,
            serviceType,
            selectedSlot,
            messageHistory: history,
            leadReply: message,
            extrasContext,
          });
          reply = result.reply;
        }

        return { reply, stage };
      }),
  }),

  // ── Hiring Pipeline ──────────────────────────────────────────────────────────
  hiring: hiringRouter,

  // ── Performance Analytics ────────────────────────────────────────────────────
  performance: router({
    /** Per-source aggregated stats. days=0 = all-time. */
    stats: adminAgentProcedure
      .input(z.object({ days: z.number().int().min(0).max(365).default(30) }))
      .query(async ({ input }) => {
        const db = await getDb();
        if (!db) return [] as { source: string; leads: number; bookings: number; bookedRevenue: number; totalQuoted: number }[];
        const cutoff = input.days === 0
          ? null
          : new Date(Date.now() - input.days * 24 * 60 * 60 * 1000);

        const rows = await db
          .select({
            leadSource: conversationSessions.leadSource,
            totalLeads: sql<number>`COUNT(*)`,
            bookings: sql<number>`SUM(CASE WHEN ${conversationSessions.bookedAt} IS NOT NULL THEN 1 ELSE 0 END)`,
            bookedRevenue: sql<number>`SUM(CASE WHEN ${conversationSessions.bookedAt} IS NOT NULL THEN COALESCE(${conversationSessions.bookedAmount}, 0) ELSE 0 END)`,
            totalQuoted: sql<number>`SUM(COALESCE(${conversationSessions.bookedAmount}, 0))`,
          })
          .from(conversationSessions)
          .where(
            and(
              isNotNull(conversationSessions.leadSource),
              sql`${conversationSessions.leadSource} != ''`,
              notInArray(conversationSessions.leadSource, ['cs_initiated', 'cs-inbound', 'cs-inbound-cleaner', 'hiring_interview', 'hiring', 'review_rebooking', 'review']),
              cutoff ? gte(conversationSessions.createdAt, cutoff) : undefined,
            )
          )
          .groupBy(conversationSessions.leadSource)
          .orderBy(sql`COUNT(*) DESC`);

        // Normalize: merge thumbtack-sms into thumbtack
        const normalized = new Map<string, { source: string; leads: number; bookings: number; bookedRevenue: number; totalQuoted: number }>();
        for (const r of rows) {
          const src = (r.leadSource === 'thumbtack-sms' ? 'thumbtack' : r.leadSource) ?? 'other';
          const existing = normalized.get(src);
          if (existing) {
            existing.leads += Number(r.totalLeads);
            existing.bookings += Number(r.bookings);
            existing.bookedRevenue += Number(r.bookedRevenue);
            existing.totalQuoted += Number(r.totalQuoted);
          } else {
            normalized.set(src, { source: src, leads: Number(r.totalLeads), bookings: Number(r.bookings), bookedRevenue: Number(r.bookedRevenue), totalQuoted: Number(r.totalQuoted) });
          }
        }
        return Array.from(normalized.values());
      }),

    /** Individual lead rows for the lead log view. days=0 = all-time. */
    leads: adminAgentProcedure
      .input(z.object({
        days: z.number().int().min(0).max(365).default(30),
        source: z.string().optional(),
      }))
      .query(async ({ input }) => {
        const db = await getDb();
        if (!db) return [] as { id: number; source: string; lead: string; date: string; amount: number; status: string; booking: boolean }[];
        const cutoff = input.days === 0
          ? null
          : new Date(Date.now() - input.days * 24 * 60 * 60 * 1000);

        const rows = await db
          .select({
            id: conversationSessions.id,
            leadSource: conversationSessions.leadSource,
            leadName: conversationSessions.leadName,
            createdAt: conversationSessions.createdAt,
            bookedAmount: conversationSessions.bookedAmount,
            bookedAt: conversationSessions.bookedAt,
            stage: conversationSessions.stage,
          })
          .from(conversationSessions)
          .where(
            and(
              isNotNull(conversationSessions.leadSource),
              sql`${conversationSessions.leadSource} != ''`,
              notInArray(conversationSessions.leadSource, ['cs_initiated', 'cs-inbound', 'cs-inbound-cleaner', 'hiring_interview', 'hiring', 'review_rebooking', 'review']),
              cutoff ? gte(conversationSessions.createdAt, cutoff) : undefined,
              input.source ? eq(conversationSessions.leadSource, input.source) : undefined,
            )
          )
          .orderBy(desc(conversationSessions.createdAt))
          .limit(200);

        return rows.map((r: { id: number; leadSource: string | null; leadName: string | null; createdAt: Date | null; bookedAmount: number | null; bookedAt: Date | null; stage: string }) => ({
          id: r.id,
          source: (r.leadSource === 'thumbtack-sms' ? 'thumbtack' : r.leadSource) ?? 'other',
          lead: r.leadName ?? 'Unknown',
          date: r.createdAt ? r.createdAt.toISOString().split('T')[0] : '',
          amount: r.bookedAmount ?? 0,
          status: r.bookedAt ? 'Booked' : r.stage === 'LOST' ? 'Lost' : 'Open',
          booking: r.bookedAt !== null,
        }));
      }),
  }),
});
export type AppRouter = typeof appRouter;
// ─── Background processor ──────────────────────────────────────────────────────

/**
 * Handles the widget lead submission (name + phone only).
 * Reads the widgetSmsFlow setting to determine which persona (Madison or Jade) to use.
 * Sends a persona-specific sizing question SMS and creates a WIDGET_SIZING session
 * with the correct smsFlow assigned so the V2 engine routes correctly on reply.
 */
async function processWidgetLeadInBackground(input: {
  name: string;
  phone: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmContent?: string;
  gclid?: string;
}): Promise<void> {
  const normalizedPhone = normalizePhone(input.phone);
  const firstName = toTitleCase(input.name).split(" ")[0] ?? toTitleCase(input.name);

  // ── Step 1: Send admin alert ──────────────────────────────────────────
  const alertMsg = `New Widget Lead - Maids in Black\n\nName: ${input.name}\nPhone: ${normalizedPhone}\nSource: ${input.utmSource ?? "direct"}`;
  sendSms({ to: CS_SUPPORT_NUMBER, content: alertMsg }).catch(err =>
    console.error("[submitWidgetLead] CS alert SMS failed:", err)
  );
  sendSms({ to: SECONDARY_ALERT_NUMBER, content: alertMsg }).catch(err =>
    console.error("[submitWidgetLead] Secondary alert SMS failed:", err)
  );

  // ── Step 1b: VAPI call notification to CS team (fire-and-forget) ─────────
  notifyNewLeadViaCall({ name: firstName })
    .catch(err => console.error("[submitWidgetLead] VAPI call notification failed:", err));

  // ── Step 2: Read widgetSmsFlow setting to determine persona ───────────────────
  const db = await getDb();
  if (!db) {
    console.warn("[submitWidgetLead] No DB — skipping session save");
    return;
  }

  let flowVariant = "B"; // Default to Jade
  try {
    const { appSettings } = await import("../drizzle/schema");
    const settingRows = await db
      .select({ value: appSettings.value })
      .from(appSettings)
      .where(eq(appSettings.key, "widgetSmsFlow"))
      .limit(1);
    const rawFlow = settingRows[0]?.value ?? "B";
    if (rawFlow === "split") {
      flowVariant = Math.random() < 0.5 ? "A" : "B";
    } else if (["A", "B", "C"].includes(rawFlow.toUpperCase())) {
      flowVariant = rawFlow.toUpperCase();
    } else {
      flowVariant = "B";
    }
  } catch (err) {
    console.warn("[submitWidgetLead] Could not read widgetSmsFlow setting, defaulting to B:", err);
  }

  // ── Step 3: Build persona-specific sizing SMS ──────────────────────────────
  // Read from DB template so Settings edits are respected
  const { getFlowTemplate } = await import("./settingsRouter");
  let sizingMsg: string;
  if (flowVariant === "A") {
    sizingMsg = await getFlowTemplate(
      "widgetFlowA_sms1",
      `Hi ${firstName}! \uD83D\uDC4B Madison here from Maids in Black. To get you an instant price, how many bedrooms and bathrooms does your home have? (e.g. 3 bed / 2 bath)`,
      { "{firstName}": firstName }
    );
  } else if (flowVariant === "C") {
    // Widget Flow C: starts with sizing question (no bedrooms/bathrooms yet from widget)
    sizingMsg = await getFlowTemplate(
      "widgetFlowC_sms1",
      `Hey ${firstName}! Jade here from Maids in Black \uD83D\uDE0A To get you an instant price, how many bedrooms and bathrooms does your home have? (e.g. 3 bed / 2 bath)`,
      { "{firstName}": firstName }
    );
  } else {
    sizingMsg = await getFlowTemplate(
      "widgetFlowB_sms1",
      `Hey ${firstName}! Jade here from Maids in Black \uD83D\uDE0A To get you an instant price, how many bedrooms and bathrooms does your home have? (e.g. 3 bed / 2 bath)`,
      { "{firstName}": firstName }
    );
  }

  // ── Step 4: Send sizing question SMS ─────────────────────────────────────
  const smsResult = await sendSms({ to: normalizedPhone, content: sizingMsg });
  console.log(`[submitWidgetLead] Sizing SMS (Flow ${flowVariant}) sent: ${smsResult.success}`);

  // ── Step 4b: Supersede any existing active sessions for this phone ───────────
  // Prevents duplicate AI responses when the same lead has multiple active sessions.
  const WIDGET_ACTIVE_STAGES = [
    "QUOTE_SENT", "AVAILABILITY", "SLOT_CHOICE", "TIME_PREF",
    "ADDRESS", "CONFIRMATION", "WIDGET_SIZING",
    "FLOWC_ADDON", "FLOWC_DATE", "FLOWC_QUOTE_SENT",
  ];
  try {
    const supersededCount = await db
      .update(conversationSessions)
      .set({ stage: "DONE" as any, autoFollowUpSent: 1 })
      .where(
        and(
          eq(conversationSessions.leadPhone, normalizedPhone),
          or(...WIDGET_ACTIVE_STAGES.map(s => eq(conversationSessions.stage, s as any)))
        )
      );
    const affected = (supersededCount as any)?.rowsAffected ?? (supersededCount as any)?.[0]?.affectedRows ?? 0;
    if (affected > 0) {
      console.log(`[submitWidgetLead] Superseded ${affected} old active session(s) for ${normalizedPhone} before creating new one.`);
    }
  } catch (supersedErr) {
    console.error("[submitWidgetLead] Failed to supersede old sessions (non-fatal):", supersedErr);
  }

  // ── Step 5: Create conversation session with correct smsFlow ──────────────
  const now = Date.now();
  const initialHistory = JSON.stringify([
    { role: "assistant", content: sizingMsg, ts: now },
  ]);
  try {
    await db.insert(conversationSessions).values({
      leadPhone: normalizedPhone,
      leadName: toTitleCase(input.name),
      stage: "WIDGET_SIZING",
      quotedPrice: null,
      serviceType: null,
      bedrooms: null,
      bathrooms: null,
      extras: null,
      messageHistory: initialHistory,
      utmSource: input.utmSource ?? null,
      utmMedium: input.utmMedium ?? null,
      utmCampaign: input.utmCampaign ?? null,
      utmContent: input.utmContent ?? null,
      gclid: input.gclid ?? null,
      leadSource: "widget",
      smsFlow: flowVariant,
    });
    console.log(`[submitWidgetLead] Session created: WIDGET_SIZING, Flow ${flowVariant}`);
  } catch (dbErr) {
    console.error("[submitWidgetLead] Failed to create conversation session:", dbErr);
  }
  // ── Step 5b: Log new_lead activity event ─────────────────────────────────────
  // Widget leads log here with name/phone only — size/price are collected during the SMS flow.
  logActivity({
    eventType: "new_lead",
    title: `New widget lead: ${toTitleCase(input.name)}`,
    body: `Phone: ${normalizedPhone}${input.utmSource ? ` · Source: ${input.utmSource}` : ""}`,
    meta: { leadPhone: normalizedPhone, leadName: toTitleCase(input.name), leadSource: "widget", smsFlow: flowVariant },
  }).catch(() => {});

  // ── Step 6: Post new widget lead card to MIB Command Chat ─────────────────
  try {
    const { opsChatMessages } = await import("../drizzle/schema");
    // Look up the session we just created to get its ID
    const [newSession] = await db
      .select({ id: conversationSessions.id })
      .from(conversationSessions)
      .where(eq(conversationSessions.leadPhone, normalizedPhone))
      .orderBy(desc(conversationSessions.id))
      .limit(1);
    const widgetSessionId = newSession?.id ?? null;
    const sourceDisplay = input.utmSource ? `\n📍 Source: ${input.utmSource}` : "";
    const leadBody = `📱 **Widget Lead** · ${toTitleCase(input.name)}${sourceDisplay}`;
    const metadata = JSON.stringify({
      leadName: toTitleCase(input.name),
      leadPhone: normalizedPhone,
      serviceType: "Widget",
      utmSource: input.utmSource ?? null,
      sessionId: widgetSessionId,
      arrivedAt: Date.now(),
    });
    await db.insert(opsChatMessages).values({
      cleanerJobId: null,
      channel: "command",
      authorName: "🎯 New Lead",
      authorRole: "system",
      body: leadBody,
      mediaUrl: null,
      quickAction: "new_lead",
      metadata,
    });
    console.log(`[submitWidgetLead] Posted new_lead card with sessionId=${widgetSessionId}`);
  } catch (err) {
    console.error("[submitWidgetLead] Failed to post lead card to command channel:", err);
  }
}

/**
 * Runs all the slow work (AI calls, SMS, DB writes) after the form has
 * already returned a success response to the user.
 */
async function processQuoteInBackground(
  input: {
    name: string;
    email: string;
    phone: string;
    serviceType: string;
    bedrooms: string;
    bathrooms: string;
    extras?: string[];
    utmSource?: string;
    utmMedium?: string;
    utmCampaign?: string;
    utmContent?: string;
    gclid?: string;
  },
  price: string
): Promise<void> {
  const normalizedPhone = normalizePhone(input.phone);

  // ── Step 1: Alert support team immediately (simple direct SMS) ───────────
  const isOffice = input.serviceType === "Office Cleaning";
  const sizeInfo = isOffice ? input.bedrooms : `${input.bedrooms} / ${input.bathrooms}`;
  const extrasLine = input.extras && input.extras.length > 0
    ? `\nExtras: ${input.extras.join(", ")}`
    : "";
  const alertMsg = `New Quote Request - Maids in Black\n\nName: ${input.name}\nPhone: ${normalizedPhone}\nService: ${input.serviceType}\nSize: ${sizeInfo}\nQuote: $${price}${extrasLine}`;

  sendSms({ to: CS_SUPPORT_NUMBER, content: alertMsg }).catch(err =>
    console.error("[submitQuote] CS alert SMS failed:", err)
  );
  sendSms({ to: SECONDARY_ALERT_NUMBER, content: alertMsg }).catch(err =>
    console.error("[submitQuote] Secondary alert SMS failed:", err)
  );

  // ── Step 1b: VAPI call notification to CS team (fire-and-forget) ─────────
  notifyNewLeadViaCall({ name: toTitleCase(input.name) })
    .catch(err => console.error("[submitQuote] VAPI call notification failed:", err));

  // ── Step 2: Read smsFlow setting to determine which flow to use ────────────
  const db = await getDb();
  if (!db) {
    console.warn("[submitQuote] No DB — skipping session and lead save");
    return;
  }

  // Read the formSmsFlow setting (falls back to smsFlow for backwards compat, default to "B")
  let flowVariant = "B";
  try {
    const { appSettings } = await import("../drizzle/schema");
    // Try formSmsFlow first, fall back to smsFlow
    const settingRows = await db
      .select({ key: appSettings.key, value: appSettings.value })
      .from(appSettings)
      .where(or(eq(appSettings.key, "formSmsFlow"), eq(appSettings.key, "smsFlow")))
      .limit(2);
    const formFlowRow = settingRows.find(r => r.key === "formSmsFlow");
    const fallbackRow = settingRows.find(r => r.key === "smsFlow");
    const rawFlow = formFlowRow?.value ?? fallbackRow?.value ?? "B";
    if (rawFlow === "split") {
      // 50-50 random assignment between A and B
      flowVariant = Math.random() < 0.5 ? "A" : "B";
    } else if (rawFlow.toUpperCase() === "C") {
      flowVariant = "C";
    } else {
      flowVariant = rawFlow.toUpperCase() === "A" ? "A" : "B";
    }
  } catch (err) {
    console.warn("[submitQuote] Could not read smsFlow setting, defaulting to B:", err);
  }

  const MADISON_PHOTO_URL = "https://d2xsxph8kpxj0f.cloudfront.net/310519663254023424/CAeRhAUjAZoEuxNGm5QbPr/madison-headshot-SPXr6KHGViveW2LxjwfyqN.png";

  let msg1: string;
  let msg2: string | null = null;
  let initialStage: string;

  if (flowVariant === "A") {
    // ── Flow A (Madison): SMS 1 = price upfront + value note (with photo), SMS 2 = availability question ──
    msg1 = await buildMadisonQuoteMessage({
      leadName: input.name,
      bedrooms: input.bedrooms,
      bathrooms: input.bathrooms,
      serviceType: input.serviceType,
      price,
      extras: input.extras,
    });
    msg2 = await generatePricingFollowUp({
      leadName: input.name,
      bedrooms: input.bedrooms,
      bathrooms: input.bathrooms,
      serviceType: input.serviceType,
      price,
    });
    initialStage = "AVAILABILITY";
  } else if (flowVariant === "C") {
    // ── Flow C (Jade Enriched): SMS 1 = confirm sizing, then collect add-ons → date → notes → quote link ──
    const firstName = toTitleCase(input.name).split(" ")[0] ?? toTitleCase(input.name);
    const { appSettings: appSettingsSchema } = await import("../drizzle/schema");
    const flowCRows = await db
      .select({ value: appSettingsSchema.value })
      .from(appSettingsSchema)
      .where(eq(appSettingsSchema.key, "flowC_sms1"))
      .limit(1);
    const flowCTemplate = flowCRows[0]?.value ??
      `Hey {firstName}! 👋 This is Jade from Maids in Black — you just reached out on our site and I wanted to personally follow up! 😊\n\nWe'd love to get your home sparkling clean. Quick question to get you the right quote — just to confirm you have a {bedrooms} / {bathrooms} home 🏠 correct?`;
    msg1 = flowCTemplate
      .replace(/\{firstName\}/g, firstName)
      .replace(/\{bedrooms\}/g, input.bedrooms)
      .replace(/\{bathrooms\}/g, input.bathrooms);
    initialStage = "WIDGET_SIZING";
  } else {
    // ── Flow B (Jade): SMS 1 = greeting + day ask (no price yet) ──
    msg1 = await generateQuoteMessage({
      leadName: input.name,
      bedrooms: input.bedrooms,
      bathrooms: input.bathrooms,
      serviceType: input.serviceType,
      price,
      extras: input.extras,
    });
    initialStage = "AVAILABILITY";
  }

  // ── Step 3: Send SMS #1 to lead ───────────────────────────────────────────
  const sms1SendOpts = flowVariant === "A"
    ? { to: input.phone, content: msg1, mediaUrl: MADISON_PHOTO_URL }
    : { to: input.phone, content: msg1 };
  const sms1 = await sendSms(sms1SendOpts);
  console.log(`[submitQuote] SMS1 (Flow ${flowVariant}) sent: ${sms1.success}`);

  // ── Step 3b: Flow A only — send SMS #2 (availability question) after a short delay ──
  if (flowVariant === "A" && msg2) {
    await delay(2000);
    const sms2 = await sendSms({ to: input.phone, content: msg2 });
    console.log(`[submitQuote] SMS2 (Flow A availability) sent: ${sms2.success}`);
  }
  // Flow B: SMS 2 (price reveal + 9am/1pm offer) is sent in the AVAILABILITY stage handler
  // when the lead replies with a specific day — NOT immediately after SMS 1.

  // ── Step 4: Create conversation session ──────────────────────────────────
  const now = Date.now();
  const historyEntries = flowVariant === "A" && msg2
    ? [
        { role: "assistant", content: msg1, ts: now },
        { role: "assistant", content: msg2, ts: now + 1 },
      ]
    : [
        { role: "assistant", content: msg1, ts: now },
      ];
  const initialHistory = JSON.stringify(historyEntries);

  // ── Step 4a: Supersede any existing active sessions for this phone ──────────
  // If the lead re-submits the form, close their old sessions so the cron
  // doesn't nudge them twice (once per old session + once for the new one).
  const ACTIVE_LEAD_STAGES = [
    "QUOTE_SENT", "AVAILABILITY", "SLOT_CHOICE", "TIME_PREF",
    "ADDRESS", "CONFIRMATION", "WIDGET_SIZING",
    "FLOWC_ADDON", "FLOWC_DATE", "FLOWC_QUOTE_SENT",
  ];
  try {
    const supersededCount = await db
      .update(conversationSessions)
      .set({ stage: "DONE" as any, autoFollowUpSent: 1 })
      .where(
        and(
          eq(conversationSessions.leadPhone, normalizedPhone),
          or(...ACTIVE_LEAD_STAGES.map(s => eq(conversationSessions.stage, s as any)))
        )
      );
    const affected = (supersededCount as any)?.rowsAffected ?? (supersededCount as any)?.[0]?.affectedRows ?? 0;
    if (affected > 0) {
      console.log(`[submitQuote] Superseded ${affected} old active session(s) for ${normalizedPhone} before creating new one.`);
    }
  } catch (supersedErr) {
    console.error("[submitQuote] Failed to supersede old sessions (non-fatal):", supersedErr);
  }

  // Always create a new session row — same phone can submit again months later
  try {
    await db.insert(conversationSessions).values({
      leadPhone: normalizedPhone,
      leadName: toTitleCase(input.name),
      stage: initialStage as any,
      quotedPrice: price,
      serviceType: input.serviceType,
      bedrooms: input.bedrooms,
      bathrooms: input.bathrooms,
      extras: input.extras && input.extras.length > 0 ? JSON.stringify(input.extras) : null,
      messageHistory: initialHistory,
      // UTM attribution
      utmSource: input.utmSource ?? null,
      utmMedium: input.utmMedium ?? null,
      utmCampaign: input.utmCampaign ?? null,
      utmContent: input.utmContent ?? null,
      gclid: input.gclid ?? null,
      leadSource: "form",
      smsFlow: flowVariant,
    });
  } catch (dbErr) {
    console.error("[submitQuote] Failed to create conversation session:", dbErr);
  }

  // ── Log new_lead activity event ─────────────────────────────────────────
  logActivity({
    eventType: "new_lead",
    title: `New quote request: ${input.name}`,
    body: `${input.serviceType} · ${input.bedrooms} / ${input.bathrooms} · $${price}`,
    meta: { leadPhone: normalizedPhone, leadName: input.name, serviceType: input.serviceType, price },
  }).catch(() => {});

  // ── Step 6: Save lead record ──────────────────────────────────────────────
  let newLeadSessionId: number | undefined;
  try {
    await db.insert(quoteLeads).values({
      name: input.name,
      email: input.email,
      phone: normalizedPhone,
      serviceType: input.serviceType,
      bedrooms: input.bedrooms,
      bathrooms: input.bathrooms,
      extras: input.extras && input.extras.length > 0 ? JSON.stringify(input.extras) : null,
      smsSent: sms1.success ? 1 : 0,
      smsMessageId: sms1.messageId ?? null,
    });
  } catch (dbErr) {
    console.error("[submitQuote] Failed to save lead:", dbErr);
  }

  // ── Step 7: Post new lead card to MIB Command Chat ────────────────────────
  try {
    // Look up the session we just created to get its ID
    const [newSession] = await db
      .select({ id: conversationSessions.id })
      .from(conversationSessions)
      .where(eq(conversationSessions.leadPhone, normalizedPhone))
      .orderBy(desc(conversationSessions.id))
      .limit(1);
    newLeadSessionId = newSession?.id;

    const isOffice = input.serviceType === "Office Cleaning";
    const sizeDisplay = isOffice ? input.bedrooms : `${input.bedrooms} / ${input.bathrooms}`;
    const extrasDisplay = input.extras && input.extras.length > 0
      ? `\n📦 Extras: ${input.extras.join(", ")}`
      : "";
    const sourceDisplay = input.utmSource ? `\n📍 Source: ${input.utmSource}` : "";
    const leadBody = `🏠 **${input.serviceType}** · ${sizeDisplay} · **$${price}**${extrasDisplay}${sourceDisplay}`;

    const metadata = JSON.stringify({
      leadName: input.name,
      leadPhone: normalizedPhone,
      serviceType: input.serviceType,
      size: sizeDisplay,
      price,
      extras: input.extras ?? [],
      utmSource: input.utmSource ?? null,
      sessionId: newLeadSessionId ?? null,
      arrivedAt: Date.now(),
    });

    await db.insert(opsChatMessages).values({
      cleanerJobId: null,
      channel: "command",
      authorName: "🎯 New Lead",
      authorRole: "system",
      body: leadBody,
      mediaUrl: null,
      quickAction: "new_lead",
      metadata,
    });
  } catch (err) {
    console.error("[submitQuote] Failed to post lead card to command channel:", err);
  }
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Returns the 10-digit US local number from a raw phone string, or null if it
 * cannot be resolved to a valid US number.
 *
 * Valid US numbers:
 *   - Area code (NPA): 200-999 (first digit 2-9)
 *   - Exchange  (NXX): 200-999 (first digit 2-9)
 *
 * Rejects:
 *   - Non-US country codes (e.g. +44, +256)
 *   - 11-digit strings starting with anything other than 1
 *   - Numbers where NPA or NXX start with 0 or 1
 */
export function extractUSDigits(phone: string): string | null {
  const digits = phone.replace(/[^\d]/g, "");
  let local: string;
  if (digits.length === 11 && digits.startsWith("1")) {
    local = digits.slice(1);
  } else if (digits.length === 10) {
    local = digits;
  } else {
    return null; // wrong length or non-US country code
  }
  const npa = local[0]; // area code first digit
  const nxx = local[3]; // exchange first digit
  if (!npa || !nxx) return null;
  if (npa < "2" || nxx < "2") return null; // 0xx or 1xx are invalid
  return local;
}

/**
 * Returns true if the raw phone string resolves to a valid 10-digit US number.
 */
export function isValidUSPhone(phone: string): boolean {
  return extractUSDigits(phone) !== null;
}

/**
 * Normalizes a phone number to E.164 format (+1XXXXXXXXXX).
 * Handles inputs like: "7259009272", "725-900-9272", "(725) 900-9272", "+17259009272"
 * Returns null for non-US or invalid numbers.
 */
/** Normalize name casing: "ROHAN" → "Rohan", "rohan smith" → "Rohan Smith" */
export function toTitleCase(str: string): string {
  return str
    .trim()
    .split(/\s+/)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

export function normalizePhone(phone: string): string {
  const local = extractUSDigits(phone);
  if (local) return `+1${local}`;
  // Fallback for legacy callers — pass through as-is (will be caught by server validation)
  const digits = phone.replace(/[^\d]/g, "");
  if (phone.startsWith("+")) return phone.replace(/[^\d+]/g, "");
  return `+${digits}`;
}

/**
 * Builds a Drizzle WHERE condition for optional date range filtering.
 * dateFrom and dateTo are ISO date strings like "2026-03-01".
 * The dateTo is treated as end-of-day (23:59:59) so the full day is included.
 */
/**
 * Calculates the effective booked revenue for a single session row.
 * Priority: bookedAmount (manual override) > quotedPrice + extras (form/widget) > reactivationLastPrice * discount (reactivation)
 */
function calcBookedRevenue(row: {
  bookedAmount?: number | null;
  quotedPrice?: string | null;
  extras?: string | null;
  reactivationLastPrice?: number | null;
  reactivationDiscountPct?: number | null;
}): number {
  // 1. Admin-set manual override always wins
  if (row.bookedAmount !== null && row.bookedAmount !== undefined) {
    return Number(row.bookedAmount);
  }
  // 2. Form/widget leads: quotedPrice + extras
  // Campaign leads get a placeholder "0" written to quotedPrice — skip it so we fall
  // through to reactivationLastPrice which IS the actual booked amount (no discount).
  if (row.quotedPrice !== null && row.quotedPrice !== undefined && row.quotedPrice !== '') {
    const base = parseFloat(row.quotedPrice);
    if (!isNaN(base) && base > 0) {
      let extrasTotal = 0;
      try {
        const keys: string[] = JSON.parse(row.extras ?? '[]');
        extrasTotal = calculateExtrasTotal(keys);
      } catch { /* ignore */ }
      return base + extrasTotal;
    }
    // base === 0: use reactivationLastPrice as the booked amount (no discount — it is the price)
    if (row.reactivationLastPrice !== null && row.reactivationLastPrice !== undefined) {
      return Number(row.reactivationLastPrice);
    }
    return 0;
  }
  // 3. Reactivation/campaign leads: reactivationLastPrice IS the actual price paid
  if (row.reactivationLastPrice !== null && row.reactivationLastPrice !== undefined) {
    return Number(row.reactivationLastPrice);
  }
  return 0;
}

/**
 * Returns the UTC offset in milliseconds for America/New_York at a given UTC instant.
 * Handles both EST (UTC-5) and EDT (UTC-4) automatically.
 */
function estOffsetMs(utcDate: Date): number {
  // Format the date in ET to get the local wall-clock time
  const etStr = utcDate.toLocaleString("en-US", {
    timeZone: "America/New_York",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false,
  });
  // etStr looks like "04/01/2026, 00:00:00"
  const [datePart, timePart] = etStr.split(", ");
  const [mo, dy, yr] = datePart.split("/");
  // Treat it as UTC to get the numeric value of the ET wall-clock time
  const etAsUtc = new Date(`${yr}-${mo}-${dy}T${timePart}Z`);
  // Offset = ET wall-clock interpreted as UTC minus actual UTC = negative for behind-UTC timezones
  return etAsUtc.getTime() - utcDate.getTime();
}

function buildDateConditions(dateFrom?: string, dateTo?: string) {
  const conditions = [];
  if (dateFrom) {
    // Midnight EST/EDT: start with midnight UTC on the given date, then adjust for ET offset
    const midnightUtc = new Date(dateFrom + "T00:00:00.000Z");
    const from = new Date(midnightUtc.getTime() - estOffsetMs(midnightUtc));
    conditions.push(gte(conversationSessions.createdAt, from));
  }
  if (dateTo) {
    // End of day EST/EDT: 23:59:59.999 ET
    const endUtc = new Date(dateTo + "T23:59:59.999Z");
    const to = new Date(endUtc.getTime() - estOffsetMs(endUtc));
    conditions.push(lte(conversationSessions.createdAt, to));
  }
  return conditions.length > 0 ? and(...conditions) : undefined;
}
/** Same as buildDateConditions but filters on bookedAt instead of createdAt.
 *  Used for booked-revenue queries so "today" means booked today, not created today.
 */
function buildBookedDateConditions(dateFrom?: string, dateTo?: string) {
  const conditions = [];
  if (dateFrom) {
    const midnightUtc = new Date(dateFrom + "T00:00:00.000Z");
    const from = new Date(midnightUtc.getTime() - estOffsetMs(midnightUtc));
    conditions.push(gte(conversationSessions.bookedAt, from));
  }
  if (dateTo) {
    const endUtc = new Date(dateTo + "T23:59:59.999Z");
    const to = new Date(endUtc.getTime() - estOffsetMs(endUtc));
    conditions.push(lte(conversationSessions.bookedAt, to));
  }
  return conditions.length > 0 ? and(...conditions) : undefined;
}
/**
 * Extracts and verifies the agent session from the request cookie..
 * Throws an error if the agent is not authenticated or inactive.
 */
async function getAgentSessionFromCtx(ctx: { req: { headers: { cookie?: string } } }) {
  const cookieHeader = ctx.req.headers.cookie;
  if (!cookieHeader) throw new Error("Agent not authenticated");
  const token = parseCookie(cookieHeader)[AGENT_COOKIE_NAME] ?? null;
  const session = await verifyAgentSession(token);
  if (!session) throw new Error("Agent not authenticated");
  // Verify agent is still active in DB and use fresh name from DB (not stale JWT name)
  const agent = await getAgentById(session.agentId);
  if (!agent || !agent.isActive) throw new Error("Agent account is inactive or not found");
  return { ...session, agentName: agent.name };
}

/**
 * syncClaimToOpsChatMessage — update the matching new_lead opsChatMessage metadata
 * so the HotLeadsTray in CommandChat reflects the claim state from the Leads drawer.
 * Pass claimedBy=null to clear the claim (unclaim).
 */
async function syncClaimToOpsChatMessage(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  sessionId: number,
  claimedBy: string | null,
  claimedAt: number | null,
): Promise<void> {
  try {
    const leadMsgs = await db
      .select({ id: opsChatMessages.id, metadata: opsChatMessages.metadata })
      .from(opsChatMessages)
      .where(eq(opsChatMessages.quickAction, "new_lead"))
      .orderBy(desc(opsChatMessages.createdAt))
      .limit(200);
    for (const msg of leadMsgs) {
      try {
        const meta = JSON.parse(msg.metadata ?? "{}");
        if (meta.sessionId === sessionId) {
          if (claimedBy) {
            meta.claimedBy = claimedBy;
            meta.claimedAt = claimedAt;
          } else {
            delete meta.claimedBy;
            delete meta.claimedAt;
          }
          await db
            .update(opsChatMessages)
            .set({ metadata: JSON.stringify(meta) })
            .where(eq(opsChatMessages.id, msg.id));
          break;
        }
      } catch { /* ignore parse errors */ }
    }
  } catch { /* non-fatal */ }
}
