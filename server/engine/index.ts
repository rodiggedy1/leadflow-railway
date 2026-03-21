/**
 * Maids in Black — LLM-First Conversation Engine
 *
 * Architecture:
 * ┌─────────────────────────────────────────────────────┐
 * │  processLeadReply(leadReply, context)               │
 * │                                                     │
 * │  1. Build prompt: stage + context + knowledge base  │
 * │  2. Call LLM → get LLMDecision (structured JSON)    │
 * │  3. Enforce business rules on the decision          │
 * │  4. Return StageResult                              │
 * └─────────────────────────────────────────────────────┘
 *
 * The LLM handles natively (no special-case code needed):
 * - Any language (responds in lead's language automatically)
 * - FAQ answers (knowledge base is in the prompt)
 * - Recurring pricing questions (pricing table is in the prompt)
 * - Objections and hesitation
 * - Existing customer / support requests
 * - Ambiguous or partial replies
 *
 * The engine enforces:
 * - Stage cannot advance without required data
 * - Address must be substantive
 * - nextStage must be a valid transition
 * - Reply must not be empty
 */

import { invokeLLM } from "../_core/llm";
import type { ConversationContext, StageResult } from "../conversationEngine";
import type { LLMDecision } from "./schema";
import { LLM_DECISION_JSON_SCHEMA } from "./schema";
import { buildSystemPrompt, buildUserMessage } from "./prompt";
import { enforceRules } from "./rules";
import { buildJadePriceReveal } from "../aiService";
import { buildJadeLockIn } from "../conversationEngine";

// ─── Fallback replies (if LLM fails entirely) ─────────────────────────────────

const FALLBACK_REPLIES: Partial<Record<string, string>> = {
  WIDGET_SIZING:   "Thanks! To get you a price, how many bedrooms and bathrooms does your home have?",
  QUOTE_SENT:      "We'd love to get your home sparkling! When would work for you this week?",
  AVAILABILITY:    "We have openings this week — would any day work for you?",
  SLOT_CHOICE:     "Which slot works best for you?",
  TIME_PREF:       "Would morning or afternoon work better for you?",
  ADDRESS:         "Great! What's the address for the cleaning?",
  CONFIRMATION:    "Perfect! Would you like us to call you now or in a few minutes to confirm?",
  CALL_SCHEDULED:  "We'll be in touch shortly. Looking forward to getting your home cleaned!",
  REACTIVATION:    "We'd love to have you back! Would you like to schedule a cleaning?",
  FUTURE_BOOKING:  "Sounds good! Just reach out when you're ready and we'll take care of everything.",
  DONE:            "Thanks for reaching out to Maids in Black! Have a great day. 😊",
};

// ─── Main Entry Point ─────────────────────────────────────────────────────────

export async function processLeadReplyV2(
  leadReply: string,
  context: ConversationContext
): Promise<StageResult> {
  const systemPrompt = buildSystemPrompt(context);
  const userMessage = buildUserMessage(context, leadReply);

  let rawDecision: LLMDecision | null = null;

  try {
    const response = await invokeLLM({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user",   content: userMessage },
      ],
      response_format: {
        type: "json_schema",
        json_schema: LLM_DECISION_JSON_SCHEMA,
      },
    });

    const content = response?.choices?.[0]?.message?.content;
    if (content && typeof content === "string") {
      rawDecision = JSON.parse(content) as LLMDecision;
    }
  } catch (err) {
    console.error("[Engine] LLM call failed:", err);
  }

  // ── Fallback if LLM failed ────────────────────────────────────────────────
  if (!rawDecision) {
    const fallbackReply = FALLBACK_REPLIES[context.stage] ?? "Thanks for your message! Let me help you. 🏠";
    return {
      reply: fallbackReply,
      nextStage: context.stage,
    };
  }

  // ── Enforce business rules ────────────────────────────────────────────────
  const { decision, violations } = enforceRules(rawDecision, context);

  if (violations.length > 0) {
    console.warn("[Engine] Business rule violations:", violations.map(v => v.rule).join(", "));
  }

  console.log(`[Engine] Stage: ${context.stage} → ${decision.nextStage} | Reasoning: ${decision.reasoning}`);

  // ── Override reply with DB templates for Flow B scripted messages ─────────
  // The LLM decides the stage transition and extracts data; we use the DB
  // template for the actual SMS text so Settings edits are always respected.
  let finalReply = decision.reply;

  if (context.smsFlow === "B" || !context.smsFlow) {
    // Price reveal: LLM moved to SLOT_CHOICE → use buildJadePriceReveal
    if (decision.nextStage === "SLOT_CHOICE" &&
        (context.stage === "QUOTE_SENT" || context.stage === "AVAILABILITY")) {
      const slot = decision.extractedData.selectedSlot ?? "this week";
      const bedrooms  = decision.extractedData.bedrooms  ?? context.bedrooms  ?? "?";
      const bathrooms = decision.extractedData.bathrooms ?? context.bathrooms ?? "?";
      const price     = decision.extractedData.quotedPrice ?? context.quotedPrice ?? "?";
      const firstName = context.leadName?.split(" ")[0] ?? context.leadName ?? "there";
      try {
        finalReply = await buildJadePriceReveal({ firstName, bedrooms, bathrooms, price, day: slot, extras: context.extras });
        console.log("[Engine] Overrode price reveal with DB template.");
      } catch (err) {
        console.error("[Engine] buildJadePriceReveal failed, using LLM reply:", err);
      }
    }

    // Lock-in confirmation: LLM moved to CONFIRMATION → use buildJadeLockIn
    if (decision.nextStage === "CONFIRMATION" && context.stage === "ADDRESS") {
      const slot    = decision.extractedData.selectedSlot ?? context.selectedSlot ?? "your slot";
      const address = decision.extractedData.address      ?? context.address      ?? "your location";
      try {
        finalReply = await buildJadeLockIn(slot, address);
        console.log("[Engine] Overrode lock-in with DB template.");
      } catch (err) {
        console.error("[Engine] buildJadeLockIn failed, using LLM reply:", err);
      }
    }
  }

  // ── Build StageResult ─────────────────────────────────────────────────────
  return {
    reply: finalReply,
    nextStage: decision.nextStage,
    extractedData: {
      selectedSlot:   decision.extractedData.selectedSlot   ?? undefined,
      address:        decision.extractedData.address        ?? undefined,
      callPreference: decision.extractedData.callPreference ?? undefined,
    },
    // Pass through extracted pricing/sizing data for webhooks.ts to persist
    _engineData: {
      bedrooms:    decision.extractedData.bedrooms    ?? undefined,
      bathrooms:   decision.extractedData.bathrooms   ?? undefined,
      quotedPrice: decision.extractedData.quotedPrice ?? undefined,
      serviceType: decision.extractedData.serviceType ?? undefined,
    },
  } as StageResult & { _engineData: Record<string, string | undefined> };
}
