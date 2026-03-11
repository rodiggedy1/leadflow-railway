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

  it("buildAvailabilityMessage mentions Thursday and Saturday", () => {
    const msg = buildAvailabilityMessage();
    expect(msg).toContain("Thursday");
    expect(msg).toContain("Saturday");
  });

  it("buildSlotChoiceMessage shows both time slots", () => {
    const msg = buildSlotChoiceMessage();
    expect(msg).toContain("Thursday 1PM");
    expect(msg).toContain("Saturday 9AM");
  });

  it("buildAddressRequestMessage asks for address", () => {
    const msg = buildAddressRequestMessage("Thursday 1PM");
    expect(msg.toLowerCase()).toContain("address");
  });

  it("buildConfirmationMessage includes slot and address", () => {
    const msg = buildConfirmationMessage("Saturday 9AM", "123 Main St, DC 20001");
    expect(msg).toContain("Saturday");
    expect(msg).toContain("9:00 AM");
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
    expect(result.reply).toContain("Thursday");
    expect(mockLLM).not.toHaveBeenCalled();
  });

  // Stage: AVAILABILITY → yes → SLOT_CHOICE
  it("AVAILABILITY: positive reply advances to SLOT_CHOICE", async () => {
    mockLLM.mockResolvedValueOnce({
      choices: [{ message: { content: JSON.stringify({ intent: "yes", extractedSlot: null, extractedAddress: null, extractedCallPreference: null, confidence: "high" }) }, index: 0, finish_reason: "stop" }],
    } as any);

    const ctx = makeContext({ stage: "AVAILABILITY" });
    const result = await processLeadReply("yes that works!", ctx);

    expect(result.nextStage).toBe("SLOT_CHOICE");
    expect(result.reply).toContain("Thursday 1PM");
    expect(result.reply).toContain("Saturday 9AM");
  });

  // Stage: AVAILABILITY → no → DONE
  it("AVAILABILITY: negative reply ends conversation", async () => {
    // Call 1: detectObjection returns "on_track" (no objection)
    mockLLM.mockResolvedValueOnce({ choices: [{ message: { content: "on_track" }, index: 0, finish_reason: "stop" }] } as any);
    // Call 2: parseLeadReply returns intent "no"
    mockLLM.mockResolvedValueOnce({
      choices: [{ message: { content: JSON.stringify({ intent: "no", extractedSlot: null, extractedAddress: null, extractedCallPreference: null, confidence: "high" }) }, index: 0, finish_reason: "stop" }],
    } as any);

    const ctx = makeContext({ stage: "AVAILABILITY" });
    const result = await processLeadReply("no thanks", ctx);

    expect(result.nextStage).toBe("DONE");
  });

  // Stage: SLOT_CHOICE → thursday → ADDRESS
  it("SLOT_CHOICE: 'thursday' reply captures slot and advances to ADDRESS", async () => {
    // Call 1: detectObjection returns "on_track"
    mockLLM.mockResolvedValueOnce({ choices: [{ message: { content: "on_track" }, index: 0, finish_reason: "stop" }] } as any);
    // Call 2: parseLeadReply returns thursday
    mockLLM.mockResolvedValueOnce({
      choices: [{ message: { content: JSON.stringify({ intent: "thursday", extractedSlot: "Thursday 1PM", extractedAddress: null, extractedCallPreference: null, confidence: "high" }) }, index: 0, finish_reason: "stop" }],
    } as any);

    const ctx = makeContext({ stage: "SLOT_CHOICE" });
    const result = await processLeadReply("thursday works", ctx);

    expect(result.nextStage).toBe("ADDRESS");
    expect(result.extractedData?.selectedSlot).toBe("Thursday 1PM");
    expect(result.reply.toLowerCase()).toContain("address");
  });

  // Stage: SLOT_CHOICE → saturday → ADDRESS
  it("SLOT_CHOICE: 'saturday' reply captures slot and advances to ADDRESS", async () => {
    // Call 1: detectObjection returns "on_track"
    mockLLM.mockResolvedValueOnce({ choices: [{ message: { content: "on_track" }, index: 0, finish_reason: "stop" }] } as any);
    // Call 2: parseLeadReply returns saturday
    mockLLM.mockResolvedValueOnce({
      choices: [{ message: { content: JSON.stringify({ intent: "saturday", extractedSlot: "Saturday 9AM", extractedAddress: null, extractedCallPreference: null, confidence: "high" }) }, index: 0, finish_reason: "stop" }],
    } as any);

    const ctx = makeContext({ stage: "SLOT_CHOICE" });
    const result = await processLeadReply("saturday 9am", ctx);

    expect(result.nextStage).toBe("ADDRESS");
    expect(result.extractedData?.selectedSlot).toBe("Saturday 9AM");
  });

  // Stage: SLOT_CHOICE → unclear → re-prompt
  it("SLOT_CHOICE: unclear reply stays at SLOT_CHOICE", async () => {
    mockLLM.mockResolvedValueOnce({
      choices: [{ message: { content: JSON.stringify({ intent: "unclear", extractedSlot: null, extractedAddress: null, extractedCallPreference: null, confidence: "low" }) }, index: 0, finish_reason: "stop" }],
    } as any);

    const ctx = makeContext({ stage: "SLOT_CHOICE" });
    const result = await processLeadReply("hmm not sure", ctx);

    expect(result.nextStage).toBe("SLOT_CHOICE");
    expect(result.reply).toContain("Thursday");
  });

  // Stage: ADDRESS → address provided → CONFIRMATION
  it("ADDRESS: address reply captured and advances to CONFIRMATION", async () => {
    mockLLM.mockResolvedValueOnce({
      choices: [{ message: { content: JSON.stringify({ intent: "address_provided", extractedSlot: null, extractedAddress: "456 Oak Ave, Washington DC 20002", extractedCallPreference: null, confidence: "high" }) }, index: 0, finish_reason: "stop" }],
    } as any);

    const ctx = makeContext({ stage: "ADDRESS", selectedSlot: "Saturday 9AM" });
    const result = await processLeadReply("456 Oak Ave, Washington DC 20002", ctx);

    expect(result.nextStage).toBe("CONFIRMATION");
    expect(result.extractedData?.address).toBe("456 Oak Ave, Washington DC 20002");
    expect(result.reply).toContain("Saturday");
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
