import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, protectedProcedure, router } from "./_core/trpc";
import { z } from "zod";
import { and, between, desc, eq, gte, lte, sql } from "drizzle-orm";
import { getDb } from "./db";
import { quoteLeads, conversationSessions, leadCallLogs, callOutcomes } from "../drizzle/schema";
import { sendSms, estimatePrice } from "./openphone";
import { generateQuoteMessage, generatePricingFollowUp } from "./aiService";
// CS_SUPPORT_NUMBER: customer service line that receives new lead alerts
const CS_SUPPORT_NUMBER = "+12028885362";

// Zod schema for the quote form submission
const quoteFormSchema = z.object({
  name: z.string().min(1, "Name is required").max(255),
  email: z.string().email("Invalid email").max(320),
  phone: z.string().min(7, "Phone is required").max(30),
  serviceType: z.string().min(1).max(100),
  bedrooms: z.string().min(1).max(50),
  bathrooms: z.string().min(1).max(50),
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
        if (!db) return { total: 0, byStage: {} };
        const conditions = buildDateConditions(input?.dateFrom, input?.dateTo);
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
        return { total, byStage };
      }),
  }),

  /**
   * agents — protected procedures for agent actions on leads
   *
   * All procedures require the agent to be logged in via Manus OAuth.
   * The agent's user.id and user.name are taken from ctx.user.
   */
  agents: router({
    /**
     * agents.claimLead — assign a lead to the calling agent
     * If the lead is already claimed by another agent, throws FORBIDDEN.
     * Admins can always reassign.
     */
    claimLead: protectedProcedure
      .input(z.object({ sessionId: z.number().int().positive() }))
      .mutation(async ({ input, ctx }) => {
        const db = await getDb();
        if (!db) throw new Error("Database unavailable");
        const [session] = await db
          .select()
          .from(conversationSessions)
          .where(eq(conversationSessions.id, input.sessionId))
          .limit(1);
        if (!session) throw new Error("Lead not found");
        // Only admins can steal a lead already claimed by someone else
        if (
          session.assignedAgentId &&
          session.assignedAgentId !== ctx.user.id &&
          ctx.user.role !== "admin"
        ) {
          throw new Error("This lead is already claimed by another agent");
        }
        await db
          .update(conversationSessions)
          .set({
            assignedAgentId: ctx.user.id,
            assignedAgentName: ctx.user.name ?? "Unknown Agent",
          })
          .where(eq(conversationSessions.id, input.sessionId));
        return { success: true };
      }),

    /**
     * agents.unclaimLead — release a lead back to unassigned
     * Only the owning agent or an admin can unclaim.
     */
    unclaimLead: protectedProcedure
      .input(z.object({ sessionId: z.number().int().positive() }))
      .mutation(async ({ input, ctx }) => {
        const db = await getDb();
        if (!db) throw new Error("Database unavailable");
        const [session] = await db
          .select()
          .from(conversationSessions)
          .where(eq(conversationSessions.id, input.sessionId))
          .limit(1);
        if (!session) throw new Error("Lead not found");
        if (
          session.assignedAgentId !== ctx.user.id &&
          ctx.user.role !== "admin"
        ) {
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
     * Also updates lastCalledAt / lastCalledByAgent on the session.
     */
    logCall: protectedProcedure
      .input(
        z.object({
          sessionId: z.number().int().positive(),
          outcome: z.enum(callOutcomes as unknown as [string, ...string[]]),
          notes: z.string().max(1000).optional(),
        })
      )
      .mutation(async ({ input, ctx }) => {
        const db = await getDb();
        if (!db) throw new Error("Database unavailable");
        const now = new Date();
        // Insert call log row
        await db.insert(leadCallLogs).values({
          sessionId: input.sessionId,
          agentId: ctx.user.id,
          agentName: ctx.user.name ?? "Unknown Agent",
          outcome: input.outcome,
          notes: input.notes ?? null,
          calledAt: now,
        });
        // Update the session's last-called fields
        const updates: Record<string, unknown> = {
          lastCalledAt: now,
          lastCalledByAgentId: ctx.user.id,
          lastCalledByAgentName: ctx.user.name ?? "Unknown Agent",
        };
        // If outcome is BOOKED, also mark as booked
        if (input.outcome === "BOOKED") {
          updates.isBooked = 1;
          updates.bookedAt = now;
          updates.bookedByAgentId = ctx.user.id;
          updates.bookedByAgentName = ctx.user.name ?? "Unknown Agent";
        }
        await db
          .update(conversationSessions)
          .set(updates)
          .where(eq(conversationSessions.id, input.sessionId));
        return { success: true };
      }),

    /**
     * agents.markBooked — explicitly mark a lead as booked (without logging a call).
     */
    markBooked: protectedProcedure
      .input(
        z.object({
          sessionId: z.number().int().positive(),
          notes: z.string().max(1000).optional(),
        })
      )
      .mutation(async ({ input, ctx }) => {
        const db = await getDb();
        if (!db) throw new Error("Database unavailable");
        const now = new Date();
        await db
          .update(conversationSessions)
          .set({
            isBooked: 1,
            bookedAt: now,
            bookedByAgentId: ctx.user.id,
            bookedByAgentName: ctx.user.name ?? "Unknown Agent",
          })
          .where(eq(conversationSessions.id, input.sessionId));
        return { success: true };
      }),

    /**
     * agents.unmarkBooked — undo a booking (admin only).
     */
    unmarkBooked: protectedProcedure
      .input(z.object({ sessionId: z.number().int().positive() }))
      .mutation(async ({ input, ctx }) => {
        if (ctx.user.role !== "admin") throw new Error("Admin only");
        const db = await getDb();
        if (!db) throw new Error("Database unavailable");
        await db
          .update(conversationSessions)
          .set({ isBooked: 0, bookedAt: null, bookedByAgentId: null, bookedByAgentName: null })
          .where(eq(conversationSessions.id, input.sessionId));
        return { success: true };
      }),

    /**
     * agents.getCallLogs — get all call log entries for a specific session.
     */
    getCallLogs: protectedProcedure
      .input(z.object({ sessionId: z.number().int().positive() }))
      .query(async ({ input }) => {
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
    myLeads: protectedProcedure
      .input(
        z.object({
          dateFrom: z.string().optional(),
          dateTo: z.string().optional(),
        }).optional()
      )
      .query(async ({ input, ctx }) => {
        const db = await getDb();
        if (!db) return [];
        const conditions = [
          eq(conversationSessions.assignedAgentId, ctx.user.id),
          ...(buildDateConditions(input?.dateFrom, input?.dateTo)
            ? [buildDateConditions(input?.dateFrom, input?.dateTo)!]
            : []),
        ];
        return db
          .select()
          .from(conversationSessions)
          .where(and(...conditions))
          .orderBy(desc(conversationSessions.updatedAt))
          .limit(500);
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
  },
  price: string
): Promise<void> {
  const normalizedPhone = normalizePhone(input.phone);

  // ── Step 1: Alert support team immediately (simple direct SMS) ───────────
  const isOffice = input.serviceType === "Office Cleaning";
  const sizeInfo = isOffice ? input.bedrooms : `${input.bedrooms} / ${input.bathrooms}`;
  const alertMsg = `New Quote Request - Maids in Black\n\nName: ${input.name}\nPhone: ${normalizedPhone}\nService: ${input.serviceType}\nSize: ${sizeInfo}\nQuote: $${price}`;

  sendSms({ to: CS_SUPPORT_NUMBER, content: alertMsg }).catch(err =>
    console.error("[submitQuote] CS alert SMS failed:", err)
  );

  // ── Step 2: Generate AI quote messages (with fallback) ────────────────────
  const msg1 = await generateQuoteMessage({
    leadName: input.name,
    bedrooms: input.bedrooms,
    bathrooms: input.bathrooms,
    serviceType: input.serviceType,
    price,
  });
  const msg2 = await generatePricingFollowUp({
    leadName: input.name,
    bedrooms: input.bedrooms,
    bathrooms: input.bathrooms,
    serviceType: input.serviceType,
    price,
  });

  // ── Step 3: Send SMS #1: Quote + price + value note to lead ───────────────
  const sms1 = await sendSms({ to: input.phone, content: msg1 });
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

  try {
    const existing = await db
      .select()
      .from(conversationSessions)
      .where(eq(conversationSessions.leadPhone, normalizedPhone))
      .limit(1);

    if (existing.length > 0) {
      await db
        .update(conversationSessions)
        .set({
          stage: "AVAILABILITY",
          leadName: input.name,
          quotedPrice: price,
          serviceType: input.serviceType,
          bedrooms: input.bedrooms,
          bathrooms: input.bathrooms,
          selectedSlot: null,
          address: null,
          callPreference: null,
          messageHistory: initialHistory,
        })
        .where(eq(conversationSessions.leadPhone, normalizedPhone));
    } else {
      await db.insert(conversationSessions).values({
        leadPhone: normalizedPhone,
        leadName: input.name,
        stage: "AVAILABILITY",
        quotedPrice: price,
        serviceType: input.serviceType,
        bedrooms: input.bedrooms,
        bathrooms: input.bathrooms,
        messageHistory: initialHistory,
      });
    }
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
    const from = new Date(dateFrom);
    from.setHours(0, 0, 0, 0);
    conditions.push(gte(conversationSessions.createdAt, from));
  }
  if (dateTo) {
    const to = new Date(dateTo);
    to.setHours(23, 59, 59, 999);
    conditions.push(lte(conversationSessions.createdAt, to));
  }
  return conditions.length > 0 ? and(...conditions) : undefined;
}
