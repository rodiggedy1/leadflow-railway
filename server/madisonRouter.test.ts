import { describe, expect, it } from "vitest";
import { rankMadisonSessions, type MadisonSessionRow } from "./madisonRouter";

const NOW = 1_760_000_000_000;

function row(overrides: Partial<MadisonSessionRow> = {}): MadisonSessionRow {
  return {
    id: 1,
    leadPhone: "+12025550100",
    leadName: "Test Lead",
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
    createdAt: new Date(NOW - 10 * 60 * 60 * 1000),
    updatedAt: new Date(NOW - 3 * 60 * 60 * 1000),
    ...overrides,
  };
}

describe("rankMadisonSessions", () => {
  it("orders the four approved categories deterministically", () => {
    const candidates = rankMadisonSessions([
      row({ id: 1, leadPhone: "+12025550001", stage: "COLD", lastMessageRole: "assistant", lastMessageTs: NOW - 60_000 }),
      row({ id: 2, leadPhone: "+12025550002", csStatusTier: "hot_lead", lastMessageTs: NOW - 60_000 }),
      row({ id: 3, leadPhone: "+12025550003", lastMessageRole: "user", lastCustomerMessageTs: NOW - 60_000, lastMessageTs: NOW - 60_000 }),
      row({ id: 4, leadPhone: "+12025550004", lastMessageRole: "assistant", lastMessageTs: NOW - 3 * 60 * 60 * 1000 }),
    ], new Set(), NOW);

    expect(candidates.map(candidate => candidate.category)).toEqual([
      "customer_waiting",
      "urgent_high_intent",
      "follow_up_due",
      "re_engagement",
    ]);
  });

  it("uses one most-recent canonical conversation per phone", () => {
    const candidates = rankMadisonSessions([
      row({ id: 1, leadPhone: "+1 (202) 555-0100", lastMessageTs: NOW - 4 * 60 * 60 * 1000 }),
      row({ id: 2, leadPhone: "+12025550100", lastMessageRole: "user", lastMessageTs: NOW - 60_000, lastCustomerMessageTs: NOW - 60_000 }),
    ], new Set(), NOW);

    expect(candidates).toHaveLength(1);
    expect(candidates[0].session.id).toBe(2);
  });

  it("lets a customer reply override an active Madison deferral in the query", () => {
    const candidates = rankMadisonSessions([
      row({
        lastMessageRole: "user",
        lastMessageTs: NOW - 60_000,
        lastCustomerMessageTs: NOW - 60_000,
        madisonDeferredUntil: NOW + 4 * 60 * 60 * 1000,
      }),
    ], new Set(), NOW);

    expect(candidates[0]?.category).toBe("customer_waiting");
  });

  it("excludes a deferred non-user-last conversation until the four-hour Skip expires", () => {
    const candidates = rankMadisonSessions([
      row({ madisonDeferredUntil: NOW + 1 }),
    ], new Set(), NOW);

    expect(candidates).toEqual([]);
  });

  it("excludes booked, lost, resolved, opted-out, scheduled, and active-nurture conversations", () => {
    const candidates = rankMadisonSessions([
      row({ id: 1, isBooked: 1 }),
      row({ id: 2, stage: "LOST" }),
      row({ id: 3, stage: "RESOLVED" }),
      row({ id: 4, smsOptOut: 1 }),
      row({ id: 5, followUpDate: "2026-12-01", followUpSent: 0 }),
      row({ id: 6 }),
    ], new Set([6]), NOW);

    expect(candidates).toEqual([]);
  });

  it("requires the full two-hour boundary for Follow-up Due", () => {
    const beforeThreshold = rankMadisonSessions([
      row({ lastMessageTs: NOW - FOLLOW_UP_MS + 1 }),
    ], new Set(), NOW);
    const atThreshold = rankMadisonSessions([
      row({ lastMessageTs: NOW - FOLLOW_UP_MS }),
    ], new Set(), NOW);

    expect(beforeThreshold).toEqual([]);
    expect(atThreshold[0]?.category).toBe("follow_up_due");
  });
});

const FOLLOW_UP_MS = 2 * 60 * 60 * 1000;
