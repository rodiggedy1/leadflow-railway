/**
 * Price Validator Tests — server/priceValidator.test.ts
 *
 * Tests the two-layer price verification system in aiService.ts:
 *
 * Layer 1 — get_price Tool Call:
 *   The LLM is given a get_price tool so it never calculates prices itself.
 *   When the model calls the tool, we execute calculatePrice/calculateRecurringPrice
 *   locally and feed the verified result back. The model formats the message around
 *   the verified number.
 *
 * Layer 2 — Post-generation Price Validator:
 *   validatePriceInReply() scans every generated SMS for $NNN patterns and
 *   rejects any amount not in the valid set for this lead. On failure it retries
 *   once, then falls back to a hardcoded safe string.
 *
 * Test strategy:
 *   - validatePriceInReply and buildValidPriceSet are private — tested indirectly
 *     through handleOffScriptReply and handleObjection (the public API).
 *   - We mock invokeLLM to return replies with specific dollar amounts and verify
 *     the validator catches hallucinated prices and passes correct ones.
 *   - We also test the tool call path by mocking invokeLLM to return tool_calls
 *     on Pass 1 and a final text on Pass 2.
 *
 * Known prices for 2 Bedrooms / 1 Bathroom / Standard Cleaning:
 *   one-time = $239, weekly = $191, biweekly = $203, monthly = $215
 *
 * Known prices for 2 Bedrooms / 2 Bathrooms / Standard Cleaning:
 *   one-time = $269, weekly = $215, biweekly = $229, monthly = $242
 *
 * Known prices for 1 Bedroom / 1 Bathroom / Standard Cleaning:
 *   one-time = $149, weekly = $119, biweekly = $127, monthly = $134
 *
 * Known prices for 2 Bedrooms / 2 Bathrooms / Deep Cleaning:
 *   one-time = $329, weekly = $263, biweekly = $280, monthly = $296
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { handleOffScriptReply, handleObjection } from "./aiService";

// ─── Mock LLM ─────────────────────────────────────────────────────────────────
vi.mock("./_core/llm", () => ({
  invokeLLM: vi.fn(),
}));
import { invokeLLM } from "./_core/llm";
const mockLLM = vi.mocked(invokeLLM);

/** Helper: LLM returns a plain text reply (no tool call) */
function makePlainReply(content: string) {
  return {
    id: "test",
    created: 0,
    model: "test",
    choices: [{ message: { role: "assistant", content, tool_calls: undefined }, index: 0, finish_reason: "stop" }],
  } as any;
}

/** Helper: LLM returns a tool_call for get_price on Pass 1 */
function makeToolCallReply(args: {
  bedrooms: string;
  bathrooms: string;
  serviceType: string;
  frequency: string;
}) {
  return {
    id: "test",
    created: 0,
    model: "test",
    choices: [{
      message: {
        role: "assistant",
        content: null,
        tool_calls: [{
          id: "call_001",
          type: "function",
          function: {
            name: "get_price",
            arguments: JSON.stringify(args),
          },
        }],
      },
      index: 0,
      finish_reason: "tool_calls",
    }],
  } as any;
}

/** Helper: LLM returns wrong_path: false for isWrongPathReply classifier */
function makeWrongPathFalse() {
  return makePlainReply(JSON.stringify({ wrong_path: false }));
}

// ─── Shared test context ──────────────────────────────────────────────────────
const baseOffScriptCtx = {
  stage: "AVAILABILITY" as const,
  leadName: "Malika Berry",
  quotedPrice: "239",
  serviceType: "Standard Cleaning",
  bedrooms: "2 Bedrooms",
  bathrooms: "1 Bathroom",
  selectedSlot: null,
  messageHistory: [
    { role: "assistant" as const, content: "We have openings Thu or Sat. Does that work?" },
  ],
  leadReply: "What's the bi-weekly price?",
};

