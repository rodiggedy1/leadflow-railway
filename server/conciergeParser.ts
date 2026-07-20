/**
 * conciergeParser.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Unified parser for AI Concierge requests.
 *
 * Replaces classifyIntent() + the entity extractor inside handleQueryData.
 * One LLM call produces a fully typed QueryPlan.
 *
 * For non-query actions (text_cleaners, text_client, etc.) the output is
 * backward-compatible with the existing action handlers — they read the same
 * hint fields (teamHint, targetHint, clientName, messageHint, questionHint).
 */

import { invokeLLM } from "./_core/llm";
import type {
  QueryPlan,
  RequestedField,
  TimeScope,
  TimeScopeType,
} from "./conciergeQuery";

// ── Target type ───────────────────────────────────────────────────────────────

export type TargetType = "customer" | "cleaner" | "team" | "unknown";

// ── LLM response shape ────────────────────────────────────────────────────────

interface ParsedResponse {
  action: string;
  entities: {
    customerName: string | null;
    cleanerName: string | null;
    teamName: string | null;
    jobId: string | null;
  };
  timeScope: {
    type: string | null;
    specificDate: string | null;
    originalPhrase: string | null;
  };
  requestedFields: string[];
  messageHint: string | null;
  questionHint: string | null;
  targetHint: string | null;
  teamHint: string | null;
  clientName: string | null;
  targetType: TargetType;
}

// ── Validation helpers ────────────────────────────────────────────────────────

const VALID_ACTIONS = [
  "query", "text_cleaners", "text_client", "send_payment_link",
  "call_client", "eta_update", "get_eta_for_customer", "unknown",
] as const;

const VALID_FIELDS: RequestedField[] = [
  "assignment", "scheduled_time", "job_status", "eta", "address",
  "access", "notes", "pricing", "payment_status", "history", "summary",
];

const VALID_SCOPE_TYPES: TimeScopeType[] = [
  "today", "yesterday", "tomorrow", "this_week", "last_week", "next_week",
  "this_month", "last_month", "specific_date", "next_appointment",
  "last_appointment", "all_time", null,
];

const VALID_TARGET_TYPES: TargetType[] = ["customer", "cleaner", "team", "unknown"];

function sanitizeFields(raw: string[]): RequestedField[] {
  return raw.filter((f): f is RequestedField => (VALID_FIELDS as string[]).includes(f));
}

function sanitizeScope(raw: ParsedResponse["timeScope"]): TimeScope {
  const type = VALID_SCOPE_TYPES.includes(raw.type as TimeScopeType)
    ? (raw.type as TimeScopeType)
    : null;
  return {
    type,
    specificDate: raw.specificDate ?? null,
    originalPhrase: raw.originalPhrase ?? null,
  };
}

// ── Plan validation ───────────────────────────────────────────────────────────

/**
 * Maps each action to the set of targetTypes it is allowed to have.
 * If the parsed plan's targetType is not in the allowed set, it is a contradiction.
 * Data-driven: add new actions here as they are introduced.
 */
const ACTION_ALLOWED_TARGET_TYPES: Partial<Record<QueryPlan["action"], TargetType[]>> = {
  text_client:      ["customer"],
  send_payment_link:["customer"],
  call_client:      ["customer", "cleaner"],   // could call a cleaner too
  text_cleaners:    ["cleaner", "team"],
  eta_update:       ["cleaner", "team"],
  get_eta_for_customer: ["customer"],
};

/**
 * When a contradiction is detected, this maps the action to its corrected form
 * based on the actual targetType. Data-driven: extend as needed.
 */
const CONTRADICTION_CORRECTION: Partial<Record<QueryPlan["action"], Partial<Record<TargetType, QueryPlan["action"]>>>> = {
  text_cleaners: {
    customer: "text_client",
  },
  eta_update: {
    customer: "get_eta_for_customer",
  },
};

export interface NormalizationResult {
  plan: QueryPlan;
  corrected: boolean;
  correction?: {
    originalAction: QueryPlan["action"];
    correctedAction: QueryPlan["action"];
    reason: string;
    evidenceSource: "chip_entity" | "explicit_entity" | "target_type" | "inferred";
  };
}

/**
 * Validate and normalize a parsed QueryPlan before dispatch.
 *
 * Precedence order (highest → lowest confidence):
 *   1. chip-selected entity (re) — user explicitly picked this entity
 *   2. explicit entity — clientName / targetHint is set and unambiguous
 *   3. targetType — LLM's explicit classification of who is targeted
 *   4. inferred action — the raw action field
 *
 * Returns the (possibly corrected) plan plus correction metadata for logging.
 */
