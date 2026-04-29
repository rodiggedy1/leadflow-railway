/**
 * Two-Step Engine Tests
 *
 * Tests the advanceStage() deterministic logic directly (no LLM needed).
 * This is the core of the new architecture — if advanceStage is correct,
 * the engine is correct regardless of what the LLM extracts.
 */

import { describe, it, expect } from "vitest";
import { advanceStage } from "./advanceStage";
import type { LeadSignals } from "./extractSchema";
import type { ConversationContext } from "../conversationEngine";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function emptySignals(overrides: Partial<LeadSignals> = {}): LeadSignals {
  return {
    bedrooms: null,
    bathrooms: null,
    timeSlot: null,
    dayPreference: null,
    address: null,
    callPreference: null,
    specialScope: null,
    optOut: false,
    isFlexible: false,
    questions: [],
    wantsFutureBooking: false,
    isExistingCustomer: false,
    serviceType: null,
    quotedPrice: null,
    ...overrides,
  };
}

function ctx(stage: string, overrides: Partial<ConversationContext> = {}): ConversationContext {
  return {
    stage: stage as ConversationContext["stage"],
    leadName: "Test Lead",
    smsFlow: "A",
    messageHistory: [],
    ...overrides,
  } as ConversationContext;
}

// ─── Opt-out ──────────────────────────────────────────────────────────────────

describe("advanceStage — opt-out always wins", () => {
  it("moves to DONE from any stage on opt-out", () => {
    const result = advanceStage("SLOT_CHOICE", emptySignals({ optOut: true }), ctx("SLOT_CHOICE"));
    expect(result.nextStage).toBe("DONE");
  });
});

// ─── WIDGET_SIZING ────────────────────────────────────────────────────────────

describe("advanceStage — WIDGET_SIZING", () => {
  it("advances to AVAILABILITY when both bedrooms and bathrooms provided", () => {
    const result = advanceStage("WIDGET_SIZING", emptySignals({ bedrooms: "2 Bedrooms", bathrooms: "2 Bathrooms" }), ctx("WIDGET_SIZING"));
    expect(result.nextStage).toBe("AVAILABILITY");
    expect(result.persistedData.bedrooms).toBe("2 Bedrooms");
    expect(result.persistedData.bathrooms).toBe("2 Bathrooms");
  });

  it("stays on WIDGET_SIZING when only bedrooms provided", () => {
    const result = advanceStage("WIDGET_SIZING", emptySignals({ bedrooms: "3 Bedrooms" }), ctx("WIDGET_SIZING"));
    expect(result.nextStage).toBe("WIDGET_SIZING");
  });

  it("stays on WIDGET_SIZING when only bathrooms provided", () => {
    const result = advanceStage("WIDGET_SIZING", emptySignals({ bathrooms: "2 Bathrooms" }), ctx("WIDGET_SIZING"));
    expect(result.nextStage).toBe("WIDGET_SIZING");
  });

  it("advances to AVAILABILITY on special scope (only the basement)", () => {
    const result = advanceStage("WIDGET_SIZING", emptySignals({ specialScope: "only the basement" }), ctx("WIDGET_SIZING"));
    expect(result.nextStage).toBe("AVAILABILITY");
    expect(result.persistedData.bedrooms).toBe("1 Bedrooms");
    expect(result.persistedData.bathrooms).toBe("1 Bathrooms");
    expect(result.persistedData.specialScope).toBe("only the basement");
  });

  it("advances to AVAILABILITY on special scope (just the kitchen)", () => {
    const result = advanceStage("WIDGET_SIZING", emptySignals({ specialScope: "just the kitchen" }), ctx("WIDGET_SIZING"));
    expect(result.nextStage).toBe("AVAILABILITY");
  });

  it("uses context bedrooms when only bathrooms provided in message", () => {
    const result = advanceStage("WIDGET_SIZING", emptySignals({ bathrooms: "1 Bathroom" }), ctx("WIDGET_SIZING", { bedrooms: "2 Bedrooms" }));
    expect(result.nextStage).toBe("AVAILABILITY");
  });
});

// ─── AVAILABILITY ─────────────────────────────────────────────────────────────

