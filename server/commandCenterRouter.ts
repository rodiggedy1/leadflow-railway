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
} from "../drizzle/schema";
import { and, desc, eq, gte, lte, ne, sql, isNotNull, or, isNull } from "drizzle-orm";
import { invokeLLM } from "./_core/llm";
import { sendSms } from "./openphone";
import { notifyNewLeadViaCall } from "./vapiLeadNotification";

// ─── Helpers ──────────────────────────────────────────────────────────────────

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
            ne(conversationSessions.leadSource, "review")
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
            ne(conversationSessions.leadSource, "review")
          )
        );

      const totalLeads = sessions.length;
      const prevLeads = prevSessions.length;

      const bookedSessions = sessions.filter(s => s.stage === "BOOKED" || s.isBooked === 1);
      const prevBooked = prevSessions.filter(s => s.stage === "BOOKED" || s.isBooked === 1).length;

      const bookedRevenue = bookedSessions.reduce((sum, s) => sum + calcRevenue(s), 0);

      // Pipeline value: all non-cold, non-lost, non-booked leads × avg quoted price
      const pipelineSessions = sessions.filter(s =>
        !["BOOKED", "NOT_INTERESTED", "COLD", "REVIEW_REQUESTED", "REVIEW_DONE", "QUALITY_RATING_DONE"].includes(s.stage)
      );
      const avgQuotedPrice = sessions
        .filter(s => s.quotedPrice)
        .reduce((sum, s, _, arr) => sum + parseFloat(s.quotedPrice ?? "0") / arr.length, 0);
      const pipelineValue = Math.round(pipelineSessions.length * (avgQuotedPrice || 180));

      // Response rate: sessions that got past QUOTE_SENT stage
      const respondedStages = ["AVAILABILITY", "SLOT_CHOICE", "TIME_PREF", "ADDRESS", "CONFIRMATION", "CALL_SCHEDULED", "DONE", "BOOKED"];
      const responded = sessions.filter(s => respondedStages.includes(s.stage)).length;
      const responseRate = totalLeads > 0 ? Math.round((responded / totalLeads) * 100) : 0;

      // Lead → Booking conversion
      const conversionRate = totalLeads > 0 ? parseFloat(((bookedSessions.length / totalLeads) * 100).toFixed(1)) : 0;
      const prevConversionRate = prevLeads > 0 ? parseFloat(((prevBooked / prevLeads) * 100).toFixed(1)) : 0;

      // Speed to lead: avg time from createdAt to first AI message
      const speedSessions = sessions.filter(s => s.lastAiMessageAt);
      const avgResponseMinutes = speedSessions.length > 0
        ? Math.round(
            speedSessions.reduce((sum, s) => {
              const created = s.createdAt instanceof Date ? s.createdAt.getTime() : new Date(s.createdAt as string).getTime();
              const replied = s.lastAiMessageAt instanceof Date ? s.lastAiMessageAt.getTime() : new Date(s.lastAiMessageAt as unknown as string).getTime();
              return sum + Math.max(0, (replied - created) / 60000);
            }, 0) / speedSessions.length
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
            ne(conversationSessions.leadSource, "review")
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
    .input(z.object({ limit: z.number().default(8) }))
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
            ne(conversationSessions.leadSource, "review"),
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
            ne(conversationSessions.leadSource, "review")
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
            ne(conversationSessions.leadSource, "review")
          )
        );

      const withResponse = sessions.filter(s => s.lastAiMessageAt);
      const avgFirstResponseMinutes = withResponse.length > 0
        ? Math.round(
            withResponse.reduce((sum, s) => {
              const created = s.createdAt instanceof Date ? s.createdAt.getTime() : new Date(s.createdAt as string).getTime();
              const replied = s.lastAiMessageAt instanceof Date ? s.lastAiMessageAt.getTime() : new Date(s.lastAiMessageAt as unknown as string).getTime();
              return sum + Math.max(0, (replied - created) / 60000);
            }, 0) / withResponse.length
          )
        : 0;

      const contactedUnder2Min = withResponse.filter(s => {
        const created = s.createdAt instanceof Date ? s.createdAt.getTime() : new Date(s.createdAt as string).getTime();
        const replied = s.lastAiMessageAt instanceof Date ? s.lastAiMessageAt.getTime() : new Date(s.lastAiMessageAt as unknown as string).getTime();
        return (replied - created) / 60000 < 2;
      }).length;

      const contactedUnder2MinPct = sessions.length > 0
        ? Math.round((contactedUnder2Min / sessions.length) * 100)
        : 0;

      const avgFollowUpAttempts = sessions.length > 0
        ? parseFloat((sessions.reduce((sum, s) => sum + (s.nudgeCount ?? 0), 0) / sessions.length).toFixed(1))
        : 0;

      return {
        avgFirstResponseMinutes,
        contactedUnder2MinPct,
        avgFollowUpAttempts,
        totalLeads: sessions.length,
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
            ne(conversationSessions.leadSource, "review")
          )
        );

      const totalLeads = sessions.length;
      const booked = sessions.filter(s => s.stage === "BOOKED" || s.isBooked === 1);
      const cold = sessions.filter(s => s.stage === "COLD" || s.stage === "NOT_INTERESTED");
      const unhandled = sessions.filter(s => s.stage === "UNHANDLED");
      const callScheduled = sessions.filter(s => s.stage === "CALL_SCHEDULED");
      const quoteSent = sessions.filter(s => s.stage === "QUOTE_SENT");
      const bookedRevenue = booked.reduce((sum, s) => sum + calcRevenue(s), 0);

      // Response time
      const withResponse = sessions.filter(s => s.lastAiMessageAt);
      const avgResponseMin = withResponse.length > 0
        ? Math.round(withResponse.reduce((sum, s) => {
            const c = s.createdAt instanceof Date ? s.createdAt.getTime() : new Date(s.createdAt as string).getTime();
            const r = s.lastAiMessageAt instanceof Date ? s.lastAiMessageAt.getTime() : new Date(s.lastAiMessageAt as unknown as string).getTime();
            return sum + Math.max(0, (r - c) / 60000);
          }, 0) / withResponse.length)
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
SERVICE TYPES: ${JSON.stringify(serviceCount)}
`.trim();

      try {
        const response = await invokeLLM({
          messages: [
            {
              role: "system",
              content: `You are an AI business analyst for a home cleaning company. 
