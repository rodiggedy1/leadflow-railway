/**
 * server/madison/comms/planner.ts
 * LLM call that extracts a structured CommsPlan from a natural-language SMS command.
 */
import { invokeLLM } from "../../_core/llm";
import { getTodayET, offsetServiceDate } from "../../conciergeTime";
import { CommsPlanSchema, COMMS_PLAN_JSON_SCHEMA, type CommsPlan } from "./schema/commsPlanSchema";

export async function createCommsPlan(message: string): Promise<CommsPlan> {
  const today = getTodayET();
  const tomorrow = offsetServiceDate(today, 1);

  const result = await invokeLLM({
    messages: [
      {
        role: "system",
        content: `You are a dispatcher assistant. Extract the SMS intent from the message.

Today is ${today}. Tomorrow is ${tomorrow}.

Rules:
- targetRef: who to text. Use the exact name if given ("Maria", "Team 3"). For groups use "today's cleaners", "tomorrow's cleaners", "everyone". For job-scoped use "job 4050013".
- messageHint: what to say. Extract verbatim if given. If the user says "text Maria about her job" with no message body, set messageHint to null.
- dateScope: "today" or "tomorrow" for group targets. Default "today".
- specificDate: null unless a specific date is mentioned.`,
      },
      { role: "user", content: message },
    ],
    response_format: { type: "json_schema", json_schema: COMMS_PLAN_JSON_SCHEMA },
  });

  const raw = JSON.parse(result.choices[0].message.content as string);
  return CommsPlanSchema.parse(raw);
}
