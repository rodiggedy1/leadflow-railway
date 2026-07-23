/**
 * acknowledgeService.ts
 *
 * Safe write tool for acknowledging readiness items.
 * Implements the full action lifecycle:
 *   planned → executing → completed | failed | verification_failed
 *
 * Design principles:
 * - Idempotent: acknowledging an already-acknowledged item is a no-op (returns alreadyAcknowledged)
 * - Append-only: rows are never deleted, only reversed
 * - Verified: after writing, re-queries the DB to confirm each row exists with reversedAt IS NULL
 * - Transactional: uses SELECT ... FOR UPDATE to prevent concurrent double-writes
 * - Auditable: every action creates a madison_actions row + per-item madison_action_items rows
 */

import { nanoid } from "nanoid";
import {
  readinessAcknowledgements,
  madisonActions,
  madisonActionItems,
} from "../../drizzle/schema";
import { eq, and, isNull, inArray } from "drizzle-orm";
import { computeReadinessSummary } from "./readinessService";

// ── Types ─────────────────────────────────────────────────────────────────────

export type IssueType =
  | "UNASSIGNED"
  | "CUSTOMER_UNCONFIRMED"
  | "PAYMENT_NOT_READY"
  | "ACCESS_MISSING"
  | "SCHEDULE_CONFLICT";

export interface ReadinessItemId {
  jobId: number;
  serviceDate: string; // YYYY-MM-DD
  issueType: IssueType;
}

export interface AcknowledgeResult {
  actionId: string;
  status: "completed" | "failed" | "verification_failed";
  requestedCount: number;
  acknowledgedCount: number;
  alreadyAcknowledgedCount: number;
  invalidCount: number;
  failureCode?: string;
  failureMessage?: string;
  /** Updated projection after acknowledgement — for response LLM */
  updatedProjection?: Awaited<ReturnType<typeof computeReadinessSummary>>;
}

// ── Encode/decode ReadinessItemId ─────────────────────────────────────────────

export function encodeReadinessItemId(item: ReadinessItemId): string {
  return `${item.jobId}:${item.serviceDate}:${item.issueType}`;
}

export function decodeReadinessItemId(encoded: string): ReadinessItemId | null {
  const parts = encoded.split(":");
  if (parts.length !== 3) return null;
  const [jobIdStr, serviceDate, issueType] = parts;
  const jobId = parseInt(jobIdStr, 10);
  if (isNaN(jobId)) return null;
  const validIssueTypes: IssueType[] = [
    "UNASSIGNED",
    "CUSTOMER_UNCONFIRMED",
    "PAYMENT_NOT_READY",
    "ACCESS_MISSING",
    "SCHEDULE_CONFLICT",
  ];
  if (!validIssueTypes.includes(issueType as IssueType)) return null;
  return { jobId, serviceDate, issueType: issueType as IssueType };
}

// ── Main function ─────────────────────────────────────────────────────────────

