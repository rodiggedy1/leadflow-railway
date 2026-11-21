import { describe, expect, it, vi } from "vitest";
import {
  publicReviewSchema,
  reviewEntrySchema,
  REVIEW_RESPONSE_RELEASE,
  type PublicReview,
  type ReviewEntry,
  type ReviewGenerationInput,
  type ReviewGenerationResult,
  type ReviewGenerator,
  type ReviewStore,
} from "../../shared/reviewResponses";
import { createReviewResponseService } from "./service";

class MemoryStore implements ReviewStore {
  rows = new Map<string, ReviewEntry>();
  reads = 0;
  lists = 0;
  inserts = 0;
  swaps: Array<{ key: string; revision: number; next: ReviewEntry }> = [];
  rejectNextSwap = false;
  async get(key: string): Promise<ReviewEntry | null> {
    this.reads++;
    return structuredClone(this.rows.get(key) ?? null);
  }
  async list(limit?: number): Promise<ReviewEntry[]> {
    this.lists++;
    return [...this.rows.values()].slice(0, limit).map(entry => structuredClone(entry));
  }
  async insertIfAbsent(entry: ReviewEntry): Promise<boolean> {
    this.inserts++;
    if (this.rows.has(entry.key)) return false;
    this.rows.set(entry.key, structuredClone(entry));
    return true;
  }
  async compareAndSwap(key: string, revision: number, next: ReviewEntry): Promise<boolean> {
    this.swaps.push({ key, revision, next: structuredClone(next) });
    if (this.rejectNextSwap) { this.rejectNextSwap = false; return false; }
    if (this.rows.get(key)?.revision !== revision) return false;
    expect(next.key).toBe(key);
    expect(next.revision).toBe(revision + 1);
    reviewEntrySchema.parse(next);
    this.rows.set(key, structuredClone(next));
    return true;
  }
}

