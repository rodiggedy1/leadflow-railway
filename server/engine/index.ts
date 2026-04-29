/**
 * Maids in Black — Two-Step Conversation Engine
 *
 * Architecture:
 * ┌─────────────────────────────────────────────────────────────────────┐
 * │  processLeadReplyV2(leadReply, context)                             │
 * │                                                                     │
 * │  Step 1 — EXTRACT (LLM)                                            │
 * │    Read the lead's message → return LeadSignals (structured JSON)  │
 * │    No decisions. No replies. Just extraction.                       │
 * │                                                                     │
 * │  Step 2 — ADVANCE (deterministic code)                             │
 * │    Given stage + LeadSignals → compute nextStage + persistedData   │
 * │    No LLM. Pure logic. Cannot loop. Cannot re-ask for known data.  │
 * │                                                                     │
 * │  Step 3 — REPLY (LLM)                                              │
 * │    Given nextStage + context → write the SMS reply                 │
 * │    Cannot change the stage. Only writes the message.               │
 * └─────────────────────────────────────────────────────────────────────┘
 *
 * This architecture eliminates the entire class of "re-asking for known data"
 * bugs. The LLM never decides whether to advance — code does. The LLM only
 * reads natural language and writes natural language.
 */

import { invokeLLM } from "../_core/llm";
import type { ConversationContext, StageResult } from "../conversationEngine";
import { buildJadePriceReveal } from "../aiService";
import { buildJadeLockIn, processLeadReply as processLeadReplyV1 } from "../conversationEngine";
import { getTemplate } from "../messageTemplateRouter";
import type { LeadSignals } from "./extractSchema";
import { LEAD_SIGNALS_JSON_SCHEMA, buildExtractionPrompt } from "./extractSchema";
import { advanceStage } from "./advanceStage";
import { buildReplyPrompt } from "./replyPrompt";

// Flow C stages — handled by conversationEngine.ts (processLeadReplyV1) not the LLM engine
const FLOW_C_STAGES = new Set(["WIDGET_SIZING", "FLOWC_ADDON", "FLOWC_DATE", "FLOWC_QUOTE_SENT"]);

// ─── Fallback replies (if LLM fails entirely) ─────────────────────────────────
const FALLBACK_REPLIES: Partial<Record<string, string>> = {
  WIDGET_SIZING:      "Thanks! To get you a price, how many bedrooms and bathrooms does your home have?",
  QUOTE_SENT:         "We'd love to get your home sparkling! When would work for you this week?",
  AVAILABILITY:       "We have openings this week — would any day work for you?",
  SLOT_CHOICE:        "Which slot works best for you?",
  TIME_PREF:          "Would morning or afternoon work better for you?",
  ADDRESS:            "Great! What's the address for the cleaning?",
  CONFIRMATION:       "Perfect! Would you like us to call you now or in a few minutes to confirm?",
  CALL_SCHEDULED:     "We'll be in touch shortly. Looking forward to getting your home cleaned!",
  REACTIVATION:       "We'd love to have you back! Would you like to schedule a cleaning?",
  REACTIVATION_TIME:  "Great! Can you give me a time window that works best for you?",
  FUTURE_BOOKING:     "Sounds good! Just reach out when you're ready and we'll take care of everything.",
  DONE:               "Thanks for reaching out to Maids in Black! Have a great day. 😊",
};

// ─── Main Entry Point ─────────────────────────────────────────────────────────

