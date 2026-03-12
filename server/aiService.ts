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

// ─── Brand System Prompt ──────────────────────────────────────────────────────

const BRAND_SYSTEM_PROMPT = `You are the AI assistant for Maids in Black, a professional home cleaning service serving the Washington DC Metro Area (DC, MD, VA).

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
4. NEVER go off-topic (politics, personal opinions, unrelated topics). If asked, politely redirect.
5. NEVER be rude or dismissive, even if the lead is.
6. NEVER send more than one message at a time. Keep it to a single SMS reply.
7. ALWAYS steer back toward booking. Every off-script response should end with a gentle nudge toward the next step.
8. If you don't know the answer to a specific question, say "Great question — our team can answer that on your confirmation call."

WHAT WE OFFER:
- Standard Cleaning: Regular maintenance cleaning
- Deep Cleaning: Thorough top-to-bottom clean (recommended for first-time customers)
- Move-In / Move-Out Cleaning: Complete clean for transitions
- Post-Construction Cleaning: Heavy-duty debris and dust removal
- Office Cleaning: Commercial spaces
- Recurring Service: Weekly, bi-weekly, or monthly at a discount

SERVICE AREA: Washington DC, Maryland, Virginia (DC Metro Area)

PRICING CONTEXT: Prices are based on bedroom/bathroom count and service type. Always present the price as a value, not just a number.`;

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

  try {
    const response = await invokeLLM({
      messages: [
        { role: "system", content: BRAND_SYSTEM_PROMPT },
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

export type ObjectionType = "price_too_high" | "not_available" | "need_to_think" | "already_have_cleaner" | "other";

export interface ObjectionResult {
  reply: string;
  nextStage: "AVAILABILITY" | "SLOT_CHOICE" | "DONE" | null; // null = stay on current stage
}

/**
 * Detects and handles common sales objections.
 */
export async function handleObjection(
  objectionType: ObjectionType,
  ctx: { leadName: string; quotedPrice: string; serviceType: string }
): Promise<ObjectionResult> {
  const firstName = ctx.leadName.split(" ")[0] ?? ctx.leadName;

  const objectionPrompts: Record<ObjectionType, string> = {
    price_too_high: `The lead thinks the price of $${ctx.quotedPrice} is too high. Acknowledge their concern, briefly justify the value (professional team, insured, satisfaction guarantee), and offer to discuss options on the confirmation call. End with the availability question.`,
    not_available: `The lead said the offered dates don't work. Acknowledge this, tell them we have other openings and our team can find a time that works, and ask them to share what days/times work best for them.`,
    need_to_think: `The lead said they need to think about it. Acknowledge this warmly, create gentle urgency (slots fill up), and ask if they'd like to tentatively hold a spot.`,
    already_have_cleaner: `The lead mentioned they already have a cleaner. Acknowledge this, briefly differentiate Maids in Black (insured, professional, satisfaction guarantee), and offer a first-clean trial at the quoted price.`,
    other: `The lead sent an unclear or unexpected message. Respond warmly and ask how you can help them get their home cleaned.`,
  };

  try {
    const response = await invokeLLM({
      messages: [
        { role: "system", content: BRAND_SYSTEM_PROMPT },
        {
          role: "user",
          content: `Handle this sales objection for lead ${firstName}. Keep reply under 200 characters.\n\n${objectionPrompts[objectionType]}`,
        },
      ],
    });

    const content = response.choices?.[0]?.message?.content;
    const text = typeof content === "string" ? content.trim() : "";

    if (text) {
      return { reply: text, nextStage: null };
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
    other: `Thanks for reaching out! How can we help get your home sparkling clean? 🏠`,
  };

  return { reply: fallbacks[objectionType], nextStage: null };
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
- "off_script" — if it's a question or comment that doesn't fit the above
- "on_track" — if the reply is a normal response continuing the booking flow

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
    ];

    return objectionTypes.includes(classification as ObjectionType)
      ? (classification as ObjectionType)
      : null;
  } catch {
    return null;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

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
