/**
 * AI Conversation Engine — Maids in Black SMS Flow
 *
 * Stages:
 *   QUOTE_SENT     → Quote + price sent. Any reply triggers availability message.
 *   AVAILABILITY   → "Thu afternoon or Sat morning?" sent. Waiting for yes/no.
 *   SLOT_CHOICE    → "Thu 1PM or Sat 9AM?" sent. Waiting for slot pick.
 *   ADDRESS        → Slot confirmed. Waiting for address.
 *   CONFIRMATION   → Address captured. Confirmation + call question sent.
 *   CALL_SCHEDULED → Lead chose call now or in a few minutes.
 *   DONE           → Conversation complete.
 *   UNHANDLED      → AI couldn't parse reply; needs human review.
 */

import { invokeLLM } from "./_core/llm";
import type { ConversationStage } from "../drizzle/schema";

export interface ConversationContext {
  stage: ConversationStage;
  leadName: string;
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
- SLOT_CHOICE: Extract which slot they chose. Intent = "thursday" or "saturday" or "unclear"
  - "thursday", "thu", "1pm", "1", "first", "option 1" → "thursday"
  - "saturday", "sat", "9am", "9", "second", "option 2" → "saturday"
- ADDRESS: Extract the full address they provided. Intent = "address_provided" or "unclear"
- CONFIRMATION: Parse if they want the call now or in a few minutes. Intent = "now" or "few_minutes" or "unclear"
  - "now", "yes", "call me", "ready" → "now"
  - "few minutes", "few", "later", "minute", "wait" → "few_minutes"

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
    // Fallback: treat any reply as engaged if in early stages
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
 */
export async function processLeadReply(
  leadReply: string,
  context: ConversationContext
): Promise<StageResult> {
  const { stage } = context;

  switch (stage) {
    // ── Stage 1: Quote was sent, any reply → send availability ────────────────
    case "QUOTE_SENT": {
      return {
        reply: buildAvailabilityMessage(),
        nextStage: "AVAILABILITY",
      };
    }

    // ── Stage 2: Availability sent → parse yes/no, send slot choice ───────────
    case "AVAILABILITY": {
      const parsed = await parseLeadReply(stage, leadReply, context);

      if (parsed.intent === "no") {
        return {
          reply: `No problem! Feel free to reach out whenever you're ready. We'd love to help you get your home sparkling clean. 🏠`,
          nextStage: "DONE",
        };
      }

      // Any positive or unclear response → show slot choice
      return {
        reply: buildSlotChoiceMessage(),
        nextStage: "SLOT_CHOICE",
      };
    }

    // ── Stage 3: Slot choice sent → parse which slot, ask for address ─────────
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

      // Unclear — re-prompt
      return {
        reply: `Just to confirm — would you prefer:\n• Thursday 1PM\n• Saturday 9AM\n\nReply with Thursday or Saturday!`,
        nextStage: "SLOT_CHOICE",
      };
    }

    // ── Stage 4: Address requested → capture address, send confirmation ───────
    case "ADDRESS": {
      const parsed = await parseLeadReply(stage, leadReply, context);

      const address = parsed.extractedAddress ?? leadReply.trim();
      const slot = context.selectedSlot ?? "Saturday 9AM";

      if (!address || address.length < 5) {
        return {
          reply: `Could you share the full address for the cleaning? (e.g., 123 Main St, Washington DC 20001)`,
          nextStage: "ADDRESS",
        };
      }

      return {
        reply: buildConfirmationMessage(slot, address),
        nextStage: "CONFIRMATION",
        extractedData: { address },
      };
    }

    // ── Stage 5: Confirmation sent → parse call preference ────────────────────
    case "CONFIRMATION": {
      const parsed = await parseLeadReply(stage, leadReply, context);

      const pref = parsed.extractedCallPreference ?? parsed.intent;

      if (pref === "now" || pref === "few_minutes") {
        return {
          reply: buildCallScheduledMessage(pref),
          nextStage: "CALL_SCHEDULED",
          extractedData: { callPreference: pref },
        };
      }

      // Unclear — re-prompt
      return {
        reply: `Should we call you now or in a few minutes to confirm your booking?`,
        nextStage: "CONFIRMATION",
      };
    }

    // ── Stage 6: Call scheduled → done ────────────────────────────────────────
    case "CALL_SCHEDULED":
    case "DONE": {
      return {
        reply: `Thanks again! We look forward to seeing you. 🏠✨`,
        nextStage: "DONE",
      };
    }

    // ── Unhandled / fallback ───────────────────────────────────────────────────
    default: {
      return {
        reply: `Thanks for your message! A member of our team will follow up with you shortly.`,
        nextStage: "UNHANDLED",
      };
    }
  }
}
