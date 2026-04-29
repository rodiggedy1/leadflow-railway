/**
 * Reply Prompt Builder — Step 3 of the two-step engine.
 *
 * At this point the stage transition has ALREADY been decided by advanceStage.ts.
 * The LLM's only job here is to generate a natural, on-brand SMS reply that:
 * 1. Answers any questions the lead asked
 * 2. Confirms what was decided (slot, address, etc.)
 * 3. Asks for whatever is needed next (if anything)
 *
 * The LLM cannot change the stage. It only writes the message.
 */

import type { ConversationContext } from "../conversationEngine";
import type { LeadSignals } from "./extractSchema";
import type { AdvanceResult } from "./advanceStage";
import { MAIDS_IN_BLACK_KNOWLEDGE_BASE } from "../knowledgeBase";
import { buildPricingSummary, PRICING_TABLE } from "./pricing";

export function buildReplyPrompt(
  ctx: ConversationContext,
  signals: LeadSignals,
  advance: AdvanceResult,
  todayDate: string,
): string {
  const persona = ctx.smsFlow === "B" ? "Jade" : "Madison";
  const firstName = ctx.leadName?.split(" ")[0] ?? ctx.leadName ?? "there";
  const { nextStage, persistedData, replyContext } = advance;

  // Build pricing context
  const bedroomsForPricing  = persistedData.bedrooms  ?? ctx.bedrooms;
  const bathroomsForPricing = persistedData.bathrooms ?? ctx.bathrooms;
  let pricingContext = PRICING_TABLE;
  if (bedroomsForPricing && bathroomsForPricing) {
    pricingContext += `\n\nPRICING FOR THIS LEAD (${bedroomsForPricing} / ${bathroomsForPricing}):\n${buildPricingSummary(bedroomsForPricing, bathroomsForPricing, persistedData.serviceType ?? ctx.serviceType ?? "Standard Cleaning")}`;
  }

  const slot    = persistedData.selectedSlot ?? ctx.selectedSlot;
  const address = persistedData.address      ?? ctx.address;
  const price   = persistedData.quotedPrice  ?? ctx.quotedPrice;

  // Build the "what happened" summary for the LLM
  const decisionsText = buildDecisionSummary(ctx.stage, nextStage, persistedData, replyContext, signals);

  // Build the "what to say next" instruction
  const nextAskText = buildNextAskInstruction(nextStage, ctx, persistedData, persona, firstName, price);

  return `You are ${persona}, the AI booking assistant for Maids in Black — a professional home cleaning service in the Washington DC Metro Area.

## YOUR ROLE
Write a single SMS reply to send to ${firstName}. Be warm, professional, and concise (1-3 sentences max).

## BRAND VOICE
- Friendly but professional — like a helpful concierge
- Confident and reassuring
- Concise — SMS messages must be SHORT
- Never use ALL CAPS or excessive punctuation
- One emoji maximum per message, only when natural
- ALWAYS respond in the SAME LANGUAGE the lead is writing in

## STRICT RULES
1. NEVER make up prices. Only use prices from the pricing table.
2. NEVER promise specific cleaners, arrival times, or guarantees not in the knowledge base.
3. If the lead is an existing customer needing support, give them: 📞 202-888-5362 or support@maidsinblacksupport.com
4. Use the knowledge base to answer questions accurately.

## TODAY'S DATE
${todayDate} (Eastern Time)

## WHAT JUST HAPPENED (stage transition already decided — do NOT change it)
${decisionsText}

## WHAT TO SAY NEXT
${nextAskText}

${signals.questions.length > 0 ? `## QUESTIONS TO ANSWER FIRST
The lead asked: ${signals.questions.join("; ")}
Answer these briefly BEFORE moving to the next ask. Keep the total message under 3 sentences.` : ""}

${persistedData.specialScope ? `## SPECIAL SCOPE NOTE
The lead said: "${persistedData.specialScope}". Acknowledge this warmly and let them know the team will be briefed.` : ""}

## PRICING TABLE
${pricingContext}

## BUSINESS KNOWLEDGE BASE
${MAIDS_IN_BLACK_KNOWLEDGE_BASE}

## OUTPUT
Return ONLY the SMS text to send. No JSON, no explanation, no markdown. Just the message.`;
}

