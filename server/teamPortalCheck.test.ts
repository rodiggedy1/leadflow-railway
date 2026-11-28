// Team-page consistency check: admin page (live) vs published results vs each team's own page vs the last text.
// Offline, fictional teams. Read-only by design.
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { checkTeamPortals, smsFigures, type PortalCheckDeps } from "./teamPortalCheck";
import { buildTeamWeekPublicationFromIncidents, type StoredIncident, type TeamWeekCounts } from "./teamLeaderboardHistoryMetrics";
import { TEAM_SCORE_METRICS } from "../shared/teamLeaderboard";
import { buildTeamReportMessage } from "../shared/teamWeeklyReport";

const row = (id: string, jobs: number) => ({ id, name: `Team ${id}`, eligibleJobs: jobs,
  metrics: Object.fromEntries(TEAM_SCORE_METRICS.map(({ key }) => [key, { successful: jobs, eligible: jobs, complete: true }])) as never });
const counts: TeamWeekCounts = { period: { weekStart: "2026-11-22", weekEnd: "2026-11-28", weekConvention: "Sunday-start", coverageStart: "2026-11-22", coverageEnd: "2026-11-28" },
  teams: [row("1", 9), row("2", 6), row("3", 4)], complete: true, warnings: [] };
const incident = (id: number, teamId: number, name: string, words: string): StoredIncident => ({ id, teamId, leadflowJobId: 100 + id, category: "cleaning_quality", attribution: "auto",
  status: "open", recleanStatus: "none", refundStatus: "none", processingStatus: "ok", reportedAtMs: Date.parse("2026-11-26T15:00:00Z"), severity: "medium", jobDate: "2026-11-25",
  evidenceQuote: words, evidenceText: null, customerName: name });
const consuelo = [incident(1, 1, "Maya Lane", "the kitchen floor is still sticky"), incident(2, 1, "Rosa Diaz", "they skipped the upstairs bathroom")];
const live = buildTeamWeekPublicationFromIncidents(counts, consuelo);
const stale = buildTeamWeekPublicationFromIncidents(counts, []); // published before the complaints were counted
const portalTeam = (id: number) => ({ cleanerProfileId: 10 + id, launch27TeamId: 100 + id, schedulingTeamId: id, payPercent: null });
function deps(published: typeof live | null, change: Partial<PortalCheckDeps> = {}): PortalCheckDeps {
  return {
    live: vi.fn(async () => ({ snapshot: live as never })),
    published: vi.fn(async () => published ? { snapshot: published as never, publishedAtMs: 1_700_000_000_000 } : null),
    teamAccounts: vi.fn(async ids => Object.fromEntries(ids.map(id => [id, { cleanerProfileId: 10 + Number(id) }]))),
    portalTeam: vi.fn(async profileId => portalTeam(profileId - 10)),
    lastSentReports: vi.fn(async () => []),
    ...change,
  };
}

describe("team pages vs the admin page", () => {
  it("stale publication (the reported case): flags the team whose complaints are missing from its page", async () => {
    const check = await checkTeamPortals(deps(stale), "2026-11-22");
    const team1 = check.teams.find(t => t.teamId === "1")!;
    expect(check.upToDate).toBe(false);
    expect(team1.live.complaints).toBe(2); expect(team1.published!.complaints).toBe(0); expect(team1.portal!.complaints).toBe(0);
    expect(team1.issues).toContain("Published complaints (0) differ from the current complaints (2).");
    expect(team1.issues.some(i => i.startsWith("Published ranking/score"))).toBe(true);
  });
  it("after publishing the latest results: every team agrees (rank, score, complaints, full complaint details)", async () => {
    const check = await checkTeamPortals(deps(live), "2026-11-22");
    expect(check.upToDate).toBe(true);
    const team1 = check.teams.find(t => t.teamId === "1")!;
    expect(team1.portal).toMatchObject({ ownTeam: true, complaints: 2, detailed: 2, customers: ["Maya Lane", "Rosa Diaz"] });
    expect(team1.portal!.rank).toBe(team1.live.rank); expect(team1.portal!.score).toBe(team1.live.score);
    for (const team of check.teams) expect(team.issues).toEqual([]);
  });
  it("not published: says so for every team", async () => {
    const check = await checkTeamPortals(deps(null), "2026-11-22");
    expect(check.publishedAtMs).toBeNull(); expect(check.teams.every(t => t.issues[0] === "This week has not been published, so the team page has no results for it.")).toBe(true);
  });
  it("a login that opens a different team record is flagged (its page could never show this team's complaints)", async () => {
    const check = await checkTeamPortals(deps(live, { portalTeam: vi.fn(async profileId => profileId === 11 ? portalTeam(3) : portalTeam(profileId - 10)) }), "2026-11-22");
    expect(check.teams.find(t => t.teamId === "1")!.issues).toEqual(["The team's login opens a different team record (3), so its page cannot show this team's results."]);
  });
  it("complaints published before full details existed are flagged so they can be published again", async () => {
    const old = structuredClone(live); old.publication.ownIncidents = old.publication.ownIncidents.map(({ complaint: _c, ...rest }) => rest);
    expect((await checkTeamPortals(deps(old), "2026-11-22")).teams.find(t => t.teamId === "1")!.issues)
      .toEqual(["Some published complaints were published before full complaint details existed; publish again to show them."]);
  });
  it("a text sent with older numbers is noted (never resent), separately from team-page problems", async () => {
    const text = buildTeamReportMessage({ teamName: "Team 1", weekStart: "2026-11-22", weekEnd: "2026-11-28", rank: 1, rankedTeams: 3, score: 100, completedJobs: 9,
      ratings: { successful: 9, eligible: 9 }, eta: { successful: 9, eligible: 9 }, photos: { successful: 9, eligible: 9 }, complaintCount: 0, link: "https://x.test/l", provisional: false }, "en");
    expect(smsFigures(text)).toEqual({ rank: 1, score: "100", complaints: 0 });
    const check = await checkTeamPortals(deps(live, { lastSentReports: vi.fn(async () => [{ teamId: 1, messageText: text, sentAtMs: 1 }]) }), "2026-11-22");
    const team1 = check.teams.find(t => t.teamId === "1")!;
    expect(team1.issues).toEqual([]); expect(check.upToDate).toBe(true);
    expect(team1.smsNote).toMatch(/^The last SMS \(#1, 100, 0 complaints\) differs from the published results; the text is not resent automatically\.$/);
    expect(smsFigures(buildTeamReportMessage({ teamName: "E", weekStart: "2026-11-22", weekEnd: "2026-11-28", rank: null, rankedTeams: 3, score: 86.67, completedJobs: 9,
      ratings: { successful: 1, eligible: 2 }, eta: { successful: 9, eligible: 9 }, photos: { successful: 9, eligible: 9 }, complaintCount: 2, link: "https://x.test/l", provisional: true }, "es")))
      .toEqual({ rank: null, score: "86.67", complaints: 2 });
  });
  it("read-only: the check never publishes, sends or writes", () => {
    const source = readFileSync("server/teamPortalCheck.ts", "utf8");
    expect(source).not.toMatch(/publishFromRecords|sendSms|INSERT|UPDATE|DELETE|anthropic/);
    const router = readFileSync("server/teamLeaderboardHistoryRouter.ts", "utf8");
    expect(router).toContain("teamPortalCheck: admin.input(teamEvidenceWeekInputSchema).query(");
    expect(readFileSync("client/src/components/TeamPortalStatus.tsx", "utf8")).toContain("No texts are sent.");
  });
});
