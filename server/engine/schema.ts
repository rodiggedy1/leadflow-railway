/**
 * LLM Decision Schema
 *
 * The structured output the LLM returns for every inbound SMS.
 * The engine validates this against business rules before acting on it.
 */

import type { ConversationStage } from "../../drizzle/schema";

export interface LLMDecision {
  /** The SMS reply to send to the lead. Already in the lead's language. */
  reply: string;
  /** The stage to transition to after this reply. */
  nextStage: ConversationStage;
  /** Data extracted from the lead's message. */
  extractedData: {
    bedrooms?: string | null;
    bathrooms?: string | null;
    selectedSlot?: string | null;
    address?: string | null;
    callPreference?: string | null;
    quotedPrice?: string | null;
    serviceType?: string | null;
  };
  /** Internal reasoning (not sent to lead, used for debugging). */
  reasoning: string;
}

/**
 * JSON Schema for the LLM structured output.
 * Passed to invokeLLM as response_format.json_schema.
 */
export const LLM_DECISION_JSON_SCHEMA = {
  name: "conversation_decision",
  strict: true,
  schema: {
    type: "object",
    properties: {
      reply: {
        type: "string",
        description: "The SMS message to send to the lead. Must be concise (1-3 sentences). Already in the lead's language.",
      },
      nextStage: {
        type: "string",
        enum: [
          "WIDGET_SIZING",
          "REACTIVATION",
          "QUOTE_SENT",
          "AVAILABILITY",
          "SLOT_CHOICE",
          "TIME_PREF",
          "ADDRESS",
          "CONFIRMATION",
          "CALL_SCHEDULED",
          "DONE",
          "UNHANDLED",
          "BOOKED",
          "FUTURE_BOOKING",
          "LANGUAGE_CONFIRM",
        ],
        description: "The conversation stage to transition to after this reply.",
      },
      extractedData: {
        type: "object",
        properties: {
          bedrooms:        { type: ["string", "null"], description: "Number of bedrooms if mentioned (e.g. '2 Bedrooms')" },
          bathrooms:       { type: ["string", "null"], description: "Number of bathrooms if mentioned (e.g. '2 Bathrooms')" },
          selectedSlot:    { type: ["string", "null"], description: "The slot the lead selected (e.g. 'Wednesday, March 19')" },
          address:         { type: ["string", "null"], description: "Street address if provided" },
          callPreference:  { type: ["string", "null"], description: "'now' or 'few_minutes' if lead specified call timing" },
          quotedPrice:     { type: ["string", "null"], description: "The price quoted (numeric string, e.g. '239')" },
          serviceType:     { type: ["string", "null"], description: "Service type if mentioned or changed" },
        },
        required: ["bedrooms", "bathrooms", "selectedSlot", "address", "callPreference", "quotedPrice", "serviceType"],
        additionalProperties: false,
      },
      reasoning: {
        type: "string",
        description: "Brief internal reasoning for this decision (1-2 sentences). Not sent to the lead.",
      },
    },
    required: ["reply", "nextStage", "extractedData", "reasoning"],
    additionalProperties: false,
  },
} as const;
