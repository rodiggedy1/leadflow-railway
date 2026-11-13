import type {
  AuditCandidate, AuditExpectation, AuditItem, AuditMessage, AuditRecord,
  AuditStatus, AuditThread,
} from "../shared/dailyActionAudit";
import { normalizePhone } from "./utils/phone";
import { BOOKING_WIDGET_PRICED_EXTRAS } from "../shared/bookingWidgetConfig";

export type VerifyAuditCandidatesInput = {
  auditDate: string;
  timeZone: string;
  asOf: string;
  threads: AuditThread[];
  candidates: AuditCandidate[];
  records: AuditRecord[];
};

type Check = { status: AuditStatus; reason: string };
type Group = { key: string; records: AuditRecord[] };
type Selection = { group: Group | null; records: AuditRecord[]; visit: string | null; error: string | null; occurrenceOnly?: boolean };
type EvidenceCheck = { thread: AuditThread | null; phone: string | null; evidence: AuditMessage[]; anchor: AuditMessage | null; error: string | null };

/** Guard syntax only; the central helper owns all US/E.164 normalization. */
export function normalizeAuditPhone(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const raw = value.trim();
  if (!raw || !/^\+?[\d\s().-]+$/.test(raw)) return null;
  if (raw.startsWith("+") && !/^\+1(?:[\s().-]*\d){10}[\s().-]*$/.test(raw)) return null;
  return normalizePhone(raw);
}

export function isValidAuditDate(value: string | null | undefined): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function validTimeZone(value: string): boolean {
  try { new Intl.DateTimeFormat("en-US", { timeZone: value }).format(0); return true; }
  catch { return false; }
}

// Reject offset-less timestamps and calendar rollover instead of letting Date.parse guess.
function instant(value: string | null): number | null {
  if (typeof value !== "string") return null;
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match || !isValidAuditDate(match[1]) || Number(match[2]) > 23 || Number(match[3]) > 59 || Number(match[4]) > 59) return null;
  if (match[5] !== "Z" && (Number(match[5].slice(1, 3)) > 23 || Number(match[5].slice(4)) > 59)) return null;
  const result = Date.parse(value);
  return Number.isFinite(result) ? result : null;
}

/** Calendar day in the business timezone, including DST transitions. */
export function auditBusinessDate(value: string | null, timeZone: string): string | null {
  const at = instant(value);
  if (at === null || !validTimeZone(timeZone)) return null;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(at);
  const get = (type: string) => parts.find(part => part.type === type)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function normalizeAuditTime(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const raw = value.trim();
  const clock = /^(\d{1,2}):(\d{2})(?::00)?$/.exec(raw);
  if (clock && Number(clock[1]) <= 23 && Number(clock[2]) <= 59) return `${clock[1].padStart(2, "0")}:${clock[2]}`;
  const meridiem = /^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)$/i.exec(raw);
  if (!meridiem || Number(meridiem[1]) < 1 || Number(meridiem[1]) > 12 || Number(meridiem[2] ?? 0) > 59) return null;
  const hour = Number(meridiem[1]) % 12 + (meridiem[3].toUpperCase() === "PM" ? 12 : 0);
  return `${String(hour).padStart(2, "0")}:${meridiem[2] ?? "00"}`;
}

