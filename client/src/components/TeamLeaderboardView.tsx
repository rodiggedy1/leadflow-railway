import {rankAssessedScores} from "@shared/teamLeaderboardReviewScores";
import type { TeamLeaderboardDetails } from "@shared/teamLeaderboardPublication";
import React, { useState } from "react";
import { ArrowRight, Award, Camera, Check, ChevronDown, Clock3, Info, MessageCircle, RefreshCcw, ShieldCheck, Star, Trophy } from "lucide-react";
import { scoreLabel, TEAM_SCORE_METRICS, type TeamLeaderboardPublication } from "@shared/teamLeaderboard";
import { ComplaintCard, AreasForImprovement, complaintImpactPoints } from "./TeamComplaintDetails";
const WEIGHT = Object.fromEntries(TEAM_SCORE_METRICS.map(metric => [metric.key, metric.weight])) as Record<string, number>;
import "./team-leaderboard.css";

const metricIcons = { ratings: Star, complaints: MessageCircle, recovery: RefreshCcw, eta: Clock3, photos: Camera };
type Tab = "standings" | "own" | "rules";

export function TeamLeaderboardView({ publication, ownTeamId, details = {}, preview = false, teamActions, period, overall = false, onOverallChange, controls }: {
  publication: TeamLeaderboardPublication | null;
  ownTeamId: string | null;
  details?: TeamLeaderboardDetails;
  preview?: boolean;
  teamActions?: (teamId: string) => React.ReactNode;
  period?: { weekStart: string; weekEnd: string; weekConvention: string; coverageStart: string; coverageEnd: string };
  overall?: boolean;
  onOverallChange?: (overall: boolean) => void;
  controls?: React.ReactNode;
}) {
  const [tab, setTab] = useState<Tab>("standings");
  const [expandedTeam, setExpandedTeam] = useState<string | null>(null);
  const teams = rankAssessedScores(publication?.teams ?? [], details);
  const own = teams.find(team => team.id === ownTeamId);
  const rankedCount = teams.filter(team => team.rank !== null).length;
  const ownIncidents = (publication?.ownIncidents ?? []).filter(incident => incident.teamId === ownTeamId);

  const coverageLabel = period ? `${period.coverageStart} – ${period.coverageEnd}` : "November 15–19";
  const selectTab = (value: Tab) => { if (value === "standings") onOverallChange?.(false); setTab(value); };
  const navigation = <nav className="tl-tabs" aria-label="Leaderboard views">{([ ["standings", "All-team standings"], ["own", "Your results"], ["rules", "How scoring works"] ] as const).filter(([value]) => !teamActions || value !== "own").map(([value, label]) => <button type="button" key={value} aria-current={tab === value && (value !== "standings" || !overall) ? "page" : undefined} onClick={() => selectTab(value)}>{label}</button>)}{onOverallChange && <button type="button" aria-current={overall && tab === "standings" ? "page" : undefined} onClick={() => { onOverallChange(true); setTab("standings"); }}>Summary</button>}</nav>;

  const metricBreakdown = (team: typeof teams[number]) => <div className="tl-breakdown">
    {TEAM_SCORE_METRICS.filter(metric => metric.weight > 0).map(metric => {
      const Icon = metricIcons[metric.key];
      const display = details[team.id]?.metricDisplay[metric.key];
      return <div className="tl-metric" key={metric.key}>
        <span className="tl-metric-icon" style={{ color: metric.color }}><Icon size={18} aria-hidden="true" /></span>
        <div className="tl-metric-top"><h3>{metric.key === "photos" ? "Photos submitted" : metric.label}</h3><strong className={`tl-metric-value ${display?.value === "Not available" ? "tl-value-missing" : ""}`}>{metric.key === "recovery" ? team.confirmedRecoveryCases : display?.value ?? "Not available"}</strong><small className="tl-metric-unit">{metric.key === "recovery" ? period ? "admin-recorded recleans/refunds" : "recorded recleans/refunds" : display?.unit}</small></div>
        <div className={`tl-category-points ${team.score.points[metric.key] === null ? "tl-points-pending" : ""}`}>
          <strong>{team.score.points[metric.key] === null ? "N/A" : scoreLabel(team.score.points[metric.key])}</strong>
          <span> / {metric.weight} points{metric.key === "complaints" || metric.key === "recovery" ? " remaining" : ""}</span>
        </div>
        <p>{metric.key === "recovery" ? `${period ? `${team.confirmedRecoveryCases} admin-recorded completed reclean/refund${team.confirmedRecoveryCases === 1 ? "" : "s"} in this reviewed period. No record is not proof of provider-wide outcome completeness.` : "No completed reclean/refund recorded in this reviewed period."} ${details[team.id]?.refundRequests ? `${details[team.id].refundRequests} refund request — not a completed refund.` : ""}` : metric.key === "complaints" ? `${metric.weight} × (${team.eligibleJobs} jobs − ${details[team.id]?.complaintCases ?? 0} quality incidents) ÷ ${team.eligibleJobs}.` : display?.note}</p>
      </div>;
    })}
  </div>;
  const feedback = (teamId: string) => <div className="tl-inline-feedback">
    {(publication?.ownIncidents ?? []).filter(incident => incident.teamId === teamId).map(incident => incident.complaint
      ? <ComplaintCard key={incident.id} complaint={incident.complaint} impact={complaintImpactPoints(teams.find(team => team.id === teamId))} />
      : <article key={incident.id}>
      <div className="tl-incident-meta">{incident.date}<span>{incident.sourceLabel}</span></div>
      <h3>{incident.summary}</h3><p>{incident.outcome}</p>
    </article>)}
  </div>;

  return <div className="tl-page">
    <header className="tl-header"><a className="tl-brand" href={teamActions ? "/admin/dashboard" : "/portal-v2"} aria-label={teamActions ? "Maids in Black staff dashboard" : "Maids in Black team portal"}><span>MIB</span><div>MAIDS IN BLACK<small>TEAM PERFORMANCE</small></div></a><div className="tl-secure"><ShieldCheck size={15} aria-hidden="true" /> {overall ? "Published Summary" : period ? "Published week" : controls ? "Published history" : "Week-to-date"}</div></header>
    <main className="tl-container">
      {preview && <div className="tl-preview" role="status"><span>FIRST DRAFT</span> Sample results for design review only. Not live scores or scheduling decisions.</div>}
      <section className="tl-title"><div><p className="tl-eyebrow">BETTER SERVICE. STRONGER TEAMS.</p><h1>{overall ? "Team leaderboard Summary" : "Weekly team leaderboard"}<span>.</span></h1>{(!controls || overall) && <p>{overall ? "Recorded counts across published weeks, not averages of weekly scores." : period ? `${coverageLabel} reviewed results, using the same reviewed-feedback and submission scoring.` : "November 15–19 results so far, using the same reviewed-feedback and submission scoring."}</p>}</div>{!controls && <div className="tl-week"><Clock3 size={17} aria-hidden="true" /><div><strong>{publication?.weekLabel ?? "Weekly results"}</strong><small>{period ? `${overall ? "Published weeks" : "Sunday-start"} · through ${period.coverageEnd}` : controls ? "No published results loaded" : "Sunday–Thursday · through November 19"}</small></div></div>}</section>
      {controls}
      {!publication && onOverallChange && navigation}
      {!publication ? controls ? null : <section className="tl-unpublished"><Trophy size={36} aria-hidden="true" /><h2>{controls ? "Published results are not loaded for this view." : "Your weekly results are on the way."}</h2><p>{controls ? "Use the history controls above to select or refresh a saved publication. Loading, access and publication status appear there; unpublished drafts are not standings." : "No leaderboard has been published here yet. Once results are ready, you’ll be able to see all-team standings, your score breakdown and reviewed feedback."}</p><a href={teamActions ? "/admin/dashboard" : "/portal-v2"}>{teamActions ? "Back to staff dashboard" : "Back to team portal"} <ArrowRight size={16} /></a></section> : <>
        {!teamActions && <section className="tl-summary" aria-label="Your weekly result">
          <div className="tl-own-summary"><div className="tl-summary-caption"><Award size={19} aria-hidden="true" />{own ? `${own.name} · Your team` : "All-team standings"}</div><div className="tl-score-line"><strong>{scoreLabel(own?.totalScore ?? null)}</strong><span>total score<small>Out of 100 · based on {own?.availablePoints ?? 0} available points</small></span></div><div className="tl-summary-base">{own?.rank ? <span>Team <b>{own.rank}</b> of {rankedCount}</span> : <span>{own?.unrankedReason ?? "No scored jobs to rank yet."}</span>}<button type="button" onClick={() => setTab("own")}>See your breakdown <ArrowRight size={15} /></button></div></div>
          <div className="tl-summary-context tl-daily-glance" aria-label="Team detail summary">
            <div className="tl-glance-heading"><h2>{overall ? "Published periods at a glance" : "This week at a glance"}</h2><span>{own?.eligibleJobs ?? "—"} recorded jobs</span></div>
            <div className="tl-glance-grid">
              <div className="tl-glance-stat" data-summary="complaints"><span><MessageCircle size={14} aria-hidden="true" />Quality incidents</span><div><strong>{own ? details[own.id]?.complaintCases ?? 0 : "—"}</strong><small>{scoreLabel(own?.score.points.complaints ?? null)} / {WEIGHT.complaints} pts</small></div></div>
              <div className="tl-glance-stat" data-summary="eta"><span><Clock3 size={14} aria-hidden="true" />ETA submitted</span><div><strong>{own ? details[own.id]?.metricDisplay.eta.value : "—"}</strong><small>{scoreLabel(own?.score.points.eta ?? null)} / {WEIGHT.eta} pts</small></div></div>
              <div className="tl-glance-stat" data-summary="photos"><span><Camera size={14} aria-hidden="true" />Photos submitted</span><div><strong>{own ? details[own.id]?.metricDisplay.photos.value : "—"}</strong><small>{scoreLabel(own?.score.points.photos ?? null)} / {WEIGHT.photos} pts</small></div></div>
            </div>
            <div className="tl-glance-feedback"><p>{ownIncidents.length ? ownIncidents.map(incident => incident.complaint?.customerName ? `${incident.complaint.customerName}: “${incident.summary}”` : incident.summary).join(" · ") : "No customer complaints flagged in this review."}</p>{own && (details[own.id]?.refundRequests ?? 0) > 0 && <small>{details[own.id].refundRequests} refund request · not a completed refund</small>}</div>
          </div>
        </section>}
        {!teamActions && own && <AreasForImprovement team={own} complaintCases={details[own.id]?.complaintCases ?? 0} />}
        {navigation}
        {tab === "standings" && <section className="tl-standings"><div className="tl-section-head"><div><h2>{overall ? "Summary · all published weeks" : controls ? "Team rankings" : period ? `${coverageLabel} team results` : "November 15–19 team results"}</h2><p>{teams.length} teams · Highest total score first.</p></div><span className="tl-publication"><Check size={13} aria-hidden="true" />{preview ? "Sample publication" : publication.publishedLabel}</span></div><div className="tl-table-head" aria-hidden="true"><span>ORDER</span><span>TEAM</span><span>JOBS</span><span>TOTAL SCORE</span><span /></div><div className="tl-team-list">{teams.map(team => <div className={`tl-team-group ${team.id === ownTeamId ? "tl-is-own" : ""}`} key={team.id}><button type="button" className="tl-team-row" aria-expanded={expandedTeam === team.id} onClick={() => setExpandedTeam(expandedTeam === team.id ? null : team.id)}><span className={`tl-rank ${team.rank === 1 ? "tl-rank-first" : ""}`}>{team.rank === null ? "—" : String(team.rank)}</span><span className="tl-team-identity"><span className="tl-avatar" aria-hidden="true">{team.name.split(" ").slice(0, 2).map(word => word[0]).join("")}</span><span><strong>{team.name}{team.id === ownTeamId && <em>Your team</em>}</strong><small>{team.eligibleJobs} recorded jobs · {details[team.id]?.complaintCases ?? 0} reviewed complaints{team.unrankedReason ? ` · ${team.unrankedReason}` : ""}</small></span></span><span className="tl-job-count">{team.eligibleJobs}</span><span className="tl-row-score">{scoreLabel(team.totalScore)}<small className="tl-row-count-label">total score</small></span><ChevronDown size={17} className={expandedTeam === team.id ? "tl-rotated" : ""} aria-hidden="true" /></button>{teamActions?.(team.id)}{expandedTeam === team.id && <div className="tl-row-detail">{metricBreakdown(team)}{feedback(team.id)}</div>}</div>)}</div><div className="tl-table-note"><Info size={15} aria-hidden="true" /><span>Teams are shown as 1, 2, 3 in descending total-score order. Totals are out of 100, using the category points that apply: quality incidents 55, five-star ratings 30, ETA 10, photos 5. No quality incidents earns 55/55; a complaint, its reclean and a quality refund count once. No received ratings remains N/A and is left out of the total. Teams with fewer than 3 completed jobs are shown but not ranked. A job with no portal record counts as a missed ETA.</span></div></section>}
        {tab === "own" && <section className="tl-results"><div className="tl-section-head"><div><h2>{overall ? "Your published Summary, explained" : "Your week, explained"}</h2><p>Submission counts, category points and the total behind your rank.</p></div><span className="tl-publication">{own?.name ?? "Team not linked"}</span></div>{own ? metricBreakdown(own) : <p className="tl-no-team">Your account has not been linked to a team in this publication.</p>}<div className="tl-feedback"><div><p className="tl-eyebrow">REVIEWED FEEDBACK</p><h2>{overall ? "Reviewed feedback across published weeks" : "Reviewed feedback for this week"}</h2><p>Only the selected team’s reviewed customer feedback appears here.</p></div>{ownIncidents.length ? ownIncidents.map(incident => incident.complaint ? <ComplaintCard key={incident.id} complaint={incident.complaint} impact={complaintImpactPoints(own)} /> : <article key={incident.id}><span className="tl-feedback-icon"><MessageCircle size={18} aria-hidden="true" /></span><div><div className="tl-incident-meta">{incident.date}<span>{incident.sourceLabel}</span></div><h3>{incident.summary}</h3><p>{incident.outcome}</p><small>Linked to the affected service and mapped team. The reviewed complaint reduces the total. A refund request is not recorded as a completed refund.</small></div></article>) : <div className="tl-no-incidents"><ShieldCheck size={22} aria-hidden="true" /><p>No reviewed incidents are shown for your team in this publication.</p></div>}<p className="tl-correction-note">If a reviewed incident is incorrect, contact the office with the service date. Corrections should be reviewed before a result is changed.</p></div></section>}
        {tab === "rules" && <section className="tl-rules"><div className="tl-section-head"><div><h2>A fair, clear 100-point score</h2><p>85 points measure customer satisfaction and service quality. 15 points cover ETA communication and job photos.</p></div></div><div className="tl-weight-bar" aria-hidden="true">{TEAM_SCORE_METRICS.filter(metric => metric.weight > 0).map(metric => <span key={metric.key} style={{ flex: metric.weight, background: metric.color }} />)}</div>{TEAM_SCORE_METRICS.filter(metric => metric.weight > 0).map(metric => { const Icon = metricIcons[metric.key]; return <article key={metric.key}><span style={{ color: metric.color }}><Icon size={20} aria-hidden="true" /></span><div><h3>{metric.label}</h3><p>{metric.key === "complaints" ? "55 × (completed jobs − quality incidents) ÷ completed jobs. No incidents = 55/55. A complaint, its reclean and a quality-related refund are one incident; repeat messages count once. Office, billing and scheduling issues are not counted." : metric.key === "recovery" ? "20 × (jobs − reclean/refund-affected jobs) ÷ jobs. No recorded recleans/refunds = 20/20. A reclean and refund on one job count once. A request alone is not a completed refund." : metric.key === "photos" ? "Earn 5 × jobs with photos submitted ÷ jobs. At least one photo counts; no quality or minimum-count requirement." : metric.key === "eta" ? "Earn 10 × jobs with an ETA submitted ÷ jobs. This does not judge punctuality." : metric.rule}</p></div><strong>{metric.weight}<small>points</small></strong></article>; })}<div className="tl-rules-footer"><ShieldCheck size={22} aria-hidden="true" /><div><h3>{overall ? "Summary uses combined counts, not averaged weekly scores." : period ? "Published reviewed period, not a provider-wide completeness claim." : "Week-to-date results, not final weekly totals."}</h3><p>{period ? `These results cover communications reviewed ${coverageLabel}${overall ? " across published weeks" : ""}.` : "These results cover communications reviewed November 15–19."} Feedback may refer to earlier service dates. It does not move bookings or replace team assignments.</p><p>No ratings means N/A; the 30-point category is excluded from the available total, not awarded or treated as zero. No recorded jobs means “Not ranked.”</p></div></div></section>}
        <section className="tl-bottom-note"><ShieldCheck size={18} aria-hidden="true" /><span>Reviewed feedback is grouped by service, not message count. A refund request is not a completed refund. The reclean/refund count reflects recorded outcomes in this reviewed period, not refund requests.</span></section>
      </>}
      <footer className="tl-footer"><span>MAIDS IN BLACK <b>·</b> TEAM PERFORMANCE</span><span>{period ? `${overall ? "Summary" : "Reviewed period"} · ${coverageLabel}` : "Service quality, made visible."}</span></footer>
    </main>
  </div>;
}
