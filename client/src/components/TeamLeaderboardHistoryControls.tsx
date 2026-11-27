import React, { useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import type { WeekOption } from "@shared/teamLeaderboardHistory";
import { teamEvidenceWeekInputSchema } from "@shared/teamLeaderboardEvidence";
import { easternDateIso, easternDateLabel } from "@shared/easternTime";
import { shiftBookingDate } from "@shared/bookingReschedule";
import { TeamLeaderboardReviewDraft } from "./TeamLeaderboardReviewDraft";
import "./team-leaderboard-history.css";

export const isSundayWeek = (value: string) => teamEvidenceWeekInputSchema.safeParse({ weekStart: value }).success;
export function currentSundayWeek(now = new Date()): string {
  const today = easternDateIso(now);
  return shiftBookingDate(today, -new Date(`${today}T00:00:00Z`).getUTCDay());
}
export function shiftSundayWeek(value: string, direction: -1 | 1): string {
  return isSundayWeek(value) ? shiftBookingDate(value, direction * 7) : "";
}
export function leaderboardWeekLabel(value: string): string {
  if (!isSundayWeek(value)) return "Choose a week";
  return `${easternDateLabel(value, { month: "short", day: "numeric" })} – ${easternDateLabel(shiftBookingDate(value, 6), { month: "short", day: "numeric", year: "numeric" })}`;
}

export function TeamLeaderboardHistoryControls({ weeks, weekStart, overall, onWeekChange, admin = false, loading = false, error, coverageEnd, onRefresh, reviewControls, children }: {
  weeks: WeekOption[];
  weekStart: string;
  overall: boolean;
  onWeekChange: (weekStart: string) => void;
  admin?: boolean;
  loading?: boolean;
  error?: string | null;
  coverageEnd?: string;
  onRefresh?: () => void;
  reviewControls?: React.ReactNode;
  children?: React.ReactNode;
}) {
  const [weekInput, setWeekInput] = useState(weekStart);
  const [attempted, setAttempted] = useState(false);
  const [choosingWeek, setChoosingWeek] = useState(false);
  const changeButton = useRef<HTMLButtonElement>(null);
  const valid = isSundayWeek(weekInput);
  const published = weeks.some(week => week.weekStart === weekStart);
  const choose = (value: string) => { onWeekChange(value); setChoosingWeek(false); };
  return <section className="tl-history-controls" aria-label="Week controls" onKeyDown={event => {
    if (event.key === "Escape" && choosingWeek) { setChoosingWeek(false); changeButton.current?.focus(); }
  }}>
    <div className="tl-history-week"><span>{overall ? "Summary" : weekStart === currentSundayWeek() ? "Current week" : "Selected week"}</span><strong>{overall ? "All published weeks" : leaderboardWeekLabel(weekStart)}</strong>{coverageEnd && !overall && <small>Updated through {easternDateLabel(coverageEnd, { month: "short", day: "numeric" })}</small>}</div>
    <button ref={changeButton} type="button" className="tl-change-week" aria-expanded={choosingWeek} aria-controls="tl-week-chooser" onClick={() => setChoosingWeek(current => !current)}>Change week</button>
    {reviewControls}
    {choosingWeek && <div id="tl-week-chooser" className="tl-week-chooser" role="group" aria-label="Choose week">
      {weeks.length > 0 && <label>Saved weeks<select aria-label="Published week" value={!overall && published ? weekStart : ""} disabled={loading} onChange={event => choose(event.target.value)}>
        <option value="" disabled>Choose a saved week</option>{weeks.map(week => <option key={week.id} value={week.weekStart}>{leaderboardWeekLabel(week.weekStart)}</option>)}
      </select></label>}
      {admin && <form onSubmit={event => { event.preventDefault(); setAttempted(true); if (valid) choose(weekInput); }}>
        <label>Another week (Sunday)<input type="text" aria-label="Review week starts Sunday" aria-invalid={attempted && !valid} value={weekInput} placeholder="YYYY-MM-DD" maxLength={10} onChange={event => { setWeekInput(event.target.value); setAttempted(true); }} /></label>
        <button type="submit" disabled={!valid}>Show week</button>
        {attempted && !valid && <p className="tl-history-error" role="alert">Use a valid Sunday date in YYYY-MM-DD format.</p>}
      </form>}
      <div className="tl-history-buttons">{(overall || weekStart !== currentSundayWeek()) && <button type="button" onClick={() => choose(currentSundayWeek())}>Current week</button>}{onRefresh && <button type="button" onClick={onRefresh}>Refresh results</button>}<button type="button" onClick={() => { setChoosingWeek(false); changeButton.current?.focus(); }}>Close</button></div>
    </div>}
    {loading && <p className="tl-history-message" role="status">Loading results…</p>}
    {error && <p className="tl-history-error tl-history-message" role="alert">{error}</p>}
    {children && <div className="tl-history-message">{children}</div>}
  </section>;
}

const queryOptions = { retry: false as const, throwOnError: false as const, refetchOnWindowFocus: false, staleTime: 0 };
const EMPTY_REVIEW_ID = "00000000-0000-4000-8000-000000000000";
export function TeamLeaderboardAdminReviewControls({ agentId, weekStart, accessReady, onPublished, hidden = false }: {
  agentId: number;
  weekStart: string;
  accessReady: boolean;
  onPublished: () => Promise<void>;
  hidden?: boolean;
}) {
  const [reviewId, setReviewId] = useState("");
  const [request, setRequest] = useState<{ weekStart: string; requestId: string } | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  // State disables the UI; this ref also locks same-task events before rerender.
  const actionPending = useRef(false);
  const meQuery = trpc.agents.me.useQuery(undefined, { retry: false, throwOnError: false, staleTime: 0 });
  const validWeek = isSundayWeek(weekStart);
  const currentStaff = accessReady && !meQuery.isError && !meQuery.isLoading && meQuery.data?.isAdmin === true && meQuery.data.id === agentId;
  // While a run is reading/reviewing, refresh it every few seconds so progress is visible without clicking.
  const activeRun = (status: string | undefined) => status === "reading" || status === "reviewing";
  const runsQuery = trpc.leadflowJobs.leaderboard.history.reviewRuns.useQuery({ weekStart }, { ...queryOptions, enabled: currentStaff && validWeek,
    refetchInterval: query => query.state.data?.runs.some(run => activeRun(run.status)) ? 5000 : false });
  const draftQuery = trpc.leadflowJobs.leaderboard.history.reviewDraft.useQuery({ reviewId: reviewId || EMPTY_REVIEW_ID }, { ...queryOptions, enabled: currentStaff && Boolean(reviewId),
    refetchInterval: query => activeRun(query.state.data?.status) ? 4000 : false });
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
    setBusy(true); setReviewOpen(true); setStartError(null); setPublishError(null);
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
  // Summary changes presentation only; the action owner and its pending lock remain mounted.
  if (hidden) return null;
  if (!currentStaff) return <p className="tl-history-message" role="status">Current staff access is required to run reviews.</p>;
  const panelOpen = reviewOpen || Boolean(reviewId) || Boolean(startError);
  return <>
    <button type="button" className="tl-history-primary tl-run-review" disabled={busy || !validWeek} onClick={() => void start(false)}>{busy ? "Submitting…" : "Run review"}</button>
    {!panelOpen && (runs?.length || runsQuery.isError) ? <button type="button" className="tl-saved-review-link" onClick={() => { setReviewOpen(true); if (runs?.[0]) setReviewId(runs[0].id); }}>Saved reviews{runs?.length ? ` (${runs.length})` : ""}</button> : null}
    {panelOpen && <section className="tl-history-admin" aria-label="Manual weekly review">
      <div className="tl-history-heading"><div><h3>Review results</h3><p>Review the draft, then Publish. The leaderboard stays unchanged until you publish.</p></div><button type="button" disabled={busy || Boolean(request)} onClick={() => { setReviewOpen(false); setReviewId(""); setStartError(null); setPublishError(null); }}>Close review</button></div>
      <div className="tl-history-buttons"><button type="button" disabled={busy || !validWeek} onClick={() => { void runsQuery.refetch(); if (reviewId) void draftQuery.refetch(); }}>Refresh progress</button></div>
      {startError && <p className="tl-history-error" role="alert">{startError}</p>}
      {startError && request && <button type="button" disabled={busy} onClick={() => void start(true)}>Retry same run request (same ID; no duplicate provider run)</button>}
      {runsQuery.isError ? <p className="tl-history-error" role="alert">Saved reviews could not be loaded. Refresh to retry this read; no review was started.</p> : validWeek && !runs ? <p role="status">Loading saved reviews…</p> : null}
      {runs && runs.length > 0 && <label>Saved review<select aria-label="Saved review" value={reviewId} disabled={busy} onChange={event => { setReviewId(event.target.value); setPublishError(null); }}><option value="">Choose a saved review</option>{runs.map(run => <option key={run.id} value={run.id}>{run.status} · {new Date(run.createdAtMs).toLocaleString("en-US")}{run.publishedAtMs !== null ? " · published" : ""}{["reading", "reviewing"].includes(run.status) && !run.runningHere ? " · not running here" : ""}</option>)}</select></label>}
      {reviewId && (draftQuery.isError ? <p className="tl-history-error" role="alert">The saved draft could not be loaded. Refresh to retry the read. Publishing is unavailable.</p> : !draft ? <p role="status">Loading the selected review draft…</p> : <TeamLeaderboardReviewDraft key={`${agentId}:${draft.id}:${draft.updatedAtMs}:${draft.expectedPublicationId ?? "none"}`} draft={draft} agentId={agentId} busy={busy} error={publishError} onPublish={async input => {
        if (actionPending.current || busy || !currentStaff || !draft || draft.agentId !== agentId || draft.id !== reviewId || draft.weekStart !== weekStart) return;
        actionPending.current = true;
        setBusy(true); setPublishError(null);
        try {
          await confirmStaff();
          const fresh = await draftQuery.refetch();
          if (fresh.isError || !fresh.data || fresh.data.agentId !== agentId || fresh.data.id !== input.reviewId || fresh.data.weekStart !== weekStart || fresh.data.updatedAtMs !== draft.updatedAtMs || fresh.data.expectedPublicationId !== input.expectedPublicationId) throw new Error("The publication or draft changed. Review the refreshed draft and acknowledge limitations again before publishing.");
          if (!fresh.data.counts?.complete || !fresh.data.progress?.completeReview || !fresh.data.outcome || !["completed", "incomplete"].includes(fresh.data.status)) throw new Error("The refreshed draft is not ready to publish. Previous results are unchanged.");
          const result = await publishMutation.mutateAsync(input);
          if (result.agentId !== agentId || result.id !== input.reviewId || result.weekStart !== weekStart) throw new Error("Publication identity could not be confirmed. Refresh published history.");
          await Promise.all([draftQuery.refetch(), runsQuery.refetch(), onPublished()]);
        } catch (error) { setPublishError(error instanceof Error ? error.message : "Publish could not be confirmed. Refresh the draft before another explicit Publish; no automatic retry was made."); }
        finally { actionPending.current = false; setBusy(false); }
      }} />)}
    </section>}
  </>;
}
