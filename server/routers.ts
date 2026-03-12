import { COOKIE_NAME, AGENT_COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, protectedProcedure, adminAgentProcedure, router } from "./_core/trpc";
import { signAgentSession, verifyAgentSession } from "./_core/agentAuth";
import { z } from "zod";
import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import { getDb, getAgentByEmail, getAgentById, getAllAgents, createAgent, setAgentActive } from "./db";
import { quoteLeads, conversationSessions, leadCallLogs, callOutcomes } from "../drizzle/schema";
import { sendSms, estimatePrice } from "./openphone";
import { generateQuoteMessage, generatePricingFollowUp, handleOffScriptReply, handlePostBookingReply } from "./aiService";
import bcrypt from "bcryptjs";
import { parse as parseCookie } from "cookie";
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
        if (!db) return { total: 0, byStage: {}, bookedCount: 0, bookedRevenue: 0, conversionRate: 0 };
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

        // Booked revenue: sum of quotedPrice for BOOKED sessions
        const bookedRows = await db
          .select({ quotedPrice: conversationSessions.quotedPrice })
          .from(conversationSessions)
          .where(
            conditions
              ? and(conditions, eq(conversationSessions.stage, "BOOKED"))
              : eq(conversationSessions.stage, "BOOKED")
          );
        const bookedCount = bookedRows.length;
        const bookedRevenue = bookedRows.reduce((sum, r) => {
          const price = parseFloat(r.quotedPrice ?? "0");
          return sum + (isNaN(price) ? 0 : price);
        }, 0);
        const conversionRate = total > 0 ? Math.round((bookedCount / total) * 100) : 0;

        return { total, byStage, bookedCount, bookedRevenue, conversionRate };
      }),

    /**
     * leads.adminUpdateStage — admin overrides the stage of any lead.
     */
    adminUpdateStage: adminAgentProcedure
      .input(z.object({
        sessionId: z.number().int().positive(),
        stage: z.enum([
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
            bookedAt: now,
            bookedByAgentId: agentSession.agentId,
            bookedByAgentName: agentSession.agentName,
          })
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
  }),

  /**
   * simulator.chat — live SMS simulator for admin/agent testing
   * Calls the real AI engine with configurable lead context.
   * No SMS is sent; responses come back immediately over tRPC.
   */
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
          stage: z.enum(["QUOTE_SENT", "AVAILABILITY", "SLOT_CHOICE", "CONFIRMATION", "ADDRESS", "DONE", "CALL_SCHEDULED"]).default("AVAILABILITY"),
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
  const initialHistory = JSON.stringify([
    { role: "assistant", content: msg1 },
    { role: "assistant", content: msg2 },
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
