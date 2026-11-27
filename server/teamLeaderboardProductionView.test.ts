import { beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { TeamLeaderboardView } from "../client/src/components/TeamLeaderboardView";
import { TEAM_SCORE_METRICS, type TeamLeaderboardPublication, type TeamLeaderboardRow } from "../shared/teamLeaderboard";
import type { TeamLeaderboardDetails } from "../shared/teamLeaderboardPublication";
import { rankAssessedScores } from "../shared/teamLeaderboardReviewScores";

// Select the approved component's existing hook states for SSR, without adding UI controls.
const state = vi.hoisted(() => ({ values: [] as unknown[], index: 0 }));
vi.mock("react", async importOriginal => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useState: (initial: unknown) => [state.values[state.index++] ?? initial, vi.fn()],
  };
});

const row = (id = "own", name = `Synthetic ${id}`): TeamLeaderboardRow => ({
  id, name, eligibleJobs: 20,
  metrics: {
    ratings: { successful: 8, eligible: 10, complete: true },
    complaints: { successful: 0, eligible: 20, complete: false },
    recovery: { successful: 0, eligible: 20, complete: false },
    eta: { successful: 18, eligible: 20, complete: true },
    photos: { successful: 19, eligible: 20, complete: true },
  },
});
const detail = (): TeamLeaderboardDetails[string] => ({
  complaintCases: 1,
  refundRequests: 2,
  confirmedRecoveryCases: 0,
  metricNotes: { ratings: "Synthetic ratings", complaints: "Synthetic complaint count", recovery: "Requests are not outcomes", eta: "ETA submissions", photos: "Photo submissions" },
  metricDisplay: {
    ratings: { value: "8 / 10", unit: "five-star ratings received", note: "Synthetic ratings" },
    complaints: { value: "1", unit: "affected jobs", note: "Synthetic complaint count" },
    recovery: { value: "0", unit: "recorded recleans/refunds", note: "Requests are not outcomes" },
    eta: { value: "18 / 20", unit: "jobs with an ETA submitted", note: "ETA submissions" },
    photos: { value: "19 / 20", unit: "jobs with photos submitted", note: "Photo submissions" },
  },
});
const publication = (teams = [row()]): TeamLeaderboardPublication => ({
  weekLabel: "November 15–21, 2026", nextWeekLabel: "November 22–28, 2026", publishedLabel: "Reviewed results",
  teams, ownIncidents: [],
});
function render(p: TeamLeaderboardPublication | null, details: TeamLeaderboardDetails = {}, tab = "standings", expanded: string | null = null, ownTeamId: string | null = "own") {
  state.values = [tab, expanded];
  state.index = 0;
  return renderToStaticMarkup(React.createElement(TeamLeaderboardView, { publication: p, ownTeamId, details }));
}

beforeEach(() => { state.values = []; state.index = 0; });

