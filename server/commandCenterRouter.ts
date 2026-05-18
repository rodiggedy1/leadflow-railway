/**
 * commandCenterRouter — AI Command Center backend procedures.
 *
 * Provides all data for the /admin/command-center page:
 *   - getDashboardStats: KPI cards (leads, booked, revenue, response rate, conversion, pipeline)
 *   - getFunnelBreakdown: stage-by-stage funnel with drop-off rates and avg time
 *   - getHotLeads: ranked by intent score with next-best-action
 *   - getLeadSourceIntelligence: per-source CPL, booked, revenue, ROAS, AI note
 *   - getSpeedToLead: response time metrics
 *   - getAiInsights: LLM-generated Today Pulse + AI Action Feed
 *   - executeAction: one-click actions (send SMS, trigger call, reactivate)
 */

import { z } from "zod";
import { adminAgentProcedure, router } from "./_core/trpc";
import { getDb } from "./db";
import {
  conversationSessions,
  activityLog,
  leadCallLogs,
  aiInsightsCache,
  commandCenterCache,
  reactivationContacts,
  completedJobs,
  campaignBlasts,
  smsOptOuts,
} from "../drizzle/schema";
import { and, desc, eq, gte, lte, ne, notInArray, sql, isNotNull, or, isNull } from "drizzle-orm";
const NON_LEAD_SOURCES = [
  "cs_initiated",
  "cs-inbound",
  "cs-inbound-cleaner",
  "hiring_interview",
  "review",
  "review_rebooking",
];

import { invokeLLM } from "./_core/llm";
import { sendSms } from "./openphone";
import { normalizePhone } from "./routers";
import { notifyNewLeadViaCall } from "./vapiLeadNotification";
import { getCompletedBookingsForDate } from "./launch27";
// ─── Helpers ───────────────────────────────────────────────────────────────────

function calcRevenue(row: {
  bookedAmount?: number | null;
  quotedPrice?: string | null;
  extras?: string | null;
  reactivationLastPrice?: number | null;
  reactivationDiscountPct?: number | null;
}): number {
  if (row.bookedAmount != null) return Number(row.bookedAmount);
  if (row.quotedPrice != null && row.quotedPrice !== "") {
    const base = parseFloat(row.quotedPrice);
    let extrasTotal = 0;
    try {
      const keys: string[] = JSON.parse(row.extras ?? "[]");
      // Simple extras estimate: $30 per extra item
      extrasTotal = keys.length * 30;
    } catch { /* ignore */ }
    return (isNaN(base) ? 0 : base) + extrasTotal;
  }
  if (row.reactivationLastPrice != null) {
    const discountPct = row.reactivationDiscountPct ?? 10;
    return Math.round(row.reactivationLastPrice * (1 - discountPct / 100));
  }
  return 0;
}

function getWindowStart(range: "today" | "7d" | "30d"): Date {
  const now = new Date();
  if (range === "today") {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    return d;
  }
  if (range === "7d") {
    const d = new Date(now);
    d.setDate(d.getDate() - 7);
    return d;
  }
  // 30d
  const d = new Date(now);
  d.setDate(d.getDate() - 30);
  return d;
}

/** Compute an intent score (0–100) for a lead based on stage, recency, and conversation data */
function computeIntentScore(session: {
  stage: string;
  createdAt: Date | string;
  updatedAt: Date | string;
  isBooked: number;
  nudgeCount: number;
  serviceType?: string | null;
  address?: string | null;
  selectedSlot?: string | null;
  quotedPrice?: string | null;
}): number {
  let score = 50;

  // Stage signals
  const stageBonus: Record<string, number> = {
    CALL_SCHEDULED: 40,
    CONFIRMATION: 35,
    ADDRESS: 30,
    SLOT_CHOICE: 25,
    TIME_PREF: 20,
    AVAILABILITY: 15,
    QUOTE_SENT: 10,
    WIDGET_SIZING: 5,
    UNHANDLED: -10,
    COLD: -30,
    NOT_INTERESTED: -40,
  };
  score += stageBonus[session.stage] ?? 0;

  // Recency: penalize leads older than 24h
  const updatedAt = session.updatedAt instanceof Date ? session.updatedAt : new Date(session.updatedAt as string);
  const hoursAgo = (Date.now() - updatedAt.getTime()) / (1000 * 60 * 60);
  if (hoursAgo < 1) score += 15;
  else if (hoursAgo < 4) score += 8;
  else if (hoursAgo > 24) score -= 10;
  else if (hoursAgo > 48) score -= 20;

  // Has address = very high intent
  if (session.address) score += 10;
  // Has slot = high intent
  if (session.selectedSlot) score += 5;
  // High-value service
  if (session.serviceType?.toLowerCase().includes("deep")) score += 5;
  if (session.serviceType?.toLowerCase().includes("move")) score += 8;

  // Nudge count penalty
  score -= session.nudgeCount * 5;

  return Math.max(0, Math.min(100, score));
}

/** Determine next best action for a lead based on their stage */
function getNextBestAction(stage: string): string {
  const actions: Record<string, string> = {
    CALL_SCHEDULED: "Call now — they're expecting it",
    CONFIRMATION: "Call to confirm booking details",
    ADDRESS: "Send booking confirmation SMS",
    SLOT_CHOICE: "Follow up on chosen time slot",
    TIME_PREF: "Confirm time preference and get address",
    AVAILABILITY: "Follow up on availability",
    QUOTE_SENT: "Follow up — no reply yet",
    WIDGET_SIZING: "Send sizing question follow-up",
    UNHANDLED: "Review conversation and respond manually",
    COLD: "Send reactivation SMS",
    NOT_INTERESTED: "Archive or send win-back offer",
    FUTURE_BOOKING: "Schedule a reminder for their target date",
    FOLLOW_UP_SCHEDULED: "Check scheduled follow-up date",
  };
  return actions[stage] ?? "Review and follow up";
}

/** Source display name mapping */
function sourceLabel(src: string): string {
  const map: Record<string, string> = {
    form: "Quote Form",
    widget: "Website Widget",
    reactivation: "Reactivation",
    bark: "Bark.com",
    voice: "Phone / Voice",
    email: "Email Lead",
  };
  return map[src] ?? src;
}

// ─── Router ───────────────────────────────────────────────────────────────────

