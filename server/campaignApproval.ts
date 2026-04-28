/**
 * campaignApproval.ts
 *
 * Campaign Approval Workflow for Always-On SMS batches.
 *
 * Instead of sending SMS immediately when the daily cron fires, this module:
 *  1. generatePendingBatches() — collects PENDING enrollments per active group,
 *     personalizes preview messages, and creates a campaignApprovalBatch record.
 *  2. approveBatch()  — admin approves a batch; the actual SMS send happens here.
 *  3. rejectBatch()   — admin rejects a batch; enrollments stay PENDING for next day.
 *
 * The internalCron calls generatePendingBatches() at 10 AM ET Mon–Sat instead of
 * calling sendAlwaysOnBatch() directly.
 */

import { getDb } from "./db";
import {
  alwaysOnGroups,
  alwaysOnEnrollments,
  campaignApprovalBatches,
  completedJobs,
  conversationSessions,
  type AlwaysOnGroupType,
} from "../drizzle/schema";
import { eq, and, sql } from "drizzle-orm";
import { sendSms } from "./openphone";
import { personalizeMessage, isWithinTcpaWindow, getNowInET } from "./alwaysOnSend";
import { notifyOwner } from "./_core/notification";
import { logActivity } from "./activityLogger";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RecipientPreviewItem {
  enrollmentId: number;
  phone: string;
  firstName: string | null;
  name: string | null;
  message: string;
}

export interface GenerateBatchResult {
  groupType: string;
  batchId: number;
  recipientCount: number;
  skippedTcpa: boolean;
}

// ─── Generate pending batches ─────────────────────────────────────────────────

/**
 * For each active always-on group, collect PENDING enrollments and create a
 * campaignApprovalBatch record for admin review. Does NOT send any SMS.
 *
 * Called by the internal cron at 10 AM ET Mon–Sat.
 */
export async function generatePendingBatches(
  nowMs: number = Date.now()
): Promise<GenerateBatchResult[]> {
  const results: GenerateBatchResult[] = [];

  // TCPA check — abort if outside window
  if (!isWithinTcpaWindow(nowMs)) {
    const { hour, dayOfWeek } = getNowInET(nowMs);
    console.log(`[CampaignApproval] TCPA window check failed — hour=${hour}, dayOfWeek=${dayOfWeek}. Skipping batch generation.`);
    return results;
  }

  const db = await getDb();
  if (!db) return results;

  // Load all active groups
  const groups = await db
    .select()
    .from(alwaysOnGroups)
    .where(eq(alwaysOnGroups.isActive, 1));

  for (const group of groups) {
    // Pick up to batchSize PENDING enrollments for this group
    const pending = await db
      .select()
      .from(alwaysOnEnrollments)
      .where(
        and(
          eq(alwaysOnEnrollments.groupId, group.id),
          eq(alwaysOnEnrollments.status, "PENDING")
        )
      )
      .limit(group.batchSize);

    if (pending.length === 0) {
      console.log(`[CampaignApproval] Group "${group.name}": no PENDING enrollments, skipping batch.`);
      continue;
    }

    // Build preview (first 5 personalized messages for the admin to review)
    const previewItems: RecipientPreviewItem[] = pending.slice(0, 5).map((e) => ({
      enrollmentId: e.id,
      phone: e.phone,
      firstName: e.firstName ?? null,
      name: e.name ?? null,
      message: personalizeMessage(group.messageTemplate, {
        firstName: e.firstName,
        lastBookingPrice: e.lastBookingPrice,
        discountPct: e.discountPct,
      }),
    }));

    const enrollmentIds = pending.map((e) => e.id);

    // Create the pending approval batch
    const [insertResult] = await db.insert(campaignApprovalBatches).values({
      groupId: group.id,
      groupType: group.groupType,
      groupName: group.name,
      messageTemplate: group.messageTemplate,
      enrollmentIds: JSON.stringify(enrollmentIds),
      recipientCount: pending.length,
      recipientPreview: JSON.stringify(previewItems),
      status: "pending",
    });

    const batchId = (insertResult as any).insertId as number;

    console.log(`[CampaignApproval] Created pending batch #${batchId} for group "${group.name}" — ${pending.length} recipients.`);

    results.push({
      groupType: group.groupType,
      batchId,
      recipientCount: pending.length,
      skippedTcpa: false,
    });
  }

  // Notify owner if any batches were created
  if (results.length > 0) {
    const totalRecipients = results.reduce((sum, r) => sum + r.recipientCount, 0);
    const summary = results.map((r) => `${r.groupType}: ${r.recipientCount}`).join(", ");
    try {
      await notifyOwner({
        title: `📋 Campaign batch ready for approval — ${totalRecipients} recipients`,
        content: `${results.length} group(s) have pending SMS batches awaiting your review. ${summary}. Go to Campaigns → Always-On to approve.`,
      });
    } catch {
      // Non-fatal
    }

    logActivity({
      eventType: "always_on_batch",
      title: `📋 Campaign batch pending approval — ${totalRecipients} recipients`,
      body: `${results.length} group(s) ready for review. ${summary}`,
      meta: { batches: results },
    }).catch(() => {});
  }

  return results;
}

