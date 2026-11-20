import { trpc } from "@/lib/trpc";
import { TeamLeaderboardView } from "@/components/TeamLeaderboardView";

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
  // Reuse the existing cookie identity; no new login, tokens or authentication flow.
  const meQuery = trpc.cleaner.me.useQuery(undefined, { retry: false, throwOnError: false });
  const resultsQuery = trpc.leadflowJobs.leaderboard.forMe.useQuery(undefined, {
    enabled: Boolean(meQuery.data) && !meQuery.isError,
    retry: false,
    throwOnError: false,
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
  if (resultsQuery.isError) {
    return <AccessState title="Unable to load team results" message="We could not load results for your linked team. Please contact your manager." />;
  }
  const results = resultsQuery.data;
  if (resultsQuery.isLoading || !results || results.cleanerProfileId !== meQuery.data.id) {
    return <AccessState title="Loading your team results…" message="Please wait while we load the results for your signed-in team." loading />;
  }
  return <TeamLeaderboardView publication={results.publication} ownTeamId={results.ownTeamId} details={results.details} />;
}
