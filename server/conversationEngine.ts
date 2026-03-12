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
import { getNextAvailableSlots, formatAvailabilityQuestion, formatSlotChoiceQuestion } from "./availability";

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
  /** The two slot labels that were offered in the AVAILABILITY/SLOT_CHOICE messages (e.g. ["Friday, March 13", "Saturday, March 14"]) */
  offeredSlots?: [string, string] | null;
  /** JSON-encoded array of extra keys selected on the quote form */
  extras?: string[] | null;
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

/**
 * Picks a short, friendly upsell phrase for one extra add-on.
 * Returns null if no extras are provided.
 */
export function buildExtrasUpsellLine(extras: string[] | null | undefined): string | null {
  if (!extras || extras.length === 0) return null;

  // Pick the first extra and build a natural mention
  const firstKey = extras[0]!;
  const label = firstKey.replace(/_/g, " ");

  // Map specific extras to friendly emoji + phrasing
  const phrases: Record<string, string> = {
    clean_inside_oven:         "We'll also take care of your oven cleaning while we're there 🍳",
    clean_inside_cabinets:     "We'll also clean inside your cabinets while we're there 🗄️",
    clean_inside_empty_fridge: "We'll also clean inside your fridge while we're there ❄️",
    clean_inside_full_fridge:  "We'll also clean inside your fridge while we're there ❄️",
    clean_interior_windows:    "We'll also clean your interior windows while we're there 🪟",
    clean_finished_basement:   "We'll also take care of your finished basement while we're there 🏠",
    green_cleaning:            "We'll be using eco-friendly green cleaning products as requested 🌿",
    move_in_move_out:          "We'll do a thorough move-in/move-out deep clean as requested 📦",
    two_hours_organizing:      "We'll also spend 2 hours organizing while we're there 🗂️",
    load_of_laundry:           "We'll also take care of a load of laundry while we're there 👕",
    i_have_pets:               "We'll use pet-safe products and give extra attention to pet areas 🐾",
    wipe_walls:                "We'll also wipe down your walls while we're there 🧹",
    sweep_garage:              "We'll also sweep out your garage while we're there 🚗",
    balcony_sweep:             "We'll also sweep your balcony while we're there 🌅",
    home_concierge:            "Your home concierge service is all set as requested 🏡",
    same_day_booking:          "We'll prioritize your same-day booking as requested ⚡",
    clean_inside_microwave:    "We'll also clean inside your microwave while we're there 📡",
    shed_pool_house:           "We'll also take care of your shed/pool house while we're there 🏊",
    wash_dishes:               "We'll also wash your dishes while we're there 🍽️",
    pool_deck:                 "We'll also clean your pool deck while we're there 🌊",
  };

  return phrases[firstKey] ?? `We'll also take care of your ${label} while we're there ✨`;
}

export function buildAvailabilityMessage(extras?: string[] | null): string {
  const slots = getNextAvailableSlots(2);
  const baseMsg = formatAvailabilityQuestion(slots);
  const upsell = buildExtrasUpsellLine(extras);
  return upsell ? `${baseMsg}\n\n${upsell}.` : baseMsg;
}

export function buildSlotChoiceMessage(): string {
  const slots = getNextAvailableSlots(2);
  return formatSlotChoiceQuestion(slots);
}

export function buildAddressRequestMessage(slot: string): string {
  return `Perfect 👍\n\nWhat's the address for the cleaning?`;
}

export function buildTimePrefMessage(slot: string): string {
  return `Great — ${slot} it is! 🗓️\n\nWould morning or afternoon work better for you?`;
}

export function buildAddressRequestAfterTimePref(slot: string, timePref: string): string {
  return `${timePref} works! What's the address for the cleaning?`;
}

