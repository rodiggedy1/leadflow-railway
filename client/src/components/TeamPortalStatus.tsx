import React, { useRef, useState } from "react";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../server/routers";
import { trpc } from "@/lib/trpc";

type Check = inferRouterOutputs<AppRouter>["leadflowJobs"]["leaderboard"]["history"]["teamPortalCheck"];
const time = (ms: number | null) => ms === null ? "" : new Date(ms).toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/** Whether every team's page (published results, opened through its own link) shows what this page shows, and a way
 * to publish the latest results WITHOUT sending any texts. Pure summary exported for tests. */
export function portalSummary(check: Pick<Check, "upToDate" | "publishedAtMs" | "teams">): { ok: boolean; title: string } {
  const differing = check.teams.filter(team => team.issues.length).length;
  if (check.publishedAtMs === null) return { ok: false, title: "Team pages: this week has not been published yet" };
  return check.upToDate ? { ok: true, title: `Team pages match this page (published ${time(check.publishedAtMs)})` }
    : { ok: false, title: `Team pages are out of date: ${differing} team${differing === 1 ? "" : "s"} see different results (published ${time(check.publishedAtMs)})` };
}

export function TeamPortalStatus({ agentId, weekStart, expectedPublicationId, onPublished }: { agentId: number; weekStart: string; expectedPublicationId: string | null | undefined; onPublished: () => void }) {
  const query = trpc.leadflowJobs.leaderboard.history.teamPortalCheck.useQuery({ weekStart }, { retry: false, staleTime: 0, refetchOnWindowFocus: true });
  const publish = trpc.leadflowJobs.leaderboard.history.publishFromRecords.useMutation({ retry: false });
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const check = query.data?.agentId === agentId && query.data.weekStart === weekStart ? query.data : null;
  if (query.isError) return <p className="tp-error">The team-page check could not be loaded: {query.error.message}</p>;
  if (!check) return <p className="tp-note">Checking team pages…</p>;
  const summary = portalSummary(check);
  const smsNotes = check.teams.filter(team => team.smsNote);
  const run = async () => {
    if (busyRef.current) return;
    if (!window.confirm("Publish this week's latest results now? Every team's page will show exactly what this page shows. No texts are sent.")) return;
    busyRef.current = true; setBusy(true); setMessage(null);
    try { await publish.mutateAsync({ requestId: crypto.randomUUID(), weekStart, expectedPublicationId: expectedPublicationId ?? null }); setMessage("Published. No texts were sent."); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Publishing failed. Nothing was changed."); }
    finally { busyRef.current = false; setBusy(false); onPublished(); await query.refetch(); }
  };
  return <section className={`tp-portal ${summary.ok ? "tp-portal-ok" : "tp-portal-warn"}`} aria-label="Team pages">
    <p className="tp-portal-title">{summary.ok ? "✓ " : ""}{summary.title}</p>
    {!summary.ok && <ul className="tp-portal-list">{check.teams.filter(team => team.issues.length).map(team => <li key={team.teamId}>
      <strong>{team.teamName}</strong>
      <span>This page: #{team.live.rank ?? "—"} · {team.live.score} · {team.live.complaints} complaint{team.live.complaints === 1 ? "" : "s"}.
        {" "}Team page: {team.portal ? `#${team.portal.rank ?? "—"} · ${team.portal.score} · ${team.portal.complaintIds.length} complaint${team.portal.complaintIds.length === 1 ? "" : "s"}` : team.published ? `#${team.published.rank ?? "—"} · ${team.published.score} · ${team.published.complaints} complaints` : "nothing published"}.</span>
      {team.issues.map(issue => <small key={issue}>{issue}</small>)}
    </li>)}</ul>}
    {!summary.ok && <div className="tp-actions"><button type="button" className="tp-btn tp-btn-primary" disabled={busy} onClick={() => void run()}>{busy ? "Publishing…" : "Publish latest results (no texts sent)"}</button></div>}
    {smsNotes.length > 0 && <p className="tp-note">{smsNotes.length} text{smsNotes.length === 1 ? "" : "s"} already sent this week used older numbers ({smsNotes.map(team => team.teamName).join(", ")}). Texts are never resent automatically; use Resend in "Send team reports" if you want to.</p>}
    {message && <p className="tp-note" role="status">{message}</p>}
  </section>;
}
