/**
 * metricsRouter — data for the /admin/metrics page.
 *
 * Data sources:
 *   cleaner_jobs          → total jobs, revenue, avg job value, quality (ratings, photos)
 *   completed_jobs        → recurring customer count (frequency + phone)
 *   conversation_sessions → leads, conversion, source breakdown, job type breakdown,
 *                           avg response time, close rate after quote, funnel
 */
import { router, agentProcedure } from "./_core/trpc";
import { z } from "zod";
import { getDb } from "./db";
import { cleanerJobs, completedJobs, conversationSessions, metricsAiAlerts } from "../drizzle/schema";
import { sql } from "drizzle-orm";
import { and, eq, gte, lte, isNotNull, notInArray } from "drizzle-orm";
import { invokeLLM } from "./_core/llm";

// Sources that are NOT leads — same exclusion list used by the Leads list page
const NON_LEAD_SOURCES = [
  "cs_initiated",
  "cs-inbound",
  "cs-inbound-cleaner",
  "hiring_interview",
  "review",
  "review_rebooking",
];

// ── helpers ──────────────────────────────────────────────────────────────────

function dateRangeDates(range: string): { start: Date; end: Date } {
  const end = new Date();
  const start = new Date();
  if (range === "today") {
    start.setHours(0, 0, 0, 0);
  } else if (range === "7d") {
    start.setDate(start.getDate() - 7);
  } else if (range === "30d") {
    start.setDate(start.getDate() - 30);
  } else if (range === "90d") {
    start.setDate(start.getDate() - 90);
  } else {
    // 12 months default
    start.setFullYear(start.getFullYear() - 1);
    start.setDate(1);
  }
  return { start, end };
}

