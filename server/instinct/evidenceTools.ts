import { createHash } from "node:crypto";
import {
  READ_TOOL_NAMES, STAGE1_CAPABILITIES, authorizedScopeSchema, citationSchema, dayReviewInputSchema, dayReviewResultSchema,
  evidenceToolCallSchema, investigationSchema, nativeSnapshotSchema, reverifyResultSchema,
  selectedIssueInputSchema, sourceContextSchema, sameEvidenceRef, validateCitation, validateIdentityScope,
  type AuthorizedScope, type DayReviewInput, type DayReviewResult, type EvidenceToolCall, type EvidenceTools,
  type Investigation, type NativeRecordReader, type NativeSnapshot, type RequestBinding, type ReverifyResult,
  type SelectedIssueInput, type SourceContext, type SourceReader,
} from "../../shared/instinct";
import { nativeIdentityProblems, recordMatchesIdentity, resolveOccurrence } from "./identity";
import { type IssueLedger, type RetainedIssue, targetOccurrenceKey } from "./issues";
import { safeReadDbError } from "./readDb";
import { type RequestVerifier } from "./verify";

export { READ_TOOL_NAMES };
export class EvidenceToolError extends Error {
  constructor(readonly code: "INVALID_SCOPE" | "INVALID_SOURCE_REFERENCE" | "INVALID_CITATION" | "STALE_CONTEXT" | "STALE_ISSUE" | "SOURCE_UNAVAILABLE" | "DB_UNAVAILABLE" | "UNSUPPORTED_QUESTION") { super(code); this.name = "EvidenceToolError"; }
}
export interface EvidenceToolsOptions {
  readonly sources: SourceReader;
  readonly nativeRecords: NativeRecordReader;
  readonly verifier: RequestVerifier;
  readonly store: Pick<IssueLedger, "getRetained" | "replaceVerification">;
  /** Service-owned stored-day traversal. It must retain all cursor continuations;
   * no provider fetch or artificial corpus cutoff is performed by this registry. */
  readonly reviewDay: (scope: AuthorizedScope, input: DayReviewInput) => Promise<DayReviewResult>;
  readonly authorizeScope?: (scope: AuthorizedScope) => boolean | Promise<boolean>;
}
export type EvidenceToolResult = Investigation | NativeSnapshot | ReverifyResult | DayReviewResult;
export interface InstinctEvidenceTools extends EvidenceTools {
  readonly dispatch: (scope: AuthorizedScope, call: unknown, selected?: SelectedIssueInput) => Promise<EvidenceToolResult>;
}
function hash(value: unknown): string { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
function safeSource(error: unknown): never {
  const code = error instanceof Error ? error.message : "";
  if (["INVALID_SCOPE", "INVALID_SOURCE_REFERENCE", "INVALID_CITATION", "STALE_CONTEXT", "STALE_ISSUE"].includes(code)) throw new EvidenceToolError(code as "INVALID_SCOPE" | "INVALID_SOURCE_REFERENCE" | "INVALID_CITATION" | "STALE_CONTEXT" | "STALE_ISSUE");
  throw new EvidenceToolError("SOURCE_UNAVAILABLE");
}
function binding(retained: RetainedIssue, request: string): RequestBinding {
  return { requestId: `${request}:${hash([retained.issue.issueId, retained.issue.revision, retained.context.manifest.revision])}`,
    contextRevision: retained.context.manifest.revision, selectedIssueId: retained.issue.issueId, selectedIssueRevision: retained.issue.revision };
}
/** Full context exact reread, not just the quoted fragment or client body. Every
 * context manifest entry, identity ref, request citation and account is checked. */
export function validateRetainedEvidence(scope: AuthorizedScope, retained: RetainedIssue, contextValue: SourceContext): SourceContext {
  const context = sourceContextSchema.parse(contextValue), original = retained.context;
  if (context.manifest.sourceAccountKey !== scope.sourceAccountKey || retained.issue.coverage.sourceAccountKey !== scope.sourceAccountKey
    || retained.issue.coverage.authorizedScope !== scope.installationScope) throw new EvidenceToolError("INVALID_SCOPE");
  if (context.manifest.contextId !== original.manifest.contextId || context.manifest.revision !== original.manifest.revision
    || context.manifest.contextFingerprint !== original.manifest.contextFingerprint
    || context.manifest.entries.length !== original.manifest.entries.length
    || context.evidence.some((item, index) => !sameEvidenceRef(item.ref, original.evidence[index].ref)
      || item.originalText !== original.evidence[index].originalText
      || JSON.stringify(item) !== JSON.stringify(original.evidence[index]))) throw new EvidenceToolError("STALE_CONTEXT");
  if ([...retained.issue.citations, ...(retained.action?.citations ?? [])].some(citation => !citationSchema.safeParse(citation).success)) throw new EvidenceToolError("INVALID_CITATION");
  try {
    validateIdentityScope(retained.issue.identity, scope, context.evidence);
    retained.issue.citations.forEach(citation => validateCitation(citation, scope, context.evidence));
    if (retained.action) {
      if (retained.action.contextId !== context.manifest.contextId || !context.evidence.some(item => sameEvidenceRef(item.ref, retained.action!.anchorRef))) throw new Error("INVALID_SOURCE_REFERENCE");
      retained.action.citations.forEach(citation => validateCitation(citation, scope, context.evidence));
    }
  } catch (error) { safeSource(error); }
  return context;
}
/** Independent fresh exact-row/link/contact validation protects even an injected
 * reader. Complete candidate closure is not proof for a different selected visit. */
export function validateSelectedSnapshot(scope: AuthorizedScope, retained: RetainedIssue, value: NativeSnapshot): NativeSnapshot {
  const parsed = nativeSnapshotSchema.safeParse(value);
  if (!parsed.success) throw new EvidenceToolError("DB_UNAVAILABLE");
  const snapshot = parsed.data, { identity, target } = retained.issue;
  if (identity.decision !== "verified" || identity.installationScope !== scope.installationScope || identity.sourceAccountKey !== scope.sourceAccountKey
    || snapshot.sourceAccountKey !== scope.sourceAccountKey) throw new EvidenceToolError("INVALID_SCOPE");
  if (!retained.action || !targetOccurrenceKey(target) || snapshot.availability !== "complete" || snapshot.continuation !== null
    || new Set(snapshot.records.map(record => record.key)).size !== snapshot.records.length || nativeIdentityProblems(identity, snapshot.records).length) throw new EvidenceToolError("DB_UNAVAILABLE");
  const exactKey = target.jobId ? `leadflow:job:${target.jobId}` : target.bookingId ? `booking:${target.bookingId}` : null;
  const exact = snapshot.records.find(record => record.key === exactKey);
  if (!exact || !recordMatchesIdentity(exact, identity) || exact.bookingId !== target.bookingId || exact.jobId !== target.jobId
    || exact.launch27BookingId !== target.launch27BookingId
    || (target.publicBookingNumber && (exact.publicBookingNumber ?? snapshot.records.find(record => record.key === `booking:${target.bookingId}`)?.publicBookingNumber) !== target.publicBookingNumber)
    || (target.publicBookingNumber && target.bookingId && snapshot.records.some(record => record.key === `booking:${target.bookingId}` && record.publicBookingNumber !== target.publicBookingNumber))
    || (target.bookingSeriesId && exact.source === "leadflow_jobs" && exact.bookingSeriesId !== target.bookingSeriesId)
    || (target.scope === "subsequent" && exact.localDate !== target.localDate)) throw new EvidenceToolError("DB_UNAVAILABLE");
  const resolution = resolveOccurrence(scope, identity, { ...retained.action.expected,
    bookingReference: target.scope === "series" ? `booking:${target.bookingId}` : exactKey,
    originalDate: target.scope === "subsequent" ? target.localDate : null, scope: target.scope }, snapshot);
  if (resolution.decision !== "verified" || targetOccurrenceKey(resolution.target) !== targetOccurrenceKey(target)) throw new EvidenceToolError("DB_UNAVAILABLE");
  return snapshot;
}
export function createEvidenceTools(options: EvidenceToolsOptions): InstinctEvidenceTools {
  const authorize = async (scopeValue: AuthorizedScope): Promise<AuthorizedScope> => {
    const parsed = authorizedScopeSchema.safeParse(scopeValue);
    if (!parsed.success || (options.authorizeScope && !(await options.authorizeScope(parsed.data)))) throw new EvidenceToolError("INVALID_SCOPE");
    return parsed.data;
  };
  const retained = async (scope: AuthorizedScope, inputValue: SelectedIssueInput): Promise<RetainedIssue> => {
    const input = selectedIssueInputSchema.parse(inputValue);
    let selected: RetainedIssue | null;
    try { selected = await options.store.getRetained(scope, input); } catch (error) { safeSource(error); }
    if (!selected! || selected!.issue.issueId !== input.issueId || selected!.issue.revision !== input.issueRevision || selected!.issue.supersededBy !== null) throw new EvidenceToolError("STALE_ISSUE");
    if (selected!.issue.identity.installationScope !== scope.installationScope || selected!.issue.identity.sourceAccountKey !== scope.sourceAccountKey) throw new EvidenceToolError("INVALID_SCOPE");
    return selected!;
  };
  const freshContext = async (scope: AuthorizedScope, selected: RetainedIssue): Promise<SourceContext> => {
    if (!selected.context.manifest.entries.length) throw new EvidenceToolError("SOURCE_UNAVAILABLE");
    try { return validateRetainedEvidence(scope, selected, await options.sources.readContext(scope, selected.context.manifest.entries.map(entry => entry.ref), selected.context.manifest.revision)); }
    catch (error) { safeSource(error); }
  };
  const freshRecords = async (scope: AuthorizedScope, selected: RetainedIssue): Promise<NativeSnapshot> => {
    if (selected.issue.identity.decision !== "verified" || !selected.action || !targetOccurrenceKey(selected.issue.target)) throw new EvidenceToolError("DB_UNAVAILABLE");
    let snapshot: NativeSnapshot;
    try { snapshot = await options.nativeRecords.readExact(scope, selected.issue.identity, selected.issue.target); }
    catch (error) { safeReadDbError(error); throw new EvidenceToolError("DB_UNAVAILABLE"); }
    return validateSelectedSnapshot(scope, selected, snapshot);
  };
  const unchanged = async (scope: AuthorizedScope, input: SelectedIssueInput, before: RetainedIssue): Promise<void> => {
    const current = await retained(scope, input);
    if (JSON.stringify(current.action) !== JSON.stringify(before.action) || current.context.manifest.revision !== before.context.manifest.revision) throw new EvidenceToolError("STALE_ISSUE");
    await freshContext(scope, before); // Reject old sources even if the ledger was not yet refreshed.
  };
  const reverifySelectedIssue: EvidenceTools["reverifySelectedIssue"] = async (scopeValue, inputValue) => {
    const scope = await authorize(scopeValue), input = selectedIssueInputSchema.parse(inputValue), selected = await retained(scope, input), context = await freshContext(scope, selected);
    if (!selected.action || !["complete", "partial"].includes(selected.issue.analysis.status)) throw new EvidenceToolError("DB_UNAVAILABLE");
    let verification;
    try {
      verification = await options.verifier.verify(scope, selected.issue.identity, selected.action, {
        context, ...(targetOccurrenceKey(selected.issue.target) ? { target: selected.issue.target } : {}),
      });
    } catch (error) {
      if (error instanceof Error && ["INVALID_SCOPE", "INVALID_SOURCE_REFERENCE", "INVALID_CITATION", "STALE_CONTEXT", "STALE_ISSUE"].includes(error.message)) safeSource(error);
      throw new EvidenceToolError("DB_UNAVAILABLE");
    }
    await unchanged(scope, input, selected);
    const issue = await options.store.replaceVerification(scope, input, verification);
    return reverifyResultSchema.parse({ binding: binding({ ...selected, issue }, "reverify"), coverage: issue.coverage,
      capabilities: STAGE1_CAPABILITIES, limitations: [...issue.coverage.exclusions, ...verification.limitations, "Fresh stored state only; no sync, correction, notification or delivery action."], issue });
  };
  const readScopedEvidence: EvidenceTools["readScopedEvidence"] = async (scopeValue, inputValue) => {
    const scope = await authorize(scopeValue), input = selectedIssueInputSchema.parse(inputValue), selected = await retained(scope, input), context = await freshContext(scope, selected);
    // Evidence remains readable when records are unknown/partial; do not turn a
    // missing handler/body/identity into an invented current-record snapshot.
    let snapshot: NativeSnapshot | null = null;
    if (selected.action && selected.issue.identity.decision === "verified" && targetOccurrenceKey(selected.issue.target)) {
      try { snapshot = await freshRecords(scope, selected); } catch (error) {
        if (!(error instanceof EvidenceToolError) || error.code !== "DB_UNAVAILABLE") throw error;
      }
    }
    await unchanged(scope, input, selected);
    const limitations = [...Array.from(new Set([...selected.issue.coverage.exclusions, ...context.manifest.limitations,
      ...(snapshot ? snapshot.limitations : ["Exact current-record snapshot unavailable; retained verification is an earlier receipt, not proof at this investigation time."]),
      ...(snapshot && snapshot.fingerprint !== selected.issue.recordFingerprint ? ["Fresh investigation records differ from the earlier verification checkpoint; reverify the selected issue before treating its retained outcome as current."] : []),
      "Process-local transient investigation; no durable review or ownership."]))];
    return investigationSchema.parse({ binding: binding(selected, "evidence"), coverage: selected.issue.coverage, capabilities: STAGE1_CAPABILITIES,
      limitations, issue: selected.issue, evidence: context.evidence, citations: selected.issue.citations, snapshot });
  };
  const readExactCustomerRecords: EvidenceTools["readExactCustomerRecords"] = async (scopeValue, inputValue) => {
    const scope = await authorize(scopeValue), input = selectedIssueInputSchema.parse(inputValue), selected = await retained(scope, input);
    await freshContext(scope, selected); const snapshot = await freshRecords(scope, selected); await unchanged(scope, input, selected);
    return snapshot;
  };
  const reviewCoverageDay: EvidenceTools["reviewCoverageDay"] = async (scopeValue, inputValue) => {
    const scope = await authorize(scopeValue), input = dayReviewInputSchema.parse(inputValue);
    let raw;
    try { raw = await options.reviewDay(scope, input); } catch (error) { safeSource(error); }
    const result = dayReviewResultSchema.parse(raw);
    if (result.localDate !== input.localDate || result.timeZone !== input.timeZone || result.coverage.authorizedScope !== scope.installationScope
      || result.coverage.sourceAccountKey !== scope.sourceAccountKey || result.continuation !== result.coverage.continuation
      || result.coverage.sourceKinds.some(kind => !input.sourceKinds.includes(kind))
      || result.groups.some(group => group.identity.installationScope !== scope.installationScope || group.identity.sourceAccountKey !== scope.sourceAccountKey)) throw new EvidenceToolError("INVALID_SCOPE");
    return result;
  };
  const registry: EvidenceTools = Object.freeze({ readScopedEvidence, readExactCustomerRecords, reverifySelectedIssue, reviewCoverageDay });
  return Object.freeze({ ...registry,
    async dispatch(scopeValue: AuthorizedScope, callValue: unknown, selected?: SelectedIssueInput): Promise<EvidenceToolResult> {
      const scope = await authorize(scopeValue), parsed = evidenceToolCallSchema.safeParse(callValue);
      if (!parsed.success) throw new EvidenceToolError("UNSUPPORTED_QUESTION");
      const call: EvidenceToolCall = parsed.data;
      if (call.name !== "reviewCoverageDay" && selected) {
        const selection = selectedIssueInputSchema.parse(selected);
        if (call.input.issueId !== selection.issueId || call.input.issueRevision !== selection.issueRevision) throw new EvidenceToolError("STALE_ISSUE");
      }
      switch (call.name) {
        case "readScopedEvidence": return registry.readScopedEvidence(scope, call.input);
        case "readExactCustomerRecords": return registry.readExactCustomerRecords(scope, call.input);
        case "reverifySelectedIssue": return registry.reverifySelectedIssue(scope, call.input);
        case "reviewCoverageDay": return registry.reviewCoverageDay(scope, call.input);
      }
    },
  });
}
export const createInstinctEvidenceTools = createEvidenceTools;
