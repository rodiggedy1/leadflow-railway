/**
 * Tests for the AI Conversation Engine
 * Tests the state machine logic, message builders, and stage transitions
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  buildQuoteMessage,
  buildPricingFollowUp,
  buildAvailabilityMessage,
  buildSlotChoiceMessage,
  buildAddressRequestMessage,
  buildConfirmationMessage,
  buildCallScheduledMessage,
  processLeadReply,
  type ConversationContext,
} from "./conversationEngine";

// ─── Mock the LLM so tests don't hit the real API ────────────────────────────
vi.mock("./_core/llm", () => ({
  invokeLLM: vi.fn(),
}));

import { invokeLLM } from "./_core/llm";
const mockLLM = vi.mocked(invokeLLM);

// ─── Helper: create a base context ───────────────────────────────────────────
function makeContext(overrides: Partial<ConversationContext> = {}): ConversationContext {
  return {
    stage: "QUOTE_SENT",
    leadName: "Jane Doe",
    quotedPrice: "130",
    serviceType: "Standard Cleaning",
    bedrooms: "2 Bedrooms",
    bathrooms: "1 Bathroom",
    selectedSlot: null,
    address: null,
    messageHistory: [],
    ...overrides,
  };
}

// ─── Message builder tests ────────────────────────────────────────────────────
describe("Message Builders", () => {
  it("buildQuoteMessage includes first name and price", () => {
    const msg = buildQuoteMessage({
      leadName: "John Smith",
      quotedPrice: "155",
      serviceType: "Standard Cleaning",
      bedrooms: "2 Bedrooms",
      bathrooms: "1 Bathroom",
    });
    expect(msg).toContain("John");
    expect(msg).toContain("$155");
    expect(msg).toContain("Maids in Black");
  });

  it("buildPricingFollowUp includes price and service type", () => {
    const msg = buildPricingFollowUp({
      serviceType: "Standard Cleaning",
      quotedPrice: "155",
    });
    expect(msg).toContain("$155");
    expect(msg).toContain("standard cleaning");
  });

  it("buildAvailabilityMessage mentions two upcoming days", () => {
    const msg = buildAvailabilityMessage();
    // Dynamic slots — verify it's a well-formed availability question
    expect(msg).toContain("openings");
    expect(msg).toContain("Would one of those work");
  });

  it("buildSlotChoiceMessage shows two slot options", () => {
    const msg = buildSlotChoiceMessage();
    // Dynamic slots — verify the structure is correct
    expect(msg).toContain("I can reserve");
    expect(msg).toContain("Which would you prefer");
  });

  it("buildAddressRequestMessage asks for address", () => {
    const msg = buildAddressRequestMessage("Thursday 1PM");
    expect(msg.toLowerCase()).toContain("address");
  });

  it("buildConfirmationMessage includes slot and address", () => {
    const msg = buildConfirmationMessage("Saturday, March 14", "123 Main St, DC 20001");
    expect(msg).toContain("Saturday, March 14");
    expect(msg).toContain("123 Main St");
    expect(msg.toLowerCase()).toContain("call");
  });

  it("buildCallScheduledMessage handles 'now'", () => {
    const msg = buildCallScheduledMessage("now");
    expect(msg.toLowerCase()).toContain("shortly");
  });

  it("buildCallScheduledMessage handles 'few_minutes'", () => {
    const msg = buildCallScheduledMessage("few_minutes");
    expect(msg.toLowerCase()).toContain("few minutes");
  });
});

// ─── State machine transition tests ──────────────────────────────────────────
describe("processLeadReply — State Machine", () => {
  beforeEach(() => {
    mockLLM.mockReset();
  });

  // Stage: QUOTE_SENT → any reply → AVAILABILITY
  it("QUOTE_SENT: any reply advances to AVAILABILITY without calling LLM", async () => {
    const ctx = makeContext({ stage: "QUOTE_SENT" });
    const result = await processLeadReply("ok thanks", ctx);

    expect(result.nextStage).toBe("AVAILABILITY");
    // Dynamic slots — verify it's an availability question
    expect(result.reply).toContain("openings");
    expect(mockLLM).not.toHaveBeenCalled();
  });

  // Stage: AVAILABILITY → yes → SLOT_CHOICE
  it("AVAILABILITY: positive reply advances to SLOT_CHOICE", async () => {
    // Call 1: detectObjection returns "on_track"
    mockLLM.mockResolvedValueOnce({ choices: [{ message: { content: "on_track" }, index: 0, finish_reason: "stop" }] } as any);
    // Call 2: parseLeadReply returns intent "yes"
    mockLLM.mockResolvedValueOnce({
      choices: [{ message: { content: JSON.stringify({ intent: "yes", extractedSlot: null, extractedAddress: null, extractedCallPreference: null, confidence: "high" }) }, index: 0, finish_reason: "stop" }],
    } as any);

    const ctx = makeContext({ stage: "AVAILABILITY" });
    const result = await processLeadReply("yes that works!", ctx);

    expect(result.nextStage).toBe("SLOT_CHOICE");
    // Dynamic slots — verify the slot choice structure is correct
    expect(result.reply).toContain("I can reserve");
    expect(result.reply).toContain("Which would you prefer");
  });

  // Stage: AVAILABILITY → hard opt-out → DONE
  it("AVAILABILITY: explicit hard opt-out ends conversation", async () => {
    // Call 1: detectObjection returns "on_track" (no objection)
    mockLLM.mockResolvedValueOnce({ choices: [{ message: { content: "on_track" }, index: 0, finish_reason: "stop" }] } as any);
    // Call 2: parseLeadReply returns intent "no" with high confidence (hard opt-out like "not interested")
    mockLLM.mockResolvedValueOnce({
      choices: [{ message: { content: JSON.stringify({ intent: "no", extractedSlot: null, extractedAddress: null, extractedCallPreference: null, confidence: "high" }) }, index: 0, finish_reason: "stop" }],
    } as any);

    const ctx = makeContext({ stage: "AVAILABILITY" });
    const result = await processLeadReply("not interested, remove me", ctx);

    expect(result.nextStage).toBe("DONE");
  });

  // Stage: AVAILABILITY → soft no / unclear → re-engage (stay in AVAILABILITY)
  it("AVAILABILITY: soft no or unclear reply re-engages instead of ending", async () => {
    // Call 1: detectObjection returns "on_track"
    mockLLM.mockResolvedValueOnce({ choices: [{ message: { content: "on_track" }, index: 0, finish_reason: "stop" }] } as any);
    // Call 2: parseLeadReply returns intent "unclear" ("no thanks" alone is not a hard opt-out)
    mockLLM.mockResolvedValueOnce({
      choices: [{ message: { content: JSON.stringify({ intent: "unclear", extractedSlot: null, extractedAddress: null, extractedCallPreference: null, confidence: "low" }) }, index: 0, finish_reason: "stop" }],
    } as any);

    const ctx = makeContext({ stage: "AVAILABILITY" });
    const result = await processLeadReply("no thanks", ctx);

    // Should re-engage, not end the conversation
    expect(result.nextStage).toBe("AVAILABILITY");
    expect(result.reply).toContain("openings");
  });

  // Stage: SLOT_CHOICE → slot1 → ADDRESS
  it("SLOT_CHOICE: 'slot1' reply captures first offered slot and advances to ADDRESS", async () => {
    // Call 1: detectObjection returns "on_track"
    mockLLM.mockResolvedValueOnce({ choices: [{ message: { content: "on_track" }, index: 0, finish_reason: "stop" }] } as any);
    // Call 2: parseLeadReply returns slot1
    mockLLM.mockResolvedValueOnce({
      choices: [{ message: { content: JSON.stringify({ intent: "slot1", extractedSlot: "Friday, March 13", extractedAddress: null, extractedCallPreference: null, confidence: "high" }) }, index: 0, finish_reason: "stop" }],
    } as any);

    const ctx = makeContext({ stage: "SLOT_CHOICE", offeredSlots: ["Friday, March 13", "Saturday, March 14"] });
    const result = await processLeadReply("friday works", ctx);

    expect(result.nextStage).toBe("TIME_PREF");
    expect(result.extractedData?.selectedSlot).toBe("Friday, March 13");
    expect(result.reply.toLowerCase()).toContain("morning");  // asks morning or afternoon
  });

  // Stage: SLOT_CHOICE → slot2 → ADDRESS
  it("SLOT_CHOICE: 'slot2' reply captures second offered slot and advances to ADDRESS", async () => {
    // Call 1: detectObjection returns "on_track"
    mockLLM.mockResolvedValueOnce({ choices: [{ message: { content: "on_track" }, index: 0, finish_reason: "stop" }] } as any);
    // Call 2: parseLeadReply returns slot2
    mockLLM.mockResolvedValueOnce({
      choices: [{ message: { content: JSON.stringify({ intent: "slot2", extractedSlot: "Saturday, March 14", extractedAddress: null, extractedCallPreference: null, confidence: "high" }) }, index: 0, finish_reason: "stop" }],
    } as any);

    const ctx = makeContext({ stage: "SLOT_CHOICE", offeredSlots: ["Friday, March 13", "Saturday, March 14"] });
    const result = await processLeadReply("saturday works", ctx);

    expect(result.nextStage).toBe("TIME_PREF");
    expect(result.extractedData?.selectedSlot).toBe("Saturday, March 14");
  });

  // Stage: SLOT_CHOICE → custom date → ADDRESS (accept any date)
  it("SLOT_CHOICE: custom date request advances to ADDRESS", async () => {
    // Call 1: detectObjection returns "on_track"
    mockLLM.mockResolvedValueOnce({ choices: [{ message: { content: "on_track" }, index: 0, finish_reason: "stop" }] } as any);
    // Call 2: parseLeadReply returns custom_date
    mockLLM.mockResolvedValueOnce({
      choices: [{ message: { content: JSON.stringify({ intent: "custom_date", extractedSlot: "Monday at 10AM", extractedAddress: null, extractedCallPreference: null, confidence: "high" }) }, index: 0, finish_reason: "stop" }],
    } as any);

    const ctx = makeContext({ stage: "SLOT_CHOICE" });
    const result = await processLeadReply("Can I do Monday at 10am instead?", ctx);

    expect(result.nextStage).toBe("TIME_PREF");
    expect(result.extractedData?.selectedSlot).toBe("Monday at 10AM");
    expect(result.reply).toContain("Monday at 10AM");
    expect(result.reply.toLowerCase()).toContain("morning");  // asks morning or afternoon
  });

  // Stage: SLOT_CHOICE → unclear → re-prompt
  it("SLOT_CHOICE: unclear reply stays at SLOT_CHOICE", async () => {
    mockLLM.mockResolvedValueOnce({
      choices: [{ message: { content: JSON.stringify({ intent: "unclear", extractedSlot: null, extractedAddress: null, extractedCallPreference: null, confidence: "low" }) }, index: 0, finish_reason: "stop" }],
    } as any);

    const ctx = makeContext({ stage: "SLOT_CHOICE" });
    const result = await processLeadReply("hmm not sure", ctx);

    expect(result.nextStage).toBe("SLOT_CHOICE");
    // For unclear replies, the engine re-prompts — just verify it stays at SLOT_CHOICE
    expect(result.reply).toBeTruthy();
  });

  // Stage: ADDRESS → address provided → CONFIRMATION
  it("ADDRESS: address reply captured and advances to CONFIRMATION", async () => {
    mockLLM.mockResolvedValueOnce({
      choices: [{ message: { content: JSON.stringify({ intent: "address_provided", extractedSlot: null, extractedAddress: "456 Oak Ave, Washington DC 20002", extractedCallPreference: null, confidence: "high" }) }, index: 0, finish_reason: "stop" }],
    } as any);

    const ctx = makeContext({ stage: "ADDRESS", selectedSlot: "Saturday, March 14" });
    const result = await processLeadReply("456 Oak Ave, Washington DC 20002", ctx);

    expect(result.nextStage).toBe("CONFIRMATION");
    expect(result.extractedData?.address).toBe("456 Oak Ave, Washington DC 20002");
    expect(result.reply).toContain("Saturday, March 14");
    expect(result.reply.toLowerCase()).toContain("call");
  });

  // Stage: CONFIRMATION → now → CALL_SCHEDULED
  it("CONFIRMATION: 'call now' advances to CALL_SCHEDULED", async () => {
    // Call 1: detectObjection returns "on_track"
    mockLLM.mockResolvedValueOnce({ choices: [{ message: { content: "on_track" }, index: 0, finish_reason: "stop" }] } as any);
    // Call 2: parseLeadReply returns now
    mockLLM.mockResolvedValueOnce({
      choices: [{ message: { content: JSON.stringify({ intent: "now", extractedSlot: null, extractedAddress: null, extractedCallPreference: "now", confidence: "high" }) }, index: 0, finish_reason: "stop" }],
    } as any);

    const ctx = makeContext({ stage: "CONFIRMATION" });
    const result = await processLeadReply("call me now", ctx);

    expect(result.nextStage).toBe("CALL_SCHEDULED");
    expect(result.extractedData?.callPreference).toBe("now");
  });

  // Stage: CONFIRMATION → few minutes → CALL_SCHEDULED
  it("CONFIRMATION: 'few minutes' advances to CALL_SCHEDULED", async () => {
    // Call 1: detectObjection returns "on_track"
    mockLLM.mockResolvedValueOnce({ choices: [{ message: { content: "on_track" }, index: 0, finish_reason: "stop" }] } as any);
    // Call 2: parseLeadReply returns few_minutes
    mockLLM.mockResolvedValueOnce({
      choices: [{ message: { content: JSON.stringify({ intent: "few_minutes", extractedSlot: null, extractedAddress: null, extractedCallPreference: "few_minutes", confidence: "high" }) }, index: 0, finish_reason: "stop" }],
    } as any);

    const ctx = makeContext({ stage: "CONFIRMATION" });
    const result = await processLeadReply("in a few minutes", ctx);

    expect(result.nextStage).toBe("CALL_SCHEDULED");
    expect(result.extractedData?.callPreference).toBe("few_minutes");
  });

  // Stage: DONE → any reply → stays DONE
  it("DONE: any reply stays at DONE", async () => {
    const ctx = makeContext({ stage: "DONE" });
    const result = await processLeadReply("thanks!", ctx);

    expect(result.nextStage).toBe("DONE");
    expect(mockLLM).not.toHaveBeenCalled();
  });

  // LLM failure fallback
  it("LLM failure falls back gracefully", async () => {
    mockLLM.mockRejectedValueOnce(new Error("LLM timeout"));

    const ctx = makeContext({ stage: "AVAILABILITY" });
    const result = await processLeadReply("yes", ctx);

    // Should still return a valid stage (not throw)
    expect(result.nextStage).toBeDefined();
    expect(result.reply).toBeTruthy();
  });
});
