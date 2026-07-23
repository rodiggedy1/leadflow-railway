/**
 * conversationContextService.ts
 *
 * Manages per-agent conversation context for Madison.
 * Stores the last readiness projection so follow-up action messages
 * ("acknowledge those", "mark them ok") can resolve the correct targetIds.
 *
 * Concurrency model:
 * - Uses optimistic concurrency via the `version` column.
 * - Every write is a conditional UPDATE: `WHERE agentId = ? AND version = ?`
 * - If the row was updated by another request between read and write, the update
 *   affects 0 rows and we log a warning (non-fatal — context is best-effort).
 * - First write for an agent does an INSERT ... ON DUPLICATE KEY UPDATE.
 *
 * Design principles:
 * - Context is best-effort: failures are logged but never surface to the user.
 * - Context is never used for authorization — only for resolving "those" references.
 * - Context is scoped per agentId (one row per agent).
 */

import { eq, and } from "drizzle-orm";
import { madisonConversationContext } from "../../drizzle/schema";
import type { ReadinessProjection, JobReadinessRow } from "./types";
import { encodeReadinessItemId } from "./acknowledgeService";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface MadisonContext {
  agentId: number;
  activeDomain: string | null;
  resolvedDateStart: string | null;
  resolvedDateEnd: string | null;
  lastProjectionId: string | null;
  /** Encoded ReadinessItemIds from the last readiness response */
  lastReadinessItemIds: string[];
  /** What "those" / "them" refers to in follow-up messages */
  lastSelectionItemIds: string[];
  version: number;
}

export interface ContextWriteResult {
  success: boolean;
  /** true if the write was rejected due to a stale version (concurrent write) */
  staleVersion?: boolean;
}

// ── Encode projection items ───────────────────────────────────────────────────

/**
 * Extract all encodable ReadinessItemIds from a projection.
 * Each job × flag combination becomes one encoded ID.
 */
export function extractItemIdsFromProjection(
  projection: ReadinessProjection
): string[] {
  const ids: string[] = [];
  for (const job of projection.jobs) {
    for (const flag of job.flags) {
      const issueType = flagToIssueType(flag);
      if (issueType) {
        ids.push(
          encodeReadinessItemId({
            jobId: job.jobId,
            serviceDate: projection.date,
            issueType,
          })
        );
      }
    }
  }
  return ids;
}

function flagToIssueType(
  flag: JobReadinessRow["flags"][number]
): string | null {
  switch (flag) {
    case "unassigned":
      return "UNASSIGNED";
    case "unconfirmed":
      return "CUSTOMER_UNCONFIRMED";
    case "no_payment":
      return "PAYMENT_NOT_READY";
    case "double_booked":
      return "SCHEDULE_CONFLICT";
    default:
      return null;
  }
}

// ── Read context ──────────────────────────────────────────────────────────────

export async function getContext(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  agentId: number
): Promise<MadisonContext | null> {
  try {
    const rows = await db
      .select()
      .from(madisonConversationContext)
      .where(eq(madisonConversationContext.agentId, agentId))
      .limit(1);

    if (rows.length === 0) return null;

    const row = rows[0];
    return {
      agentId: row.agentId,
      activeDomain: row.activeDomain ?? null,
      resolvedDateStart: row.resolvedDateStart
        ? (row.resolvedDateStart instanceof Date
            ? row.resolvedDateStart.toISOString().slice(0, 10)
            : String(row.resolvedDateStart))
        : null,
      resolvedDateEnd: row.resolvedDateEnd
        ? (row.resolvedDateEnd instanceof Date
            ? row.resolvedDateEnd.toISOString().slice(0, 10)
            : String(row.resolvedDateEnd))
        : null,
      lastProjectionId: row.lastProjectionId ?? null,
      lastReadinessItemIds: Array.isArray(row.lastReadinessItemIds)
        ? (row.lastReadinessItemIds as string[])
        : [],
      lastSelectionItemIds: Array.isArray(row.lastSelectionItemIds)
        ? (row.lastSelectionItemIds as string[])
        : [],
      version: row.version,
    };
  } catch (err) {
    console.warn("[Madison] getContext failed:", err instanceof Error ? err.message : String(err));
    return null;
  }
}

// ── Write context after a query ───────────────────────────────────────────────

/**
 * Persist context after a successful readiness query.
 * Uses INSERT ... ON DUPLICATE KEY UPDATE for the first write,
 * then conditional UPDATE (version check) for subsequent writes.
 */
