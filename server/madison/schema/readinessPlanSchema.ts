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
 */

import { z } from "zod";

// ─────────────────────────────────────────────────────────────────────────────
// 1. Zod validator
// ─────────────────────────────────────────────────────────────────────────────

export const READINESS_PLAN_ZOD_SCHEMA = z.object({
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

// ─────────────────────────────────────────────────────────────────────────────
// 2. TypeScript type (inferred — never write this by hand)
// ─────────────────────────────────────────────────────────────────────────────

export type ReadinessPlan = z.infer<typeof READINESS_PLAN_ZOD_SCHEMA>;

// ─────────────────────────────────────────────────────────────────────────────
// 3. OpenAI JSON schema (strict mode)
//
// Must mirror the Zod schema exactly. Rules:
//   - All objects: additionalProperties: false
//   - All objects: required lists every key in properties
//   - Optional fields: anyOf: [<real type>, { type: "null" }]
// ─────────────────────────────────────────────────────────────────────────────

export const READINESS_PLAN_JSON_SCHEMA = {
  type: "object",
  properties: {
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
  required: ["dateScope", "filters", "sort"],
  additionalProperties: false,
} as const;
