/**
 * activityRouter.ts
 *
 * tRPC procedures for the in-app activity notification feed.
 */

import { router, protectedProcedure, opsChatProcedure } from "./_core/trpc";
import { z } from "zod";
import { getDb } from "./db";
import { activityLog, madisonMessageUnderstanding, madisonSmsDrafts } from "../drizzle/schema";
import { madisonSmsActionApprovals } from "./madisonActionApprovalStore";
import { getBusinessDayStart } from "./businessTime";
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
      if (!db) return { items: [], unreadCount: 0, todayActions: 0, todayLeadsAnswered: 0 };

      const limit = input?.limit ?? 100;
      const sinceDays = input?.sinceDays ?? 30;
      const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);
      const todayStart = getBusinessDayStart();

      const [approvedReplies, approvedTasks] = await Promise.all([
        db.select({
          id: madisonSmsDrafts.id,
          senderName: madisonSmsDrafts.senderName,
          approvedText: madisonSmsDrafts.approvedText,
          generatedDraft: madisonSmsDrafts.generatedDraft,
          originalMessage: madisonSmsDrafts.originalMessage,
          approvedBy: madisonSmsDrafts.approvedBy,
          approvedAt: madisonSmsDrafts.approvedAt,
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
          incomingMessage: madisonSmsActionApprovals.incomingMessage,
          title: madisonSmsActionApprovals.title,
          task: madisonSmsActionApprovals.task,
          recommendation: madisonSmsActionApprovals.recommendation,
          status: madisonSmsActionApprovals.status,
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
          meta: {
            kind: "madison_reply",
            draftId: reply.id,
            originalMessage: reply.originalMessage,
            generatedDraft: reply.generatedDraft,
            approvedText: reply.approvedText ?? reply.generatedDraft,
            edited: Boolean(reply.approvedText && reply.generatedDraft && reply.approvedText !== reply.generatedDraft),
            approvedBy: reply.approvedBy,
            approvedAt: reply.approvedAt,
            sentAt: reply.sentAt,
            deliveredAt: reply.deliveredAt,
          },
          readAt: null,
          createdAt: reply.sentAt ?? reply.deliveredAt,
        })),
        ...approvedTasks.map(task => ({
          id: -task.id,
          eventType: "ai_sms_sent" as const,
          title: `Madison task approved${task.customerName ? ` — ${task.customerName}` : ""}`,
          body: `${task.task}. ${task.recommendation}`,
          meta: {
            kind: "madison_task",
            approvalId: task.id,
            issueId: task.issueId,
            incomingMessage: task.incomingMessage,
            title: task.title,
            task: task.task,
            recommendation: task.recommendation,
            status: task.status,
            approvedBy: task.approvedBy,
            approvedAt: task.approvedAt,
          },
          readAt: null,
          createdAt: task.approvedAt,
        })),
      ]
        .filter(item => item.createdAt !== null)
        .sort((a, b) => b.createdAt!.getTime() - a.createdAt!.getTime())
        .slice(0, limit);

      const todayReplies = approvedReplies.filter(reply => reply.sentAt && reply.sentAt >= todayStart).length;
      const todayTasks = approvedTasks.filter(task => task.approvedAt && task.approvedAt >= todayStart).length;

      return {
        items,
        unreadCount: 0,
        todayActions: todayReplies + todayTasks,
        todayLeadsAnswered: todayReplies,
      };
    }),

  /** Read-only shadow understanding for an Activity drawer item. */
  getShadowPrediction: opsChatProcedure
    .input(z.object({ draftId: z.number().int().positive() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return null;
      const [prediction] = await db
        .select({
          id: madisonMessageUnderstanding.id,
          sourceMessageId: madisonMessageUnderstanding.sourceMessageId,
          draftId: madisonMessageUnderstanding.draftId,
          primaryCategory: madisonMessageUnderstanding.primaryCategory,
          categories: madisonMessageUnderstanding.categories,
          mission: madisonMessageUnderstanding.mission,
          missionState: madisonMessageUnderstanding.missionState,
          nextBestAction: madisonMessageUnderstanding.nextBestAction,
          confidence: madisonMessageUnderstanding.confidence,
          knownFacts: madisonMessageUnderstanding.knownFacts,
          missingFacts: madisonMessageUnderstanding.missingFacts,
          model: madisonMessageUnderstanding.model,
          classifierVersion: madisonMessageUnderstanding.classifierVersion,
          extractionStatus: madisonMessageUnderstanding.extractionStatus,
          extractionQualityNote: madisonMessageUnderstanding.extractionQualityNote,
          createdAt: madisonMessageUnderstanding.createdAt,
        })
        .from(madisonMessageUnderstanding)
        .where(eq(madisonMessageUnderstanding.draftId, input.draftId))
        .limit(1);
      return prediction ?? null;
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
