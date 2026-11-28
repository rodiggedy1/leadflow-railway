import React, { useState } from "react";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../server/routers";
import { trpc } from "@/lib/trpc";
import { rankAssessedScores } from "@shared/teamLeaderboardReviewScores";
import { countsAgainstTeam, qualityExclusionReason } from "@shared/teamQualityIncidents";
import { shiftBookingDate } from "@shared/bookingReschedule";
import { TeamLeaderboardAdminLink } from "./TeamLeaderboardAdminLink";
import { TeamQualityRecords } from "./TeamQualityRecords";
import { currentSundayWeek } from "./TeamLeaderboardHistoryControls";
import "./team-performance.css";

type History = inferRouterOutputs<AppRouter>["leadflowJobs"]["leaderboard"]["history"];
export type AnalysisStatus = History["analysisStatus"];
type Live = History["liveFromRecords"];
type Incident = History["qualityRecords"]["incidents"][number];

const opts = { retry: false as const, throwOnError: false as const, staleTime: 0 };
const STATE_LABEL: Record<AnalysisStatus["state"], string> = {
  not_started: "Not started", running: "In progress", complete: "Complete", incomplete: "Incomplete", failed: "Failed",
};
const CATEGORY: Record<string, string> = { cleaning_quality: "Complaint", team_service: "Arrival / team conduct", office_service: "Office",
  pricing_billing: "Billing / pricing", scheduling: "Scheduling", other: "Other", unclassified: "Related signal" };
const CHANNEL: Record<string, string> = { sms: "Text", email: "Email", call: "Call", rating: "Rating", signoff: "Cleaner sign-off", review: "Weekly analysis", staff: "Staff" };
const ERRORS: Record<string, string> = {
  MISSING_API_KEY: "The AI key is not set up on this server.", WEEKLY_REVIEW_TIMED_OUT: "A day took longer than 20 minutes and was stopped.",
  ANALYSIS_INTERRUPTED: "The server restarted several times during the analysis.", ANALYSIS_READ_FAILED: "This week's messages and calls could not be read.",
  ANALYSIS_DAY_FAILED: "The AI step for a day failed.", ANALYSIS_DAY_INCOMPLETE: "The AI did not finish reading every message for a day.",
};
export function explainAnalysisError(code: string | null): string {
  if (!code) return "";
  const key = Object.keys(ERRORS).find(k => code.includes(k));
  return key ? ERRORS[key] : "The analysis stopped before finishing.";
}
const time = (ms: number | null) => ms === null ? "—" : new Date(ms).toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const dayLabel = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" });
export function weekLabel(weekStart: string) {
  const end = shiftBookingDate(weekStart, 6), f = (d: string, o: Intl.DateTimeFormatOptions) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", ...o });
  return `${f(weekStart, { month: "long", day: "numeric" })}–${weekStart.slice(5, 7) === end.slice(5, 7) ? f(end, { day: "numeric" }) : f(end, { month: "long", day: "numeric" })}, ${end.slice(0, 4)}`;
}

