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
import { desc, eq, gte, lte, and, sql, inArray } from "drizzle-orm";
import { router, agentProcedure } from "./_core/trpc";
import { getDb } from "./db";
import { voiceCalls, callbackTasks, conversationSessions } from "../drizzle/schema";
import { getAssistantId } from "./vapiService";

export const voiceRouter = router({
  /**
   * List all voice calls, newest first.
   */
  listCalls: agentProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(100).default(50),
        offset: z.number().min(0).default(0),
        /** ISO date string — only return calls on or after this date */
        dateFrom: z.string().optional(),
        /** ISO date string — only return calls on or before this date */
        dateTo: z.string().optional(),
        /** Filter by call outcome, e.g. 'booked', 'callback_requested' */
        outcome: z.string().optional(),
      })
    )
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return { calls: [], total: 0 };

      const conditions = [];
      if (input.dateFrom) conditions.push(gte(voiceCalls.createdAt, new Date(input.dateFrom)));
      if (input.dateTo) {
        const endOfDay = new Date(input.dateTo);
        endOfDay.setHours(23, 59, 59, 999);
        conditions.push(lte(voiceCalls.createdAt, endOfDay));
      }
      if (input.outcome) conditions.push(eq(voiceCalls.outcome, input.outcome));
      const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

      const rows = await db
        .select({
          id: voiceCalls.id,
          vapiCallId: voiceCalls.vapiCallId,
          sessionId: voiceCalls.sessionId,
          callerPhone: voiceCalls.callerPhone,
          durationSeconds: voiceCalls.durationSeconds,
          transcript: voiceCalls.transcript,
          summary: voiceCalls.summary,
          recordingUrl: voiceCalls.recordingUrl,
          outcome: voiceCalls.outcome,
          structuredData: voiceCalls.structuredData,
          endedReason: voiceCalls.endedReason,
          successEvaluation: voiceCalls.successEvaluation,
          createdAt: voiceCalls.createdAt,
          // Caller name from linked conversation session
          callerName: conversationSessions.leadName,
        })
        .from(voiceCalls)
        .leftJoin(conversationSessions, eq(voiceCalls.sessionId, conversationSessions.id))
        .where(whereClause)
        .orderBy(desc(voiceCalls.createdAt))
        .limit(input.limit)
        .offset(input.offset);

      const [{ count }] = await db
        .select({ count: sql<number>`COUNT(*)` })
        .from(voiceCalls)
        .where(whereClause);

      return { calls: rows, total: Number(count) };
    }),

  /**
   * Get all voice calls linked to a specific conversation session.
   */
  getCallsBySession: agentProcedure
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
  stats: agentProcedure
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
      // Use raw SQL with explicit table.column to avoid TiDB only_full_group_by error
      // (Drizzle interpolates column refs differently in SELECT vs GROUP BY)
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const dailyRawResult = await db.execute(
        sql`SELECT LEFT(voice_calls.createdAt, 10) as date, COUNT(*) as count
            FROM voice_calls
            WHERE voice_calls.createdAt >= ${sevenDaysAgo}
            GROUP BY LEFT(voice_calls.createdAt, 10)
            ORDER BY LEFT(voice_calls.createdAt, 10)`
      );
      const dailyRows = (dailyRawResult as unknown as Array<Array<{date: string; count: number}>>)[0] as Array<{date: string; count: number}>;

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
  getAssistantId: agentProcedure.query(() => {
    return { assistantId: getAssistantId() };
  }),

  /**
   * List callback tasks, newest first, joined with their linked voice call.
   */
  listCallbacks: agentProcedure
    .input(z.object({ includeCompleted: z.boolean().default(false) }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];
      const rows = await db
        .select({
          // callback task fields
          id: callbackTasks.id,
          voiceCallId: callbackTasks.voiceCallId,
          sessionId: callbackTasks.sessionId,
          callerPhone: callbackTasks.callerPhone,
          callerName: callbackTasks.callerName,
          preferredCallbackTime: callbackTasks.preferredCallbackTime,
          notes: callbackTasks.notes,
          completed: callbackTasks.completed,
          completedByAgentName: callbackTasks.completedByAgentName,
          completedAt: callbackTasks.completedAt,
          createdAt: callbackTasks.createdAt,
          // linked voice call fields
          callRecordingUrl: voiceCalls.recordingUrl,
          callTranscript: voiceCalls.transcript,
          callSummary: voiceCalls.summary,
          callDurationSeconds: voiceCalls.durationSeconds,
          callOutcome: voiceCalls.outcome,
          callEndedReason: voiceCalls.endedReason,
          vapiCallId: voiceCalls.vapiCallId,
        })
        .from(callbackTasks)
        .leftJoin(voiceCalls, eq(callbackTasks.voiceCallId, voiceCalls.id))
        .where(input.includeCompleted ? undefined : eq(callbackTasks.completed, 0))
        .orderBy(desc(callbackTasks.createdAt));
      return rows;
    }),

  /**
   * Mark a callback task as completed.
   */
  completeCallback: agentProcedure
    .input(z.object({
      id: z.number().int().positive(),
      completedByAgentName: z.string().min(1),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("DB unavailable");
      await db
        .update(callbackTasks)
        .set({
          completed: 1,
          completedByAgentName: input.completedByAgentName,
          completedAt: new Date(),
        })
        .where(eq(callbackTasks.id, input.id));
      return { success: true };
    }),
});
