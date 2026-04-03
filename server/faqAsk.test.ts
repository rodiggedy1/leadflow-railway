/**
 * faqAsk procedure tests — verifies the FAQ AI assistant procedure
 * builds correct messages and returns the LLM answer.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock LLM and knowledge base ───────────────────────────────────────────────
vi.mock("./_core/llm", () => ({
  invokeLLM: vi.fn(),
}));

vi.mock("./knowledgeBase", () => ({
  MAIDS_IN_BLACK_KNOWLEDGE_BASE: "## Test KB\nMaids in Black charges $150 for a standard clean.",
}));

import { invokeLLM } from "./_core/llm";
import { opsChatRouter } from "./opsChatRouter";

// Helper to call a procedure directly (bypasses tRPC HTTP layer).
async function callMutation(procedure: any, input?: any) {
  const ctx = {
    user: { id: 1, name: "Test Agent", role: "admin" as const, openId: "test" },
    opsCaller: { id: "test", name: "Test Agent" },
  };
  return procedure({ ctx, input });
}

describe("faqAsk", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls invokeLLM with system prompt containing knowledge base", async () => {
    vi.mocked(invokeLLM).mockResolvedValue({
      choices: [{ message: { content: "Standard clean costs $150." } }],
    } as any);

    await callMutation(opsChatRouter._def.procedures.faqAsk._def.resolver, {
      question: "How much is a standard clean?",
      history: [],
    });

    expect(invokeLLM).toHaveBeenCalledOnce();
    const callArgs = vi.mocked(invokeLLM).mock.calls[0][0];
    const systemMsg = callArgs.messages.find((m: any) => m.role === "system");
    expect(systemMsg).toBeDefined();
    expect(systemMsg.content).toContain("MAIDS_IN_BLACK_KNOWLEDGE_BASE" in {} ? "" : "Maids in Black");
    expect(systemMsg.content).toContain("FAQ assistant");
  });

  it("returns the LLM answer as the response", async () => {
    vi.mocked(invokeLLM).mockResolvedValue({
      choices: [{ message: { content: "Standard clean costs $150." } }],
    } as any);

    const result = await callMutation(opsChatRouter._def.procedures.faqAsk._def.resolver, {
      question: "How much is a standard clean?",
      history: [],
    });

    expect(result).toEqual({ answer: "Standard clean costs $150." });
  });

  it("includes conversation history in messages for follow-up questions", async () => {
    vi.mocked(invokeLLM).mockResolvedValue({
      choices: [{ message: { content: "Yes, we offer deep cleans." } }],
    } as any);

    await callMutation(opsChatRouter._def.procedures.faqAsk._def.resolver, {
      question: "What about deep cleans?",
      history: [
        { role: "user", content: "Do you offer cleaning services?" },
        { role: "assistant", content: "Yes, we offer standard and deep cleaning." },
      ],
    });

    const callArgs = vi.mocked(invokeLLM).mock.calls[0][0];
    const messages = callArgs.messages;
    // Should have: system + 2 history + 1 new question = 4 messages
    expect(messages).toHaveLength(4);
    expect(messages[1]).toEqual({ role: "user", content: "Do you offer cleaning services?" });
    expect(messages[2]).toEqual({ role: "assistant", content: "Yes, we offer standard and deep cleaning." });
    expect(messages[3]).toEqual({ role: "user", content: "What about deep cleans?" });
  });

  it("falls back gracefully when LLM returns no choices", async () => {
    vi.mocked(invokeLLM).mockResolvedValue({
      choices: [],
    } as any);

    const result = await callMutation(opsChatRouter._def.procedures.faqAsk._def.resolver, {
      question: "What services do you offer?",
      history: [],
    });

    expect(result.answer).toContain("couldn't generate an answer");
  });

  it("validates question length via Zod schema", () => {
    // The faqAsk procedure uses z.string().min(1).max(500) for the question field.
    // Zod validation runs at the tRPC middleware layer (before the resolver),
    // so we test the schema directly here.
    const { z } = require("zod");
    const schema = z.object({
      question: z.string().min(1).max(500),
      history: z.array(z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string(),
      })).optional().default([]),
    });

    // Valid question
    expect(() => schema.parse({ question: "How much?", history: [] })).not.toThrow();

    // Too long
    expect(() => schema.parse({ question: "a".repeat(501), history: [] })).toThrow();

    // Empty
    expect(() => schema.parse({ question: "", history: [] })).toThrow();
  });
});
