import {
  teamComplaintCandidateSchema,
  type TeamComplaintCandidate,
  type TeamComplaintMatch,
  type TeamComplaintVisitGroup,
  type TeamEvidence,
  type TeamEvidenceVisit,
  type TeamEvidenceVisitHistory,
  type TeamEvidenceWindow,
} from "../shared/teamLeaderboardEvidence";
import { normalizePhone } from "./utils/phone";

// Pure attribution only: no clock, persistence, provider/model calls, or scoring.
const unique = (values: string[]) => Array.from(new Set(values));
const textKey = (value: string | null | undefined) => value?.trim().toLowerCase().replace(/\s+/g, " ") || null;
const emailKey = (value: string | null | undefined) => value?.trim().toLowerCase() || null;
const dayMillis = 86_400_000;
function validDay(value: string): boolean {
  const milliseconds = Date.parse(`${value}T00:00:00Z`);
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(milliseconds)
    && new Date(milliseconds).toISOString().slice(0, 10) === value;
}
function timestamp(value: string | null): number | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) return null;
  if (!validDay(value.slice(0, 10))) return null;
  if (Number(value.slice(11, 13)) > 23 || Number(value.slice(14, 16)) > 59
    || (value[16] === ":" && Number(value.slice(17, 19)) > 59)) return null;
  const result = Date.parse(value);
  return Number.isFinite(result) ? result : null;
}
function localDay(milliseconds: number): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date(milliseconds));
  const part = (type: string) => parts.find(item => item.type === type)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}
function weekOf(day: string): string {
  const date = new Date(`${day}T00:00:00Z`);
  return new Date(date.getTime() - date.getUTCDay() * dayMillis).toISOString().slice(0, 10);
}
function validWindow(window: TeamEvidenceWindow): boolean {
  return window.timeZone === "America/New_York" && validDay(window.weekStart) && validDay(window.weekEnd)
    && new Date(`${window.weekStart}T00:00:00Z`).getUTCDay() === 0
    && Date.parse(`${window.weekEnd}T00:00:00Z`) - Date.parse(`${window.weekStart}T00:00:00Z`) === 6 * dayMillis;
}
const statusKey = (value: string | null) => value?.trim().toLowerCase() ?? null;
function completed(visit: TeamEvidenceVisit): boolean {
  return !["cancelled", "canceled", "rescheduled", "missing_from_launch27"].includes(statusKey(visit.bookingStatus) ?? "")
    && statusKey(visit.progressStatus ?? visit.bookingStatus) === "completed";
}

/**
 * A shared phone/email is not a customer ID. Differing populated names or emails
 * identify ambiguity, even within a household. Multiple addresses alone may be
 * the same customer ONLY with an agreeing populated name or email and no such
 * conflict. Missing identity details are not invented from the candidate text.
 */
function distinctCustomers(a: TeamEvidenceVisit, b: TeamEvidenceVisit): boolean {
  const an = textKey(a.customerName), bn = textKey(b.customerName);
  const ae = emailKey(a.customerEmail), be = emailKey(b.customerEmail);
  if (an && bn && an !== bn) return true;
  if (ae && be && ae !== be) return true;
  const aa = textKey(a.address), ba = textKey(b.address);
  return !!(aa && ba && aa !== ba && !(an && an === bn) && !(ae && ae === be));
}
function ambiguousCustomers(visits: readonly TeamEvidenceVisit[]): boolean {
  return visits.some((a, index) => visits.slice(index + 1).some(b => distinctCustomers(a, b)));
}

const months: Record<string, string> = {
  january: "01", jan: "01", february: "02", feb: "02", march: "03", mar: "03", april: "04", apr: "04",
  may: "05", june: "06", jun: "06", july: "07", jul: "07", august: "08", aug: "08", september: "09",
  sep: "09", sept: "09", october: "10", oct: "10", november: "11", nov: "11", december: "12", dec: "12",
};
/** Only absolute ISO or English month-name/day/four-digit-year dates. No relative,
 * yearless, locale-ambiguous numeric, body-timestamp, or model-invented dates. */