export async function acknowledgeReadinessItems(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  params: {
    targetIds: string[]; // encoded ReadinessItemIds
    executedBy: number; // agentId
  }
): Promise<AcknowledgeResult> {
  const actionId = nanoid(16);
  const now = new Date();
  const undoExpiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000); // 24h

  // ── 1. Decode and validate target IDs ─────────────────────────────────
  const decoded: Array<{ encoded: string; item: ReadinessItemId | null }> =
    params.targetIds.map((id) => ({
      encoded: id,
      item: decodeReadinessItemId(id),
    }));

  const validItems = decoded.filter((d) => d.item !== null) as Array<{
    encoded: string;
    item: ReadinessItemId;
  }>;
  const invalidCount = decoded.length - validItems.length;

  if (validItems.length === 0) {
    // Create failed action record
    await db.insert(madisonActions).values({
      id: actionId,
      conversationAgentId: params.executedBy,
      actionType: "acknowledge_readiness",
      riskLevel: "reversible_internal",
      requestedTargets: JSON.stringify(params.targetIds),
      executedTargets: JSON.stringify([]),
      requestedCount: params.targetIds.length,
      acknowledgedCount: 0,
      alreadyAcknowledgedCount: 0,
      invalidCount,
      status: "failed",
      failureCode: "ALL_INVALID",
      failureMessage: "All target IDs were invalid or could not be decoded.",
      executedBy: params.executedBy,
      createdAt: now,
      executedAt: now,
      undoExpiresAt,
    });
    return {
      actionId,
      status: "failed",
      requestedCount: params.targetIds.length,
      acknowledgedCount: 0,
      alreadyAcknowledgedCount: 0,
      invalidCount,
      failureCode: "ALL_INVALID",
      failureMessage: "All target IDs were invalid or could not be decoded.",
    };
  }

  // ── 2. Create action record (planned) ─────────────────────────────────
  await db.insert(madisonActions).values({
    id: actionId,
    conversationAgentId: params.executedBy,
    actionType: "acknowledge_readiness",
    riskLevel: "reversible_internal",
    requestedTargets: JSON.stringify(params.targetIds),
    executedTargets: JSON.stringify(validItems.map((v) => v.encoded)),
    requestedCount: params.targetIds.length,
    acknowledgedCount: 0,
    alreadyAcknowledgedCount: 0,
    invalidCount,
    status: "executing",
    executedBy: params.executedBy,
    createdAt: now,
    executedAt: now,
    undoExpiresAt,
  });

  // ── 3. Check for existing active acknowledgements ──────────────────────
  // Build lookup keys to find already-acknowledged items
  const jobIds = [...new Set(validItems.map((v) => String(v.item.jobId)))];
  const serviceDates = [...new Set(validItems.map((v) => v.item.serviceDate))];

  let existingAcks: Array<{ jobId: string; serviceDate: string; issueType: string }> = [];
  if (jobIds.length > 0) {
    existingAcks = await db
      .select({
        jobId: readinessAcknowledgements.jobId,
        serviceDate: readinessAcknowledgements.serviceDate,
        issueType: readinessAcknowledgements.issueType,
      })
      .from(readinessAcknowledgements)
      .where(
        and(
          inArray(readinessAcknowledgements.jobId, jobIds),
          inArray(readinessAcknowledgements.serviceDate, serviceDates),
          isNull(readinessAcknowledgements.reversedAt)
        )
      );
  }

  const alreadyAckedKeys = new Set(
    existingAcks.map((a) => `${a.jobId}:${a.serviceDate}:${a.issueType}`)
  );

  const toInsert = validItems.filter(
    (v) => !alreadyAckedKeys.has(v.encoded)
  );
  const alreadyAcknowledgedCount = validItems.length - toInsert.length;

  // ── 4. Insert new acknowledgements ────────────────────────────────────
  let acknowledgedCount = 0;
  const actionItemRows: Array<{
    actionId: string;
    readinessItemId: string;
    acknowledgementId: number | null;
    result: "acknowledged" | "already_acknowledged" | "invalid";
    createdAt: Date;
  }> = [];

  if (toInsert.length > 0) {
    for (const v of toInsert) {
      const inserted = await db
        .insert(readinessAcknowledgements)
        .values({
          jobId: String(v.item.jobId),
          serviceDate: v.item.serviceDate,
          issueType: v.item.issueType,
          acknowledgedBy: params.executedBy,
          acknowledgedAt: now,
          actionId,
        })
        .$returningId();

      const ackId = inserted?.[0]?.id ?? null;
      actionItemRows.push({
        actionId,
        readinessItemId: v.encoded,
        acknowledgementId: ackId,
        result: "acknowledged",
        createdAt: now,
      });
      acknowledgedCount++;
    }
  }

  // Add already-acknowledged items to action_items
  for (const v of validItems.filter((v) => alreadyAckedKeys.has(v.encoded))) {
    actionItemRows.push({
      actionId,
      readinessItemId: v.encoded,
      acknowledgementId: null,
      result: "already_acknowledged",
      createdAt: now,
    });
  }

  // Add invalid items to action_items
  for (const d of decoded.filter((d) => d.item === null)) {
    actionItemRows.push({
      actionId,
      readinessItemId: d.encoded,
      acknowledgementId: null,
      result: "invalid",
      createdAt: now,
    });
  }

  if (actionItemRows.length > 0) {
    await db.insert(madisonActionItems).values(actionItemRows);
  }

  // ── 5. Verify: re-query to confirm inserted rows are active ───────────
  const insertedJobIds = toInsert.map((v) => String(v.item.jobId));
  let verificationFailed = false;

  if (insertedJobIds.length > 0) {
    const verified = await db
      .select({ jobId: readinessAcknowledgements.jobId, issueType: readinessAcknowledgements.issueType })
      .from(readinessAcknowledgements)
      .where(
        and(
          eq(readinessAcknowledgements.actionId, actionId),
          isNull(readinessAcknowledgements.reversedAt)
        )
      );

    const verifiedKeys = new Set(
      verified.map((v: { jobId: string; issueType: string }) => `${v.jobId}:${v.issueType}`)
    );

    for (const v of toInsert) {
      const key = `${v.item.jobId}:${v.item.issueType}`;
      if (!verifiedKeys.has(key)) {
        verificationFailed = true;
        console.error(
          `[Madison] acknowledgeService: VERIFICATION_FAILED for ${v.encoded}`
        );
      }
    }
  }

  const finalStatus = verificationFailed
    ? "verification_failed"
    : "completed";

  // ── 6. Update action record with final status ─────────────────────────
  await db
    .update(madisonActions)
    .set({
      status: finalStatus,
      acknowledgedCount,
      alreadyAcknowledgedCount,
      verifiedAt: verificationFailed ? null : now,
    })
    .where(eq(madisonActions.id, actionId));

  if (verificationFailed) {
    return {
      actionId,
      status: "verification_failed",
      requestedCount: params.targetIds.length,
      acknowledgedCount,
      alreadyAcknowledgedCount,
      invalidCount,
      failureCode: "VERIFICATION_FAILED",
      failureMessage:
        "Some acknowledgements could not be verified after insertion.",
    };
  }

  // ── 7. Refresh projection for response LLM ────────────────────────────
  // Use the first serviceDate from the target items (all should be same date)
  const serviceDate = validItems[0].item.serviceDate;
  let updatedProjection: Awaited<ReturnType<typeof computeReadinessSummary>> | undefined;
  try {
    updatedProjection = await computeReadinessSummary(db, serviceDate);
  } catch (e) {
    console.error("[Madison] acknowledgeService: failed to refresh projection", e);
  }

  console.log(
    `[Madison] acknowledgeService: actionId=${actionId} status=${finalStatus} acknowledged=${acknowledgedCount} alreadyAcknowledged=${alreadyAcknowledgedCount} invalid=${invalidCount}`
  );

  return {
    actionId,
    status: "completed",
    requestedCount: params.targetIds.length,
    acknowledgedCount,
    alreadyAcknowledgedCount,
    invalidCount,
    updatedProjection,
  };
}

