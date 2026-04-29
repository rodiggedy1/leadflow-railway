/**
 * Flow A/B Tests for the Two-Step Engine
 *
 * Tests:
 * 1. Prompt builder tests (no LLM needed — pure string checks)
 * 2. Integration tests for processLeadReplyV2 with two-step LLM mocks
 *    - First mock call = extraction (returns LeadSignals JSON)
 *    - Second mock call = reply (returns plain text string)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { buildSystemPrompt, buildUserMessage } from "./prompt";
import { processLeadReplyV2 } from "./index";
import type { ConversationContext } from "../conversationEngine";
import type { LeadSignals } from "./extractSchema";

// ─── Mock LLM ─────────────────────────────────────────────────────────────────
vi.mock("../_core/llm", () => ({
  invokeLLM: vi.fn(),
}));

vi.mock("../messageTemplateRouter", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../messageTemplateRouter")>();
  return {
    ...actual,
    getTemplate: vi.fn().mockResolvedValue("Template reply"),
  };
});

vi.mock("../aiService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../aiService")>();
  return {
    ...actual,
    buildJadePriceReveal: vi.fn().mockResolvedValue("Price reveal reply"),
  };
});

vi.mock("../conversationEngine", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../conversationEngine")>();
  return {
    ...actual,
    buildJadeLockIn: vi.fn().mockResolvedValue("Lock-in reply"),
  };
});

import { invokeLLM } from "../_core/llm";
const mockLLM = vi.mocked(invokeLLM);

/** Returns a mock extraction response (Step 1) */
function makeExtractionResponse(signals: Partial<LeadSignals>) {
  const full: LeadSignals = {
    bedrooms: null, bathrooms: null, timeSlot: null, dayPreference: null,
    address: null, callPreference: null, specialScope: null, optOut: false,
    isFlexible: false, questions: [], wantsFutureBooking: false,
    isExistingCustomer: false, serviceType: null, quotedPrice: null,
    ...signals,
  };
  return { choices: [{ message: { content: JSON.stringify(full) } }] };
}

