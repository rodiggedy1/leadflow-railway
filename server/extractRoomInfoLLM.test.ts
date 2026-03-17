/**
 * Tests for extractRoomInfoWithLLM — language-agnostic room count extraction.
 * Verifies:
 *   - English regex fast path (no LLM call)
 *   - LLM fallback for non-English languages (Spanish, French, Portuguese)
 *   - Numeric-only inputs work via regex even for non-English sessions
 *   - Partial results (only bedrooms or only bathrooms) are merged correctly
 *   - LLM failure falls back gracefully to regex result
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { extractRoomInfoWithLLM } from "./conversationEngine";

vi.mock("./_core/llm", () => ({
  invokeLLM: vi.fn(),
}));

import { invokeLLM } from "./_core/llm";
const mockLLM = vi.mocked(invokeLLM);

describe("extractRoomInfoWithLLM", () => {
  beforeEach(() => {
    mockLLM.mockReset();
  });

  // ── English fast path (no LLM) ───────────────────────────────────────────────
  it("English: extracts both values via regex without calling LLM", async () => {
    const result = await extractRoomInfoWithLLM("3 bed 2 bath", "en");
    expect(result.bedrooms).toBe("3 Bedrooms");
    expect(result.bathrooms).toBe("2 Bathrooms");
    expect(mockLLM).not.toHaveBeenCalled();
  });

  it("English: partial result (bedrooms only) returns null bathrooms without LLM", async () => {
    const result = await extractRoomInfoWithLLM("3 bedrooms", "en");
    expect(result.bedrooms).toBe("3 Bedrooms");
    expect(result.bathrooms).toBeNull();
    expect(mockLLM).not.toHaveBeenCalled();
  });

  it("No language set: uses regex only, no LLM", async () => {
    const result = await extractRoomInfoWithLLM("2 bed 1 bath");
    expect(result.bedrooms).toBe("2 Bedrooms");
    expect(result.bathrooms).toBe("1 Bathroom");
    expect(mockLLM).not.toHaveBeenCalled();
  });

  // ── Numeric inputs work via regex even for non-English sessions ──────────────
  it("Spanish session: numeric input '3 bed 2 bath' uses regex fast path, no LLM", async () => {
    const result = await extractRoomInfoWithLLM("3 bed 2 bath", "es");
    expect(result.bedrooms).toBe("3 Bedrooms");
    expect(result.bathrooms).toBe("2 Bathrooms");
    expect(mockLLM).not.toHaveBeenCalled();
  });

  // ── LLM fallback for non-English text ────────────────────────────────────────
  it("Spanish: '3 habitaciones y 2 baños' uses LLM fallback", async () => {
    mockLLM.mockResolvedValueOnce({
      choices: [{ message: { content: JSON.stringify({ bedrooms: 3, bathrooms: 2 }) }, index: 0, finish_reason: "stop" }],
    } as any);

    const result = await extractRoomInfoWithLLM("3 habitaciones y 2 baños", "es");
    expect(result.bedrooms).toBe("3 Bedrooms");
    expect(result.bathrooms).toBe("2 Bathrooms");
    expect(mockLLM).toHaveBeenCalledTimes(1);
  });

  it("French: '2 chambres et 1 salle de bain' uses LLM fallback", async () => {
    mockLLM.mockResolvedValueOnce({
      choices: [{ message: { content: JSON.stringify({ bedrooms: 2, bathrooms: 1 }) }, index: 0, finish_reason: "stop" }],
    } as any);

    const result = await extractRoomInfoWithLLM("2 chambres et 1 salle de bain", "fr");
    expect(result.bedrooms).toBe("2 Bedrooms");
    expect(result.bathrooms).toBe("1 Bathroom");
    expect(mockLLM).toHaveBeenCalledTimes(1);
  });

  it("Portuguese: '3 quartos e 2 banheiros' uses LLM fallback", async () => {
    mockLLM.mockResolvedValueOnce({
      choices: [{ message: { content: JSON.stringify({ bedrooms: 3, bathrooms: 2 }) }, index: 0, finish_reason: "stop" }],
    } as any);

    const result = await extractRoomInfoWithLLM("3 quartos e 2 banheiros", "pt");
    expect(result.bedrooms).toBe("3 Bedrooms");
    expect(result.bathrooms).toBe("2 Bathrooms");
    expect(mockLLM).toHaveBeenCalledTimes(1);
  });

  it("Spanish: 'studio' (0 bedrooms) is mapped to Studio", async () => {
    mockLLM.mockResolvedValueOnce({
      choices: [{ message: { content: JSON.stringify({ bedrooms: 0, bathrooms: 1 }) }, index: 0, finish_reason: "stop" }],
    } as any);

    const result = await extractRoomInfoWithLLM("es un estudio con un baño", "es");
    expect(result.bedrooms).toBe("Studio");
    expect(result.bathrooms).toBe("1 Bathroom");
  });

  it("Spanish: partial — only bedrooms extracted by LLM, bathrooms null", async () => {
    mockLLM.mockResolvedValueOnce({
      choices: [{ message: { content: JSON.stringify({ bedrooms: 3, bathrooms: null }) }, index: 0, finish_reason: "stop" }],
    } as any);

    const result = await extractRoomInfoWithLLM("3 habitaciones", "es");
    expect(result.bedrooms).toBe("3 Bedrooms");
    expect(result.bathrooms).toBeNull();
  });

  it("Spanish: LLM returns null for both when text has no room info", async () => {
    mockLLM.mockResolvedValueOnce({
      choices: [{ message: { content: JSON.stringify({ bedrooms: null, bathrooms: null }) }, index: 0, finish_reason: "stop" }],
    } as any);

    const result = await extractRoomInfoWithLLM("¿cuánto cuesta?", "es");
    expect(result.bedrooms).toBeNull();
    expect(result.bathrooms).toBeNull();
  });

  // ── LLM failure fallback ─────────────────────────────────────────────────────
  it("LLM failure falls back to regex result gracefully", async () => {
    mockLLM.mockRejectedValueOnce(new Error("LLM timeout"));

    // Regex can extract bedrooms from "3 bed" even in a Spanish session
    const result = await extractRoomInfoWithLLM("3 bed", "es");
    expect(result.bedrooms).toBe("3 Bedrooms");
    expect(result.bathrooms).toBeNull(); // regex couldn't find bathrooms, LLM failed
  });

  it("LLM failure with no regex result returns null for both", async () => {
    mockLLM.mockRejectedValueOnce(new Error("LLM timeout"));

    const result = await extractRoomInfoWithLLM("no sé", "es");
    expect(result.bedrooms).toBeNull();
    expect(result.bathrooms).toBeNull();
  });
});
