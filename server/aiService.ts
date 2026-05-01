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
import { getFlowTemplate } from "./settingsRouter";
import { buildPricingSummary, PRICING_TABLE, calculatePrice, calculateRecurringPrice, RECURRING_DISCOUNTS } from "./engine/pricing";

// ─── Brand System Prompt ──────────────────────────────────────────────────────
// ─── Layer 1: get_price Tool Call ─────────────────────────────────────────────
/**
 * The LLM is given this tool so it NEVER calculates prices itself.
 * When the lead asks any pricing question, the model calls get_price().
 * We execute the function locally (deterministic, from pricing.ts) and feed
 * the result back. The model then formats the message around the verified number.
 */
const GET_PRICE_TOOL = {
  type: "function" as const,
  function: {
    name: "get_price",
    description: "Look up the exact price for a cleaning service. ALWAYS call this tool when you need to mention any dollar amount. NEVER calculate or estimate prices yourself.",
    parameters: {
      type: "object",
      properties: {
        bedrooms: {
          type: "string",
          description: "Number of bedrooms, e.g. '2 Bedrooms', '1 Bedroom', 'Studio'",
        },
        bathrooms: {
          type: "string",
          description: "Number of bathrooms, e.g. '2 Bathrooms', '1.5 Bathrooms'",
        },
        serviceType: {
          type: "string",
          description: "Service type: 'Standard Cleaning', 'Deep Cleaning', 'Move-In/Move-Out', 'Post-Construction Cleaning'",
        },
        frequency: {
          type: "string",
          enum: ["one_time", "weekly", "biweekly", "monthly"],
          description: "Frequency: one_time for a single clean, or weekly/biweekly/monthly for recurring",
        },
      },
      required: ["bedrooms", "bathrooms", "serviceType", "frequency"],
      additionalProperties: false,
    },
  },
};

/**
 * Executes the get_price tool call locally using the deterministic pricing engine.
 * Returns a human-readable string like "$209/clean (15% off for bi-weekly)".
 */
function executePriceTool(args: {
  bedrooms: string;
  bathrooms: string;
  serviceType: string;
  frequency: "one_time" | "weekly" | "biweekly" | "monthly";
}): string {
  const { bedrooms, bathrooms, serviceType, frequency } = args;
  const basePrice = calculatePrice(bedrooms, bathrooms, serviceType);
  if (frequency === "one_time") {
    return `$${basePrice} (one-time ${serviceType})`;
  }
  const freqKey = frequency as keyof typeof RECURRING_DISCOUNTS;
  const discountedPrice = calculateRecurringPrice(basePrice, freqKey);
  const pct = RECURRING_DISCOUNTS[freqKey].pct;
  const label = RECURRING_DISCOUNTS[freqKey].label;
  return `$${discountedPrice}/clean (${pct}% off for ${label} recurring — base was $${basePrice})`;
}

/**
 * Two-pass LLM invocation with get_price tool support.
 *
 * Pass 1: LLM receives the messages + the get_price tool.
 *   - If the model calls get_price, we execute it locally and do Pass 2.
 *   - If the model replies directly (no tool call), we return that text.
 *
 * Pass 2: We append the tool result and call the LLM again for the final text.
 *
 * This ensures the LLM NEVER calculates prices — it only formats verified numbers.
 */
