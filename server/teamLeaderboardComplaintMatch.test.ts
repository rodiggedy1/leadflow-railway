import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type {
  TeamComplaintCandidate, TeamEvidence, TeamEvidenceAssignment, TeamEvidenceVisit,
  TeamEvidenceVisitHistory, TeamEvidenceWindow,
} from "../shared/teamLeaderboardEvidence";
import { groupTeamComplaintVisits, matchTeamComplaintCandidates } from "./teamLeaderboardComplaintMatch";

const window: TeamEvidenceWindow = {
  weekStart: "2026-11-15", weekEnd: "2026-11-21", throughDate: "2026-11-19",
  timeZone: "America/New_York", startInclusiveUtc: "2026-11-15T05:00:00Z",
  endExclusiveUtc: "2026-11-22T05:00:00Z", capturedAtUtc: "2026-11-19T22:00:00Z",
};
function source(overrides: Partial<TeamEvidence> = {}): TeamEvidence {
  const result: TeamEvidence = {
    id: "sms:1", revision: "", sourceKind: "sms", store: "messages", sourceRowId: "1", providerId: "provider-1",
    sessionId: null, threadId: null, originalText: "The team left the kitchen dirty.",
    occurredAtUtc: "2026-11-19T17:00:00Z", observedAtUtc: "2026-11-19T17:01:00Z",
    timeBasis: "original", bodyBasis: "original", speakerBasis: "customer",
    customerPhone: "+17035551234", customerEmail: null, customerName: "Alice Example",
    businessLine: "+17035559999", mailboxEmail: null, limitations: [], ...overrides,
  };
  result.revision = overrides.revision ?? createHash("sha256").update(JSON.stringify(result)).digest("hex");
  return result;
}
function candidate(evidence: TeamEvidence, overrides: Partial<TeamComplaintCandidate> = {}): TeamComplaintCandidate {
  return { evidenceId: evidence.id, evidenceRevision: evidence.revision, summary: "Kitchen cleaning complaint",
    category: "cleaning_quality", evidenceQuotes: ["The team left the kitchen dirty."], references: [], ...overrides };
}
function visit(overrides: Partial<TeamEvidenceVisit> = {}): TeamEvidenceVisit {
  return {
    id: 100, bookingId: null, launch27BookingId: 800, publicBookingNumber: "LF-800",
    jobDate: "2026-11-18", serviceStartUtc: "2026-11-18T15:00:00Z",
    bookingStatus: "completed", progressStatus: null,
    customerName: "Alice Example", customerPhone: "(703) 555-1234", customerEmail: "alice@example.test",
    address: "123 Oak Street", storedTeamId: 1, storedTeamName: "Team One",
    progressTeamId: null, signoffTeamId: null,
    progressUpdatedAtUtc: null, signoffAtUtc: null, jobUpdatedAtUtc: "2026-11-18T18:00:00Z",
    customerRating: null, etaTimestamp: null, ...overrides,
  };
}
function history(visits: TeamEvidenceVisit[] = [visit()], overrides: Partial<TeamEvidenceVisitHistory> = {}): TeamEvidenceVisitHistory {
  return { visits, teams: [{ id: 1, name: "Team One", launch27TeamId: 901 }, { id: 2, name: "Team Two", launch27TeamId: 902 }],
    assignments: [], complete: true, limitations: [], ...overrides };
}
function assignment(overrides: Partial<TeamEvidenceAssignment> = {}): TeamEvidenceAssignment {
  return { id: 1, bookingId: 10, teamId: 1, teamName: "Team One", assignedAtUtc: "2026-11-17T12:00:00Z",
    unassignedAtUtc: null, status: "assigned", ...overrides };
}
function match(evidence = source(), data = history(), input = candidate(evidence)) {
  return matchTeamComplaintCandidates([input], [evidence], data, window)[0];
}
const referenceSource = (reference: string) => source({ originalText: `The team left the kitchen dirty. ${reference}` });
const nativeVisit = (overrides: Partial<TeamEvidenceVisit> = {}) => visit({ bookingId: 10, launch27BookingId: null,
  storedTeamId: 1, ...overrides });
