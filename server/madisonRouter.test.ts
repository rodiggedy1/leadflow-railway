import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

vi.mock("./db", () => ({ getDb: vi.fn() }));

import { getDb } from "./db";
import { madisonRouter, rankMadisonSessions, type MadisonSessionRow } from "./madisonRouter";

const mockGetDb = vi.mocked(getDb);

const NOW = new Date("2025-10-09T16:00:00.000Z").getTime();

function row(overrides: Partial<MadisonSessionRow> & { id: number }): MadisonSessionRow {
  return {
    id: overrides.id,
    leadPhone: `+1202555${String(overrides.id).padStart(4, "0")}`,
    leadName: `Lead ${overrides.id}`,
    leadSource: "form",
    stage: "QUOTE_SENT",
    isBooked: 0,
    bookedAt: null,
    smsOptOut: 0,
    followUpDate: null,
    followUpSent: 0,
    messageHistory: "[]",
    serviceType: null,
    address: null,
    quotedPrice: null,
    lastInboundPhoneNumberId: null,
    csStatusTier: null,
    csPriorityTag: null,
    csPriorityReason: null,
    lastMessageText: null,
    lastMessageTs: NOW - 3 * 60 * 60 * 1000,
    lastCustomerMessageTs: null,
    lastMessageRole: "assistant",
    madisonDeferredUntil: null,
    csResolvedAt: null,
    createdAt: new Date(NOW - 10 * 24 * 60 * 60 * 1000),
    updatedAt: new Date(NOW - 3 * 60 * 60 * 1000),
    ...overrides,
  };
}

function ownerContext(): TrpcContext {
  return {
    user: { openId: "test-owner", name: "Test Owner" } as TrpcContext["user"],
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: vi.fn() } as unknown as TrpcContext["res"],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Madison canonical Waiting on Customer queue", () => {
  it("keeps assistant-last cards only and orders them newest first", () => {
    const candidates = rankMadisonSessions([
      row({ id: 1, lastMessageTs: NOW - 38 * 24 * 60 * 60 * 1000 }),
      row({ id: 2, lastMessageTs: NOW - 6 * 60 * 60 * 1000 }),
      row({ id: 3, lastMessageTs: NOW - 20 * 60 * 1000 }),
      row({ id: 4, lastMessageRole: "user", lastMessageTs: NOW - 10 * 60 * 1000, lastCustomerMessageTs: NOW - 10 * 60 * 1000 }),
    ], NOW);

    expect(candidates.map(candidate => candidate.session.id)).toEqual([3, 2, 1]);
  });

  it("uses the newest canonical conversation for a phone, so a customer reply removes an older outreach from the queue", () => {
    const candidates = rankMadisonSessions([
      row({ id: 1, leadPhone: "+1 (202) 555-0100", lastMessageTs: NOW - 4 * 60 * 60 * 1000 }),
      row({ id: 2, leadPhone: "+12025550100", lastMessageRole: "user", lastMessageTs: NOW - 10 * 60 * 1000, lastCustomerMessageTs: NOW - 10 * 60 * 1000 }),
    ], NOW);

    expect(candidates).toEqual([]);
  });

  it("includes due follow-ups and excludes future scheduled follow-ups", () => {
    const candidates = rankMadisonSessions([
      row({ id: 1, followUpDate: "2025-10-09", followUpSent: 0, lastMessageTs: NOW - 24 * 60 * 60 * 1000 }),
      row({ id: 2, followUpDate: "2025-10-10", followUpSent: 0, lastMessageTs: NOW - 10 * 60 * 1000 }),
    ], NOW);

    expect(candidates.map(candidate => candidate.session.id)).toEqual([1]);
    expect(candidates[0]?.whyNow).toContain("Scheduled follow-up is due");
  });

  it("hides a card while its existing Skip defer is active", () => {
    const candidates = rankMadisonSessions([
      row({ id: 1, madisonDeferredUntil: NOW + 10_000 }),
    ], NOW);

    expect(candidates).toEqual([]);
  });

  it("excludes a resolved current card so the next unresolved card advances into the queue", () => {
    const candidates = rankMadisonSessions([
      row({ id: 1, csResolvedAt: NOW - 1_000, lastMessageTs: NOW - 10 * 60 * 1000 }),
      row({ id: 2, csResolvedAt: null, lastMessageTs: NOW - 20 * 60 * 1000 }),
      row({ id: 3, csResolvedAt: null, lastMessageTs: NOW - 30 * 60 * 1000 }),
    ], NOW);

    expect(candidates.map(candidate => candidate.session.id)).toEqual([2, 3]);
  });

  it("defers the presented session with a direct write and no candidate-pool pre-read", async () => {
    const where = vi.fn().mockResolvedValue({ affectedRows: 1 });
    const set = vi.fn().mockReturnValue({ where });
    const update = vi.fn().mockReturnValue({ set });
    const select = vi.fn();
    mockGetDb.mockResolvedValue({ select, update } as never);

    const caller = madisonRouter.createCaller(ownerContext());
    const result = await caller.deferNextBestAction({ sessionId: 42 });

    expect(result.success).toBe(true);
    expect(result.madisonDeferredUntil).toBeGreaterThan(Date.now());
    expect(select).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalled();
    expect(set).toHaveBeenCalledWith(expect.objectContaining({ madisonDeferredUntil: expect.any(Number) }));
    expect(where).toHaveBeenCalled();
  });
});
