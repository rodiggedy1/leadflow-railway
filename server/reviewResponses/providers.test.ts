import { afterEach, describe, expect, it, vi } from "vitest";
import { normalizeGoogleReviewPage, normalizeThumbtackReviewPage, readGoogleReviewPage, readThumbtackReviewPage, publishPublicReviewResponse } from "./providers";
const scope = { accountId: "account1", businessId: "biz1" };
const tt = { reviewID: "review1", rating: 5, reviewText: "The kitchen looked great.", createTime: "2026-11-20T12:00:00Z", reviewerName: "Synthetic reviewer", negotiationID: "neg1" };
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
describe("review provider adapters — offline only", () => {
  it("preserves native Thumbtack identity, negotiation and existing response", () => {
    const got = normalizeThumbtackReviewPage({ data: [{ ...tt, responseText: "Existing reply", responseTime: tt.createTime }] }, scope);
    expect(got.reviews[0]).toMatchObject({ ...scope, reviewId: "review1", negotiationId: "neg1", source: "thumbtack_api", existingResponse: "Existing reply" });
  });
  it("does not follow arbitrary pagination URLs", () => {
    expect(normalizeThumbtackReviewPage({ data: [tt], pagination: { limit: 10, offset: 20, next: "https://malicious.invalid/key" } }, scope).nextOffset).toBe(30);
  });
  it.each([{ rating: 0 }, { reviewID: "" }, { createTime: "yesterday" }, { responseTime: tt.createTime }])("rejects malformed or unresolved existing Thumbtack replies %j", patch => {
    expect(() => normalizeThumbtackReviewPage({ data: [{ ...tt, ...patch }] }, scope)).toThrow();
  });
  it("uses strict Google account/location/review identity and native reply", () => {
    const review = { name: "accounts/account1/locations/biz1/reviews/gr1", reviewId: "gr1", reviewer: { displayName: "Synthetic reviewer" }, starRating: "FOUR" as const,
      createTime: tt.createTime, updateTime: tt.createTime, comment: "Good work", reviewReply: { comment: "Already answered", updateTime: tt.createTime } };
    expect(normalizeGoogleReviewPage({ reviews: [review] }, scope).reviews[0]).toMatchObject({ rating: 4, source: "google_api", existingResponse: "Already answered" });
    expect(() => normalizeGoogleReviewPage({ reviews: [{ ...review, name: "accounts/other/locations/biz1/reviews/gr1" }] }, scope)).toThrow();
    expect(() => normalizeGoogleReviewPage({ reviews: [{ ...review, reviewReply: { comment: "", updateTime: tt.createTime } }] }, scope)).toThrow();
  });
  it("blocks every provider read and publication before network even if env tries to enable", async () => {
    vi.stubEnv("REVIEW_MONITORING_ENABLED", "true"); vi.stubEnv("REVIEW_PUBLICATION_ENABLED", "true");
    const fetcher = vi.fn(() => { throw new Error("NETWORK FORBIDDEN"); }); vi.stubGlobal("fetch", fetcher);
    await expect(readGoogleReviewPage(scope)).rejects.toThrow("disabled");
    await expect(readThumbtackReviewPage(scope, "mock-not-a-key", 0, fetcher)).rejects.toThrow("disabled");
    await expect(publishPublicReviewResponse()).rejects.toThrow("disabled");
    expect(fetcher).not.toHaveBeenCalled();
  });
});
