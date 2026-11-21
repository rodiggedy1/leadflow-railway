import { randomUUID } from "node:crypto";
import {
  publicReviewSchema,
  reviewEntrySchema,
  reviewGenerationResultSchema,
  type PublicReview,
  type ReviewEntry,
  type ReviewGenerator,
  type ReviewResponseService,
  type ReviewStore,
  type SafeBookingContext,
} from "../../shared/reviewResponses";
import { reviewIdentity, safeBookingContext, severityReasonsFor, validateReviewResponse } from "./policy";

export interface ReviewResponseServiceOptions {
  store: ReviewStore;
  generator: ReviewGenerator;
  now?: () => number;
  requestId?: () => string;
  bookingContext?: (review: PublicReview) => Promise<SafeBookingContext | null>;
}

export class ReviewResponseError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "ReviewResponseError";
  }
}

const fail = (code: string): never => { throw new ReviewResponseError(code); };
const immutable = (entry: ReviewEntry): boolean => entry.status === "PUBLISHED" || entry.status === "UNCERTAIN";
const replied = (entry: ReviewEntry): boolean => entry.status === "ALREADY_REPLIED" || !!entry.review.existingResponse?.trim();
const clearApproval = { approvedText: null, approvedBy: null, approvedAt: null } as const;
const clearGeneration = { generationRequestId: null, generationStartedAt: null } as const;

