/**
 * server/madison/comms/schema/commsPlanSchema.ts
 * Zod schema and JSON schema for CommsPlan (used by planner LLM call).
 */
import { z } from "zod";

export const CommsPlanSchema = z.object({
  targetRef: z.string().describe("Who to text — name, group description, or job reference"),
  messageHint: z.string().nullable().describe("What to say — null if not specified"),
  dateScope: z.enum(["today", "tomorrow", "specific"]).default("today").describe("Date context for group targets"),
  specificDate: z.string().nullable().default(null).describe("YYYY-MM-DD if dateScope is specific"),
});

export type CommsPlan = z.infer<typeof CommsPlanSchema>;

/** JSON schema passed to the LLM response_format */
export const COMMS_PLAN_JSON_SCHEMA = {
  name: "comms_plan",
  strict: true,
  schema: {
    type: "object",
    properties: {
      targetRef: { type: "string", description: "Who to text — name, group description, or job reference" },
      messageHint: { type: ["string", "null"], description: "What to say — null if not specified" },
      dateScope: { type: "string", enum: ["today", "tomorrow", "specific"], description: "Date context for group targets" },
      specificDate: { type: ["string", "null"], description: "YYYY-MM-DD if dateScope is specific, otherwise null" },
    },
    required: ["targetRef", "messageHint", "dateScope", "specificDate"],
    additionalProperties: false,
  },
};
