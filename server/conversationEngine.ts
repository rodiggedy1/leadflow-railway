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
import { detectLanguage, buildLanguageConfirmSms, parseLanguageConfirmReply, getLanguageInstruction } from "./languageDetect";
import {
  handleOffScriptReply,
  handleObjection,
  detectObjection,
  handlePostBookingReply,
  buildJadePriceReveal,
} from "./aiService";
import { notifyAgentOfLead } from "./agentNotification";
import { getTemplate } from "./messageTemplateRouter";
import { getFlowTemplate } from "./settingsRouter";
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
  /** Last service price from reactivation CSV (dollars, integer) */
  lastPrice?: number | null;
  /** Discount percentage for reactivation offer (default 10) */
  discountPct?: number | null;
  /** ISO 639-1 language code for this conversation (default "en") */
  language?: string | null;
  /** Stage before LANGUAGE_CONFIRM was triggered — used to resume flow */
  preLangStage?: string | null;
  /** Lead source: "form" | "widget" | "reactivation" | "bark" | etc. */
  leadSource?: string | null;
  /** For Bark leads: the Q&A summary extracted from display_text */
  barkQA?: string | null;
  /**
   * Which SMS flow was assigned to this lead at creation time.
   * "A" = Madison flow (price upfront + availability question)
   * "B" = Jade flow (greeting + day ask → price reveal → lock in)
   * "C" = Jade enriched flow (add-ons → dates → notes → quote link)
   * Defaults to "B" if not set.
   */
  smsFlow?: string | null;
  /** Flow C: preferred date(s) the lead mentioned */
  preferredDates?: string | null;
  /** Flow C: special notes from the lead (pets, focus areas, time of day) */
  specialNotes?: string | null;
}

export interface ChatMessage {
  role: "assistant" | "user";
  content: string;
  /** Unix timestamp (ms) when this message was stored. Optional for backwards compat. */
  ts?: number;
}

export interface StageResult {
  reply: string;
  nextStage: ConversationStage;
  extractedData?: {
    selectedSlot?: string;
    address?: string;
    callPreference?: string;
    /** Flow C: add-on keys parsed from the lead's reply */
    extras?: string[];
    /** Flow C: preferred dates from the lead's reply */
    preferredDates?: string;
    /** Flow C: special notes from the lead's reply */
    specialNotes?: string;
  };
}

// ─── Static message templates ─────────────────────────────────────────────────
// These are used as fallbacks and for the initial burst messages.
// The AI service generates personalized versions when possible.

