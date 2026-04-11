/**
 * Tests for issue comment procedures:
 *   - getIssueComments: returns comments for a given issueKey
 *   - addIssueComment: inserts a new comment
 *   - claimIssue: auto-posts a system event comment
 *   - resolveIssueOwnership: auto-posts a system event comment
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("./db", () => ({
  getDb: vi.fn(),
}));
vi.mock("./openphone", () => ({
  sendSms: vi.fn().mockResolvedValue({ success: true }),
}));
vi.mock("./sseBroadcast", () => ({
  broadcastOpsUpdate: vi.fn(),
}));

import { getDb } from "./db";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

function createAgentContext(): TrpcContext {
  return {
    user: {
      id: 2,
      openId: "agent-open-id",
      email: "agent@example.com",
      name: "Test Agent",
      loginMethod: "manus",
      role: "user",
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: { protocol: "https", headers: { "x-agent-name": "Test Agent" } } as TrpcContext["req"],
  };
}

function createCaller() {
  return appRouter.createCaller(createAgentContext());
}

// ── getIssueComments ──────────────────────────────────────────────────────────

describe("opsChat.getIssueComments", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns empty array when DB is unavailable", async () => {
    vi.mocked(getDb).mockResolvedValue(null as any);
    const caller = createCaller();
    const result = await caller.opsChat.getIssueComments({ issueKey: "alert-123-456" });
    expect(result).toEqual([]);
  });

  it("returns mapped comment rows ordered by createdAt", async () => {
    const mockRows = [
      { id: 1, issueKey: "alert-123-456", authorName: "Rohan", body: "Looking into it", type: "text", createdAt: 1000 },
      { id: 2, issueKey: "alert-123-456", authorName: "system", body: "Rohan claimed this issue", type: "system", createdAt: 2000 },
    ];
    const mockDb = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockResolvedValue(mockRows),
    };
    vi.mocked(getDb).mockResolvedValue(mockDb as any);

    const caller = createCaller();
    const result = await caller.opsChat.getIssueComments({ issueKey: "alert-123-456" });

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ id: 1, authorName: "Rohan", body: "Looking into it", type: "text" });
    expect(result[1]).toMatchObject({ id: 2, authorName: "system", type: "system" });
  });
});

// ── addIssueComment ───────────────────────────────────────────────────────────

describe("opsChat.addIssueComment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("throws when DB is unavailable", async () => {
    vi.mocked(getDb).mockResolvedValue(null as any);
    const caller = createCaller();
    await expect(
      caller.opsChat.addIssueComment({ issueKey: "alert-123-456", authorName: "Rohan", body: "Test note", type: "text" })
    ).rejects.toThrow("DB unavailable");
  });

  it("inserts a comment and returns ok + createdAt", async () => {
    const insertedRows: any[] = [];
    const mockDb = {
      insert: vi.fn().mockReturnThis(),
      values: vi.fn().mockImplementation((row: any) => {
        insertedRows.push(row);
        return Promise.resolve();
      }),
    };
    vi.mocked(getDb).mockResolvedValue(mockDb as any);

    const caller = createCaller();
    const result = await caller.opsChat.addIssueComment({
      issueKey: "alert-123-456",
      authorName: "Rohan",
      body: "Calling cleaner now",
      type: "text",
    });

    expect(result.ok).toBe(true);
    expect(typeof result.createdAt).toBe("number");
    expect(insertedRows[0]).toMatchObject({
      issueKey: "alert-123-456",
      authorName: "Rohan",
      body: "Calling cleaner now",
      type: "text",
    });
  });
});

// ── claimIssue auto-comment ───────────────────────────────────────────────────

describe("opsChat.claimIssue — system event auto-comment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("auto-posts a system event comment when issue is claimed", async () => {
    const insertedRows: any[] = [];
    // The mock needs to support chaining: insert().values().onDuplicateKeyUpdate()
    // AND insert().values() (for the comment insert which doesn't chain onDuplicateKeyUpdate)
    const chainObj = {
      onDuplicateKeyUpdate: vi.fn().mockResolvedValue(undefined),
    };
    const mockDb = {
      insert: vi.fn().mockReturnThis(),
      values: vi.fn().mockImplementation((row: any) => {
        insertedRows.push(row);
        // Return chainObj for first call (issueOwnership), plain resolved for second (issueComments)
        return chainObj;
      }),
    };
    vi.mocked(getDb).mockResolvedValue(mockDb as any);

    const caller = createCaller();
    const result = await caller.opsChat.claimIssue({ issueKey: "manual-789", claimedBy: "Rohan" });

    expect(result.ok).toBe(true);
    // Should have inserted 2 rows: one for issueOwnership, one for issueComments
    expect(insertedRows.length).toBe(2);
    const systemComment = insertedRows.find((r: any) => r.type === "system");
    expect(systemComment).toBeDefined();
    expect(systemComment.body).toBe("Rohan claimed this issue");
    expect(systemComment.authorName).toBe("system");
  });
});

// ── resolveIssueOwnership auto-comment ───────────────────────────────────────

describe("opsChat.resolveIssueOwnership — system event auto-comment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("auto-posts a system event comment when issue is resolved", async () => {
    const insertedRows: any[] = [];
    const chainObj = {
      onDuplicateKeyUpdate: vi.fn().mockResolvedValue(undefined),
    };
    const mockDb = {
      insert: vi.fn().mockReturnThis(),
      values: vi.fn().mockImplementation((row: any) => {
        insertedRows.push(row);
        return chainObj;
      }),
    };
    vi.mocked(getDb).mockResolvedValue(mockDb as any);

    const caller = createCaller();
    const result = await caller.opsChat.resolveIssueOwnership({ issueKey: "manual-789", resolvedBy: "Diane" });

    expect(result.ok).toBe(true);
    expect(insertedRows.length).toBe(2);
    const systemComment = insertedRows.find((r: any) => r.type === "system");
    expect(systemComment).toBeDefined();
    expect(systemComment.body).toBe("Diane marked this issue resolved");
    expect(systemComment.authorName).toBe("system");
  });
});