/** No publisher, monitor, notifications, application imports or automatic jobs exist here. */
export function createReviewResponseService(options: ReviewResponseServiceOptions): ReviewResponseService {
  const { store, generator } = options;
  const now = options.now ?? Date.now;
  const requestId = options.requestId ?? randomUUID;

  const actorFor = (actor: string): string => {
    if (typeof actor !== "string" || !actor.trim() || actor.length > 256) fail("INVALID_ACTOR");
    // Actor comes from the authenticated server adapter, never generation output.
    return actor.trim();
  };
  const keyFor = (key: string): string => {
    if (!new RegExp("^[a-f0-9]{64}$", "u").test(key)) fail("INVALID_KEY");
    return key;
  };
  const revisionFor = (revision: number): void => {
    if (!Number.isSafeInteger(revision) || revision < 1) fail("INVALID_REVISION");
  };
  const load = async (key: string): Promise<ReviewEntry> => {
    const entry = await store.get(keyFor(key));
    if (!entry) return fail("NOT_FOUND");
    return entry;
  };
  const editable = (entry: ReviewEntry): void => {
    if (immutable(entry) || replied(entry)) fail("REVIEW_LOCKED");
  };
  const auditCapacity = (entry: ReviewEntry, needed = 1): void => {
    if (entry.events.length + needed > 1000) fail("AUDIT_CAPACITY_REACHED");
  };
  const advance = (entry: ReviewEntry, patch: Partial<ReviewEntry>, actor: string, action: string): ReviewEntry => {
    auditCapacity(entry);
    const at = now();
    return reviewEntrySchema.parse({
      ...entry,
      ...patch,
      key: entry.key,
      revision: entry.revision + 1,
      createdAt: entry.createdAt,
      updatedAt: at,
      events: [...entry.events, { at, actor, action, text: null }],
    });
  };
  const save = async (previous: ReviewEntry, next: ReviewEntry): Promise<ReviewEntry> => {
    if (!await store.compareAndSwap(previous.key, previous.revision, next)) return fail("REVISION_CONFLICT");
    return next;
  };
  const contextFor = async (review: PublicReview): Promise<SafeBookingContext | null> => {
    if (!options.bookingContext) return null;
    const context = await options.bookingContext(structuredClone(review));
    if (context === null) return null;
    const safe = safeBookingContext(review, context);
    if (!safe) return fail("INVALID_BOOKING_CONTEXT");
    return safe;
  };
  const recentFor = async (entry: ReviewEntry): Promise<string[]> => {
    // Same business/platform/account only. Reads do not mutate unrelated rows.
    const rows = await store.list();
    return rows.filter(row => row.key !== entry.key &&
      row.review.platform === entry.review.platform &&
      row.review.accountId === entry.review.accountId &&
      row.review.businessId === entry.review.businessId)
      .sort((a, b) => b.updatedAt - a.updatedAt || b.revision - a.revision || b.key.localeCompare(a.key))
      .map(row => row.publishedResponse ?? row.approvedText ?? row.generatedDraft)
      .filter((text): text is string => !!text?.trim()).slice(0, 10);
  };

  return {
    async list(limit) {
      if (limit !== undefined && (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000)) fail("INVALID_LIMIT");
      return store.list(limit);
    },

    async ingest(input, actor) {
      const by = actorFor(actor);
      const review = publicReviewSchema.parse(input);
      const key = reviewIdentity(review);
      const at = now();
      const reasons = severityReasonsFor(review);
      const hasResponse = !!review.existingResponse?.trim();
      const initial = reviewEntrySchema.parse({
        key, revision: 1, review,
        status: hasResponse ? "ALREADY_REPLIED" : "RECORDED",
        generatedDraft: null, ...clearApproval,
        publishedResponse: hasResponse ? review.existingResponse : null,
        // Import time is not a claimed original publication timestamp.
        publishedAt: null, ...clearGeneration,
        severityReasons: reasons, validationIssues: [],
        escalationStatus: reasons.length ? "management_required" : "not_required",
        createdAt: at, updatedAt: at,
        events: [{ at, actor: by, action: hasResponse ? "ingested_existing_response" : "ingested", text: null }],
      });
      if (await store.insertIfAbsent(initial)) return initial;
      const current = await load(key);
      // Never unfreeze publication/uncertainty on reimport; no automatic retry.
      if (immutable(current) || JSON.stringify(current.review) === JSON.stringify(review)) return current;
      auditCapacity(current);
      // A partial/manual reimport cannot erase evidence of a known public reply.
      const knownResponse = hasResponse ? review.existingResponse : current.publishedResponse ?? current.review.existingResponse;
      const responseLocked = hasResponse || replied(current) || !!knownResponse?.trim();
      return save(current, advance(current, {
        review: responseLocked ? { ...review, existingResponse: knownResponse } : review,
        status: responseLocked ? "ALREADY_REPLIED" : "RECORDED",
        generatedDraft: null, ...clearApproval, ...clearGeneration,
        publishedResponse: responseLocked ? knownResponse : null,
        publishedAt: null,
        severityReasons: reasons, validationIssues: [],
        escalationStatus: reasons.length ? "management_required" : "not_required",
      }, by, responseLocked ? "reimported_existing_response" : "review_changed"));
    },

    async generate(key, actor) {
      const by = actorFor(actor);
      const current = await load(key);
      if (replied(current)) return current;
      editable(current);
      if (current.status === "DRAFTING") return fail("GENERATION_IN_PROGRESS");
      auditCapacity(current, 2);
      const id = requestId();
      if (typeof id !== "string" || !id.trim() || id.length > 128) return fail("INVALID_REQUEST_ID");
      const reasons = severityReasonsFor(current.review);
      const claim = advance(current, {
        status: "DRAFTING", generatedDraft: null, ...clearApproval,
        generationRequestId: id, generationStartedAt: now(),
        severityReasons: reasons, validationIssues: [],
        escalationStatus: reasons.length ? "management_required" : "not_required",
      }, by, "generation_claimed");
      // Claim must be durable before any optional context or provider operation.
      await save(current, claim);
      let completed: ReviewEntry;
      try {
        const bookingContext = await contextFor(claim.review);
        const recentResponses = await recentFor(claim);
        // Reimport/edit during context lookup prevents even a stale provider call.
        const stillClaimed = await load(key);
        if (stillClaimed.revision !== claim.revision || stillClaimed.generationRequestId !== id) return stillClaimed;
        const result = reviewGenerationResultSchema.parse(await generator.generate({
          review: structuredClone(claim.review), requestId: id,
          recentResponses: [...recentResponses], bookingContext: bookingContext ? structuredClone(bookingContext) : null,
        }));
        if (result.requestId !== id || result.reviewId !== claim.review.reviewId) fail("GENERATION_BINDING_MISMATCH");
        const issues = validateReviewResponse({
          review: claim.review, text: result.responseText, recentResponses, bookingContext, generation: result,
        });
        completed = advance(claim, {
          status: issues.length ? "FAILED" : (claim.review.rating <= 4 || reasons.length ? "NEEDS_APPROVAL" : "DRAFT_READY"),
          // Schema/binding-verified recommendations remain visible for admin editing.
          // A rejected recommendation is not an approvable draft; FAILED and all issues stay intact.
          generatedDraft: result.responseText,
          validationIssues: issues, ...clearApproval,
        }, by, issues.length ? "generation_validation_failed" : "draft_generated");
      } catch {
        // Never persist raw exceptions, provider diagnostics, private context or IDs.
        completed = advance(claim, {
          status: "FAILED", generatedDraft: null, ...clearApproval,
          validationIssues: ["generation_failed"],
        }, by, "generation_failed");
      }
      if (await store.compareAndSwap(key, claim.revision, completed)) return completed;
      // Late completions/failures cannot overwrite an edit, approval or reimport.
      return load(key);
    },

    async edit(key, text, expectedRevision, actor) {
      const by = actorFor(actor);
      revisionFor(expectedRevision);
      const current = await load(key);
      if (current.revision !== expectedRevision) return fail("REVISION_CONFLICT");
      editable(current);
      auditCapacity(current);
      if (typeof text !== "string" || !text.trim() || text.length > 20000) return fail("INVALID_RESPONSE_TEXT");
      const trimmed = text.trim();
      const bookingContext = await contextFor(current.review);
      const recentResponses = await recentFor(current);
      const issues = validateReviewResponse({ review: current.review, text: trimmed, recentResponses, bookingContext });
      const reasons = severityReasonsFor(current.review);
      return save(current, advance(current, {
        generatedDraft: trimmed, ...clearApproval, ...clearGeneration,
        status: current.review.rating <= 4 || reasons.length || issues.length ? "NEEDS_APPROVAL" : "DRAFT_READY",
        severityReasons: reasons, validationIssues: issues,
        escalationStatus: reasons.length ? "management_required" : "not_required",
      }, by, "draft_edited"));
    },

    async approve(key, expectedRevision, actor) {
      const by = actorFor(actor);
      revisionFor(expectedRevision);
      const current = await load(key);
      if (current.revision !== expectedRevision) return fail("REVISION_CONFLICT");
      editable(current);
      auditCapacity(current);
      if (!["DRAFT_READY", "NEEDS_APPROVAL", "APPROVED"].includes(current.status) || !current.generatedDraft) return fail("NO_APPROVABLE_DRAFT");
      const bookingContext = await contextFor(current.review);
      const recentResponses = await recentFor(current);
      const issues = validateReviewResponse({ review: current.review, text: current.generatedDraft, recentResponses, bookingContext });
      if (current.validationIssues.length || issues.length) return fail("VALIDATION_FAILED");
      const reasons = severityReasonsFor(current.review);
      // The server adapter must restrict this explicit approval to management
      // for severityReasons. Acknowledgement alone never sets approvedText.
      return save(current, advance(current, {
        status: "APPROVED", approvedText: current.generatedDraft,
        approvedBy: by, approvedAt: now(), severityReasons: reasons,
        escalationStatus: reasons.length ? current.escalationStatus === "acknowledged" ? "acknowledged" : "management_required" : "not_required",
        validationIssues: [],
      }, by, "human_approved"));
    },

    async acknowledge(key, expectedRevision, actor) {
      const by = actorFor(actor);
      revisionFor(expectedRevision);
      const current = await load(key);
      if (current.revision !== expectedRevision) return fail("REVISION_CONFLICT");
      editable(current);
      auditCapacity(current);
      if (!current.severityReasons.length) return fail("NO_ESCALATION_REQUIRED");
      if (current.status === "DRAFTING") return fail("GENERATION_IN_PROGRESS");
      // Changes only the persisted acknowledgement flag; never grants approval.
      return save(current, advance(current, { escalationStatus: "acknowledged" }, by, "management_acknowledged"));
    },

    async publish(_key, _actor): Promise<never> {
      // Unconditional hard lock, before validation, storage, context or provider I/O.
      return fail("PUBLICATION_DISABLED");
    },
  };
}
