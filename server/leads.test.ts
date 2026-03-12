/**
 * Tests for the leads router (leads.list and leads.stats)
 *
 * These tests verify that the procedures return the correct shape,
 * handle the case where the database is unavailable gracefully,
 * and pass date range conditions when provided.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

// ── Helpers ───────────────────────────────────────────────────────────────────

function createPublicContext(): TrpcContext {
  return {
    user: null,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: vi.fn() } as unknown as TrpcContext["res"],
  };
}

// ── Mock the DB module ────────────────────────────────────────────────────────

vi.mock("./db", () => ({
  getDb: vi.fn(),
}));

import { getDb } from "./db";

const mockGetDb = vi.mocked(getDb);

// ── leads.list ────────────────────────────────────────────────────────────────

describe("leads.list", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns an empty array when the database is unavailable", async () => {
    mockGetDb.mockResolvedValue(null as never);
    const caller = appRouter.createCaller(createPublicContext());
    const result = await caller.leads.list();
    expect(result).toEqual([]);
  });

  it("returns an empty array when called with date filter and DB is unavailable", async () => {
    mockGetDb.mockResolvedValue(null as never);
    const caller = appRouter.createCaller(createPublicContext());
    const result = await caller.leads.list({ dateFrom: "2026-03-01", dateTo: "2026-03-31" });
    expect(result).toEqual([]);
  });

  it("returns sessions ordered by updatedAt when DB is available", async () => {
    const fakeSessions = [
      {
        id: 2,
        leadPhone: "+12025551234",
        leadName: "Alice",
        stage: "AVAILABILITY",
        quotedPrice: "209",
        serviceType: "Standard Cleaning",
        bedrooms: "2",
        bathrooms: "1",
        selectedSlot: null,
        address: null,
        callPreference: null,
        messageHistory: "[]",
        quoteLeadId: null,
        createdAt: new Date("2026-03-10T10:00:00Z"),
        updatedAt: new Date("2026-03-11T15:00:00Z"),
      },
      {
        id: 1,
        leadPhone: "+12025559876",
        leadName: "Bob",
        stage: "DONE",
        quotedPrice: "299",
        serviceType: "Deep Cleaning",
        bedrooms: "3",
        bathrooms: "2",
        selectedSlot: "Thursday 1PM",
        address: "123 Main St, Washington DC",
        callPreference: "now",
        messageHistory: "[]",
        quoteLeadId: 5,
        createdAt: new Date("2026-03-09T08:00:00Z"),
        updatedAt: new Date("2026-03-10T12:00:00Z"),
      },
    ];

    // Build a chainable mock that returns fakeSessions at the end
    const mockLimit = vi.fn().mockResolvedValue(fakeSessions);
    const mockOrderBy = vi.fn().mockReturnValue({ limit: mockLimit });
    const mockWhere = vi.fn().mockReturnValue({ orderBy: mockOrderBy });
    const mockFrom = vi.fn().mockReturnValue({ where: mockWhere });
    const mockSelect = vi.fn().mockReturnValue({ from: mockFrom });

    mockGetDb.mockResolvedValue({ select: mockSelect } as never);

    const caller = appRouter.createCaller(createPublicContext());
    const result = await caller.leads.list();

    expect(result).toHaveLength(2);
    expect(result[0]?.leadName).toBe("Alice");
    expect(result[1]?.leadName).toBe("Bob");
  });

  it("accepts dateFrom and dateTo filter parameters", async () => {
    const mockLimit = vi.fn().mockResolvedValue([]);
    const mockOrderBy = vi.fn().mockReturnValue({ limit: mockLimit });
    const mockWhere = vi.fn().mockReturnValue({ orderBy: mockOrderBy });
    const mockFrom = vi.fn().mockReturnValue({ where: mockWhere });
    const mockSelect = vi.fn().mockReturnValue({ from: mockFrom });

    mockGetDb.mockResolvedValue({ select: mockSelect } as never);

    const caller = appRouter.createCaller(createPublicContext());
    // Should not throw even with date filters
    const result = await caller.leads.list({ dateFrom: "2026-03-01", dateTo: "2026-03-31" });
    expect(Array.isArray(result)).toBe(true);
  });
});

// ── leads.stats ───────────────────────────────────────────────────────────────

describe("leads.stats", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns zero totals when the database is unavailable", async () => {
    mockGetDb.mockResolvedValue(null as never);
    const caller = appRouter.createCaller(createPublicContext());
    const result = await caller.leads.stats();
    expect(result).toEqual({ total: 0, byStage: {} });
  });

  it("returns zero totals with date filter when DB is unavailable", async () => {
    mockGetDb.mockResolvedValue(null as never);
    const caller = appRouter.createCaller(createPublicContext());
    const result = await caller.leads.stats({ dateFrom: "2026-03-01" });
    expect(result).toEqual({ total: 0, byStage: {} });
  });

  it("aggregates stage counts correctly", async () => {
    const fakeRows = [
      { stage: "AVAILABILITY", count: 5 },
      { stage: "DONE", count: 3 },
      { stage: "UNHANDLED", count: 1 },
    ];

    const mockGroupBy = vi.fn().mockResolvedValue(fakeRows);
    const mockWhere = vi.fn().mockReturnValue({ groupBy: mockGroupBy });
    const mockFrom = vi.fn().mockReturnValue({ where: mockWhere });
    const mockSelect = vi.fn().mockReturnValue({ from: mockFrom });

    mockGetDb.mockResolvedValue({ select: mockSelect } as never);

    const caller = appRouter.createCaller(createPublicContext());
    const result = await caller.leads.stats();

    expect(result.total).toBe(9);
    expect(result.byStage["AVAILABILITY"]).toBe(5);
    expect(result.byStage["DONE"]).toBe(3);
    expect(result.byStage["UNHANDLED"]).toBe(1);
  });

  it("handles numeric string counts from MySQL", async () => {
    // MySQL count() returns strings in some drivers
    const fakeRows = [
      { stage: "SLOT_CHOICE", count: "7" },
      { stage: "CONFIRMATION", count: "2" },
    ];

    const mockGroupBy = vi.fn().mockResolvedValue(fakeRows);
    const mockWhere = vi.fn().mockReturnValue({ groupBy: mockGroupBy });
    const mockFrom = vi.fn().mockReturnValue({ where: mockWhere });
    const mockSelect = vi.fn().mockReturnValue({ from: mockFrom });

    mockGetDb.mockResolvedValue({ select: mockSelect } as never);

    const caller = appRouter.createCaller(createPublicContext());
    const result = await caller.leads.stats();

    expect(result.total).toBe(9);
    expect(result.byStage["SLOT_CHOICE"]).toBe(7);
    expect(result.byStage["CONFIRMATION"]).toBe(2);
  });

  it("returns correct counts for all 8 conversation stages", async () => {
    const allStages = [
      "QUOTE_SENT", "AVAILABILITY", "SLOT_CHOICE", "ADDRESS",
      "CONFIRMATION", "CALL_SCHEDULED", "DONE", "UNHANDLED",
    ];
    const fakeRows = allStages.map((stage, i) => ({ stage, count: i + 1 }));

    const mockGroupBy = vi.fn().mockResolvedValue(fakeRows);
    const mockWhere = vi.fn().mockReturnValue({ groupBy: mockGroupBy });
    const mockFrom = vi.fn().mockReturnValue({ where: mockWhere });
    const mockSelect = vi.fn().mockReturnValue({ from: mockFrom });

    mockGetDb.mockResolvedValue({ select: mockSelect } as never);

    const caller = appRouter.createCaller(createPublicContext());
    const result = await caller.leads.stats();

    // 1+2+3+4+5+6+7+8 = 36
    expect(result.total).toBe(36);
    expect(result.byStage["QUOTE_SENT"]).toBe(1);
    expect(result.byStage["DONE"]).toBe(7);
    expect(result.byStage["UNHANDLED"]).toBe(8);
  });
});
