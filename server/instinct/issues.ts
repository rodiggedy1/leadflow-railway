import { createHash } from "node:crypto";
import {
  STAGE1_CAPABILITIES, analysisReceiptSchema, authorizedScopeSchema, coverageReceiptSchema,
  feedInputSchema, feedSchema, instinctIssueSchema, issueGroupSchema, selectedIssueInputSchema,
  sourceContextSchema, validateCitation, validateIdentityScope, verificationResultSchema,
  sameEvidenceRef, type AnalysisReceipt, type AuthorizedScope, type Clock, type CoverageReceipt,
  type ExtractionAction, type FeedInput, type InstinctFeed, type InstinctIssue, type IssueGroup,
  type Outcome, type ReadonlyInstinctStore, type SelectedIssueInput, type SourceContext,
  type TargetOccurrence, type VerificationResult, type VerifiedIdentity,
} from "../../shared/instinct";

export const INSTINCT_ISSUE_VERSION = "instinct-transient-occurrence-v1";
export class IssueError extends Error {
  constructor(readonly code: "INVALID_SCOPE" | "INVALID_SOURCE_REFERENCE" | "STALE_CONTEXT" | "STALE_ISSUE" | "DURABLE_STORE_UNAVAILABLE") { super(code); this.name = "IssueError"; }
}
export interface ActionVerification { readonly actionId: string; readonly verification: VerificationResult }
export interface IssueObservation {
  readonly context: SourceContext;
  readonly identity: VerifiedIdentity;
  readonly analysis: AnalysisReceipt;
  readonly coverage: CoverageReceipt;
  readonly verifications?: readonly ActionVerification[];
}
export interface RetainedIssue {
  readonly issue: InstinctIssue;
  readonly context: SourceContext;
  readonly action: ExtractionAction | null;
}
export interface IssueRevisionHistory {
  readonly issueId: string;
  readonly revision: string;
  readonly supersededByRevision: string;
  readonly reason: "source_revision" | "verified_correction" | "same_expectation";
  readonly issue: InstinctIssue;
}
/** Only feature-local transient publication; no business/source persistence or
 * review/ownership mutation. The service must authorize and freshly read first. */
export interface IssueLedger extends ReadonlyInstinctStore {
  readonly publish: (scope: AuthorizedScope, observation: IssueObservation) => Promise<InstinctIssue[]>;
  readonly getRetained: (scope: AuthorizedScope, input: SelectedIssueInput) => Promise<RetainedIssue | null>;
  readonly replaceVerification: (scope: AuthorizedScope, input: SelectedIssueInput, verification: VerificationResult) => Promise<InstinctIssue>;
  readonly history: (scope: AuthorizedScope, input: SelectedIssueInput) => Promise<readonly IssueRevisionHistory[]>;
  readonly setCoverage: (scope: AuthorizedScope, coverage: CoverageReceipt) => Promise<void>;
}
export interface IssueLedgerOptions { readonly clock?: Clock; readonly authorizeScope?: (scope: AuthorizedScope) => boolean | Promise<boolean> }
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
function hash(value: unknown): string { return createHash("sha256").update(canonical(value)).digest("hex"); }
function clone<T>(value: T): T { return structuredClone(value); }
const unique = (values: readonly string[]) => [...Array.from(new Set(values))];
const refIdentity = (ref: ExtractionAction["anchorRef"]) => [ref.sourceAccountKey, ref.store, ref.sourceId, ref.providerId, ref.sessionId, ref.threadId];
const semanticRef = (ref: ExtractionAction["anchorRef"]) => { const { observedAtUtc: _observation, ...semantic } = ref; return semantic; };
function emptyTarget(): TargetOccurrence { return { bookingId: null, jobId: null, launch27BookingId: null, bookingSeriesId: null, publicBookingNumber: null, scope: "unspecified", localDate: null, localTime: null, arrivalWindow: null, timeZone: null, occurredAtUtc: null }; }
/** Stable native IDs, not replacement date/time or current-record fingerprints.
 * Subsequent scope includes its actual boundary visit; full series does not. */