describe("advanceStage — AVAILABILITY", () => {
  it("advances to SLOT_CHOICE when specific day mentioned", () => {
    const result = advanceStage("AVAILABILITY", emptySignals({ dayPreference: "Thursday, May 1" }), ctx("AVAILABILITY"));
    expect(result.nextStage).toBe("SLOT_CHOICE");
    expect(result.persistedData.selectedSlot).toBe("Thursday, May 1");
  });

  it("advances to SLOT_CHOICE with default slot when lead is flexible", () => {
    const result = advanceStage("AVAILABILITY", emptySignals({ isFlexible: true }), ctx("AVAILABILITY"));
    expect(result.nextStage).toBe("SLOT_CHOICE");
    expect(result.persistedData.selectedSlot).toBeTruthy();
    expect(result.replyContext.usedDefault).toBe(true);
  });

  it("stays on AVAILABILITY when no day info", () => {
    const result = advanceStage("AVAILABILITY", emptySignals(), ctx("AVAILABILITY"));
    expect(result.nextStage).toBe("AVAILABILITY");
  });

  it("moves to FUTURE_BOOKING when lead wants future booking", () => {
    const result = advanceStage("AVAILABILITY", emptySignals({ wantsFutureBooking: true }), ctx("AVAILABILITY"));
    expect(result.nextStage).toBe("FUTURE_BOOKING");
  });
});

// ─── SLOT_CHOICE ──────────────────────────────────────────────────────────────

describe("advanceStage — SLOT_CHOICE (the main bug scenario)", () => {
  it("advances to ADDRESS when lead says '9am'", () => {
    const result = advanceStage("SLOT_CHOICE", emptySignals({ timeSlot: "9am" }), ctx("SLOT_CHOICE", { selectedSlot: "Saturday, May 9" }));
    expect(result.nextStage).toBe("ADDRESS");
    expect(result.persistedData.selectedSlot).toBe("Saturday, May 9 at 9am");
  });

  it("advances to ADDRESS when lead says '1pm'", () => {
    const result = advanceStage("SLOT_CHOICE", emptySignals({ timeSlot: "1pm" }), ctx("SLOT_CHOICE", { selectedSlot: "Saturday, May 9" }));
    expect(result.nextStage).toBe("ADDRESS");
    expect(result.persistedData.selectedSlot).toBe("Saturday, May 9 at 1pm");
  });

  it("advances to ADDRESS when lead says 'grab 9am, are the teams insured?' (multi-intent)", () => {
    // The extraction would return: timeSlot: "9am", questions: ["Are the teams insured?"]
    const result = advanceStage("SLOT_CHOICE", emptySignals({ timeSlot: "9am", questions: ["Are the teams insured?"] }), ctx("SLOT_CHOICE", { selectedSlot: "Saturday, May 9" }));
    expect(result.nextStage).toBe("ADDRESS");
    expect(result.persistedData.selectedSlot).toBe("Saturday, May 9 at 9am");
  });

  it("advances to ADDRESS with default 9am when lead says 'any day works'", () => {
    const result = advanceStage("SLOT_CHOICE", emptySignals({ isFlexible: true }), ctx("SLOT_CHOICE", { selectedSlot: "Saturday, May 9" }));
    expect(result.nextStage).toBe("ADDRESS");
    expect(result.persistedData.selectedSlot).toBe("Saturday, May 9 at 9am");
    expect(result.replyContext.usedDefault).toBe(true);
  });

  it("advances to ADDRESS with default 9am when timeSlot is 'any'", () => {
    const result = advanceStage("SLOT_CHOICE", emptySignals({ timeSlot: "any" }), ctx("SLOT_CHOICE", { selectedSlot: "Saturday, May 9" }));
    expect(result.nextStage).toBe("ADDRESS");
    expect(result.persistedData.selectedSlot).toBe("Saturday, May 9 at 9am");
  });

  it("advances to ADDRESS when lead says 'either works'", () => {
    const result = advanceStage("SLOT_CHOICE", emptySignals({ isFlexible: true }), ctx("SLOT_CHOICE", { selectedSlot: "Thursday, May 1" }));
    expect(result.nextStage).toBe("ADDRESS");
    expect(result.persistedData.selectedSlot).toBe("Thursday, May 1 at 9am");
  });

  it("stays on SLOT_CHOICE when only a question asked (no slot)", () => {
    const result = advanceStage("SLOT_CHOICE", emptySignals({ questions: ["Do you bring supplies?"] }), ctx("SLOT_CHOICE", { selectedSlot: "Saturday, May 9" }));
    expect(result.nextStage).toBe("SLOT_CHOICE");
  });
});

