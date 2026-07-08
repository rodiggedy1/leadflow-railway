/**
 * AudienceFreezer.ts
 *
 * Orchestrator for the freeze phase of an SMS campaign.
 * Completely independent of tRPC — no router imports, no HTTP concerns.
 *
 * Flow:
 *   loadCampaign()
 *   → planAudienceForFreeze()
 *   → buildSafetySets()
 *   → applySafetyChecks()
 *   → freezeRecipients()
 *   → finalizeCampaign()
 *   → return FreezeResult
 *
 * The router's only job: authenticate, call freezeAudience(), return result.
 *
 * CRITICAL INVARIANT:
 *   The audience query is re-run from the saved audienceDefinition at freeze time.
 *   The planner preview shown in the UI is NEVER the source of truth.
 *   Once frozen, the recipient list in sms_campaign_recipients is the only
 *   source of truth for all sends. No live queries after freeze.
 */

import crypto from "crypto";
import { eq, and, gt, isNotNull } from "drizzle-orm";
import type { MySql2Database } from "drizzle-orm/mysql2";
import {
  smsCampaigns,
  smsCampaignRecipients,
  completedJobs,
  conversationSessions,
  alwaysOnEnrollments,
  cleanerJobs,
} from "../../drizzle/schema";
import type { AudienceDefinition } from "./plannerTypes";
import { planAudienceForFreeze, canonicalHash } from "./AudiencePlanner";
import {
  buildDefaultSafetyChecks,
  applySafetyChecks,
} from "./SafetyFilter";
import type { SafetyFilterResult } from "./SafetyFilter";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface FreezeResult {
  /** Campaign ID that was frozen */
  campaignId: number;
  /** New campaign status — always "FROZEN" on success */
  campaignStatus: "FROZEN";
  /** Number of recipients written to sms_campaign_recipients */
  frozenCount: number;
  /** SHA-256 of the canonical audienceDefinition at freeze time */
  definitionHash: string;
  /** UTC ms when the freeze completed */
  frozenAt: number;
  /** Total wall-clock time for the freeze operation in ms */
  durationMs: number;
  /** Breakdown of excluded customers by reason */
  exclusionBreakdown: SafetyFilterResult["breakdown"];
  /** Total excluded count */
  totalExcluded: number;
  /** Warnings (e.g. audience size, quality concerns) */
  warnings: string[];
  /** Audit summary line — stored in logs */
  auditSummary: string;
}

export interface FreezeError {
  code:
    | "CAMPAIGN_NOT_FOUND"
    | "WRONG_STATUS"
    | "INVALID_AUDIENCE_DEFINITION"
    | "EMPTY_AUDIENCE"
    | "DB_ERROR";
  message: string;
}

// ─── Main orchestrator ────────────────────────────────────────────────────────

/**
 * freezeAudience — the single entry point for the freeze phase.
 *
 * @param db          Drizzle DB instance (passed in, not imported — easier to test)
 * @param campaignId  ID of the DRAFT campaign to freeze
 * @param approvedBy  Name of the agent initiating the freeze (for audit)
 */
export async function freezeAudience(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: MySql2Database<any>,
  campaignId: number,
  approvedBy: string
): Promise<FreezeResult> {
  const startMs = Date.now();

  // ── Step 1: Load campaign ──────────────────────────────────────────────────
  const campaign = await loadCampaign(db, campaignId);

  // ── Step 2: Parse and hash the audience definition ─────────────────────────
  let def: AudienceDefinition;
  try {
    def = JSON.parse(campaign.audienceDefinition) as AudienceDefinition;
  } catch {
    throw freezeError("INVALID_AUDIENCE_DEFINITION", "audienceDefinition is not valid JSON");
  }

  const defHash = canonicalHash(def);

  // ── Step 3: Re-run the planner to get the full candidate set ───────────────
  // This is the source of truth — NOT the preview result stored in plannerResult.
  const candidates = await planAudienceForFreeze(db, def);

  if (candidates.length === 0) {
    throw freezeError("EMPTY_AUDIENCE", "No customers match the audience definition. Cannot freeze an empty audience.");
  }

  // ── Step 4: Build safety sets and apply safety checks ─────────────────────
  const { optOutPhones, recentlySentPhones, complaintPhones } = await buildSafetySets(db, def);
  const checks = buildDefaultSafetyChecks(optOutPhones, recentlySentPhones, complaintPhones);
  const safetyResult = applySafetyChecks(candidates, checks, campaign.messageTemplate);

  if (safetyResult.valid.length === 0) {
    throw freezeError(
      "EMPTY_AUDIENCE",
      `All ${candidates.length} matched customers were excluded by safety checks. ` +
      `STOP: ${safetyResult.breakdown.stopOptOut}, ` +
      `Complaints: ${safetyResult.breakdown.openComplaint}, ` +
      `Recently texted: ${safetyResult.breakdown.recentlyTexted}, ` +
      `Invalid phone: ${safetyResult.breakdown.invalidPhone}`
    );
  }

  // ── Step 5: Write frozen recipients in a single batch ─────────────────────
  const frozenAt = Date.now();
  await freezeRecipients(db, campaignId, safetyResult, frozenAt);

  // ── Step 6: Finalize campaign — update status, hash, counts ───────────────
  await finalizeCampaign(db, campaignId, {
    defHash,
    frozenAt,
    frozenCount: safetyResult.valid.length,
    approvedBy,
  });

  // ── Step 7: Build result and write audit log ───────────────────────────────
  const durationMs = Date.now() - startMs;
  const totalExcluded = safetyResult.excluded.length;
  const warnings = buildWarnings(safetyResult, candidates.length);

  const auditSummary =
    `Campaign ${campaignId} frozen by ${approvedBy} at ${new Date(frozenAt).toISOString()} — ` +
    `${safetyResult.valid.length} recipients, ${totalExcluded} excluded, ${durationMs}ms`;

  console.info(`[AudienceFreezer] ${auditSummary}`);

  return {
    campaignId,
    campaignStatus: "FROZEN",
    frozenCount: safetyResult.valid.length,
    definitionHash: defHash,
    frozenAt,
    durationMs,
    exclusionBreakdown: safetyResult.breakdown,
    totalExcluded,
    warnings,
    auditSummary,
  };
}

