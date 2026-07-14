/**
 * appendCampaignMessage.ts
 *
 * Appends a successfully-sent outbound campaign SMS to the canonical
 * conversation session's messageHistory, making it a first-class message.
 *
 * This ensures:
 *   - lastMessageRole = "assistant" (we sent last)
 *   - unreadCount recalculates to 0 (lastReadAt = sentAt)
 *   - The lead no longer appears in the Unread filter
 *
 * Safety guarantees:
 *   - Uses a MySQL transaction with SELECT ... FOR UPDATE to prevent
 *     concurrent read-modify-write races with inbound webhooks.
 *   - Deduplicates using the exact OpenPhone message ID only — no fuzzy matching.
 *   - Skips and logs when openPhoneMessageId is absent.
 *   - Updates messageHistory and all 5 computeSessionSummary fields atomically.
 */

import { eq } from "drizzle-orm";
import type { MySql2Database } from "drizzle-orm/mysql2";
import { conversationSessions } from "../../drizzle/schema";
import { computeSessionSummary } from "../sessionSummary";

export interface AppendCampaignMessageParams {
  db: MySql2Database<Record<string, never>>;
  /** Exact session ID — always pass the known session, never look up by phone. */
  sessionId: number;
  /** The exact personalized message text that was sent. */
  message: string;
  /** Unix ms timestamp captured immediately after the provider confirmed success. */
  sentAt: number;
  /** Campaign type tag written into the history entry for traceability. */
  source: "reactivation" | "always_on" | "command_center";
  /** OpenPhone message ID — required for exact deduplication. */
  openPhoneMessageId: string;
}

/**
 * Appends one outbound campaign message to a conversation session's history.
 *
 * Idempotent: calling this twice with the same openPhoneMessageId is safe —
 * the second call detects the duplicate and exits without writing.
 */
export async function appendOutboundCampaignMessageToSession(
  params: AppendCampaignMessageParams,
): Promise<void> {
  const { db, sessionId, message, sentAt, source, openPhoneMessageId } = params;

  await db.transaction(async (tx) => {
    // Lock the row so concurrent inbound webhooks or other writes cannot
    // read stale history between our SELECT and UPDATE.
    const [session] = await (tx as any)
      .select({
        id: conversationSessions.id,
        messageHistory: conversationSessions.messageHistory,
      })
      .from(conversationSessions)
      .where(eq(conversationSessions.id, sessionId))
      .for("update")
      .limit(1);

    if (!session) {
      console.warn(
        `[appendCampaignMessage] Session ${sessionId} not found — skipping append (source=${source})`,
      );
      return;
    }

    // Parse existing history
    let history: Array<Record<string, unknown>> = [];
    try {
      const parsed = JSON.parse((session.messageHistory as string) ?? "[]");
      if (Array.isArray(parsed)) history = parsed;
    } catch {
      history = [];
    }

    // Exact deduplication — never append the same OpenPhone message twice
    const alreadyPresent = history.some(
      (m) => m.openPhoneId === openPhoneMessageId,
    );
    if (alreadyPresent) {
      console.log(
        `[appendCampaignMessage] Duplicate detected for openPhoneId=${openPhoneMessageId} ` +
          `session=${sessionId} — skipping`,
      );
      return;
    }

    // Append the campaign message as a first-class assistant entry
    history.push({
      role: "assistant",
      content: message,
      ts: sentAt,
      source,
      openPhoneId: openPhoneMessageId,
    });

    // Compute all 5 summary fields from the updated history
    const summary = computeSessionSummary(
      history as Parameters<typeof computeSessionSummary>[0],
    );

    // Write messageHistory + summary fields + lastReadAt in one atomic update
    await (tx as any)
      .update(conversationSessions)
      .set({
        messageHistory: JSON.stringify(history),
        lastReadAt: sentAt,
        lastMessageText: summary.lastMessageText,
        lastMessageTs: summary.lastMessageTs,
        lastCustomerMessageTs: summary.lastCustomerMessageTs,
        lastMessageRole: summary.lastMessageRole,
        messageCount: summary.messageCount,
      })
      .where(eq(conversationSessions.id, sessionId));

    console.log(
      `[appendCampaignMessage] Appended campaign message to session ${sessionId} ` +
        `(source=${source} openPhoneId=${openPhoneMessageId} sentAt=${sentAt})`,
    );
  });
}
