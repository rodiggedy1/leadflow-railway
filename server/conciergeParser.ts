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
  "call_client", "eta_update", "get_eta_for_customer", "card_status", "rank_teams", "list_no_eta",
  "confirmation_texts", "confirmation_results", "job_status_stream", "unanswered_sms", "generate_invoice", "unknown",
] as const;

const VALID_FIELDS: RequestedField[] = [
  "assignment", "scheduled_time", "job_status", "eta", "address",
  "access", "notes", "pricing", "payment_status", "history", "summary", "rating",
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
- "card_status" — user wants to see credit card / payment hold status for jobs on a specific date (e.g. "show cards on hold for tomorrow", "card status for July 21", "which customers have pre-auth today")
- "rank_teams" — user wants to rank or compare teams/cleaners by their customer rating (e.g. "rank teams by rating", "who has the best rating", "team ratings", "best cleaners", "worst rated team")
- "list_no_eta" — user wants to see which teams/cleaners have not yet submitted an ETA today (e.g. "which teams have no ETA", "who hasn't submitted ETA", "missing ETA", "no ETA teams", "teams with no ETA", "who still needs to send ETA")
- "job_status_stream" — user wants to see the live status stream of all today's jobs and alerts (e.g. "show me today's jobs", "job status", "what's going on today", "status stream", "show all jobs", "live status", "team status")
- "unanswered_sms" — user wants to see CS inbox conversations where the customer's last message has been sitting unanswered for longer than a time threshold (e.g. "unanswered texts over 30 minutes", "any SMS over an hour", "who's been waiting more than 45 minutes", "unanswered messages"). Use questionHint to store the threshold in minutes as a plain number string (e.g. "30", "60", "120"). Default to "30" if no threshold is specified.
- "generate_invoice" — user wants to generate an invoice PDF for a customer (e.g. "generate invoice for Janice", "create invoice for Mary", "invoice for Sarah", "make an invoice for Jennifer"). Use clientName to store the customer name. Use questionHint to store the service date if mentioned.
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
- "rating" — customer ratings/reviews for a specific team or cleaner (e.g. "last 5 ratings for maidsplus", "how has Team 3 been rated", "ratings for Pilar this month")

Rules:
- "who is assigned" → ["assignment"]
- "what time" → ["scheduled_time"]
- "what's the status" → ["job_status"]
- "entry code" / "lockbox" / "gate code" / "how do I get in" → ["access"]
- "tell me about [customer]" / "who is [customer]" / "pull up [customer]" → ["summary"]
- "history" / "past jobs" → ["history"]
- "ratings" / "how rated" / "last N ratings" / "review score" → ["rating"]
- Multiple fields in one question → include all relevant fields
- For non-query actions, return []

## Action-specific hints (only for non-query actions)
- teamHint: team or cleaner name for eta_update
- targetHint: who to text for text_cleaners (exact name or group like "all", "DC", "team 5")
- clientName: exact customer full name for text_client, send_payment_link, call_client
- messageHint: message content or topic for text_client or text_cleaners
- questionHint: topic/question to ask for call_client; for unanswered_sms, the wait threshold in minutes as a plain number string (e.g. "30", "60")

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
"Send Cindy a payment link" → action: "send_payment_link", clientName: "Cindy", targetType: "customer", requestedFields: []
"Show me cards on hold for tomorrow" → action: "card_status", timeScope: {type: "tomorrow"}, requestedFields: []
"Card status for today" → action: "card_status", timeScope: {type: "today"}, requestedFields: []
"Rank teams by rating" → action: "rank_teams", timeScope: {type: null}, requestedFields: []
"Who has the best rating?" → action: "rank_teams", timeScope: {type: null}, requestedFields: []
"Team ratings" → action: "rank_teams", timeScope: {type: null}, requestedFields: []
"Which teams have no ETA?" → action: "list_no_eta", timeScope: {type: null}, requestedFields: []
"Who hasn't submitted ETA today?" → action: "list_no_eta", timeScope: {type: null}, requestedFields: []
"Missing ETA teams" → action: "list_no_eta", timeScope: {type: null}, requestedFields: []
"Send confirmation texts for tomorrow" → action: "confirmation_texts", timeScope: {type: "tomorrow"}, requestedFields: []
"Fire confirmations for July 22" → action: "confirmation_texts", timeScope: {type: "specific_date", specificDate: "2026-07-22"}, requestedFields: []
"Text all clients for today's appointments" → action: "confirmation_texts", timeScope: {type: "today"}, requestedFields: []
"Show confirmation results for tomorrow" → action: "confirmation_results", timeScope: {type: "tomorrow"}, requestedFields: []
"Confirmation text results for July 22" → action: "confirmation_results", timeScope: {type: "specific_date", specificDate: "2026-07-22"}, requestedFields: []
"Who confirmed for tomorrow?" → action: "confirmation_results", timeScope: {type: "tomorrow"}, requestedFields: []
"Show me today's jobs" → action: "job_status_stream", timeScope: {type: "today"}, requestedFields: []
"What's going on today?" → action: "job_status_stream", timeScope: {type: "today"}, requestedFields: []
"Status stream" → action: "job_status_stream", timeScope: {type: "today"}, requestedFields: []
"Team status" → action: "job_status_stream", timeScope: {type: "today"}, requestedFields: []
"Unanswered texts over 30 minutes" → action: "unanswered_sms", questionHint: "30", timeScope: {type: null}, requestedFields: []
"Any SMS over an hour" → action: "unanswered_sms", questionHint: "60", timeScope: {type: null}, requestedFields: []
"Who's been waiting more than 45 minutes" → action: "unanswered_sms", questionHint: "45", timeScope: {type: null}, requestedFields: []
"Unanswered messages" → action: "unanswered_sms", questionHint: "30", timeScope: {type: null}, requestedFields: []
"Generate invoice for Janice" → action: "generate_invoice", clientName: "Janice", questionHint: null, timeScope: {type: null}, requestedFields: []
"Create invoice for Mary Jones" → action: "generate_invoice", clientName: "Mary Jones", questionHint: null, timeScope: {type: null}, requestedFields: []
"Invoice for Sarah for June 29" → action: "generate_invoice", clientName: "Sarah", questionHint: "June 29", timeScope: {type: null}, requestedFields: []
"Last 5 ratings for maidsplus" → action: "query", entities: {cleanerName: "maidsplus", teamName: "maidsplus"}, timeScope: {type: null, originalPhrase: "last 5"}, requestedFields: ["rating"]
"How has Team 3 been rated recently?" → action: "query", entities: {teamName: "Team 3"}, timeScope: {type: null, originalPhrase: "recently"}, requestedFields: ["rating"]
"Ratings for Pilar this month" → action: "query", entities: {cleanerName: "Pilar"}, timeScope: {type: "this_month"}, requestedFields: ["rating"]`,
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
              enum: ["query", "text_cleaners", "text_client", "send_payment_link", "call_client", "eta_update", "get_eta_for_customer", "card_status", "rank_teams", "list_no_eta", "confirmation_texts", "confirmation_results", "job_status_stream", "unanswered_sms", "generate_invoice", "unknown"],
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
                enum: ["assignment", "scheduled_time", "job_status", "eta", "address", "access", "notes", "pricing", "payment_status", "history", "summary", "rating"],
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
  action: "eta_update" | "get_eta_for_customer" | "text_cleaners" | "text_client" | "send_payment_link" | "call_client" | "query_data" | "customer_profile" | "list_no_eta" | "rank_teams" | "card_status" | "confirmation_texts" | "confirmation_results" | "job_status_stream" | "unanswered_sms" | "generate_invoice" | "unknown";
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
