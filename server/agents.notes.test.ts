/**
 * Tests for agents.claimLead, agents.updateNotes, and agents.getNotes procedures
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import { signAgentSession } from "./_core/agentAuth";
import { AGENT_COOKIE_NAME } from "@shared/const";

// ── Context helpers ───────────────────────────────────────────────────────────

async function createAgentContext(agentId = 1, isAdmin = false): Promise<TrpcContext> {
  const token = await signAgentSession({
    agentId,
    agentName: "Test Agent",
    agentEmail: "agent@test.com",
    isAdmin,
  });
  return {
    user: null,
    req: {
      protocol: "https",
      headers: { cookie: `${AGENT_COOKIE_NAME}=${token}` },
    } as TrpcContext["req"],
    res: { clearCookie: vi.fn(), cookie: vi.fn() } as unknown as TrpcContext["res"],
  };
}

function createPublicContext(): TrpcContext {
  return {
    user: null,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: vi.fn() } as unknown as TrpcContext["res"],
  };
}

// ── Mock DB ───────────────────────────────────────────────────────────────────

vi.mock("./db", () => ({
  getDb: vi.fn(),
  getAgentByEmail: vi.fn(),
  getAgentById: vi.fn(),
  getAllAgents: vi.fn(),
  createAgent: vi.fn(),
  setAgentActive: vi.fn(),
}));

import { getDb, getAgentById } from "./db";
const mockGetDb = vi.mocked(getDb);
const mockGetAgentById = vi.mocked(getAgentById);

// Default: agent is active
beforeEach(() => {
  mockGetAgentById.mockResolvedValue({ id: 1, name: "Test Agent", email: "agent@test.com", isActive: 1, isAdmin: 0, passwordHash: "x", createdAt: new Date(), updatedAt: new Date() } as never);
});

// ── agents.claimLead ──────────────────────────────────────────────────────────

describe("agents.claimLead", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("throws when no agent session cookie is present", async () => {
    mockGetDb.mockResolvedValue(null as never);
    const caller = appRouter.createCaller(createPublicContext());
    await expect(caller.agents.claimLead({ sessionId: 1 })).rejects.toThrow();
  });

  it("throws when the lead is not found", async () => {
    // claimLead: db.select().from().where().limit() → must resolve to []
    const mockLimit = vi.fn().mockResolvedValue([]);
    const mockWhere = vi.fn().mockReturnValue({ limit: mockLimit });
    const mockFrom = vi.fn().mockReturnValue({ where: mockWhere });
    const mockSelect = vi.fn().mockReturnValue({ from: mockFrom });
    mockGetDb.mockResolvedValue({ select: mockSelect } as never);

    const ctx = await createAgentContext(1);
    const caller = appRouter.createCaller(ctx);
    await expect(caller.agents.claimLead({ sessionId: 999 })).rejects.toThrow("Lead not found");
  });

  it("throws when the lead is already claimed by another agent", async () => {
    const existingSession = [{ id: 1, assignedAgentId: 99, assignedAgentName: "Other Agent" }];
    const mockWhere = vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue(existingSession) });
    const mockFrom = vi.fn().mockReturnValue({ where: mockWhere });
    const mockSelect = vi.fn().mockReturnValue({ from: mockFrom });
    mockGetDb.mockResolvedValue({ select: mockSelect } as never);

    const ctx = await createAgentContext(1); // agent 1 trying to claim a lead owned by agent 99
    const caller = appRouter.createCaller(ctx);
    await expect(caller.agents.claimLead({ sessionId: 1 })).rejects.toThrow("already claimed by another agent");
  });

  it("succeeds when the lead is unassigned", async () => {
    const existingSession = [{ id: 1, assignedAgentId: null, assignedAgentName: null }];
    const mockSetWhere = vi.fn().mockResolvedValue(undefined);
    const mockSet = vi.fn().mockReturnValue({ where: mockSetWhere });
    const mockUpdate = vi.fn().mockReturnValue({ set: mockSet });
    const mockWhere = vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue(existingSession) });
    const mockFrom = vi.fn().mockReturnValue({ where: mockWhere });
    const mockSelect = vi.fn().mockReturnValue({ from: mockFrom });
    mockGetDb.mockResolvedValue({ select: mockSelect, update: mockUpdate } as never);

    const ctx = await createAgentContext(1);
    const caller = appRouter.createCaller(ctx);
    const result = await caller.agents.claimLead({ sessionId: 1 });
    expect(result).toEqual({ success: true });
  });

  it("succeeds when the lead is already assigned to the same agent (idempotent)", async () => {
    const existingSession = [{ id: 1, assignedAgentId: 1, assignedAgentName: "Test Agent" }];
    const mockSetWhere = vi.fn().mockResolvedValue(undefined);
    const mockSet = vi.fn().mockReturnValue({ where: mockSetWhere });
    const mockUpdate = vi.fn().mockReturnValue({ set: mockSet });
    const mockWhere = vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue(existingSession) });
    const mockFrom = vi.fn().mockReturnValue({ where: mockWhere });
    const mockSelect = vi.fn().mockReturnValue({ from: mockFrom });
    mockGetDb.mockResolvedValue({ select: mockSelect, update: mockUpdate } as never);

    const ctx = await createAgentContext(1);
    const caller = appRouter.createCaller(ctx);
    const result = await caller.agents.claimLead({ sessionId: 1 });
    expect(result).toEqual({ success: true });
  });
});

// ── agents.updateNotes ────────────────────────────────────────────────────────

describe("agents.updateNotes", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("throws when no agent session cookie is present", async () => {
    mockGetDb.mockResolvedValue(null as never);
    const caller = appRouter.createCaller(createPublicContext());
    await expect(caller.agents.updateNotes({ sessionId: 1, notes: "test" })).rejects.toThrow();
  });

  it("throws when the database is unavailable", async () => {
    mockGetDb.mockResolvedValue(null as never);
    const ctx = await createAgentContext(1);
    const caller = appRouter.createCaller(ctx);
    await expect(caller.agents.updateNotes({ sessionId: 1, notes: "test" })).rejects.toThrow("Database unavailable");
  });

  it("saves notes and returns success", async () => {
    const mockSetWhere = vi.fn().mockResolvedValue(undefined);
    const mockSet = vi.fn().mockReturnValue({ where: mockSetWhere });
    const mockUpdate = vi.fn().mockReturnValue({ set: mockSet });
    mockGetDb.mockResolvedValue({ update: mockUpdate } as never);

    const ctx = await createAgentContext(1);
    const caller = appRouter.createCaller(ctx);
    const result = await caller.agents.updateNotes({ sessionId: 1, notes: "Left voicemail, call back Friday" });
    expect(result).toEqual({ success: true });
    expect(mockSet).toHaveBeenCalledWith({ internalNotes: "Left voicemail, call back Friday" });
  });

  it("rejects notes longer than 5000 characters", async () => {
    const ctx = await createAgentContext(1);
    const caller = appRouter.createCaller(ctx);
    const longNotes = "x".repeat(5001);
    await expect(caller.agents.updateNotes({ sessionId: 1, notes: longNotes })).rejects.toThrow();
  });

  it("allows saving empty notes (clearing notes)", async () => {
    const mockSetWhere = vi.fn().mockResolvedValue(undefined);
    const mockSet = vi.fn().mockReturnValue({ where: mockSetWhere });
    const mockUpdate = vi.fn().mockReturnValue({ set: mockSet });
    mockGetDb.mockResolvedValue({ update: mockUpdate } as never);

    const ctx = await createAgentContext(1);
    const caller = appRouter.createCaller(ctx);
    const result = await caller.agents.updateNotes({ sessionId: 1, notes: "" });
    expect(result).toEqual({ success: true });
    expect(mockSet).toHaveBeenCalledWith({ internalNotes: "" });
  });
});

// ── agents.getNotes ───────────────────────────────────────────────────────────

describe("agents.getNotes", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("throws when no agent session cookie is present", async () => {
    mockGetDb.mockResolvedValue(null as never);
    const caller = appRouter.createCaller(createPublicContext());
    await expect(caller.agents.getNotes({ sessionId: 1 })).rejects.toThrow();
  });

  it("returns null notes when DB is unavailable", async () => {
    mockGetDb.mockResolvedValue(null as never);
    const ctx = await createAgentContext(1);
    const caller = appRouter.createCaller(ctx);
    const result = await caller.agents.getNotes({ sessionId: 1 });
    expect(result).toEqual({ notes: null });
  });

  it("returns null when session is not found", async () => {
    const mockWhere = vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]) });
    const mockFrom = vi.fn().mockReturnValue({ where: mockWhere });
    const mockSelect = vi.fn().mockReturnValue({ from: mockFrom });
    mockGetDb.mockResolvedValue({ select: mockSelect } as never);

    const ctx = await createAgentContext(1);
    const caller = appRouter.createCaller(ctx);
    const result = await caller.agents.getNotes({ sessionId: 999 });
    expect(result).toEqual({ notes: null });
  });

  it("returns the stored notes for a session", async () => {
    const fakeRow = [{ internalNotes: "Price objection — follow up Monday" }];
    const mockWhere = vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue(fakeRow) });
    const mockFrom = vi.fn().mockReturnValue({ where: mockWhere });
    const mockSelect = vi.fn().mockReturnValue({ from: mockFrom });
    mockGetDb.mockResolvedValue({ select: mockSelect } as never);

    const ctx = await createAgentContext(1);
    const caller = appRouter.createCaller(ctx);
    const result = await caller.agents.getNotes({ sessionId: 1 });
    expect(result).toEqual({ notes: "Price objection — follow up Monday" });
  });

  it("returns null when internalNotes is null in DB", async () => {
    const fakeRow = [{ internalNotes: null }];
    const mockWhere = vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue(fakeRow) });
    const mockFrom = vi.fn().mockReturnValue({ where: mockWhere });
    const mockSelect = vi.fn().mockReturnValue({ from: mockFrom });
    mockGetDb.mockResolvedValue({ select: mockSelect } as never);

    const ctx = await createAgentContext(1);
    const caller = appRouter.createCaller(ctx);
    const result = await caller.agents.getNotes({ sessionId: 1 });
    expect(result).toEqual({ notes: null });
  });
});
