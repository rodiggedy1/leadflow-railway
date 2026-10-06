/**
 * activityRouter.ts
 *
 * tRPC procedures for the in-app activity notification feed.
 */

import { router, protectedProcedure } from "./_core/trpc";
import { z } from "zod";
import { getDb } from "./db";
import {
  activityLog,
  madisonActionApprovals,
  madisonActionProposals,
  madisonDecisions,
} from "../drizzle/schema";
import { desc, isNull } from "drizzle-orm";

function parseMeta(value: string | null): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function safeString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export const activityRouter = router({
  /**
   * Get the latest activity feed items.
   * Returns up to 50 most recent events, newest first.
   */
  getFeed: protectedProcedure
    .input(z.object({ limit: z.number().min(1).max(100).default(50) }).optional())
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return { items: [], unreadCount: 0 };

      const limit = input?.limit ?? 50;

      const items = await db
        .select()
        .from(activityLog)
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
          meta: parseMeta(item.meta),
          readAt: item.readAt,
          createdAt: item.createdAt,
        })),
        unreadCount,
      };
    }),

  /** Read-only normalized feed for the AI Team Activity page. */
  getAiTeamFeed: protectedProcedure
    .input(z.object({ limit: z.number().min(1).max(100).default(50) }).optional())
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];
      const limit = input?.limit ?? 50;
      const [logs, decisions, proposals, approvals] = await Promise.all([
        db.select().from(activityLog).orderBy(desc(activityLog.createdAt)).limit(limit),
        db.select().from(madisonDecisions).orderBy(desc(madisonDecisions.createdAt)).limit(limit),
        db.select().from(madisonActionProposals).orderBy(desc(madisonActionProposals.createdAt)).limit(limit),
        db.select().from(madisonActionApprovals).orderBy(desc(madisonActionApprovals.createdAt)).limit(limit),
      ]);
      const proposalByDecision = new Map(proposals.map(item => [Number(item.decisionId), item]));
      const approvalByProposal = new Map(approvals.map(item => [Number(item.proposalId), item]));
      const items = [
        ...logs.map(item => {
          const metadata = parseMeta(item.meta);
          return {
            id: `activity:${item.id}`,
            source: "activity_log" as const,
            eventType: item.eventType,
            occurredAt: item.createdAt,
            title: item.title,
            summary: item.body ?? "No additional detail was recorded.",
            status: "completed" as const,
            agent: safeString(metadata.agentName) ?? safeString(metadata.agent) ?? null,
            sessionId: typeof metadata.sessionId === "number" ? metadata.sessionId : null,
            decisionId: null,
            proposalId: null,
            issueId: typeof metadata.issueId === "number" ? metadata.issueId : null,
            metadata,
          };
        }),
        ...decisions.map(decision => {
          const proposal = proposalByDecision.get(Number(decision.id));
          const approval = proposal ? approvalByProposal.get(Number(proposal.id)) : undefined;
          const status = approval?.decision === "APPROVE"
            ? "approved"
            : approval?.decision === "DISMISS"
              ? "resolved"
              : proposal ? "awaiting_approval" : "recorded";
          return {
            id: `madison-decision:${decision.id}`,
            source: "madison_decision" as const,
            eventType: `madison_${decision.disposition.toLowerCase()}`,
            occurredAt: decision.createdAt,
            title: proposal ? "Madison recommended an operational task" : "Madison analyzed a customer message",
            summary: decision.summary,
            status,
            agent: "Madison",
            sessionId: Number(decision.sessionId),
            decisionId: Number(decision.id),
            proposalId: proposal ? Number(proposal.id) : null,
            issueId: approval?.createdIssueId ? Number(approval.createdIssueId) : null,
            metadata: {
              disposition: decision.disposition,
              replyRecommended: Boolean(decision.replyRecommended),
              replyDraft: decision.replyDraft,
              contextUsed: decision.contextUsed,
              uncertainties: decision.uncertainties,
              proposal: proposal ? {
                actionType: proposal.actionType,
                operation: proposal.operation,
                readiness: proposal.readiness,
                status: proposal.status,
                verificationSteps: proposal.verificationSteps,
              } : null,
              approval: approval ? {
                decision: approval.decision,
                correctedBy: approval.correctedBy,
                createdAt: approval.createdAt,
              } : null,
            },
          };
        }),
      ];
      return items
        .sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime())
        .slice(0, limit);
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
