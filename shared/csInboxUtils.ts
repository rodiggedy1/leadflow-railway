/**
 * Shared pure helper for resolving the default CS Inbox conversation ID.
 *
 * Used in two places:
 *   1. CsInbox — to compute the initial effectiveSelectedId on first mount
 *   2. OpsChat — to resolve the conversation to prefetch before mounting CsInbox
 *
 * Rule: first row where csResolvedAt is null/falsy (i.e. still open).
 * This mirrors the "All" filter default in CsInbox.
 *
 * Keeping this in one place prevents the two call sites from drifting
 * if the default filter or sort order ever changes.
 */
export function getInitialCsConversationId(
  rows: Array<{ id: number; csResolvedAt?: number | null }>
): number | null {
  return rows.find((row) => !row.csResolvedAt)?.id ?? null;
}