export function buildQuoteMessage(ctx: Pick<ConversationContext, "leadName" | "quotedPrice" | "bedrooms" | "bathrooms" | "serviceType">): string {
  const firstName = ctx.leadName.split(" ")[0] ?? ctx.leadName;
  return `Awesome, we'd love to help! What day were you thinking so we can see how fast we can get you taken care of?`;
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

export async function buildAvailabilityMessage(extras?: string[] | null): Promise<string> {
  const slots = getNextAvailableSlots(2);
  const slot1 = slots[0]?.shortLabel ?? "Thursday afternoon";
  const slot2 = slots[1]?.shortLabel ?? "Saturday morning";
  const fallback = formatAvailabilityQuestion(slots);
  const baseMsg = await getFlowTemplate("flowA_sms2", fallback, {
    "{slot1}": slot1,
    "{slot2}": slot2,
  });
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

export async function buildTimePrefMessage(slot: string): Promise<string> {
  const fallback = `Great — ${slot} it is! 🗓️\n\nWould morning or afternoon work better for you?`;
  return getFlowTemplate("flowA_sms3", fallback, { "{slot}": slot });
}

export async function buildAddressRequestAfterTimePref(slot: string, timePref: string): Promise<string> {
  const fallback = `${timePref} works! What's the address for the cleaning?`;
  return getFlowTemplate("flowA_sms4", fallback, { "{slot}": slot, "{timePref}": timePref });
}

export function buildConfirmationMessage(slot: string, address: string): string {
  // slot is now a full label like "Friday, March 13" — use it directly
  return `Perfect — I've reserved ${slot} for you at ${address}.\n\nWe just do a quick 60-second confirmation call to finalize the booking and make sure we have everything correct.\n\nShould we call you now or in a few minutes?`;
}

/**
 * SMS 3 in the new Jade flow: lock in the slot, ask for notes, offer call now or in a few minutes.
 * Sent when the lead picks 9am or 1pm from the SLOT_CHOICE stage.
 */
export async function buildJadeLockIn(slotWithTime: string, address?: string): Promise<string> {
  const addr = address ?? "your location";
  return getFlowTemplate(
    "flowB_sms4",
    `Perfect — I've reserved ${slotWithTime} for you at ${addr}. ✅\nAnything I should pass to the team? (pets, gate code, anything like that)\n\nWe'll do a quick 60-sec call to confirm details — should I call now or in a few minutes?`,
    { "{slot}": slotWithTime, "{address}": addr }
  );
}

export async function buildCallScheduledMessage(preference: string, firstName?: string): Promise<string> {
  const name = firstName ?? "";
  const vars = name ? { "{firstName}": name } : { "{firstName}": "" };
  if (preference === "now") {
    return getFlowTemplate(
      "flowB_sms5",
      `Perfect ${name ? name + "! " : ""}Expect a call from us shortly. We look forward to serving you! 🏠✨`,
      vars
    );
  }
  return getFlowTemplate(
    "flowB_sms5_later",
    `No problem${name ? " " + name : ""}! We'll give you a call in a few minutes. Talk soon! 🏠✨`,
    vars
  );
}

export async function buildConfirmationMessageAsync(slot: string, address: string): Promise<string> {
  return getFlowTemplate(
    "flowA_sms5",
    `Perfect — I've reserved ${slot} for you at ${address}.\n\nWe just do a quick 60-second confirmation call to finalize the booking and make sure we have everything correct.\n\nShould we call you now or in a few minutes?`,
    { "{slot}": slot, "{address}": address }
  );
}

export async function buildJadeAddressRequest(firstName?: string): Promise<string> {
  const name = firstName ?? "there";
  return getFlowTemplate(
    "flowB_sms3",
    `Awesome ${name}, what's the address for service?`,
    { "{firstName}": name }
  );
}

// ─── Infrastructure-level language handling ──────────────────────────────────────────────────
//
// Language is handled at the boundary of processLeadReply, not inside stage handlers:
//   1. normalizeInput:  translate lead reply → English before any stage handler sees it
//   2. localizeOutput:  translate bot reply → lead's language after stage handler returns
//
// Stage handlers always work in English. No stage ever needs to know what language
// the lead speaks. Adding a new stage requires zero language work.

/**
 * Translates a lead's message to English if the session language is non-English.
 * Returns the original text unchanged for English sessions (no LLM cost).
 * Falls back to original text if translation fails.
 */
async function normalizeInput(text: string, langCode: string | null | undefined): Promise<string> {
  const lang = (langCode ?? "en").toLowerCase().split("-")[0];
  if (!lang || lang === "en") return text;
  try {
    const result = await invokeLLM({
      messages: [
        {
          role: "system",
          content: `Translate the following message to English. Return ONLY the translated text, no explanations, no quotes. Preserve numbers and proper nouns exactly.`,
        },
        { role: "user", content: text },
      ],
    });
    return (result.choices?.[0]?.message?.content as string)?.trim() || text;
  } catch {
    return text;
  }
}

/**
 * Translates the bot's English reply into the lead's language.
 * Returns the original message unchanged for English sessions (no LLM cost).
 * Falls back to original English message if translation fails.
 */
async function localizeOutput(msg: string, langCode: string | null | undefined): Promise<string> {
  const lang = (langCode ?? "en").toLowerCase().split("-")[0];
  if (!lang || lang === "en") return msg;
  try {
    const result = await invokeLLM({
      messages: [
        {
          role: "system",
          content: `You are a translation assistant for a home cleaning service SMS bot. Translate the following message into the language with ISO code "${lang}". Keep the same tone (friendly, concise), preserve any emojis, and keep date/slot names in their original form. Return ONLY the translated message, no explanations.`,
        },
        { role: "user", content: msg },
      ],
    });
    return (result.choices?.[0]?.message?.content as string)?.trim() || msg;
  } catch {
    return msg;
  }
}

// ─── Widget Sizing Helpers ─────────────────────────────────────────────────────────

/**
 * Returns true if the message looks like a pricing question.
 */
export function isPricingQuestion(text: string): boolean {
  const lower = text.toLowerCase();
  return /how much|price|cost|pricing|rate|quote|estimate|\$/.test(lower);
}

const WORD_TO_NUM: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
};

/**
 * Extracts bedroom and bathroom counts from a natural-language message.
 * Supports numeric ("2 bed"), word ("two bedrooms"), shorthand ("2br"),
 * half-bath ("1.5 bath"), and studio.
 */
export function extractRoomInfo(text: string): { bedrooms: string | null; bathrooms: string | null } {
  const lower = text.toLowerCase();
  let bedrooms: string | null = null;
  let bathrooms: string | null = null;

  // Studio
  if (/\bstudio\b/.test(lower)) {
    bedrooms = "Studio";
  }

  // Bedrooms: "2 bed", "2 bedroom(s)", "2br", "two bed"
  if (!bedrooms) {
    const numMatch = lower.match(/(\d+)\s*(?:bed(?:room)?s?|br)\b/);
    if (numMatch) {
      const n = parseInt(numMatch[1], 10);
      bedrooms = n === 1 ? "1 Bedroom" : `${n} Bedrooms`;
    } else {
      const wordMatch = lower.match(/(zero|one|two|three|four|five|six)\s*(?:bed(?:room)?s?|br)\b/);
      if (wordMatch) {
        const n = WORD_TO_NUM[wordMatch[1]];
        bedrooms = n === 1 ? "1 Bedroom" : `${n} Bedrooms`;
      }
    }
  }

  // Bathrooms: "1.5 bath", "2 bath(room)(s)", "2ba", "two bath", "one and a half bath"
  const halfMatch = lower.match(/(\d+\.5)\s*(?:bath(?:room)?s?|ba)\b/) ||
    lower.match(/one\s+and\s+a\s+half\s*(?:bath(?:room)?s?|ba)?/);
  if (halfMatch) {
    bathrooms = "1.5 Bathrooms";
  } else {
    const numMatch = lower.match(/(\d+)\s*(?:bath(?:room)?s?|ba)\b/);
    if (numMatch) {
      const n = parseInt(numMatch[1], 10);
      bathrooms = n === 1 ? "1 Bathroom" : `${n} Bathrooms`;
    } else {
      const wordMatch = lower.match(/(zero|one|two|three|four|five|six)\s*(?:bath(?:room)?s?|ba)\b/);
      if (wordMatch) {
        const n = WORD_TO_NUM[wordMatch[1]];
        bathrooms = n === 1 ? "1 Bathroom" : `${n} Bathrooms`;
      }
    }
  }

  return { bedrooms, bathrooms };
}

/**
 * Language-agnostic room count extractor.
 * Fast path: tries the English regex first (free, instant).
 * Fallback: if language is non-English and counts are still missing, uses a structured
 * LLM call to extract bedrooms/bathrooms from any language (Spanish, French, Portuguese, etc.).
 *
 * Examples that the LLM fallback handles:
 *   "3 habitaciones y 2 baños" (Spanish)
 *   "2 chambres et 1 salle de bain" (French)
 *   "3 quartos e 2 banheiros" (Portuguese)
 *   "2室で1厅" (Japanese)
 */
export async function extractRoomInfoWithLLM(
  text: string,
  language?: string | null
): Promise<{ bedrooms: string | null; bathrooms: string | null }> {
  // Step 1: Try English regex (fast path — works for English and numeric inputs in any language)
  const regexResult = extractRoomInfo(text);

  // If both values found, no LLM needed
  if (regexResult.bedrooms && regexResult.bathrooms) {
    return regexResult;
  }

  // If English (or no language set), regex is authoritative — don't call LLM
  const lang = (language ?? "en").toLowerCase().split("-")[0];
  if (lang === "en" || lang === "") {
    return regexResult;
  }

  // Step 2: LLM fallback for non-English inputs
  try {
    const response = await invokeLLM({
      messages: [
        {
          role: "system",
          content: `You extract bedroom and bathroom counts from text in any language.
Return JSON with "bedrooms" (integer or null) and "bathrooms" (number or null, can be 1.5).
Examples:
  "3 habitaciones y 2 baños" → {"bedrooms":3,"bathrooms":2}
  "2 chambres et 1 salle de bain" → {"bedrooms":2,"bathrooms":1}
  "studio" → {"bedrooms":0,"bathrooms":null}
  "I don't know" → {"bedrooms":null,"bathrooms":null}`,
        },
        { role: "user", content: text },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "room_counts",
          strict: true,
          schema: {
            type: "object",
            properties: {
              bedrooms: { type: ["integer", "null"] },
              bathrooms: { type: ["number", "null"] },
            },
            required: ["bedrooms", "bathrooms"],
            additionalProperties: false,
          },
        },
      },
    });

    const raw = response.choices?.[0]?.message?.content;
    if (typeof raw === "string") {
      const parsed = JSON.parse(raw);
      const bedroomsNum: number | null = parsed.bedrooms;
      const bathroomsNum: number | null = parsed.bathrooms;

      // Format to match the same labels as extractRoomInfo
      let bedrooms: string | null = regexResult.bedrooms; // keep regex result if already found
      let bathrooms: string | null = regexResult.bathrooms;

      if (!bedrooms && bedroomsNum !== null) {
        if (bedroomsNum === 0) {
          bedrooms = "Studio";
        } else {
          bedrooms = bedroomsNum === 1 ? "1 Bedroom" : `${bedroomsNum} Bedrooms`;
        }
      }

      if (!bathrooms && bathroomsNum !== null) {
        bathrooms = bathroomsNum === 1 ? "1 Bathroom" : `${bathroomsNum} Bathrooms`;
      }

      return { bedrooms, bathrooms };
    }
  } catch (err) {
    console.error("[extractRoomInfoWithLLM] LLM fallback failed:", err);
  }

  // If LLM also fails, return whatever regex found
  return regexResult;
}

