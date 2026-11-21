import { z } from "zod";
import { publicReviewSchema, REVIEW_RESPONSE_RELEASE, type PublicReview } from "../../shared/reviewResponses";
import type { GbpReview } from "../gbpService";

const id = z.string().trim().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/);
const iso = z.string().datetime({ offset: true });
const thumbtackReview = z.object({
  reviewID: z.string().min(1).max(256), reviewText: z.string().max(20000).optional(), rating: z.number().int().min(1).max(5),
  createTime: iso, reviewerName: z.string().max(128).optional(), responseText: z.string().max(20000).nullable().optional(),
  responseTime: iso.nullable().optional(), negotiationID: z.string().min(1).max(128).nullable().optional(),
}).passthrough();
const thumbtackPage = z.object({ data: z.array(thumbtackReview).max(100), pagination: z.object({
  limit: z.number().int().min(1).max(100), offset: z.number().int().nonnegative(), next: z.string().nullable().optional(),
}).passthrough().optional() }).passthrough();

/** Normalize retained native provider data only. No account reads or webhook registration. */
export function normalizeThumbtackReviewPage(payload: unknown, scope: { accountId: string; businessId: string }) {
  id.parse(scope.accountId); id.parse(scope.businessId);
  const page = thumbtackPage.parse(payload);
  const reviews = page.data.map(row => {
    if (row.responseTime && !row.responseText?.trim()) throw new Error("Existing Thumbtack reply requires reconciliation");
    return publicReviewSchema.parse({ platform: "thumbtack", ...scope, reviewId: row.reviewID, rating: row.rating,
      reviewerName: row.reviewerName ?? "", text: row.reviewText ?? "", createdAt: row.createTime, updatedAt: null,
      existingResponse: row.responseText ?? null, negotiationId: row.negotiationID ?? null, source: "thumbtack_api" });
  });
  // Never follow provider-supplied arbitrary next URLs, including the documented /api-prefix variation.
  return { reviews, nextOffset: page.pagination?.next ? page.pagination.offset + page.pagination.limit : null };
}

const ratings = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 } as const;
export function normalizeGoogleReviewPage(payload: { reviews?: GbpReview[]; nextPageToken?: string }, scope: { accountId: string; businessId: string }) {
  id.parse(scope.accountId); id.parse(scope.businessId);
  if (!payload || (payload.reviews !== undefined && (!Array.isArray(payload.reviews) || payload.reviews.length > 50))) throw new Error("Invalid Google review page");
  const prefix = `accounts/${scope.accountId}/locations/${scope.businessId}/reviews/`;
  const reviews: PublicReview[] = (payload.reviews ?? []).map(row => {
    if (!row || !row.reviewId || row.name !== prefix + row.reviewId || !(row.starRating in ratings)) throw new Error("Google review identity mismatch");
    if (row.reviewReply && !row.reviewReply.comment?.trim()) throw new Error("Existing Google reply requires reconciliation");
    return publicReviewSchema.parse({ platform: "google", ...scope, reviewId: row.reviewId, rating: ratings[row.starRating],
      reviewerName: row.reviewer?.isAnonymous ? "" : row.reviewer?.displayName ?? "", text: row.comment ?? "", createdAt: row.createTime,
      updatedAt: row.updateTime ?? null, existingResponse: row.reviewReply?.comment ?? null, negotiationId: null, source: "google_api" });
  });
  if (payload.nextPageToken !== undefined && (typeof payload.nextPageToken !== "string" || payload.nextPageToken.length > 2048)) throw new Error("Invalid Google page token");
  return { reviews, nextPageToken: payload.nextPageToken ?? null };
}

/** Prepared read adapter reuses the existing GBP helper, but this release cannot call it. */
export async function readGoogleReviewPage(scope: { accountId: string; businessId: string }, pageToken?: string) {
  if (!REVIEW_RESPONSE_RELEASE.monitoringEnabled) throw new Error("Review monitoring is disabled in this release");
  id.parse(scope.accountId); id.parse(scope.businessId);
  if (pageToken && !/^[A-Za-z0-9_.~-]{1,2048}$/.test(pageToken)) throw new Error("Invalid page token");
  const { listGbpReviews } = await import("../gbpService");
  return normalizeGoogleReviewPage(await listGbpReviews(`accounts/${scope.accountId}/locations/${scope.businessId}`, pageToken), scope);
}

/** Partner credentials and review permissions are unverified; never guess an existing SMS credential. */
export async function readThumbtackReviewPage(scope: { accountId: string; businessId: string }, token: string, offset = 0,
  fetcher: typeof fetch = globalThis.fetch) {
  if (!REVIEW_RESPONSE_RELEASE.monitoringEnabled) throw new Error("Review monitoring is disabled in this release");
  id.parse(scope.accountId); id.parse(scope.businessId);
  if (!token.trim() || !Number.isSafeInteger(offset) || offset < 0) throw new Error("Invalid Thumbtack read configuration");
  const url = `https://api.thumbtack.com/api/v4/businesses/${encodeURIComponent(scope.businessId)}/reviews?limit=10&offset=${offset}`;
  const response = await fetcher(url, { method: "GET", redirect: "error", headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15000) });
  if (!response.ok) { void response.body?.cancel().catch(() => undefined); throw new Error("Thumbtack review read failed"); }
  return normalizeThumbtackReviewPage(await response.json(), scope);
}

/** No live publisher is installed. This gate precedes even identity/store/provider lookup. */
export async function publishPublicReviewResponse(): Promise<never> {
  throw new Error("Public review publication is disabled in this release");
}
