import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AdminTeamLeaderboard from "../client/src/pages/AdminTeamLeaderboard";
import { TeamLeaderboardView } from "../client/src/components/TeamLeaderboardView";
import ReviewWorkspaceNav from "../client/src/components/ReviewWorkspaceNav";
import OriginalDashboardWorkspaceNav from "../client/src/components/OriginalDashboardWorkspaceNav";
import type { TeamLeaderboardPublication } from "../shared/teamLeaderboard";

const state = vi.hoisted(() => ({ live: {} as any, liveOptions: {} as any, me: {} as any, results: {} as any, generated: vi.fn(), refetch: vi.fn(), options: {} as any, input: {} as any, weeks: {} as any, runs: {} as any, draft: {} as any, started: vi.fn(), published: vi.fn() }));
vi.mock("@/lib/trpc", () => ({ trpc: {
  agents: { me: { useQuery: () => ({ ...state.me, refetch: vi.fn() }) } },
  cleaner: { getMagicLink: { useMutation: () => ({ mutateAsync: state.generated }) } },
  leadflowJobs: { leaderboard: { history: {
    forAdmin: { useQuery: (input: unknown, options: any) => { state.input = input; state.options = options; return { ...state.results, refetch: state.refetch }; } },
    weeksForAdmin: { useQuery: () => ({ ...state.weeks, refetch: vi.fn() }) },
    reviewRuns: { useQuery: () => ({ ...state.runs, refetch: vi.fn() }) },
    reviewDraft: { useQuery: () => ({ ...state.draft, refetch: vi.fn() }) },
    startReview: { useMutation: () => ({ mutateAsync: state.started }) },
    publishReview: { useMutation: () => ({ mutateAsync: state.published }) },
    liveFromRecords: { useQuery: (_input: unknown, options: any) => { state.liveOptions = options; return { ...state.live, refetch: vi.fn() }; } },
    publishFromRecords: { useMutation: () => ({ mutateAsync: vi.fn() }) },
  } } },
} }));
vi.mock("wouter", () => ({ useLocation: () => ["/admin/team-leaderboard", vi.fn()] }));
const publication: TeamLeaderboardPublication = {
  weekLabel: "Synthetic week", nextWeekLabel: "Synthetic next week", publishedLabel: "Synthetic reviewed results", ownIncidents: [],
  teams: ["710", "920"].map(id => ({ id, name: `Synthetic Team ${id}`, eligibleJobs: 2,
    metrics: { ratings: { successful: 1, eligible: 1, complete: true }, complaints: { successful: 2, eligible: 2, complete: true }, recovery: { successful: 2, eligible: 2, complete: true }, eta: { successful: 2, eligible: 2, complete: true }, photos: { successful: 1, eligible: 2, complete: true } } })),
};
function adminMarkup() { return renderToStaticMarkup(React.createElement(AdminTeamLeaderboard)); }
afterEach(() => vi.useRealTimers());
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-20T17:00:00Z"));
  vi.stubGlobal("React", React);
  vi.clearAllMocks();
  state.weeks = { data: { agentId: 44, weeks: [{ id: "synthetic-baseline", weekStart: "2026-11-15", weekEnd: "2026-11-21", coverageEnd: "2026-11-19", publishedAtMs: 0 }] }, isLoading: false, isError: false };
  state.runs = { data: { agentId: 44, runs: [] }, isLoading: false, isError: false };
  state.draft = { data: null, isLoading: false, isError: false };
  state.me = { data: { id: 44, isAdmin: true }, isLoading: false, isError: false };
  state.results = { data: { publication, details: {}, agentId: 44, selectionKey: "2026-11-15", teamAccounts: { "710": { cleanerProfileId: 13 }, "920": { cleanerProfileId: null, reason: "No active linked team account" } } }, isLoading: false, isError: false };
});

