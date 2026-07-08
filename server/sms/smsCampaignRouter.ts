/**
 * smsCampaignRouter.ts
 *
 * tRPC router for SMS Campaign features.
 *
 * Procedures:
 *   planAudience     — read-only audience planning (Stage 2)
 *   saveDraft        — create or update a DRAFT campaign
 *   freezeAudience   — freeze the recipient list (calls AudienceFreezer)
 *   approveCampaign  — mark a FROZEN campaign as APPROVED after review
 *   getCampaign      — fetch campaign row + frozen recipient count
 *   listRecipients   — paginated frozen recipient list for the review modal
 *   removeRecipient  — manually remove a single recipient from a FROZEN campaign
 *
 * Architecture principle: This router authenticates and delegates.
 * All business logic lives in AudiencePlanner / AudienceFreezer.
 */

import { z } from "zod";
import { eq, and, sql, desc } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { adminAgentProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { planAudience } from "./AudiencePlanner";
import type { AudienceDefinition } from "./plannerTypes";
import { freezeAudience as doFreezeAudience } from "./AudienceFreezer";
import { sendCampaign as doSendCampaign } from "./CampaignSender";
import {
  smsCampaigns,
  smsCampaignRecipients,
} from "../../drizzle/schema";

// ─── Zod schemas ──────────────────────────────────────────────────────────────

const RuleSchema = z.object({
  field: z.enum([
    // Booking History
    "lastBookingDays",
    "bookingCount",
    "recurringStatus",
    "serviceType",
    "bedrooms",
    "bathrooms",
    // Customer Value
    "lifetimeRevenue",
    "avgTicket",
    "lastBookingPrice",
    // Customer Health
    "reviewScore",
    "hasComplaint",
    "hasRefund",
    "hasChargeback",
    // Marketing
    "lastSmsDays",
    "lastEmailDays",
    "stopStatus",
    "openRate",
    "replyRate",
    // AI
    "aiLikelihoodToBook",
    "aiLikelihoodToRespond",
    // Geography (Stage 3)
    "radiusMiles",
    "city",
    "zip",
  ]),
  op: z.enum([">", ">=", "<", "<=", "=", "!=", "is_true", "is_false"]),
  value: z.union([z.string(), z.number(), z.boolean()]),
});

const GeographySchema = z.object({
  radiusMiles: z.number().optional(),
  lat: z.number().optional(),
  lng: z.number().optional(),
  city: z.string().optional(),
  zip: z.string().optional(),
}).nullable();

const AudienceDefinitionSchema = z.object({
  presets: z.array(z.string()),
  includeRules: z.array(RuleSchema),
  excludeRules: z.array(RuleSchema),
  geography: GeographySchema,
  options: z.object({
    recentSmsDays: z.number().min(1).max(365).optional(),
    sampleSize: z.number().min(1).max(50).optional(),
  }).optional(),
});

// ─── Router ───────────────────────────────────────────────────────────────────

export const smsCampaignRouter = router({
  /**
   * planAudience — read-only audience planning.
   *
   * Takes an AudienceDefinition and returns:
   *   - summary (matchedCustomers, excludedCustomers, estimated metrics, quality score)
   *   - stats (avg days since booking, avg ticket, frequency breakdown, service types)
   *   - exclusionBreakdown (STOP, invalid phone, complaint, recently texted)
   *   - sampleIncluded (up to 10 customers with matchedBecause[])
   *   - sampleExcluded (up to 10 customers with reason + reasonLabel)
   *   - ruleHash (SHA-256 of canonical AudienceDefinition — stable across key order)
   *   - generatedAt (Unix ms timestamp)
   *
   * Called from the UI on every rule change (debounced 800ms on the client).
   * Target latency: < 500ms for typical audience sizes.
   */
  planAudience: adminAgentProcedure
    .input(AudienceDefinitionSchema)
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Database unavailable",
        });
      }

      try {
        const result = await planAudience(db, input as unknown as AudienceDefinition);
        return result;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error("[smsCampaignRouter] planAudience error:", msg, err);
        // Surface the real error message so the UI can display it for debugging
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Audience planning failed: ${msg}`,
        });
      }
    }),

  /**
   * saveDraft — create or update a DRAFT campaign.
   *
   * - If campaignId is omitted: creates a new DRAFT campaign, returns the new id.
   * - If campaignId is provided: updates name, audienceDefinition, messageTemplate.
   *   Only allowed while status = DRAFT.
   *
   * Returns: { campaignId }
   */
  saveDraft: adminAgentProcedure
    .input(z.object({
      campaignId: z.number().int().positive().optional(),
      name: z.string().min(1).max(255),
      audienceDefinition: AudienceDefinitionSchema,
      messageTemplate: z.string().min(1).max(1600),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      }

      const agentId = ctx.agent.agentId;
      const agentName = ctx.agent.agentName;
      const audienceJson = JSON.stringify(input.audienceDefinition as unknown as AudienceDefinition);

      if (input.campaignId) {
        // Update existing DRAFT
        const rows = await db
          .select({ id: smsCampaigns.id, status: smsCampaigns.status })
          .from(smsCampaigns)
          .where(eq(smsCampaigns.id, input.campaignId))
          .limit(1);

        if (rows.length === 0) {
          throw new TRPCError({ code: "NOT_FOUND", message: `Campaign ${input.campaignId} not found` });
        }
        if (rows[0].status !== "DRAFT") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Campaign ${input.campaignId} is in status "${rows[0].status}" — only DRAFT campaigns can be edited`,
          });
        }

        await db
          .update(smsCampaigns)
          .set({
            name: input.name,
            audienceDefinition: audienceJson,
            messageTemplate: input.messageTemplate,
            updatedAt: new Date(),
          })
          .where(eq(smsCampaigns.id, input.campaignId));

        return { campaignId: input.campaignId };
      } else {
        // Create new DRAFT
        // Drizzle + MySQL2 returns [ResultSetHeader, FieldPacket[]] — destructure to get insertId
        const [insertResult] = await db.insert(smsCampaigns).values({
          name: input.name,
          status: "DRAFT",
          audienceDefinition: audienceJson,
          messageTemplate: input.messageTemplate,
          createdByAgentId: agentId,
          createdByName: agentName,
          sentCount: 0,
          failedCount: 0,
          repliedCount: 0,
          bookedCount: 0,
          isDryRun: 0,
        });
        const insertId = (insertResult as any).insertId as number;
        return { campaignId: insertId };
      }
    }),

  /**
   * freezeAudience — freeze the recipient list for a DRAFT campaign.
   *
   * Calls AudienceFreezer.freezeAudience() which:
   *   1. Re-runs planAudienceForFreeze() from the saved audienceDefinition
   *   2. Applies safety checks (STOP, complaints, recently texted, duplicates, invalid phones)
   *   3. Writes frozen recipients to sms_campaign_recipients
   *   4. Updates campaign status to FROZEN
   *
   * Returns the FreezeResult with counts, breakdown, warnings, and audit summary.
   */
  freezeAudience: adminAgentProcedure
    .input(z.object({
      campaignId: z.number().int().positive(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      }

      const agentName = ctx.agent.agentName;

      try {
        const result = await doFreezeAudience(db, input.campaignId, agentName);
        return result;
      } catch (err: unknown) {
        const freezeErr = err as { code?: string; message?: string };
        console.error("[smsCampaignRouter] freezeAudience error:", err);

        if (freezeErr.code === "CAMPAIGN_NOT_FOUND") {
          throw new TRPCError({ code: "NOT_FOUND", message: freezeErr.message ?? "Campaign not found" });
        }
        if (freezeErr.code === "WRONG_STATUS") {
          throw new TRPCError({ code: "BAD_REQUEST", message: freezeErr.message ?? "Wrong campaign status" });
        }
        if (freezeErr.code === "EMPTY_AUDIENCE") {
          throw new TRPCError({ code: "BAD_REQUEST", message: freezeErr.message ?? "Audience is empty after safety checks" });
        }
        if (freezeErr.code === "INVALID_AUDIENCE_DEFINITION") {
          throw new TRPCError({ code: "BAD_REQUEST", message: freezeErr.message ?? "Invalid audience definition" });
        }

        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Freeze failed. Please try again.",
        });
      }
    }),

  /**
   * approveCampaign — mark a FROZEN campaign as APPROVED after admin review.
   *
   * Prerequisites:
   *   - Campaign must be in FROZEN status
   *   - Admin must have reviewed the recipient list in the Review modal
   *
   * Sets: status=APPROVED, approvedAt, approvedByAgentId, approvedByName
   * Returns: { campaignId, status: "APPROVED", approvedAt }
   */
  approveCampaign: adminAgentProcedure
    .input(z.object({
      campaignId: z.number().int().positive(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      }

      const agentId = ctx.agent.agentId;
      const agentName = ctx.agent.agentName;

      // Validate campaign exists and is FROZEN
      const rows = await db
        .select({ id: smsCampaigns.id, status: smsCampaigns.status })
        .from(smsCampaigns)
        .where(eq(smsCampaigns.id, input.campaignId))
        .limit(1);

      if (rows.length === 0) {
        throw new TRPCError({ code: "NOT_FOUND", message: `Campaign ${input.campaignId} not found` });
      }
      if (rows[0].status !== "FROZEN") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Campaign ${input.campaignId} is in status "${rows[0].status}" — only FROZEN campaigns can be approved`,
        });
      }

      const approvedAt = Date.now();

      await db
        .update(smsCampaigns)
        .set({
          status: "APPROVED",
          approvedAt,
          approvedByAgentId: agentId,
          approvedByName: agentName,
          updatedAt: new Date(approvedAt),
        })
        .where(eq(smsCampaigns.id, input.campaignId));

      console.info(
        `[smsCampaignRouter] Campaign ${input.campaignId} approved by ${agentName} (id=${agentId}) at ${new Date(approvedAt).toISOString()}`
      );

      return { campaignId: input.campaignId, status: "APPROVED" as const, approvedAt };
    }),

  /**
   * getCampaign — fetch a campaign row with frozen recipient count.
   *
   * Returns the full campaign row plus:
   *   - liveRecipientCount (live count from sms_campaign_recipients)
   *   - pendingCount (recipients with status=PENDING)
   *
   * Used by the Review modal to show the frozen list summary.
   */
  getCampaign: adminAgentProcedure
    .input(z.object({
      campaignId: z.number().int().positive(),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      }

      const rows = await db
        .select()
        .from(smsCampaigns)
        .where(eq(smsCampaigns.id, input.campaignId))
        .limit(1);

      if (rows.length === 0) {
        throw new TRPCError({ code: "NOT_FOUND", message: `Campaign ${input.campaignId} not found` });
      }

      const campaign = rows[0];

      // Live count from recipients table (authoritative after freeze)
      const [[countRow], [pendingRow]] = await Promise.all([
        db
          .select({ total: sql<number>`count(*)` })
          .from(smsCampaignRecipients)
          .where(eq(smsCampaignRecipients.campaignId, input.campaignId)),
        db
          .select({ total: sql<number>`count(*)` })
          .from(smsCampaignRecipients)
          .where(
            and(
              eq(smsCampaignRecipients.campaignId, input.campaignId),
              eq(smsCampaignRecipients.status, "PENDING")
            )
          ),
      ]);

      return {
        ...campaign,
        liveRecipientCount: Number(countRow?.total ?? 0),
        pendingCount: Number(pendingRow?.total ?? 0),
      };
    }),

  /**
   * listRecipients — paginated list of frozen recipients for the review modal.
   *
   * Supports search (by name/phone) and sort.
   * Returns items, total, page, pageSize, manuallyExcludedCount.
   */
  listRecipients: adminAgentProcedure
    .input(z.object({
      campaignId: z.number().int().positive(),
      page: z.number().int().min(1).default(1),
      pageSize: z.number().int().min(1).max(100).default(25),
      search: z.string().optional(),
      sortBy: z.enum(["name", "phone", "lastService", "lastPrice"]).optional(),
      sortDir: z.enum(["asc", "desc"]).optional(),
      showSkipped: z.boolean().optional(),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      }

      const offset = (input.page - 1) * input.pageSize;
      const { campaignId, search, showSkipped } = input;

      // Build WHERE conditions
      const conditions = [eq(smsCampaignRecipients.campaignId, campaignId)];
      if (!showSkipped) {
        conditions.push(sql`${smsCampaignRecipients.status} != 'SKIPPED'`);
      }
      if (search && search.trim()) {
        const like = `%${search.trim()}%`;
        conditions.push(
          sql`(${smsCampaignRecipients.snapshotName} LIKE ${like} OR ${smsCampaignRecipients.phone} LIKE ${like})`
        );
      }

      const whereClause = conditions.length === 1 ? conditions[0] : and(...conditions);

      // Sort
      const sortCol = input.sortBy === "phone" ? smsCampaignRecipients.phone
        : input.sortBy === "lastService" ? smsCampaignRecipients.snapshotLastService
        : input.sortBy === "lastPrice" ? smsCampaignRecipients.snapshotLastPrice
        : smsCampaignRecipients.snapshotName;

      const [items, [countRow], [skippedRow]] = await Promise.all([
        db
          .select()
          .from(smsCampaignRecipients)
          .where(whereClause)
          .orderBy(input.sortDir === "desc" ? sql`${sortCol} DESC` : sql`${sortCol} ASC`)
          .limit(input.pageSize)
          .offset(offset),
        db
          .select({ total: sql<number>`count(*)` })
          .from(smsCampaignRecipients)
          .where(whereClause),
        db
          .select({ total: sql<number>`count(*)` })
          .from(smsCampaignRecipients)
          .where(and(
            eq(smsCampaignRecipients.campaignId, campaignId),
            eq(smsCampaignRecipients.status, "SKIPPED"),
            sql`${smsCampaignRecipients.skipReason} = 'MANUAL_EXCLUSION'`
          )),
      ]);

      return {
        items,
        total: Number(countRow?.total ?? 0),
        page: input.page,
        pageSize: input.pageSize,
        manuallyExcludedCount: Number(skippedRow?.total ?? 0),
      };
    }),

  /**
   * removeRecipient — manually remove a single recipient from a FROZEN campaign.
   *
   * Only allowed while campaign status = FROZEN (before approval).
   * Deletes the row from sms_campaign_recipients and decrements frozenRecipientCount.
   *
   * Returns: { removed: true, recipientId, remainingCount }
   */
  removeRecipient: adminAgentProcedure
    .input(z.object({
      campaignId: z.number().int().positive(),
      recipientId: z.number().int().positive(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      }

      // Validate campaign is in FROZEN status
      const campaignRows = await db
        .select({ id: smsCampaigns.id, status: smsCampaigns.status })
        .from(smsCampaigns)
        .where(eq(smsCampaigns.id, input.campaignId))
        .limit(1);

      if (campaignRows.length === 0) {
        throw new TRPCError({ code: "NOT_FOUND", message: `Campaign ${input.campaignId} not found` });
      }
      if (campaignRows[0].status !== "FROZEN") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Cannot remove recipients from a campaign in status "${campaignRows[0].status}" — only FROZEN campaigns allow manual removal`,
        });
      }

      // Validate recipient belongs to this campaign
      const recipientRows = await db
        .select({ id: smsCampaignRecipients.id, snapshotName: smsCampaignRecipients.snapshotName })
        .from(smsCampaignRecipients)
        .where(
          and(
            eq(smsCampaignRecipients.id, input.recipientId),
            eq(smsCampaignRecipients.campaignId, input.campaignId)
          )
        )
        .limit(1);

      if (recipientRows.length === 0) {
        throw new TRPCError({ code: "NOT_FOUND", message: `Recipient ${input.recipientId} not found in campaign ${input.campaignId}` });
      }

      // Delete the recipient
      await db
        .delete(smsCampaignRecipients)
        .where(
          and(
            eq(smsCampaignRecipients.id, input.recipientId),
            eq(smsCampaignRecipients.campaignId, input.campaignId)
          )
        );

      // Update frozenRecipientCount on the campaign (floor at 0)
      await db
        .update(smsCampaigns)
        .set({
          frozenRecipientCount: sql`GREATEST(0, ${smsCampaigns.frozenRecipientCount} - 1)`,
          updatedAt: new Date(),
        })
        .where(eq(smsCampaigns.id, input.campaignId));

      // Get remaining count
      const [[remaining]] = await Promise.all([
        db
          .select({ total: sql<number>`count(*)` })
          .from(smsCampaignRecipients)
          .where(eq(smsCampaignRecipients.campaignId, input.campaignId)),
      ]);

      console.info(
        `[smsCampaignRouter] Recipient ${input.recipientId} (${recipientRows[0].snapshotName ?? "unknown"}) ` +
        `removed from campaign ${input.campaignId} by ${ctx.agent.agentName}`
      );

      return {
        removed: true as const,
        recipientId: input.recipientId,
        remainingCount: Number(remaining?.total ?? 0),
      };
    }),

  /**
   * skipRecipient — soft-exclude a recipient (status=SKIPPED, reason=MANUAL_EXCLUSION).
   * Does NOT delete the row. Allows undo via unskipRecipient.
   * Only allowed while campaign status = FROZEN.
   */
  skipRecipient: adminAgentProcedure
    .input(z.object({
      campaignId: z.number().int().positive(),
      recipientId: z.number().int().positive(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const campaignRows = await db
        .select({ id: smsCampaigns.id, status: smsCampaigns.status })
        .from(smsCampaigns)
        .where(eq(smsCampaigns.id, input.campaignId))
        .limit(1);

      if (campaignRows.length === 0) throw new TRPCError({ code: "NOT_FOUND", message: "Campaign not found" });
      if (campaignRows[0].status !== "FROZEN") {
        throw new TRPCError({ code: "BAD_REQUEST", message: `Cannot skip recipients in status "${campaignRows[0].status}"` });
      }

      const recipientRows = await db
        .select({ id: smsCampaignRecipients.id, snapshotName: smsCampaignRecipients.snapshotName, status: smsCampaignRecipients.status })
        .from(smsCampaignRecipients)
        .where(and(eq(smsCampaignRecipients.id, input.recipientId), eq(smsCampaignRecipients.campaignId, input.campaignId)))
        .limit(1);

      if (recipientRows.length === 0) throw new TRPCError({ code: "NOT_FOUND", message: "Recipient not found" });
      if (recipientRows[0].status === "SKIPPED") return { skipped: true as const, recipientId: input.recipientId };

      await db
        .update(smsCampaignRecipients)
        .set({ status: "SKIPPED", skipReason: "MANUAL_EXCLUSION" })
        .where(and(eq(smsCampaignRecipients.id, input.recipientId), eq(smsCampaignRecipients.campaignId, input.campaignId)));

      console.info(`[smsCampaignRouter] Recipient ${input.recipientId} (${recipientRows[0].snapshotName ?? "unknown"}) manually excluded from campaign ${input.campaignId} by ${ctx.agent.agentName}`);

      return { skipped: true as const, recipientId: input.recipientId };
    }),

  /**
   * unskipRecipient — undo a manual exclusion (status=PENDING, skipReason=null).
   * Only works on MANUAL_EXCLUSION rows while campaign is FROZEN.
   */
  unskipRecipient: adminAgentProcedure
    .input(z.object({
      campaignId: z.number().int().positive(),
      recipientId: z.number().int().positive(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const campaignRows = await db
        .select({ id: smsCampaigns.id, status: smsCampaigns.status })
        .from(smsCampaigns)
        .where(eq(smsCampaigns.id, input.campaignId))
        .limit(1);

      if (campaignRows.length === 0) throw new TRPCError({ code: "NOT_FOUND", message: "Campaign not found" });
      if (campaignRows[0].status !== "FROZEN") {
        throw new TRPCError({ code: "BAD_REQUEST", message: `Cannot unskip recipients in status "${campaignRows[0].status}"` });
      }

      await db
        .update(smsCampaignRecipients)
        .set({ status: "PENDING", skipReason: null })
        .where(and(
          eq(smsCampaignRecipients.id, input.recipientId),
          eq(smsCampaignRecipients.campaignId, input.campaignId),
          sql`${smsCampaignRecipients.skipReason} = 'MANUAL_EXCLUSION'`
        ));

      console.info(`[smsCampaignRouter] Recipient ${input.recipientId} unskipped in campaign ${input.campaignId} by ${ctx.agent.agentName}`);

      return { unskipped: true as const, recipientId: input.recipientId };
    }),

  /**
   * sendTestSms — send a test SMS to a given phone number using a custom first name.
   * On preview: logs the test, does not send real SMS.
   * On production: sends via OpenPhone to the test phone only.
   * The production campaign is never touched.
   */
  sendTestSms: adminAgentProcedure
    .input(z.object({
      campaignId: z.number().int().positive(),
      testPhone: z.string().min(10),
      testFirstName: z.string().min(1).max(50),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const rows = await db
        .select({ id: smsCampaigns.id, messageTemplate: smsCampaigns.messageTemplate, status: smsCampaigns.status })
        .from(smsCampaigns)
        .where(eq(smsCampaigns.id, input.campaignId))
        .limit(1);

      if (rows.length === 0) throw new TRPCError({ code: "NOT_FOUND", message: "Campaign not found" });

      const template = rows[0].messageTemplate;
      const personalizedMessage = template
        .replace(/\{\{first_name\}\}/gi, input.testFirstName)
        .replace(/\{\{name\}\}/gi, input.testFirstName);

      // TODO (production): replace stub with real OpenPhone call
      // For now: log the test and return the personalized message
      console.info(
        `[smsCampaignRouter] TEST SMS for campaign ${input.campaignId} by ${ctx.agent.agentName}: ` +
        `to=${input.testPhone}, name=${input.testFirstName}, msg="${personalizedMessage.slice(0, 80)}…"`
      );

      return {
        sent: true as const,
        testPhone: input.testPhone,
        testFirstName: input.testFirstName,
        personalizedMessage,
      };
    }),

  /**
   * sendCampaign — Stage 5
   * Executes the send loop for an APPROVED campaign.
   * On preview: writes TEST_SENT log entries, no real SMS sent.
   * On production: replace the stub in CampaignSender.sendOneMessage().
   */
  sendCampaign: adminAgentProcedure
    .input(z.object({ campaignId: z.number().int().positive() }))
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      const agentId = ctx.agent.agentId;
      const agentName = ctx.agent.agentName;

      const result = await doSendCampaign(db, input.campaignId, agentId, agentName);

      console.info(
        `[smsCampaignRouter] Campaign ${input.campaignId} sent by ${agentName} (id=${agentId}): ` +
        `${result.sentCount} sent, ${result.failedCount} failed, ${result.durationMs}ms`
      );

      return result;
    }),

  /**
   * unfreezeCampaign — revert a FROZEN campaign back to DRAFT.
   *
   * Deletes all rows from sms_campaign_recipients for this campaign,
   * resets frozenRecipientCount to 0, clears frozenAt, and sets status back to DRAFT.
   *
   * Only allowed while status = FROZEN (not after APPROVED or later).
   * Returns: { campaignId, status: "DRAFT" }
   */
  unfreezeCampaign: adminAgentProcedure
    .input(z.object({
      campaignId: z.number().int().positive(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      }

      const agentName = ctx.agent.agentName;

      // Validate campaign exists and is FROZEN
      const rows = await db
        .select({ id: smsCampaigns.id, status: smsCampaigns.status })
        .from(smsCampaigns)
        .where(eq(smsCampaigns.id, input.campaignId))
        .limit(1);

      if (rows.length === 0) {
        throw new TRPCError({ code: "NOT_FOUND", message: `Campaign ${input.campaignId} not found` });
      }
      if (rows[0].status !== "FROZEN") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Campaign ${input.campaignId} is in status "${rows[0].status}" — only FROZEN campaigns can be unfrozen`,
        });
      }

      // Delete all recipients for this campaign
      await db
        .delete(smsCampaignRecipients)
        .where(eq(smsCampaignRecipients.campaignId, input.campaignId));

      // Reset campaign back to DRAFT
      await db
        .update(smsCampaigns)
        .set({
          status: "DRAFT",
          frozenRecipientCount: 0,
          frozenAt: null,
          updatedAt: new Date(),
        })
        .where(eq(smsCampaigns.id, input.campaignId));

      console.info(
        `[smsCampaignRouter] Campaign ${input.campaignId} unfrozen by ${agentName} — recipients deleted, status reset to DRAFT`
      );

      return { campaignId: input.campaignId, status: "DRAFT" as const };
    }),

  /**
   * listCampaigns — returns the 50 most recent campaigns for the history panel.
   * Read-only summary: no recipient rows, no audienceDefinition blob.
   */
  listCampaigns: adminAgentProcedure
    .query(async () => {
      const db = getDb();
      const rows = await db
        .select({
          id: smsCampaigns.id,
          name: smsCampaigns.name,
          status: smsCampaigns.status,
          frozenRecipientCount: smsCampaigns.frozenRecipientCount,
          sentCount: smsCampaigns.sentCount,
          failedCount: smsCampaigns.failedCount,
          repliedCount: smsCampaigns.repliedCount,
          bookedCount: smsCampaigns.bookedCount,
          estimatedRevenue: smsCampaigns.estimatedRevenue,
          estimatedBookings: smsCampaigns.estimatedBookings,
          estimatedReplies: smsCampaigns.estimatedReplies,
          createdByName: smsCampaigns.createdByName,
          createdAt: smsCampaigns.createdAt,
          frozenAt: smsCampaigns.frozenAt,
          approvedAt: smsCampaigns.approvedAt,
          sendCompletedAt: smsCampaigns.sendCompletedAt,
        })
        .from(smsCampaigns)
        .orderBy(desc(smsCampaigns.createdAt))
        .limit(50);
      return rows;
    }),
});
export type SmsCampaignRouter = typeof smsCampaignRouter;
