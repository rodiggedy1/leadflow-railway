/**
 * Tests for the 4 new OpsChat features:
 * 1. updateIssueNote — inline note editing on issue flags
 * 2. getDueReminders — reminder popup polling
 * 3. dismissReminder — dismiss a due reminder
 * 4. snoozeReminder — snooze a reminder by N minutes
 * 5. uploadProfilePhoto — profile photo upload (mocked S3)
 *
 * These tests use mocked DB + storage to avoid real DB connections.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

// ── Mocks ─────────────────────────────────────────────────────────────────────

// Mock getDb so we don't need a real DB connection
vi.mock("./db", () => ({
  getDb: vi.fn(),
}));

// Mock storagePut so we don't need a real S3 connection
vi.mock("./storage", () => ({
  storagePut: vi.fn().mockResolvedValue({ url: "https://cdn.example.com/profile-photos/test-123.jpg", key: "profile-photos/test-123.jpg" }),
}));

// Mock openphone sendSms to prevent real SMS
vi.mock("./openphone", () => ({
  sendSms: vi.fn().mockResolvedValue({ success: true }),
}));

import { getDb } from "./db";
import { storagePut } from "./storage";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

// ── Context helpers ────────────────────────────────────────────────────────────

function createOwnerContext(): TrpcContext {
  return {
    user: {
      id: 1,
      openId: "owner-open-id",
      email: "owner@example.com",
      name: "Owner User",
      loginMethod: "manus",
      role: "admin",
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: vi.fn() } as unknown as TrpcContext["res"],
  };
}

// ── updateIssueNote ────────────────────────────────────────────────────────────

describe("opsChat.updateIssueNote", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("updates the issue note and returns success", async () => {
    const mockUpdate = vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      }),
    });
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue({ update: mockUpdate });

    const caller = appRouter.createCaller(createOwnerContext());
    const result = await caller.opsChat.updateIssueNote({ flagId: 42, note: "Cleaner is locked out" });

    expect(result).toEqual({ success: true });
    // The opsChatProcedure middleware fires a fire-and-forget db.update(agents) heartbeat
    // on every request, so mockUpdate is called twice: once by the middleware (agents table)
    // and once by the procedure itself (the business table). Both are expected.
    expect(mockUpdate).toHaveBeenCalledTimes(2);
  });

  it("throws INTERNAL_SERVER_ERROR when DB is unavailable", async () => {
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const caller = appRouter.createCaller(createOwnerContext());
    await expect(caller.opsChat.updateIssueNote({ flagId: 1, note: "test" }))
      .rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
  });

  it("rejects note longer than 2000 characters", async () => {
    const caller = appRouter.createCaller(createOwnerContext());
    const longNote = "x".repeat(2001);
    await expect(caller.opsChat.updateIssueNote({ flagId: 1, note: longNote }))
      .rejects.toThrow();
  });
});

// ── getDueReminders ────────────────────────────────────────────────────────────

describe("opsChat.getDueReminders", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns empty array when DB is unavailable", async () => {
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const caller = appRouter.createCaller(createOwnerContext());
    const result = await caller.opsChat.getDueReminders();

    expect(result).toEqual({ reminders: [] });
  });

  it("returns due reminders for the current caller", async () => {
    const fakeReminders = [
      { id: 1, body: "Check on job 5", triggerAt: Date.now() - 1000, callerId: "owner-open-id", dismissedAt: null, snoozedUntil: null },
    ];
    const mockSelect = vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(fakeReminders),
      }),
    });
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue({ select: mockSelect });

    const caller = appRouter.createCaller(createOwnerContext());
    const result = await caller.opsChat.getDueReminders();

    expect(result.reminders).toHaveLength(1);
    expect(result.reminders[0]?.body).toBe("Check on job 5");
  });
});

// ── dismissReminder ────────────────────────────────────────────────────────────

describe("opsChat.dismissReminder", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("marks a reminder as dismissed and returns success", async () => {
    const mockUpdate = vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      }),
    });
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue({ update: mockUpdate });

    const caller = appRouter.createCaller(createOwnerContext());
    const result = await caller.opsChat.dismissReminder({ reminderId: 7 });

    expect(result).toEqual({ success: true });
    // The opsChatProcedure middleware fires a fire-and-forget db.update(agents) heartbeat
    // on every request, so mockUpdate is called twice: once by the middleware (agents table)
    // and once by the procedure itself (opsReminders table). Both are expected.
    expect(mockUpdate).toHaveBeenCalledTimes(2);
  });

  it("throws INTERNAL_SERVER_ERROR when DB is unavailable", async () => {
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const caller = appRouter.createCaller(createOwnerContext());
    await expect(caller.opsChat.dismissReminder({ reminderId: 1 }))
      .rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
  });
});

// ── snoozeReminder ────────────────────────────────────────────────────────────

describe("opsChat.snoozeReminder", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("snoozes a reminder and returns success", async () => {
    const mockUpdate = vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      }),
    });
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue({ update: mockUpdate });

    const caller = appRouter.createCaller(createOwnerContext());
    const result = await caller.opsChat.snoozeReminder({ reminderId: 3, minutes: 15 });

    expect(result).toEqual({ success: true });
    // The opsChatProcedure middleware fires a fire-and-forget db.update(agents) heartbeat
    // on every request, so mockUpdate is called twice: once by the middleware (agents table)
    // and once by the procedure itself (opsReminders table). Both are expected.
    expect(mockUpdate).toHaveBeenCalledTimes(2);
  });

  it("rejects minutes > 60", async () => {
    const caller = appRouter.createCaller(createOwnerContext());
    await expect(caller.opsChat.snoozeReminder({ reminderId: 1, minutes: 61 }))
      .rejects.toThrow();
  });

  it("rejects minutes < 1", async () => {
    const caller = appRouter.createCaller(createOwnerContext());
    await expect(caller.opsChat.snoozeReminder({ reminderId: 1, minutes: 0 }))
      .rejects.toThrow();
  });
});

// ── uploadProfilePhoto ─────────────────────────────────────────────────────────

describe("opsChat.uploadProfilePhoto", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uploads a photo and returns the CDN URL", async () => {
    const mockUpdate = vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      }),
    });
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue({ update: mockUpdate });
    (storagePut as ReturnType<typeof vi.fn>).mockResolvedValue({ url: "https://cdn.example.com/profile-photos/owner-open-id-abc.jpg", key: "profile-photos/owner-open-id-abc.jpg" });

    const caller = appRouter.createCaller(createOwnerContext());
    const result = await caller.opsChat.uploadProfilePhoto({
      base64Data: Buffer.from("fake-image-data").toString("base64"),
      mimeType: "image/jpeg",
    });

    expect(result.url).toContain("cdn.example.com");
    expect(storagePut).toHaveBeenCalledOnce();
  });

  it("throws INTERNAL_SERVER_ERROR when DB is unavailable", async () => {
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const caller = appRouter.createCaller(createOwnerContext());
    await expect(caller.opsChat.uploadProfilePhoto({
      base64Data: Buffer.from("fake").toString("base64"),
      mimeType: "image/jpeg",
    })).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
  });
});
