import { describe, expect, expectTypeOf, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import ts from "typescript";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { InvokeParams, InvokeResult } from "../_core/llm";
import {
  INSTINCT_CONTRACT_VERSION, STAGE1_CAPABILITIES,
  analysisOutputSchema, analysisOutputJsonSchema, analysisReceiptSchema, analysisRequestSchema, askInputSchema, authorizedScopeSchema,
  bigintIdSchema, checkInputSchema, contextManifestSchema, coverageReceiptSchema, evidenceRefSchema,
  evidenceToolCallSchema, expectationSchema, feedInputSchema, hasCompleteAnalyzedCoverage,
  instinctIssueSchema, nativeRecordSchema, nativeSnapshotSchema, notificationObservationSchema,
  occurrenceResolutionSchema, originalTurnSchema, requestBindingSchema, sourceContextSchema,
  sourceContinuationSchema, sourcesInputSchema, stage1CapabilitiesSchema, storedEvidenceSchema,
  targetOccurrenceSchema, validateCitation, validateEvidenceRef, validateIdentityScope,
  validateAnalysisOutput, validateResponseBinding,
  verificationResultSchema, verifiedIdentitySchema,
  type AuthorizedScope, type AnalysisReceipt, type CoverageReceipt, type EvidenceRef, type Expectation,
  type InstinctInvokeParams, type InstinctInvokeResult, type InstinctIssue, type ModelCallable,
  type NativeRecord, type NativeSnapshot, type SourceContext, type StoredEvidence, type TargetOccurrence,
  type VerifiedIdentity, type ReadonlyInstinctStore, type InstinctApi,
} from "../../shared/instinct";

const timestamp = "2026-11-13T18:00:00.000Z";
const hash = "a".repeat(64);
const scope: AuthorizedScope = { installationScope: "installed-fixture", sourceAccountKey: "stored-fixture", authorizationVersion: "auth-v1", actor: { staffId: "9007199254740993", role: "admin" } };
function ref(overrides: Partial<EvidenceRef> = {}): EvidenceRef {
  return { store: "conversation_sessions", sourceKind: "sms", sourceId: "session:7:message:0", providerId: "provider-message-9", sourceRevision: "source-r1", contextFingerprint: hash, sourceAccountKey: scope.sourceAccountKey, sessionId: "7", threadId: null, occurredAtUtc: timestamp, observedAtUtc: timestamp, timeBasis: "history", handlingEvidence: null, ...overrides };
}
function evidence(overrides: Partial<StoredEvidence> = {}): StoredEvidence {
  return { ref: ref(), originalText: "Please move to 9 AM. Thanks!", originalTurns: [], translatedText: null, participants: { from: "+13015550123", to: ["+13015550456"], cc: [], replyTo: null, businessLine: "+13015550456", mailbox: null }, direction: "inbound", contentBasis: "original_full", availability: "complete", limitations: [], ...overrides };
}
function context(item = evidence()): SourceContext {
  return { manifest: { contextId: "context-7", revision: "context-r1", contextFingerprint: hash, sourceAccountKey: scope.sourceAccountKey, entries: [{ ref: item.ref, ordinal: 0, originalTextLength: item.originalText?.length ?? null, turnCount: item.originalTurns.length, availability: item.availability }], complete: item.availability === "complete", continuation: null, capturedAtUtc: timestamp, limitations: item.limitations }, evidence: [item] };
}
function coverage(overrides: Partial<CoverageReceipt> = {}): CoverageReceipt {
  return { receiptId: "coverage-1", authorizedScope: scope.installationScope, sourceAccountKey: scope.sourceAccountKey, sourceKinds: ["sms"], boundaries: [{ store: "conversation_sessions", throughId: "7", observedAtUtc: timestamp, availability: "complete", limitations: [] }], continuation: null, read: 1, analyzed: 1, unprocessed: 0, unavailable: 0, partial: false, exclusions: [], checkedAtUtc: timestamp, ...overrides };
}
function identity(overrides: Partial<VerifiedIdentity> = {}): VerifiedIdentity {
  return { installationScope: scope.installationScope, sourceAccountKey: scope.sourceAccountKey, phone: "+13015550123", email: null, sessionIds: ["7"], customerPortalAccountId: null, decision: "verified", reasons: [], evidenceRefs: [ref()], fingerprint: hash, displayName: "Synthetic fixture", ...overrides };
}
function target(overrides: Partial<TargetOccurrence> = {}): TargetOccurrence {
  return { bookingId: "1", jobId: null, launch27BookingId: null, bookingSeriesId: null, publicBookingNumber: "LF-FIXTURE", scope: "visit", localDate: "2026-11-16", localTime: "09:00", arrivalWindow: null, timeZone: "America/New_York", occurredAtUtc: "2026-11-16T14:00:00.000Z", ...overrides };
}
function expected(overrides: Partial<Expectation> = {}): Expectation {
  return { bookingReference: "LF-FIXTURE", date: "2026-11-16", originalDate: null, time: "09:00", timeKind: "exact", windowEnd: null, timeZone: "America/New_York", scope: "visit", address: null, serviceName: null, extras: null, extrasMode: "unspecified", teamName: null, amountCents: null, notes: null, notesDestination: "unspecified", ...overrides };
}
function record(overrides: Partial<NativeRecord> = {}): NativeRecord {
  return { key: "booking:1", source: "bookings", bookingId: "1", jobId: null, launch27BookingId: null, bookingSeriesId: null, publicBookingNumber: "LF-FIXTURE", customerPhone: "+13015550123", customerEmail: "fixture@example.test", customerName: "Synthetic fixture", localDate: "2026-11-16", localTime: "09:00", timeZone: "America/New_York", arrivalWindow: null, requestedStartAt: "1794837600000", serviceDateTime: null, status: "confirmed", address: "Fixture address", serviceId: "standard", serviceName: "Standard cleaning", extras: [], recurrence: "one-time", teamName: null, companyNotes: "Gate code 2841", specialRequestNotes: [], customerNotes: null, cleanerFacingNotes: "Gate code 2841", notesBasis: "canonical_composition", availability: "complete", limitations: [], fingerprint: hash, observedAtUtc: timestamp, updatedAtUtc: timestamp, ...overrides };
}
function snapshot(overrides: Partial<NativeSnapshot> = {}): NativeSnapshot {
  return { snapshotId: "snapshot-1", sourceAccountKey: scope.sourceAccountKey, records: [record()], fingerprint: hash, checkedAtUtc: timestamp, availability: "complete", continuation: null, limitations: [], ...overrides };
}
function analysis(overrides: Partial<AnalysisReceipt> = {}): AnalysisReceipt {
  return { status: "complete", contextRevision: "context-r1", contextFingerprint: hash, actions: [], totalSegments: 1, completedSegments: 1, reductionComplete: true, failure: null, limitations: [], ...overrides };
}
function noAction(overrides: Partial<InstinctIssue> = {}): InstinctIssue {
  return { issueId: "issue-1", revision: "issue-r1", identity: identity(), action: null, expectation: null, target: target({ bookingId: null, publicBookingNumber: null, scope: "unspecified", localDate: null, localTime: null, occurredAtUtc: null }), citations: [], outcome: "no_action", explanation: "No operational request in complete original evidence.", priorityReason: null, recordFingerprint: null, checkedAtUtc: timestamp, coverage: coverage(), analysis: analysis(), verification: null, fulfillment: "unknown", notification: "unknown", delivery: "unknown", supersededBy: null, transient: true, ...overrides };
}

 describe("Instinct exact normalized source contracts", () => {
  it("keeps stored IDs, provider IDs, context and source revisions distinct", () => {
    const parsed = evidenceRefSchema.parse(ref());
    expect(parsed.sourceId).not.toBe(parsed.providerId);
    expect(parsed.sourceRevision).not.toBe(parsed.contextFingerprint);
    expect(Object.isFrozen(parsed)).toBe(true);
  });
  it.each([1, 9007199254740992, "0", "1.5", "-1", "01", "1e20"])("rejects a lossy or malformed BIGINT ID %s", value => {
    expect(bigintIdSchema.safeParse(value).success).toBe(false);
  });
  it("round-trips a BIGINT string beyond the safe integer range", () => {
    const value = "9223372036854775807";
    expect(JSON.parse(JSON.stringify(bigintIdSchema.parse(value)))).toBe(value);
    expect(authorizedScopeSchema.parse(scope).actor.staffId).toBe("9007199254740993");
  });
  it("rejects invented stores, source-kind relabeling and client customer foreign keys", () => {
    expect(evidenceRefSchema.safeParse({ ...ref(), store: "arbitrary_store" }).success).toBe(false);
    expect(evidenceRefSchema.safeParse(ref({ sourceKind: "email" })).success).toBe(false);
    expect(nativeRecordSchema.safeParse({ ...record(), customerId: "99" }).success).toBe(false);
  });
  it("does not infer human handling from the provider", () => {
    const unverified = ref({ store: "openphone_call_recordings", sourceKind: "phone_unverified", sourceId: "call:1", sessionId: null, timeBasis: "call_started" });
    expect(evidenceRefSchema.safeParse(unverified).success).toBe(true);
    expect(evidenceRefSchema.safeParse({ ...unverified, sourceKind: "human_call" }).success).toBe(false);
  });
  it("keeps unknown occurrence time honest and never uses observation time as occurrence", () => {
    expect(evidenceRefSchema.safeParse(ref({ occurredAtUtc: null, timeBasis: "unknown" })).success).toBe(true);
    expect(evidenceRefSchema.safeParse(ref({ timeBasis: "stored_record" })).success).toBe(false);
    expect(evidenceRefSchema.safeParse(ref({ timeBasis: "received" })).success).toBe(false);
  });
  it("allows stored-only partial email snapshots with missing mailbox/headers but not complete originals", () => {
    const item = evidence({ ref: ref({ store: "madison_email_drafts", sourceKind: "email", sourceId: "draft:4", providerId: null, sessionId: null, threadId: "gmail-thread-4", occurredAtUtc: null, timeBasis: "stored_record" }), contentBasis: "stored_snapshot", availability: "partial", limitations: ["Original body, date, mailbox and recipient headers are unproven"] });
    expect(storedEvidenceSchema.safeParse(item).success).toBe(true);
    expect(storedEvidenceSchema.safeParse({ ...item, availability: "complete", contentBasis: "original_full", limitations: [] }).success).toBe(false);
  });
  it("rejects missing, snippet, translation and malformed evidence claiming a complete body", () => {
    for (const item of [evidence({ originalText: null }), evidence({ contentBasis: "snippet" }), evidence({ contentBasis: "translation_only", translatedText: "translated" }), evidence({ limitations: ["Malformed source entries"] })]) expect(storedEvidenceSchema.safeParse(item).success).toBe(false);
  });
  it("validates original dialogue against exact UTF-16 offsets, preserving unicode", () => {
    const text = "Hi 👋\nGate 2841";
    const turn = { turnId: "turn-0", speaker: null, role: "unknown" as const, text, start: 0, end: text.length, occurredAtUtc: null, timeBasis: "unknown" as const };
    expect(originalTurnSchema.safeParse(turn).success).toBe(true);
    expect(storedEvidenceSchema.safeParse(evidence({ originalText: text, originalTurns: [turn] })).success).toBe(true);
    expect(storedEvidenceSchema.safeParse(evidence({ originalText: text, originalTurns: [{ ...turn, text: "Hi 🐈\nGate 2841" }] })).success).toBe(false);
  });
  it("rejects forged refs after shape validation, including metadata/revision/account changes", () => {
    const originals = [evidence()];
    expect(validateEvidenceRef(ref(), scope, originals)).toEqual(ref());
    for (const forged of [ref({ sourceAccountKey: "other-account" }), ref({ sourceId: "other-source" }), ref({ providerId: "other-provider" }), ref({ sourceRevision: "old-revision" }), ref({ observedAtUtc: "2026-11-13T19:00:00.000Z" }), ref({ sessionId: "88" })]) expect(() => validateEvidenceRef(forged, scope, originals)).toThrow("INVALID_SOURCE_REFERENCE");
  });
  it("rejects fabricated quotes, offsets and references and accepts exact original text only", () => {
    const quote = { ref: ref(), start: 0, end: 6, exactQuote: "Please" };
    expect(validateCitation(quote, scope, [evidence()]).exactQuote).toBe("Please");
    expect(() => validateCitation({ ...quote, exactQuote: "Change" }, scope, [evidence()])).toThrow("INVALID_CITATION");
    expect(() => validateCitation({ ...quote, start: 1, end: 7 }, scope, [evidence()])).toThrow("INVALID_CITATION");
    expect(() => validateCitation({ ...quote, ref: ref({ sourceAccountKey: "other" }) }, scope, [evidence()])).toThrow("INVALID_SOURCE_REFERENCE");
    expect(() => validateCitation({ ...quote, end: 99 }, scope, [evidence()])).toThrow();
  });
  it("requires the full exact manifest and does not allow partial, missing or out-of-order context to be complete", () => {
    expect(sourceContextSchema.safeParse(context()).success).toBe(true);
    expect(sourceContextSchema.safeParse({ ...context(), evidence: [] }).success).toBe(false);
    expect(sourceContextSchema.safeParse({ ...context(), evidence: [evidence({ originalText: "different" })] }).success).toBe(false);
    const manifest = context().manifest;
    expect(contextManifestSchema.safeParse({ ...manifest, continuation: "remaining" }).success).toBe(false);
    expect(contextManifestSchema.safeParse({ ...manifest, entries: [{ ...manifest.entries[0], ordinal: 1 }] }).success).toBe(false);
    expect(contextManifestSchema.safeParse({ ...manifest, entries: [{ ...manifest.entries[0], availability: "partial" }] }).success).toBe(false);
  });
  it("binds continuation to server-authorized inventory without a tail exclusion", () => {
    const boundary = { inventoryId: "inventory-1", sourceAccountKey: scope.sourceAccountKey, authorizationVersion: "auth-v1", sourceKinds: ["sms"], families: coverage().boundaries, capturedAtUtc: timestamp };
    const cursor = { inventoryId: "inventory-1", sourceAccountKey: scope.sourceAccountKey, authorizationVersion: "auth-v1", boundary, positions: [{ store: "conversation_sessions", afterId: "7", historyOffset: 50123 }], phase: "inventory" };
    expect(sourceContinuationSchema.safeParse(cursor).success).toBe(true);
    expect(sourceContinuationSchema.safeParse({ ...cursor, sourceAccountKey: "forged" }).success).toBe(false);
    expect(sourceContinuationSchema.safeParse({ ...cursor, limit: 100 }).success).toBe(false);
  });
});

 describe("Instinct exact identity, occurrence and native snapshot contracts", () => {
  it("requires actual contact evidence, not a name or invented customer link", () => {
    expect(verifiedIdentitySchema.safeParse(identity()).success).toBe(true);
    expect(verifiedIdentitySchema.safeParse(identity({ phone: null, displayName: "Known-looking name" })).success).toBe(false);
    expect(verifiedIdentitySchema.safeParse(identity({ evidenceRefs: [] })).success).toBe(false);
    expect(verifiedIdentitySchema.safeParse(identity({ phone: "+441234567890" })).success).toBe(false);
    expect(verifiedIdentitySchema.safeParse(identity({ email: "Upper@Example.test" })).success).toBe(false);
    expect(verifiedIdentitySchema.safeParse(identity({ decision: "ambiguous", reasons: ["Shared phone"], fingerprint: null })).success).toBe(true);
  });
  it("validates server installation/account and exact identity refs independently of shape", () => {
    expect(validateIdentityScope(identity(), scope, [evidence()]).phone).toBe(identity().phone);
    expect(() => validateIdentityScope(identity({ installationScope: "other" }), scope, [evidence()])).toThrow("INVALID_IDENTITY_SCOPE");
    expect(() => validateIdentityScope(identity({ evidenceRefs: [ref({ sourceId: "forged" })] }), scope, [evidence()])).toThrow("INVALID_SOURCE_REFERENCE");
  });
  it("preserves exact native public, canonical, operational, external and series identities", () => {
    expect(nativeRecordSchema.safeParse(record()).success).toBe(true);
    expect(nativeRecordSchema.safeParse(record({ key: "booking:2" })).success).toBe(false);
    expect(nativeRecordSchema.safeParse(record({ publicBookingNumber: null })).success).toBe(false);
    expect(nativeRecordSchema.safeParse(record({ source: "leadflow_jobs", key: "leadflow:job:8", jobId: "8", bookingId: null, publicBookingNumber: null, launch27BookingId: "1234", notesBasis: "operational_customer_notes" })).success).toBe(true);
  });
  it("keeps visit, subsequent and series scope and window versus exact time distinct", () => {
    expect(targetOccurrenceSchema.safeParse(target({ scope: "series", bookingSeriesId: "42" })).success).toBe(true);
    expect(targetOccurrenceSchema.safeParse(target({ scope: "subsequent" })).success).toBe(true);
    expect(targetOccurrenceSchema.safeParse(target({ localTime: null, arrivalWindow: { start: "12:00", end: "17:00" } })).success).toBe(true);
    expect(targetOccurrenceSchema.safeParse(target({ arrivalWindow: { start: "12:00", end: "17:00" } })).success).toBe(false);
    expect(targetOccurrenceSchema.safeParse(target({ localDate: "2026-02-30" })).success).toBe(false);
    expect(targetOccurrenceSchema.safeParse(target({ timeZone: "Invented/Zone" })).success).toBe(false);
  });
  it("does not convert partial or continued native reads into a complete current snapshot", () => {
    expect(nativeSnapshotSchema.safeParse(snapshot()).success).toBe(true);
    expect(nativeSnapshotSchema.safeParse(snapshot({ continuation: "remaining" })).success).toBe(false);
    expect(nativeSnapshotSchema.safeParse(snapshot({ records: [record({ availability: "partial", limitations: ["Missing canonical counterpart"] })] })).success).toBe(false);
    expect(occurrenceResolutionSchema.safeParse({ decision: "verified", target: target(), eligibleRecordKeys: ["booking:2"], reasons: [], snapshot: snapshot() }).success).toBe(false);
  });
  it("requires fresh exact proof for a match but never requires notification or delivery", () => {
    const verification = { outcome: "matches_current", identity: identity(), target: target(), snapshot: snapshot(), explanation: "Current local time is 09:00", limitations: [], priorityReason: null, recordFingerprint: hash, checkedAtUtc: timestamp, fulfillment: "verified_current", notification: "unknown", delivery: "unknown" };
    expect(verificationResultSchema.safeParse(verification).success).toBe(true);
    expect(verificationResultSchema.safeParse({ ...verification, snapshot: null }).success).toBe(false);
    expect(verificationResultSchema.safeParse({ ...verification, checkedAtUtc: "2026-11-13T19:00:00.000Z" }).success).toBe(false);
    expect(verificationResultSchema.safeParse({ ...verification, identity: identity({ decision: "ambiguous", reasons: ["Conflicting contact"] }) }).success).toBe(false);
    expect(verificationResultSchema.safeParse({ ...verification, snapshot: snapshot({ sourceAccountKey: "other" }) }).success).toBe(false);
    expect(verificationResultSchema.safeParse({ ...verification, target: target({ bookingId: "99" }) }).success).toBe(false);
    expect(verificationResultSchema.safeParse({ ...verification, outcome: "discrepancy", fulfillment: "not_verified" }).success).toBe(true);
  });
});

 describe("Instinct extraction, outcomes and independent evidence axes", () => {
  it("accepts a full typed request and rejects client actor, SQL and forged scope fields", () => {
    const request = { context: context(), localDate: "2026-11-13", timeZone: "America/New_York", contractVersion: INSTINCT_CONTRACT_VERSION, promptVersion: "prompt-v1", segmentationVersion: "segment-v1", reductionVersion: "reduce-v1" };
    expect(analysisRequestSchema.safeParse(request).success).toBe(true);
    expect(analysisRequestSchema.safeParse({ ...request, actor: { staffId: "99" } }).success).toBe(false);
    expect(sourcesInputSchema.safeParse({ sourceKinds: ["sms"], sourceAccountKey: "other" }).success).toBe(false);
    expect(checkInputSchema.safeParse({ sourceRefs: [ref()], expectedContextRevision: "context-r1", sql: "SELECT secret" }).success).toBe(false);
  });
  it("uses a strict action taxonomy and original indexes instead of model-created customer IDs", () => {
    const action = { action: "reschedule", agreement: "requested", anchorEvidenceIndex: 0, citations: [{ evidenceIndex: 0, start: 0, end: 6, exactQuote: "Please" }], expected: expected(), explanation: "Move the stated occurrence", confidence: 0.9, ambiguous: false, missingParameters: [], supersededByEvidenceIndex: null };
    expect(analysisOutputSchema.safeParse({ actions: [action] }).success).toBe(true);
    expect(analysisOutputSchema.safeParse({ actions: [{ ...action, customerId: "44" }] }).success).toBe(false);
    expect(analysisOutputSchema.safeParse({ actions: [{ ...action, action: "execute_sql" }] }).success).toBe(false);
    expect(analysisOutputSchema.safeParse({ actions: [{ ...action, outcome: "matches_current" }] }).success).toBe(false);
    expect(analysisOutputSchema.safeParse({ actions: Array.from({ length: 201 }, () => action) }).success).toBe(true);
  });
  it("validates every model index and quote against the actual authorized context", () => {
    const request = { context: context(), localDate: "2026-11-13", timeZone: "America/New_York", contractVersion: INSTINCT_CONTRACT_VERSION, promptVersion: "prompt-v1", segmentationVersion: "segment-v1", reductionVersion: "reduce-v1" };
    const action = { action: "reschedule", agreement: "requested", anchorEvidenceIndex: 0, citations: [{ evidenceIndex: 0, start: 0, end: 6, exactQuote: "Please" }], expected: expected(), explanation: "Move the stated occurrence", confidence: 0.9, ambiguous: false, missingParameters: [], supersededByEvidenceIndex: null };
    expect(validateAnalysisOutput({ actions: [action] }, request, scope).actions).toHaveLength(1);
    expect(() => validateAnalysisOutput({ actions: [{ ...action, anchorEvidenceIndex: 99 }] }, request, scope)).toThrow("INVALID_SOURCE_REFERENCE");
    expect(() => validateAnalysisOutput({ actions: [{ ...action, supersededByEvidenceIndex: 99 }] }, request, scope)).toThrow("INVALID_SOURCE_REFERENCE");
    expect(() => validateAnalysisOutput({ actions: [{ ...action, citations: [{ evidenceIndex: 0, start: 0, end: 6, exactQuote: "Change" }] }] }, request, scope)).toThrow("INVALID_CITATION");
    expect(() => validateAnalysisOutput({ actions: [] }, request, { ...scope, sourceAccountKey: "forged" })).toThrow("INVALID_SOURCE_REFERENCE");
    expect(analysisOutputJsonSchema).toMatchObject({ type: "object", additionalProperties: false });
  });
  it("validates arrival-window expectation semantics and preserves access codes without imposing length caps", () => {
    expect(expectationSchema.safeParse(expected({ timeKind: "window", time: "12:00", windowEnd: "17:00", notes: "Gate 2841" })).success).toBe(true);
    expect(expectationSchema.safeParse(expected({ timeKind: "window", windowEnd: null })).success).toBe(false);
    expect(expectationSchema.safeParse(expected({ notes: "2841 ".repeat(20000), notesDestination: "cleaner_instructions" })).success).toBe(true);
  });
  it("requires every segment and the complete reduction before claiming analysis complete", () => {
    expect(analysisReceiptSchema.safeParse(analysis()).success).toBe(true);
    expect(analysisReceiptSchema.safeParse(analysis({ totalSegments: 2 })).success).toBe(false);
    expect(analysisReceiptSchema.safeParse(analysis({ reductionComplete: false })).success).toBe(false);
    expect(analysisReceiptSchema.safeParse(analysis({ failure: "MODEL_UNAVAILABLE" })).success).toBe(false);
    expect(analysisReceiptSchema.safeParse(analysis({ status: "unavailable", failure: "MODEL_UNAVAILABLE" })).success).toBe(true);
  });
  it("partitions coverage accurately and distinguishes an empty analyzed scope from a negative finding", () => {
    expect(coverageReceiptSchema.safeParse(coverage()).success).toBe(true);
    expect(hasCompleteAnalyzedCoverage(coverage({ read: 0, analyzed: 0 }))).toBe(false);
    expect(coverageReceiptSchema.safeParse(coverage({ analyzed: 2 })).success).toBe(false);
    expect(coverageReceiptSchema.safeParse(coverage({ analyzed: 0, unprocessed: 1 })).success).toBe(false);
    expect(coverageReceiptSchema.safeParse(coverage({ analyzed: 0, unprocessed: 1, partial: true })).success).toBe(true);
    expect(coverageReceiptSchema.safeParse(coverage({ continuation: "next-page" })).success).toBe(false);
  });
  it("unknown notification and delivery do not prohibit a sufficiently complete no-action result", () => {
    expect(instinctIssueSchema.safeParse(noAction()).success).toBe(true);
    expect(instinctIssueSchema.safeParse(noAction({ notification: "unknown", delivery: "failed" })).success).toBe(true);
  });
  it.each(["pending", "partial", "unavailable"] as const)("%s analysis cannot become a complete no-action finding", status => {
    expect(instinctIssueSchema.safeParse(noAction({ analysis: analysis({ status, failure: status === "unavailable" ? "MODEL_UNAVAILABLE" : null }) })).success).toBe(false);
  });
  it("unavailable, unprocessed, continued, bodyless and empty coverage cannot become no action", () => {
    for (const receipt of [coverage({ analyzed: 0, unavailable: 1, partial: true }), coverage({ analyzed: 0, unprocessed: 1, partial: true }), coverage({ continuation: "remaining", partial: true }), coverage({ read: 0, analyzed: 0 }), coverage({ partial: true })]) expect(instinctIssueSchema.safeParse(noAction({ coverage: receipt })).success).toBe(false);
  });
  it("notification observations require exact associations and cannot fabricate delivery from phone notices", () => {
    const observation = { issueId: "issue-1", issueRevision: "issue-r1", requestRevision: "request-r1", transitionId: "transition-1", channel: "phone", recipient: "+13015550123", sendingIdentity: "+13015550456", payloadFingerprint: hash, providerMessageId: null, observedAtUtc: timestamp, notification: "recorded_phone_notice", delivery: "not_supported", citations: [{ ref: ref(), start: 0, end: 6, exactQuote: "Please" }], completeSendScope: false, limitations: [] };
    expect(notificationObservationSchema.safeParse(observation).success).toBe(true);
    expect(notificationObservationSchema.safeParse({ ...observation, delivery: "provider_confirmed", providerMessageId: "some-call" }).success).toBe(false);
    expect(notificationObservationSchema.safeParse({ ...observation, notification: "not_sent", citations: [] }).success).toBe(false);
    expect(notificationObservationSchema.safeParse({ ...observation, channel: "sms", notification: "sent", delivery: "unknown", providerMessageId: "message-4", citations: [] }).success).toBe(true);
    expect(notificationObservationSchema.safeParse({ ...observation, transitionId: undefined }).success).toBe(false);
  });
});

 describe("Instinct read-only API and injection contracts", () => {
  it("requires exact selection and request revision binding for investigation/chat", () => {
    expect(askInputSchema.safeParse({ threadId: "chat-1", requestId: "request-1", question: "What changed?", selectedIssueId: "issue-1" }).success).toBe(false);
    expect(askInputSchema.safeParse({ threadId: "chat-1", requestId: "request-1", question: "What changed?", selectedIssueId: "issue-1", selectedIssueRevision: "issue-r1" }).success).toBe(true);
    expect(requestBindingSchema.safeParse({ requestId: "request-1", contextRevision: "context-r1", selectedIssueId: "issue-1", selectedIssueRevision: null }).success).toBe(false);
  });
  it("rejects late responses for a different question, customer or source/issue revision", () => {
    const binding = { requestId: "request-1", contextRevision: "context-r1", selectedIssueId: "issue-1", selectedIssueRevision: "issue-r1" };
    expect(validateResponseBinding(binding, binding)).toEqual(binding);
    for (const changed of [{ ...binding, requestId: "request-2" }, { ...binding, contextRevision: "context-r2" }, { ...binding, selectedIssueId: "issue-2" }, { ...binding, selectedIssueRevision: "issue-r2" }]) expect(() => validateResponseBinding(changed, binding)).toThrow("STALE_RESPONSE");
  });
  it("only permits the four issue-bound read tools, no raw SQL or customer dispatch", () => {
    expect(evidenceToolCallSchema.safeParse({ name: "readScopedEvidence", input: { issueId: "issue-1", issueRevision: "issue-r1" } }).success).toBe(true);
    expect(evidenceToolCallSchema.safeParse({ name: "send", input: {} }).success).toBe(false);
    expect(evidenceToolCallSchema.safeParse({ name: "readExactCustomerRecords", input: { issueId: "issue-1", issueRevision: "issue-r1", customerId: "other" } }).success).toBe(false);
    expect(evidenceToolCallSchema.safeParse({ name: "reviewCoverageDay", input: { localDate: "2026-11-13", timeZone: "America/New_York", sourceKinds: ["sms"], cursor: "continuation-1" } }).success).toBe(true);
  });
  it("exposes reviewed and durable capabilities honestly as unavailable", () => {
    expect(feedInputSchema.safeParse({ filter: "reviewed" }).success).toBe(true);
    expect(stage1CapabilitiesSchema.parse(STAGE1_CAPABILITIES).durableStoreAvailable).toBe(false);
    expect(stage1CapabilitiesSchema.safeParse({ ...STAGE1_CAPABILITIES, durableStoreAvailable: true }).success).toBe(false);
    expect(Object.isFrozen(STAGE1_CAPABILITIES)).toBe(true);
    expectTypeOf<keyof ReadonlyInstinctStore>().toEqualTypeOf<"capabilities" | "getIssue" | "feed">();
    expectTypeOf<keyof InstinctApi>().toEqualTypeOf<"sources" | "feed" | "check" | "evidence" | "reverify" | "dayReview" | "ask">();
  });
  it("is structurally identical to the actual model transport, without importing its runtime", () => {
    expectTypeOf<InstinctInvokeParams>().toEqualTypeOf<InvokeParams>();
    expectTypeOf<InstinctInvokeResult>().toEqualTypeOf<InvokeResult>();
    expectTypeOf<ModelCallable>().toEqualTypeOf<(params: InvokeParams) => Promise<InvokeResult>>();
    const injected = vi.fn<ModelCallable>(async () => ({ id: "offline", created: 0, model: "offline-synthetic", choices: [] }));
    expect(injected).not.toHaveBeenCalled();
    const source = readFileSync(new URL("../../shared/instinct.ts", import.meta.url), "utf8");
    const imports = source.split("\n").filter(line => /^import /.test(line));
    expect(imports).toEqual(['import { z } from "zod";']);
    expect(source).not.toMatch(/\b(?:fetch|setInterval|setTimeout)\s*\(/);
  });
  it("compiles the actual shared module strictly and proves bidirectional model type compatibility", () => {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
    const virtual = path.join(root, "server/instinct/__contract_typecheck.ts");
    const llmPath = path.join(root, "server/_core/llm.ts");
    const llmText = readFileSync(llmPath, "utf8");
    // Actual declarations only: never execute or compile the transport's runtime graph.
    const llmDeclarations = llmText.slice(llmText.indexOf("export type Role"), llmText.indexOf("const ensureArray"));
    const input = `import type { InvokeParams, InvokeResult } from '../_core/llm';
import type { InstinctInvokeParams, InstinctInvokeResult, ModelCallable } from '../../shared/instinct';
type Assert<T extends true> = T;
type Checks = [Assert<InvokeParams extends InstinctInvokeParams ? true : false>,
 Assert<InstinctInvokeParams extends InvokeParams ? true : false>,
 Assert<InvokeResult extends InstinctInvokeResult ? true : false>,
 Assert<InstinctInvokeResult extends InvokeResult ? true : false>,
 Assert<ModelCallable extends (p: InvokeParams) => Promise<InvokeResult> ? true : false>];`;
    const options: ts.CompilerOptions = { noEmit: true, strict: true, skipLibCheck: true, target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, types: [] };
    const host = ts.createCompilerHost(options);
    const originalRead = host.readFile.bind(host);
    const originalExists = host.fileExists.bind(host);
    host.fileExists = filename => path.resolve(filename) === virtual || originalExists(filename);
    host.readFile = filename => path.resolve(filename) === virtual ? input : path.resolve(filename) === llmPath ? llmDeclarations : originalRead(filename);
    host.getSourceFile = (filename, languageVersion) => {
      const text = host.readFile(filename);
      return text === undefined ? undefined : ts.createSourceFile(filename, text, languageVersion, true);
    };
    const program = ts.createProgram([virtual], options, host);
    const diagnostics = ts.getPreEmitDiagnostics(program).map(diagnostic => `${diagnostic.file?.fileName ?? "compiler"}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, " ")}`);
    expect(diagnostics).toEqual([]);
  });
});
