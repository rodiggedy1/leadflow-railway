/**
 * Maids in Black — Guardrailed AI Service
 *
 * Design philosophy:
 * - The STATE MACHINE is always in control. ChatGPT never decides what stage to go to.
 * - ChatGPT has two jobs only:
 *     1. Generate natural, on-brand messages for each stage (dynamic pricing, personalization)
 *     2. Handle off-script replies (FAQs, objections) and steer back to the funnel
 * - A strict system prompt enforces brand voice, message length, and topic boundaries.
 * - If ChatGPT fails for any reason, every function has a hardcoded fallback.
 */

import { invokeLLM } from "./_core/llm";
import { getNextAvailableSlots, formatAvailabilityQuestion, formatSlotChoiceQuestion } from "./availability";
import { resolveExtras } from "../shared/extras";
import { MAIDS_IN_BLACK_KNOWLEDGE_BASE } from "./knowledgeBase";

// ─── Brand System Prompt ──────────────────────────────────────────────────────

const BRAND_SYSTEM_PROMPT = `You are Madison, the AI assistant for Maids in Black, a professional home cleaning service serving the Washington DC Metro Area (DC, MD, VA).

YOUR ROLE:
You help convert leads into booked cleaning appointments via SMS. You are warm, professional, and concise.

BRAND VOICE:
- Friendly but professional — like a helpful concierge, not a pushy salesperson
- Confident and reassuring — customers trust us with their homes
- Concise — SMS messages must be SHORT (1-3 sentences max, never more than 160 characters if possible)
- Never use ALL CAPS, excessive punctuation, or spam-like language
- One emoji maximum per message, only when it feels natural

STRICT RULES — NEVER VIOLATE THESE:
1. NEVER make up prices. Only use the price provided to you in the prompt.
2. NEVER promise specific cleaners, arrival times outside what's given, or guarantees not in our standard service.
3. NEVER discuss competitors.
4. NEVER engage with off-topic questions (weather, restaurants, news, personal opinions, etc.). Politely deflect in one sentence and immediately steer back to booking.
5. NEVER be rude or dismissive, even if the lead is.
6. NEVER send more than one message at a time. Keep it to a single SMS reply.
7. ALWAYS steer back toward booking. Every off-script response MUST end with a gentle nudge toward the next step (e.g. asking about availability, confirming a slot, or getting their address). This is non-negotiable.
8. Use the BUSINESS KNOWLEDGE BASE below to answer questions accurately. If a question is not covered, say "Great question — our team can answer that on your confirmation call."
9. When a lead has selected add-ons (extras), be specific and confident: confirm we WILL take care of that specific item during the visit.

--- BUSINESS KNOWLEDGE BASE ---
${MAIDS_IN_BLACK_KNOWLEDGE_BASE}
--- END KNOWLEDGE BASE ---`;

// ─── Dynamic Quote Message Generator ─────────────────────────────────────────

export interface QuoteMessageParams {
  leadName: string;
  bedrooms: string;
  bathrooms: string;
  serviceType: string;
  price: string;
  extras?: string[];
}

/**
 * Generates the initial quote SMS.
 * Uses a consistent static template for reliability — no AI variation.
 * Format: "Hi [Name]! Thanks for reaching out to Maids in Black. Your [service] quote for [beds]/[baths] is $[price] — our fully insured team handles everything."
 */
export async function generateQuoteMessage(params: QuoteMessageParams): Promise<string> {
  const { leadName, bedrooms, bathrooms, serviceType, price, extras } = params;
  const firstName = leadName.split(" ")[0] ?? leadName;
  return buildFallbackQuoteMessage(firstName, bedrooms, bathrooms, serviceType, price, extras);
}

/**
 * Generates the availability follow-up message (sent right after the quote).
 * Uses dynamic rolling slots (next 2 available days, skipping Sundays).
 */
export async function generatePricingFollowUp(params: QuoteMessageParams): Promise<string> {
  const slots = getNextAvailableSlots(2);
  return formatAvailabilityQuestion(slots);
}

// ─── Off-Script Handler ───────────────────────────────────────────────────────

export interface OffScriptContext {
  stage: string;
  leadName: string;
  quotedPrice: string;
  serviceType: string;
  selectedSlot?: string | null;
  messageHistory: Array<{ role: "assistant" | "user"; content: string }>;
  leadReply: string;
  /** Extras the lead selected on the quote form (human-readable labels) */
  extrasContext?: string | null;
  /** ISO 639-1 language code for this conversation (default "en") */
  language?: string | null;
}

