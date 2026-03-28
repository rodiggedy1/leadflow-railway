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
 */

import { getDb } from "./db";
import { opsChatMessages } from "../drizzle/schema";
import { eq, and, isNull, lt } from "drizzle-orm";

const ESCALATION_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes

export async function runUnclaimedLeadEscalation(): Promise<{ checked: number; escalated: number }> {
  const db = await getDb();
  if (!db) return { checked: 0, escalated: 0 };

  const cutoff = new Date(Date.now() - ESCALATION_THRESHOLD_MS);

  // Find all new_lead cards older than 5 minutes
  const candidates = await db
    .select()
    .from(opsChatMessages)
    .where(
      and(
        eq(opsChatMessages.channel, "command"),
        eq(opsChatMessages.quickAction, "new_lead"),
        lt(opsChatMessages.createdAt, cutoff),
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

    // Skip if escalation already posted
    if (meta.escalationPosted) continue;

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

    // Mark the original card so we don't fire again
    const updatedMeta = { ...meta, escalationPosted: true };
    await db
      .update(opsChatMessages)
      .set({ metadata: JSON.stringify(updatedMeta) })
      .where(eq(opsChatMessages.id, card.id));

    escalated++;
  }

  return { checked: candidates.length, escalated };
}
