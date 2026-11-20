import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TeamLeaderboardView } from "../client/src/components/TeamLeaderboardView";
import { restrictTeamLeaderboardAdminPublication, restrictTeamLeaderboardPublication } from "./teamLeaderboardPublication";
import type { TeamLeaderboardSnapshot } from "./teamLeaderboardPublication";
import { rankAssessedScores } from "../shared/teamLeaderboardReviewScores";

const state = vi.hoisted(() => ({ expanded: "10000", index: 0 }));
vi.mock("react", async original => {
  const actual = await original<typeof import("react")>();
  return { ...actual, useState: (initial: unknown) => [state.index++ === 0 ? "standings" : state.expanded ?? initial, vi.fn()] };
});
const snapshot: TeamLeaderboardSnapshot = {
  publication: {
    weekLabel: "Synthetic reviewed week", nextWeekLabel: "Synthetic next week", publishedLabel: "Reviewed",
    teams: ["10000", "20000"].map(id => ({ id, name: `Synthetic team ${id}`, eligibleJobs: 2,
      metrics: { ratings: { successful: 1, eligible: 1, complete: true }, complaints: { successful: 1, eligible: 2, complete: true }, recovery: { successful: 2, eligible: 2, complete: true }, eta: { successful: 2, eligible: 2, complete: true }, photos: { successful: 2, eligible: 2, complete: true } } })),
    ownIncidents: ["10000", "20000"].map(id => ({ id: `incident-${id}`, teamId: id, date: "2026-11-19", summary: `CUSTOMER COMPLAINT ${id}`, outcome: `REVIEWED DETAIL ${id}`, sourceLabel: "Reviewed SMS" })),
  },
  details: {},
};
beforeEach(() => { state.index = 0; });
function render(publication: TeamLeaderboardSnapshot["publication"], ownTeamId: string | null, admin: boolean) {
  return renderToStaticMarkup(React.createElement(TeamLeaderboardView, {
    publication, ownTeamId, details: snapshot.details,
    ...(admin ? { teamActions: (id: string) => React.createElement("button", { type: "button" }, `Copy existing link ${id}`) } : {}),
  }));
}

describe("admin complaints in the existing leaderboard row expansion", () => {
  it.each(["10000", "20000"])("shows reviewed customer complaint details for admin-expanded team %s", id => {
    state.expanded = id;
    const admin = restrictTeamLeaderboardAdminPublication(snapshot);
    expect(admin.publication.ownIncidents).toEqual(snapshot.publication.ownIncidents);
    const html = render(admin.publication, null, true);
    expect(html).toContain(`CUSTOMER COMPLAINT ${id}`);
    expect(html).toContain(`REVIEWED DETAIL ${id}`);
    expect(html).toContain("2026-11-19");
    expect(html).toContain("Reviewed SMS");
    expect(html).not.toContain(`CUSTOMER COMPLAINT ${id === "10000" ? "20000" : "10000"}`);
    expect(html).toContain("Copy existing link 10000");
    expect(html).toContain("Copy existing link 20000");
  });
  it.each(["10000", "20000"])("does not expose another team's complaints to signed-in team %s", id => {
    const team = restrictTeamLeaderboardPublication(snapshot, { cleanerProfileId: 77, launch27TeamId: 222, schedulingTeamId: Number(id), payPercent: null }, 77);
    const other = id === "10000" ? "20000" : "10000";
    for (const expanded of [id, other]) {
      state.index = 0; state.expanded = expanded;
      const html = render(team.publication, id, false);
      expect(html).not.toContain(`CUSTOMER COMPLAINT ${other}`);
      expect(html).not.toContain(`REVIEWED DETAIL ${other}`);
      expect(html).not.toContain("Copy existing link");
      if (expanded === id) expect(html).toContain(`CUSTOMER COMPLAINT ${id}`);
    }
  });
  it("preserves standings, metric inputs and scored order when exposing admin complaints", () => {
    const before = structuredClone(snapshot);
    const admin = restrictTeamLeaderboardAdminPublication(snapshot);
    expect(rankAssessedScores(admin.publication.teams, admin.details)).toEqual(rankAssessedScores(snapshot.publication.teams, snapshot.details));
    expect(snapshot).toEqual(before);
  });
});