const expectReview = (result: ReturnType<typeof match>, reason: string) => {
  expect(result.status).toBe("needs_review"); expect(result.reviewReasons).toContain(reason);
  expect(result.verified).toBe(false); expect(result.eligibleForScore).toBe(false);
};

describe("pure team complaint attribution", () => {
  it("automatically matches a routine SMS to its preceding completed service without score verification", () => {
    const result = match();
    expect(result).toMatchObject({ status: "matched", matchBasis: "latest_completed_before_report", visit: { id: 100 },
      team: { id: 1, basis: "stored_visit" }, affectedWeekStart: "2026-11-15", includedInRequestedWeek: true,
      verified: false, eligibleForScore: false });
    expect(result.limitations).toContain("imported_stored_team_without_immutable_assignment_history");
  });
  it("uses evidence email contact, not candidate/model names, for email lookup", () => {
    const evidence = source({ id: "email:2", sourceKind: "email", customerPhone: null, customerEmail: " ALICE@EXAMPLE.TEST ",
      customerName: "Not an identity key", mailboxEmail: "office@example.test" });
    expect(match(evidence, history(), candidate(evidence, { summary: "Team ID 2, customer Bob claims bad work" }))).toMatchObject({ status: "matched", team: { id: 1 } });
  });
  it("uses full prior history, not only requested week or newest/future/cancelled rows", () => {
    const visits = [visit(), visit({ id: 101, jobDate: "2026-11-20", serviceStartUtc: "2026-11-20T15:00:00Z" }),
      visit({ id: 102, jobDate: "2026-11-19", serviceStartUtc: "2026-11-19T18:00:00Z" }),
      visit({ id: 103, jobDate: "2026-11-19", serviceStartUtc: "2026-11-19T12:00:00Z", bookingStatus: "cancelled" })];
    expect(match(source(), history(visits)).visit?.id).toBe(100);
  });
  it.each(["cancelled", "canceled", "rescheduled", "missing_from_launch27"])("excludes %s even if stale progress says completed", bookingStatus => {
    expect(match(source(), history([visit({ bookingStatus, progressStatus: "completed" })])).status).toBe("needs_review");
  });
  it("uses progress status in preference to booking completed", () => {
    expectReview(match(source(), history([visit({ progressStatus: "in_progress" })])), "no_completed_service_before_report");
    expect(match(source(), history([visit({ bookingStatus: "confirmed", progressStatus: "completed", progressTeamId: 1 })])).status).toBe("matched");
  });
  it.each(["booking", "service_date", "address"] as const)("uses a literal older %s reference before latest service", kind => {
    const older = visit({ id: 90, launch27BookingId: 700, publicBookingNumber: "LF-700", jobDate: "2026-11-16",
      serviceStartUtc: "2026-11-16T15:00:00Z", address: "77 Maple Road", jobUpdatedAtUtc: "2026-11-16T19:00:00Z" });
    const value = kind === "booking" ? "booking LF-700" : kind === "service_date" ? "2026-11-16" : "77 Maple Road";
    const evidence = referenceSource(value);
    const result = match(evidence, history([visit(), older]), candidate(evidence, { references: [{ kind, value, quote: value }] }));
    expect(result).toMatchObject({ status: "matched", matchBasis: "explicit_visit", visit: { id: 90 } });
  });
  it("accepts unambiguous named-month/year natural dates with raw reference values", () => {
    const value = "November 18th, 2026", evidence = referenceSource(value);
    expect(match(evidence, history(), candidate(evidence, { references: [{ kind: "service_date", value, quote: value }] })).status).toBe("matched");
  });
  it.each(["yesterday", "last Monday", "11/18/26", "November 18", "2026-02-30", "2026-11-18 or 2026-11-17"])("reviews unsupported/ambiguous date %s instead of guessing", value => {
    const evidence = referenceSource(value);
    expectReview(match(evidence, history(), candidate(evidence, { references: [{ kind: "service_date", value, quote: value }] })), "unsupported_service_date_reference");
  });
  it.each(["unresolved", "booking", "address"] as const)("never falls back for unresolved/unknown %s", kind => {
    const value = kind === "booking" ? "LF-999" : kind === "address" ? "999 Unknown Lane" : "that previous cleaning";
    const evidence = referenceSource(value);
    const result = match(evidence, history(), candidate(evidence, { references: [{ kind, value, quote: value }] }));
    expect(result.status).toBe("needs_review"); expect(result.visit).toBeNull();
  });
  it("does not map model-supplied internal/provider numeric IDs to a visit", () => {
    const evidence = referenceSource("booking 800");
    expectReview(match(evidence, history(), candidate(evidence, { references: [{ kind: "booking", value: "800", quote: "booking 800" }] })), "explicit_reference_not_found");
  });
  it("does not allow a booking ID substring to match a larger public ID", () => {
    const evidence = referenceSource("booking LF-8009");
    expectReview(match(evidence, history(), candidate(evidence, { references: [{ kind: "booking", value: "LF-8009", quote: "booking LF-8009" }] })), "explicit_reference_not_found");
  });
  it.each(["future", "cancelled", "rescheduled"])("retains/reviews explicit %s service rather than replacing it", situation => {
    const referenced = visit({ id: 101, publicBookingNumber: "LF-801", ...(situation === "future"
      ? { jobDate: "2026-11-20", serviceStartUtc: "2026-11-20T15:00:00Z" } : { bookingStatus: situation }) });
    const evidence = referenceSource("booking LF-801");
    const result = match(evidence, history([visit(), referenced]), candidate(evidence, { references: [{ kind: "booking", value: "LF-801", quote: "booking LF-801" }] }));
    expect(result.status).toBe("needs_review"); expect(result.visit?.id).toBe(101);
  });
  it("rejects phone+email conflict rather than choosing one", () => {
    const evidence = source({ customerEmail: "bob@example.test" });
    expectReview(match(evidence, history([visit(), visit({ id: 101, customerPhone: "7035557777", customerEmail: "bob@example.test", customerName: "Bob" })])), "phone_email_customer_conflict");
  });
  it("rejects conflicting populated contact even when the other key matches", () => {
    expectReview(match(source({ customerEmail: "wrong@example.test" })), "phone_email_customer_conflict");
  });
  it("does not hide a populated secondary contact conflict behind another row's missing email", () => {
    const data = history([visit(), visit({ id: 101, customerEmail: null })]);
    expectReview(match(source({ customerEmail: "wrong@example.test" }), data), "phone_email_customer_conflict");
  });
  it("requires unique literal visit reference for shared phone and distinct customers", () => {
    const bob = visit({ id: 101, publicBookingNumber: "LF-801", customerName: "Bob", customerEmail: "bob@example.test", address: "456 Pine Street" });
    expectReview(match(source(), history([visit(), bob])), "shared_contact_multiple_customers");
    const evidence = referenceSource("booking LF-800");
    expect(match(evidence, history([visit(), bob]), candidate(evidence, { references: [{ kind: "booking", value: "LF-800", quote: "booking LF-800" }] }))).toMatchObject({ status: "matched", visit: { id: 100 } });
  });
  it("still requires unique reference for shared phone even if source email would disambiguate", () => {
    const bob = visit({ id: 101, customerName: "Bob", customerEmail: "bob@example.test" });
    expectReview(match(source({ customerEmail: "alice@example.test" }), history([visit(), bob])), "shared_contact_multiple_customers");
  });
  it("allows same customer's multiple addresses with agreeing name/email and no contact conflicts", () => {
    expect(match(source(), history([visit(), visit({ id: 90, jobDate: "2026-11-16", serviceStartUtc: "2026-11-16T15:00:00Z", address: "77 Maple Road" })])).status).toBe("matched");
    expectReview(match(source(), history([visit({ customerName: "", customerEmail: null }), visit({ id: 90, customerName: "", customerEmail: null, address: "77 Maple Road" })])), "shared_contact_multiple_customers");
  });
  it("does not identify by customer name alone or the business's number", () => {
    expectReview(match(source({ customerPhone: null })), "customer_contact_unavailable_or_business_contact");
    expectReview(match(source({ customerPhone: "+17035559999" })), "customer_contact_unavailable_or_business_contact");
  });
  it("blocks same-day unknown start instead of falling back to an older service", () => {
    expectReview(match(source(), history([visit(), visit({ id: 101, jobDate: "2026-11-19", serviceStartUtc: null })])), "same_day_service_time_unknown");
  });
  it("accepts prior-day date-only visit with historical limitations", () => {
    const result = match(source(), history([visit({ serviceStartUtc: null })]));
    expect(result.status).toBe("matched"); expect(result.limitations).toContain("prior_service_date_only_no_exact_start");
  });
  it("never uses job IDs to break tied or ambiguous same-day starts", () => {
    expectReview(match(source(), history([visit(), visit({ id: 101 })])), "service_start_tie");
    expectReview(match(source(), history([visit(), visit({ id: 101, serviceStartUtc: null })])), "multiple_service_visits_with_unknown_times");
  });
  it("selects latest precisely timed completed same-day visit", () => {
    expect(match(source(), history([visit(), visit({ id: 101, serviceStartUtc: "2026-11-18T17:00:00Z" })])).visit?.id).toBe(101);
  });
  it("requires completion strictly before report, including equal starts", () => {
    const evidence = source({ occurredAtUtc: "2026-11-18T15:00:00Z" });
    expectReview(match(evidence), "no_completed_service_before_report");
  });
  it.each(["progressUpdatedAtUtc", "signoffAtUtc"] as const)("reviews %s after report as historically uncertain", field => {
    expectReview(match(source(), history([visit({ [field]: "2026-11-20T12:00:00Z" })])), "historical_completion_uncertain_after_report");
  });
  it.each(["received", "stored", "unknown"] as const)("does not substitute observed/body/current timestamps for %s basis", timeBasis => {
    const evidence = source({ timeBasis, originalText: "The team left the kitchen dirty. Reported 2026-11-19T17:00:00Z" });
    expectReview(match(evidence), "original_report_time_uncertain");
  });
  it("accepts timezone-offset original timestamps, rejects timestamps lacking timezone", () => {
    expect(match(source({ occurredAtUtc: "2026-11-19T12:00:00-05:00" })).status).toBe("matched");
    expectReview(match(source({ occurredAtUtc: "2026-11-19T12:00:00" })), "original_report_time_uncertain");
  });
  it("rejects rolled-over invalid timestamps rather than accepting JavaScript date normalization", () => {
    expectReview(match(source({ occurredAtUtc: "2026-11-19T24:00:00Z" })), "original_report_time_uncertain");
    expectReview(match(source({ occurredAtUtc: "2026-02-30T12:00:00Z" })), "original_report_time_uncertain");
  });
  it("assigns late complaint to service Sunday, not report week, without forcing deductions", () => {
    const old = visit({ jobDate: "2026-11-13", serviceStartUtc: "2026-11-13T15:00:00Z", jobUpdatedAtUtc: "2026-11-13T19:00:00Z" });
    expect(match(source(), history([old]))).toMatchObject({ status: "matched", affectedWeekStart: "2026-11-08", includedInRequestedWeek: false, verified: false, eligibleForScore: false });
  });
  it("accepts requested Sunday 15 through Saturday 21 and uses service-local date", () => {
    const sunday = visit({ jobDate: "2026-11-15", serviceStartUtc: "2026-11-16T02:00:00Z" });
    expect(match(source(), history([sunday])).affectedWeekStart).toBe("2026-11-15");
  });
  it("uses reader-normalized local IDs without remapping imported/captured numeric collisions", () => {
    const data = history([visit({ storedTeamId: 7 })], { teams: [{ id: 901, name: "Wrong local namespace", launch27TeamId: 7 }, { id: 7, name: "Imported crew", launch27TeamId: 901 }] });
    expect(match(source(), data).team?.id).toBe(7);
    expect(match(source(), { ...data, visits: [visit({ storedTeamId: 7, signoffTeamId: 7 })] }).team?.basis).toBe("signoff");
    expect(match(source(), history([nativeVisit()])).team?.id).toBe(1);
  });
  it("rejects multiple mapping rows rather than guessing from names", () => {
    expectReview(match(source(), history([visit()], { teams: [{ id: 1, name: "Team One", launch27TeamId: 901 }, { id: 1, name: "Team One duplicate", launch27TeamId: 902 }] })), "ambiguous_team_id_mapping");
    expectReview(match(source(), history([visit({ storedTeamId: null, storedTeamName: "Team One" })])), "service_team_not_resolved");
  });
  it("uses captured signoff then completed progress ahead of stored team", () => {
    expect(match(source(), history([visit({ signoffTeamId: 1, signoffAtUtc: "2026-11-18T19:00:00Z", progressStatus: "completed", progressTeamId: 1 })])).team?.basis).toBe("signoff");
    expect(match(source(), history([visit({ progressStatus: "completed", progressTeamId: 1 })])).team?.basis).toBe("progress");
  });
  it("reviews signoff/progress disagreement while retaining captured team", () => {
    const result = match(source(), history([visit({ signoffTeamId: 1, progressStatus: "completed", progressTeamId: 2 })]));
    expectReview(result, "signoff_progress_team_conflict"); expect(result.team?.id).toBe(1);
  });
  it("uses native historical interval even when assignment is now unassigned", () => {
    const data = history([nativeVisit()], { assignments: [assignment({ status: "unassigned", unassignedAtUtc: "2026-11-18T19:00:00Z" })] });
    expect(match(source(), data)).toMatchObject({ status: "matched", team: { id: 1, basis: "assignment_at_service" } });
  });
  it("does not transfer incident to later reassignment and flags conflicting history", () => {
    const data = history([nativeVisit({ storedTeamId: 2, storedTeamName: "Team Two" })], { assignments: [
      assignment({ status: "unassigned", unassignedAtUtc: "2026-11-18T19:00:00Z" }),
      assignment({ id: 2, teamId: 2, teamName: "Team Two", assignedAtUtc: "2026-11-19T12:00:00Z" }),
    ] });
    const result = match(source(), data);
    expectReview(result, "later_assignment_conflicts_with_service_team"); expect(result.team?.id).toBe(1);
    expect(result.reviewReasons).toContain("historical_team_sources_conflict");
  });
  it("does not choose later/future assignment as default when stored team is absent", () => {
    const result = match(source(), history([nativeVisit({ storedTeamId: null })], { assignments: [assignment({ teamId: 2, assignedAtUtc: "2026-11-20T12:00:00Z" })] }));
    expectReview(result, "service_team_not_resolved"); expect(result.team).toBeNull();
  });
  it("reviews missing interval times unless captured signoff resolves attribution", () => {
    const assignments = [assignment({ assignedAtUtc: null })];
    expectReview(match(source(), history([nativeVisit()], { assignments })), "assignment_interval_time_uncertain");
    const result = match(source(), history([nativeVisit({ signoffTeamId: 1, signoffAtUtc: "2026-11-18T18:00:00Z" })], { assignments }));
    expect(result.status).toBe("matched"); expect(result.limitations).toContain("assignment_interval_uncertain_resolved_by_captured_signoff");
  });
  it("reviews overlapping historical teams and name concatenation", () => {
    expectReview(match(source(), history([nativeVisit()], { assignments: [assignment(), assignment({ id: 2, teamId: 2, teamName: "Team Two" })] })), "multiple_teams_assigned_at_service");
    expectReview(match(source(), history([visit({ storedTeamName: "Team One, Team Two" })])), "multiple_team_names_ambiguous");
  });
  it("reviews ampersand and plain concatenated crew names without using them as identity", () => {
    expectReview(match(source(), history([visit({ storedTeamName: "Team One&Team Two" })])), "multiple_team_names_ambiguous");
    expectReview(match(source(), history([visit({ storedTeamName: "Team One Team Two" })])), "multiple_team_names_ambiguous");
  });
  it("reviews imported latest team snapshots updated after complaint", () => {
    expectReview(match(source(), history([visit({ jobUpdatedAtUtc: "2026-11-20T12:00:00Z" })])), "stored_team_snapshot_updated_after_report");
  });
  it("supports undiarized call contact/visit lookup with speaker review limitations but never verification", () => {
    const result = match(source({ id: "call:1", sourceKind: "human_call", speakerBasis: "unverified" }));
    expect(result.status).toBe("matched"); expect(result.visit?.id).toBe(100);
    expect(result.reviewReasons).toContain("call_speaker_unverified_fault_not_verified");
    expect(result.limitations).toContain("call_speaker_not_verified_customer"); expect(result.verified).toBe(false);
  });
  it("does not extend the undiarized call exception to unverified email routing/speaker", () => {
    expectReview(match(source({ sourceKind: "email", speakerBasis: "unverified" })), "non_call_customer_speaker_unverified");
  });
  it("does not attribute known noncustomer caller messages", () => {
    expectReview(match(source({ speakerBasis: "non_customer", originalText: "The team left the kitchen dirty. Hiring inquiry" })), "non_customer_evidence");
  });
  it.each(["hiring", "billing", "not_a_complaint"])("rejects unapproved candidate category %s at runtime", category => {
    const evidence = source();
    const input = { ...candidate(evidence), category } as unknown as TeamComplaintCandidate;
    expectReview(match(evidence, history(), input), "invalid_candidate_schema");
  });
  it("requires candidate literal quotes and reference quotes in ORIGINAL evidence", () => {
    const evidence = source();
    expectReview(match(evidence, history(), candidate(evidence, { evidenceQuotes: ["translated kitchen complaint"] })), "quote_not_literal_original_evidence");
    expectReview(match(evidence, history(), candidate(evidence, { references: [{ kind: "booking", value: "LF-800", quote: "booking LF-800" }] })), "quote_not_literal_original_evidence");
  });
  it("rejects model-invented reference values even when the quoted text is literal", () => {
    const evidence = referenceSource("booking LF-800");
    expectReview(match(evidence, history(), candidate(evidence, { references: [{ kind: "booking", value: "LF-999", quote: "booking LF-800" }] })), "unsupported_booking_reference");
    expectReview(match(evidence, history(), candidate(evidence, { references: [{ kind: "service_date", value: "2026-11-18", quote: "booking LF-800" }] })), "unsupported_service_date_reference");
  });
  it("retains a uniquely address-referenced cancelled visit for review without fallback", () => {
    const evidence = referenceSource("77 Maple Road");
    const data = history([visit(), visit({ id: 101, address: "77 Maple Road", bookingStatus: "cancelled" })]);
    const input = candidate(evidence, { references: [{ kind: "address", value: "77 Maple Road", quote: "77 Maple Road" }] });
    const result = match(evidence, data, input);
    expectReview(result, "referenced_service_not_completed"); expect(result.visit?.id).toBe(101);
  });
  it("cannot certify stored native team when its only assignment begins after the service", () => {
    const data = history([nativeVisit()], { assignments: [assignment({ assignedAtUtc: "2026-11-19T12:00:00Z" })] });
    expectReview(match(source(), data), "stored_team_supported_only_by_later_assignment");
  });
  it("rejects translation snapshots even when their quotes are literal", () => {
    expectReview(match(source({ bodyBasis: "snapshot", limitations: ["Stored English translation is a non-original variant, not eligible original complaint evidence"] })), "non_original_translation_evidence");
  });
  it("surfaces reader-detected visit contact or ambiguous provider-team mapping conflicts", () => {
    expectReview(match(source(), history(undefined, { limitations: ["Visit 100: operational/canonical contact conflict; explicit review required"] })), "visit_history_identity_or_mapping_conflict");
    expectReview(match(source(), history(undefined, { limitations: ["Visit 100 stored assignment: launch27 team 901 has missing/ambiguous scheduling mapping"] })), "visit_history_identity_or_mapping_conflict");
  });
  it.each(["snippet", "missing"] as const)("rejects %s bodies even if quote happens to match", bodyBasis => {
    expectReview(match(source({ bodyBasis })), "original_evidence_body_unavailable");
  });
  it("fails closed for unknown evidence IDs, invalid hashes, or stale revision", () => {
    const evidence = source();
    expectReview(match(evidence, history(), candidate(evidence, { evidenceId: "fake:id" })), "unknown_or_stale_evidence_binding");
    expectReview(match(evidence, history(), candidate(evidence, { evidenceRevision: "f".repeat(64) })), "unknown_or_stale_evidence_binding");
    expectReview(match(evidence, history(), candidate(evidence, { evidenceRevision: "not-a-sha256" })), "invalid_candidate_schema");
  });
  it("does not select between conflicting copies of the same canonical ID", () => {
    const evidence = source(), conflict = source({ originalText: "A different snapshot" });
    const result = matchTeamComplaintCandidates([candidate(evidence)], [evidence, conflict], history(), window)[0];
    expectReview(result, "conflicting_canonical_evidence_binding");
  });
  it("preserves history/evidence coverage limitations without forcing every routine match to manual review", () => {
    const result = match(source({ limitations: ["source coverage warning"] }), history(undefined, { complete: false, limitations: ["older historical rows unavailable"] }));
    expect(result.status).toBe("matched"); expect(result.limitations).toEqual(expect.arrayContaining(["source coverage warning", "older historical rows unavailable", "visit_history_incomplete"]));
  });
  it("does not mutate candidate/evidence/history inputs", () => {
    const evidence = source(), input = candidate(evidence), data = history();
    const before = JSON.stringify({ evidence, input, data, window });
    match(evidence, data, input);
    expect(JSON.stringify({ evidence, input, data, window })).toBe(before);
  });
});