function text(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
  return normalized || null;
}
export function normalizeAuditExtra(value: string): string | null {
  const normalized = text(value);
  return BOOKING_WIDGET_PRICED_EXTRAS.find(extra => text(extra.id) === normalized || text(extra.label) === normalized)?.id ?? null;
}
function validId(value: number | null): value is number { return Number.isSafeInteger(value) && (value ?? 0) > 0; }
// The shared contract does not distinguish provider-backed history from a generic
// processing-time history timestamp. Only an explicit provider basis proves time.
function authoritative(message: AuditMessage): boolean { return message.timeBasis === "provider"; }
function cancelled(record: AuditRecord): boolean { return ["cancelled", "canceled"].includes(text(record.status) ?? ""); }
const activeStatuses = new Set(["confirmed", "booked", "scheduled", "assigned", "unassigned", "in_progress", "completed"]);
const pendingStatuses = new Set(["pending", "pending_card", "needs_attention", "requested", "draft", "hold", "on_hold"]);
function recurring(record: AuditRecord): boolean {
  const recurrence = text(record.recurrence);
  return !!record.seriesId || (recurrence !== null && !["one-time", "one time", "once", "none", "single"].includes(recurrence));
}
// Match the supported cadence semantics of bookingReschedule/leadflowJobsService,
// not origin, a nonempty label, or an unrelated series ID.
function recurringCadence(record: AuditRecord): string | null {
  const frequency = text(record.recurrence)?.replace(/[–—]/g, "-") ?? "";
  if (frequency.includes("tri-weekly") || frequency.includes("triweekly")) return "triweekly";
  if (frequency.includes("bi-weekly") || frequency.includes("biweekly")) return "biweekly";
  if (frequency.includes("monthly")) return "monthly";
  if (frequency.includes("weekly")) return "weekly";
  return null;
}
function unique<T>(values: T[]): T[] { return Array.from(new Set(values)); }
function copyExpectation(expected: AuditExpectation): AuditExpectation { return { ...expected, extras: expected.extras ? [...expected.extras] : null }; }
function copyRecord(record: AuditRecord): AuditRecord { return { ...record, extras: record.extras ? [...record.extras] : null }; }

function evidenceFor(candidate: AuditCandidate, input: VerifyAuditCandidatesInput): EvidenceCheck {
  const threads = input.threads.filter(thread => thread.key === candidate.threadKey);
  const thread = threads.length === 1 ? threads[0] : null;
  const phone = normalizeAuditPhone(thread?.customerPhone);
  const result: EvidenceCheck = { thread, phone, evidence: [], anchor: null, error: null };
  const fail = (error: string) => ({ ...result, error });
  if (!thread || !phone) return fail("Thread or exact valid customer phone is missing or ambiguous; names are not identity proof.");
  if (!candidate.evidenceKeys.length || !candidate.evidenceKeys.includes(candidate.anchorMessageKey)) return fail("The anchor must be included in the candidate's source evidence keys.");
  if (unique(candidate.evidenceKeys).length !== candidate.evidenceKeys.length) return fail("Duplicate evidence keys cannot establish source provenance.");
  const messages: AuditMessage[] = [];
  for (const key of candidate.evidenceKeys) {
    const local = thread.messages.filter(message => message.key === key);
    const global = input.threads.flatMap(other => other.messages).filter(message => message.key === key);
    if (local.length !== 1 || global.length !== 1 || normalizeAuditPhone(local[0].customerPhone) !== phone) return fail("A source key is missing, duplicated, or belongs to a different thread/customer.");
    messages.push(local[0]);
  }
  result.evidence = messages;
  result.anchor = messages.find(message => message.key === candidate.anchorMessageKey) ?? null;
  const anchor = result.anchor;
  if (!anchor) return fail("The selected anchor could not be established.");
  if (!authoritative(anchor) || instant(anchor.occurredAt) === null) return fail("Anchor time is unknown/received/history without explicit provider-time proof, or invalid; observed/received time cannot prove strict-day evidence.");
  if (anchor.direction === "outbound" && !["sent", "delivered"].includes(anchor.delivery)) return fail("An outbound anchor must be actually sent/delivered, regardless of the model's agreement label; drafts and failed messages cannot establish requests or corrections.");
  if (anchor.direction === "inbound" && anchor.delivery !== "received") return fail("An inbound anchor must be actually received; incomplete or failed incoming messages are not established requests.");
  if (!candidate.contextOnly && auditBusinessDate(anchor.occurredAt, input.timeZone) !== input.auditDate) return fail("The authoritative anchor is outside the selected business-timezone day.");
  const asOf = instant(input.asOf)!;
  for (const message of messages) {
    if (!authoritative(message) || instant(message.occurredAt) === null) return fail("Evidence has unknown/received/history without explicit provider-time proof, or invalid occurrence time; strict-day agreement cannot be verified.");
    if (instant(message.occurredAt)! > asOf) return fail("Evidence occurs after the supplied snapshot asOf.");
  }
  if (candidate.agreement === "confirmed" && !messages.some(message => message.direction === "outbound" && ["sent", "delivered"].includes(message.delivery))) return fail("Confirmation requires actual sent/delivered OUTBOUND source evidence; unknown outbound delivery is not confirmation.");
  return result;
}