export async function saveQueryContext(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  params: {
    agentId: number;
    projection: ReadinessProjection;
    requestId: string;
    currentVersion?: number; // undefined = first write
  }
): Promise<ContextWriteResult> {
  const { agentId, projection, requestId, currentVersion } = params;
  const now = new Date();

  const itemIds = extractItemIdsFromProjection(projection);
  const projectionId = `${projection.date}-${requestId}`;

  try {
    if (currentVersion === undefined) {
      // First write — upsert
      await db
        .insert(madisonConversationContext)
        .values({
          agentId,
          activeDomain: "readiness",
          resolvedDateStart: projection.date,
          resolvedDateEnd: projection.date,
          lastProjectionId: projectionId,
          lastReadinessItemIds: itemIds,
          lastSelectionItemIds: itemIds, // default selection = all items shown
          lastRequestId: requestId,
          version: 1,
          updatedAt: now,
        })
        .onDuplicateKeyUpdate({
          set: {
            activeDomain: "readiness",
            resolvedDateStart: projection.date,
            resolvedDateEnd: projection.date,
            lastProjectionId: projectionId,
            lastReadinessItemIds: itemIds,
            lastSelectionItemIds: itemIds,
            lastRequestId: requestId,
            version: 1,
            updatedAt: now,
          },
        });
      return { success: true };
    }

    // Subsequent write — conditional UPDATE with version check
    const result = await db
      .update(madisonConversationContext)
      .set({
        activeDomain: "readiness",
        resolvedDateStart: projection.date,
        resolvedDateEnd: projection.date,
        lastProjectionId: projectionId,
        lastReadinessItemIds: itemIds,
        lastSelectionItemIds: itemIds,
        lastRequestId: requestId,
        version: currentVersion + 1,
        updatedAt: now,
      })
      .where(
        and(
          eq(madisonConversationContext.agentId, agentId),
          eq(madisonConversationContext.version, currentVersion)
        )
      );

    // MySQL UPDATE returns affectedRows in result[0].affectedRows
    const affectedRows =
      Array.isArray(result) && result[0]
        ? (result[0] as { affectedRows?: number }).affectedRows ?? 0
        : 0;

    if (affectedRows === 0) {
      console.warn(
        `[Madison] saveQueryContext: stale version for agentId=${agentId} version=${currentVersion} — context not updated`
      );
      return { success: false, staleVersion: true };
    }

    return { success: true };
  } catch (err) {
    console.warn(
      "[Madison] saveQueryContext failed:",
      err instanceof Error ? err.message : String(err)
    );
    return { success: false };
  }
}

/**
 * Update context after a successful acknowledgement action.
 * Refreshes lastReadinessItemIds from the updated projection.
 */
export async function saveActionContext(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  params: {
    agentId: number;
    updatedProjection: Awaited<ReturnType<typeof import("./readinessService").computeReadinessSummary>>;
    requestId: string;
    currentVersion?: number;
  }
): Promise<ContextWriteResult> {
  const { agentId, updatedProjection, requestId, currentVersion } = params;
  const now = new Date();

  // Build item IDs from the updated summary's jobs
  const itemIds: string[] = [];
  for (const job of updatedProjection.jobs) {
    // Use acknowledgedIssues to skip already-acked items from selection
    const flags = deriveFlags(job);
    for (const flag of flags) {
      const issueType = flagToIssueType(flag as JobReadinessRow["flags"][number]);
      if (issueType && !job.acknowledgedIssues.includes(issueType)) {
        itemIds.push(
          encodeReadinessItemId({
            jobId: job.id,
            serviceDate: updatedProjection.date,
            issueType,
          })
        );
      }
    }
  }

  try {
    if (currentVersion === undefined) {
      await db
        .insert(madisonConversationContext)
        .values({
          agentId,
          activeDomain: "readiness",
          resolvedDateStart: updatedProjection.date,
          resolvedDateEnd: updatedProjection.date,
          lastProjectionId: `${updatedProjection.date}-${requestId}`,
          lastReadinessItemIds: itemIds,
          lastSelectionItemIds: itemIds,
          lastRequestId: requestId,
          version: 1,
          updatedAt: now,
        })
        .onDuplicateKeyUpdate({
          set: {
            activeDomain: "readiness",
            resolvedDateStart: updatedProjection.date,
            resolvedDateEnd: updatedProjection.date,
            lastProjectionId: `${updatedProjection.date}-${requestId}`,
            lastReadinessItemIds: itemIds,
            lastSelectionItemIds: itemIds,
            lastRequestId: requestId,
            version: 1,
            updatedAt: now,
          },
        });
      return { success: true };
    }

    const result = await db
      .update(madisonConversationContext)
      .set({
        activeDomain: "readiness",
        resolvedDateStart: updatedProjection.date,
        resolvedDateEnd: updatedProjection.date,
        lastProjectionId: `${updatedProjection.date}-${requestId}`,
        lastReadinessItemIds: itemIds,
        lastSelectionItemIds: itemIds,
        lastRequestId: requestId,
        version: currentVersion + 1,
        updatedAt: now,
      })
      .where(
        and(
          eq(madisonConversationContext.agentId, agentId),
          eq(madisonConversationContext.version, currentVersion)
        )
      );

    const affectedRows =
      Array.isArray(result) && result[0]
        ? (result[0] as { affectedRows?: number }).affectedRows ?? 0
        : 0;

    if (affectedRows === 0) {
      console.warn(
        `[Madison] saveActionContext: stale version for agentId=${agentId} version=${currentVersion}`
      );
      return { success: false, staleVersion: true };
    }

    return { success: true };
  } catch (err) {
    console.warn(
      "[Madison] saveActionContext failed:",
      err instanceof Error ? err.message : String(err)
    );
    return { success: false };
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Derive flags from a raw JobRow (from readinessService) for context storage.
 * This mirrors the flag logic in executor.ts but operates on raw summary jobs.
 */
function deriveFlags(job: {
  cleanerProfileId: number | null;
  scheduleConfirmed?: boolean | null;
  hasStripeCard?: boolean | null;
  chargesOnHoldCents?: number | null;
}): string[] {
  const flags: string[] = [];
  if (!job.cleanerProfileId) flags.push("unassigned");
  // Note: confirmation and payment flags require dimension data not available here
  // For context storage, we only track assignment flags from raw job data
  return flags;
}