function buildDecisionSummary(
  fromStage: string,
  toStage: string,
  persisted: AdvanceResult["persistedData"],
  replyCtx: AdvanceResult["replyContext"],
  signals: LeadSignals,
): string {
  const lines: string[] = [`Stage transition: ${fromStage} → ${toStage}`];

  if (persisted.selectedSlot) {
    if (replyCtx.usedDefault) {
      lines.push(`Slot: ${persisted.selectedSlot} (you picked this default because the lead was flexible — confirm it warmly)`);
    } else {
      lines.push(`Slot confirmed: ${persisted.selectedSlot}`);
    }
  }
  if (persisted.address)     lines.push(`Address captured: ${persisted.address}`);
  if (persisted.bedrooms)    lines.push(`Bedrooms: ${persisted.bedrooms}`);
  if (persisted.bathrooms)   lines.push(`Bathrooms: ${persisted.bathrooms}`);
  if (persisted.quotedPrice) lines.push(`Quoted price: $${persisted.quotedPrice}`);
  if (persisted.specialScope) lines.push(`Special scope: "${persisted.specialScope}" — use 1 bed/1 bath defaults`);
  if (persisted.callPreference) lines.push(`Call preference: ${persisted.callPreference}`);

  return lines.join("\n");
}

function buildNextAskInstruction(
  nextStage: string,
  ctx: ConversationContext,
  persisted: AdvanceResult["persistedData"],
  persona: string,
  firstName: string,
  price?: string | null,
): string {
  const slot    = persisted.selectedSlot ?? ctx.selectedSlot;
  const address = persisted.address      ?? ctx.address;

  switch (nextStage) {
    case "WIDGET_SIZING":
      return "Ask for bedrooms and bathrooms. If you already have one, ask only for the missing one.";

    case "AVAILABILITY":
      return `Ask when they'd like to schedule. Use this format: "Got it, [briefly echo what they need]. When were you hoping to schedule that so we can see how fast we can get you taken care of?"`;

    case "SLOT_CHOICE":
      if (ctx.smsFlow === "B") {
        // Flow B: reveal price when giving slot options
        return `Reveal the price and offer 9am or 1pm on ${slot ?? "the day they mentioned"}. Use this format:
"Perfect. We handle a lot of [X] bed / [Y] bath homes — no problem at all.\\n\\nJust so you know upfront: we bring all our own supplies and get everything done in one visit. Kitchens, bathrooms, floors, surfaces — the works. 🧹\\n\\nFor a home like yours, most clients land around $${price ?? "[PRICE]"}. That covers everything, no hidden fees or surprises.\\n\\nI've got ${slot ?? "[DAY]"} at 9am or 1pm — which one should I lock in?"`;
      }
      return `Offer 9am or 1pm on ${slot ?? "the selected day"}. Ask which works.`;

    case "ADDRESS":
      return `The slot is confirmed (${slot ?? "their chosen slot"}). Ask for their home address.`;

    case "CONFIRMATION":
      return `Slot and address are confirmed. Ask if they want a call now or in a few minutes. Use this format: "Perfect — I've reserved ${slot ?? "your slot"} for you at ${address ?? "your address"}. ✅\\nAnything I should pass to the team? (pets, gate code, anything like that)\\n\\nWe'll do a quick 60-sec call to confirm details — should I call now or in a few minutes?"`;

    case "CALL_SCHEDULED":
      if (persisted.callPreference === "now") {
        return `Say: "Perfect ${firstName}! Expect a call from us shortly. We look forward to serving you! 🏠✨"`;
      }
      return `Say: "No problem ${firstName}! We'll give you a call in a few minutes. Talk soon! 🏠✨"`;

    case "FUTURE_BOOKING":
      return "Acknowledge that they want to book in the future. Keep it warm and let them know to reach out when ready.";

    case "DONE":
      return "Wrap up the conversation warmly.";

    default:
      return "Continue the conversation naturally based on the context.";
  }
}
