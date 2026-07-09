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

    case "SLOT_CHOICE": {
      const priceDisplay = price ? `$${price}` : null;
      const recurringDisplay = price ? `$${Math.round(parseInt(price, 10) * 0.85)}` : null;
      if (ctx.smsFlow === "B") {
        return [
          `The lead gave a day (${slot ?? "this week"}) and you are now revealing the price and offering 9am or 1pm.`,
          `Write a warm, natural SMS that:`,
          `1. Answers any questions the lead asked (if any) — directly and confidently in 1 sentence`,
          `2. Confirms you handle their home size (${persisted.bedrooms ?? ctx.bedrooms ?? "their size"} bed / ${persisted.bathrooms ?? ctx.bathrooms ?? "their size"} bath) — no problem`,
          `3. Mentions the price: one-time ${priceDisplay ?? "(use pricing table)"}, or ${recurringDisplay ?? "15% less"} on a recurring plan`,
          `4. Mentions everything is included — supplies, equipment, background-checked team, satisfaction guarantee`,
          `5. Offers 9am or 1pm on ${slot ?? "the day they mentioned"} and asks which to lock in`,
          `Keep it natural and warm. Do NOT use a rigid template. Adapt the order if the lead asked a question — answer it first.`,
        ].join("\n");
      }
      return `Offer 9am or 1pm on ${slot ?? "the selected day"}. Ask which works.`;
    }

    case "ADDRESS":
      return `The slot is confirmed (${slot ?? "their chosen slot"}). Ask for their home address.`;

    case "CONFIRMATION": {
      return [
        `Slot and address are confirmed. Write a warm, natural SMS that:`,
        `1. Answers any questions the lead asked (if any) — directly and confidently in 1 sentence`,
        `2. Confirms the booking: ${slot ?? "their slot"} at ${address ?? "their address"}`,
        `3. Asks if there's anything to pass to the team (pets, gate code, special instructions)`,
        `4. Mentions a quick 60-second call to confirm details — asks if they want it now or in a few minutes`,
        `Keep it natural. Do NOT use a rigid template. If the lead asked a question, answer it first.`,
      ].join("\n");
    }

    case "CALL_SCHEDULED":
      if (persisted.callPreference === "now") {
        return `Say: "Perfect ${firstName}! Expect a call from us shortly. We look forward to serving you! 🏠✨"`;
      }
      return `Say: "No problem ${firstName}! We'll give you a call in a few minutes. Talk soon! 🏠✨"`;

    case "FUTURE_BOOKING":
      return "Acknowledge that they want to book in the future. Keep it warm and let them know to reach out when ready.";

    case "RESOLVED":
      return "Wrap up the conversation warmly.";

    default:
      return "Continue the conversation naturally based on the context.";
  }
}