// ─── Layer 2: Post-generation Price Validator ─────────────────────────────────
describe("Layer 2 — Price Validator (via handleOffScriptReply)", () => {
  beforeEach(() => mockLLM.mockReset());

  // 2 bed / 1 bath / Standard: one-time=$239, weekly=$191, biweekly=$203, monthly=$215
  it("passes a reply containing the correct one-time price ($239)", async () => {
    // Call 1: isWrongPathReply → false
    mockLLM.mockResolvedValueOnce(makeWrongPathFalse());
    // Call 2: invokeLLMWithPriceTool Pass 1 → direct reply with correct price
    mockLLM.mockResolvedValueOnce(makePlainReply("Your one-time clean is $239 — does Thu or Sat work?"));

    const result = await handleOffScriptReply(baseOffScriptCtx);
    expect(result.reply).toContain("$239");
    expect(result.isWrongPath).toBe(false);
  });

  it("passes a reply containing the correct bi-weekly price ($203)", async () => {
    mockLLM.mockResolvedValueOnce(makeWrongPathFalse());
    mockLLM.mockResolvedValueOnce(makePlainReply("Bi-weekly is $203/clean (15% off). Does Thu or Sat work?"));

    const result = await handleOffScriptReply(baseOffScriptCtx);
    expect(result.reply).toContain("$203");
  });

  it("passes a reply containing the correct monthly price ($215)", async () => {
    mockLLM.mockResolvedValueOnce(makeWrongPathFalse());
    mockLLM.mockResolvedValueOnce(makePlainReply("Monthly plan is $215/clean (10% off). Does Thu or Sat work?"));

    const result = await handleOffScriptReply(baseOffScriptCtx);
    expect(result.reply).toContain("$215");
  });

  it("passes a reply containing the correct weekly price ($191)", async () => {
    mockLLM.mockResolvedValueOnce(makeWrongPathFalse());
    mockLLM.mockResolvedValueOnce(makePlainReply("Weekly plan is $191/clean (20% off). Does Thu or Sat work?"));

    const result = await handleOffScriptReply(baseOffScriptCtx);
    expect(result.reply).toContain("$191");
  });

  it("passes a reply with no dollar amounts (conversational)", async () => {
    mockLLM.mockResolvedValueOnce(makeWrongPathFalse());
    mockLLM.mockResolvedValueOnce(makePlainReply("Yes, we bring all our own supplies! Does Thu or Sat work?"));

    const result = await handleOffScriptReply(baseOffScriptCtx);
    expect(result.reply).toContain("supplies");
  });

  it("rejects a hallucinated price on first attempt, retries, and uses second attempt if valid", async () => {
    // Call 1: isWrongPathReply → false
    mockLLM.mockResolvedValueOnce(makeWrongPathFalse());
    // Call 2: Pass 1 — hallucinated price ($175 is not valid for 2bed/1bath)
    mockLLM.mockResolvedValueOnce(makePlainReply("Bi-weekly is $175/clean. Does Thu or Sat work?"));
    // Call 3: retry Pass 1 — correct price this time
    mockLLM.mockResolvedValueOnce(makePlainReply("Bi-weekly is $203/clean (15% off). Does Thu or Sat work?"));

    const result = await handleOffScriptReply(baseOffScriptCtx);
    expect(result.reply).toContain("$203");
    expect(result.reply).not.toContain("$175");
  });

  it("falls back to hardcoded string when both attempts have hallucinated prices", async () => {
    // Call 1: isWrongPathReply → false
    mockLLM.mockResolvedValueOnce(makeWrongPathFalse());
    // Call 2: Pass 1 — hallucinated price
    mockLLM.mockResolvedValueOnce(makePlainReply("Bi-weekly is $175/clean. Does Thu or Sat work?"));
    // Call 3: retry Pass 1 — still hallucinated
    mockLLM.mockResolvedValueOnce(makePlainReply("Bi-weekly is $180/clean. Does Thu or Sat work?"));

    const result = await handleOffScriptReply(baseOffScriptCtx);
    // Should fall back to hardcoded string — no hallucinated price
    expect(result.reply).not.toContain("$175");
    expect(result.reply).not.toContain("$180");
    expect(result.reply.length).toBeGreaterThan(10); // fallback is non-empty
  });

  it("passes a reply with allowed surcharge amount ($60 for Deep Cleaning context)", async () => {
    mockLLM.mockResolvedValueOnce(makeWrongPathFalse());
    // $60 is in the allowed set (surcharges), $239 is the one-time price
    mockLLM.mockResolvedValueOnce(makePlainReply("Deep Cleaning adds $60 to the base. Your total is $239. Does Thu or Sat work?"));

    const result = await handleOffScriptReply(baseOffScriptCtx);
    // $60 is in valid set, $239 is the one-time price — both valid
    expect(result.reply).toContain("$60");
  });

  it("skips validation when bedrooms/bathrooms are unknown (no false positives)", async () => {
    const ctxNoSize = {
      ...baseOffScriptCtx,
      bedrooms: undefined,
      bathrooms: undefined,
      quotedPrice: "239",
    };
    mockLLM.mockResolvedValueOnce(makeWrongPathFalse());
    // Any price passes when home size is unknown
    mockLLM.mockResolvedValueOnce(makePlainReply("Bi-weekly is $175/clean. Does Thu or Sat work?"));

    const result = await handleOffScriptReply(ctxNoSize);
    // Validator skips (returns true) when home size unknown — passes through
    expect(result.reply).toContain("$175");
  });
});

