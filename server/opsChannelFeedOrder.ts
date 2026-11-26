/** Command Chat feed order (pure). Used by opsChat.listChannelMessages. */
/** Highest sortKey first (ties: newest id first), each message once, at most `limit`; sortKey removed. */
export function orderChannelFeed<T extends { id: number; sortKey: unknown }>(rows: T[], limit: number): Omit<T, "sortKey">[] {
  const byId = new Map<number, T>();
  for (const row of rows) if (!byId.has(row.id)) byId.set(row.id, row);
  return Array.from(byId.values())
    .sort((a, b) => Number(b.sortKey) - Number(a.sortKey) || b.id - a.id)
    .slice(0, limit)
    .map(({ sortKey: _sortKey, ...row }) => row);
}
