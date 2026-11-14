import { createHash } from "node:crypto";
import {
  authorizedScopeSchema, expectationSchema, nativeSnapshotSchema, occurrenceResolutionSchema,
  sourceContextSchema, targetOccurrenceSchema, verifiedIdentitySchema,
  type AuthorizedScope, type Expectation, type IdentityResolver, type NativeRecord,
  type NativeSnapshot, type OccurrenceResolution, type SourceContext, type StoredEvidence,
  type TargetOccurrence, type VerifiedIdentity,
} from "../../shared/instinct";
import { normalizePhone } from "../utils/phone";
import { businessLocalDateTimeToUtcMs } from "../utils/businessTime";

/** Trusted server configuration only; never populate this from client endpoints.
 * An installation database is the native-record boundary, not a fictitious tenant FK.
 */
export interface IdentityAccountBindings {
  readonly sourceAccountKey: string;
  readonly businessLines: readonly string[];
  readonly mailboxes: readonly string[];
}
export interface IdentitySessionContact { readonly sessionId: string; readonly phone: string | null; readonly displayName?: string | null }
export interface IdentityResolverOptions {
  readonly getAccountBindings: (scope: AuthorizedScope) => IdentityAccountBindings | Promise<IdentityAccountBindings>;
  readonly readSessionContacts?: (scope: AuthorizedScope, sessionIds: readonly string[]) => Promise<readonly IdentitySessionContact[]>;
}

