/**
 * missedCallsRouter — /admin/missed-calls
 *
 * Procedures:
 *   listMissedCalls   — paginated list with optional filter (all/pending/resolved)
 *   getPendingCount   — lightweight count for the header badge
 *   markCalledBack    — mark a row as resolved with optional agent name + note
 *   undoCalledBack    — undo a call-back mark
 */
import { z } from "zod";
import { router, agentProcedure } from "./_core/trpc";
import { TRPCError } from "@trpc/server";
import { getDb } from "./db";
import { missedCalls } from "../drizzle/schema";
import { eq, desc, and, gte, sql } from "drizzle-orm";

export const missedCallsRouter = router({
  listMissedCalls: agentProcedure
    .input(
      z.object({
        filter: z.enum(["all", "pending", "resolved"]).default("all"),
        limit: z.number().int().min(1).max(200).default(100),
        offset: z.number().int().min(0).default(0),
      })
    )
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      const conditions = [];
      if (input.filter === "pending") conditions.push(eq(missedCalls.calledBack, 0));
      else if (input.filter === "resolved") conditions.push(eq(missedCalls.calledBack, 1));
      return db
        .select()
        .from(missedCalls)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(missedCalls.calledAt))
        .limit(input.limit)
        .offset(input.offset);
    }),

  getPendingCount: agentProcedure
    .input(z.object({ todayOnly: z.boolean().default(false) }).optional())
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return { count: 0 };
      const conditions: any[] = [eq(missedCalls.calledBack, 0)];
      if (input?.todayOnly) {
        // Start of today in business timezone (reuses the same pattern as internalCron.ts)
        const { ENV } = await import("./_core/env");
        const todayStart = new Date(
          new Date().toLocaleDateString("en-US", { timeZone: ENV.businessTimezone })
        );
        conditions.push(gte(missedCalls.calledAt, todayStart));
      }
      const [row] = await db
        .select({ count: sql<number>`COUNT(*)` })
        .from(missedCalls)
        .where(and(...conditions));
      return { count: Number(row?.count ?? 0) };
    }),

  markCalledBack: agentProcedure
    .input(
      z.object({
        id: z.number().int().positive(),
        agentName: z.string().min(1).max(128),
        notes: z.string().max(2000).optional(),
      })
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      await db
        .update(missedCalls)
        .set({ calledBack: 1, calledBackAt: new Date(), calledBackByAgentName: input.agentName, notes: input.notes ?? null })
        .where(eq(missedCalls.id, input.id));
      // Broadcast so CommandChat pill decrements in real time for all agents
      const { broadcastOpsUpdate } = await import("./sseBroadcast");
      broadcastOpsUpdate("missed_call_resolved" as any);
      return { success: true };
    }),

  undoCalledBack: agentProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      await db
        .update(missedCalls)
        .set({ calledBack: 0, calledBackAt: null, calledBackByAgentName: null })
        .where(eq(missedCalls.id, input.id));
      // Broadcast so CommandChat pill increments back in real time
      const { broadcastOpsUpdate } = await import("./sseBroadcast");
      broadcastOpsUpdate("missed_call_resolved" as any);
      return { success: true };
    }),
});