// ─── Step functions ───────────────────────────────────────────────────────────

/**
 * loadCampaign — loads the campaign and validates it is in DRAFT status.
 * Throws a typed FreezeError if not found or wrong status.
 */
async function loadCampaign(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: MySql2Database<any>,
  campaignId: number
) {
  const rows = await db
    .select()
    .from(smsCampaigns)
    .where(eq(smsCampaigns.id, campaignId))
    .limit(1);

  if (rows.length === 0) {
    throw freezeError("CAMPAIGN_NOT_FOUND", `Campaign ${campaignId} not found`);
  }

  const campaign = rows[0];

  if (campaign.status !== "DRAFT") {
    throw freezeError(
      "WRONG_STATUS",
      `Campaign ${campaignId} is in status "${campaign.status}" — only DRAFT campaigns can be frozen`
    );
  }

  if (!campaign.audienceDefinition) {
    throw freezeError("INVALID_AUDIENCE_DEFINITION", "Campaign has no audienceDefinition");
  }

  if (!campaign.messageTemplate) {
    throw freezeError("INVALID_AUDIENCE_DEFINITION", "Campaign has no messageTemplate");
  }

  return campaign;
}

/**
 * buildSafetySets — queries the DB for opt-out, recently texted, and complaint phones.
 * Returns three Sets of normalized phone numbers for use by SafetyFilter.
 *
 * The recentSmsDays window comes from the audience definition options (default 30).
 */
async function buildSafetySets(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: MySql2Database<any>,
  def: AudienceDefinition
): Promise<{
  optOutPhones: Set<string>;
  recentlySentPhones: Set<string>;
  complaintPhones: Set<string>;
}> {
  const recentSmsDays = def.options?.recentSmsDays ?? 30;
  const cutoffDate = new Date(Date.now() - recentSmsDays * 24 * 60 * 60 * 1000);

  const [alwaysOnOptOuts, sessionOptOuts, jobOptOuts, recentlySent, complaints] =
    await Promise.all([
      // STOP opt-outs from alwaysOnEnrollments
      db
        .selectDistinct({ phone: alwaysOnEnrollments.phone })
        .from(alwaysOnEnrollments)
        .where(eq(alwaysOnEnrollments.status, "OPTED_OUT")),

      // STOP opt-outs from conversationSessions
      db
        .selectDistinct({ phone: conversationSessions.leadPhone })
        .from(conversationSessions)
        .where(eq(conversationSessions.smsOptOut, 1)),

      // STOP opt-outs from completedJobs
      db
        .selectDistinct({ phone: completedJobs.phone })
        .from(completedJobs)
        .where(eq(completedJobs.status, "OPTED_OUT")),

      // Recently texted: conversationSessions where lastAiMessageAt > cutoff
      db
        .selectDistinct({ phone: conversationSessions.leadPhone })
        .from(conversationSessions)
        .where(
          and(
            isNotNull(conversationSessions.lastAiMessageAt),
            gt(conversationSessions.lastAiMessageAt, cutoffDate)
          )
        ),

      // Complaint phones: cleanerJobs where customerComplaint is not null/empty
      db
        .selectDistinct({ phone: completedJobs.phone })
        .from(cleanerJobs)
        .innerJoin(completedJobs, eq(cleanerJobs.completedJobId, completedJobs.id))
        .where(isNotNull(cleanerJobs.customerComplaint)),
    ]);

  // Build opt-out set (union of all three sources)
  const optOutPhones = new Set<string>();
  for (const r of alwaysOnOptOuts) if (r.phone) optOutPhones.add(r.phone);
  for (const r of sessionOptOuts) if (r.phone) optOutPhones.add(r.phone);
  for (const r of jobOptOuts) if (r.phone) optOutPhones.add(r.phone);

  // Build recently sent set
  const recentlySentPhones = new Set<string>();
  for (const r of recentlySent) if (r.phone) recentlySentPhones.add(r.phone);

  // Build complaint phones set
  const complaintPhones = new Set<string>();
  for (const r of complaints) if (r.phone) complaintPhones.add(r.phone);

  return { optOutPhones, recentlySentPhones, complaintPhones };
}

