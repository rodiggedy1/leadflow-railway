import React, { useRef, useState } from "react";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../server/routers";
import { trpc } from "@/lib/trpc";

type View = inferRouterOutputs<AppRouter>["leadflowJobs"]["leaderboard"]["history"]["teamReports"];
type Team = View["teams"][number];
type Outcome = inferRouterOutputs<AppRouter>["leadflowJobs"]["leaderboard"]["history"]["sendTeamReports"]["outcomes"][number];

const time = (ms: number | null) => ms === null ? "" : new Date(ms).toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
/** One status line per team (pure, exported for tests). */
export function reportStatus(team: Team): { tone: "none" | "pending" | "sent" | "failed" | "skipped"; text: string } {
  if (team.issue) return { tone: "skipped", text: `Will be skipped: ${team.issue}` };
  const last = team.latest;
  if (!last) return { tone: "none", text: "Not sent" };
  const again = last.attempt > 1 ? ` (send ${last.attempt})` : "";
  if (last.status === "sent") return { tone: "sent", text: `Sent ${time(last.sentAtMs ?? last.atMs)}${again}${last.provisional ? " · preliminary" : ""}` };
  if (last.status === "failed") return { tone: "failed", text: `Failed ${time(last.atMs)}${again}${last.error ? ` · ${last.error.slice(0, 120)}` : ""}` };
  if (last.status === "uncertain") return { tone: "pending", text: `May have been sent ${time(last.atMs)}: check with the team before resending` };
  return { tone: "pending", text: `Pending since ${time(last.atMs)}` };
}
/** The confirmation shown before anything is published or sent (pure, exported for tests). */
export function confirmationText(view: { provisional: boolean; provisionalReason: string | null }, names: string[], resend: boolean, weekText: string): string {
  const warning = view.provisional ? `WARNING: this week's analysis is not complete (${view.provisionalReason ?? "results may change"}). The published results and the texts will be marked PRELIMINARY.\n\n` : "";
  const what = resend ? `${names[0]} will receive this week's report again (a second text).`
    : `${names.length} team${names.length === 1 ? "" : "s"} will receive ${names.length === 1 ? "its report" : "their reports"} by text: ${names.join(", ")}.`;
  return `${warning}The latest results for ${weekText} will be published first, so every team sees the same numbers on its team page. Then ${what}\n\nIf publishing fails, nothing is sent. Continue?`;
}
/** Teams "Send to all" would send to: a valid phone and nothing sent, pending or possibly sent yet. */
export const sendable = (team: Team) => !team.issue && (!team.latest || team.latest.status === "failed");
const OUTCOME: Record<Outcome["result"], string> = {
  sent: "sent", failed: "failed", skipped_no_phone: "skipped (no valid phone)", skipped_already_sent: "skipped (already sent)",
  skipped_pending: "skipped (may have been sent)", skipped_in_progress: "skipped (a send is in progress)", skipped_no_jobs: "skipped (no jobs this week)",
};
export function outcomeSummary(outcomes: Outcome[]): string {
  return outcomes.map(o => `${o.teamName || `Team ${o.teamId}`}: ${OUTCOME[o.result]}${o.result === "failed" && o.detail ? ` (${o.detail.slice(0, 80)})` : ""}`).join(" · ");
}

export function TeamReportsPanel({ agentId, weekStart, weekText, onClose }: { agentId: number; weekStart: string; weekText: string; onClose: () => void }) {
  const query = trpc.leadflowJobs.leaderboard.history.teamReports.useQuery({ weekStart }, { retry: false, staleTime: 0, refetchInterval: 30_000 });
  const send = trpc.leadflowJobs.leaderboard.history.sendTeamReports.useMutation({ retry: false });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const view = query.data?.agentId === agentId && query.data.weekStart === weekStart ? query.data : null;

  const run = async (teamIds: string[], resend: boolean, seenAttempts?: number) => {
    if (busyRef.current || !view || !teamIds.length) return;
    const names = view.teams.filter(t => teamIds.includes(t.teamId)).map(t => t.teamName);
    const question = confirmationText(view, names, resend, weekText);
    if (!window.confirm(question)) return;
    busyRef.current = true; setBusy(true); setError(null); setResult(null);
    try { setResult(outcomeSummary((await send.mutateAsync({ weekStart, teamIds, resend, ...(resend ? { seenAttempts } : {}) })).outcomes)); setSelected(new Set()); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "The reports could not be sent. Check each team's status before trying again."); }
    finally { busyRef.current = false; setBusy(false); await query.refetch(); }
  };

  return <section className="tp-reports" aria-label="Team reports">
    <div className="tp-reports-head"><h2>Team reports · {weekText}</h2><button type="button" className="tp-btn" onClick={onClose}>Close</button></div>
    {query.isError ? <p className="tp-error">{query.error.message}</p> : !view ? <p className="tp-note">Loading reports…</p> : <>
      {view.provisional && <p className="tp-reports-provisional" role="status"><strong>Preliminary.</strong> {view.provisionalReason} Publishing and sending now will mark the results and texts PRELIMINARY.</p>}
      {!view.teams.length && <p className="tp-note">No team had jobs this week.</p>}
      <ul className="tp-reports-list">{view.teams.map(team => {
        const status = reportStatus(team), canResend = !team.issue && (team.latest?.status === "sent" || team.latest?.status === "uncertain");
        return <li key={team.teamId} data-team={team.teamId}>
          <label className="tp-reports-row">
            <input type="checkbox" disabled={busy || !sendable(team)} checked={selected.has(team.teamId)}
              onChange={event => setSelected(prev => { const next = new Set(prev); if (event.target.checked) next.add(team.teamId); else next.delete(team.teamId); return next; })} />
            <span className="tp-reports-name">{team.teamName}<small>{team.language === "es" ? "Español" : "English"}{team.phoneMasked ? ` · ${team.phoneMasked}` : ""}</small></span>
          </label>
          <p className={`tp-reports-status tp-reports-${status.tone}`}>{status.text}</p>
          <div className="tp-reports-actions">
            <button type="button" className="tp-btn" aria-expanded={open === team.teamId} onClick={() => setOpen(open === team.teamId ? null : team.teamId)}>{open === team.teamId ? "Hide message" : "Preview"}</button>
            {canResend && <button type="button" className="tp-btn" disabled={busy} onClick={() => void run([team.teamId], true, team.attempts)}>Resend</button>}
          </div>
          {open === team.teamId && <pre className="tp-reports-message">{team.message}</pre>}
        </li>;
      })}</ul>
      <div className="tp-actions">
        <button type="button" className="tp-btn tp-btn-primary" disabled={busy || !selected.size} onClick={() => void run(Array.from(selected), false)}>
          {busy ? "Sending…" : `Send to selected (${selected.size})`}</button>
        <button type="button" className="tp-btn" disabled={busy || !view.teams.some(sendable)} onClick={() => void run(view.teams.filter(sendable).map(t => t.teamId), false)}>
          Send to all not yet sent ({view.teams.filter(sendable).length})</button>
      </div>
      <p className="tp-note">Sending publishes this week's latest results first, then texts the selected teams. Teams already sent are never texted again unless you press Resend. Teams without a valid phone are skipped.</p>
      {result && <p className="tp-reports-result" role="status">{result}</p>}
      {error && <p className="tp-error" role="alert">{error}</p>}
    </>}
  </section>;
}
