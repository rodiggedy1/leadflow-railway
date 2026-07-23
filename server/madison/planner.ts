/**
 * planner.ts
 *
 * Creates a structured ReadinessPlan from a natural-language message.
 * Single LLM call with JSON schema output. Validated deterministically after.
 *
 * Schema source of truth: ./schema/readinessPlanSchema.ts
 * Do not inline schema here — edit readinessPlanSchema.ts instead.
 */

import { invokeLLM } from "../_core/llm";
import { getTodayET, offsetServiceDate } from "../conciergeTime";
import { MadisonError } from "./types";
import {
  READINESS_PLAN_ZOD_SCHEMA,
  READINESS_PLAN_JSON_SCHEMA,
  normalizeFlatPlan,
  type FlatPlanResponse,
  type ReadinessPlan,
} from "./schema/readinessPlanSchema";

export type { ReadinessPlan };

const PLANNER_SYSTEM_PROMPT = `You are a planning assistant for an operations manager at a residential cleaning company.

Your job is to interpret a natural-language question about operational readiness and produce a structured JSON plan.

Today's date in Eastern Time will be provided. Use it to resolve relative date references like "tomorrow", "today", "this week".

The response schema is a FLAT object with ALL fields present. Set fields that do not apply to the selected type to null.

Plan types:
- type: "query" — for read-only readiness questions (most requests)
- type: "action" — ONLY when the user explicitly asks to acknowledge, dismiss, or mark items as handled

For type: "query" plans:
- Set dateScope, filters, sort as needed. Set action, targetReference, serviceDate to null.
- dateScope.startDate and endDate must be YYYY-MM-DD strings
- "tomorrow" → next calendar day from today
- "today" → today's date
- "this week" → startDate = today, endDate = today + 6 days
- timeOfDay: "morning" = before 12:00, "afternoon" = 12:00–17:00, "evening" = after 17:00
- If the user asks about a specific time like "9 AM jobs", set startTime and endTime to a 1-hour window: "09:00" to "10:00"
- dimension: use "assignment" for unassigned/no cleaner questions, "confirmation" for confirmed/unconfirmed, "payment" for card/payment questions, "access" for instructions/notes/access, "schedule" for double-booked/double-booking/schedule conflicts/overlap, "all" for general readiness
- onlyNeedsAttention: true when user asks about problems, issues, risks, or "what needs attention"
- minimumFlagCount: set to 2 when user asks about jobs "at risk" (multiple issues)
- sort: "risk" when asking about problems/issues, "service_time" otherwise
- For fields you cannot determine, use null (do not omit them)
- If the user does not specify a date or time reference, default dateScope to TODAY (not tomorrow)
- For exact time queries like "8:30 AM jobs" or "9 AM jobs", set exactTime to "08:30" or "09:00" (HH:MM 24-hour format) — do NOT use startTime/endTime for exact time matches

For type: "action" plans (acknowledge_readiness):
- Set action: "acknowledge_readiness". Set dateScope, filters, sort to null.
- targetReference: declare how to resolve the target items:
  - { kind: "context_selection" } — use whatever was last shown in the conversation (use this when user says "those", "them", "all of them", etc.)
  - { kind: "explicit", itemIds: [...] } — only if the user explicitly named specific item IDs
  - Default to context_selection unless the user explicitly provides item IDs.
- serviceDate: the YYYY-MM-DD date of the items being acknowledged (null if unknown)
- Only produce this plan type when the user explicitly asks to acknowledge/dismiss/mark items

Return ONLY valid JSON matching the schema. No explanation.`;

export async function createReadinessPlan(
  message: string
): Promise<ReadinessPlan> {
  const todayET = getTodayET();
  const tomorrowET = offsetServiceDate(todayET, 1);

  const userPrompt = `Today's date (Eastern Time): ${todayET}
Tomorrow's date (Eastern Time): ${tomorrowET}

User question: "${message}"

Produce the ReadinessPlan JSON.`;

  let raw: string;
  try {
    const response = await invokeLLM({
      messages: [
        { role: "system", content: PLANNER_SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "readiness_plan",
          strict: true,
          schema: READINESS_PLAN_JSON_SCHEMA,
        },
      },
    });

    raw = response.choices?.[0]?.message?.content ?? "";
  } catch (err) {
    // Extract OpenAI error details for diagnostics
    const errMsg = err instanceof Error ? err.message : String(err);
    // Try to extract OpenAI error code and request ID from the error body
    let detail = errMsg;
    try {
      const bodyMatch = errMsg.match(/\{[\s\S]*\}/);
      if (bodyMatch) {
        const body = JSON.parse(bodyMatch[0]);
        const code = body?.error?.code ?? body?.error?.type ?? "unknown";
        const msg = body?.error?.message ?? "";
        detail = `code=${code} message=${msg} raw=${errMsg.slice(0, 200)}`;
      }
    } catch {
      // ignore parse failure — use raw errMsg
    }
    throw new MadisonError(
      "PLAN_FAILED",
      `LLM call failed: ${detail}`
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new MadisonError("PLAN_FAILED", `LLM returned non-JSON: ${raw.slice(0, 200)}`);
  }

  // Normalize flat OpenAI transport format → internal discriminated union shape
  let normalized: unknown;
  try {
    normalized = normalizeFlatPlan(parsed as FlatPlanResponse);
  } catch (normErr) {
    throw new MadisonError(
      "PLAN_INVALID",
      `Plan normalization failed: ${normErr instanceof Error ? normErr.message : String(normErr)}`
    );
  }

  const result = READINESS_PLAN_ZOD_SCHEMA.safeParse(normalized);
  if (!result.success) {
    throw new MadisonError(
      "PLAN_INVALID",
      `Plan failed validation: ${result.error.message}`
    );
  }

  return result.data;
}
