import React, { useState } from "react";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../server/routers";
import { trpc } from "@/lib/trpc";
import { countsAgainstTeam, QUALITY_CATEGORIES, QUALITY_SEVERITIES, RECLEAN_STATUSES, REFUND_STATUSES, type QualityIncidentAction } from "@shared/teamQualityIncidents";
import "./team-leaderboard-history.css";

type Listed = inferRouterOutputs<AppRouter>["leadflowJobs"]["leaderboard"]["history"]["qualityRecords"];
type Incident = Listed["incidents"][number];
type Message = Incident["messages"][number];
const queryOptions = { retry: false as const, throwOnError: false as const, refetchOnWindowFocus: false, staleTime: 0 };
export const CATEGORY_LABELS: Record<string, string> = {
  cleaning_quality: "Cleaning quality", team_service: "Team service", office_service: "Office / communication",
  pricing_billing: "Pricing / billing", scheduling: "Scheduling", other: "Other", unclassified: "Supporting signal",
};
const CHANNEL_LABELS: Record<string, string> = { sms: "Text", email: "Email", call: "Call", rating: "Low rating", signoff: "Cleaner sign-off", review: "Weekly review", staff: "Staff" };
export type QualityFilter = "counted" | "not_team" | "signals" | "dismissed";
/** Which list an incident belongs in, from the automatic decisions (pure, exported for tests). */
export function qualityFilterFor(incident: Incident): QualityFilter {
  if (incident.status === "dismissed") return "dismissed";
  if (countsAgainstTeam(incident)) return "counted";
  if (incident.category === "unclassified" || incident.attribution === "unattributed") return "signals";
  return "not_team";
}

function MessageLine({ message, onSeparate, busy }: { message: Message | Incident; onSeparate?: () => void; busy: boolean }) {
  return <div className="tl-quality-message">
    <small>{CHANNEL_LABELS[message.channel] ?? message.channel} · {new Date(message.reportedAtMs).toLocaleString("en-US", { timeZone: "America/New_York" })}{message.customerName ? ` · ${message.customerName}` : ""}{message.customerPhone ? ` · ${message.customerPhone}` : ""}{message.customerEmail ? ` · ${message.customerEmail}` : ""}</small>
    {message.evidenceQuote && <blockquote>“{message.evidenceQuote}”</blockquote>}
    {message.evidenceText && message.evidenceText !== message.evidenceQuote && <details><summary>Original customer evidence</summary><p style={{ whiteSpace: "pre-wrap" }}>{message.evidenceText}</p></details>}
    {onSeparate && <button type="button" disabled={busy} onClick={onSeparate}>This is a separate complaint</button>}
  </div>;
}

