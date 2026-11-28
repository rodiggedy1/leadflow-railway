// Owner rule (2026-11-28): only the quality of the cleaning counts; arrival and scheduling issues never do.
// Applied when scores are calculated, to saved records as they are. Synthetic texts only.
import { describe, expect, it } from "vitest";
import { countsAgainstTeam, isArrivalOrSchedulingOnly, qualityExclusionReason, isCompletedRecovery } from "../shared/teamQualityIncidents";
import { buildTeamWeekPublicationFromIncidents, type StoredIncident, type TeamWeekCounts } from "./teamLeaderboardHistoryMetrics";
import { TEAM_SCORE_METRICS } from "../shared/teamLeaderboard";

const incident = (id: number, evidenceQuote: string | null, change: Partial<StoredIncident> = {}): StoredIncident => ({ id, teamId: 1, leadflowJobId: 100 + id,
  category: "cleaning_quality", attribution: "auto", status: "open", recleanStatus: "none", refundStatus: "none", processingStatus: "ok",
  reportedAtMs: Date.parse("2026-11-24T15:00:00Z"), severity: "medium", jobDate: "2026-11-23", evidenceQuote, evidenceText: null, ...change });

describe("what counts as a quality incident", () => {
  it.each([
    ["The kitchen floor is still sticky after the cleaning"],
    ["They missed the upstairs bathroom completely"],
    ["The cleaning was not done properly, dust everywhere"],
    ["They broke a vase while cleaning"],
    ["The cleaners were late and they also missed the bathroom"], // late, but it is about the cleaning too
    ["Please send someone to reclean the oven"],
  ])("counts: %s", text => {
    expect(isArrivalOrSchedulingOnly(text)).toBe(false);
    expect(countsAgainstTeam(incident(1, text))).toBe(true);
  });
  it.each([
    ["The cleaners arrived two hours late"],
    ["They came outside my arrival window"],
    ["Is anyone coming today? Nobody is here yet"],
    ["Where are my cleaners?"],
    ["Hello, are the cleaners on their way?"],
    ["They missed my appointment this morning"],
    ["I need to reschedule, the delay ruined my day"],
    ["No-show again, I want a refund"],
    ["Still waiting for the team"],
  ])("does not count (arrival or scheduling): %s", text => {
    expect(isArrivalOrSchedulingOnly(text)).toBe(true);
    const saved = incident(1, text, { refundStatus: "requested" });
    expect(countsAgainstTeam(saved)).toBe(false);
    expect(qualityExclusionReason(saved)).toBe("arrival or scheduling issue, not cleaning quality");
    expect(isCompletedRecovery({ ...saved, refundStatus: "issued" })).toBe(false); // a refund for lateness never counts
  });
  it("reads the AI's summary too, not only the quoted words", () => {
    expect(countsAgainstTeam(incident(1, "Hi, any update?", { evidenceText: "Customer says the cleaners arrived late, outside the window." }))).toBe(false);
    expect(countsAgainstTeam(incident(1, "Hi, any update?", { evidenceText: "Customer reports the kitchen floor was left dirty." }))).toBe(true);
  });
  it("team service (lateness, no-show, conduct) and office, billing and scheduling categories never count", () => {
    for (const category of ["team_service", "office_service", "pricing_billing", "scheduling", "other", "unclassified"])
      expect(countsAgainstTeam(incident(1, "The kitchen was dirty", { category }))).toBe(false);
    expect(qualityExclusionReason(incident(1, "x", { category: "team_service" }))).toBe("not about the cleaning (arrival, timing or conduct)");
  });
  it("records are kept: the week's scores simply leave out the excluded ones (no record is changed)", () => {
    const records = [incident(1, "The kitchen floor is still sticky"), incident(2, "The cleaners arrived two hours late"), incident(3, "Is anyone coming today?", { category: "team_service" })];
    const before = structuredClone(records);
    const row = { id: "1", name: "Team", eligibleJobs: 10, metrics: Object.fromEntries(TEAM_SCORE_METRICS.map(({ key }) => [key, { successful: 10, eligible: 10, complete: true }])) as never };
    const counts: TeamWeekCounts = { period: { weekStart: "2026-11-22", weekEnd: "2026-11-28", weekConvention: "Sunday-start", coverageStart: "2026-11-22", coverageEnd: "2026-11-28" }, teams: [row], complete: true, warnings: [] };
    const snapshot = buildTeamWeekPublicationFromIncidents(counts, records);
    expect(snapshot.details["1"].complaintCases).toBe(1);
    expect(snapshot.publication.teams[0].metrics.complaints).toEqual({ successful: 9, eligible: 10, complete: true });
    expect(records).toEqual(before);
  });
});
