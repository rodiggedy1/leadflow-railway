import React, { useEffect, useRef, useState } from "react";
import { AlertCircle, ArrowRight, CalendarDays, CheckCircle2, ClipboardCheck, Clock3, FileSearch, LockKeyhole, MessageSquareText, ShieldCheck } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { safeAuditFailureMessage } from "@shared/dailyActionAudit";
import type { AuditAgreement, AuditItem, AuditMessage, AuditRecord, AuditStatus, DailyActionAuditResult } from "@shared/dailyActionAudit";
import { BOOKING_WIDGET_PRICED_EXTRAS } from "@shared/bookingWidgetConfig";
import AuditCalendar from "@/components/daily-action-audit/AuditCalendar";
import "./daily-action-audit.css";

export const AUDIT_TIME_ZONE = "America/New_York";
const MIN_DATE = "1970-01-01";
export type AuditFilter = "all" | "affectsTomorrow";
const STATUS_LABELS: Record<AuditStatus, string> = {
  needs_action: "Needs action", conflict: "Conflict", cannot_verify: "Cannot verify", matches: "Matches current state", superseded: "Superseded",
};
const STATUS_ORDER: AuditStatus[] = ["needs_action", "conflict", "cannot_verify", "matches", "superseded"];
const AGREEMENT_LABELS: Record<AuditAgreement, string> = {
  requested: "Requested · not confirmed", confirmed: "Confirmed in SMS", declined: "Declined in SMS", unclear: "Agreement unclear",
};
const ACTION_LABELS: Record<AuditItem["action"], string> = {
  reschedule: "Reschedule", cancel: "Cancellation", book: "New booking", address: "Address change", service: "Service change", assignment: "Team assignment", payment: "Payment",
};

