/**
 * CampaignSender.ts — Stage 5 Send Engine
 *
 * Single-worker sequential send loop with built-in rate limiting:
 *   - Random 3–6 second delay between every message
 *   - Every 25 messages, pause 45 seconds
 *   - Skip anyone no longer PENDING (re-checked before each send)
 *   - Log every send attempt
 *   - If OpenPhone returns a 429 / rate-limit error, stop immediately
 *
 * PREVIEW_MODE: no real API calls, 50ms stub delay.
 */

import { and, eq, sql } from "drizzle-orm";
import type { MySql2Database } from "drizzle-orm/mysql2";
import {
  smsCampaigns,
  smsCampaignRecipients,
  smsCampaignSendLog,
  type SmsCampaignRecipient,
} from "../../drizzle/schema";

// ─── Constants ────────────────────────────────────────────────────────────────

const DELAY_MIN_MS = 3_000;
const DELAY_MAX_MS = 6_000;
const BATCH_SIZE = 25;
const BATCH_PAUSE_MS = 45_000;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SendResult {
  campaignId: number;
  sentCount: number;
  failedCount: number;
  skippedCount: number;
  durationMs: number;
  /** COMPLETED = all processed; PARTIAL = some failures; RATE_LIMITED = stopped by 429 */
  campaignStatus: "COMPLETED" | "PARTIAL" | "RATE_LIMITED";
  sentAt: number; // Unix ms
}

