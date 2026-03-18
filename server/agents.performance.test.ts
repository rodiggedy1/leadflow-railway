/**
 * Tests for agents.performance procedure
 *
 * The procedure makes 6 Drizzle queries + 1 raw db.execute():
 *   1. allAgents:          select().from().where()
 *   2. callsThisWeek:      select().from().where().groupBy()
 *   3. bookingsThisWeek:   select().from().where().groupBy()
 *   4. totalAssigned:      select().from().where().groupBy()
 *   5. bookingsAllTime:    select().from().where().groupBy()
 *   6. revenuePerAgent:    select().from().where().groupBy()
 *   7. responseTimeRows:   db.execute(sql`...`)  → returns [rows, fields]
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import { signAgentSession } from "./_core/agentAuth";
import { AGENT_COOKIE_NAME } from "@shared/const";

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
 * Build a mock DB that returns a sequence of results for successive select() calls,
 * plus a fixed result for db.execute() (the raw SQL response time query).
 *
 * Drizzle select chains supported:
 *   - select().from().where()                 (allAgents — where is awaitable)
 *   - select().from().where().groupBy()       (grouped queries)
 *
 * db.execute() returns [rows, fields] matching MySQL2 format.
 */
function buildSequentialMockDb(
  results: unknown[][],
  executeResult: unknown[] = []
) {
  let callIndex = 0;

  const selectMock = vi.fn().mockImplementation(() => {
    const result = results[callIndex] ?? [];
    callIndex++;

    const groupBy = vi.fn().mockResolvedValue(result);

    // where: awaitable (for allAgents) AND returns { groupBy }
    const whereResult = {
      groupBy,
      then: (resolve: (v: unknown) => void, reject: (e: unknown) => void) =>
        Promise.resolve(result).then(resolve, reject),
    };
    const where = vi.fn().mockReturnValue(whereResult);
    const from = vi.fn().mockReturnValue({ where });
    return { from };
  });

  // db.execute() returns [rows, fields] — MySQL2 format
  const executeMock = vi.fn().mockResolvedValue([executeResult, []]);

  return { select: selectMock, execute: executeMock };
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

  it("returns all 4 stats for each active agent", async () => {
    const fakeAgents = [
      { id: 1, name: "Alice", email: "alice@test.com", isActive: 1 },
      { id: 2, name: "Bob", email: "bob@test.com", isActive: 1 },
    ];
    const mockDb = buildSequentialMockDb(
      [
        fakeAgents,                                                      // 1. allAgents
        [{ agentId: 1, count: 3 }, { agentId: 2, count: 1 }],          // 2. callsThisWeek
        [{ agentId: 1, count: 2 }],                                     // 3. bookingsThisWeek
        [{ agentId: 1, count: 5 }, { agentId: 2, count: 3 }],          // 4. totalAssigned
        [{ agentId: 1, count: 4 }, { agentId: 2, count: 1 }],          // 5. bookingsAllTime
        [{ agentId: 1, revenue: 1200 }, { agentId: 2, revenue: 300 }], // 6. revenuePerAgent
      ],
      [{ agentId: 1, avgMinutes: 45 }]                                  // 7. db.execute (response time)
    );
    mockGetDb.mockResolvedValue(mockDb as never);

    const ctx = await createAdminContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.agents.performance();

    expect(result).toHaveLength(2);
    const alice = result.find(a => a.name === "Alice") as any;
    const bob = result.find(a => a.name === "Bob") as any;

    expect(alice?.callsThisWeek).toBe(3);
    expect(alice?.bookingsThisWeek).toBe(2);
    expect(alice?.totalAssigned).toBe(5);
    expect(alice?.bookingsAllTime).toBe(4);
    expect(alice?.conversionRate).toBe(80);
    expect(alice?.revenueBooked).toBe(1200);
    expect(alice?.avgResponseTimeMinutes).toBe(45);

    expect(bob?.callsThisWeek).toBe(1);
    expect(bob?.bookingsThisWeek).toBe(0);
    expect(bob?.totalAssigned).toBe(3);
    expect(bob?.bookingsAllTime).toBe(1);
    expect(bob?.conversionRate).toBe(33);
    expect(bob?.revenueBooked).toBe(300);
    expect(bob?.avgResponseTimeMinutes).toBeNull(); // no response time data for Bob
  });

  it("returns zeros and null when agent has no data", async () => {
    const fakeAgents = [{ id: 1, name: "Charlie", email: "charlie@test.com", isActive: 1 }];
    const mockDb = buildSequentialMockDb(
      [fakeAgents, [], [], [], [], []],
      []
    );
    mockGetDb.mockResolvedValue(mockDb as never);

    const ctx = await createAdminContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.agents.performance();

    expect(result).toHaveLength(1);
    expect(result[0]?.conversionRate).toBe(0);
    expect(result[0]?.totalAssigned).toBe(0);
    expect(result[0]?.callsThisWeek).toBe(0);
    expect(result[0]?.bookingsThisWeek).toBe(0);
    expect((result[0] as any)?.revenueBooked).toBe(0);
    expect((result[0] as any)?.avgResponseTimeMinutes).toBeNull();
  });

  it("handles numeric string counts from MySQL", async () => {
    const fakeAgents = [{ id: 1, name: "Dana", email: "dana@test.com", isActive: 1 }];
    const mockDb = buildSequentialMockDb(
      [
        fakeAgents,
        [{ agentId: 1, count: "5" }],
        [{ agentId: 1, count: "3" }],
        [{ agentId: 1, count: "10" }],
        [{ agentId: 1, count: "6" }],
        [{ agentId: 1, revenue: "2500" }],
      ],
      [{ agentId: 1, avgMinutes: "120" }]
    );
    mockGetDb.mockResolvedValue(mockDb as never);

    const ctx = await createAdminContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.agents.performance();

    expect(result[0]?.callsThisWeek).toBe(5);
    expect(result[0]?.bookingsThisWeek).toBe(3);
    expect(result[0]?.totalAssigned).toBe(10);
    expect(result[0]?.bookingsAllTime).toBe(6);
    expect(result[0]?.conversionRate).toBe(60);
    expect((result[0] as any)?.revenueBooked).toBe(2500);
    expect((result[0] as any)?.avgResponseTimeMinutes).toBe(120);
  });

  it("throws when called by a non-admin agent", async () => {
    mockGetDb.mockResolvedValue(null as never);
    const ctx = await createNonAdminAgentContext();
    const caller = appRouter.createCaller(ctx);
    await expect(caller.agents.performance()).rejects.toThrow("Admin access required");
  });
});
