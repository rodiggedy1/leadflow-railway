import { describe, expect, it } from "vitest";
import { rankMadisonSessions, type MadisonSessionRow } from "./madisonRouter";

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

  it("excludes a resolved assistant-last conversation while keeping an unresolved card", () => {
    const candidates = rankMadisonSessions([
      row({ id: 1, csResolvedAt: NOW - 1_000 }),
      row({ id: 2, csResolvedAt: null }),
    ], NOW);

    expect(candidates.map(candidate => candidate.session.id)).toEqual([2]);
  });
});
