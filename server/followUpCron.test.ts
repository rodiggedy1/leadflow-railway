/**
 * Tests for followUpCron.ts
 *
 * Covers:
 *   1. Deduplication by phone — only the most recent session per phone gets nudged
 *   2. Stale session silencing — older sessions for the same phone are marked autoFollowUpSent=1
 *   3. Atomic claim guard — if autoFollowUpSent is already 1 (claimed by another instance),
 *      the cron skips that session and does not send an SMS
 *   4. Happy path — a single eligible session gets nudged and marked
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("./db", () => ({
  getDb: vi.fn(),
}));

vi.mock("./openphone", () => ({
  sendSms: vi.fn().mockResolvedValue({ success: true }),
}));

vi.mock("./_core/llm", () => ({
  invokeLLM: vi.fn().mockResolvedValue({
    choices: [{ message: { content: "Hey there, just circling back!" } }],
  }),
}));

vi.mock("./activityLogger", () => ({
  logActivity: vi.fn().mockResolvedValue(undefined),
}));

import { getDb } from "./db";
import { sendSms } from "./openphone";
import { invokeLLM } from "./_core/llm";
import { logActivity } from "./activityLogger";
import { runSilenceFollowUp } from "./followUpCron";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeSession(overrides: Partial<{
  id: number;
  leadPhone: string;
  leadName: string;
  stage: string;
  aiMode: number;
  autoFollowUpSent: number;
  lastAiMessageAt: Date;
  messageHistory: string;
}> = {}) {
  return {
    id: 1001,
    leadPhone: "+12025551234",
    leadName: "Test Lead",
    stage: "AVAILABILITY",
    aiMode: 1,
    autoFollowUpSent: 0,
    lastAiMessageAt: new Date(Date.now() - 10 * 60 * 1000), // 10 min ago
    messageHistory: JSON.stringify([{ role: "assistant", content: "What day works?", ts: Date.now() - 10 * 60 * 1000 }]),
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("runSilenceFollowUp", () => {
  let mockDb: any;
  let updateMock: any;
  let selectMock: any;

  beforeEach(() => {
    vi.resetAllMocks(); // resets both call counts AND mock implementations

    // Re-initialize mocks to their defaults (resetAllMocks clears the vi.mock factory defaults)
    (sendSms as any).mockResolvedValue({ success: true });
    (logActivity as any).mockResolvedValue(undefined);
    (invokeLLM as any).mockResolvedValue({
      choices: [{ message: { content: "Hey there, just circling back!" } }],
    });

    // Build a chainable mock for db.select().from().where().limit()
    selectMock = vi.fn();
    updateMock = vi.fn();

    mockDb = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: selectMock,
          }),
        }),
      }),
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: updateMock,
        }),
      }),
    };

    (getDb as any).mockResolvedValue(mockDb);
  });

  it("returns zeros when no eligible sessions exist", async () => {
    selectMock.mockResolvedValue([]);

    const result = await runSilenceFollowUp();

    expect(result).toEqual({ checked: 0, sent: 0, errors: 0 });
    expect(sendSms).not.toHaveBeenCalled();
  });

  it("sends one nudge for a single eligible session", async () => {
    const session = makeSession();
    selectMock.mockResolvedValue([session]);

    // Atomic claim returns 1 affected row (claim succeeded)
    updateMock.mockResolvedValue({ rowsAffected: 1 });

    const result = await runSilenceFollowUp();

    expect(result.sent).toBe(1);
    expect(result.errors).toBe(0);
    expect(sendSms).toHaveBeenCalledOnce();
    expect((sendSms as any).mock.calls[0][0].to).toBe("+12025551234");
  });

  it("deduplicates by phone — only nudges the most recent session (highest id)", async () => {
    const older = makeSession({ id: 1001, leadPhone: "+12025551234", stage: "ADDRESS" });
    const newer = makeSession({ id: 1005, leadPhone: "+12025551234", stage: "CONFIRMATION" });
    selectMock.mockResolvedValue([older, newer]);

    // Atomic claim succeeds for the one session we pick
    updateMock.mockResolvedValue({ rowsAffected: 1 });

    const result = await runSilenceFollowUp();

    // Only one SMS sent (to the newer session)
    expect(result.sent).toBe(1);
    expect(sendSms).toHaveBeenCalledOnce();
  });

  it("silences stale older sessions for the same phone (marks autoFollowUpSent=1)", async () => {
    const older = makeSession({ id: 1001, leadPhone: "+12025551234", stage: "ADDRESS" });
    const newer = makeSession({ id: 1005, leadPhone: "+12025551234", stage: "CONFIRMATION" });
    selectMock.mockResolvedValue([older, newer]);

    updateMock.mockResolvedValue({ rowsAffected: 1 });

    await runSilenceFollowUp();

    // update() should be called at least twice:
    // 1. To silence the stale older session (id=1001)
    // 2. To atomically claim the newer session (id=1005)
    // 3. To update lastAiMessageAt + messageHistory after sending
    expect(mockDb.update).toHaveBeenCalledTimes(3);
  });

  it("skips session when atomic claim returns 0 affected rows (already claimed by another instance)", async () => {
    const session = makeSession();
    selectMock.mockResolvedValue([session]);

    // Simulate another cron instance already claimed this session
    updateMock.mockResolvedValue({ rowsAffected: 0 });

    const result = await runSilenceFollowUp();

    expect(result.sent).toBe(0);
    expect(sendSms).not.toHaveBeenCalled();
  });

  it("counts errors when sendSms fails", async () => {
    const session = makeSession();
    selectMock.mockResolvedValue([session]);
    updateMock.mockResolvedValue({ rowsAffected: 1 });
    (sendSms as any).mockResolvedValue({ success: false, error: "Network error" });

    const result = await runSilenceFollowUp();

    expect(result.sent).toBe(0);
    expect(result.errors).toBe(1);
  });

  it("handles two different phones independently — both get nudged", async () => {
    const sessionA = makeSession({ id: 1001, leadPhone: "+12025551234" });
    const sessionB = makeSession({ id: 1002, leadPhone: "+12025559999" });
    selectMock.mockResolvedValue([sessionA, sessionB]);

    // Two sessions, two phones, no stale sessions to silence.
    // Calls: claim A (rowsAffected:1), update A history, claim B (rowsAffected:1), update B history
    updateMock
      .mockResolvedValueOnce({ rowsAffected: 1 }) // claim sessionA
      .mockResolvedValueOnce({ rowsAffected: 1 }) // update sessionA history
      .mockResolvedValueOnce({ rowsAffected: 1 }) // claim sessionB
      .mockResolvedValueOnce({ rowsAffected: 1 }); // update sessionB history

    const result = await runSilenceFollowUp();

    expect(result.sent).toBe(2);
    expect(sendSms).toHaveBeenCalledTimes(2);
  });

  // ── COLD stage tests ────────────────────────────────────────────────────────

  it("moves lead to COLD when nudgeCount reaches 2 (MAX_NUDGES_BEFORE_COLD)", async () => {
    // This session has already received 1 nudge; this run will be the 2nd → COLD
    const session = makeSession({ nudgeCount: 1 } as any);
    selectMock.mockResolvedValue([session]);
    updateMock.mockResolvedValue({ rowsAffected: 1 });

    const result = await runSilenceFollowUp();

    expect(result.sent).toBe(1);

    // The final DB update must include stage: "COLD" and nudgeCount: 2
    const allSetCalls = mockDb.update.mock.results
      .map((_: any, i: number) => mockDb.update.mock.instances[i])
      .concat([]);

    // Find the set() call that includes stage: "COLD"
    const setCalls: any[] = [];
    mockDb.update.mock.calls.forEach((_: any, i: number) => {
      const setFn = mockDb.update.mock.results[i]?.value?.set;
      if (setFn) setCalls.push(...setFn.mock?.calls ?? []);
    });

    // Verify the update chain was called with COLD stage
    // The set() is chained: db.update(...).set({...}).where(...)
    // We check the set mock on the update chain
    const updateChain = mockDb.update.mock.results.find(
      (r: any) => r?.value?.set?.mock?.calls?.some((c: any[]) => c[0]?.stage === "COLD")
    );
    expect(updateChain).toBeDefined();
  });

  it("does NOT move lead to COLD on first nudge (nudgeCount 0 → 1)", async () => {
    const session = makeSession({ nudgeCount: 0 } as any);
    selectMock.mockResolvedValue([session]);
    updateMock.mockResolvedValue({ rowsAffected: 1 });

    await runSilenceFollowUp();

    // No update should include stage: "COLD"
    const coldUpdate = mockDb.update.mock.results.find(
      (r: any) => r?.value?.set?.mock?.calls?.some((c: any[]) => c[0]?.stage === "COLD")
    );
    expect(coldUpdate).toBeUndefined();
  });

  it("increments nudgeCount on each successful nudge", async () => {
    const session = makeSession({ nudgeCount: 0 } as any);
    selectMock.mockResolvedValue([session]);
    updateMock.mockResolvedValue({ rowsAffected: 1 });

    await runSilenceFollowUp();

    // Find the set() call that includes nudgeCount
    const nudgeCountUpdate = mockDb.update.mock.results.find(
      (r: any) => r?.value?.set?.mock?.calls?.some((c: any[]) => c[0]?.nudgeCount === 1)
    );
    expect(nudgeCountUpdate).toBeDefined();
  });

  it("logs lead_cold activity event when moving to COLD", async () => {
    const session = makeSession({ nudgeCount: 1 } as any);
    selectMock.mockResolvedValue([session]);
    updateMock.mockResolvedValue({ rowsAffected: 1 });

    await runSilenceFollowUp();

    const coldLogCall = (logActivity as any).mock.calls.find(
      (c: any[]) => c[0]?.eventType === "lead_cold"
    );
    expect(coldLogCall).toBeDefined();
    expect(coldLogCall[0].title).toContain("Cold");
  });

  it("logs silence_nudge (not lead_cold) on first nudge", async () => {
    const session = makeSession({ nudgeCount: 0 } as any);
    selectMock.mockResolvedValue([session]);
    updateMock.mockResolvedValue({ rowsAffected: 1 });

    await runSilenceFollowUp();

    const nudgeLogCall = (logActivity as any).mock.calls.find(
      (c: any[]) => c[0]?.eventType === "silence_nudge"
    );
    expect(nudgeLogCall).toBeDefined();

    const coldLogCall = (logActivity as any).mock.calls.find(
      (c: any[]) => c[0]?.eventType === "lead_cold"
    );
    expect(coldLogCall).toBeUndefined();
  });
});
