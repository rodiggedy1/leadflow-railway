/**
 * readinessPlanSchema.ts
 *
 * Single source of truth for the Madison ReadinessPlan contract.
 *
 * Three things are derived from this one file:
 *   1. READINESS_PLAN_ZOD_SCHEMA  — Zod validator used for runtime parse after LLM call
 *   2. ReadinessPlan              — TypeScript type (inferred from Zod)
 *   3. READINESS_PLAN_JSON_SCHEMA — OpenAI structured-output JSON schema (strict mode)
 *
 * IMPORTANT: If you add or remove a field, update ALL THREE sections below.
 * The unit test in planner.test.ts will catch mismatches at CI time.
 *
 * OpenAI strict-mode rules (enforced by the API, not TypeScript):
 *   - Every object must have `additionalProperties: false`
 *   - Every property in `properties` must appear in `required`
 *   - Optional fields must use `anyOf: [<type>, { type: "null" }]` instead of being omitted
 *
 * Plan types:
 *   - "query"  — read-only readiness query (existing behavior)
 *   - "action" — write action: acknowledge_readiness
 *
 * Discriminant field: `type` (required on all plan variants)
 */

import { z } from "zod";

// ─────────────────────────────────────────────────────────────────────────────
// 1. Zod validator
// ─────────────────────────────────────────────────────────────────────────────

const QUERY_PLAN_ZOD = z.object({
  type: z.literal("query"),
  dateScope: z.object({
    type: z.literal("service_date"),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  }),
  filters: z
    .object({
      timeOfDay: z.enum(["morning", "afternoon", "evening"]).nullable().optional(),
      startTime: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
      endTime: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
      exactTime: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
      dimension: z
        .enum(["all", "assignment", "confirmation", "payment", "access", "schedule"])
        .nullable()
        .optional(),
      onlyNeedsAttention: z.boolean().nullable().optional(),
      minimumFlagCount: z.number().int().min(1).max(5).nullable().optional(),
    })
    .nullable()
    .optional(),
  sort: z.enum(["service_time", "risk"]).nullable().optional(),
});

const ACTION_PLAN_ZOD = z.object({
  type: z.literal("action"),
  action: z.literal("acknowledge_readiness"),
  /**
   * Encoded as "jobId:serviceDate:issueType" strings.
   * The LLM should populate these from the most recent readiness query context.
   */
  targetIds: z.array(z.string()),
  /**
   * The service date these items belong to (YYYY-MM-DD).
   * Used to refresh the projection after acknowledgement.
   */
  serviceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export const READINESS_PLAN_ZOD_SCHEMA = z.discriminatedUnion("type", [
  QUERY_PLAN_ZOD,
  ACTION_PLAN_ZOD,
]);

// ─────────────────────────────────────────────────────────────────────────────
// 2. TypeScript types (inferred — never write these by hand)
// ─────────────────────────────────────────────────────────────────────────────

export type ReadinessQueryPlan = z.infer<typeof QUERY_PLAN_ZOD>;
export type ReadinessActionPlan = z.infer<typeof ACTION_PLAN_ZOD>;
export type ReadinessPlan = z.infer<typeof READINESS_PLAN_ZOD_SCHEMA>;

// ─────────────────────────────────────────────────────────────────────────────
// 3. OpenAI JSON schema (strict mode)
//
// Must mirror the Zod schema exactly. Rules:
//   - All objects: additionalProperties: false
//   - All objects: required lists every key in properties
//   - Optional fields: anyOf: [<real type>, { type: "null" }]
//   - Discriminated union: anyOf at root with each variant as a separate object
// ─────────────────────────────────────────────────────────────────────────────

export const READINESS_PLAN_JSON_SCHEMA = {
  anyOf: [
    // ── Query plan variant ──────────────────────────────────────────────────
    {
      type: "object",
      properties: {
        type: { type: "string", enum: ["query"] },
        dateScope: {
          type: "object",
          properties: {
            type: { type: "string", enum: ["service_date"] },
            startDate: { type: "string" },
            endDate: { type: "string" },
          },
          required: ["type", "startDate", "endDate"],
          additionalProperties: false,
        },
        filters: {
          anyOf: [
            {
              type: "object",
              properties: {
                timeOfDay: {
                  anyOf: [
                    { type: "string", enum: ["morning", "afternoon", "evening"] },
                    { type: "null" },
                  ],
                },
                startTime: { anyOf: [{ type: "string" }, { type: "null" }] },
                endTime: { anyOf: [{ type: "string" }, { type: "null" }] },
                exactTime: { anyOf: [{ type: "string" }, { type: "null" }] },
                dimension: {
                  anyOf: [
                    {
                      type: "string",
                      enum: ["all", "assignment", "confirmation", "payment", "access", "schedule"],
                    },
                    { type: "null" },
                  ],
                },
                onlyNeedsAttention: { anyOf: [{ type: "boolean" }, { type: "null" }] },
                minimumFlagCount: { anyOf: [{ type: "number" }, { type: "null" }] },
              },
              required: [
                "timeOfDay",
                "startTime",
                "endTime",
                "exactTime",
                "dimension",
                "onlyNeedsAttention",
                "minimumFlagCount",
              ],
              additionalProperties: false,
            },
            { type: "null" },
          ],
        },
        sort: {
          anyOf: [{ type: "string", enum: ["service_time", "risk"] }, { type: "null" }],
        },
      },
      required: ["type", "dateScope", "filters", "sort"],
      additionalProperties: false,
    },
    // ── Action plan variant ─────────────────────────────────────────────────
    {
      type: "object",
      properties: {
        type: { type: "string", enum: ["action"] },
        action: { type: "string", enum: ["acknowledge_readiness"] },
        targetIds: {
          type: "array",
          items: { type: "string" },
        },
        serviceDate: { type: "string" },
      },
      required: ["type", "action", "targetIds", "serviceDate"],
      additionalProperties: false,
    },
  ],
} as const;