/**
 * Real Maids in Black pricing — mirrors estimatePrice() in openphone.ts.
 * Standard Cleaning base prices (1 bathroom included):
 *   Studio/1 bed base = $119, 2 bed base = $209, 3 bed base = $229, 4 bed base = $279, 5 bed base = $319, 6+ bed base = $379
 * Every bathroom adds $30 (e.g. 1 bed / 1 bath = $149, 1 bed / 2 bath = $179).
 */
function lookupPrice(bedrooms: string, bathrooms: string): string {
  const bedroomBase: Record<string, number> = {
    "Studio":      119,
    "1 Bedroom":   119,
    "2 Bedrooms":  209,
    "3 Bedrooms":  229,
    "4 Bedrooms":  279,
    "5 Bedrooms":  319,
    "6 Bedrooms":  379,
    "7 Bedrooms":  419,
    "7+ Bedrooms": 419,
  };
  const bathroomCount: Record<string, number> = {
    "1 Bathroom":    1,
    "1.5 Bathrooms": 1,
    "2 Bathrooms":   2,
    "2.5 Bathrooms": 2,
    "3 Bathrooms":   3,
    "3.5 Bathrooms": 3,
    "4 Bathrooms":   4,
    "4+ Bathrooms":  4,
  };
  const base = bedroomBase[bedrooms] ?? 119;
  const baths = bathroomCount[bathrooms] ?? 1;
  const total = base + baths * 30; // every bathroom adds $30
  return String(total);
}

/**
 * Handles replies in the REACTIVATION stage.
 * Hybrid scripted + LLM fallback. Scripted paths handle the happy path deterministically;
 * the LLM only fires when the reply doesn't match any known pattern.
 *
 * Flow:
 *   1. STOP / opt-out    → reactivation_opt_out → DONE
 *   2. Price question     → reactivation_price_question + reactivation_time_ask → REACTIVATION_TIME
 *   3. YES / positive     → reactivation_yes_reply → REACTIVATION_TIME
 *   4. Off-script (LLM)  → brand-voice answer + time-ask → REACTIVATION_TIME
 *   5. LLM unavailable   → reactivation_time_ask → REACTIVATION_TIME (safe fallback)
 */
async function handleReactivationReply(
  leadReply: string,
  context: ConversationContext
): Promise<StageResult> {
  const lower = leadReply.trim().toLowerCase();
  const firstName = context.leadName?.split(" ")[0] ?? context.leadName ?? "there";
  const discountPct = context.discountPct ?? 10;

  // STOP / opt-out
  if (/^\s*(stop|unsubscribe|cancel|quit|end|remove me|opt.?out)\s*$/i.test(lower)) {
    const reply = await getTemplate("reactivation_opt_out");
    return { reply, nextStage: "DONE" };
  }

  // Price question — give discounted price then ask for time window
  if (isPricingQuestion(lower)) {
    if (context.lastPrice && context.lastPrice > 0) {
      const discounted = Math.round(context.lastPrice * (1 - discountPct / 100));
      const priceReply = await getTemplate("reactivation_price_question", {
        "[Name]": firstName,
        "[LastPrice]": String(context.lastPrice),
        "[Discount]": String(discountPct),
        "[DiscountedPrice]": String(discounted),
      });
      const timeAsk = await getTemplate("reactivation_time_ask");
      return {
        reply: priceReply + " " + timeAsk,
        nextStage: "REACTIVATION_TIME",
      };
    }
    // No price on file — still ask for time window
    const timeAsk = await getTemplate("reactivation_time_ask");
    return {
      reply: `Hi ${firstName}! We'd love to get you back. ` + timeAsk,
      nextStage: "REACTIVATION_TIME",
    };
  }

  // YES / positive intent — use the yes_reply template then REACTIVATION_TIME
  if (/^\s*(yes|yeah|yep|sure|ok|okay|sounds good|let's do it|book|i'm in|im in|absolutely|definitely|great|perfect|yes please)\s*[!.]*\s*$/i.test(lower)) {
    const yesReply = await getTemplate("reactivation_yes_reply", { "[Name]": firstName });
    return {
      reply: yesReply,
      nextStage: "REACTIVATION_TIME",
    };
  }

  // Off-script reply — LLM answers in brand voice, then steers back to time-ask
  const timeAsk = await getTemplate("reactivation_time_ask");
  try {
    const systemPrompt = [
      "You are Jade, a friendly and professional booking assistant for Maids in Black, a premium home cleaning service in the Washington DC metro area.",
      "A past customer just replied to a reactivation SMS offering them a discount on their next cleaning.",
      "Their reply doesn't clearly say yes or ask about price — it's something off-script.",
      "Your job: give a BRIEF, warm, on-brand answer (1-2 sentences max) that addresses what they said, then ALWAYS end with this exact sentence: \"" + timeAsk + "\"",
      "Rules:",
      "- Never make up prices, availability, or policies you don't know.",
      "- If they ask something you can't answer (e.g. specific availability), say we'll confirm details when they book.",
      "- Stay in character as Jade. Warm, professional, concise.",
      "- Do NOT say 'As an AI' or break character.",
      "- Your entire reply must be under 160 characters if possible.",
    ].join("\n");

    const llmResult = await invokeLLM({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: leadReply.trim() },
      ],
    });
    const rawContent = llmResult?.choices?.[0]?.message?.content;
    const llmReply = typeof rawContent === "string" ? rawContent.trim() : undefined;
    if (llmReply && llmReply.length > 0) {
      return { reply: llmReply, nextStage: "REACTIVATION_TIME" };
    }
  } catch {
    // LLM unavailable — fall through to safe scripted fallback
  }

  // Safe fallback if LLM fails
  return {
    reply: timeAsk,
    nextStage: "REACTIVATION_TIME",
  };
}

/**
 * Handles replies in the REACTIVATION_TIME stage.
 * Hybrid scripted + LLM fallback.
 *
 * Flow:
 *   1. STOP / opt-out       → reactivation_opt_out → DONE
 *   2. Time window given    → reactivation_closing → DONE
 *   3. Off-script (LLM)    → brand-voice answer + re-ask for time → REACTIVATION_TIME
 *   4. LLM unavailable     → reactivation_time_ask → REACTIVATION_TIME (safe fallback)
 */
