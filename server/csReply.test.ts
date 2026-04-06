/**
 * csReply procedure tests — verifies the World-Class CS Reply AI procedure
 */
import { describe, it, expect, vi } from "vitest";
import { opsChatRouter } from "./opsChatRouter";

// ── minimal mock for invokeLLM ──────────────────────────────────────────────
vi.mock("./_core/llm", () => ({
  invokeLLM: vi.fn().mockResolvedValue({
    choices: [{ message: { content: "I completely understand your frustration, and I sincerely apologize for this experience." } }],
  }),
}));

vi.mock("./knowledgeBase", () => ({
  MAIDS_IN_BLACK_KNOWLEDGE_BASE: "Test knowledge base content.",
}));

// ── helper to call a mutation resolver directly ──────────────────────────────
async function callMutation(resolver: Function, input: unknown) {
  return resolver({ input, ctx: {} });
}

describe("csReply", () => {
  it("returns a reply for a basic scenario", async () => {
    const result = await callMutation(
      opsChatRouter._def.procedures.csReply._def.resolver,
      { scenario: "Customer says the cleaner missed the bathroom", history: [] }
    );
    expect(result).toHaveProperty("reply");
    expect(typeof result.reply).toBe("string");
    expect(result.reply.length).toBeGreaterThan(10);
  });

  it("scenario is optional — empty string is accepted (defaults to empty)", async () => {
    // The schema changed: scenario is now optional().default("") so empty string is valid.
    // The procedure handles empty scenario gracefully (uses history/jobContext instead).
    const schema = opsChatRouter._def.procedures.csReply._def.inputs[0];
    const result = schema.safeParse({ scenario: "", history: [] });
    expect(result.success).toBe(true);
  });

  it("validates scenario max length (2000 chars)", async () => {
    const schema = opsChatRouter._def.procedures.csReply._def.inputs[0];
    const longScenario = "a".repeat(2001);
    const result = schema.safeParse({ scenario: longScenario, history: [] });
    expect(result.success).toBe(false);
  });

  it("accepts valid scenario within length limits", async () => {
    const schema = opsChatRouter._def.procedures.csReply._def.inputs[0];
    const result = schema.safeParse({ scenario: "Customer is upset about a late arrival", history: [] });
    expect(result.success).toBe(true);
  });

  it("passes history for follow-up turns", async () => {
    const result = await callMutation(
      opsChatRouter._def.procedures.csReply._def.resolver,
      {
        scenario: "What should I say next?",
        history: [
          { role: "user", content: "Customer is upset about a late arrival" },
          { role: "assistant", content: "I sincerely apologize for the delay..." },
        ],
      }
    );
    expect(result).toHaveProperty("reply");
  });
});