export function buildConfirmationMessage(slot: string, address: string): string {
  // slot is now a full label like "Friday, March 13" — use it directly
  return `Perfect — I've reserved ${slot} for you at ${address}.\n\nWe just do a quick 60-second confirmation call to finalize the booking and make sure we have everything correct.\n\nShould we call you now or in a few minutes?`;
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
- AVAILABILITY: Parse if they said yes/interested or explicitly opted out. Intent = "yes", "specific_day", "no", or "unclear"
  - "yes", "sure", "sounds good", "ok", "yeah", "works", "that works", "perfect", "great" → "yes"
  - Any day name ("monday", "tuesday", "wednesday", "thursday", "friday", "saturday") → "specific_day", put the day name in extractedSlot
  - Any time mention ("morning", "afternoon", "9am", "next week") → "yes" (they're interested, just specifying)
  - ONLY hard explicit opt-out → "no": "not interested", "remove me", "stop", "unsubscribe", "don't contact me", "cancel"
  - "no" alone, "not now", "busy", "maybe later", "not sure" → "unclear" (NOT "no" — they haven't opted out)
  - Anything else, questions, objections → "unclear" (keep them in the funnel, re-engage)
- SLOT_CHOICE: The two available slots offered were: Slot 1 = "${context.offeredSlots?.[0] ?? "first option"}", Slot 2 = "${context.offeredSlots?.[1] ?? "second option"}". Extract which slot they chose. Intent = "slot1", "slot2", "custom_date", or "unclear"
  - If they mention the day name of slot 1, "first", "option 1", "1" → "slot1", put the full slot 1 label in extractedSlot
  - If they mention the day name of slot 2, "second", "option 2", "2" → "slot2", put the full slot 2 label in extractedSlot
  - ANY other date/time request ("monday", "next tuesday", "friday at 2pm", "next week", etc.) → "custom_date", and put the requested date/time in extractedSlot
  - If they request a custom date, ALWAYS treat it as a valid booking request — we accommodate all schedules
- TIME_PREF: The lead was asked if morning or afternoon works. Intent = "morning", "afternoon", or "unclear"
  - "morning", "am", "early", "9", "10", "11" → "morning"
  - "afternoon", "pm", "after noon", "12", "1", "2", "3", "4", "5" → "afternoon"
  - Either works, flexible, doesn't matter → "morning" (default to morning)
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

  // Build a human-readable extras string for AI context (e.g. "Clean Inside Oven, Load of Laundry")
  const extrasContext = context.extras && context.extras.length > 0
    ? context.extras.map(k => k.replace(/_/g, " ")).join(", ")
    : null;

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
      reply: buildAvailabilityMessage(context.extras),
      nextStage: "AVAILABILITY",
    };
  }

  // ── For all other stages: check for objections first ──────────────────────
  // Only check objections in stages where the lead might push back
  if (["AVAILABILITY", "SLOT_CHOICE", "TIME_PREF", "ADDRESS", "CONFIRMATION"].includes(stage)) {
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
    // ── Stage 2: Availability ──────────────────────────────────────────────────────
    case "AVAILABILITY": {
      const dynamicSlotsForAvail = getNextAvailableSlots(2);
      const slot1 = dynamicSlotsForAvail[0];
      const slot2 = dynamicSlotsForAvail[1];
      const replyLower = leadReply.toLowerCase();

      // Step 1: Pure string check — any day of the week mentioned goes to TIME_PREF
      // This runs BEFORE the LLM so day names are never misclassified as "no"
      const ALL_DAY_NAMES = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
      const mentionedDay = ALL_DAY_NAMES.find(d => replyLower.includes(d));

      if (mentionedDay) {
        // Try to match against one of the offered slots first
        if (slot1 && slot1.shortLabel.toLowerCase() === mentionedDay) {
          return {
            reply: buildTimePrefMessage(slot1.label),
            nextStage: "TIME_PREF",
            extractedData: { selectedSlot: slot1.label },
          };
        }
        if (slot2 && slot2.shortLabel.toLowerCase() === mentionedDay) {
          return {
            reply: buildTimePrefMessage(slot2.label),
            nextStage: "TIME_PREF",
            extractedData: { selectedSlot: slot2.label },
          };
        }
        // They mentioned a day not in the offered slots — treat as custom date request
        const capitalizedDay = mentionedDay.charAt(0).toUpperCase() + mentionedDay.slice(1);
        return {
          reply: buildTimePrefMessage(capitalizedDay),
          nextStage: "TIME_PREF",
          extractedData: { selectedSlot: capitalizedDay },
        };
      }

      // Step 2: Use LLM for intent — with strict instructions to only return "no" on hard opt-out
      const parsed = await parseLeadReply(stage, leadReply, context);

      // Step 3: Only send DONE on explicit hard opt-out ("not interested", "remove me", "stop")
      if (parsed.intent === "no" && parsed.confidence === "high") {
        return {
          reply: `No worries at all! If you ever need a cleaning in the future, we're here. Have a great day! 🏠`,
          nextStage: "DONE",
        };
      }

      // Step 4: On "specific_day" intent from LLM (backup — string check above should catch most)
      if (parsed.intent === "specific_day" && parsed.extractedSlot) {
        const dayLower = parsed.extractedSlot.toLowerCase();
        const matchedSlot = dynamicSlotsForAvail.find(s => s.shortLabel.toLowerCase() === dayLower);
        const slotLabel = matchedSlot?.label ?? parsed.extractedSlot;
        return {
          reply: buildTimePrefMessage(slotLabel),
          nextStage: "TIME_PREF",
          extractedData: { selectedSlot: slotLabel },
        };
      }

      // Step 5: Unclear, "not now", soft no, or questions → re-engage with slot options
      // NEVER give up — always try to move them toward booking
      if (parsed.intent === "unclear" || parsed.intent === "no") {
        const slots = getNextAvailableSlots(2);
        const slot1Label = slots[0]?.shortLabel ?? "Thursday";
        const slot2Label = slots[1]?.shortLabel ?? "Friday";
        return {
          reply: `No worries! We have openings ${slot1Label} or ${slot2Label} — would either of those work for you? We make it super easy to get your home sparkling. ✨`,
          nextStage: "AVAILABILITY",
        };
      }

      // Step 6: Positive reply — show slot choice
      return {
        reply: buildSlotChoiceMessage(),
        nextStage: "SLOT_CHOICE",
      };
    } // ── Stage 3: Slot choice ──────────────────────────────────────────────────
    case "SLOT_CHOICE": {
      const parsed = await parseLeadReply(stage, leadReply, context);

      // Get the dynamic slots that were offered (or fall back to computing fresh ones)
      const dynamicSlots = getNextAvailableSlots(2);
      const slot1Label = context.offeredSlots?.[0] ?? dynamicSlots[0]?.label ?? "the first date";
      const slot2Label = context.offeredSlots?.[1] ?? dynamicSlots[1]?.label ?? "the second date";

      if (parsed.intent === "slot1") {
        return {
          reply: buildTimePrefMessage(slot1Label),
          nextStage: "TIME_PREF",
          extractedData: { selectedSlot: slot1Label },
        };
      }

      if (parsed.intent === "slot2") {
        return {
          reply: buildTimePrefMessage(slot2Label),
          nextStage: "TIME_PREF",
          extractedData: { selectedSlot: slot2Label },
        };
      }

      // Custom date/time request — accept it enthusiastically and advance to TIME_PREF
      if (parsed.intent === "custom_date" || parsed.extractedSlot) {
        const requestedSlot = parsed.extractedSlot ?? leadReply.trim();
        return {
          reply: buildTimePrefMessage(requestedSlot),
          nextStage: "TIME_PREF",
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
        extrasContext,
      });

      return {
        reply: offScript.reply,
        nextStage: "SLOT_CHOICE",
      };
    }

    // ── Stage 3.5: Time preference (morning or afternoon) ─────────────────────
    case "TIME_PREF": {
      const parsed = await parseLeadReply(stage, leadReply, context);
      const slot = context.selectedSlot ?? "your selected day";

      const timePrefMap: Record<string, string> = {
        morning: "Morning",
        afternoon: "Afternoon",
      };
      const timePref = timePrefMap[parsed.intent] ?? "Morning";

      // Append time preference to the slot label for the confirmation message
      const slotWithTime = `${slot} (${timePref})`;

      return {
        reply: buildAddressRequestAfterTimePref(slot, timePref),
        nextStage: "ADDRESS",
        extractedData: { selectedSlot: slotWithTime },
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
          extrasContext,
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
        extrasContext,
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
          extrasContext,
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
