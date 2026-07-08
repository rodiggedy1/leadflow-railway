/**
 * CampaignSender.ts — Stage 5 Send Engine
 *
 * Orchestrates the send loop for a single APPROVED campaign.
 * Reads only PENDING recipients, writes one sms_campaign_send_log row per
 * attempt, updates recipient status, and finalizes the campaign counters.
 *
 * Provider call is intentionally stubbed for preview:
 *   - Writes action = "TEST_SENT" to sms_campaign_send_log
 *   - Behaves as if every send succeeded
 *   - No OpenPhone API call is made
 *
 * When moving to production, replace the stub in sendOneMessage() with the
 * real OpenPhone call. Everything else remains identical.
 */

import { and, eq, sql } from "drizzle-orm";
import type { MySql2Database } from "drizzle-orm/mysql2";
import {
  smsCampaigns,
  smsCampaignRecipients,
  smsCampaignSendLog,
  type SmsCampaignRecipient,
} from "../../drizzle/schema";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SendResult {
  campaignId: number;
  sentCount: number;
  failedCount: number;
  skippedCount: number;
  durationMs: number;
  /** COMPLETED = all processed; PARTIAL = some failures */
  campaignStatus: "COMPLETED" | "PARTIAL";
  sentAt: number; // Unix ms
}

interface ProviderResult {
  success: boolean;
  openPhoneMessageId?: string;
  errorMessage?: string;
  durationMs: number;
}

// ─── Provider stub ────────────────────────────────────────────────────────────

/**
 * Sends one SMS via OpenPhone.
 *
 * In PREVIEW_MODE (Railway preview environment) the real API call is skipped
 * and a stub result is returned — so preview deployments never fire real SMS.
 * In production (PREVIEW_MODE unset / false) the real OpenPhone API is called.
 *
 * The PREVIEW_MODE guard lives here, NOT in openphone.ts — see the warning
 * comment in that file explaining why.
 */