describe("admin leaderboard usability — synthetic SSR only", () => {
  it("an unpublished week shows its automatic scores from quality records, with the same team controls", () => {
    state.weeks.data.weeks = [];
    state.live = { data: { publication, details: {}, agentId: 44, period: { weekStart: "2026-11-15", weekEnd: "2026-11-21", weekConvention: "Sunday-start", coverageStart: "2026-11-15", coverageEnd: "2026-11-20" },
      teamAccounts: { "710": { cleanerProfileId: 13 }, "920": { cleanerProfileId: null, reason: "No active linked team account" } }, countsComplete: true, expectedPublicationId: null }, isLoading: false, isError: false };
    const html = adminMarkup();
    expect(state.liveOptions.enabled).toBe(true);
    expect(html).toContain("This week&#x27;s scores, updated automatically from saved quality records");
    expect((html.match(/data-team-admin-link/g) ?? []).length).toBe(2);
    state.live.data.agentId = 45;
    expect(adminMarkup()).not.toContain("data-team-admin-link");
  });
  it("a published week shows its published results by default (automatic scores stay one click away)", () => {
    const html = adminMarkup();
    expect(state.liveOptions.enabled).toBe(false);
    expect(html).toContain("Show this week&#x27;s automatic scores");
  });
  it("renders the same score standings with one separate copy control per team and an explicit unavailable account", () => {
    const html = adminMarkup();
    expect((html.match(/data-team-admin-link/g) ?? []).length).toBe(2);
    expect(html).toContain("Copy leaderboard magic link for Synthetic Team 710");
    expect(html).toContain('disabled=""');
    expect(html).toContain("No active linked team account");
    expect(html).not.toContain("Your results");
    expect(html).not.toContain("See your breakdown");
    expect(html).not.toContain("No scored jobs to rank yet");
    expect(html).not.toContain("Send leaderboard");
    expect(html).toContain('href="/admin/dashboard"');
    expect(state.generated).not.toHaveBeenCalled();
    expect(state.refetch).not.toHaveBeenCalled();
    expect(state.started).not.toHaveBeenCalled();
    expect(state.published).not.toHaveBeenCalled();
    expect(state.input).toEqual({ weekStart: "2026-11-15" });
    expect(html).toContain("Change week");
    expect(html).toContain("Run review");
    expect(html).toContain(">Summary</button>");
  });
  it.each([
    ["Staff sign-in required", { data: null, isLoading: false, isError: false }],
    ["Checking staff access…", { data: null, isLoading: true, isError: false }],
    ["Unable to confirm staff access", { data: { id: 44, isAdmin: true }, isLoading: false, isError: true }],
    ["Admin access required", { data: { id: 44, isAdmin: false }, isLoading: false, isError: false }],
  ])("fails closed before exposing links when %s", (title, me) => {
    state.me = me;
    const html = adminMarkup();
    expect(html).toContain(title);
    expect(html).not.toContain("data-team-admin-link");
    expect(state.options.enabled).toBe(false);
    expect(state.generated).not.toHaveBeenCalled();
  });
  it("rejects cached leaderboard data from another admin identity", () => {
    state.results.data.agentId = 45;
    const html = adminMarkup();
    expect(html).toContain("Loading the team leaderboard…");
    expect(html).not.toContain("data-team-admin-link");
  });
  it("rejects a cached publication for another selected week", () => {
    state.results.data.selectionKey = "2026-11-08";
    const html = adminMarkup();
    expect(html).toContain("Loading the team leaderboard…");
    expect(html).not.toContain("data-team-admin-link");
  });
  it("rejects another staff identity's saved weeks without hiding the explicit Run surface", () => {
    state.weeks.data.agentId = 45;
    const html = adminMarkup();
    expect(html).not.toContain("Synthetic Team 710");
    expect(html).not.toContain("data-team-admin-link");
    expect(html).toContain("Run review");
    expect(state.options.enabled).toBe(false);
    expect(state.started).not.toHaveBeenCalled();
  });
  it("rejects cached standings when the admin read failed", () => {
    state.results.isError = true;
    const html = adminMarkup();
    expect(html).toContain("Unable to load the leaderboard");
    expect(html).not.toContain("data-team-admin-link");
  });
  it("keeps the original team view free of all admin account and copy controls", () => {
    const html = renderToStaticMarkup(React.createElement(TeamLeaderboardView, { publication, ownTeamId: "710" }));
    expect(html).toContain("Your results");
    expect(html).toContain("See your breakdown");
    expect(html).toContain('href="/portal-v2"');
    expect(html).not.toContain("data-team-admin-link");
    expect(html).not.toContain("Copy magic link");
  });
  it("repoints the original dashboard sidebar and leaves its other destinations intact", () => {
    const html = renderToStaticMarkup(React.createElement(OriginalDashboardWorkspaceNav));
    expect(html).toMatch(/href="\/admin\/team-leaderboard"[^>]*aria-current="page"[^>]*>[\s\S]*?<span>Reviews &amp; Quality<\/span>/);
    expect(html).toContain('href="/admin/team"');
    expect(html).toContain('href="/admin/sms"');
    expect(html).toContain('href="/admin/bookings"');
  });
  it("repoints the live workspace sidebar while keeping Reviews & Quality selected", () => {
    const html = renderToStaticMarkup(React.createElement(ReviewWorkspaceNav, { activePath: "/review/reviews-quality" }));
    expect(html).toMatch(/href="\/admin\/team-leaderboard"[^>]*aria-current="page"/);
    expect(html).toContain('href="/admin/sms"');
    expect(html).toContain('href="/admin/team"');
  });
  it("preserves review-only navigation outside live workspace frames", () => {
    const html = renderToStaticMarkup(React.createElement(ReviewWorkspaceNav));
    expect(html).toContain('href="/review/reviews-quality"');
  });
  it("preserves the old quality and team routes and scopes watcher exclusion only to the new admin workspace", () => {
    const app = readFileSync(new URL("../client/src/App.tsx", import.meta.url), "utf8");
    expect(app).toContain('<Route path={"/admin/quality"} component={CleanerDashboard} />');
    expect(app).toContain('<Route path={"/team-leaderboard"} component={TeamLeaderboard} />');
    expect(app).toContain('<Route path={"/admin/team-leaderboard"} component={AdminTeamLeaderboardRoute} />');
    expect(app).toContain('activePath="/review/reviews-quality" /><AdminTeamLeaderboard');
    expect(app).toContain('location === "/admin/dashboard" || location === "/admin/team-leaderboard"');
  });
  it("uses only the existing magic-link mutation and destination helper; no message-sending adapter", () => {
    const link = readFileSync(new URL("../client/src/components/TeamLeaderboardAdminLink.tsx", import.meta.url), "utf8");
    expect(link).toContain("trpc.cleaner.getMagicLink.useMutation()");
    expect(link).toContain("withTeamLeaderboardDestination(result.url, origin)");
    expect(link).toContain("const profileId = await resolveProfile()");
    expect(link).not.toMatch(/sendMessage|sendMagicLink|shareTeamLeaderboard|randomBytes|fetch\(/);
  });
});
