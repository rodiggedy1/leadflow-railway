/**
 * activityRouter.ts
 *
 * tRPC procedures for the in-app activity notification feed.
 */

import { router, protectedProcedure, opsChatProcedure } from "./_core/trpc";
import { z } from "zod";
import { getDb } from "./db";
import { activityLog } from "../drizzle/schema";
import { desc, gte, isNull } from "drizzle-orm";

export const activityRouter = router({
  /**
   * Get the latest activity feed items.
   * Returns the most recent historical events, newest first.
   */
  getFeed: opsChatProcedure
    .input(z.object({
      limit: z.number().min(1).max(100).default(100),
      sinceDays: z.number().int().min(1).max(365).default(30),
    }).optional())
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return { items: [], unreadCount: 0 };

      const limit = input?.limit ?? 100;
      const sinceDays = input?.sinceDays ?? 30;
      const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);

      const items = await db
        .select()
        .from(activityLog)
        .where(gte(activityLog.createdAt, since))
        .orderBy(desc(activityLog.createdAt))
        .limit(limit);

      // Count unread (readAt is null)
      const unreadCount = items.filter(item => item.readAt === null).length;

      return {
        items: items.map(item => ({
          id: item.id,
          eventType: item.eventType,
          title: item.title,
          body: item.body,
          meta: item.meta ? (() => { try { return JSON.parse(item.meta!); } catch { return {}; } })() : {},
          readAt: item.readAt,
          createdAt: item.createdAt,
        })),
        unreadCount,
      };
    }),

  /**
   * Mark all activity items as read (up to current timestamp).
   */
  markAllRead: protectedProcedure.mutation(async () => {
    const db = await getDb();
    if (!db) return { ok: false };

    await db
      .update(activityLog)
      .set({ readAt: new Date() })
      .where(isNull(activityLog.readAt));

    return { ok: true };
  }),
});