// ─── Layer 1: Tool Call Path ──────────────────────────────────────────────────
describe("Layer 1 — get_price Tool Call (via handleOffScriptReply)", () => {
  beforeEach(() => mockLLM.mockReset());

  it("executes tool call and uses verified price in final reply", async () => {
    // Call 1: isWrongPathReply → false
    mockLLM.mockResolvedValueOnce(makeWrongPathFalse());
    // Call 2: Pass 1 — LLM calls get_price tool for biweekly
    mockLLM.mockResolvedValueOnce(makeToolCallReply({
      bedrooms: "2 Bedrooms",
      bathrooms: "1 Bathroom",
      serviceType: "Standard Cleaning",
      frequency: "biweekly",
    }));
    // Call 3: Pass 2 — LLM formats the verified price ($203) into a reply
    mockLLM.mockResolvedValueOnce(makePlainReply("Bi-weekly is $203/clean (15% off). Does Thu or Sat work?"));

    const result = await handleOffScriptReply(baseOffScriptCtx);
    // The tool was called, price was verified, final reply has the correct price
    expect(result.reply).toContain("$203");
    // invokeLLM should have been called 3 times: classifier + pass1 + pass2
    expect(mockLLM).toHaveBeenCalledTimes(3);
  });

  it("uses fallback args when tool call omits bedrooms/bathrooms", async () => {
    mockLLM.mockResolvedValueOnce(makeWrongPathFalse());
    // Tool call with missing bedrooms/bathrooms — should use context fallback values
    mockLLM.mockResolvedValueOnce(makeToolCallReply({
      bedrooms: "",
      bathrooms: "",
      serviceType: "Standard Cleaning",
      frequency: "monthly",
    }));
    // Pass 2 — LLM uses the tool result (which used fallback values)
    mockLLM.mockResolvedValueOnce(makePlainReply("Monthly plan is $215/clean. Does Thu or Sat work?"));

    const result = await handleOffScriptReply(baseOffScriptCtx);
    expect(result.reply).toBeTruthy();
    // Should not throw even with empty bedrooms/bathrooms in tool args
    expect(result.isWrongPath).toBe(false);
  });

  it("falls back to hardcoded string when Pass 2 returns a hallucinated price", async () => {
    // Call 1: isWrongPathReply → false
    mockLLM.mockResolvedValueOnce(makeWrongPathFalse());
    // Call 2: Pass 1 — tool call
    mockLLM.mockResolvedValueOnce(makeToolCallReply({
      bedrooms: "2 Bedrooms",
      bathrooms: "1 Bathroom",
      serviceType: "Standard Cleaning",
      frequency: "biweekly",
    }));
    // Call 3: Pass 2 — LLM ignores tool result and hallucinates anyway
    mockLLM.mockResolvedValueOnce(makePlainReply("Bi-weekly is $175/clean. Does Thu or Sat work?"));
    // Call 4: retry Pass 1 — still wrong
    mockLLM.mockResolvedValueOnce(makeToolCallReply({
      bedrooms: "2 Bedrooms",
      bathrooms: "1 Bathroom",
      serviceType: "Standard Cleaning",
      frequency: "biweekly",
    }));
    // Call 5: retry Pass 2 — still wrong
    mockLLM.mockResolvedValueOnce(makePlainReply("Bi-weekly is $180/clean. Does Thu or Sat work?"));

    const result = await handleOffScriptReply(baseOffScriptCtx);
    // Layer 2 catches both hallucinations — falls back to hardcoded string
    expect(result.reply).not.toContain("$175");
    expect(result.reply).not.toContain("$180");
    expect(result.reply.length).toBeGreaterThan(10);
  });
});