export function normalizeIdentityEmail(value: string | null | undefined): string | null {
  if (!value) return null;
  const email = value.trim().toLowerCase();
  // Same trim/lowercase policy as native booking; preserve plus tags and dots.
  return /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(email) ? email : null;
}
function hash(value: unknown): string { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
function unique<T>(values: readonly T[]): T[] { return [...Array.from(new Set(values))]; }
function baseIdentity(scope: AuthorizedScope, context: SourceContext): VerifiedIdentity {
  return { installationScope: scope.installationScope, sourceAccountKey: scope.sourceAccountKey,
    phone: null, email: null, sessionIds: unique(context.evidence.flatMap(item => item.ref.sessionId ? [item.ref.sessionId] : [])),
    customerPortalAccountId: null, decision: "unavailable", reasons: ["SOURCE_CONTACT_UNAVAILABLE"],
    evidenceRefs: context.evidence.map(item => item.ref), fingerprint: null, displayName: null };
}
function emptyTarget(scope: TargetOccurrence["scope"] = "unspecified"): TargetOccurrence {
  return { bookingId: null, jobId: null, launch27BookingId: null, bookingSeriesId: null, publicBookingNumber: null,
    scope, localDate: null, localTime: null, arrivalWindow: null, timeZone: null, occurredAtUtc: null };
}
function uncertain(identity: VerifiedIdentity, decision: "ambiguous" | "unavailable", reasons: readonly string[]): VerifiedIdentity {
  // A saved conversation label is display-only, not proof of a booking match.
  return verifiedIdentitySchema.parse({ ...identity, decision, reasons: unique(reasons), fingerprint: null });
}

/** Contact discovery for the initial SELECT, not yet a verified customer. Source
 * text, names, Reply-To and the latest session routing line are never contacts.
 * resolveSourceIdentity returns NATIVE_CONTACT_CORROBORATION_REQUIRED until the
 * fresh complete native snapshot and any actual session links are checked.
 */
export async function resolveSourceIdentity(scopeValue: AuthorizedScope, contextValue: SourceContext, options: IdentityResolverOptions): Promise<VerifiedIdentity> {
  const scope = authorizedScopeSchema.parse(scopeValue);
  const context = sourceContextSchema.parse(contextValue);
  const identity = baseIdentity(scope, context);
  if (context.manifest.sourceAccountKey !== scope.sourceAccountKey || context.evidence.some(item => item.ref.sourceAccountKey !== scope.sourceAccountKey)) {
    // Do not return foreign source refs even in an unavailable receipt.
    return uncertain({ ...identity, evidenceRefs: [], sessionIds: [] }, "unavailable", ["SOURCE_ACCOUNT_CONFLICT"]);
  }
  let bindings: IdentityAccountBindings;
  try { bindings = await options.getAccountBindings(scope); } catch { return uncertain(identity, "unavailable", ["ACCOUNT_BINDING_UNAVAILABLE"]); }
  if (bindings.sourceAccountKey !== scope.sourceAccountKey) return uncertain(identity, "unavailable", ["SOURCE_ACCOUNT_CONFLICT"]);
  const lines = unique(bindings.businessLines.map(normalizePhone).filter((value): value is string => value !== null));
  const mailboxes = unique(bindings.mailboxes.map(normalizeIdentityEmail).filter((value): value is string => value !== null));
  const phones: string[] = [], emails: string[] = [], sourceLines: string[] = [], sourceMailboxes: string[] = [], reasons: string[] = [];
  // Same authority as Command Chat/Live Text Monitor: the exact stored session's
  // leadPhone and leadName. Historical receiving-line metadata governs routing,
  // not who owns a source conversation. Never link an unbound provider SMS here.
  const smsSessionIds = unique(context.evidence.flatMap(item => item.ref.sourceKind === "sms" && item.ref.store === "conversation_sessions" && item.ref.sessionId ? [item.ref.sessionId] : []));
  const smsContacts = new Map<string, IdentitySessionContact>();
  if (smsSessionIds.length) {
    if (!options.readSessionContacts) return uncertain(identity, "unavailable", ["SESSION_CONTACT_BINDING_UNAVAILABLE"]);
    let sessions: readonly IdentitySessionContact[];
    try { sessions = await options.readSessionContacts(scope, smsSessionIds); } catch { return uncertain(identity, "unavailable", ["SESSION_CONTACT_BINDING_UNAVAILABLE"]); }
    if (sessions.some(session => !smsSessionIds.includes(session.sessionId)) || smsSessionIds.some(id => sessions.filter(session => session.sessionId === id).length !== 1)
      || sessions.some(session => !normalizePhone(session.phone))) return uncertain(identity, "unavailable", ["SESSION_CONTACT_BINDING_UNAVAILABLE"]);
    sessions.forEach(session => smsContacts.set(session.sessionId, session));
  }
  const sourceNames: string[] = [];
  let ambiguous = false;
  for (const item of context.evidence) {
    const p = item.participants;
    const savedSms = item.ref.sourceKind === "sms" && item.ref.store === "conversation_sessions" && item.ref.sessionId ? smsContacts.get(item.ref.sessionId) : undefined;
    if (savedSms) {
      const phone = normalizePhone(savedSms.phone)!;
      const from = normalizePhone(p.from), to = p.to.map(normalizePhone);
      if (p.cc.length || p.to.length > 1) { reasons.push("MULTIPARTY_PHONE_SOURCE"); ambiguous = true; continue; }
      if (item.direction !== "inbound" && item.direction !== "outbound") { reasons.push("PHONE_DIRECTION_OR_CONTACT_UNVERIFIED"); ambiguous = true; continue; }
      const customerConflict = item.direction === "inbound" ? p.from !== null && from !== phone : p.to.length === 1 && to[0] !== phone;
      const reversed = item.direction === "inbound" ? to.includes(phone) : from === phone;
      if (customerConflict || reversed || normalizePhone(p.businessLine) === phone || lines.includes(phone)
        || item.limitations.some(value => /customer\/session binding conflicts/i.test(value))) {
        reasons.push("SESSION_CONTACT_CONFLICT"); ambiguous = true; continue;
      }
      phones.push(phone);
      const name = savedSms.displayName?.trim(); if (name) sourceNames.push(name);
    } else if (item.ref.sourceKind === "email") {
      const mailbox = normalizeIdentityEmail(p.mailbox);
      if (!mailbox || !mailboxes.includes(mailbox)) { reasons.push("MAILBOX_UNVERIFIED"); continue; }
      sourceMailboxes.push(mailbox);
      if (p.cc.length || p.to.length !== 1 || /(?:forwarded message|begin forwarded message|^\s*(?:fwd?|fw):)/im.test(item.originalText ?? "")) {
        reasons.push("GROUP_OR_FORWARDED_EMAIL"); ambiguous = true; continue;
      }
      const from = normalizeIdentityEmail(p.from), to = normalizeIdentityEmail(p.to[0]);
      const replyTo = normalizeIdentityEmail(p.replyTo);
      if (replyTo && from && replyTo !== from) { reasons.push("REPLY_TO_CONFLICT"); ambiguous = true; continue; }
      if (item.direction === "inbound" && to === mailbox && from && !mailboxes.includes(from)) emails.push(from);
      else if (item.direction === "outbound" && from === mailbox && to && !mailboxes.includes(to)) emails.push(to);
      else { reasons.push("EMAIL_DIRECTION_OR_CONTACT_UNVERIFIED"); ambiguous = true; }
    } else {
      const line = normalizePhone(p.businessLine);
      if (!line || !lines.includes(line)) { reasons.push("BUSINESS_LINE_UNVERIFIED"); continue; }
      sourceLines.push(line);
      if (p.cc.length || p.to.length !== 1) { reasons.push("MULTIPARTY_PHONE_SOURCE"); ambiguous = true; continue; }
      const from = normalizePhone(p.from), to = normalizePhone(p.to[0]);
      if (item.ref.sourceKind === "phone_unverified" || (item.ref.sourceKind !== "sms" &&
        (!item.originalTurns.length || !item.originalTurns.some(turn => turn.role === "customer") || item.originalTurns.some(turn => turn.role === "unknown")))) {
        reasons.push("CUSTOMER_SPEAKER_UNVERIFIED"); continue;
      }
      if (item.direction === "inbound" && to === line && from && !lines.includes(from)) phones.push(from);
      else if (item.direction === "outbound" && from === line && to && !lines.includes(to)) phones.push(to);
      else { reasons.push("PHONE_DIRECTION_OR_CONTACT_UNVERIFIED"); ambiguous = true; }
    }
    if (item.availability === "missing" || item.availability === "malformed" || item.originalText === null) reasons.push("ORIGINAL_SOURCE_UNAVAILABLE");
    // Stored adapters must retain provenance conflicts as limitations. Partial
    // body coverage alone is not a fabricated identity conflict.
    if (item.limitations.some(value => /conflict|speaker|participant|forward|identity|session.*(?:missing|unverified)/i.test(value))) {
      reasons.push("SOURCE_PROVENANCE_UNVERIFIED"); ambiguous = true;
    }
  }
  if (unique(sourceLines).length > 1 || unique(sourceMailboxes).length > 1) { reasons.push("MULTIPLE_SOURCE_IDENTITIES"); ambiguous = true; }
  const phoneValues = unique(phones), emailValues = unique(emails);
  if (phoneValues.length > 1 || emailValues.length > 1) { reasons.push("SOURCE_CONTACT_CONFLICT"); ambiguous = true; }
  const names = unique(sourceNames);
  const candidate = { ...identity, phone: phoneValues.length === 1 ? phoneValues[0] : null, email: emailValues.length === 1 ? emailValues[0] : null,
    displayName: phoneValues.length === 1 && names.length === 1 ? names[0] : null };
  if (reasons.length) return uncertain(candidate, ambiguous ? "ambiguous" : "unavailable", reasons);
  if (!candidate.phone && !candidate.email) return uncertain(candidate, "unavailable", ["SOURCE_CONTACT_UNAVAILABLE"]);
  return uncertain(candidate, "unavailable", ["NATIVE_CONTACT_CORROBORATION_REQUIRED"]);
}

export function recordMatchesIdentity(record: NativeRecord, identity: VerifiedIdentity): boolean {
  if (!identity.phone && !identity.email) return false;
  return (!identity.phone || record.customerPhone === identity.phone) && (!identity.email || record.customerEmail === identity.email);
}
/** Detects a reused phone/email and contradictory canonical/job/series links.
 * Multiple visits are not themselves multiple customers; names never decide.
 */
export function nativeIdentityProblems(identity: VerifiedIdentity, records: readonly NativeRecord[]): string[] {
  const reasons: string[] = [];
  const contacts = records.filter(record => record.source !== "booking_series");
  if (contacts.some(record => !recordMatchesIdentity(record, identity))) reasons.push("NATIVE_CONTACT_CONFLICT");
  if (identity.phone && unique(contacts.map(record => record.customerEmail).filter(Boolean)).length > 1) reasons.push("SHARED_PHONE");
  if (identity.email && unique(contacts.map(record => record.customerPhone).filter(Boolean)).length > 1) reasons.push("SHARED_EMAIL");
  for (const record of records) {
    if (record.source === "leadflow_jobs" && record.bookingId) {
      const canonical = records.find(item => item.key === `booking:${record.bookingId}`);
      if (!canonical) reasons.push("CANONICAL_COUNTERPART_UNAVAILABLE");
      else if (!recordMatchesIdentity(canonical, identity) ||
        (record.customerPhone && canonical.customerPhone && record.customerPhone !== canonical.customerPhone) ||
        (record.customerEmail && canonical.customerEmail && record.customerEmail !== canonical.customerEmail)) reasons.push("CANONICAL_CONTACT_CONFLICT");
    }
    if (record.bookingSeriesId) {
      const series = records.find(item => item.key === `series:${record.bookingSeriesId}`);
      if (!series) reasons.push("SERIES_COUNTERPART_UNAVAILABLE");
      else if (!record.bookingId || series.bookingId !== record.bookingId) reasons.push("SERIES_LINK_CONFLICT");
    }
    if (record.source === "booking_series") {
      const canonical = records.find(item => item.key === `booking:${record.bookingId}`);
      if (!canonical) reasons.push("CANONICAL_COUNTERPART_UNAVAILABLE");
      else if (!recordMatchesIdentity(canonical, identity)) reasons.push("SERIES_CONTACT_CONFLICT");
    }
  }
  return unique(reasons);
}

/** Enumerates the real UTC instants of a local minute: zero for a spring gap,
 * two for a fall fold. Offsets are sampled around that date (timezone offsets,
 * not arbitrary analysis/time budgets). The existing converter supplies the
 * normal canonical instant; roundtrip and alternative offsets catch folds.
 */
export function localOccurrenceInstants(localDate: string, localTime: string, timeZone: string): string[] {
  if (!targetOccurrenceSchema.safeParse({ ...emptyTarget(), localDate, localTime, timeZone }).success) return [];
  const format = (ms: number) => {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(ms));
    const get = (type: Intl.DateTimeFormatPartTypes) => parts.find(part => part.type === type)?.value ?? "";
    return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
  };
  const rough = Date.parse(`${localDate}T${localTime}:00.000Z`);
  const offsets = new Set<number>();
  for (const delta of [-2, -1, 0, 1, 2]) {
    const sample = rough + delta * 86_400_000;
    offsets.add(Date.parse(`${format(sample)}:00.000Z`) - sample);
  }
  const instants = [...Array.from(offsets)].map(offset => rough - offset).filter(ms => format(ms) === `${localDate}T${localTime}`);
  try { instants.push(businessLocalDateTimeToUtcMs(localDate, localTime, timeZone)); } catch { /* nonexistent local time */ }
  return unique(instants.filter(ms => format(ms) === `${localDate}T${localTime}`).map(ms => new Date(ms).toISOString())).sort();
}
function recordInstant(record: NativeRecord): string | null {
  const localTime = record.localTime ?? record.arrivalWindow?.start;
  if (!record.localDate || !localTime || !record.timeZone) return null;
  const instants = localOccurrenceInstants(record.localDate, localTime, record.timeZone);
  let stored: string | null = null;
  if (record.requestedStartAt !== null) {
    const numeric = Number(record.requestedStartAt);
    if (Number.isSafeInteger(numeric)) { try { stored = new Date(numeric).toISOString(); } catch { /* invalid timestamp */ } }
  } else if (record.serviceDateTime && /(?:Z|[+-]\d{2}:\d{2})$/.test(record.serviceDateTime)) {
    const date = new Date(record.serviceDateTime);
    if (Number.isFinite(date.getTime())) stored = date.toISOString();
  }
  return stored && instants.includes(stored) ? stored : !stored && instants.length === 1 ? instants[0] : null;
}
function targetFor(record: NativeRecord, records: readonly NativeRecord[], scope: TargetOccurrence["scope"]): TargetOccurrence {
  const canonical = records.find(item => item.key === `booking:${record.bookingId}`);
  const series = records.find(item => item.source === "booking_series" && item.bookingId === record.bookingId);
  return { bookingId: record.bookingId, jobId: record.jobId, launch27BookingId: record.launch27BookingId,
    bookingSeriesId: record.bookingSeriesId ?? series?.bookingSeriesId ?? null,
    publicBookingNumber: record.publicBookingNumber ?? canonical?.publicBookingNumber ?? null,
    scope, localDate: record.localDate, localTime: record.localTime, arrivalWindow: record.arrivalWindow,
    timeZone: record.timeZone, occurredAtUtc: recordInstant(record) };
}

