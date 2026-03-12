/**
 * Tests for agents.myStats procedure
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import { signAgentSession } from "./_core/agentAuth";
import { AGENT_COOKIE_NAME } from "@shared/const";

// ── Context helpers ───────────────────────────────────────────────────────────

async function createAgentContext(agentId = 1): Promise<TrpcContext> {
  const token = await signAgentSession({
    agentId,
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

beforeEach(() => {
  vi.clearAllMocks();
  mockGetAgentById.mockResolvedValue({
    id: 1,
    name: "Test Agent",
    email: "agent@test.com",
    isActive: 1,
    isAdmin: 0,
    passwordHash: "x",
    createdAt: new Date(),
    updatedAt: new Date(),
  } as never);
});

// ── agents.myStats ────────────────────────────────────────────────────────────

describe("agents.myStats", () => {
  it("throws when no agent session cookie is present", async () => {
    mockGetDb.mockResolvedValue(null as never);
    const caller = appRouter.createCaller(createPublicContext());
    await expect(caller.agents.myStats({})).rejects.toThrow();
  });

  it("returns zeros when DB is unavailable", async () => {
    mockGetDb.mockResolvedValue(null as never);
    const ctx = await createAgentContext(1);
    const caller = appRouter.createCaller(ctx);
    const result = await caller.agents.myStats({});
    expect(result).toEqual({ leadsAssigned: 0, bookedCount: 0, bookedRevenue: 0, conversionRate: 0 });
  });

  it("returns zeros when agent has no assigned leads", async () => {
    // First query (assignedRows): returns empty
    // Second query (bookedRows): returns empty
    let callCount = 0;
    const mockOrderBy = vi.fn().mockResolvedValue([]);
    const mockWhere = vi.fn().mockReturnValue({ orderBy: mockOrderBy });
    const mockFrom = vi.fn().mockReturnValue({ where: mockWhere });
    const mockSelect = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        // assignedRows query — returns empty array directly via where
        return { from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }) };
      }
      // bookedRows query
      return { from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }) };
    });
    mockGetDb.mockResolvedValue({ select: mockSelect } as never);

    const ctx = await createAgentContext(1);
    const caller = appRouter.createCaller(ctx);
    const result = await caller.agents.myStats({});
    expect(result.leadsAssigned).toBe(0);
    expect(result.bookedCount).toBe(0);
    expect(result.bookedRevenue).toBe(0);
    expect(result.conversionRate).toBe(0);
  });

  it("calculates correct revenue using bookedAmount override", async () => {
    let callCount = 0;
    const mockSelect = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        // assignedRows: 2 leads assigned
        return {
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([{ id: 1 }, { id: 2 }]),
          }),
        };
      }
      // bookedRows: 1 booked lead with bookedAmount override of 500
      return {
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([
            { bookedAmount: 500, quotedPrice: "200", extras: null },
          ]),
        }),
      };
    });
    mockGetDb.mockResolvedValue({ select: mockSelect } as never);

    const ctx = await createAgentContext(1);
    const caller = appRouter.createCaller(ctx);
    const result = await caller.agents.myStats({});
    expect(result.leadsAssigned).toBe(2);
    expect(result.bookedCount).toBe(1);
    expect(result.bookedRevenue).toBe(500); // uses bookedAmount override
    expect(result.conversionRate).toBe(50); // 1/2 = 50%
  });

  it("falls back to quotedPrice + extras when bookedAmount is null", async () => {
    let callCount = 0;
    const mockSelect = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return {
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([{ id: 1 }]),
          }),
        };
      }
      // bookedAmount is null — should use quotedPrice 200 + extras (clean_inside_cabinets = 30)
      return {
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([
            { bookedAmount: null, quotedPrice: "200", extras: JSON.stringify(["clean_inside_cabinets"]) },
          ]),
        }),
      };
    });
    mockGetDb.mockResolvedValue({ select: mockSelect } as never);

    const ctx = await createAgentContext(1);
    const caller = appRouter.createCaller(ctx);
    const result = await caller.agents.myStats({});
    expect(result.bookedCount).toBe(1);
    expect(result.bookedRevenue).toBe(230); // 200 + 30
    expect(result.conversionRate).toBe(100); // 1/1
  });
});