export function TeamQualityRecords({ agentId, weekStart, fromRecords, onToggleRecords, expectedPublicationId, onChanged }: {
  agentId: number; weekStart: string; fromRecords: boolean; onToggleRecords: (value: boolean) => void;
  expectedPublicationId: string | null | undefined; onChanged: () => Promise<void> | void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const publish = trpc.leadflowJobs.leaderboard.history.publishFromRecords.useMutation({ retry: false });
  const run = async (work: () => Promise<unknown>, done: string) => {
    if (busy) return;
    setBusy(true); setMessage(null);
    try { await work(); setMessage(done); await onChanged(); }
    catch (error) { setMessage(error instanceof Error ? error.message : "That change could not be saved. Nothing was changed."); }
    finally { setBusy(false); }
  };
  return <section className="tl-history-admin" aria-label="Quality records">
    <div className="tl-history-heading"><div><h3>Quality records</h3><p>Complaints from texts, emails, calls, ratings and sign-offs are detected, categorised, matched to the visit and team, de-duplicated and scored automatically. No staff action is needed; overrides are optional.</p></div>
      <button type="button" onClick={() => setOpen(!open)}>{open ? "Hide records" : "Show records"}</button></div>
    <div className="tl-history-buttons">
      <button type="button" onClick={() => onToggleRecords(!fromRecords)}>{fromRecords ? "Show published results" : "Show this week's automatic scores"}</button>
      {fromRecords && <button type="button" className="tl-history-primary" disabled={busy} onClick={() => {
        if (!window.confirm("Publish this week's scores from the saved quality records? Teams will see the new results. No texts are sent.")) return;
        void run(() => publish.mutateAsync({ requestId: crypto.randomUUID(), weekStart, expectedPublicationId: expectedPublicationId ?? null }), "Published from quality records.");
      }}>Publish these scores</button>}
    </div>
    {message && <p role="status">{message}</p>}
    {open && <QualityRecordsList agentId={agentId} weekStart={weekStart} onChanged={onChanged} />}
  </section>;
}

/** Mounted only when staff open the records, so nothing is read before then. */
export function QualityRecordsList({ agentId, weekStart, onChanged }: { agentId: number; weekStart: string; onChanged: () => Promise<void> | void }) {
  const [filter, setFilter] = useState<QualityFilter>("counted");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [choicesFor, setChoicesFor] = useState<number | null>(null);
  const [importId, setImportId] = useState("");
  const list = trpc.leadflowJobs.leaderboard.history.qualityRecords.useQuery({ weekStart }, queryOptions);
  const runs = trpc.leadflowJobs.leaderboard.history.reviewRuns.useQuery({ weekStart }, queryOptions);
  const choices = trpc.leadflowJobs.leaderboard.history.qualityChoices.useQuery({ id: choicesFor ?? 1 }, { ...queryOptions, enabled: choicesFor !== null });
  const act = trpc.leadflowJobs.leaderboard.history.qualityAction.useMutation({ retry: false });
  const retry = trpc.leadflowJobs.leaderboard.history.qualityRetry.useMutation({ retry: false });
  const importReview = trpc.leadflowJobs.leaderboard.history.importReviewToRecords.useMutation({ retry: false });
  const data = list.data?.agentId === agentId ? list.data : null;
  const run = async (work: () => Promise<unknown>, done: string) => {
    if (busy) return;
    setBusy(true); setMessage(null);
    try { await work(); setMessage(done); await list.refetch(); await onChanged(); }
    catch (error) { setMessage(error instanceof Error ? error.message : "That change could not be saved. Nothing was changed."); }
    finally { setBusy(false); }
  };
  const action = (input: QualityIncidentAction, done: string) => run(() => act.mutateAsync(input), done);
  const team = (id: number | null) => id === null ? "No team" : data?.teamNames[String(id)] ?? `Team ${id}`;
  const incidents = data?.incidents ?? [];
  const shown = incidents.filter(incident => qualityFilterFor(incident) === filter);
  const count = (value: QualityFilter) => incidents.filter(incident => qualityFilterFor(incident) === value).length;
  const completedRuns = (runs.data?.runs ?? []).filter(item => item.status === "completed" || item.status === "incomplete");
  return <>
      {message && <p role="status">{message}</p>}
      {list.isError ? <p className="tl-history-error" role="alert">{list.error.message}</p> : !data ? <p role="status">Loading quality records…</p> : <>
        <div className="tl-history-buttons" role="tablist" aria-label="Quality record lists">
          {([["counted", "Counted against a team"], ["not_team", "Not the team's responsibility"], ["signals", "Supporting signals / no matching visit"], ["dismissed", "Dismissed by override"]] as const).map(([value, label]) =>
            <button type="button" key={value} aria-pressed={filter === value} onClick={() => setFilter(value)}>{label} ({count(value)})</button>)}
        </div>
        {shown.length === 0 && <p>No records in this list for this week.</p>}
        {shown.map(incident => <article key={incident.id} className="tl-history-group">
          <strong>{CATEGORY_LABELS[incident.category] ?? incident.category} · {incident.severity} · {team(incident.teamId)}{incident.leadflowJobId ? ` · job ${incident.leadflowJobId}` : ""}</strong>
          <p><small>{incident.attribution === "unattributed" ? "Not matched to a visit (retried automatically): " : incident.attribution === "staff" ? "Staff override: " : "Matched automatically: "}{incident.attributionNote}</small></p>
          {(incident.recleanStatus !== "none" || incident.refundStatus !== "none") && <p><small>Reclean: {incident.recleanStatus} · Refund: {incident.refundStatus}</small></p>}
          {incident.statusNote && <p><small>{incident.status}: {incident.statusNote}</small></p>}
          <MessageLine message={incident} busy={busy} />
          {incident.messages.map(item => <MessageLine key={item.id} message={item} busy={busy} onSeparate={() => void action({ action: "separate", id: item.id }, "Separated into its own incident.")} />)}
          <details className="tl-quality-override"><summary>Staff override (optional)</summary>
          <div className="tl-history-buttons">
            <button type="button" disabled={busy} onClick={() => setChoicesFor(choicesFor === incident.id ? null : incident.id)}>{choicesFor === incident.id ? "Close visit choice" : "Choose the visit/team"}</button>
            {incident.teamId !== null && <button type="button" disabled={busy} onClick={() => void action({ action: "unattribute", id: incident.id }, "Team removed; it no longer counts.")}>Remove team</button>}
            {incident.status === "dismissed"
              ? <button type="button" disabled={busy} onClick={() => void action({ action: "restore", id: incident.id }, "Restored.")}>Restore</button>
              : <button type="button" disabled={busy} onClick={() => { const note = window.prompt("Why is this not a valid complaint?"); if (note?.trim()) void action({ action: "dismiss", id: incident.id, note: note.trim() }, "Dismissed; it no longer counts."); }}>Dismiss</button>}
            {incident.status === "open" && <button type="button" disabled={busy} onClick={() => void action({ action: "resolve", id: incident.id }, "Marked resolved (it still counts for its week).")}>Mark resolved</button>}
          </div>
          {choicesFor === incident.id && (choices.isError ? <p className="tl-history-error">{choices.error.message}</p> : !choices.data ? <p role="status">Loading this customer's visits…</p>
            : choices.data.choices.length === 0 ? <p>No visits found for this customer within 30 days.</p>
            : <ul>{choices.data.choices.map(choice => <li key={choice.leadflowJobId}><button type="button" disabled={busy || choice.teamId === null} onClick={() => void action({ action: "attribute", id: incident.id, leadflowJobId: choice.leadflowJobId }, "Attribution saved.")}>
              {choice.jobDate} · job {choice.leadflowJobId} · {choice.teamName ?? "no single team"} · {choice.bookingStatus}</button></li>)}</ul>)}
          <div className="tl-history-buttons">
            <label>Category<select value={incident.category} disabled={busy} onChange={event => void action({ action: "classify", id: incident.id, category: event.target.value as typeof QUALITY_CATEGORIES[number], severity: incident.severity as typeof QUALITY_SEVERITIES[number] }, "Category saved.")}>
              {QUALITY_CATEGORIES.map(value => <option key={value} value={value}>{CATEGORY_LABELS[value]}</option>)}</select></label>
            <label>Severity<select value={incident.severity} disabled={busy} onChange={event => void action({ action: "classify", id: incident.id, category: incident.category as typeof QUALITY_CATEGORIES[number], severity: event.target.value as typeof QUALITY_SEVERITIES[number] }, "Severity saved.")}>
              {QUALITY_SEVERITIES.map(value => <option key={value} value={value}>{value}</option>)}</select></label>
            <label>Reclean<select value={incident.recleanStatus} disabled={busy} onChange={event => void action({ action: "recovery", id: incident.id, recleanStatus: event.target.value as typeof RECLEAN_STATUSES[number], refundStatus: incident.refundStatus as typeof REFUND_STATUSES[number] }, "Reclean status saved.")}>
              {RECLEAN_STATUSES.map(value => <option key={value} value={value}>{value}</option>)}</select></label>
            <label>Refund<select value={incident.refundStatus} disabled={busy} onChange={event => void action({ action: "recovery", id: incident.id, recleanStatus: incident.recleanStatus as typeof RECLEAN_STATUSES[number], refundStatus: event.target.value as typeof REFUND_STATUSES[number] }, "Refund status saved.")}>
              {REFUND_STATUSES.map(value => <option key={value} value={value}>{value}</option>)}</select></label>
            {incidents.length > 1 && <label>Same problem as<select value="" disabled={busy} onChange={event => { if (event.target.value) void action({ action: "merge", id: incident.id, intoId: Number(event.target.value) }, "Merged; it now counts once."); }}>
              <option value="">Merge into…</option>{incidents.filter(other => other.id !== incident.id).map(other => <option key={other.id} value={other.id}>#{other.id} {CATEGORY_LABELS[other.category]} · {team(other.teamId)}</option>)}</select></label>}
          </div>
          </details>
        </article>)}
        {data.unprocessed.length > 0 && <div className="tl-history-error" role="alert"><strong>Records waiting to be processed ({data.unprocessed.length})</strong>
          <p>The customer message was saved, but matching it to a visit failed. It is retried automatically each time the scores are recalculated; Retry now does it immediately. No reply is re-sent.</p>
          {data.unprocessed.map(item => <div key={item.id}><MessageLine message={item} busy={busy} /><small>Code: {item.processingError ?? item.processingStatus} · attempts {item.processingAttempts}</small>
            <button type="button" disabled={busy} onClick={() => void run(() => retry.mutateAsync({ id: item.id }), "Processed.")}>Retry now</button></div>)}
        </div>}
      </>}
      <div className="tl-history-buttons">
        <label>One-time fill from a saved Run review<select value={importId} disabled={busy} onChange={event => setImportId(event.target.value)}>
          <option value="">Choose a finished review</option>{completedRuns.map(item => <option key={item.id} value={item.id}>{item.status} · {new Date(item.createdAtMs).toLocaleString("en-US")}</option>)}</select></label>
        <button type="button" disabled={busy || !importId} onClick={() => void run(async () => {
          const result = await importReview.mutateAsync({ reviewId: importId });
          return result;
        }, "Import finished. Findings already recorded were not added twice.")}>Import findings</button>
      </div>
    </>;
}