describe("complaint visit grouping without deductions", () => {
  it("groups repeated SMS/email/calls and multiple categories once while retaining every match", () => {
    const sms = source(), email = source({ id: "email:2", sourceKind: "email", providerId: "mail-2" });
    const call = source({ id: "call:3", sourceKind: "human_call", speakerBasis: "unverified", providerId: "call-3" });
    const inputs = [candidate(sms), candidate(sms, { category: "reclean_request" }), candidate(email, { category: "refund_request" }), candidate(call)];
    const matches = matchTeamComplaintCandidates(inputs, [sms, email, call], history(), window);
    const groups = groupTeamComplaintVisits(matches);
    expect(groups).toHaveLength(1); expect(groups[0].matches).toHaveLength(4);
    expect(groups[0].evidenceIds).toEqual([sms.id, email.id, call.id]);
    expect(groups[0]).toMatchObject({ visitId: 100, teamId: 1, verified: false, eligibleForScore: false });
  });
  it("does not merge different visits or include ambiguous/unmatched evidence", () => {
    const evidence = referenceSource("booking LF-800"), other = referenceSource("booking LF-700"); other.id = "sms:2";
    const inputs = [candidate(evidence, { references: [{ kind: "booking", value: "LF-800", quote: "booking LF-800" }] }),
      candidate(other, { references: [{ kind: "booking", value: "LF-700", quote: "booking LF-700" }] }),
      candidate(evidence, { evidenceRevision: "f".repeat(64) })];
    const data = history([visit(), visit({ id: 90, publicBookingNumber: "LF-700", jobDate: "2026-11-16", serviceStartUtc: "2026-11-16T15:00:00Z" })]);
    const matches = matchTeamComplaintCandidates(inputs, [evidence, other], data, window);
    const groups = groupTeamComplaintVisits(matches);
    expect(groups).toHaveLength(2); expect(groups.map(group => group.matches.length)).toEqual([1, 1]);
  });
  it("does not merge across teams even for the same visit identity", () => {
    const first = match();
    const second = { ...first, team: { id: 2, name: "Team Two", basis: "stored_visit" as const } };
    expect(groupTeamComplaintVisits([first, second])).toHaveLength(2);
  });
  it("retains conflicting messages from the same provider rather than deduplicating away evidence", () => {
    const first = source(), second = source({ id: "sms:2", originalText: "The team left the kitchen dirty. Also dust." });
    const matches = matchTeamComplaintCandidates([candidate(first), candidate(second)], [first, second], history(), window);
    const group = groupTeamComplaintVisits(matches)[0];
    expect(group.evidenceIds).toEqual([first.id, second.id]); expect(group.matches).toHaveLength(2);
    expect(group.matches.every(item => item.limitations.includes("same_provider_conflicting_evidence_retained"))).toBe(true);
  });
});
