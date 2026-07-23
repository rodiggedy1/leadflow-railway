/**
 * readinessPlanSchema.ts
 *
 * Single source of truth for the Madison ReadinessPlan contract.
 *
 * Architecture: transport ≠ domain model
 * ─────────────────────────────────────
 * OpenAI structured-output requires a root `type: "object"` — bare anyOf at
 * root is explicitly rejected. So the LLM receives a FLAT schema with all
 * fields in one object. After parsing, a normalization step converts the flat
 * response into the internal discriminated union, which is then validated by
 * Zod.
 *
 * Flow:
 *   LLM → flat JSON (READINESS_PLAN_JSON_SCHEMA)
 *        → normalizeFlatPlan()
 *        → READINESS_PLAN_ZOD_SCHEMA.parse()
 *        → ReadinessPlan (discriminated union)
 *        → executor / acknowledgeService
 *
 * Three exports:
 *   1. READINESS_PLAN_JSON_SCHEMA  — flat OpenAI strict-mode schema (transport)
 *   2. READINESS_PLAN_ZOD_SCHEMA   — Zod discriminated union (internal domain)
 *   3. normalizeFlatPlan()         — converts flat → union shape
 *
 * OpenAI strict-mode rules (enforced by the API):
 *   - Root must be `type: "object"` — no bare anyOf/oneOf at root
 *   - Every object must have `additionalProperties: false`
 *   - Every property in `properties` must appear in `required`
 *   - Optional fields must use `anyOf: [<type>, { type: "null" }]`
 *
 * targetReference design:
 *   The LLM never supplies trusted readiness item IDs directly. Instead it
 *   declares intent: "use whatever was last shown" (context_selection) or
 *   "I extracted these IDs from the conversation" (explicit). The server
 *   resolves and validates IDs deterministically against the stored context.
 */

import { z } from "zod";

// ─────────────────────────────────────────────────────────────────────────────
// 1. Internal Zod schema (discriminated union — domain model)
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
   * How to resolve the target items. The LLM never supplies raw item IDs
   * that are trusted directly — it declares intent and the server resolves.
   *
   * context_selection: use whatever was last shown in the conversation context
   * explicit: LLM extracted these IDs from the conversation (still validated
   *           against context before use)
   */
  targetReference: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("context_selection") }),
    z.object({ kind: z.literal("explicit"), itemIds: z.array(z.string()) }),
  ]),
  /**
   * The service date these items belong to (YYYY-MM-DD).
   * Used to refresh the projection after acknowledgement.
   */
  serviceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
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
// 3. OpenAI JSON schema (flat transport format, strict mode)
//
// Root MUST be type: "object" — OpenAI rejects bare anyOf at root.
// All fields are present on every response; query-only fields are null for
// action plans and vice versa. The normalizeFlatPlan() function below converts
// this flat shape into the internal discriminated union.
// ─────────────────────────────────────────────────────────────────────────────

export const READINESS_PLAN_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "type",
    // query-only fields
    "dateScope",
    "filters",
    "sort",
    // action-only fields
    "action",
    "targetReference",
    "serviceDate",
  ],
  properties: {
    // ── Discriminant ──────────────────────────────────────────────────────────
    type: {
      type: "string",
      enum: ["query", "action"],
    },

    // ── Query-only fields (null when type=action) ─────────────────────────────
    dateScope: {
      anyOf: [
        {
          type: "object",
          properties: {
            type: { type: "string", enum: ["service_date"] },
            startDate: { type: "string" },
            endDate: { type: "string" },
          },
          required: ["type", "startDate", "endDate"],
          additionalProperties: false,
        },
        { type: "null" },
      ],
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

    // ── Action-only fields (null when type=query) ─────────────────────────────
    action: {
      anyOf: [{ type: "string", enum: ["acknowledge_readiness"] }, { type: "null" }],
    },
    targetReference: {
      anyOf: [
        // context_selection: use last shown items from conversation context
        {
          type: "object",
          properties: {
            kind: { type: "string", enum: ["context_selection"] },
          },
          required: ["kind"],
          additionalProperties: false,
        },
        // explicit: LLM extracted these IDs from the conversation
        {
          type: "object",
          properties: {
            kind: { type: "string", enum: ["explicit"] },
            itemIds: {
              type: "array",
              items: { type: "string" },
            },
          },
          required: ["kind", "itemIds"],
          additionalProperties: false,
        },
        { type: "null" },
      ],
    },
    serviceDate: {
      anyOf: [{ type: "string" }, { type: "null" }],
    },
  },
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// 4. Normalization: flat OpenAI response → internal discriminated union shape
//
// Called by planner.ts after JSON.parse(), before Zod validation.
// Rejects contradictory responses (e.g. type=query with action set).
// ─────────────────────────────────────────────────────────────────────────────

export type FlatPlanResponse = {
  type: "query" | "action";
  // query-only
  dateScope: unknown;
  filters: unknown;
  sort: unknown;
  // action-only
  action: unknown;
  targetReference: unknown;
  serviceDate: unknown;
};

/**
 * Converts the flat OpenAI response into the internal discriminated union shape.
 * Throws a descriptive error if the response is contradictory or invalid.
 */
export function normalizeFlatPlan(flat: FlatPlanResponse): unknown {
  if (flat.type === "query") {
    // Reject contradictory responses
    if (flat.action !== null && flat.action !== undefined) {
      throw new Error(
        `Contradictory plan: type=query but action=${JSON.stringify(flat.action)}`
      );
    }
    return {
      type: "query",
      dateScope: flat.dateScope,
      filters: flat.filters ?? null,
      sort: flat.sort ?? null,
    };
  }

  if (flat.type === "action") {
    // Reject contradictory responses
    if (flat.dateScope !== null && flat.dateScope !== undefined) {
      throw new Error(
        `Contradictory plan: type=action but dateScope is set`
      );
    }
    if (!flat.action) {
      throw new Error(`Action plan missing action field`);
    }
    if (!flat.targetReference) {
      throw new Error(`Action plan missing targetReference field`);
    }
    return {
      type: "action",
      action: flat.action,
      targetReference: flat.targetReference,
      serviceDate: flat.serviceDate ?? null,
    };
  }

  throw new Error(`Unknown plan type: ${JSON.stringify((flat as { type: unknown }).type)}`);
}
