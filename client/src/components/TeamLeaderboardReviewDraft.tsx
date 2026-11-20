import React, { useState } from "react";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../server/routers";
import type { ReviewPublish } from "@shared/teamLeaderboardHistory";
import "./team-leaderboard-history.css";

type Draft = inferRouterOutputs<AppRouter>["leadflowJobs"]["leaderboard"]["history"]["reviewDraft"];
type Decision = ReviewPublish["decisions"][number];

export function TeamLeaderboardReviewDraft({ draft, agentId, busy = false, error, onPublish }: {
  draft: Draft;
  agentId: number;
  busy?: boolean;
  error?: string | null;
  onPublish: (input: ReviewPublish) => Promise<void>;
}) {
  const groups = draft.outcome?.visitGroups ?? [];
  const [decisions, setDecisions] = useState<Decision[]>(() => groups.map(group => ({
    visitId: group.visitId, teamId: group.teamId, includeComplaint: true, completedRecovery: false, outcomeNote: "",
  })));
  const [acknowledged, setAcknowledged] = useState(false);
  // A stale identity/period must never expose even the draft's private summaries.
  if (draft.agentId !== agentId) return <p role="status">Current staff access could not be confirmed. Reload saved reviews.</p>;
  const unmatched = (draft.outcome?.matches ?? []).filter(match => match.status !== "matched");
  const blocks = [
    ...(!draft.counts?.complete ? ["Job/submission counts are incomplete."] : []),
    ...(!draft.progress?.completeReview ? ["The communication review is not complete."] : []),
    ...(!draft.outcome?.validOutput ? ["The review output is unavailable or invalid."] : []),
    ...(!["completed", "incomplete"].includes(draft.status) ? ["This saved run is not ready for publication."] : []),
    ...(decisions.length !== groups.length || groups.some(group => !decisions.some(decision => decision.visitId === group.visitId && decision.teamId === group.teamId)) ? ["Decisions do not cover the captured groups. Reload this draft."] : []),
    ...(decisions.some(decision => decision.completedRecovery && !decision.outcomeNote.trim()) ? ["Every completed recovery requires an outcome note."] : []),
  ];
  const published = draft.publishedAtMs !== null;
  const update = (index: number, patch: Partial<Decision>) => setDecisions(current => current.map((value, i) => i === index ? { ...value, ...patch } : value));
  const warnings = [...(draft.counts?.warnings ?? []), ...(draft.progress?.warnings ?? [])];
  const coverage = draft.progress?.coverage;
  return <section className="tl-history-draft" aria-label="Saved review draft">
    <div className="tl-history-heading"><div><h3>{published ? "Published review" : "Unpublished review draft"}</h3><p>Sunday {draft.weekStart} · {draft.status}</p></div><span className="tl-history-tag">{published ? "Published" : "Not published"}</span></div>
    <p className="tl-history-id">Saved review: {draft.id}</p>
    {!published && ["reading", "reviewing"].includes(draft.status) && <p role="status">{draft.runningHere ? "Review is running. Refresh the draft to check progress." : "This saved run is not running on this server. It will not resume automatically. You may intentionally run a new review."}</p>}
    <div className="tl-history-warnings">
      <h4>Coverage and limitations</h4>
      <p>{draft.counts?.complete ? "Job/submission count read complete." : "Job/submission counts unavailable or incomplete; partial counts are not proven zeros."} {draft.progress?.completeReview ? "Eligible retained communications reviewed." : "Communication review incomplete."}</p>
      {coverage && <p>{coverage.deliveredEligibleCount} / {coverage.eligibleTotal} eligible retained sources delivered; {coverage.pendingCount} pending. Provider-wide coverage is not verified.</p>}
      <p>This review uses retained originals only. Matching is a suggested service/team association, not verified fault. An admin publication is an explicit decision, not model verification. A request alone is never a completed reclean/refund. No recorded recovery is not proof of complete provider outcomes.</p>
      {warnings.length > 0 && <ul>{Array.from(new Set(warnings)).map(warning => <li key={warning}>{warning}</li>)}</ul>}
      <h4>Unmatched reports: {unmatched.length}</h4>
      <p>Unmatched reports have no team deduction. Review the unresolved association and coverage warnings before publishing.</p>
      {unmatched.map((match, i) => <article key={`${match.candidate.evidenceId}:${i}`}><strong>{match.candidate.summary}</strong><p>{match.reviewReasons.join("; ") || "Affected service/team needs review."}</p>{match.limitations.length > 0 && <p>{match.limitations.join("; ")}</p>}</article>)}
      {(draft.outcome?.rejectedCandidateCount ?? 0) > 0 && <p role="alert">Rejected candidates: {draft.outcome!.rejectedCandidateCount}. Invalid output cannot be published.</p>}
    </div>
    {draft.counts && <section className="tl-history-counts" aria-label="Captured job and submission counts">
      <h4>Captured job and submission counts</h4>
      <p>{draft.counts.period.coverageStart} – {draft.counts.period.coverageEnd} · {draft.counts.complete ? "Complete owned-record traversal" : "Partial counts; not proven totals or zeros"}. Ratings use received numeric ratings, not the job count.</p>
      {draft.counts.teams.map(team => <article key={team.id}><strong>{team.name}</strong><dl>
        <div><dt>Recorded jobs</dt><dd>{team.eligibleJobs}</dd></div>
        <div><dt>Five-star / received ratings</dt><dd>{team.metrics.ratings.complete ? `${team.metrics.ratings.successful} / ${team.metrics.ratings.eligible}` : "Incomplete / unavailable"}</dd></div>
        <div><dt>Jobs with ETA / eligible</dt><dd>{team.metrics.eta.complete ? `${team.metrics.eta.successful} / ${team.metrics.eta.eligible}` : "Incomplete / unavailable"}</dd></div>
        <div><dt>Jobs with photos / eligible</dt><dd>{team.metrics.photos.complete ? `${team.metrics.photos.successful} / ${team.metrics.photos.eligible}` : "Incomplete / unavailable"}</dd></div>
      </dl></article>)}
    </section>}
    {!published && <form onSubmit={event => {
      event.preventDefault();
      if (!busy && acknowledged && blocks.length === 0 && draft.agentId === agentId) {
        void onPublish({ reviewId: draft.id, expectedPublicationId: draft.expectedPublicationId, decisions, acknowledgeLimitations: true });
      }
    }}>
      <h4>Suggested complaints · {groups.length} affected service/team groups</h4>
      <p>Matched groups are selected by default. Review every inclusion; Publish explicitly confirms these decisions. Repeated reports for one affected service/team count once.</p>
      {groups.map((group, index) => {
        const decision = decisions[index];
        return <fieldset key={`${group.visitId}:${group.teamId}`} disabled={busy} className="tl-history-group">
          <legend>{group.matches[0]?.team?.name ?? `Team ${group.teamId}`} · Service {group.serviceDate} · Job {group.visitId}</legend>
          {group.matches.map((match, i) => <div key={`${match.candidate.evidenceId}:${i}`}><p>{match.candidate.summary}</p><small>{match.candidate.category.replaceAll("_", " ")} · {match.matchBasis?.replaceAll("_", " ") ?? "Association needs review"}</small>{match.limitations.length > 0 && <p>{match.limitations.join("; ")}</p>}</div>)}
          <label className="tl-history-check"><input type="checkbox" checked={decision?.includeComplaint ?? false} onChange={event => update(index, { includeComplaint: event.target.checked })} />Include suggested complaint for this affected service/team</label>
          <label className="tl-history-check"><input type="checkbox" checked={decision?.completedRecovery ?? false} onChange={event => update(index, { completedRecovery: event.target.checked })} />Explicitly record a completed reclean/refund</label>
          <label>Reviewed outcome note {decision?.completedRecovery ? "(required for completed recovery)" : "(optional)"}<textarea value={decision?.outcomeNote ?? ""} maxLength={2000} required={decision?.completedRecovery ?? false} onChange={event => update(index, { outcomeNote: event.target.value })} /></label>
        </fieldset>;
      })}
      {blocks.length > 0 && <div className="tl-history-error" role="status"><strong>Publish unavailable</strong><ul>{blocks.map(block => <li key={block}>{block}</li>)}</ul></div>}
      <label className="tl-history-check tl-history-ack"><input type="checkbox" checked={acknowledged} disabled={busy} onChange={event => setAcknowledged(event.target.checked)} />I reviewed the suggested inclusions, unmatched reports and coverage/provenance limitations. I confirm only explicitly recorded completed recoveries and understand this publishes a new revision.</label>
      {error && <p className="tl-history-error" role="alert">{error}</p>}
      <button type="submit" className="tl-history-primary" disabled={busy || !acknowledged || blocks.length > 0}>{busy ? "Publishing…" : "Publish reviewed results"}</button>
      <p>Running or re-running a review does not replace any published result. Only this explicit Publish action changes the published revision.</p>
    </form>}
  </section>;
}