export function targetOccurrenceKey(target: TargetOccurrence): string | null {
  if (target.scope === "unspecified") return null;
  if (target.scope === "series") return target.bookingSeriesId && target.bookingId ? hash(["series", target.bookingId, target.bookingSeriesId]) : null;
  if (target.scope === "subsequent" && (!target.bookingSeriesId || !target.jobId)) return null;
  return target.jobId ? hash([target.scope, "job", target.jobId, target.bookingId, target.bookingSeriesId, target.launch27BookingId])
    : target.scope === "visit" && target.bookingId ? hash(["visit", "booking", target.bookingId]) : null;
}
function hasExactProof(identity: VerifiedIdentity, verification?: VerificationResult): boolean {
  return identity.decision === "verified" && !!verification?.snapshot && verification.snapshot.availability === "complete"
    && ["matches_current", "discrepancy"].includes(verification.outcome) && !!targetOccurrenceKey(verification.target);
}
export function stableIssueKey(scope: AuthorizedScope, identity: VerifiedIdentity, action: ExtractionAction, verification?: VerificationResult): string {
  const target = hasExactProof(identity, verification) ? targetOccurrenceKey(verification!.target) : null;
  // Notes destinations are independent operational actions, never interchangeable.
  const dimension = [action.action, ["notes", "access_notes"].includes(action.action) ? action.expected.notesDestination : null];
  return `issue:${hash([INSTINCT_ISSUE_VERSION, scope.installationScope, scope.sourceAccountKey,
    target ? ["verified", identity.fingerprint, dimension, target] : ["provisional", action.contextId, refIdentity(action.anchorRef), dimension, action.id]])}`;
}
export function issueExpectationRevision(action: ExtractionAction, context: SourceContext): string {
  return hash([INSTINCT_ISSUE_VERSION, action.action, action.expected, action.agreement, action.ambiguous,
    action.missingParameters, context.manifest.contextId, context.manifest.revision, context.manifest.contextFingerprint,
    action.citations.map(citation => ({ ...citation, ref: semanticRef(citation.ref) })),
    action.supersededByRef ? semanticRef(action.supersededByRef) : null]);
}
function sameExpectation(left: ExtractionAction, right: ExtractionAction): boolean {
  const agreement = (action: ExtractionAction) => ["requested", "confirmed"].includes(action.agreement) ? "eligible_request" : action.agreement;
  return canonical([left.action, left.expected, agreement(left)]) === canonical([right.action, right.expected, agreement(right)]);
}
/** A model's supersession suggestion alone is not proof. Independently require
 * same verified customer/action/native scope, quoted exact correction and real
 * original chronological order. Cancellation then booking is always independent. */
