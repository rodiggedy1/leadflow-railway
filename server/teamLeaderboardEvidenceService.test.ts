import { describe, expect, it, vi } from "vitest";
import { createTeamEvidenceService } from "./teamLeaderboardEvidenceService";
import { resolveTeamEvidenceWindow } from "./teamLeaderboardEvidenceWindow";
import type { TeamEvidence, TeamEvidenceRead, TeamEvidenceVisitHistory, TeamComplaintCandidate } from "../shared/teamLeaderboardEvidence";

const now = new Date("2026-11-20T01:20:00Z");
const input = { weekStart: "2026-11-15" };
const evidence = (change: Partial<TeamEvidence> = {}): TeamEvidence => ({
  id: "sms:1", revision: "a".repeat(64), sourceKind: "sms", store: "conversation_sessions", sourceRowId: "1", providerId: "msg1", sessionId: "1", threadId: null,
  originalText: "The kitchen was dirty", occurredAtUtc: "2026-11-18T15:00:00Z", observedAtUtc: "2026-11-18T15:01:00Z", timeBasis: "original", bodyBasis: "original", speakerBasis: "customer",
  customerPhone: "+17035550101", customerEmail: null, customerName: "Synthetic Customer", businessLine: null, mailboxEmail: null, limitations: [], ...change,
});
const candidate: TeamComplaintCandidate = { evidenceId: "sms:1", evidenceRevision: "a".repeat(64), summary: "Kitchen complaint", category: "cleaning_quality", evidenceQuotes: ["The kitchen was dirty"], references: [] };
const read = (items = [evidence()], change: Partial<TeamEvidenceRead> = {}): TeamEvidenceRead => ({ window: resolveTeamEvidenceWindow(input, now), evidence: items, families: [], collectionComplete: true, limitations: [], ...change });
const history = (change: Partial<TeamEvidenceVisitHistory> = {}): TeamEvidenceVisitHistory => ({
  teams: [{ id: 2, name: "Synthetic Team", launch27TeamId: 200 }], assignments: [], complete: true, limitations: [],
  visits: [{ id: 1, bookingId: null, launch27BookingId: 300, publicBookingNumber: null, jobDate: "2026-11-17", serviceStartUtc: "2026-11-17T13:00:00Z",
    bookingStatus: "completed", progressStatus: "completed", customerName: "Synthetic Customer", customerPhone: "+17035550101", customerEmail: null, address: "Synthetic address",
    storedTeamId: 2, storedTeamName: "Synthetic Team", progressTeamId: 2, signoffTeamId: 2, progressUpdatedAtUtc: "2026-11-17T16:00:00Z", signoffAtUtc: "2026-11-17T15:59:00Z", jobUpdatedAtUtc: "2026-11-17T16:00:00Z", customerRating: null, etaTimestamp: null }], ...change,
});
const fixture = (sourceRead = read(), visitRead = history(), detector = vi.fn(async (_: TeamEvidence) => [candidate])) => {
  const port = { select: vi.fn(async () => []) };
  const readEvidence = vi.fn(async () => sourceRead), readHistory = vi.fn(async () => visitRead);
  const service = createTeamEvidenceService({ port, clock: () => now, readEvidence, readHistory, detect: detector });
  return { service, detector, readEvidence, readHistory, port };
};

describe("unpublished team evidence service", () => {
  it("does no work at factory time", () => {
    const f = fixture(); expect(f.readEvidence).not.toHaveBeenCalled(); expect(f.detector).not.toHaveBeenCalled(); expect(f.port.select).not.toHaveBeenCalled();
  });
  it("readWeek reads evidence/history only and can never call the detector", async () => {
    const f = fixture(); const result = await f.service.readWeek(input);
    expect(f.detector).not.toHaveBeenCalled(); expect(f.readEvidence).toHaveBeenCalledWith(f.port, input, now);
    expect(f.readHistory).toHaveBeenCalledWith(f.port, result.sources.evidence, result.sources.window);
    expect(result.status).toBe("unpublished_read"); expect(result.publication).toBeNull(); expect(result.scoreResults).toBeNull();
  });
  it("analyzes exact originals only when explicitly called", async () => {
    const f = fixture(); const result = await f.service.analyzeWeek(input);
    expect(f.detector).toHaveBeenCalledTimes(1); expect(f.detector).toHaveBeenCalledWith(evidence());
    expect(result.analysis.analyzedEvidenceIds).toEqual(["sms:1"]); expect(result.analysis.complete).toBe(true);
    expect(result.matches).toHaveLength(1); expect(result.matches[0].verified).toBe(false); expect(result.matches[0].eligibleForScore).toBe(false);
    expect(result.matches[0].status).toBe("matched"); expect(result.matches[0].team?.id).toBe(2); expect(result.visitGroups).toHaveLength(1);
    expect(result.publication).toBeNull(); expect(result.scoreResults).toBeNull(); expect(result.verifiedComplaintCount).toBeNull(); expect(result.verifiedRecleanRefundCount).toBeNull();
  });
  it("returns model failures as incomplete analysis, not zero verified complaints", async () => {
    const detector = vi.fn(async (_: TeamEvidence): Promise<TeamComplaintCandidate[]> => { throw new Error("API secret and customer text"); });
    const result = await fixture(read(), history(), detector).service.analyzeWeek(input);
    expect(result.analysis.complete).toBe(false); expect(result.analysis.failures).toEqual([{ evidenceId: "sms:1", code: "CANDIDATE_ANALYSIS_FAILED" }]);
    expect(result.verifiedComplaintCount).toBeNull(); expect(JSON.stringify(result)).not.toContain("API secret"); expect(detector).toHaveBeenCalledTimes(1);
  });
  it("rejects an injected detector's invented evidence instead of passing it into matching", async () => {
    const detector = vi.fn(async (_: TeamEvidence) => [{ ...candidate, evidenceId: "invented" }]);
    const result = await fixture(read(), history(), detector).service.analyzeWeek(input);
    expect(result.analysis.complete).toBe(false); expect(result.matches).toEqual([]); expect(result.analysis.failures).toHaveLength(1);
  });
  it("does not analyze snippets/missing source bodies and keeps coverage incomplete", async () => {
    const f = fixture(read([evidence({ bodyBasis: "snippet" })])); const result = await f.service.analyzeWeek(input);
    expect(f.detector).not.toHaveBeenCalled(); expect(result.analysis.complete).toBe(false); expect(result.analysis.notAnalyzedEvidenceIds).toEqual(["sms:1"]);
  });
  it("does not analyze known non-customer/outbound text", async () => {
    const f = fixture(read([evidence({ speakerBasis: "non_customer" })])); const result = await f.service.analyzeWeek(input);
    expect(f.detector).not.toHaveBeenCalled(); expect(result.matches).toEqual([]);
  });
  it("partial collection cannot become complete analysis", async () => {
    const result = await fixture(read([], { collectionComplete: false }), history()).service.analyzeWeek(input);
    expect(result.analysis.complete).toBe(false); expect(result.verifiedComplaintCount).toBeNull();
  });
  it("partial service/team history cannot become a complete review", async () => {
    const result = await fixture(read(), history({ complete: false })).service.analyzeWeek(input);
    expect(result.analysis.complete).toBe(false); expect(result.verifiedComplaintCount).toBeNull();
  });
  it("keeps matching results private to the service, separate from score publication", async () => {
    const result = await fixture().service.analyzeWeek(input);
    expect(result.matches.every(match => match.verified === false && match.eligibleForScore === false)).toBe(true);
    expect(result.visitGroups.every(group => group.verified === false && group.eligibleForScore === false)).toBe(true);
  });
});
