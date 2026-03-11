/**
 * AI Conversation Engine — Maids in Black SMS Flow
 *
 * Architecture:
 * - The STATE MACHINE always controls stage transitions. ChatGPT never decides what stage to go to.
 * - ChatGPT handles two things only:
 *     1. Intent parsing (what did the lead mean?)
 *     2. Off-script replies & objections (handled by aiService.ts)
 *
 * Stages:
 *   QUOTE_SENT     → Quote + price sent. Any reply triggers availability message.
 *   AVAILABILITY   → "Thu afternoon or Sat morning?" sent. Waiting for yes/no.
 *   SLOT_CHOICE    → "Thu 1PM or Sat 9AM?" sent. Waiting for slot pick.
 *   ADDRESS        → Slot confirmed. Waiting for address.
 *   CONFIRMATION   → Address captured. Confirmation + call question sent.
 *   CALL_SCHEDULED → Lead chose call now or in a few minutes.
 *   DONE           → Conversation complete.
 *   UNHANDLED      → Needs human review.
 */

import { invokeLLM } from "./_core/llm";
import type { ConversationStage } from "../drizzle/schema";
import {
  handleOffScriptReply,
  handleObjection,
  detectObjection,
} from "./aiService";
import { notifyAgentOfLead } from "./agentNotification";

export interface ConversationContext {
  stage: ConversationStage;
  leadName: string;
  leadPhone: string;
  quotedPrice: string;
  serviceType: string;
  bedrooms: string;
  bathrooms: string;
  selectedSlot?: string | null;
  address?: string | null;
  messageHistory: ChatMessage[];
}

export interface ChatMessage {
  role: "assistant" | "user";
  content: string;
}

export interface StageResult {
  reply: string;
  nextStage: ConversationStage;
  extractedData?: {
    selectedSlot?: string;
    address?: string;
    callPreference?: string;
  };
}

// ─── Static message templates ─────────────────────────────────────────────────
// These are used as fallbacks and for the initial burst messages.
// The AI service generates personalized versions when possible.

export function buildQuoteMessage(ctx: Pick<ConversationContext, "leadName" | "quotedPrice" | "bedrooms" | "bathrooms" | "serviceType">): string {
  const firstName = ctx.leadName.split(" ")[0] ?? ctx.leadName;
  return `Hi ${firstName}! Thanks for requesting a quote with Maids in Black. Based on your ${ctx.bedrooms} / ${ctx.bathrooms} home, here's your estimate: $${ctx.quotedPrice}.`;
}

export function buildPricingFollowUp(ctx: Pick<ConversationContext, "serviceType" | "quotedPrice">): string {
  return `Homes that size are typically $${ctx.quotedPrice} for the first ${ctx.serviceType.toLowerCase()}.`;
}

export function buildAvailabilityMessage(): string {
  return `We currently have openings Thursday afternoon or Saturday morning. Would one of those work for you?`;
}

export function buildSlotChoiceMessage(): string {
  return `Great — I can reserve:\n• Thursday 1PM\n• Saturday 9AM\n\nWhich would you prefer?`;
}

export function buildAddressRequestMessage(slot: string): string {
  return `Perfect 👍\n\nWhat's the address for the cleaning?`;
}

export function buildConfirmationMessage(slot: string, address: string): string {
  const [day, time] = slot.includes("Thursday") ? ["Thursday", "1:00 PM"] : ["Saturday", "9:00 AM"];
  return `Perfect — I've reserved ${day} at ${time} for you at ${address}.\n\nWe just do a quick 60-second confirmation call to finalize the booking and make sure we have everything correct.\n\nShould we call you now or in a few minutes?`;
}

export function buildCallScheduledMessage(preference: string): string {
  if (preference === "now") {
    return `Perfect! Expect a call from us shortly. We look forward to serving you! 🏠✨`;
  }
  return `No problem! We'll give you a call in a few minutes. Talk soon! 🏠✨`;
}

// ─── AI Intent Parser ─────────────────────────────────────────────────────────

/**
 * Uses ChatGPT to parse the lead's reply and extract intent + data.
 * Returns structured JSON so we can advance the state machine.
 */
