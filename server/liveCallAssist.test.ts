/**
 * Tests for leads.getLiveCallSuggestions tRPC procedure.
 *
 * Verifies input validation, fallback behavior, and response shape
 * without making real LLM calls.
 *
 * Current API contract:
 *   Input:  { stage: string (min 1), transcript: string (max 6000),
 *             leadName?, serviceType?, quotedPrice?, context?, lastCustomerLine? (max 1000) }
 *   Output: { success: true,  suggestion: string, currentStage: string, extracted: {...} }
 *         | { success: false, suggestion: string, currentStage: string }
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

/** A valid LLM response matching the current JSON schema */
const VALID_LLM_RESPONSE = {
  suggestion: "Hey Sarah, I totally understand the hesitation. Most of our clients felt the same way before their first clean — and now they can't imagine going back. What would make you feel confident moving forward?",
  currentStage: "close",
  extracted: {
    customerName: "Sarah",
    address: null,
    bedrooms: null,
    bathrooms: null,
    serviceType: null,
    preferredDate: null,
    addExtras: null,
  },
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("leads.getLiveCallSuggestions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns AI suggestion when LLM call succeeds", async () => {
    vi.mocked(invokeLLM).mockResolvedValueOnce({
      choices: [{ message: { content: JSON.stringify(VALID_LLM_RESPONSE) } }],
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
    expect(result.suggestion).toBeTruthy();
    expect(result.currentStage).toBeTruthy();
  });

  it("returns fallback suggestion when LLM call fails", async () => {
    vi.mocked(invokeLLM).mockRejectedValueOnce(new Error("LLM unavailable"));

    const ctx = await createAdminContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.leads.getLiveCallSuggestions({
      stage: "opener",
      transcript: "",
    });

    // Should not throw — always returns a usable response
    expect(result.success).toBe(false);
    expect(result.suggestion).toBeTruthy();
    expect(result.currentStage).toBeTruthy();
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
    expect(result.suggestion).toBeTruthy();
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

    expect(result.suggestion).toBeTruthy();
    expect(result.currentStage).toBeTruthy();
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

  it("rejects transcript exceeding 6000 chars", async () => {
    const ctx = await createAdminContext();
    const caller = appRouter.createCaller(ctx);

    await expect(
      caller.leads.getLiveCallSuggestions({
        stage: "opener",
        transcript: "x".repeat(6001),
      })
    ).rejects.toThrow();
  });

  it("accepts transcript at exactly 6000 chars", async () => {
    vi.mocked(invokeLLM).mockResolvedValueOnce({
      choices: [{ message: { content: JSON.stringify(VALID_LLM_RESPONSE) } }],
    } as any);

    const ctx = await createAdminContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.leads.getLiveCallSuggestions({
      stage: "opener",
      transcript: "x".repeat(6000),
    });

    expect(result.suggestion).toBeTruthy();
  });

  it("rejects lastCustomerLine exceeding 1000 chars", async () => {
    const ctx = await createAdminContext();
    const caller = appRouter.createCaller(ctx);

    await expect(
      caller.leads.getLiveCallSuggestions({
        stage: "opener",
        transcript: "some text",
        lastCustomerLine: "x".repeat(1001),
      })
    ).rejects.toThrow();
  });

  it("all 6 valid stage IDs are accepted without error", async () => {
    const stages = ["opener", "discovery", "value", "recap", "close", "objection"];

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
      expect(result.suggestion).toBeTruthy();
    }
  });

  it("auto-populates extracted fields from LLM response", async () => {
    const responseWithExtracted = {
      suggestion: "Great — let me pull up your address.",
      currentStage: "discovery",
      extracted: {
        customerName: "John",
        address: "123 Main St",
        bedrooms: "3",
        bathrooms: "2",
        serviceType: "Standard",
        preferredDate: "Monday",
        addExtras: null,
      },
    };

    vi.mocked(invokeLLM).mockResolvedValueOnce({
      choices: [{ message: { content: JSON.stringify(responseWithExtracted) } }],
    } as any);

    const ctx = await createAdminContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.leads.getLiveCallSuggestions({
      stage: "discovery",
      transcript: "CUSTOMER: I'm John at 123 Main St, 3 bed 2 bath.",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.extracted.customerName).toBe("John");
      expect(result.extracted.address).toBe("123 Main St");
      expect(result.extracted.bedrooms).toBe("3");
    }
  });

  it("returns addExtras when customer agrees to an extra", async () => {
    const responseWithExtras = {
      suggestion: "Perfect — I've added the pet add-on. Your updated total is $194.",
      currentStage: "close",
      extracted: {
        customerName: null,
        address: null,
        bedrooms: null,
        bathrooms: null,
        serviceType: null,
        preferredDate: null,
        addExtras: ["i_have_pets"],
      },
    };

    vi.mocked(invokeLLM).mockResolvedValueOnce({
      choices: [{ message: { content: JSON.stringify(responseWithExtras) } }],
    } as any);

    const ctx = await createAdminContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.leads.getLiveCallSuggestions({
      stage: "close",
      transcript: "AGENT: One thing a lot of clients with pets add is our pet add-on for just $15.\nCUSTOMER: Yes, add that.",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.extracted.addExtras).toContain("i_have_pets");
    }
  });
});
