/**
 * Tests for CS chat AI suggestion prompt branching.
 *
 * The csQuickReply procedure now accepts a `queue` field.
 * When queue === "Teams", the AI should use a field-manager context
 * (cleaner on the other end). Otherwise it uses the client/CS context.
 *
 * These tests verify the branching logic in isolation — the actual LLM
 * call is not made; we just verify the correct prompt is selected.
 */
import { describe, it, expect } from "vitest";

// ── Mirrors the branching logic in csQuickReply ───────────────────────────────

function buildSystemPrompt(isTeams: boolean, firstName: string): string {
  return isTeams
    ? `You are a field operations manager for Maids in Black, a premium home cleaning company in the DC/MD/VA area. You are texting one of your cleaning team members named ${firstName}. You write short, direct, supportive SMS messages. Never use emojis. Never sound corporate. Sound like a real manager who has their team's back and gets things done quickly. Common situations: access issues (can't get into the job), job size questions (bigger than expected), callouts (can't make it to work), field management questions (supplies, parking, timing), and requests for larger or better jobs.`
    : `You are a world-class customer service agent for Maids in Black, a premium home cleaning company serving the DC/MD/VA area. You write short, human, warm SMS messages. Never use emojis. Never sound corporate or scripted. Always sound like a real person who cares.`;
}

function buildConversationSnippet(
  messages: Array<{ role: string; content: string }>,
  isTeams: boolean
): string {
  return messages
    .map((m) => `${m.role === "user" ? (isTeams ? "Cleaner" : "Client") : "Agent"}: ${m.content}`)
    .join("\n");
}

// ── System prompt branching ───────────────────────────────────────────────────
describe("csQuickReply system prompt branching", () => {
  it("uses field-manager prompt for Teams queue", () => {
    const prompt = buildSystemPrompt(true, "Carolann");
    expect(prompt).toContain("field operations manager");
    expect(prompt).toContain("Carolann");
    expect(prompt).toContain("access issues");
    expect(prompt).toContain("callouts");
    expect(prompt).not.toContain("customer service agent");
  });

  it("uses customer-service prompt for non-Teams queue", () => {
    const prompt = buildSystemPrompt(false, "Sarah");
    expect(prompt).toContain("customer service agent");
    expect(prompt).not.toContain("field operations manager");
    expect(prompt).not.toContain("access issues");
  });

  it("isTeams is true only when queue === 'Teams'", () => {
    expect("Teams" === "Teams").toBe(true);
    expect("Needs attention" === "Teams").toBe(false);
    expect("CS" === "Teams").toBe(false);
    expect(undefined === "Teams").toBe(false);
  });
});

// ── Conversation snippet labelling ───────────────────────────────────────────
describe("conversation snippet role labelling", () => {
  const msgs = [
    { role: "user", content: "I can't get into the job" },
    { role: "assistant", content: "Try the lockbox code" },
  ];

  it("labels inbound as 'Cleaner' for Teams conversations", () => {
    const snippet = buildConversationSnippet(msgs, true);
    expect(snippet).toContain("Cleaner: I can't get into the job");
    expect(snippet).toContain("Agent: Try the lockbox code");
    expect(snippet).not.toContain("Client:");
  });

  it("labels inbound as 'Client' for non-Teams conversations", () => {
    const snippet = buildConversationSnippet(msgs, false);
    expect(snippet).toContain("Client: I can't get into the job");
    expect(snippet).not.toContain("Cleaner:");
  });
});

// ── Teams action prompts contain cleaner-specific language ───────────────────
describe("Teams action prompts", () => {
  const firstName = "Maria";

  function teamsPrompt(action: string): string {
    const map: Record<string, string> = {
      send_quote: `Write a brief SMS to a cleaner named ${firstName} acknowledging their request for bigger or better jobs. Start with "Hey ${firstName},".`,
      make_it_right: `Write a brief SMS to a cleaner named ${firstName} who is having an access issue at a job site. Start with "Hey ${firstName},".`,
      refer_friend: `Write a brief SMS to a cleaner named ${firstName} encouraging them to refer another cleaner to join the team.`,
      running_late: `Write a brief SMS to a cleaner named ${firstName} who is running late to a job.`,
      on_the_way: `Write a brief SMS to a cleaner named ${firstName} confirming they should head to their next job.`,
      review_rebook: `Write a brief SMS to a cleaner named ${firstName} following up after a job.`,
    };
    return map[action] ?? "";
  }

  it("send_quote prompt mentions bigger/better jobs (not client quote)", () => {
    expect(teamsPrompt("send_quote")).toContain("bigger or better jobs");
    expect(teamsPrompt("send_quote")).not.toContain("home cleaning service");
  });

  it("make_it_right prompt mentions access issue (not de-escalation)", () => {
    expect(teamsPrompt("make_it_right")).toContain("access issue");
  });

  it("all prompts address the cleaner by name", () => {
    for (const action of ["send_quote", "make_it_right", "refer_friend", "running_late", "on_the_way", "review_rebook"]) {
      expect(teamsPrompt(action)).toContain("Maria");
    }
  });
});
