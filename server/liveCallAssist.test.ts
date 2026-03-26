/**
 * Tests for leads.getLiveCallSuggestions tRPC procedure.
 *
 * These tests verify the procedure's input validation, fallback behavior,
 * and response shape — without making real LLM calls.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import { signAgentSession } from "./_core/agentAuth";
import { AGENT_COOKIE_NAME } from "@shared/const";

// ── Mock invokeLLM so tests never hit the real API ──────────────────────────

vi.mock("./_core/llm", () => ({
  invokeLLM: vi.fn(),
}));

import { invokeLLM } from "./_core/llm";

// ── Helpers ──────────────────────────────────────────────────────────────────

async function createAdminContext(): Promise<TrpcContext> {
  const token = await signAgentSession({
    agentId: 1,
    agentName: "Test Admin",
    agentEmail: "admin@test.com",
    isAdmin: true,
  });
  return {
    user: null,
    req: {
      protocol: "https",
      headers: { cookie: `${AGENT_COOKIE_NAME}=${token}` },
    } as TrpcContext["req"],
    res: {
      clearCookie: vi.fn(),
      cookie: vi.fn(),
    } as unknown as TrpcContext["res"],
  };
}

const VALID_LLM_RESPONSE = {
  primarySuggestion: "Hey Sarah, I totally understand the hesitation. Most of our clients felt the same way before their first clean — and now they can't imagine going back. What would make you feel confident moving forward?",
  primaryLabel: "Empathy + Social Proof",
  primaryRationale: "Acknowledges her concern, uses social proof to normalize it, then re-opens the conversation.",
  alternatives: [
    {
      label: "Urgency + Scarcity",
      suggestion: "We actually have a spot opening up in your area this week that I'd hate to see go to someone else. Can we lock it in for you?",
      angle: "Urgency",
    },
    {
      label: "Risk Reversal",
      suggestion: "Here's what I'll do — let's schedule the first clean and if it's not exactly what you expected, we'll make it right, no questions asked.",
      angle: "Empathy",
    },
    {
      label: "Assumptive Close",
      suggestion: "Great — so do you prefer mornings or afternoons? I want to get you the best team for your area.",
      angle: "Assumptive",
    },
  ],
  liveSignals: ["Price sensitivity detected", "Good engagement — keep going"],
  stageProgress: 65,
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("leads.getLiveCallSuggestions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns AI suggestions when LLM call succeeds", async () => {
    vi.mocked(invokeLLM).mockResolvedValueOnce({
      choices: [
        {
          message: {
            content: JSON.stringify(VALID_LLM_RESPONSE),
          },
        },
      ],
    } as any);

    const ctx = await createAdminContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.leads.getLiveCallSuggestions({
      stage: "close",
      transcript: "CUSTOMER: I'm not sure I'm ready to commit right now.\nAGENT: I understand, what's holding you back?",
      leadName: "Sarah",
      serviceType: "Deep clean, 3bd/2ba",
      quotedPrice: "180",
      lastCustomerLine: "I'm not sure I'm ready to commit right now.",
    });

    expect(result.success).toBe(true);
    expect(result.primarySuggestion).toBeTruthy();
    expect(result.primaryLabel).toBeTruthy();
    expect(result.primaryRationale).toBeTruthy();
    expect(result.alternatives).toHaveLength(3);
    expect(result.liveSignals.length).toBeGreaterThan(0);
    expect(result.stageProgress).toBeGreaterThanOrEqual(0);
    expect(result.stageProgress).toBeLessThanOrEqual(100);
  });

  it("returns fallback suggestions when LLM call fails", async () => {
    vi.mocked(invokeLLM).mockRejectedValueOnce(new Error("LLM unavailable"));

    const ctx = await createAdminContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.leads.getLiveCallSuggestions({
      stage: "opener",
      transcript: "",
    });

    // Should not throw — always returns a usable response
    expect(result.success).toBe(false);
    expect(result.primarySuggestion).toBeTruthy();
    expect(result.alternatives).toHaveLength(3);
    expect(result.stageProgress).toBe(50);
  });

  it("returns fallback when LLM returns empty content", async () => {
    vi.mocked(invokeLLM).mockResolvedValueOnce({
      choices: [{ message: { content: null } }],
    } as any);

    const ctx = await createAdminContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.leads.getLiveCallSuggestions({
      stage: "discovery",
      transcript: "CUSTOMER: Tell me more about your service.",
    });

    expect(result.success).toBe(false);
    expect(result.primarySuggestion).toBeTruthy();
  });

  it("works with minimal input (only stage and transcript)", async () => {
    vi.mocked(invokeLLM).mockResolvedValueOnce({
      choices: [{ message: { content: JSON.stringify(VALID_LLM_RESPONSE) } }],
    } as any);

    const ctx = await createAdminContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.leads.getLiveCallSuggestions({
      stage: "value",
      transcript: "",
    });

    expect(result.primarySuggestion).toBeTruthy();
    expect(result.alternatives).toHaveLength(3);
  });

  it("rejects invalid stage (empty string)", async () => {
    const ctx = await createAdminContext();
    const caller = appRouter.createCaller(ctx);

    await expect(
      caller.leads.getLiveCallSuggestions({
        stage: "",
        transcript: "some text",
      })
    ).rejects.toThrow();
  });

  it("rejects transcript exceeding 4000 chars", async () => {
    const ctx = await createAdminContext();
    const caller = appRouter.createCaller(ctx);

    await expect(
      caller.leads.getLiveCallSuggestions({
        stage: "opener",
        transcript: "x".repeat(4001),
      })
    ).rejects.toThrow();
  });

  it("rejects lastCustomerLine exceeding 500 chars", async () => {
    const ctx = await createAdminContext();
    const caller = appRouter.createCaller(ctx);

    await expect(
      caller.leads.getLiveCallSuggestions({
        stage: "opener",
        transcript: "some text",
        lastCustomerLine: "x".repeat(501),
      })
    ).rejects.toThrow();
  });

  it("all 6 stage IDs are accepted without error", async () => {
    const stages = ["opener", "discovery", "pain", "value", "close", "objection"];

    vi.mocked(invokeLLM).mockResolvedValue({
      choices: [{ message: { content: JSON.stringify(VALID_LLM_RESPONSE) } }],
    } as any);

    const ctx = await createAdminContext();
    const caller = appRouter.createCaller(ctx);

    for (const stage of stages) {
      const result = await caller.leads.getLiveCallSuggestions({
        stage,
        transcript: "",
      });
      expect(result.primarySuggestion).toBeTruthy();
    }
  });
});
