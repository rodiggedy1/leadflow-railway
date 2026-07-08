/**
 * smsCampaignRouter.ts
 *
 * tRPC router for SMS Campaign features.
 * Stage 2: planAudience — read-only audience planning endpoint.
 *
 * No DB writes. No campaign creation. No OpenPhone calls.
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { adminAgentProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { planAudience } from "./AudiencePlanner";

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
        const result = await planAudience(db, input);
        return result;
      } catch (err) {
        console.error("[smsCampaignRouter] planAudience error:", err);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Audience planning failed. Please try again.",
        });
      }
    }),
});

export type SmsCampaignRouter = typeof smsCampaignRouter;
