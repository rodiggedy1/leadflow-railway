import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { TeamLeaderboardView } from "@/components/TeamLeaderboardView";
import { TeamLeaderboardHistoryControls } from "@/components/TeamLeaderboardHistoryControls";

function AccessState({ title, message, loading = false }: { title: string; message: string; loading?: boolean }) {
  return (
    <main className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
      <section className="max-w-md rounded-2xl bg-white border border-slate-200 p-8 text-center" aria-busy={loading}>
        <p className="text-xs font-semibold uppercase tracking-widest text-slate-500 mb-3">Maids in Black · Team leaderboard</p>
        <h1 className="text-2xl font-semibold text-slate-900 mb-3">{title}</h1>
        <p className="text-sm leading-relaxed text-slate-600" role={loading ? "status" : undefined}>{message}</p>
      </section>
    </main>
  );
}

export default function TeamLeaderboard() {
  const [selectedWeek, setSelectedWeek] = useState("");
  const [overall, setOverall] = useState(false);
  // Reuse the existing cookie identity; no new login, tokens or authentication flow.
  const meQuery = trpc.cleaner.me.useQuery(undefined, { retry: false, throwOnError: false });
  const allowed = Boolean(meQuery.data) && !meQuery.isError && !meQuery.isLoading;
  const weeksQuery = trpc.leadflowJobs.leaderboard.history.weeksForMe.useQuery(undefined, {
    enabled: allowed, retry: false, throwOnError: false, staleTime: 0, refetchOnWindowFocus: false,
  });
  const weeksReady = allowed && !weeksQuery.isError && !weeksQuery.isLoading && weeksQuery.data?.cleanerProfileId === meQuery.data?.id;
  const weeks = weeksReady ? weeksQuery.data!.weeks : [];
  const weekStart = selectedWeek || weeks[0]?.weekStart || "";
  const selection = overall ? { summary: true } : weekStart ? { weekStart } : {};
  const selectionKey = overall ? "summary" : weekStart || "latest";
  const resultsQuery = trpc.leadflowJobs.leaderboard.history.forMe.useQuery(selection, {
    enabled: allowed && weeksReady,
    retry: false,
    throwOnError: false,
    staleTime: 0,
    refetchOnWindowFocus: false,
  });

  if (meQuery.isLoading) {
    return <AccessState title="Checking your team access…" message="Please wait while we confirm your active session." loading />;
  }
  if (meQuery.isError) {
    return <AccessState title="Unable to confirm access" message="We could not check your session. Please try again later or contact your manager." />;
  }
  if (!meQuery.data) {
    return <AccessState title="Sign-in required" message="Open the login link provided by your manager to view the team leaderboard. An active team account is required." />;
  }
  const results = !resultsQuery.isError && !resultsQuery.isLoading && weeksReady && resultsQuery.data?.cleanerProfileId === meQuery.data.id && resultsQuery.data.selectionKey === selectionKey ? resultsQuery.data : null;
  const controls = <TeamLeaderboardHistoryControls key={`${meQuery.data.id}:${weekStart}`} weeks={weeks} weekStart={weekStart} overall={overall} onWeekChange={week => { setSelectedWeek(week); setOverall(false); }} loading={weeksQuery.isLoading || (!weeksReady && !weeksQuery.isError)} error={weeksQuery.isError ? "Unable to load published history. Please contact your manager; no cached team history is shown." : null}>
    {resultsQuery.isError ? <p className="tl-history-error" role="alert">Unable to load team results for the selected view. Please contact your manager.</p> : !results ? <p role="status">Loading your team results… Please wait while we load the selected published results for your signed-in team.</p> : null}
    <div className="tl-history-buttons"><button type="button" onClick={() => { void weeksQuery.refetch(); void resultsQuery.refetch(); }}>Refresh published history</button></div>
  </TeamLeaderboardHistoryControls>;
  return <TeamLeaderboardView publication={results?.publication ?? null} ownTeamId={results?.ownTeamId ?? null} details={results?.details ?? {}} period={results?.period} overall={overall} onOverallChange={setOverall} controls={controls} />;
}
