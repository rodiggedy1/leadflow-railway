export type EmailKanbanCard = { lastMessageAt?: unknown };

export type EmailKanbanDirectionCard = EmailKanbanCard & {
  latestMessageId?: string | null;
  latestSentMessageId?: string | null;
  messageCount?: number | null;
};

export function emailKanbanTimestamp(value: unknown): number {
  if (!value) return 0;
  if (value instanceof Date) return value.getTime();
  const timestamp = typeof value === "number" ? value : new Date(value as string).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

export function sortEmailKanbanCardsNewestFirst<T extends EmailKanbanCard>(items: readonly T[]): T[] {
  return [...items].sort(
    (a, b) => emailKanbanTimestamp(b.lastMessageAt) - emailKanbanTimestamp(a.lastMessageAt),
  );
}

/**
 * Exact sent-log identity means an agent sent the newest Gmail message.
 * Null legacy IDs intentionally make no direction claim; age classification
 * remains customer-side until the worker reconciles that row.
 */
export function getEmailKanbanColumn(
  card: EmailKanbanDirectionCard,
  now: number = Date.now(),
): "New" | "Needs Response" | "Waiting on Customer" | "At Risk" {
  const agentSpokeLast = Boolean(
    card.latestMessageId &&
    card.latestSentMessageId &&
    card.latestMessageId === card.latestSentMessageId,
  );
  if (agentSpokeLast) return "Waiting on Customer";

  const waitMs = now - emailKanbanTimestamp(card.lastMessageAt);
  if (waitMs >= 30 * 60 * 1000) return "At Risk";
  if (waitMs < 24 * 60 * 60 * 1000 && (card.messageCount ?? Number.MAX_SAFE_INTEGER) <= 2) return "New";
  return "Needs Response";
}