/** The status panel (pure, exported for tests). */
export function AnalysisPanel({ status, busy, onStart }: { status: AnalysisStatus; busy: boolean; onStart: (day?: string) => void }) {
  const counted = `${status.processed.toLocaleString("en-US")} of ${status.total.toLocaleString("en-US")} communications`;
  const day = status.scope === "day" && status.days[0] ? ` (test: ${dayLabel(status.days[0].day)} only)` : "";
  if (status.state === "not_started") return <div className="tp-status" data-state="not_started">
    <div className="tp-status-top"><span>Complaint analysis not started</span></div>
    <p>Complaints from this week's texts, emails and calls have not been analyzed yet. Rankings are provisional until the analysis finishes.</p>
    <div className="tp-actions"><button type="button" className="tp-btn tp-btn-primary" disabled={busy} onClick={() => onStart()}>Analyze this week</button></div>
  </div>;
  if (status.state === "running") return <div className="tp-status" data-state="running">
    <div className="tp-status-top"><span>Analyzing historical complaints{day}</span><em>{status.percent.toFixed(1)}%</em></div>
    <div className="tp-bar" role="progressbar" aria-valuenow={status.percent} aria-valuemin={0} aria-valuemax={100}><div style={{ width: `${Math.max(1, status.percent)}%` }} /></div>
    <p>Rankings are provisional until the analysis finishes. {counted}. Started {time(status.startedAtMs)} · last progress {time(status.lastProgressAtMs)}.</p>
  </div>;
  if (status.state === "complete" && status.scope === "day") return <div className="tp-status" data-state="test_complete">
    <div className="tp-status-top"><span>Test day analyzed{day}</span><em>100% of that day</em></div>
    <p>{status.total.toLocaleString("en-US")} communications analyzed for that day; its complaints are in the standings. The rest of the week has not been analyzed, so rankings are provisional.</p>
    <div className="tp-actions"><button type="button" className="tp-btn tp-btn-primary" disabled={busy} onClick={() => onStart()}>Analyze the whole week</button></div>
    <p>The test day is reused, not analyzed again.</p>
  </div>;
  if (status.state === "complete") return <div className="tp-status tp-status-complete" data-state="complete">
    <div className="tp-status-top"><span>Analysis complete{day}</span><em>100%</em></div>
    <p>{status.total.toLocaleString("en-US")} communications analyzed. Started {time(status.startedAtMs)} · finished {time(status.finishedAtMs)}. New messages are added automatically.</p>
  </div>;
  const unfinished = status.days.filter(d => d.status !== "done").length;
  return <div className={`tp-status ${status.state === "failed" ? "tp-status-failed" : ""}`} data-state={status.state}>
    <div className="tp-status-top"><span>{status.state === "failed" ? "Analysis failed" : `Analysis incomplete: ${unfinished} day${unfinished === 1 ? "" : "s"} not finished`}{day}</span><em>{status.percent.toFixed(1)}%</em></div>
    <p>{explainAnalysisError(status.error ?? status.days.find(d => d.error)?.error ?? null)} {counted}. Rankings are provisional. Started {time(status.startedAtMs)} · stopped {time(status.finishedAtMs ?? status.lastProgressAtMs)}.</p>
    <div className="tp-actions"><button type="button" className="tp-btn tp-btn-primary" disabled={busy} onClick={() => onStart(status.scope === "day" ? status.days[0]?.day : undefined)}>Finish the analysis</button></div>
    <p>Finished days are kept; only the unfinished days are analyzed again.</p>
  </div>;
}