async function parseLeadReply(
  stage: ConversationStage,
  leadReply: string,
  context: ConversationContext
): Promise<{
  intent: string;
  extractedSlot?: string;
  extractedAddress?: string;
  extractedCallPreference?: string;
  confidence: "high" | "low";
}> {
  const systemPrompt = `You are an AI assistant helping parse SMS replies from leads for a home cleaning service called "Maids in Black".

Current conversation stage: ${stage}
Lead's name: ${context.leadName}

Your job is to extract intent and data from the lead's SMS reply. Respond ONLY with valid JSON.

Stage-specific instructions:
- QUOTE_SENT: Any reply (even "ok", "thanks", "?") means they're engaged. Intent = "engaged"
- AVAILABILITY: Parse if they said yes/interested or no/not interested. Intent = "yes" or "no"
  - "yes", "sure", "sounds good", "ok", "yeah", "works" → "yes"
  - "no", "not interested", "never mind", "cancel" → "no"
  - Anything else (questions, objections) → "yes" (keep them in the funnel)
- SLOT_CHOICE: Extract which slot they chose. Intent = "thursday", "saturday", "custom_date", or "unclear"
  - "thursday", "thu", "1pm", "1", "first", "option 1" → "thursday"
  - "saturday", "sat", "9am", "9", "second", "option 2" → "saturday"
  - ANY other date/time request ("monday", "next tuesday", "friday at 2pm", "next week", etc.) → "custom_date", and put the requested date/time in extractedSlot
  - If they request a custom date, ALWAYS treat it as a valid booking request — we accommodate all schedules
- ADDRESS: Extract the full address they provided. Intent = "address_provided" or "unclear"
- CONFIRMATION: Parse if they want the call now or in a few minutes. Intent = "now" or "few_minutes" or "unclear"
  - "now", "yes", "call me", "ready", "go ahead" → "now"
  - "few minutes", "few", "later", "minute", "wait", "give me" → "few_minutes"

Respond with this exact JSON structure:
{
  "intent": "<intent>",
  "extractedSlot": "<slot if applicable, else null>",
  "extractedAddress": "<full address if provided, else null>",
  "extractedCallPreference": "<'now' or 'few_minutes' if applicable, else null>",
  "confidence": "<'high' or 'low'>"
}`;

  try {
    const response = await invokeLLM({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `Lead's reply: "${leadReply}"` },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "parse_lead_reply",
          strict: true,
          schema: {
            type: "object",
            properties: {
              intent: { type: "string" },
              extractedSlot: { type: ["string", "null"] },
              extractedAddress: { type: ["string", "null"] },
              extractedCallPreference: { type: ["string", "null"] },
              confidence: { type: "string", enum: ["high", "low"] },
            },
            required: ["intent", "extractedSlot", "extractedAddress", "extractedCallPreference", "confidence"],
            additionalProperties: false,
          },
        },
      },
    });

    const rawContent = response.choices?.[0]?.message?.content;
    if (!rawContent) throw new Error("Empty LLM response");
    const content = typeof rawContent === "string" ? rawContent : JSON.stringify(rawContent);
    return JSON.parse(content);
  } catch (err) {
    console.error("[ConversationEngine] LLM parse error:", err);
    return {
      intent: stage === "QUOTE_SENT" ? "engaged" : "unclear",
      extractedSlot: undefined,
      extractedAddress: undefined,
      extractedCallPreference: undefined,
      confidence: "low" as const,
    };
  }
}

// ─── Main Stage Processor ─────────────────────────────────────────────────────

/**
 * Processes an inbound SMS reply from a lead and returns the next reply + stage.
 *
 * For each stage, we:
 * 1. Check for objections first (price pushback, not available, etc.)
 * 2. Parse the intent with ChatGPT
 * 3. Advance the state machine based on intent
 * 4. If the reply is off-script/unclear, use the AI off-script handler
 */
