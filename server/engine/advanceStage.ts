/**
 * advanceStage — deterministic stage advancement.
 *
 * This is the heart of the two-step engine. Given the current stage and
 * the signals extracted from the lead's message, it returns the next stage
 * and any data to persist. No LLM involved — pure logic.
 *
 * Rules:
 * - If we have enough to advance, we advance. Always.
 * - If the lead is flexible, we pick the best default and advance.
 * - We never re-ask for something the lead already gave us.
 * - Opt-out always wins.
 */

import type { ConversationStage } from "../../drizzle/schema";
import type { ConversationContext } from "../conversationEngine";
import type { LeadSignals } from "./extractSchema";
import { getNextAvailableSlots } from "../availability";

export interface AdvanceResult {
  nextStage: ConversationStage;
  /** Data to persist from this turn */
  persistedData: {
    bedrooms?: string;
    bathrooms?: string;
    selectedSlot?: string;
    address?: string;
    callPreference?: string;
    quotedPrice?: string;
    serviceType?: string;
    specialScope?: string;
  };
  /** Context the reply generator needs */
  replyContext: {
    answeredQuestions: string[];
    usedDefault: boolean;
    defaultDescription?: string;
  };
}

/**
 * Picks the first available 9am slot as the default when a lead is flexible.
 */
function pickDefaultSlot(existingSlot?: string | null): string {
  if (existingSlot) {
    // They already have a day — just add 9am
    const day = existingSlot.replace(/ at .*/i, "").replace(/, ?(9am|1pm|morning|afternoon)$/i, "");
    return `${day} at 9am`;
  }
  const slots = getNextAvailableSlots(1);
  const slot = slots[0];
  return slot ? `${slot.label} at 9am` : "the next available slot at 9am";
}

