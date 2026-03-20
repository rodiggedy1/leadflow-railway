/**
 * campaignApprovalRouter — tRPC procedures for the Campaign Approval workflow.
 *
 * Exposes:
 *   campaignApproval.getPendingBatches  — list all batches awaiting review
 *   campaignApproval.getRecentBatches   — last N batches (any status) for history
 *   campaignApproval.approveBatch       — approve a pending batch and send SMS
 *   campaignApproval.rejectBatch        — reject a pending batch
 *   campaignApproval.generateBatch      — manually trigger batch generation (admin)
 */

import { z } from "zod";
import { desc, eq, or } from "drizzle-orm";
import { protectedProcedure, router } from "./_core/trpc";
import { getDb } from "./db";
import { campaignApprovalBatches } from "../drizzle/schema";
import {
  getPendingBatches,
  approveBatch,
  rejectBatch,
  generatePendingBatches,
} from "./campaignApproval";

export const campaignApprovalRouter = router({
  /**
   * Returns all pending batches awaiting admin review.
   */
  getPendingBatches: protectedProcedure.query(async () => {
    return getPendingBatches();
  }),

  /**
   * Returns the most recent N batches (any status) for the history view.
   */
  getRecentBatches: protectedProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(100).default(20),
      })
    )
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];

      const rows = await db
        .select()
        .from(campaignApprovalBatches)
        .orderBy(desc(campaignApprovalBatches.createdAt))
        .limit(input.limit);

      return rows.map((r) => ({
        ...r,
        enrollmentIds: JSON.parse(r.enrollmentIds) as number[],
        recipientPreview: JSON.parse(r.recipientPreview) as Array<{
          enrollmentId: number;
          phone: string;
          firstName: string | null;
          name: string | null;
          message: string;
        }>,
      }));
    }),

  /**
   * Approve a pending batch. Sends SMS to all recipients.
   */
  approveBatch: protectedProcedure
    .input(
      z.object({
        batchId: z.number().int().positive(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const approvedBy = ctx.user?.name ?? ctx.user?.email ?? "admin";
      return approveBatch(input.batchId, approvedBy);
    }),

  /**
   * Reject a pending batch. Enrollments remain PENDING for the next day.
   */
  rejectBatch: protectedProcedure
    .input(
      z.object({
        batchId: z.number().int().positive(),
        reason: z.string().max(500).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const rejectedBy = ctx.user?.name ?? ctx.user?.email ?? "admin";
      return rejectBatch(input.batchId, rejectedBy, input.reason);
    }),

  /**
   * Manually trigger batch generation for all active groups.
   * Useful for testing the approval workflow without waiting for the cron.
   */
  generateBatch: protectedProcedure.mutation(async () => {
    return generatePendingBatches();
  }),
});
