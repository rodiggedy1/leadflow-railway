import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { TeamLeaderboardView } from "@/components/TeamLeaderboardView";
import { TeamLeaderboardAdminLink } from "@/components/TeamLeaderboardAdminLink";
import { TeamLeaderboardHistoryControls, TeamLeaderboardAdminReviewControls, currentSundayWeek } from "@/components/TeamLeaderboardHistoryControls";
import { TeamQualityRecords } from "@/components/TeamQualityRecords";

function AccessState({ title, message, loading = false }: { title: string; message: string; loading?: boolean }) {
  return <main className="tl-admin-access"><section aria-busy={loading}>
    <h1>{title}</h1><p role={loading ? "status" : undefined}>{message}</p>
    {!loading && <a href="/admin/dashboard">Back to staff dashboard</a>}
  </section></main>;
}

export default function AdminTeamLeaderboard() {
  const [selectedWeek, setSelectedWeek] = useState(currentSundayWeek);
  const [overall, setOverall] = useState(false);
  // Phase 2: a week that is not published yet (normally the current week) shows its scores calculated automatically
  // from saved quality records (no AI review); a published week shows its published results. Staff can switch either way.
  const [recordsChoice, setRecordsChoice] = useState<{ weekStart: string; value: boolean } | null>(null);
  const meQuery = trpc.agents.me.useQuery(undefined, { retry: false, throwOnError: false, staleTime: 0 });
  const allowed = meQuery.data?.isAdmin === true && !meQuery.isError && !meQuery.isLoading;
  const weeksQuery = trpc.leadflowJobs.leaderboard.history.weeksForAdmin.useQuery(undefined, {
    enabled: allowed, retry: false, throwOnError: false, staleTime: 0, refetchOnWindowFocus: false,
  });
  const weeksReady = allowed && !weeksQuery.isError && !weeksQuery.isLoading && weeksQuery.data?.agentId === meQuery.data?.id;
  const weeks = weeksReady ? weeksQuery.data!.weeks : [];
  const weekStart = selectedWeek || currentSundayWeek();
  const fromRecords = recordsChoice?.weekStart === weekStart ? recordsChoice.value : weeksReady && !weeks.some(week => week.weekStart === weekStart);
  const setFromRecords = (value: boolean) => setRecordsChoice({ weekStart, value });
  const selection = overall ? { summary: true } : weekStart ? { weekStart } : {};
  const selectionKey = overall ? "summary" : weekStart || "latest";
  const resultsQuery = trpc.leadflowJobs.leaderboard.history.forAdmin.useQuery(selection, {
    enabled: allowed && weeksReady,
    retry: false,
    throwOnError: false,
    staleTime: 0,
    refetchOnWindowFocus: false,
  });
  const liveQuery = trpc.leadflowJobs.leaderboard.history.liveFromRecords.useQuery({ weekStart }, {
    enabled: allowed && fromRecords && !overall, retry: false, throwOnError: false, staleTime: 0, refetchOnWindowFocus: false,
  });
  if (meQuery.isLoading) return <AccessState title="Checking staff access…" message="Confirming your existing staff session." loading />;
  if (meQuery.isError) return <AccessState title="Unable to confirm staff access" message="Please return to the staff dashboard and try again." />;
  if (!meQuery.data) return <AccessState title="Staff sign-in required" message="Sign in on the staff dashboard, then open Reviews & Quality." />;
  if (!meQuery.data.isAdmin) return <AccessState title="Admin access required" message="Team magic links are available only in the admin leaderboard." />;
  const agentId = meQuery.data.id;
  const live = fromRecords && !overall && !liveQuery.isError && liveQuery.data?.agentId === agentId && liveQuery.data.period?.weekStart === weekStart ? liveQuery.data : null;
  const results = !resultsQuery.isError && !resultsQuery.isLoading && weeksReady && resultsQuery.data?.agentId === agentId && resultsQuery.data.selectionKey === selectionKey ? resultsQuery.data : null;
  const unpublished = !overall && Boolean(weekStart) && weeksReady && !weeks.some(week => week.weekStart === weekStart);
  const controls = <TeamLeaderboardHistoryControls key={`${agentId}:${weekStart}`} weeks={weeks} weekStart={weekStart} overall={overall} admin coverageEnd={results?.period?.coverageEnd} onWeekChange={week => { setSelectedWeek(week); setOverall(false); }} loading={weeksQuery.isLoading || (!weeksReady && !weeksQuery.isError)} error={weeksQuery.isError ? "Unable to load saved weeks. Change week to retry." : null}
    onRefresh={() => { void weeksQuery.refetch(); void resultsQuery.refetch(); }}
    reviewControls={<TeamLeaderboardAdminReviewControls key={`${agentId}:${weekStart}`} agentId={agentId} weekStart={weekStart} accessReady={allowed} hidden={overall} onPublished={async () => { await weeksQuery.refetch(); await resultsQuery.refetch(); }} />}>
    <TeamQualityRecords key={`quality:${agentId}:${weekStart}`} agentId={agentId} weekStart={weekStart} fromRecords={fromRecords && !overall} onToggleRecords={setFromRecords}
      expectedPublicationId={live?.expectedPublicationId} onChanged={async () => { await weeksQuery.refetch(); await resultsQuery.refetch(); if (fromRecords) await liveQuery.refetch(); }} />
    {fromRecords && !overall ? (liveQuery.isError ? <p className="tl-history-error" role="alert">Live scores from quality records could not be loaded. Published results are unchanged.</p>
      : !live ? <p role="status">Calculating this week's scores from quality records…</p> : <p role="status">This week's scores, updated automatically from saved quality records{live.countsComplete ? "" : " (job counts incomplete; publishing is unavailable)"}. Not yet published to teams.</p>)
    : unpublished ? <p role="status">No published results for this week yet. Click Run review to prepare them.</p> : resultsQuery.isError ? <p className="tl-history-error" role="alert">Unable to load the leaderboard. No team links were generated. Change week to refresh results.</p> : !results && !weeksQuery.isLoading ? <p role="status">Loading the team leaderboard…</p> : null}
  </TeamLeaderboardHistoryControls>;
  const shown = fromRecords && !overall ? live : results;
  return <div className="tl-admin-workspace"><TeamLeaderboardView publication={shown?.publication ?? null} ownTeamId={null} details={shown?.details ?? {}} period={shown?.period} overall={overall} onOverallChange={setOverall} controls={controls}
    teamActions={teamId => {
      const source = fromRecords && !overall ? live : results;
      if (!source) return null;
      const team = source.publication.teams.find(row => row.id === teamId)!;
      const account = source.teamAccounts[teamId];
      return <TeamLeaderboardAdminLink key={`${agentId}:${selectionKey}:${teamId}:${account?.cleanerProfileId ?? "none"}`} teamName={team.name}
        cleanerProfileId={account?.cleanerProfileId ?? null} unavailableReason={account?.reason}
        resolveProfile={async () => {
          if (fromRecords && !overall) {
            const fresh = await liveQuery.refetch();
            if (fresh.isError || !fresh.data || fresh.data.agentId !== agentId || fresh.data.period?.weekStart !== weekStart) throw new Error("Staff access and the current team account could not be confirmed.");
            return fresh.data.teamAccounts[teamId]?.cleanerProfileId ?? null;
          }
          const fresh = await resultsQuery.refetch();
          if (fresh.isError || !fresh.data || fresh.data.agentId !== agentId || fresh.data.selectionKey !== selectionKey) {
            throw new Error("Staff access and the current team account could not be confirmed.");
          }
          return fresh.data.teamAccounts[teamId]?.cleanerProfileId ?? null;
        }} />;
    }} /></div>;
}
