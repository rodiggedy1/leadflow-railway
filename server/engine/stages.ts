/**
 * Stage Contracts
 *
 * Each stage defines:
 * - description: what the bot asked / what it's waiting for
 * - requiredFields: data that MUST be present before advancing
 * - validNextStages: stages the LLM is allowed to transition to
 * - stayStage: the stage to fall back to if required data is missing
 */

import type { ConversationStage } from "../../drizzle/schema";
import type { LLMDecision } from "./schema";

export interface StageContract {
  /** Human-readable description of what this stage is waiting for */
  description: string;
  /** Fields in extractedData that must be non-null to advance */
  requiredToAdvance: (keyof LLMDecision["extractedData"])[];
  /** Stages the LLM is allowed to move to */
  validNextStages: ConversationStage[];
  /** Stage to stay on if required data is missing */
  stayStage: ConversationStage;
}

export const STAGE_CONTRACTS: Partial<Record<ConversationStage, StageContract>> = {
  WIDGET_SIZING: {
    description: "Bot asked for number of bedrooms and bathrooms. Waiting for both.",
    requiredToAdvance: ["bedrooms", "bathrooms"],
    validNextStages: ["AVAILABILITY", "WIDGET_SIZING", "DONE"],
    stayStage: "WIDGET_SIZING",
  },
  QUOTE_SENT: {
    description: "Quote and price sent. Any reply triggers availability question.",
    requiredToAdvance: [],
    validNextStages: ["AVAILABILITY", "FUTURE_BOOKING", "DONE"],
    stayStage: "AVAILABILITY",
  },
  AVAILABILITY: {
    description: "Bot offered 2 available days. Waiting for the lead to pick one or express interest.",
    requiredToAdvance: ["selectedSlot"],
    validNextStages: ["SLOT_CHOICE", "ADDRESS", "FUTURE_BOOKING", "DONE", "AVAILABILITY"],
    stayStage: "AVAILABILITY",
  },
  SLOT_CHOICE: {
    description: "Bot offered specific slot options. Waiting for the lead to pick one.",
    requiredToAdvance: ["selectedSlot"],
    validNextStages: ["ADDRESS", "TIME_PREF", "SLOT_CHOICE", "DONE"],
    stayStage: "SLOT_CHOICE",
  },
  TIME_PREF: {
    description: "Bot asked for morning or afternoon preference. Waiting for time preference.",
    requiredToAdvance: ["selectedSlot"],
    validNextStages: ["ADDRESS", "TIME_PREF", "DONE"],
    stayStage: "TIME_PREF",
  },
  ADDRESS: {
    description: "Slot confirmed. Bot asked for the home address. Waiting for a street address.",
    requiredToAdvance: ["address"],
    validNextStages: ["CONFIRMATION", "ADDRESS", "DONE"],
    stayStage: "ADDRESS",
  },
  CONFIRMATION: {
    description: "Address captured. Bot asked if lead wants a call now or in a few minutes.",
    requiredToAdvance: ["callPreference"],
    validNextStages: ["CALL_SCHEDULED", "CONFIRMATION", "DONE"],
    stayStage: "CONFIRMATION",
  },
  REACTIVATION: {
    description: "Reactivation offer sent to a past customer. Waiting for yes/no.",
    requiredToAdvance: [],
    validNextStages: ["REACTIVATION_TIME", "AVAILABILITY", "FUTURE_BOOKING", "DONE", "REACTIVATION"],
    stayStage: "REACTIVATION",
  },
  REACTIVATION_TIME: {
    description: "Customer said yes to reactivation. Waiting for their preferred time window.",
    requiredToAdvance: [],
    validNextStages: ["DONE", "REACTIVATION_TIME"],
    stayStage: "REACTIVATION_TIME",
  },
  FUTURE_BOOKING: {
    description: "Lead expressed interest but not ready yet. Staying warm.",
    requiredToAdvance: [],
    validNextStages: ["AVAILABILITY", "FUTURE_BOOKING", "DONE"],
    stayStage: "FUTURE_BOOKING",
  },
  CALL_SCHEDULED: {
    description: "Call scheduled. Post-booking conversation.",
    requiredToAdvance: [],
    validNextStages: ["CALL_SCHEDULED", "DONE"],
    stayStage: "CALL_SCHEDULED",
  },
  DONE: {
    description: "Conversation complete. Post-booking or closed conversation.",
    requiredToAdvance: [],
    validNextStages: ["DONE"],
    stayStage: "DONE",
  },
};

/**
 * Returns the stage contract for a given stage, or a permissive default.
 */
export function getStageContract(stage: ConversationStage): StageContract {
  return STAGE_CONTRACTS[stage] ?? {
    description: "General conversation.",
    requiredToAdvance: [],
    validNextStages: ["DONE", "UNHANDLED"],
    stayStage: stage,
  };
}
