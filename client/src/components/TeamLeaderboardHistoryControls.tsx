import React, { useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import type { WeekOption } from "@shared/teamLeaderboardHistory";
import { teamEvidenceWeekInputSchema } from "@shared/teamLeaderboardEvidence";
import { TeamLeaderboardReviewDraft } from "./TeamLeaderboardReviewDraft";
import "./team-leaderboard-history.css";

export const isSundayWeek = (value: string) => teamEvidenceWeekInputSchema.safeParse({ weekStart: value }).success;
export function shiftSundayWeek(value: string, direction: -1 | 1): string {
  if (!isSundayWeek(value)) return "";
  const day = new Date(`${value}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() + direction * 7);
  return day.toISOString().slice(0, 10);
}

export function TeamLeaderboardHistoryControls({ weeks, weekStart, overall, onWeekChange, admin = false, loading = false, error, children }: {
  weeks: WeekOption[];
  weekStart: string;
  overall: boolean;
  onWeekChange: (weekStart: string) => void;
  admin?: boolean;
  loading?: boolean;
  error?: string | null;
  children?: React.ReactNode;
}) {
  const [weekInput, setWeekInput] = useState(weekStart);
  const [attempted, setAttempted] = useState(false);
  const valid = isSundayWeek(weekInput);
  const published = weeks.some(week => week.weekStart === weekStart);
  return <section className="tl-history-controls" aria-label="Leaderboard history">
    <div className="tl-history-heading"><div><h2>Published history</h2><p>{overall ? "Summary combines recorded counts from the latest published revision of each week, not averages of weekly scores." : "Choose a saved Sunday-start week. Drafts do not change these results until explicitly published."}</p></div></div>
    <div className="tl-history-fields"><label>Published week<select aria-label="Published week" value={published ? weekStart : ""} disabled={loading || weeks.length === 0} onChange={event => { onWeekChange(event.target.value); setWeekInput(event.target.value); setAttempted(false); }}>
      <option value="" disabled>{weeks.length ? "Choose a published week" : "No saved published weeks"}</option>
      {weeks.map(week => <option key={week.id} value={week.weekStart}>{week.weekStart} – {week.weekEnd} · through {week.coverageEnd}</option>)}
    </select></label></div>
    {admin && <form className="tl-history-week-form" onSubmit={event => { event.preventDefault(); setAttempted(true); if (valid) onWeekChange(weekInput); }}>
      <label>Review week starts Sunday<input type="text" aria-label="Review week starts Sunday" aria-describedby="tl-history-week-help" aria-invalid={attempted && !valid} value={weekInput} placeholder="YYYY-MM-DD" maxLength={10} onChange={event => { setWeekInput(event.target.value); setAttempted(true); }} /></label>
      <div className="tl-history-buttons"><button type="button" disabled={!valid} onClick={() => { const week = shiftSundayWeek(weekInput, -1); setWeekInput(week); onWeekChange(week); }}>Previous week</button><button type="button" disabled={!valid} onClick={() => { const week = shiftSundayWeek(weekInput, 1); setWeekInput(week); onWeekChange(week); }}>Next week</button><button type="submit" disabled={!valid}>Use review week</button></div>
      <p id="tl-history-week-help">Enter a valid Sunday as YYYY-MM-DD. This selects a week only; it never starts a review.</p>
      {attempted && !valid && <p className="tl-history-error" role="alert">Use a valid Sunday date in YYYY-MM-DD format.</p>}
    </form>}
    {loading && <p role="status">Loading published history…</p>}
    {error && <p className="tl-history-error" role="alert">{error}</p>}
    {children}
  </section>;
}

const queryOptions = { retry: false as const, throwOnError: false as const, refetchOnWindowFocus: false, staleTime: 0 };
const EMPTY_REVIEW_ID = "00000000-0000-4000-8000-000000000000";
export function TeamLeaderboardAdminReviewControls({ agentId, weekStart, accessReady, onPublished }: {
  agentId: number;
  weekStart: string;
  accessReady: boolean;
  onPublished: () => Promise<void>;
}) {
  const [reviewId, setReviewId] = useState("");
  const [request, setRequest] = useState<{ weekStart: string; requestId: string } | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // State disables the UI; this ref also locks same-task events before rerender.
  const actionPending = useRef(false);
  const meQuery = trpc.agents.me.useQuery(undefined, { retry: false, throwOnError: false, staleTime: 0 });
  const validWeek = isSundayWeek(weekStart);
  const currentStaff = accessReady && !meQuery.isError && !meQuery.isLoading && meQuery.data?.isAdmin === true && meQuery.data.id === agentId;
  const runsQuery = trpc.leadflowJobs.leaderboard.history.reviewRuns.useQuery({ weekStart }, { ...queryOptions, enabled: currentStaff && validWeek });
  const draftQuery = trpc.leadflowJobs.leaderboard.history.reviewDraft.useQuery({ reviewId: reviewId || EMPTY_REVIEW_ID }, { ...queryOptions, enabled: currentStaff && Boolean(reviewId) });
  const startMutation = trpc.leadflowJobs.leaderboard.history.startReview.useMutation({ retry: false });
  const publishMutation = trpc.leadflowJobs.leaderboard.history.publishReview.useMutation({ retry: false });
  const runs = !runsQuery.isError && !runsQuery.isLoading && runsQuery.data?.agentId === agentId && runsQuery.data.runs.every(run => run.weekStart === weekStart) ? runsQuery.data.runs : null;
  const draft = !draftQuery.isError && !draftQuery.isLoading && draftQuery.data?.agentId === agentId && draftQuery.data.id === reviewId && draftQuery.data.weekStart === weekStart ? draftQuery.data : null;
  const confirmStaff = async () => {
    const fresh = await meQuery.refetch();
    if (fresh.isError || fresh.data?.id !== agentId || fresh.data?.isAdmin !== true) throw new Error("Current staff access could not be confirmed. No action was submitted.");
  };
  const start = async (retrySameRequest: boolean) => {
    if (actionPending.current || busy || !currentStaff || !validWeek) return;
    actionPending.current = true;
    setBusy(true); setStartError(null); setPublishError(null);
    try {
      await confirmStaff();
      const input = retrySameRequest && request?.weekStart === weekStart ? request : { weekStart, requestId: crypto.randomUUID() };
      setRequest(input);
      const result = await startMutation.mutateAsync(input);
      if (result.agentId !== agentId || result.weekStart !== weekStart || result.id !== input.requestId) throw new Error("Current staff/review identity could not be confirmed. Reload saved reviews; do not assume this run failed.");
      setReviewId(result.id); setRequest(null);
      await runsQuery.refetch();
    } catch (error) {
      setStartError(`${error instanceof Error ? error.message : "The run request could not be confirmed."} No automatic retry was made. Refresh saved reviews before intentionally creating another run.`);
    } finally { actionPending.current = false; setBusy(false); }
  };
  if (!currentStaff) return <p role="status">Current staff access is required to load or run saved reviews.</p>;
  return <section className="tl-history-admin" aria-label="Manual weekly review">
    <h3>Manual weekly review · {validWeek ? weekStart : "select a Sunday"}</h3>
    <p>Run creates a saved, unpublished draft. Re-run creates a separate draft and never replaces the current publication. No review runs on page load, week selection or reload.</p>
    <div className="tl-history-buttons"><button type="button" className="tl-history-primary" disabled={busy || !validWeek} onClick={() => void start(false)}>{busy ? "Submitting…" : runs?.length ? "Run new review / re-run" : "Run review"}</button><button type="button" disabled={busy || !validWeek} onClick={() => { void runsQuery.refetch(); if (reviewId) void draftQuery.refetch(); }}>Refresh saved reviews / progress</button></div>
    {startError && <p className="tl-history-error" role="alert">{startError}</p>}
    {startError && request && <button type="button" disabled={busy} onClick={() => void start(true)}>Retry same run request (same ID; no duplicate provider run)</button>}
    {runsQuery.isError ? <p className="tl-history-error" role="alert">Saved reviews could not be loaded. Refresh to retry this read; no review was started.</p> : validWeek && !runs ? <p role="status">Loading saved reviews…</p> : null}
    <label>Saved review<select aria-label="Saved review" value={reviewId} disabled={busy || !runs} onChange={event => { setReviewId(event.target.value); setPublishError(null); }}><option value="">Choose a saved draft or published run</option>{runs?.map(run => <option key={run.id} value={run.id}>{run.status} · {new Date(run.createdAtMs).toISOString()} · {run.id}{run.publishedAtMs !== null ? " · published" : ""}{["reading", "reviewing"].includes(run.status) && !run.runningHere ? " · not running here" : ""}</option>)}</select></label>
    {runs?.length === 0 && <p>No saved reviews for this week. Run is still available.</p>}
    {reviewId && (draftQuery.isError ? <p className="tl-history-error" role="alert">The saved draft could not be loaded. Refresh to retry the read. Publishing is unavailable.</p> : !draft ? <p role="status">Loading the selected review draft…</p> : <TeamLeaderboardReviewDraft key={`${agentId}:${draft.id}:${draft.updatedAtMs}:${draft.expectedPublicationId ?? "none"}`} draft={draft} agentId={agentId} busy={busy} error={publishError} onPublish={async input => {
      if (actionPending.current || busy || !currentStaff || !draft || draft.agentId !== agentId || draft.id !== reviewId || draft.weekStart !== weekStart) return;
      actionPending.current = true;
      setBusy(true); setPublishError(null);
      try {
        await confirmStaff();
        const fresh = await draftQuery.refetch();
        if (fresh.isError || !fresh.data || fresh.data.agentId !== agentId || fresh.data.id !== input.reviewId || fresh.data.weekStart !== weekStart || fresh.data.updatedAtMs !== draft.updatedAtMs || fresh.data.expectedPublicationId !== input.expectedPublicationId) throw new Error("The publication or draft changed. Review the refreshed draft and acknowledge limitations again before publishing.");
        if (!fresh.data.counts?.complete || !fresh.data.progress?.completeReview || !fresh.data.outcome?.validOutput || !["completed", "incomplete"].includes(fresh.data.status)) throw new Error("The refreshed draft is not ready to publish. Previous results are unchanged.");
        const result = await publishMutation.mutateAsync(input);
        if (result.agentId !== agentId || result.id !== input.reviewId || result.weekStart !== weekStart) throw new Error("Publication identity could not be confirmed. Refresh published history.");
        await Promise.all([draftQuery.refetch(), runsQuery.refetch(), onPublished()]);
      } catch (error) { setPublishError(error instanceof Error ? error.message : "Publish could not be confirmed. Refresh the draft before another explicit Publish; no automatic retry was made."); }
      finally { actionPending.current = false; setBusy(false); }
    }} />)}
  </section>;
}
