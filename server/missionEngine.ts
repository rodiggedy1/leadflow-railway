/**
 * missionEngine.ts
 *
 * Core lifecycle helpers for the Mission Engine.
 * All mission types (GET_ETA, ACCESS_ISSUE, etc.) call these helpers
 * instead of writing their own DB + SSE logic.
 *
 * Design rules:
 * - createMission is idempotent via activeDedupKey (nullable unique index).
 * - completeMission / cancelMission clear activeDedupKey so a future mission
 *   can be created for the same session+job.
 * - flagMission optionally clears activeDedupKey for terminal failures where
 *   the workflow can be retried.
 * - All mutations broadcast SSE after writing.
 */

import { getDb } from "./db";
import { csMissions } from "../drizzle/schema";
import type { CsMissionStage } from "../drizzle/schema";
import { eq, and, sql } from "drizzle-orm";
import { broadcastOpsUpdate } from "./sseBroadcast";

export type MissionStatus =
  | "active"
  | "waiting"
  | "ready"
  | "sending"
  | "completed"
  | "cancelled"
  | "needs_attention";

export interface CreateMissionParams {
  sessionId: number;
  agentId: number;
  agentName?: string;
  title: string;
  emoji?: string;
  missionType: string;
  jobId?: number;
  cleanerPhone?: string;
  cleanerName?: string;
  customerPhone?: string;
  customerName?: string;
  activeDedupKey?: string;
  stages: CsMissionStage[];
  status?: MissionStatus;
}

/**
 * Creates a new mission row, or returns the existing one if activeDedupKey
 * already exists with an unresolved status (active/waiting/ready/sending).
 *
 * Returns { missionId, created: true } on insert, { missionId, created: false }
 * if a matching unresolved mission already exists.
 *
 * Callers MUST only call handler.onCreate() when created === true.
 */
export async function createMission(
  params: CreateMissionParams
): Promise<{ missionId: number; created: boolean }> {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");

  const now = new Date();

  // If a dedupKey is provided, check for an existing unresolved mission first
  if (params.activeDedupKey) {
    const [existing] = await db
      .select({ id: csMissions.id, status: csMissions.status })
      .from(csMissions)
      .where(eq(csMissions.activeDedupKey, params.activeDedupKey))
      .limit(1);

    if (existing) {
      // Already exists and unresolved — idempotent, do not create again
      return { missionId: existing.id, created: false };
    }
  }

  const [result] = await db.insert(csMissions).values({
    sessionId: params.sessionId,
    agentId: params.agentId,
    agentName: params.agentName ?? null,
    title: params.title,
    emoji: params.emoji ?? null,
    status: params.status ?? "active",
    stages: params.stages as any,
    sortOrder: 0,
    missionType: params.missionType,
    jobId: params.jobId ?? null,
    cleanerPhone: params.cleanerPhone ?? null,
    cleanerName: params.cleanerName ?? null,
    customerPhone: params.customerPhone ?? null,
    customerName: params.customerName ?? null,
    activeDedupKey: params.activeDedupKey ?? null,
    failureReason: null,
    createdAt: now,
    updatedAt: now,
  }) as any;

  const missionId = (result as any).insertId as number;
  broadcastOpsUpdate("cs_mission_update", { sessionId: params.sessionId });
  return { missionId, created: true };
}

/**
 * Updates the stages JSON and optionally the mission status.
 * Always bumps updatedAt.
 */
export async function advanceStages(
  missionId: number,
  stages: CsMissionStage[],
  newStatus?: MissionStatus
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");

  const [existing] = await db
    .select({ sessionId: csMissions.sessionId })
    .from(csMissions)
    .where(eq(csMissions.id, missionId))
    .limit(1);
  if (!existing) throw new Error(`Mission ${missionId} not found`);

  await db
    .update(csMissions)
    .set({
      stages: stages as any,
      ...(newStatus ? { status: newStatus } : {}),
      updatedAt: new Date(),
    } as any)
    .where(eq(csMissions.id, missionId));

  broadcastOpsUpdate("cs_mission_update", { sessionId: existing.sessionId });
}