async function invokeLLMWithPriceTool(
  messages: Array<{ role: "system" | "user" | "assistant" | "tool"; content: string; tool_call_id?: string; name?: string }>,
  fallbackBedrooms?: string | null,
  fallbackBathrooms?: string | null,
  fallbackServiceType?: string,
): Promise<string> {
  // Pass 1: offer the tool
  const pass1 = await invokeLLM({
    messages,
    tools: [GET_PRICE_TOOL],
    toolChoice: "auto",
  });

  const pass1Message = pass1.choices?.[0]?.message;
  const toolCalls = pass1Message?.tool_calls;

  // No tool call — model replied directly (conversational, no price needed)
  if (!toolCalls || toolCalls.length === 0) {
    const text = typeof pass1Message?.content === "string" ? pass1Message.content.trim() : "";
    return text;
  }

  // Execute all tool calls (usually just one)
  const toolResultMessages: Array<{ role: "tool"; content: string; tool_call_id: string; name: string }> = [];
  for (const tc of toolCalls) {
    let result: string;
    try {
      const rawArgs = JSON.parse(tc.function.arguments) as {
        bedrooms?: string;
        bathrooms?: string;
        serviceType?: string;
        frequency?: string;
      };
      // Fall back to context values if the model omitted them
      const resolvedArgs = {
        bedrooms: rawArgs.bedrooms ?? fallbackBedrooms ?? "2 Bedrooms",
        bathrooms: rawArgs.bathrooms ?? fallbackBathrooms ?? "2 Bathrooms",
        serviceType: rawArgs.serviceType ?? fallbackServiceType ?? "Standard Cleaning",
        frequency: (rawArgs.frequency ?? "one_time") as "one_time" | "weekly" | "biweekly" | "monthly",
      };
      result = executePriceTool(resolvedArgs);
    } catch (err) {
      result = "Price lookup failed — use the pricing table in the system context.";
    }
    toolResultMessages.push({
      role: "tool",
      content: result,
      tool_call_id: tc.id,
      name: tc.function.name,
    });
  }

  // Pass 2: feed tool results back and get the final reply
  const pass2Messages = [
    ...messages,
    // The assistant's tool-call turn (content may be null — normalize to empty string)
    {
      role: "assistant" as const,
      content: typeof pass1Message?.content === "string" ? pass1Message.content : "",
      tool_calls: toolCalls,
    },
    ...toolResultMessages,
  ];

  const pass2 = await invokeLLM({ messages: pass2Messages as any });
  const finalContent = pass2.choices?.[0]?.message?.content;
  return typeof finalContent === "string" ? finalContent.trim() : "";
}

// ─── Layer 2: Post-generation Price Validator ──────────────────────────────────
/**
 * Builds the complete set of valid dollar amounts for a given lead.
 * Any price the AI mentions MUST appear in this set.
 *
 * Includes:
 * - One-time price for the lead's home + service
 * - All three recurring tier prices (weekly, biweekly, monthly)
 * - Standard cleaning prices (for when serviceType has a surcharge)
 * - Common add-on amounts ($0, $30 bath add-on, $60 surcharge)
 *
 * Returns null if home size is unknown (validation is skipped).
 */
function buildValidPriceSet(
  bedrooms: string | null | undefined,
  bathrooms: string | null | undefined,
  serviceType: string,
  quotedPrice: string,
): Set<number> | null {
  if (!bedrooms || !bathrooms) return null;

  const oneTime = calculatePrice(bedrooms, bathrooms, serviceType);
  const weekly = calculateRecurringPrice(oneTime, "weekly");
  const biweekly = calculateRecurringPrice(oneTime, "biweekly");
  const monthly = calculateRecurringPrice(oneTime, "monthly");

  // Also allow standard cleaning prices (no surcharge) so context mentions are valid
  const standardOneTime = calculatePrice(bedrooms, bathrooms, "Standard Cleaning");
  const standardWeekly = calculateRecurringPrice(standardOneTime, "weekly");
  const standardBiweekly = calculateRecurringPrice(standardOneTime, "biweekly");
  const standardMonthly = calculateRecurringPrice(standardOneTime, "monthly");

  // Allow the quoted price as-is (may be a manually set override)
  const quoted = parseInt(quotedPrice, 10);

  return new Set([
    oneTime, weekly, biweekly, monthly,
    standardOneTime, standardWeekly, standardBiweekly, standardMonthly,
    // Surcharges and add-ons that may legitimately appear in a reply
    0, 30, 60,
    ...(isNaN(quoted) ? [] : [quoted]),
  ]);
}