export function isValidAuditDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value < MIN_DATE) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function shiftDay(value: string, offset: number): string {
  if (!isValidAuditDate(value)) return "";
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

export function easternDay(now: Date): string {
  if (!Number.isFinite(now.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: AUDIT_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const get = (type: string) => parts.find(part => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function previousBusinessDay(now = new Date()): string {
  // Previous calendar day in the business timezone, including weekends.
  return shiftDay(easternDay(now), -1);
}

export function auditDateError(value: string, now = new Date()): string | null {
  if (!value) return "Choose a message date before running the audit.";
  if (!isValidAuditDate(value)) return "Choose a valid message date on or after January 1, 1970.";
  if (value >= easternDay(now)) return "Choose a previous day in Eastern Time. Today and future message dates cannot be audited.";
  return null;
}

function dateLabel(value: string | null): string {
  if (!value || !isValidAuditDate(value)) return "Date not available";
  return new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${value}T00:00:00.000Z`));
}

function timestampLabel(value: string | null): string {
  if (!value) return "Timestamp unavailable";
  // Never interpret a timezone-less timestamp in the browser's local timezone.
  if (!/T.*(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) return "Timestamp unavailable";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Timestamp unavailable";
  return new Intl.DateTimeFormat("en-US", { timeZone: AUDIT_TIME_ZONE, month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(date);
}

function money(cents: number | null): string {
  return cents !== null && Number.isFinite(cents)
    ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100)
    : "Not available";
}

// Accept fixed, local admin destinations only. Never build a URL from customer text or phone numbers.
export function isSafeAuditRecordLink(href: string): boolean {
  return href === "/admin/bookings" || href === "/admin/schedule";
}

function DetailRow({ label, value }: { label: string; value: string | null }) {
  return <div className="daa-detail-row"><dt>{label}</dt><dd>{value || "Not available"}</dd></div>;
}
function extrasLabel(values: string[]): string {
  return values.map(value => BOOKING_WIDGET_PRICED_EXTRAS.find(extra => extra.id === value)?.label ?? value).join(", ");
}

function ExpectedDetails({ item }: { item: AuditItem }) {
  const expected = item.expected;
  return <section className="daa-comparison-panel daa-expected"><h4><MessageSquareText size={14} aria-hidden="true" /> Expected from SMS</h4><dl>
    <DetailRow label="Service date" value={expected.date ? dateLabel(expected.date) : null} />
    {expected.originalDate && <DetailRow label="Original date" value={dateLabel(expected.originalDate)} />}
    <DetailRow label="Arrival" value={expected.time ? `${expected.time}${expected.windowEnd ? ` – ${expected.windowEnd}` : ""} · ${expected.timeKind === "window" ? "arrival window" : expected.timeKind === "exact" ? "exact time" : "time unspecified"}` : null} />
    <DetailRow label="Scope" value={expected.scope === "visit" ? "This visit" : expected.scope === "subsequent" ? "Subsequent visits" : "Not specified"} />
    {expected.bookingReference && <DetailRow label="Booking reference" value={expected.bookingReference} />}
    {expected.address && <DetailRow label="Address" value={expected.address} />}
    {expected.serviceName && <DetailRow label="Service" value={expected.serviceName} />}
    {expected.extras !== null && <><DetailRow label="Extras operation" value={expected.extrasMode ?? "Not specified"} /><DetailRow label="Extras" value={extrasLabel(expected.extras) || "None specified"} /></>}
    {expected.teamName && <DetailRow label="Team" value={expected.teamName} />}
    {expected.amountCents !== null && <DetailRow label="Requested amount" value={money(expected.amountCents)} />}
  </dl></section>;
}

function CurrentRecord({ record }: { record: AuditRecord }) {
  return <div className="daa-record"><p className="daa-record-source">{record.source === "leadflow_jobs" ? "LeadFlow job" : "Booking"}{record.publicBookingNumber ? ` · #${record.publicBookingNumber}` : record.bookingId !== null ? ` · ID ${record.bookingId}` : record.jobId !== null ? ` · ID ${record.jobId}` : ""}</p><dl>
    <DetailRow label="Service date" value={record.date ? dateLabel(record.date) : null} />
    <DetailRow label="Arrival" value={record.time ? `${record.time}${record.timeZone ? ` · ${record.timeZone}` : " · timezone unavailable"}` : null} />
    <DetailRow label="Status" value={record.status} />
    <DetailRow label="Address" value={record.address} />
    <DetailRow label="Service" value={record.serviceName} />
    <DetailRow label="Extras" value={record.extras === null ? null : extrasLabel(record.extras) || "None"} />
    <DetailRow label="Team" value={record.teamName} />
    {record.recurrence && <DetailRow label="Recurrence" value={record.recurrence} />}
    {record.paymentStatus && <DetailRow label="Payment status" value={record.paymentStatus} />}
    {record.paidAmountCents !== null && <DetailRow label="Paid amount" value={money(record.paidAmountCents)} />}
  </dl></div>;
}

function SmsEvidence({ message }: { message: AuditMessage }) {
  const sources: Record<AuditMessage["source"], string> = { inbound_sms: "Inbound SMS", conversation_history: "Conversation history", madison_sent: "Madison sent SMS", provider: "Verified SMS provider evidence" };
  const timeBases: Record<AuditMessage["timeBasis"], string> = { provider: "Provider timestamp", history: "History timestamp", received: "Received timestamp", unknown: "Time basis unknown" };
  return <li className={`daa-message daa-message-${message.direction}`}>
    <header><strong>{message.direction === "inbound" ? "Inbound · customer" : "Outbound · business"}</strong><span>{message.delivery}</span></header>
    <p className="daa-message-time">{timestampLabel(message.occurredAt)} · {timeBases[message.timeBasis]}</p>
    <p className="daa-message-text">{message.text || "Message text unavailable."}</p>
    <footer>{sources[message.source]}{message.observedAt && <span> · Observed {timestampLabel(message.observedAt)}</span>}</footer>
  </li>;
}

function AuditCard({ item }: { item: AuditItem }) {
  const links = item.recordLinks.filter(link => isSafeAuditRecordLink(link.href));
  return <article className={`daa-audit-card daa-status-${item.status}`} data-audit-status={item.status}>
    <header className="daa-item-header"><div className="daa-item-identity"><span className="daa-customer-icon" aria-hidden="true"><MessageSquareText size={17} /></span><div><h3>{item.customerName || "Customer name unavailable"}</h3><p>{item.customerPhone || "Phone unavailable"} <span>· {ACTION_LABELS[item.action]}</span></p></div></div><span className={`daa-status-pill daa-pill-${item.status}`}>{STATUS_LABELS[item.status]}</span></header>
    <div className="daa-item-context"><span className={`daa-agreement daa-agreement-${item.agreement}`}>{AGREEMENT_LABELS[item.agreement]}</span><p>{item.explanation || "No explanation supplied."}</p></div>
    <div className="daa-comparison"><ExpectedDetails item={item} /><section className="daa-comparison-panel daa-actual"><h4><ClipboardCheck size={14} aria-hidden="true" /> Actual · current records</h4>{item.records.length ? item.records.map(record => <CurrentRecord key={record.key} record={record} />) : <p className="daa-missing">No matching current record was available. This is not proof that the action was missed.</p>}</section></div>
    <div className="daa-verification"><FileSearch size={15} aria-hidden="true" /><p>{item.verification || "Verification detail unavailable."}<small>Current state verified at {timestampLabel(item.verifiedAt)}. This does not establish when an action was completed.</small></p></div>
    <details className="daa-evidence"><summary><MessageSquareText size={15} aria-hidden="true" /><span>Source SMS evidence <small>({item.evidence.length})</small></span><span className="daa-evidence-hint">View messages</span></summary>{item.evidence.length ? <ol className="daa-message-list">{item.evidence.map(message => <SmsEvidence key={message.key} message={message} />)}</ol> : <p className="daa-missing">Source SMS evidence is missing. Do not treat this item as a verified agreement.</p>}</details>
    {links.length > 0 && <nav className="daa-record-links" aria-label="Current record links">{links.map((link, index) => <a key={`${link.href}-${index}`} href={link.href}>{link.label || "Open current record"}<ArrowRight size={13} aria-hidden="true" /></a>)}</nav>}
  </article>;
}

function DateGroups({ items, auditDate }: { items: AuditItem[]; auditDate: string }) {
  const groups = new Map<string, AuditItem[]>();
  for (const item of items) {
    const key = item.affectedDate && isValidAuditDate(item.affectedDate) ? item.affectedDate : "undated";
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  const dates = Array.from(groups.keys()).sort((a, b) => a === "undated" ? 1 : b === "undated" ? -1 : a.localeCompare(b));
  return <>{dates.map(date => <section className="daa-date-group" key={date}><header className="daa-group-header"><CalendarDays size={15} aria-hidden="true" /><h3>{date === "undated" ? "Undated queue · service date unresolved" : dateLabel(date)}</h3><span>{date === "undated" ? "Date needs review" : date > auditDate ? "Future service date from message day" : "Service date"} · {groups.get(date)!.length} items</span></header><div className="daa-cards">{groups.get(date)!.map(item => <AuditCard item={item} key={item.id} />)}</div></section>)}</>;
}

export function mergeAuditBatches(previous: DailyActionAuditResult | null, next: DailyActionAuditResult): DailyActionAuditResult {
  if (!previous) return next;
  if (previous.auditDate !== next.auditDate || previous.timeZone !== next.timeZone || previous.asOf !== next.asOf) {
    throw new Error("Audit batch does not match the initial scan.");
  }
  const byId = new Map(previous.items.map(item => [item.id, item]));
  for (const item of next.items) byId.set(item.id, item);
  const items = Array.from(byId.values());
  const totals: DailyActionAuditResult["totals"] = { needs_action: 0, conflict: 0, cannot_verify: 0, matches: 0, superseded: 0 };
  for (const item of items) totals[item.status] += 1;
  return {
    ...next, items, totals,
    coverage: {
      status: "partial",
      messagesRead: previous.coverage.messagesRead + next.coverage.messagesRead,
      threadsRead: previous.coverage.threadsRead + next.coverage.threadsRead,
      threadsAnalyzed: previous.coverage.threadsAnalyzed + next.coverage.threadsAnalyzed,
      truncated: previous.coverage.truncated || next.coverage.truncated,
      warnings: Array.from(new Set([...previous.coverage.warnings, ...next.coverage.warnings])),
    },
  };
}

export function AuditResults({ result, filter = "all" }: { result: DailyActionAuditResult; filter?: AuditFilter }) {
  const tomorrow = shiftDay(easternDay(new Date(result.asOf)), 1);
  const filtered = result.items.filter(item => filter === "all" || Boolean(tomorrow && item.affectedDate === tomorrow));
  const sorted = [...filtered].sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status));
  const unresolved = sorted.filter(item => ["needs_action", "conflict", "cannot_verify"].includes(item.status));
  const reviewed = sorted.filter(item => item.status === "matches" || item.status === "superseded");
  return <section className="daa-results" aria-label="Audit results">
    <section className="daa-coverage" aria-label="Partial coverage warnings"><AlertCircle size={19} aria-hidden="true" /><div><h2>Partial coverage · not a complete reconciliation</h2><p>Only the available SMS evidence and current LeadFlow records were checked. Missing messages or records may leave actions unverified.</p><p className="daa-coverage-counts">{result.coverage.messagesRead} messages read · {result.coverage.threadsRead} threads read · {result.coverage.threadsAnalyzed} threads analyzed</p>{result.coverage.truncated && <p className="daa-warning"><strong>Scan truncated.</strong> Some source evidence was not included.</p>}{result.coverage.warnings.length > 0 && <ul>{result.coverage.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul>}</div></section>
    <div className="daa-result-meta"><p>Message day <strong>{dateLabel(result.auditDate)}</strong> · Eastern Time</p><p><Clock3 size={13} aria-hidden="true" /> Message evidence cutoff {timestampLabel(result.asOf)}</p></div>
    <div className="daa-status-counts" aria-label="All audit status counts">{STATUS_ORDER.map(status => <div key={status} className={`daa-count daa-count-${status}`} data-status-count={status}><strong>{result.totals[status]}</strong><span>{STATUS_LABELS[status]}</span></div>)}</div>
    <div className="daa-results-heading"><div><h2>{filter === "affectsTomorrow" ? "Actions affecting tomorrow" : "Actions by service date"}</h2><p>Unresolved items first. Requests and SMS confirmations are shown separately from current records.</p></div><span>{filtered.length} of {result.items.length} items</span></div>
    {filter === "affectsTomorrow" && <p className="daa-filter-note">Tomorrow is {tomorrow ? dateLabel(tomorrow) : "unavailable because the snapshot timestamp is invalid"}, calculated in Eastern Time at this scan. Undated items are excluded; switch to all actions to review them. Counts above cover the full scan.</p>}
    {!filtered.length && <div className="daa-empty"><FileSearch size={28} aria-hidden="true" /><h3>{result.items.length ? "No dated actions affect tomorrow in this scan" : "No actionable items found in the available evidence"}</h3><p>{result.items.length ? "Other service dates and the undated queue remain in all actions." : "Partial coverage still applies. An empty scan does not confirm that every customer agreement was fulfilled."}</p></div>}
    {unresolved.length > 0 && <section className="daa-priority-section" aria-label="Unresolved actions"><h2 className="daa-section-label"><AlertCircle size={15} aria-hidden="true" /> Needs review <span>{unresolved.length}</span></h2><DateGroups items={unresolved} auditDate={result.auditDate} /></section>}
    {reviewed.length > 0 && <section className="daa-priority-section" aria-label="Matching and superseded actions"><h2 className="daa-section-label"><CheckCircle2 size={15} aria-hidden="true" /> Matching / superseded <span>{reviewed.length}</span></h2><DateGroups items={reviewed} auditDate={result.auditDate} /></section>}
    <p className="daa-batch-note">{result.nextCursor ? "More evidence batches are available. Review the next batch manually to extend this scan." : "No further batch is available for this scan. Coverage remains partial; this does not establish complete provider-message coverage."}</p>
  </section>;
}

export function AuditRunError({ continuation = false, safeMessage }: { continuation?: boolean; safeMessage?: string }) {
  // Transport errors can contain source text. Render only an exact allowlist match.
  const message = safeAuditFailureMessage(safeMessage);
  return <div className="daa-error" role="alert"><AlertCircle size={18} aria-hidden="true" /><div><strong>{continuation ? "Next evidence batch could not be completed" : "Audit could not be completed"}</strong><p>{message ? `${message} No results are being shown. Run the audit again manually.` : "No results are being shown. Check your access and connection, then run the audit again manually."}</p></div></div>;
}

function AuditWorkspace() {
  const run = trpc.aiActions.dailyAudit.run.useMutation({ retry: false, gcTime: 0 });
  const [auditDate, setAuditDate] = useState(previousBusinessDay);
  const [result, setResult] = useState<DailyActionAuditResult | null>(null);
  const [filter, setFilter] = useState<AuditFilter>("all");
  const [failed, setFailed] = useState(false);
  const [batchFailed, setBatchFailed] = useState(false);
  const [safeMessage, setSafeMessage] = useState<string | null>(null);
  const [validation, setValidation] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const requestVersion = useRef(0);
  const mounted = useRef(false);
  const inFlight = useRef(false);
  const selectedDate = useRef(auditDate);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; requestVersion.current += 1; };
  }, []);

  function changeDate(value: string) {
    requestVersion.current += 1;
    selectedDate.current = value;
    setAuditDate(value);
    setResult(null);
    setFailed(false);
    setBatchFailed(false);
    setSafeMessage(null);
    setFilter("all");
    setValidation(auditDateError(value));
    run.reset();
  }

  async function runAudit(event: React.SyntheticEvent, continuation = false) {
    event.preventDefault();
    if (inFlight.current || pending || run.isPending) return;
    if (continuation && !result?.nextCursor) return;
    const previous = continuation ? result : null;
    const cursor = previous?.nextCursor;
    const error = auditDateError(auditDate);
    setValidation(error);
    setResult(null);
    setFailed(false);
    setBatchFailed(false);
    setSafeMessage(null);
    if (error) return;
    const version = ++requestVersion.current;
    const requestedDate = auditDate;
    inFlight.current = true;
    setPending(true);
    run.reset();
    try {
      const next = await run.mutateAsync({ auditDate: requestedDate, timeZone: AUDIT_TIME_ZONE, ...(cursor ? { cursor } : {}) });
      if (!mounted.current || version !== requestVersion.current || selectedDate.current !== requestedDate) return;
      if (next.auditDate !== requestedDate || next.timeZone !== AUDIT_TIME_ZONE) {
        setFailed(true);
        setBatchFailed(continuation);
        return;
      }
      setResult(mergeAuditBatches(previous, next));
    } catch (error) {
      if (mounted.current && version === requestVersion.current && selectedDate.current === requestedDate) {
        setResult(null);
        setFailed(true);
        setBatchFailed(continuation);
        setSafeMessage(safeAuditFailureMessage(typeof error === "object" && error !== null && "message" in error ? error.message : null));
      }
    } finally {
      inFlight.current = false;
      if (mounted.current) {
        run.reset();
        setPending(false);
      }
    }
  }

  const dateProblem = auditDateError(auditDate);
  return <main className="daily-action-audit-page"><div className="daa-content">
    <header className="daa-hero"><div><p className="daa-eyebrow"><ClipboardCheck size={15} aria-hidden="true" /> OPERATIONS · READ-ONLY REVIEW</p><h1>Daily Action Audit</h1><p className="daa-intro">What did customers ask for, and what does the schedule show now? Review a previous message day against current records.</p></div><span className="daa-readonly"><ShieldCheck size={16} aria-hidden="true" /> Read-only · nothing is changed</span></header>
    <form className="daa-run-panel" onSubmit={runAudit} aria-label="Run daily action audit"><div className="daa-date-field"><AuditCalendar value={isValidAuditDate(auditDate) ? auditDate : ""} min={MIN_DATE} onChange={changeDate} /><p>Previous days only · America/New_York</p></div><div className="daa-run-copy"><strong>Choose a message day, then run once.</strong><p>The scan compares SMS expectations with records as they exist now. It does not send messages, fix records, or run automatically.</p></div><button className="daa-run-button" type="submit" disabled={pending || run.isPending || Boolean(dateProblem)}><FileSearch size={17} aria-hidden="true" />{pending || run.isPending ? "Running audit…" : "Run audit"}</button></form>
    {(validation || dateProblem) && <p className="daa-date-error" role="alert">{validation || dateProblem}</p>}
    <aside className="daa-limit-note"><AlertCircle size={16} aria-hidden="true" /><p><strong>Every scan has partial coverage.</strong> Review warnings and source SMS before drawing conclusions. A current-state match does not prove that an action happened on the selected message day.</p></aside>
    {failed && <AuditRunError continuation={batchFailed} safeMessage={safeMessage ?? undefined} />}
    {(pending || run.isPending) && <div className="daa-empty daa-pending" role="status"><FileSearch size={28} aria-hidden="true" /><h2>Reading evidence and checking current records…</h2><p>No changes are made. Changing the message date discards this scan’s response.</p></div>}
    {result && !pending && !run.isPending && <><div className="daa-filter-bar" aria-label="Audit result filters"><span>Show</span><button type="button" aria-pressed={filter === "all"} onClick={() => setFilter("all")}>All actions</button><button type="button" aria-pressed={filter === "affectsTomorrow"} onClick={() => setFilter("affectsTomorrow")}>Affects tomorrow <span>ET</span></button></div><AuditResults result={result} filter={filter} />{result.nextCursor && <div className="daa-continuation"><p>Scan another bounded batch only when you choose. Coverage stays partial.</p><button type="button" className="daa-run-button" disabled={pending || run.isPending} onClick={event => void runAudit(event, true)}><FileSearch size={16} aria-hidden="true" /> Review next batch</button></div>}</>}
    {!result && !failed && !pending && !run.isPending && <div className="daa-empty daa-initial"><span className="daa-empty-icon"><ClipboardCheck size={29} aria-hidden="true" /></span><h2>Ready when you are</h2><p>Select a previous message day to review future service dates, unresolved actions, and their source SMS. Nothing runs until you click Run audit.</p><span className="daa-empty-footnote"><LockKeyhole size={13} aria-hidden="true" /> No automatic scans · no record changes</span></div>}
  </div></main>;
}

export default function DailyActionAudit() {
  const me = trpc.agents.me.useQuery(undefined, {
    retry: false, refetchOnWindowFocus: false, refetchOnReconnect: false, refetchInterval: false, gcTime: 0,
  });
  // Keep the workspace unmounted until authorization is known. No customer-data hook runs here.
  if (me.isLoading) return <main className="daily-action-audit-page"><div className="daa-access" role="status"><ShieldCheck size={25} aria-hidden="true" /><h1>Checking admin access…</h1></div></main>;
  if (me.error) return <main className="daily-action-audit-page"><div className="daa-access" role="alert"><LockKeyhole size={25} aria-hidden="true" /><h1>Could not verify admin access</h1><p>No audit data was loaded. Sign in as an admin and reload this page.</p></div></main>;
  if (me.data?.isAdmin !== true) return <main className="daily-action-audit-page"><div className="daa-access"><LockKeyhole size={25} aria-hidden="true" /><h1>Admin access required</h1><p>Sign in with an admin agent account to run this read-only audit.</p></div></main>;
  return <AuditWorkspace />;
}
