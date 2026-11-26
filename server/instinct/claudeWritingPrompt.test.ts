import { describe, expect, it } from "vitest";
import { buildSystemPrompt } from "../csReplyStream";
import { MAIDS_IN_BLACK_KNOWLEDGE_BASE } from "../knowledgeBase";
import { claudeWritingPrompt } from "./claudeWritingPrompt";
import { createClaudeCustomerReplyGenerator } from "./claudeCustomerSmsGeneration";

describe("CS writing prompt as Claude replies receive it (shared source unchanged)", () => {
  const full = buildSystemPrompt(), claude = claudeWritingPrompt();

  it("keeps the knowledge base word for word, exactly once", () => {
    expect(claude.split(MAIDS_IN_BLACK_KNOWLEDGE_BASE)).toHaveLength(2);
    expect(claude.endsWith(MAIDS_IN_BLACK_KNOWLEDGE_BASE)).toBe(true);
  });
  it("keeps the identity, tone section and every writing rule", () => {
    for (const kept of ["You are a customer service agent for Maids in Black, a residential cleaning company in Washington DC.",
      "=== TONE ===", "Be SPECIFIC.", "Be CONNECTING.", "=== WRITING RULES ===", "2. Use the customer's first name naturally",
      "4. Always include a clear next step or resolution", "5. Never be defensive.", "8. Use the Maids in Black knowledge base"])
      expect(claude).toContain(kept);
    const rules = full.slice(full.indexOf("=== WRITING RULES ==="), full.indexOf("=== MAIDS IN BLACK KNOWLEDGE BASE ==="));
    expect(claude).toContain(rules);
  });
  it("leaves out the guidance the Claude reply rules replace or contradict", () => {
    for (const removed of ["Length: Write until the message feels COMPLETE", "=== WHAT NOT TO WRITE", 'Got it, Kate!',
      "=== EMOJI RULES ===", "Use 1–3 emojis max", "not advice, the actual text message", "for the scenario described"])
      expect(claude).not.toContain(removed);
  });
  it("keeps only tone examples that report or promise no action, without dashes", () => {
    for (const claim of ["We've moved your clean", "We're sending someone back", "Your clean is cancelled", "Your crew has been briefed",
      "Your crew arrives", "Your crew just arrived", "We're passing this along", "showed it some extra love", "We're sending [Sub Name]",
      "Here's what we're going to do"]) expect(claude).not.toContain(claim);
    const examples = claude.slice(claude.indexOf("Examples of the right tone:"), claude.indexOf("=== WRITING RULES ===")).split("\n").filter(line => line.startsWith('- "'));
    expect(examples).toHaveLength(4);
    for (const line of examples) expect(line).not.toContain("—");
  });
  it("does not change the shared prompt used by the Manus drafting tools", () => {
    for (const unchanged of ["=== WHAT NOT TO WRITE (BAD EXAMPLES) ===", "=== EMOJI RULES ===", "Length: Write until the message feels COMPLETE",
      "We've moved your clean", "Write the exact SMS the agent should send for the scenario described."]) expect(full).toContain(unchanged);
  });
  it("falls back to the text unchanged when the shared prompt changes shape", () => {
    const other = `Different prompt\n\n${MAIDS_IN_BLACK_KNOWLEDGE_BASE}`;
    expect(claudeWritingPrompt(other)).toBe(other);
    expect(claudeWritingPrompt("No knowledge here")).toBe("No knowledge here");
  });
  it("is what Claude SMS/email replies are sent", async () => {
    let systemPrompt = "";
    await createClaudeCustomerReplyGenerator({ readKnowledge: async () => MAIDS_IN_BLACK_KNOWLEDGE_BASE,
      runner: async options => { systemPrompt = options.systemPrompt; return { finalSmsText: JSON.stringify({ replyText: "Hi!", task: null }) }; } })(
      { incomingMessage: "Hi", context: {}, protectedIds: [] });
    expect(systemPrompt.endsWith(`=== CS WRITING PROMPT ===\n${claude}`)).toBe(true);
    expect(systemPrompt).not.toContain("Got it, Kate!");
  });
});