/**
 * Scans a generated SMS reply for dollar amounts and verifies each one is in
 * the valid price set for this lead.
 *
 * Returns true if all prices are valid (or if validation cannot be performed).
 * Returns false if any price is invalid — the caller should retry or fall back.
 */
function validatePriceInReply(
  text: string,
  bedrooms: string | null | undefined,
  bathrooms: string | null | undefined,
  serviceType: string,
  quotedPrice: string,
): boolean {
  const validSet = buildValidPriceSet(bedrooms, bathrooms, serviceType, quotedPrice);
  if (!validSet) return true; // can't validate without home size — pass through

  // Extract all $NNN patterns from the text
  const matches = text.match(/\$(\d+)/g) ?? [];
  if (matches.length === 0) return true; // no prices mentioned — nothing to validate

  for (const match of matches) {
    const amount = parseInt(match.replace("$", ""), 10);
    if (!validSet.has(amount)) {
      console.warn(
        `[PriceValidator] INVALID price $${amount} in reply. Valid set: [${Array.from(validSet).sort((a, b) => a - b).join(", ")}]. Reply: "${text.slice(0, 120)}"`
      );
      return false;
    }
  }
  return true;
}


const BRAND_SYSTEM_PROMPT = `You are Jade, the AI assistant for Maids in Black, a professional home cleaning service serving the Washington DC Metro Area (DC, MD, VA).

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
 * Generates the initial quote SMS (SMS 1 in the new Jade flow).
 * Jade greets the lead and asks what day they're thinking — no price in this message.
 * Price is revealed in SMS 2 after the lead replies with a day.
 */
export async function generateQuoteMessage(params: QuoteMessageParams): Promise<string> {
  const { leadName, bedrooms, bathrooms, serviceType, price } = params;
  const rawFirst = leadName.split(" ")[0] ?? leadName;
  // Normalize to title case so ROHAN → Rohan, rohan → Rohan
  const firstName = rawFirst.charAt(0).toUpperCase() + rawFirst.slice(1).toLowerCase();
  return getFlowTemplate(
    "flowB_sms1",
    buildFallbackQuoteMessage(firstName),
    {
      "{firstName}": firstName,
      "{bedrooms}": bedrooms ?? "",
      "{bathrooms}": bathrooms ?? "",
      "{serviceType}": serviceType ?? "",
      "{price}": price ?? "",
    }
  );
}

/**
 * Generates SMS 2 in the new Jade flow: price reveal + supplies note + 9am/1pm offer.
 * Called from the AVAILABILITY stage handler when the lead replies with a specific day.
 */
/** Normalize any casing to Title Case: "ROHAN" → "Rohan", "rohan" → "Rohan" */
function toTitleCase(str: string): string {
  return str
    .trim()
    .split(/\s+/)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

export async function buildJadePriceReveal(params: {
  firstName: string;
  bedrooms: string;
  bathrooms: string;
  price: string;
  extras?: string[] | null;
  day: string; // the specific day the lead mentioned
  quoteLink?: string; // optional personalized quote page URL
}): Promise<string> {
  const { firstName, bedrooms, bathrooms, price, extras, day, quoteLink } = params;
  const normalizedFirstName = toTitleCase(firstName);
  const resolvedExtras = extras && extras.length > 0 ? resolveExtras(extras) : [];
  const extrasTotal = resolvedExtras.reduce((sum, e) => sum + e.price, 0);
  const basePrice = parseInt(price, 10) || 0;
  const grandTotal = basePrice + extrasTotal;
  // totalDisplay has $ prefix for the fallback string; priceForTemplate is just the number
  // because the DB template already has "$" before the {price} placeholder.
  const totalDisplay = grandTotal > basePrice ? `$${grandTotal}` : `$${price}`;
  const priceForTemplate = grandTotal > basePrice ? `${grandTotal}` : `${price}`;

  // Build inline extras note: "(including cleaning inside your oven, load of laundry)"
  const extrasLine = resolvedExtras.length > 0
    ? ` (including ${resolvedExtras.map(e => e.label.toLowerCase()).join(", ")})`
    : "";

  // Recurring price = one-time price minus 15% discount, rounded to nearest dollar.
  // The DB template uses {recurringprice} — just the number, "$" is in the template.
  // Also handle the typo variant $(recurringprice} that may appear in saved scripts.
  const recurringPriceNum = Math.round((grandTotal > basePrice ? grandTotal : basePrice) * 0.85);
  const recurringPriceForTemplate = `${recurringPriceNum}`;

  const fallback = `Perfect. We handle a lot of ${bedrooms} bed / ${bathrooms} bath homes — no problem at all.\n\nJust so you know upfront: we bring all our own supplies and get everything done in one visit. Kitchens, bathrooms, floors, surfaces — the works. 🧹\n\nFor a home like yours, most clients land around ${totalDisplay}. That covers everything, no hidden fees or surprises${extrasLine}.\n\nI've got ${day} at 9am or 1pm — which one should I lock in?`;

  // Use template from DB; substitute dynamic values.
  // NOTE: {price} in the DB template already has "$" before it, so pass the number only.
  const template = await getFlowTemplate(
    "flowB_sms2",
    fallback,
    {
      "{firstName}": normalizedFirstName,
      "{bedrooms}": bedrooms,
      "{bathrooms}": bathrooms,
      "{price}": priceForTemplate,
      // ${price} — dollar-sign prefixed variant (DB template may use either form)
      "${price}": `$${priceForTemplate}`,
      "{recurringprice}": recurringPriceForTemplate,
      "$(recurringprice}": recurringPriceForTemplate,
      // ${recurringprice} — user-friendly format where $ is part of the placeholder
      // We substitute the whole thing including the $ so the output already has the dollar sign
      "${recurringprice}": `$${recurringPriceForTemplate}`,
      "{day}": day,
      "{extrasLine}": extrasLine,
      // {quoteLink} — replaced with the personalized quote page URL if available,
      // otherwise removed so the template reads cleanly without a broken placeholder.
      "{quoteLink}": quoteLink ?? "",
    }
  );
  return template;
}

