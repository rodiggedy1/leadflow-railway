import { trpc } from "@/lib/trpc";
import { TeamLeaderboardView } from "@/components/TeamLeaderboardView";
import { TeamLeaderboardAdminLink } from "@/components/TeamLeaderboardAdminLink";

function AccessState({ title, message, loading = false }: { title: string; message: string; loading?: boolean }) {
  return <main className="tl-admin-access"><section aria-busy={loading}>
    <h1>{title}</h1><p role={loading ? "status" : undefined}>{message}</p>
    {!loading && <a href="/admin/dashboard">Back to staff dashboard</a>}
  </section></main>;
}

export default function AdminTeamLeaderboard() {
  const meQuery = trpc.agents.me.useQuery(undefined, { retry: false, throwOnError: false, staleTime: 0 });
  const resultsQuery = trpc.leadflowJobs.leaderboard.forAdmin.useQuery(undefined, {
    enabled: meQuery.data?.isAdmin === true && !meQuery.isError,
    retry: false,
    throwOnError: false,
    refetchOnWindowFocus: false,
  });
  if (meQuery.isLoading) return <AccessState title="Checking staff access…" message="Confirming your existing staff session." loading />;
  if (meQuery.isError) return <AccessState title="Unable to confirm staff access" message="Please return to the staff dashboard and try again." />;
  if (!meQuery.data) return <AccessState title="Staff sign-in required" message="Sign in on the staff dashboard, then open Reviews & Quality." />;
  if (!meQuery.data.isAdmin) return <AccessState title="Admin access required" message="Team magic links are available only in the admin leaderboard." />;
  if (resultsQuery.isError) return <AccessState title="Unable to load the leaderboard" message="The reviewed results or team accounts could not be loaded. No team links were generated." />;
  const results = resultsQuery.data;
  const agentId = meQuery.data.id;
  if (resultsQuery.isLoading || !results || results.agentId !== agentId) {
    return <AccessState title="Loading the team leaderboard…" message="Loading reviewed results and linked team accounts." loading />;
  }
  return <div className="tl-admin-workspace"><TeamLeaderboardView publication={results.publication} ownTeamId={null} details={results.details}
    teamActions={teamId => {
      const team = results.publication.teams.find(row => row.id === teamId)!;
      const account = results.teamAccounts[teamId];
      return <TeamLeaderboardAdminLink key={`${agentId}:${teamId}:${account?.cleanerProfileId ?? "none"}`} teamName={team.name}
        cleanerProfileId={account?.cleanerProfileId ?? null} unavailableReason={account?.reason}
        resolveProfile={async () => {
          const fresh = await resultsQuery.refetch();
          if (fresh.isError || !fresh.data || fresh.data.agentId !== agentId) {
            throw new Error("Staff access and the current team account could not be confirmed.");
          }
          return fresh.data.teamAccounts[teamId]?.cleanerProfileId ?? null;
        }} />;
    }} /></div>;
}