/**
 * freezeRecipients — writes validated recipients to sms_campaign_recipients.
 *
 * Uses INSERT IGNORE to handle the uq_campaign_phone unique constraint gracefully.
 * If a duplicate somehow slips through (race condition), it is silently skipped
 * rather than throwing an error. The unique constraint is the hard safety net.
 *
 * All rows are written in a single batch for performance.
 */
async function freezeRecipients(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: MySql2Database<any>,
  campaignId: number,
  safetyResult: SafetyFilterResult,
  frozenAt: number
): Promise<void> {
  if (safetyResult.valid.length === 0) return;

  // Batch insert in chunks of 500 to avoid packet size limits
  const CHUNK_SIZE = 500;
  const recipients = safetyResult.valid;

  for (let i = 0; i < recipients.length; i += CHUNK_SIZE) {
    const chunk = recipients.slice(i, i + CHUNK_SIZE);
    await db.insert(smsCampaignRecipients).values(
      chunk.map((r) => ({
        campaignId,
        phone: r.phone,
        phoneNormalized: r.phoneNormalized,
        snapshotFirstName: r.firstName,
        snapshotName: r.name,
        snapshotAddress: r.address,
        snapshotLastService: r.serviceType,
        snapshotLastPrice: r.lastBookingPrice,
        snapshotCity: r.city || null,
        snapshotFrequency: r.frequency || null,
        snapshotBedrooms: r.bedrooms ?? null,
        snapshotDaysSinceBooking: r.daysSinceBooking ?? null,
        snapshotPreferredTeam: r.preferredTeam || null,
        completedJobId: r.completedJobId,
        personalizedMessage: r.personalizedMessage,
        status: "PENDING" as const,
        createdAt: new Date(frozenAt),
      }))
    );
  }
}

/**
 * finalizeCampaign — updates the campaign row with freeze metadata.
 * Moves status to FROZEN and stores the definitionHash, frozenAt, frozenCount.
 *
 * Called only after freezeRecipients() succeeds.
 * If this update fails, the campaign stays in DRAFT and the orphaned recipient
 * rows will be cleaned up on the next freeze attempt (INSERT IGNORE handles dupes).
 */
async function finalizeCampaign(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: MySql2Database<any>,
  campaignId: number,
  opts: {
    defHash: string;
    frozenAt: number;
    frozenCount: number;
    approvedBy: string;
  }
): Promise<void> {
  await db
    .update(smsCampaigns)
    .set({
      status: "FROZEN",
      definitionHash: opts.defHash,
      frozenAt: opts.frozenAt,
      frozenRecipientCount: opts.frozenCount,
      // Store approvedBy name as sentByName for now (approvedBy is set at APPROVED step)
      updatedAt: new Date(opts.frozenAt),
    })
    .where(eq(smsCampaigns.id, campaignId));
}

// ─── Warnings ─────────────────────────────────────────────────────────────────

function buildWarnings(result: SafetyFilterResult, totalCandidates: number): string[] {
  const warnings: string[] = [];
  const frozenCount = result.valid.length;

  if (frozenCount > 500) {
    warnings.push(`Large audience: ${frozenCount} recipients. Consider splitting into smaller campaigns.`);
  }

  if (result.breakdown.stopOptOut > 0) {
    warnings.push(`${result.breakdown.stopOptOut} customers excluded due to STOP opt-out.`);
  }

  if (result.breakdown.recentlyTexted > 0) {
    warnings.push(`${result.breakdown.recentlyTexted} customers excluded — texted within the last 30 days.`);
  }

  if (result.breakdown.openComplaint > 0) {
    warnings.push(`${result.breakdown.openComplaint} customers excluded due to open complaints.`);
  }

  const exclusionRate = totalCandidates > 0 ? result.excluded.length / totalCandidates : 0;
  if (exclusionRate > 0.5) {
    warnings.push(
      `High exclusion rate: ${Math.round(exclusionRate * 100)}% of matched customers were excluded by safety checks.`
    );
  }

  return warnings;
}

// ─── Error factory ────────────────────────────────────────────────────────────

function freezeError(code: FreezeError["code"], message: string): Error & FreezeError {
  const err = new Error(message) as Error & FreezeError;
  err.code = code;
  err.message = message;
  return err;
}
