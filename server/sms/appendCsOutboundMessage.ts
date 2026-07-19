/**
 * appendCsOutboundMessage.ts
 *
 * Appends an agent-initiated outbound SMS (sent from the CS phone number) to
 * the canonical CS conversation session, so it appears in the CS inbox.
 *
 * Lookup strategy:
 *   1. Find the most-recent cs-inbound session whose leadPhone matches the
 *      last 10 digits of the recipient phone.
 *   2. If no session exists, create a proactive outbound session so the
 *      conversation is visible in the inbox and any reply is routed correctly.
 *
 * This is intentionally separate from appendOutboundCampaignMessageToSession,
 * which requires a known sessionId and an OpenPhone message ID. This helper
 * is designed for agent-triggered sends where we only know the phone number
 * and the message text.
 *
 * Safety:
 *   - All DB writes are non-fatal: errors are logged but never thrown, so a
 *     session-write failure never blocks the SMS send response.
 *   - Deduplication by content + timestamp window (15 s) prevents double-writes
 *     if the OpenPhone webhook also mirrors the same message.
 */
import { eq, desc } from "drizzle-orm";
import type { MySql2Database } from "drizzle-orm/mysql2";
import { conversationSessions } from "../../drizzle/schema";
import { computeSessionSummary } from "../sessionSummary";

export interface AppendCsOutboundParams {
  db: MySql2Database<Record<string, never>>;
  /** Recipient phone — any format; we normalise to last 10 digits for lookup. */
  recipientPhone: string;
  /** Recipient name — used when creating a new proactive session. */
  recipientName?: string;
  /** The exact message text that was sent. */
  message: string;
  /** Display name of the agent who sent the message (e.g. ctx.user.name). */
  senderName: string;
  /** Unix ms timestamp of the send. Defaults to Date.now(). */
  sentAt?: number;
  /** Optional OpenPhone message ID for exact deduplication. */
  openPhoneMessageId?: string;
}

/**
 * Appends one agent-sent CS SMS to the conversation session for the given phone.
 * Creates a proactive session if none exists. Never throws.
 */
export async function appendCsOutboundMessage(
  params: AppendCsOutboundParams,
): Promise<void> {
  const {
    db,
    recipientPhone,
    recipientName,
    message,
    senderName,
    openPhoneMessageId,
  } = params;
  const sentAt = params.sentAt ?? Date.now();

  try {
    // Normalise to last 10 digits for lookup (matches the webhook pattern)
    const digits = recipientPhone.replace(/\D/g, "");
    const phone10 = digits.slice(-10);

    // Find the most-recent CS session for this phone
    // Use the same RIGHT(REGEXP_REPLACE...) pattern used throughout the codebase
    const { sql: sql2 } = await import("drizzle-orm"); // dynamic import to avoid circular deps
    const [session] = await (db as any)
      .select({
        id: conversationSessions.id,
        messageHistory: conversationSessions.messageHistory,
      })
      .from(conversationSessions)
      .where(
        sql2`RIGHT(REGEXP_REPLACE(${conversationSessions.leadPhone}, '[^0-9]', ''), 10) = ${phone10}
          AND ${conversationSessions.leadSource} IN ('cs-inbound', 'cs-inbound-cleaner', 'cs_initiated')`,
      )
      .orderBy(desc(conversationSessions.updatedAt))
      .limit(1);

    let sessionId: number;

    if (!session) {
      // No existing session — create a proactive outbound one
      const e164 = digits.length === 10 ? `+1${digits}` : `+${digits}`;
      const history = [
        {
          role: "assistant",
          content: message,
          ts: sentAt,
          senderName,
          ...(openPhoneMessageId ? { opMsgId: openPhoneMessageId } : {}),
        },
      ];
      const summary = computeSessionSummary(
        history as Parameters<typeof computeSessionSummary>[0],
      );
      const result = await (db as any).insert(conversationSessions).values({
        leadPhone: e164,
        leadName: recipientName ?? null,
        leadSource: "cs-inbound",
        stage: "OPEN",
        messageHistory: JSON.stringify(history),
        lastReadAt: sentAt,
        ...summary,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      sessionId = (result as any).insertId;
      console.log(
        `[appendCsOutbound] Created proactive session ${sessionId} for ${e164} (sender=${senderName})`,
      );
    } else {
      sessionId = session.id;

      // Parse existing history
      let history: Array<Record<string, unknown>> = [];
      try {
        const parsed = JSON.parse((session.messageHistory as string) ?? "[]");
        if (Array.isArray(parsed)) history = parsed;
      } catch {
        history = [];
      }

      // Dedup: skip if same openPhoneMessageId already present
      if (
        openPhoneMessageId &&
        history.some((m) => m.opMsgId === openPhoneMessageId)
      ) {
        console.log(
          `[appendCsOutbound] Duplicate opMsgId=${openPhoneMessageId} for session ${sessionId} — skipping`,
        );
        return;
      }

      // Dedup: skip if identical assistant message within 15 s
      const isDup = history.slice(-3).some(
        (m) =>
          m.role === "assistant" &&
          m.content === message &&
          sentAt - ((m.ts as number) ?? 0) < 15_000,
      );
      if (isDup) {
        console.log(
          `[appendCsOutbound] Content dedup for session ${sessionId} — skipping`,
        );
        return;
      }

      history.push({
        role: "assistant",
        content: message,
        ts: sentAt,
        senderName,
        ...(openPhoneMessageId ? { opMsgId: openPhoneMessageId } : {}),
      });

      const summary = computeSessionSummary(
        history as Parameters<typeof computeSessionSummary>[0],
      );

      await (db as any)
        .update(conversationSessions)
        .set({
          messageHistory: JSON.stringify(history),
          lastReadAt: sentAt,
          updatedAt: new Date(),
          ...summary,
        })
        .where(eq(conversationSessions.id, sessionId));

      console.log(
        `[appendCsOutbound] Appended to session ${sessionId} for phone10=${phone10} (sender=${senderName})`,
      );
    }

    // Broadcast SSE so CS inbox updates in real time
    try {
      const { broadcastOpsUpdate } = await import("../sseBroadcast");
      broadcastOpsUpdate("lead_update");
    } catch {
      // SSE broadcast is best-effort
    }
  } catch (err) {
    console.error(
      `[appendCsOutbound] Non-fatal error for phone=${recipientPhone}:`,
      err,
    );
  }
}
