/**
 * Tests for the QUOTE_SENT pricing detection and room extraction logic.
 * These cover the widget lead pricing flow:
 *   - isPricingQuestion: detects when a lead is asking about cost
 *   - extractRoomInfo: parses bedroom/bathroom counts from natural language
 */
import { describe, it, expect } from "vitest";
import { isPricingQuestion, extractRoomInfo } from "./conversationEngine";

describe("isPricingQuestion", () => {
  it("detects 'how much'", () => {
    expect(isPricingQuestion("how much for a cleaning?")).toBe(true);
  });
  it("detects 'price'", () => {
    expect(isPricingQuestion("what's your price?")).toBe(true);
  });
  it("detects 'cost'", () => {
    expect(isPricingQuestion("what does it cost?")).toBe(true);
  });
  it("detects 'pricing'", () => {
    expect(isPricingQuestion("can you tell me about your pricing")).toBe(true);
  });
  it("detects 'rate'", () => {
    expect(isPricingQuestion("what's your rate?")).toBe(true);
  });
  it("detects 'quote'", () => {
    expect(isPricingQuestion("can I get a quote")).toBe(true);
  });
  it("detects 'estimate'", () => {
    expect(isPricingQuestion("I need an estimate")).toBe(true);
  });
  it("detects dollar sign", () => {
    expect(isPricingQuestion("how much is it? $?")).toBe(true);
  });
  it("does not flag a simple 'ok'", () => {
    expect(isPricingQuestion("ok sounds good")).toBe(false);
  });
  it("does not flag 'thanks'", () => {
    expect(isPricingQuestion("thanks!")).toBe(false);
  });
  it("does not flag availability reply", () => {
    expect(isPricingQuestion("Thursday works for me")).toBe(false);
  });
  it("does not flag address", () => {
    expect(isPricingQuestion("123 Main St Washington DC")).toBe(false);
  });
  it("is case-insensitive", () => {
    expect(isPricingQuestion("HOW MUCH FOR 2 BED?")).toBe(true);
  });
});

describe("extractRoomInfo — bedrooms", () => {
  it("extracts '1 bedroom'", () => {
    expect(extractRoomInfo("how much for a 1 bedroom cleaning").bedrooms).toBe("1 Bedroom");
  });
  it("extracts '2 bedrooms'", () => {
    expect(extractRoomInfo("I have 2 bedrooms and 1 bathroom").bedrooms).toBe("2 Bedrooms");
  });
  it("extracts '3 bedrooms'", () => {
    expect(extractRoomInfo("3 bed 2 bath").bedrooms).toBe("3 Bedrooms");
  });
  it("extracts '4 bedrooms'", () => {
    expect(extractRoomInfo("4 bedroom house").bedrooms).toBe("4 Bedrooms");
  });
  it("extracts 'one bedroom' (word)", () => {
    expect(extractRoomInfo("one bedroom apartment").bedrooms).toBe("1 Bedroom");
  });
  it("extracts 'two bedroom' (word)", () => {
    expect(extractRoomInfo("two bedroom condo").bedrooms).toBe("2 Bedrooms");
  });
  it("extracts 'three bed' (word)", () => {
    expect(extractRoomInfo("three bed two bath").bedrooms).toBe("3 Bedrooms");
  });
  it("extracts '2br' shorthand", () => {
    expect(extractRoomInfo("2br 1ba").bedrooms).toBe("2 Bedrooms");
  });
  it("extracts 'studio'", () => {
    expect(extractRoomInfo("studio apartment").bedrooms).toBe("Studio");
  });
  it("returns null when no bedroom info", () => {
    expect(extractRoomInfo("how much do you charge?").bedrooms).toBeNull();
  });
  it("handles the original user message: '1 bedroom 2 bathroom'", () => {
    expect(extractRoomInfo("how much for a one bedroom two bathroom cleaning").bedrooms).toBe("1 Bedroom");
  });
});

describe("extractRoomInfo — bathrooms", () => {
  it("extracts '1 bathroom'", () => {
    expect(extractRoomInfo("1 bedroom 1 bathroom").bathrooms).toBe("1 Bathroom");
  });
  it("extracts '2 bathrooms'", () => {
    expect(extractRoomInfo("2 bed 2 bath").bathrooms).toBe("2 Bathrooms");
  });
  it("extracts '1.5 bathrooms'", () => {
    expect(extractRoomInfo("1 bed 1.5 bath").bathrooms).toBe("1.5 Bathrooms");
  });
  it("extracts 'one and a half bath'", () => {
    expect(extractRoomInfo("one and a half bath").bathrooms).toBe("1.5 Bathrooms");
  });
  it("extracts 'two bath' (word)", () => {
    expect(extractRoomInfo("two bath").bathrooms).toBe("2 Bathrooms");
  });
  it("extracts '3 bathrooms'", () => {
    expect(extractRoomInfo("3 bed 3 bath").bathrooms).toBe("3 Bathrooms");
  });
  it("returns null when no bathroom info", () => {
    expect(extractRoomInfo("how much do you charge?").bathrooms).toBeNull();
  });
  it("handles the original user message: 'two bathroom'", () => {
    expect(extractRoomInfo("how much for a one bedroom two bathroom cleaning").bathrooms).toBe("2 Bathrooms");
  });
});

describe("extractRoomInfo — combined extraction", () => {
  it("extracts both from '2 bed 1 bath'", () => {
    const result = extractRoomInfo("2 bed 1 bath");
    expect(result.bedrooms).toBe("2 Bedrooms");
    expect(result.bathrooms).toBe("1 Bathroom");
  });
  it("extracts both from '3 bedroom 2 bathroom'", () => {
    const result = extractRoomInfo("3 bedroom 2 bathroom");
    expect(result.bedrooms).toBe("3 Bedrooms");
    expect(result.bathrooms).toBe("2 Bathrooms");
  });
  it("extracts both from '1 bed 2 bath' (the original failing case)", () => {
    const result = extractRoomInfo("how much for a one bedroom two bathroom cleaning");
    expect(result.bedrooms).toBe("1 Bedroom");
    expect(result.bathrooms).toBe("2 Bathrooms");
  });
  it("handles '2br 2ba' shorthand", () => {
    const result = extractRoomInfo("2br 2ba");
    expect(result.bedrooms).toBe("2 Bedrooms");
    expect(result.bathrooms).toBe("2 Bathrooms");
  });
  it("returns nulls when no room info in message", () => {
    const result = extractRoomInfo("what are your hours?");
    expect(result.bedrooms).toBeNull();
    expect(result.bathrooms).toBeNull();
  });
});