export function verifiedCorrection(previous: RetainedIssue, next: RetainedIssue): boolean {
  const a = previous.action, b = next.action;
  if (!a || !b || a.action !== b.action || a.ambiguous || b.ambiguous || a.missingParameters.length || b.missingParameters.length
    || !hasExactProof(previous.issue.identity, previous.issue.verification ?? undefined) || !hasExactProof(next.issue.identity, next.issue.verification ?? undefined)
    || previous.issue.identity.fingerprint !== next.issue.identity.fingerprint
    || targetOccurrenceKey(previous.issue.target) !== targetOccurrenceKey(next.issue.target)
    || !a.supersededByRef || !sameEvidenceRef(a.supersededByRef, b.anchorRef)
    || !a.citations.some(citation => sameEvidenceRef(citation.ref, b.anchorRef))
    || !b.citations.some(citation => sameEvidenceRef(citation.ref, b.anchorRef))
    || sameExpectation(a, b)) return false;
  const correctionText = b.citations.filter(citation => sameEvidenceRef(citation.ref, b.anchorRef)).map(citation => citation.exactQuote).join("\n");
  if (!new RegExp("\\b(?:actually|instead|correction|correcting|rather|not that|i meant|make that|change that)\\b", "iu").test(correctionText)) return false;
  const earlier = a.anchorRef.occurredAtUtc, later = b.anchorRef.occurredAtUtc;
  if (!earlier || !later || Date.parse(later) < Date.parse(earlier)) return false;
  if (Date.parse(later) === Date.parse(earlier)) {
    if (previous.context.manifest.contextId !== next.context.manifest.contextId || previous.context.manifest.revision !== next.context.manifest.revision) return false;
    const entries = next.context.manifest.entries;
    const ai = entries.findIndex(entry => sameEvidenceRef(entry.ref, a.anchorRef)), bi = entries.findIndex(entry => sameEvidenceRef(entry.ref, b.anchorRef));
    if (ai < 0 || bi <= ai) return false;
  }
  return a.expected.notesDestination === b.expected.notesDestination;
}
function assertCoverage(scope: AuthorizedScope, value: CoverageReceipt): CoverageReceipt {
  const coverage = coverageReceiptSchema.parse(value);
  if (coverage.authorizedScope !== scope.installationScope || coverage.sourceAccountKey !== scope.sourceAccountKey) throw new IssueError("INVALID_SCOPE");
  return coverage;
}
function observationCoverage(scope: AuthorizedScope, observation: IssueObservation): CoverageReceipt {
  const original = assertCoverage(scope, observation.coverage), { analysis, context } = observation;
  // Completed interpretation describes usable originals, not identity/record proof.
  // A partial receipt counts only if every segment and the reduction succeeded.
  const analyzed = (analysis.status === "complete" || analysis.status === "partial") && analysis.totalSegments > 0
    && analysis.completedSegments === analysis.totalSegments && analysis.reductionComplete
    && (analysis.failure === null || analysis.failure === "PARTIAL_CONTEXT");
  const unavailable = analysis.status === "unavailable";
  const complete = analysis.status === "complete" && context.manifest.complete
    && (!analysis.actions.length || (observation.verifications?.length === analysis.actions.length && observation.verifications.every(entry => ["matches_current", "discrepancy"].includes(entry.verification.outcome))));
  const read = original.read;
  const exclusions = unique([...original.exclusions, ...context.manifest.limitations, ...analysis.limitations,
    ...(!complete ? [unavailable ? "Analysis or exact record proof unavailable within observed context" : "Context or exact request verification remains partial; completed original analysis is counted separately."] : [])]);
  return coverageReceiptSchema.parse({ ...original, analyzed: analyzed ? read - original.unavailable : 0,
    unavailable: unavailable ? read : original.unavailable,
    unprocessed: analyzed || unavailable ? 0 : read - original.unavailable,
    partial: !!original.continuation || original.unavailable > 0 || original.boundaries.some(boundary => boundary.availability !== "complete") || !complete || exclusions.length > 0, exclusions });
}
function verificationFor(identity: VerifiedIdentity, action: ExtractionAction, value: VerificationResult): VerificationResult {
  const verification = verificationResultSchema.parse(value);
  if (canonical(verification.identity) !== canonical(identity) || action.expected.scope !== verification.target.scope) throw new IssueError("INVALID_SOURCE_REFERENCE");
  return verification;
}
function actionIssue(scope: AuthorizedScope, observation: IssueObservation, action: ExtractionAction, coverage: CoverageReceipt, verification?: VerificationResult): RetainedIssue {
  const { identity, context, analysis } = observation;
  if (verification) verificationFor(identity, action, verification);
  const usable = analysis.status === "complete" || analysis.status === "partial";
  const outcome: Outcome = !usable ? analysis.status === "pending" ? "checking" : "analysis_unavailable"
    : analysis.status !== "complete" || action.ambiguous || action.missingParameters.length ? "review" : verification?.outcome ?? "checking";
  const proof = usable && outcome === verification?.outcome ? verification : null;
  const issue = instinctIssueSchema.parse({ issueId: stableIssueKey(scope, identity, action, verification), revision: issueExpectationRevision(action, context),
    identity, action: action.action, expectation: action.expected, target: verification?.target ?? { ...emptyTarget(), scope: action.expected.scope }, citations: action.citations,
    outcome, explanation: proof?.explanation ?? (outcome === "checking" ? "This request has not yet been checked against exact current records." : outcome === "analysis_unavailable" ? "Complete request analysis is unavailable; retained original request candidates require review." : "Original request meaning, identity, context or exact target requires review."),
    priorityReason: outcome === "discrepancy" ? proof?.priorityReason ?? null : null, recordFingerprint: proof?.recordFingerprint ?? null,
    checkedAtUtc: proof?.checkedAtUtc ?? null, coverage, analysis, verification: proof,
    fulfillment: proof?.fulfillment ?? "unknown", notification: proof?.notification ?? "unknown", delivery: proof?.delivery ?? "unknown", supersededBy: null, transient: true });
  return { issue, context, action };
}
function contextIssue(scope: AuthorizedScope, observation: IssueObservation, coverage: CoverageReceipt): RetainedIssue {
  const { context, identity, analysis } = observation;
  const outcome: Outcome = analysis.status === "pending" ? "checking" : analysis.status === "unavailable" ? "analysis_unavailable"
    : analysis.status === "complete" && context.manifest.complete && !coverage.partial && coverage.analyzed === coverage.read && coverage.read > 0 ? "no_action" : "review";
  return { context, action: null, issue: instinctIssueSchema.parse({ issueId: `issue:${hash([INSTINCT_ISSUE_VERSION, scope.installationScope, scope.sourceAccountKey, "context", context.manifest.contextId])}`,
    revision: hash([context.manifest.revision, analysis.status, analysis.failure, analysis.limitations]), identity, action: null, expectation: null,
    target: emptyTarget(), citations: [], outcome, explanation: outcome === "no_action" ? "No operational request found within this completely analyzed stored context."
      : outcome === "analysis_unavailable" ? "Stored-context analysis is unavailable; this is not a No-action finding." : outcome === "checking" ? "Stored context is not yet analyzed." : "Stored context coverage is incomplete; no complete No-action conclusion was made.",
    priorityReason: null, recordFingerprint: null, checkedAtUtc: null, coverage, analysis, verification: null, fulfillment: "unknown", notification: "unknown", delivery: "unknown", supersededBy: null, transient: true }) };
}
export function groupIssues(issues: readonly InstinctIssue[]): IssueGroup[] {
  const current = new Map(issues.filter(issue => issue.supersededBy === null).map(issue => [issue.issueId, instinctIssueSchema.parse(issue)]));
  const groups = new Map<string, InstinctIssue[]>();
  for (const issue of Array.from(current.values())) {
    const verified = issue.identity.decision === "verified";
    const key = `group:${hash([issue.identity.installationScope, issue.identity.sourceAccountKey, verified ? ["verified", issue.identity.fingerprint] : ["provisional", issue.issueId]])}`;
    groups.set(key, [...(groups.get(key) ?? []), issue]);
  }
  return [...Array.from(groups)].sort(([a], [b]) => a.localeCompare(b)).map(([groupId, items]) => issueGroupSchema.parse({ groupId, identity: items[0].identity,
    issues: items.sort((a, b) => a.issueId.localeCompare(b.issueId)), requestCount: items.filter(issue => issue.action !== null).length, verifiedCustomer: items[0].identity.decision === "verified" }));
}
/** Counts are deterministic loaded-scope observations, never refresh counts,
 * model accuracy, workflow causation or organization-wide completeness. */
