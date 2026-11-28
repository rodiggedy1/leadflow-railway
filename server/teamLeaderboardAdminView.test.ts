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
  it.each([
    ["Staff sign-in required", { data: null, isLoading: false, isError: false }],
    ["Checking staff access…", { data: null, isLoading: true, isError: false }],
    ["Unable to confirm staff access", { data: { id: 44, isAdmin: true }, isLoading: false, isError: true }],
    ["Admin access required", { data: { id: 44, isAdmin: false }, isLoading: false, isError: false }],
  ])("fails closed before reading anything or exposing links when %s", (title, me) => {
    state.me = me;
    const html = adminMarkup();
    expect(html).toContain(title);
    expect(html).not.toContain("data-team-admin-link");
    expect(html).not.toContain("Team performance");
    expect(state.generated).not.toHaveBeenCalled();
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
