export const HUMAN_ASSISTANT_SUMMARY_VERSION = 1;

type ActiveAgentIdentity = { name: string; email: string };
type UserIdentityAlias = { name: string | null; email: string | null };

type HistoricalMessage = {
  role?: unknown;
  senderName?: unknown;
  ts?: unknown;
};

const KNOWN_NON_HUMAN_SENDER_NAMES = new Set(["openphone"]);

function validTimestamp(message: HistoricalMessage): number | null {
  return typeof message.ts === "number" && Number.isFinite(message.ts) ? message.ts : null;
}

function newestFirst(messages: HistoricalMessage[]): HistoricalMessage[] {
  return messages
    .map((message, ordinal) => ({ message, ordinal, timestamp: validTimestamp(message) }))
    .sort((a, b) => {
      if (a.timestamp !== null && b.timestamp !== null) {
        return b.timestamp - a.timestamp || b.ordinal - a.ordinal;
      }
      if (a.timestamp !== null) return -1;
      if (b.timestamp !== null) return 1;
      return b.ordinal - a.ordinal;
    })
    .map(({ message }) => message);
}

/**
 * Produces only exact, database-backed human aliases: an active agent's own
 * stored name and a users-table full name whose email exactly matches that
 * agent's email. No prefix, fuzzy, or guessed name matching is allowed.
 */
export function buildExactActiveHumanAliasMap(
  activeAgents: ActiveAgentIdentity[],
  users: UserIdentityAlias[],
): Map<string, string> {
  const aliases = new Map<string, string>();
  const canonicalByEmail = new Map<string, string>();
  for (const agent of activeAgents) {
    const canonicalName = agent.name.trim();
    const normalizedEmail = agent.email.trim().toLowerCase();
    if (!canonicalName || !normalizedEmail) continue;
    aliases.set(canonicalName.toLowerCase(), canonicalName);
    canonicalByEmail.set(normalizedEmail, canonicalName);
  }
  for (const user of users) {
    const alias = user.name?.trim();
    const canonicalName = user.email ? canonicalByEmail.get(user.email.trim().toLowerCase()) : undefined;
    if (alias && canonicalName) aliases.set(alias.toLowerCase(), canonicalName);
  }
  return aliases;
}

/**
 * Resolve history against a registry loaded once for the current backfill batch.
 * Only historical backfill uses this registry; normal live sends write their
 * verified authenticated actor directly.
 */
export function findLastHistoricalHumanAssistant(
  messageHistory: unknown,
  activeHumanAliases: ReadonlyMap<string, string>,
): string | null {
  let messages: HistoricalMessage[] = [];
  try {
    const parsed = typeof messageHistory === "string" ? JSON.parse(messageHistory) : messageHistory;
    if (Array.isArray(parsed)) messages = parsed;
  } catch {
    return null;
  }

  for (const message of newestFirst(messages)) {
    if (message.role !== "assistant") continue;
    if (typeof message.senderName !== "string") continue;
    const normalized = message.senderName.trim().toLowerCase();
    if (!normalized || KNOWN_NON_HUMAN_SENDER_NAMES.has(normalized)) continue;
    const canonicalName = activeHumanAliases.get(normalized);
    if (canonicalName) return canonicalName;
  }
  return null;
}