export function buildIssueFeed(scope: AuthorizedScope, issues: readonly InstinctIssue[], coverageValue: CoverageReceipt, inputValue: FeedInput = { filter: "all" }): InstinctFeed {
  authorizedScopeSchema.parse(scope); const input = feedInputSchema.parse(inputValue), coverage = assertCoverage(scope, coverageValue);
  if (input.cursor) throw new IssueError("INVALID_SCOPE"); // This ledger returns its complete retained feed in one response.
  const eligible = issues.filter(issue => issue.identity.installationScope === scope.installationScope && issue.identity.sourceAccountKey === scope.sourceAccountKey && issue.supersededBy === null);
  const inDay = (issue: InstinctIssue) => !input.localDay || !issue.citations.length || issue.citations.some(citation => !citation.ref.occurredAtUtc || dayAt(citation.ref.occurredAtUtc) === input.localDay);
  const groups = groupIssues(input.filter === "reviewed" ? [] : eligible.filter(issue => inDay(issue) && (input.filter !== "urgent" || (issue.outcome === "discrepancy" && !!issue.priorityReason))));
  const outcomes: Record<Outcome, number> = { checking: 0, no_action: 0, matches_current: 0, discrepancy: 0, review: 0, analysis_unavailable: 0, record_unavailable: 0 };
  groups.forEach(group => group.issues.forEach(issue => { outcomes[issue.outcome]++; }));
  const limitations = unique(["Process-local transient findings only; restart/replica continuity and durable review/ownership are unavailable.", ...coverage.exclusions,
    ...(input.filter === "reviewed" ? ["Durable review is not approved or available; no reviewed findings were invented."] : []),
    ...(input.localDay ? ["Feed date filter describes retained source occurrences; unknown dates remain included. Coverage describes the supplied observed inventory, not a complete daily cohort."] : [])]);
  return feedSchema.parse({ binding: { requestId: `feed:${hash([scope, input, groups, coverage])}`, contextRevision: null, selectedIssueId: null, selectedIssueRevision: null },
    coverage, capabilities: STAGE1_CAPABILITIES, limitations, groups, continuation: null, reviewedUnavailable: true,
    totals: { requests: groups.reduce((total, group) => total + group.requestCount, 0), customerGroups: groups.length, verifiedCustomers: groups.filter(group => group.verifiedCustomer).length, outcomes } });
}
function dayAt(instant: string): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(instant));
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find(part => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}
function combinedCoverage(scope: AuthorizedScope, receipts: readonly CoverageReceipt[], now: string): CoverageReceipt {
  const boundaries = new Map<string, CoverageReceipt["boundaries"][number]>();
  receipts.forEach(receipt => receipt.boundaries.forEach(boundary => boundaries.set(boundary.store, boundary)));
  return coverageReceiptSchema.parse({ receiptId: `coverage:${hash([scope, receipts])}`, authorizedScope: scope.installationScope, sourceAccountKey: scope.sourceAccountKey,
    sourceKinds: [...Array.from(new Set(receipts.flatMap(receipt => receipt.sourceKinds)))], boundaries: [...Array.from(boundaries.values())], continuation: receipts.find(receipt => receipt.continuation)?.continuation ?? null,
    read: receipts.reduce((sum, receipt) => sum + receipt.read, 0), analyzed: receipts.reduce((sum, receipt) => sum + receipt.analyzed, 0), unprocessed: receipts.reduce((sum, receipt) => sum + receipt.unprocessed, 0),
    unavailable: receipts.reduce((sum, receipt) => sum + receipt.unavailable, 0), partial: !receipts.length || receipts.some(receipt => receipt.partial), exclusions: unique(receipts.flatMap(receipt => receipt.exclusions)), checkedAtUtc: now });
}
interface ScopeState { retained: Map<string, RetainedIssue>; histories: Map<string, IssueRevisionHistory[]>; contexts: Map<string, CoverageReceipt>; inventory: CoverageReceipt | null }
export function createIssueLedger(options: IssueLedgerOptions = {}): IssueLedger {
  const states = new Map<string, ScopeState>(), clock = options.clock ?? { now: () => new Date() };
  const stateFor = async (value: AuthorizedScope) => {
    const scope = authorizedScopeSchema.parse(value);
    if (options.authorizeScope && !(await options.authorizeScope(scope))) throw new IssueError("INVALID_SCOPE");
    const key = hash(scope); let state = states.get(key);
    if (!state) { state = { retained: new Map(), histories: new Map(), contexts: new Map(), inventory: null }; states.set(key, state); }
    return { scope, state };
  };
  const selected = (state: ScopeState, value: SelectedIssueInput): RetainedIssue | null => {
    const input = selectedIssueInputSchema.parse(value), retained = state.retained.get(input.issueId);
    if (!retained) return null;
    if (retained.issue.revision !== input.issueRevision || retained.issue.supersededBy !== null) throw new IssueError("STALE_ISSUE");
    return retained;
  };
  const save = (state: ScopeState, prior: RetainedIssue | undefined, next: RetainedIssue, reason: IssueRevisionHistory["reason"]) => {
    if (prior && prior.issue.revision !== next.issue.revision) state.histories.set(next.issue.issueId, [...(state.histories.get(next.issue.issueId) ?? []),
      { issueId: next.issue.issueId, revision: prior.issue.revision, supersededByRevision: next.issue.revision, reason, issue: clone(prior.issue) }]);
    state.retained.set(next.issue.issueId, clone(next));
  };
  return Object.freeze({ capabilities: STAGE1_CAPABILITIES,
    async publish(scopeValue, value) {
      const { scope, state } = await stateFor(scopeValue), context = sourceContextSchema.parse(value.context), analysis = analysisReceiptSchema.parse(value.analysis);
      const identity = validateIdentityScope(value.identity, scope, context.evidence);
      if (analysis.contextRevision !== context.manifest.revision || analysis.contextFingerprint !== context.manifest.contextFingerprint) throw new IssueError("STALE_CONTEXT");
      analysis.actions.forEach(action => {
        if (action.contextId !== context.manifest.contextId || !context.evidence.some(item => sameEvidenceRef(item.ref, action.anchorRef))) throw new IssueError("INVALID_SOURCE_REFERENCE");
        action.citations.forEach(citation => validateCitation(citation, scope, context.evidence));
        if (action.supersededByRef && !context.evidence.some(item => sameEvidenceRef(item.ref, action.supersededByRef!))) throw new IssueError("INVALID_SOURCE_REFERENCE");
      });
      if (new Set(analysis.actions.map(action => action.id)).size !== analysis.actions.length || new Set(value.verifications?.map(entry => entry.actionId)).size !== (value.verifications?.length ?? 0)
        || value.verifications?.some(entry => !analysis.actions.some(action => action.id === entry.actionId))) throw new IssueError("INVALID_SOURCE_REFERENCE");
      const observation = { ...value, context, identity, analysis }, coverage = observationCoverage(scope, observation);
      const candidates = analysis.actions.length ? analysis.actions.map(action => actionIssue(scope, observation, action, coverage, value.verifications?.find(entry => entry.actionId === action.id)?.verification)) : [contextIssue(scope, observation, coverage)];
      // Work on a clone until every candidate/proof validates: no half-published feed.
      const staged: ScopeState = { retained: new Map([...Array.from(state.retained)].map(([key, item]) => [key, clone(item)])), histories: new Map([...Array.from(state.histories)].map(([key, items]) => [key, clone(items)])), contexts: new Map(state.contexts), inventory: state.inventory };
      for (const [key, old] of Array.from(staged.retained)) {
        if (old.context.manifest.contextId !== context.manifest.contextId || old.context.manifest.revision === context.manifest.revision) continue;
        // A changed original invalidates earlier current proof even if complete
        // replacement extraction is unavailable. It does not prove fulfillment
        // or causal supersession of the retained request.
        const stale = instinctIssueSchema.parse({ ...old.issue, revision: hash([old.issue.revision, context.manifest.revision, "stale_source"]),
          outcome: "review", explanation: "The stored source context changed; this earlier request is retained for review, not current proof.",
          verification: null, recordFingerprint: null, checkedAtUtc: null, priorityReason: null, fulfillment: "unknown", notification: "unknown", delivery: "unknown" });
        staged.retained.set(key, { ...old, issue: stale });
      }
      const output = new Map<string, InstinctIssue>();
      for (const candidate of candidates) {
        const later = candidates.filter(next => verifiedCorrection(candidate, next));
        // Multiple correction branches have no proven single successor. Retain
        // the original independently instead of dropping it or choosing first.
        const chosen = later.length === 1 ? later[0] : candidate;
        let key = later.length > 1 && candidate.action ? `issue:${hash([candidate.issue.issueId, "competing", candidate.action.id])}` : chosen.issue.issueId;
        let prior = staged.retained.get(key);
        const sameRequest = chosen.action ? [...Array.from(staged.retained.values())].filter(old => old.action
          && old.context.manifest.contextId === chosen.context.manifest.contextId
          && old.action.id === chosen.action!.id
          && canonical(refIdentity(old.action.anchorRef)) === canonical(refIdentity(chosen.action!.anchorRef))
          && ((old.issue.identity.fingerprint === chosen.issue.identity.fingerprint && old.issue.identity.decision === chosen.issue.identity.decision)
            || (old.issue.identity.decision !== "verified" && chosen.issue.identity.decision === "verified"))) : [];
        if (!prior && sameRequest.length === 1) {
          const old = sameRequest[0];
          // A proven native occurrence keeps its key when fresh record coverage
          // is lost. A provisional key promotes only this exact source request.
          const wasExact = !!old.issue.verification && hasExactProof(old.issue.identity, old.issue.verification)
            || (state.retained.get(old.issue.issueId)?.issue.verification ? hasExactProof(old.issue.identity, state.retained.get(old.issue.issueId)!.issue.verification!) : false);
          if (wasExact && !hasExactProof(chosen.issue.identity, chosen.issue.verification ?? undefined)) key = old.issue.issueId;
          prior = old;
          if (old.issue.issueId !== key) staged.retained.delete(old.issue.issueId);
        }
        if (prior?.action && chosen.action && !sameExpectation(prior.action, chosen.action)) {
          const sameSource = canonical(refIdentity(prior.action.anchorRef)) === canonical(refIdentity(chosen.action.anchorRef))
            && (prior.action.id === chosen.action.id || (prior.context.manifest.revision !== chosen.context.manifest.revision
              && canonical(prior.action.citations.filter(citation => sameEvidenceRef(citation.ref, prior!.action!.anchorRef)).map(citation => [citation.start, citation.end]))
                === canonical(chosen.action.citations.filter(citation => sameEvidenceRef(citation.ref, chosen.action!.anchorRef)).map(citation => [citation.start, citation.end]))));
          const proven = verifiedCorrection(prior, chosen) || (later.length === 1 && candidate.issue.issueId === prior.issue.issueId);
          if (!sameSource && !proven) { key = `issue:${hash([chosen.issue.issueId, "independent", refIdentity(chosen.action.anchorRef), chosen.action.id])}`; prior = staged.retained.get(key); }
        }
        const next = { ...chosen, issue: { ...chosen.issue, issueId: key } };
        // Repeated older source candidates cannot undo an already accepted explicit correction.
        if (prior && verifiedCorrection(next, prior)) { output.set(key, prior.issue); continue; }
        if (!prior && later.length === 1 && candidate.issue.issueId === chosen.issue.issueId) prior = candidate;
        save(staged, prior, next, later.length === 1 || (prior && verifiedCorrection(prior, next)) ? "verified_correction" : prior?.action && next.action && sameExpectation(prior.action, next.action) ? "same_expectation" : "source_revision");
        output.set(key, next.issue);
      }
      // Remove the prior context-only pending/unavailable receipt once requests exist.
      if (analysis.actions.length) for (const [key, retained] of Array.from(staged.retained)) if (!retained.action && retained.context.manifest.contextId === context.manifest.contextId) staged.retained.delete(key);
      staged.contexts.set(context.manifest.contextId, coverage);
      state.retained = staged.retained; state.histories = staged.histories; state.contexts = staged.contexts;
      return clone([...Array.from(output.values())]);
    },
    async getRetained(scope, input) { const { state } = await stateFor(scope); return clone(selected(state, input)); },
    async getIssue(scope, input) { const { state } = await stateFor(scope); return clone(selected(state, input)?.issue ?? null); },
    async replaceVerification(scopeValue, input, value) {
      const { state } = await stateFor(scopeValue), retained = selected(state, input);
      if (!retained?.action || !["complete", "partial"].includes(retained.issue.analysis.status)) throw new IssueError("STALE_ISSUE");
      const verification = verificationFor(retained.issue.identity, retained.action, value);
      if (targetOccurrenceKey(retained.issue.target) && targetOccurrenceKey(verification.target) && targetOccurrenceKey(retained.issue.target) !== targetOccurrenceKey(verification.target)) throw new IssueError("INVALID_SOURCE_REFERENCE");
      // Rechecks use the same certainty policy as initial publication: uncertain
      // requests remain Review, never a fabricated match or fulfillment upgrade.
      const uncertain = retained.issue.analysis.status !== "complete" || retained.action.ambiguous || retained.action.missingParameters.length > 0;
      const outcome = uncertain ? "review" : verification.outcome;
      const proof = outcome === verification.outcome ? verification : null;
      const issue = instinctIssueSchema.parse({ ...retained.issue, verification: proof, target: verification.target, outcome, explanation: proof?.explanation ?? retained.issue.explanation,
        priorityReason: outcome === "discrepancy" ? proof?.priorityReason ?? null : null, recordFingerprint: proof?.recordFingerprint ?? null, checkedAtUtc: proof?.checkedAtUtc ?? null,
        fulfillment: proof?.fulfillment ?? "unknown", notification: proof?.notification ?? "unknown", delivery: proof?.delivery ?? "unknown" });
      state.retained.set(issue.issueId, clone({ ...retained, issue }));
      const contextRetained = [...Array.from(state.retained.values())].filter(item => item.context.manifest.contextId === retained.context.manifest.contextId && item.action && item.issue.supersededBy === null);
      const sourceUnavailable = retained.context.evidence.filter(item => item.availability === "missing" || item.availability === "malformed" || item.originalText === null).length;
      const coverage = observationCoverage(scopeValue, { context: retained.context, identity: issue.identity, analysis: issue.analysis,
        coverage: { ...issue.coverage, analyzed: 0, unavailable: sourceUnavailable, unprocessed: issue.coverage.read - sourceUnavailable,
          partial: true, exclusions: issue.coverage.exclusions.filter(text => !text.startsWith("Analysis or exact record") && !text.startsWith("Context or exact request")) },
        verifications: contextRetained.flatMap(item => item.issue.verification && item.action ? [{ actionId: item.action.id, verification: item.issue.verification }] : []) });
      issue.coverage = coverage;
      state.retained.set(issue.issueId, clone({ ...retained, issue }));
      state.contexts.set(retained.context.manifest.contextId, coverage);
      return clone(issue);
    },
    async history(scope, input) { const { state } = await stateFor(scope); selected(state, input); return clone(state.histories.get(input.issueId) ?? []); },
    async setCoverage(scopeValue, value) { const { scope, state } = await stateFor(scopeValue); state.inventory = clone(assertCoverage(scope, value)); },
    async feed(scopeValue, input) {
      const { scope, state } = await stateFor(scopeValue);
      const coverage = state.inventory ?? combinedCoverage(scope, [...Array.from(state.contexts.values())], clock.now().toISOString());
      return buildIssueFeed(scope, [...Array.from(state.retained.values())].map(item => item.issue), coverage, input);
    },
  } satisfies IssueLedger);
}
export const createTransientIssueStore = createIssueLedger;
