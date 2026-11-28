import { trpc } from "@/lib/trpc";
import { TeamPerformanceAdmin } from "@/components/TeamPerformanceAdmin";

function AccessState({ title, message, loading = false }: { title: string; message: string; loading?: boolean }) {
  return <main className="tl-admin-access"><section aria-busy={loading}>
    <h1>{title}</h1><p role={loading ? "status" : undefined}>{message}</p>
    {!loading && <a href="/admin/dashboard">Back to staff dashboard</a>}
  </section></main>;
}

/** One team-performance page: one status, one set of standings, complaint details per team, technical details under Advanced. */
export default function AdminTeamLeaderboard() {
  const meQuery = trpc.agents.me.useQuery(undefined, { retry: false, throwOnError: false, staleTime: 0 });
  if (meQuery.isLoading) return <AccessState title="Checking staff access…" message="Confirming your existing staff session." loading />;
  if (meQuery.isError) return <AccessState title="Unable to confirm staff access" message="Please return to the staff dashboard and try again." />;
  if (!meQuery.data) return <AccessState title="Staff sign-in required" message="Sign in on the staff dashboard, then open Reviews & Quality." />;
  if (!meQuery.data.isAdmin) return <AccessState title="Admin access required" message="Team magic links are available only in the admin leaderboard." />;
  return <TeamPerformanceAdmin key={meQuery.data.id} agentId={meQuery.data.id} />;
}