function expectationError(candidate: AuditCandidate): string | null {
  const expected = candidate.expected;
  if (candidate.ambiguous) return "The action candidate is explicitly ambiguous; no visit or household will be guessed.";
  if (expected.date !== null && !isValidAuditDate(expected.date)) return "Expected target date is malformed or impossible.";
  if (expected.originalDate !== null && !isValidAuditDate(expected.originalDate)) return "Expected original date is malformed or impossible.";
  if (expected.bookingReference !== null && !expected.bookingReference.trim()) return "An empty public booking reference cannot identify a visit.";
  if (expected.scope === "subsequent") return "A series-wide/subsequent change cannot be proven from a current visit snapshot with unknown series coverage.";
  if ((candidate.action === "reschedule" || candidate.action === "book") && !expected.date) return "A booking/schedule action requires an explicit target calendar date.";
  if (expected.timeKind === "exact" && (normalizeAuditTime(expected.time) === null || expected.windowEnd !== null)) return "Exact-time expectation is missing, invalid, or inconsistently includes a window end.";
  if (expected.timeKind === "window") {
    const start = normalizeAuditTime(expected.time), end = normalizeAuditTime(expected.windowEnd);
    if (!start || !end || start >= end) return "Arrival window is missing, malformed, or crosses midnight without an explicit date scope.";
  }
  if (expected.timeKind === "unspecified" && (expected.time !== null || expected.windowEnd !== null)) return "Time values with unspecified time semantics cannot be guessed.";
  if (expected.amountCents !== null && (!Number.isSafeInteger(expected.amountCents) || expected.amountCents <= 0)) return "Requested payment amount must be a positive integer number of cents.";
  if (expected.extras?.length === 0 && ["add", "remove"].includes(expected.extrasMode ?? "")) return "An add/remove request requires at least one exact extra.";
  return null;
}