// ─── handleObjection price validation ────────────────────────────────────────
describe("Layer 2 — Price Validator (via handleObjection)", () => {
  beforeEach(() => mockLLM.mockReset());

  const objCtx = {
    leadName: "Malika Berry",
    quotedPrice: "239",
    serviceType: "Standard Cleaning",
    bedrooms: "2 Bedrooms",
    bathrooms: "1 Bathroom",
  };

  it("passes a price_too_high objection reply with correct recurring price ($203)", async () => {
    // Pass 1: direct reply (no tool call)
    mockLLM.mockResolvedValueOnce(
      makePlainReply("We get it! Bi-weekly is only $203/clean — saves 15%. Does Thu or Sat work?")
    );

    const result = await handleObjection("price_too_high", objCtx);
    expect(result.reply).toContain("$203");
    expect(result.nextStage).toBeNull();
  });

  it("rejects hallucinated price in price_too_high reply and retries", async () => {
    // Pass 1: hallucinated price
    mockLLM.mockResolvedValueOnce(
      makePlainReply("We get it! Bi-weekly is only $175/clean. Does Thu or Sat work?")
    );
    // Retry Pass 1: correct price
    mockLLM.mockResolvedValueOnce(
      makePlainReply("We get it! Bi-weekly is only $203/clean — saves 15%. Does Thu or Sat work?")
    );

    const result = await handleObjection("price_too_high", objCtx);
    expect(result.reply).toContain("$203");
    expect(result.reply).not.toContain("$175");
  });

  it("falls back to hardcoded string when both attempts hallucinate", async () => {
    mockLLM.mockResolvedValueOnce(
      makePlainReply("Bi-weekly is only $175/clean. Does Thu or Sat work?")
    );
    mockLLM.mockResolvedValueOnce(
      makePlainReply("Bi-weekly is only $180/clean. Does Thu or Sat work?")
    );

    const result = await handleObjection("price_too_high", objCtx);
    expect(result.reply).not.toContain("$175");
    expect(result.reply).not.toContain("$180");
    // Fallback contains "insured" (from the hardcoded fallback string)
    expect(result.reply.toLowerCase()).toContain("insured");
  });

  it("non-price objections (not_available) pass through without price validation", async () => {
    mockLLM.mockResolvedValueOnce(
      makePlainReply("No problem! We have other openings. What days work best for you?")
    );

    const result = await handleObjection("not_available", objCtx);
    expect(result.reply).toBeTruthy();
    expect(result.nextStage).toBeNull();
  });

  it("future_booking objection sets nextStage to FUTURE_BOOKING", async () => {
    mockLLM.mockResolvedValueOnce(
      makePlainReply("That's perfect — we'd love to help when the time comes! Reach out when you're ready.")
    );

    const result = await handleObjection("future_booking", objCtx);
    expect(result.nextStage).toBe("FUTURE_BOOKING");
  });
});