export const commandCenterRouter = router({
  /**
   * KPI stat cards for the top row.
   * Returns current-period stats + comparison to previous period.
   */
  getDashboardStats: adminAgentProcedure
    .input(z.object({ range: z.enum(["today", "7d", "30d"]).default("today") }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("DB unavailable");

      const since = getWindowStart(input.range);
      // Previous period window (same length, immediately before)
      const periodMs = Date.now() - since.getTime();
      const prevSince = new Date(since.getTime() - periodMs);
      const prevUntil = since;

      // Current period: all non-review sessions
      const sessions = await db
        .select({
          id: conversationSessions.id,
          stage: conversationSessions.stage,
          isBooked: conversationSessions.isBooked,
          quotedPrice: conversationSessions.quotedPrice,
          extras: conversationSessions.extras,
          bookedAmount: conversationSessions.bookedAmount,
          reactivationLastPrice: conversationSessions.reactivationLastPrice,
          reactivationDiscountPct: conversationSessions.reactivationDiscountPct,
          createdAt: conversationSessions.createdAt,
          leadSource: conversationSessions.leadSource,
          lastAiMessageAt: conversationSessions.lastAiMessageAt,
        })
        .from(conversationSessions)
        .where(
          and(
            gte(conversationSessions.createdAt, since),
            notInArray(conversationSessions.leadSource, NON_LEAD_SOURCES)
          )
        );

      // Previous period
      const prevSessions = await db
        .select({ id: conversationSessions.id, stage: conversationSessions.stage, isBooked: conversationSessions.isBooked })
        .from(conversationSessions)
        .where(
          and(
            gte(conversationSessions.createdAt, prevSince),
            lte(conversationSessions.createdAt, prevUntil),
            notInArray(conversationSessions.leadSource, NON_LEAD_SOURCES)
          )
        );

      const totalLeads = sessions.length;
      const prevLeads = prevSessions.length;

      const bookedSessions = sessions.filter(s => s.stage === "BOOKED" || s.isBooked === 1);
      const prevBooked = prevSessions.filter(s => s.stage === "BOOKED" || s.isBooked === 1).length;

      const bookedRevenue = bookedSessions.reduce((sum, s) => sum + calcRevenue(s), 0);

      // Pipeline value: sum of estimated revenue for all active (non-booked, non-lost, non-cold) sessions
      // This mirrors the Pipeline page — total value of leads still in play
      const PIPELINE_EXCLUDE = new Set(["BOOKED", "NOT_INTERESTED", "COLD", "DONE", "REVIEW_REQUESTED", "REVIEW_DONE", "QUALITY_RATING_DONE"]);
      const pipelineSessions = sessions.filter(s =>
        !PIPELINE_EXCLUDE.has(s.stage) && s.isBooked !== 1
      );
      const pipelineValue = Math.round(pipelineSessions.reduce((sum, s) => sum + calcRevenue(s), 0));

      // Response rate: sessions that got past QUOTE_SENT stage
      const respondedStages = ["AVAILABILITY", "SLOT_CHOICE", "TIME_PREF", "ADDRESS", "CONFIRMATION", "CALL_SCHEDULED", "DONE", "BOOKED"];
      const responded = sessions.filter(s => respondedStages.includes(s.stage)).length;
      const responseRate = totalLeads > 0 ? Math.round((responded / totalLeads) * 100) : 0;

      // Lead → Booking conversion
      const conversionRate = totalLeads > 0 ? parseFloat(((bookedSessions.length / totalLeads) * 100).toFixed(1)) : 0;
      const prevConversionRate = prevLeads > 0 ? parseFloat(((prevBooked / prevLeads) * 100).toFixed(1)) : 0;

      // Speed to first contact: only sessions where lastAiMessageAt is within 10 min of createdAt
      // (lastAiMessageAt is updated on every outbound SMS including cron nudges, so cap at 10 min)
      const speedSessions = sessions.filter(s => {
        if (!s.lastAiMessageAt) return false;
        const created = s.createdAt instanceof Date ? s.createdAt.getTime() : new Date(s.createdAt as string).getTime();
        const replied = s.lastAiMessageAt instanceof Date ? s.lastAiMessageAt.getTime() : new Date(s.lastAiMessageAt as unknown as string).getTime();
        const diffMin = (replied - created) / 60000;
        return diffMin >= 0 && diffMin <= 10;
      });
      const avgResponseMinutes = speedSessions.length > 0
        ? parseFloat(
            (speedSessions.reduce((sum, s) => {
              const created = s.createdAt instanceof Date ? s.createdAt.getTime() : new Date(s.createdAt as string).getTime();
              const replied = s.lastAiMessageAt instanceof Date ? s.lastAiMessageAt.getTime() : new Date(s.lastAiMessageAt as unknown as string).getTime();
              return sum + Math.max(0, (replied - created) / 60000);
            }, 0) / speedSessions.length).toFixed(1)
          )
        : 0;

      return {
        totalLeads,
        prevLeads,
        leadsChange: prevLeads > 0 ? Math.round(((totalLeads - prevLeads) / prevLeads) * 100) : 0,
        bookedJobs: bookedSessions.length,
        prevBooked,
        bookedChange: prevBooked > 0 ? bookedSessions.length - prevBooked : 0,
        bookedRevenue,
        conversionRate,
        prevConversionRate,
        conversionChange: parseFloat((conversionRate - prevConversionRate).toFixed(1)),
        responseRate,
        pipelineValue,
        avgResponseMinutes,
      };
    }),

  /**
   * Lead funnel breakdown: stage-by-stage counts, drop-off rates, avg time in stage.
   */
  getFunnelBreakdown: adminAgentProcedure
    .input(z.object({ range: z.enum(["today", "7d", "30d"]).default("30d") }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("DB unavailable");

      const since = getWindowStart(input.range);

      const rows = await db
        .select({
          stage: conversationSessions.stage,
          count: sql<number>`count(*)`,
        })
        .from(conversationSessions)
        .where(
          and(
            gte(conversationSessions.createdAt, since),
            notInArray(conversationSessions.leadSource, NON_LEAD_SOURCES)
          )
        )
        .groupBy(conversationSessions.stage);

      const byStage: Record<string, number> = {};
      let total = 0;
      for (const row of rows) {
        byStage[row.stage] = Number(row.count);
        total += Number(row.stage !== "BOOKED" && row.stage !== "NOT_INTERESTED" && row.stage !== "COLD" ? row.count : 0);
      }

      const allTotal = rows.reduce((s, r) => s + Number(r.count), 0);

      // Funnel stages in order
      const funnelStages = [
        { key: "new", label: "New", count: allTotal },
        {
          key: "contacted",
          label: "Contacted",
          count: allTotal - (byStage["QUOTE_SENT"] ?? 0) - (byStage["WIDGET_SIZING"] ?? 0),
        },
        {
          key: "quoted",
          label: "Quoted",
          count: (byStage["AVAILABILITY"] ?? 0) + (byStage["SLOT_CHOICE"] ?? 0) + (byStage["TIME_PREF"] ?? 0) + (byStage["ADDRESS"] ?? 0) + (byStage["CONFIRMATION"] ?? 0) + (byStage["CALL_SCHEDULED"] ?? 0) + (byStage["BOOKED"] ?? 0),
        },
        {
          key: "booked",
          label: "Booked",
          count: byStage["BOOKED"] ?? 0,
        },
        {
          key: "cold",
          label: "Lost / Ghosted",
          count: (byStage["COLD"] ?? 0) + (byStage["NOT_INTERESTED"] ?? 0),
        },
      ];

      // Calculate drop-off rates
      const withDropOff = funnelStages.map((stage, idx) => {
        const pct = allTotal > 0 ? parseFloat(((stage.count / allTotal) * 100).toFixed(1)) : 0;
        const prevCount = idx > 0 ? funnelStages[idx - 1].count : allTotal;
        const dropOff = prevCount > 0 && idx > 0
          ? parseFloat((((prevCount - stage.count) / prevCount) * 100).toFixed(1))
          : 0;
        return { ...stage, pct, dropOff };
      });

      // Biggest drop-off
      const biggestDropOff = withDropOff
        .slice(1)
        .sort((a, b) => b.dropOff - a.dropOff)[0];

      return {
        stages: withDropOff,
        total: allTotal,
        biggestDropOff: biggestDropOff
          ? `${biggestDropOff.label} → ${withDropOff[withDropOff.indexOf(biggestDropOff) + 1]?.label ?? "next"}`
          : null,
      };
    }),

  /**
   * Hot leads queue: top leads ranked by intent score with next-best-action.
   */
  getHotLeads: adminAgentProcedure
    .input(z.object({ limit: z.number().default(3) }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("DB unavailable");

      // Get active leads (not booked, not cold, not lost) from last 7 days
      const since = new Date();
      since.setDate(since.getDate() - 7);

      const sessions = await db
        .select({
          id: conversationSessions.id,
          leadName: conversationSessions.leadName,
          leadPhone: conversationSessions.leadPhone,
          stage: conversationSessions.stage,
          serviceType: conversationSessions.serviceType,
          bedrooms: conversationSessions.bedrooms,
          bathrooms: conversationSessions.bathrooms,
          quotedPrice: conversationSessions.quotedPrice,
          selectedSlot: conversationSessions.selectedSlot,
          address: conversationSessions.address,
          isBooked: conversationSessions.isBooked,
          nudgeCount: conversationSessions.nudgeCount,
          leadSource: conversationSessions.leadSource,
          utmSource: conversationSessions.utmSource,
          createdAt: conversationSessions.createdAt,
          updatedAt: conversationSessions.updatedAt,
          messageHistory: conversationSessions.messageHistory,
          internalNotes: conversationSessions.internalNotes,
          barkQA: conversationSessions.barkQA,
        })
        .from(conversationSessions)
        .where(
          and(
            gte(conversationSessions.createdAt, since),
            ne(conversationSessions.stage, "BOOKED"),
            ne(conversationSessions.stage, "NOT_INTERESTED"),
            ne(conversationSessions.stage, "REVIEW_REQUESTED"),
            ne(conversationSessions.stage, "REVIEW_DONE"),
            ne(conversationSessions.stage, "QUALITY_RATING_DONE"),
            notInArray(conversationSessions.leadSource, NON_LEAD_SOURCES),
          )
        )
        .orderBy(desc(conversationSessions.updatedAt))
        .limit(50);

      // Score and rank
      const scored = sessions.map(s => ({
        id: s.id,
        name: s.leadName ?? "Unknown",
        phone: s.leadPhone,
        stage: s.stage,
        serviceType: s.serviceType ?? "Cleaning",
        bedrooms: s.bedrooms,
        bathrooms: s.bathrooms,
        quotedPrice: s.quotedPrice,
        source: sourceLabel(s.utmSource ?? s.leadSource ?? "form"),
        rawSource: s.utmSource ?? s.leadSource ?? "form",
        nextBestAction: getNextBestAction(s.stage),
        intentScore: computeIntentScore(s),
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
        // Brief context from message history
        context: (() => {
          try {
            const msgs: Array<{ role: string; content: string }> = JSON.parse(s.messageHistory ?? "[]");
            const lastCustomer = [...msgs].reverse().find(m => m.role === "user");
            return lastCustomer?.content?.slice(0, 120) ?? null;
          } catch { return null; }
        })(),
        thumbtackUrl: (() => {
          if (!s.barkQA) return null;
          // Match full URLs (https://...) or bare thmtk.com short links
          const match = s.barkQA.match(/https?:\/\/[^\s]+|thmtk\.com\/[^\s]+/);
          if (!match) return null;
          const url = match[0];
          return url.startsWith('http') ? url : `https://${url}`;
        })(),
      }));

      // Sort by intent score desc
      scored.sort((a, b) => b.intentScore - a.intentScore);

      return scored.slice(0, input.limit);
    }),

  /**
   * Lead source intelligence: per-source breakdown with CPL estimate, booked, revenue, ROAS.
   */
  getLeadSourceIntelligence: adminAgentProcedure
    .input(z.object({ range: z.enum(["today", "7d", "30d"]).default("30d") }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("DB unavailable");

      const since = getWindowStart(input.range);

      const sessions = await db
        .select({
          leadSource: conversationSessions.leadSource,
          utmSource: conversationSessions.utmSource,
          stage: conversationSessions.stage,
          isBooked: conversationSessions.isBooked,
          quotedPrice: conversationSessions.quotedPrice,
          extras: conversationSessions.extras,
          bookedAmount: conversationSessions.bookedAmount,
          reactivationLastPrice: conversationSessions.reactivationLastPrice,
          reactivationDiscountPct: conversationSessions.reactivationDiscountPct,
        })
        .from(conversationSessions)
        .where(
          and(
            gte(conversationSessions.createdAt, since),
            notInArray(conversationSessions.leadSource, NON_LEAD_SOURCES)
          )
        );

      // Group by source
      const sourceMap = new Map<string, { leads: number; booked: number; revenue: number }>();
      for (const s of sessions) {
        const src = s.utmSource ?? s.leadSource ?? "organic";
        const existing = sourceMap.get(src) ?? { leads: 0, booked: 0, revenue: 0 };
        existing.leads++;
        if (s.stage === "BOOKED" || s.isBooked === 1) {
          existing.booked++;
          existing.revenue += calcRevenue(s);
        }
        sourceMap.set(src, existing);
      }

      // CPL estimates (rough — no ad spend data in DB yet)
      const cplEstimates: Record<string, number> = {
        google: 35,
        "google lsa": 31,
        lsa: 31,
        facebook: 24,
        instagram: 24,
        thumbtack: 49,
        bark: 45,
        yelp: 38,
        organic: 0,
        direct: 0,
        form: 0,
        widget: 0,
        reactivation: 0,
      };

      const aiNotes: Record<string, string> = {
        google: "Consistent performer",
        "google lsa": "Best quality today",
        lsa: "Best quality today",
        facebook: "Weak follow-up",
        instagram: "Low volume",
        thumbtack: "Pause likely",
        bark: "High CPL — monitor",
        organic: "High intent",
        direct: "High intent",
        form: "Core channel",
        widget: "High intent",
        reactivation: "Best ROI",
      };

      const rows = Array.from(sourceMap.entries()).map(([src, data]) => {
        const cpl = cplEstimates[src.toLowerCase()] ?? 0;
        const roas = cpl > 0 && data.booked > 0
          ? parseFloat((data.revenue / (cpl * data.leads)).toFixed(1))
          : null;
        return {
          source: src,
          label: sourceLabel(src),
          leads: data.leads,
          cpl,
          booked: data.booked,
          revenue: data.revenue,
          roas,
          aiNote: aiNotes[src.toLowerCase()] ?? "Monitor",
        };
      });

      // Sort by revenue desc
      rows.sort((a, b) => b.revenue - a.revenue);
      return rows;
    }),

  /**
   * Speed to lead metrics.
   */
  getSpeedToLead: adminAgentProcedure
    .input(z.object({ range: z.enum(["today", "7d", "30d"]).default("7d") }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("DB unavailable");

      const since = getWindowStart(input.range);

      const sessions = await db
        .select({
          createdAt: conversationSessions.createdAt,
          lastAiMessageAt: conversationSessions.lastAiMessageAt,
          nudgeCount: conversationSessions.nudgeCount,
          autoFollowUpSent: conversationSessions.autoFollowUpSent,
        })
        .from(conversationSessions)
        .where(
          and(
            gte(conversationSessions.createdAt, since),
            notInArray(conversationSessions.leadSource, NON_LEAD_SOURCES)
          )
        );

      // Only count sessions where lastAiMessageAt is within 10 minutes of createdAt.
      // lastAiMessageAt is updated on EVERY outbound SMS (including cron nudges days later),
      // so filtering to <=10 min isolates the true first-contact speed.
      const withFirstContact = sessions.filter(s => {
        if (!s.lastAiMessageAt) return false;
        const created = s.createdAt instanceof Date ? s.createdAt.getTime() : new Date(s.createdAt as string).getTime();
        const replied = s.lastAiMessageAt instanceof Date ? s.lastAiMessageAt.getTime() : new Date(s.lastAiMessageAt as unknown as string).getTime();
        const diffMin = (replied - created) / 60000;
        return diffMin >= 0 && diffMin <= 10;
      });

      const avgFirstResponseMinutes = withFirstContact.length > 0
        ? parseFloat(
            (withFirstContact.reduce((sum, s) => {
              const created = s.createdAt instanceof Date ? s.createdAt.getTime() : new Date(s.createdAt as string).getTime();
              const replied = s.lastAiMessageAt instanceof Date ? s.lastAiMessageAt.getTime() : new Date(s.lastAiMessageAt as unknown as string).getTime();
              return sum + Math.max(0, (replied - created) / 60000);
            }, 0) / withFirstContact.length).toFixed(1)
          )
        : 0;

      const contactedUnder2Min = withFirstContact.filter(s => {
        const created = s.createdAt instanceof Date ? s.createdAt.getTime() : new Date(s.createdAt as string).getTime();
        const replied = s.lastAiMessageAt instanceof Date ? s.lastAiMessageAt.getTime() : new Date(s.lastAiMessageAt as unknown as string).getTime();
        return (replied - created) / 60000 < 2;
      }).length;

      const contactedUnder2MinPct = sessions.length > 0
        ? Math.round((contactedUnder2Min / sessions.length) * 100)
        : 0;

      return {
        avgFirstResponseMinutes,
        contactedUnder2MinPct,
        totalLeads: sessions.length,
        contactedCount: withFirstContact.length,
      };
    }),

  /**
   * AI-generated insights: Today Pulse cards + AI Action Feed.
   * Calls LLM with real metrics to generate actionable recommendations.
   */
  getAiInsights: adminAgentProcedure
    .input(z.object({ range: z.enum(["today", "7d", "30d"]).default("today") }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("DB unavailable");

      // ── Cache check: serve instantly if cache is <30 min old ──────────────
      const CACHE_TTL_MS = 30 * 60 * 1000;
      const cached = await db
        .select()
        .from(aiInsightsCache)
        .where(eq(aiInsightsCache.rangeKey, input.range))
        .limit(1);

      const cacheHit = cached[0];
      const cacheAge = cacheHit
        ? Date.now() - (cacheHit.generatedAt instanceof Date
            ? cacheHit.generatedAt.getTime()
            : new Date(cacheHit.generatedAt as unknown as string).getTime())
        : Infinity;

      if (cacheHit && cacheAge < CACHE_TTL_MS) {
        try {
          return JSON.parse(cacheHit.payload) as {
            pulse: Array<{ type: string; title: string; body: string; metric: string; action: string; linkStage: string }>;
            actionFeed: Array<{ id: string; title: string; description: string; estimatedValue: string; actionType: string; urgency: string; linkStage: string }>;
          };
        } catch { /* fall through to regenerate */ }
      }

      // Helper to persist result to cache after generation
      const saveToCache = async (result: object) => {
        try {
          const payload = JSON.stringify(result);
          if (cacheHit) {
            await db.update(aiInsightsCache)
              .set({ payload, generatedAt: new Date() })
              .where(eq(aiInsightsCache.rangeKey, input.range));
          } else {
            await db.insert(aiInsightsCache).values({
              rangeKey: input.range,
              payload,
              generatedAt: new Date(),
            });
          }
        } catch (e) {
          console.error("[CommandCenter] Cache save error:", e);
        }
      };

      const since = getWindowStart(input.range);

      // Gather metrics for LLM context
      const sessions = await db
        .select({
          id: conversationSessions.id,
          stage: conversationSessions.stage,
          isBooked: conversationSessions.isBooked,
          quotedPrice: conversationSessions.quotedPrice,
          extras: conversationSessions.extras,
          bookedAmount: conversationSessions.bookedAmount,
          reactivationLastPrice: conversationSessions.reactivationLastPrice,
          reactivationDiscountPct: conversationSessions.reactivationDiscountPct,
          leadSource: conversationSessions.leadSource,
          utmSource: conversationSessions.utmSource,
          createdAt: conversationSessions.createdAt,
          updatedAt: conversationSessions.updatedAt,
          nudgeCount: conversationSessions.nudgeCount,
          lastAiMessageAt: conversationSessions.lastAiMessageAt,
          serviceType: conversationSessions.serviceType,
        })
        .from(conversationSessions)
        .where(
          and(
            gte(conversationSessions.createdAt, since),
            notInArray(conversationSessions.leadSource, NON_LEAD_SOURCES)
          )
        );

      const totalLeads = sessions.length;
      const booked = sessions.filter(s => s.stage === "BOOKED" || s.isBooked === 1);
      const cold = sessions.filter(s => s.stage === "COLD" || s.stage === "NOT_INTERESTED");
      const unhandled = sessions.filter(s => s.stage === "UNHANDLED");
      const callScheduled = sessions.filter(s => s.stage === "CALL_SCHEDULED");
      const quoteSent = sessions.filter(s => s.stage === "QUOTE_SENT");
      const bookedRevenue = booked.reduce((sum, s) => sum + calcRevenue(s), 0);

      // Response time — cap to sessions where first SMS arrived within 10 min of creation
      // (prevents cron nudges from inflating the average)
      const TEN_MIN_MS = 10 * 60 * 1000;
      const withFirstContact = sessions.filter(s => {
        if (!s.lastAiMessageAt) return false;
        const c = s.createdAt instanceof Date ? s.createdAt.getTime() : new Date(s.createdAt as string).getTime();
        const r = s.lastAiMessageAt instanceof Date ? s.lastAiMessageAt.getTime() : new Date(s.lastAiMessageAt as unknown as string).getTime();
        return (r - c) <= TEN_MIN_MS;
      });
      const avgResponseMin = withFirstContact.length > 0
        ? Math.round(withFirstContact.reduce((sum, s) => {
            const c = s.createdAt instanceof Date ? s.createdAt.getTime() : new Date(s.createdAt as string).getTime();
            const r = s.lastAiMessageAt instanceof Date ? s.lastAiMessageAt.getTime() : new Date(s.lastAiMessageAt as unknown as string).getTime();
            return sum + Math.max(0, (r - c) / 60000);
          }, 0) / withFirstContact.length)
        : 0;

      // Source breakdown
      const sourceCount: Record<string, number> = {};
      const sourceBooked: Record<string, number> = {};
      for (const s of sessions) {
        const src = s.utmSource ?? s.leadSource ?? "organic";
        sourceCount[src] = (sourceCount[src] ?? 0) + 1;
        if (s.stage === "BOOKED" || s.isBooked === 1) {
          sourceBooked[src] = (sourceBooked[src] ?? 0) + 1;
        }
      }

      // Service type breakdown
      const serviceCount: Record<string, number> = {};
      for (const s of sessions) {
        if (s.serviceType) serviceCount[s.serviceType] = (serviceCount[s.serviceType] ?? 0) + 1;
      }

      // Reactivation pool (cold leads from last 90 days)
      const ninetyDaysAgo = new Date();
      ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
      const reactivationPool = await db
        .select({ id: conversationSessions.id })
        .from(conversationSessions)
        .where(
          and(
            gte(conversationSessions.createdAt, ninetyDaysAgo),
            or(
              eq(conversationSessions.stage, "COLD" as string),
              eq(conversationSessions.stage, "NOT_INTERESTED" as string)
            )
          )
        );

      // ── Conversation Intelligence: extract lead messages for objection context ──
      const allSessions = await db
        .select({
          messageHistory: conversationSessions.messageHistory,
          stage: conversationSessions.stage,
          isBooked: conversationSessions.isBooked,
        })
        .from(conversationSessions)
        .where(
          and(
            gte(conversationSessions.createdAt, since),
            notInArray(conversationSessions.leadSource, NON_LEAD_SOURCES)
          )
        )
        .limit(200);

      const leadMessages: string[] = [];
      for (const s of allSessions) {
        try {
          const history: Array<{ role: string; content: string }> = JSON.parse(s.messageHistory ?? "[]");
          for (const msg of history) {
            if (msg.role === "user" && msg.content && msg.content.trim().length > 5) {
              leadMessages.push(msg.content.trim());
            }
          }
        } catch { /* skip malformed */ }
      }

      // Quick LLM call to get top objections (lightweight — 50 messages max)
      let topObjections: Array<{ label: string; pct: number; tip: string; example: string }> = [];
      let conversationInsight = "";
      if (leadMessages.length >= 5) {
        try {
          const sample = leadMessages.slice(0, 50);
          const objResponse = await invokeLLM({
            messages: [
              { role: "system", content: "You are a sales coach. Respond only with valid JSON." },
              {
                role: "user",
                content: `Analyze these ${sample.length} SMS replies from cleaning service leads and identify the top 3 objections. Respond with JSON: {"objections":[{"label":string,"pct":number,"tip":string,"example":string}],"topInsight":string}\n\n${sample.map((m, i) => `${i + 1}. "${m}"`).join("\n")}`,
              },
            ],
            response_format: { type: "json_object" } as any,
          });
          const rawObjContent = objResponse?.choices?.[0]?.message?.content ?? "{}";
          const rawObj = typeof rawObjContent === "string" ? rawObjContent : JSON.stringify(rawObjContent);
          const parsedObj = JSON.parse(rawObj);
          topObjections = (parsedObj.objections ?? []).slice(0, 3);
          conversationInsight = parsedObj.topInsight ?? "";
        } catch { /* non-blocking — skip if fails */ }
      }

      const objectionContext = topObjections.length > 0
        ? `\nTOP OBJECTIONS FROM SMS CONVERSATIONS:\n${topObjections.map(o => `- "${o.label}" (~${o.pct}% of leads): ${o.tip} Example: "${o.example}"`).join("\n")}\nOVERALL CONVERSATION INSIGHT: ${conversationInsight}`
        : "";

      const metricsContext = `
BUSINESS: Maids in Black — home cleaning service, Washington DC Metro Area.
PERIOD: ${input.range === "today" ? "Today" : input.range === "7d" ? "Last 7 days" : "Last 30 days"}

KEY METRICS:
- Total new leads: ${totalLeads}
- Booked jobs: ${booked.length} (${totalLeads > 0 ? Math.round((booked.length / totalLeads) * 100) : 0}% conversion)
- Revenue booked: $${bookedRevenue.toLocaleString()}
- Avg first response time: ${avgResponseMin} minutes
- Leads with no reply (COLD): ${cold.length}
- Unhandled/needs review: ${unhandled.length}
- Call scheduled (hot): ${callScheduled.length}
- Quote sent, no reply yet: ${quoteSent.length}
- Reactivation pool (last 90 days cold): ${reactivationPool.length} leads

LEAD SOURCES: ${JSON.stringify(sourceCount)}
BOOKED BY SOURCE: ${JSON.stringify(sourceBooked)}
SERVICE TYPES: ${JSON.stringify(serviceCount)}${objectionContext}
`.trim();

      try {
        const response = await invokeLLM({
          messages: [
            {
              role: "system",
              content: `You are an AI business analyst specializing in residential home cleaning companies.
You have deep knowledge of home cleaning industry benchmarks. Use these benchmarks to evaluate performance — do NOT use generic sales or e-commerce benchmarks.

HOME CLEANING INDUSTRY BENCHMARKS:
- Lead-to-booking conversion rate: 15–25% is average, 30–40% is good, 40%+ is excellent
- Speed to first contact: under 5 minutes is excellent, 5–15 min is good, 15–60 min is acceptable, 60+ min is a problem
- Average job value: $150–$250 for standard cleaning, $300–$500 for deep/move-out
- Repeat booking rate: 40–60% of first-time customers rebook within 90 days
- Lead reactivation success rate: 10–20% of cold leads convert with a well-timed follow-up
- Google LSA ROAS: 3–5x is typical, 6x+ is excellent
- Facebook/paid ads ROAS: 2–3x is typical, 4x+ is good
- Cost per lead (CPL): $20–$50 is typical for paid channels, $0 for organic/referral
- Response time impact: leads contacted within 5 min convert 3.7x better than those contacted after 1 hour
- Quote follow-up: 60% of quoted leads who don't reply within 24h will never book without a follow-up

When a metric is above benchmark, celebrate it and suggest how to push it further.
When a metric is below benchmark, flag it as an alert with specific improvement actions.
Never call a 30%+ conversion rate low — that is above industry average.

Analyze the metrics and return a JSON object with exactly this structure:
{
  "pulse": [
    {
      "type": "alert" | "opportunity" | "revenue",
      "title": "short title (5 words max)",
      "body": "2-3 sentence insight with specific numbers and benchmark context",
      "metric": "key metric or dollar amount",
      "action": "specific suggested action (1 sentence)"
    }
  ],
  "actionFeed": [
    {
      "id": "unique_id",
      "title": "action title (4-6 words)",
      "description": "why this matters (1 sentence with numbers and benchmark context)",
      "estimatedValue": "+$X est." or "+N bookings est." or "+$X/week",
      "actionType": "send_sms" | "trigger_call" | "review_leads" | "reactivate",
      "urgency": "high" | "medium" | "low"
    }
  ]
}
Rules:
- pulse: exactly 3 cards (one alert, one opportunity, one revenue/hidden-revenue insight)
- actionFeed: 4-6 items, sorted by urgency then estimated value
- Be specific with numbers from the metrics provided
- Always compare to the industry benchmarks above — mention when performance is above or below benchmark
- Keep titles short and punchy
- estimatedValue must be a string like "+$1,260 est." or "+4 bookings est."
- actionType must be one of the four values listed
- linkStage: for pulse cards and action items, set to the most relevant pipeline stage to filter by when the user wants to see the leads (e.g. "COLD", "QUOTE_SENT", "UNHANDLED", "CALL_SCHEDULED", "all"). Use "all" if no specific stage applies.

If TOP OBJECTIONS are provided in the metrics:
- Reference the top objection in at least one pulse card or action feed item
- For the action item addressing the top objection, include a specific 1-sentence rebuttal script the team can use in the description (e.g. "Reply: 'We offer a satisfaction guarantee — if it's not perfect, we come back free.'")
- If multiple objections are present, suggest a different rebuttal script for each in the action feed`,
            },
            {
              role: "user",
              content: metricsContext,
            },
          ],
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "ai_insights",
              strict: true,
              schema: {
                type: "object",
                properties: {
                  pulse: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        type: { type: "string" },
                        title: { type: "string" },
                        body: { type: "string" },
                        metric: { type: "string" },
                        action: { type: "string" },
                        linkStage: { type: "string" },
                      },
                        required: ["type", "title", "body", "metric", "action", "linkStage"],
                      additionalProperties: false,
                    },
                  },
                  actionFeed: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        id: { type: "string" },
                        title: { type: "string" },
                        description: { type: "string" },
                        estimatedValue: { type: "string" },
                        actionType: { type: "string" },
                        urgency: { type: "string" },
                        linkStage: { type: "string" },
                      },
                        required: ["id", "title", "description", "estimatedValue", "actionType", "urgency", "linkStage"],
                      additionalProperties: false,
                    },
                  },
                },
                required: ["pulse", "actionFeed"],
                additionalProperties: false,
              },
            },
          },
        });

        const rawContent = response.choices?.[0]?.message?.content;
        const content = typeof rawContent === 'string' ? rawContent : null;
        if (!content) throw new Error("No LLM response");
        const parsed = JSON.parse(content);
        // Save to cache in background (don't await — don't block response)
        void saveToCache(parsed);
        return parsed as {
          pulse: Array<{ type: string; title: string; body: string; metric: string; action: string; linkStage: string }>;
          actionFeed: Array<{ id: string; title: string; description: string; estimatedValue: string; actionType: string; urgency: string; linkStage: string }>;
        };
      } catch (err) {
        // Fallback static insights if LLM fails
        console.error("[CommandCenter] AI insights error:", err);
        const fallback = {
          pulse: [
            { type: "alert", title: "Response time check", body: `Average first reply is ${avgResponseMin} minutes. Leads replying within 5 minutes convert 3.7x better.`, metric: `${avgResponseMin} min avg`, action: "Review unhandled leads and ensure AI is responding", linkStage: "UNHANDLED" },
            { type: "opportunity", title: "Reactivation pool ready", body: `${reactivationPool.length} cold leads from the last 90 days match your service area. A targeted SMS could recover several bookings.`, metric: `${reactivationPool.length} leads`, action: "Launch a reactivation campaign", linkStage: "COLD" },
            { type: "revenue", title: "Pipeline value", body: `${quoteSent.length} leads have received a quote but haven't replied yet. A follow-up SMS now could convert several.`, metric: `${quoteSent.length} open quotes`, action: "Send follow-up SMS to all open quotes", linkStage: "QUOTE_SENT" },
          ],
          actionFeed: [
            { id: "call_hot", title: `Call ${callScheduled.length} hot leads`, description: `${callScheduled.length} leads are in CALL_SCHEDULED stage and expecting your call.`, estimatedValue: `+${callScheduled.length * 180} est.`, actionType: "trigger_call", urgency: "high", linkStage: "CALL_SCHEDULED" },
            { id: "followup_cold", title: "Send follow-up to cold leads", description: `${cold.length} leads went cold without booking. A reactivation SMS could recover some.`, estimatedValue: "+2 bookings est.", actionType: "send_sms", urgency: "medium", linkStage: "COLD" },
            { id: "review_unhandled", title: "Review unhandled conversations", description: `${unhandled.length} conversations need manual review — AI couldn't parse the reply.`, estimatedValue: "+1 booking est.", actionType: "review_leads", urgency: unhandled.length > 0 ? "high" : "low", linkStage: "UNHANDLED" },
            { id: "reactivate_pool", title: "Reactivate old leads", description: `${reactivationPool.length} cold leads from last 90 days haven't been re-engaged.`, estimatedValue: "+3 bookings est.", actionType: "reactivate", urgency: "medium", linkStage: "COLD" },
          ],
        };
        void saveToCache(fallback);
        return fallback;
      }
    }),

  /**
   * Execute a one-click action on a specific lead.
   */
  executeLeadAction: adminAgentProcedure
    .input(z.object({
      sessionId: z.number(),
      actionType: z.enum(["send_sms", "trigger_call", "send_reactivation_sms"]),
      customMessage: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("DB unavailable");

      const session = await db
        .select({
          id: conversationSessions.id,
          leadName: conversationSessions.leadName,
          leadPhone: conversationSessions.leadPhone,
          stage: conversationSessions.stage,
          quotedPrice: conversationSessions.quotedPrice,
          serviceType: conversationSessions.serviceType,
          bedrooms: conversationSessions.bedrooms,
          bathrooms: conversationSessions.bathrooms,
        })
        .from(conversationSessions)
        .where(eq(conversationSessions.id, input.sessionId))
        .limit(1);

      if (!session[0]) throw new Error("Session not found");
      const s = session[0];
      const firstName = (s.leadName ?? "there").split(" ")[0];

      if (input.actionType === "send_sms" || input.actionType === "send_reactivation_sms") {
        const message = input.customMessage
          ?? (input.actionType === "send_reactivation_sms"
            ? `Hi ${firstName}! This is Jade from Maids in Black. We still have a few openings this week — would you like to lock in a time for your cleaning? 🧹`
            : `Hi ${firstName}! Just checking in — are you still interested in scheduling your cleaning? We have openings this week!`);

        const result = await sendSms({ to: s.leadPhone, content: message });
        return { success: result.success ?? true, message: "SMS sent" };
      }

      if (input.actionType === "trigger_call") {
        const called = await notifyNewLeadViaCall({ name: firstName });
        return { success: called, message: called ? "Call initiated" : "Call skipped (outside hours or disabled)" };
      }

      return { success: false, message: "Unknown action" };
    }),

  /**
   * Preview the SMS that would be sent for a given lead.
   * Returns the default message text so the agent can review/edit before sending.
   */
  getLeadSmsPreview: adminAgentProcedure
    .input(z.object({ sessionId: z.number() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("DB unavailable");
      const session = await db
        .select({
          id: conversationSessions.id,
          leadName: conversationSessions.leadName,
          stage: conversationSessions.stage,
          aiClosingRecCache: conversationSessions.aiClosingRecCache,
        })
        .from(conversationSessions)
        .where(eq(conversationSessions.id, input.sessionId))
        .limit(1);
      if (!session[0]) throw new Error("Session not found");
      const s = session[0];
      const firstName = (s.leadName ?? "there").split(" ")[0];
      // Use the AI-generated suggestedMessage if available
      let suggestedMessage: string | null = null;
      if (s.aiClosingRecCache) {
        try {
          const cached = JSON.parse(s.aiClosingRecCache) as { suggestedMessage?: string };
          suggestedMessage = cached.suggestedMessage ?? null;
        } catch { /* ignore */ }
      }
      // Fall back to stage-based default
      const defaultMessage = suggestedMessage
        ?? `Hi ${firstName}! Just checking in — are you still interested in scheduling your cleaning? We have openings this week!`;
      return { message: defaultMessage, firstName };
    }),

  /**
   * Bulk action: send follow-up SMS to all leads in a given stage.
   */
  executeBulkAction: adminAgentProcedure
    .input(z.object({
      actionType: z.enum(["followup_cold", "followup_quote_sent", "reactivate_pool"]),
      customMessage: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("DB unavailable");

      let targetStages: string[] = [];
      let defaultMessage = "";
      let since = new Date();

      if (input.actionType === "followup_cold") {
        targetStages = ["COLD"];
        since.setDate(since.getDate() - 30);
        defaultMessage = "Hi {firstName}! Jade here from Maids in Black 😊 We still have openings this week — want to lock in a time for your cleaning?";
      } else if (input.actionType === "followup_quote_sent") {
        targetStages = ["QUOTE_SENT"];
        since.setDate(since.getDate() - 7);
        defaultMessage = "Hi {firstName}! Just following up on your cleaning quote — we have a few spots left this week. Want to grab one?";
      } else if (input.actionType === "reactivate_pool") {
        targetStages = ["COLD", "NOT_INTERESTED"];
        since.setDate(since.getDate() - 90);
        defaultMessage = "Hi {firstName}! It's been a while — Maids in Black here. We have a special opening this week. Interested in getting your home cleaned? 🧹";
      }

      const sessions = await db
        .select({
          id: conversationSessions.id,
          leadName: conversationSessions.leadName,
          leadPhone: conversationSessions.leadPhone,
          smsOptOut: conversationSessions.smsOptOut,
        })
        .from(conversationSessions)
        .where(
          and(
            gte(conversationSessions.createdAt, since),
            sql`${conversationSessions.stage} IN (${sql.join(targetStages.map((s: string) => sql`${s}`), sql`, `)})`,
            eq(conversationSessions.smsOptOut, 0),
          )
        )
        .limit(50); // Safety cap

      let sent = 0;
      let failed = 0;
      for (const s of sessions) {
        const firstName = (s.leadName ?? "there").split(" ")[0];
        const msg = (input.customMessage ?? defaultMessage).replace("{firstName}", firstName);
        try {
          await sendSms({ to: s.leadPhone, content: msg });
          sent++;
        } catch {
          failed++;
        }
      }

      return { success: true, sent, failed, total: sessions.length };
    }),

  /**
   * Preview a bulk action before firing: returns recipient count, first-name list, and SMS template.
   * Used by the confirmation dialog so the user can see exactly who will be messaged.
   */
  getBulkActionPreview: adminAgentProcedure
    .input(z.object({
      actionType: z.enum(["followup_cold", "followup_quote_sent", "reactivate_pool"]),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("DB unavailable");

      let targetStages: string[] = [];
      let smsTemplate = "";
      let since = new Date();
      let label = "";

      if (input.actionType === "followup_cold") {
        targetStages = ["COLD"];
        since.setDate(since.getDate() - 30);
        smsTemplate = "Hi {firstName}! Jade here from Maids in Black 😊 We still have openings this week — want to lock in a time for your cleaning?";
        label = "cold leads";
      } else if (input.actionType === "followup_quote_sent") {
        targetStages = ["QUOTE_SENT"];
        since.setDate(since.getDate() - 7);
        smsTemplate = "Hi {firstName}! Just following up on your cleaning quote — we have a few spots left this week. Want to grab one?";
        label = "open quotes";
      } else if (input.actionType === "reactivate_pool") {
        targetStages = ["COLD", "NOT_INTERESTED"];
        since.setDate(since.getDate() - 90);
        smsTemplate = "Hi {firstName}! It's been a while — Maids in Black here. We have a special opening this week. Interested in getting your home cleaned? 🧹";
        label = "lapsed leads";
      }

      const sessions = await db
        .select({
          id: conversationSessions.id,
          leadName: conversationSessions.leadName,
          leadPhone: conversationSessions.leadPhone,
        })
        .from(conversationSessions)
        .where(
          and(
            gte(conversationSessions.createdAt, since),
            sql`${conversationSessions.stage} IN (${sql.join(targetStages.map((s: string) => sql`${s}`), sql`, `)})`,
            eq(conversationSessions.smsOptOut, 0),
          )
        )
        .limit(50);

      const firstNames = sessions.map(s => (s.leadName ?? "there").split(" ")[0]);
      // Build a sample SMS using the first recipient's name (or "[Name]" as placeholder)
      const sampleName = firstNames[0] ?? "[Name]";
      const smsPreview = smsTemplate.replace("{firstName}", sampleName);

      return {
        recipientCount: sessions.length,
        label,
        smsTemplate,
        smsPreview,
        firstNames: firstNames.slice(0, 5), // Show up to 5 names as a sample
      };
    }),

  /**
   * Conversation Intelligence: LLM-analyzed objections from SMS message history.
   * Reads recent inbound lead messages and identifies top stall reasons with coaching tips.
   */
  getConversationIntelligence: adminAgentProcedure
    .input(z.object({ range: z.enum(["today", "7d", "30d"]).default("30d") }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("DB unavailable");

      // ── Cache check: serve instantly if cache is <5 min old ──────────────
      const CONV_CACHE_TTL_MS = 5 * 60 * 1000;
      const convCached = await db
        .select()
        .from(commandCenterCache)
        .where(and(eq(commandCenterCache.cacheKey, "conv_intel"), eq(commandCenterCache.rangeKey, input.range)))
        .limit(1);
      const convCacheHit = convCached[0];
      const convCacheAge = convCacheHit
        ? Date.now() - (convCacheHit.generatedAt instanceof Date ? convCacheHit.generatedAt.getTime() : new Date(convCacheHit.generatedAt as unknown as string).getTime())
        : Infinity;
      if (convCacheHit && convCacheAge < CONV_CACHE_TTL_MS) {
        try { return JSON.parse(convCacheHit.payload); } catch { /* fall through */ }
      }

      const since = getWindowStart(input.range);

      // Pull message histories from recent sessions
      const sessions = await db
        .select({
          id: conversationSessions.id,
          stage: conversationSessions.stage,
          messageHistory: conversationSessions.messageHistory,
          isBooked: conversationSessions.isBooked,
          serviceType: conversationSessions.serviceType,
        })
        .from(conversationSessions)
        .where(
          and(
            gte(conversationSessions.createdAt, since),
            notInArray(conversationSessions.leadSource, NON_LEAD_SOURCES)
          )
        )
        .limit(200);

      // Extract inbound (lead) messages from message histories
      const leadMessages: string[] = [];
      for (const s of sessions) {
        try {
          const history: Array<{ role: string; content: string }> = JSON.parse(s.messageHistory ?? "[]");
          for (const msg of history) {
            if (msg.role === "user" && msg.content && msg.content.trim().length > 5) {
              leadMessages.push(msg.content.trim());
            }
          }
        } catch { /* skip malformed */ }
      }

      if (leadMessages.length === 0) {
        const emptyResult = {
          objections: [],
          topInsight: "Not enough conversation data yet. Check back after more leads have replied.",
          totalMessagesAnalyzed: 0,
        };
        // Cache the empty result for 5 min to avoid repeated DB scans
        void (async () => {
          try {
            const payload = JSON.stringify(emptyResult);
            if (convCacheHit) {
              await db.update(commandCenterCache).set({ payload, generatedAt: new Date() })
                .where(and(eq(commandCenterCache.cacheKey, "conv_intel"), eq(commandCenterCache.rangeKey, input.range)));
            } else {
              await db.insert(commandCenterCache).values({ cacheKey: "conv_intel", rangeKey: input.range, payload, generatedAt: new Date() });
            }
          } catch { /* non-fatal */ }
        })();
        return emptyResult;
      }

      // Sample up to 150 messages to keep LLM context manageable
      const sample = leadMessages.slice(0, 150);
      const totalLeads = sessions.length;
      const bookedCount = sessions.filter(s => s.isBooked === 1 || s.stage === "BOOKED").length;

      const prompt = `You are a sales coach analyzing SMS conversations for Maids in Black, a cleaning service in Washington DC.

Here are ${sample.length} inbound messages from leads (replies to our quote SMS):

${sample.map((m, i) => `${i + 1}. "${m}"`).join("\n")}

Context: ${totalLeads} leads total, ${bookedCount} booked (${totalLeads > 0 ? Math.round((bookedCount / totalLeads) * 100) : 0}% conversion).

Analyze these messages and identify the top 5 objections or stall reasons that are preventing bookings. For each, provide:
1. A short label (2-4 words, e.g. "Too expensive")
2. An estimated percentage of leads affected (rough estimate)
3. A 1-sentence coaching tip for the sales team on how to handle it
4. A representative example quote from the messages (exact or paraphrased)

Also provide one overall insight about what's most impacting conversion.

Respond in JSON with this exact schema:
{
  "objections": [
    {
      "label": string,
      "pct": number,
      "tip": string,
      "example": string
    }
  ],
  "topInsight": string
}`;

      try {
        const response = await invokeLLM({
          messages: [
            { role: "system", content: "You are a sales coach. Respond only with valid JSON." },
            { role: "user", content: prompt },
          ],
          response_format: { type: "json_object" } as any,
        });

        const rawContent = response?.choices?.[0]?.message?.content ?? "{}";
        const raw = typeof rawContent === "string" ? rawContent : JSON.stringify(rawContent);
        const parsed = JSON.parse(raw);
        const result = {
          objections: (parsed.objections ?? []).slice(0, 5) as Array<{
            label: string;
            pct: number;
            tip: string;
            example: string;
          }>,
          topInsight: parsed.topInsight ?? "",
          totalMessagesAnalyzed: sample.length,
        };
        // Save to cache in background
        void (async () => {
          try {
            const payload = JSON.stringify(result);
            if (convCacheHit) {
              await db.update(commandCenterCache).set({ payload, generatedAt: new Date() })
                .where(and(eq(commandCenterCache.cacheKey, "conv_intel"), eq(commandCenterCache.rangeKey, input.range)));
            } else {
              await db.insert(commandCenterCache).values({ cacheKey: "conv_intel", rangeKey: input.range, payload, generatedAt: new Date() });
            }
          } catch { /* non-fatal */ }
        })();
        return result;
      } catch (err) {
        console.error("[getConversationIntelligence] LLM error:", err);
        return {
          objections: [],
          topInsight: "Analysis temporarily unavailable.",
          totalMessagesAnalyzed: sample.length,
        };
      }
    }),

  /**
   * getTomorrowCampaigns — checks tomorrow's Launch27 schedule and proposes
   * ready-to-fire SMS campaigns for open slots and reactivation opportunities.
   */
  getTomorrowCampaigns: adminAgentProcedure
    .query(async () => {
      const db = await getDb();
      if (!db) throw new Error("DB unavailable");

      // ── Cache check: serve instantly if cache is <15 min old ──────────────
      const CAMP_CACHE_TTL_MS = 15 * 60 * 1000;
      const campCached = await db
        .select()
        .from(commandCenterCache)
        .where(and(eq(commandCenterCache.cacheKey, "tomorrow_campaigns"), eq(commandCenterCache.rangeKey, "none")))
        .limit(1);
      const campCacheHit = campCached[0];
      const campCacheAge = campCacheHit
        ? Date.now() - (campCacheHit.generatedAt instanceof Date ? campCacheHit.generatedAt.getTime() : new Date(campCacheHit.generatedAt as unknown as string).getTime())
        : Infinity;
      if (campCacheHit && campCacheAge < CAMP_CACHE_TTL_MS) {
        try {
          const cached = JSON.parse(campCacheHit.payload);
          // Always inject saved scripts even on cache hit (scripts are not cached)
          const savedRows = await db
            .select()
            .from(commandCenterCache)
            .where(
              and(
                sql`${commandCenterCache.cacheKey} LIKE 'campaign_script:%'`,
                eq(commandCenterCache.rangeKey, "none")
              )
            );
          const scriptMap = new Map<string, string>();
          for (const row of savedRows) {
            try {
              const p = JSON.parse(row.payload) as { script?: string };
              if (p.script) scriptMap.set(row.cacheKey.replace("campaign_script:", ""), p.script);
            } catch { /* ignore */ }
          }
          if (scriptMap.size > 0 && Array.isArray(cached.campaigns)) {
            cached.campaigns = cached.campaigns.map((c: { id: string; script: string }) => ({
              ...c,
              script: scriptMap.get(c.id) ?? c.script,
              hasCustomScript: scriptMap.has(c.id),
            }));
          }
          return cached;
        } catch { /* fall through */ }
      }

      // Get tomorrow's date string in Eastern time (business timezone).
      // Using toISOString() would give UTC and could be a day ahead after 8 PM ET.
      const EASTERN_TZ = "America/New_York";
      const nowET = new Date(new Date().toLocaleString("en-US", { timeZone: EASTERN_TZ }));
      const tomorrowET = new Date(nowET);
      tomorrowET.setDate(tomorrowET.getDate() + 1);
      // Build YYYY-MM-DD from local Eastern parts to avoid UTC offset shift
      const tomorrowStr = [
        tomorrowET.getFullYear(),
        String(tomorrowET.getMonth() + 1).padStart(2, "0"),
        String(tomorrowET.getDate()).padStart(2, "0"),
      ].join("-");
      const tomorrowLabel = tomorrowET.toLocaleDateString("en-US", { timeZone: EASTERN_TZ, weekday: "long", month: "short", day: "numeric" });

      // Fetch tomorrow's bookings from Launch27
      let bookedSlots = 0;
      let totalSlots = 0;
      let openSlots = 0;
      let scheduleNote = "";
      try {
        const result = await getCompletedBookingsForDate(tomorrowStr, { includeAll: true });
        bookedSlots = result.bookings.length;
        // Derive capacity from unique active teams on tomorrow's schedule.
        // Each team can handle ~4 jobs/day. If no bookings yet, fall back to
        // a conservative 2-team baseline (8 slots).
        const uniqueTeams = new Set(
          result.bookings.flatMap(b => b.teams.map(t => t.id))
        );
        const teamCount = uniqueTeams.size || 2;
        const slotsPerTeam = 4;
        totalSlots = teamCount * slotsPerTeam;
        openSlots = Math.max(totalSlots - bookedSlots, 0);
        scheduleNote = bookedSlots === 0
          ? `Tomorrow (${tomorrowLabel}) has no bookings yet — wide open schedule.`
          : openSlots === 0
          ? `Tomorrow (${tomorrowLabel}) is fully booked across ${teamCount} team${teamCount === 1 ? "" : "s"}.`
          : openSlots <= 2
          ? `Tomorrow (${tomorrowLabel}) is nearly full — ${openSlots} slot${openSlots === 1 ? "" : "s"} left across ${teamCount} team${teamCount === 1 ? "" : "s"}.`
          : `Tomorrow (${tomorrowLabel}) has ${openSlots} open slot${openSlots === 1 ? "" : "s"} out of ${totalSlots} (${teamCount} team${teamCount === 1 ? "" : "s"} × ${slotsPerTeam} jobs each).`;
      } catch {
        scheduleNote = `Tomorrow (${tomorrowLabel}) — schedule data unavailable.`;
        openSlots = 3;
      }

      // Find unbooked leads that could be re-engaged:
      // - COLD: received nudges, went quiet — prime reactivation targets
      // - QUOTE_SENT / AVAILABILITY / SLOT_CHOICE / TIME_PREF: active in funnel but stalled
      // - FOLLOW_UP_SCHEDULED: agent set a follow-up, good for blast campaigns
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      const ninetyDaysAgo = new Date();
      ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

      // Stalled active leads (last 30 days, not booked, in a reachable stage)
      const stalledLeads = await db
        .select({
          id: conversationSessions.id,
          name: conversationSessions.leadName,
          phone: conversationSessions.leadPhone,
          serviceType: conversationSessions.serviceType,
          stage: conversationSessions.stage,
        })
        .from(conversationSessions)
        .where(
          and(
            gte(conversationSessions.createdAt, thirtyDaysAgo),
            or(
              eq(conversationSessions.stage, "COLD" as string),
              eq(conversationSessions.stage, "QUOTE_SENT" as string),
              eq(conversationSessions.stage, "AVAILABILITY" as string),
              eq(conversationSessions.stage, "SLOT_CHOICE" as string),
              eq(conversationSessions.stage, "TIME_PREF" as string),
              eq(conversationSessions.stage, "FOLLOW_UP_SCHEDULED" as string)
            ),
            ne(conversationSessions.isBooked, 1),
            isNotNull(conversationSessions.leadPhone)
          )
        )
        .limit(100);

      // Pull from the curated reactivationEligible list — one-time customers only,
      // 30+ days since last job, manually reviewed and cleaned.
      const lapsedCustomers = await db
        .select({
          phone: completedJobs.phone,
          firstName: completedJobs.firstName,
          fullName: completedJobs.name,
          serviceType: completedJobs.serviceType,
          frequency: completedJobs.frequency,
          lastJobDate: sql<string>`MAX(${completedJobs.jobDate})`.as("lastJobDate"),
        })
        .from(completedJobs)
        .where(
          and(
            isNotNull(completedJobs.phone),
            isNotNull(completedJobs.jobDate),
            eq(completedJobs.reactivationEligible, 1)
          )
        )
        .groupBy(completedJobs.phone, completedJobs.firstName, completedJobs.name, completedJobs.serviceType, completedJobs.frequency)
        .orderBy(sql`MAX(${completedJobs.jobDate}) DESC`)
        .limit(3500);

      // Map to the same shape as stalledLeads for the recency filter,
      // keeping the extra fields for the recipient preview table.
      // Note: lastCampaignSmsDate is populated below after normalizePhone is declared.
      const coldLeads = lapsedCustomers.map(c => ({
        id: 0 as number, // no session id for past customers
        name: c.fullName ?? c.firstName ?? "Customer", // full name for session display; SMS greeting extracts first name
        fullName: c.fullName ?? c.firstName ?? "Customer",
        phone: c.phone,
        serviceType: c.serviceType,
        frequency: c.frequency ?? null,
        lastJobDate: c.lastJobDate ?? null,
        lastCampaignSmsDate: null as Date | null, // filled in below
        stage: "LAPSED" as string,
      }));

      // ── Permanent opt-out exclusion ────────────────────────────────────────
      // Exclude any phone that has replied STOP to any campaign.
      const optedOutRows = await db
        .select({ phone: smsOptOuts.phone })
        .from(smsOptOuts);
      const optedOutPhones = new Set(optedOutRows.map(r => r.phone));

      // ── 7-day campaign recency filter ──────────────────────────────────────
      // Exclude any lead whose phone number was sent a campaign SMS in the last 7 days.
      // This checks reactivationContacts.sentAt (campaign blasts only — not automated
      // system messages like ratings, follow-ups, or circle-backs).
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

      const recentlyCampaignedRows = await db
        .select({ phone: reactivationContacts.phone })
        .from(reactivationContacts)
        .where(
          and(
            isNotNull(reactivationContacts.sentAt),
            gte(reactivationContacts.sentAt, sevenDaysAgo)
          )
        );

      const recentlyCampaignedPhones = new Set(
        recentlyCampaignedRows.map(r => r.phone)
      );

      // Helper: normalize phone to E.164 for comparison.
      // Both completedJobs and reactivationContacts store phones as E.164 (+12025551234).
      // Use the shared normalizePhone from routers.ts to ensure consistent format.
      // The local strip-digits version was causing map lookup mismatches.
      const normalizePhoneLocal = (p: string | null): string => {
        if (!p) return "";
        // Already E.164
        if (p.startsWith("+")) return p.replace(/[^\d+]/g, "");
        const digits = p.replace(/\D/g, "");
        if (digits.length === 10) return `+1${digits}`;
        if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
        return `+${digits}`;
      };

      // Build a map of phone → last campaign SMS date.
      // PRIMARY source: conversation_sessions with leadSource LIKE 'campaign:%'
      // This is written immediately when fireCampaign sends each SMS, so it's
      // always up-to-date even before reactivationContacts logging completes.
      // FALLBACK: reactivationContacts.sentAt for older campaigns.
      const lastCampaignSmsMap = new Map<string, Date>();

      // 1. Load from conversation_sessions (most reliable — written per-send)
      const campaignSessionRows = await db
        .select({
          phone: conversationSessions.leadPhone,
          createdAt: conversationSessions.createdAt,
        })
        .from(conversationSessions)
        .where(sql`${conversationSessions.leadSource} LIKE ${'campaign:%'}`)
        .orderBy(sql`${conversationSessions.createdAt} DESC`);

      for (const row of campaignSessionRows) {
        const e164 = normalizePhoneLocal(row.phone);
        if (e164 && !lastCampaignSmsMap.has(e164)) {
          lastCampaignSmsMap.set(e164, row.createdAt as Date);
        }
      }

      // 2. Fallback: reactivationContacts.sentAt for phones not found above
      const allCampaignedRows = await db
        .select({
          phone: reactivationContacts.phone,
          sentAt: reactivationContacts.sentAt,
        })
        .from(reactivationContacts)
        .where(isNotNull(reactivationContacts.sentAt))
        .orderBy(sql`${reactivationContacts.sentAt} DESC`);

      for (const row of allCampaignedRows) {
        const e164 = normalizePhoneLocal(row.phone);
        if (e164 && !lastCampaignSmsMap.has(e164)) {
          lastCampaignSmsMap.set(e164, row.sentAt as Date);
        }
      }

      // Populate lastCampaignSmsDate on each coldLead
      for (const lead of coldLeads) {
        const e164 = normalizePhoneLocal(lead.phone);
        lead.lastCampaignSmsDate = lastCampaignSmsMap.get(e164) ?? null;
      }

      const recentPhoneDigits = new Set(
        Array.from(recentlyCampaignedPhones).map(p => normalizePhoneLocal(p))
      );

      const optedOutPhoneDigits = new Set(
        Array.from(optedOutPhones).map(p => normalizePhoneLocal(p))
      );

      const notRecentlyCampaigned = (lead: { phone: string | null }) =>
        !recentPhoneDigits.has(normalizePhoneLocal(lead.phone)) &&
        !optedOutPhoneDigits.has(normalizePhoneLocal(lead.phone));

      // Segment leads for each campaign type (applying recency filter)
      // Campaign 1 (Tomorrow Slots) & Campaign 2 (Re-engage) both draw from the lapsed
      // past-customer pool with a DAILY ROTATING OFFSET:
      //   Each day advances 100 positions through the full pool so every lapsed customer
      //   gets reached systematically before the cycle repeats.
      //   Tomorrow Slots  → dailyStart + 0..49  (50 leads)
      //   Re-engage       → dailyStart + 50..99 (50 leads, no overlap)
      const coldFiltered = coldLeads.filter(notRecentlyCampaigned);
      const totalLapsed = coldFiltered.length; // full pool count for UI display

      // Compute today's Eastern date as a stable day-of-year integer
      const poolNowET = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
      const startOfYear = new Date(poolNowET.getFullYear(), 0, 1);
      const dayOfYear = Math.floor((poolNowET.getTime() - startOfYear.getTime()) / 86_400_000);

      // dailyStart wraps so we never go out of bounds; each day = +100 positions
      const batchSize = 100;
      const dailyStart = totalLapsed > 0
        ? (dayOfYear * batchSize) % totalLapsed
        : 0;

      // Wrap-around: if the batch crosses the end of the array, concatenate tail + head
      const getWrappedSlice = (start: number, count: number) => {
        if (totalLapsed === 0) return [];
        const end = start + count;
        if (end <= totalLapsed) return coldFiltered.slice(start, end);
        // Wrap: take from start to end of array, then from beginning
        return [...coldFiltered.slice(start), ...coldFiltered.slice(0, end % totalLapsed)];
      };

      // Sort the full eligible pool by most recent last job date (2026 first)
      // and always take the top 50 — this ensures the most recently eligible
      // customers are always shown first, regardless of the daily rotation offset.
      const recencySorted = [...coldFiltered].sort((a, b) => {
        if (!a.lastJobDate && !b.lastJobDate) return 0;
        if (!a.lastJobDate) return 1;
        if (!b.lastJobDate) return -1;
        return new Date(b.lastJobDate).getTime() - new Date(a.lastJobDate).getTime();
      });

      const tomorrowTargets = recencySorted.slice(0, 50); // cap at 50 per batch
      const coldOnly: typeof recencySorted = []; // all go to tomorrow_slots card

      // Human-readable batch label for UI (e.g. "#81–180 of 3,491")
      const batchStart = dailyStart + 1;
      const batchEnd = Math.min(dailyStart + batchSize, totalLapsed);
      const batchLabel = totalLapsed > 0 ? `#${batchStart}–${batchEnd} of ${totalLapsed.toLocaleString()}` : "";
      const stalledFunnelLeads = stalledLeads
        .filter(l => l.stage === "AVAILABILITY" || l.stage === "SLOT_CHOICE" || l.stage === "TIME_PREF" || l.stage === "FOLLOW_UP_SCHEDULED")
        .filter(notRecentlyCampaigned)
        .slice(0, 30);

      // Always return exactly 3 campaign cards — show 0 recipients if no matching leads
      const campaigns: Array<{
        id: string;
        type: "tomorrow_slots" | "reactivation" | "quote_followup";
        title: string;
        subtitle: string;
        urgency: "high" | "medium" | "low";
        recipientCount: number;
        totalPoolSize: number; // full eligible pool before the 50-cap
        estimatedRevenue: number;
        script: string;
        scheduleNote: string;
        batchLabel: string;
        targetLeadIds: number[];
        targetPhones: string[]; // for lapsed customers who have no session id
        hasLeads: boolean;
        recipients: Array<{
          name: string;
          fullName: string;
          phone: string;
          frequency: string | null;
          lastBookingDate: string | null;
          lastCampaignSmsDate: Date | null;
        }>
      }> = [
        // Campaign 1: Fill Tomorrow's Open Slots — targets lapsed past customers
        // with an urgency script about the open slot tomorrow.
        {
          id: "tomorrow_slots",
          type: "tomorrow_slots",
          title: `Fill Tomorrow's Open Slots`,
          subtitle: tomorrowTargets.length > 0
            ? `${scheduleNote} Today's batch: lapsed customers ${batchLabel} (first 50).`
            : scheduleNote,
          urgency: openSlots >= 4 ? "high" : openSlots >= 2 ? "medium" : "low",
          recipientCount: tomorrowTargets.length,
          totalPoolSize: totalLapsed,
          estimatedRevenue: tomorrowTargets.length * 250 * 0.15,
          script: `Hi {{name}}, it's Maids in Black! 🏠 We have a last-minute opening ${tomorrowLabel} — perfect timing to get your home sparkling! Want to grab the slot? Reply YES and we'll confirm right away! ✨`,
          scheduleNote,
          batchLabel,
          targetLeadIds: [],
          targetPhones: tomorrowTargets.map(l => l.phone).filter(Boolean) as string[],
          hasLeads: tomorrowTargets.length > 0,
          recipients: tomorrowTargets.map(l => ({
            name: l.name,
            fullName: (l as any).fullName ?? l.name,
            phone: l.phone ?? "",
            frequency: l.frequency ?? null,
            lastBookingDate: l.lastJobDate ?? null,
            lastCampaignSmsDate: l.lastCampaignSmsDate ?? null,
          })),
        },
        // Campaign 2: Re-engage Lapsed Customers (haven't booked in 60+ days)
        {
          id: "reactivation",
          type: "reactivation",
          title: `Re-engage Lapsed Customers`,
          subtitle: coldOnly.length > 0
            ? `Today's batch: lapsed customers ${batchLabel} (second 50, no overlap with Tomorrow Slots).`
            : totalLapsed > 0
            ? `${totalLapsed.toLocaleString()} past customers haven't booked in 60+ days — all covered by Tomorrow Slots campaign.`
            : `No lapsed customers right now — great retention!`,
          urgency: totalLapsed >= 100 ? "high" : totalLapsed >= 20 ? "medium" : "low",
          recipientCount: coldOnly.length,
          totalPoolSize: totalLapsed,
          estimatedRevenue: coldOnly.length * 250 * 0.15, // past customers have higher avg value
          script: `Hi {{name}}, it's Maids in Black! 🏠 We'd love to have you back. We're offering priority scheduling for returning customers this week — want to book a clean? Reply YES or just let us know a good time!`,
          scheduleNote: coldOnly.length > 0
            ? `Sending to customers ${batchLabel} (second 50 of today's batch, no overlap with Tomorrow Slots).`
            : `No additional lapsed customers beyond the Tomorrow Slots batch.`,
          batchLabel,
          targetLeadIds: [],
          targetPhones: coldOnly.map(l => l.phone).filter(Boolean) as string[],
          hasLeads: coldOnly.length > 0,
          recipients: coldOnly.map(l => ({
            name: l.name,
            fullName: (l as any).fullName ?? l.name,
            phone: l.phone ?? "",
            frequency: l.frequency ?? null,
            lastBookingDate: l.lastJobDate ?? null,
            lastCampaignSmsDate: l.lastCampaignSmsDate ?? null,
          })),
        },
        // Campaign 3: Follow Up on Open Quotes
        {
          id: "quote_followup",
          type: "quote_followup",
          title: `Follow Up on Open Quotes`,
          subtitle: stalledFunnelLeads.length > 0
            ? `${stalledFunnelLeads.length} lead${stalledFunnelLeads.length === 1 ? "" : "s"} started booking but haven't confirmed yet.`
            : `No stalled leads right now — funnel is clean!`,
          urgency: stalledFunnelLeads.length >= 5 ? "high" : stalledFunnelLeads.length >= 2 ? "medium" : "low",
          recipientCount: stalledFunnelLeads.length,
          estimatedRevenue: stalledFunnelLeads.length * 180 * 0.25,
          script: `Hi {{name}}! Just checking in — we'd love to get your home sparkling clean! We have openings this week. Any questions? Reply anytime or just say YES to book. 🌟`,
          scheduleNote: stalledFunnelLeads.length > 0
            ? `${stalledFunnelLeads.length} lead${stalledFunnelLeads.length === 1 ? "" : "s"} are mid-funnel and haven't booked yet.`
            : `No stalled quotes right now.`,
          batchLabel: "",
          totalPoolSize: stalledFunnelLeads.length,
          targetLeadIds: stalledFunnelLeads.map(l => l.id),
          targetPhones: [],
          hasLeads: stalledFunnelLeads.length > 0,
          recipients: stalledFunnelLeads.map(l => ({
            name: l.name ?? "Lead",
            fullName: l.name ?? "Lead",
            phone: l.phone ?? "",
            frequency: l.serviceType ?? null,
            lastBookingDate: null,
            lastCampaignSmsDate: null,
          })),
        },
      ];

      // ── Load saved scripts (always fresh, not cached) ─────────────────────
      // Fetch any admin-saved scripts for each campaign type and override defaults.
      const savedScriptRows = await db
        .select()
        .from(commandCenterCache)
        .where(
          and(
            sql`${commandCenterCache.cacheKey} LIKE 'campaign_script:%'`,
            eq(commandCenterCache.rangeKey, "none")
          )
        );
      const savedScriptMap = new Map<string, string>();
      for (const row of savedScriptRows) {
        try {
          const parsed = JSON.parse(row.payload) as { script?: string };
          if (parsed.script) {
            const campaignId = row.cacheKey.replace("campaign_script:", "");
            savedScriptMap.set(campaignId, parsed.script);
          }
        } catch { /* ignore malformed */ }
      }

      // Apply saved scripts to campaign objects
      const campaignsWithSavedScripts = campaigns.map(c => ({
        ...c,
        script: savedScriptMap.get(c.id) ?? c.script,
        hasCustomScript: savedScriptMap.has(c.id),
      }));

      const campResult = {
        campaigns: campaignsWithSavedScripts,
        scheduleNote,
        tomorrowLabel,
        openSlots,
        bookedSlots,
      };

      // Save to cache in background (don't await)
      void (async () => {
        try {
          // Cache the base campaigns (without saved scripts) so script edits
          // are always loaded fresh and not frozen in cache.
          const cachePayload = JSON.stringify({
            campaigns,
            scheduleNote,
            tomorrowLabel,
            openSlots,
            bookedSlots,
          });
          if (campCacheHit) {
            await db.update(commandCenterCache).set({ payload: cachePayload, generatedAt: new Date() })
              .where(and(eq(commandCenterCache.cacheKey, "tomorrow_campaigns"), eq(commandCenterCache.rangeKey, "none")));
          } else {
            await db.insert(commandCenterCache).values({ cacheKey: "tomorrow_campaigns", rangeKey: "none", payload: cachePayload, generatedAt: new Date() });
          }
        } catch { /* non-fatal */ }
      })();

      return campResult;
    }),

  /**
   * fireCampaign — sends the campaign SMS to all target leads.
   * Supports two modes:
   *   - targetLeadIds: for active funnel leads (conversationSessions rows)
   *   - targetPhones:  for lapsed past customers (completedJobs rows, no session id)
   * All successful sends are logged to reactivationContacts so the 7-day recency
   * filter catches them on future campaign loads.
   */
  fireCampaign: adminAgentProcedure
    .input(z.object({
      campaignId: z.string(),
      campaignType: z.string().optional().default("command-center"),
      campaignTitle: z.string().optional().default("Command Center Campaign"),
      batchLabel: z.string().optional(),
      targetLeadIds: z.array(z.number()),
      targetPhones: z.array(z.string()).optional().default([]),
      script: z.string(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("DB unavailable");

      // Build the unified send list
      // isPhoneOnly=true means this is a lapsed past customer with no active session;
      // we must create a session on send so their reply can be routed to Jade.
      type SendTarget = { phone: string; name: string; sourceId?: number; isPhoneOnly?: boolean };
      const sendList: SendTarget[] = [];
      // 1. Session-based leads (funnel leads — already have a session, no need to create one)
      if (input.targetLeadIds.length > 0) {
        const leads = await db
          .select({
            id: conversationSessions.id,
            name: conversationSessions.leadName,
            phone: conversationSessions.leadPhone,
          })
          .from(conversationSessions)
          .where(
            and(
              isNotNull(conversationSessions.leadPhone),
              sql`${conversationSessions.id} IN (${sql.join(input.targetLeadIds.map(id => sql`${id}`), sql`, `)})`
            )
          );
        for (const l of leads) {
          if (l.phone) sendList.push({ phone: l.phone, name: l.name ?? "", sourceId: l.id, isPhoneOnly: false });
        }
      }
      // 2. Phone-only targets (lapsed past customers from completedJobs — no session exists)
      if (input.targetPhones.length > 0) {
        const pastCustomers = await db
          .select({
            phone: completedJobs.phone,
            firstName: completedJobs.firstName,
            fullName: completedJobs.name,
          })
          .from(completedJobs)
          .where(
            sql`${completedJobs.phone} IN (${sql.join(input.targetPhones.map(p => sql`${p}`), sql`, `)})`
          )
          .groupBy(completedJobs.phone, completedJobs.firstName, completedJobs.name);
        for (const c of pastCustomers) {
          // Use full name for session display; SMS greeting extracts first name separately
          sendList.push({ phone: c.phone, name: c.fullName ?? c.firstName ?? "", isPhoneOnly: true });
        }
      }

      const blastStartedAt = new Date(); // Record before first SMS so session window is accurate

      // Fire the send loop in the background so the HTTP request returns immediately.
      // This prevents tRPC timeouts for large batches (50 msgs × 12s = 10 min).
      // The client polls getCampaignProgress to track live progress.
      const runBlast = async () => {
      let sent = 0;
      let failed = 0;
      const errors: string[] = [];
      const sentPhones: string[] = [];

      for (const target of sendList) {
        const name = target.name.split(" ")[0] || "there";
        const personalizedScript = input.script.replace(/\{\{name\}\}/g, name);
        try {
          const smsResult = await sendSms({ to: target.phone, content: personalizedScript });
          if (!smsResult.success) {
            // sendSms returns { success: false } on API errors — count as failed
            failed++;
            errors.push(`${target.phone}: ${smsResult.error ?? "OpenPhone returned failure"}`);
          } else {
            sent++;
            sentPhones.push(target.phone);
            // Only create a session for phone-only targets (lapsed past customers).
            // Session-based funnel leads already have an active session — no need to create one.
            if (target.isPhoneOnly) {
              try {
                // Look up the last booking price + service type from completed_jobs for this phone
                const [priceRow] = await db
                  .select({
                    lastBookingPrice: completedJobs.lastBookingPrice,
                    serviceType: completedJobs.serviceType,
                    frequency: completedJobs.frequency,
                  })
                  .from(completedJobs)
                  .where(eq(completedJobs.phone, target.phone))
                  .orderBy(desc(completedJobs.jobDate))
                  .limit(1);
                // Use serviceType if available, fall back to frequency (e.g. "Monthly", "One-time")
                const resolvedServiceType = priceRow?.serviceType || priceRow?.frequency || null;
                await db.insert(conversationSessions).values({
                  leadPhone: target.phone,
                  leadName: target.name ?? "",
                  stage: "REACTIVATION",
                  // Tag with the specific campaign so the leads page shows the source
                  leadSource: `campaign:${input.campaignId}`,
                  messageHistory: JSON.stringify([{ role: "assistant", content: personalizedScript, ts: Date.now() }]),
                  aiMode: 1,
                  isBooked: 0,
                  reactivationLastPrice: priceRow?.lastBookingPrice ?? null,
                  serviceType: resolvedServiceType,
                });
              } catch (sessionErr) {
                // Non-fatal: session creation failure should not block the send count
                console.error(`[fireCampaign] Failed to create session for ${target.phone}:`, sessionErr);
              }
            }
          }
          // Stagger sends at 12s intervals (5/min) to avoid carrier burst-detection
          // and OpenPhone rate limits. 50 contacts ≈ 10 minutes total.
          await new Promise(r => setTimeout(r, 12_000));
        } catch (err) {
          failed++;
          errors.push(`${target.phone}: ${String(err)}`);
        }
      }

      // Log all successful sends to reactivationContacts so the 7-day recency
      // filter catches them on future campaign loads.
      // Note: reactivationContacts has no unique key on (campaignId, phone), so we
      // use individual inserts with error suppression to avoid duplicate rows.
      if (sentPhones.length > 0) {
        const CC_CAMPAIGN_ID = -1;
        for (const phone of sentPhones) {
          try {
            await db.insert(reactivationContacts).values({
              campaignId: CC_CAMPAIGN_ID,
              phone,
              bookingCount: 0,
              status: "SENT" as const,
              sentAt: new Date(),
            });
          } catch {
            // Ignore duplicate insert errors — phone already logged from a prior campaign
          }
        }
      }

      // Log the blast to campaignBlasts for the Campaign History tab
      try {
        await db.insert(campaignBlasts).values({
          campaignType: input.campaignType,
          campaignTitle: input.campaignTitle,
          batchLabel: input.batchLabel ?? null,
          recipientCount: sendList.length,
          sentCount: sent,
          failedCount: failed,
          script: input.script.slice(0, 2000),
          startedAt: blastStartedAt,
          firedAt: new Date(),
          firedBy: "admin",
        });
      } catch (logErr) {
        // Non-fatal: blast logging failure should not affect the return value
        console.error("[fireCampaign] Failed to log blast:", logErr);
      }

      }; // end runBlast
      // Kick off the blast in the background — do not await
      setImmediate(() => { runBlast().catch(err => console.error("[fireCampaign] background blast error:", err)); });

      return { sent: 0, failed: 0, errors: [], total: sendList.length, startedAt: blastStartedAt.getTime() };
    }),

  /**
   * getCampaignHistory — returns the last 50 campaign blasts for the Campaign History tab.
   * Enriches each blast with reply count (sessions that advanced past REACTIVATION).
   */
  getCampaignHistory: adminAgentProcedure
    .query(async () => {
      const db = await getDb();
      if (!db) return [];

      const blasts = await db
        .select()
        .from(campaignBlasts)
        .orderBy(desc(campaignBlasts.firedAt))
        .limit(50);

      // For each blast, count sessions and replies.
      // Sessions are tagged with leadSource = 'campaign:{campaignType}' by fireCampaign.
      // IMPORTANT: firedAt is recorded at the END of the blast (after all SMS are sent),
      // so sessions are created BEFORE firedAt. We use a 2-hour lookback window to capture
      // all sessions that were created during the blast, plus a 7-day forward window for
      // delayed replies.
      const enriched = await Promise.all(
        blasts.map(async (blast) => {
          // Use startedAt if available (recorded before first SMS); fall back to
          // a 2-hour lookback from firedAt for legacy blasts without startedAt.
          const windowStart = blast.startedAt
            ? new Date(blast.startedAt.getTime() - 60_000) // 1-min buffer before first send
            : new Date(blast.firedAt.getTime() - 2 * 60 * 60 * 1000);
          // 7-day forward window to catch delayed replies
          const windowEnd = new Date(blast.firedAt.getTime() + 7 * 24 * 60 * 60 * 1000);
          // Count sessions created in the blast window with matching campaign source
          const [sessionRow] = await db
            .select({ count: sql<number>`COUNT(*)` })
            .from(conversationSessions)
            .where(
              and(
                sql`${conversationSessions.leadSource} LIKE ${`campaign:${blast.campaignType}%`}`,
                gte(conversationSessions.createdAt, windowStart),
                lte(conversationSessions.createdAt, windowEnd)
              )
            );
          // Count those that have replied — has at least one user message in messageHistory
          const [replyRow] = await db
            .select({ count: sql<number>`COUNT(*)` })
            .from(conversationSessions)
            .where(
              and(
                sql`${conversationSessions.leadSource} LIKE ${`campaign:${blast.campaignType}%`}`,
                sql`${conversationSessions.messageHistory} LIKE ${`%"role":"user"%`}`,
                gte(conversationSessions.createdAt, windowStart),
                lte(conversationSessions.createdAt, windowEnd)
              )
            );
          return {
            ...blast,
            sessionCount: Number(sessionRow?.count ?? 0),
            replyCount: Number(replyRow?.count ?? 0),
          };
        })
      );

      return enriched;
    }),

  /**
   * getCampaignProgress — returns live send progress for a campaign blast.
   * Used by the progress indicator while fireCampaign is running.
   * Returns sent/total/remaining/estimatedMinutesLeft based on reactivationContacts.
   */
  getCampaignProgress: adminAgentProcedure
    .input(z.object({
      campaignId: z.string(),
      totalExpected: z.number().int().min(1),
      startedAt: z.number(), // Unix ms timestamp when firing started
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return { sent: 0, total: input.totalExpected, remaining: input.totalExpected, estimatedMinutesLeft: null, done: false };

      // Count sends logged to reactivationContacts after startedAt.
      // fireCampaign writes one row per successful send regardless of whether a new session was created,
      // making this the most reliable progress counter for all campaign types.
      const since = new Date(input.startedAt);
      const [row] = await db
        .select({ count: sql<number>`COUNT(*)` })
        .from(reactivationContacts)
        .where(
          and(
            eq(reactivationContacts.status, "SENT"),
            gte(reactivationContacts.sentAt, since)
          )
        );
      const sent = Math.min(Number(row?.count ?? 0), input.totalExpected);
      const remaining = Math.max(0, input.totalExpected - sent);
      // 12s per message → remaining * 12 / 60 minutes
      const estimatedMinutesLeft = remaining > 0 ? Math.ceil((remaining * 12) / 60) : 0;
      return { sent, total: input.totalExpected, remaining, estimatedMinutesLeft, done: remaining === 0 };
    }),

  /**
   * getTodayCampaignStatus — returns all campaigns sent today so the AI Center
   * can show a "Today's Campaign" banner to prevent duplicate sends.
   * Uses conversation_sessions as source of truth (written per-send).
   */
  getTodayCampaignStatus: adminAgentProcedure
    .query(async () => {
      const db = await getDb();
      if (!db) return [];

      // Start of today in UTC
      const todayStart = new Date();
      todayStart.setUTCHours(0, 0, 0, 0);

      // Group sessions by campaignId (extract from leadSource 'campaign:{id}')
      const rows = await db
        .select({
          leadSource: conversationSessions.leadSource,
          count: sql<number>`COUNT(*)`,
          firstSent: sql<Date>`MIN(${conversationSessions.createdAt})`,
          lastSent: sql<Date>`MAX(${conversationSessions.createdAt})`,
        })
        .from(conversationSessions)
        .where(
          and(
            sql`${conversationSessions.leadSource} LIKE ${'campaign:%'}`,
            gte(conversationSessions.createdAt, todayStart)
          )
        )
        .groupBy(conversationSessions.leadSource)
        .orderBy(sql`MIN(${conversationSessions.createdAt}) DESC`);

      return rows.map(r => ({
        campaignId: (r.leadSource ?? '').replace('campaign:', ''),
        sentCount: Number(r.count),
        firstSent: r.firstSent,
        lastSent: r.lastSent,
      }));
    }),

  /**
   * Save a custom SMS script for a campaign type so it persists across sessions.
   * Stored in commandCenterCache with key "campaign_script:{campaignId}".
   */
  saveCampaignScript: adminAgentProcedure
    .input(z.object({
      campaignId: z.string(), // e.g. "tomorrow_slots", "reactivation", "quote_followup"
      script: z.string().max(1000),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("DB unavailable");

      const cacheKey = `campaign_script:${input.campaignId}`;
      const existing = await db
        .select()
        .from(commandCenterCache)
        .where(and(eq(commandCenterCache.cacheKey, cacheKey), eq(commandCenterCache.rangeKey, "none")))
        .limit(1);

      const payload = JSON.stringify({ script: input.script });
      if (existing[0]) {
        await db
          .update(commandCenterCache)
          .set({ payload, generatedAt: new Date() })
          .where(and(eq(commandCenterCache.cacheKey, cacheKey), eq(commandCenterCache.rangeKey, "none")));
      } else {
        await db
          .insert(commandCenterCache)
          .values({ cacheKey, rangeKey: "none", payload, generatedAt: new Date() });
      }

      return { ok: true };
    }),

  /**
   * Send a test SMS to a single phone number using the provided script.
   * Replaces {{name}} with "Test" so the message looks realistic.
   */
  sendTestCampaignSms: adminAgentProcedure
    .input(z.object({
      phone: z.string().min(10),
      script: z.string().max(1000),
      testName: z.string().optional(),
      campaignId: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      // CRITICAL: Normalize to E.164 (+1XXXXXXXXXX) so the webhook can find this
      // session when the recipient replies. The webhook always normalizes the
      // inbound phone via normalizePhone() before the DB lookup — if the session
      // was stored without the +1 prefix the lookup fails and the reply is dropped.
      const e164Phone = normalizePhone(input.phone);
      // Name substitution is handled client-side before calling this procedure
      const result = await sendSms({ to: e164Phone, content: input.script });
      // CRITICAL: Create a REACTIVATION session so that when the test recipient
      // replies, the webhook finds an active session and routes the reply through
      // the REACTIVATION → REACTIVATION_TIME flow. Without this, the webhook finds
      // only DONE sessions and silently drops the reply.
      if (db && result.success) {
        try {
          await db.insert(conversationSessions).values({
            leadPhone: e164Phone,
            leadName: input.testName ?? "Test",
            stage: "REACTIVATION",
            leadSource: `campaign-test:${input.campaignId ?? "manual"}`,
            messageHistory: JSON.stringify([{ role: "assistant", content: input.script, ts: Date.now() }]),
            aiMode: 1,
            isBooked: 0,
          });
        } catch (sessionErr) {
          // Non-fatal: log but don't fail the send
          console.error("[sendTestCampaignSms] Failed to create test session:", sessionErr);
        }
      }
      return { ok: result.success };
    }),

  /**
   * getBlastDetail — returns per-contact status for a single campaign blast.
   * Shows who replied, their current stage, and whether they moved into the pipeline.
   */
  getBlastDetail: adminAgentProcedure
    .input(z.object({ blastId: z.number() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return null;

      // Fetch the blast record
      const [blast] = await db
        .select()
        .from(campaignBlasts)
        .where(eq(campaignBlasts.id, input.blastId))
        .limit(1);

      if (!blast) return null;

      // Determine session window (same logic as getCampaignHistory)
      const windowStart = blast.startedAt
        ? new Date(blast.startedAt.getTime() - 60_000)
        : new Date(blast.firedAt.getTime() - 2 * 60 * 60 * 1000);
      const windowEnd = new Date(blast.firedAt.getTime() + 7 * 24 * 60 * 60 * 1000);

      // Fetch all sessions for this blast
      const sessions = await db
        .select({
          id: conversationSessions.id,
          leadPhone: conversationSessions.leadPhone,
          leadName: conversationSessions.leadName,
          stage: conversationSessions.stage,
          isBooked: conversationSessions.isBooked,
          messageHistory: conversationSessions.messageHistory,
          createdAt: conversationSessions.createdAt,
          updatedAt: conversationSessions.updatedAt,
          leadSource: conversationSessions.leadSource,
        })
        .from(conversationSessions)
        .where(
          and(
            sql`${conversationSessions.leadSource} LIKE ${`campaign:${blast.campaignType}%`}`,
            gte(conversationSessions.createdAt, windowStart),
            lte(conversationSessions.createdAt, windowEnd)
          )
        )
        .orderBy(desc(conversationSessions.updatedAt));

      // Pipeline stages — leads that moved beyond initial outreach
      const PIPELINE_STAGES = new Set(["QUOTE_SENT", "FOLLOW_UP", "BOOKED", "CALL_SCHEDULED", "UNHANDLED"]);

      const contacts = sessions.map((s) => {
        const history: Array<{ role: string; content: string; ts?: number }> =
          (() => { try { return JSON.parse(s.messageHistory ?? "[]"); } catch { return []; } })();
        const hasReplied = history.some((m) => m.role === "user");
        const lastUserMsg = [...history].reverse().find((m) => m.role === "user");
        const inPipeline = PIPELINE_STAGES.has(s.stage ?? "") || s.isBooked === 1;
        return {
          id: s.id,
          phone: s.leadPhone,
          name: s.leadName || "Unknown",
          stage: s.stage,
          isBooked: s.isBooked === 1,
          inPipeline,
          hasReplied,
          lastReply: lastUserMsg?.content ?? null,
          lastReplyTs: lastUserMsg?.ts ?? null,
          createdAt: s.createdAt,
          updatedAt: s.updatedAt,
        };
      });

      return {
        blast,
        contacts,
        totalSent: contacts.length,
        totalReplied: contacts.filter((c) => c.hasReplied).length,
        totalInPipeline: contacts.filter((c) => c.inPipeline).length,
        totalBooked: contacts.filter((c) => c.isBooked).length,
      };
    }),
});

// ─── Background Cache Warm-Up ──────────────────────────────────────────────────
/**
 * warmAiInsightsCache — pre-generates and stores AI insights for all three
 * range keys ("today", "7d", "30d") and conversation intelligence for "30d".
 *
 * Called by the internal cron every 30 minutes so users always hit a warm cache
 * and never wait for LLM calls on page load.
 */
export async function warmAiInsightsCache(): Promise<{ warmed: string[]; errors: string[] }> {
  const db = await getDb();
  if (!db) return { warmed: [], errors: ["DB unavailable"] };

  const warmed: string[] = [];
  const errors: string[] = [];

  // ── 1. Warm getAiInsights for all three ranges ─────────────────────────────
  const ranges: Array<"today" | "7d" | "30d"> = ["today", "7d", "30d"];

  for (const range of ranges) {
    try {
      const since = getWindowStart(range);

      const sessions = await db
        .select({
          id: conversationSessions.id,
          stage: conversationSessions.stage,
          isBooked: conversationSessions.isBooked,
          quotedPrice: conversationSessions.quotedPrice,
          extras: conversationSessions.extras,
          bookedAmount: conversationSessions.bookedAmount,
          reactivationLastPrice: conversationSessions.reactivationLastPrice,
          reactivationDiscountPct: conversationSessions.reactivationDiscountPct,
          leadSource: conversationSessions.leadSource,
          utmSource: conversationSessions.utmSource,
          createdAt: conversationSessions.createdAt,
          updatedAt: conversationSessions.updatedAt,
          nudgeCount: conversationSessions.nudgeCount,
          lastAiMessageAt: conversationSessions.lastAiMessageAt,
          serviceType: conversationSessions.serviceType,
        })
        .from(conversationSessions)
        .where(and(gte(conversationSessions.createdAt, since), notInArray(conversationSessions.leadSource, NON_LEAD_SOURCES)));

      const totalLeads = sessions.length;
      const booked = sessions.filter(s => s.stage === "BOOKED" || s.isBooked === 1);
      const cold = sessions.filter(s => s.stage === "COLD" || s.stage === "NOT_INTERESTED");
      const unhandled = sessions.filter(s => s.stage === "UNHANDLED");
      const callScheduled = sessions.filter(s => s.stage === "CALL_SCHEDULED");
      const quoteSent = sessions.filter(s => s.stage === "QUOTE_SENT");
      const bookedRevenue = booked.reduce((sum, s) => sum + calcRevenue(s), 0);

      const TEN_MIN_MS = 10 * 60 * 1000;
      const withFirstContact = sessions.filter(s => {
        if (!s.lastAiMessageAt) return false;
        const c = s.createdAt instanceof Date ? s.createdAt.getTime() : new Date(s.createdAt as string).getTime();
        const r = s.lastAiMessageAt instanceof Date ? s.lastAiMessageAt.getTime() : new Date(s.lastAiMessageAt as unknown as string).getTime();
        return (r - c) <= TEN_MIN_MS;
      });
      const avgResponseMin = withFirstContact.length > 0
        ? Math.round(withFirstContact.reduce((sum, s) => {
            const c = s.createdAt instanceof Date ? s.createdAt.getTime() : new Date(s.createdAt as string).getTime();
            const r = s.lastAiMessageAt instanceof Date ? s.lastAiMessageAt.getTime() : new Date(s.lastAiMessageAt as unknown as string).getTime();
            return sum + Math.max(0, (r - c) / 60000);
          }, 0) / withFirstContact.length)
        : 0;

      const sourceCount: Record<string, number> = {};
      const sourceBooked: Record<string, number> = {};
      for (const s of sessions) {
        const src = s.utmSource ?? s.leadSource ?? "organic";
        sourceCount[src] = (sourceCount[src] ?? 0) + 1;
        if (s.stage === "BOOKED" || s.isBooked === 1) sourceBooked[src] = (sourceBooked[src] ?? 0) + 1;
      }

      const serviceCount: Record<string, number> = {};
      for (const s of sessions) {
        if (s.serviceType) serviceCount[s.serviceType] = (serviceCount[s.serviceType] ?? 0) + 1;
      }

      const ninetyDaysAgo = new Date();
      ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
      const reactivationPool = await db
        .select({ id: conversationSessions.id })
        .from(conversationSessions)
        .where(and(
          gte(conversationSessions.createdAt, ninetyDaysAgo),
          or(eq(conversationSessions.stage, "COLD" as string), eq(conversationSessions.stage, "NOT_INTERESTED" as string))
        ));

      // Quick objections LLM call
      const allSessions = await db
        .select({ messageHistory: conversationSessions.messageHistory, stage: conversationSessions.stage, isBooked: conversationSessions.isBooked })
        .from(conversationSessions)
        .where(and(gte(conversationSessions.createdAt, since), notInArray(conversationSessions.leadSource, NON_LEAD_SOURCES)))
        .limit(200);

      const leadMessages: string[] = [];
      for (const s of allSessions) {
        try {
          const history: Array<{ role: string; content: string }> = JSON.parse(s.messageHistory ?? "[]");
          for (const msg of history) {
            if (msg.role === "user" && msg.content && msg.content.trim().length > 5) leadMessages.push(msg.content.trim());
          }
        } catch { /* skip */ }
      }

      let topObjections: Array<{ label: string; pct: number; tip: string; example: string }> = [];
      let conversationInsight = "";
      if (leadMessages.length >= 5) {
        try {
          const sample = leadMessages.slice(0, 50);
          const objResponse = await invokeLLM({
            messages: [
              { role: "system", content: "You are a sales coach. Respond only with valid JSON." },
              { role: "user", content: `Analyze these ${sample.length} SMS replies from cleaning service leads and identify the top 3 objections. Respond with JSON: {"objections":[{"label":string,"pct":number,"tip":string,"example":string}],"topInsight":string}\n\n${sample.map((m, i) => `${i + 1}. "${m}"`).join("\n")}` },
            ],
            response_format: { type: "json_object" } as any,
          });
          const rawObjContent = objResponse?.choices?.[0]?.message?.content ?? "{}";
          const rawObj = typeof rawObjContent === "string" ? rawObjContent : JSON.stringify(rawObjContent);
          const parsedObj = JSON.parse(rawObj);
          topObjections = (parsedObj.objections ?? []).slice(0, 3);
          conversationInsight = parsedObj.topInsight ?? "";
        } catch { /* non-blocking */ }
      }

      const objectionContext = topObjections.length > 0
        ? `\nTOP OBJECTIONS FROM SMS CONVERSATIONS:\n${topObjections.map(o => `- "${o.label}" (~${o.pct}% of leads): ${o.tip} Example: "${o.example}"`).join("\n")}\nOVERALL CONVERSATION INSIGHT: ${conversationInsight}`
        : "";

      const metricsContext = `
BUSINESS: Maids in Black — home cleaning service, Washington DC Metro Area.
PERIOD: ${range === "today" ? "Today" : range === "7d" ? "Last 7 days" : "Last 30 days"}
KEY METRICS:
- Total new leads: ${totalLeads}
- Booked jobs: ${booked.length} (${totalLeads > 0 ? Math.round((booked.length / totalLeads) * 100) : 0}% conversion)
- Revenue booked: $${bookedRevenue.toLocaleString()}
- Avg first response time: ${avgResponseMin} minutes
- Leads with no reply (COLD): ${cold.length}
- Unhandled/needs review: ${unhandled.length}
- Call scheduled (hot): ${callScheduled.length}
- Quote sent, no reply yet: ${quoteSent.length}
- Reactivation pool (last 90 days cold): ${reactivationPool.length} leads
LEAD SOURCES: ${JSON.stringify(sourceCount)}
BOOKED BY SOURCE: ${JSON.stringify(sourceBooked)}
SERVICE TYPES: ${JSON.stringify(serviceCount)}${objectionContext}`.trim();

      const response = await invokeLLM({
        messages: [
          {
            role: "system",
            content: `You are an AI business analyst specializing in residential home cleaning companies. Analyze the metrics and return a JSON object with exactly this structure: {"pulse":[{"type":string,"title":string,"body":string,"metric":string,"action":string,"linkStage":string}],"actionFeed":[{"id":string,"title":string,"description":string,"estimatedValue":string,"actionType":string,"urgency":string,"linkStage":string}]}. Rules: pulse has exactly 3 cards; actionFeed has 4-6 items sorted by urgency; be specific with numbers; compare to home cleaning benchmarks (15-25% conversion is average, 30%+ is good).`,
          },
          { role: "user", content: metricsContext },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "ai_insights_warmup",
            strict: true,
            schema: {
              type: "object",
              properties: {
                pulse: { type: "array", items: { type: "object", properties: { type: { type: "string" }, title: { type: "string" }, body: { type: "string" }, metric: { type: "string" }, action: { type: "string" }, linkStage: { type: "string" } }, required: ["type", "title", "body", "metric", "action", "linkStage"], additionalProperties: false } },
                actionFeed: { type: "array", items: { type: "object", properties: { id: { type: "string" }, title: { type: "string" }, description: { type: "string" }, estimatedValue: { type: "string" }, actionType: { type: "string" }, urgency: { type: "string" }, linkStage: { type: "string" } }, required: ["id", "title", "description", "estimatedValue", "actionType", "urgency", "linkStage"], additionalProperties: false } },
              },
              required: ["pulse", "actionFeed"],
              additionalProperties: false,
            },
          },
        },
      });

      const rawContent = response.choices?.[0]?.message?.content;
      const content = typeof rawContent === "string" ? rawContent : null;
      if (!content) throw new Error("No LLM response");
      const parsed = JSON.parse(content);

      // Upsert into aiInsightsCache
      const existing = await db.select().from(aiInsightsCache).where(eq(aiInsightsCache.rangeKey, range)).limit(1);
      const payload = JSON.stringify(parsed);
      if (existing[0]) {
        await db.update(aiInsightsCache).set({ payload, generatedAt: new Date() }).where(eq(aiInsightsCache.rangeKey, range));
      } else {
        await db.insert(aiInsightsCache).values({ rangeKey: range, payload, generatedAt: new Date() });
      }
      warmed.push(`ai_insights:${range}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`ai_insights:${range}: ${msg}`);
      console.error(`[WarmCache] ai_insights:${range} failed:`, msg);
    }
  }

  // ── 2. Warm getConversationIntelligence for "30d" ─────────────────────────
  try {
    const since = getWindowStart("30d");
    const sessions = await db
      .select({ id: conversationSessions.id, stage: conversationSessions.stage, messageHistory: conversationSessions.messageHistory, isBooked: conversationSessions.isBooked })
      .from(conversationSessions)
      .where(and(gte(conversationSessions.createdAt, since), notInArray(conversationSessions.leadSource, NON_LEAD_SOURCES)))
      .limit(200);

    const leadMessages: string[] = [];
    for (const s of sessions) {
      try {
        const history: Array<{ role: string; content: string }> = JSON.parse(s.messageHistory ?? "[]");
        for (const msg of history) {
          if (msg.role === "user" && msg.content && msg.content.trim().length > 5) leadMessages.push(msg.content.trim());
        }
      } catch { /* skip */ }
    }

    if (leadMessages.length > 0) {
      const sample = leadMessages.slice(0, 150);
      const totalLeads = sessions.length;
      const bookedCount = sessions.filter(s => s.isBooked === 1 || s.stage === "BOOKED").length;

      const prompt = `You are a sales coach analyzing SMS conversations for Maids in Black, a cleaning service in Washington DC.\n\nHere are ${sample.length} inbound messages from leads:\n\n${sample.map((m, i) => `${i + 1}. "${m}"`).join("\n")}\n\nContext: ${totalLeads} leads total, ${bookedCount} booked (${totalLeads > 0 ? Math.round((bookedCount / totalLeads) * 100) : 0}% conversion).\n\nIdentify the top 5 objections. Respond in JSON: {"objections":[{"label":string,"pct":number,"tip":string,"example":string}],"topInsight":string}`;

      const response = await invokeLLM({
        messages: [
          { role: "system", content: "You are a sales coach. Respond only with valid JSON." },
          { role: "user", content: prompt },
        ],
        response_format: { type: "json_object" } as any,
      });

      const rawContent = response?.choices?.[0]?.message?.content ?? "{}";
      const raw = typeof rawContent === "string" ? rawContent : JSON.stringify(rawContent);
      const parsed = JSON.parse(raw);
      const result = {
        objections: (parsed.objections ?? []).slice(0, 5),
        topInsight: parsed.topInsight ?? "",
        totalMessagesAnalyzed: sample.length,
      };

      const payload = JSON.stringify(result);
      const existing = await db.select().from(commandCenterCache)
        .where(and(eq(commandCenterCache.cacheKey, "conv_intel"), eq(commandCenterCache.rangeKey, "30d"))).limit(1);
      if (existing[0]) {
        await db.update(commandCenterCache).set({ payload, generatedAt: new Date() })
          .where(and(eq(commandCenterCache.cacheKey, "conv_intel"), eq(commandCenterCache.rangeKey, "30d")));
      } else {
        await db.insert(commandCenterCache).values({ cacheKey: "conv_intel", rangeKey: "30d", payload, generatedAt: new Date() });
      }
      warmed.push("conv_intel:30d");
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    errors.push(`conv_intel:30d: ${msg}`);
    console.error("[WarmCache] conv_intel:30d failed:", msg);
  }

  return { warmed, errors };
}