/**
 * @deprecated — kept for backwards compatibility with Bark/widget flows.
 * The new Jade quote form flow uses buildJadePriceReveal() instead.
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
  /** Bedrooms from the lead's quote — used to build a precise pricing summary */
  bedrooms?: string | null;
  /** Bathrooms from the lead's quote — used to build a precise pricing summary */
  bathrooms?: string | null;
  selectedSlot?: string | null;
  messageHistory: Array<{ role: "assistant" | "user"; content: string }>;
  leadReply: string;
  /** Extras the lead selected on the quote form (human-readable labels) */
  extrasContext?: string | null;
}

export interface OffScriptResult {
  reply: string;
  shouldAdvanceStage: boolean; // true if the AI thinks the lead is ready to continue
  isWrongPath: boolean;        // true if this person is NOT a new booking lead (existing customer, support request, wrong number)
}

/**
 * Classifies whether a reply is from someone who is NOT a new booking lead.
 * Returns true for: existing customers needing support, reschedule/cancel requests,
 * wrong number, "I already booked", "I need help with my account", etc.
 * Returns false for: FAQs, pricing questions, hesitation, objections — all still in-funnel.
 */
async function isWrongPathReply(leadReply: string): Promise<boolean> {
  try {
    const response = await invokeLLM({
      messages: [
        {
          role: "system",
          content: `You are a classifier. Determine if the message is from someone who is NOT a new booking lead.

Return JSON: { "wrong_path": true } or { "wrong_path": false }

Return true ONLY if the message clearly indicates:
- They are an EXISTING customer needing support (reschedule, cancel, complaint, account help)
- They received this message by mistake / wrong number
- They are asking about a booking they already made
- They explicitly say they don't need a new cleaning and need customer service instead

Return false for:
- Questions about pricing, services, availability, what's included
- Hesitation or "I'm not sure yet"
- General curiosity about the company
- Anything that could still lead to a new booking`,
        },
        { role: "user", content: `Message: "${leadReply}"` },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "wrong_path_classification",
          strict: true,
          schema: {
            type: "object",
            properties: { wrong_path: { type: "boolean" } },
            required: ["wrong_path"],
            additionalProperties: false,
          },
        },
      },
    });
    const raw = response.choices?.[0]?.message?.content;
    if (typeof raw === "string") {
      const parsed = JSON.parse(raw);
      return parsed.wrong_path === true;
    }
  } catch (err) {
    console.error("[AI] isWrongPathReply classification failed:", err);
  }
  return false; // default to in-funnel on failure
}