async function handleReactivationTimeReply(
  leadReply: string,
  context: ConversationContext
): Promise<StageResult> {
  const lower = leadReply.trim().toLowerCase();
  const firstName = context.leadName?.split(" ")[0] ?? context.leadName ?? "there";

  // STOP / opt-out
  if (/^\s*(stop|unsubscribe|cancel|quit|end|remove me|opt.?out)\s*$/i.test(lower)) {
    const reply = await getTemplate("reactivation_opt_out");
    return { reply, nextStage: "DONE" };
  }

  // Time window detected — any mention of a day, time, or scheduling preference
  const hasTimeWindow = /(monday|tuesday|wednesday|thursday|friday|saturday|morning|afternoon|evening|weekend|weekday|anytime|flexible|any day|any time|\d{1,2}(am|pm)|next week|this week|tomorrow)/i.test(lower);
  if (hasTimeWindow) {
    const closingReply = await getTemplate("reactivation_closing", { "[Name]": firstName });
    return { reply: closingReply, nextStage: "DONE" };
  }

  // Off-script reply — LLM answers in brand voice, then steers back to time-ask
  const timeAsk = await getTemplate("reactivation_time_ask");
  try {
    const systemPrompt = [
      "You are Jade, a friendly and professional booking assistant for Maids in Black, a premium home cleaning service in the Washington DC metro area.",
      "A past customer agreed to rebook their cleaning. You asked them what days and times work best.",
      "Their reply is off-script — it doesn't mention a day or time preference.",
      "Your job: give a BRIEF, warm, on-brand response (1-2 sentences max) that acknowledges what they said, then ALWAYS end with this exact sentence: \"" + timeAsk + "\"",
      "Rules:",
      "- Never make up prices, availability, or policies you don't know.",
      "- If they ask something you can't answer, say we'll confirm details when they book.",
      "- Stay in character as Jade. Warm, professional, concise.",
      "- Do NOT say 'As an AI' or break character.",
      "- Your entire reply must be under 160 characters if possible.",
    ].join("\n");

    const llmResult = await invokeLLM({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: leadReply.trim() },
      ],
    });
    const rawContent = llmResult?.choices?.[0]?.message?.content;
    const llmReply = typeof rawContent === "string" ? rawContent.trim() : undefined;
    if (llmReply && llmReply.length > 0) {
      return { reply: llmReply, nextStage: "REACTIVATION_TIME" };
    }
  } catch {
    // LLM unavailable — fall through to safe scripted fallback
  }

  // Safe fallback if LLM fails
  return {
    reply: timeAsk,
    nextStage: "REACTIVATION_TIME",
  };
}

/**
 * Handles replies in the WIDGET_SIZING stage.
 * Extracts bedroom/bathroom counts and either:
 *   - Sends a quote + advances to AVAILABILITY (if both counts found)
 *   - Asks a follow-up question (if partial or no info)
 */