function selectRecords(candidate: AuditCandidate, phone: string, records: AuditRecord[]): Selection {
  const expected = candidate.expected;
  const empty = (error: string | null): Selection => ({ group: null, records: [], visit: null, error });
  const byGroup = new Map<string, AuditRecord[]>();
  for (const record of records.filter(record => normalizeAuditPhone(record.customerPhone) === phone)) {
    const key = validId(record.bookingId) ? `booking:${record.bookingId}` : validId(record.jobId) && record.source === "leadflow_jobs" ? `job:${record.jobId}` : `unlinked:${record.key}`;
    byGroup.set(key, [...(byGroup.get(key) ?? []), record]);
  }
  let groups = Array.from(byGroup).map(([key, members]) => ({ key, records: members }));
  if (expected.bookingReference !== null) {
    // Reference is case-sensitive, and is NEVER looked up outside this verified customer.
    groups = groups.filter(group => group.records.some(record => record.publicBookingNumber?.trim() === expected.bookingReference!.trim()));
  } else {
    if (!expected.originalDate && !expected.date) return empty("No exact public reference or original/target visit date identifies the booking.");
    const original = expected.originalDate ? groups.filter(group => group.records.some(record => record.date === expected.originalDate)) : [];
    groups = original.length ? original : groups.filter(group => group.records.some(record => record.date === expected.date));
  }
  if (groups.length > 1) return empty("Multiple bookings/households fit the exact reference/date; no fuzzy or nearest-visit choice is permitted.");
  if (!groups.length) return empty(candidate.action === "book" ? null : "No existing visit is unambiguously identified by this customer's exact reference/date; absence is not cancellation proof.");
  const group = groups[0];
  const fail = (error: string): Selection => ({ group, records: group.records, visit: null, error });
  if (group.records.some(record => (record.source === "bookings" && !validId(record.bookingId)) || (record.source === "leadflow_jobs" && !validId(record.jobId)))) return fail("A selected record lacks its stable canonical booking or operational job identity.");
  const bookingIds = unique(group.records.map(record => record.bookingId).filter(validId));
  if (records.some(record => validId(record.bookingId) && bookingIds.includes(record.bookingId) && normalizeAuditPhone(record.customerPhone) !== phone)) return fail("A linked booking/job has a different or invalid customer phone; cross-customer linkage cannot be verified.");
  if (unique(group.records.map(record => record.key)).length !== group.records.length) return fail("Duplicate record keys make current snapshot provenance ambiguous.");
  const canonical = group.records.filter(record => record.source === "bookings");
  if (canonical.length > 1) return fail("Multiple canonical snapshots exist for the same booking identity.");
  const jobs = group.records.filter(record => record.source === "leadflow_jobs" && text(record.status) !== "rescheduled");
  if (group.records.some(record => record.date !== null && !isValidAuditDate(record.date))) return fail("A selected persisted record has a malformed calendar date.");
  const jobDates = unique(jobs.map(record => record.date));
  const seriesIds = unique(group.records.map(record => record.seriesId).filter((id): id is string => !!id));
  const seriesDates = unique(records.filter(record => normalizeAuditPhone(record.customerPhone) === phone && record.seriesId !== null && seriesIds.includes(record.seriesId)).map(record => record.date));
  const recurringCustomerDates = unique(records.filter(record => normalizeAuditPhone(record.customerPhone) === phone && recurring(record)).map(record => record.date));
  if (expected.scope === "unspecified" && group.records.some(recurring) && (jobDates.length > 1 || seriesDates.length > 1 || recurringCustomerDates.length > 1)) return fail("Recurring visits have multiple dates and unspecified scope; one visit cannot stand for the series.");
  let chosenJobs = jobs;
  if (jobDates.length > 1) {
    const original = expected.originalDate ? jobs.filter(record => record.date === expected.originalDate) : [];
    chosenJobs = original.length ? original : jobs.filter(record => record.date === expected.date);
    if (!chosenJobs.length) return fail("Multiple operational visit dates exist without an exact, unambiguous original/target-date match.");
  }
  if (chosenJobs.length > 1) return fail("Multiple operational jobs/households fit this visit; a specific job cannot be guessed.");
  const selected = [...canonical, ...chosenJobs];
  if (!selected.length) return fail("No current canonical booking or operational visit remains; rescheduled tombstones do not prove the new state.");
  let occurrenceOnly = false;
  const anchor = canonical[0], occurrence = chosenJobs[0];
  if (occurrence && (recurringCadence(occurrence) || (anchor && recurringCadence(anchor)))
    && expected.date !== null && occurrence.date !== expected.date && occurrence.date !== expected.originalDate) {
    return fail("The exact requested recurring occurrence is not identified; a different supplied visit cannot prove or contradict its schedule.");
  }
  if (anchor && occurrence && recurringCadence(anchor) && anchor.date !== occurrence.date) {
    const exactDate = expected.originalDate ?? expected.date;
    const anchorJobs = jobs.filter(record => record.date === anchor.date);
    // AuditRecord has no visit-purpose/history marker. A distinct, unique linked
    // anchor occurrence proves these are separate current visits; without it a
    // moved first visit and a later occurrence are indistinguishable here.
    if (expected.scope !== "visit" || occurrence.date !== exactDate || !isValidAuditDate(anchor.date)
      || anchorJobs.length !== 1 || !activeStatuses.has(text(anchorJobs[0].status) ?? "")
      || recurringCadence(occurrence) !== recurringCadence(anchor)
      || recurringCadence(anchorJobs[0]) !== recurringCadence(anchor)
      || occurrence.bookingId !== anchor.bookingId) {
      return fail("The exact first versus later recurring occurrence cannot be proven from this snapshot; canonical first-visit preferences are not a target-occurrence conflict.");
    }
    occurrenceOnly = true;
  }
  return { group, records: selected, visit: occurrence?.date ?? anchor?.date ?? null, error: null, occurrenceOnly };
}