/**
 * Handles off-script replies (FAQs, objections, random questions).
 *
 * Three outcomes:
 * 1. wrong_path (existing customer / support request / wrong number)
 *    → warm exit message with support contact, isWrongPath: true
 * 2. FAQ / curiosity / hesitation (still a potential new booking lead)
 *    → answer + steer back to current stage question, isWrongPath: false
 *
 * Falls back to a safe generic response if AI fails.
 */
export async function handleOffScriptReply(ctx: OffScriptContext): Promise<OffScriptResult> {
  const { stage, leadName, quotedPrice, serviceType, bedrooms, bathrooms, selectedSlot, messageHistory, leadReply, extrasContext } = ctx;
  const firstName = leadName.split(" ")[0] ?? leadName;

  // ── Step 1: Classify — is this person NOT a new booking lead? ────────────────
  const wrongPath = await isWrongPathReply(leadReply);

  if (wrongPath) {
    // Generate a warm, helpful exit message — do NOT push booking
    try {
      const exitResponse = await invokeLLM({
        messages: [
          { role: "system", content: BRAND_SYSTEM_PROMPT },
          {
            role: "user",
            content: `The person who received this SMS is NOT a new booking lead. They need customer support or reached us by mistake.

Lead name: ${firstName}
Their message: "${leadReply}"

Instructions:
1. Acknowledge their situation warmly in 1 sentence
2. Direct them to our support team: call/text 202-888-5362 or email support@maidsinblacksupport.com
3. Do NOT ask about bedrooms, bathrooms, availability, or anything booking-related
4. Keep reply under 160 characters`,
          },
        ],
      });
      const content = exitResponse.choices?.[0]?.message?.content;
      const text = typeof content === "string" ? content.trim() : "";
      if (text) {
        return { reply: text, shouldAdvanceStage: false, isWrongPath: true };
      }
    } catch (err) {
      console.error("[AI] handleOffScriptReply wrong_path exit failed:", err);
    }
    // Fallback exit message
    return {
      reply: `Hi ${firstName}! For support with an existing booking, please call/text us at 202-888-5362 or email support@maidsinblacksupport.com. We're happy to help! 😊`,
      shouldAdvanceStage: false,
      isWrongPath: true,
    };
  }

  // ── Step 2: In-funnel — answer FAQ and steer back to current stage ────────────
  const nextAction = getNextActionPrompt(stage, selectedSlot);

  // Build conversation history for context (last 6 messages)
  const recentHistory = messageHistory.slice(-6).map(m => ({
    role: m.role as "assistant" | "user",
    content: m.content,
  }));

  // Build a precise pricing summary for this lead's home size, or fall back to the
  // full pricing table if bedrooms/bathrooms are not available. This is the single
  // source of truth — the LLM MUST NOT calculate or estimate any prices.
  const pricingBlock = (bedrooms && bathrooms)
    ? buildPricingSummary(bedrooms, bathrooms, serviceType)
    : PRICING_TABLE;

  // Build the messages array once — reused for retry if validation fails
  const offScriptMessages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
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
--- PRICING REFERENCE ---
${pricingBlock}
--- END PRICING REFERENCE ---
CRITICAL PRICING RULE: Use the get_price tool when you need to mention any dollar amount. If the lead asks about recurring plans (weekly, bi-weekly, monthly), call get_price with the correct frequency — do NOT calculate or estimate prices yourself.
Instructions:
1. Respond naturally to their message in 1-2 sentences max
2. If they asked a question about a selected add-on, confirm we will take care of it
3. If they asked a pricing question, call the get_price tool to get the exact amount, then include it in your reply
4. End your reply by gently steering back: ${nextAction}
5. Keep total reply under 200 characters
6. Do NOT repeat information already sent`,
    },
  ];

  // Layer 1 + Layer 2: tool call + post-generation validation, with one retry
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const text = await invokeLLMWithPriceTool(offScriptMessages, bedrooms, bathrooms, serviceType);
      if (!text) break;

      // Layer 2: validate every dollar amount in the reply
      if (!validatePriceInReply(text, bedrooms, bathrooms, serviceType, quotedPrice)) {
        console.warn(`[AI] handleOffScriptReply price validation failed on attempt ${attempt + 1} — ${attempt < 1 ? "retrying" : "falling back"}`);
        continue; // retry
      }

      return { reply: text, shouldAdvanceStage: false, isWrongPath: false };
    } catch (err) {
      console.error("[AI] handleOffScriptReply failed:", err);
      break;
    }
  }
  return { reply: buildFallbackOffScript(nextAction), shouldAdvanceStage: false, isWrongPath: false };
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
  ctx: { leadName: string; quotedPrice: string; serviceType: string; bedrooms?: string | null; bathrooms?: string | null }
): Promise<ObjectionResult> {
  const firstName = ctx.leadName.split(" ")[0] ?? ctx.leadName;

  // Build a precise pricing summary for this lead's home size so the LLM can quote
  // accurate recurring prices when handling price_too_high objections.
  const pricingBlock = (ctx.bedrooms && ctx.bathrooms)
    ? buildPricingSummary(ctx.bedrooms, ctx.bathrooms, ctx.serviceType)
    : PRICING_TABLE;

  const objectionPrompts: Record<ObjectionType, string> = {
    price_too_high: `The lead thinks the price of $${ctx.quotedPrice} is too high. Acknowledge their concern, briefly justify the value (professional team, insured, satisfaction guarantee), and mention that recurring plans (bi-weekly or monthly) are available at a lower rate — use ONLY the exact recurring prices from the PRICING REFERENCE below. End with the availability question.`,
    not_available: `The lead said the offered dates don't work. Acknowledge this, tell them we have other openings and our team can find a time that works, and ask them to share what days/times work best for them.`,
    need_to_think: `The lead said they need to think about it. Acknowledge this warmly, create gentle urgency (slots fill up), and ask if they'd like to tentatively hold a spot.`,
    already_have_cleaner: `The lead mentioned they already have a cleaner. Acknowledge this, briefly differentiate Maids in Black (insured, professional, satisfaction guarantee), and offer a first-clean trial at the quoted price.`,
    future_booking: `The lead said they won't need the service until a future date (weeks or months away). Acknowledge their timeline warmly and positively — do NOT push for an immediate slot. Tell them we'd love to help when the time comes, and ask them to reach back out when they're ready or offer to make a note and follow up. Keep it warm and low-pressure. Do NOT mention current availability or ask them to book now.`,
    other: `The lead sent an unclear or unexpected message. Respond warmly and ask how you can help them get their home cleaned.`,
  };

  // Only inject pricing block for price-related objections
  const pricingSection = objectionType === "price_too_high"
    ? `\n\n--- PRICING REFERENCE ---\n${pricingBlock}\n--- END PRICING REFERENCE ---\n\nCRITICAL PRICING RULE: NEVER calculate, estimate, or guess prices. ONLY use the EXACT dollar amounts shown in the PRICING REFERENCE above.`
    : "";

  const objectionMessages: Array<{ role: "system" | "user"; content: string }> = [
    { role: "system", content: BRAND_SYSTEM_PROMPT },
    {
      role: "user",
      content: `Handle this sales objection for lead ${firstName}. Keep reply under 200 characters.\n\n${objectionPrompts[objectionType]}${pricingSection}\n\nIf you need to mention a price, call the get_price tool to get the exact amount.`,
    },
  ];

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const text = await invokeLLMWithPriceTool(objectionMessages, ctx.bedrooms, ctx.bathrooms, ctx.serviceType);
      if (!text) break;

      // Layer 2: validate every dollar amount in the reply
      if (!validatePriceInReply(text, ctx.bedrooms, ctx.bathrooms, ctx.serviceType, ctx.quotedPrice)) {
        console.warn(`[AI] handleObjection price validation failed on attempt ${attempt + 1} — ${attempt < 1 ? "retrying" : "falling back"}`);
        continue;
      }

      // For future_booking, advance the stage so the lead is tagged correctly
      const nextStage = objectionType === "future_booking" ? "FUTURE_BOOKING" : null;
      return { reply: text, nextStage };
    } catch (err) {
      console.error("[AI] handleObjection failed:", err);
      break;
    }
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

  try {
    const response = await invokeLLM({
      messages: [
        { role: "system", content: BRAND_SYSTEM_PROMPT },
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

/**
 * SMS 1 in the new Jade flow: greeting + ask for day. No price yet.
 */
function buildFallbackQuoteMessage(_firstName: string): string {
  return `Awesome, we'd love to help! What day were you thinking so we can see how fast we can get you taken care of?`;
}

/**
 * SMS 1 in Flow A (Madison): price upfront + value note.
 * Sent with Madison's headshot photo as MMS.
 */
export async function buildMadisonQuoteMessage(params: QuoteMessageParams): Promise<string> {
  const { leadName, bedrooms, bathrooms, serviceType, price, extras } = params;
  const firstName = leadName.split(" ")[0] ?? leadName;
  const resolvedExtras = extras && extras.length > 0 ? resolveExtras(extras) : [];
  const extrasTotal = resolvedExtras.reduce((sum, e) => sum + e.price, 0);
  const basePrice = parseInt(price, 10) || 0;
  const grandTotal = basePrice + extrasTotal;
  const totalDisplay = resolvedExtras.length > 0 ? `$${grandTotal}` : `$${price}`;

  const fallback = resolvedExtras.length === 0
    ? `Hi ${firstName}! Madison here, thanks for reaching out to Maids in Black. Your ${serviceType} quote for a ${bedrooms} / ${bathrooms} home is $${price} — our fully insured team handles everything.`
    : `Hi ${firstName}! Madison here, thanks for reaching out to Maids in Black.\n\nYour quote:\n  ${serviceType} (${bedrooms} / ${bathrooms}): $${price}\n${resolvedExtras.map(e => `  + ${e.label}: $${e.price}`).join("\n")}\n  ─────────────\n  Total: $${grandTotal}\n\nOur fully insured team handles everything — including your selected add-ons!`;

  return getFlowTemplate(
    "flowA_sms1",
    fallback,
    {
      "{firstName}": firstName,
      "{serviceType}": serviceType,
      "{bedrooms}": bedrooms,
      "{bathrooms}": bathrooms,
      "{price}": totalDisplay,
    }
  );
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
    case "TIME_PREF":
      return `Would morning or afternoon work better for you${selectedSlot ? ` on ${selectedSlot}` : ""}?`;
    case "ADDRESS":
      return `What's the address for the cleaning${selectedSlot ? ` on ${selectedSlot}` : ""}?`;
    case "CONFIRMATION":
      return "Should we call you now or in a few minutes to confirm?";
    case "WIDGET_SIZING":
      return "How many bedrooms and bathrooms does your home have? (e.g. 3 bed / 2 bath)";
    default:
      return "How can we help you today?";
  }
}
