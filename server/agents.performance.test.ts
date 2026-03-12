/**
 * Tests for agents.performance procedure
 *
 * The procedure makes 5 DB queries:
 *   1. allAgents:          select().from().where()            — where() is awaitable
 *   2. callsThisWeek:      select().from().where().groupBy()  — groupBy() is awaitable
 *   3. bookingsThisWeek:   select().from().where().groupBy()  — groupBy() is awaitable
 *   4. totalAssigned:      select().from().where().groupBy()  — groupBy() is awaitable
 *   5. bookingsAllTime:    select().from().where().groupBy()  — groupBy() is awaitable
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import { signAgentSession } from "./_core/agentAuth";
import { AGENT_COOKIE_NAME } from "@shared/const";

/**
 * Build a TrpcContext with a valid admin agent session cookie.
 * Must be awaited before passing to appRouter.createCaller().
 */
async function createAdminContext(): Promise<TrpcContext> {
  const token = await signAgentSession({
    agentId: 1,
    agentName: "Admin",
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

/**
 * Build a TrpcContext with a non-admin agent session cookie.
 */
async function createNonAdminAgentContext(): Promise<TrpcContext> {
  const token = await signAgentSession({
    agentId: 2,
    agentName: "Agent",
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

vi.mock("./db", () => ({
  getDb: vi.fn(),
  getAgentByEmail: vi.fn(),
  getAgentById: vi.fn(),
  getAllAgents: vi.fn(),
  createAgent: vi.fn(),
  setAgentActive: vi.fn(),
}));

import { getDb } from "./db";
const mockGetDb = vi.mocked(getDb);

/**
 * Build a mock DB that returns a sequence of results for successive select() calls.
 *
 * Query 1 (allAgents): select().from().where()  — where() must be a thenable
 * Queries 2-5 (grouped): select().from().where().groupBy()  — groupBy() must be a thenable
 *
 * We make where() itself a thenable (has .then) AND return { groupBy } so both chains work.
 */
function buildSequentialMockDb(results: unknown[][]) {
  let callIndex = 0;
  const selectMock = vi.fn().mockImplementation(() => {
    const result = results[callIndex] ?? [];
    callIndex++;

    // groupBy is the terminal for grouped queries
    const groupBy = vi.fn().mockResolvedValue(result);

    // where needs to be BOTH awaitable (for allAgents) AND return { groupBy }
    // We do this by making where() return a thenable object that also has groupBy
    const whereResult = {
      groupBy,
      then: (resolve: (v: unknown) => void, reject: (e: unknown) => void) =>
        Promise.resolve(result).then(resolve, reject),
    };
    const where = vi.fn().mockReturnValue(whereResult);
    const from = vi.fn().mockReturnValue({ where });
    return { from };
  });
  return { select: selectMock };
}

describe("agents.performance", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("returns empty array when DB is unavailable", async () => {
    mockGetDb.mockResolvedValue(null as never);
    const ctx = await createAdminContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.agents.performance();
    expect(result).toEqual([]);
  });

  it("returns stats for each active agent", async () => {
    const fakeAgents = [
      { id: 1, name: "Alice", email: "alice@test.com", isActive: 1 },
      { id: 2, name: "Bob", email: "bob@test.com", isActive: 1 },
    ];
    const mockDb = buildSequentialMockDb([
      fakeAgents,
      [{ agentId: 1, count: 3 }, { agentId: 2, count: 1 }],
      [{ agentId: 1, count: 2 }],
      [{ agentId: 1, count: 5 }, { agentId: 2, count: 3 }],
      [{ agentId: 1, count: 4 }, { agentId: 2, count: 1 }],
    ]);
    mockGetDb.mockResolvedValue(mockDb as never);

    const ctx = await createAdminContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.agents.performance();

    expect(result).toHaveLength(2);
    const alice = result.find(a => a.name === "Alice");
    const bob = result.find(a => a.name === "Bob");

    expect(alice?.callsThisWeek).toBe(3);
    expect(alice?.bookingsThisWeek).toBe(2);
    expect(alice?.totalAssigned).toBe(5);
    expect(alice?.bookingsAllTime).toBe(4);
    expect(alice?.conversionRate).toBe(80);

    expect(bob?.callsThisWeek).toBe(1);
    expect(bob?.bookingsThisWeek).toBe(0);
    expect(bob?.totalAssigned).toBe(3);
    expect(bob?.bookingsAllTime).toBe(1);
    expect(bob?.conversionRate).toBe(33);
  });

  it("returns conversionRate of 0 when agent has no assigned leads", async () => {
    const fakeAgents = [{ id: 1, name: "Charlie", email: "charlie@test.com", isActive: 1 }];
    const mockDb = buildSequentialMockDb([fakeAgents, [], [], [], []]);
    mockGetDb.mockResolvedValue(mockDb as never);

    const ctx = await createAdminContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.agents.performance();

    expect(result).toHaveLength(1);
    expect(result[0]?.conversionRate).toBe(0);
    expect(result[0]?.totalAssigned).toBe(0);
    expect(result[0]?.callsThisWeek).toBe(0);
    expect(result[0]?.bookingsThisWeek).toBe(0);
  });

  it("handles numeric string counts from MySQL", async () => {
    const fakeAgents = [{ id: 1, name: "Dana", email: "dana@test.com", isActive: 1 }];
    const mockDb = buildSequentialMockDb([
      fakeAgents,
      [{ agentId: 1, count: "5" }],
      [{ agentId: 1, count: "3" }],
      [{ agentId: 1, count: "10" }],
      [{ agentId: 1, count: "6" }],
    ]);
    mockGetDb.mockResolvedValue(mockDb as never);

    const ctx = await createAdminContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.agents.performance();

    expect(result[0]?.callsThisWeek).toBe(5);
    expect(result[0]?.bookingsThisWeek).toBe(3);
    expect(result[0]?.totalAssigned).toBe(10);
    expect(result[0]?.bookingsAllTime).toBe(6);
    expect(result[0]?.conversionRate).toBe(60);
  });

  it("throws when called by a non-admin agent", async () => {
    mockGetDb.mockResolvedValue(null as never);
    const ctx = await createNonAdminAgentContext();
    const caller = appRouter.createCaller(ctx);
    await expect(caller.agents.performance()).rejects.toThrow("Admin access required");
  });
});