export interface OffScriptResult {
  reply: string;
  shouldAdvanceStage: boolean; // true if the AI thinks the lead is ready to continue
}

/**
 * Handles off-script replies (FAQs, objections, random questions).
 * Always ends with a nudge back toward the current stage's goal.
 * Falls back to a safe generic response if AI fails.
 */
export async function handleOffScriptReply(ctx: OffScriptContext): Promise<OffScriptResult> {
  const { stage, leadName, quotedPrice, serviceType, selectedSlot, messageHistory, leadReply, extrasContext } = ctx;
  const firstName = leadName.split(" ")[0] ?? leadName;

  // Build the next expected action based on current stage
  const nextAction = getNextActionPrompt(stage, selectedSlot);

  // Build conversation history for context (last 6 messages)
  const recentHistory = messageHistory.slice(-6).map(m => ({
    role: m.role as "assistant" | "user",
    content: m.content,
  }));

  // Build language instruction if non-English
  const langCode = ctx.language || "en";
  const langInstruction = langCode !== "en"
    ? `\n\nIMPORTANT: This customer prefers ${langCode}. Respond ONLY in that language.`
    : "";

  try {
    const response = await invokeLLM({
      messages: [
        { role: "system", content: BRAND_SYSTEM_PROMPT + langInstruction },
        ...recentHistory,
        {
          role: "user",
          content: `The lead sent an off-script reply that doesn't match what we expected.

Lead name: ${firstName}
Current stage: ${stage}
Quoted price: $${quotedPrice}
Service: ${serviceType}${extrasContext ? `\nSelected add-ons: ${extrasContext}` : ""}
Lead's message: "${leadReply}"

Instructions:
1. Respond naturally to their message in 1-2 sentences max
2. If they asked a question about a selected add-on, confirm we will take care of it
3. If they asked a question, answer it briefly (or say our team will cover it on the call)
4. End your reply by gently steering back: ${nextAction}
5. Keep total reply under 200 characters
6. Do NOT repeat information already sent`,
        },
      ],
    });

    const content = response.choices?.[0]?.message?.content;
    const text = typeof content === "string" ? content.trim() : "";

    if (text) {
      return { reply: text, shouldAdvanceStage: false };
    }

    return { reply: buildFallbackOffScript(nextAction), shouldAdvanceStage: false };
  } catch (err) {
    console.error("[AI] handleOffScriptReply failed:", err);
    return { reply: buildFallbackOffScript(nextAction), shouldAdvanceStage: false };
  }
}

// ─── Objection Handler ────────────────────────────────────────────────────────

export type ObjectionType = "price_too_high" | "not_available" | "need_to_think" | "already_have_cleaner" | "future_booking" | "other";

export interface ObjectionResult {
  reply: string;
  nextStage: "AVAILABILITY" | "SLOT_CHOICE" | "DONE" | "FUTURE_BOOKING" | null; // null = stay on current stage
}

/**
 * Detects and handles common sales objections.
 */