function compareState(candidate: AuditCandidate, selection: Selection, timeZone: string): Check {
  const expected = candidate.expected;
  const selected = selection.records;
  const visitRecords = selection.occurrenceOnly ? selected.filter(record => record.source === "leadflow_jobs") : selected;
  const unknown = (reason: string): Check => ({ status: "cannot_verify", reason });
  const wrong = (reason: string): Check => ({ status: candidate.agreement === "requested" ? "needs_action" : "conflict", reason });
  const good = (reason: string): Check => ({ status: "matches", reason: candidate.agreement === "requested" ? `${reason} The current state matches this request; a sent confirmation and historical completion are not proven.` : reason });
  if (!selected.length) return candidate.action === "book" ? wrong("No matching persisted new booking exists in the supplied snapshot.") : unknown("No selected persisted visit can prove this state.");
  const problems: string[] = [], missing: string[] = [];
  const equalsField = (field: "address" | "serviceName" | "teamName", label: string) => {
    const wanted = text(expected[field]);
    if (!wanted) { missing.push(`No exact requested ${label} is specified.`); return; }
    for (const record of selected) {
      const actual = text(record[field]);
      if (!actual) missing.push(`${record.source} ${record.key} has no persisted ${label}.`);
      else if (actual !== wanted) problems.push(`${record.source} ${record.key} ${label} differs from the exact normalized request.`);
    }
  };
  const extras = () => {
    if (expected.extras === null) return;
    const mode = expected.extrasMode ?? "unspecified";
    if (mode === "unspecified") { missing.push("The requested extras operation is unclear; add/remove is not a full replacement."); return; }
    const wanted = expected.extras.map(normalizeAuditExtra);
    if (wanted.some(value => !value)) { missing.push("Requested extras have unknown labels or quantities; exact catalog identity cannot be proven."); return; }
    for (const record of selected) {
      if (!record.extras || record.extras.some(value => !text(value))) { missing.push(`${record.source} ${record.key} has no complete persisted extras list.`); continue; }
      const actual = record.extras.map(normalizeAuditExtra);
      if (mode !== "add" && actual.some(value => !value)) { missing.push(`${record.source} ${record.key} has unsupported extras that prevent proving absence or a full replacement.`); continue; }
      const mismatch = mode === "add" ? wanted.some(value => !actual.includes(value))
        : mode === "remove" ? wanted.some(value => actual.includes(value))
        : JSON.stringify(actual.slice().sort()) !== JSON.stringify(wanted.slice().sort());
      if (mismatch) problems.push(`${record.source} ${record.key} extras do not satisfy the exact requested ${mode} operation.`);
    }
  };
  if (expected.date !== null) {
    for (const record of visitRecords) {
      if (!isValidAuditDate(record.date)) missing.push(`${record.source} ${record.key} has no valid persisted visit date.`);
      else if (record.date !== expected.date) problems.push(`${record.source} ${record.key} persisted date differs from the requested target date.`);
    }
  }
  if (candidate.action === "payment") {
    if (expected.amountCents === null) return unknown("Persisted paid/captured status alone cannot prove the unspecified requested amount.");
    const authoritativePayments = selected.filter(record => record.paymentStatus !== null && text(record.paymentStatus));
    if (!authoritativePayments.length) return unknown("No authoritative persisted paymentStatus is available; card-on-file, quoted price, or a sent link is not payment proof.");
    for (const record of authoritativePayments) {
      if (!["paid", "captured"].includes(text(record.paymentStatus)!)) problems.push(`${record.source} ${record.key} persisted paymentStatus is not paid/captured; authorization/card/link is not capture.`);
      else if (record.paidAmountCents === null || !Number.isSafeInteger(record.paidAmountCents) || record.paidAmountCents < 0) missing.push(`${record.source} ${record.key} lacks a proven persisted paid amount.`);
      else if (record.paidAmountCents !== expected.amountCents) problems.push(`${record.source} ${record.key} persisted paid amount differs from the requested cents.`);
    }
  } else if (candidate.action === "cancel") {
    for (const record of selected) {
      if (!text(record.status)) missing.push(`${record.source} ${record.key} has unknown cancellation state.`);
      else if (!cancelled(record)) problems.push(`${record.source} ${record.key} is not cancelled in the current snapshot.`);
    }
  } else {
    for (const record of selected) {
      const status = text(record.status);
      // needs_attention also describes a legitimately booked unpaid invoice.
      // For schedule actions only, an active linked job proves activity; payment
      // attention is not schedule disapproval. Cancelled/expired remain contrary.
      if ((candidate.action === "book" || candidate.action === "reschedule") && record.source === "bookings"
        && status === "needs_attention") {
        if (!selected.some(other => other.source === "leadflow_jobs" && activeStatuses.has(text(other.status) ?? ""))) missing.push(`${record.source} ${record.key} attention state has no active linked job proving the schedule.`);
        continue;
      }
      if (status === "expired") { problems.push(`${record.source} ${record.key} is expired rather than active.`); continue; }
      if (!status || (!activeStatuses.has(status) && !pendingStatuses.has(status) && !cancelled(record))) missing.push(`${record.source} ${record.key} has an unrecognized current booking state.`);
      else if (!activeStatuses.has(status)) problems.push(`${record.source} ${record.key} is cancelled or awaiting booking approval rather than active.`);
    }
    if (candidate.action === "book" || candidate.action === "reschedule") {
      // Uniform rule: 09:00 uses the very same comparisons as every other time.
      if (!selected.some(record => record.source === "leadflow_jobs")) missing.push("Only canonical booking preferences exist; no linked operational job proves the actual scheduled visit.");
      for (const record of visitRecords) {
        if (expected.timeKind !== "unspecified") {
          if (!record.timeZone || !validTimeZone(record.timeZone) || record.timeZone !== timeZone) { missing.push(`${record.source} ${record.key} local time timezone is unknown or differs from the business timezone.`); continue; }
          const actual = normalizeAuditTime(record.time);
          if (!actual) missing.push(`${record.source} ${record.key} has no valid exact scheduled local time.`);
          else if (expected.timeKind === "exact" && actual !== normalizeAuditTime(expected.time)) problems.push(`${record.source} ${record.key} scheduled time differs from the exact request.`);
          else if (expected.timeKind === "window" && (actual < normalizeAuditTime(expected.time)! || actual > normalizeAuditTime(expected.windowEnd)!)) problems.push(`${record.source} ${record.key} scheduled time is outside the requested arrival window.`);
        }
      }
      if (expected.address !== null) equalsField("address", "address");
      if (expected.serviceName !== null) equalsField("serviceName", "service");
      extras();
      if (expected.teamName !== null) {
        if (!text(expected.teamName)?.includes(" ")) missing.push("A first-name/single-token assignment cannot prove a complete exact team designation.");
        else equalsField("teamName", "team");
      }
    } else if (candidate.action === "address") equalsField("address", "address");
    else if (candidate.action === "service") {
      if (expected.serviceName === null && expected.extras === null) missing.push("No exact requested service or extras are specified.");
      if (expected.serviceName !== null) equalsField("serviceName", "service");
      extras();
    } else if (candidate.action === "assignment") {
      if (!text(expected.teamName)?.includes(" ")) missing.push("A first-name/single-token assignment cannot prove a complete exact team designation.");
      else equalsField("teamName", "team");
      if (!selected.some(record => record.source === "leadflow_jobs")) missing.push("No linked operational job proves the actual team assignment.");
    } else missing.push("Unsupported action type cannot be verified.");
  }
  if (problems.length) return wrong(problems.join(" ") + (missing.length ? ` Additional gaps: ${missing.join(" ")}` : ""));
  if (missing.length) return unknown(missing.join(" "));
  return good("All specified fields match the selected persisted booking/operational snapshot." + (selection.occurrenceOnly ? " Date/time are verified against this exact operational occurrence, not canonical first-visit preferences; no subsequent-series shift is proven." : ""));
}

