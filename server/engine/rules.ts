/**
 * Business Rule Enforcer
 *
 * Validates the LLM's decision against hard business rules.
 * The LLM is smart but the rules are absolute.
 *
 * Rules:
 * 1. A stage cannot advance unless its required data is present.
 * 2. The reply must not be empty.
 * 3. The nextStage must be a valid transition from the current stage.
 * 4. Address must be substantive (≥10 chars) to count as captured.
 */

import type { ConversationStage } from "../../drizzle/schema";
import type { LLMDecision } from "./schema";
import type { ConversationContext } from "../conversationEngine";
import { getStageContract } from "./stages";

export interface RuleViolation {
  rule: string;
  override: Partial<LLMDecision>;
}

/**
 * Validates a LLMDecision against business rules.
 * Returns the (possibly corrected) decision and any violations found.
 */
export function enforceRules(
  decision: LLMDecision,
  context: ConversationContext
): { decision: LLMDecision; violations: RuleViolation[] } {
  const violations: RuleViolation[] = [];
  let corrected = { ...decision, extractedData: { ...decision.extractedData } };

  const contract = getStageContract(context.stage);

  // ── Rule 1: Reply must not be empty ──────────────────────────────────────────
  if (!corrected.reply || corrected.reply.trim().length === 0) {
    violations.push({
      rule: "reply_empty",
      override: { reply: "Thanks for your message! Let me help you get your home cleaned. 🏠" },
    });
    corrected.reply = "Thanks for your message! Let me help you get your home cleaned. 🏠";
  }

  // ── Rule 2: Merge extracted data with existing context ───────────────────────
  // LLM only returns what it extracted from THIS message; merge with prior context
  corrected.extractedData = {
    bedrooms:       corrected.extractedData.bedrooms       ?? context.bedrooms       ?? null,
    bathrooms:      corrected.extractedData.bathrooms      ?? context.bathrooms      ?? null,
    selectedSlot:   corrected.extractedData.selectedSlot   ?? context.selectedSlot   ?? null,
    address:        corrected.extractedData.address        ?? context.address        ?? null,
    callPreference: corrected.extractedData.callPreference ?? null,
    quotedPrice:    corrected.extractedData.quotedPrice    ?? context.quotedPrice    ?? null,
    serviceType:    corrected.extractedData.serviceType    ?? context.serviceType    ?? null,
  };

  // ── Rule 3: Address must be substantive ──────────────────────────────────────
  const addr = corrected.extractedData.address;
  if (addr && addr.trim().length < 10) {
    // Too short to be a real address — treat as not captured
    corrected.extractedData.address = null;
  }

  // ── Rule 4: Cannot advance stage without required data ───────────────────────
  // Skip this check for always-allowed escape hatches (DONE, UNHANDLED, LANGUAGE_CONFIRM)
  const alwaysAllowedEarly: ConversationStage[] = ["RESOLVED", "UNHANDLED", "LANGUAGE_CONFIRM"];
  const isAdvancing = corrected.nextStage !== context.stage && !alwaysAllowedEarly.includes(corrected.nextStage);
  if (isAdvancing) {
    for (const field of contract.requiredToAdvance) {
      const value = corrected.extractedData[field];
      if (!value || (typeof value === "string" && value.trim().length === 0)) {
        violations.push({
          rule: `missing_required_field:${field}`,
          override: { nextStage: contract.stayStage },
        });
        corrected.nextStage = contract.stayStage;
        break; // One violation is enough to block advancement
      }
    }
  }

  // ── Rule 5: nextStage must be a valid transition ─────────────────────────────
  // (Allow DONE and UNHANDLED from any stage as escape hatches)
  const alwaysAllowed: ConversationStage[] = ["RESOLVED", "UNHANDLED", "LANGUAGE_CONFIRM"];
  const isValidTransition =
    alwaysAllowed.includes(corrected.nextStage) ||
    contract.validNextStages.includes(corrected.nextStage);

  if (!isValidTransition) {
    violations.push({
      rule: `invalid_transition:${context.stage}→${corrected.nextStage}`,
      override: { nextStage: contract.stayStage },
    });
    corrected.nextStage = contract.stayStage;
  }

  return { decision: corrected, violations };
}
