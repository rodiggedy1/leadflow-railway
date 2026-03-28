/**
 * Tests for runUnclaimedLeadEscalation
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Hoisted mocks (must be declared before vi.mock calls) ─────────────────────
const { mockInsert, mockUpdate, mockSelect } = vi.hoisted(() => {
  const mockSelect = vi.fn();
  const mockInsert = vi.fn();
  const mockUpdate = vi.fn();
  return { mockInsert, mockUpdate, mockSelect };
});

vi.mock("./db", () => ({
  getDb: vi.fn().mockResolvedValue({
    select: mockSelect,
    insert: mockInsert,
    update: mockUpdate,
  }),
}));

vi.mock("../drizzle/schema", () => ({
  opsChatMessages: {},
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((col, val) => ({ col, val, op: "eq" })),
  and: vi.fn((...args) => ({ args, op: "and" })),
  isNull: vi.fn(col => ({ col, op: "isNull" })),
  lt: vi.fn((col, val) => ({ col, val, op: "lt" })),
}));

// ── Import after mocks ────────────────────────────────────────────────────────
import { runUnclaimedLeadEscalation } from "./unclaimedLeadEscalation";

describe("runUnclaimedLeadEscalation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 0 escalated when no candidates found", async () => {
    mockSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    });

    const result = await runUnclaimedLeadEscalation();
    expect(result.checked).toBe(0);
    expect(result.escalated).toBe(0);
  });

  it("skips a card that is already claimed", async () => {
    const claimedCard = {
      id: 1,
      metadata: JSON.stringify({ claimedBy: "Alice", arrivedAt: Date.now() - 10 * 60_000 }),
      createdAt: new Date(Date.now() - 10 * 60_000),
    };
    mockSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([claimedCard]),
      }),
    });

    const result = await runUnclaimedLeadEscalation();
    expect(result.checked).toBe(1);
    expect(result.escalated).toBe(0);
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("skips a card that already has escalationPosted = true", async () => {
    const alreadyEscalated = {
      id: 2,
      metadata: JSON.stringify({ escalationPosted: true, arrivedAt: Date.now() - 10 * 60_000 }),
      createdAt: new Date(Date.now() - 10 * 60_000),
    };
    mockSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([alreadyEscalated]),
      }),
    });

    const result = await runUnclaimedLeadEscalation();
    expect(result.checked).toBe(1);
    expect(result.escalated).toBe(0);
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("posts a nudge and marks escalationPosted for an unclaimed lead", async () => {
    const insertValues = vi.fn().mockResolvedValue(undefined);
    const updateWhere = vi.fn().mockResolvedValue(undefined);
    const updateSet = vi.fn().mockReturnValue({ where: updateWhere });
    mockInsert.mockReturnValue({ values: insertValues });
    mockUpdate.mockReturnValue({ set: updateSet });

    const unclaimedCard = {
      id: 3,
      metadata: JSON.stringify({ leadName: "Anna Smith", arrivedAt: Date.now() - 7 * 60_000 }),
      createdAt: new Date(Date.now() - 7 * 60_000),
    };
    mockSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([unclaimedCard]),
      }),
    });

    const result = await runUnclaimedLeadEscalation();
    expect(result.checked).toBe(1);
    expect(result.escalated).toBe(1);

    // Should have inserted an escalation_nudge message
    expect(mockInsert).toHaveBeenCalledTimes(1);
    const insertedValues = insertValues.mock.calls[0][0];
    expect(insertedValues.quickAction).toBe("escalation_nudge");
    expect(insertedValues.body).toContain("Anna Smith");
    expect(insertedValues.channel).toBe("command");

    // Should have updated the original card's metadata
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    const updatedMeta = JSON.parse(updateSet.mock.calls[0][0].metadata);
    expect(updatedMeta.escalationPosted).toBe(true);
  });

  it("handles malformed metadata gracefully without throwing", async () => {
    const badCard = {
      id: 4,
      metadata: "not-valid-json",
      createdAt: new Date(Date.now() - 10 * 60_000),
    };
    mockSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([badCard]),
      }),
    });

    const result = await runUnclaimedLeadEscalation();
    expect(result).not.toBeNull();
    expect(result.escalated).toBe(0);
  });
});
