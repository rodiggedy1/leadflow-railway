/**
 * Tests for leads.appendCallToSession tRPC procedure.
 *
 * Verifies that outbound call transcripts are appended to existing lead sessions
 * without creating new leads, and that stage transitions and field updates work
 * correctly for all outcome types.
 *
 * Current API contract:
 *   Input:  { sessionId: number, transcript: string (max 8000),
 *             quotedPrice?, preferredDate?, extras?, isBooked?, notInterested?,
 *             isFollowUp?, followUpDate?, agentId?, agentName?,
 *             bedrooms?, bathrooms?, address? }
 *   Output: { success: true, sessionId: number }
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import { signAgentSession } from "./_core/agentAuth";
import { AGENT_COOKIE_NAME } from "@shared/const";

// ── Mock the DB so tests never hit a real database ───────────────────────────

vi.mock("./db", () => ({
  getDb: vi.fn(),
}));

import { getDb } from "./db";

// ── Helpers ──────────────────────────────────────────────────────────────────

async function createAgentContext(): Promise<TrpcContext> {
  const token = await signAgentSession({
    agentId: 42,
    agentName: "Test Agent",
    agentEmail: "agent@test.com",
    isAdmin: false,
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

/** Minimal existing session row returned by the mock DB */
function makeExistingSession(overrides: Record<string, unknown> = {}) {
  return {
    id: 101,
    stage: "CONFIRMATION",
    messageHistory: "[]",
    quotedPrice: null,
    selectedSlot: null,
    extras: null,
    bedrooms: null,
    bathrooms: null,
    address: null,
    assignedAgentId: null,
    assignedAgentName: null,
    bookedByAgentId: null,
    bookedByAgentName: null,
    bookedAmount: null,
    isBooked: 0,
    ...overrides,
  };
}