/**
 * Marks a mission as needs_attention with a reason string.
 * Pass releaseDedupKey: true for terminal failures where the workflow
 * should be retryable (e.g. no_cleaner_phone, no_job_or_cleaner).
 * Leave false for temporary failures where the dedup key should be held
 * (e.g. ambiguous_cleaner_match — agent needs to resolve before retrying).
 */
export async function flagMission(
  missionId: number,
  reason: string,
  options?: { releaseDedupKey?: boolean }
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");

  const [existing] = await db
    .select({ sessionId: csMissions.sessionId })
    .from(csMissions)
    .where(eq(csMissions.id, missionId))
    .limit(1);
  if (!existing) throw new Error(`Mission ${missionId} not found`);

  await db
    .update(csMissions)
    .set({
      status: "needs_attention",
      failureReason: reason,
      ...(options?.releaseDedupKey ? { activeDedupKey: null } : {}),
      updatedAt: new Date(),
    } as any)
    .where(eq(csMissions.id, missionId));

  broadcastOpsUpdate("cs_mission_update", { sessionId: existing.sessionId });
}

/**
 * Completes a mission and clears activeDedupKey so a future mission
 * can be created for the same session+job.
 */
export async function completeMission(missionId: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");

  const [existing] = await db
    .select({ sessionId: csMissions.sessionId })
    .from(csMissions)
    .where(eq(csMissions.id, missionId))
    .limit(1);
  if (!existing) throw new Error(`Mission ${missionId} not found`);

  const now = new Date();
  await db
    .update(csMissions)
    .set({
      status: "completed",
      activeDedupKey: null,
      completedAt: now,
      updatedAt: now,
    } as any)
    .where(eq(csMissions.id, missionId));

  broadcastOpsUpdate("cs_mission_update", { sessionId: existing.sessionId });
}

/**
 * Cancels a mission and clears activeDedupKey.
 */
export async function cancelMission(missionId: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");

  const [existing] = await db
    .select({ sessionId: csMissions.sessionId })
    .from(csMissions)
    .where(eq(csMissions.id, missionId))
    .limit(1);
  if (!existing) throw new Error(`Mission ${missionId} not found`);

  const now = new Date();
  await db
    .update(csMissions)
    .set({
      status: "cancelled",
      activeDedupKey: null,
      updatedAt: now,
    } as any)
    .where(eq(csMissions.id, missionId));

  broadcastOpsUpdate("cs_mission_update", { sessionId: existing.sessionId });
}

/**
 * Atomically transitions a mission from 'ready' to 'sending'.
 * Returns true if the transition succeeded (this process owns the send),
 * false if another process already claimed it.
 *
 * Use this before calling OpenPhone to prevent double-sends on concurrent clicks.
 */
export async function claimSending(missionId: number): Promise<boolean> {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");

  const [result] = await db.execute(
    sql`UPDATE cs_missions
        SET status = 'sending', updatedAt = NOW()
        WHERE id = ${missionId} AND status = 'ready'`
  ) as any;

  return (result as any).affectedRows === 1;
}

/**
 * Reverts a mission from 'sending' back to 'ready' after a failed send.
 */
export async function revertSending(missionId: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");

  const [existing] = await db
    .select({ sessionId: csMissions.sessionId })
    .from(csMissions)
    .where(eq(csMissions.id, missionId))
    .limit(1);

  await db
    .update(csMissions)
    .set({ status: "ready", updatedAt: new Date() } as any)
    .where(and(eq(csMissions.id, missionId), eq(csMissions.status, "sending")));

  if (existing) {
    broadcastOpsUpdate("cs_mission_update", { sessionId: existing.sessionId });
  }
}