function quotedDate(quote: string): string | null {
  const found: string[] = [];
  for (const match of Array.from(quote.matchAll(/\b\d{4}-\d{2}-\d{2}\b/g))) {
    if (!validDay(match[0])) return null;
    found.push(match[0]);
  }
  const monthPattern = Object.keys(months).sort((a, b) => b.length - a.length).join("|");
  const forward = new RegExp(`\\b(${monthPattern})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,\\s*|\\s+)(\\d{4})\\b`, "gi");
  const reverse = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${monthPattern})\\.?\\s+(\\d{4})\\b`, "gi");
  for (const [pattern, reversed] of [[forward, false], [reverse, true]] as const) {
    for (const match of Array.from(quote.matchAll(pattern))) {
      const day = reversed ? match[1] : match[2];
      const month = months[(reversed ? match[2] : match[1]).toLowerCase()];
      const value = `${match[3]}-${month}-${day.padStart(2, "0")}`;
      if (!validDay(value)) return null;
      found.push(value);
    }
  }
  const dates = unique(found);
  return dates.length === 1 ? dates[0] : null;
}
function literalToken(haystack: string, needle: string): boolean {
  if (!needle) return false;
  let position = haystack.indexOf(needle);
  while (position >= 0) {
    const left = haystack[position - 1], right = haystack[position + needle.length];
    if ((!left || !/[\w-]/.test(left)) && (!right || !/[\w-]/.test(right))) return true;
    position = haystack.indexOf(needle, position + 1);
  }
  return false;
}
function referencedVisits(candidate: TeamComplaintCandidate, visits: readonly TeamEvidenceVisit[]): {
  visits: TeamEvidenceVisit[]; reasons: string[];
} {
  let result = [...visits];
  const reasons: string[] = [];
  for (const reference of candidate.references) {
    const value = reference.value;
    if (reference.kind === "unresolved" || !value) {
      reasons.push("unresolved_explicit_reference");
      continue;
    }
    let matching: TeamEvidenceVisit[] = [];
    if (reference.kind === "service_date") {
      const date = quotedDate(reference.quote);
      if (!date || !(reference.quote.includes(value) || value === date)) {
        reasons.push("unsupported_service_date_reference");
        continue;
      }
      matching = visits.filter(visit => visit.jobDate === date);
    } else if (reference.kind === "booking") {
      if (!reference.quote.includes(value)) {
        reasons.push("unsupported_booking_reference");
        continue;
      }
      // Public numbers only. Never reinterpret an unnamespaced numeric value as
      // a local visit ID, native booking ID, or imported provider booking ID.
      matching = visits.filter(visit => visit.publicBookingNumber !== null
        && literalToken(value, visit.publicBookingNumber)
        && literalToken(reference.quote, visit.publicBookingNumber));
    } else if (reference.kind === "address") {
      if (!reference.quote.includes(value)) {
        reasons.push("unsupported_address_reference");
        continue;
      }
      matching = visits.filter(visit => !!visit.address?.trim()
        && value.includes(visit.address!.trim()) && reference.quote.includes(visit.address!.trim()));
    }
    if (matching.length === 0) reasons.push("explicit_reference_not_found");
    const ids = new Set(matching.map(visit => visit.id));
    result = result.filter(visit => ids.has(visit.id));
  }
  if (candidate.references.length && !result.length && !reasons.length) reasons.push("conflicting_explicit_references");
  return { visits: result, reasons };
}

function selectVisit(visits: readonly TeamEvidenceVisit[], report: number, explicit: boolean,
  preciseReference: boolean): { visit: TeamEvidenceVisit | null; reasons: string[]; limitations: string[] } {
  const reasons: string[] = [], limitations: string[] = [];
  const reportDay = localDay(report);
  // A unique booking/date reference is never replaced by an older completion.
  if (explicit && visits.length === 1) {
    return { visit: visits[0], reasons, limitations };
  }
  if (explicit && preciseReference && visits.length > 1) {
    return { visit: null, reasons: ["explicit_reference_multiple_visits"], limitations };
  }
  const possible = visits.filter(visit => {
    if (!completed(visit) || !validDay(visit.jobDate) || visit.jobDate > reportDay) return false;
    const start = timestamp(visit.serviceStartUtc);
    // Same-day unknown times remain in contention and BLOCK falling back to an
    // older job. Known future starts are not an earlier completed service.
    return start === null || start < report;
  });
  if (!possible.length) return { visit: null, reasons: [explicit ? "referenced_service_not_completed_before_report" : "no_completed_service_before_report"], limitations };
  const latestDate = possible.reduce((latest, visit) => visit.jobDate > latest ? visit.jobDate : latest, "");
  const sameDay = possible.filter(visit => visit.jobDate === latestDate);
  if (sameDay.length > 1 && sameDay.some(visit => timestamp(visit.serviceStartUtc) === null)) {
    return { visit: null, reasons: ["multiple_service_visits_with_unknown_times"], limitations };
  }
  const ordered = [...sameDay].sort((a, b) => (timestamp(b.serviceStartUtc) ?? 0) - (timestamp(a.serviceStartUtc) ?? 0));
  if (ordered.length > 1 && timestamp(ordered[0].serviceStartUtc) === timestamp(ordered[1].serviceStartUtc)) {
    return { visit: null, reasons: ["service_start_tie"], limitations };
  }
  return { visit: ordered[0], reasons, limitations };
}

function validateVisit(visit: TeamEvidenceVisit, report: number): { reasons: string[]; limitations: string[] } {
  const reasons: string[] = [], limitations: string[] = [];
  if (!validDay(visit.jobDate)) return { reasons: ["invalid_service_date"], limitations };
  if (!completed(visit)) reasons.push("referenced_service_not_completed");
  const reportDay = localDay(report), start = timestamp(visit.serviceStartUtc);
  if (visit.jobDate > reportDay || (start !== null && start >= report)) reasons.push("service_not_strictly_before_report");
  if (visit.serviceStartUtc && start === null) reasons.push("invalid_service_start_timestamp");
  if (start === null) {
    if (visit.jobDate === reportDay) reasons.push("same_day_service_time_unknown");
    else limitations.push("prior_service_date_only_no_exact_start");
  } else if (localDay(start) !== visit.jobDate) {
    reasons.push("service_date_start_conflict");
  }
  for (const [value, label] of [[visit.progressUpdatedAtUtc, "progress"], [visit.signoffAtUtc, "signoff"]] as const) {
    const event = timestamp(value);
    if (value && event === null) reasons.push(`invalid_${label}_timestamp`);
    if (event !== null && event > report) reasons.push("historical_completion_uncertain_after_report");
  }
  if (!visit.progressUpdatedAtUtc && !visit.signoffAtUtc) limitations.push("completion_status_has_no_historical_event_timestamp");
  return { reasons: unique(reasons), limitations };
}

type TeamResolution = { team: TeamComplaintMatch["team"]; reasons: string[]; limitations: string[] };
function resolveTeam(visit: TeamEvidenceVisit, history: TeamEvidenceVisitHistory, report: number): TeamResolution {
  const reasons: string[] = [], limitations: string[] = [];
  const possibilities: NonNullable<TeamComplaintMatch["team"]>[] = [];
  // The reader performs unique Launch27 -> scheduling ID mapping. Every team
  // field in TeamEvidenceVisit/Assignment is already in that local namespace;
  // remapping imported stored fields here would confuse colliding numeric IDs.
  const resolve = (id: number | null, basis: NonNullable<TeamComplaintMatch["team"]>["basis"]) => {
    if (id === null) return null;
    const rows = history.teams.filter(team => team.id === id);
    if (rows.length !== 1) {
      reasons.push(rows.length ? "ambiguous_team_id_mapping" : "team_id_mapping_missing");
      return null;
    }
    const team = { id: rows[0].id, name: rows[0].name, basis };
    return team;
  };
  const signoff = resolve(visit.signoffTeamId, "signoff");
  if (signoff) possibilities.push(signoff);
  const progress = statusKey(visit.progressStatus) === "completed" ? resolve(visit.progressTeamId, "progress") : null;
  if (progress) possibilities.push(progress);
  if (signoff && progress && signoff.id !== progress.id) reasons.push("signoff_progress_team_conflict");
  const start = timestamp(visit.serviceStartUtc);
  const native = visit.launch27BookingId === null && visit.bookingId !== null;
  const assignments = native ? history.assignments.filter(assignment => assignment.bookingId === visit.bookingId) : [];
  const active: NonNullable<TeamComplaintMatch["team"]>[] = [];
  const later: NonNullable<TeamComplaintMatch["team"]>[] = [];
  let intervalUncertain = false;
  for (const assignment of assignments) {
    const assigned = timestamp(assignment.assignedAtUtc), unassigned = timestamp(assignment.unassignedAtUtc);
    if (start === null || assigned === null || (assignment.unassignedAtUtc && unassigned === null)
      || (unassigned !== null && unassigned <= assigned)
      || (statusKey(assignment.status) === "unassigned" && unassigned === null)) {
      intervalUncertain = true;
      continue;
    }
    const team = resolve(assignment.teamId, "assignment_at_service");
    if (!team) { intervalUncertain = true; continue; }
    if (assigned <= start && (unassigned === null || unassigned > start)) active.push(team);
    else if (assigned > start) later.push(team);
  }
  const activeIds = unique(active.map(team => String(team.id)));
  if (activeIds.length > 1) reasons.push("multiple_teams_assigned_at_service");
  if (active.length) possibilities.push(active[0]);
  if (intervalUncertain) {
    if (signoff) limitations.push("assignment_interval_uncertain_resolved_by_captured_signoff");
    else reasons.push("assignment_interval_time_uncertain");
  }
  const stored = resolve(visit.storedTeamId, "stored_visit");
  if (stored) possibilities.push(stored);
  // A name is display context, never a mapping key. Concatenated names cannot
  // certify a single crew even when a numeric field currently contains one ID.
  const names = [visit.storedTeamName, ...assignments.map(assignment => assignment.teamName)].filter((name): name is string => !!name);
  if (names.some(name => !history.teams.some(team => team.name === name)
    && (/[,;|/+&]|\sand\s/i.test(name)
      || history.teams.filter(team => team.name && name.includes(team.name)).length > 1))) {
    reasons.push("multiple_team_names_ambiguous");
  }
  const team = possibilities[0] ?? null;
  if (!team) reasons.push("service_team_not_resolved");
  if (team && possibilities.some(other => other.id !== team.id)) reasons.push("historical_team_sources_conflict");
  if (team && later.some(other => other.id !== team.id)) reasons.push("later_assignment_conflicts_with_service_team");
  if (team && later.length) limitations.push("later_assignments_not_used_for_service_attribution");
  if (native && team?.basis === "stored_visit" && later.length && !active.length) {
    reasons.push("stored_team_supported_only_by_later_assignment");
  }
  const updated = timestamp(visit.jobUpdatedAtUtc);
  if (visit.jobUpdatedAtUtc && updated === null) reasons.push("invalid_job_update_timestamp");
  if (updated !== null && updated > report && visit.storedTeamId !== null) reasons.push("stored_team_snapshot_updated_after_report");
  if (team?.basis === "stored_visit") {
    limitations.push(visit.launch27BookingId !== null
      ? "imported_stored_team_without_immutable_assignment_history"
      : "native_stored_team_without_immutable_assignment_history");
    if (updated === null) limitations.push("stored_team_snapshot_update_time_unknown");
  }
  if (signoff && !visit.signoffAtUtc) limitations.push("captured_signoff_team_without_event_timestamp");
  return { team, reasons: unique(reasons), limitations: unique(limitations) };
}

export function matchTeamComplaintCandidates(
  candidates: readonly TeamComplaintCandidate[],
  evidence: readonly TeamEvidence[],
  history: TeamEvidenceVisitHistory,
  window: TeamEvidenceWindow,
): TeamComplaintMatch[] {
  return candidates.map(candidate => {
    const result: TeamComplaintMatch = {
      candidate, status: "needs_review", matchBasis: null, visit: null, team: null,
      reportAtUtc: null, affectedWeekStart: null, includedInRequestedWeek: false,
      reviewReasons: [], limitations: unique([...history.limitations, ...(!history.complete ? ["visit_history_incomplete"] : [])]),
      verified: false, eligibleForScore: false,
    };
    const review = (reason: string) => { result.reviewReasons.push(reason); };
    const finish = () => {
      result.reviewReasons = unique(result.reviewReasons);
      result.limitations = unique(result.limitations);
      result.status = result.reviewReasons.length || !result.visit || !result.team ? "needs_review" : "matched";
      return result;
    };
    if (!teamComplaintCandidateSchema.safeParse(candidate).success) {
      review("invalid_candidate_schema"); return finish();
    }
    const bound = evidence.filter(item => item.id === candidate.evidenceId);
    if (!bound.length || !bound.some(item => item.revision === candidate.evidenceRevision)) {
      review("unknown_or_stale_evidence_binding"); return finish();
    }
    const source = bound.find(item => item.revision === candidate.evidenceRevision)!;
    const sourceFields = Object.keys(source) as Array<keyof TeamEvidence>;
    if (bound.some(item => sourceFields.some(key => key !== "limitations" && item[key] !== source[key]))) {
      review("conflicting_canonical_evidence_binding"); return finish();
    }
    result.limitations.push(...bound.flatMap(item => item.limitations));
    if (source.providerId && evidence.some(item => item.id !== source.id && item.providerId === source.providerId
      && item.store === source.store && item.originalText !== source.originalText)) {
      result.limitations.push("same_provider_conflicting_evidence_retained");
    }
    if (source.originalText === null || source.bodyBasis === "snippet" || source.bodyBasis === "missing") {
      review("original_evidence_body_unavailable"); return finish();
    }
    if (source.bodyBasis === "snapshot" && source.limitations.some(reason => /translation|non-original variant/i.test(reason))) {
      review("non_original_translation_evidence"); return finish();
    }
    if (!candidate.evidenceQuotes.every(quote => source.originalText!.includes(quote))
      || !candidate.references.every(reference => source.originalText!.includes(reference.quote))) {
      review("quote_not_literal_original_evidence"); return finish();
    }
    if (source.bodyBasis === "snapshot") result.limitations.push("original_body_snapshot_not_live_source");
    if (source.speakerBasis === "non_customer") {
      review("non_customer_evidence"); return finish();
    }
    // Unverified callers can have a deterministic contact/visit match. This
    // limitation is surfaced as a review reason, but does not demand manual
    // assignment or turn a clear lookup into an unmatched candidate.
    const speakerUnverified = source.speakerBasis === "unverified";
    const unverifiedCall = speakerUnverified && ["human_call", "ai_call", "phone_unverified"].includes(source.sourceKind);
    if (unverifiedCall) result.limitations.push("call_speaker_not_verified_customer");
    else if (speakerUnverified) review("non_call_customer_speaker_unverified");
    const report = timestamp(source.occurredAtUtc);
    result.reportAtUtc = source.occurredAtUtc;
    if (source.timeBasis !== "original" || report === null) {
      review("original_report_time_uncertain"); return finish();
    }
    if (!validWindow(window)) { review("invalid_requested_sunday_week"); return finish(); }
    const phone = normalizePhone(source.customerPhone), email = emailKey(source.customerEmail);
    if ((!phone && !email) || (phone && phone === normalizePhone(source.businessLine))
      || (email && email === emailKey(source.mailboxEmail))) {
      review("customer_contact_unavailable_or_business_contact"); return finish();
    }
    const phoneVisits = phone ? history.visits.filter(visit => normalizePhone(visit.customerPhone) === phone) : [];
    const emailVisits = email ? history.visits.filter(visit => emailKey(visit.customerEmail) === email) : [];
    let contactVisits = phoneVisits.length ? phoneVisits : emailVisits;
    if (phone && email) {
      if (phoneVisits.length && emailVisits.length) {
        contactVisits = phoneVisits.filter(visit => emailVisits.includes(visit));
        if (!contactVisits.length) { review("phone_email_customer_conflict"); return finish(); }
      } else if (phoneVisits.length) {
        if (phoneVisits.some(visit => emailKey(visit.customerEmail) && emailKey(visit.customerEmail) !== email)) {
          review("phone_email_customer_conflict"); return finish();
        }
        contactVisits = phoneVisits.filter(visit => !emailKey(visit.customerEmail) || emailKey(visit.customerEmail) === email);
        result.limitations.push("email_contact_not_present_in_visit_history");
      } else if (emailVisits.length) {
        if (emailVisits.some(visit => normalizePhone(visit.customerPhone) && normalizePhone(visit.customerPhone) !== phone)) {
          review("phone_email_customer_conflict"); return finish();
        }
        contactVisits = emailVisits.filter(visit => !normalizePhone(visit.customerPhone) || normalizePhone(visit.customerPhone) === phone);
        result.limitations.push("phone_contact_not_present_in_visit_history");
      }
    }
    if (!contactVisits.length) { review("customer_contact_not_found"); return finish(); }
    const duplicateIds = contactVisits.some((visit, index) => contactVisits.slice(index + 1).some(other => other.id === visit.id));
    if (duplicateIds) { review("duplicate_visit_identity_in_history"); return finish(); }
    const explicit = candidate.references.length > 0;
    const references = referencedVisits(candidate, contactVisits);
    if (references.reasons.length) { result.reviewReasons.push(...references.reasons); return finish(); }
    const shared = ambiguousCustomers(phoneVisits) || ambiguousCustomers(emailVisits) || ambiguousCustomers(contactVisits);
    if (shared && (!explicit || references.visits.length !== 1)) {
      review("shared_contact_multiple_customers"); return finish();
    }
    if (shared) result.limitations.push("shared_contact_resolved_by_unique_literal_service_reference");
    const selected = selectVisit(explicit ? references.visits : contactVisits, report, explicit,
      candidate.references.some(reference => reference.kind === "booking" || reference.kind === "service_date"));
    result.reviewReasons.push(...selected.reasons);
    result.limitations.push(...selected.limitations);
    if (!selected.visit) return finish();
    const visit = selected.visit;
    result.matchBasis = explicit ? "explicit_visit" : "latest_completed_before_report";
    result.visit = { id: visit.id, bookingId: visit.bookingId, serviceDate: visit.jobDate, serviceStartUtc: visit.serviceStartUtc };
    if (history.limitations.some(reason => reason.startsWith(`Visit ${visit.id} `) || reason.startsWith(`Visit ${visit.id}:`)
      ? /conflict|changed across|missing\/ambiguous.*mapping/i.test(reason) : false)) {
      review("visit_history_identity_or_mapping_conflict");
    }
    if (validDay(visit.jobDate)) {
      result.affectedWeekStart = weekOf(visit.jobDate);
      result.includedInRequestedWeek = result.affectedWeekStart === window.weekStart;
      if (!result.includedInRequestedWeek) result.limitations.push("affected_service_outside_requested_week");
    }
    const validation = validateVisit(visit, report);
    result.reviewReasons.push(...validation.reasons);
    result.limitations.push(...validation.limitations);
    const teamResolution = resolveTeam(visit, history, report);
    result.team = teamResolution.team;
    result.reviewReasons.push(...teamResolution.reasons);
    result.limitations.push(...teamResolution.limitations);
    if (unverifiedCall) {
      // A review reason about speaker identity is not an attribution blocker:
      // retain the deterministic matched status and all review context below.
      result.reviewReasons.push("call_speaker_unverified_fault_not_verified");
    }
    finish();
    if (unverifiedCall && result.visit && result.team
      && result.reviewReasons.every(reason => reason === "call_speaker_unverified_fault_not_verified")) result.status = "matched";
    return result;
  });
}

export function groupTeamComplaintVisits(matches: readonly TeamComplaintMatch[]): TeamComplaintVisitGroup[] {
  const groups = new Map<string, TeamComplaintVisitGroup>();
  for (const match of matches) {
    if (match.status !== "matched" || !match.visit || !match.team) continue;
    const key = `${match.visit.id}:${match.team.id}`;
    let group = groups.get(key);
    if (!group) {
      group = { visitId: match.visit.id, teamId: match.team.id, serviceDate: match.visit.serviceDate,
        matches: [], evidenceIds: [], verified: false, eligibleForScore: false };
      groups.set(key, group);
    }
    group.matches.push(match);
    if (!group.evidenceIds.includes(match.candidate.evidenceId)) group.evidenceIds.push(match.candidate.evidenceId);
  }
  return Array.from(groups.values());
}