interface ProviderResult {
  success: boolean;
  rateLimited: boolean;
  openPhoneMessageId?: string;
  errorMessage?: string;
  durationMs: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function randomDelay(): Promise<void> {
  const ms = DELAY_MIN_MS + Math.floor(Math.random() * (DELAY_MAX_MS - DELAY_MIN_MS + 1));
  return new Promise((r) => setTimeout(r, ms));
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ─── Provider call ────────────────────────────────────────────────────────────

async function sendOneMessage(
  phone: string,
  message: string,
): Promise<ProviderResult> {
  const { ENV } = await import("../_core/env");

  if (ENV.isPreviewMode) {
    await sleep(50);
    console.log(`[CampaignSender] PREVIEW_MODE — skipping real send to ${phone}`);
    return { success: true, rateLimited: false, openPhoneMessageId: `PREVIEW_${Date.now()}`, durationMs: 50 };
  }

  const { sendSms } = await import("../openphone");
  const start = Date.now();

  const result = await sendSms({ to: phone, content: message });

  // Detect 429 / rate-limit in the error message
  const isRateLimit =
    !result.success &&
    (result.error?.includes("429") ||
      result.error?.toLowerCase().includes("rate") ||
      result.error?.toLowerCase().includes("too many"));

  return {
    success: result.success,
    rateLimited: isRateLimit,
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

  if (!campaign) throw new Error(`Campaign ${campaignId} not found`);
  if (campaign.status !== "APPROVED") {
    throw new Error(`Campaign ${campaignId} is not APPROVED (current status: ${campaign.status})`);
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
    .set({ status: "SENDING", sendStartedAt: Date.now(), sentByAgentId, sentByName })
    .where(eq(smsCampaigns.id, campaignId));
}

// ─── Step 4: Re-check recipient is still PENDING before sending ───────────────

async function isStillPending(
  db: MySql2Database<Record<string, never>>,
  recipientId: number,
): Promise<boolean> {
  const [row] = await db
    .select({ status: smsCampaignRecipients.status })
    .from(smsCampaignRecipients)
    .where(eq(smsCampaignRecipients.id, recipientId))
    .limit(1);
  return row?.status === "PENDING";
}

// ─── Step 5: Process one recipient ───────────────────────────────────────────

async function processRecipient(
  db: MySql2Database<Record<string, never>>,
  campaignId: number,
  recipient: SmsCampaignRecipient,
  triggeredBy: string,
): Promise<{ outcome: "SENT" | "FAILED" | "SKIPPED"; rateLimited: boolean }> {
  // Re-check status right before sending
  const stillPending = await isStillPending(db, recipient.id);
  if (!stillPending) {
    console.log(`[CampaignSender] Skipping recipient ${recipient.id} — no longer PENDING`);
    return { outcome: "SKIPPED", rateLimited: false };
  }

  const providerResult = await sendOneMessage(
    recipient.phoneNormalized,
    recipient.personalizedMessage,
  );

  if (providerResult.rateLimited) {
    // Log the failed attempt then signal caller to stop
    await db.insert(smsCampaignSendLog).values({
      campaignId,
      recipientId: recipient.id,
      phoneNormalized: recipient.phoneNormalized,
      action: "FAILED",
      batchNumber: 1,
      attempt: 1,
      durationMs: providerResult.durationMs,
      openPhoneMessageId: null,
      errorMessage: `RATE_LIMITED: ${providerResult.errorMessage ?? "429"}`,
      triggeredBy,
    });
    return { outcome: "FAILED", rateLimited: true };
  }

  const outcome = providerResult.success ? "SENT" : "FAILED";

  await db.insert(smsCampaignSendLog).values({
    campaignId,
    recipientId: recipient.id,
    phoneNormalized: recipient.phoneNormalized,
    action: outcome,
    batchNumber: 1,
    attempt: 1,
    durationMs: providerResult.durationMs,
    openPhoneMessageId: providerResult.openPhoneMessageId ?? null,
    errorMessage: providerResult.errorMessage ?? null,
    triggeredBy,
  });

  await db
    .update(smsCampaignRecipients)
    .set({
      status: outcome,
      sentAt: Date.now(),
      openPhoneMessageId: providerResult.openPhoneMessageId ?? null,
      errorMessage: providerResult.errorMessage ?? null,
    })
    .where(eq(smsCampaignRecipients.id, recipient.id));

  return { outcome, rateLimited: false };
}

// ─── Step 6: Finalize campaign ────────────────────────────────────────────────

async function finalizeCampaign(
  db: MySql2Database<Record<string, never>>,
  campaignId: number,
  sentCount: number,
  failedCount: number,
  rateLimited: boolean,
): Promise<void> {
  const finalStatus = rateLimited ? "PARTIAL" : "COMPLETED";
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

  await loadApprovedCampaign(db, campaignId);

  const recipients = await loadPendingRecipients(db, campaignId);
  if (recipients.length === 0) {
    throw new Error(`Campaign ${campaignId} has no PENDING recipients. Was it already sent?`);
  }

  await markSending(db, campaignId, sentByAgentId, sentByName);

  let sentCount = 0;
  let failedCount = 0;
  let skippedCount = 0;
  let stoppedByRateLimit = false;
  let messagesSentThisBatch = 0;

  for (let i = 0; i < recipients.length; i++) {
    const recipient = recipients[i];

    const { outcome, rateLimited } = await processRecipient(db, campaignId, recipient, sentByName);

    if (outcome === "SENT") {
      sentCount++;
      messagesSentThisBatch++;
    } else if (outcome === "FAILED") {
      failedCount++;
    } else {
      skippedCount++;
    }

    if (rateLimited) {
      console.error(`[CampaignSender] 429 rate limit hit on recipient ${recipient.id} — stopping campaign ${campaignId}`);
      stoppedByRateLimit = true;
      break;
    }

    const isLast = i === recipients.length - 1;
    if (!isLast) {
      // Every 25 actual sends, pause 45 seconds
      if (messagesSentThisBatch > 0 && messagesSentThisBatch % BATCH_SIZE === 0) {
        console.log(`[CampaignSender] Batch pause — sent ${messagesSentThisBatch} messages, pausing ${BATCH_PAUSE_MS / 1000}s`);
        await sleep(BATCH_PAUSE_MS);
      } else {
        // Random 3–6s delay between every message
        await randomDelay();
      }
    }
  }

  await finalizeCampaign(db, campaignId, sentCount, failedCount, stoppedByRateLimit);

  const durationMs = Date.now() - startMs;
  console.log(
    `[CampaignSender] Campaign ${campaignId} finished by ${sentByName}: ` +
      `${sentCount} sent, ${failedCount} failed, ${skippedCount} skipped, ${durationMs}ms` +
      (stoppedByRateLimit ? " — STOPPED BY RATE LIMIT" : ""),
  );

  return {
    campaignId,
    sentCount,
    failedCount,
    skippedCount,
    durationMs,
    campaignStatus: stoppedByRateLimit ? "RATE_LIMITED" : failedCount === 0 ? "COMPLETED" : "PARTIAL",
    sentAt: Date.now(),
  };
}