// ─── Approve batch ────────────────────────────────────────────────────────────

/**
 * Admin approves a pending batch. Sends the SMS to all enrolled recipients.
 * Returns counts of sent/failed.
 */
export async function approveBatch(
  batchId: number,
  approvedBy: string
): Promise<{ sent: number; failed: number; error?: string }> {
  const db = await getDb();
  if (!db) return { sent: 0, failed: 0, error: "DB unavailable" };

  // Load the batch
  const [batch] = await db
    .select()
    .from(campaignApprovalBatches)
    .where(eq(campaignApprovalBatches.id, batchId))
    .limit(1);

  if (!batch) return { sent: 0, failed: 0, error: "Batch not found" };
  if (batch.status !== "pending") return { sent: 0, failed: 0, error: `Batch is already ${batch.status}` };

  // Load the group for the message template
  const [group] = await db
    .select()
    .from(alwaysOnGroups)
    .where(eq(alwaysOnGroups.id, batch.groupId))
    .limit(1);

  if (!group) return { sent: 0, failed: 0, error: "Group not found" };

  // Mark as approved
  await db
    .update(campaignApprovalBatches)
    .set({ status: "approved", reviewedBy: approvedBy, reviewedAt: new Date() })
    .where(eq(campaignApprovalBatches.id, batchId));

  // Load the actual enrollments
  const enrollmentIds: number[] = JSON.parse(batch.enrollmentIds);
  const enrollments = await db
    .select()
    .from(alwaysOnEnrollments)
    .where(
      and(
        eq(alwaysOnEnrollments.groupId, batch.groupId),
        eq(alwaysOnEnrollments.status, "PENDING")
      )
    )
    .limit(enrollmentIds.length + 50); // slight buffer in case of concurrent changes

  // Filter to only the IDs in this batch
  const batchEnrollments = enrollments.filter((e) => enrollmentIds.includes(e.id));

  let sent = 0;
  let failed = 0;

  for (const enrollment of batchEnrollments) {
    const message = personalizeMessage(group.messageTemplate, {
      firstName: enrollment.firstName,
      lastBookingPrice: enrollment.lastBookingPrice,
      discountPct: enrollment.discountPct,
    });

    const sendResult = await sendSms({ to: enrollment.phone, content: message });

    if (sendResult.success) {
      // Look up address for session pre-population
      let knownAddress: string | null = null;
      try {
        const jobRow = await db
          .select({ address: completedJobs.address })
          .from(completedJobs)
          .where(eq(completedJobs.id, enrollment.completedJobId))
          .limit(1);
        knownAddress = jobRow[0]?.address ?? null;
      } catch {
        // Non-fatal
      }

      // Create conversation session
      let sessionId: number | null = null;
      try {
        const [sessionResult] = await db.insert(conversationSessions).values({
          leadPhone: enrollment.phone,
          leadName: enrollment.name ?? enrollment.firstName ?? "",
          stage: "REACTIVATION",
          leadSource: `always-on:${group.groupType}`,
          reactivationLastPrice: enrollment.lastBookingPrice
            ? Math.round(enrollment.lastBookingPrice / 100)
            : null,
          reactivationDiscountPct: enrollment.discountPct ?? 10,
          messageHistory: "[]",
          aiMode: 1,
          isBooked: 0,
          address: knownAddress ?? undefined,
        });
        sessionId = (sessionResult as any).insertId as number;
      } catch (err) {
        console.error(`[CampaignApproval] Failed to create session for ${enrollment.phone}:`, err);
      }

      await db
        .update(alwaysOnEnrollments)
        .set({
          status: "SENT",
          sentAt: new Date(),
          openPhoneMessageId: sendResult.messageId ?? null,
          sessionId: sessionId ?? undefined,
        })
        .where(eq(alwaysOnEnrollments.id, enrollment.id));

      sent++;
    } else {
      await db
        .update(alwaysOnEnrollments)
        .set({ status: "FAILED" })
        .where(eq(alwaysOnEnrollments.id, enrollment.id));
      failed++;
    }
  }

  // Update group sentCount
  if (sent > 0) {
    await db
      .update(alwaysOnGroups)
      .set({ sentCount: sql`${alwaysOnGroups.sentCount} + ${sent}` })
      .where(eq(alwaysOnGroups.id, batch.groupId));
  }

  // Mark batch as sent
  await db
    .update(campaignApprovalBatches)
    .set({ status: "sent", sentCount: sent, failedCount: failed, sentAt: new Date() })
    .where(eq(campaignApprovalBatches.id, batchId));

  console.log(`[CampaignApproval] Batch #${batchId} approved by ${approvedBy} — sent: ${sent}, failed: ${failed}`);

  logActivity({
    eventType: "always_on_batch",
    title: `✅ Campaign batch #${batchId} sent — ${sent} SMS`,
    body: `Approved by ${approvedBy}. Sent: ${sent}, failed: ${failed}.`,
    meta: { batchId, sent, failed, approvedBy },
  }).catch(() => {});

  return { sent, failed };
}

