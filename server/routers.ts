import { COOKIE_NAME, AGENT_COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, protectedProcedure, adminAgentProcedure, router } from "./_core/trpc";
import { TRPCError } from "@trpc/server";
import { messageTemplateRouter } from "./messageTemplateRouter";
import { signAgentSession, verifyAgentSession } from "./_core/agentAuth";
import { z } from "zod";
import { and, desc, eq, gte, isNull, isNotNull, lte, ne, or, sql } from "drizzle-orm";
import { getDb, getAgentByEmail, getAgentById, getAllAgents, createAgent, setAgentActive } from "./db";
import { quoteLeads, conversationSessions, leadCallLogs, callOutcomes, pageViews, voiceCalls } from "../drizzle/schema";
import { sendSms, estimatePrice } from "./openphone";
import { generateQuoteMessage, generatePricingFollowUp, handleOffScriptReply, handlePostBookingReply } from "./aiService";
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
// CS_SUPPORT_NUMBER: customer service line that receives new lead alerts
const CS_SUPPORT_NUMBER = "+12028885362";

// In-memory typing presence store: sessionId -> { agentName, agentId, expiresAt }
// Ephemeral — cleared on server restart. No DB needed for real-time typing indicators.
const typingPresence = new Map<string, { agentName: string; agentId: number; expiresAt: number }>();
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

        // Include sessions that are either:
        //   (a) NOT from always-on campaigns (form leads, reactivation CSV, widget, etc.)
        //   (b) FROM always-on campaigns but have progressed past REACTIVATION stage
        //       (meaning the customer replied and entered the booking flow)
        // Explicitly exclude:
        //   - review sessions (leadSource = 'review') — these belong in the Reviews tab
        const sourceFilter = and(
          // Never show review-flow sessions in the lead list
          ne(conversationSessions.leadSource, "review"),
          or(
            // Non-always-on sources
            sql`(${conversationSessions.leadSource} IS NULL OR ${conversationSessions.leadSource} NOT LIKE 'always-on%')`,
            // Always-on but replied (stage advanced past REACTIVATION)
            and(
              sql`${conversationSessions.leadSource} LIKE 'always-on%'`,
              ne(conversationSessions.stage, "REACTIVATION")
            )
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

        // Derive lastActivity from messageHistory (most recent SMS) or lastCalledAt
        const mapped = sessions.map(s => {
          let lastActivityText: string | null = null;
          let lastActivityAt: Date | null = null;
          let lastActivityType: "sms" | "call" | null = null;

          // Parse message history to find the most recent message
          try {
            const history: Array<{ role: string; content: string; ts?: number }> =
              JSON.parse(s.messageHistory ?? "[]");
            if (history.length > 0) {
              const last = history[history.length - 1];
              lastActivityText = typeof last.content === "string"
                ? last.content.slice(0, 100)
                : null;
              // Sanity-guard: if the stored ts is more than 30 days older than
              // the session's own updatedAt, it's corrupt data (e.g. a test call
              // with a wrong clock). Fall back to updatedAt so the dashboard
              // never shows a wildly stale timestamp.
              if (last.ts) {
                const sessionUpdatedMs = s.updatedAt instanceof Date
                  ? s.updatedAt.getTime()
                  : new Date(s.updatedAt as string).getTime();
                const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
                const tsDiff = sessionUpdatedMs - last.ts;
                lastActivityAt = tsDiff > THIRTY_DAYS_MS
                  ? s.updatedAt  // ts is suspiciously old — use session updatedAt
                  : new Date(last.ts);
              } else {
                lastActivityAt = s.updatedAt;
              }
              lastActivityType = "sms";
            }
          } catch {
            // ignore parse errors
          }

          // If the most recent call log is newer than the last SMS, prefer it
          if (s.lastCalledAt && (!lastActivityAt || s.lastCalledAt > lastActivityAt)) {
            lastActivityText = `Call: ${s.lastCalledByAgentName ?? "agent"}`;
            lastActivityAt = s.lastCalledAt;
            lastActivityType = "call";
          }

          return { ...s, lastActivityText, lastActivityAt, lastActivityType };
        });

        // Sort by lastActivityAt descending so the most recently active lead
        // is always at the top. Falls back to createdAt for sessions with no
        // message history yet.
        mapped.sort((a, b) => {
          const aTime = a.lastActivityAt
            ? (a.lastActivityAt instanceof Date ? a.lastActivityAt.getTime() : new Date(a.lastActivityAt as string).getTime())
            : (a.createdAt instanceof Date ? a.createdAt.getTime() : new Date(a.createdAt as string).getTime());
          const bTime = b.lastActivityAt
            ? (b.lastActivityAt instanceof Date ? b.lastActivityAt.getTime() : new Date(b.lastActivityAt as string).getTime())
            : (b.createdAt instanceof Date ? b.createdAt.getTime() : new Date(b.createdAt as string).getTime());
          return bTime - aTime;
        });

        return mapped;
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
        if (!db) return { total: 0, byStage: {}, bookedCount: 0, bookedRevenue: 0, conversionRate: 0, revenueBySource: { form: 0, widget: 0, reactivation: 0 } };
        const conditions = buildDateConditions(input?.dateFrom, input?.dateTo);

        // Stage breakdown — exclude review sessions (they belong in the Reviews tab)
        const reviewExclude = ne(conversationSessions.leadSource, "review");
        const statsConditions = conditions
          ? and(conditions, reviewExclude)
          : reviewExclude;

        const rows = await db
          .select({
            stage: conversationSessions.stage,
            count: sql<number>`count(*)`,
          })
          .from(conversationSessions)
          .where(statsConditions)
          .groupBy(conversationSessions.stage);
        const byStage: Record<string, number> = {};
        let total = 0;
        for (const row of rows) {
          byStage[row.stage] = Number(row.count);
          total += Number(row.count);
        }

        // Booked revenue: use bookedAmount if set, else quotedPrice + extras total
        const bookedRows = await db
          .select({
            leadSource: conversationSessions.leadSource,
            quotedPrice: conversationSessions.quotedPrice,
            extras: conversationSessions.extras,
            bookedAmount: conversationSessions.bookedAmount,
            reactivationLastPrice: conversationSessions.reactivationLastPrice,
            reactivationDiscountPct: conversationSessions.reactivationDiscountPct,
          })
          .from(conversationSessions)
          .where(
            conditions
              ? and(conditions, eq(conversationSessions.stage, "BOOKED"))
              : eq(conversationSessions.stage, "BOOKED")
          );
        const bookedCount = bookedRows.length;
        const bookedRevenue = bookedRows.reduce((sum, r) => sum + calcBookedRevenue(r), 0);
        // Revenue broken down by lead source
        const revenueBySource = { form: 0, widget: 0, reactivation: 0 } as Record<string, number>;
        for (const r of bookedRows) {
          const src = r.leadSource ?? 'form';
          revenueBySource[src] = (revenueBySource[src] ?? 0) + calcBookedRevenue(r);
        }
        const conversionRate = total > 0 ? Math.round((bookedCount / total) * 100) : 0;

        return { total, byStage, bookedCount, bookedRevenue, conversionRate, revenueBySource };
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
          "NOT_INTERESTED",
          "FUTURE_BOOKING",
          "FOLLOW_UP_SCHEDULED",
        ]),
      }))
      .mutation(async ({ input }) => {
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
          return { success: true };
        }
        const agent = await getAgentById(input.agentId);
        if (!agent) throw new Error("Agent not found");
        await db
          .update(conversationSessions)
          .set({ assignedAgentId: agent.id, assignedAgentName: agent.name })
          .where(eq(conversationSessions.id, input.sessionId));
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
     * leads.sendMessage — agent or admin sends an outbound SMS to a lead from the app.
     * Stores the message in messageHistory and sends via OpenPhone.
     */
    sendMessage: publicProcedure
      .input(z.object({
        sessionId: z.number().int().positive(),
        message: z.string().min(1).max(1600),
      }))
      .mutation(async ({ input, ctx }) => {
        const agentSession = await getAgentSessionFromCtx(ctx);
        const db = await getDb();
        if (!db) throw new Error("Database unavailable");

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

        // Deduplication guard: reject if the exact same message was sent within the last 10 seconds.
        // This prevents double-sends caused by rapid re-renders or accidental double-clicks.
        const now = Date.now();
        const recentDuplicate = history.find(
          m => m.role === "assistant" && m.content === input.message && m.ts && (now - m.ts) < 10_000
        );
        if (recentDuplicate) {
          console.warn(`[sendMessage] Duplicate detected for session ${input.sessionId} — skipping SMS send.`);
          return { success: true, smsSent: false, duplicate: true };
        }

        history.push({ role: "assistant", content: input.message, ts: now, senderName: agentSession.agentName });
        if (history.length > 20) history = history.slice(-20);

        // Save to DB
        await db
          .update(conversationSessions)
          .set({ messageHistory: JSON.stringify(history) })
          .where(eq(conversationSessions.id, input.sessionId));

        // Send via OpenPhone
        const smsResult = await sendSms({ to: session.leadPhone, content: input.message });
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

      // All sessions created yesterday (excluding review sessions)
      const sessions = await db
        .select()
        .from(conversationSessions)
        .where(
          and(
            gte(conversationSessions.createdAt, yesterdayStart),
            lte(conversationSessions.createdAt, yesterdayEnd),
            ne(conversationSessions.leadSource, "review")
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
  }),

  /**
   * agents — agent auth + lead action procedures.
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
      return { id: agent.id, name: agent.name, email: agent.email, isActive: agent.isActive, isAdmin: agent.isAdmin === 1 };
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
      return all.map(a => ({
        id: a.id,
        name: a.name,
        email: a.email,
        isActive: a.isActive,
        createdAt: a.createdAt,
      }));
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

        return { leadsAssigned, bookedCount, bookedRevenue, conversionRate };
      }),

    /**
     * agents.leaderboard — admin-only ranked leaderboard for all active agents.
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
});

export type AppRouter = typeof appRouter;

// ─── Background processor ─────────────────────────────────────────────────────

/**
 * Handles the widget lead submission (name + phone only).
 * Sends a sizing question SMS and creates a WIDGET_SIZING session.
 * The conversation engine handles the reply to extract rooms and send a quote.
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
  const firstName = input.name.trim().split(" ")[0] ?? input.name.trim();

  // ── Step 1: Send admin alert ──────────────────────────────────────────────
  const alertMsg = `New Widget Lead - Maids in Black\n\nName: ${input.name}\nPhone: ${normalizedPhone}\nSource: ${input.utmSource ?? "direct"}`;
  sendSms({ to: CS_SUPPORT_NUMBER, content: alertMsg }).catch(err =>
    console.error("[submitWidgetLead] CS alert SMS failed:", err)
  );
  sendSms({ to: SECONDARY_ALERT_NUMBER, content: alertMsg }).catch(err =>
    console.error("[submitWidgetLead] Secondary alert SMS failed:", err)
  );

  // ── Step 2: Send sizing question SMS ─────────────────────────────────────
  const sizingMsg = `Hi ${firstName}! \uD83D\uDC4B Thanks for reaching out to Maids in Black. To get you an instant price, how many bedrooms and bathrooms does your home have? (e.g. 3 bed / 2 bath)`;
  const smsResult = await sendSms({ to: normalizedPhone, content: sizingMsg });
  console.log(`[submitWidgetLead] Sizing SMS sent: ${smsResult.success}`);

  // ── Step 3: Create conversation session ──────────────────────────────────
  const db = await getDb();
  if (!db) {
    console.warn("[submitWidgetLead] No DB — skipping session save");
    return;
  }
  const now = Date.now();
  const initialHistory = JSON.stringify([
    { role: "assistant", content: sizingMsg, ts: now },
  ]);
  try {
    await db.insert(conversationSessions).values({
      leadPhone: normalizedPhone,
      leadName: input.name.trim(),
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
    });
  } catch (dbErr) {
    console.error("[submitWidgetLead] Failed to create conversation session:", dbErr);
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

  // ── Step 2: Generate AI quote messages (with fallback) ────────────────────
  const msg1 = await generateQuoteMessage({
    leadName: input.name,
    bedrooms: input.bedrooms,
    bathrooms: input.bathrooms,
    serviceType: input.serviceType,
    price,
    extras: input.extras,
  });
  const msg2 = await generatePricingFollowUp({
    leadName: input.name,
    bedrooms: input.bedrooms,
    bathrooms: input.bathrooms,
    serviceType: input.serviceType,
    price,
  });

  // ── Step 3: Send SMS #1: Quote + price + value note to lead ───────────────
  const MADISON_PHOTO_URL = "https://d2xsxph8kpxj0f.cloudfront.net/310519663254023424/CAeRhAUjAZoEuxNGm5QbPr/madison-headshot-SPXr6KHGViveW2LxjwfyqN.png";
  const sms1 = await sendSms({ to: input.phone, content: msg1, mediaUrl: MADISON_PHOTO_URL });
  console.log(`[submitQuote] SMS1 sent: ${sms1.success}`);

  // ── Step 4: Send SMS #2: Availability question (natural delay) ────────────
  await delay(2000);
  const sms2 = await sendSms({ to: input.phone, content: msg2 });
  console.log(`[submitQuote] SMS2 sent: ${sms2.success}`);

  const db = await getDb();
  if (!db) {
    console.warn("[submitQuote] No DB — skipping session and lead save");
    return;
  }

  // ── Step 5: Create/update conversation session ────────────────────────────
  const now = Date.now();
  const initialHistory = JSON.stringify([
    { role: "assistant", content: msg1, ts: now },
    { role: "assistant", content: msg2, ts: now + 1 },
  ]);

  // Always create a new session row — same phone can submit again months later
  try {
    await db.insert(conversationSessions).values({
      leadPhone: normalizedPhone,
      leadName: input.name,
      stage: "AVAILABILITY",
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
  if (row.quotedPrice !== null && row.quotedPrice !== undefined && row.quotedPrice !== '') {
    const base = parseFloat(row.quotedPrice);
    let extrasTotal = 0;
    try {
      const keys: string[] = JSON.parse(row.extras ?? '[]');
      extrasTotal = calculateExtrasTotal(keys);
    } catch { /* ignore */ }
    return (isNaN(base) ? 0 : base) + extrasTotal;
  }
  // 3. Reactivation leads: last price with discount applied
  if (row.reactivationLastPrice !== null && row.reactivationLastPrice !== undefined) {
    const discountPct = row.reactivationDiscountPct ?? 10;
    return Math.round(row.reactivationLastPrice * (1 - discountPct / 100));
  }
  return 0;
}

