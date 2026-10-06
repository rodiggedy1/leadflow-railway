/**
 * activityRouter.ts
 *
 * tRPC procedures for the in-app activity notification feed.
 */

import { router, protectedProcedure, opsChatProcedure } from "./_core/trpc";
import { z } from "zod";
import { getDb } from "./db";
import { activityLog, madisonSmsDrafts } from "../drizzle/schema";
import { madisonSmsActionApprovals } from "./madisonActionApprovalStore";
import { and, eq, gte, inArray, isNull } from "drizzle-orm";

export const activityRouter = router({
  /**
   * Get Madison's historical approved actions.
   * Generic activity such as new leads and bookings is intentionally excluded.
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

      const [approvedReplies, approvedTasks] = await Promise.all([
        db.select({
          id: madisonSmsDrafts.id,
          senderName: madisonSmsDrafts.senderName,
          approvedText: madisonSmsDrafts.approvedText,
          generatedDraft: madisonSmsDrafts.generatedDraft,
          originalMessage: madisonSmsDrafts.originalMessage,
          approvedBy: madisonSmsDrafts.approvedBy,
          sentAt: madisonSmsDrafts.sentAt,
          deliveredAt: madisonSmsDrafts.deliveredAt,
        })
          .from(madisonSmsDrafts)
          .where(and(
            inArray(madisonSmsDrafts.status, ["SENT", "DELIVERED"]),
            gte(madisonSmsDrafts.sentAt, since),
          )),
        db.select({
          id: madisonSmsActionApprovals.id,
          customerName: madisonSmsActionApprovals.customerName,
          task: madisonSmsActionApprovals.task,
          recommendation: madisonSmsActionApprovals.recommendation,
          approvedBy: madisonSmsActionApprovals.approvedBy,
          approvedAt: madisonSmsActionApprovals.approvedAt,
          issueId: madisonSmsActionApprovals.issueId,
        })
          .from(madisonSmsActionApprovals)
          .where(and(
            eq(madisonSmsActionApprovals.status, "APPROVED"),
            gte(madisonSmsActionApprovals.approvedAt, since),
          )),
      ]);

      const items = [
        ...approvedReplies.map(reply => ({
          id: reply.id,
          eventType: "ai_sms_sent" as const,
          title: `Madison sent approved reply${reply.senderName ? ` — ${reply.senderName}` : ""}`,
          body: reply.approvedText ?? reply.generatedDraft ?? reply.originalMessage,
          meta: { kind: "madison_reply", draftId: reply.id, approvedBy: reply.approvedBy },
          readAt: null,
          createdAt: reply.sentAt ?? reply.deliveredAt,
        })),
        ...approvedTasks.map(task => ({
          id: -task.id,
          eventType: "ai_sms_sent" as const,
          title: `Madison task approved${task.customerName ? ` — ${task.customerName}` : ""}`,
          body: `${task.task}. ${task.recommendation}`,
          meta: { kind: "madison_task", approvalId: task.id, issueId: task.issueId, approvedBy: task.approvedBy },
          readAt: null,
          createdAt: task.approvedAt,
        })),
      ]
        .filter(item => item.createdAt !== null)
        .sort((a, b) => b.createdAt!.getTime() - a.createdAt!.getTime())
        .slice(0, limit);

      return { items, unreadCount: 0 };
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
