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

type IndexedMessage = {
  message: RawMessage;
  ordinal: number;
  timestamp: number | null;
};

function validTimestamp(message: RawMessage): number | null {
  return typeof message.ts === "number" && Number.isFinite(message.ts)
    ? message.ts
    : null;
}

/**
 * Select the latest deterministically without manufacturing chronology for legacy
 * entries that have no valid timestamp. A valid numeric timestamp always wins;
 * ties use the later original array ordinal. When every candidate lacks a valid
 * timestamp, the later original array ordinal is the explicit fallback.
 */
function latestChronologicalMessage(
  messages: RawMessage[],
  include: (message: RawMessage) => boolean = () => true,
): IndexedMessage | null {
  const candidates = messages
    .map((message, ordinal) => ({ message, ordinal, timestamp: validTimestamp(message) }))
    .filter(({ message }) => include(message));

  if (candidates.length === 0) return null;

  const timestamped = candidates.filter(
    (candidate): candidate is IndexedMessage & { timestamp: number } => candidate.timestamp !== null,
  );

  if (timestamped.length === 0) return candidates[candidates.length - 1] ?? null;

  return timestamped.reduce((latest, candidate) =>
    candidate.timestamp > latest.timestamp ||
    (candidate.timestamp === latest.timestamp && candidate.ordinal > latest.ordinal)
      ? candidate
      : latest,
  );
}

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

  const latest = latestChronologicalMessage(messages);
  if (!latest) {
    return {
      lastMessageText: null,
      lastMessageTs: null,
      lastCustomerMessageTs: null,
      lastMessageRole: null,
      messageCount: count,
    };
  }

  const rawText = typeof latest.message.content === "string" ? latest.message.content : "";
  // Truncate to 255 chars for the varchar column
  const lastMessageText = rawText.slice(0, 255) || null;
  const lastMessageTs = latest.timestamp;
  const lastMessageRole = latest.message.role || null;

  const latestCustomer = latestChronologicalMessage(
    messages,
    (message) => message.role === "user" || message.role === "customer",
  );
  const lastCustomerMessageTs = latestCustomer?.timestamp ?? null;

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
