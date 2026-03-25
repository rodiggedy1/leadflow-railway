/**
 * cleaner.magicLink.test.ts
 *
 * Unit tests for the cleaner magic link authentication flow:
 *  - cleaner.sendMagicLink (agentProcedure): generates token, sends SMS
 *  - cleaner.verifyMagicLink (publicProcedure): validates token, issues session cookie
 *
 * These tests mock the database and SMS layer so they run without external dependencies.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { TRPCError } from "@trpc/server";
import type { TrpcContext } from "./_core/context";
import { signAgentSession } from "./_core/agentAuth";
import { AGENT_COOKIE_NAME, CLEANER_COOKIE_NAME } from "@shared/const";

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("./db", () => ({
  getDb: vi.fn(),
  getAgentByEmail: vi.fn(),
  getAgentById: vi.fn(),
  getAllAgents: vi.fn(),
  createAgent: vi.fn(),
  setAgentActive: vi.fn(),
}));

vi.mock("./openphone", () => ({
  sendSms: vi.fn(),
}));

vi.mock("./_core/cleanerAuth", () => ({
  signCleanerSession: vi.fn().mockResolvedValue("mock-session-token"),
  verifyCleanerSession: vi.fn(),
}));

vi.mock("./_core/cookies", () => ({
  getSessionCookieOptions: vi.fn().mockReturnValue({
    httpOnly: true,
    secure: true,
    sameSite: "none",
    path: "/",
  }),
}));

import { getDb, getAgentById } from "./db";
import { sendSms } from "./openphone";

// ── Context helpers ───────────────────────────────────────────────────────────

type SetCookieCall = { name: string; value: string; options: Record<string, unknown> };

async function createAgentContext(): Promise<{ ctx: TrpcContext; cookies: SetCookieCall[] }> {
  const cookies: SetCookieCall[] = [];
  const token = await signAgentSession({
    agentId: 1,
    agentName: "Test Agent",
    agentEmail: "agent@test.com",
    isAdmin: false,
  });
  const ctx: TrpcContext = {
    user: null,
    req: {
      protocol: "https",
      headers: { cookie: `${AGENT_COOKIE_NAME}=${token}` },
    } as TrpcContext["req"],
    res: {
      cookie: (name: string, value: string, options: Record<string, unknown>) => {
        cookies.push({ name, value, options });
      },
      clearCookie: vi.fn(),
    } as unknown as TrpcContext["res"],
  };
  return { ctx, cookies };
}

function createPublicContext(): { ctx: TrpcContext; cookies: SetCookieCall[] } {
  const cookies: SetCookieCall[] = [];
  const ctx: TrpcContext = {
    user: null,
    req: {
      protocol: "https",
      headers: {},
    } as TrpcContext["req"],
    res: {
      cookie: (name: string, value: string, options: Record<string, unknown>) => {
        cookies.push({ name, value, options });
      },
      clearCookie: vi.fn(),
    } as unknown as TrpcContext["res"],
  };
  return { ctx, cookies };
}

// ── sendMagicLink tests ───────────────────────────────────────────────────────

describe("cleaner.sendMagicLink", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // agentProcedure calls getAgentById after verifying the cookie
    vi.mocked(getAgentById).mockResolvedValue({
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

  it("throws NOT_FOUND when cleaner does not exist", async () => {
    const mockDb = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([]),
      update: vi.fn().mockReturnThis(),
      set: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      values: vi.fn().mockResolvedValue(undefined),
    };
    vi.mocked(getDb).mockResolvedValue(mockDb as unknown as Awaited<ReturnType<typeof getDb>>);

    const { appRouter } = await import("./routers");
    const { ctx } = await createAgentContext();
    const caller = appRouter.createCaller(ctx);

    await expect(
      caller.cleaner.sendMagicLink({ cleanerProfileId: 9999, origin: "https://example.com" })
    ).rejects.toThrow(TRPCError);
  });

  it("throws BAD_REQUEST when cleaner has no phone", async () => {
    const mockDb = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([
        { id: 1, name: "Alice Smith", phone: null, isActive: 1 },
      ]),
      update: vi.fn().mockReturnThis(),
      set: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      values: vi.fn().mockResolvedValue(undefined),
    };
    vi.mocked(getDb).mockResolvedValue(mockDb as unknown as Awaited<ReturnType<typeof getDb>>);

    const { appRouter } = await import("./routers");
    const { ctx } = await createAgentContext();
    const caller = appRouter.createCaller(ctx);

    await expect(
      caller.cleaner.sendMagicLink({ cleanerProfileId: 1, origin: "https://example.com" })
    ).rejects.toThrow("no phone number");
  });

  it("throws INTERNAL_SERVER_ERROR when SMS fails", async () => {
    const mockDb = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([
        { id: 1, name: "Alice Smith", phone: "+15551234567", isActive: 1 },
      ]),
      update: vi.fn().mockReturnThis(),
      set: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      values: vi.fn().mockResolvedValue(undefined),
    };
    vi.mocked(getDb).mockResolvedValue(mockDb as unknown as Awaited<ReturnType<typeof getDb>>);
    vi.mocked(sendSms).mockResolvedValue({ success: false, error: "Network error" });

    const { appRouter } = await import("./routers");
    const { ctx } = await createAgentContext();
    const caller = appRouter.createCaller(ctx);

    await expect(
      caller.cleaner.sendMagicLink({ cleanerProfileId: 1, origin: "https://example.com" })
    ).rejects.toThrow("Failed to send SMS");
  });

  it("returns success and phone when SMS is sent", async () => {
    const mockDb = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([
        { id: 1, name: "Alice Smith", phone: "+15551234567", isActive: 1 },
      ]),
      update: vi.fn().mockReturnThis(),
      set: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      values: vi.fn().mockResolvedValue(undefined),
    };
    vi.mocked(getDb).mockResolvedValue(mockDb as unknown as Awaited<ReturnType<typeof getDb>>);
    vi.mocked(sendSms).mockResolvedValue({ success: true });

    const { appRouter } = await import("./routers");
    const { ctx } = await createAgentContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.cleaner.sendMagicLink({
      cleanerProfileId: 1,
      origin: "https://example.com",
    });

    expect(result).toEqual({ success: true, phone: "+15551234567" });
    expect(sendSms).toHaveBeenCalledOnce();
    // Verify the SMS contains the magic link URL
    const smsCall = vi.mocked(sendSms).mock.calls[0]![0];
    expect(smsCall.content).toContain("https://example.com/cleaner?magic=");
  });
});

// ── verifyMagicLink tests ─────────────────────────────────────────────────────

describe("cleaner.verifyMagicLink", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("throws UNAUTHORIZED when token does not exist", async () => {
    const mockDb = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([]),
      update: vi.fn().mockReturnThis(),
      set: vi.fn().mockReturnThis(),
    };
    vi.mocked(getDb).mockResolvedValue(mockDb as unknown as Awaited<ReturnType<typeof getDb>>);

    const { appRouter } = await import("./routers");
    const { ctx } = createPublicContext();
    const caller = appRouter.createCaller(ctx);

    await expect(
      caller.cleaner.verifyMagicLink({ token: "nonexistent-token" })
    ).rejects.toThrow("Invalid login link");
  });

  it("throws UNAUTHORIZED when token is already used", async () => {
    const mockDb = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([
        {
          id: 1,
          cleanerProfileId: 1,
          token: "used-token",
          expiresAt: new Date(Date.now() + 60000),
          used: 1,
        },
      ]),
      update: vi.fn().mockReturnThis(),
      set: vi.fn().mockReturnThis(),
    };
    vi.mocked(getDb).mockResolvedValue(mockDb as unknown as Awaited<ReturnType<typeof getDb>>);

    const { appRouter } = await import("./routers");
    const { ctx } = createPublicContext();
    const caller = appRouter.createCaller(ctx);

    await expect(
      caller.cleaner.verifyMagicLink({ token: "used-token" })
    ).rejects.toThrow("already been used");
  });

  it("throws UNAUTHORIZED when token is expired", async () => {
    const mockDb = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([
        {
          id: 1,
          cleanerProfileId: 1,
          token: "expired-token",
          expiresAt: new Date(Date.now() - 60000), // 1 minute ago
          used: 0,
        },
      ]),
      update: vi.fn().mockReturnThis(),
      set: vi.fn().mockReturnThis(),
    };
    vi.mocked(getDb).mockResolvedValue(mockDb as unknown as Awaited<ReturnType<typeof getDb>>);

    const { appRouter } = await import("./routers");
    const { ctx } = createPublicContext();
    const caller = appRouter.createCaller(ctx);

    await expect(
      caller.cleaner.verifyMagicLink({ token: "expired-token" })
    ).rejects.toThrow("expired");
  });

  it("issues session cookie and returns cleaner info on valid token", async () => {
    // First limit() call returns the token row; second returns the cleaner profile
    let callCount = 0;
    const mockDb = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve([
            {
              id: 1,
              cleanerProfileId: 42,
              token: "valid-token-abc123",
              expiresAt: new Date(Date.now() + 10 * 60 * 1000),
              used: 0,
            },
          ]);
        }
        return Promise.resolve([
          {
            id: 42,
            name: "Bob Jones",
            phone: "+15559876543",
            email: "bob@example.com",
            isActive: 1,
            passwordHash: null,
            payPercent: "50",
          },
        ]);
      }),
      update: vi.fn().mockReturnThis(),
      set: vi.fn().mockReturnThis(),
    };
    vi.mocked(getDb).mockResolvedValue(mockDb as unknown as Awaited<ReturnType<typeof getDb>>);

    const { appRouter } = await import("./routers");
    const { ctx, cookies } = createPublicContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.cleaner.verifyMagicLink({ token: "valid-token-abc123" });

    expect(result.success).toBe(true);
    expect(result.cleaner.id).toBe(42);
    expect(result.cleaner.name).toBe("Bob Jones");

    // Verify a session cookie was set with the correct name
    expect(cookies).toHaveLength(1);
    expect(cookies[0]?.name).toBe(CLEANER_COOKIE_NAME);
    expect(cookies[0]?.value).toBe("mock-session-token");
    expect(cookies[0]?.options).toMatchObject({ httpOnly: true, secure: true });

    // Verify the token was marked as used
    expect(mockDb.update).toHaveBeenCalled();
    expect(mockDb.set).toHaveBeenCalledWith({ used: 1 });
  });
});