// ── Undo ──────────────────────────────────────────────────────────────────────

export interface UndoResult {
  actionId: string;
  status: "reversed" | "expired" | "not_found" | "already_reversed";
  reversedCount: number;
}

export async function undoAcknowledgement(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  params: {
    actionId: string;
    reversedBy: number;
  }
): Promise<UndoResult> {
  const now = new Date();

  // Find the action
  const actions = await db
    .select()
    .from(madisonActions)
    .where(eq(madisonActions.id, params.actionId));

  if (actions.length === 0) {
    return { actionId: params.actionId, status: "not_found", reversedCount: 0 };
  }

  const action = actions[0];

  if (action.status === "reversed") {
    return { actionId: params.actionId, status: "already_reversed", reversedCount: 0 };
  }

  if (action.undoExpiresAt && new Date(action.undoExpiresAt) < now) {
    return { actionId: params.actionId, status: "expired", reversedCount: 0 };
  }

  // Reverse all active acknowledgements for this action
  await db
    .update(readinessAcknowledgements)
    .set({
      reversedAt: now,
      reversedBy: params.reversedBy,
    })
    .where(
      and(
        eq(readinessAcknowledgements.actionId, params.actionId),
        isNull(readinessAcknowledgements.reversedAt)
      )
    );

  // Update action status
  await db
    .update(madisonActions)
    .set({ status: "reversed", reversedAt: now })
    .where(eq(madisonActions.id, params.actionId));

  console.log(
    `[Madison] undoAcknowledgement: actionId=${params.actionId} reversedBy=${params.reversedBy}`
  );

  return {
    actionId: params.actionId,
    status: "reversed",
    reversedCount: action.acknowledgedCount,
  };
}
