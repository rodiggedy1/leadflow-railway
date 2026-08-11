export type EmailKanbanCard = { lastMessageAt?: unknown };

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