export function validateAndNormalizePlan(
  plan: QueryPlan,
  re: { type: "customer" | "cleaner"; name: string; phone?: string; cleanerProfileId?: number } | null,
): NormalizationResult {
  const allowedTypes = ACTION_ALLOWED_TARGET_TYPES[plan.action];

  // Actions with no target type constraint (query, unknown) — pass through
  if (!allowedTypes) {
    return { plan, corrected: false };
  }

  // ── 1. Chip-selected entity (highest confidence) ──────────────────────────
  if (re) {
    const chipTargetType: TargetType = re.type === "customer" ? "customer"
      : re.type === "cleaner" ? "cleaner"
      : "unknown";
    if (!allowedTypes.includes(chipTargetType)) {
      const correctedAction = CONTRADICTION_CORRECTION[plan.action]?.[chipTargetType];
      if (correctedAction) {
        return {
          plan: { ...plan, action: correctedAction, targetType: chipTargetType },
          corrected: true,
          correction: {
            originalAction: plan.action,
            correctedAction,
            reason: `chip entity type "${chipTargetType}" contradicts action "${plan.action}"`,
            evidenceSource: "chip_entity",
          },
        };
      }
    }
    // Chip is consistent — trust it, no correction needed
    return { plan, corrected: false };
  }

  // ── 2. Explicit entity (clientName present, no chip) ─────────────────────
  // A clientName strongly implies a customer target for text/call/payment actions
  if (plan.clientName && plan.action === "text_cleaners") {
    const correctedAction = CONTRADICTION_CORRECTION[plan.action]?.["customer"];
    if (correctedAction) {
      return {
        plan: { ...plan, action: correctedAction, targetType: "customer" },
        corrected: true,
        correction: {
          originalAction: plan.action,
          correctedAction,
          reason: `clientName "${plan.clientName}" is set but action is "${plan.action}"`,
          evidenceSource: "explicit_entity",
        },
      };
    }
  }

  // ── 3. targetType from LLM ────────────────────────────────────────────────
  if (plan.targetType !== "unknown" && !allowedTypes.includes(plan.targetType)) {
    const correctedAction = CONTRADICTION_CORRECTION[plan.action]?.[plan.targetType];
    if (correctedAction) {
      return {
        plan: { ...plan, action: correctedAction },
        corrected: true,
        correction: {
          originalAction: plan.action,
          correctedAction,
          reason: `targetType "${plan.targetType}" contradicts action "${plan.action}"`,
          evidenceSource: "target_type",
        },
      };
    }
  }

  // No contradiction detected
  return { plan, corrected: false };
}

// ── Main parser ───────────────────────────────────────────────────────────────