export function resolveOccurrence(scopeValue: AuthorizedScope, identityValue: VerifiedIdentity, expectedValue: Expectation, snapshotValue: NativeSnapshot): OccurrenceResolution {
  const scope = authorizedScopeSchema.parse(scopeValue), identity = verifiedIdentitySchema.parse(identityValue);
  const expected = expectationSchema.parse(expectedValue), snapshot = nativeSnapshotSchema.parse(snapshotValue);
  const result = (decision: OccurrenceResolution["decision"], reasons: string[], target = emptyTarget(expected.scope), keys: string[] = []) =>
    occurrenceResolutionSchema.parse({ decision, target, eligibleRecordKeys: keys, reasons: unique(reasons), snapshot });
  if (identity.installationScope !== scope.installationScope || identity.sourceAccountKey !== scope.sourceAccountKey || snapshot.sourceAccountKey !== scope.sourceAccountKey || identity.evidenceRefs.some(ref => ref.sourceAccountKey !== scope.sourceAccountKey)) return result("unavailable", ["IDENTITY_SCOPE_CONFLICT"]);
  if (identity.decision !== "verified") return result(identity.decision, identity.reasons);
  const problems = nativeIdentityProblems(identity, snapshot.records);
  if (problems.length) return result(problems.some(reason => reason.includes("UNAVAILABLE")) ? "unavailable" : "ambiguous", problems);
  if (snapshot.availability !== "complete" || snapshot.continuation !== null) return result("unavailable", ["NATIVE_SNAPSHOT_INCOMPLETE", ...snapshot.limitations]);
  if (expected.scope === "unspecified") return result("ambiguous", ["OCCURRENCE_SCOPE_UNSPECIFIED"]);
  // Requested replacement date/time is an expectation, not proof of the original
  // visit. originalDate selects the old occurrence; date alone cannot choose one
  // of multiple retained visits after a reschedule.
  let candidates = snapshot.records.filter(record => record.source !== "booking_series" && recordMatchesIdentity(record, identity));
  if (expected.bookingReference) {
    const reference = expected.bookingReference;
    const exact = candidates.filter(record => record.key === reference || record.publicBookingNumber === reference);
    const bookings = unique(exact.flatMap(record => record.bookingId ? [record.bookingId] : []));
    const jobs = exact.filter(record => record.source === "leadflow_jobs");
    if (reference.startsWith("leadflow:job:")) candidates = jobs;
    else candidates = candidates.filter(record => exact.includes(record) || (record.bookingId !== null && bookings.includes(record.bookingId)));
    if (!candidates.length) return result("unavailable", ["BOOKING_REFERENCE_NOT_FOUND"]);
  }
  if (expected.originalDate) candidates = candidates.filter(record => record.localDate === expected.originalDate);
  const operational = candidates.filter(record => record.source === "leadflow_jobs");
  const canonicalOnly = candidates.filter(record => record.source === "bookings" && !operational.some(job => job.bookingId === record.bookingId));
  // Later recurring operational visits suppress their linked first-visit preference.
  candidates = [...operational, ...canonicalOnly];
  if (!candidates.length) return result("unavailable", ["EXACT_OCCURRENCE_UNAVAILABLE"]);
  if (expected.scope === "visit") {
    if (candidates.length !== 1) return result("ambiguous", ["MULTIPLE_ELIGIBLE_VISITS"]);
    const record = candidates[0], target = targetFor(record, snapshot.records, "visit");
    if (expected.timeZone && target.timeZone && expected.timeZone !== target.timeZone) return result("ambiguous", ["TIMEZONE_CONFLICT"], target);
    if (!target.localDate || !target.timeZone || !target.occurredAtUtc) return result("ambiguous", ["OCCURRENCE_TIME_UNVERIFIED"], target);
    const keys = [record.key];
    if (record.bookingId && record.source === "leadflow_jobs") keys.push(`booking:${record.bookingId}`);
    if (target.bookingSeriesId) keys.push(`series:${target.bookingSeriesId}`);
    return result("verified", [], target, unique(keys));
  }
  const seriesIds = unique(candidates.map(record => targetFor(record, snapshot.records, expected.scope).bookingSeriesId).filter((id): id is string => id !== null));
  if (seriesIds.length !== 1 || candidates.some(record => targetFor(record, snapshot.records, expected.scope).bookingSeriesId !== seriesIds[0])) return result("ambiguous", ["RECURRING_SERIES_UNVERIFIED"]);
  const series = snapshot.records.find(record => record.key === `series:${seriesIds[0]}`);
  if (!series || !series.bookingId) return result("unavailable", ["SERIES_COUNTERPART_UNAVAILABLE"]);
  if (expected.scope === "subsequent" && !expected.originalDate) return result("ambiguous", ["SUBSEQUENT_BOUNDARY_UNSPECIFIED"]);
  // All actual series visits, not fabricated recurrence projections.
  const affected = snapshot.records.filter(record => record.source === "leadflow_jobs" && record.bookingSeriesId === series.bookingSeriesId && record.bookingId === series.bookingId &&
    (expected.scope === "series" || (record.localDate !== null && record.localDate >= expected.originalDate!)));
  if (!affected.length) return result("unavailable", ["RECURRING_OCCURRENCES_UNAVAILABLE"]);
  if (affected.some(record => !recordInstant(record))) return result("ambiguous", ["OCCURRENCE_TIME_UNVERIFIED"]);
  const anchor = expected.scope === "subsequent" ? affected.find(record => record.localDate === expected.originalDate) : series;
  if (!anchor) return result("unavailable", ["SUBSEQUENT_BOUNDARY_NOT_FOUND"]);
  const target = targetFor(anchor, snapshot.records, expected.scope);
  if (expected.timeZone && target.timeZone !== expected.timeZone) return result("ambiguous", ["TIMEZONE_CONFLICT"], target);
  return result("verified", [], target, unique([`booking:${series.bookingId}`, series.key, ...affected.map(record => record.key)]));
}

