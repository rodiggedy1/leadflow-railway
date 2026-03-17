/**
 * syncHealthRouter — tRPC procedures for the Sync Health dashboard.
 *
 * Exposes:
 *   syncHealth.getRecentRuns  — last N runs (default 30), optionally filtered by runType
 *   syncHealth.getSummary     — latest run per type + streak counts for the status cards
 *   syncHealth.triggerSync    — manually trigger a nightly sync (admin only, for testing)
 */

import { z } from "zod";
import { desc, eq, and, gte } from "drizzle-orm";
import { protectedProcedure, router } from "./_core/trpc";
import { getDb } from "./db";
import { syncRuns } from "../drizzle/schema";
import { runNightlySync } from "./cronSync";

export const syncHealthRouter = router({
  /**
   * Returns the most recent sync runs, newest first.
   * Optional filter by runType.
   */
  getRecentRuns: protectedProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(100).default(30),
        runType: z.enum(["launch27-sync", "always-on-send"]).optional(),
      })
    )
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];

      const rows = await db
        .select()
        .from(syncRuns)
        .where(input.runType ? eq(syncRuns.runType, input.runType) : undefined)
        .orderBy(desc(syncRuns.startedAt))
        .limit(input.limit);

      return rows.map((r) => ({
        ...r,
        groupBreakdown: r.groupBreakdown ? JSON.parse(r.groupBreakdown) : null,
        enrollmentBreakdown: r.enrollmentBreakdown ? JSON.parse(r.enrollmentBreakdown) : null,
      }));
    }),

  /**
   * Returns a summary for the health status cards:
   *   - Latest run per type (status, timestamp, counts)
   *   - Consecutive success streak for each type
   *   - Last 7 days of runs per type (for the mini sparkline)
   */
  getSummary: protectedProcedure.query(async () => {
    const db = await getDb();
    if (!db) {
      return {
        launch27: null,
        alwaysOn: null,
        launch27Recent: [],
        alwaysOnRecent: [],
      };
    }

    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    // Latest run per type
    const [latestSync] = await db
      .select()
      .from(syncRuns)
      .where(eq(syncRuns.runType, "launch27-sync"))
      .orderBy(desc(syncRuns.startedAt))
      .limit(1);

    const [latestSend] = await db
      .select()
      .from(syncRuns)
      .where(eq(syncRuns.runType, "always-on-send"))
      .orderBy(desc(syncRuns.startedAt))
      .limit(1);

    // Recent 14 runs per type for the history list
    const launch27Recent = await db
      .select()
      .from(syncRuns)
      .where(eq(syncRuns.runType, "launch27-sync"))
      .orderBy(desc(syncRuns.startedAt))
      .limit(14);

    const alwaysOnRecent = await db
      .select()
      .from(syncRuns)
      .where(eq(syncRuns.runType, "always-on-send"))
      .orderBy(desc(syncRuns.startedAt))
      .limit(14);

    // Compute consecutive success streak for each type
    function computeStreak(runs: typeof launch27Recent): number {
      let streak = 0;
      for (const run of runs) {
        if (run.status === "success" || run.status === "skipped") {
          streak++;
        } else {
          break;
        }
      }
      return streak;
    }

    const parseBreakdown = (r: typeof latestSync | undefined) =>
      r
        ? {
            ...r,
            groupBreakdown: r.groupBreakdown ? JSON.parse(r.groupBreakdown) : null,
            enrollmentBreakdown: r.enrollmentBreakdown
              ? JSON.parse(r.enrollmentBreakdown)
              : null,
          }
        : null;

    return {
      launch27: parseBreakdown(latestSync),
      alwaysOn: parseBreakdown(latestSend),
      launch27Streak: computeStreak(launch27Recent),
      alwaysOnStreak: computeStreak(alwaysOnRecent),
      launch27Recent: launch27Recent.map(parseBreakdown),
      alwaysOnRecent: alwaysOnRecent.map(parseBreakdown),
    };
  }),

  /**
   * Manually trigger a nightly sync for a given date (admin only).
   * Useful for backfilling or testing the health log.
   */
  triggerSync: protectedProcedure
    .input(
      z.object({
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD").optional(),
      })
    )
    .mutation(async ({ input }) => {
      const result = await runNightlySync(input.date);
      return result;
    }),
});
