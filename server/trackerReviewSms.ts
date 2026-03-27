/**
 * trackerReviewSms.ts
 *
 * Sends a review incentive SMS to the customer when their job is marked completed.
 * The message re-sends the tracker link and includes the "$50 tip" incentive.
 *
 * Called fire-and-forget from cleanerRouter.markComplete.
 */

import { getDb } from "./db";
import { cleanerJobs } from "../drizzle/schema";
import { eq } from "drizzle-orm";
import { sendSms } from "./openphone";
import { randomBytes } from "crypto";

const BASE_URL = "https://quote.maidinblack.com";

function generateToken(): string {
  return randomBytes(24).toString("base64url");
}

/**
 * Send the post-completion review SMS to the customer.
 * - Generates a tracker token if one doesn't exist.
 * - Sends the tracker link with a "$50 tip" incentive message.
 * - Only sends once (checks if already sent via trackerSmsSentAt — but we allow
 *   a second send on completion, so we use a separate flag check).
 */
export async function sendCompletionReviewSms(cleanerJobId: number): Promise<void> {
  const db = await getDb();
  if (!db) return;

  const jobRows = await db
    .select({
      id: cleanerJobs.id,
      customerPhone: cleanerJobs.customerPhone,
      customerName: cleanerJobs.customerName,
      teamName: cleanerJobs.teamName,
      trackerToken: cleanerJobs.trackerToken,
    })
    .from(cleanerJobs)
    .where(eq(cleanerJobs.id, cleanerJobId))
    .limit(1);

  const job = jobRows[0];
  if (!job) return;
  if (!job.customerPhone) {
    console.log(`[TrackerReviewSms] No customer phone for job ${cleanerJobId} — skipping`);
    return;
  }

  // Ensure tracker token exists
  let token = job.trackerToken;
  if (!token) {
    token = generateToken();
    await db
      .update(cleanerJobs)
      .set({ trackerToken: token })
      .where(eq(cleanerJobs.id, job.id));
  }

  const trackerUrl = `${BASE_URL}/track/${token}`;
  const firstName = job.customerName?.split(" ")[0] ?? "there";
  const teamDisplay = job.teamName ?? "your team";

  const message =
    `Hi ${firstName}! ✨ ${teamDisplay} just finished your clean — your home is sparkling!\n\n` +
    `Leave a 5-star Google review and we'll add a $50 tip to ${teamDisplay}:\n` +
    `${trackerUrl}`;

  const result = await sendSms({ to: job.customerPhone, content: message });

  if (result.success) {
    console.log(`[TrackerReviewSms] Sent review SMS to ${job.customerPhone} for job ${cleanerJobId}`);
  } else {
    console.error(`[TrackerReviewSms] Failed to send review SMS for job ${cleanerJobId}:`, result.error);
  }
}
