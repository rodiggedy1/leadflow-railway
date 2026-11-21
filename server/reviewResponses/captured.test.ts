import { describe, expect, it, vi } from "vitest";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { type SQL } from "drizzle-orm";
import type { ReviewEntry, ReviewResponseApi, ReviewResponseService } from "../../shared/reviewResponses";
import { CAPTURED_THUMBTACK_SCOPE, ingestCapturedThumbtackReviews, normalizeCapturedThumbtackReviews, readCapturedThumbtackReviews } from "./captured";
import { reviewIdentity } from "./policy";
vi.mock("../db", () => { throw Error("Runtime DB import forbidden"); });
vi.mock("@/lib/trpc", () => ({ trpc: {} }));
import { pullCapturedReviewsAndDrafts } from "../../client/src/pages/ReviewResponses";
function payload(patch: Record<string, unknown> = {}) {
  return { event: { eventType: "ReviewCreatedV4", webhookID: CAPTURED_THUMBTACK_SCOPE.webhookId },
    data: { reviewID: "review-1", reviewText: "Careful team", rating: 5, createTime: "2026-11-20T12:00:00Z", ...patch } };
}
function row(id = 1, value: unknown = payload()) { return { id, raw_payload: JSON.stringify(value) }; }
function entry(patch: Partial<ReviewEntry> = {}): ReviewEntry {
  const review = normalizeCapturedThumbtackReviews([row()])[0];
  return { key: reviewIdentity(review), revision: 1, review, status: "RECORDED", generatedDraft: null, approvedText: null,
    approvedBy: null, approvedAt: null, publishedResponse: null, publishedAt: null, generationRequestId: null, generationStartedAt: null,
    severityReasons: [], validationIssues: [], escalationStatus: "not_required", createdAt: 1, updatedAt: 1, events: [], ...patch };
}
describe("retained captured Thumbtack import — offline only", () => {
  it("normalizes verified webhook provenance and keeps omitted replies unknown", () => {
    expect(normalizeCapturedThumbtackReviews([row()])[0]).toMatchObject({ platform: "thumbtack", accountId: CAPTURED_THUMBTACK_SCOPE.accountId,
      businessId: CAPTURED_THUMBTACK_SCOPE.businessId, reviewId: "review-1", existingResponse: null, reviewerName: "", source: "thumbtack_webhook" });
  });
  it("deduplicates by reviewID using newest retained delivery ID without mutating input", () => {
    const rows = [row(1), row(3, payload({ reviewText: "Newest review" })), row(2, payload({ reviewID: "other" }))];
    const before = JSON.stringify(rows);
    expect(normalizeCapturedThumbtackReviews(rows).map(review => [review.reviewId, review.text])).toEqual([["review-1", "Newest review"], ["other", "Careful team"]]);
    expect(JSON.stringify(rows)).toBe(before);
  });
  it("fails closed for the wrong webhook, business, event or malformed payload", () => {
    for (const value of [null, [], { ...payload(), event: { eventType: "ReviewCreatedV4", webhookID: "wrong" } },
      { ...payload(), event: { eventType: "MessageCreatedV4", webhookID: CAPTURED_THUMBTACK_SCOPE.webhookId } },
      payload({ businessID: "wrong" }), payload({ business: { businessID: "wrong" } })]) expect(() => normalizeCapturedThumbtackReviews([row(2, value)])).toThrow();
    expect(() => normalizeCapturedThumbtackReviews([{ id: 1, raw_payload: "{" }])).toThrow();
  });
  it.each([{ rating: "5" }, { rating: 6 }, { reviewID: "" }, { reviewText: null }, { reviewText: undefined },
    { createTime: "2026-11-20" }, { reviewerName: 5 }, { negotiationID: "" }, { responseText: 5 }, { responseTime: "2026-11-20T12:00:00Z" }])("rejects invalid captured fields before deduplication: %j", patch => {
    expect(() => normalizeCapturedThumbtackReviews([row(2), row(1, payload(patch))])).toThrow();
  });
  it("rejects lossy IDs, duplicate delivery IDs and oversized pages", () => {
    expect(() => normalizeCapturedThumbtackReviews([{ ...row(), id: Number.MAX_SAFE_INTEGER + 1 }])).toThrow();
    expect(() => normalizeCapturedThumbtackReviews([row(), row()])).toThrow();
    expect(() => normalizeCapturedThumbtackReviews(Array.from({ length: 201 }, (_, index) => row(index + 1)))).toThrow();
  });
  it("issues exactly one parameterized SELECT for newest 200 review deliveries and no writes", async () => {
    const execute = vi.fn(async (_query: SQL) => [[row()], []]);
    await readCapturedThumbtackReviews({ execute } as any);
    expect(execute).toHaveBeenCalledTimes(1);
    const compiled = new MySqlDialect().sqlToQuery(execute.mock.calls[0][0]);
    expect(compiled.sql.replace(/\s+/g, " ").trim()).toBe("SELECT id, raw_payload FROM webhook_events WHERE source = ? AND event_type = ? ORDER BY id DESC LIMIT ?");
    expect(compiled.params).toEqual(["thumbtack", "ReviewCreatedV4", 200]);
    expect(compiled.sql).not.toMatch(/UPDATE|INSERT|DELETE|processed/i);
  });
  it("fails closed on invalid driver shapes and redacts driver errors", async () => {
    for (const result of [[], [null, []], [[{ ...row(), raw_payload: null }], []]]) await expect(readCapturedThumbtackReviews({ execute: async () => result } as any)).rejects.toThrow("could not be validated");
    await expect(readCapturedThumbtackReviews({ execute: async () => { throw Error("secret"); } } as any)).rejects.toThrow("Captured Thumbtack reviews could not be validated");
  });
  it("preserves saved drafted, edited, approved, failed and locked reviews on repeated import", async () => {
    for (const status of ["DRAFT_READY", "NEEDS_APPROVAL", "APPROVED", "FAILED", "DRAFTING", "UNCERTAIN", "PUBLISHED", "ALREADY_REPLIED"] as const) {
      const saved = entry({ status, generatedDraft: "Keep existing recommendation" });
      const service = { list: vi.fn(async () => [saved]), ingest: vi.fn(), generate: vi.fn() };
      expect(await ingestCapturedThumbtackReviews(service as unknown as ReviewResponseService, [saved.review], "server-admin")).toEqual([saved]);
      expect(service.ingest).not.toHaveBeenCalled(); expect(service.generate).not.toHaveBeenCalled();
    }
  });
  it("performs one explicit import then initial generation sequentially and one list, never overwriting saved drafts", async () => {
    const first = entry(), second = entry({ key: "b".repeat(64) }), saved = entry({ key: "c".repeat(64), status: "APPROVED", generatedDraft: "Keep", approvedText: "Keep", approvedAt: 2 });
    const calls: string[] = [];
    const api = { importCaptured: vi.fn(async () => { calls.push("import"); return [first, second, saved]; }),
      generate: vi.fn(async (key: string) => { calls.push(key); return entry({ key, revision: 3, status: "DRAFT_READY", generatedDraft: "Thanks" }); }),
      list: vi.fn(async () => { calls.push("list"); return [saved]; }) } as unknown as ReviewResponseApi;
    const result = await pullCapturedReviewsAndDrafts(api, { entry: vi.fn(), message: vi.fn(), current: () => true });
    expect(calls).toEqual(["import", first.key, second.key, "list"]);
    expect(result).toMatchObject({ importedCount: 3, draftedCount: 2 });
  });
  it("old fixtures lacking import stay compatible and canceled batches do not generate", async () => {
    const generate = vi.fn(), list = vi.fn();
    await expect(pullCapturedReviewsAndDrafts({ list, generate } as unknown as ReviewResponseApi, { entry: vi.fn(), message: vi.fn(), current: () => true })).rejects.toThrow("unavailable");
    await pullCapturedReviewsAndDrafts({ importCaptured: async () => [entry()], list, generate } as unknown as ReviewResponseApi, { entry: vi.fn(), message: vi.fn(), current: () => false });
    expect(generate).not.toHaveBeenCalled(); expect(list).not.toHaveBeenCalled();
  });
});