Analyze the metrics and return a JSON object with exactly this structure:
{
  "pulse": [
    {
      "type": "alert" | "opportunity" | "revenue",
      "title": "short title (5 words max)",
      "body": "2-3 sentence insight with specific numbers",
      "metric": "key metric or dollar amount",
      "action": "specific suggested action (1 sentence)"
    }
  ],
  "actionFeed": [
    {
      "id": "unique_id",
      "title": "action title (4-6 words)",
      "description": "why this matters (1 sentence with numbers)",
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
- Keep titles short and punchy
- estimatedValue must be a string like "+$1,260 est." or "+4 bookings est."
- actionType must be one of the four values listed`,
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
                      },
                      required: ["type", "title", "body", "metric", "action"],
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
                      },
                      required: ["id", "title", "description", "estimatedValue", "actionType", "urgency"],
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
        return parsed as {
          pulse: Array<{ type: string; title: string; body: string; metric: string; action: string }>;
          actionFeed: Array<{ id: string; title: string; description: string; estimatedValue: string; actionType: string; urgency: string }>;
        };
      } catch (err) {
        // Fallback static insights if LLM fails
        console.error("[CommandCenter] AI insights error:", err);
        return {
          pulse: [
            {
              type: "alert",
              title: "Response time check",
              body: `Average first reply is ${avgResponseMin} minutes. Leads replying within 5 minutes convert 3.7x better.`,
              metric: `${avgResponseMin} min avg`,
              action: "Review unhandled leads and ensure AI is responding",
            },
            {
              type: "opportunity",
              title: "Reactivation pool ready",
              body: `${reactivationPool.length} cold leads from the last 90 days match your service area. A targeted SMS could recover several bookings.`,
              metric: `${reactivationPool.length} leads`,
              action: "Launch a reactivation campaign",
            },
            {
              type: "revenue",
              title: "Pipeline value",
              body: `${quoteSent.length} leads have received a quote but haven't replied yet. A follow-up SMS now could convert several.`,
              metric: `${quoteSent.length} open quotes`,
              action: "Send follow-up SMS to all open quotes",
            },
          ],
          actionFeed: [
            {
              id: "call_hot",
              title: `Call ${callScheduled.length} hot leads`,
              description: `${callScheduled.length} leads are in CALL_SCHEDULED stage and expecting your call.`,
              estimatedValue: `+${callScheduled.length * 180} est.`,
              actionType: "trigger_call",
              urgency: "high",
            },
            {
              id: "followup_cold",
              title: "Send follow-up to cold leads",
              description: `${cold.length} leads went cold without booking. A reactivation SMS could recover some.`,
              estimatedValue: "+2 bookings est.",
              actionType: "send_sms",
              urgency: "medium",
            },
            {
              id: "review_unhandled",
              title: "Review unhandled conversations",
              description: `${unhandled.length} conversations need manual review — AI couldn't parse the reply.`,
              estimatedValue: "+1 booking est.",
              actionType: "review_leads",
              urgency: unhandled.length > 0 ? "high" : "low",
            },
            {
              id: "reactivate_pool",
              title: "Reactivate old leads",
              description: `${reactivationPool.length} cold leads from last 90 days haven't been re-engaged.`,
              estimatedValue: "+3 bookings est.",
              actionType: "reactivate",
              urgency: "medium",
            },
          ],
        };
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
});