export async function handleObjection(
  objectionType: ObjectionType,
  ctx: { leadName: string; quotedPrice: string; serviceType: string; language?: string | null }
): Promise<ObjectionResult> {
  const firstName = ctx.leadName.split(" ")[0] ?? ctx.leadName;
  const langCode = ctx.language || "en";
  const langInstruction = langCode !== "en"
    ? `\n\nIMPORTANT: This customer prefers ${langCode}. Respond ONLY in that language.`
    : "";

  const objectionPrompts: Record<ObjectionType, string> = {
    price_too_high: `The lead thinks the price of $${ctx.quotedPrice} is too high. Acknowledge their concern, briefly justify the value (professional team, insured, satisfaction guarantee), and offer to discuss options on the confirmation call. End with the availability question.`,
    not_available: `The lead said the offered dates don't work. Acknowledge this, tell them we have other openings and our team can find a time that works, and ask them to share what days/times work best for them.`,
    need_to_think: `The lead said they need to think about it. Acknowledge this warmly, create gentle urgency (slots fill up), and ask if they'd like to tentatively hold a spot.`,
    already_have_cleaner: `The lead mentioned they already have a cleaner. Acknowledge this, briefly differentiate Maids in Black (insured, professional, satisfaction guarantee), and offer a first-clean trial at the quoted price.`,
    future_booking: `The lead said they won't need the service until a future date (weeks or months away). Acknowledge their timeline warmly and positively — do NOT push for an immediate slot. Tell them we'd love to help when the time comes, and ask them to reach back out when they're ready or offer to make a note and follow up. Keep it warm and low-pressure. Do NOT mention current availability or ask them to book now.`,
    other: `The lead sent an unclear or unexpected message. Respond warmly and ask how you can help them get their home cleaned.`,
  };

  try {
    const response = await invokeLLM({
      messages: [
        { role: "system", content: BRAND_SYSTEM_PROMPT + langInstruction },
        {
          role: "user",
          content: `Handle this sales objection for lead ${firstName}. Keep reply under 200 characters.\n\n${objectionPrompts[objectionType]}`,
        },
      ],
    });

    const content = response.choices?.[0]?.message?.content;
    const text = typeof content === "string" ? content.trim() : "";

    if (text) {
      // For future_booking, advance the stage so the lead is tagged correctly
      const nextStage = objectionType === "future_booking" ? "FUTURE_BOOKING" : null;
      return { reply: text, nextStage };
    }
  } catch (err) {
    console.error("[AI] handleObjection failed:", err);
  }

  // Fallback responses per objection type
  const fallbacks: Record<ObjectionType, string> = {
    price_too_high: `We totally understand! Our team is fully insured and we guarantee your satisfaction. We can discuss options on your confirmation call — would one of our upcoming openings work for you?`,
    not_available: `No problem! We have other openings too. What days/times generally work best for you?`,
    need_to_think: `Of course, take your time! Just a heads up — our slots do fill up quickly. Would you like to tentatively hold one of our upcoming openings?`,
    already_have_cleaner: `That's great! We'd love to show you what we can do — many of our regulars switched after just one clean. Want to try us for this one?`,
    future_booking: `That's perfect — we'd love to help when the time comes! Just reach back out when you're ready and we'll get you all set. 🏠`,
    other: `Thanks for reaching out! How can we help get your home sparkling clean? 🏠`,
  };

  // For future_booking, advance the stage even in fallback path
  const fallbackNextStage = objectionType === "future_booking" ? "FUTURE_BOOKING" as const : null;
  return { reply: fallbacks[objectionType], nextStage: fallbackNextStage };
}

// ─── Objection Detector ───────────────────────────────────────────────────────

/**
 * Uses ChatGPT to classify whether a lead reply is an objection and what type.
 */
export async function detectObjection(leadReply: string): Promise<ObjectionType | null> {
  try {
    const response = await invokeLLM({
      messages: [
        {
          role: "system",
          content: `Classify the following SMS reply from a home cleaning lead. Respond with ONLY one of these exact values:
- "price_too_high" — if they mention price is too much, expensive, can't afford, etc.
- "not_available" — if they say the offered times don't work for them
- "need_to_think" — if they say they need to think, not sure, maybe later, etc.
- "already_have_cleaner" — if they mention having a cleaner already
- "future_booking" — if they express interest but for a future date that is weeks or months away (e.g. "early May", "next month", "in a few weeks", "after the holidays", "when I move in", "not until summer")
- "off_script" — if it's a question or comment that doesn't fit the above
- "on_track" — if the reply is a normal response continuing the booking flow

IMPORTANT: "future_booking" takes priority over "need_to_think" when the lead mentions a specific future timeframe.

Reply with ONLY the classification word, nothing else.`,
        },
        { role: "user", content: `Lead reply: "${leadReply}"` },
      ],
    });

    const content = response.choices?.[0]?.message?.content;
    const classification = typeof content === "string" ? content.trim().toLowerCase() : "";

    if (classification === "on_track" || classification === "off_script") return null;

    const objectionTypes: ObjectionType[] = [
      "price_too_high",
      "not_available",
      "need_to_think",
      "already_have_cleaner",
      "future_booking",
    ];

    return objectionTypes.includes(classification as ObjectionType)
      ? (classification as ObjectionType)
      : null;
  } catch {
    return null;
  }
}

// ─── Post-Booking AI Handler ───────────────────────────────────────────────────────────────────

export interface PostBookingContext {
  stage: "DONE" | "CALL_SCHEDULED";
  leadName: string;
  quotedPrice: string;
  serviceType: string;
  selectedSlot?: string | null;
  address?: string | null;
  messageHistory: Array<{ role: "assistant" | "user"; content: string }>;
  leadReply: string;
  extrasContext?: string | null;
  language?: string | null;
}

/**
 * Handles replies after the booking is confirmed (DONE / CALL_SCHEDULED stages).
 * The AI knows the booking is locked in and responds naturally to follow-up questions,
 * concerns about the call, or anything else the lead sends.
 */
