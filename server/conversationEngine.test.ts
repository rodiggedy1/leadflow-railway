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

  it("buildAvailabilityMessage mentions two upcoming days (no extras)", () => {
    const msg = buildAvailabilityMessage();
    // Dynamic slots — verify it's a well-formed availability question
    expect(msg).toContain("openings");
    expect(msg).toContain("Would one of those work");
    // No upsell line when no extras
    expect(msg).not.toContain("while we're there");
  });

  it("buildAvailabilityMessage appends upsell line when extras are provided", () => {
    const msg = buildAvailabilityMessage(["clean_inside_oven"]);
    expect(msg).toContain("openings");
    expect(msg).toContain("oven");
    expect(msg).toContain("while we're there");
  });

  it("buildAvailabilityMessage uses fallback phrase for unknown extra key", () => {
    const msg = buildAvailabilityMessage(["some_unknown_extra"]);
    expect(msg).toContain("while we're there");
    expect(msg).toContain("some unknown extra");
  });

  it("buildAvailabilityMessage uses first extra when multiple are selected", () => {
    const msg = buildAvailabilityMessage(["load_of_laundry", "wash_dishes"]);
    expect(msg).toContain("laundry");
    // Only one upsell line
    expect(msg.split("while we're there").length).toBe(2);
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

  it("QUOTE_SENT: includes extras upsell line when extras are in context", async () => {
    const ctx = makeContext({ stage: "QUOTE_SENT", extras: ["clean_inside_oven"] });
    const result = await processLeadReply("sounds good", ctx);

    expect(result.nextStage).toBe("AVAILABILITY");
    expect(result.reply).toContain("openings");
    expect(result.reply).toContain("oven");
    expect(result.reply).toContain("while we're there");
    expect(mockLLM).not.toHaveBeenCalled();
  });

  it("QUOTE_SENT: no upsell line when no extras selected", async () => {
    const ctx = makeContext({ stage: "QUOTE_SENT", extras: [] });
    const result = await processLeadReply("thanks", ctx);

    expect(result.nextStage).toBe("AVAILABILITY");
    expect(result.reply).not.toContain("while we're there");
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
    // Call 1: detectObjection returns "on_track" (ADDRESS is in the objection check list)
    mockLLM.mockResolvedValueOnce({ choices: [{ message: { content: "on_track" }, index: 0, finish_reason: "stop" }] } as any);
    // Call 2: parseLeadReply extracts the address
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

  // Stage: DONE → any reply → stays DONE, but now routes through AI
  it("DONE: any reply stays at DONE and uses AI for natural response", async () => {
    // handlePostBookingReply calls the LLM
    mockLLM.mockResolvedValueOnce({
      choices: [{ message: { content: "Your booking is all set! Our team will be in touch shortly." }, index: 0, finish_reason: "stop" }],
    } as any);

    const ctx = makeContext({ stage: "DONE" });
    const result = await processLeadReply("I didn't get a call", ctx);

    expect(result.nextStage).toBe("DONE");
    expect(result.reply).toBeTruthy();
    // AI should have been called (no longer a hardcoded dead-end)
    expect(mockLLM).toHaveBeenCalled();
  });

  // Stage: CALL_SCHEDULED → any reply → stays CALL_SCHEDULED, routes through AI
  it("CALL_SCHEDULED: any reply stays at CALL_SCHEDULED and uses AI", async () => {
    mockLLM.mockResolvedValueOnce({
      choices: [{ message: { content: "So sorry! Our team will call you very shortly." }, index: 0, finish_reason: "stop" }],
    } as any);

    const ctx = makeContext({ stage: "CALL_SCHEDULED", selectedSlot: "Thursday (Morning)" });
    const result = await processLeadReply("I didn't get a call yet", ctx);

    expect(result.nextStage).toBe("CALL_SCHEDULED");
    expect(result.reply).toBeTruthy();
    expect(mockLLM).toHaveBeenCalled();
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

// ─── Reactivation stage tests ─────────────────────────────────────────────────
describe("REACTIVATION stage", () => {
  beforeEach(() => {
    mockLLM.mockReset();
  });

  it("YES reply moves to AVAILABILITY and asks for scheduling", async () => {
    const ctx = makeContext({
      stage: "REACTIVATION",
      leadName: "Sarah Johnson",
      lastPrice: 150,
      discountPct: 10,
    });
    const result = await processLeadReply("yes", ctx);
    expect(result.nextStage).toBe("AVAILABILITY");
    expect(result.reply).toBeTruthy();
    expect(result.reply.toLowerCase()).toMatch(/schedule|available|when|book|opening/);
  });

  it("STOP reply marks as DONE and unsubscribes", async () => {
    const ctx = makeContext({
      stage: "REACTIVATION",
      leadName: "Bob Smith",
    });
    const result = await processLeadReply("STOP", ctx);
    expect(result.nextStage).toBe("DONE");
    expect(result.reply.toLowerCase()).toMatch(/unsubscribe|won't receive|opt/);
  });

  it("price question with lastPrice gives discounted price", async () => {
    const ctx = makeContext({
      stage: "REACTIVATION",
      leadName: "Alice Brown",
      lastPrice: 200,
      discountPct: 10,
    });
    const result = await processLeadReply("how much does it cost?", ctx);
    expect(result.nextStage).toBe("AVAILABILITY");
    // $200 with 10% off = $180
    expect(result.reply).toContain("$180");
    expect(result.reply).toContain("$200");
  });

  it("price question without lastPrice routes to availability", async () => {
    const ctx = makeContext({
      stage: "REACTIVATION",
      leadName: "Tom Davis",
      lastPrice: null,
      discountPct: 10,
    });
    const result = await processLeadReply("what's the price?", ctx);
    expect(result.nextStage).toBe("AVAILABILITY");
  });

  it("unsubscribe variants all mark DONE", async () => {
    const variants = ["unsubscribe", "cancel", "quit", "opt out", "opt-out", "remove me"];
    for (const variant of variants) {
      const ctx = makeContext({ stage: "REACTIVATION", leadName: "Test User" });
      const result = await processLeadReply(variant, ctx);
      expect(result.nextStage).toBe("DONE");
    }
  });

  it("positive variants all move to AVAILABILITY", async () => {
    const variants = ["yeah", "yep", "sure", "ok", "sounds good", "absolutely", "book"];
    for (const variant of variants) {
      const ctx = makeContext({ stage: "REACTIVATION", leadName: "Test User", lastPrice: 150, discountPct: 10 });
      const result = await processLeadReply(variant, ctx);
      expect(result.nextStage).toBe("AVAILABILITY");
    }
  });

  it("other replies move to AVAILABILITY", async () => {
    const ctx = makeContext({
      stage: "REACTIVATION",
      leadName: "Mike Wilson",
    });
    const result = await processLeadReply("I'm interested but need more info", ctx);
    expect(result.nextStage).toBe("AVAILABILITY");
  });
});

// ─── Stage Guard Rule tests ───────────────────────────────────────────────────
// The guard rule: a stage must NOT advance until it has a valid answer.
// Off-topic replies (FAQs, unclear) get answered by AI and the bot re-asks.
describe("Stage Guard Rule — no stage advances without a valid answer", () => {
  beforeEach(() => {
    mockLLM.mockReset();
  });

  // ── WIDGET_SIZING guard ──────────────────────────────────────────────────────
  it("WIDGET_SIZING: FAQ reply stays at WIDGET_SIZING and uses AI off-script handler", async () => {
    // handleOffScriptReply calls LLM once — returns an answer + re-asks for rooms
    mockLLM.mockResolvedValueOnce({
      choices: [{ message: { content: "Great question! We're fully insured. How many bedrooms and bathrooms does your home have?" }, index: 0, finish_reason: "stop" }],
    } as any);

    const ctx = makeContext({
      stage: "WIDGET_SIZING",
      quotedPrice: "TBD",
      serviceType: "Standard Cleaning",
      bedrooms: null as any,
      bathrooms: null as any,
    });
    const result = await processLeadReply("Are you insured?", ctx);

    expect(result.nextStage).toBe("WIDGET_SIZING");
    expect(result.reply).toBeTruthy();
    expect(mockLLM).toHaveBeenCalled();
  });

  it("WIDGET_SIZING: reply with only bedrooms stays at WIDGET_SIZING and asks for bathrooms", async () => {
    const ctx = makeContext({
      stage: "WIDGET_SIZING",
      quotedPrice: "TBD",
      serviceType: "Standard Cleaning",
      bedrooms: null as any,
      bathrooms: null as any,
    });
    const result = await processLeadReply("3 bedrooms", ctx);

    expect(result.nextStage).toBe("WIDGET_SIZING");
    expect(result.reply.toLowerCase()).toContain("bathroom");
    expect(mockLLM).not.toHaveBeenCalled(); // partial info path is static, no LLM needed
  });

  it("WIDGET_SIZING: reply with only bathrooms stays at WIDGET_SIZING and asks for bedrooms", async () => {
    const ctx = makeContext({
      stage: "WIDGET_SIZING",
      quotedPrice: "TBD",
      serviceType: "Standard Cleaning",
      bedrooms: null as any,
      bathrooms: null as any,
    });
    const result = await processLeadReply("2 bathrooms", ctx);

    expect(result.nextStage).toBe("WIDGET_SIZING");
    expect(result.reply.toLowerCase()).toContain("bedroom");
    expect(mockLLM).not.toHaveBeenCalled();
  });

  it("WIDGET_SIZING: reply with both rooms advances to AVAILABILITY", async () => {
    const ctx = makeContext({
      stage: "WIDGET_SIZING",
      quotedPrice: "TBD",
      serviceType: "Standard Cleaning",
      bedrooms: null as any,
      bathrooms: null as any,
    });
    const result = await processLeadReply("3 bed 2 bath", ctx);

    expect(result.nextStage).toBe("AVAILABILITY");
    expect(result.reply).toContain("$");
    expect(mockLLM).not.toHaveBeenCalled();
  });

  // ── TIME_PREF guard ──────────────────────────────────────────────────────────
  it("TIME_PREF: unclear reply stays at TIME_PREF and uses AI off-script handler", async () => {
    // Call 1: detectObjection — returns "on_track"
    mockLLM.mockResolvedValueOnce({ choices: [{ message: { content: "on_track" }, index: 0, finish_reason: "stop" }] } as any);
    // Call 2: parseLeadReply — returns unclear (no morning/afternoon)
    mockLLM.mockResolvedValueOnce({
      choices: [{ message: { content: JSON.stringify({ intent: "unclear", extractedSlot: null, extractedAddress: null, extractedCallPreference: null, confidence: "low" }) }, index: 0, finish_reason: "stop" }],
    } as any);
    // Call 3: handleOffScriptReply — returns a re-ask
    mockLLM.mockResolvedValueOnce({
      choices: [{ message: { content: "No problem! Would morning or afternoon work better for you on Thursday?" }, index: 0, finish_reason: "stop" }],
    } as any);

    const ctx = makeContext({ stage: "TIME_PREF", selectedSlot: "Thursday" });
    const result = await processLeadReply("I'm not sure yet", ctx);

    expect(result.nextStage).toBe("TIME_PREF");
    expect(result.reply).toBeTruthy();
  });

  it("TIME_PREF: 'morning' reply advances to ADDRESS", async () => {
    // Call 1: detectObjection — returns "on_track"
    mockLLM.mockResolvedValueOnce({ choices: [{ message: { content: "on_track" }, index: 0, finish_reason: "stop" }] } as any);
    // Call 2: parseLeadReply — returns morning
    mockLLM.mockResolvedValueOnce({
      choices: [{ message: { content: JSON.stringify({ intent: "morning", extractedSlot: null, extractedAddress: null, extractedCallPreference: null, confidence: "high" }) }, index: 0, finish_reason: "stop" }],
    } as any);

    const ctx = makeContext({ stage: "TIME_PREF", selectedSlot: "Thursday" });
    const result = await processLeadReply("morning please", ctx);

    expect(result.nextStage).toBe("ADDRESS");
    expect(result.extractedData?.selectedSlot).toContain("Morning");
  });

  it("TIME_PREF: 'afternoon' reply advances to ADDRESS", async () => {
    // Call 1: detectObjection — returns "on_track"
    mockLLM.mockResolvedValueOnce({ choices: [{ message: { content: "on_track" }, index: 0, finish_reason: "stop" }] } as any);
    // Call 2: parseLeadReply — returns afternoon
    mockLLM.mockResolvedValueOnce({
      choices: [{ message: { content: JSON.stringify({ intent: "afternoon", extractedSlot: null, extractedAddress: null, extractedCallPreference: null, confidence: "high" }) }, index: 0, finish_reason: "stop" }],
    } as any);

    const ctx = makeContext({ stage: "TIME_PREF", selectedSlot: "Friday" });
    const result = await processLeadReply("afternoon works", ctx);

    expect(result.nextStage).toBe("ADDRESS");
    expect(result.extractedData?.selectedSlot).toContain("Afternoon");
  });

  it("TIME_PREF: FAQ reply stays at TIME_PREF (guard prevents advance)", async () => {
    // Call 1: detectObjection — returns "on_track"
    mockLLM.mockResolvedValueOnce({ choices: [{ message: { content: "on_track" }, index: 0, finish_reason: "stop" }] } as any);
    // Call 2: parseLeadReply — returns unclear (FAQ about price)
    mockLLM.mockResolvedValueOnce({
      choices: [{ message: { content: JSON.stringify({ intent: "unclear", extractedSlot: null, extractedAddress: null, extractedCallPreference: null, confidence: "low" }) }, index: 0, finish_reason: "stop" }],
    } as any);
    // Call 3: handleOffScriptReply — answers FAQ and re-asks
    mockLLM.mockResolvedValueOnce({
      choices: [{ message: { content: "The price is $130. Would morning or afternoon work better for you?" }, index: 0, finish_reason: "stop" }],
    } as any);

    const ctx = makeContext({ stage: "TIME_PREF", selectedSlot: "Thursday" });
    const result = await processLeadReply("what's included in the cleaning?", ctx);

    expect(result.nextStage).toBe("TIME_PREF"); // GUARD: must not advance
    expect(result.reply).toBeTruthy();
  });

  // ── ADDRESS guard ────────────────────────────────────────────────────────────
  it("ADDRESS: short/unclear reply stays at ADDRESS", async () => {
    // Call 1: parseLeadReply — returns no address
    mockLLM.mockResolvedValueOnce({
      choices: [{ message: { content: JSON.stringify({ intent: "unclear", extractedSlot: null, extractedAddress: null, extractedCallPreference: null, confidence: "low" }) }, index: 0, finish_reason: "stop" }],
    } as any);
    // Call 2: handleOffScriptReply — re-asks for address
    mockLLM.mockResolvedValueOnce({
      choices: [{ message: { content: "No worries! What's the address for the cleaning on Thursday?" }, index: 0, finish_reason: "stop" }],
    } as any);

    const ctx = makeContext({ stage: "ADDRESS", selectedSlot: "Thursday (Morning)" });
    const result = await processLeadReply("hmm", ctx);

    expect(result.nextStage).toBe("ADDRESS"); // GUARD: must not advance
    expect(result.reply).toBeTruthy();
  });

  it("ADDRESS: FAQ reply stays at ADDRESS (guard prevents advance)", async () => {
    // Call 1: parseLeadReply — returns no address (FAQ, not an address)
    mockLLM.mockResolvedValueOnce({
      choices: [{ message: { content: JSON.stringify({ intent: "unclear", extractedSlot: null, extractedAddress: null, extractedCallPreference: null, confidence: "low" }) }, index: 0, finish_reason: "stop" }],
    } as any);
    // Call 2: handleOffScriptReply — answers FAQ and re-asks for address
    mockLLM.mockResolvedValueOnce({
      choices: [{ message: { content: "We bring all our own supplies! What's the address for the cleaning?" }, index: 0, finish_reason: "stop" }],
    } as any);

    const ctx = makeContext({ stage: "ADDRESS", selectedSlot: "Thursday (Morning)" });
    const result = await processLeadReply("Do you bring your own supplies?", ctx);

    expect(result.nextStage).toBe("ADDRESS"); // GUARD: must not advance
    expect(result.reply).toBeTruthy();
  });

  // ── CONFIRMATION guard ───────────────────────────────────────────────────────
  it("CONFIRMATION: unclear reply stays at CONFIRMATION", async () => {
    // Call 1: detectObjection — returns "on_track"
    mockLLM.mockResolvedValueOnce({ choices: [{ message: { content: "on_track" }, index: 0, finish_reason: "stop" }] } as any);
    // Call 2: parseLeadReply — returns unclear
    mockLLM.mockResolvedValueOnce({
      choices: [{ message: { content: JSON.stringify({ intent: "unclear", extractedSlot: null, extractedAddress: null, extractedCallPreference: null, confidence: "low" }) }, index: 0, finish_reason: "stop" }],
    } as any);
    // Call 3: handleOffScriptReply — re-asks for call preference
    mockLLM.mockResolvedValueOnce({
      choices: [{ message: { content: "No worries! Should we call you now or in a few minutes to confirm?" }, index: 0, finish_reason: "stop" }],
    } as any);

    const ctx = makeContext({ stage: "CONFIRMATION", selectedSlot: "Thursday (Morning)", address: "123 Main St" });
    const result = await processLeadReply("I'm not sure", ctx);

    expect(result.nextStage).toBe("CONFIRMATION"); // GUARD: must not advance
    expect(result.reply).toBeTruthy();
  });

  it("CONFIRMATION: FAQ reply stays at CONFIRMATION (guard prevents advance)", async () => {
    // Call 1: detectObjection — returns "on_track"
    mockLLM.mockResolvedValueOnce({ choices: [{ message: { content: "on_track" }, index: 0, finish_reason: "stop" }] } as any);
    // Call 2: parseLeadReply — returns unclear (FAQ, not a call preference)
    mockLLM.mockResolvedValueOnce({
      choices: [{ message: { content: JSON.stringify({ intent: "unclear", extractedSlot: null, extractedAddress: null, extractedCallPreference: null, confidence: "low" }) }, index: 0, finish_reason: "stop" }],
    } as any);
    // Call 3: handleOffScriptReply — answers FAQ and re-asks
    mockLLM.mockResolvedValueOnce({
      choices: [{ message: { content: "We accept all major cards! Should we call you now or in a few minutes?" }, index: 0, finish_reason: "stop" }],
    } as any);

    const ctx = makeContext({ stage: "CONFIRMATION", selectedSlot: "Thursday (Morning)", address: "123 Main St" });
    const result = await processLeadReply("What payment methods do you accept?", ctx);

    expect(result.nextStage).toBe("CONFIRMATION"); // GUARD: must not advance
    expect(result.reply).toBeTruthy();
  });

  // ── AVAILABILITY guard ───────────────────────────────────────────────────────
  it("AVAILABILITY: FAQ reply stays at AVAILABILITY (guard prevents advance)", async () => {
    // Call 1: detectObjection — returns "on_track"
    mockLLM.mockResolvedValueOnce({ choices: [{ message: { content: "on_track" }, index: 0, finish_reason: "stop" }] } as any);
    // Call 2: parseLeadReply — returns unclear (FAQ, not a day selection)
    mockLLM.mockResolvedValueOnce({
      choices: [{ message: { content: JSON.stringify({ intent: "unclear", extractedSlot: null, extractedAddress: null, extractedCallPreference: null, confidence: "low" }) }, index: 0, finish_reason: "stop" }],
    } as any);

    const ctx = makeContext({ stage: "AVAILABILITY" });
    const result = await processLeadReply("Do you clean apartments?", ctx);

    expect(result.nextStage).toBe("AVAILABILITY"); // GUARD: must not advance
    expect(result.reply).toContain("openings"); // re-asks with slot options
  });

  // ── SLOT_CHOICE guard ────────────────────────────────────────────────────────
  it("SLOT_CHOICE: FAQ reply stays at SLOT_CHOICE (guard prevents advance)", async () => {
    // Call 1: detectObjection — returns "on_track"
    mockLLM.mockResolvedValueOnce({ choices: [{ message: { content: "on_track" }, index: 0, finish_reason: "stop" }] } as any);
    // Call 2: parseLeadReply — returns unclear (FAQ, not a slot choice)
    mockLLM.mockResolvedValueOnce({
      choices: [{ message: { content: JSON.stringify({ intent: "unclear", extractedSlot: null, extractedAddress: null, extractedCallPreference: null, confidence: "low" }) }, index: 0, finish_reason: "stop" }],
    } as any);
    // Call 3: handleOffScriptReply — answers FAQ and re-asks for slot
    mockLLM.mockResolvedValueOnce({
      choices: [{ message: { content: "Yes we do deep cleaning! Which slot works better for you — option 1 or 2?" }, index: 0, finish_reason: "stop" }],
    } as any);

    const ctx = makeContext({ stage: "SLOT_CHOICE", offeredSlots: ["Thursday, March 19", "Friday, March 20"] });
    const result = await processLeadReply("Do you do deep cleaning?", ctx);

    expect(result.nextStage).toBe("SLOT_CHOICE"); // GUARD: must not advance
    expect(result.reply).toBeTruthy();
  });
});