function laterCorrection(candidate: AuditCandidate, evidence: EvidenceCheck, selection: Selection, input: VerifyAuditCandidatesInput): boolean {
  if (!candidate.supersededByMessageKey || !evidence.anchor || !selection.group || selection.error) return false;
  const later = input.candidates.filter(other => other !== candidate && other.anchorMessageKey === candidate.supersededByMessageKey && other.action === candidate.action);
  if (later.length !== 1 || ["declined", "unclear"].includes(later[0].agreement) || expectationError(later[0])) return false;
  if (input.candidates.filter(other => other.id === later[0].id).length !== 1) return false;
  const proof = evidenceFor(later[0], input);
  if (proof.error || !proof.anchor || proof.phone !== evidence.phone || proof.thread?.key !== evidence.thread?.key) return false;
  if (instant(proof.anchor.occurredAt)! <= instant(evidence.anchor.occurredAt)!) return false;
  const otherSelection = selectRecords(later[0], proof.phone!, input.records);
  if (otherSelection.error || otherSelection.group?.key !== selection.group.key || otherSelection.visit !== selection.visit) return false;
  const a = candidate.expected, b = later[0].expected;
  // Only this action's meaningful fields can establish a correction. In
  // particular a stray time/address on a cancel/payment must not suppress it.
  const scheduleChanged = a.date !== b.date || normalizeAuditTime(a.time) !== normalizeAuditTime(b.time)
    || a.timeKind !== b.timeKind || normalizeAuditTime(a.windowEnd) !== normalizeAuditTime(b.windowEnd);
  const serviceChanged = text(a.serviceName) !== text(b.serviceName)
    || JSON.stringify(a.extras?.map(normalizeAuditExtra).sort()) !== JSON.stringify(b.extras?.map(normalizeAuditExtra).sort())
    || a.extrasMode !== b.extrasMode;
  const changed = candidate.action === "reschedule" ? scheduleChanged
    : candidate.action === "book" ? scheduleChanged || serviceChanged || text(a.address) !== text(b.address) || text(a.teamName) !== text(b.teamName)
    : candidate.action === "address" ? text(a.address) !== text(b.address)
    : candidate.action === "service" ? serviceChanged
    : candidate.action === "assignment" ? text(a.teamName) !== text(b.teamName)
    : candidate.action === "payment" ? a.amountCents !== b.amountCents
    : false;
  if (!changed) return false;
  // Multi-visit corrections need a shared original visit, not merely a later SMS.
  if (a.originalDate || b.originalDate) return !!a.originalDate && a.originalDate === b.originalDate && a.scope === b.scope;
  return a.scope === b.scope && (a.date === b.date || (a.bookingReference !== null && a.bookingReference === b.bookingReference && unique(selection.group.records.filter(record => record.source === "leadflow_jobs").map(record => record.date)).length <= 1));
}

