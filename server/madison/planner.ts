/**
 * planner.ts
 *
 * Creates a structured ReadinessPlan from a natural-language message.
 * Single LLM call with JSON schema output. Validated deterministically after.
 */

import { invokeLLM } from "../_core/llm";
import { getTodayET } from "../conciergeTime";
import { ReadinessPlanSchema, type ReadinessPlan, MadisonError } from "./types";

const PLANNER_SYSTEM_PROMPT = `You are a planning assistant for an operations manager at a residential cleaning company.

Your job is to interpret a natural-language question about operational readiness and produce a structured JSON plan.

Today's date in Eastern Time will be provided. Use it to resolve relative date references like "tomorrow", "today", "this week".

Rules:
- dateScope.startDate and endDate must be YYYY-MM-DD strings
- "tomorrow" → next calendar day from today
- "today" → today's date
- "this week" → startDate = today, endDate = today + 6 days
- timeOfDay: "morning" = before 12:00, "afternoon" = 12:00–17:00, "evening" = after 17:00
- If the user asks about a specific time like "9 AM jobs", set startTime and endTime to a 1-hour window: "09:00" to "10:00"
- dimension: use "assignment" for unassigned/cleaner questions, "confirmation" for confirmed/unconfirmed, "payment" for card/payment questions, "access" for instructions/notes, "schedule" for double-booking/conflicts, "all" for general readiness
- onlyNeedsAttention: true when user asks about problems, issues, risks, or "what needs attention"
- minimumFlagCount: set to 2 when user asks about jobs "at risk" (multiple issues)
- sort: "risk" when asking about problems/issues, "service_time" otherwise
- If you cannot determine a specific filter, omit it (do not guess)

Return ONLY valid JSON matching the schema. No explanation.`;

export async function createReadinessPlan(
  message: string
): Promise<ReadinessPlan> {
  const todayET = getTodayET();
  // Compute tomorrow
  const d = new Date(todayET + "T12:00:00");
  d.setDate(d.getDate() + 1);
  const tomorrowET = d.toISOString().slice(0, 10);

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
          schema: {
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
                type: "object",
                properties: {
                  timeOfDay: {
                    anyOf: [{ type: "string", enum: ["morning", "afternoon", "evening"] }, { type: "null" }],
                  },
                  startTime: { anyOf: [{ type: "string" }, { type: "null" }] },
                  endTime: { anyOf: [{ type: "string" }, { type: "null" }] },
                  dimension: {
                    anyOf: [
                      { type: "string", enum: ["all", "assignment", "confirmation", "payment", "access", "schedule"] },
                      { type: "null" },
                    ],
                  },
                  onlyNeedsAttention: { anyOf: [{ type: "boolean" }, { type: "null" }] },
                  minimumFlagCount: { anyOf: [{ type: "number" }, { type: "null" }] },
                },
                required: ["timeOfDay", "startTime", "endTime", "dimension", "onlyNeedsAttention", "minimumFlagCount"],
                additionalProperties: false,
              },
              sort: { anyOf: [{ type: "string", enum: ["service_time", "risk"] }, { type: "null" }] },
            },
            required: ["dateScope", "filters", "sort"],
            additionalProperties: false,
          },
        },
      },
    });

    raw = response.choices?.[0]?.message?.content ?? "";
  } catch (err) {
    throw new MadisonError(
      "PLAN_FAILED",
      `LLM call failed: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new MadisonError("PLAN_FAILED", `LLM returned non-JSON: ${raw}`);
  }

  const result = ReadinessPlanSchema.safeParse(parsed);
  if (!result.success) {
    throw new MadisonError(
      "PLAN_INVALID",
      `Plan failed validation: ${result.error.message}`
    );
  }

  return result.data;
}
