export type GmailThreadMessageMetadata = {
  id?: string | null;
  internalDate?: string | null;
};

/**
 * Extract the immutable identity and timestamp of the latest Gmail message.
 * The worker persists these together so Kanban direction can use message identity,
 * never customer identity or timestamp inference.
 */
export function getLatestGmailMessageMetadata(
  messages: readonly GmailThreadMessageMetadata[],
): { latestMessageId: string | null; lastMessageAt: number } {
  const latestMessage = messages[messages.length - 1];
  return {
    latestMessageId: latestMessage?.id ?? null,
    lastMessageAt: Number.parseInt(latestMessage?.internalDate ?? "0", 10) || 0,
  };
}