function buildDateConditions(dateFrom?: string, dateTo?: string) {
  const conditions = [];
  if (dateFrom) {
    // Parse as local midnight by appending T00:00:00 without Z (local time)
    // Then convert to UTC for the DB query. We use a wide window: from start of
    // dateFrom in UTC-12 (earliest timezone) to cover all possible local "today"s.
    const from = new Date(dateFrom + "T00:00:00.000Z");
    // Subtract 14 hours to cover UTC-14 (furthest behind UTC timezone)
    from.setUTCHours(from.getUTCHours() - 14);
    conditions.push(gte(conversationSessions.createdAt, from));
  }
  if (dateTo) {
    // End of dateTo: add 1 day + 14 hours to cover UTC+14 (furthest ahead)
    const to = new Date(dateTo + "T23:59:59.999Z");
    to.setUTCHours(to.getUTCHours() + 14);
    conditions.push(lte(conversationSessions.createdAt, to));
  }
  return conditions.length > 0 ? and(...conditions) : undefined;
}

/**
 * Extracts and verifies the agent session from the request cookie.
 * Throws an error if the agent is not authenticated or inactive.
 */
async function getAgentSessionFromCtx(ctx: { req: { headers: { cookie?: string } } }) {
  const cookieHeader = ctx.req.headers.cookie;
  if (!cookieHeader) throw new Error("Agent not authenticated");
  const token = parseCookie(cookieHeader)[AGENT_COOKIE_NAME] ?? null;
  const session = await verifyAgentSession(token);
  if (!session) throw new Error("Agent not authenticated");
  // Verify agent is still active in DB
  const agent = await getAgentById(session.agentId);
  if (!agent || !agent.isActive) throw new Error("Agent account is inactive or not found");
  return session;
}
