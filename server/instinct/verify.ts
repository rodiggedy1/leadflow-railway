import {
  authorizedScopeSchema, extractionActionSchema, nativeSnapshotSchema, occurrenceResolutionSchema,
  sourceContextSchema, targetOccurrenceSchema, validateCitation, validateIdentityScope,
  verifiedIdentitySchema, verificationResultSchema, sameEvidenceRef,
  type AuthorizedScope, type Clock, type Expectation, type ExtractionAction, type IdentityResolver,
  type NativeRecord, type NativeRecordReader, type NativeSnapshot, type OccurrenceResolution,
  type SourceContext, type TargetOccurrence, type VerificationResult, type VerifiedIdentity,
} from "../../shared/instinct";
import { localOccurrenceInstants, resolveOccurrence } from "./identity";
import { composeCanonicalCleanerNotes } from "./nativeRecords";
import { safeReadDbError } from "./readDb";

/** Inputs are server-validated extraction/identity receipts, never client bodies or
 * record keys. A retained target must come from this issue's earlier resolution.
 * No current snapshot is accepted or cached by the asynchronous verifier. */
export interface VerificationOptions {
  readonly nativeRecords: NativeRecordReader;
  readonly identity?: Pick<IdentityResolver, "occurrence">;
  readonly clock?: Clock;
  readonly authorizeScope?: (scope: AuthorizedScope) => boolean | Promise<boolean>;
}
export interface VerificationCheckOptions {
  readonly target?: TargetOccurrence;
  /** Optional defense-in-depth exact original revalidation by the service. */
  readonly context?: SourceContext;
}
export interface RequestVerifier {
  readonly verify: (scope: AuthorizedScope, identity: VerifiedIdentity, action: ExtractionAction, options?: VerificationCheckOptions) => Promise<VerificationResult>;
}
export const INSTINCT_VERIFICATION_VERSION = "instinct-fresh-native-v1";
const currentOnly = "Current stored state only: this does not prove who changed it, when a change occurred, customer notification, provider delivery, or cleaner receipt/acknowledgment.";
const activeStates = new Set(["confirmed", "booked", "scheduled", "assigned", "unassigned", "in_progress"]);
const canceledStates = new Set(["cancelled", "canceled"]);
const inactiveStates = new Set(["expired", "rescheduled", "missing_from_launch27", "completed"]);
const pendingStates = new Set(["pending", "pending_card", "needs_attention", "requested", "draft", "hold", "on_hold", "intent_pending"]);
// Exact identity projection of shared/bookingWidgetConfig.ts:46–55 only; no
// pricing functions or mutable intake/widget helpers enter this read-only graph.
const extraIdentities = [
  ["inside-cabinets", "Inside cabinets"], ["inside-fridge", "Inside fridge"],
  ["inside-oven", "Inside oven"], ["interior-windows", "Interior windows"],
  ["basement", "Basement"], ["organizing-hour", "One hour of organizing"],
  ["laundry-load", "Laundry"], ["wipe-walls-room", "Wipe walls"], ["sweep-garage", "Sweep garage"],
] as const;
function unique(values: readonly string[]): string[] { return [...Array.from(new Set(values))]; }
/** Deliberately no NFKC, punctuation/number removal, synonym or fuzzy matching. */
export function normalizeInstructionText(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(new RegExp("\\s+", "gu"), " ").toLowerCase();
  return normalized || null;
}
function instructionAssessment(actual: string | null, expected: string): "present" | "absent" | "uncertain" {
  const needle = normalizeInstructionText(expected), haystack = normalizeInstructionText(actual);
  if (!needle || !haystack || !literalInstructionContains(haystack, needle)) return "absent";
  const negation = new RegExp("\\b(?:not|never|no longer|obsolete|invalid|incorrect|wrong|old|don't|dont)\\b", "u");
  let present = false, uncertain = false;
  // Evaluate complete clauses so a negated/obsolete code or trailing prohibition
  // cannot become a positive substring match. No synonym inference is attempted.
  let offset = haystack.indexOf(needle);
  while (offset >= 0) {
    const prefix = haystack.slice(0, offset), suffix = haystack.slice(offset + needle.length);
    const start = Math.max(prefix.lastIndexOf(";"), prefix.lastIndexOf("."), prefix.lastIndexOf("!"), prefix.lastIndexOf("?")) + 1;
    const tail = suffix.search(new RegExp("[;.!?]", "u"));
    const clause = haystack.slice(start, tail < 0 ? haystack.length : offset + needle.length + tail);
    if (negation.test(clause.replace(needle, ""))) uncertain = true;
    else present = true;
    offset = haystack.indexOf(needle, offset + 1);
  }
  return uncertain ? "uncertain" : present ? "present" : "absent";
}
/** Substring presence with lexical boundaries: 2841 never matches 12841 or 28410.
 * Material punctuation, leading zeros, hyphens and all instruction words survive. */