// ─── Different home sizes ─────────────────────────────────────────────────────
describe("Layer 2 — Price Validator with different home sizes", () => {
  beforeEach(() => mockLLM.mockReset());

  it("validates prices correctly for 2bed/2bath ($269 one-time, $229 biweekly)", async () => {
    const ctx = {
      ...baseOffScriptCtx,
      bedrooms: "2 Bedrooms",
      bathrooms: "2 Bathrooms",
      quotedPrice: "269",
    };
    mockLLM.mockResolvedValueOnce(makeWrongPathFalse());
    mockLLM.mockResolvedValueOnce(makePlainReply("Bi-weekly is $229/clean. Does Thu or Sat work?"));

    const result = await handleOffScriptReply(ctx);
    expect(result.reply).toContain("$229");
  });

  it("rejects a price valid for 2bed/2bath but wrong for 2bed/1bath", async () => {
    // $229 is valid for 2bed/2bath but NOT for 2bed/1bath (which has $203 biweekly)
    const ctx = {
      ...baseOffScriptCtx,
      bedrooms: "2 Bedrooms",
      bathrooms: "1 Bathroom",
      quotedPrice: "239",
    };
    mockLLM.mockResolvedValueOnce(makeWrongPathFalse());
    // First attempt: wrong price for this home size
    mockLLM.mockResolvedValueOnce(makePlainReply("Bi-weekly is $229/clean. Does Thu or Sat work?"));
    // Second attempt: correct price
    mockLLM.mockResolvedValueOnce(makePlainReply("Bi-weekly is $203/clean. Does Thu or Sat work?"));

    const result = await handleOffScriptReply(ctx);
    expect(result.reply).toContain("$203");
    expect(result.reply).not.toContain("$229");
  });

  it("validates prices correctly for 1bed/1bath ($149 one-time, $127 biweekly)", async () => {
    const ctx = {
      ...baseOffScriptCtx,
      bedrooms: "1 Bedroom",
      bathrooms: "1 Bathroom",
      quotedPrice: "149",
    };
    mockLLM.mockResolvedValueOnce(makeWrongPathFalse());
    mockLLM.mockResolvedValueOnce(makePlainReply("Bi-weekly is $127/clean. Does Thu or Sat work?"));

    const result = await handleOffScriptReply(ctx);
    expect(result.reply).toContain("$127");
  });

  it("rejects a price that would be correct for a larger home but wrong for 1bed/1bath", async () => {
    // $203 is valid for 2bed/1bath biweekly but NOT for 1bed/1bath
    const ctx = {
      ...baseOffScriptCtx,
      bedrooms: "1 Bedroom",
      bathrooms: "1 Bathroom",
      quotedPrice: "149",
    };
    mockLLM.mockResolvedValueOnce(makeWrongPathFalse());
    mockLLM.mockResolvedValueOnce(makePlainReply("Bi-weekly is $203/clean. Does Thu or Sat work?"));
    mockLLM.mockResolvedValueOnce(makePlainReply("Bi-weekly is $127/clean. Does Thu or Sat work?"));

    const result = await handleOffScriptReply(ctx);
    expect(result.reply).toContain("$127");
    expect(result.reply).not.toContain("$203");
  });
});

// ─── Edge cases ───────────────────────────────────────────────────────────────
describe("Layer 2 — Price Validator edge cases", () => {
  beforeEach(() => mockLLM.mockReset());

  it("allows the quoted price even if it differs from the calculated price (manual override)", async () => {
    // quotedPrice is $250 (manually set), which is not in the calculated set for 2bed/1bath
    // but the validator should allow it because it's the quoted price
    const ctx = {
      ...baseOffScriptCtx,
      quotedPrice: "250",
    };
    mockLLM.mockResolvedValueOnce(makeWrongPathFalse());
    mockLLM.mockResolvedValueOnce(makePlainReply("Your one-time clean is $250. Does Thu or Sat work?"));

    const result = await handleOffScriptReply(ctx);
    expect(result.reply).toContain("$250");
  });

  it("handles AI returning empty string gracefully", async () => {
    mockLLM.mockResolvedValueOnce(makeWrongPathFalse());
    mockLLM.mockResolvedValueOnce(makePlainReply(""));

    const result = await handleOffScriptReply(baseOffScriptCtx);
    // Empty reply → falls back to hardcoded string
    expect(result.reply.length).toBeGreaterThan(10);
  });

  it("handles LLM throwing an error gracefully", async () => {
    mockLLM.mockResolvedValueOnce(makeWrongPathFalse());
    mockLLM.mockRejectedValueOnce(new Error("LLM timeout"));

    const result = await handleOffScriptReply(baseOffScriptCtx);
    expect(result.reply.length).toBeGreaterThan(10);
    expect(result.shouldAdvanceStage).toBe(false);
  });
});