export async function parseConciergeRequest(message: string): Promise<QueryPlan> {
  const result = await invokeLLM({
    messages: [
      {
        role: "system",
        content: `You are the intent parser for an AI operations concierge at a home cleaning company.

Parse the dispatcher's message and return a JSON object with the following fields.

## action
Choose ONE of:
- "query" — user is asking for information about jobs, customers, teams, or cleaners. Use this for ALL informational questions.
- "text_cleaners" — user wants to send an SMS to cleaning staff or teams
- "text_client" — user wants to send an SMS to a specific customer
- "send_payment_link" — user wants to send a Stripe card-on-file link to a customer
- "call_client" — user wants to place an outbound call to a customer
- "eta_update" — user wants to trigger an ETA call to a team
- "get_eta_for_customer" — user wants the ETA for a specific customer's job
- "unknown" — cannot determine intent

## entities (for "query" action)
- customerName: name of the CLIENT whose home is being cleaned (null if not mentioned)
- cleanerName: name of a specific CLEANER (null if not mentioned)
- teamName: name of a TEAM like "Team 3" or "Team Solange" (null if not mentioned)
- jobId: booking or job ID if explicitly mentioned (null otherwise)

When a name is ambiguous (could be customer or cleaner), set BOTH customerName and cleanerName to the same value.

## timeScope (for "query" action)
- type: one of "today", "yesterday", "tomorrow", "this_week", "last_week", "next_week", "this_month", "last_month", "specific_date", "next_appointment", "last_appointment", "all_time", or null (not specified)
- specificDate: YYYY-MM-DD only when type = "specific_date"
- originalPhrase: the exact time phrase from the message (e.g. "last Tuesday", "this Friday"), or null

## requestedFields (for "query" action)
Array of information types the user is asking for. Choose from:
- "assignment" — who is assigned, which team, which cleaner
- "scheduled_time" — what time is the cleaning
- "job_status" — current status (on the way, arrived, in progress, completed, etc.)
- "eta" — ETA for arrival
- "address" — job address / location
- "access" — entry code, lockbox, gate code, key instructions
- "notes" — customer notes, special instructions, staff notes
- "pricing" — price charged, job revenue
- "payment_status" — payment status (paid, balance due, etc.)
- "history" — booking history, past jobs
- "summary" — full customer profile / overview

Rules:
- "who is assigned" → ["assignment"]
- "what time" → ["scheduled_time"]
- "what's the status" → ["job_status"]
- "entry code" / "lockbox" / "gate code" / "how do I get in" → ["access"]
- "tell me about [customer]" / "who is [customer]" / "pull up [customer]" → ["summary"]
- "history" / "past jobs" → ["history"]
- Multiple fields in one question → include all relevant fields
- For non-query actions, return []

## Action-specific hints (only for non-query actions)
- teamHint: team or cleaner name for eta_update
- targetHint: who to text for text_cleaners (exact name or group like "all", "DC", "team 5")
- clientName: exact customer full name for text_client, send_payment_link, call_client
- messageHint: message content or topic for text_client or text_cleaners
- questionHint: topic/question to ask for call_client

## targetType
Classify who the action targets:
- "customer" — a homeowner/client receiving cleaning services. A full personal name (first + last) like "Rohan Gilkes" or "Mary Jones" is almost always a customer.
- "cleaner" — a cleaning staff member by name
- "team" — a team label like "DC", "Team 5", "all cleaners", "working today"
- "unknown" — for query/eta/informational actions, or when truly ambiguous

## Examples
"Who is assigned to Cindy today?" → action: "query", entities: {customerName: "Cindy"}, timeScope: {type: "today"}, requestedFields: ["assignment"]
"What time is Cindy's cleaning?" → action: "query", entities: {customerName: "Cindy"}, timeScope: {type: "today"}, requestedFields: ["scheduled_time"]
"Who is Cindy?" → action: "query", entities: {customerName: "Cindy"}, timeScope: {type: null}, requestedFields: ["summary"]
"Tell me Cindy's history" → action: "query", entities: {customerName: "Cindy"}, timeScope: {type: "all_time"}, requestedFields: ["history"]
"Who is assigned to Cindy today and what's her entry code?" → action: "query", entities: {customerName: "Cindy"}, timeScope: {type: "today"}, requestedFields: ["assignment", "access"]
"What jobs does Team 3 have today?" → action: "query", entities: {teamName: "Team 3"}, timeScope: {type: "today"}, requestedFields: ["assignment", "scheduled_time"]
"List all jobs today" → action: "query", entities: {customerName: null, cleanerName: null, teamName: null, jobId: null}, timeScope: {type: "today"}, requestedFields: ["assignment", "scheduled_time", "job_status"]
"Text team 3 to hurry up" → action: "text_cleaners", targetHint: "team 3", messageHint: "hurry up", targetType: "team", requestedFields: []
"Text Rohan Gilkes and let him know we're running late" → action: "text_client", clientName: "Rohan Gilkes", messageHint: "running late", targetType: "customer", requestedFields: []
"Send Cindy a payment link" → action: "send_payment_link", clientName: "Cindy", targetType: "customer", requestedFields: []`,
      },
      { role: "user", content: message },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "concierge_parse",
        strict: true,
        schema: {
          type: "object",
          properties: {
            action: {
              type: "string",
              enum: ["query", "text_cleaners", "text_client", "send_payment_link", "call_client", "eta_update", "get_eta_for_customer", "unknown"],
            },
            entities: {
              type: "object",
              properties: {
                customerName: { type: ["string", "null"] },
                cleanerName:  { type: ["string", "null"] },
                teamName:     { type: ["string", "null"] },
                jobId:        { type: ["string", "null"] },
              },
              required: ["customerName", "cleanerName", "teamName", "jobId"],
              additionalProperties: false,
            },
            timeScope: {
              type: "object",
              properties: {
                type:           { type: ["string", "null"] },
                specificDate:   { type: ["string", "null"] },
                originalPhrase: { type: ["string", "null"] },
              },
              required: ["type", "specificDate", "originalPhrase"],
              additionalProperties: false,
            },
            requestedFields: {
              type: "array",
              items: {
                type: "string",
                enum: ["assignment", "scheduled_time", "job_status", "eta", "address", "access", "notes", "pricing", "payment_status", "history", "summary"],
              },
            },
            messageHint:  { type: ["string", "null"] },
            questionHint: { type: ["string", "null"] },
            targetHint:   { type: ["string", "null"] },
            teamHint:     { type: ["string", "null"] },
            clientName:   { type: ["string", "null"] },
            targetType:   { type: "string", enum: ["customer", "cleaner", "team", "unknown"] },
          },
          required: ["action", "entities", "timeScope", "requestedFields", "messageHint", "questionHint", "targetHint", "teamHint", "clientName", "targetType"],
          additionalProperties: false,
        },
      },
    },
  });

  let parsed: ParsedResponse;
  try {
    parsed = JSON.parse(result.choices[0].message.content as string) as ParsedResponse;
  } catch {
    return fallbackPlan(message);
  }

  const action = (VALID_ACTIONS as readonly string[]).includes(parsed.action)
    ? (parsed.action as QueryPlan["action"])
    : "unknown";

  const requestedFields = sanitizeFields(parsed.requestedFields ?? []);
  const timeScope = sanitizeScope(parsed.timeScope ?? { type: null, specificDate: null, originalPhrase: null });

  // If action is "query" but no requestedFields extracted, default to summary
  const effectiveFields: RequestedField[] =
    action === "query" && requestedFields.length === 0
      ? ["summary"]
      : requestedFields;

  const targetType: TargetType = VALID_TARGET_TYPES.includes(parsed.targetType as TargetType)
    ? (parsed.targetType as TargetType)
    : "unknown";

  console.log("[Parser] action:", action, "targetType:", targetType, "fields:", effectiveFields, "timeScope:", timeScope.type, "entities:", JSON.stringify(parsed.entities));

  return {
    action,
    entities: {
      customerName: parsed.entities?.customerName ?? null,
      cleanerName:  parsed.entities?.cleanerName ?? null,
      teamName:     parsed.entities?.teamName ?? null,
      jobId:        parsed.entities?.jobId ?? null,
    },
    timeScope,
    requestedFields: effectiveFields,
    messageHint:  parsed.messageHint ?? null,
    questionHint: parsed.questionHint ?? null,
    targetHint:   parsed.targetHint ?? null,
    teamHint:     parsed.teamHint ?? null,
    clientName:   parsed.clientName ?? null,
    targetType,
  };
}

