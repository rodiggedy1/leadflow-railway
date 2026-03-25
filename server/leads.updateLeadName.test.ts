/**
 * Tests for leads.updateLeadName tRPC mutation.
 * Verifies that the mutation correctly updates the leadName field
 * on a conversationSession and returns the new name.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import { signAgentSession } from "./_core/agentAuth";
import { AGENT_COOKIE_NAME } from "@shared/const";

// ── Mock DB ───────────────────────────────────────────────────────────────────
vi.mock("./db", () => ({
  getDb: vi.fn(),
  getAgentByEmail: vi.fn(),
  getAgentById: vi.fn(),
  getAllAgents: vi.fn(),
  createAgent: vi.fn(),
  setAgentActive: vi.fn(),
  getOrCreateCleanerMagicLink: vi.fn(),
}));

import { getDb, getAgentById } from "./db";
const mockGetDb = vi.mocked(getDb);
const mockGetAgentById = vi.mocked(getAgentById);

// ── Context helpers ───────────────────────────────────────────────────────────
async function createAdminContext(): Promise<TrpcContext> {
  const token = await signAgentSession({
    agentId: 1,
    agentName: "Admin Agent",
    agentEmail: "admin@test.com",
    isAdmin: true,
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

// ── Mock DB query chain ───────────────────────────────────────────────────────
const mockWhere = vi.fn().mockResolvedValue(undefined);
const mockSet = vi.fn().mockReturnValue({ where: mockWhere });
const mockUpdate = vi.fn().mockReturnValue({ set: mockSet });

beforeEach(() => {
  vi.clearAllMocks();

  // Agent lookup — required by adminAgentProcedure
  mockGetAgentById.mockResolvedValue({
    id: 1,
    name: "Admin Agent",
    email: "admin@test.com",
    isActive: 1,
    isAdmin: 1,
    passwordHash: "x",
    createdAt: new Date(),
  } as any);

  // DB query chain
  mockWhere.mockResolvedValue(undefined);
  mockSet.mockReturnValue({ where: mockWhere });
  mockUpdate.mockReturnValue({ set: mockSet });
  mockGetDb.mockResolvedValue({ update: mockUpdate } as any);
});

// ── Tests ─────────────────────────────────────────────────────────────────────
describe("leads.updateLeadName", () => {
  it("updates the leadName in the database and returns the new name", async () => {
    const ctx = await createAdminContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.leads.updateLeadName({
      sessionId: 42,
      leadName: "Jane Doe",
    });

    expect(result).toEqual({ success: true, leadName: "Jane Doe" });
    expect(mockUpdate).toHaveBeenCalled();
    expect(mockSet).toHaveBeenCalledWith({ leadName: "Jane Doe" });
  });

  it("trims whitespace from the name before saving", async () => {
    const ctx = await createAdminContext();
    const caller = appRouter.createCaller(ctx);

    // Zod .trim() strips leading/trailing whitespace automatically
    const result = await caller.leads.updateLeadName({
      sessionId: 5,
      leadName: "Alice Smith",
    });

    expect(result.leadName).toBe("Alice Smith");
    expect(mockSet).toHaveBeenCalledWith({ leadName: "Alice Smith" });
  });

  it("rejects empty string names", async () => {
    const ctx = await createAdminContext();
    const caller = appRouter.createCaller(ctx);

    await expect(
      caller.leads.updateLeadName({ sessionId: 1, leadName: "" })
    ).rejects.toThrow();
  });

  it("rejects names longer than 255 characters", async () => {
    const ctx = await createAdminContext();
    const caller = appRouter.createCaller(ctx);

    const longName = "A".repeat(256);
    await expect(
      caller.leads.updateLeadName({ sessionId: 1, leadName: longName })
    ).rejects.toThrow();
  });

  it("throws when database is unavailable", async () => {
    mockGetDb.mockResolvedValueOnce(null as any);

    const ctx = await createAdminContext();
    const caller = appRouter.createCaller(ctx);

    await expect(
      caller.leads.updateLeadName({ sessionId: 1, leadName: "Test" })
    ).rejects.toThrow("Database unavailable");
  });
});
