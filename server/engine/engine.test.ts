/**
 * Tests for the LLM-First Conversation Engine
 *
 * Tests cover:
 * 1. Business rule enforcement (stage guard, address validation, etc.)
 * 2. Stage contracts (valid transitions)
 * 3. Pricing calculations
 * 4. Full engine integration (mocked LLM)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { enforceRules } from "./rules";
import { calculatePrice, calculateRecurringPrice, buildPricingSummary } from "./pricing";
import { getStageContract } from "./stages";
import { processLeadReplyV2 } from "./index";
import type { ConversationContext } from "../conversationEngine";
import type { LLMDecision } from "./schema";

// ─── Mock LLM ─────────────────────────────────────────────────────────────────
vi.mock("../_core/llm", () => ({
  invokeLLM: vi.fn(),
}));

import { invokeLLM } from "../_core/llm";
const mockLLM = vi.mocked(invokeLLM);

function makeLLMResponse(decision: LLMDecision) {
  return {
    choices: [{ message: { content: JSON.stringify(decision) } }],
  };
}

// ─── Test Fixtures ────────────────────────────────────────────────────────────

function makeContext(overrides: Partial<ConversationContext> = {}): ConversationContext {
  return {
    stage: "AVAILABILITY",
    leadName: "John Smith",
    leadPhone: "+12025551234",
    quotedPrice: "269",
    serviceType: "Standard Cleaning",
    bedrooms: "2 Bedrooms",
    bathrooms: "2 Bathrooms",
    selectedSlot: null,
    address: null,
    messageHistory: [],
    ...overrides,
  };
}

// ─── Pricing Tests ────────────────────────────────────────────────────────────

describe("Pricing", () => {
  it("calculates standard price for 2bed/2bath correctly", () => {
    expect(calculatePrice("2 Bedrooms", "2 Bathrooms")).toBe(269);
  });

  it("calculates standard price for 3bed/2bath correctly", () => {
    expect(calculatePrice("3 Bedrooms", "2 Bathrooms")).toBe(289);
  });

  it("adds $30 per extra bathroom", () => {
    const base = calculatePrice("2 Bedrooms", "1 Bathroom");
    const withExtra = calculatePrice("2 Bedrooms", "2 Bathrooms");
    expect(withExtra - base).toBe(30);
  });

  it("calculates weekly recurring discount (20% off)", () => {
    const standard = calculatePrice("2 Bedrooms", "2 Bathrooms"); // 269
    const weekly = calculateRecurringPrice(standard, "weekly");
    expect(weekly).toBe(Math.round(269 * 0.8)); // 215
  });

  it("calculates biweekly recurring discount (15% off)", () => {
    const standard = calculatePrice("2 Bedrooms", "2 Bathrooms"); // 269
    const biweekly = calculateRecurringPrice(standard, "biweekly");
    expect(biweekly).toBe(Math.round(269 * 0.85)); // 229
  });

  it("calculates monthly recurring discount (10% off)", () => {
    const standard = calculatePrice("2 Bedrooms", "2 Bathrooms"); // 269
    const monthly = calculateRecurringPrice(standard, "monthly");
    expect(monthly).toBe(Math.round(269 * 0.9)); // 242
  });

  it("buildPricingSummary includes all frequency options", () => {
    const summary = buildPricingSummary("2 Bedrooms", "2 Bathrooms");
    expect(summary).toContain("$269");
    expect(summary).toContain("Weekly");
    expect(summary).toContain("Bi-weekly");
    expect(summary).toContain("Monthly");
    expect(summary).toContain("20%");
    expect(summary).toContain("15%");
    expect(summary).toContain("10%");
  });
});

// ─── Stage Contract Tests ─────────────────────────────────────────────────────

describe("Stage Contracts", () => {
  it("WIDGET_SIZING requires bedrooms and bathrooms to advance", () => {
    const contract = getStageContract("WIDGET_SIZING");
    expect(contract.requiredToAdvance).toContain("bedrooms");
    expect(contract.requiredToAdvance).toContain("bathrooms");
  });

  it("AVAILABILITY requires selectedSlot to advance", () => {
    const contract = getStageContract("AVAILABILITY");
    expect(contract.requiredToAdvance).toContain("selectedSlot");
  });

  it("ADDRESS requires address to advance", () => {
    const contract = getStageContract("ADDRESS");
    expect(contract.requiredToAdvance).toContain("address");
  });

  it("CONFIRMATION requires callPreference to advance", () => {
    const contract = getStageContract("CONFIRMATION");
    expect(contract.requiredToAdvance).toContain("callPreference");
  });

  it("QUOTE_SENT has no required fields (any reply advances)", () => {
    const contract = getStageContract("QUOTE_SENT");
    expect(contract.requiredToAdvance).toHaveLength(0);
  });
});

// ─── Business Rule Enforcer Tests ─────────────────────────────────────────────

describe("Business Rule Enforcer", () => {
  it("blocks AVAILABILITY→SLOT_CHOICE if selectedSlot is missing", () => {
    const ctx = makeContext({ stage: "AVAILABILITY" });
    const decision: LLMDecision = {
      reply: "Great, let me check slots for you!",
      nextStage: "SLOT_CHOICE",
      extractedData: { bedrooms: null, bathrooms: null, selectedSlot: null, address: null, callPreference: null, quotedPrice: null, serviceType: null },
      reasoning: "Lead said yes",
    };
    const { decision: corrected, violations } = enforceRules(decision, ctx);
    expect(corrected.nextStage).toBe("AVAILABILITY");
    expect(violations.some(v => v.rule.includes("missing_required_field"))).toBe(true);
  });

  it("allows AVAILABILITY→SLOT_CHOICE when selectedSlot is provided", () => {
    const ctx = makeContext({ stage: "AVAILABILITY" });
    const decision: LLMDecision = {
      reply: "Great, Wednesday works!",
      nextStage: "SLOT_CHOICE",
      extractedData: { bedrooms: null, bathrooms: null, selectedSlot: "Wednesday, March 19", address: null, callPreference: null, quotedPrice: null, serviceType: null },
      reasoning: "Lead picked Wednesday",
    };
    const { decision: corrected, violations } = enforceRules(decision, ctx);
    expect(corrected.nextStage).toBe("SLOT_CHOICE");
    expect(violations).toHaveLength(0);
  });

  it("blocks ADDRESS→CONFIRMATION if address is too short", () => {
    const ctx = makeContext({ stage: "ADDRESS" });
    const decision: LLMDecision = {
      reply: "Got it!",
      nextStage: "CONFIRMATION",
      extractedData: { bedrooms: null, bathrooms: null, selectedSlot: null, address: "123 St", address: "123 St", callPreference: null, quotedPrice: null, serviceType: null },
      reasoning: "Got address",
    };
    const { decision: corrected, violations } = enforceRules(decision, ctx);
    // "123 St" is 6 chars — too short, should be nulled and block advancement
    expect(corrected.extractedData.address).toBeNull();
    expect(corrected.nextStage).toBe("ADDRESS");
  });

  it("allows ADDRESS→CONFIRMATION with a real address", () => {
    const ctx = makeContext({ stage: "ADDRESS" });
    const decision: LLMDecision = {
      reply: "Perfect, got your address!",
      nextStage: "CONFIRMATION",
      extractedData: { bedrooms: null, bathrooms: null, selectedSlot: null, address: "123 Main St, Washington DC 20001", callPreference: null, quotedPrice: null, serviceType: null },
      reasoning: "Real address provided",
    };
    const { decision: corrected, violations } = enforceRules(decision, ctx);
    expect(corrected.nextStage).toBe("CONFIRMATION");
    expect(violations).toHaveLength(0);
  });

  it("blocks WIDGET_SIZING advance if only bedrooms provided", () => {
    const ctx = makeContext({ stage: "WIDGET_SIZING", bedrooms: "", bathrooms: "" });
    const decision: LLMDecision = {
      reply: "Great, 3 bedrooms! And bathrooms?",
      nextStage: "AVAILABILITY",
      extractedData: { bedrooms: "3 Bedrooms", bathrooms: null, selectedSlot: null, address: null, callPreference: null, quotedPrice: null, serviceType: null },
      reasoning: "Only bedrooms given",
    };
    const { decision: corrected, violations } = enforceRules(decision, ctx);
    expect(corrected.nextStage).toBe("WIDGET_SIZING");
    expect(violations.some(v => v.rule.includes("bathrooms"))).toBe(true);
  });

  it("merges extracted data with existing context", () => {
    const ctx = makeContext({ stage: "ADDRESS", selectedSlot: "Wednesday, March 19", bedrooms: "2 Bedrooms", bathrooms: "2 Bathrooms" });
    const decision: LLMDecision = {
      reply: "Got it!",
      nextStage: "CONFIRMATION",
      extractedData: { bedrooms: null, bathrooms: null, selectedSlot: null, address: "456 Oak Ave, Washington DC 20002", callPreference: null, quotedPrice: null, serviceType: null },
      reasoning: "Address provided",
    };
    const { decision: corrected } = enforceRules(decision, ctx);
    // Should merge selectedSlot from context
    expect(corrected.extractedData.selectedSlot).toBe("Wednesday, March 19");
    // Should keep bedrooms/bathrooms from context
    expect(corrected.extractedData.bedrooms).toBe("2 Bedrooms");
  });

  it("blocks invalid stage transition", () => {
    const ctx = makeContext({ stage: "WIDGET_SIZING" });
    const decision: LLMDecision = {
      reply: "Booking you now!",
      nextStage: "CONFIRMATION", // Not a valid transition from WIDGET_SIZING
      extractedData: { bedrooms: "2 Bedrooms", bathrooms: "2 Bathrooms", selectedSlot: null, address: null, callPreference: null, quotedPrice: null, serviceType: null },
      reasoning: "Skipping ahead",
    };
    const { decision: corrected, violations } = enforceRules(decision, ctx);
    expect(corrected.nextStage).toBe("WIDGET_SIZING");
    expect(violations.some(v => v.rule.includes("invalid_transition"))).toBe(true);
  });

  it("always allows DONE from any stage", () => {
    const ctx = makeContext({ stage: "WIDGET_SIZING" });
    const decision: LLMDecision = {
      reply: "No worries! Have a great day.",
      nextStage: "DONE",
      extractedData: { bedrooms: null, bathrooms: null, selectedSlot: null, address: null, callPreference: null, quotedPrice: null, serviceType: null },
      reasoning: "Lead opted out",
    };
    const { decision: corrected, violations } = enforceRules(decision, ctx);
    expect(corrected.nextStage).toBe("DONE");
    expect(violations).toHaveLength(0);
  });
});

// ─── Full Engine Integration Tests ───────────────────────────────────────────

describe("processLeadReplyV2 — Integration", () => {
  beforeEach(() => {
    mockLLM.mockReset();
  });

  it("answers recurring pricing question in AVAILABILITY and stays on AVAILABILITY", async () => {
    const ctx = makeContext({ stage: "AVAILABILITY" });
    mockLLM.mockResolvedValueOnce(makeLLMResponse({
      reply: "Great question! For your 2bed/2bath home: weekly $191/clean (20% off), bi-weekly $203/clean (15% off), monthly $215/clean (10% off). Which day works for you — Wednesday or Thursday?",
      nextStage: "AVAILABILITY",
      extractedData: { bedrooms: null, bathrooms: null, selectedSlot: null, address: null, callPreference: null, quotedPrice: null, serviceType: null },
      reasoning: "Lead asked about recurring pricing. Answered and re-asked for availability.",
    }));

    const result = await processLeadReplyV2("How much for recurring", ctx);
    expect(result.nextStage).toBe("AVAILABILITY");
    expect(result.reply).toContain("weekly");
    expect(result.reply).toContain("Wednesday");
  });

  it("advances AVAILABILITY→SLOT_CHOICE when lead picks a day", async () => {
    const ctx = makeContext({ stage: "AVAILABILITY" });
    mockLLM.mockResolvedValueOnce(makeLLMResponse({
      reply: "Wednesday works! I can reserve:\nWednesday, March 19\nThursday, March 20\nWhich would you prefer?",
      nextStage: "SLOT_CHOICE",
      extractedData: { bedrooms: null, bathrooms: null, selectedSlot: "Wednesday, March 19", address: null, callPreference: null, quotedPrice: null, serviceType: null },
      reasoning: "Lead picked Wednesday",
    }));

    const result = await processLeadReplyV2("Wednesday works", ctx);
    expect(result.nextStage).toBe("SLOT_CHOICE");
    expect(result.extractedData?.selectedSlot).toBe("Wednesday, March 19");
  });

  it("handles Spanish reply natively — no translation needed", async () => {
    const ctx = makeContext({ stage: "AVAILABILITY" });
    mockLLM.mockResolvedValueOnce(makeLLMResponse({
      reply: "¡Perfecto! ¿Cuánto cuesta el servicio recurrente? Para tu hogar de 2 habitaciones y 2 baños: semanal $191/limpieza (20% de descuento), quincenal $203/limpieza (15% de descuento). ¿Qué día te viene bien?",
      nextStage: "AVAILABILITY",
      extractedData: { bedrooms: null, bathrooms: null, selectedSlot: null, address: null, callPreference: null, quotedPrice: null, serviceType: null },
      reasoning: "Lead asked about recurring in Spanish. Answered in Spanish and re-asked.",
    }));

    const result = await processLeadReplyV2("¿Cuánto cuesta el servicio recurrente?", ctx);
    expect(result.nextStage).toBe("AVAILABILITY");
    expect(result.reply).toContain("quincenal");
  });

  it("routes existing customer to DONE with support contact", async () => {
    const ctx = makeContext({ stage: "AVAILABILITY" });
    mockLLM.mockResolvedValueOnce(makeLLMResponse({
      reply: "Hi! For help with your existing booking, please contact our support team: 📞 202-888-5362 or support@maidsinblacksupport.com. They'll take great care of you!",
      nextStage: "DONE",
      extractedData: { bedrooms: null, bathrooms: null, selectedSlot: null, address: null, callPreference: null, quotedPrice: null, serviceType: null },
      reasoning: "Lead is an existing customer needing support, not a new booking.",
    }));

    const result = await processLeadReplyV2("I need to reschedule my existing cleaning", ctx);
    expect(result.nextStage).toBe("DONE");
    expect(result.reply).toContain("202-888-5362");
  });

  it("stays on WIDGET_SIZING when only bedrooms provided", async () => {
    const ctx = makeContext({ stage: "WIDGET_SIZING", bedrooms: "", bathrooms: "" });
    mockLLM.mockResolvedValueOnce(makeLLMResponse({
      reply: "Got it — 3 bedrooms! And how many bathrooms does your home have?",
      nextStage: "AVAILABILITY", // LLM tries to advance — should be blocked
      extractedData: { bedrooms: "3 Bedrooms", bathrooms: null, selectedSlot: null, address: null, callPreference: null, quotedPrice: null, serviceType: null },
      reasoning: "Only bedrooms given, asking for bathrooms",
    }));

    const result = await processLeadReplyV2("3 bedrooms", ctx);
    // Business rule enforcer should block the advance
    expect(result.nextStage).toBe("WIDGET_SIZING");
  });

  it("advances WIDGET_SIZING→AVAILABILITY when both rooms provided", async () => {
    const ctx = makeContext({ stage: "WIDGET_SIZING", bedrooms: "", bathrooms: "" });
    mockLLM.mockResolvedValueOnce(makeLLMResponse({
      reply: "Great! For a 3 Bedrooms / 2 Bathrooms home, a Standard Cleaning is $289. Ready to schedule? We have openings Wednesday or Thursday — would either work?",
      nextStage: "AVAILABILITY",
      extractedData: { bedrooms: "3 Bedrooms", bathrooms: "2 Bathrooms", selectedSlot: null, address: null, callPreference: null, quotedPrice: "289", serviceType: "Standard Cleaning" },
      reasoning: "Both rooms provided, quoted price, asking for availability",
    }));

    const result = await processLeadReplyV2("3 bed 2 bath", ctx);
    expect(result.nextStage).toBe("AVAILABILITY");
  });

  it("uses fallback reply when LLM fails", async () => {
    const ctx = makeContext({ stage: "AVAILABILITY" });
    mockLLM.mockRejectedValueOnce(new Error("LLM timeout"));

    const result = await processLeadReplyV2("Wednesday", ctx);
    expect(result.nextStage).toBe("AVAILABILITY");
    expect(result.reply.length).toBeGreaterThan(0);
  });

  it("full CONFIRMATION flow — advances when callPreference provided", async () => {
    const ctx = makeContext({
      stage: "CONFIRMATION",
      selectedSlot: "Wednesday, March 19",
      address: "123 Main St, Washington DC 20001",
    });
    mockLLM.mockResolvedValueOnce(makeLLMResponse({
      reply: "Perfect! We'll call you right now to confirm everything. 📞",
      nextStage: "CALL_SCHEDULED",
      extractedData: { bedrooms: null, bathrooms: null, selectedSlot: null, address: null, callPreference: "now", quotedPrice: null, serviceType: null },
      reasoning: "Lead wants call now",
    }));

    const result = await processLeadReplyV2("Call me now", ctx);
    expect(result.nextStage).toBe("CALL_SCHEDULED");
    expect(result.extractedData?.callPreference).toBe("now");
  });

  it("stays on CONFIRMATION when callPreference missing", async () => {
    const ctx = makeContext({
      stage: "CONFIRMATION",
      selectedSlot: "Wednesday, March 19",
      address: "123 Main St, Washington DC 20001",
    });
    mockLLM.mockResolvedValueOnce(makeLLMResponse({
      reply: "Would you like us to call you now or in a few minutes?",
      nextStage: "CALL_SCHEDULED", // LLM tries to advance without callPreference
      extractedData: { bedrooms: null, bathrooms: null, selectedSlot: null, address: null, callPreference: null, quotedPrice: null, serviceType: null },
      reasoning: "Unclear reply",
    }));

    const result = await processLeadReplyV2("ok", ctx);
    expect(result.nextStage).toBe("CONFIRMATION");
  });
});
