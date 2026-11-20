/** Local-only destination selection. Never accepts a redirect URL or carries a token forward. */
export function getCleanerCallbackDestination(params: URLSearchParams): string {
  if (params.get("view") === "team-leaderboard") return "/team-leaderboard";
  const requestedJob = params.get("job") ?? "";
  const messageJobQuery = /^leadflow:\d+$/.test(requestedJob) ? `?job=${encodeURIComponent(requestedJob)}` : "";
  return `/portal-v2${messageJobQuery}`;
}

/**
 * Add a destination to an EXISTING magic link; this does not create or verify a token.
 * expectedOrigin must come from trusted application configuration, never a query parameter.
 * Returns null on invalid input, without logging or exposing the supplied token.
 */
export function withTeamLeaderboardDestination(existingMagicLink: string, expectedOrigin: string): string | null {
  try {
    if (/[\u0000-\u0020\u007f]/.test(existingMagicLink) ||
        !/^https:\/\/[^/?#]+\/auth\/cleaner-callback(?:\?|$)/.test(existingMagicLink)) return null;
    const origin = new URL(expectedOrigin);
    const link = new URL(existingMagicLink);
    if (origin.protocol !== "https:" || origin.username || origin.password ||
        origin.pathname !== "/" || origin.search || origin.hash ||
        (expectedOrigin !== origin.origin && expectedOrigin !== `${origin.origin}/`)) return null;
    if (link.protocol !== "https:" || link.origin !== origin.origin || link.username || link.password ||
        link.pathname !== "/auth/cleaner-callback" || link.hash) return null;
    const tokens = link.searchParams.getAll("token");
    // Existing generators use randomBytes(32).toString("hex"); do not fabricate a replacement.
    if (tokens.length !== 1 || !/^[a-f0-9]{64}$/.test(tokens[0])) return null;
    link.searchParams.set("view", "team-leaderboard");
    return link.toString();
  } catch {
    return null;
  }
}
