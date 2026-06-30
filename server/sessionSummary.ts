/**
 * sessionSummary.ts
 *
 * Single source of truth for computing the 5 denormalized inbox summary fields
 * from a messageHistory JSON string. All write paths that update messageHistory
 * MUST call this helper and include the returned fields in their .set() payload.
 *
 * Fields managed:
 *   lastMessageText       varchar(255)  — preview text of the last message
 *   lastMessageTs         bigint        — Unix ms of the last message (any role)
 *   lastCustomerMessageTs bigint        — Unix ms of the last role:"user" message
 *   lastMessageRole       varchar(16)   — role of the last message
 *   messageCount          int           — total message count
 */

type RawMessage = {
  role: string;
  content: string;
  ts?: number;
  senderName?: string;
  media?: string[];
};

export type SessionSummaryFields = {
  lastMessageText: string | null;
  lastMessageTs: number | null;
  lastCustomerMessageTs: number | null;
  lastMessageRole: string | null;
  messageCount: number;
};

/**
 * Compute all 5 summary fields from a parsed message array.
 * Pass the already-parsed array (not the JSON string) to avoid double-parsing.
 */
export function computeSessionSummary(messages: RawMessage[]): SessionSummaryFields {
  const count = messages.length;

  if (count === 0) {
    return {
      lastMessageText: null,
      lastMessageTs: null,
      lastCustomerMessageTs: null,
      lastMessageRole: null,
      messageCount: 0,
    };
  }

  const last = messages[count - 1];
  const rawText = typeof last.content === "string" ? last.content : "";
  // Truncate to 255 chars for the varchar column
  const lastMessageText = rawText.slice(0, 255) || null;
  const lastMessageTs = last.ts ?? null;
  const lastMessageRole = last.role ?? null;

  // Walk backwards to find the last customer message
  let lastCustomerMessageTs: number | null = null;
  for (let i = count - 1; i >= 0; i--) {
    if (messages[i].role === "user" && messages[i].ts != null) {
      lastCustomerMessageTs = messages[i].ts!;
      break;
    }
  }

  return {
    lastMessageText,
    lastMessageTs,
    lastCustomerMessageTs,
    lastMessageRole,
    messageCount: count,
  };
}

/**
 * Convenience: parse the JSON string and compute summary in one call.
 * Use this when you only have the raw JSON string (e.g. after reading from DB).
 */
export function computeSessionSummaryFromJson(messageHistoryJson: string): SessionSummaryFields {
  let messages: RawMessage[] = [];
  try {
    messages = JSON.parse(messageHistoryJson);
    if (!Array.isArray(messages)) messages = [];
  } catch {
    messages = [];
  }
  return computeSessionSummary(messages);
}
