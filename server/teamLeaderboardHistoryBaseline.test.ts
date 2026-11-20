import { describe, expect, it } from "vitest";
import baseline from "./teamLeaderboardWeeklySnapshot.json";
import { legacyTeamSnapshotForSummary } from "./teamLeaderboardHistoryBaseline";
import { aggregateTeamPublications } from "./teamLeaderboardHistoryMetrics";
import { restrictTeamLeaderboardAdminPublication, restrictTeamLeaderboardPublication } from "./teamLeaderboardPublication";
import { rankAssessedScores } from "../shared/teamLeaderboardReviewScores";
const clone = <T>(value: T): T => structuredClone(value);

describe("verified legacy Summary identity adjunct — no I/O", () => {
  it("clones only the exact approved snapshot without changing scores, details or visible incident text", () => {
    const before = clone(baseline), result = legacyTeamSnapshotForSummary(baseline);
    expect(baseline).toEqual(before);
    expect(result.period).toEqual(baseline.period); expect(result.details).toEqual(baseline.details);
    expect(result.publication.teams).toEqual(baseline.publication.teams);
    expect(result.publication.ownIncidents.map(({ id: _id, ...incident }) => incident))
      .toEqual(baseline.publication.ownIncidents.map(({ id: _id, ...incident }) => incident));
    expect(result.publication.ownIncidents.map(incident => incident.id)).toEqual([
      "week-540077:9", "week-540053:120001", "week-360056:2", "week-540047:120001",
      "week-540169:4", "week-540175:5", "week-540155:360001", "week-540064:9",
    ]);
    expect((result as any).reviewMetadata).not.toHaveProperty("countsComplete");
  });
  it("preserves every baseline rank and total when Summary contains only the original week", () => {
    const result = aggregateTeamPublications([{ id: "legacy-2026-11-15", publishedAtMs: 0, snapshot: legacyTeamSnapshotForSummary(baseline) }]);
    const scores = (snapshot: typeof result) => rankAssessedScores(snapshot.publication.teams, snapshot.details).map(team => ({ id: team.id, rank: team.rank, total: team.totalScore }));
    expect(scores(result)).toEqual(scores(baseline));
  });
  it("deduplicates proven affected services and refund requests across different report weeks without inventing recoveries", () => {
    const original = legacyTeamSnapshotForSummary(baseline), later = clone(original);
    later.period = { ...later.period!, weekStart: "2026-11-22", weekEnd: "2026-11-28", coverageStart: "2026-11-22", coverageEnd: "2026-11-26" };
    const result = aggregateTeamPublications([{ id: "legacy-2026-11-15", publishedAtMs: 0, snapshot: original }, { id: "synthetic-later-report", publishedAtMs: 1, snapshot: later }]);
    expect(result.publication.ownIncidents).toHaveLength(8);
    for (const team of baseline.publication.teams) {
      expect(result.publication.teams.find(row => row.id === team.id)!.eligibleJobs).toBe(team.eligibleJobs * 2);
      expect(result.details[team.id]?.complaintCases).toBe(baseline.details[team.id].complaintCases);
      expect(result.details[team.id]?.refundRequests).toBe(baseline.details[team.id].refundRequests);
      expect(result.details[team.id]?.confirmedRecoveryCases).toBe(0);
    }
    expect((result as any).reviewMetadata.warnings.join(" ")).not.toContain("lacks complete stable");
  });
  it.each(["id", "teamId", "summary", "outcome"])("rejects stale alias use after a baseline incident %s change", key => {
    const altered = clone(baseline); (altered.publication.ownIncidents[0] as any)[key] = "synthetic changed";
    expect(() => legacyTeamSnapshotForSummary(altered)).toThrow("LEGACY_TEAM_HISTORY_BASELINE_CHANGED");
  });
  it("strips identity adjuncts from team and admin public projections and keeps team-own complaint privacy", () => {
    const source = legacyTeamSnapshotForSummary(baseline);
    const admin = restrictTeamLeaderboardAdminPublication(source);
    const team = restrictTeamLeaderboardPublication(source, { cleanerProfileId: 77, schedulingTeamId: 4, launch27TeamId: 222, payPercent: null }, 77);
    expect(admin).not.toHaveProperty("reviewMetadata"); expect(team).not.toHaveProperty("reviewMetadata");
    expect(admin.publication.ownIncidents).toHaveLength(8);
    expect(team.publication.ownIncidents.map(incident => incident.id)).toEqual(["week-540169:4"]);
    expect(JSON.stringify(team)).not.toContain("Legacy accepted identity aliases");
  });
});
