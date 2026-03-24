/**
 * useAgentPermissions — returns the current agent's page permissions.
 *
 * Returns:
 *   - pagePermissions: null  → agent is unrestricted (admin or no restrictions set)
 *   - pagePermissions: []    → agent is blocked from all pages
 *   - pagePermissions: [...] → agent can only see the listed page IDs
 *   - isAdmin: true          → agent is admin, always unrestricted
 *   - loaded: true           → the query has resolved (use to avoid flash)
 */
import { trpc } from "@/lib/trpc";

export function useAgentPermissions() {
  const { data, isLoading } = trpc.agents.me.useQuery(undefined, {
    retry: false,
    throwOnError: false,
    staleTime: 60_000,
  });

  const isAdmin = data?.isAdmin === true;
  // Admins are always unrestricted regardless of stored permissions
  const pagePermissions: string[] | null = isAdmin ? null : (data?.pagePermissions ?? null);

  return {
    isAdmin,
    pagePermissions,
    loaded: !isLoading,
    agentId: data?.id ?? null,
    agentName: data?.name ?? null,
  };
}