async function sendOneMessage(
  phone: string,
  message: string,
): Promise<ProviderResult> {
  const { ENV } = await import("../_core/env");

  // ── Preview stub ────────────────────────────────────────────────────────
  if (ENV.isPreviewMode) {
    await new Promise((r) => setTimeout(r, 50));
    console.log(`[CampaignSender] PREVIEW_MODE — skipping real send to ${phone}`);
    return {
      success: true,
      openPhoneMessageId: `PREVIEW_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      durationMs: 50,
    };
  }

  // ── Real OpenPhone send ─────────────────────────────────────────────────
  const { sendSms } = await import("../openphone");
  const start = Date.now();

  const result = await sendSms({ to: phone, content: message });

  return {
    success: result.success,
    openPhoneMessageId: result.messageId,
    errorMessage: result.error,
    durationMs: Date.now() - start,
  };
}

// ─── Step 1: Load campaign ────────────────────────────────────────────────────

async function loadApprovedCampaign(
  db: MySql2Database<Record<string, never>>,
  campaignId: number,
) {
  const [campaign] = await db
    .select()
    .from(smsCampaigns)
    .where(eq(smsCampaigns.id, campaignId))
    .limit(1);

  if (!campaign) {
    throw new Error(`Campaign ${campaignId} not found`);
  }
  if (campaign.status !== "APPROVED") {
    throw new Error(
      `Campaign ${campaignId} is not APPROVED (current status: ${campaign.status})`,
    );
  }
  return campaign;
}

// ─── Step 2: Load PENDING recipients ─────────────────────────────────────────

async function loadPendingRecipients(
  db: MySql2Database<Record<string, never>>,
  campaignId: number,
): Promise<SmsCampaignRecipient[]> {
  return db
    .select()
    .from(smsCampaignRecipients)
    .where(
      and(
        eq(smsCampaignRecipients.campaignId, campaignId),
        eq(smsCampaignRecipients.status, "PENDING"),
      ),
    );
}

// ─── Step 3: Mark campaign SENDING ───────────────────────────────────────────

async function markSending(
  db: MySql2Database<Record<string, never>>,
  campaignId: number,
  sentByAgentId: number,
  sentByName: string,
) {
  await db
    .update(smsCampaigns)
    .set({
      status: "SENDING",
      sendStartedAt: Date.now(),
      sentByAgentId,
      sentByName,
    })
    .where(eq(smsCampaigns.id, campaignId));
}

// ─── Step 4: Process one recipient ───────────────────────────────────────────

async function processRecipient(
  db: MySql2Database<Record<string, never>>,
  campaignId: number,
  recipient: SmsCampaignRecipient,
  triggeredBy: string,
): Promise<"SENT" | "FAILED"> {
  const providerResult = await sendOneMessage(
    recipient.phoneNormalized,
    recipient.personalizedMessage,
  );

  const outcome = providerResult.success ? "SENT" : "FAILED";

  // Write immutable audit log row
  await db.insert(smsCampaignSendLog).values({
    campaignId,
    recipientId: recipient.id,
    phoneNormalized: recipient.phoneNormalized,
    action: outcome === "SENT" ? "SENT" : "FAILED",
    batchNumber: 1,
    attempt: 1,
    durationMs: providerResult.durationMs,
    openPhoneMessageId: providerResult.openPhoneMessageId ?? null,
    errorMessage: providerResult.errorMessage ?? null,
    triggeredBy,
  });

  // Update recipient status
  await db
    .update(smsCampaignRecipients)
    .set({
      status: outcome,
      sentAt: Date.now(),
      openPhoneMessageId: providerResult.openPhoneMessageId ?? null,
      errorMessage: providerResult.errorMessage ?? null,
    })
    .where(eq(smsCampaignRecipients.id, recipient.id));

  return outcome;
}

// ─── Step 5: Finalize campaign ────────────────────────────────────────────────

async function finalizeCampaign(
  db: MySql2Database<Record<string, never>>,
  campaignId: number,
  sentCount: number,
  failedCount: number,
): Promise<void> {
  const finalStatus = failedCount === 0 ? "COMPLETED" : "COMPLETED";
  // Note: we always mark COMPLETED here. PARTIAL is returned in SendResult
  // for the caller to surface in the UI, but the DB status is COMPLETED
  // once all recipients have been processed (success or failure).
  await db
    .update(smsCampaigns)
    .set({
      status: finalStatus,
      sentCount: sql`${smsCampaigns.sentCount} + ${sentCount}`,
      failedCount: sql`${smsCampaigns.failedCount} + ${failedCount}`,
      sendCompletedAt: Date.now(),
    })
    .where(eq(smsCampaigns.id, campaignId));
}

// ─── Orchestrator ─────────────────────────────────────────────────────────────

export async function sendCampaign(
  db: MySql2Database<Record<string, never>>,
  campaignId: number,
  sentByAgentId: number,
  sentByName: string,
): Promise<SendResult> {
  const startMs = Date.now();

  // 1. Load and verify campaign
  await loadApprovedCampaign(db, campaignId);

  // 2. Load PENDING recipients
  const recipients = await loadPendingRecipients(db, campaignId);

  if (recipients.length === 0) {
    throw new Error(
      `Campaign ${campaignId} has no PENDING recipients. Was it already sent?`,
    );
  }

  // 3. Mark SENDING
  await markSending(db, campaignId, sentByAgentId, sentByName);

  // 4. Send loop
  let sentCount = 0;
  let failedCount = 0;

  for (const recipient of recipients) {
    const outcome = await processRecipient(
      db,
      campaignId,
      recipient,
      sentByName,
    );
    if (outcome === "SENT") sentCount++;
    else failedCount++;
  }

  // 5. Finalize
  await finalizeCampaign(db, campaignId, sentCount, failedCount);

  const durationMs = Date.now() - startMs;

  console.log(
    `[CampaignSender] Campaign ${campaignId} completed by ${sentByName}: ` +
      `${sentCount} sent, ${failedCount} failed, ${durationMs}ms`,
  );

  return {
    campaignId,
    sentCount,
    failedCount,
    skippedCount: 0,
    durationMs,
    campaignStatus: failedCount === 0 ? "COMPLETED" : "PARTIAL",
    sentAt: Date.now(),
  };
}
