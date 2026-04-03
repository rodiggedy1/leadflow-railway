/**
 * objectionReply procedure tests
 * Verifies the objection handler AI procedure returns a script string.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { opsChatRouter } from "./opsChatRouter";

// ── mock LLM ──────────────────────────────────────────────────────────────────
vi.mock("./_core/llm", () => ({
  invokeLLM: vi.fn().mockResolvedValue({
    choices: [{ message: { content: "Here's what you should say to the customer..." } }],
  }),
}));

// ── helper: call mutation resolver directly ───────────────────────────────────
async function callMutation(resolver: Function, input: unknown) {
  return resolver({ input, ctx: { agentId: 1, agentName: "Test Agent" } });
}

// ── tests ─────────────────────────────────────────────────────────────────────
describe("objectionReply", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns a script string for a preset objection", async () => {
    const result = await callMutation(
      opsChatRouter._def.procedures.objectionReply._def.resolver,
      { objection: "Price is too high", history: [] }
    );
    expect(result).toHaveProperty("script");
    expect(typeof result.script).toBe("string");
    expect(result.script.length).toBeGreaterThan(0);
  });

  it("returns a script for a custom objection", async () => {
    const result = await callMutation(
      opsChatRouter._def.procedures.objectionReply._def.resolver,
      { objection: "I need to talk to my spouse first", history: [] }
    );
    expect(result).toHaveProperty("script");
    expect(typeof result.script).toBe("string");
  });

  it("passes conversation history to the LLM for follow-up turns", async () => {
    const { invokeLLM } = await import("./_core/llm");
    const history = [
      { role: "user" as const, content: "Price is too high" },
      { role: "assistant" as const, content: "I hear you — here's the value..." },
    ];
    await callMutation(
      opsChatRouter._def.procedures.objectionReply._def.resolver,
      { objection: "But the competitor is cheaper", history }
    );
    expect(invokeLLM).toHaveBeenCalledTimes(1);
    const callArgs = (invokeLLM as ReturnType<typeof vi.fn>).mock.calls[0][0];
    // Should include history messages + new user message
    const userMessages = callArgs.messages.filter((m: { role: string }) => m.role === "user");
    expect(userMessages.length).toBeGreaterThanOrEqual(2);
  });

  it("returns fallback message when LLM returns no content", async () => {
    const { invokeLLM } = await import("./_core/llm");
    (invokeLLM as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ choices: [] });
    const result = await callMutation(
      opsChatRouter._def.procedures.objectionReply._def.resolver,
      { objection: "Not interested", history: [] }
    );
    expect(result.script).toBe("Sorry, I couldn't generate a response. Please try again.");
  });

  it("includes the objection text in the LLM messages", async () => {
    const { invokeLLM } = await import("./_core/llm");
    await callMutation(
      opsChatRouter._def.procedures.objectionReply._def.resolver,
      { objection: "I had a bad experience before", history: [] }
    );
    const callArgs = (invokeLLM as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const lastUserMsg = callArgs.messages.filter((m: { role: string }) => m.role === "user").at(-1);
    expect(lastUserMsg.content).toContain("I had a bad experience before");
  });
});