/**
 * Pure read-only verifier. The extractor's IDs, confidence, prose and supersession hints
 * are never persistence or identity proof. No history, capture, mutation or provider
 * action is performed. The caller owns snapshot completeness and extraction quality.
 */
export function verifyAuditCandidates(input: VerifyAuditCandidatesInput): AuditItem[] {
  const globalError = !isValidAuditDate(input.auditDate) ? "Audit date is malformed or impossible."
    : !validTimeZone(input.timeZone) ? "Business timezone is invalid."
    : instant(input.asOf) === null ? "Snapshot asOf must be a valid timestamp with an explicit offset."
    : null;
  return input.candidates.filter(candidate => !candidate.contextOnly).map(candidate => {
    const proof = evidenceFor(candidate, input);
    let selection: Selection = { group: null, records: [], visit: null, error: null };
    let check: Check;
    const error = globalError || proof.error || expectationError(candidate)
      || (input.candidates.filter(other => other.id === candidate.id).length !== 1 ? "Candidate IDs are duplicated; an arbitrary ID cannot suppress a finding." : null);
    if (error) check = { status: "cannot_verify", reason: error };
    else if (candidate.agreement === "declined" || candidate.agreement === "unclear") check = { status: "cannot_verify", reason: "Declined/unclear conversation is not an agreed instruction or a matching confirmation." };
    else {
      selection = selectRecords(candidate, proof.phone!, input.records);
      if (selection.error) check = { status: "cannot_verify", reason: selection.error };
      else if (laterCorrection(candidate, proof, selection, input)) check = { status: "superseded", reason: "A strictly later, validated same-customer action candidate corrects this same identified booking/visit and action." };
      else check = compareState(candidate, selection, input.timeZone);
    }
    const links: AuditItem["recordLinks"] = [];
    if (selection.records.some(record => record.source === "bookings")) links.push({ label: "Bookings", href: "/admin/bookings" });
    if (selection.records.some(record => record.source === "leadflow_jobs")) links.push({ label: "Schedule", href: "/admin/schedule" });
    return {
      id: candidate.id, action: candidate.action, agreement: candidate.agreement,
      status: check.status, customerPhone: proof.phone ?? "", customerName: proof.thread?.customerName ?? null,
      affectedDate: isValidAuditDate(candidate.expected.date) ? candidate.expected.date : isValidAuditDate(candidate.expected.originalDate) ? candidate.expected.originalDate : selection.visit,
      expected: copyExpectation(candidate.expected), explanation: candidate.explanation,
      verification: `${check.reason} Verification is limited to the supplied current snapshot as of ${input.asOf}; it does not prove historical changes, charge events, or message meaning beyond the cited source evidence.`,
      evidence: proof.evidence.map(message => ({ ...message })),
      records: selection.records.filter(record => normalizeAuditPhone(record.customerPhone) === proof.phone).map(copyRecord),
      recordLinks: links, verifiedAt: input.asOf,
    };
  });
}
