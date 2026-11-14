import { createHash, randomUUID } from "node:crypto";
import {
  STAGE1_CAPABILITIES, apiFailureSchema, authorizedScopeSchema, sourcesInputSchema, sourceInventorySchema,
  feedInputSchema, checkInputSchema, checkResultSchema, selectedIssueInputSchema, dayReviewInputSchema,
  dayReviewResultSchema, chatAnswerSchema, askInputSchema, coverageReceiptSchema, sourceContextSchema,
  analysisReceiptSchema, verificationResultSchema, validateCitation, validateIdentityScope, sameEvidenceRef, sameRequestBinding,
  type ApiFailure, type AuthorizedScope, type AskInput, type ChatAnswer, type CheckInput, type CheckResult,
  type Clock, type CoverageReceipt, type DayReviewInput, type DayReviewResult, type EvidenceRef,
  type EvidenceTools, type InstinctApi, type InstinctFeed, type InstinctIssue, type InventoryBoundary,
  type ModelCallable, type NativeRecordReader, type NativeSnapshot, type SourceContext, type SourceInventory, type SourceReader,
  type SourcesInput, type StoredEvidence, type IdentityResolver,
} from "../../shared/instinct";
import { createStoredSourceReader } from "./sources";
import { createLazyReadDb, ReadDbError, type ReadDb, type InstallationReadScope } from "./readDb";
import { createNativeRecordReader, createSessionContactReader } from "./nativeRecords";
import { createIdentityResolver, resolveSourceIdentity, type IdentityResolverOptions } from "./identity";
import { createAnalysisRequest, createRequestInterpreter, type RequestInterpreter } from "./interpret";
import { createRequestVerifier, type RequestVerifier } from "./verify";
import { buildIssueFeed, createIssueLedger, targetOccurrenceKey, type IssueLedger } from "./issues";
import { createEvidenceTools, type InstinctEvidenceTools } from "./evidenceTools";
import { createInstinctChat } from "./chat";