const review = (patch: Partial<PublicReview> = {}): PublicReview => publicReviewSchema.parse({
  platform: "google", accountId: "account", businessId: "business", reviewId: "review",
  rating: 5, reviewerName: "", text: "Great work!", createdAt: "2026-11-20T12:00:00Z", ...patch,
});
const result = (input: ReviewGenerationInput, patch: Partial<ReviewGenerationResult> = {}): ReviewGenerationResult => ({
  requestId: input.requestId, reviewId: input.review.reviewId,
  responseText: "Thanks for the kind review! It means a lot to us.",
  groundingQuotes: input.review.text ? [input.review.text] : [], safetyFlags: [], unsupportedClaims: [], ...patch,
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function fixture(generate?: ReviewGenerator["generate"]) {
  const store = new MemoryStore();
  let time = 100;
  let request = 0;
  const generator = { generate: vi.fn(generate ?? (async input => result(input))) };
  const service = createReviewResponseService({ store, generator, now: () => ++time, requestId: () => `request-${++request}` });
  return { store, generator, service };
}

// No database, provider, network, timers, application server or integration code
// is imported. The only generator and store used by these tests are the fakes.
describe("isolated review response service", () => {
  it("starts with all monitoring and publication switches disabled", () => {
    expect(REVIEW_RESPONSE_RELEASE).toEqual({ monitoringEnabled: false, publicationEnabled: false, autoPublishEnabled: false });
  });

  it("deduplicates concurrent imports by the full identity without touching unrelated records", async () => {
    const { service, store } = fixture();
    const untouched = await service.ingest(review({ businessId: "other" }), "server-admin");
    const [first, second] = await Promise.all([service.ingest(review(), "server-admin"), service.ingest(review(), "server-admin")]);
    expect(first.key).toBe(second.key);
    expect(store.rows.size).toBe(2);
    expect(await store.get(untouched.key)).toEqual(untouched);
    expect(store.swaps).toHaveLength(0);
    expect(first.revision).toBe(1);
    expect(first.review.source).toBe("manual");
  });

  it("validates imports strictly and rejects unknown sources without a grant", async () => {
    const { service, store } = fixture();
    await expect(service.ingest({ ...review(), source: "unknown" } as unknown as PublicReview, "server-admin")).rejects.toThrow();
    await expect(service.ingest({ ...review(), actor: "spoofed" } as unknown as PublicReview, "server-admin")).rejects.toThrow();
    expect(store.inserts).toBe(0);
  });

  it("existing response import skips generator and context and cannot be edited or approved", async () => {
    const { store, generator } = fixture();
    const context = vi.fn();
    const service = createReviewResponseService({ store, generator, bookingContext: context });
    const entry = await service.ingest(review({ existingResponse: "The owner already replied" }), "server-admin");
    expect(entry.status).toBe("ALREADY_REPLIED");
    expect(entry.publishedAt).toBeNull();
    expect(await service.generate(entry.key, "server-admin")).toEqual(entry);
    expect(generator.generate).not.toHaveBeenCalled();
    expect(context).not.toHaveBeenCalled();
    await expect(service.edit(entry.key, "Another response", entry.revision, "server-admin")).rejects.toThrow("REVIEW_LOCKED");
    await expect(service.approve(entry.key, entry.revision, "server-admin")).rejects.toThrow("REVIEW_LOCKED");
  });

  it("imports rating-only reviews with no invented customer or booking information", async () => {
    const { service, generator } = fixture(async input => result(input, { responseText: "Thank you for the five stars!" }));
    const entry = await service.ingest(review({ text: "" }), "server-admin");
    const generated = await service.generate(entry.key, "server-admin");
    expect(generated.status).toBe("DRAFT_READY");
    expect(generator.generate.mock.calls[0][0].bookingContext).toBeNull();
    expect(generator.generate.mock.calls[0][0].review.reviewerName).toBe("");
  });

  it("claims DRAFTING by revision CAS before provider and binds request and review IDs", async () => {
    const { service, store, generator } = fixture();
    const entry = await service.ingest(review(), "trusted-server");
    generator.generate.mockImplementation(async input => {
      const claimed = store.rows.get(entry.key)!;
      expect(claimed.status).toBe("DRAFTING");
      expect(claimed.revision).toBe(2);
      expect(claimed.generationRequestId).toBe(input.requestId);
      expect(claimed.generationStartedAt).not.toBeNull();
      expect(claimed.approvedText).toBeNull();
      return result(input);
    });
    const generated = await service.generate(entry.key, "trusted-server");
    expect(generated.status).toBe("DRAFT_READY");
    expect(generated.revision).toBe(3);
    expect(generated.events.every(event => event.actor === "trusted-server")).toBe(true);
    expect(generated.generationRequestId).toBe("request-1");
    expect(store.swaps.map(swap => swap.next.status)).toEqual(["DRAFTING", "DRAFT_READY"]);
  });

  it("does not call provider when a generation claim loses CAS", async () => {
    const { service, store, generator } = fixture();
    const entry = await service.ingest(review(), "server-admin");
    store.rejectNextSwap = true;
    await expect(service.generate(entry.key, "server-admin")).rejects.toThrow("REVISION_CONFLICT");
    expect(generator.generate).not.toHaveBeenCalled();
    expect(await store.get(entry.key)).toEqual(entry);
  });

  it("only one concurrent generation claims a review", async () => {
    const ready = deferred<ReviewGenerationInput>();
    const completion = deferred<ReviewGenerationResult>();
    const { service, generator } = fixture(async input => { ready.resolve(input); return completion.promise; });
    const entry = await service.ingest(review(), "server-admin");
    const first = service.generate(entry.key, "server-admin");
    const input = await ready.promise;
    await expect(service.generate(entry.key, "server-admin")).rejects.toThrow("GENERATION_IN_PROGRESS");
    completion.resolve(result(input));
    await first;
    expect(generator.generate).toHaveBeenCalledTimes(1);
  });

  it.each(["requestId", "reviewId"] as const)("rejects mismatched %s with a durable safe failure", async field => {
    const { service, store } = fixture(async input => result(input, { [field]: "other-private-id" }));
    const entry = await service.ingest(review(), "server-admin");
    const failed = await service.generate(entry.key, "server-admin");
    expect(failed.status).toBe("FAILED");
    expect(failed.validationIssues).toEqual(["generation_failed"]);
    expect(failed.generatedDraft).toBeNull();
    expect(await store.get(entry.key)).toEqual(failed);
    expect(JSON.stringify(failed)).not.toContain("other-private-id");
  });

  it("persists a fixed provider failure without secrets, raw diagnostics or retries", async () => {
    const { service, generator, store } = fixture(async () => { throw new Error("TOKEN_SECRET customer's private address"); });
    const entry = await service.ingest(review(), "server-admin");
    const failed = await service.generate(entry.key, "server-admin");
    expect(failed.status).toBe("FAILED");
    expect(failed.validationIssues).toEqual(["generation_failed"]);
    expect(JSON.stringify(failed)).not.toContain("TOKEN_SECRET");
    expect(JSON.stringify(failed)).not.toContain("private address");
    expect(generator.generate).toHaveBeenCalledTimes(1);
    expect(await store.get(entry.key)).toEqual(failed);
  });

  it("rejects malformed model output safely", async () => {
    const { service } = fixture(async () => ({ responseText: "missing binding" } as ReviewGenerationResult));
    const entry = await service.ingest(review(), "server-admin");
    expect((await service.generate(entry.key, "server-admin")).validationIssues).toEqual(["generation_failed"]);
  });

  it("fails closed on provider safety flags, unsupported claims and invalid quotes", async () => {
    const { service } = fixture(async input => result(input, {
      safetyFlags: ["private leak"], unsupportedClaims: ["invented history"], groundingQuotes: ["not in this review"],
    }));
    const entry = await service.ingest(review(), "server-admin");
    const failed = await service.generate(entry.key, "server-admin");
    expect(failed.status).toBe("FAILED");
    expect(failed.generatedDraft).toBe("Thanks for the kind review! It means a lot to us.");
    expect(failed.validationIssues).toEqual(expect.arrayContaining(["provider_safety_flags", "provider_unsupported_claims", "invalid_grounding_quote"]));
    await expect(service.approve(failed.key, failed.revision, "server-admin")).rejects.toThrow("NO_APPROVABLE_DRAFT");
    const edited = await service.edit(failed.key, "Thank you for sharing your feedback.", failed.revision, "server-admin");
    expect(edited.validationIssues).toEqual([]);
    expect(edited.status).toBe("DRAFT_READY");
    expect((await service.approve(edited.key, edited.revision, "server-admin")).status).toBe("APPROVED");
  });

  it("changed imports invalidate all draft and approval data but preserve unrelated rows", async () => {
    const { service, store } = fixture();
    const other = await service.ingest(review({ reviewId: "other" }), "server-admin");
    const entry = await service.ingest(review(), "server-admin");
    const generated = await service.generate(entry.key, "server-admin");
    const approved = await service.approve(entry.key, generated.revision, "manager-authenticated");
    const changed = await service.ingest(review({ text: "Different feedback", rating: 2 }), "server-admin");
    expect(changed.revision).toBe(approved.revision + 1);
    expect(changed.status).toBe("RECORDED");
    expect(changed.generatedDraft).toBeNull();
    expect(changed.approvedText).toBeNull();
    expect(changed.approvedAt).toBeNull();
    expect(changed.approvedBy).toBeNull();
    expect(changed.generationRequestId).toBeNull();
    expect(changed.escalationStatus).toBe("management_required");
    expect(await store.get(other.key)).toEqual(other);
    expect(store.swaps.every(swap => swap.key === entry.key)).toBe(true);
  });

  it("ingest CAS conflicts are surfaced instead of overwriting another change", async () => {
    const { service, store } = fixture();
    const entry = await service.ingest(review(), "server-admin");
    store.rejectNextSwap = true;
    await expect(service.ingest(review({ text: "Changed" }), "server-admin")).rejects.toThrow("REVISION_CONFLICT");
    expect(await store.get(entry.key)).toEqual(entry);
  });

  it.each(["PUBLISHED", "UNCERTAIN"] as const)("never retries or resets %s even on changed reimport", async status => {
    const { service, store, generator } = fixture();
    const entry = await service.ingest(review(), "server-admin");
    const locked = { ...entry, status };
    store.rows.set(entry.key, locked);
    expect(await service.ingest(review({ text: "Changed" }), "server-admin")).toEqual(locked);
    await expect(service.generate(entry.key, "server-admin")).rejects.toThrow("REVIEW_LOCKED");
    await expect(service.edit(entry.key, "A draft", 1, "server-admin")).rejects.toThrow("REVIEW_LOCKED");
    await expect(service.approve(entry.key, 1, "server-admin")).rejects.toThrow("REVIEW_LOCKED");
    expect(generator.generate).not.toHaveBeenCalled();
    expect(store.swaps).toHaveLength(0);
  });

  it("regeneration explicitly clears approved text, actor and timestamp before provider", async () => {
    const { service, store, generator } = fixture();
    const entry = await service.ingest(review(), "server-admin");
    const draft = await service.generate(entry.key, "server-admin");
    await service.approve(entry.key, draft.revision, "manager-authenticated");
    generator.generate.mockImplementation(async input => {
      const claim = store.rows.get(entry.key)!;
      expect(claim.approvedText).toBeNull();
      expect(claim.approvedBy).toBeNull();
      expect(claim.approvedAt).toBeNull();
      return result(input);
    });
    const regenerated = await service.generate(entry.key, "server-admin");
    expect(regenerated.status).toBe("DRAFT_READY");
    expect(regenerated.approvedText).toBeNull();
  });

  it.each(["edit", "reimport", "existing_response"] as const)("late provider completion cannot overwrite %s", async operation => {
    const ready = deferred<ReviewGenerationInput>();
    const completion = deferred<ReviewGenerationResult>();
    const { service, store } = fixture(async input => { ready.resolve(input); return completion.promise; });
    const entry = await service.ingest(review(), "server-admin");
    const pending = service.generate(entry.key, "server-admin");
    const input = await ready.promise;
    const claimed = (await store.get(entry.key))!;
    const newer = operation === "edit"
      ? await service.edit(entry.key, "A human-written thank you.", claimed.revision, "manager-authenticated")
      : await service.ingest(review(operation === "existing_response" ? { existingResponse: "Public reply exists" } : { text: "A changed review" }), "server-admin");
    completion.resolve(result(input, { responseText: "Obsolete generated response" }));
    expect(await pending).toEqual(newer);
    expect(await store.get(entry.key)).toEqual(newer);
  });

  it("late provider failure cannot overwrite a newer human edit", async () => {
    const ready = deferred<ReviewGenerationInput>();
    const completion = deferred<ReviewGenerationResult>();
    const { service, store } = fixture(async input => { ready.resolve(input); return completion.promise; });
    const entry = await service.ingest(review(), "server-admin");
    const pending = service.generate(entry.key, "server-admin");
    await ready.promise;
    const claim = (await store.get(entry.key))!;
    const edited = await service.edit(entry.key, "A human-written thank you.", claim.revision, "manager-authenticated");
    completion.reject(new Error("secret failure"));
    expect(await pending).toEqual(edited);
  });

  it("stale generation does not call provider after a delayed context lookup", async () => {
    const entered = deferred<boolean>();
    const release = deferred<null>();
    const { store, generator } = fixture();
    const service = createReviewResponseService({
      store, generator, bookingContext: async () => { entered.resolve(true); return release.promise; },
    });
    const entry = await service.ingest(review(), "server-admin");
    const pending = service.generate(entry.key, "server-admin");
    await entered.promise;
    const imported = await service.ingest(review({ text: "Changed during lookup" }), "server-admin");
    release.resolve(null);
    expect(await pending).toEqual(imported);
    expect(generator.generate).not.toHaveBeenCalled();
  });

  it("edits and approvals enforce optimistic revisions and authenticated actor provenance", async () => {
    const { service, store } = fixture();
    const entry = await service.ingest(review(), "import-server");
    const edited = await service.edit(entry.key, " Thank you for sharing this review. ", entry.revision, "editor-server");
    expect(edited.generatedDraft).toBe("Thank you for sharing this review.");
    await expect(service.edit(entry.key, "A stale edit", entry.revision, "editor-server")).rejects.toThrow("REVISION_CONFLICT");
    await expect(service.approve(entry.key, entry.revision, "approver-server")).rejects.toThrow("REVISION_CONFLICT");
    const approved = await service.approve(entry.key, edited.revision, "approver-server");
    expect(approved.approvedText).toBe(edited.generatedDraft);
    expect(approved.approvedBy).toBe("approver-server");
    expect(approved.approvedAt).not.toBeNull();
    expect(approved.events.map(event => event.actor)).toEqual(["import-server", "editor-server", "approver-server"]);
    expect(await store.get(entry.key)).toEqual(approved);
    const revised = await service.edit(entry.key, "Another human thank-you.", approved.revision, "editor-server");
    expect(revised.approvedAt).toBeNull();
    expect(revised.approvedText).toBeNull();
  });

  it("unsafe manual edits remain unapproved with issue codes; approval cannot bypass", async () => {
    const { service } = fixture();
    const entry = await service.ingest(review(), "server-admin");
    const edited = await service.edit(entry.key, "Email private@example.com for a refund", entry.revision, "editor-server");
    expect(edited.status).toBe("NEEDS_APPROVAL");
    expect(edited.validationIssues).toContain("compensation_not_allowed");
    expect(edited.approvedText).toBeNull();
    await expect(service.approve(entry.key, edited.revision, "manager-authenticated")).rejects.toThrow("VALIDATION_FAILED");
  });

  it("approval revalidates against newly loaded private context", async () => {
    const { store, generator } = fixture();
    let excluded: string[] = [];
    const service = createReviewResponseService({ store, generator, bookingContext: async () => ({
      verified: true, matchMethod: "explicit_booking_link", bookingId: "private-booking",
      serviceType: null, privateTermsToExclude: excluded,
    }) });
    const entry = await service.ingest(review({ reviewerName: "Blueberry" }), "server-admin");
    const edited = await service.edit(entry.key, "Thank you, Blueberry.", entry.revision, "editor-server");
    expect(edited.validationIssues).toEqual([]);
    excluded = ["Blueberry"];
    await expect(service.approve(entry.key, edited.revision, "manager-authenticated")).rejects.toThrow("VALIDATION_FAILED");
  });

  it("approval revalidates against the current consecutive business response", async () => {
    const { service } = fixture();
    const entry = await service.ingest(review(), "server-admin");
    const edited = await service.edit(entry.key, "Thanks for sharing! We enjoyed reading this.", entry.revision, "editor-server");
    const other = await service.ingest(review({ reviewId: "other" }), "server-admin");
    await service.edit(other.key, "Thanks for sharing! A different middle and close.", other.revision, "editor-server");
    await expect(service.approve(entry.key, edited.revision, "manager-authenticated")).rejects.toThrow("VALIDATION_FAILED");
  });

  it("approval cannot overwrite an edit that occurs during context revalidation", async () => {
    const { store, generator } = fixture();
    const entered = deferred<boolean>();
    const release = deferred<null>();
    let delay = false;
    const service = createReviewResponseService({ store, generator, bookingContext: async () => {
      if (delay) { entered.resolve(true); return release.promise; }
      return null;
    } });
    const entry = await service.ingest(review(), "server-admin");
    const edited = await service.edit(entry.key, "Thank you for sharing.", entry.revision, "editor-server");
    delay = true;
    const pending = service.approve(entry.key, edited.revision, "manager-authenticated");
    await entered.promise;
    const imported = await service.ingest(review({ text: "Changed after draft" }), "server-admin");
    release.resolve(null);
    await expect(pending).rejects.toThrow("REVISION_CONFLICT");
    expect(await store.get(entry.key)).toEqual(imported);
  });

  it.each([
    { rating: 2, text: "Poor experience" },
    { rating: 5, text: "The staff broke my vase" },
    { rating: 5, text: "Theft and legal action" },
  ])("persists management escalation without notifications and acknowledgement does not approve: %o", async patch => {
    const { service } = fixture();
    const entry = await service.ingest(review(patch), "server-admin");
    expect(entry.escalationStatus).toBe("management_required");
    const draft = await service.generate(entry.key, "server-admin");
    expect(draft.status).toBe("NEEDS_APPROVAL");
    const acknowledged = await service.acknowledge(entry.key, draft.revision, "manager-authenticated");
    expect(acknowledged.escalationStatus).toBe("acknowledged");
    expect(acknowledged.status).toBe("NEEDS_APPROVAL");
    expect(acknowledged.approvedText).toBeNull();
    expect(acknowledged.approvedBy).toBeNull();
    expect(acknowledged.approvedAt).toBeNull();
    const approved = await service.approve(entry.key, acknowledged.revision, "manager-authenticated");
    expect(approved.status).toBe("APPROVED");
    expect(approved.severityReasons.length).toBeGreaterThan(0);
    await expect(service.publish(entry.key, "manager-authenticated")).rejects.toThrow("PUBLICATION_DISABLED");
  });

  it("four-star drafts require explicit human approval", async () => {
    const { service } = fixture();
    const entry = await service.ingest(review({ rating: 4 }), "server-admin");
    const draft = await service.generate(entry.key, "server-admin");
    expect(draft.status).toBe("NEEDS_APPROVAL");
    expect(draft.escalationStatus).toBe("not_required");
    await expect(service.acknowledge(entry.key, draft.revision, "manager-authenticated")).rejects.toThrow("NO_ESCALATION_REQUIRED");
  });

  it("uses only verified optional context and blocks actual private context in output", async () => {
    const { store, generator } = fixture();
    const service = createReviewResponseService({ store, generator, bookingContext: async () => ({
      verified: true, matchMethod: "explicit_booking_link", bookingId: "booking-private-xyz",
      serviceType: "Deep clean", privateTermsToExclude: ["Hidden Address Unit Red"],
    }) });
    generator.generate.mockImplementation(async input => result(input, { responseText: "Thank you at Hidden Address Unit Red." }));
    const entry = await service.ingest(review(), "server-admin");
    const failed = await service.generate(entry.key, "server-admin");
    expect(failed.status).toBe("FAILED");
    expect(failed.validationIssues).toContain("private_context_term");
    expect(failed.generatedDraft).toBe("Thank you at Hidden Address Unit Red.");
    await expect(service.approve(failed.key, failed.revision, "server-admin")).rejects.toThrow("NO_APPROVABLE_DRAFT");
    expect(generator.generate.mock.calls[0][0].bookingContext?.privateTermsToExclude).toContain("booking-private-xyz");
  });

  it("invalid or failing context fails generation closed before provider", async () => {
    const { store, generator } = fixture();
    const service = createReviewResponseService({ store, generator, bookingContext: async () => { throw new Error("private diagnostic"); } });
    const entry = await service.ingest(review(), "server-admin");
    expect((await service.generate(entry.key, "server-admin")).validationIssues).toEqual(["generation_failed"]);
    expect(generator.generate).not.toHaveBeenCalled();
  });

  it("recent responses are isolated to the same account, business and platform", async () => {
    const { service, generator } = fixture();
    for (const patch of [{ accountId: "other" }, { businessId: "other" }, { platform: "thumbtack" as const }]) {
      const unrelated = await service.ingest(review(patch), "server-admin");
      await service.edit(unrelated.key, "Thanks for the kind review! It means a lot to us.", unrelated.revision, "editor-server");
    }
    const entry = await service.ingest(review(), "server-admin");
    const draft = await service.generate(entry.key, "server-admin");
    expect(draft.status).toBe("DRAFT_READY");
    expect(generator.generate.mock.calls[0][0].recentResponses).toEqual([]);
  });

  it.each(["manual", "google_api", "thumbtack_api", "thumbtack_webhook"] as const)("source %s never grants publication; publish rejects before ANY I/O", async source => {
    const store: ReviewStore = {
      get: vi.fn(async () => { throw new Error("I/O forbidden"); }),
      list: vi.fn(async () => { throw new Error("I/O forbidden"); }),
      insertIfAbsent: vi.fn(async () => { throw new Error("I/O forbidden"); }),
      compareAndSwap: vi.fn(async () => { throw new Error("I/O forbidden"); }),
    };
    const generator = { generate: vi.fn(async () => { throw new Error("provider forbidden"); }) };
    const bookingContext = vi.fn(async () => { throw new Error("lookup forbidden"); });
    const service = createReviewResponseService({ store, generator, bookingContext });
    // Even malformed keys/actors or environment switches cannot weaken the lock.
    await expect(service.publish(`invalid-${source}`, "")).rejects.toThrow("PUBLICATION_DISABLED");
    for (const operation of Object.values(store)) expect(operation).not.toHaveBeenCalled();
    expect(generator.generate).not.toHaveBeenCalled();
    expect(bookingContext).not.toHaveBeenCalled();
  });

  it("rejects empty or oversized actors before storage I/O", async () => {
    const { service, store } = fixture();
    await expect(service.ingest(review(), " ")).rejects.toThrow("INVALID_ACTOR");
    await expect(service.ingest(review(), "x".repeat(257))).rejects.toThrow("INVALID_ACTOR");
    expect(store.reads + store.inserts + store.lists + store.swaps.length).toBe(0);
  });
});

describe("audit capacity and retained public replies", () => {
  it("retains a known public response when a manual reimport omits it", async () => {
    const { service, generator } = fixture();
    const entry = await service.ingest(review({ source: "google_api", existingResponse: "Known public response" }), "server-admin");
    const imported = await service.ingest(review({ source: "manual", text: "Changed review", existingResponse: null }), "server-admin");
    expect(imported.status).toBe("ALREADY_REPLIED");
    expect(imported.review.existingResponse).toBe("Known public response");
    expect(imported.publishedResponse).toBe("Known public response");
    expect(imported.revision).toBe(entry.revision + 1);
    expect(await service.generate(imported.key, "server-admin")).toEqual(imported);
    expect(generator.generate).not.toHaveBeenCalled();
    const changedReply = await service.ingest(review({ existingResponse: "Updated public response" }), "server-admin");
    expect(changedReply.status).toBe("ALREADY_REPLIED");
    expect(changedReply.review.existingResponse).toBe("Updated public response");
  });

  it("fails closed at audit capacity before changing history or consulting providers/context", async () => {
    const { store, generator } = fixture();
    const context = vi.fn(async () => null);
    const service = createReviewResponseService({ store, generator, bookingContext: context });
    const entry = await service.ingest(review({ rating: 2 }), "server-admin");
    const full = reviewEntrySchema.parse({
      ...entry, status: "NEEDS_APPROVAL", generatedDraft: "Thank you for sharing.",
      events: Array.from({ length: 1000 }, (_, at) => ({ at, actor: "server-admin", action: `event-${at}`, text: null })),
    });
    store.rows.set(full.key, structuredClone(full));
    await expect(service.generate(full.key, "server-admin")).rejects.toThrow("AUDIT_CAPACITY_REACHED");
    await expect(service.edit(full.key, "Edited", full.revision, "server-admin")).rejects.toThrow("AUDIT_CAPACITY_REACHED");
    await expect(service.approve(full.key, full.revision, "manager-authenticated")).rejects.toThrow("AUDIT_CAPACITY_REACHED");
    await expect(service.acknowledge(full.key, full.revision, "manager-authenticated")).rejects.toThrow("AUDIT_CAPACITY_REACHED");
    await expect(service.ingest(review({ rating: 2, text: "Changed" }), "server-admin")).rejects.toThrow("AUDIT_CAPACITY_REACHED");
    expect(await store.get(full.key)).toEqual(full);
    expect(store.swaps).toHaveLength(0);
    expect(generator.generate).not.toHaveBeenCalled();
    expect(context).not.toHaveBeenCalled();
  });

  it("reserves both generation events and never drops the first audit event", async () => {
    const { service, store, generator } = fixture();
    const entry = await service.ingest(review(), "server-admin");
    const events = Array.from({ length: 999 }, (_, at) => ({ at, actor: "server-admin", action: `event-${at}`, text: null }));
    store.rows.set(entry.key, { ...entry, events });
    await expect(service.generate(entry.key, "server-admin")).rejects.toThrow("AUDIT_CAPACITY_REACHED");
    expect(generator.generate).not.toHaveBeenCalled();
    store.rows.set(entry.key, { ...entry, events: events.slice(0, 998) });
    const generated = await service.generate(entry.key, "server-admin");
    expect(generated.status).toBe("DRAFT_READY");
    expect(generated.events).toHaveLength(1000);
    expect(generated.events.slice(0, 998)).toEqual(events.slice(0, 998));
    expect(generated.events[0]).toEqual(events[0]);
  });
});

describe("acknowledgement during generation", () => {
  it("does not change an in-flight generation revision", async () => {
    const ready = deferred<ReviewGenerationInput>();
    const completion = deferred<ReviewGenerationResult>();
    const { service, store } = fixture(async input => { ready.resolve(input); return completion.promise; });
    const entry = await service.ingest(review({ rating: 2 }), "server-admin");
    const pending = service.generate(entry.key, "server-admin");
    const input = await ready.promise;
    const claim = (await store.get(entry.key))!;
    await expect(service.acknowledge(entry.key, claim.revision, "manager-authenticated")).rejects.toThrow("GENERATION_IN_PROGRESS");
    expect(await store.get(entry.key)).toEqual(claim);
    completion.resolve(result(input));
    const draft = await pending;
    expect(draft.status).toBe("NEEDS_APPROVAL");
    expect(draft.revision).toBe(claim.revision + 1);
  });
});