export async function processLeadReplyV2(
  leadReply: string,
  context: ConversationContext
): Promise<StageResult> {
  // ── Flow C bypass ──────────────────────────────────────────────────────────
  if (context.smsFlow === "C" && FLOW_C_STAGES.has(context.stage)) {
    console.log(`[Engine] Flow C bypass: delegating stage=${context.stage} to conversationEngine`);
    return processLeadReplyV1(leadReply, context);
  }

  const todayET = new Date().toLocaleDateString("en-US", {
    timeZone: "America/New_York",
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  // ── Step 1: EXTRACT ────────────────────────────────────────────────────────
  let signals: LeadSignals | null = null;

  try {
    const extractResponse = await invokeLLM({
      messages: [
        { role: "system", content: buildExtractionPrompt(todayET) },
        { role: "user",   content: leadReply },
      ],
      response_format: {
        type: "json_schema",
        json_schema: LEAD_SIGNALS_JSON_SCHEMA,
      },
    });

    const content = extractResponse?.choices?.[0]?.message?.content;
    if (content && typeof content === "string") {
      signals = JSON.parse(content) as LeadSignals;
    }
  } catch (err) {
    console.error("[Engine] Step 1 (extract) failed:", err);
  }

  // ── Fallback if extraction failed ──────────────────────────────────────────
  if (!signals) {
    const fallbackReply = FALLBACK_REPLIES[context.stage] ?? "Thanks for your message! Let me help you. 🏠";
    return { reply: fallbackReply, nextStage: context.stage };
  }

  console.log(`[Engine] Step 1 signals: timeSlot=${signals.timeSlot}, dayPref=${signals.dayPreference}, isFlexible=${signals.isFlexible}, questions=${signals.questions.length}`);

  // ── Step 2: ADVANCE (deterministic) ───────────────────────────────────────
  const advance = advanceStage(context.stage, signals, context);

  console.log(`[Engine] Step 2 advance: ${context.stage} → ${advance.nextStage} | usedDefault=${advance.replyContext.usedDefault}`);

  // ── REACTIVATION_TIME override (scripted closing message from DB) ──────────
  if (context.stage === "REACTIVATION_TIME") {
    const firstName = context.leadName?.split(" ")[0] ?? context.leadName ?? "there";
    const finalReply = await getTemplate("reactivation_closing", { "[Name]": firstName });
    return { reply: finalReply, nextStage: "DONE" };
  }

  // ── Step 3: REPLY (LLM writes the message) ────────────────────────────────
  let reply = FALLBACK_REPLIES[advance.nextStage] ?? FALLBACK_REPLIES[context.stage] ?? "Thanks for your message!";

  try {
    const replySystemPrompt = buildReplyPrompt(context, signals, advance, todayET);
    const replyResponse = await invokeLLM({
      messages: [
        { role: "system", content: replySystemPrompt },
        { role: "user",   content: `Lead's message: "${leadReply}"\n\nWrite the SMS reply now.` },
      ],
    });

    const content = replyResponse?.choices?.[0]?.message?.content;
    if (content && typeof content === "string" && content.trim().length > 0) {
      reply = content.trim();
    }
  } catch (err) {
    console.error("[Engine] Step 3 (reply) failed:", err);
  }

  // ── DB template overrides for Flow B scripted messages ────────────────────
  let finalReply = reply;

  if (context.smsFlow === "B" || !context.smsFlow) {
    const { persistedData } = advance;

    // Price reveal: advancing to SLOT_CHOICE from QUOTE_SENT or AVAILABILITY
    if (advance.nextStage === "SLOT_CHOICE" &&
        (context.stage === "QUOTE_SENT" || context.stage === "AVAILABILITY")) {
      const slot      = persistedData.selectedSlot ?? context.selectedSlot ?? "this week";
      const bedrooms  = persistedData.bedrooms     ?? context.bedrooms     ?? "?";
      const bathrooms = persistedData.bathrooms    ?? context.bathrooms    ?? "?";
      const price     = persistedData.quotedPrice  ?? context.quotedPrice  ?? "?";
      const firstName = context.leadName?.split(" ")[0] ?? context.leadName ?? "there";
      try {
        finalReply = await buildJadePriceReveal({ firstName, bedrooms, bathrooms, price, day: slot, extras: context.extras });
        console.log("[Engine] Overrode price reveal with DB template.");
      } catch (err) {
        console.error("[Engine] buildJadePriceReveal failed, using LLM reply:", err);
      }
    }

    // Lock-in confirmation: advancing to CONFIRMATION from ADDRESS
    if (advance.nextStage === "CONFIRMATION" && context.stage === "ADDRESS") {
      const slot    = persistedData.selectedSlot ?? context.selectedSlot ?? "your slot";
      const address = persistedData.address      ?? context.address      ?? "your location";
      try {
        finalReply = await buildJadeLockIn(slot, address);
        console.log("[Engine] Overrode lock-in with DB template.");
      } catch (err) {
        console.error("[Engine] buildJadeLockIn failed, using LLM reply:", err);
      }
    }
  }

  // ── Build StageResult ─────────────────────────────────────────────────────
  const { persistedData } = advance;
  return {
    reply: finalReply,
    nextStage: advance.nextStage,
    extractedData: {
      selectedSlot:   persistedData.selectedSlot   ?? undefined,
      address:        persistedData.address        ?? undefined,
      callPreference: persistedData.callPreference ?? undefined,
    },
    _engineData: {
      bedrooms:    persistedData.bedrooms    ?? undefined,
      bathrooms:   persistedData.bathrooms   ?? undefined,
      quotedPrice: persistedData.quotedPrice ?? undefined,
      serviceType: persistedData.serviceType ?? undefined,
    },
  } as StageResult & { _engineData: Record<string, string | undefined> };
}
