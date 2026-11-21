import { sql } from "drizzle-orm";
import { z } from "zod";
import { publicReviewSchema, type PublicReview, type ReviewEntry, type ReviewResponseService } from "../../shared/reviewResponses";
import type { getDb } from "../db";
import { reviewIdentity } from "./policy";

/** Verified from retained business-bearing lead payloads, not a provider OAuth account. */
export const CAPTURED_THUMBTACK_SCOPE = Object.freeze({
  webhookId: "593076134892109838",
  businessId: "382987965776199683",
  accountId: "captured-webhook-593076134892109838",
});
export const CAPTURED_REVIEW_LIMIT = 200;
const iso = z.string().datetime({ offset: true });
const capturedPayload = z.object({
  event: z.object({ eventType: z.literal("ReviewCreatedV4"), webhookID: z.literal(CAPTURED_THUMBTACK_SCOPE.webhookId) }).passthrough(),
  data: z.object({
    reviewID: z.string().trim().min(1).max(256), reviewText: z.string().max(20000), rating: z.number().int().min(1).max(5),
    createTime: iso, reviewerName: z.string().max(128).optional(), negotiationID: z.string().trim().min(1).max(128).nullable().optional(),
    responseText: z.string().max(20000).nullable().optional(), responseTime: iso.nullable().optional(),
    businessID: z.literal(CAPTURED_THUMBTACK_SCOPE.businessId).optional(),
    business: z.object({ businessID: z.literal(CAPTURED_THUMBTACK_SCOPE.businessId) }).passthrough().optional(),
  }).passthrough(),
}).passthrough();

function invalid(): never { throw new Error("Captured Thumbtack reviews could not be validated"); }
function captureId(value: unknown): bigint {
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) return BigInt(value);
  if (typeof value === "bigint" && value > BigInt(0)) return value;
  if (typeof value === "string" && /^[1-9][0-9]*$/.test(value)) return BigInt(value);
  return invalid();
}

/** Validate every delivery before deduplication or ingestion; bad newest rows cannot fall back to older data. */
export function normalizeCapturedThumbtackReviews(rows: unknown): PublicReview[] {
  if (!Array.isArray(rows) || rows.length > CAPTURED_REVIEW_LIMIT) return invalid();
  const seenIds = new Set<bigint>();
  const deliveries = rows.map(row => {
    if (!row || typeof row !== "object" || Array.isArray(row) || typeof row.raw_payload !== "string") return invalid();
    const id = captureId(row.id);
    if (seenIds.has(id)) return invalid();
    seenIds.add(id);
    let decoded: unknown;
    try { decoded = JSON.parse(row.raw_payload); } catch { return invalid(); }
    const parsed = capturedPayload.safeParse(decoded);
    if (!parsed.success) return invalid();
    const data = parsed.data.data;
    if (data.responseTime && !data.responseText?.trim()) return invalid();
    const review = publicReviewSchema.parse({
      platform: "thumbtack", accountId: CAPTURED_THUMBTACK_SCOPE.accountId, businessId: CAPTURED_THUMBTACK_SCOPE.businessId,
      reviewId: data.reviewID, text: data.reviewText, rating: data.rating, reviewerName: data.reviewerName ?? "",
      createdAt: data.createTime, updatedAt: null, negotiationId: data.negotiationID ?? null,
      // Missing reply fields mean UNKNOWN current public reply status, never verified unanswered.
      existingResponse: data.responseText ?? null, source: "thumbtack_webhook",
    });
    return { id, review };
  }).sort((a, b) => a.id > b.id ? -1 : a.id < b.id ? 1 : 0);
  const newest = new Map<string, PublicReview>();
  for (const { review } of deliveries) if (!newest.has(review.reviewId)) newest.set(review.reviewId, review);
  return Array.from(newest.values());
}

/** SELECT only. Source deliveries and webhook dispatch are never changed; no live provider request exists. */
export async function readCapturedThumbtackReviews(db: Pick<NonNullable<Awaited<ReturnType<typeof getDb>>>, "execute">): Promise<PublicReview[]> {
  let result: unknown;
  try {
    result = await db.execute(sql`SELECT id, raw_payload FROM webhook_events
      WHERE source = ${"thumbtack"} AND event_type = ${"ReviewCreatedV4"} ORDER BY id DESC LIMIT ${CAPTURED_REVIEW_LIMIT}`);
  } catch { return invalid(); }
  if (!Array.isArray(result) || !Array.isArray(result[0])) return invalid();
  return normalizeCapturedThumbtackReviews(result[0]);
}

/** Human-triggered import only. Preserve saved recommendations, edits, approvals and locked/in-flight states. */
export async function ingestCapturedThumbtackReviews(service: ReviewResponseService, reviews: PublicReview[], actor: string): Promise<ReviewEntry[]> {
  const saved = new Map((await service.list(CAPTURED_REVIEW_LIMIT)).map(entry => [entry.key, entry]));
  const entries: ReviewEntry[] = [];
  for (const review of reviews) {
    const current = saved.get(reviewIdentity(review));
    if (current && (current.status !== "RECORDED" || current.generatedDraft !== null || current.approvedText !== null || current.approvedAt !== null)) {
      entries.push(current);
    } else {
      entries.push(await service.ingest(review, actor));
    }
  }
  return entries;
}
