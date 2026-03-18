/**
 * Voice Router — tRPC procedures for Vapi voice call data
 *
 * Exposes:
 *   voice.listCalls        — paginated list of all voice calls
 *   voice.getCallsBySession — all calls linked to a session
 *   voice.stats            — aggregate voice stats (calls, avg duration, conversion)
 *   voice.getAssistantId   — returns the current Vapi assistant ID
 */

import { z } from "zod";
import { desc, eq, gte, and, sql } from "drizzle-orm";
import { router, adminAgentProcedure } from "./_core/trpc";
import { getDb } from "./db";
import { voiceCalls } from "../drizzle/schema";
import { getAssistantId } from "./vapiService";

export const voiceRouter = router({
  /**
   * List all voice calls, newest first.
   */
  listCalls: adminAgentProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(100).default(50),
        offset: z.number().min(0).default(0),
      })
    )
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return { calls: [], total: 0 };

      const calls = await db
        .select()
        .from(voiceCalls)
        .orderBy(desc(voiceCalls.createdAt))
        .limit(input.limit)
        .offset(input.offset);

      const [{ count }] = await db
        .select({ count: sql<number>`COUNT(*)` })
        .from(voiceCalls);

      return { calls, total: Number(count) };
    }),

  /**
   * Get all voice calls linked to a specific conversation session.
   */
  getCallsBySession: adminAgentProcedure
    .input(z.object({ sessionId: z.number().int().positive() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];

      return db
        .select()
        .from(voiceCalls)
        .where(eq(voiceCalls.sessionId, input.sessionId))
        .orderBy(desc(voiceCalls.createdAt));
    }),

  /**
   * Aggregate voice stats for the summary cards.
   * Returns total calls, avg duration, booked count, and 7-day daily trend.
   */
  stats: adminAgentProcedure
    .input(
      z.object({
        days: z.number().min(1).max(90).default(30),
      })
    )
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) {
        return {
          totalCalls: 0,
          avgDurationSeconds: 0,
          bookedCount: 0,
          conversionRate: 0,
          dailyTrend: [],
        };
      }

      const since = new Date(Date.now() - input.days * 24 * 60 * 60 * 1000);

      const [totals] = await db
        .select({
          totalCalls: sql<number>`COUNT(*)`,
          avgDuration: sql<number>`AVG(durationSeconds)`,
          bookedCount: sql<number>`SUM(CASE WHEN outcome = 'booked' THEN 1 ELSE 0 END)`,
          quoteGivenCount: sql<number>`SUM(CASE WHEN outcome = 'quote_given' THEN 1 ELSE 0 END)`,
        })
        .from(voiceCalls)
        .where(gte(voiceCalls.createdAt, since));

      const totalCalls = Number(totals.totalCalls ?? 0);
      const avgDurationSeconds = Math.round(Number(totals.avgDuration ?? 0));
      const bookedCount = Number(totals.bookedCount ?? 0);
      const conversionRate = totalCalls > 0 ? Math.round((bookedCount / totalCalls) * 100) : 0;

      // 7-day daily trend
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const dailyRows = await db
        .select({
          date: sql<string>`DATE(createdAt)`,
          count: sql<number>`COUNT(*)`,
        })
        .from(voiceCalls)
        .where(gte(voiceCalls.createdAt, sevenDaysAgo))
        .groupBy(sql`DATE(createdAt)`)
        .orderBy(sql`DATE(createdAt)`);

      // Fill in missing days with 0
      const dailyMap = new Map<string, number>();
      for (const row of dailyRows) {
        dailyMap.set(row.date, Number(row.count));
      }

      const dailyTrend: Array<{ date: string; count: number }> = [];
      for (let i = 6; i >= 0; i--) {
        const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
        const dateStr = d.toISOString().slice(0, 10);
        dailyTrend.push({ date: dateStr, count: dailyMap.get(dateStr) ?? 0 });
      }

      return {
        totalCalls,
        avgDurationSeconds,
        bookedCount,
        conversionRate,
        dailyTrend,
      };
    }),

  /**
   * Returns the current Vapi assistant ID (for the settings page).
   */
  getAssistantId: adminAgentProcedure.query(() => {
    return { assistantId: getAssistantId() };
  }),
});