function toYYYYMM(date: Date): string {
  // Use UTC to match how dates are stored in the DB
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(yyyymm: string): string {
  const [y, m] = yyyymm.split("-");
  return new Date(Number(y), Number(m) - 1, 1).toLocaleString("en-US", { month: "short" });
}

/** Normalize raw serviceType strings into 4 clean buckets */
function normalizeServiceType(raw: string | null): string {
  const s = (raw ?? "").toLowerCase();
  if (s.includes("deep")) return "Deep Clean";
  if (s.includes("move") || s.includes("moving")) return "Move Out";
  if (
    s.includes("add-on") || s.includes("addon") || s.includes("extra") ||
    s.includes("window") || s.includes("floor") || s.includes("commercial") ||
    s.includes("post-construction") || s.includes("hourly")
  ) return "Add-ons";
  return "Standard";
}

// ── router ───────────────────────────────────────────────────────────────────

export const metricsRouter = router({
  /**
   * getOverview — KPI cards + monthly time-series + funnel + quality + sources + job types
   */
  getOverview: agentProcedure
    .input(z.object({ range: z.string().default("12m") }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database unavailable");
      const { start, end } = dateRangeDates(input.range);
      const startStr = start.toISOString().slice(0, 10);
      const endStr = end.toISOString().slice(0, 10);

      // ── 1. Jobs + revenue from cleaner_jobs ──────────────────────────────
      const jobRows = await db
        .select({
          jobDate: cleanerJobs.jobDate,
          jobRevenue: cleanerJobs.jobRevenue,
          bookingStatus: cleanerJobs.bookingStatus,
          serviceType: cleanerJobs.serviceType,
          customerRating: cleanerJobs.customerRating,
          photoSubmitted: cleanerJobs.photoSubmitted,
        })
        .from(cleanerJobs)
        .where(
          and(
            gte(cleanerJobs.jobDate, startStr),
            lte(cleanerJobs.jobDate, endStr),
            eq(cleanerJobs.bookingStatus, "completed")
          )
        );

      // ── 2. Recurring customers from completed_jobs ───────────────────────
      const recurringRows = await db
        .select({ frequency: completedJobs.frequency, jobDate: completedJobs.jobDate, phone: completedJobs.phone })
        .from(completedJobs)
        .where(
          and(
            gte(completedJobs.jobDate, startStr),
            lte(completedJobs.jobDate, endStr),
            isNotNull(completedJobs.frequency)
          )
        );

      // ── 3. Leads + conversions from conversation_sessions ────────────────
      const leadRows = await db
        .select({
          createdAt: conversationSessions.createdAt,
          isBooked: conversationSessions.isBooked,
          leadSource: conversationSessions.leadSource,
          messageHistory: conversationSessions.messageHistory,
          serviceType: conversationSessions.serviceType,
          quotedPrice: conversationSessions.quotedPrice,
        })
        .from(conversationSessions)
        .where(
          and(
            gte(conversationSessions.createdAt, start),
            lte(conversationSessions.createdAt, end),
            notInArray(conversationSessions.leadSource, NON_LEAD_SOURCES)
          )
        );

      // ── Build monthly buckets ────────────────────────────────────────────
      const months: string[] = [];
      const cur = new Date(start.getFullYear(), start.getMonth(), 1);
      while (cur <= end) {
        months.push(toYYYYMM(cur));
        cur.setMonth(cur.getMonth() + 1);
      }

      type MonthBucket = { revenue: number; jobs: number; leads: number; booked: number; recurring: number };
      const buckets: Record<string, MonthBucket> = {};
      for (const m of months) {
        buckets[m] = { revenue: 0, jobs: 0, leads: 0, booked: 0, recurring: 0 };
      }

      // Fill jobs + revenue
      for (const row of jobRows) {
        if (!row.jobDate) continue;
        const ym = row.jobDate.slice(0, 7);
        if (!buckets[ym]) continue;
        buckets[ym].jobs += 1;
        buckets[ym].revenue += parseFloat(row.jobRevenue ?? "0") || 0;
      }

      // Fill recurring — distinct customers (by phone) per month
      const recurringPhonesByMonth: Record<string, Set<string>> = {};
      for (const m of months) recurringPhonesByMonth[m] = new Set();
      for (const row of recurringRows) {
        if (!row.jobDate || !row.phone) continue;
        const ym = row.jobDate.slice(0, 7);
        if (!recurringPhonesByMonth[ym]) continue;
        const freq = (row.frequency ?? "").toLowerCase();
        if (freq && freq !== "one-time" && freq !== "one time" && freq !== "onetime") {
          recurringPhonesByMonth[ym].add(row.phone);
        }
      }
      for (const m of months) {
        if (buckets[m]) buckets[m].recurring = recurringPhonesByMonth[m].size;
      }

      // Fill leads + booked
      for (const row of leadRows) {
        if (!row.createdAt) continue;
        const ym = toYYYYMM(new Date(row.createdAt));
        if (!buckets[ym]) continue;
        buckets[ym].leads += 1;
        if (row.isBooked) buckets[ym].booked += 1;
      }

      const monthly = months.map((ym) => ({
        month: monthLabel(ym),
        ym,
        revenue: Math.round(buckets[ym].revenue),
        jobs: buckets[ym].jobs,
        leads: buckets[ym].leads,
        booked: buckets[ym].booked,
        recurring: buckets[ym].recurring,
        conv: buckets[ym].leads > 0 ? Math.round((buckets[ym].booked / buckets[ym].leads) * 100) : 0,
        avg: buckets[ym].jobs > 0 ? Math.round(buckets[ym].revenue / buckets[ym].jobs) : 0,
      }));

      // ── KPI totals ───────────────────────────────────────────────────────
      const totalRevenue = jobRows.reduce((s, r) => s + (parseFloat(r.jobRevenue ?? "0") || 0), 0);
      const totalJobs = jobRows.length;
      const totalLeads = leadRows.length;
      const totalBooked = leadRows.filter((r) => r.isBooked).length;
      const avgJobValue = totalJobs > 0 ? totalRevenue / totalJobs : 0;
      const convRate = totalLeads > 0 ? Math.round((totalBooked / totalLeads) * 100) : 0;

      // ── Quality metrics ──────────────────────────────────────────────────
      const ratedJobs = jobRows.filter((r) => r.customerRating != null);
      const fiveStarJobs = ratedJobs.filter((r) => r.customerRating === 5);
      const photoJobs = jobRows.filter((r) => r.photoSubmitted === 1);
      const fiveStarPct = ratedJobs.length > 0 ? Math.round((fiveStarJobs.length / ratedJobs.length) * 100) : 0;
      const photoPct = totalJobs > 0 ? Math.round((photoJobs.length / totalJobs) * 100) : 0;

      // Rebook rate: recurring / total in completed_jobs range
      const totalCompletedInRange = recurringRows.length;
      const recurringCount = recurringRows.filter((r) => {
        const freq = (r.frequency ?? "").toLowerCase();
        return freq && freq !== "one-time" && freq !== "one time" && freq !== "onetime";
      }).length;
      const rebookRate = totalCompletedInRange > 0 ? Math.round((recurringCount / totalCompletedInRange) * 100) : 0;

      // ── Avg response time (seconds) — first ts in messageHistory ─────────
      let totalResponseSecs = 0;
      let responseCount = 0;
      for (const row of leadRows) {
        if (!row.messageHistory || !row.createdAt) continue;
        try {
          const hist = JSON.parse(row.messageHistory as string) as Array<{ role: string; ts?: number }>;
          const firstMsg = hist[0];
          if (firstMsg?.ts) {
            const sessionMs = new Date(row.createdAt).getTime();
            const diffSecs = (firstMsg.ts - sessionMs) / 1000;
            if (diffSecs >= 0 && diffSecs < 3600) { // cap at 1 hour to exclude outliers
              totalResponseSecs += diffSecs;
              responseCount++;
            }
          }
        } catch { /* skip */ }
      }
      const avgResponseSecs = responseCount > 0 ? Math.round(totalResponseSecs / responseCount) : 0;

      // ── Close rate after quote ───────────────────────────────────────────
      const quotedLeads = leadRows.filter((r) => r.quotedPrice != null && r.quotedPrice !== "");
      const quotedAndBooked = quotedLeads.filter((r) => r.isBooked);
      const closeRateAfterQuote = quotedLeads.length > 0
        ? Math.round((quotedAndBooked.length / quotedLeads.length) * 100)
        : 0;

      // ── Service type breakdown from conversation_sessions ────────────────
      const serviceTypeCounts: Record<string, number> = {};
      for (const row of leadRows) {
        const label = normalizeServiceType(row.serviceType as string | null);
        serviceTypeCounts[label] = (serviceTypeCounts[label] ?? 0) + 1;
      }
      const serviceTypeBreakdown = Object.entries(serviceTypeCounts)
        .map(([name, value]) => ({ name, value }))
        .sort((a, b) => b.value - a.value);

      // ── Lead source breakdown ────────────────────────────────────────────
      const sourceMap: Record<string, { leads: number; booked: number }> = {};
      for (const row of leadRows) {
        const src = row.leadSource ?? "unknown";
        if (!sourceMap[src]) sourceMap[src] = { leads: 0, booked: 0 };
        sourceMap[src].leads += 1;
        if (row.isBooked) sourceMap[src].booked += 1;
      }
      const sources = Object.entries(sourceMap)
        .map(([source, d]) => ({ source, leads: d.leads, booked: d.booked }))
        .sort((a, b) => b.leads - a.leads);

      // ── Funnel ───────────────────────────────────────────────────────────
      let respondedCount = 0;
      for (const row of leadRows) {
        if (!row.messageHistory) continue;
        try {
          const hist = JSON.parse(row.messageHistory as string);
          if (Array.isArray(hist) && hist.some((m: { role: string }) => m.role === "user")) {
            respondedCount++;
          }
        } catch { /* skip */ }
      }
      const funnelBase = totalLeads || 1;
      const funnel = [
        { step: "Leads", value: totalLeads, pct: 100 },
        { step: "Responded", value: respondedCount, pct: Math.round((respondedCount / funnelBase) * 100) },
        { step: "Booked", value: totalBooked, pct: Math.round((totalBooked / funnelBase) * 100) },
      ];

      return {
        monthly,
        kpis: {
          totalRevenue: Math.round(totalRevenue),
          totalJobs,
          totalLeads,
          totalBooked,
          avgJobValue: Math.round(avgJobValue),
          convRate,
        },
        quality: [
          { label: "5-star jobs", value: fiveStarPct },
          { label: "Photo compliance", value: photoPct },
          { label: "Rebook rate", value: rebookRate },
        ],
        operational: {
          avgResponseSecs,
          closeRateAfterQuote,
        },
        serviceTypeBreakdown,
        sources,
        funnel,
      };
    }),

  /**
   * getAiAlerts — 3 AI-generated growth alerts based on real metrics
   * Cached for 1 hour to avoid excessive LLM calls.
   */
  getAiAlerts: agentProcedure
    .input(z.object({ range: z.string().default("12m") }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database unavailable");
      const ONE_HOUR_MS = 60 * 60 * 1000;
      // ── Serve from DB cache if fresh (< 1 hour old) ──────────────────────
      const cached = await db
        .select()
        .from(metricsAiAlerts)
        .where(eq(metricsAiAlerts.range, input.range))
        .orderBy(sql`generatedAt DESC`)
        .limit(1);
      if (cached.length > 0) {
        const age = Date.now() - new Date(cached[0].generatedAt).getTime();
        if (age < ONE_HOUR_MS) {
          try {
            return { alerts: JSON.parse(cached[0].alertsJson) };
          } catch { /* fall through to regenerate */ }
        }
      }
      // ── Generate fresh alerts via LLM ─────────────────────────────────────
      const { start, end } = dateRangeDates(input.range);
      const leadRows = await db
        .select({
          isBooked: conversationSessions.isBooked,
          leadSource: conversationSessions.leadSource,
          createdAt: conversationSessions.createdAt,
        })
        .from(conversationSessions)
        .where(
          and(
            gte(conversationSessions.createdAt, start),
            lte(conversationSessions.createdAt, end),
            notInArray(conversationSessions.leadSource, NON_LEAD_SOURCES)
          )
        );
      const srcMap: Record<string, { leads: number; booked: number }> = {};
      for (const r of leadRows) {
        const src = r.leadSource ?? "unknown";
        if (!srcMap[src]) srcMap[src] = { leads: 0, booked: 0 };
        srcMap[src].leads++;
        if (r.isBooked) srcMap[src].booked++;
      }
      const sourceSummary = Object.entries(srcMap)
        .map(([src, d]) => `${src}: ${d.leads} leads, ${d.booked} booked (${d.leads > 0 ? Math.round((d.booked / d.leads) * 100) : 0}% conv)`)
        .join("\n");
      const totalLeads = leadRows.length;
      const totalBooked = leadRows.filter((r) => r.isBooked).length;
      const convRate = totalLeads > 0 ? Math.round((totalBooked / totalLeads) * 100) : 0;
      const prompt = `You are a business analyst for a home cleaning company. Generate exactly 3 growth alerts. Return JSON with objects: { title, summary, detail, type } where:
- title: short headline (5-7 words)
- summary: one sentence takeaway
- detail: 2-3 sentences with specific numbers, context, and a concrete action to take
- type: "warning" | "positive" | "insight"
Metrics (${input.range} range):
- Total leads: ${totalLeads}
- Total booked: ${totalBooked}
- Overall conversion rate: ${convRate}%
Lead source breakdown:
${sourceSummary}`;
      try {
        const response = await invokeLLM({
          messages: [
            { role: "system", content: "You are a business analyst. Return only valid JSON." },
            { role: "user", content: prompt },
          ],
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "growth_alerts",
              strict: true,
              schema: {
                type: "object",
                properties: {
                  alerts: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        title: { type: "string" },
                        summary: { type: "string" },
                        detail: { type: "string" },
                        type: { type: "string", enum: ["warning", "positive", "insight"] },
                      },
                      required: ["title", "summary", "detail", "type"],
                      additionalProperties: false,
                    },
                  },
                },
                required: ["alerts"],
                additionalProperties: false,
              },
            },
          },
        });
        const rawContent = response.choices[0]?.message?.content;
        const alertsJson = typeof rawContent === "string" ? rawContent : "{}";
        const parsed = JSON.parse(alertsJson);
        const alerts = (parsed.alerts ?? []).slice(0, 3);
        // ── Persist to DB for next request ─────────────────────────────────
        await db.insert(metricsAiAlerts).values({ range: input.range, alertsJson: JSON.stringify(alerts) });
        return { alerts };
      } catch {
        // Return stale cache rather than empty on LLM failure
        if (cached.length > 0) {
          try { return { alerts: JSON.parse(cached[0].alertsJson) }; } catch { /* ignore */ }
        }
        return { alerts: [] };
      }
    }),
});
// ── Background pre-generation helper (called by internalCron) ─────────────────
/**
 * Pre-generates AI alerts for all time ranges and persists them to the DB.
 * Called hourly by internalCron so the Metrics page always serves from cache.
 */
