import React, { useEffect, useRef, type CSSProperties } from "react";
import type { CoverageReceipt, Expectation, InstinctIssue, NativeRecord } from "@shared/instinct";
import { INSTINCT_CHARACTER } from "./character";
import { sourceLabel, needsAttention, visibleGroups, type InstinctWorkspaceBinding } from "./useInstinct";
import "./instinct.css";

const star = <span style={{ color: "#c5b2dc" }}>✦</span>;
const outcomes = { checking: "Checking…", no_action: "No action", matches_current: "Matches current records", discrepancy: "Confirmed discrepancy", review: "Needs clarification", analysis_unavailable: "Analysis unavailable", record_unavailable: "Record unavailable" };
export function coverageLabel(coverage: CoverageReceipt | null): string {
  if (!coverage) return "Coverage not yet established";
  return `${coverage.read} read · ${coverage.analyzed} analyzed · ${coverage.unprocessed} unprocessed · ${coverage.unavailable} unavailable${coverage.partial ? " · partial" : ""}${coverage.continuation ? " · continuing" : ""}`;
}
function time(value: string | null) {
  if (!value) return "Time unavailable";
  return new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value));
}
function person(issue: InstinctIssue) {
  return issue.identity.displayName || issue.identity.phone || issue.identity.email || "Identity needs review";
}
function expectation(value: Expectation | null): string {
  if (!value) return "Request not established from available evidence.";
  return [value.date, value.timeKind === "window" ? `${value.time}–${value.windowEnd} arrival window` : value.time,
    value.timeZone, value.address, value.serviceName, value.extras?.join(", "), value.notes,
    value.scope !== "unspecified" ? `${value.scope} scope` : null].filter(Boolean).join(" · ") || "Requested parameters need clarification.";
}
function current(record: NativeRecord, issue: InstinctIssue): string {
  switch (issue.action) {
    case "notes": case "access_notes": return record.cleanerFacingNotes ?? "Cleaner-facing instructions unavailable";
    case "address": return record.address ?? "Address unavailable";
    case "service": return record.serviceName ?? "Service unavailable";
    case "extras": return record.extras?.map(extra => extra.label).join(", ") ?? "Extras unavailable";
    case "assignment": return record.teamName ?? "Team unavailable";
    default: return [record.localDate, record.arrivalWindow ? `${record.arrivalWindow.start}–${record.arrivalWindow.end} arrival window` : record.localTime,
      record.timeZone, record.status].filter(Boolean).join(" · ") || "Current fields unavailable";
  }
}
function IssueInvestigation({ binding }: { binding: InstinctWorkspaceBinding }) {
  const { state, controller } = binding;
  const issue = state.selected;
  if (!issue) return null;
  const investigation = state.investigation;
  const exactKey = issue.target.jobId ? `leadflow:job:${issue.target.jobId}` : issue.target.bookingId ? `booking:${issue.target.bookingId}` : null;
  const records = investigation?.snapshot?.records.filter(record => record.key === exactKey || record.key === `series:${issue.target.bookingSeriesId}`) ?? [];
  return <div className="msg"><div className="mini" aria-hidden="true" /><div className="bubble">
    <div style={{ fontSize: 17, fontWeight: 750, lineHeight: 1.3 }}>{outcomes[issue.outcome]} · {person(issue)}</div>
    <div className="prose" style={{ marginTop: 9 }}>{state.investigating ? "Reading the exact selected evidence…" : investigation ? issue.explanation : "The selected issue needs a fresh evidence read before proof can be shown."}</div>
    <div className="compare"><div><div className="label">Customer asked</div>{expectation(issue.expectation)}</div>
      <div><div className="label bad">System actually shows</div>{records.length ? records.map(record => <div key={record.key}>{current(record, issue)}<small className="source-meta">{record.key} · {record.publicBookingNumber ?? "Public number unavailable"} · {time(record.observedAtUtc)}</small></div>) : "Current exact record proof unavailable."}</div></div>
    <div className="prose"><strong style={{ color: "#eee7f6" }}>My recommendation:</strong> {issue.outcome === "discrepancy" ? "Review the exact request and current occurrence before any separately authorized correction." : "Resolve the stated evidence or identity limitations before treating this request as fulfilled."}</div>
    {issue.priorityReason && <div className="proof">{issue.priorityReason}</div>}
    <div className="actionrow"><button type="button" className="btn primary" disabled title="Corrections require separate authorization after read-only Preview sign-off.">Corrections unavailable</button>
      <button type="button" className="btn" onClick={controller.showEvidence} disabled={state.investigating}>View evidence</button>
      <button type="button" className="btn" disabled title="Durable review storage is not authorized in Stage 1.">Mark reviewed</button>
      <button type="button" className="btn" onClick={() => void controller.reverify()} disabled={state.paused || !state.foreground}>Recheck records</button>
      {!investigation && <button type="button" className="btn" onClick={() => void controller.investigate()} disabled={state.investigating || state.paused || !state.foreground}>Retry evidence</button>}</div>
    <div className="smallprint">Review and corrections unavailable · Findings are process-local and transient</div>
    {state.evidenceVisible && investigation && <div>
      <div className="label" style={{ marginTop: 14 }}>Source evidence</div>
      {investigation.citations.map((citation, index) => <div className="proof" key={`${citation.ref.store}:${citation.ref.sourceId}:${index}`}><small className="source-meta">{sourceLabel(citation.ref.sourceKind)} · {citation.ref.store}:{citation.ref.sourceId} · {citation.ref.providerId ?? "Provider ID unavailable"} · {time(citation.ref.occurredAtUtc)} · {citation.ref.timeBasis} · revision {citation.ref.sourceRevision}</small>{citation.exactQuote}</div>)}
      {investigation.evidence.map(evidence => <details key={`${evidence.ref.store}:${evidence.ref.sourceId}`}><summary className="source-meta">Full stored context · {sourceLabel(evidence.ref.sourceKind)} · {evidence.availability} · {evidence.contentBasis}</summary><div className="proof">{evidence.originalText ?? "Original body/transcript unavailable"}</div><div className="prose">{evidence.limitations.join(" · ")}</div></details>)}
      <div className="prose" style={{ marginTop: 12 }}><strong>Independent booking check:</strong> {investigation.snapshot ? `${time(investigation.snapshot.checkedAtUtc)} · ${investigation.snapshot.availability} · ${investigation.snapshot.fingerprint}` : "Unavailable"}</div>
      <div className="source-meta">Fulfillment: {issue.fulfillment} · Customer notification: {issue.notification} · Delivery: {issue.delivery}</div>
      <div className="coverage-detail">{coverageLabel(investigation.coverage)}{investigation.limitations.length ? ` · ${investigation.limitations.join(" · ")}` : ""}</div>
    </div>}
  </div></div>;
}
export function InstinctPanels({ binding }: { binding: InstinctWorkspaceBinding }) {
  const { state, controller } = binding;
  const chat = useRef<HTMLDivElement>(null);
  useEffect(() => { if (chat.current) chat.current.scrollTop = chat.current.scrollHeight; }, [state.messages, state.selected, state.investigation, state.evidenceVisible]);
  const allIssues = (state.feed?.groups ?? []).flatMap(group => group.issues).filter(needsAttention);
  const count = allIssues.filter(issue => issue.action !== null).length;
  const urgent = allIssues.filter(issue => issue.priorityReason !== null && issue.action !== null).length;
  const groups = visibleGroups(state);
  const pending = state.work.filter(work => work.state === "queued" || work.state === "pending").length;
  const failures = state.work.filter(work => work.state === "error").length;
  const processed = state.work.filter(work => work.state === "done").length;
  const disabled = state.paused || !state.foreground;
  const status = state.paused ? "Page paused" : !state.foreground ? "Page hidden" : state.error ? "Updates unavailable" : state.loading ? "Loading stored sources…" : pending ? `${pending} conversations pending` : state.scanning ? "Loading last two days…" : failures ? `${failures} analysis unavailable` : state.coverage?.partial ? "Partial stored coverage" : "Stored read-only results";
  const sourceFilters = [{ kind: "all" as const, label: "All sources" }, { kind: "sms" as const, label: "SMS" }, { kind: "email" as const, label: "EMAIL" }, { kind: "human_call" as const, label: "HUMAN CALL / unverified" }, { kind: "ai_call" as const, label: "AI CALL" }];
  return <div className="instinct-customer-intelligence" style={{ "--instinct-character": `url('${INSTINCT_CHARACTER}')` } as CSSProperties}>
    <div className="app"><header><div className="brand"><span className="spark">✦</span>Instinct <small>Customer Intelligence</small></div>
      <div className="header-status"><div className="demo" role="status">{status}</div><button type="button" className="reset" aria-pressed={state.paused} onClick={controller.togglePause}>{state.paused ? "Resume" : "Pause"}</button></div></header>
      <main className="shell"><section className="left"><div className="eyebrow">Your attention</div>
        <h1 className="heading"><em>{state.feed ? count : "—"}</em> things need your attention<span style={{ color: "#c5b2dc" }}>.</span></h1>
        <div className="subtitle">Last two days only. Customer requests compared with exact booking records. Findings are grouped by verified customer.</div>
        <div className="tabs"><button type="button" className={`tab ${state.filter === "all" ? "active" : ""}`} aria-pressed={state.filter === "all"} onClick={() => controller.setFilter("all")}>All <span>{state.feed ? count : "—"}</span></button>
          <button type="button" className={`tab ${state.filter === "urgent" ? "active" : ""}`} aria-pressed={state.filter === "urgent"} onClick={() => controller.setFilter("urgent")}>Urgent <span>{state.feed ? urgent : "—"}</span></button>
          <button type="button" className={`tab ${state.filter === "reviewed" ? "active" : ""}`} aria-pressed={state.filter === "reviewed"} onClick={() => controller.setFilter("reviewed")} title="Durable review is unavailable in Stage 1.">Reviewed</button></div>
        <div className="source-filters" aria-label="Stored conversation sources">{sourceFilters.map(source => <button type="button" className={`tab ${state.sourceFilter === source.kind ? "active" : ""}`} aria-pressed={state.sourceFilter === source.kind} key={source.kind} onClick={() => controller.setSourceFilter(source.kind)}>{source.label}</button>)}</div>
        <div className="list">{groups.map(group => {
          const issue = group.issues.find(value => value.issueId === state.selected?.issueId) ?? group.issues[0];
          const name = person(issue);
          const active = group.issues.some(value => value.issueId === state.selected?.issueId && value.revision === state.selected?.revision);
          const initials = issue.identity.displayName ? name.split(/\s+/).map(value => value[0]).join("") : "?";
          return <div key={group.groupId} className="attention-card"><button type="button" className={`issue ${active ? "active" : ""}`} disabled={disabled} onClick={() => controller.select(issue)} aria-pressed={active}>
            <div className="topline"><span className="person"><span className="initial">{initials}</span>{name}</span><span className="time">{time(issue.checkedAtUtc)}</span></div>
            <div className="issue-title">{outcomes[issue.outcome]}{issue.action ? ` · ${issue.action.replace(/_/g, " ")}` : ""}</div>
            <div className="issue-desc">{issue.expectation ? `Requested: ${expectation(issue.expectation)}` : "Open this finding to inspect its evidence and limitations."}{group.issues.length > 1 ? ` · ${group.issues.length} independent findings` : ""}<span className="source-meta">{Array.from(new Set([...issue.citations.map(value => value.ref.sourceKind), ...issue.identity.evidenceRefs.map(ref => ref.sourceKind)])).map(sourceLabel).join(" + ") || "Source provenance unavailable"}</span></div>
            <div className="bottom"><span className={`chip ${issue.priorityReason ? "" : "normal"}`}>{issue.priorityReason ? "Urgent" : outcomes[issue.outcome]}</span><span style={{ color: "#a995c7", fontSize: 12 }}>Investigate →</span></div></button>
            {active && group.issues.length > 1 && <div className="requests" aria-label="Independent requests">{group.issues.map(value => <button type="button" className="btn" key={value.issueId} disabled={disabled} onClick={() => controller.select(value)} aria-pressed={value.issueId === state.selected?.issueId}>{value.action?.replace(/_/g, " ") ?? outcomes[value.outcome]}</button>)}</div>}
          </div>;
        })}
          {!groups.length && <div className="empty" role="status">{state.filter === "reviewed" ? "Durable reviewed acknowledgments are unavailable in Stage 1." : state.loading ? "Loading available stored conversations…" : state.error ? "Stored source updates unavailable." : "No loaded attention findings in this filter. Unchecked or unavailable sources are not all caught up."}</div>}
        </div>
        <div className="foot">✦ Select any issue to investigate it with Instinct.<span className="coverage-detail">{processed} conversations checked · {pending} conversations pending · {failures} retryable checks · {state.feed?.totals.customerGroups ?? "—"} loaded customer groups</span><span className="coverage-detail">Recent stored entries: {coverageLabel(state.coverage)}</span>
          {state.coverage?.exclusions.length ? <span className="coverage-detail">{state.coverage.exclusions.join(" · ")}</span> : null}
          {state.error && <span className="coverage-detail" role="alert">{state.error}</span>}
          {(state.error || failures > 0) && <button type="button" className="btn" disabled={disabled} onClick={() => { controller.retryChecks(); controller.retryDay(); }}>Retry unavailable work</button>}</div>
      </section><section className="right"><div className="assistant-top"><div className="avatar" role="img" aria-label="Instinct character" /><div><div className="ai-name">Instinct {star}</div><div className="ai-status">{status}</div></div><button type="button" className="reset rightword" onClick={controller.resetConversation}>↻ New conversation</button></div>
        <div className="chat" ref={chat} aria-live="polite" tabIndex={0} aria-label="Instinct investigation and conversation">
          {!state.selected && !state.messages.length && <div className="msg"><div className="mini" aria-hidden="true" /><div className="bubble"><div className="eyebrow">Your AI operations teammate</div><div className="welcome" style={{ marginTop: 12 }}>Hey, I'm Instinct. {star}</div>
            <div className="prose">I compare available stored customer conversations with current records, without changing bookings or sending messages.</div><div className="summary"><strong>{state.feed ? `${count} loaded customer requests need attention.` : "Stored findings are loading."}</strong><div className="prose" style={{ marginTop: 7 }}>{state.feed ? `${urgent} have a verified urgency reason. ${coverageLabel(state.coverage)}.` : "Source coverage and analysis availability will be shown explicitly."}</div></div><div className="prose" style={{ marginTop: 15 }}>Choose a customer to investigate, or ask me what we missed today.</div></div></div>}
          <IssueInvestigation binding={binding} />
          {state.messages.map(message => <React.Fragment key={message.id}><div className="msg user"><div className="bubble">{message.question}</div></div><div className="msg"><div className="mini" aria-hidden="true" /><div className="bubble">
            {message.answer ? <><div className="prose">{message.answer.answer || "Answer unavailable"}</div>{message.answer.citations.map((citation, index) => <div className="proof" key={index}><small className="source-meta">{sourceLabel(citation.ref.sourceKind)} · {citation.ref.store}:{citation.ref.sourceId} · revision {citation.ref.sourceRevision}</small>{citation.exactQuote}</div>)}{message.answer.recordCitations.map((citation, index) => <div className="source-meta" key={index}>Current record: {citation.recordKey} · {citation.field} · {time(citation.checkedAtUtc)} · fingerprint {citation.recordFingerprint}</div>)}<div className="coverage-detail">{coverageLabel(message.answer.coverage)} · {message.answer.limitations.join(" · ")}</div></> : message.error ? <div role="alert">Analysis unavailable. Your question is retained; retry when ready.</div> : "Checking grounded evidence…"}
            {message.error && <button type="button" className="btn" disabled={disabled || state.asking} onClick={() => void controller.ask(message.question)}>Retry question</button>}
          </div></div></React.Fragment>)}
        </div><div className="composer"><div className="suggestions"><button type="button" disabled={disabled || state.asking} onClick={() => void controller.ask("What did we miss today?")}>What did we miss?</button><button type="button" disabled={disabled || state.asking} onClick={() => void controller.ask("Show missed cancellations")}>Missed cancellations</button><button type="button" disabled={disabled || state.asking} onClick={() => void controller.ask("Show failed reschedules")}>Failed reschedules</button></div>
          <form className="inputbox" onSubmit={event => { event.preventDefault(); void controller.ask(); }}><input aria-label="Ask Instinct" placeholder="Ask Instinct anything about your customers…" autoComplete="off" value={state.question} onChange={event => controller.setQuestion(event.target.value)} disabled={disabled} /><button className="send" type="submit" aria-label="Send" disabled={disabled || state.asking || !state.question.trim()}>↑</button></form>
          <div className="smallprint">Read-only stored evidence · Transient findings · No booking changes or sending</div></div>
      </section></main></div>
  </div>;
}
