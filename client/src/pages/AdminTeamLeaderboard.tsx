import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { TeamLeaderboardView } from "@/components/TeamLeaderboardView";
import { TeamLeaderboardAdminLink } from "@/components/TeamLeaderboardAdminLink";
import { TeamLeaderboardHistoryControls, TeamLeaderboardAdminReviewControls } from "@/components/TeamLeaderboardHistoryControls";

function AccessState({ title, message, loading = false }: { title: string; message: string; loading?: boolean }) {
  return <main className="tl-admin-access"><section aria-busy={loading}>
    <h1>{title}</h1><p role={loading ? "status" : undefined}>{message}</p>
    {!loading && <a href="/admin/dashboard">Back to staff dashboard</a>}
  </section></main>;
}

export default function AdminTeamLeaderboard() {
  const [selectedWeek, setSelectedWeek] = useState("");
  const [overall, setOverall] = useState(false);
  const meQuery = trpc.agents.me.useQuery(undefined, { retry: false, throwOnError: false, staleTime: 0 });
  const allowed = meQuery.data?.isAdmin === true && !meQuery.isError && !meQuery.isLoading;
  const weeksQuery = trpc.leadflowJobs.leaderboard.history.weeksForAdmin.useQuery(undefined, {
    enabled: allowed, retry: false, throwOnError: false, staleTime: 0, refetchOnWindowFocus: false,
  });
  const weeksReady = allowed && !weeksQuery.isError && !weeksQuery.isLoading && weeksQuery.data?.agentId === meQuery.data?.id;
  const weeks = weeksReady ? weeksQuery.data!.weeks : [];
  const weekStart = selectedWeek || weeks[0]?.weekStart || "";
  const selection = overall ? { summary: true } : weekStart ? { weekStart } : {};
  const selectionKey = overall ? "summary" : weekStart || "latest";
  const resultsQuery = trpc.leadflowJobs.leaderboard.history.forAdmin.useQuery(selection, {
    enabled: allowed && weeksReady,
    retry: false,
    throwOnError: false,
    staleTime: 0,
    refetchOnWindowFocus: false,
  });
  if (meQuery.isLoading) return <AccessState title="Checking staff access…" message="Confirming your existing staff session." loading />;
  if (meQuery.isError) return <AccessState title="Unable to confirm staff access" message="Please return to the staff dashboard and try again." />;
  if (!meQuery.data) return <AccessState title="Staff sign-in required" message="Sign in on the staff dashboard, then open Reviews & Quality." />;
  if (!meQuery.data.isAdmin) return <AccessState title="Admin access required" message="Team magic links are available only in the admin leaderboard." />;
  const agentId = meQuery.data.id;
  const results = !resultsQuery.isError && !resultsQuery.isLoading && weeksReady && resultsQuery.data?.agentId === agentId && resultsQuery.data.selectionKey === selectionKey ? resultsQuery.data : null;
  const unpublished = !overall && Boolean(weekStart) && weeksReady && !weeks.some(week => week.weekStart === weekStart);
  const controls = <TeamLeaderboardHistoryControls key={`${agentId}:${weekStart}`} weeks={weeks} weekStart={weekStart} overall={overall} admin onWeekChange={week => { setSelectedWeek(week); setOverall(false); }} loading={weeksQuery.isLoading || (!weeksReady && !weeksQuery.isError)} error={weeksQuery.isError ? "Unable to load published history. No cached history is shown. You can enter a Sunday to inspect or run a review." : null}>
    {unpublished ? <p role="status">No published results for Sunday {weekStart} yet. Select a saved week, or Run review below; published results remain unchanged until explicit Publish.</p> : resultsQuery.isError ? <p className="tl-history-error" role="alert">Unable to load the leaderboard. No team links were generated. Refresh the published read or inspect saved reviews below.</p> : !results ? <p role="status">Loading the team leaderboard… Loading reviewed results and linked team accounts.</p> : null}
    <div className="tl-history-buttons"><button type="button" onClick={() => { void weeksQuery.refetch(); void resultsQuery.refetch(); }}>Refresh published history</button></div>
    <TeamLeaderboardAdminReviewControls key={`${agentId}:${weekStart}`} agentId={agentId} weekStart={weekStart} accessReady={allowed} onPublished={async () => { await weeksQuery.refetch(); await resultsQuery.refetch(); }} />
  </TeamLeaderboardHistoryControls>;
  return <div className="tl-admin-workspace"><TeamLeaderboardView publication={results?.publication ?? null} ownTeamId={null} details={results?.details ?? {}} period={results?.period} overall={overall} onOverallChange={setOverall} controls={controls}
    teamActions={teamId => {
      if (!results) return null;
      const team = results.publication.teams.find(row => row.id === teamId)!;
      const account = results.teamAccounts[teamId];
      return <TeamLeaderboardAdminLink key={`${agentId}:${selectionKey}:${teamId}:${account?.cleanerProfileId ?? "none"}`} teamName={team.name}
        cleanerProfileId={account?.cleanerProfileId ?? null} unavailableReason={account?.reason}
        resolveProfile={async () => {
          const fresh = await resultsQuery.refetch();
          if (fresh.isError || !fresh.data || fresh.data.agentId !== agentId || fresh.data.selectionKey !== selectionKey) {
            throw new Error("Staff access and the current team account could not be confirmed.");
          }
          return fresh.data.teamAccounts[teamId]?.cleanerProfileId ?? null;
        }} />;
    }} /></div>;
}
