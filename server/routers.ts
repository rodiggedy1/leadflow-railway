import { COOKIE_NAME, AGENT_COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, protectedProcedure, adminAgentProcedure, router } from "./_core/trpc";
import { signAgentSession, verifyAgentSession } from "./_core/agentAuth";
import { z } from "zod";
import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import { getDb, getAgentByEmail, getAgentById, getAllAgents, createAgent, setAgentActive } from "./db";
import { quoteLeads, conversationSessions, leadCallLogs, callOutcomes, pageViews } from "../drizzle/schema";
import { sendSms, estimatePrice } from "./openphone";
import { generateQuoteMessage, generatePricingFollowUp, handleOffScriptReply, handlePostBookingReply } from "./aiService";
import bcrypt from "bcryptjs";
import { parse as parseCookie } from "cookie";
import { calculateExtrasTotal } from "../shared/extras";
import { campaignRouter, markReactivationContactBooked } from "./campaignRouter";
// CS_SUPPORT_NUMBER: customer service line that receives new lead alerts
const CS_SUPPORT_NUMBER = "+12028885362";
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
        const conditions = buildDateConditions(input?.dateFrom, input?.dateTo);
        const sessions = await db
          .select()
          .from(conversationSessions)
          .where(conditions)
          .orderBy(desc(conversationSessions.updatedAt))
          .limit(500);
        return sessions;
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

        // Stage breakdown
        const rows = await db
          .select({
            stage: conversationSessions.stage,
            count: sql<number>`count(*)`,
          })
          .from(conversationSessions)
          .where(conditions)
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
        const visitorRows = await db
          .select({
            utmSource: pageViews.utmSource,
            count: sql<number>`count(*)`,
          })
          .from(pageViews)
          .where(
            and(
              input?.dateFrom ? gte(pageViews.createdAt, new Date(input.dateFrom)) : undefined,
              input?.dateTo   ? lte(pageViews.createdAt, new Date(input.dateTo))   : undefined,
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
      }))
      .mutation(async ({ input }) => {
        const db = await getDb();
        if (!db) return { ok: false };
        // Upsert — ignore if this sessionKey already exists
        try {
          await db.insert(pageViews).ignore().values({
            sessionKey: input.sessionKey,
            utmSource: input.utmSource ?? null,
            utmMedium: input.utmMedium ?? null,
            utmCampaign: input.utmCampaign ?? null,
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
        const [visitorRow] = await db
          .select({ count: sql<number>`count(*)` })
          .from(pageViews)
          .where(
            input?.dateFrom || input?.dateTo
              ? and(
                  input?.dateFrom ? gte(pageViews.createdAt, new Date(input.dateFrom)) : undefined,
                  input?.dateTo ? lte(pageViews.createdAt, new Date(input.dateTo)) : undefined,
                )
              : undefined
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
        ]),
      }))
      .mutation(async ({ input }) => {
        const db = await getDb();
        if (!db) throw new Error("Database unavailable");
        await db
          .update(conversationSessions)
          .set({ stage: input.stage })
          .where(eq(conversationSessions.id, input.sessionId));
        // If marking as BOOKED, increment campaign bookedCount for reactivation leads
        if (input.stage === "BOOKED") {
          await markReactivationContactBooked(input.sessionId).catch(console.error);
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
        let history: Array<{ role: string; content: string; ts?: number }> = [];
        try { history = JSON.parse(session.messageHistory ?? "[]"); } catch { history = []; }
        history.push({ role: "assistant", content: input.message, ts: Date.now() });
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
          maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
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

      const callsMap = new Map(callsThisWeek.map(r => [r.agentId, Number(r.count)]));
      const bookingsWeekMap = new Map(bookingsThisWeek.map(r => [r.agentId, Number(r.count)]));
      const assignedMap = new Map(totalAssigned.map(r => [r.agentId, Number(r.count)]));
      const bookingsAllTimeMap = new Map(bookingsAllTime.map(r => [r.agentId, Number(r.count)]));

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
 * Normalizes a phone number to E.164 format (+1XXXXXXXXXX).
 * Handles inputs like: "7259009272", "725-900-9272", "(725) 900-9272", "+17259009272"
 */
export function normalizePhone(phone: string): string {
  const digits = phone.replace(/[^\d]/g, "");
  if (digits.length === 11 && digits.startsWith("1")) {
    return `+${digits}`;
  }
  if (digits.length === 10) {
    return `+1${digits}`;
  }
  if (phone.startsWith("+")) {
    return phone.replace(/[^\d+]/g, "");
  }
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
