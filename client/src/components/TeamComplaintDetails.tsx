import React from "react";
import { AlertTriangle, MessageCircle, TrendingUp } from "lucide-react";
import { scoreLabel, TEAM_SCORE_METRICS, type TeamComplaintDetail, type TeamScoreMetric } from "@shared/teamLeaderboard";
import "./team-complaints.css";

/** Team page (owner decision, 2026-11-28): each of the team's OWN cleaning complaints in full, and where it lost points.
 * Built only from the published week; no AI. The score maths is the leaderboard's own (shown, never recalculated). */
type ScoredTeam = {
  eligibleJobs: number; availablePoints: number;
  score: { points: Record<TeamScoreMetric, number | null> };
  metrics: Record<TeamScoreMetric, { successful: number; eligible: number }>;
};
const WEIGHT = Object.fromEntries(TEAM_SCORE_METRICS.map(metric => [metric.key, metric.weight])) as Record<TeamScoreMetric, number>;
/** Points one counted complaint takes off the team's total score (out of 100), from the published formula:
 * quality incidents = 55 × (jobs − complaints) ÷ jobs, and the total is scaled to the points that apply. */
export function complaintImpactPoints(team: ScoredTeam | undefined): number | null {
  if (!team || team.eligibleJobs <= 0 || team.availablePoints <= 0 || team.score.points.complaints === null) return null;
  return WEIGHT.complaints / team.eligibleJobs * 100 / team.availablePoints;
}
const cleaningDate = (date: string | null) => date ? new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric", year: "numeric" }) : "Date not recorded";
const SEVERITY: Record<string, string> = { low: "Low", medium: "Medium", high: "High" };
const RECLEAN: Record<string, string> = { none: "No reclean requested", requested: "Reclean requested", completed: "Reclean completed" };
const REFUND: Record<string, string> = { none: "No refund requested", requested: "Refund requested (not issued yet)", issued: "Refund issued" };

export function ComplaintCard({ complaint, impact }: { complaint: TeamComplaintDetail; impact: number | null }) {
  return <article className="tl-complaint-card">
    <span className="tl-feedback-icon"><MessageCircle size={18} aria-hidden="true" /></span>
    <div>
      <div className="tl-complaint-head"><h3>{complaint.customerName ?? "Customer name not recorded"}</h3><span className={`tl-severity tl-severity-${complaint.severity}`}>{SEVERITY[complaint.severity] ?? complaint.severity} severity</span></div>
      <p className="tl-complaint-date">Cleaning on {cleaningDate(complaint.cleaningDate)}</p>
      {complaint.wording ? <blockquote className="tl-complaint-words">“{complaint.wording}”</blockquote> : <p className="tl-complaint-words">The customer's words were not saved for this complaint.</p>}
      {complaint.fullMessage && <p className="tl-complaint-full"><span>Full message:</span> {complaint.fullMessage}</p>}
      <ul className="tl-complaint-facts">
        <li>{RECLEAN[complaint.reclean] ?? `Reclean: ${complaint.reclean}`}</li>
        <li>{REFUND[complaint.refund] ?? `Refund: ${complaint.refund}`}</li>
        <li className="tl-complaint-impact">{impact === null ? "Score impact not available" : `−${scoreLabel(impact)} points from your total score`}</li>
      </ul>
    </div>
  </article>;
}

/** Where the team lost points this week, largest first, each with what to do next. */
export function improvementAreas(team: ScoredTeam, complaintCases: number): Array<{ key: TeamScoreMetric; lost: number; title: string; detail: string }> {
  if (team.availablePoints <= 0) return [];
  const scale = 100 / team.availablePoints;
  const result: Array<{ key: TeamScoreMetric; lost: number; title: string; detail: string }> = [];
  for (const metric of TEAM_SCORE_METRICS) {
    const points = team.score.points[metric.key];
    if (metric.weight <= 0 || points === null) continue;
    const lost = (metric.weight - points) * scale;
    if (lost < 0.005) continue;
    const m = team.metrics[metric.key];
    if (metric.key === "complaints") result.push({ key: metric.key, lost, title: "Cleaning quality",
      detail: `${complaintCases} cleaning complaint${complaintCases === 1 ? "" : "s"} this week. Read each complaint below, fix those areas on every visit and do a final walk-through before leaving.` });
    else if (metric.key === "ratings") result.push({ key: metric.key, lost, title: "Five-star reviews",
      detail: `${m.successful} of ${m.eligible} rated visits were five stars. Every visit should earn five stars: ask the customer if anything else needs attention before you leave.` });
    else if (metric.key === "eta") result.push({ key: metric.key, lost, title: "ETA texts",
      detail: `An ETA was sent for ${m.successful} of ${m.eligible} jobs. Send the ETA before every job.` });
    else if (metric.key === "photos") result.push({ key: metric.key, lost, title: "Job photos",
      detail: `Photos were uploaded for ${m.successful} of ${m.eligible} jobs. Upload photos for every job.` });
  }
  return result.sort((a, b) => b.lost - a.lost);
}

export function AreasForImprovement({ team, complaintCases }: { team: ScoredTeam; complaintCases: number }) {
  const areas = improvementAreas(team, complaintCases);
  return <section className="tl-improve" aria-label="Areas for improvement">
    <div className="tl-improve-head"><TrendingUp size={18} aria-hidden="true" /><h2>Areas for improvement</h2></div>
    {areas.length ? <ol>{areas.map(area => <li key={area.key}><div><strong>{area.title}</strong><span className="tl-improve-lost"><AlertTriangle size={13} aria-hidden="true" />−{scoreLabel(area.lost)} points</span></div><p>{area.detail}</p></li>)}</ol>
      : <p className="tl-improve-none">No points lost in any category this week. Keep it up!</p>}
  </section>;
}