export async function handlePostBookingReply(ctx: PostBookingContext): Promise<string> {
  const { stage, leadName, quotedPrice, serviceType, selectedSlot, address, messageHistory, leadReply, extrasContext } = ctx;
  const firstName = leadName.split(" ")[0] ?? leadName;

  const bookingContext = [
    selectedSlot ? `Scheduled slot: ${selectedSlot}` : null,
    address ? `Address: ${address}` : null,
    extrasContext ? `Selected add-ons: ${extrasContext}` : null,
  ].filter(Boolean).join("\n");

  const stageNote = stage === "CALL_SCHEDULED"
    ? "The booking is confirmed and a confirmation call was requested. The team is aware and will call shortly."
    : "The booking process is complete. The team is aware of this appointment.";

  const recentHistory = messageHistory.slice(-6).map(m => ({
    role: m.role as "assistant" | "user",
    content: m.content,
  }));

  const langCode2 = ctx.language || "en";
  const langInstruction2 = langCode2 !== "en"
    ? `\n\nIMPORTANT: This customer prefers ${langCode2}. Respond ONLY in that language.`
    : "";

  try {
    const response = await invokeLLM({
      messages: [
        { role: "system", content: BRAND_SYSTEM_PROMPT + langInstruction2 },
        ...recentHistory,
        {
          role: "user",
          content: `The lead has replied after their booking was confirmed. Respond naturally and helpfully.

Lead name: ${firstName}
Service: ${serviceType} — $${quotedPrice}
${bookingContext}
Status: ${stageNote}
Lead's message: "${leadReply}"

Instructions:
1. Respond warmly and naturally in 1-2 sentences — you know their booking is confirmed
2. If they say they didn't get a call, apologize briefly and reassure them the team will be in touch very shortly
3. If they ask about timing/arrival, give a warm reassurance that the team will confirm details on the call
4. If they have a question about their add-ons, confirm we have them noted
5. Keep reply under 200 characters
6. Do NOT ask them to re-book or repeat the booking flow`,
        },
      ],
    });

    const content = response.choices?.[0]?.message?.content;
    const text = typeof content === "string" ? content.trim() : "";
    if (text) return text;
  } catch (err) {
    console.error("[AI] handlePostBookingReply failed:", err);
  }

  // Fallback — still much better than the old static message
  if (leadReply.toLowerCase().includes("call") || leadReply.toLowerCase().includes("didn't") || leadReply.toLowerCase().includes("waiting")) {
    return `So sorry about that, ${firstName}! Our team will be in touch with you very shortly. 📞`;
  }
  return `Hi ${firstName}! Your booking is all set — our team will be in touch shortly to confirm the details. 🏠✨`;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────────────────────

function buildFallbackQuoteMessage(
  firstName: string,
  bedrooms: string,
  bathrooms: string,
  serviceType: string,
  price: string,
  extras?: string[]
): string {
  const resolvedExtras = extras && extras.length > 0 ? resolveExtras(extras) : [];
  const extrasTotal = resolvedExtras.reduce((sum, e) => sum + e.price, 0);
  const basePrice = parseInt(price, 10) || 0;
  const grandTotal = basePrice + extrasTotal;

  if (resolvedExtras.length === 0) {
    return `Hi ${firstName}! Madison here, thanks for reaching out to Maids in Black. Your ${serviceType} quote for a ${bedrooms} / ${bathrooms} home is $${price} — our fully insured team handles everything.`;
  }

  const extrasLines = resolvedExtras
    .map(e => `  + ${e.label}: $${e.price}`)
    .join("\n");

  return `Hi ${firstName}! Madison here, thanks for reaching out to Maids in Black.\n\nYour quote:\n  ${serviceType} (${bedrooms} / ${bathrooms}): $${price}\n${extrasLines}\n  ─────────────\n  Total: $${grandTotal}\n\nOur fully insured team handles everything — including your selected add-ons!`;
}

function buildFallbackOffScript(nextAction: string): string {
  return `Great question — our team can cover that on your confirmation call! ${nextAction}`;
}

function getNextActionPrompt(stage: string, selectedSlot?: string | null): string {
  switch (stage) {
    case "QUOTE_SENT":
    case "AVAILABILITY":
      return formatAvailabilityQuestion(getNextAvailableSlots(2));
    case "SLOT_CHOICE":
      return formatSlotChoiceQuestion(getNextAvailableSlots(2));
    case "ADDRESS":
      return `What's the address for the cleaning${selectedSlot ? ` on ${selectedSlot}` : ""}?`;
    case "CONFIRMATION":
      return "Should we call you now or in a few minutes to confirm?";
    default:
      return "How can we help you today?";
  }
}