export class InstinctServiceError extends Error {
  constructor(readonly code: ApiFailure["code"], readonly retryable = false) { super(code); this.name = "InstinctServiceError"; }
}
/** Only allowlisted classes are exposed. Never serialize driver/provider errors or causes. */
export function safeInstinctFailure(error: unknown): ApiFailure {
  if (error instanceof InstinctServiceError) return { code: error.code, retryable: error.retryable };
  if (error instanceof ReadDbError) return { code: error.reason, retryable: error.reason !== "DB_SCHEMA" };
  const parsed = apiFailureSchema.shape.code.safeParse(error instanceof Error ? error.message : null);
  const code = parsed.success ? parsed.data : "SOURCE_UNAVAILABLE";
  return { code, retryable: ["SOURCE_UNAVAILABLE", "DB_UNAVAILABLE", "DB_TIMEOUT", "DB_READ_FAILED", "MODEL_UNAVAILABLE", "MODEL_TIMEOUT"].includes(code) };
}
function hash(value: unknown): string { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
const refKey = (ref: EvidenceRef) => `${ref.store}:${ref.sourceId}`;
const observationKey = (ref: EvidenceRef) => ref.sourceKind === "ai_call" && ref.providerId ? `vapi:${ref.providerId}` : refKey(ref);
const exactRefKey = (ref: EvidenceRef) => hash(ref);
const unique = (values: readonly string[]) => [...Array.from(new Set(values))];
const transientLimitation = "Process-local transient observations only; no durable review, ownership, closed-page work or corrections.";
export interface InstinctChatContext {
  readonly store: IssueLedger;
  readonly clock: Clock;
  readonly feed: (scope: AuthorizedScope, input: Parameters<IssueLedger["feed"]>[1]) => Promise<InstinctFeed>;
}
export type InstinctAsk = (scope: AuthorizedScope, input: AskInput, tools: EvidenceTools, context: InstinctChatContext) => Promise<ChatAnswer>;
export interface InstinctServiceOptions {
  readonly scope: InstallationReadScope;
  readonly db?: ReadDb;
  readonly clock?: Clock;
  readonly model?: ModelCallable;
  readonly sources?: SourceReader;
  readonly nativeRecords?: NativeRecordReader;
  readonly identity?: IdentityResolver;
  readonly identityOptions?: IdentityResolverOptions;
  readonly interpreter?: RequestInterpreter;
  readonly verifier?: RequestVerifier;
  readonly store?: IssueLedger;
  readonly ask?: InstinctAsk;
  readonly businessLines?: readonly string[];
  readonly mailboxes?: readonly string[];
  readonly authorizeScope?: (scope: AuthorizedScope) => boolean | Promise<boolean>;
}
export interface InstinctService {
  readonly sources: (scope: AuthorizedScope, input: SourcesInput) => Promise<SourceInventory>;
  readonly feed: IssueLedger["feed"];
  readonly check: (scope: AuthorizedScope, input: CheckInput) => Promise<CheckResult>;
  readonly evidence: InstinctEvidenceTools["readScopedEvidence"];
  readonly reverify: InstinctEvidenceTools["reverifySelectedIssue"];
  readonly dayReview: (scope: AuthorizedScope, input: DayReviewInput) => Promise<DayReviewResult>;
  readonly ask: (scope: AuthorizedScope, input: AskInput) => Promise<ChatAnswer>;
  readonly tools: InstinctEvidenceTools;
  readonly forScope: (scope: AuthorizedScope) => InstinctApi;
}
interface ContextCheck { readonly revision: string; readonly coverage: CoverageReceipt }
interface ActorState {
  readonly issued: Map<string, EvidenceRef>;
  readonly observed: Map<string, StoredEvidence>;
  readonly missing: Set<string>;
  readonly checks: Map<string, ContextCheck>;
  readonly pending: Map<string, Promise<CheckResult>>;
  boundaries: CoverageReceipt["boundaries"];
  kinds: CoverageReceipt["sourceKinds"];
  continuation: string | null;
  exclusions: string[];
}
interface Scan {
  readonly actorKey: string;
  readonly inputKey: string;
  readonly mode: "sources" | "day";
  boundary: InventoryBoundary;
  readonly seen: Map<string, StoredEvidence>;
  readonly contexts: Set<string>;
  readonly exclusions: Set<string>;
}
/** Construction creates only lazy/injected dependencies and maps. No DB connection,
 * model invocation, timer, worker, source mutation or operational dispatch exists. */
export function createInstinctService(options: InstinctServiceOptions): InstinctService {
  const clock = options.clock ?? { now: () => new Date() };
  const authorize = async (value: AuthorizedScope) => {
    const parsed = authorizedScopeSchema.safeParse(value);
    if (!parsed.success || parsed.data.installationScope !== options.scope.installationScope
      || parsed.data.sourceAccountKey !== options.scope.sourceAccountKey
      || parsed.data.authorizationVersion !== options.scope.authorizationVersion
      || (options.authorizeScope && !(await options.authorizeScope(parsed.data)))) throw new InstinctServiceError("INVALID_SCOPE");
    return parsed.data;
  };
  const db = options.db ?? createLazyReadDb();
  const sources = options.sources ?? createStoredSourceReader({ scope: options.scope, db, clock });
  const nativeRecords = options.nativeRecords ?? createNativeRecordReader({ db, clock, authorizeScope: async s => { await authorize(s); return true; } });
  const identityOptions: IdentityResolverOptions = options.identityOptions ?? {
    getAccountBindings: s => ({ sourceAccountKey: s.sourceAccountKey, businessLines: options.businessLines ?? [], mailboxes: options.mailboxes ?? [] }),
    readSessionContacts: createSessionContactReader(db, async s => { await authorize(s); return true; }),
  };
  const identity = options.identity ?? createIdentityResolver(identityOptions);
  const interpreter = options.interpreter ?? createRequestInterpreter({ model: options.model });
  const verifier = options.verifier ?? createRequestVerifier({ nativeRecords, identity, clock, authorizeScope: async s => { await authorize(s); return true; } });
  const store = options.store ?? createIssueLedger({ clock, authorizeScope: async s => { await authorize(s); return true; } });
  const actors = new Map<string, ActorState>();
  const cursors = new Map<string, { scan: Scan; readerCursor: string }>();
  const actor = (scope: AuthorizedScope): ActorState => {
    const key = hash(scope); let state = actors.get(key);
    if (!state) { state = { issued: new Map(), observed: new Map(), missing: new Set(), checks: new Map(), pending: new Map(), boundaries: [], kinds: [], continuation: null, exclusions: [] }; actors.set(key, state); }
    return state;
  };
  const issued = (scope: AuthorizedScope, refs: readonly EvidenceRef[]) => {
    const state = actor(scope);
    if (!refs.length || refs.some(ref => ref.sourceAccountKey !== scope.sourceAccountKey || !state.issued.has(exactRefKey(ref)))) throw new InstinctServiceError("INVALID_SOURCE_REFERENCE");
  };
  const register = (scope: AuthorizedScope, evidence: readonly StoredEvidence[]) => {
    for (const item of evidence) actor(scope).issued.set(exactRefKey(item.ref), item.ref);
  };
  const aggregate = (scope: AuthorizedScope, state: ActorState, observed = state.observed, continuation = state.continuation,
    exclusions = state.exclusions, kinds = state.kinds, boundaries = state.boundaries): CoverageReceipt => {
    let analyzed = 0, unavailable = 0, unprocessed = 0;
    for (const item of Array.from(observed.values())) {
      const check = state.checks.get(item.ref.contextFingerprint);
      if (state.missing.has(observationKey(item.ref)) || item.originalText === null || ["missing", "malformed"].includes(item.availability)) unavailable++;
      else if (check && check.revision === item.ref.contextFingerprint && check.coverage.analyzed > 0
        && check.coverage.analyzed === check.coverage.read - check.coverage.unavailable) analyzed++;
      else if (check && check.revision === item.ref.contextFingerprint && check.coverage.read > 0 && check.coverage.unavailable === check.coverage.read) unavailable++;
      else unprocessed++;
    }
    const limitations = unique([...exclusions, ...[...Array.from(observed.values())].flatMap(item => {
      const check = state.checks.get(item.ref.contextFingerprint);
      return [...item.limitations, ...(check?.revision === item.ref.contextFingerprint ? check.coverage.exclusions : [])];
    })]);
    return coverageReceiptSchema.parse({ receiptId: `coverage:${hash([scope, [...Array.from(observed.keys())], analyzed, unavailable, unprocessed, continuation, limitations, boundaries])}`,
      authorizedScope: scope.installationScope, sourceAccountKey: scope.sourceAccountKey, sourceKinds: kinds, boundaries,
      continuation, read: observed.size, analyzed, unavailable, unprocessed,
      partial: !!continuation || !!unavailable || !!unprocessed || !!limitations.length || boundaries.some(b => b.availability !== "complete") || !kinds.length,
      exclusions: limitations, checkedAtUtc: clock.now().toISOString() });
  };
  const updateCoverage = async (scope: AuthorizedScope) => { await store.setCoverage(scope, aggregate(scope, actor(scope))); };
  const page = async (scope: AuthorizedScope, input: SourcesInput, mode: Scan["mode"]) => {
    const inputKey = hash([input.sourceKinds, input.localDay ?? null]);
    let scan: Scan, readerInput: SourcesInput;
    if (input.cursor) {
      const saved = cursors.get(input.cursor);
      if (!saved || saved.scan.actorKey !== hash(scope) || saved.scan.inputKey !== inputKey || saved.scan.mode !== mode) throw new InstinctServiceError("INVALID_SCOPE");
      // Replay forks page state; a lost response never consumes a continuation.
      scan = { ...saved.scan, seen: new Map(saved.scan.seen), contexts: new Set(saved.scan.contexts), exclusions: new Set(saved.scan.exclusions) };
      readerInput = { ...input, cursor: saved.readerCursor };
    } else {
      scan = { actorKey: hash(scope), inputKey, mode, boundary: await sources.captureBoundary(scope, input), seen: new Map(), contexts: new Set(), exclusions: new Set() };
      readerInput = input;
    }
    const result = sourceInventorySchema.parse(await sources.inventory(scope, readerInput, scan.boundary));
    if (result.coverage.authorizedScope !== scope.installationScope || result.inventory.sourceAccountKey !== scope.sourceAccountKey
      || result.inventory.authorizationVersion !== scope.authorizationVersion || result.inventory.inventoryId !== scan.boundary.inventoryId
      || JSON.stringify(result.inventory.sourceKinds) !== JSON.stringify(input.sourceKinds)) throw new InstinctServiceError("INVALID_SCOPE");
    scan.boundary = result.inventory;
    const readyEvidence: StoredEvidence[] = [];
    for (const ready of result.readyContexts ?? []) {
      const anchors = result.items.filter(item => item.ref.contextFingerprint === ready.contextFingerprint).map(item => item.ref);
      if (!anchors.length) throw new InstinctServiceError("INVALID_SOURCE_REFERENCE");
      const context = sourceContextSchema.parse(await sources.readContext(scope, anchors, ready.contextFingerprint));
      if (context.manifest.sourceAccountKey !== scope.sourceAccountKey || context.manifest.revision !== ready.contextFingerprint
        || context.manifest.contextFingerprint !== ready.contextFingerprint
        || [...anchors, ...ready.refs].some(ref => !context.evidence.some(item => sameEvidenceRef(item.ref, ref)))) throw new InstinctServiceError("STALE_CONTEXT");
      readyEvidence.push(...context.evidence.filter(item => ready.refs.some(ref => sameEvidenceRef(item.ref, ref))));
    }
    await authorize(scope);
    register(scope, result.items);
    register(scope, readyEvidence);
    for (const item of result.items) { const key = observationKey(item.ref); scan.seen.set(key, item); actor(scope).observed.set(key, item); actor(scope).missing.delete(key); }
    result.coverage.exclusions.forEach(value => scan.exclusions.add(value));
    let continuation: string | null = null;
    if (result.continuation) { continuation = `instinct-cursor:${randomUUID()}`; cursors.set(continuation, { scan, readerCursor: result.continuation }); }
    const state = actor(scope);
    const boundaries = new Map(state.boundaries.map(boundary => [boundary.store, boundary]));
    result.inventory.families.forEach(boundary => boundaries.set(boundary.store, boundary));
    state.boundaries = [...Array.from(boundaries.values())];
    state.kinds = [...Array.from(new Set([...state.kinds, ...input.sourceKinds]))];
    state.continuation = continuation;
    state.exclusions = unique([...state.exclusions, ...Array.from(scan.exclusions)]);
    if (!continuation && !input.localDay) {
      const stores = new Set(result.inventory.families.map(boundary => boundary.store));
      for (const [key, old] of Array.from(state.observed)) if (stores.has(old.ref.store) && !scan.seen.has(key)) {
        state.missing.add(key);
        const limitation = "Previously observed original is missing/deleted or its source family is unavailable; retained findings are not current proof.";
        scan.exclusions.add(limitation);
        state.exclusions = unique([...state.exclusions, limitation]);
      }
    }
    await updateCoverage(scope);
    return { scan, result: sourceInventorySchema.parse({ ...result, continuation,
      coverage: aggregate(scope, state, scan.seen, continuation, [...Array.from(scan.exclusions)], input.sourceKinds, result.inventory.families) }) };
  };
  const freshContext = async (scope: AuthorizedScope, input: CheckInput): Promise<SourceContext> => {
    issued(scope, input.sourceRefs);
    const context = sourceContextSchema.parse(await sources.readContext(scope, input.sourceRefs, input.expectedContextRevision));
    if (context.manifest.sourceAccountKey !== scope.sourceAccountKey || context.manifest.revision !== input.expectedContextRevision
      || context.manifest.contextFingerprint !== input.sourceRefs[0].contextFingerprint
      || input.sourceRefs.some(ref => !context.evidence.some(item => sameEvidenceRef(item.ref, ref)))) throw new InstinctServiceError("STALE_CONTEXT");
    register(scope, context.evidence); return context;
  };
  const contextCoverage = (scope: AuthorizedScope, context: SourceContext): CoverageReceipt => {
    const unavailable = context.evidence.filter(item => item.originalText === null || ["missing", "malformed"].includes(item.availability)).length;
    return coverageReceiptSchema.parse({ receiptId: `context-coverage:${hash([scope, context.manifest.contextFingerprint])}`, authorizedScope: scope.installationScope,
      sourceAccountKey: scope.sourceAccountKey, sourceKinds: [...Array.from(new Set(context.evidence.map(item => item.ref.sourceKind)))], boundaries: [], continuation: context.manifest.continuation,
      read: context.evidence.length, analyzed: 0, unavailable, unprocessed: context.evidence.length - unavailable, partial: true,
      exclusions: context.manifest.limitations, checkedAtUtc: clock.now().toISOString() });
  };
  const runCheck = async (scope: AuthorizedScope, input: CheckInput): Promise<CheckResult> => {
    const context = await freshContext(scope, input);
    // Discovery is intentionally NOT a verified identity. Native and actual source
    // session bindings must corroborate it before any definitive comparison.
    const discovery = await resolveSourceIdentity(scope, context, identityOptions);
    const candidates = await nativeRecords.readCandidates(scope, discovery);
    const customer = validateIdentityScope(await identity.resolve(scope, context, candidates), scope, context.evidence);
    const unchangedContext = async () => {
      const fresh = await freshContext(scope, input);
      if (fresh.manifest.contextId !== context.manifest.contextId || JSON.stringify(fresh.manifest.entries) !== JSON.stringify(context.manifest.entries)
        || JSON.stringify(fresh.evidence) !== JSON.stringify(context.evidence) || fresh.manifest.complete !== context.manifest.complete
        || JSON.stringify(fresh.manifest.limitations) !== JSON.stringify(context.manifest.limitations)) throw new InstinctServiceError("STALE_CONTEXT");
    };
    await unchangedContext();
    const analysis = analysisReceiptSchema.parse(await interpreter.interpret(scope, createAnalysisRequest(context)));
    if (analysis.contextRevision !== context.manifest.revision || analysis.contextFingerprint !== context.manifest.contextFingerprint) throw new InstinctServiceError("STALE_CONTEXT");
    for (const action of analysis.actions) {
      if (action.contextId !== context.manifest.contextId || !context.evidence.some(item => sameEvidenceRef(item.ref, action.anchorRef))) throw new InstinctServiceError("INVALID_SOURCE_REFERENCE");
      action.citations.forEach(citation => validateCitation(citation, scope, context.evidence));
    }
    await unchangedContext();
    const verifications = [];
    const retainedFeed = await store.feed(scope, { filter: "all" });
    if (analysis.status === "complete" || analysis.status === "partial") for (const action of analysis.actions) {
      const targets = [];
      for (const issue of retainedFeed.groups.flatMap(group => group.issues)) {
        if (issue.identity.fingerprint !== customer.fingerprint || issue.analysis.contextRevision !== context.manifest.revision || !targetOccurrenceKey(issue.target)) continue;
        const retained = await store.getRetained(scope, { issueId: issue.issueId, issueRevision: issue.revision });
        if (retained?.action?.id === action.id && retained.action.revision === action.revision) targets.push(retained.issue.target);
      }
      const verification = verificationResultSchema.parse(await verifier.verify(scope, customer, action, { context, ...(targets.length === 1 ? { target: targets[0] } : {}) }));
      verifications.push({ actionId: action.id, verification });
    }
    await unchangedContext();
    await authorize(scope);
    const issues = await store.publish(scope, { context, identity: customer, analysis, coverage: contextCoverage(scope, context), verifications });
    const coverage = issues[0]?.coverage ?? contextCoverage(scope, context);
    actor(scope).checks.set(context.manifest.contextFingerprint, { revision: context.manifest.revision, coverage });
    await updateCoverage(scope);
    return checkResultSchema.parse({ binding: { requestId: `check:${hash([scope, input])}`, contextRevision: context.manifest.revision, selectedIssueId: null, selectedIssueRevision: null },
      coverage, capabilities: STAGE1_CAPABILITIES, limitations: unique([transientLimitation, ...coverage.exclusions, ...analysis.limitations]),
      analysis, issues, contextRevision: context.manifest.revision });
  };
  const check = async (scopeValue: AuthorizedScope, inputValue: CheckInput): Promise<CheckResult> => {
    const scope = await authorize(scopeValue), input = checkInputSchema.parse(inputValue); issued(scope, input.sourceRefs);
    const state = actor(scope), key = hash(input);
    const existing = state.pending.get(key); if (existing) return existing;
    const pending = runCheck(scope, input).catch(error => { const failure = safeInstinctFailure(error); throw new InstinctServiceError(failure.code, failure.retryable); }); state.pending.set(key, pending);
    try { return await pending; } finally { if (state.pending.get(key) === pending) state.pending.delete(key); }
  };
  const feed: IssueLedger["feed"] = async (scopeValue, inputValue) => {
    const scope = await authorize(scopeValue), input = feedInputSchema.parse(inputValue);
    await updateCoverage(scope);
    const result = await store.feed(scope, input);
    // Newly inventoried edits cannot leave earlier outcomes displayed as current
    // even before the foreground queue reaches that changed context.
    const stale = (issue: InstinctIssue) => issue.identity.evidenceRefs.some(ref => {
      const observed = actor(scope).observed.get(observationKey(ref));
      return actor(scope).missing.has(observationKey(ref)) || (observed && (observed.ref.contextFingerprint !== ref.contextFingerprint
        || (ref.sourceKind !== "ai_call" && observed.ref.sourceRevision !== ref.sourceRevision)));
    });
    const items = result.groups.flatMap(group => group.issues).map(issue => stale(issue) ? {
      ...issue, outcome: "review" as const, explanation: "Stored source context changed; earlier interpretation and current-state proof require a fresh check.",
      verification: null, checkedAtUtc: null, recordFingerprint: null, priorityReason: null,
      fulfillment: "unknown" as const, notification: "unknown" as const, delivery: "unknown" as const,
    } : issue);
    return buildIssueFeed(scope, items, result.coverage, input);
  };
  const dayReview = async (scopeValue: AuthorizedScope, inputValue: DayReviewInput): Promise<DayReviewResult> => {
    const scope = await authorize(scopeValue), input = dayReviewInputSchema.parse(inputValue);
    const { result, scan } = await page(scope, { sourceKinds: input.sourceKinds, localDay: input.localDate, ...(input.cursor ? { cursor: input.cursor } : {}) }, "day");
    const contexts = new Map<string, EvidenceRef[]>();
    for (const item of result.items) contexts.set(item.ref.contextFingerprint, [...(contexts.get(item.ref.contextFingerprint) ?? []), item.ref]);
    for (const [revision, refs] of Array.from(contexts)) {
      try { const checked = await check(scope, { sourceRefs: refs, expectedContextRevision: revision }); checked.issues.forEach(issue => scan.contexts.add(issue.analysis.contextFingerprint)); }
      catch (error) {
        const failure = safeInstinctFailure(error); scan.exclusions.add(failure.code);
        const evidence = result.items.filter(item => item.ref.contextFingerprint === revision);
        const coverage = coverageReceiptSchema.parse({ ...result.coverage, receiptId: `day-failure:${hash([scope, revision])}`, continuation: null,
          read: evidence.length, analyzed: 0, unprocessed: 0, unavailable: evidence.length, partial: true, exclusions: [failure.code] });
        actor(scope).checks.set(revision, { revision, coverage });
      }
    }
    // The issued continuation retains the page's accumulated contexts/exclusions.
    if (result.continuation) { const saved = cursors.get(result.continuation); if (saved) { scan.contexts.forEach(value => saved.scan.contexts.add(value)); scan.exclusions.forEach(value => saved.scan.exclusions.add(value)); } }
    const current = await feed(scope, { filter: "all", localDay: input.localDate });
    const coverage = aggregate(scope, actor(scope), scan.seen, result.continuation, [...Array.from(scan.exclusions)], input.sourceKinds, result.inventory.families);
    return dayReviewResultSchema.parse({ binding: { requestId: `day:${hash([scope, input, coverage.receiptId])}`, contextRevision: null, selectedIssueId: null, selectedIssueRevision: null },
      coverage, capabilities: STAGE1_CAPABILITIES, limitations: unique([transientLimitation, ...coverage.exclusions]), localDate: input.localDate,
      timeZone: input.timeZone, groups: current.groups.map(group => ({ ...group, issues: group.issues.filter(issue => scan.contexts.has(issue.analysis.contextFingerprint)) }))
        .filter(group => group.issues.length).map(group => ({ ...group, requestCount: group.issues.filter(issue => issue.action !== null && issue.supersededBy === null).length })), continuation: result.continuation });
  };
  const tools = createEvidenceTools({ sources, nativeRecords, verifier, store, reviewDay: dayReview, authorizeScope: async s => { await authorize(s); return true; } });
  const service: InstinctService = Object.freeze({
    sources: async (scopeValue, inputValue) => { const scope = await authorize(scopeValue); return (await page(scope, sourcesInputSchema.parse(inputValue), "sources")).result; },
    feed, check,
    evidence: async (scopeValue, inputValue) => { const scope = await authorize(scopeValue); return tools.readScopedEvidence(scope, selectedIssueInputSchema.parse(inputValue)); },
    reverify: async (scopeValue, inputValue) => {
      const scope = await authorize(scopeValue), result = await tools.reverifySelectedIssue(scope, selectedIssueInputSchema.parse(inputValue));
      actor(scope).checks.set(result.issue.analysis.contextFingerprint, { revision: result.issue.analysis.contextRevision, coverage: result.coverage });
      await updateCoverage(scope); return result;
    },
    dayReview,
    ask: async (scopeValue, inputValue) => {
      const scope = await authorize(scopeValue), input = askInputSchema.parse(inputValue);
      let contextRevision: string | null = null;
      if (input.selectedIssueId && input.selectedIssueRevision) {
        const selected = await tools.readScopedEvidence(scope, { issueId: input.selectedIssueId, issueRevision: input.selectedIssueRevision });
        contextRevision = selected.binding.contextRevision;
      }
      const binding = { requestId: input.requestId, contextRevision, selectedIssueId: input.selectedIssueId ?? null, selectedIssueRevision: input.selectedIssueRevision ?? null };
      const unavailable = async (failure: ApiFailure) => { const current = await feed(scope, { filter: "all" }); return chatAnswerSchema.parse({ binding,
        coverage: current.coverage, capabilities: STAGE1_CAPABILITIES, limitations: [transientLimitation, "Grounded chat is unavailable; no answer or operation was fabricated."],
        threadId: input.threadId, status: "unavailable", answer: "Grounded investigation is unavailable. Your question can be retried; no booking was changed.",
        citations: [], recordCitations: [], comparison: null, failure }); };
      if (!options.ask) return unavailable({ code: "MODEL_UNAVAILABLE", retryable: true });
      let answer: ChatAnswer;
      const proofSnapshots = new Map<string, NativeSnapshot>();
      const proofOriginals = new Map<string, StoredEvidence>();
      const rememberSnapshot = (snapshot: NativeSnapshot | null) => { if (snapshot) proofSnapshots.set(snapshot.snapshotId, snapshot); };
      const selectedTool = (s: AuthorizedScope, selected: Parameters<EvidenceTools["readScopedEvidence"]>[1]) => {
        if (hash(s) !== hash(scope)) throw new InstinctServiceError("INVALID_SCOPE");
        if (input.selectedIssueId && (selected.issueId !== input.selectedIssueId || selected.issueRevision !== input.selectedIssueRevision)) throw new InstinctServiceError("STALE_ISSUE");
      };
      const chatTools: EvidenceTools = Object.freeze({
        readScopedEvidence: async (s: AuthorizedScope, selected: Parameters<EvidenceTools["readScopedEvidence"]>[1]) => {
          selectedTool(s, selected);
          const result = await tools.readScopedEvidence(s, selected); rememberSnapshot(result.snapshot);
          result.evidence.forEach(item => proofOriginals.set(exactRefKey(item.ref), item)); return result;
        },
        readExactCustomerRecords: async (s: AuthorizedScope, selected: Parameters<EvidenceTools["readExactCustomerRecords"]>[1]) => {
          selectedTool(s, selected);
          const result = await tools.readExactCustomerRecords(s, selected); rememberSnapshot(result); return result;
        },
        reverifySelectedIssue: async (s: AuthorizedScope, selected: Parameters<EvidenceTools["reverifySelectedIssue"]>[1]) => {
          selectedTool(s, selected);
          const result = await service.reverify(s, selected); rememberSnapshot(result.issue.verification?.snapshot ?? null); return result;
        },
        reviewCoverageDay: async (s: AuthorizedScope, day: DayReviewInput) => {
          if (hash(s) !== hash(scope)) throw new InstinctServiceError("INVALID_SCOPE");
          return tools.reviewCoverageDay(s, day);
        },
      });
      try { answer = chatAnswerSchema.parse(await options.ask(scope, input, chatTools, { store, clock, feed })); }
      catch (error) { return unavailable(safeInstinctFailure(error)); }
      if (!sameRequestBinding(answer.binding, binding) || answer.threadId !== input.threadId
        || answer.coverage.authorizedScope !== scope.installationScope || answer.coverage.sourceAccountKey !== scope.sourceAccountKey) throw new InstinctServiceError("STALE_ISSUE");
      for (const citation of answer.recordCitations) {
        const proof = proofSnapshots.get(citation.snapshotId), record = proof?.records.find(record => record.key === citation.recordKey);
        if (!record || proof?.checkedAtUtc !== citation.checkedAtUtc || record.fingerprint !== citation.recordFingerprint) throw new InstinctServiceError("INVALID_SOURCE_REFERENCE");
      }
      if (input.selectedIssueId && input.selectedIssueRevision) {
        const fresh = await tools.readScopedEvidence(scope, { issueId: input.selectedIssueId, issueRevision: input.selectedIssueRevision });
        answer.citations.forEach(citation => validateCitation(citation, scope, fresh.evidence));
        if (fresh.binding.contextRevision !== contextRevision) throw new InstinctServiceError("STALE_CONTEXT");
        for (const citation of answer.recordCitations) {
          const record = fresh.snapshot?.records.find(record => record.key === citation.recordKey);
          if (!record || record.fingerprint !== citation.recordFingerprint) throw new InstinctServiceError("STALE_ISSUE");
        }
        if (answer.comparison && (!fresh.snapshot || answer.comparison.identity.fingerprint !== fresh.issue.identity.fingerprint
          || targetOccurrenceKey(answer.comparison.target) !== targetOccurrenceKey(fresh.issue.target)
          || answer.comparison.snapshot?.fingerprint !== fresh.snapshot.fingerprint || answer.comparison.recordFingerprint !== fresh.snapshot.fingerprint)) throw new InstinctServiceError("STALE_ISSUE");
      } else if (answer.citations.length || answer.recordCitations.length) {
        // Free-question citations must originate in a server read-tool result.
        answer.citations.forEach(citation => validateCitation(citation, scope, [...Array.from(proofOriginals.values())]));
        for (const citation of answer.citations) validateCitation(citation, scope, [await sources.readExact(scope, citation.ref)]);
      }
      await authorize(scope); return answer;
    },
    tools,
    forScope: scope => ({ sources: input => service.sources(scope, input), feed: input => service.feed(scope, input), check: input => service.check(scope, input),
      evidence: input => service.evidence(scope, input), reverify: input => service.reverify(scope, input), dayReview: input => service.dayReview(scope, input), ask: input => service.ask(scope, input) }),
  } satisfies InstinctService);
  return service;
}

/** Nonsecret installation identity is derived from the current configured database
 * endpoint/database plus app/account identifiers. Credentials are neither hashed
 * into public IDs nor returned. Environment is inspected only on authorized use. */
export function resolveInstinctInstallation(env: Readonly<Record<string, string | undefined>> = process.env): InstallationReadScope {
  let endpoint: URL;
  try { endpoint = new URL(env.DATABASE_URL ?? ""); } catch { throw new InstinctServiceError("INVALID_SCOPE"); }
  if (!/^(?:mysql|mysql2):$/.test(endpoint.protocol) || !endpoint.hostname || endpoint.pathname === "/" || !endpoint.pathname) throw new InstinctServiceError("INVALID_SCOPE");
  const installationScope = `installation:${hash([endpoint.protocol, endpoint.hostname, endpoint.port || "3306", endpoint.pathname, env.VITE_APP_ID ?? ""])}`;
  const sourceAccountKey = `account:${hash([installationScope, env.OPENPHONE_PHONE_NUMBER_ID ?? "", env.OPENPHONE_CS_PHONE_NUMBER_ID ?? "", env.OPENPHONE_BARK_PHONE_NUMBER_ID ?? "", env.OPENPHONE_FROM_NUMBER ?? "", env.GMAIL_CLIENT_ID ?? ""])}`;
  return { installationScope, sourceAccountKey, authorizationVersion: "instinct-admin-stored-read-v1" };
}
let runtime: { key: string; service: InstinctService } | undefined;
export function getRuntimeInstinctService(): { scope: InstallationReadScope; service: InstinctService } {
  const scope = resolveInstinctInstallation(), key = hash(scope);
  if (!runtime || runtime.key !== key) runtime = { key, service: createInstinctService({ scope, ask: createInstinctChat(), businessLines: process.env.OPENPHONE_FROM_NUMBER ? [process.env.OPENPHONE_FROM_NUMBER] : [] }) };
  return { scope, service: runtime.service };
}