export function TeamPerformanceAdmin({ agentId }: { agentId: number }) {
  const [weekStart, setWeekStart] = useState(currentSundayWeek);
  const [picking, setPicking] = useState(false);
  const [openTeam, setOpenTeam] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [testDay, setTestDay] = useState("");
  const [sizing, setSizing] = useState(false);
  const statusQuery = trpc.leadflowJobs.leaderboard.history.analysisStatus.useQuery({ weekStart }, { ...opts,
    refetchInterval: query => query.state.data?.state === "running" ? 4000 : 60000 });
  const status = statusQuery.data?.agentId === agentId ? statusQuery.data : null;
  const running = status?.state === "running";
  const liveQuery = trpc.leadflowJobs.leaderboard.history.liveFromRecords.useQuery({ weekStart }, { ...opts, refetchInterval: running ? 15000 : false });
  const live: Live | null = liveQuery.data?.agentId === agentId && liveQuery.data.period?.weekStart === weekStart ? liveQuery.data : null;
  const records = trpc.leadflowJobs.leaderboard.history.qualityRecords.useQuery({ weekStart }, { ...opts, enabled: openTeam !== null, refetchInterval: running && openTeam ? 15000 : false });
  const start = trpc.leadflowJobs.leaderboard.history.startAnalysis.useMutation({ retry: false });
  const estimate = trpc.leadflowJobs.leaderboard.history.estimateAnalysis.useQuery({ weekStart }, { ...opts, enabled: sizing });
  const final = status?.state === "complete" && status.scope === "week";
  const teams = live ? rankAssessedScores(live.publication.teams, live.details) : [];
  const withJobs = teams.filter(team => team.eligibleJobs > 0), noJobs = teams.length - withJobs.length;

  const begin = async (day?: string) => {
    if (busy) return;
    if (!status || status.state === "not_started") {
      if (!window.confirm(`Analyze ${day ? `${dayLabel(day)} only` : "this week's"} texts, emails and calls for complaints? This uses AI once; finished days are never analyzed again.`)) return;
    }
    setBusy(true); setMessage(null);
    try { await start.mutateAsync({ weekStart, day: day ?? null }); }
    catch (error) { setMessage(error instanceof Error ? error.message : "The analysis could not be started."); }
    finally { setBusy(false); await statusQuery.refetch(); await liveQuery.refetch(); }
  };
  const teamIncidents = (teamId: string): Incident[] => (records.data?.agentId === agentId ? records.data.incidents : [])
    .filter(incident => String(incident.teamId) === teamId && incident.status !== "dismissed");

  return <div className="tp-page"><section className="tp-card" aria-label="Team performance">
    <div className="tp-head">
      <div><h1>Team performance</h1><p>{weekLabel(weekStart)}</p></div>
      <button type="button" className="tp-icon-btn" aria-label="Change week" onClick={() => setPicking(!picking)}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></svg>
      </button>
    </div>
    {picking && <div className="tp-weekpicker">
      <button type="button" onClick={() => { setWeekStart(shiftBookingDate(weekStart, -7)); setOpenTeam(null); }}>‹ Previous week</button>
      {weekStart !== currentSundayWeek() && <button type="button" onClick={() => { setWeekStart(currentSundayWeek()); setOpenTeam(null); }}>This week</button>}
      {weekStart < currentSundayWeek() && <button type="button" onClick={() => { setWeekStart(shiftBookingDate(weekStart, 7)); setOpenTeam(null); }}>Next week ›</button>}
    </div>}
    <div className="tp-stats">
      <div><span>Teams</span><strong>{live ? withJobs.length : "—"}</strong></div>
      <div><span>Quality review</span><strong className={`tp-state-${status && !(status.scope === "day" && status.state === "complete") ? status.state : "not_started"}`}>{!status ? "Loading…" : status.scope === "day" && status.state === "complete" ? "Test day only" : STATE_LABEL[status.state]}</strong></div>
      <div><span>Reporting</span><strong>Weekly</strong></div>
    </div>
    {statusQuery.isError ? <div className="tp-status tp-status-failed"><p>The analysis status could not be loaded. It is retried automatically.</p></div>
      : status ? <AnalysisPanel status={status} busy={busy} onStart={day => void begin(day)} /> : <div className="tp-status"><p>Loading the analysis status…</p></div>}
    {message && <p className="tp-error" role="alert">{message}</p>}

    <div className="tp-table">
      <h2>Team standings{final ? "" : " (provisional)"}</h2>
      {liveQuery.isError ? <p className="tp-error">The standings could not be loaded. They are retried automatically.</p> : !live ? <p className="tp-note">Loading standings…</p> : <>
        <div className="tp-row tp-row-head" aria-hidden="true"><span>Team</span><span>Jobs</span><span>Complaints</span><span>Score</span><span /></div>
        {withJobs.map((team, index) => {
          const open = openTeam === team.id, complaints = live.details[team.id]?.complaintCases ?? 0;
          return <React.Fragment key={team.id}>
            <button type="button" className={`tp-row ${open ? "tp-open" : ""}`} aria-expanded={open} onClick={() => setOpenTeam(open ? null : team.id)}>
              <span>{team.rank !== null ? `${team.rank}. ` : ""}{team.name}{team.unrankedReason && <span className="tp-unranked">Not ranked: fewer than 3 jobs</span>}</span>
              <span>{team.eligibleJobs}</span>
              <span className={final ? "" : "tp-pending"}>{final ? complaints : "Pending"}</span>
              <span>{team.totalScore === null ? "—" : team.totalScore.toFixed(2)}</span>
              <span className="tp-chev" aria-hidden="true">›</span>
            </button>
            {open && <div className="tp-detail">
              <div className="tp-detail-metrics">
                <div><span>Five-star ratings</span><strong>{team.metrics.ratings.successful} / {team.metrics.ratings.eligible}</strong></div>
                <div><span>ETA sent</span><strong>{team.metrics.eta.successful} / {team.metrics.eta.eligible}</strong></div>
                <div><span>Photos</span><strong>{team.metrics.photos.successful} / {team.metrics.photos.eligible}</strong></div>
                <div><span>Complaints{final ? "" : " so far"}</span><strong>{complaints}</strong></div>
              </div>
              {records.isError ? <p className="tp-error">The complaint details could not be loaded.</p> : !records.data ? <p className="tp-note">Loading complaints…</p> : (() => {
                const list = teamIncidents(team.id);
                if (!list.length) return <p className="tp-note">{final ? "No complaints about this team this week." : "No complaints found so far. The analysis is not finished."}</p>;
                return list.map(incident => <article key={incident.id} className="tp-complaint">
                  <strong>{countsAgainstTeam(incident) ? "Cleaning quality" : `${CATEGORY[incident.category] ?? incident.category} · not counted (${qualityExclusionReason(incident)})`}</strong>
                  <small>{CHANNEL[incident.channel] ?? incident.channel} · {time(incident.reportedAtMs)}{incident.customerName ? ` · ${incident.customerName}` : ""}{incident.leadflowJobId ? ` · job ${incident.leadflowJobId}` : ""}{incident.messages.length ? ` · ${incident.messages.length + 1} messages about it` : ""}</small>
                  {incident.evidenceQuote ? <blockquote>“{incident.evidenceQuote}”</blockquote> : incident.evidenceText ? <blockquote>{incident.evidenceText}</blockquote> : null}
                  {(incident.recleanStatus !== "none" || incident.refundStatus !== "none") && <small>Reclean: {incident.recleanStatus} · Refund: {incident.refundStatus}</small>}
                </article>);
              })()}
              <div className="tp-link"><TeamLeaderboardAdminLink teamName={team.name} cleanerProfileId={live.teamAccounts[team.id]?.cleanerProfileId ?? null} unavailableReason={live.teamAccounts[team.id]?.reason}
                resolveProfile={async () => { const fresh = await liveQuery.refetch(); return fresh.data?.teamAccounts[team.id]?.cleanerProfileId ?? null; }} /></div>
            </div>}
          </React.Fragment>;
        })}
        {noJobs > 0 && <p className="tp-note">{noJobs} team{noJobs === 1 ? "" : "s"} had no jobs this week.</p>}
        {!final && <p className="tp-note">Scores and complaints are provisional until the week's analysis is complete.</p>}
      </>}
    </div>

    <details className="tp-advanced">
      <summary>Advanced</summary>
      {status && status.days.length > 0 && <table>
        <thead><tr><th>Day</th><th>Communications</th><th>Analyzed</th><th>Complaints found</th><th>Status</th></tr></thead>
        <tbody>{status.days.map(day => <tr key={day.day}><td>{dayLabel(day.day)}</td><td>{day.eligible}</td><td>{day.processed}</td><td>{day.findings}</td>
          <td>{day.status}{day.reusedFrom ? " (from an earlier run)" : ""}{day.error ? ` · ${day.error}` : ""}</td></tr>)}</tbody>
      </table>}
      {status?.error && <p>Error code: {status.error}</p>}
      <p><button type="button" className="tp-btn" onClick={() => setSizing(true)}>Estimate size (no AI)</button></p>
      {sizing && (estimate.isError ? <p className="tp-error">{estimate.error.message}</p> : !estimate.data ? <p>Reading this week's messages (no AI)…</p> : <table>
        <thead><tr><th>Day</th><th>Communications to analyze</th><th>Text size</th></tr></thead>
        <tbody>{estimate.data.days.map(d => <tr key={d.day}><td>{dayLabel(d.day)}</td><td>{d.communications.toLocaleString("en-US")}</td><td>{Math.round(d.characters / 1000).toLocaleString("en-US")}k characters</td></tr>)}</tbody>
      </table>)}
      {status?.runId && <p>Analysis run: {status.runId}{status.runningHere ? " (running on this server)" : ""}</p>}
      {status && (status.state === "not_started" || status.scope === "day") && status.state !== "running" && <p>
        Test one day first: <input type="date" value={testDay} min={weekStart} max={shiftBookingDate(weekStart, 6)} onChange={event => setTestDay(event.target.value)} />{" "}
        <button type="button" className="tp-btn" disabled={busy || !testDay} onClick={() => void begin(testDay)}>Analyze that day only</button>
      </p>}
      {live && live.notes.length ? <><p>Notes from the job counts:</p><ul>{Array.from(new Set(live.notes)).slice(0, 40).map(w => <li key={w}>{w}</li>)}</ul></> : null}
      <TeamQualityRecords agentId={agentId} weekStart={weekStart} fromRecords onToggleRecords={() => {}} expectedPublicationId={live?.expectedPublicationId}
        onChanged={async () => { await liveQuery.refetch(); await records.refetch(); }} />
    </details>
  </section></div>;
}
