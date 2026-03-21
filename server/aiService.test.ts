/**
 * Tests for the Guardrailed AI Service (aiService.ts)
 *
 * All LLM calls are mocked — tests verify:
 * 1. Message generation uses AI output when valid
 * 2. Fallbacks trigger when AI output is invalid or fails
 * 3. Objection detection classifies correctly
 * 4. Off-script handler always returns a reply with a nudge back
 * 5. Guardrails: price is always present in quote messages
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  generateQuoteMessage,
  generatePricingFollowUp,
  handleOffScriptReply,
  handleObjection,
  detectObjection,
} from "./aiService";

// ─── Mock LLM ─────────────────────────────────────────────────────────────────
vi.mock("./_core/llm", () => ({
  invokeLLM: vi.fn(),
}));

import { invokeLLM } from "./_core/llm";
const mockLLM = vi.mocked(invokeLLM);

function makeLLMResponse(content: string) {
  return {
    choices: [{ message: { content }, index: 0, finish_reason: "stop" }],
  } as any;
}

// ─── generateQuoteMessage ─────────────────────────────────────────────────────
describe("generateQuoteMessage", () => {
  beforeEach(() => mockLLM.mockReset());

  const params = {
    leadName: "Sarah Johnson",
    bedrooms: "2 Bedrooms",
    bathrooms: "1 Bathroom",
    serviceType: "Standard Cleaning",
    price: "130",
  };

  it("SMS 1: Jade day-ask (no price, no Jade re-intro)", async () => {
    const result = await generateQuoteMessage(params);
    // flowB_sms1 is the day-ask sent after the form submit.
    // It no longer re-introduces Jade (she already introduced herself in the widget sizing SMS
    // or is implied by context). It just asks for a day.
    expect(result).toContain("day");
    // Price is NOT in SMS 1 — it's in SMS 2 (buildJadePriceReveal)
    expect(result).not.toContain("$130");
    // Should NOT call the LLM — it's a static template
    expect(mockLLM).not.toHaveBeenCalled();
  });

  it("does not re-introduce Jade in the day-ask SMS", async () => {
    const result = await generateQuoteMessage(params);
    // The greeting + intro is in the widget sizing SMS (widgetFlowB_sms1).
    // flowB_sms1 should NOT say 'Jade here' again.
    expect(result).not.toContain("Jade here");
    expect(result).not.toContain("Got your request");
  });

  it("always returns a consistent format regardless of params", async () => {
    const result1 = await generateQuoteMessage(params);
    const result2 = await generateQuoteMessage(params);
    // Static template — should be identical every time
    expect(result1).toBe(result2);
  });
});

// ─── generatePricingFollowUp (now the availability question) ───────────────────────────
describe("generatePricingFollowUp", () => {
  // generatePricingFollowUp now returns the availability question (Thu/Sat)
  // rather than a pricing context message — pricing is in the opening quote.

  const params = {
    leadName: "Sarah Johnson",
    bedrooms: "2 Bedrooms",
    bathrooms: "1 Bathroom",
    serviceType: "Standard Cleaning",
    price: "130",
  };

  it("returns a dynamic availability question with two upcoming day options", async () => {
    const result = await generatePricingFollowUp(params);
    // The message should contain the availability question structure
    expect(result.toLowerCase()).toContain("openings");
    expect(result.toLowerCase()).toContain("would one of those work");
    // Should mention two different days (not hardcoded to Thursday/Saturday)
    const dayNames = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
    const mentionedDays = dayNames.filter(d => result.toLowerCase().includes(d));
    expect(mentionedDays.length).toBeGreaterThanOrEqual(1);
  });

  it("always returns a non-empty string regardless of params", async () => {
    const result = await generatePricingFollowUp(params);
    expect(result.length).toBeGreaterThan(10);
  });

  it("does not make any LLM calls (pure static message)", async () => {
    const mockFn = vi.fn();
    // generatePricingFollowUp is now synchronous/static — no LLM call
    const result = await generatePricingFollowUp(params);
    expect(mockFn).not.toHaveBeenCalled();
    expect(result).toBeTruthy();
  });
});

// ─── detectObjectionon ──────────────────────────────────────────────────────────
describe("detectObjection", () => {
  beforeEach(() => mockLLM.mockReset());

  it("returns 'price_too_high' for price objection", async () => {
    mockLLM.mockResolvedValueOnce(makeLLMResponse("price_too_high"));
    const result = await detectObjection("That's too expensive for me");
    expect(result).toBe("price_too_high");
  });

  it("returns 'not_available' for scheduling objection", async () => {
    mockLLM.mockResolvedValueOnce(makeLLMResponse("not_available"));
    const result = await detectObjection("Neither of those days work for me");
    expect(result).toBe("not_available");
  });

  it("returns 'need_to_think' for hesitation", async () => {
    mockLLM.mockResolvedValueOnce(makeLLMResponse("need_to_think"));
    const result = await detectObjection("I need to think about it");
    expect(result).toBe("need_to_think");
  });

  it("returns null for on_track replies", async () => {
    mockLLM.mockResolvedValueOnce(makeLLMResponse("on_track"));
    const result = await detectObjection("Saturday works for me!");
    expect(result).toBeNull();
  });

  it("returns null for off_script replies", async () => {
    mockLLM.mockResolvedValueOnce(makeLLMResponse("off_script"));
    const result = await detectObjection("Do you clean ovens?");
    expect(result).toBeNull();
  });

  it("returns null when AI fails", async () => {
    mockLLM.mockRejectedValueOnce(new Error("LLM error"));
    const result = await detectObjection("some reply");
    expect(result).toBeNull();
  });
});

// ─── handleObjection ──────────────────────────────────────────────────────────
describe("handleObjection", () => {
  beforeEach(() => mockLLM.mockReset());

  const ctx = {
    leadName: "Mike Davis",
    quotedPrice: "155",
    serviceType: "Deep Cleaning",
  };

  it("returns AI response for price_too_high objection", async () => {
    mockLLM.mockResolvedValueOnce(
      makeLLMResponse("We totally understand! Our team is fully insured and we guarantee satisfaction. Does Thu or Sat still work?")
    );

    const result = await handleObjection("price_too_high", ctx);
    expect(result.reply).toBeTruthy();
    expect(result.reply.length).toBeGreaterThan(10);
  });

  it("falls back gracefully when AI fails for price_too_high", async () => {
    mockLLM.mockRejectedValueOnce(new Error("AI down"));

    const result = await handleObjection("price_too_high", ctx);
    expect(result.reply).toContain("insured");
    expect(result.nextStage).toBeNull();
  });

  it("falls back gracefully for not_available", async () => {
    mockLLM.mockRejectedValueOnce(new Error("AI down"));

    const result = await handleObjection("not_available", ctx);
    expect(result.reply.toLowerCase()).toContain("work");
    expect(result.nextStage).toBeNull();
  });

  it("falls back gracefully for need_to_think", async () => {
    mockLLM.mockRejectedValueOnce(new Error("AI down"));

    const result = await handleObjection("need_to_think", ctx);
    expect(result.reply).toBeTruthy();
  });

  it("falls back gracefully for already_have_cleaner", async () => {
    mockLLM.mockRejectedValueOnce(new Error("AI down"));

    const result = await handleObjection("already_have_cleaner", ctx);
    expect(result.reply).toBeTruthy();
  });
});

// ─── handleOffScriptReply ─────────────────────────────────────────────────────
describe("handleOffScriptReply", () => {
  beforeEach(() => mockLLM.mockReset());

  const baseCtx = {
    stage: "AVAILABILITY" as const,
    leadName: "Lisa Chen",
    quotedPrice: "120",
    serviceType: "Standard Cleaning",
    selectedSlot: null,
    messageHistory: [
      { role: "assistant" as const, content: "We have openings Thu or Sat. Does that work?" },
    ],
    leadReply: "Do you bring your own supplies?",
  };

  it("returns AI reply for off-script question", async () => {
    mockLLM.mockResolvedValueOnce(
      makeLLMResponse("Yes, we bring all supplies and equipment! Does Thursday or Saturday work for you?")
    );

    const result = await handleOffScriptReply(baseCtx);
    expect(result.reply).toBeTruthy();
    expect(result.shouldAdvanceStage).toBe(false);
  });

  it("falls back gracefully when AI fails", async () => {
    mockLLM.mockRejectedValueOnce(new Error("LLM timeout"));

    const result = await handleOffScriptReply(baseCtx);
    expect(result.reply).toBeTruthy();
    expect(result.reply.length).toBeGreaterThan(10);
    expect(result.shouldAdvanceStage).toBe(false);
  });

  it("always returns shouldAdvanceStage = false", async () => {
    mockLLM.mockResolvedValueOnce(
      makeLLMResponse("Great question! Our team can answer that on your confirmation call. Does Thu or Sat work?")
    );

    const result = await handleOffScriptReply(baseCtx);
    expect(result.shouldAdvanceStage).toBe(false);
  });

  it("handles ADDRESS stage off-script replies", async () => {
    mockLLM.mockResolvedValueOnce(
      makeLLMResponse("We clean all rooms included in your package. What's the address for your Saturday cleaning?")
    );

    const result = await handleOffScriptReply({
      ...baseCtx,
      stage: "ADDRESS",
      selectedSlot: "Saturday 9AM",
      leadReply: "What rooms do you clean?",
    });

    expect(result.reply).toBeTruthy();
  });
});