export function advanceStage(
  stage: ConversationStage,
  signals: LeadSignals,
  ctx: ConversationContext,
): AdvanceResult {
  const persisted: AdvanceResult["persistedData"] = {};
  const replyCtx: AdvanceResult["replyContext"] = { answeredQuestions: signals.questions, usedDefault: false };

  // ── Opt-out always wins ────────────────────────────────────────────────────
  if (signals.optOut) {
    return { nextStage: "DONE", persistedData: persisted, replyContext: replyCtx };
  }

  // ── Existing customer → support ────────────────────────────────────────────
  if (signals.isExistingCustomer) {
    return { nextStage: "DONE", persistedData: persisted, replyContext: replyCtx };
  }

  // ── Future booking ─────────────────────────────────────────────────────────
  if (signals.wantsFutureBooking) {
    return { nextStage: "FUTURE_BOOKING", persistedData: persisted, replyContext: replyCtx };
  }

  // ── Persist any extracted data regardless of stage ─────────────────────────
  if (signals.bedrooms)    persisted.bedrooms    = signals.bedrooms;
  if (signals.bathrooms)   persisted.bathrooms   = signals.bathrooms;
  if (signals.address)     persisted.address     = signals.address;
  if (signals.serviceType) persisted.serviceType = signals.serviceType;
  if (signals.quotedPrice) persisted.quotedPrice = signals.quotedPrice;
  if (signals.specialScope) persisted.specialScope = signals.specialScope;

  // ── Stage-specific advancement logic ──────────────────────────────────────

  switch (stage) {

    case "WIDGET_SIZING": {
      const hasBedrooms  = !!(signals.bedrooms  || ctx.bedrooms);
      const hasBathrooms = !!(signals.bathrooms || ctx.bathrooms);
      const hasScope     = !!(signals.specialScope);

      if (hasScope) {
        // Special scope → use defaults and advance
        persisted.bedrooms  = persisted.bedrooms  ?? "1 Bedrooms";
        persisted.bathrooms = persisted.bathrooms ?? "1 Bathrooms";
        persisted.serviceType = persisted.serviceType ?? "Standard Cleaning";
        return { nextStage: "AVAILABILITY", persistedData: persisted, replyContext: replyCtx };
      }

      if (hasBedrooms && hasBathrooms) {
        return { nextStage: "AVAILABILITY", persistedData: persisted, replyContext: replyCtx };
      }

      // Missing one — stay and ask for the missing piece
      return { nextStage: "WIDGET_SIZING", persistedData: persisted, replyContext: replyCtx };
    }

    case "QUOTE_SENT":
    case "AVAILABILITY": {
      // Do we have a specific day?
      if (signals.dayPreference) {
        const slot = signals.dayPreference;
        persisted.selectedSlot = slot;
        return { nextStage: "SLOT_CHOICE", persistedData: persisted, replyContext: replyCtx };
      }

      // Flexible about day → pick first available
      if (signals.isFlexible) {
        const defaultSlot = pickDefaultSlot(null);
        persisted.selectedSlot = defaultSlot;
        replyCtx.usedDefault = true;
        replyCtx.defaultDescription = defaultSlot;
        return { nextStage: "SLOT_CHOICE", persistedData: persisted, replyContext: replyCtx };
      }

      // No day info → stay
      return { nextStage: stage, persistedData: persisted, replyContext: replyCtx };
    }

    case "SLOT_CHOICE": {
      const existingDay = ctx.selectedSlot ?? null;

      // Explicit time slot in the message
      if (signals.timeSlot && signals.timeSlot !== "any") {
        const day = existingDay
          ? existingDay.replace(/ at .*/i, "").replace(/, ?(9am|1pm|morning|afternoon)$/i, "")
          : (signals.dayPreference ?? "the scheduled day");
        const slot = `${day} at ${signals.timeSlot}`;
        persisted.selectedSlot = slot;
        return { nextStage: "ADDRESS", persistedData: persisted, replyContext: replyCtx };
      }

      // Flexible about time ("any", "either works", "you pick")
      if (signals.timeSlot === "any" || signals.isFlexible) {
        const defaultSlot = pickDefaultSlot(existingDay);
        persisted.selectedSlot = defaultSlot;
        replyCtx.usedDefault = true;
        replyCtx.defaultDescription = defaultSlot;
        return { nextStage: "ADDRESS", persistedData: persisted, replyContext: replyCtx };
      }

      // Different day requested
      if (signals.dayPreference) {
        persisted.selectedSlot = signals.dayPreference;
        return { nextStage: "SLOT_CHOICE", persistedData: persisted, replyContext: replyCtx };
      }

      // No slot info — only questions → stay and answer
      return { nextStage: "SLOT_CHOICE", persistedData: persisted, replyContext: replyCtx };
    }

    case "TIME_PREF": {
      if (signals.timeSlot && signals.timeSlot !== "any") {
        const base = ctx.selectedSlot ?? signals.dayPreference ?? "the scheduled day";
        const day = base.replace(/ at .*/i, "").replace(/, ?(9am|1pm|morning|afternoon)$/i, "");
        persisted.selectedSlot = `${day} at ${signals.timeSlot}`;
        return { nextStage: "ADDRESS", persistedData: persisted, replyContext: replyCtx };
      }
      if (signals.isFlexible) {
        const defaultSlot = pickDefaultSlot(ctx.selectedSlot);
        persisted.selectedSlot = defaultSlot;
        replyCtx.usedDefault = true;
        replyCtx.defaultDescription = defaultSlot;
        return { nextStage: "ADDRESS", persistedData: persisted, replyContext: replyCtx };
      }
      return { nextStage: "TIME_PREF", persistedData: persisted, replyContext: replyCtx };
    }

    case "ADDRESS": {
      if (signals.address && signals.address.length >= 10) {
        persisted.address = signals.address;
        return { nextStage: "CONFIRMATION", persistedData: persisted, replyContext: replyCtx };
      }
      return { nextStage: "ADDRESS", persistedData: persisted, replyContext: replyCtx };
    }

    case "CONFIRMATION": {
      if (signals.callPreference) {
        persisted.callPreference = signals.callPreference;
        return { nextStage: "CALL_SCHEDULED", persistedData: persisted, replyContext: replyCtx };
      }
      return { nextStage: "CONFIRMATION", persistedData: persisted, replyContext: replyCtx };
    }

    case "REACTIVATION": {
      // Any positive reply → move to availability
      if (signals.dayPreference || signals.isFlexible || signals.timeSlot) {
        return { nextStage: "AVAILABILITY", persistedData: persisted, replyContext: replyCtx };
      }
      return { nextStage: "REACTIVATION", persistedData: persisted, replyContext: replyCtx };
    }

    case "REACTIVATION_TIME": {
      // Any time/day reply → done
      if (signals.dayPreference || signals.timeSlot || signals.isFlexible) {
        return { nextStage: "DONE", persistedData: persisted, replyContext: replyCtx };
      }
      return { nextStage: "REACTIVATION_TIME", persistedData: persisted, replyContext: replyCtx };
    }

    case "FUTURE_BOOKING": {
      if (signals.dayPreference || signals.timeSlot) {
        return { nextStage: "AVAILABILITY", persistedData: persisted, replyContext: replyCtx };
      }
      return { nextStage: "FUTURE_BOOKING", persistedData: persisted, replyContext: replyCtx };
    }

    case "CALL_SCHEDULED":
    case "DONE":
    default:
      return { nextStage: stage as ConversationStage, persistedData: persisted, replyContext: replyCtx };
  }
}
