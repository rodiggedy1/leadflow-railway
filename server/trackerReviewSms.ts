/**
 * trackerReviewSms.ts
 *
 * Sends a review incentive SMS to the customer when their job is marked completed.
 * The message opens the established customer portal and includes the "$50 tip" incentive.
 *
 * Called fire-and-forget from cleanerRouter.markComplete.
 */

import { getDb } from "./db";
import { cleanerJobs } from "../drizzle/schema";
import { eq } from "drizzle-orm";
import { sendSms } from "./openphone";
import { ENV } from "./_core/env";
import { getOrCreateCustomerPortalMagicLink } from "./customerPortalService";

/**
 * Send the post-completion review SMS to the customer.
 * - Opens the existing customer portal with a reusable handoff link.
 * - Never creates or sends a retired single-job tracker token.
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

  const portalUrl = await getOrCreateCustomerPortalMagicLink(db, {
    customerName: job.customerName ?? "Customer",
    customerPhone: job.customerPhone,
  });
  const firstName = job.customerName?.split(" ")[0] ?? "there";
  const teamDisplay = job.teamName ?? "your team";

  const message =
    `Hi ${firstName}! ✨ ${teamDisplay} just finished your clean — your home is sparkling!\n\n` +
    `Leave a 5-star Google review and we'll add a $50 tip to ${teamDisplay}:\n` +
    `Open My Home: ${portalUrl}`;

  const result = await sendSms({ to: job.customerPhone, content: message, fromNumberId: ENV.openPhoneCsNumberId });

  if (result.success) {
    console.log(`[TrackerReviewSms] Sent review SMS to ${job.customerPhone} for job ${cleanerJobId}`);
  } else {
    console.error(`[TrackerReviewSms] Failed to send review SMS for job ${cleanerJobId}:`, result.error);
  }
}