export async function processLeadReply(
  leadReply: string,
  context: ConversationContext
): Promise<StageResult> {
  const { stage } = context;

  // ── Terminal stages — no further processing ────────────────────────────────
  if (stage === "DONE" || stage === "CALL_SCHEDULED") {
    return {
      reply: `Thanks again! We look forward to serving you. 🏠✨`,
      nextStage: "DONE",
    };
  }

  // ── QUOTE_SENT: Any reply → send availability (no objection check needed) ──
  if (stage === "QUOTE_SENT") {
    return {
      reply: buildAvailabilityMessage(),
      nextStage: "AVAILABILITY",
    };
  }

  // ── For all other stages: check for objections first ──────────────────────
  // Only check objections in stages where the lead might push back
  if (["AVAILABILITY", "SLOT_CHOICE", "ADDRESS", "CONFIRMATION"].includes(stage)) {
    const objectionType = await detectObjection(leadReply);

    if (objectionType) {
      console.log(`[ConversationEngine] Objection detected: ${objectionType} at stage ${stage}`);
      const objectionResult = await handleObjection(objectionType, {
        leadName: context.leadName,
        quotedPrice: context.quotedPrice,
        serviceType: context.serviceType,
      });

      // For "not_available" objection at AVAILABILITY stage, we can advance
      // to a flexible scheduling response but stay in AVAILABILITY
      return {
        reply: objectionResult.reply,
        nextStage: objectionResult.nextStage ?? (stage as ConversationStage),
      };
    }
  }

  // ── Parse intent and advance state machine ─────────────────────────────────
  switch (stage) {
    // ── Stage 2: Availability ─────────────────────────────────────────────────
    case "AVAILABILITY": {
      const parsed = await parseLeadReply(stage, leadReply, context);

      if (parsed.intent === "no") {
        return {
          reply: `No problem! Feel free to reach out whenever you're ready. We'd love to help you get your home sparkling clean. 🏠`,
          nextStage: "DONE",
        };
      }

      // Positive or unclear → show slot choice
      return {
        reply: buildSlotChoiceMessage(),
        nextStage: "SLOT_CHOICE",
      };
    }

    // ── Stage 3: Slot choice ──────────────────────────────────────────────────
    case "SLOT_CHOICE": {
      const parsed = await parseLeadReply(stage, leadReply, context);

      if (parsed.intent === "thursday" || parsed.extractedSlot?.toLowerCase().includes("thursday")) {
        const slot = "Thursday 1PM";
        return {
          reply: buildAddressRequestMessage(slot),
          nextStage: "ADDRESS",
          extractedData: { selectedSlot: slot },
        };
      }

      if (parsed.intent === "saturday" || parsed.extractedSlot?.toLowerCase().includes("saturday")) {
        const slot = "Saturday 9AM";
        return {
          reply: buildAddressRequestMessage(slot),
          nextStage: "ADDRESS",
          extractedData: { selectedSlot: slot },
        };
      }

      // Custom date/time request — accept it enthusiastically and advance
      if (parsed.intent === "custom_date" || parsed.extractedSlot) {
        const requestedSlot = parsed.extractedSlot ?? leadReply.trim();
        const firstName = context.leadName.split(" ")[0] ?? context.leadName;
        const reply = `${requestedSlot} works perfectly! 👍\n\nWhat's the address for the cleaning?`;
        return {
          reply,
          nextStage: "ADDRESS",
          extractedData: { selectedSlot: requestedSlot },
        };
      }

      // Truly unclear — use AI off-script handler to respond naturally
      const offScript = await handleOffScriptReply({
        stage,
        leadName: context.leadName,
        quotedPrice: context.quotedPrice,
        serviceType: context.serviceType,
        selectedSlot: context.selectedSlot,
        messageHistory: context.messageHistory,
        leadReply,
      });

      return {
        reply: offScript.reply,
        nextStage: "SLOT_CHOICE",
      };
    }

    // ── Stage 4: Address ──────────────────────────────────────────────────────
    case "ADDRESS": {
      const parsed = await parseLeadReply(stage, leadReply, context);
      const address = parsed.extractedAddress ?? leadReply.trim();
      const slot = context.selectedSlot ?? "Saturday 9AM";

      if (!address || address.length < 5) {
        // Use AI to ask for address more naturally
        const offScript = await handleOffScriptReply({
          stage,
          leadName: context.leadName,
          quotedPrice: context.quotedPrice,
          serviceType: context.serviceType,
          selectedSlot: slot,
          messageHistory: context.messageHistory,
          leadReply,
        });

        return {
          reply: offScript.reply,
          nextStage: "ADDRESS",
        };
      }

      return {
        reply: buildConfirmationMessage(slot, address),
        nextStage: "CONFIRMATION",
        extractedData: { address },
      };
    }

    // ── Stage 5: Confirmation ─────────────────────────────────────────────────
    case "CONFIRMATION": {
      const parsed = await parseLeadReply(stage, leadReply, context);
      const pref = parsed.extractedCallPreference ?? parsed.intent;

      if (pref === "now" || pref === "few_minutes") {
        // Fire-and-forget: notify support agent via SMS + push notification
        notifyAgentOfLead({
          name: context.leadName,
          phone: context.leadPhone,
          serviceType: context.serviceType,
          bedrooms: context.bedrooms ?? "",
          bathrooms: context.bathrooms ?? "",
          price: context.quotedPrice,
          selectedSlot: context.selectedSlot ?? undefined,
          address: context.address ?? undefined,
        }).catch((err) =>
          console.error("[ConversationEngine] Agent notification failed:", err)
        );

        return {
          reply: buildCallScheduledMessage(pref),
          nextStage: "CALL_SCHEDULED",
          extractedData: { callPreference: pref },
        };
      }

      // Unclear — use AI to handle naturally
      const offScript = await handleOffScriptReply({
        stage,
        leadName: context.leadName,
        quotedPrice: context.quotedPrice,
        serviceType: context.serviceType,
        selectedSlot: context.selectedSlot,
        messageHistory: context.messageHistory,
        leadReply,
      });

      return {
        reply: offScript.reply,
        nextStage: "CONFIRMATION",
      };
    }

    // ── Unhandled / fallback ───────────────────────────────────────────────────
    default: {
      // Try the AI off-script handler as a last resort
      try {
        const offScript = await handleOffScriptReply({
          stage,
          leadName: context.leadName,
          quotedPrice: context.quotedPrice,
          serviceType: context.serviceType,
          selectedSlot: context.selectedSlot,
          messageHistory: context.messageHistory,
          leadReply,
        });

        return {
          reply: offScript.reply,
          nextStage: "UNHANDLED",
        };
      } catch {
        return {
          reply: `Thanks for your message! A member of our team will follow up with you shortly.`,
          nextStage: "UNHANDLED",
        };
      }
    }
  }
}
