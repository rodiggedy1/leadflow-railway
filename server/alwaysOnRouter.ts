/**
 * alwaysOnRouter.ts
 *
 * tRPC procedures for the Always-On Campaign admin UI.
 *
 * Procedures:
 *   alwaysOn.listGroups      → all 4 groups with stats
 *   alwaysOn.getGroupContacts → paginated enrollments for a group
 *   alwaysOn.updateGroup     → edit message template, batch size, isActive
 *   alwaysOn.manualEnroll    → trigger enrollment run now (for backfill)
 *   alwaysOn.groupStats      → aggregate stats per group
 */

import { z } from "zod";
import { protectedProcedure, router } from "./_core/trpc";
import { getDb } from "./db";
import {
  alwaysOnGroups,
  alwaysOnEnrollments,
  type AlwaysOnGroupType,
} from "../drizzle/schema";
import { eq, desc, and, sql } from "drizzle-orm";
import { enrollNewlyEligible, seedDefaultGroups } from "./alwaysOnEngine";
import { TRPCError } from "@trpc/server";

export const alwaysOnRouter = router({
  /**
   * Returns all four always-on groups with their current stats.
   * Seeds default groups if they don't exist yet.
   */
  listGroups: protectedProcedure.query(async () => {
    await seedDefaultGroups();
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

    const groups = await db
      .select()
      .from(alwaysOnGroups)
      .orderBy(alwaysOnGroups.id);

    return groups;
  }),

  /**
   * Returns paginated enrollments for a specific group.
   */
  getGroupContacts: protectedProcedure
    .input(
      z.object({
        groupId: z.number(),
        status: z.enum(["PENDING", "SENT", "REPLIED", "BOOKED", "OPTED_OUT", "SKIPPED", "all"]).default("all"),
        limit: z.number().min(1).max(500).default(100),
        offset: z.number().min(0).default(0),
      })
    )
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const conditions = [eq(alwaysOnEnrollments.groupId, input.groupId)];
      if (input.status !== "all") {
        conditions.push(eq(alwaysOnEnrollments.status, input.status));
      }

      const contacts = await db
        .select()
        .from(alwaysOnEnrollments)
        .where(and(...conditions))
        .orderBy(desc(alwaysOnEnrollments.enrolledAt))
        .limit(input.limit)
        .offset(input.offset);

      // Total count for pagination
      const [countRow] = await db
        .select({ count: sql<number>`count(*)` })
        .from(alwaysOnEnrollments)
        .where(and(...conditions));

      return {
        contacts,
        total: Number(countRow?.count ?? 0),
      };
    }),

  /**
   * Update a group's message template, batch size, or active status.
   */
  updateGroup: protectedProcedure
    .input(
      z.object({
        groupId: z.number(),
        messageTemplate: z.string().min(10).max(1600).optional(),
        batchSize: z.number().min(1).max(500).optional(),
        isActive: z.boolean().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const updates: Record<string, unknown> = {};
      if (input.messageTemplate !== undefined) updates.messageTemplate = input.messageTemplate;
      if (input.batchSize !== undefined) updates.batchSize = input.batchSize;
      if (input.isActive !== undefined) updates.isActive = input.isActive ? 1 : 0;

      if (Object.keys(updates).length === 0) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "No fields to update" });
      }

      await db
        .update(alwaysOnGroups)
        .set(updates)
        .where(eq(alwaysOnGroups.id, input.groupId));

      return { ok: true };
    }),

  /**
   * Manually trigger an enrollment run (useful for backfill or testing).
   * Enrolls all currently eligible completedJobs not yet in any group.
   */
  manualEnroll: protectedProcedure.mutation(async () => {
    const enrolled = await enrollNewlyEligible();
    const total = Object.values(enrolled).reduce((a, b) => a + b, 0);
    return { ok: true, enrolled, total };
  }),

  /**
   * Returns per-group stats breakdown (pending/sent/replied/booked counts).
   */
  groupStats: protectedProcedure
    .input(z.object({ groupId: z.number() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const rows = await db
        .select({
          status: alwaysOnEnrollments.status,
          count: sql<number>`count(*)`,
        })
        .from(alwaysOnEnrollments)
        .where(eq(alwaysOnEnrollments.groupId, input.groupId))
        .groupBy(alwaysOnEnrollments.status);

      const stats: Record<string, number> = {
        PENDING: 0,
        SENT: 0,
        REPLIED: 0,
        BOOKED: 0,
        OPTED_OUT: 0,
        SKIPPED: 0,
      };

      for (const row of rows) {
        stats[row.status] = Number(row.count);
      }

      return stats;
    }),
});
