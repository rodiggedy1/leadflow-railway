type HistoryMessage = { role?: unknown; senderName?: unknown };

const NON_HUMAN_SENDER_NAMES = new Set(["openphone", "ai", "system", "automation"]);

/**
 * Resolve only an exact active-agent name from already-stored message history.
 * This is read-only and deliberately has no alias, prefix, or fuzzy matching.
 */
export function findLastExactActiveAgentName(
  messageHistory: unknown,
  activeAgentNames: ReadonlyMap<string, string>,
): string | null {
  let history: HistoryMessage[] = [];
  try {
    const parsed = typeof messageHistory === "string" ? JSON.parse(messageHistory) : messageHistory;
    if (Array.isArray(parsed)) history = parsed;
  } catch {
    return null;
  }

  for (let index = history.length - 1; index >= 0; index--) {
    const message = history[index];
    if (message.role !== "assistant" || typeof message.senderName !== "string") continue;
    const normalized = message.senderName.trim().toLowerCase();
    if (!normalized || NON_HUMAN_SENDER_NAMES.has(normalized)) continue;
    const canonicalName = activeAgentNames.get(normalized);
    if (canonicalName) return canonicalName;
  }
  return null;
}
