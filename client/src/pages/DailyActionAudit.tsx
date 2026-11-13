import React, { useEffect, useRef, useState } from "react";
import { AlertCircle, ArrowRight, ChevronDown, ClipboardCheck, Clock3, FileSearch, LockKeyhole, MessageSquareText, ShieldCheck } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { AUDIT_COLLECTION_FAILURES, safeAuditFailureMessage } from "@shared/dailyActionAudit";
import type { AuditAgreement, AuditDayCollection, AuditDaySms, AuditItem, AuditMessage, AuditRecord, AuditStatus, DailyActionAuditResult } from "@shared/dailyActionAudit";
import { BOOKING_WIDGET_PRICED_EXTRAS } from "@shared/bookingWidgetConfig";
import AuditCalendar from "@/components/daily-action-audit/AuditCalendar";
import "./daily-action-audit.css";

export const AUDIT_TIME_ZONE = "America/New_York";
const MIN_DATE = "1970-01-01";
export type AuditFilter = "all" | "affectsTomorrow";
const STATUS_LABELS: Record<AuditStatus, string> = {
  needs_action: "Needs action", conflict: "Conflict", cannot_verify: "Cannot verify", matches: "Matches now", superseded: "Superseded",
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

function uniqueAuditItems(items: AuditItem[]): AuditItem[] {
  // Match batch merge identity: the latest item with the same server ID wins.
  return Array.from(new Map(items.map(item => [item.id, item])).values());
}

function isCanonicalAuditPhone(value: string): boolean {
  // Validate the server's canonical US E.164 result only. Never normalize or repair it here.
  return /^\+1[2-9]\d{2}[2-9]\d{6}$/.test(value);
}

function compareAuditItems(a: AuditItem, b: AuditItem): number {
  const severity = STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status);
  if (severity) return severity;
  const aDate = a.affectedDate && isValidAuditDate(a.affectedDate) ? a.affectedDate : "undated";
  const bDate = b.affectedDate && isValidAuditDate(b.affectedDate) ? b.affectedDate : "undated";
  return aDate.localeCompare(bDate) || a.id.localeCompare(b.id);
}

export function groupAuditPeople(items: AuditItem[]): { key: string; customerPhone: string; customerName: string | null; nameConflict: boolean; items: AuditItem[]; reviewCount: number; status: AuditStatus }[] {
  const groups = new Map<string, AuditItem[]>();
  for (const item of uniqueAuditItems(items)) {
    const key = isCanonicalAuditPhone(item.customerPhone) ? `phone:${item.customerPhone}` : `item:${item.id}`;
    const group = groups.get(key) ?? [];
    group.push(item);
    groups.set(key, group);
  }
  return Array.from(groups, ([key, group]) => {
    const sorted = [...group].sort(compareAuditItems);
    const names = Array.from(new Set(sorted.map(item => item.customerName?.trim()).filter((name): name is string => Boolean(name))));
    return {
      key, customerPhone: sorted[0].customerPhone, customerName: names.length === 1 ? names[0] : null,
      nameConflict: names.length > 1, items: sorted,
      reviewCount: sorted.filter(item => item.status === "needs_action" || item.status === "conflict" || item.status === "cannot_verify").length,
      status: sorted[0].status,
    };
  }).sort((a, b) => compareAuditItems(a.items[0], b.items[0]) || a.key.localeCompare(b.key));
}

export function summarizeAuditItems(items: AuditItem[]): { people: number; actions: number; needsReview: number; matches: number; superseded: number; totals: Record<AuditStatus, number> } {
  const unique = uniqueAuditItems(items);
  const totals: Record<AuditStatus, number> = { needs_action: 0, conflict: 0, cannot_verify: 0, matches: 0, superseded: 0 };
  for (const item of unique) totals[item.status] += 1;
  return {
    people: groupAuditPeople(unique).length, actions: unique.length,
    needsReview: totals.needs_action + totals.conflict + totals.cannot_verify,
    matches: totals.matches, superseded: totals.superseded, totals,
  };
}

function conciseValue(value: string): string {
  const text = value.replace(/\s+/g, " ").trim();
  return text.length > 80 ? `${text.slice(0, 77)}…` : text;
}