/** Returns a mock reply response (Step 3) */
function makeReplyResponse(text: string) {
  return { choices: [{ message: { content: text } }] };
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

// ─── Full Engine Integration Tests — Two-Step Architecture ───────────────────

describe("processLeadReplyV2 — Flow B (Jade) integration", () => {
  beforeEach(() => {
    mockLLM.mockReset();
  });

  it("Flow B AVAILABILITY→SLOT_CHOICE: advances when lead gives a specific day", async () => {
    const ctx = makeContext({ smsFlow: "B", stage: "AVAILABILITY" });
    // Step 1: extraction
    mockLLM.mockResolvedValueOnce(makeExtractionResponse({ dayPreference: "Thursday, May 1" }));
    // Step 3: reply (Step 2 is deterministic code, no LLM)
    mockLLM.mockResolvedValueOnce(makeReplyResponse("Perfect. For a 2 bed / 2 bath home, we're looking at $239. I've got Thursday at 9am or 1pm — which one should I lock in?"));

    const result = await processLeadReplyV2("Thursday", ctx);
    expect(result.nextStage).toBe("SLOT_CHOICE");
  });

  it("Flow B SLOT_CHOICE→ADDRESS: advances when lead picks 9am", async () => {
    const ctx = makeContext({ smsFlow: "B", stage: "SLOT_CHOICE", selectedSlot: "Thursday, May 1" });
    mockLLM.mockResolvedValueOnce(makeExtractionResponse({ timeSlot: "9am" }));
    mockLLM.mockResolvedValueOnce(makeReplyResponse("Awesome Sarah, what's the address for service?"));

    const result = await processLeadReplyV2("9am", ctx);
    expect(result.nextStage).toBe("ADDRESS");
    expect(result.extractedData?.selectedSlot).toBe("Thursday, May 1 at 9am");
  });

  it("Flow B SLOT_CHOICE→ADDRESS: advances with default 9am when lead says 'any day works'", async () => {
    const ctx = makeContext({ smsFlow: "B", stage: "SLOT_CHOICE", selectedSlot: "Thursday, May 1" });
    mockLLM.mockResolvedValueOnce(makeExtractionResponse({ isFlexible: true }));
    mockLLM.mockResolvedValueOnce(makeReplyResponse("Perfect, I'll lock you in for Thursday at 9am! What's the address?"));

    const result = await processLeadReplyV2("any day works", ctx);
    expect(result.nextStage).toBe("ADDRESS");
    expect(result.extractedData?.selectedSlot).toBe("Thursday, May 1 at 9am");
  });

  it("Flow B SLOT_CHOICE→ADDRESS: advances when lead says '9am' AND asks a question (multi-intent)", async () => {
    const ctx = makeContext({ smsFlow: "B", stage: "SLOT_CHOICE", selectedSlot: "Saturday, May 9" });
    mockLLM.mockResolvedValueOnce(makeExtractionResponse({ timeSlot: "9am", questions: ["Are the teams insured?"] }));
    mockLLM.mockResolvedValueOnce(makeReplyResponse("Yes, our teams are fully bonded and insured! I've locked you in for Saturday at 9am. What's the address?"));

    const result = await processLeadReplyV2("grab 9am, are the teams insured?", ctx);
    expect(result.nextStage).toBe("ADDRESS");
    expect(result.extractedData?.selectedSlot).toBe("Saturday, May 9 at 9am");
  });

  it("Flow B SLOT_CHOICE stays when lead only asks a question (no slot)", async () => {
    const ctx = makeContext({ smsFlow: "B", stage: "SLOT_CHOICE", selectedSlot: "Thursday, May 1" });
    mockLLM.mockResolvedValueOnce(makeExtractionResponse({ questions: ["Do you bring supplies?"] }));
    mockLLM.mockResolvedValueOnce(makeReplyResponse("Yes, we bring all supplies! Which slot works — 9am or 1pm?"));

    const result = await processLeadReplyV2("do you bring supplies?", ctx);
    expect(result.nextStage).toBe("SLOT_CHOICE");
  });

  it("Flow B ADDRESS→CONFIRMATION: advances after address provided", async () => {
    const ctx = makeContext({ smsFlow: "B", stage: "ADDRESS", selectedSlot: "Thursday at 9am" });
    mockLLM.mockResolvedValueOnce(makeExtractionResponse({ address: "123 Oak St, Washington DC 20001" }));
    mockLLM.mockResolvedValueOnce(makeReplyResponse("Lock-in reply"));

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
    mockLLM.mockResolvedValueOnce(makeExtractionResponse({ callPreference: "now" }));
    mockLLM.mockResolvedValueOnce(makeReplyResponse("Perfect Sarah! Expect a call from us shortly. 🏠✨"));

    const result = await processLeadReplyV2("now", ctx);
    expect(result.nextStage).toBe("CALL_SCHEDULED");
    expect(result.extractedData?.callPreference).toBe("now");
  });

  it("Flow B AVAILABILITY stays when lead is vague (no specific day)", async () => {
    const ctx = makeContext({ smsFlow: "B", stage: "AVAILABILITY" });
    mockLLM.mockResolvedValueOnce(makeExtractionResponse({ isFlexible: false, dayPreference: null }));
    mockLLM.mockResolvedValueOnce(makeReplyResponse("Of course! What specific day works best for you?"));

    const result = await processLeadReplyV2("as soon as possible", ctx);
    expect(result.nextStage).toBe("AVAILABILITY");
  });

  it("WIDGET_SIZING→AVAILABILITY: advances on special scope 'only the basement'", async () => {
    const ctx = makeContext({ smsFlow: "B", stage: "WIDGET_SIZING" });
    mockLLM.mockResolvedValueOnce(makeExtractionResponse({ specialScope: "only the basement" }));
    mockLLM.mockResolvedValueOnce(makeReplyResponse("Got it — we'll take care of the basement. When were you hoping to schedule?"));

    const result = await processLeadReplyV2("only need the basement cleaned", ctx);
    expect(result.nextStage).toBe("AVAILABILITY");
  });

  it("opt-out moves to DONE from any stage", async () => {
    const ctx = makeContext({ smsFlow: "B", stage: "SLOT_CHOICE" });
    mockLLM.mockResolvedValueOnce(makeExtractionResponse({ optOut: true }));
    mockLLM.mockResolvedValueOnce(makeReplyResponse("No problem! You've been unsubscribed. Have a great day!"));

    const result = await processLeadReplyV2("STOP", ctx);
    expect(result.nextStage).toBe("DONE");
  });
});