export async function warmMetricsAiAlerts(): Promise<{ generated: number; errors: number }> {
  const RANGES = ["today", "7d", "30d", "90d", "12m"];
  let generated = 0;
  let errors = 0;
  const db = await getDb();
  if (!db) return { generated: 0, errors: RANGES.length };

  for (const range of RANGES) {
    try {
      const { start, end } = dateRangeDates(range);
      const leadRows = await db
        .select({
          isBooked: conversationSessions.isBooked,
          leadSource: conversationSessions.leadSource,
          createdAt: conversationSessions.createdAt,
        })
        .from(conversationSessions)
        .where(
          and(
            gte(conversationSessions.createdAt, start),
            lte(conversationSessions.createdAt, end),
            notInArray(conversationSessions.leadSource, NON_LEAD_SOURCES)
          )
        );
      const srcMap: Record<string, { leads: number; booked: number }> = {};
      for (const r of leadRows) {
        const src = r.leadSource ?? "unknown";
        if (!srcMap[src]) srcMap[src] = { leads: 0, booked: 0 };
        srcMap[src].leads++;
        if (r.isBooked) srcMap[src].booked++;
      }
      const sourceSummary = Object.entries(srcMap)
        .map(([src, d]) => `${src}: ${d.leads} leads, ${d.booked} booked (${d.leads > 0 ? Math.round((d.booked / d.leads) * 100) : 0}% conv)`)
        .join("\n");
      const totalLeads = leadRows.length;
      const totalBooked = leadRows.filter((r) => r.isBooked).length;
      const convRate = totalLeads > 0 ? Math.round((totalBooked / totalLeads) * 100) : 0;
      const prompt = `You are a business analyst for a home cleaning company. Generate exactly 3 growth alerts. Return JSON with objects: { title, summary, detail, type } where:
- title: short headline (5-7 words)
- summary: one sentence takeaway
- detail: 2-3 sentences with specific numbers, context, and a concrete action to take
- type: "warning" | "positive" | "insight"
Metrics (${range} range):
- Total leads: ${totalLeads}
- Total booked: ${totalBooked}
- Overall conversion rate: ${convRate}%
Lead source breakdown:
${sourceSummary}`;
      const response = await invokeLLM({
        messages: [
          { role: "system", content: "You are a business analyst. Return only valid JSON." },
          { role: "user", content: prompt },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "growth_alerts",
            strict: true,
            schema: {
              type: "object",
              properties: {
                alerts: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      title: { type: "string" },
                      summary: { type: "string" },
                      detail: { type: "string" },
                      type: { type: "string", enum: ["warning", "positive", "insight"] },
                    },
                    required: ["title", "summary", "detail", "type"],
                    additionalProperties: false,
                  },
                },
              },
              required: ["alerts"],
              additionalProperties: false,
            },
          },
        },
      });
      const rawContent = response.choices[0]?.message?.content;
      const alertsJson = typeof rawContent === "string" ? rawContent : "{}";
      const parsed = JSON.parse(alertsJson);
      const alerts = (parsed.alerts ?? []).slice(0, 3);
      await db.insert(metricsAiAlerts).values({ range, alertsJson: JSON.stringify(alerts) });
      generated++;
    } catch (err) {
      console.error(`[warmMetricsAiAlerts] Failed for range=${range}:`, err);
      errors++;
    }
  }
  return { generated, errors };
}