export function actionSummary(item: AuditItem): string {
  const expected = item.expected;
  const date = expected.date && isValidAuditDate(expected.date) ? expected.date : item.affectedDate && isValidAuditDate(item.affectedDate) ? item.affectedDate : "date unresolved";
  const arrival = item.action === "reschedule" || item.action === "book"
    ? expected.time ? ` · ${conciseValue(expected.time)}${expected.windowEnd ? `–${conciseValue(expected.windowEnd)}` : ""}${expected.timeKind === "window" ? " arrival window" : expected.timeKind === "exact" ? " exact time" : " (time unspecified)"}` : " · time unspecified"
    : "";
  const scope = expected.scope === "subsequent" ? "subsequent visits" : expected.scope === "visit" ? "this visit" : "scope unspecified";
  const affected = item.affectedDate && isValidAuditDate(item.affectedDate) && item.affectedDate !== date ? ` · affects ${item.affectedDate}` : "";
  let action: string;
  switch (item.action) {
    case "reschedule": action = "Reschedule"; break;
    case "cancel": action = "Cancellation"; break;
    case "book": action = `New booking${expected.serviceName ? ` · ${conciseValue(expected.serviceName)}` : ""}`; break;
    case "address": action = `Address change · ${expected.address ? conciseValue(expected.address) : "address unspecified"}`; break;
    case "service": action = `Service change${expected.serviceName ? ` · ${conciseValue(expected.serviceName)}` : ""}${expected.extras !== null ? ` · ${expected.extrasMode ?? "unspecified"} extras: ${conciseValue(extrasLabel(expected.extras)) || "none specified"}` : ""}`; break;
    case "assignment": action = `Team assignment · ${expected.teamName ? conciseValue(expected.teamName) : "team unspecified"}`; break;
    case "payment": action = `Payment · ${expected.amountCents !== null ? money(expected.amountCents) : "amount unspecified"}`; break;
  }
  const original = item.action === "reschedule" && expected.originalDate && isValidAuditDate(expected.originalDate) ? `${expected.originalDate} → ` : "";
  return `${action} · ${original}${date}${arrival} · ${scope}${affected}`;
}

function serviceContext(item: AuditItem): string {
  const expected = item.expected;
  const parts = [expected.date ? `Service date: ${dateLabel(expected.date)}` : `Service date: undated / unresolved${item.affectedDate ? ` · affects ${dateLabel(item.affectedDate)}` : ""}`];
  if (expected.originalDate) parts.push(`Original date: ${dateLabel(expected.originalDate)}`);
  if (item.affectedDate && expected.date && item.affectedDate !== expected.date) parts.push(`Affects: ${dateLabel(item.affectedDate)}`);
  parts.push(expected.time ? `Arrival: ${expected.time}${expected.windowEnd ? ` – ${expected.windowEnd}` : ""} · ${expected.timeKind === "window" ? "arrival window" : expected.timeKind === "exact" ? "exact time" : "time unspecified"}` : `Arrival: time unspecified${expected.windowEnd ? ` · window end ${expected.windowEnd}` : ""}`);
  parts.push(`Scope: ${expected.scope === "visit" ? "this visit" : expected.scope === "subsequent" ? "subsequent visits" : "not specified"}`);
  return parts.join(" · ");
}

function recordReference(record: AuditRecord): string {
  const references = [record.publicBookingNumber ? `#${record.publicBookingNumber}` : null, record.bookingId !== null ? `Booking ID ${record.bookingId}` : null, record.jobId !== null ? `Job ID ${record.jobId}` : null].filter(Boolean);
  return `${record.source === "leadflow_jobs" ? "LeadFlow job (leadflow_jobs)" : "Booking (bookings)"} · ${references.join(" · ") || "record reference unavailable"}`;
}

function relevantRecordValue(item: AuditItem, record: AuditRecord): string | null {
  switch (item.action) {
    case "address": return `Actual address: ${record.address || "unavailable"}`;
    case "service": return `Actual service: ${record.serviceName || "unavailable"} · Extras: ${record.extras === null ? "unavailable" : extrasLabel(record.extras) || "none"}`;
    case "assignment": return `Actual team: ${record.teamName || "unavailable"}`;
    case "payment": return `Actual payment status: ${record.paymentStatus || "unavailable"} · Paid amount: ${money(record.paidAmountCents)}`;
    case "reschedule":
    case "book": {
      const fields: string[] = [];
      if (item.expected.address !== null) fields.push(`Actual address: ${record.address || "unavailable"}`);
      if (item.expected.serviceName !== null) fields.push(`Actual service: ${record.serviceName || "unavailable"}`);
      if (item.expected.extras !== null) fields.push(`Actual extras: ${record.extras === null ? "unavailable" : extrasLabel(record.extras) || "none"}`);
      if (item.expected.teamName !== null) fields.push(`Actual team: ${record.teamName || "unavailable"}`);
      return fields.length ? fields.join(" · ") : null;
    }
    default: return null;
  }
}