export function createIdentityResolver(options: IdentityResolverOptions): IdentityResolver {
  return Object.freeze({
    async resolve(scope: AuthorizedScope, context: SourceContext, snapshotValue: NativeSnapshot) {
      const identity = await resolveSourceIdentity(scope, context, options);
      if (identity.reasons[0] !== "NATIVE_CONTACT_CORROBORATION_REQUIRED") return identity;
      const snapshot = nativeSnapshotSchema.parse(snapshotValue);
      if (snapshot.sourceAccountKey !== scope.sourceAccountKey) return uncertain(identity, "unavailable", ["SOURCE_ACCOUNT_CONFLICT"]);
      const problems = nativeIdentityProblems(identity, snapshot.records);
      if (problems.length) return uncertain(identity, problems.some(reason => reason.includes("UNAVAILABLE")) ? "unavailable" : "ambiguous", problems);
      if (snapshot.availability !== "complete" || snapshot.continuation !== null) return uncertain(identity, "unavailable", ["NATIVE_SNAPSHOT_INCOMPLETE", ...snapshot.limitations]);
      if (!snapshot.records.some(record => record.source !== "booking_series" && recordMatchesIdentity(record, identity))) return uncertain(identity, "unavailable", ["NATIVE_CONTACT_NOT_FOUND"]);
      if (identity.sessionIds.length) {
        if (!options.readSessionContacts) return uncertain(identity, "unavailable", ["SESSION_CONTACT_BINDING_UNAVAILABLE"]);
        let sessions: readonly IdentitySessionContact[];
        try { sessions = await options.readSessionContacts(scope, identity.sessionIds); } catch { return uncertain(identity, "unavailable", ["SESSION_CONTACT_BINDING_UNAVAILABLE"]); }
        if (identity.sessionIds.some(id => sessions.filter(session => session.sessionId === id).length !== 1)) return uncertain(identity, "unavailable", ["SESSION_CONTACT_BINDING_UNAVAILABLE"]);
        if (!identity.phone || sessions.some(session => normalizePhone(session.phone) !== identity.phone)) return uncertain(identity, "ambiguous", ["SESSION_CONTACT_CONFLICT"]);
      }
      const contacts = snapshot.records.filter(record => record.source !== "booking_series");
      const corroboratedPhone = identity.phone ?? unique(contacts.map(record => record.customerPhone).filter(Boolean))[0] ?? null;
      const corroboratedEmail = identity.email ?? unique(contacts.map(record => record.customerEmail).filter(Boolean))[0] ?? null;
      // A single-source contact must not adopt conflicting counterparts.
      if (unique(contacts.map(record => record.customerPhone).filter(Boolean)).length > 1 || unique(contacts.map(record => record.customerEmail).filter(Boolean)).length > 1) return uncertain(identity, "ambiguous", ["NATIVE_CONTACT_CONFLICT"]);
      return verifiedIdentitySchema.parse({ ...identity, phone: corroboratedPhone, email: corroboratedEmail,
        decision: "verified", reasons: [], fingerprint: hash([scope.installationScope, scope.sourceAccountKey, corroboratedPhone, corroboratedEmail]),
        displayName: identity.displayName ?? contacts[0]?.customerName ?? null });
    },
    async occurrence(scope: AuthorizedScope, identity: VerifiedIdentity, expected: Expectation, records: NativeSnapshot) { return resolveOccurrence(scope, identity, expected, records); },
  });
}