export function instructionContains(actual: string | null, expected: string): boolean {
  return instructionAssessment(actual, expected) === "present";
}
function literalInstructionContains(actual: string | null, expected: string): boolean {
  const haystack = normalizeInstructionText(actual), needle = normalizeInstructionText(expected);
  if (!haystack || !needle) return false;
  let offset = haystack.indexOf(needle);
  const word = (char: string) => new RegExp("[\\p{L}\\p{N}_]", "u").test(char);
  while (offset >= 0) {
    const before = offset > 0 ? haystack[offset - 1] : "", after = haystack[offset + needle.length] ?? "";
    if (!(before && word(before) && word(needle[0])) && !(after && word(after) && word(needle.at(-1)!))) return true;
    offset = haystack.indexOf(needle, offset + 1);
  }
  return false;
}
function emptyTarget(scope: TargetOccurrence["scope"]): TargetOccurrence {
  return { bookingId: null, jobId: null, launch27BookingId: null, bookingSeriesId: null, publicBookingNumber: null,
    scope, localDate: null, localTime: null, arrivalWindow: null, timeZone: null, occurredAtUtc: null };
}
function status(record: NativeRecord): string | null { return normalizeInstructionText(record.status); }
function active(record: NativeRecord): boolean { return activeStates.has(status(record) ?? ""); }
function scopeCheck(scope: AuthorizedScope, identity: VerifiedIdentity, action: ExtractionAction): void {
  if (identity.installationScope !== scope.installationScope || identity.sourceAccountKey !== scope.sourceAccountKey
    || identity.evidenceRefs.some(ref => ref.sourceAccountKey !== scope.sourceAccountKey)
    || action.anchorRef.sourceAccountKey !== scope.sourceAccountKey
    || !identity.evidenceRefs.some(ref => sameEvidenceRef(ref, action.anchorRef))
    || !action.citations.some(citation => sameEvidenceRef(citation.ref, action.anchorRef))
    || action.citations.some(citation => !identity.evidenceRefs.some(ref => sameEvidenceRef(ref, citation.ref))
      || citation.ref.contextFingerprint !== action.anchorRef.contextFingerprint)) throw new Error("INVALID_SOURCE_REFERENCE");
}
function result(identity: VerifiedIdentity, target: TargetOccurrence, snapshot: NativeSnapshot | null, now: string,
  outcome: VerificationResult["outcome"], explanation: string, limitations: readonly string[] = [], priorityReason: string | null = null): VerificationResult {
  return verificationResultSchema.parse({ outcome, identity, target, snapshot,
    explanation: `${explanation} ${currentOnly}`, limitations: unique(limitations), priorityReason,
    recordFingerprint: snapshot?.fingerprint ?? null, checkedAtUtc: snapshot?.checkedAtUtc ?? now,
    fulfillment: outcome === "matches_current" ? "verified_current" : "not_verified", notification: "unknown", delivery: "unknown" });
}
function exactRecord(snapshot: NativeSnapshot, target: TargetOccurrence): NativeRecord | undefined {
  const key = target.jobId ? `leadflow:job:${target.jobId}` : target.bookingId ? `booking:${target.bookingId}` : null;
  return snapshot.records.find(record => record.key === key);
}
function boundExpected(action: ExtractionAction, target: TargetOccurrence, snapshot: NativeSnapshot): Expectation {
  const current = exactRecord(snapshot, target);
  // Replacement state is never an occurrence selector. A stable issue-bound row
  // can still be reverified after its date/time has actually changed.
  return { ...action.expected, bookingReference: target.jobId ? `leadflow:job:${target.jobId}` : `booking:${target.bookingId}`,
    originalDate: target.scope === "subsequent" ? current?.localDate ?? action.expected.originalDate : null,
    scope: target.scope };
}
function targetLinksAgree(target: TargetOccurrence, snapshot: NativeSnapshot): boolean {
  const row = exactRecord(snapshot, target);
  if (!row || row.bookingId !== target.bookingId || row.jobId !== target.jobId || row.launch27BookingId !== target.launch27BookingId) return false;
  if (target.bookingSeriesId && row.source === "leadflow_jobs" && row.bookingSeriesId !== target.bookingSeriesId) return false;
  const canonical = snapshot.records.find(record => record.key === `booking:${target.bookingId}`);
  if (target.publicBookingNumber && (row.publicBookingNumber ?? canonical?.publicBookingNumber) !== target.publicBookingNumber) return false;
  if (target.bookingSeriesId && !snapshot.records.some(record => record.key === `series:${target.bookingSeriesId}` && record.bookingId === target.bookingId)) return false;
  if (target.scope === "subsequent" && row.localDate !== target.localDate) return false;
  return true;
}
function selectionExpectation(action: ExtractionAction): Expectation {
  // For cancellation/instructions the stated date is the affected occurrence,
  // not a replacement schedule. Never let a single unrelated visit satisfy it.
  return !["book", "reschedule", "arrival_window"].includes(action.action) && action.expected.date && !action.expected.originalDate
    ? { ...action.expected, originalDate: action.expected.date } : action.expected;
}
interface Comparison {
  readonly mismatch: string[]; readonly missing: string[]; readonly review: string[];
  readonly mismatchedKeys: Set<string>;
}
function compare(action: ExtractionAction, resolution: OccurrenceResolution): Comparison {
  const expected = action.expected, snapshot = resolution.snapshot, target = resolution.target;
  const mismatch: string[] = [], missing: string[] = [], review: string[] = [], mismatchedKeys = new Set<string>();
  const wrong = (row: NativeRecord, message: string) => { mismatch.push(`${row.key}: ${message}`); mismatchedKeys.add(row.key); };
  const gap = (row: NativeRecord, message: string) => missing.push(`${row.key}: ${message}`);
  const selected = snapshot.records.filter(row => resolution.eligibleRecordKeys.includes(row.key));
  const canonical = selected.find(row => row.source === "bookings");
  const jobs = selected.filter(row => row.source === "leadflow_jobs");
  const exact = exactRecord(snapshot, target);
  if (!exact) { missing.push("EXACT_TARGET_UNAVAILABLE"); return { mismatch, missing, review, mismatchedKeys }; }
  const recurringScope = target.scope === "series" || target.scope === "subsequent";
  const visitRows = recurringScope ? jobs : [exact];
  // First-visit preferences are not later recurring visit values. A non-recurring
  // linked first visit has two authoritative counterparts; both must agree.
  const stateRows = !recurringScope && exact.source === "leadflow_jobs" && canonical && !target.bookingSeriesId
    ? [canonical, exact] : visitRows;
  if (!visitRows.length) missing.push("ACTUAL_RECURRING_VISITS_UNAVAILABLE");
  if (["book", "reschedule", "arrival_window"].includes(action.action) && !jobs.length) {
    missing.push("OPERATIONAL_VISIT_UNAVAILABLE: canonical preferences alone do not prove an actual scheduled visit; future-date stored coverage may be unsynced. No sync was requested or performed.");
  }
  if (action.action === "payment") {
    missing.push("PAYMENT_PROOF_UNAVAILABLE: native projection has no authoritative paid/captured amount; booking status, a card, price or sent link is not payment proof.");
    return { mismatch, missing, review, mismatchedKeys };
  }
  const statusRows = [...stateRows];
  if (action.action !== "cancel" && target.scope === "series") statusRows.push(...selected.filter(row => row.source === "bookings" || row.source === "booking_series"));
  if (action.action === "cancel" && target.scope === "series") {
    const series = selected.find(row => row.source === "booking_series");
    if (!series || !canonical) missing.push("CANCELLATION_COUNTERPART_UNAVAILABLE");
    else statusRows.push(canonical, series);
  }
  for (const row of statusRows) {
    const value = status(row);
    if (!value) { gap(row, "current status unavailable"); continue; }
    if (action.action === "cancel") {
      if (canceledStates.has(value)) continue;
      if (activeStates.has(value) || pendingStates.has(value) || value === "active") wrong(row, `requested cancellation; current status is ${row.status}`);
      else if (inactiveStates.has(value)) review.push(`${row.key}: ${row.status} is not proof of this requested cancellation`);
      else gap(row, "unrecognized cancellation status");
    } else if (row.source === "bookings" && value === "needs_attention" && jobs.some(active)) {
      // Existing unpaid-invoice attention is not schedule disapproval when an
      // independently linked active operational visit establishes activity.
    } else if (row.source === "booking_series" && value === "active") {
      // Actual native series uses its own active status, not visit assignment.
    } else if (!active(row)) {
      if (canceledStates.has(value) || value === "expired" || pendingStates.has(value)) wrong(row, `requested active state; current status is ${row.status}`);
      else if (inactiveStates.has(value)) review.push(`${row.key}: terminal/tombstone state cannot prove a current active occurrence`);
      else gap(row, "unrecognized active status");
    }
  }
  if (action.action === "cancel") return { mismatch, missing, review, mismatchedKeys };
  const schedule = ["book", "reschedule", "arrival_window"].includes(action.action);
  if ((action.action === "book" || action.action === "reschedule") && !expected.date && expected.timeKind === "unspecified") review.push("REQUESTED_SCHEDULE_UNSPECIFIED");
  if (action.action === "book" && !expected.date) review.push("REQUESTED_BOOKING_DATE_UNSPECIFIED");
  if (action.action === "arrival_window" && expected.timeKind !== "window") review.push("REQUESTED_ARRIVAL_WINDOW_UNSPECIFIED");
  if (schedule && expected.date !== null && recurringScope) {
    // A single replacement calendar date does not specify every retained visit's
    // transition. Do not fabricate a cadence projection or assign one date to all.
    review.push("RECURRING_DATE_TRANSITION_UNAVAILABLE: a single requested date does not prove every subsequent/series occurrence's intended replacement date.");
  }
  const scheduleRows = recurringScope ? [...jobs, ...(target.scope === "series" ? selected.filter(row => row.source === "bookings" || row.source === "booking_series") : [])] : stateRows;
  if (schedule) for (const row of scheduleRows) {
    if (expected.date !== null && !recurringScope) {
      if (!row.localDate) gap(row, "current calendar date unavailable");
      else if (row.localDate !== expected.date) wrong(row, `requested date ${expected.date}; current date ${row.localDate}`);
    }
    if (expected.timeKind !== "unspecified") {
      if (!expected.timeZone) { review.push("REQUESTED_TIMEZONE_UNSPECIFIED"); continue; }
      if (!row.timeZone || row.timeZone !== expected.timeZone) { gap(row, "business timezone missing or conflicting"); continue; }
      const date = expected.date ?? row.localDate;
      if (!date || localOccurrenceInstants(date, expected.time!, expected.timeZone).length !== 1
        || (expected.timeKind === "window" && localOccurrenceInstants(date, expected.windowEnd!, expected.timeZone).length !== 1)) {
        review.push("REQUESTED_LOCAL_TIME_DST_UNCERTAIN"); continue;
      }
      if (expected.timeKind === "exact") {
        if (row.arrivalWindow) wrong(row, `requested exact ${expected.time}; current arrival window ${row.arrivalWindow.start}–${row.arrivalWindow.end} is not an exact appointment`);
        else if (!row.localTime) gap(row, "current exact local time unavailable");
        else if (row.localTime !== expected.time) wrong(row, `requested exact time ${expected.time}; current time ${row.localTime}`);
      } else {
        if (!row.arrivalWindow) {
          if (row.localTime) wrong(row, `requested arrival window ${expected.time}–${expected.windowEnd}; current exact ${row.localTime} does not prove that window`);
          else gap(row, "current arrival-window endpoints unavailable");
        } else if (row.arrivalWindow.start !== expected.time || row.arrivalWindow.end !== expected.windowEnd) wrong(row, `requested window ${expected.time}–${expected.windowEnd}; current window ${row.arrivalWindow.start}–${row.arrivalWindow.end}`);
      }
    }
  }
  const field = (name: "address" | "serviceName" | "teamName", required: boolean) => {
    const wanted = normalizeInstructionText(expected[name]);
    if (!wanted) { if (required) review.push(`REQUESTED_${name.toUpperCase()}_UNSPECIFIED`); return; }
    for (const row of stateRows) {
      const actual = normalizeInstructionText(row[name]);
      if (!actual) gap(row, `current ${name} unavailable`);
      else if (actual !== wanted) wrong(row, `requested ${name} ${expected[name]}; current ${row[name]}`);
    }
  };
  if (action.action === "address" || (schedule && expected.address !== null)) field("address", action.action === "address");
  if (action.action === "service" || (schedule && expected.serviceName !== null)) field("serviceName", action.action === "service" && expected.extras === null);
  if (action.action === "assignment" || (schedule && expected.teamName !== null)) {
    if (!expected.teamName || !normalizeInstructionText(expected.teamName)?.includes(" ")) review.push("EXACT_TEAM_DESIGNATION_UNSPECIFIED");
    if (!jobs.length) missing.push("OPERATIONAL_ASSIGNMENT_UNAVAILABLE");
    // Team assignments are operational fields, not canonical preferences.
    for (const row of jobs) {
      const actual = normalizeInstructionText(row.teamName), wanted = normalizeInstructionText(expected.teamName);
      if (!actual) gap(row, "current assigned team unavailable");
      else if (wanted && actual !== wanted) wrong(row, `requested team ${expected.teamName}; current ${row.teamName}`);
    }
  }
  if (action.action === "extras" || action.action === "service" || schedule) {
    if (expected.extras === null) { if (action.action === "extras") review.push("REQUESTED_EXTRAS_UNSPECIFIED"); }
    else if (expected.extrasMode === "unspecified" || (!expected.extras.length && expected.extrasMode !== "replace")) review.push("REQUESTED_EXTRAS_OPERATION_UNSPECIFIED");
    else for (const row of stateRows) {
      if (row.extras === null) { gap(row, "current extras unavailable"); continue; }
      const extraId = (value: string) => {
        const normalized = normalizeInstructionText(value);
        return extraIdentities.find(([id, label]) => normalizeInstructionText(id) === normalized || normalizeInstructionText(label) === normalized)?.[0] ?? null;
      };
      const wanted = expected.extras.map(extraId);
      const actual = row.extras.filter(extra => extra.quantity === null || extra.quantity > 0);
      const matches = (extra: typeof actual[number], value: string | null) => extraId(extra.id) === value || extraId(extra.label) === value;
      if (wanted.some(value => !value) || new Set(wanted).size !== wanted.length) { review.push("EXTRAS_IDENTITY_UNCERTAIN"); continue; }
      if (expected.extrasMode !== "add" && actual.some(extra => !extraId(extra.id) && !extraId(extra.label))) { gap(row, "unsupported persisted extras prevent proving absence or complete replacement"); continue; }
      if (actual.some(extra => { const byId = extraId(extra.id), byLabel = extraId(extra.label); return byId && byLabel && byId !== byLabel; })) { gap(row, "persisted extra ID/label conflict"); continue; }
      const present = wanted.map(value => actual.filter(extra => matches(extra, value)));
      if (present.some(rows => rows.length > 1) || (expected.extrasMode === "replace" && new Set(actual.map(extra => extra.id)).size !== actual.length)) { gap(row, "duplicate extras identity prevents complete comparison"); continue; }
      const differs = expected.extrasMode === "add" ? present.some(rows => !rows.length)
        : expected.extrasMode === "remove" ? present.some(rows => rows.length > 0)
        : present.some(rows => !rows.length) || actual.some(extra => !wanted.some(value => matches(extra, value))) || actual.length !== wanted.length;
      if (differs) wrong(row, `current extras do not satisfy the exact ${expected.extrasMode} request ${expected.extras.join(", ")}`);
    }
  }
  if (action.action === "access_notes" || action.action === "notes") {
    if (!normalizeInstructionText(expected.notes)) review.push("REQUESTED_NOTES_UNSPECIFIED");
    if (expected.notesDestination === "unspecified") review.push("NOTES_DESTINATION_UNSPECIFIED");
    if (expected.notesDestination === "cleaner_instructions" && !jobs.length) missing.push("CLEANER_VISIT_INSTRUCTIONS_UNAVAILABLE: canonical notes alone do not establish the actual operational visit's cleaner-facing response.");
    for (const row of visitRows) {
      let actual: string | null = null;
      if (expected.notesDestination === "cleaner_instructions") {
        if (row.notesBasis === "canonical_composition") {
          const source = row.source === "bookings" ? row : snapshot.records.find(record => record.key === `booking:${row.bookingId}`);
          if (!source || source.specialRequestNotes === null || source.notesBasis !== "canonical_composition"
            || row.cleanerFacingNotes !== composeCanonicalCleanerNotes(source.specialRequestNotes, source.companyNotes)) { gap(row, "exact canonical cleaner projection unavailable/conflicting"); continue; }
        } else if (row.notesBasis === "operational_customer_notes" && row.source === "leadflow_jobs" && row.bookingId === null) {
          if (row.cleanerFacingNotes !== row.customerNotes) { gap(row, "exact operational cleaner projection conflicts with stored customer notes"); continue; }
        } else { gap(row, "cleaner instruction destination unavailable"); continue; }
        actual = row.cleanerFacingNotes;
      } else if (expected.notesDestination === "company_notes" || expected.notesDestination === "special_request_notes") {
        const source = row.source === "bookings" ? row : snapshot.records.find(record => record.key === `booking:${row.bookingId}`);
        if (!source || source.notesBasis !== "canonical_composition" || source.specialRequestNotes === null) { gap(row, "canonical notes destination unavailable; operational notes cannot substitute"); continue; }
        actual = expected.notesDestination === "company_notes" ? source.companyNotes : source.specialRequestNotes.join("\n");
      } else if (expected.notesDestination === "customer_notes") {
        if (row.source !== "leadflow_jobs") { gap(row, "operational customer-notes destination unavailable"); continue; }
        actual = row.customerNotes;
      }
      if (expected.notes && expected.notesDestination !== "unspecified") {
        const assessment = instructionAssessment(actual, expected.notes);
        if (assessment === "uncertain") review.push(`${row.key}: requested instruction occurs in a negated, obsolete or conflicting clause; exact wording presence alone cannot prove fulfillment`);
        else if (assessment === "absent") wrong(row, `requested ${expected.notesDestination} ${expected.notes}; current destination ${actual === null ? "empty" : JSON.stringify(actual)}`);
      }
    }
  }
  return { mismatch, missing, review, mismatchedKeys };
}
function recordInstant(row: NativeRecord): string | null {
  const clock = row.localTime ?? row.arrivalWindow?.start;
  if (!row.localDate || !clock || !row.timeZone) return null;
  const values = localOccurrenceInstants(row.localDate, clock, row.timeZone);
  let explicit: string | null = null;
  try {
    explicit = row.serviceDateTime && /(?:Z|[+-]\d{2}:\d{2})$/.test(row.serviceDateTime) ? new Date(row.serviceDateTime).toISOString()
      : row.requestedStartAt && Number.isSafeInteger(Number(row.requestedStartAt)) ? new Date(Number(row.requestedStartAt)).toISOString() : null;
  } catch { return null; }
  return explicit && values.includes(explicit) ? explicit : !explicit && values.length === 1 ? values[0] : null;
}
/** Deterministic display policy, not model sentiment, notification or a scheduler. */
export function verificationPriorityReason(action: ExtractionAction, resolution: OccurrenceResolution, mismatchedKeys: ReadonlySet<string>, checkedAtUtc: string): string | null {
  if (resolution.decision !== "verified" || !["cancel", "reschedule", "access_notes"].includes(action.action)
    || (action.action === "access_notes" && action.expected.notesDestination !== "cleaner_instructions")) return null;
  const now = Date.parse(checkedAtUtc);
  for (const row of resolution.snapshot.records) {
    if (row.source !== "leadflow_jobs" || !mismatchedKeys.has(row.key) || !active(row)) continue;
    const occurrence = recordInstant(row);
    if (!occurrence || !row.timeZone) continue;
    const day = (utc: string) => new Intl.DateTimeFormat("en-CA", { timeZone: row.timeZone!, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(utc));
    if (day(occurrence) !== day(checkedAtUtc) && !(Date.parse(occurrence) >= now && Date.parse(occurrence) - now <= 86_400_000)) continue;
    return `${action.action === "access_notes" ? "Required access instructions are missing" : `Unresolved ${action.action} discrepancy`} for verified active visit ${row.key} at ${row.localDate} ${row.localTime ?? `${row.arrivalWindow?.start}–${row.arrivalWindow?.end}`} ${row.timeZone} (today/next 24 hours).`;
  }
  return null;
}

export function createRequestVerifier(options: VerificationOptions): RequestVerifier {
  const clock = options.clock ?? { now: () => new Date() };
  const occurrence = options.identity?.occurrence ?? (async (scope: AuthorizedScope, identity: VerifiedIdentity, expected: Expectation, snapshot: NativeSnapshot) => resolveOccurrence(scope, identity, expected, snapshot));
  return Object.freeze({
    async verify(scopeValue: AuthorizedScope, identityValue: VerifiedIdentity, actionValue: ExtractionAction, check: VerificationCheckOptions = {}): Promise<VerificationResult> {
      const scope = authorizedScopeSchema.parse(scopeValue), identity = verifiedIdentitySchema.parse(identityValue), action = extractionActionSchema.parse(actionValue);
      const now = clock.now().toISOString();
      scopeCheck(scope, identity, action);
      if (options.authorizeScope && !(await options.authorizeScope(scope))) throw new Error("INVALID_SCOPE");
      if (check.context) {
        const context = sourceContextSchema.parse(check.context);
        validateIdentityScope(identity, scope, context.evidence);
        if (context.manifest.contextId !== action.contextId || context.manifest.contextFingerprint !== action.anchorRef.contextFingerprint) throw new Error("STALE_CONTEXT");
        action.citations.forEach(citation => validateCitation(citation, scope, context.evidence));
      }
      const prior = check.target ? targetOccurrenceSchema.parse(check.target) : null;
      if (prior && (prior.scope !== action.expected.scope || (!prior.bookingId && !prior.jobId))) throw new Error("INVALID_SOURCE_REFERENCE");
      const empty = prior ?? emptyTarget(action.expected.scope);
      if (identity.decision !== "verified") return result(identity, empty, null, now, identity.decision === "ambiguous" ? "review" : "record_unavailable", "Customer identity is not independently verified.", identity.reasons);
      if (action.ambiguous || action.missingParameters.length || ["declined", "unclear"].includes(action.agreement)) return result(identity, empty, null, now, "review", "The request meaning, parameters or agreement require clarification; no current-state conclusion was made.", ["REQUEST_UNCERTAIN", ...action.missingParameters]);
      let snapshot: NativeSnapshot;
      try { snapshot = nativeSnapshotSchema.parse(prior ? await options.nativeRecords.readExact(scope, identity, prior) : await options.nativeRecords.readCandidates(scope, identity)); }
      catch (error) { return result(identity, empty, null, now, "record_unavailable", "A fresh native SELECT snapshot could not be obtained.", [safeReadDbError(error).reason]); }
      if (snapshot.sourceAccountKey !== scope.sourceAccountKey) throw new Error("INVALID_SCOPE");
      if (new Set(snapshot.records.map(row => row.key)).size !== snapshot.records.length) return result(identity, empty, snapshot, now, "record_unavailable", "Duplicate native rows prevent exact current-state proof.", ["DUPLICATE_NATIVE_KEYS"]);
      let resolution: OccurrenceResolution;
      try {
        if (prior && !targetLinksAgree(prior, snapshot)) return result(identity, empty, snapshot, now, "record_unavailable", "The retained issue target no longer has its exact native counterparts and links.", ["EXACT_TARGET_LINK_UNAVAILABLE"]);
        const selection = prior ? boundExpected(action, prior, snapshot) : selectionExpectation(action);
        resolution = occurrenceResolutionSchema.parse(await occurrence(scope, identity, selection, snapshot));
        // Even an injected resolver cannot supply an old/foreign snapshot as fresh proof.
        if (resolution.snapshot.snapshotId !== snapshot.snapshotId || resolution.snapshot.fingerprint !== snapshot.fingerprint || resolution.snapshot.checkedAtUtc !== snapshot.checkedAtUtc
          || JSON.stringify(resolution.snapshot) !== JSON.stringify(snapshot)) throw new Error("INVALID_RESOLUTION_SNAPSHOT");
        // Independent exact native resolver validates the injected decision/target.
        const independentlyResolved = resolveOccurrence(scope, identity, selection, snapshot);
        if (resolution.decision === "verified" && (independentlyResolved.decision !== "verified"
          || JSON.stringify(resolution.target) !== JSON.stringify(independentlyResolved.target)
          || JSON.stringify([...resolution.eligibleRecordKeys].sort()) !== JSON.stringify([...independentlyResolved.eligibleRecordKeys].sort()))) throw new Error("INVALID_OCCURRENCE_PROOF");
      } catch { return result(identity, empty, snapshot, now, "record_unavailable", "Exact fresh occurrence proof could not be established.", ["OCCURRENCE_PROOF_UNAVAILABLE"]); }
      if (resolution.decision !== "verified") return result(identity, resolution.target, snapshot, now, resolution.decision === "ambiguous" ? "review" : "record_unavailable", "The exact requested native occurrence is ambiguous or unavailable.", [...resolution.reasons, ...snapshot.limitations]);
      // readCandidates is already one fresh repeatable-read snapshot containing
      // the complete native link closure. No second snapshot creates a race between
      // target selection and comparison; readExact is used for retained issue IDs.
      const comparison = compare(action, resolution);
      if (comparison.review.length) return result(identity, resolution.target, snapshot, now, "review", "The requested state cannot be compared without clarification.", [...comparison.review, ...comparison.missing]);
      if (comparison.missing.length) return result(identity, resolution.target, snapshot, now, "record_unavailable", "Current native field/visit coverage is inadequate; no definite match or discrepancy was claimed.", comparison.missing);
      const outcome = comparison.mismatch.length ? "discrepancy" : "matches_current";
      const proof = comparison.mismatch.length ? comparison.mismatch.join("; ")
        : `Every specified requested field matches the exact ${resolution.target.scope} target${resolution.target.jobId ? ` leadflow:job:${resolution.target.jobId}` : ` booking:${resolution.target.bookingId}`}${action.action === "notes" || action.action === "access_notes" ? ` in ${action.expected.notesDestination}; presence only, not cleaner receipt` : ""}.`;
      return result(identity, resolution.target, snapshot, now, outcome,
        `${proof} Checked at ${snapshot.checkedAtUtc}; record fingerprint ${snapshot.fingerprint}.`, [],
        outcome === "discrepancy" ? verificationPriorityReason(action, resolution, comparison.mismatchedKeys, snapshot.checkedAtUtc) : null);
    },
  });
}
export const createInstinctVerifier = createRequestVerifier;
export function verifyRequest(scope: AuthorizedScope, identity: VerifiedIdentity, action: ExtractionAction, options: VerificationOptions, check?: VerificationCheckOptions): Promise<VerificationResult> {
  return createRequestVerifier(options).verify(scope, identity, action, check);
}
