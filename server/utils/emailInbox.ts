export interface EmailInboxCardRow {
  threadId: string;
  senderEmail: string | null;
}

/** Source rows must be newest-first; retain one latest row per external email. */
export function keepLatestEmailThreadPerSender<T extends EmailInboxCardRow>(rows: readonly T[]): T[] {
  const latestBySenderEmail = new Map<string, T>();
  for (const row of rows) {
    const normalizedEmail = row.senderEmail?.trim().toLowerCase();
    const key = normalizedEmail ? `email:${normalizedEmail}` : `thread:${row.threadId}`;
    if (!latestBySenderEmail.has(key)) latestBySenderEmail.set(key, row);
  }
  return [...latestBySenderEmail.values()];
}
