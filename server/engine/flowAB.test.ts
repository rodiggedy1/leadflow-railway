/**
 * Flow A/B Routing Tests for the V2 Engine
 *
 * Verifies that:
 * - Flow A uses Madison persona and Flow A stage instructions
 * - Flow B uses Jade persona and Flow B stage instructions (price reveal + 9am/1pm)
 * - buildUserMessage uses the correct persona name in history
 * - Full engine integration with Flow B stages
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { buildSystemPrompt, buildUserMessage } from "./prompt";
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

function makeContext(overrides: Partial<ConversationContext> = {}): ConversationContext {
  return {
    stage: "AVAILABILITY",
    leadName: "Sarah Johnson",
    leadPhone: "+12025559876",
    quotedPrice: "239",
    serviceType: "Standard Cleaning",
    bedrooms: "2 Bedrooms",
    bathrooms: "2 Bathrooms",
    selectedSlot: null,
    address: null,
    messageHistory: [],
    smsFlow: "B",
    ...overrides,
  };
}

// ─── Prompt Builder Tests ─────────────────────────────────────────────────────

describe("Flow A/B prompt builder", () => {
  it("uses Madison persona for Flow A", () => {
    const ctx = makeContext({ smsFlow: "A", stage: "AVAILABILITY" });
    const prompt = buildSystemPrompt(ctx);
    expect(prompt).toContain("You are Madison");
    expect(prompt).not.toContain("You are Jade");
  });

  it("uses Jade persona for Flow B", () => {
    const ctx = makeContext({ smsFlow: "B", stage: "AVAILABILITY" });
    const prompt = buildSystemPrompt(ctx);
    expect(prompt).toContain("You are Jade");
    expect(prompt).not.toContain("You are Madison");
  });

  it("Flow B AVAILABILITY stage instructs price reveal + 9am/1pm offer", () => {
    const ctx = makeContext({ smsFlow: "B", stage: "AVAILABILITY" });
    const prompt = buildSystemPrompt(ctx);
    expect(prompt).toContain("9am or 1pm");
    expect(prompt).toContain("reveal the price");
  });

  it("Flow A AVAILABILITY stage does NOT mention 9am/1pm offer", () => {
    const ctx = makeContext({ smsFlow: "A", stage: "AVAILABILITY" });
    const prompt = buildSystemPrompt(ctx);
    expect(prompt).not.toContain("9am or 1pm");
  });

  it("Flow B SLOT_CHOICE stage instructs address ask after time pick", () => {
    const ctx = makeContext({ smsFlow: "B", stage: "SLOT_CHOICE", selectedSlot: "Thursday" });
    const prompt = buildSystemPrompt(ctx);
    expect(prompt).toContain("address");
  });

  it("Flow B ADDRESS stage instructs lock-in confirmation message", () => {
    const ctx = makeContext({ smsFlow: "B", stage: "ADDRESS", selectedSlot: "Thursday at 9am" });
    const prompt = buildSystemPrompt(ctx);
    expect(prompt).toContain("lock-in confirmation");
  });

  it("Flow B CONFIRMATION stage instructs call preference ask", () => {
    const ctx = makeContext({ smsFlow: "B", stage: "CONFIRMATION" });
    const prompt = buildSystemPrompt(ctx);
    expect(prompt).toContain("call now or in a few minutes");
  });

  it("includes SMS flow label in current state section", () => {
    const ctxA = makeContext({ smsFlow: "A", stage: "AVAILABILITY" });
    const ctxB = makeContext({ smsFlow: "B", stage: "AVAILABILITY" });
    expect(buildSystemPrompt(ctxA)).toContain("Flow A (Madison)");
    expect(buildSystemPrompt(ctxB)).toContain("Flow B (Jade)");
  });
});

// ─── buildUserMessage persona tests ──────────────────────────────────────────

describe("buildUserMessage persona in history", () => {
  it("uses Jade for Flow B history", () => {
    const ctx = makeContext({
      smsFlow: "B",
      stage: "AVAILABILITY",
      messageHistory: [{ role: "assistant", content: "Hey! What day were you thinking?" }],
    });
    const msg = buildUserMessage(ctx, "Thursday");
    expect(msg).toContain("Jade:");
    expect(msg).not.toContain("Madison:");
  });

  it("uses Madison for Flow A history", () => {
    const ctx = makeContext({
      smsFlow: "A",
      stage: "AVAILABILITY",
      messageHistory: [{ role: "assistant", content: "Great! When would you like to schedule?" }],
    });
    const msg = buildUserMessage(ctx, "Thursday");
    expect(msg).toContain("Madison:");
    expect(msg).not.toContain("Jade:");
  });

  it("uses lead first name in history", () => {
    const ctx = makeContext({
      smsFlow: "B",
      leadName: "Sarah Johnson",
      messageHistory: [{ role: "user", content: "Thursday" }],
    });
    const msg = buildUserMessage(ctx, "9am");
    expect(msg).toContain("Sarah:");
  });
});

// ─── Full Engine Integration Tests — Flow B ───────────────────────────────────

describe("processLeadReplyV2 — Flow B (Jade) integration", () => {
  beforeEach(() => {
    mockLLM.mockReset();
  });

  it("Flow B AVAILABILITY→SLOT_CHOICE: reveals price + 9am/1pm when lead gives a day", async () => {
    const ctx = makeContext({ smsFlow: "B", stage: "AVAILABILITY" });
    mockLLM.mockResolvedValueOnce(makeLLMResponse({
      reply: "Perfect. We handle a lot of 2 bed / 2 bath homes — no problem at all.\n\nFor a home like yours, most clients land around $239. That covers everything, no hidden fees.\nI've got Thursday at 9am or 1pm — which one should I lock in?",
      nextStage: "SLOT_CHOICE",
      extractedData: { bedrooms: null, bathrooms: null, selectedSlot: "Thursday", address: null, callPreference: null, quotedPrice: "239", serviceType: null },
      reasoning: "Lead gave a specific day (Thursday). Revealing price and offering 9am/1pm.",
    }));
    const result = await processLeadReplyV2("Thursday", ctx);
    expect(result.nextStage).toBe("SLOT_CHOICE");
    expect(result.reply).toContain("239");
  });

  it("Flow B SLOT_CHOICE→ADDRESS: asks for address after lead picks a time", async () => {
    const ctx = makeContext({ smsFlow: "B", stage: "SLOT_CHOICE", selectedSlot: "Thursday" });
    mockLLM.mockResolvedValueOnce(makeLLMResponse({
      reply: "Awesome Sarah, what's the address for service?",
      nextStage: "ADDRESS",
      extractedData: { bedrooms: null, bathrooms: null, selectedSlot: "Thursday at 9am", address: null, callPreference: null, quotedPrice: null, serviceType: null },
      reasoning: "Lead picked 9am. Asking for address.",
    }));
    const result = await processLeadReplyV2("9am", ctx);
    expect(result.nextStage).toBe("ADDRESS");
    expect(result.extractedData?.selectedSlot).toBe("Thursday at 9am");
  });

  it("Flow B ADDRESS→CONFIRMATION: sends lock-in message after address", async () => {
    const ctx = makeContext({ smsFlow: "B", stage: "ADDRESS", selectedSlot: "Thursday at 9am" });
    mockLLM.mockResolvedValueOnce(makeLLMResponse({
      reply: "Perfect — I've reserved Thursday at 9am for you at 123 Oak St, Washington DC 20001. ✅\nAnything I should pass to the team?\nWe'll do a quick 60-sec call to confirm details — should I call now or in a few minutes?",
      nextStage: "CONFIRMATION",
      extractedData: { bedrooms: null, bathrooms: null, selectedSlot: null, address: "123 Oak St, Washington DC 20001", callPreference: null, quotedPrice: null, serviceType: null },
      reasoning: "Address received. Sending lock-in confirmation and asking about call.",
    }));
    const result = await processLeadReplyV2("123 Oak St, Washington DC 20001", ctx);
    expect(result.nextStage).toBe("CONFIRMATION");
    expect(result.extractedData?.address).toBe("123 Oak St, Washington DC 20001");
  });

  it("Flow B CONFIRMATION→CALL_SCHEDULED: schedules call when lead says now", async () => {
    const ctx = makeContext({
      smsFlow: "B",
      stage: "CONFIRMATION",
      selectedSlot: "Thursday at 9am",
      address: "123 Oak St, Washington DC 20001",
    });
    mockLLM.mockResolvedValueOnce(makeLLMResponse({
      reply: "Perfect Sarah! Expect a call from us shortly. We look forward to serving you! 🏠✨",
      nextStage: "CALL_SCHEDULED",
      extractedData: { bedrooms: null, bathrooms: null, selectedSlot: null, address: null, callPreference: "now", quotedPrice: null, serviceType: null },
      reasoning: "Lead said now. Setting callPreference to now.",
    }));
    const result = await processLeadReplyV2("now", ctx);
    expect(result.nextStage).toBe("CALL_SCHEDULED");
    expect(result.extractedData?.callPreference).toBe("now");
  });

  it("Flow B AVAILABILITY stays when lead is vague (no specific day)", async () => {
    const ctx = makeContext({ smsFlow: "B", stage: "AVAILABILITY" });
    mockLLM.mockResolvedValueOnce(makeLLMResponse({
      reply: "Of course! What specific day works best for you?",
      nextStage: "AVAILABILITY",
      extractedData: { bedrooms: null, bathrooms: null, selectedSlot: null, address: null, callPreference: null, quotedPrice: null, serviceType: null },
      reasoning: "Lead said ASAP — no specific day. Asking for a day.",
    }));
    const result = await processLeadReplyV2("as soon as possible", ctx);
    expect(result.nextStage).toBe("AVAILABILITY");
  });
});
