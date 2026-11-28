// Owner decision (2026-11-28): each team sees its OWN cleaning complaints in full (customer name, cleaning date, the
// customer's words, severity, reclean/refund status, score impact) and its areas for improvement. Fictional data only.
import { describe, expect, it } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { buildTeamWeekPublicationFromIncidents, type StoredIncident, type TeamWeekCounts } from "./teamLeaderboardHistoryMetrics";
import { restrictTeamLeaderboardPublication } from "./teamLeaderboardPublication";
import { TEAM_SCORE_METRICS } from "../shared/teamLeaderboard";
import { rankAssessedScores } from "../shared/teamLeaderboardReviewScores";
(globalThis as any).React = React;

const incident = (id: number, teamId: number, change: Partial<StoredIncident> = {}): StoredIncident => ({ id, teamId, leadflowJobId: 100 + id, category: "cleaning_quality",
  attribution: "auto", status: "open", recleanStatus: "none", refundStatus: "none", processingStatus: "ok", reportedAtMs: Date.parse("2026-11-26T15:00:00Z"),
  severity: "medium", jobDate: "2026-11-25", evidenceQuote: "the kitchen floor is still sticky", evidenceText: "Hi, the kitchen floor is still sticky after the cleaning.",
  customerName: "Maya Lane", jobCustomerName: "Maya Lane (job)", ...change });
const row = (id: string, jobs: number, ratings = jobs) => ({ id, name: `Team ${id}`, eligibleJobs: jobs,
  metrics: { ...Object.fromEntries(TEAM_SCORE_METRICS.map(({ key }) => [key, { successful: jobs, eligible: jobs, complete: true }])), ratings: { successful: ratings, eligible: jobs, complete: true },
    eta: { successful: jobs - 1, eligible: jobs, complete: true } } as never });
const counts: TeamWeekCounts = { period: { weekStart: "2026-11-22", weekEnd: "2026-11-28", weekConvention: "Sunday-start", coverageStart: "2026-11-22", coverageEnd: "2026-11-28" },
  teams: [row("1", 4, 3), row("2", 5)], complete: true, warnings: [] };
const records = [
  incident(1, 1),
  incident(2, 1, { evidenceQuote: "The cleaners arrived two hours late", evidenceText: null, customerName: "Late Customer" }), // arrival only: not counted
  incident(3, 2, { evidenceQuote: "they missed the upstairs bathroom", evidenceText: null, customerName: null, jobCustomerName: "Rosa Diaz", severity: "high",
    recleanStatus: "completed", refundStatus: "requested", jobDate: "2026-11-24" }),
];

describe("published complaints: the customer's own complaint, never a generic label", () => {
  const snapshot = buildTeamWeekPublicationFromIncidents(counts, records);
  it("each counted complaint carries the customer, date, words, severity and recovery status", () => {
    const own = snapshot.publication.ownIncidents;
    expect(own.map(i => i.summary)).toEqual(["the kitchen floor is still sticky", "they missed the upstairs bathroom"]);
    expect(own.every(i => !/Cleaning quality complaint \(/.test(i.summary))).toBe(true);
    expect(own[0].complaint).toEqual({ customerName: "Maya Lane", cleaningDate: "2026-11-25", wording: "the kitchen floor is still sticky",
      fullMessage: "Hi, the kitchen floor is still sticky after the cleaning.", severity: "medium", reclean: "none", refund: "none" });
    expect(own[1].complaint).toMatchObject({ customerName: "Rosa Diaz", cleaningDate: "2026-11-24", severity: "high", reclean: "completed", refund: "requested", fullMessage: null });
    expect(own.some(i => i.complaint?.customerName === "Late Customer")).toBe(false); // arrival complaints still excluded
  });
  it("scores are unchanged by the details (same counts as before)", () => {
    expect(snapshot.details["1"].complaintCases).toBe(1); expect(snapshot.details["2"].complaintCases).toBe(1);
    expect(snapshot.publication.teams.find(t => t.id === "1")!.metrics.complaints).toEqual({ successful: 3, eligible: 4, complete: true });
  });
  it("each team receives only its own complaints, in full; no phone numbers or emails", () => {
    const team1 = restrictTeamLeaderboardPublication(snapshot, { cleanerProfileId: 11, launch27TeamId: 101, schedulingTeamId: 1, payPercent: null } as never, 11);
    const team2 = restrictTeamLeaderboardPublication(snapshot, { cleanerProfileId: 12, launch27TeamId: 102, schedulingTeamId: 2, payPercent: null } as never, 12);
    expect(team1.publication.ownIncidents.map(i => i.complaint?.customerName)).toEqual(["Maya Lane"]);
    expect(team2.publication.ownIncidents.map(i => i.complaint?.customerName)).toEqual(["Rosa Diaz"]);
    expect(JSON.stringify(team1)).not.toMatch(/Rosa Diaz|upstairs|\+1\d{10}|@/);
  });
});

describe("team page: complaint cards and areas for improvement", async () => {
  const ui = await import("../client/src/components/TeamComplaintDetails");
  const snapshot = buildTeamWeekPublicationFromIncidents(counts, records);
  const teams = rankAssessedScores(snapshot.publication.teams, snapshot.details);
  const team1 = teams.find(t => t.id === "1")!;
  it("score impact per complaint is the published formula: 55 ÷ jobs, scaled to the available points", () => {
    expect(ui.complaintImpactPoints(team1)).toBeCloseTo(13.75, 5); // 55 / 4 jobs, all 100 points available
    expect(ui.complaintImpactPoints({ ...team1, availablePoints: 70 })).toBeCloseTo(55 / 4 * 100 / 70, 5);
  });
  it("the card shows the customer, cleaning date, their words, severity, reclean, refund and impact", () => {
    const html = renderToStaticMarkup(React.createElement(ui.ComplaintCard, { complaint: snapshot.publication.ownIncidents[0].complaint!, impact: ui.complaintImpactPoints(team1) }));
    for (const part of ["Maya Lane", "Medium severity", "Cleaning on Wed, Nov 25, 2026", "“the kitchen floor is still sticky”", "Full message:", "Hi, the kitchen floor is still sticky after the cleaning.",
      "No reclean requested", "No refund requested", "−13.75 points from your total score"]) expect(html).toContain(part);
    const other = renderToStaticMarkup(React.createElement(ui.ComplaintCard, { complaint: snapshot.publication.ownIncidents[1].complaint!, impact: null }));
    for (const part of ["Rosa Diaz", "High severity", "Reclean completed", "Refund requested (not issued yet)", "Score impact not available"]) expect(other).toContain(part);
  });
  it("areas for improvement: where points were lost, largest first, with what to do", () => {
    const areas = ui.improvementAreas(team1, 1);
    expect(areas.map(a => a.title)).toEqual(["Cleaning quality", "Five-star reviews", "ETA texts"]);
    expect(areas[0].lost).toBeCloseTo(13.75, 5); expect(areas[1].lost).toBeCloseTo(7.5, 5); expect(areas[2].lost).toBeCloseTo(2.5, 5);
    const html = renderToStaticMarkup(React.createElement(ui.AreasForImprovement, { team: team1, complaintCases: 1 }));
    expect(html).toContain("Areas for improvement"); expect(html).toContain("−13.75 points"); expect(html).toContain("Send the ETA before every job.");
    const perfect = { ...team1, score: { ...team1.score, points: { ...team1.score.points, complaints: 55, ratings: 30, eta: 10 } } };
    expect(renderToStaticMarkup(React.createElement(ui.AreasForImprovement, { team: perfect, complaintCases: 0 }))).toContain("No points lost in any category this week.");
  });
});