describe("approved weekly production view — synthetic SSR only", () => {
  it("shows supplied complaint/recovery/ETA/photo counts, category points and the un-reweighted category sum", () => {
    const p = publication();
    const details = { own: detail() };
    expect(TEAM_SCORE_METRICS.map(metric => metric.weight)).toEqual([30, 25, 20, 15, 10]);
    expect(rankAssessedScores(p.teams, details)[0]).toMatchObject({
      score: { points: { ratings: 24, complaints: 23.75, recovery: 20, eta: 13.5, photos: 9.5 } },
      totalScore: 90.75, availablePoints: 100, confirmedRecoveryCases: 0, rank: 1,
    });
    const html = render(p, details);
    expect(html).toContain('<div class="tl-score-line"><strong>90.75</strong>');
    expect(html).toContain("Out of 100 · based on 100 available points");
    expect(html).toMatch(/data-summary="complaints"[\s\S]*?<strong>1<\/strong><small>23\.75 \/ 25 pts<\/small>/);
    expect(html).toMatch(/data-summary="recovery"[\s\S]*?<strong>0<\/strong><small>20 \/ 20 pts<\/small>/);
    expect(html).toMatch(/data-summary="eta"[\s\S]*?<strong>18 \/ 20<\/strong><small>13\.5 \/ 15 pts<\/small>/);
    expect(html).toMatch(/data-summary="photos"[\s\S]*?<strong>19 \/ 20<\/strong><small>9\.5 \/ 10 pts<\/small>/);
    expect(html).toContain("2 refund request · not a completed refund");
    expect(html).toContain("20 recorded jobs · 1 reviewed complaints");
  });

  it("shows all five approved category breakdowns on the own-results tab", () => {
    const html = render(publication(), { own: detail() }, "own");
    expect((html.match(/class="tl-metric"/g) ?? []).length).toBe(5);
    expect(Array.from(html.matchAll(/class="tl-category-points "><strong>([^<]*)<\/strong>/g)).map(match => match[1])).toEqual(["24", "23.75", "20", "13.5", "9.5"]);
    expect(Array.from(html.matchAll(/class="tl-metric-value ">([^<]*)<\/strong>/g)).map(match => match[1])).toEqual(["8 / 10", "1", "0", "18 / 20", "19 / 20"]);
    expect(html).toContain("25 × (20 jobs − 1 affected jobs) ÷ 20.");
    expect(html).toContain("2 refund request — not a completed refund.");
  });

  it("keeps another team's public category and submission breakdown visible without their customer incident", () => {
    const p = publication([row(), row("other")]);
    const details = { own: detail(), other: detail() };
    const syntheticIncidents = [
      { id: "own-feedback", teamId: "own", date: "2026-11-18", summary: "OWN SYNTHETIC FEEDBACK", outcome: "OWN REVIEWED OUTCOME", sourceLabel: "SMS" },
      { id: "other-feedback", teamId: "other", date: "2026-11-19", summary: "OTHER PRIVATE CUSTOMER FEEDBACK", outcome: "OTHER PRIVATE REVIEWED OUTCOME", sourceLabel: "Email" },
    ];
    // This mirrors the server contract: only trusted own-team incidents reach the view.
    p.ownIncidents = syntheticIncidents.filter(incident => incident.teamId === "own");
    const otherExpanded = render(p, details, "standings", "other");
    expect(otherExpanded).toContain("Synthetic other");
    expect(otherExpanded).toContain("20 recorded jobs · 1 reviewed complaints");
    expect(otherExpanded).toContain('<strong class="tl-metric-value ">18 / 20</strong>');
    expect(otherExpanded).toContain('<strong class="tl-metric-value ">19 / 20</strong>');
    expect(otherExpanded).toContain('<div class="tl-category-points "><strong>23.75</strong>');
    expect(otherExpanded).toContain('<div class="tl-inline-feedback"></div>');
    const ownExpanded = render(p, details, "standings", "own");
    expect(ownExpanded).toContain("OWN REVIEWED OUTCOME");
    const ownResults = render(p, details, "own");
    expect(ownResults).toContain("OWN SYNTHETIC FEEDBACK");
    expect(ownResults).toContain("OWN REVIEWED OUTCOME");
    for (const html of [otherExpanded, ownExpanded, ownResults]) {
      expect(html).not.toContain("OTHER PRIVATE CUSTOMER FEEDBACK");
      expect(html).not.toContain("OTHER PRIVATE REVIEWED OUTCOME");
    }
  });

  it("leaves unavailable ratings N/A and scores the 70 available points out of 100", () => {
    const team = row();
    team.metrics.ratings = { successful: 0, eligible: 0, complete: true };
    const details = { own: detail() };
    details.own.metricDisplay.ratings = { value: "Not available", unit: "No ratings received", note: "No received ratings" };
    // Same category points (66.75 of the 70 that apply); the total is 66.75 / 70 = 95.36 out of 100.
    expect(rankAssessedScores([team], details)[0]).toMatchObject({ score: { points: { ratings: null } }, totalScore: 95.36, availablePoints: 70, rank: 1 });
    const html = render(publication([team]), details, "own");
    expect(html).toContain('<div class="tl-score-line"><strong>95.36</strong>');
    expect(html).toContain("Out of 100 · based on 70 available points");
    expect(html).toContain('<div class="tl-category-points tl-points-pending"><strong>N/A</strong>');
    expect(html).toContain('<strong class="tl-metric-value tl-value-missing">Not available</strong>');
  });

  it("renders sequential 1, 2, 3 ranks even for equal totals and keeps zero-job teams unranked", () => {
    const a = row("a", "Synthetic Alpha"), b = row("b", "Synthetic Beta"), c = row("c", "Synthetic Gamma"), zero = row("zero", "Synthetic Zero");
    c.metrics.ratings.successful = 9;
    zero.eligibleJobs = 0;
    const details = { a: detail(), b: detail(), c: detail(), zero: detail() };
    const p = publication([zero, b, a, c]);
    expect(rankAssessedScores(p.teams, details).map(team => [team.id, team.rank])).toEqual([["c", 1], ["a", 2], ["b", 3], ["zero", null]]);
    const html = render(p, details, "standings", null, "a");
    expect(Array.from(html.matchAll(/<span class="tl-rank[^"]*">([^<]*)<\/span>/g)).map(match => match[1])).toEqual(["1", "2", "3", "—"]);
    const standings = html.slice(html.indexOf('<div class="tl-team-list">'));
    expect(standings.indexOf("Synthetic Gamma")).toBeLessThan(standings.indexOf("Synthetic Alpha"));
    expect(standings.indexOf("Synthetic Alpha")).toBeLessThan(standings.indexOf("Synthetic Beta"));
    expect(html).not.toContain('aria-label="Rank 1"');
  });

  it("preserves the old null-publication state when details are omitted and does not show preview controls by default", () => {
    const html = renderToStaticMarkup(React.createElement(TeamLeaderboardView, { publication: null, ownTeamId: null }));
    expect(html).toContain("No leaderboard has been published here yet");
    expect(html).not.toContain("tl-team-row");
    expect(html).not.toContain("Sample results");
    expect(html).not.toContain("<select");
  });

  it("keeps approved frozen period labels and removes only test-review wording", () => {
    const html = render(publication(), { own: detail() }, "rules");
    expect(html).toContain("Week-to-date");
    expect(html).toContain("November 15–19 results so far");
    expect(html).toContain("Sunday–Thursday · through November 19");
    expect(html).toContain("These results cover communications reviewed November 15–19");
    expect(html).toContain("this reviewed period");
    expect(html).not.toContain("Week test");
    expect(html).not.toContain("this test review");
  });

  it("imports only the approved scorer, public types, UI dependencies and local CSS; no real fixtures or client data", () => {
    const source = readFileSync(new URL("../client/src/components/TeamLeaderboardView.tsx", import.meta.url), "utf8");
    const imports = Array.from(source.matchAll(/^import\s+.*?(?:from\s+)?["']([^"']+)["'];/gm)).map(match => match[1]);
    expect(imports).toEqual(["@shared/teamLeaderboardReviewScores", "@shared/teamLeaderboardPublication", "react", "lucide-react", "@shared/teamLeaderboard", "./team-leaderboard.css"]);
    expect(source).toContain('import type { TeamLeaderboardDetails } from "@shared/teamLeaderboardPublication";');
    expect(source).toContain("rankAssessedScores(publication?.teams ?? [], details)");
    expect(source).not.toMatch(/day-data|dayDetails|dayPublication|fixtures|client-data|rankTeamScores/);
    expect(source).not.toMatch(/\bfetch\s*\(|\bimport\s*\(/);
    expect(source).not.toContain("<select");
  });

  it("keeps the approved stylesheet byte-exact", () => {
    const css = readFileSync(new URL("../client/src/components/team-leaderboard.css", import.meta.url));
    expect(createHash("sha256").update(css).digest("hex")).toBe("0f062b30d0b92faa0d1235df4c90b02a2bad87e4bfc10a0fc7d62d56bcfe85dd");
  });
});
