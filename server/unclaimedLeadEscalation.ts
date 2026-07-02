/**
 * Unclaimed Lead Escalation
 *
 * Runs every minute. Finds new_lead cards in the command channel that:
 *   1. Were posted more than 5 minutes ago
 *   2. Have not been claimed (metadata.claimedBy is null/missing)
 *   3. Have not already had an escalation nudge posted (metadata.escalationPosted = true)
 *
 * For each such lead, posts a ⚠️ nudge message to the command channel and
 * marks the original card's metadata with escalationPosted = true so the
 * nudge fires only once per lead.
 *
 * Duplicate-prevention strategy (two layers):
 *   1. startInternalCron() has a singleton guard — crons are registered once per process.
 *   2. The escalationPosted flag is set via an atomic UPDATE … WHERE JSON_EXTRACT … IS NULL
 *      so that concurrent runs (race condition) cannot both pass the gate.
 *      Only the run whose UPDATE affects 1 row proceeds to insert the nudge.
 */

import { getDb } from "./db";
import { opsChatMessages } from "../drizzle/schema";
import { eq, and, lt, sql } from "drizzle-orm";

const ESCALATION_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes

export async function runUnclaimedLeadEscalation(): Promise<{ checked: number; escalated: number }> {
  const db = await getDb();
  if (!db) return { checked: 0, escalated: 0 };

  const cutoff = new Date(Date.now() - ESCALATION_THRESHOLD_MS);

  // Find all new_lead cards older than 5 minutes that have NOT yet been escalated.
  // We filter escalationPosted at the DB level to reduce candidates to only actionable rows.
  const candidates = await db
    .select()
    .from(opsChatMessages)
    .where(
      and(
        eq(opsChatMessages.channel, "command"),
        eq(opsChatMessages.quickAction, "new_lead"),
        lt(opsChatMessages.createdAt, cutoff),
        // Only rows where escalationPosted is not yet set
        sql`JSON_EXTRACT(${opsChatMessages.metadata}, '$.escalationPosted') IS NULL`
      )
    );

  let escalated = 0;

  for (const card of candidates) {
    let meta: Record<string, unknown> = {};
    try {
      meta = JSON.parse(card.metadata ?? "{}");
    } catch {
      continue;
    }

    // Skip if already claimed
    if (meta.claimedBy) continue;

    // ── Atomic gate: attempt to claim the escalation slot ────────────────────
    // UPDATE the row to set escalationPosted=true ONLY IF it is still NULL.
    // If two concurrent runs both reach this point, only one UPDATE will match
    // (the other will see escalationPosted already set and affect 0 rows).
    const updatedMeta = { ...meta, escalationPosted: true };
    const result = await db
      .update(opsChatMessages)
      .set({ metadata: JSON.stringify(updatedMeta) })
      .where(
        and(
          eq(opsChatMessages.id, card.id),
          // Re-check: only update if escalationPosted is still absent
          sql`JSON_EXTRACT(${opsChatMessages.metadata}, '$.escalationPosted') IS NULL`
        )
      );

    // rowsAffected === 0 means another concurrent run already claimed this slot
    // Drizzle with mysql2 returns [ResultSetHeader, ...] — affectedRows is on index 0
    const affectedRows = (result as unknown as [{ affectedRows: number }])[0]?.affectedRows ?? 1;
    if (affectedRows === 0) continue;

    const leadName = (meta.leadName as string) ?? "A lead";
    const arrivedAt = (meta.arrivedAt as number) ?? card.createdAt.getTime();
    const minutesWaiting = Math.floor((Date.now() - arrivedAt) / 60_000);

    // Post the nudge to the command channel
    await db.insert(opsChatMessages).values({
      cleanerJobId: null,
      channel: "command",
      authorName: "⚠️ Escalation",
      authorRole: "system",
      body: `⚠️ **${leadName}** has been waiting **${minutesWaiting} min** — no one has claimed this lead yet.`,
      mediaUrl: null,
      quickAction: "escalation_nudge",
      metadata: JSON.stringify({
        originalMessageId: card.id,
        leadName,
        minutesWaiting,
      }),
    });

    escalated++;
  }

  return { checked: candidates.length, escalated };
}

/**
 * One-time cleanup: delete all escalation_nudge messages from the command channel.
 * Called once at server startup after the feature was disabled.
 */
export async function purgeEscalationNudges(): Promise<void> {
  try {
    const db = await getDb();
    if (!db) return;
    const { eq } = await import("drizzle-orm");
    await db.delete(opsChatMessages).where(eq(opsChatMessages.quickAction as any, "escalation_nudge"));
    console.log("[UnclaimedLeadEscalation] Purged all escalation_nudge messages.");
  } catch (err) {
    console.error("[UnclaimedLeadEscalation] Failed to purge escalation_nudge messages:", err);
  }
}