// ─── Reject batch ─────────────────────────────────────────────────────────────

/**
 * Admin rejects a pending batch. Enrollments remain PENDING for the next day.
 */
export async function rejectBatch(
  batchId: number,
  rejectedBy: string,
  reason?: string
): Promise<{ ok: boolean; error?: string }> {
  const db = await getDb();
  if (!db) return { ok: false, error: "DB unavailable" };

  const [batch] = await db
    .select()
    .from(campaignApprovalBatches)
    .where(eq(campaignApprovalBatches.id, batchId))
    .limit(1);

  if (!batch) return { ok: false, error: "Batch not found" };
  if (batch.status !== "pending") return { ok: false, error: `Batch is already ${batch.status}` };

  await db
    .update(campaignApprovalBatches)
    .set({
      status: "rejected",
      reviewedBy: rejectedBy,
      reviewedAt: new Date(),
      rejectionReason: reason ?? null,
    })
    .where(eq(campaignApprovalBatches.id, batchId));

  console.log(`[CampaignApproval] Batch #${batchId} rejected by ${rejectedBy}. Reason: ${reason ?? "none"}`);

  logActivity({
    eventType: "always_on_batch",
    title: `❌ Campaign batch #${batchId} rejected`,
    body: `Rejected by ${rejectedBy}. Reason: ${reason ?? "none"}. Enrollments remain PENDING for tomorrow.`,
    meta: { batchId, rejectedBy, reason },
  }).catch(() => {});

  return { ok: true };
}

// ─── Get pending batches ──────────────────────────────────────────────────────

/**
 * Returns all pending batches with parsed preview data.
 */
export async function getPendingBatches() {
  const db = await getDb();
  if (!db) return [];

  const rows = await db
    .select()
    .from(campaignApprovalBatches)
    .where(eq(campaignApprovalBatches.status, "pending"))
    .orderBy(campaignApprovalBatches.createdAt);

  return rows.map((r) => ({
    ...r,
    enrollmentIds: JSON.parse(r.enrollmentIds) as number[],
    recipientPreview: JSON.parse(r.recipientPreview) as RecipientPreviewItem[],
  }));
}