// ─── ADDRESS ──────────────────────────────────────────────────────────────────

describe("advanceStage — ADDRESS", () => {
  it("advances to CONFIRMATION when valid address provided", () => {
    const result = advanceStage("ADDRESS", emptySignals({ address: "123 Main St, Washington DC 20001" }), ctx("ADDRESS"));
    expect(result.nextStage).toBe("CONFIRMATION");
    expect(result.persistedData.address).toBe("123 Main St, Washington DC 20001");
  });

  it("stays on ADDRESS when no address", () => {
    const result = advanceStage("ADDRESS", emptySignals(), ctx("ADDRESS"));
    expect(result.nextStage).toBe("ADDRESS");
  });

  it("stays on ADDRESS when address too short (not a real address)", () => {
    const result = advanceStage("ADDRESS", emptySignals({ address: "123 Main" }), ctx("ADDRESS"));
    expect(result.nextStage).toBe("ADDRESS");
  });
});

// ─── CONFIRMATION ─────────────────────────────────────────────────────────────

describe("advanceStage — CONFIRMATION", () => {
  it("advances to CALL_SCHEDULED when callPreference is 'now'", () => {
    const result = advanceStage("CONFIRMATION", emptySignals({ callPreference: "now" }), ctx("CONFIRMATION"));
    expect(result.nextStage).toBe("CALL_SCHEDULED");
    expect(result.persistedData.callPreference).toBe("now");
  });

  it("advances to CALL_SCHEDULED when callPreference is 'few_minutes'", () => {
    const result = advanceStage("CONFIRMATION", emptySignals({ callPreference: "few_minutes" }), ctx("CONFIRMATION"));
    expect(result.nextStage).toBe("CALL_SCHEDULED");
  });

  it("advances to CALL_SCHEDULED even with no explicit call preference (any reply advances)", () => {
    const result = advanceStage("CONFIRMATION", emptySignals(), ctx("CONFIRMATION"));
    expect(result.nextStage).toBe("CALL_SCHEDULED");
  });

  it("advances to CALL_SCHEDULED when lead gives notes/questions (any reply advances)", () => {
    const result = advanceStage("CONFIRMATION", emptySignals({ questions: ["Do you have parking?"] }), ctx("CONFIRMATION"));
    expect(result.nextStage).toBe("CALL_SCHEDULED");
  });
});

// ─── Full flow ────────────────────────────────────────────────────────────────

describe("advanceStage — full happy path", () => {
  it("WIDGET_SIZING → AVAILABILITY → SLOT_CHOICE → ADDRESS → CONFIRMATION → CALL_SCHEDULED", () => {
    let result = advanceStage("WIDGET_SIZING", emptySignals({ bedrooms: "2 Bedrooms", bathrooms: "2 Bathrooms" }), ctx("WIDGET_SIZING"));
    expect(result.nextStage).toBe("AVAILABILITY");

    result = advanceStage("AVAILABILITY", emptySignals({ dayPreference: "Thursday, May 1" }), ctx("AVAILABILITY"));
    expect(result.nextStage).toBe("SLOT_CHOICE");

    result = advanceStage("SLOT_CHOICE", emptySignals({ timeSlot: "9am" }), ctx("SLOT_CHOICE", { selectedSlot: "Thursday, May 1" }));
    expect(result.nextStage).toBe("ADDRESS");

    result = advanceStage("ADDRESS", emptySignals({ address: "456 Oak Ave, Bethesda MD 20814" }), ctx("ADDRESS"));
    expect(result.nextStage).toBe("CONFIRMATION");

    result = advanceStage("CONFIRMATION", emptySignals({ callPreference: "now" }), ctx("CONFIRMATION"));
    expect(result.nextStage).toBe("CALL_SCHEDULED");
  });
});