function ExpectedDetails({ item }: { item: AuditItem }) {
  const expected = item.expected;
  return <section className="daa-fields daa-expected"><h4><MessageSquareText size={14} aria-hidden="true" /> Expected from SMS · not system proof</h4><dl>
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
  return <div className="daa-record"><p className="daa-record-source">{recordReference(record)}</p><dl>
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

function AuditAction({ item }: { item: AuditItem }) {
  const links = item.recordLinks.filter(link => isSafeAuditRecordLink(link.href));
  return <article className={`daa-action daa-status-${item.status}`} data-audit-status={item.status}>
    <header className="daa-action-header"><h3>{actionSummary(item)}</h3><span className={`daa-status-pill daa-pill-${item.status}`}>{STATUS_LABELS[item.status]}</span></header>
    <p className={`daa-agreement daa-agreement-${item.agreement}`}>{AGREEMENT_LABELS[item.agreement]} · SMS agreement, not system proof</p>
    <p className="daa-service-context">{serviceContext(item)}</p>
    <section className="daa-system-evidence" aria-label="Actual system evidence"><h4><ClipboardCheck size={14} aria-hidden="true" /> System record evidence · current records</h4>{item.records.length ? <ul className="daa-system-records">{item.records.map(record => <li key={record.key}><strong>{recordReference(record)}</strong><p>Actual service date: {record.date ? dateLabel(record.date) : "unavailable"} · Arrival: {record.time ? `${record.time}${record.timeZone ? ` · ${record.timeZone}` : " · timezone unavailable"}` : "unavailable"} · Status: {record.status || "unavailable"}</p>{relevantRecordValue(item, record) && <p>{relevantRecordValue(item, record)}</p>}</li>)}</ul> : <p className="daa-missing">No matching current record was available. This is not proof that the action was missed.</p>}<p className="daa-verification">{item.verification || "Verification detail unavailable."}</p><p className="daa-snapshot-note">Current records checked at {timestampLabel(item.verifiedAt)}. A match now does not establish when an action happened.</p></section>
    <details className="daa-record-details"><summary><FileSearch size={14} aria-hidden="true" /><span>Full action &amp; record fields</span><ChevronDown size={14} className="daa-detail-chevron" aria-hidden="true" /></summary><div className="daa-expanded-fields"><dl><DetailRow label="Supplied name" value={item.customerName} /><DetailRow label="Customer phone" value={item.customerPhone} /></dl><p className="daa-explanation"><strong>{ACTION_LABELS[item.action]} assessment:</strong> {item.explanation || "No explanation supplied."}</p><p className="daa-verification"><strong>Current-state comparison:</strong> {item.verification || "Verification detail unavailable."}</p><ExpectedDetails item={item} /><section className="daa-fields daa-actual"><h4>Actual system record fields</h4>{item.records.map(record => <CurrentRecord key={record.key} record={record} />)}{!item.records.length && <p className="daa-missing">No current record fields available.</p>}</section></div></details>
    <details className="daa-evidence"><summary><MessageSquareText size={14} aria-hidden="true" /><span>Cited SMS only <small>({item.evidence.length})</small></span><ChevronDown size={14} className="daa-detail-chevron" aria-hidden="true" /></summary>{item.evidence.length ? <ol className="daa-message-list">{item.evidence.map(message => <SmsEvidence key={message.key} message={message} />)}</ol> : <p className="daa-missing">Source SMS evidence is missing. Do not treat this item as a verified agreement.</p>}</details>
    {links.length > 0 && <nav className="daa-record-links" aria-label="Current record links">{links.map((link, index) => <a key={`${link.href}-${index}`} href={link.href}>{link.label || "Open current record"}<ArrowRight size={13} aria-hidden="true" /></a>)}</nav>}
  </article>;
}

function AuditPerson({ person }: { person: ReturnType<typeof groupAuditPeople>[number] }) {
  return <details className={`daa-person daa-status-${person.status}`} data-person-key={person.key}>
    <summary className="daa-person-summary"><span className="daa-person-identity"><strong>{person.nameConflict ? "Name needs review" : person.customerName || "Customer name unavailable"}</strong><span>{isCanonicalAuditPhone(person.customerPhone) ? person.customerPhone : person.customerPhone ? `Phone needs review · ${person.customerPhone}` : "Phone unavailable · separate item"}</span></span><span className="daa-person-work"><span className="daa-person-counts"><strong>{person.items.length} {person.items.length === 1 ? "action" : "actions"}</strong><span>{person.reviewCount} need review</span></span><span className="daa-action-preview">{actionSummary(person.items[0])}{person.items.length > 1 ? ` · +${person.items.length - 1} more` : ""}</span></span><span className={`daa-status-pill daa-pill-${person.status}`}>{STATUS_LABELS[person.status]}</span><ChevronDown size={17} className="daa-person-chevron" aria-hidden="true" /></summary>
    <div className="daa-person-body"><h3 className="daa-section-label">Action items</h3>{person.nameConflict && <p className="daa-name-warning"><AlertCircle size={14} aria-hidden="true" /> Different names appear for this phone. Name needs review; no name was chosen as the identity.</p>}{!isCanonicalAuditPhone(person.customerPhone) && <p className="daa-name-warning">Phone is missing or not a trusted canonical result. This action has not been merged with another person.</p>}{person.items.map(item => <AuditAction item={item} key={item.id} />)}</div>
  </details>;
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

function uniqueDaySms(messages: AuditDaySms[]): AuditDaySms[] {
  // Raw source identity is the provider SMS ID, never action/person eligibility.
  return Array.from(new Map(messages.map(message => [message.id, message])).values());
}

function collectionFailureText(failure: AuditDayCollection["failure"]): string {
  // Even malformed runtime values may only select fixed shared text, never error content.
  return typeof failure === "string" && Object.prototype.hasOwnProperty.call(AUDIT_COLLECTION_FAILURES, failure)
    ? AUDIT_COLLECTION_FAILURES[failure] : AUDIT_COLLECTION_FAILURES.FAILED;
}

function SmsCollectionStatus({ result, messages }: { result: DailyActionAuditResult; messages: AuditDaySms[] }) {
  const collection = result.collection;
  if (!collection) return <section className="daa-collection-status daa-collection-unproven" aria-label="SMS collection status"><h2>SMS collection completeness not established</h2><p>This legacy result does not include the day’s raw SMS corpus. Its source counters do not prove a complete organization-wide day collection.</p></section>;
  const complete = collection.status === "complete";
  const incoming = messages.filter(message => message.direction === "incoming").length;
  const outgoing = messages.filter(message => message.direction === "outgoing").length;
  return <section className={`daa-collection-status daa-collection-${collection.status}`} aria-label="SMS collection status" role={complete ? undefined : "alert"}>
    <h2>{complete ? messages.length ? "SMS collection complete · all organization lines" : "No SMS returned for this day" : "SMS collection failed"}</h2>
    {complete && !messages.length && <p><strong>SMS collection complete · all organization lines</strong></p>}
    {complete || messages.length > 0 ? <p className="daa-source-count"><strong>{messages.length} unique SMS{!complete && " captured before collection failed"}</strong> · {incoming} incoming · {outgoing} outgoing · {collection.pagesRead} pages read</p> : <p>Collection stopped before any SMS could be verified · {collection.pagesRead} pages read</p>}
    <p>Provider SMS window: {timestampLabel(collection.start)} inclusive → {timestampLabel(collection.end)} exclusive · Eastern Time</p>
    <p>{complete ? "All organization SMS pages for this window were collected before action analysis. SMS collection is not proof that any requested action was completed." : "Incomplete captured prefix only — not a full-day SMS collection. No full-day action finding is available."}</p>
    {!complete && <p className="daa-collection-failure">{collectionFailureText(collection.failure)}</p>}
    {(collection.duplicates > 0 || collection.outOfWindow > 0) && <p className="daa-source-exclusions">{collection.duplicates} duplicate SMS excluded · {collection.outOfWindow} out-of-window SMS excluded</p>}
  </section>;
}

function DaySmsCorpus({ collection, messages }: { collection: AuditDayCollection; messages: AuditDaySms[] }) {
  // One closed native expander: all raw SMS remain inspectable without another request.
  // Do not apply action filters, canonical-phone grouping, or model eligibility here.
  return <details className="daa-day-sms" aria-label="Day's source SMS"><summary><MessageSquareText size={15} aria-hidden="true" /><strong>Day’s SMS ({messages.length})</strong>{collection.status === "failed" && <span>Incomplete prefix</span>}<ChevronDown size={15} className="daa-detail-chevron" aria-hidden="true" /></summary>
    <div className="daa-day-sms-body"><p>All captured unique provider SMS, including groups, unknown identities, and attachments. Action filters do not change this source list. Attachments are listed as metadata only; they are not fetched or analyzed.</p>
      {messages.length ? <ol className="daa-day-sms-list">{messages.map(message => <li className="daa-source-sms" key={message.id} data-sms-id={message.id}>
        <header><strong>{message.direction === "incoming" ? "Incoming SMS" : "Outgoing SMS"}</strong><span>Status: {message.status || "Unavailable"}</span></header>
        <p className="daa-message-time">Provider SMS date/time: {timestampLabel(message.createdAt)} · {message.createdAt || "Unavailable"}</p>
        <dl><DetailRow label="SMS ID" value={message.id} /><DetailRow label="From" value={message.from} /><DetailRow label="To" value={message.to.join(", ")} /><DetailRow label="Organization line ID" value={message.phoneNumberId} /><DetailRow label="Conversation ID" value={message.conversationId} /><DetailRow label="Provider updated" value={message.updatedAt ? `${timestampLabel(message.updatedAt)} · ${message.updatedAt}` : null} /></dl>
        <p className="daa-message-text">{message.text || "No text supplied with this SMS."}</p>
        <p className="daa-source-attachments">{message.media.length} {message.media.length === 1 ? "attachment" : "attachments"} · metadata only</p>
        {message.media.length > 0 && <ul className="daa-source-media">{message.media.map((media, index) => <li key={index}>Attachment {index + 1} · {media.type || "Type unavailable"} · {media.url || "URL unavailable"}</li>)}</ul>}
      </li>)}</ol> : <p>{collection.status === "complete" ? "No SMS returned for this day." : "No verified SMS prefix was returned. Collection failed; this is not an empty-day finding."}</p>}
    </div>
  </details>;
}

function auditAnalysisState(result: DailyActionAuditResult, messages: AuditDaySms[]) {
  const analysis = result.analysis;
  const collectionFailed = result.collection?.status === "failed";
  const emptyDay = result.collection?.status === "complete" && messages.length === 0;
  const analyzed = analysis?.threadsAnalyzed ?? result.coverage.threadsAnalyzed;
  const total = analysis?.threadsTotal ?? result.coverage.threadsRead;
  const available = !collectionFailed && !emptyDay && (analyzed > 0 || result.items.length > 0) && (analysis ? analysis.status === "complete" || analysis.status === "partial" : !result.collection);
  const partial = !analysis || analysis.status !== "complete" || analyzed < total || analysis.failedThreads > 0 || analysis.omittedMessages > 0 || analysis.unsupportedMessages > 0;
  const smsLoaded = messages.length > 0 || (!result.collection && result.coverage.messagesRead > 0);
  return { available, partial, analyzed, total, emptyDay, collectionFailed, smsLoaded };
}

function ActionAnalysisStatus({ result, state }: { result: DailyActionAuditResult; state: ReturnType<typeof auditAnalysisState> }) {
  const analysis = result.analysis;
  return <section className={`daa-analysis-status${state.available && !state.partial ? "" : " daa-analysis-incomplete"}`} aria-label="Action analysis status">
    <h2>{state.collectionFailed ? "Action analysis unavailable · SMS collection failed" : state.emptyDay ? "No SMS to analyze" : !state.available ? state.smsLoaded ? "SMS loaded; analysis unavailable" : "Action analysis unavailable" : state.partial ? "Partial action analysis · returned findings only" : "Action analysis complete"}</h2>
    {analysis ? <p className="daa-analysis-counts">{analysis.threadsAnalyzed} of {analysis.threadsTotal} threads analyzed · {analysis.failedThreads} failed · {analysis.unsupportedMessages} unsupported messages · {analysis.omittedMessages} omitted messages</p> : result.collection ? <p className="daa-analysis-counts">Explicit action-analysis status and counts were not returned.</p> : <p className="daa-analysis-counts">{state.analyzed} of {state.total} threads analyzed · Failure, omission, and unsupported-message counts are unavailable for this legacy result.</p>}
    {!state.available && !state.emptyDay && <p>{analysis?.status === "not_run" || state.collectionFailed ? "Analysis was not run." : analysis?.status === "failed" ? "Analysis failed." : "No usable action analysis was returned."} No action finding or zero-action conclusion is available.</p>}
    {state.available && state.partial && <p>Only successfully processed SMS evidence contributed returned actions. This is not a whole-day action finding.</p>}
    {Boolean(analysis?.unsupportedMessages) && <p>Unsupported SMS remain in Day’s SMS; they were not analyzed for actions.</p>}
    {Boolean(analysis?.failedThreads || analysis?.omittedMessages) && <p>Failed threads or omitted SMS may still contain actions requiring review.</p>}
  </section>;
}

export function AuditResults({ result, filter = "all" }: { result: DailyActionAuditResult; filter?: AuditFilter }) {
  const tomorrow = shiftDay(easternDay(new Date(result.asOf)), 1);
  const items = uniqueAuditItems(result.items);
  const filtered = items.filter(item => filter === "all" || Boolean(tomorrow && item.affectedDate === tomorrow));
  const summary = summarizeAuditItems(items);
  const visibleIds = new Set(filtered.map(item => item.id));
  // Date filters narrow actions, not the identity/conflicts established by the full scan.
  const people = groupAuditPeople(items).flatMap(person => {
    const visible = person.items.filter(item => visibleIds.has(item.id));
    if (!visible.length) return [];
    return [{ ...person, items: visible,
      reviewCount: visible.filter(item => item.status === "needs_action" || item.status === "conflict" || item.status === "cannot_verify").length,
      status: visible[0].status,
    }];
  }).sort((a, b) => compareAuditItems(a.items[0], b.items[0]) || a.key.localeCompare(b.key));
  const messages = result.collection ? uniqueDaySms(result.collection.messages) : [];
  const analysisState = auditAnalysisState(result, messages);
  return <section className="daa-results" aria-label="Audit results">
    <SmsCollectionStatus result={result} messages={messages} />
    {result.collection && <DaySmsCorpus collection={result.collection} messages={messages} />}
    <ActionAnalysisStatus result={result} state={analysisState} />
    {analysisState.available && <section className="daa-overview" aria-label="Action summary"><div className="daa-overview-heading"><h2>Overall summary</h2><span>{analysisState.partial ? "Returned actions · partial analysis · all dates" : "Returned actions · analyzed threads · all dates"}</span></div><div className="daa-overview-counts"><div><strong>{summary.people}</strong><span>People with actions</span></div><div><strong>{summary.actions}</strong><span>Actions</span></div><div className="daa-overview-review"><strong>{summary.needsReview}</strong><span>Needs review</span></div><div className="daa-overview-matches"><strong>{summary.matches}</strong><span>Matches now</span></div></div><div className="daa-status-counts" aria-label="All audit status counts">{STATUS_ORDER.map(status => <span key={status} className={`daa-count daa-count-${status}`} data-status-count={status}><strong>{summary.totals[status]}</strong> {STATUS_LABELS[status]}</span>)}</div></section>}
    <details className="daa-coverage-details" aria-label="Partial coverage warnings"><summary><AlertCircle size={16} aria-hidden="true" /><strong>Partial coverage · not a complete reconciliation</strong><span className="daa-coverage-flags">{result.coverage.truncated && <span>Scan truncated</span>}{result.coverage.warnings.length > 0 && <span>{result.coverage.warnings.length} analysis {result.coverage.warnings.length === 1 ? "warning" : "warnings"}</span>}</span><ChevronDown size={15} className="daa-detail-chevron" aria-hidden="true" /></summary><div className="daa-coverage-body"><p>{result.collection?.status === "complete" ? "Complete SMS collection is separate from action analysis and historical proof. Current LeadFlow records do not establish when an action happened." : "Only the available SMS evidence and current LeadFlow records were checked. Missing messages or records may leave actions unverified."} People and action counts come from unique returned action items, not conversation totals.</p>{!result.collection && <p className="daa-coverage-counts">Source counters may overlap across batches: {result.coverage.messagesRead} messages read · {result.coverage.threadsRead} threads read · {result.coverage.threadsAnalyzed} threads analyzed. These counters do not establish complete interaction coverage.</p>}{result.coverage.truncated && <p className="daa-warning"><strong>Scan truncated.</strong> Some source evidence was not included.</p>}{result.coverage.warnings.length > 0 && <ul>{result.coverage.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul>}</div></details>
    <div className="daa-result-meta"><p>Message day <strong>{dateLabel(result.auditDate)}</strong> · Eastern Time</p><p><Clock3 size={13} aria-hidden="true" /> Message evidence cutoff {timestampLabel(result.asOf)}</p></div>
    {analysisState.available && <><div className="daa-results-heading"><div><h2>{filter === "affectsTomorrow" ? "People with actions affecting tomorrow" : "Actions by person"}</h2><p>Needs review first. Expand a person for concise actions and actual system evidence.</p></div><span>{people.length} {people.length === 1 ? "person" : "people"} · {filtered.length} of {summary.actions} actions</span></div>
      {filter === "affectsTomorrow" && <p className="daa-filter-note">Tomorrow is {tomorrow ? dateLabel(tomorrow) : "unavailable because the snapshot timestamp is invalid"}, calculated in Eastern Time at this scan. Undated items are excluded; switch to all actions to review them. Counts above cover all returned actions, not unanalyzed SMS.</p>}
      {!filtered.length && <div className="daa-empty"><FileSearch size={28} aria-hidden="true" /><h3>{items.length ? "No dated actions affect tomorrow in this scan" : analysisState.partial ? "No actionable items returned from analyzed threads" : "No actionable items found in analyzed SMS"}</h3><p>{items.length ? "Other service dates and undated actions remain in all actions." : `${analysisState.partial ? "Partial analysis still applies; unanalyzed SMS may contain actions. " : "Current-state evidence is not historical proof. "}An empty scan does not confirm that every customer agreement was fulfilled.`}</p></div>}
      <div className="daa-people">{people.map(person => <AuditPerson person={person} key={person.key} />)}</div></>}
    <p className="daa-batch-note">{result.collection ? result.collection.status === "complete" ? "SMS collection is complete. Current records still do not establish when an action happened." : "Incomplete SMS prefix only; not a full-day collection." : result.nextCursor ? "More evidence batches are available. Review the next batch manually to extend this scan." : "No further batch is available for this scan. Coverage remains partial; this does not establish complete provider-message coverage."}</p>
  </section>;
}

export function AuditRunError({ continuation = false, safeMessage }: { continuation?: boolean; safeMessage?: string }) {
  // Transport errors can contain source text. Render only an exact allowlist match.
  const message = safeAuditFailureMessage(safeMessage);
  return <div className="daa-error" role="alert"><AlertCircle size={18} aria-hidden="true" /><div><strong>{continuation ? "Next evidence batch could not be completed" : "Audit could not be completed"}</strong><p>{message ? `${message} No results are being shown.` : "No results are being shown. The audit failed without a verified failure detail. No changes were made."}</p></div></div>;
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
    <aside className="daa-limit-note"><AlertCircle size={16} aria-hidden="true" /><p><strong>SMS collection and action verification are separate.</strong> Review collection status, analysis gaps, and source SMS before drawing conclusions. A current-state match does not prove that an action happened on the selected message day.</p></aside>
    {failed && <AuditRunError continuation={batchFailed} safeMessage={safeMessage ?? undefined} />}
    {(pending || run.isPending) && <div className="daa-empty daa-pending" role="status"><FileSearch size={28} aria-hidden="true" /><h2>Collecting the day’s SMS, then checking actions…</h2><p>No changes are made. Changing the message date discards this scan’s response.</p></div>}
    {result && !pending && !run.isPending && <><div className="daa-filter-bar" aria-label="Audit result filters"><span>Show</span><button type="button" aria-pressed={filter === "all"} onClick={() => setFilter("all")}>All actions</button><button type="button" aria-pressed={filter === "affectsTomorrow"} onClick={() => setFilter("affectsTomorrow")}>Affects tomorrow <span>ET</span></button></div><AuditResults result={result} filter={filter} />{!result.collection && result.nextCursor && <div className="daa-continuation"><p>Scan another bounded batch only when you choose. Coverage stays partial.</p><button type="button" className="daa-run-button" disabled={pending || run.isPending} onClick={event => void runAudit(event, true)}><FileSearch size={16} aria-hidden="true" /> Review next batch</button></div>}</>}
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