async function handleWidgetSizingReply(
  leadReply: string,
  context: ConversationContext
): Promise<StageResult> {
  // Input is already normalized to English by processLeadReply — use regex extractor directly
  // If the session already has room counts (form leads), treat a confirmation reply as a sizing confirmation
  const extracted = extractRoomInfo(leadReply);
  const isConfirmation = /^(yes|yeah|yep|correct|right|yup|sure|ok|okay|that'?s? right|confirmed?)/i.test(leadReply.trim());
  const bedrooms = extracted.bedrooms ?? (isConfirmation ? context.bedrooms ?? null : null);
  const bathrooms = extracted.bathrooms ?? (isConfirmation ? context.bathrooms ?? null : null);

  if (bedrooms && bathrooms) {
    const price = lookupPrice(bedrooms, bathrooms);
    const flowVariant = (context.smsFlow ?? "B").toUpperCase();
    const firstName = context.leadName?.split(" ")[0] ?? context.leadName ?? "there";
    let reply: string;
    let nextStage: string;
    if (flowVariant === "A") {
      // Flow A (Madison): send availability question
      reply = await buildAvailabilityMessage(context.extras);
      nextStage = "AVAILABILITY";
    } else if (flowVariant === "C") {
      // Flow C (Jade enriched): send add-on question after sizing
      const addonFallback = `Perfect, thanks for confirming ${firstName}! 🙌\nJust a couple quick things so we can tailor your quote — do you need any of these add-ons?\n\n✨ Inside oven\n🪟 Interior windows\n🧺 Laundry (wash + fold)\n🍽️ Inside fridge\n🛏️ Inside cabinets\n🧹 Deep clean\n📦 Move in / Move out\n\nJust reply with anything that applies, or say "none" and we'll keep it standard! 😊`;
      reply = await getFlowTemplate("flowC_sms2", addonFallback, { "{firstName}": firstName });
      nextStage = "FLOWC_ADDON";
    } else {
      // Flow B (Jade): send price reveal with day offer using DB template (supports {recurringprice})
      const slots = getNextAvailableSlots(2);
      const dayLabel = slots[0]?.shortLabel ?? "this week";
      reply = await buildJadePriceReveal({
        firstName,
        bedrooms,
        bathrooms,
        price,
        extras: context.extras,
        day: dayLabel,
      });
      nextStage = "SLOT_CHOICE";
    }
    return {
      reply,
      nextStage: nextStage as any,
      extractedData: {
        bedrooms,
        bathrooms,
        quotedPrice: price,
        serviceType: "Standard Cleaning",
      } as any,
    };
  }

  if (bedrooms && !bathrooms) {
    // Have bedrooms but not bathrooms — ask specifically for bathrooms
    return {
      reply: `Got it — ${bedrooms}! And how many bathrooms does your home have?`,
      nextStage: "WIDGET_SIZING",
    };
  }

  if (!bedrooms && bathrooms) {
    // Have bathrooms but not bedrooms — ask specifically for bedrooms
    return {
      reply: `Got it — ${bathrooms}! And how many bedrooms does your home have?`,
      nextStage: "WIDGET_SIZING",
    };
  }

  // GUARD: No room info extracted — reply is off-topic or a FAQ.
  // Use AI to answer naturally, then steer back to asking for room counts.
  // If the person is an existing customer / wrong path, exit the funnel gracefully.
  const offScript = await handleOffScriptReply({
    stage: "WIDGET_SIZING",
    leadName: context.leadName,
    quotedPrice: context.quotedPrice ?? "TBD",
    serviceType: context.serviceType ?? "Standard Cleaning",
    selectedSlot: null,
    messageHistory: context.messageHistory,
    leadReply,
    extrasContext: null,
  });
  return {
    reply: offScript.reply,
    nextStage: offScript.isWrongPath ? "DONE" : "WIDGET_SIZING",
  };
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
  const langNote = context.language && context.language !== "en"
    ? `\nIMPORTANT: The lead may be replying in a non-English language (language code: ${context.language}). Understand their reply in that language and map it to the same intents listed below.`
    : "";

  const systemPrompt = `You are an AI assistant helping parse SMS replies from leads for a home cleaning service called "Maids in Black".${langNote}

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
async function _processLeadReplyCore(
  leadReply: string,
  context: ConversationContext
): Promise<StageResult> {
  const { stage } = context;

  // Build a human-readable extras string for AI context (e.g. "Clean Inside Oven, Load of Laundry")
  const extrasContext = context.extras && context.extras.length > 0
    ? context.extras.map(k => k.replace(/_/g, " ")).join(", ")
    : null;

  // ── LANGUAGE_CONFIRM: Lead replied to the bilingual language confirmation ──────────────────────
  if (stage === "LANGUAGE_CONFIRM") {
    return handleLanguageConfirmReply(leadReply, context);
  }

  // ── Language detection: detect non-English on first meaningful reply ──────────────────────────
  // Only detect on the very first reply (no language set yet) and skip terminal/simple stages
  const currentLanguage = context.language || "en";
  const shouldDetectLanguage =
    currentLanguage === "en" &&
    stage !== "DONE" &&
    stage !== "BOOKED" &&
    stage !== "NOT_INTERESTED" &&
    stage !== "FUTURE_BOOKING" &&
    stage !== "FOLLOW_UP_SCHEDULED" &&
    leadReply.trim().length > 1;

  if (shouldDetectLanguage) {
    try {
      const langResult = await detectLanguage(leadReply);
      if (!langResult.isEnglish && langResult.confidence >= 0.75) {
        const confirmMsg = buildLanguageConfirmSms(langResult.language, langResult.languageName);
        return {
          reply: confirmMsg,
          nextStage: "LANGUAGE_CONFIRM",
          extractedData: {
            // Pass language info via a special marker in selectedSlot (will be parsed in webhooks.ts)
          },
          // Attach language metadata for the webhook to persist
          _detectedLanguage: langResult.language,
          _detectedLanguageName: langResult.languageName,
          _preLangStage: stage,
        } as StageResult & { _detectedLanguage: string; _detectedLanguageName: string; _preLangStage: string };
      }
    } catch (err) {
      console.error("[ConversationEngine] Language detection failed:", err);
    }
  }

  // ── Post-booking stages — route through AI instead of a static dead-end ───────────────────────
  if (stage === "DONE" || stage === "CALL_SCHEDULED") {
    const reply = await handlePostBookingReply({
      stage,
      leadName: context.leadName,
      quotedPrice: context.quotedPrice,
      serviceType: context.serviceType,
      selectedSlot: context.selectedSlot,
      address: context.address,
      messageHistory: context.messageHistory,
      leadReply,
      extrasContext,
    });
    return {
      reply,
      nextStage: stage, // stay in the same stage
    };
  }
  // ── REACTIVATION: Handle YES/price/STOP replies from reactivation campaign contacts ──
  if (stage === "REACTIVATION") {
    return handleReactivationReply(leadReply, context);
  }

  // ── REACTIVATION_TIME: Customer gave a time window → send closing, or LLM fallback for off-script ──
  if (stage === "REACTIVATION_TIME") {
    return handleReactivationTimeReply(leadReply, context);
  }

  // ── WIDGET_SIZING: Extract room counts and send quote, or ask for missing info ──
  if (stage === "WIDGET_SIZING") {
    return handleWidgetSizingReply(leadReply, context);
  }

  // ── FLOW C STAGES ─────────────────────────────────────────────────────────────

  // FLOWC_ADDON: Lead replied with add-ons (or "none") — use AI to parse intent, answer questions, then advance
  if (stage === "FLOWC_ADDON") {
    const firstName = context.leadName?.split(" ")[0] ?? "there";
    // Use AI to parse the reply
    let aiResult: { intent: string; extractedAddons: string[]; question: string | null; confidence: string };
    try {
      const resp = await invokeLLM({
        messages: [
          {
            role: "system",
            content: `You are parsing an SMS reply from a home cleaning lead. They were asked which add-on services they want.
Available add-ons: inside_oven, interior_windows, laundry, inside_fridge, inside_cabinets, deep_clean, move_in_out.
Extract which add-ons they mentioned. If they said none/no/standard, return empty array.
If they asked a question about an add-on, capture it in the question field.
Respond ONLY with JSON: { "intent": "addons_provided" | "none" | "question" | "unclear", "extractedAddons": string[], "question": string | null, "confidence": "high" | "low" }`,
          },
          { role: "user", content: `Lead reply: "${leadReply}"` },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "parse_addon_reply",
            strict: true,
            schema: {
              type: "object",
              properties: {
                intent: { type: "string" },
                extractedAddons: { type: "array", items: { type: "string" } },
                question: { type: ["string", "null"] },
                confidence: { type: "string", enum: ["high", "low"] },
              },
              required: ["intent", "extractedAddons", "question", "confidence"],
              additionalProperties: false,
            },
          },
        },
      });
      aiResult = JSON.parse(resp.choices[0].message.content as string);
    } catch {
      // Fallback: treat as none
      aiResult = { intent: "none", extractedAddons: [], question: null, confidence: "low" };
    }

    // If they asked a question, answer it with AI then re-ask the add-on question
    if (aiResult.intent === "question" && aiResult.question) {
      const answerResp = await handleOffScriptReply({
        stage: "FLOWC_ADDON",
        leadName: context.leadName,
        quotedPrice: context.quotedPrice,
        serviceType: context.serviceType,
        selectedSlot: null,
        messageHistory: context.messageHistory,
        leadReply,
        extrasContext: null,
      });
      const addonFallback = `Just reply with any add-ons you'd like, or say "none" to keep it standard! 😊`;
      const reAsk = await getFlowTemplate("flowC_sms2_reask", addonFallback, { "{firstName}": firstName });
      return { reply: `${answerResp.reply}\n\n${reAsk}`, nextStage: "FLOWC_ADDON" };
    }

    const extrasToStore = aiResult.intent === "none" ? [] : aiResult.extractedAddons;
    const dateFallback = `Almost there! 📅 What date works best for you? Drop a date (or a couple options) and I'll check availability right away as well! 😊⚡`;
    const dateReply = await getFlowTemplate("flowC_sms3", dateFallback, {});
    return {
      reply: dateReply,
      nextStage: "FLOWC_DATE",
      extractedData: { extras: extrasToStore },
    };
  }

  // FLOWC_DATE: Lead replied with preferred date(s) — use AI to validate, handle questions, re-ask if no date given
  if (stage === "FLOWC_DATE") {
    const firstName = context.leadName?.split(" ")[0] ?? "there";
    let aiResult: { intent: string; extractedDate: string | null; question: string | null; confidence: string };
    try {
      const resp = await invokeLLM({
        messages: [
          {
            role: "system",
            content: `You are parsing an SMS reply from a home cleaning lead. They were asked what date(s) work best for them.
Extract the date or date range they mentioned. If they asked a question instead, capture it.
If they gave no date info at all, set intent to "no_date".
Respond ONLY with JSON: { "intent": "date_provided" | "no_date" | "question" | "unclear", "extractedDate": string | null, "question": string | null, "confidence": "high" | "low" }`,
          },
          { role: "user", content: `Lead reply: "${leadReply}"` },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "parse_date_reply",
            strict: true,
            schema: {
              type: "object",
              properties: {
                intent: { type: "string" },
                extractedDate: { type: ["string", "null"] },
                question: { type: ["string", "null"] },
                confidence: { type: "string", enum: ["high", "low"] },
              },
              required: ["intent", "extractedDate", "question", "confidence"],
              additionalProperties: false,
            },
          },
        },
      });
      aiResult = JSON.parse(resp.choices[0].message.content as string);
    } catch {
      aiResult = { intent: "date_provided", extractedDate: leadReply.trim(), question: null, confidence: "low" };
    }

    // If they asked a question, answer it then re-ask for the date
    if (aiResult.intent === "question" && aiResult.question) {
      const answerResp = await handleOffScriptReply({
        stage: "FLOWC_DATE",
        leadName: context.leadName,
        quotedPrice: context.quotedPrice,
        serviceType: context.serviceType,
        selectedSlot: null,
        messageHistory: context.messageHistory,
        leadReply,
        extrasContext: null,
      });
      return { reply: `${answerResp.reply}\n\nWhat date works best for you? 📅`, nextStage: "FLOWC_DATE" };
    }

    // If no date given, re-ask
    if (aiResult.intent === "no_date") {
      return {
        reply: `No worries ${firstName}! Just drop a date or two that work for you and I'll check availability right away 📅`,
        nextStage: "FLOWC_DATE",
      };
    }

    const notesFallback = `🎉 Last thing — is there anything specific we should know before we arrive? (Pets, areas to focus on, preferred time of day, etc.)\n\nOr just say "all good" and we'll give you the final quote! 🐾🏡`;
    const notesReply = await getFlowTemplate("flowC_sms4", notesFallback, {});
    return {
      reply: notesReply,
      nextStage: "FLOWC_NOTES",
      extractedData: { preferredDates: aiResult.extractedDate ?? leadReply.trim() },
    };
  }

  // FLOWC_NOTES: Lead replied with notes or "all good" — generate quote link and send SMS 5
  if (stage === "FLOWC_NOTES") {
    const firstName = context.leadName?.split(" ")[0] ?? context.leadName ?? "there";
    const quoteLinkFallback = `Hi ${firstName}! Here's your custom quote from Maids in Black — put together just for you based on everything you shared 🖤✨\n\n👉 {quoteLink}\n\nTake a look and if it all looks good, you can book directly through the link or just tell me "Looks good" and I can lock it in by text as well. Excited to work with you. 😊`;
    const quoteReply = await getFlowTemplate("flowC_sms5", quoteLinkFallback, { "{firstName}": firstName });
    return {
      reply: quoteReply,
      nextStage: "FLOWC_QUOTE_SENT",
      extractedData: { specialNotes: leadReply.trim() },
    };
  }

  // FLOWC_QUOTE_SENT: Quote link already sent — handle any follow-up reply ("looks good", questions, etc.)
  if (stage === "FLOWC_QUOTE_SENT") {
    const lower = leadReply.toLowerCase();
    const wantsToBook = /\b(looks good|book|yes|yeah|let'?s do it|confirm|ready|lock it in|perfect|great|awesome|sounds good)\b/.test(lower);
    if (wantsToBook) {
      return {
        reply: `Amazing! 🎉 To lock it in, what's the address for the service?`,
        nextStage: "ADDRESS",
      };
    }
    // Off-script reply — handle with AI
    const offScript = await handleOffScriptReply({
      stage,
      leadName: context.leadName,
      quotedPrice: context.quotedPrice,
      serviceType: context.serviceType,
      selectedSlot: context.selectedSlot,
      messageHistory: context.messageHistory,
      leadReply,
      extrasContext: null,
    });
    return { reply: offScript.reply, nextStage: offScript.isWrongPath ? "DONE" : "FLOWC_QUOTE_SENT" };
  }

  // ── QUOTE_SENT: Route to Flow A (Madison) or Flow B (Jade) based on smsFlow ──
  if (stage === "QUOTE_SENT") {
    const flowVariant = (context.smsFlow ?? "B").toUpperCase();

    if (flowVariant === "A") {
      // Flow A (Madison): any reply → send availability question
      return {
        reply: await buildAvailabilityMessage(context.extras),
        nextStage: "AVAILABILITY",
      };
    }

    // Flow B (Jade): check if lead already mentioned a day — if so, skip straight to SMS 2 (price reveal)
    const replyLowerQS = leadReply.toLowerCase();
    const ALL_DAY_NAMES_QS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
    const mentionedDayQS = ALL_DAY_NAMES_QS.find(d => replyLowerQS.includes(d));

    // Also check for "today", "tomorrow", "this week", "next week" as day-like signals
    const hasDaySignal = mentionedDayQS ||
      /\b(today|tomorrow|this week|next week|asap|as soon as possible|soonest|earliest)\b/.test(replyLowerQS);

    if (hasDaySignal) {
      // Resolve the day label
      const dynamicSlotsQS = getNextAvailableSlots(2);
      let dayLabel: string;
      if (mentionedDayQS) {
        const matchedSlot = dynamicSlotsQS.find(s => s.shortLabel.toLowerCase() === mentionedDayQS);
        dayLabel = matchedSlot?.label ?? (mentionedDayQS.charAt(0).toUpperCase() + mentionedDayQS.slice(1));
      } else if (/\btoday\b/.test(replyLowerQS)) {
        dayLabel = "Today";
      } else if (/\btomorrow\b/.test(replyLowerQS)) {
        dayLabel = dynamicSlotsQS[0]?.label ?? "Tomorrow";
      } else {
        // "this week", "asap", "next week" — offer the first available slot
        dayLabel = dynamicSlotsQS[0]?.label ?? "this week";
      }
      const firstName = context.leadName.split(" ")[0] ?? context.leadName;
      return {
        reply: await buildJadePriceReveal({
          firstName,
          bedrooms: context.bedrooms,
          bathrooms: context.bathrooms,
          price: context.quotedPrice,
          extras: context.extras,
          day: dayLabel,
        }),
        nextStage: "SLOT_CHOICE",
        extractedData: { selectedSlot: dayLabel },
      };
    }

    // No day mentioned — re-ask what day works (stay in AVAILABILITY so next reply triggers day detection)
    return {
      reply: `What day were you thinking? We have openings most days this week. 📅`,
      nextStage: "AVAILABILITY",
    };
  }

  // ── FUTURE_BOOKING: Lead is interested but not ready yet — stay warm, no pressure ──
  if (stage === "FUTURE_BOOKING") {
    const reply = await handleOffScriptReply({
      stage,
      leadName: context.leadName,
      quotedPrice: context.quotedPrice,
      serviceType: context.serviceType,
      selectedSlot: context.selectedSlot,
      messageHistory: context.messageHistory,
      leadReply,
      extrasContext,
    });
    // If they're now ready to book, let them back into the flow
    const lower = leadReply.toLowerCase();
    const readyNow = /\b(ready|book|schedule|let'?s do it|when can|available|yes|yeah|sure|ok|okay)\b/.test(lower);
    if (readyNow) {
      return {
        reply: await buildAvailabilityMessage(context.extras),
        nextStage: "AVAILABILITY",
      };
    }
    return { reply: reply.reply, nextStage: reply.isWrongPath ? "DONE" : "FUTURE_BOOKING" };
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

      return {
        reply: objectionResult.reply,
        nextStage: (objectionResult.nextStage ?? stage) as ConversationStage,
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
        // Determine the display label for the day
        let dayLabel: string;
        if (slot1 && slot1.shortLabel.toLowerCase() === mentionedDay) {
          dayLabel = slot1.label;
        } else if (slot2 && slot2.shortLabel.toLowerCase() === mentionedDay) {
          dayLabel = slot2.label;
        } else {
          dayLabel = mentionedDay.charAt(0).toUpperCase() + mentionedDay.slice(1);
        }
        // SMS 2: price reveal + supplies note + 9am/1pm offer on the specific day
        const firstName = context.leadName.split(" ")[0] ?? context.leadName;
        return {
          reply: await buildJadePriceReveal({
            firstName,
            bedrooms: context.bedrooms,
            bathrooms: context.bathrooms,
            price: context.quotedPrice,
            extras: context.extras,
            day: dayLabel,
          }),
          nextStage: "SLOT_CHOICE",
          extractedData: { selectedSlot: dayLabel },
        };
      }

      // Step 1b: Check for future-date intent BEFORE the LLM — catches "early May", "next month", etc.
      // This runs after the day-name check but before the LLM to avoid misclassifying as "unclear"
      const futureDatePatterns = [
        /\b(next month|next year|in a few weeks|in a few months|in \d+ weeks|in \d+ months)\b/i,
        /\b(early|mid|late)\s+(january|february|march|april|may|june|july|august|september|october|november|december)\b/i,
        /\b(january|february|march|april|may|june|july|august|september|october|november|december)\b/i,
        /\b(not until|won't need|won't be ready|not ready|not for a while|a while from now|after the holidays|when i move|after i move|when we move|after we move)\b/i,
        /\b(summer|fall|winter|spring|next season|after summer|after winter)\b/i,
        /\b(in a month|in two months|in three months|in a couple months|in a couple of months)\b/i,
      ];
      const isFutureDate = futureDatePatterns.some(p => p.test(leadReply));
      if (isFutureDate) {
        const objectionResult = await handleObjection("future_booking", {
          leadName: context.leadName,
          quotedPrice: context.quotedPrice,
          serviceType: context.serviceType,
        });
        return {
          reply: objectionResult.reply,
          nextStage: "FUTURE_BOOKING",
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
        const firstName = context.leadName.split(" ")[0] ?? context.leadName;
        return {
          reply: await buildJadePriceReveal({
            firstName,
            bedrooms: context.bedrooms,
            bathrooms: context.bathrooms,
            price: context.quotedPrice,
            extras: context.extras,
            day: slotLabel,
          }),
          nextStage: "SLOT_CHOICE",
          extractedData: { selectedSlot: slotLabel },
        };
      }

      // Step 5: Unclear, "not now", soft no, or questions → re-engage by asking what day works
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

      // Step 6: Positive reply but no specific day — ask what day works
      return {
        reply: `Great! What day were you thinking? We have openings most days this week. 📅`,
        nextStage: "AVAILABILITY",
      };
    }

    // ── Stage 3: Slot choice (9am or 1pm pick) ───────────────────────────────
    // In the new Jade flow, SLOT_CHOICE is reached after the lead replies with a day.
    // The lead is now choosing between 9am or 1pm on their chosen day.
    case "SLOT_CHOICE": {
      const parsed = await parseLeadReply(stage, leadReply, context);

      // Detect 9am / 1pm pick (or morning/afternoon equivalent)
      const replyLowerSlot = leadReply.toLowerCase();
      const picked9am = /\b(9|9am|9\s*am|morning|first|early)\b/.test(replyLowerSlot);
      const picked1pm = /\b(1|1pm|1\s*pm|afternoon|second|later)\b/.test(replyLowerSlot);

      const chosenDay = context.selectedSlot ?? "your chosen day";

      if (picked9am || picked1pm || parsed.intent === "slot1" || parsed.intent === "slot2") {
        const timeLabel = (picked9am || parsed.intent === "slot1") ? "9am" : "1pm";
        const slotWithTime = `${chosenDay} at ${timeLabel}`;
        // If address already on file (reactivation/always-on), skip address step
        if (context.address && context.address.length >= 5) {
          return {
            reply: await buildJadeLockIn(slotWithTime, context.address),
            nextStage: "CONFIRMATION",
            extractedData: { selectedSlot: slotWithTime },
          };
        }
        // SMS 3: ask for address
        const firstName1 = context.leadName?.split(" ")[0] ?? context.leadName;
        return {
          reply: await buildJadeAddressRequest(firstName1),
          nextStage: "ADDRESS",
          extractedData: { selectedSlot: slotWithTime },
        };
      }

      // Custom date/time request — ask for address
      if (parsed.intent === "custom_date" || parsed.extractedSlot) {
        const requestedSlot = parsed.extractedSlot ?? leadReply.trim();
        if (context.address && context.address.length >= 5) {
          return {
            reply: await buildJadeLockIn(requestedSlot, context.address),
            nextStage: "CONFIRMATION",
            extractedData: { selectedSlot: requestedSlot },
          };
        }
        const firstName2 = context.leadName?.split(" ")[0] ?? context.leadName;
        return {
          reply: await buildJadeAddressRequest(firstName2),
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
        extrasContext,
      });

      return {
        reply: offScript.reply,
        nextStage: offScript.isWrongPath ? "DONE" : "SLOT_CHOICE",
      };
    }

    // ── Stage 3.5: Time preference (morning or afternoon) ─────────────────
    case "TIME_PREF": {
      const parsed = await parseLeadReply(stage, leadReply, context);
      const slot = context.selectedSlot ?? "your selected day";

      const timePrefMap: Record<string, string> = {
        morning: "Morning",
        afternoon: "Afternoon",
      };
      const timePref = timePrefMap[parsed.intent];

      // GUARD: must have a clear morning/afternoon answer before advancing
      if (!timePref) {
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
          nextStage: offScript.isWrongPath ? "DONE" : "TIME_PREF",
        };
      }

      // Append time preference to the slot label for the confirmation message
      const slotWithTime = `${slot} (${timePref})`;

      // If we already have the address on file (always-on / reactivation leads),
      // skip the ADDRESS step and go straight to CONFIRMATION.
      if (context.address && context.address.length >= 5) {
        return {
          reply: buildConfirmationMessage(slotWithTime, context.address),
          nextStage: "CONFIRMATION",
          extractedData: { selectedSlot: slotWithTime },
        };
      }

      return {
        reply: await buildAddressRequestAfterTimePref(slot, timePref),
        nextStage: "ADDRESS",
        extractedData: { selectedSlot: slotWithTime },
      };
    }

       // ── Stage 4: Address ────────────────────────────────────────────
    case "ADDRESS": {
      const parsed = await parseLeadReply(stage, leadReply, context);
      // GUARD: only use the LLM-extracted address — never fall back to raw reply text.
      // Raw text could be a FAQ question ("Do you bring supplies?") which would
      // pass the length check but is not a real address.
      const address = parsed.extractedAddress;
      const slot = context.selectedSlot ?? "Saturday 9AM";

      if (!address || address.length < 5) {
        // Use AI to answer naturally and re-ask for address
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
          nextStage: offScript.isWrongPath ? "DONE" : "ADDRESS",
        };
      }
      // Jade flow (B): after address, send lock-in + notes + call question
      // Madison flow (A): after address, send confirmation with slot + address + call question
      const flowVariantAddr = (context.smsFlow ?? "B").toUpperCase();
      if (flowVariantAddr === "B") {
        return {
          reply: await buildJadeLockIn(slot, address),
          nextStage: "CONFIRMATION",
          extractedData: { address },
        };
      }
      return {
        reply: await buildConfirmationMessageAsync(slot, address),
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

        const firstName = context.leadName?.split(" ")[0] ?? context.leadName;
        return {
          reply: await buildCallScheduledMessage(pref, firstName),
          nextStage: "CALL_SCHEDULED",
          extractedData: { callPreference: pref },
        };
      }

      // Hard opt-out — end the conversation
      if (parsed.intent === "no" && parsed.confidence === "high") {
        return {
          reply: `No worries at all! If you ever need a cleaning in the future, we're here. Have a great day! 🏠`,
          nextStage: "DONE",
        };
      }

      // Looks like notes/special instructions (not a call preference) — acknowledge and re-ask call question
      // This handles replies like "no pets", "gate code is 1234", "just let yourselves in", etc.
      const looksLikeNotes = parsed.intent !== "now" && parsed.intent !== "few_minutes" &&
        !/\b(call|phone|ring|now|minute|soon|later|yes|yeah|sure|ok|okay)\b/i.test(leadReply);

      if (looksLikeNotes) {
        // Check if this is a wrong-path reply (existing customer, support request, wrong number)
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
        if (offScript.isWrongPath) {
          return {
            reply: offScript.reply,
            nextStage: "DONE",
          };
        }
        return {
          reply: `Got it — noted for the team! 📝\n\nShould I have someone call you now to confirm, or in a few minutes?`,
          nextStage: "CONFIRMATION",
        };
      }

      // Unclear — re-ask the call question directly (never ask for address here)
      return {
        reply: `Just to confirm — should we call you now or in a few minutes to lock everything in? 📞`,
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
          nextStage: offScript.isWrongPath ? "DONE" : "UNHANDLED",
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

/**
 * Public entry point for processing a lead's SMS reply.
 *
 * Language handling is done here at the infrastructure boundary:
 *   1. normalizeInput  — translates the lead's reply to English (no-op for English sessions)
 *   2. _processLeadReplyCore — all stage logic runs in English
 *   3. localizeOutput  — translates the bot's reply back to the lead's language (no-op for English)
 *
 * No stage handler needs to know what language the lead speaks.
 */
export async function processLeadReply(
  leadReply: string,
  context: ConversationContext
): Promise<StageResult> {
  // Step 1: Normalize input to English (skipped for English sessions — no LLM cost)
  const normalizedReply = await normalizeInput(leadReply, context.language);

  // Step 2: Run all stage logic with English input
  const result = await _processLeadReplyCore(normalizedReply, context);

  // Step 3: Localize output to lead's language (skipped for English sessions — no LLM cost)
  const localizedReply = await localizeOutput(result.reply, context.language);

  return { ...result, reply: localizedReply };
}

/**
 * Handle a reply to the bilingual language confirmation message.
 * If the lead says yes → confirm in their language and resume the pre-lang stage.
 * If the lead says no → confirm English and resume.
 * If unclear → ask again.
 */
async function handleLanguageConfirmReply(
  leadReply: string,
  context: ConversationContext
): Promise<StageResult & { _confirmedLanguage?: string; _confirmedLanguageName?: string }> {
  const answer = parseLanguageConfirmReply(leadReply);
  const preLangStage = (context.preLangStage as ConversationStage) || "AVAILABILITY";
  const firstName = context.leadName?.split(" ")[0] ?? context.leadName ?? "there";

  if (answer === "yes") {
    // Confirmed non-English — resume in their language
    const langCode = context.language || "en";
    const langInstruction = getLanguageInstruction(langCode, langCode);

    // Generate a brief acknowledgment in their language
    let ackMsg = "";
    try {
      const ackResponse = await invokeLLM({
        messages: [
          {
            role: "system",
            content: `You are a friendly cleaning service assistant. Respond ONLY in the language with code "${langCode}". Keep it very short (1 sentence).`,
          },
          {
            role: "user",
            content: `Say "Great! I'll continue in [language name]. Let's get you scheduled!" in the language with code "${langCode}".`,
          },
        ],
      });
      ackMsg = (ackResponse.choices?.[0]?.message?.content as string) || "";
    } catch {
      ackMsg = `Great! Let's continue. 😊`;
    }

    // Now resume the pre-lang stage flow
    const resumeResult = await resumeStageAfterLanguageConfirm(preLangStage, context);
    const fullReply = ackMsg ? `${ackMsg}\n\n${resumeResult.reply}` : resumeResult.reply;

    return {
      reply: fullReply,
      nextStage: resumeResult.nextStage,
      _confirmedLanguage: langCode,
    };
  } else if (answer === "no") {
    // Wants English — resume normally
    const resumeResult = await resumeStageAfterLanguageConfirm(preLangStage, context);
    return {
      reply: `No problem! ${resumeResult.reply}`,
      nextStage: resumeResult.nextStage,
      _confirmedLanguage: "en",
    };
  } else {
    // Unclear — ask again
    return {
      reply: `Sorry, I didn't catch that! Reply *Yes* to continue in your language, or *No* for English.`,
      nextStage: "LANGUAGE_CONFIRM",
    };
  }
}

/**
 * Resume the conversation at the appropriate stage after language is confirmed.
 * Translates the resume message into the confirmed language if not English.
 */
async function resumeStageAfterLanguageConfirm(
  preLangStage: ConversationStage,
  context: ConversationContext
): Promise<{ reply: string; nextStage: ConversationStage }> {
  const langCode = context.language || "en";

  // Build the English base message first
  let englishMsg: string;
  let nextStage: ConversationStage;

  switch (preLangStage) {
    case "WIDGET_SIZING":
      // Lead was in the middle of answering bedrooms/bathrooms — ask again in their language
      englishMsg = `To get you a price, I just need to know: how many bedrooms and bathrooms does your home have? (e.g. 3 bed / 2 bath)`;
      nextStage = "WIDGET_SIZING";
      break;
    case "REACTIVATION_TIME":
      englishMsg = await getTemplate("reactivation_closing", {
        "[Name]": context.leadName?.split(" ")[0] ?? context.leadName ?? "there",
      });
      nextStage = "DONE";
      break;
    case "QUOTE_SENT":
    case "AVAILABILITY":
    case "REACTIVATION":
      englishMsg = await buildAvailabilityMessage(context.extras);
      nextStage = "AVAILABILITY";
      break;
    case "SLOT_CHOICE":
      englishMsg = buildSlotChoiceMessage();
      nextStage = "SLOT_CHOICE";
      break;
    case "TIME_PREF":
      englishMsg = await buildTimePrefMessage(context.selectedSlot || "your slot");
      nextStage = "TIME_PREF";
      break;
    case "ADDRESS":
      englishMsg = buildAddressRequestMessage(context.selectedSlot || "");
      nextStage = "ADDRESS";
      break;
    case "CONFIRMATION":
      englishMsg = buildConfirmationMessage(context.selectedSlot || "your slot", context.address || "");
      nextStage = "CONFIRMATION";
      break;
    default:
      // Unknown stage — fall back to asking bedrooms/bathrooms if no quote yet, else availability
      if (!context.quotedPrice || context.quotedPrice === "0") {
        englishMsg = `To get you a price, I just need to know: how many bedrooms and bathrooms does your home have? (e.g. 3 bed / 2 bath)`;
        nextStage = "WIDGET_SIZING";
      } else {
        englishMsg = await buildAvailabilityMessage(context.extras);
        nextStage = "AVAILABILITY";
      }
  }

  // If English, return as-is
  if (langCode === "en") {
    return { reply: englishMsg, nextStage };
  }

  // Translate the message into the confirmed language
  try {
    const translated = await invokeLLM({
      messages: [
        {
          role: "system",
          content: `You are a translation assistant for a home cleaning service SMS bot. Translate the following message into the language with ISO code "${langCode}". Keep the same tone (friendly, concise), preserve any emojis, and keep slot/date names in their original form. Return ONLY the translated message, no explanations.`,
        },
        {
          role: "user",
          content: englishMsg,
        },
      ],
    });
    const translatedMsg = (translated.choices?.[0]?.message?.content as string) || englishMsg;
    return { reply: translatedMsg, nextStage };
  } catch {
    // Fallback to English on translation error
    return { reply: englishMsg, nextStage };
  }
}