function fallbackPlan(message: string): QueryPlan {
  return {
    action: "unknown",
    entities: { customerName: null, cleanerName: null, teamName: null, jobId: null },
    timeScope: { type: null, specificDate: null, originalPhrase: null },
    requestedFields: [],
    messageHint: null,
    questionHint: null,
    targetHint: null,
    teamHint: null,
    clientName: null,
    targetType: "unknown",
  };
}

// ── Backward-compat adapter ───────────────────────────────────────────────────
// The existing action handlers read from an "Intent" object. This adapter
// converts a QueryPlan to the old Intent shape so we don't have to rewrite
// every handler in this PR.

export interface LegacyIntent {
  action: "eta_update" | "get_eta_for_customer" | "text_cleaners" | "text_client" | "send_payment_link" | "call_client" | "query_data" | "customer_profile" | "unknown";
  teamHint?: string | null;
  targetHint?: string | null;
  clientName?: string | null;
  messageHint?: string | null;
  questionHint?: string | null;
  targetType?: TargetType;
}

/**
 * Convert a QueryPlan to a LegacyIntent for backward-compatible action handlers.
 * "query" action is NOT converted here — the caller handles it via resolveQuery().
 */
export function toLegacyIntent(plan: QueryPlan): LegacyIntent {
  // Map new "query" action to legacy action names for backward compat
  // (should not be called for "query" — caller handles that branch)
  const action = plan.action === "query" ? "query_data" : plan.action;
  return {
    action: action as LegacyIntent["action"],
    teamHint:     plan.teamHint,
    targetHint:   plan.targetHint,
    clientName:   plan.clientName,
    messageHint:  plan.messageHint,
    questionHint: plan.questionHint,
    targetType:   plan.targetType,
  };
}