/** Build a mock DB object with chainable Drizzle-style query builder */
function buildMockDb(existingSession: ReturnType<typeof makeExistingSession> | null) {
  const updateSet = vi.fn().mockReturnThis();
  const updateWhere = vi.fn().mockResolvedValue(undefined);
  const updateObj = { set: updateSet };
  updateSet.mockReturnValue({ where: updateWhere });

  const selectFrom = vi.fn().mockReturnThis();
  const selectWhere = vi.fn().mockReturnThis();
  const selectLimit = vi.fn().mockResolvedValue(existingSession ? [existingSession] : []);
  const selectObj = { from: selectFrom };
  selectFrom.mockReturnValue({ where: selectWhere });
  selectWhere.mockReturnValue({ limit: selectLimit });

  return {
    select: vi.fn().mockReturnValue(selectObj),
    update: vi.fn().mockReturnValue(updateObj),
    _updateSet: updateSet,
    _updateWhere: updateWhere,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("leads.appendCallToSession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns success and sessionId when session exists", async () => {
    const mockDb = buildMockDb(makeExistingSession());
    vi.mocked(getDb).mockResolvedValue(mockDb as any);

    const ctx = await createAgentContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.leads.appendCallToSession({
      sessionId: 101,
      transcript: "AGENT: Hi Sarah!\nCUSTOMER: Hi, yes I'm interested.",
    });

    expect(result.success).toBe(true);
    expect(result.sessionId).toBe(101);
  });

  it("appends [OUTBOUND CALL] marker to message history", async () => {
    const existingSession = makeExistingSession({ messageHistory: "[]" });
    const mockDb = buildMockDb(existingSession);
    vi.mocked(getDb).mockResolvedValue(mockDb as any);

    const ctx = await createAgentContext();
    const caller = appRouter.createCaller(ctx);

    await caller.leads.appendCallToSession({
      sessionId: 101,
      transcript: "AGENT: Hello!\nCUSTOMER: Hi there.",
      agentName: "Jane",
    });

    const setCall = mockDb._updateSet.mock.calls[0][0];
    const parsedHistory = JSON.parse(setCall.messageHistory);
    expect(parsedHistory).toHaveLength(1);
    expect(parsedHistory[0].role).toBe("system");
    expect(parsedHistory[0].content).toContain("[OUTBOUND CALL by Jane]");
    expect(parsedHistory[0].content).toContain("AGENT: Hello!");
  });

  it("sets stage to BOOKED when isBooked is true", async () => {
    const mockDb = buildMockDb(makeExistingSession({ stage: "CONFIRMATION" }));
    vi.mocked(getDb).mockResolvedValue(mockDb as any);

    const ctx = await createAgentContext();
    const caller = appRouter.createCaller(ctx);

    await caller.leads.appendCallToSession({
      sessionId: 101,
      transcript: "AGENT: Great, you're all set!\nCUSTOMER: Perfect.",
      isBooked: true,
      quotedPrice: "195",
    });

    const setCall = mockDb._updateSet.mock.calls[0][0];
    expect(setCall.stage).toBe("BOOKED");
    expect(setCall.isBooked).toBe(1);
    expect(setCall.bookedAmount).toBe(195);
  });

  it("sets stage to NOT_INTERESTED when notInterested is true", async () => {
    const mockDb = buildMockDb(makeExistingSession({ stage: "CONFIRMATION" }));
    vi.mocked(getDb).mockResolvedValue(mockDb as any);

    const ctx = await createAgentContext();
    const caller = appRouter.createCaller(ctx);

    await caller.leads.appendCallToSession({
      sessionId: 101,
      transcript: "CUSTOMER: Not interested, thanks.",
      notInterested: true,
    });

    const setCall = mockDb._updateSet.mock.calls[0][0];
    expect(setCall.stage).toBe("NOT_INTERESTED");
  });

  it("sets stage to FOLLOW_UP_SCHEDULED when isFollowUp is true", async () => {
    const mockDb = buildMockDb(makeExistingSession({ stage: "CONFIRMATION" }));
    vi.mocked(getDb).mockResolvedValue(mockDb as any);

    const ctx = await createAgentContext();
    const caller = appRouter.createCaller(ctx);

    await caller.leads.appendCallToSession({
      sessionId: 101,
      transcript: "CUSTOMER: Call me back next week.",
      isFollowUp: true,
      followUpDate: "2026-04-03",
    });

    const setCall = mockDb._updateSet.mock.calls[0][0];
    expect(setCall.stage).toBe("FOLLOW_UP_SCHEDULED");
    expect(setCall.followUpDate).toBe("2026-04-03");
  });

  it("preserves existing stage when no outcome flag is set", async () => {
    const mockDb = buildMockDb(makeExistingSession({ stage: "UNHANDLED" }));
    vi.mocked(getDb).mockResolvedValue(mockDb as any);

    const ctx = await createAgentContext();
    const caller = appRouter.createCaller(ctx);

    await caller.leads.appendCallToSession({
      sessionId: 101,
      transcript: "AGENT: Just checking in.",
    });

    const setCall = mockDb._updateSet.mock.calls[0][0];
    expect(setCall.stage).toBe("UNHANDLED");
  });

  it("updates quotedPrice, bedrooms, bathrooms, and address when provided", async () => {
    const mockDb = buildMockDb(makeExistingSession());
    vi.mocked(getDb).mockResolvedValue(mockDb as any);

    const ctx = await createAgentContext();
    const caller = appRouter.createCaller(ctx);

    await caller.leads.appendCallToSession({
      sessionId: 101,
      transcript: "AGENT: So you have 3 beds and 2 baths.",
      quotedPrice: "210",
      bedrooms: "3",
      bathrooms: "2",
      address: "456 Oak Ave NW",
    });

    const setCall = mockDb._updateSet.mock.calls[0][0];
    expect(setCall.quotedPrice).toBe("210");
    expect(setCall.bedrooms).toBe("3");
    expect(setCall.bathrooms).toBe("2");
    expect(setCall.address).toBe("456 Oak Ave NW");
  });

  it("falls back to existing extras when none provided", async () => {
    const existingExtras = JSON.stringify(["i_have_pets"]);
    const mockDb = buildMockDb(makeExistingSession({ extras: existingExtras }));
    vi.mocked(getDb).mockResolvedValue(mockDb as any);

    const ctx = await createAgentContext();
    const caller = appRouter.createCaller(ctx);

    await caller.leads.appendCallToSession({
      sessionId: 101,
      transcript: "AGENT: Just a quick check-in.",
    });

    const setCall = mockDb._updateSet.mock.calls[0][0];
    expect(setCall.extras).toBe(existingExtras);
  });

  it("overwrites extras when new ones are provided", async () => {
    const mockDb = buildMockDb(makeExistingSession({ extras: null }));
    vi.mocked(getDb).mockResolvedValue(mockDb as any);

    const ctx = await createAgentContext();
    const caller = appRouter.createCaller(ctx);

    await caller.leads.appendCallToSession({
      sessionId: 101,
      transcript: "CUSTOMER: Yes, add the oven cleaning.",
      extras: ["clean_inside_oven"],
    });

    const setCall = mockDb._updateSet.mock.calls[0][0];
    expect(JSON.parse(setCall.extras)).toContain("clean_inside_oven");
  });

  it("appends to existing message history (does not overwrite)", async () => {
    const existingMessages = [{ role: "user", content: "Hello", ts: 1000 }];
    const mockDb = buildMockDb(makeExistingSession({
      messageHistory: JSON.stringify(existingMessages),
    }));
    vi.mocked(getDb).mockResolvedValue(mockDb as any);

    const ctx = await createAgentContext();
    const caller = appRouter.createCaller(ctx);

    await caller.leads.appendCallToSession({
      sessionId: 101,
      transcript: "AGENT: Following up.",
    });

    const setCall = mockDb._updateSet.mock.calls[0][0];
    const parsedHistory = JSON.parse(setCall.messageHistory);
    expect(parsedHistory).toHaveLength(2);
    expect(parsedHistory[0].content).toBe("Hello");
    expect(parsedHistory[1].role).toBe("system");
  });

  it("throws NOT_FOUND when session does not exist", async () => {
    const mockDb = buildMockDb(null); // no session found
    vi.mocked(getDb).mockResolvedValue(mockDb as any);

    const ctx = await createAgentContext();
    const caller = appRouter.createCaller(ctx);

    await expect(
      caller.leads.appendCallToSession({
        sessionId: 9999,
        transcript: "AGENT: Hello?",
      })
    ).rejects.toThrow("Session not found");
  });

  it("rejects transcript exceeding 8000 chars", async () => {
    const ctx = await createAgentContext();
    const caller = appRouter.createCaller(ctx);

    await expect(
      caller.leads.appendCallToSession({
        sessionId: 101,
        transcript: "x".repeat(8001),
      })
    ).rejects.toThrow();
  });

  it("rejects sessionId of 0 (must be positive)", async () => {
    const ctx = await createAgentContext();
    const caller = appRouter.createCaller(ctx);

    await expect(
      caller.leads.appendCallToSession({
        sessionId: 0,
        transcript: "AGENT: Hello.",
      })
    ).rejects.toThrow();
  });

  it("sets lastCalledAt on every call", async () => {
    const mockDb = buildMockDb(makeExistingSession());
    vi.mocked(getDb).mockResolvedValue(mockDb as any);

    const ctx = await createAgentContext();
    const caller = appRouter.createCaller(ctx);

    await caller.leads.appendCallToSession({
      sessionId: 101,
      transcript: "AGENT: Checking in.",
    });

    const setCall = mockDb._updateSet.mock.calls[0][0];
    expect(setCall.lastCalledAt).toBeInstanceOf(Date);
  });
});
