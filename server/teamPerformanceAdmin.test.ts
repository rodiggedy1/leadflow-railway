// The single Team performance card — synthetic SSR only, no network or database.
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TEAM_SCORE_METRICS } from "../shared/teamLeaderboard";

const state = vi.hoisted(() => ({ status: {} as any, live: {} as any, records: {} as any, started: vi.fn(), statusOptions: {} as any, openTeam: null as string | null }));
vi.mock("@/lib/trpc", () => ({ trpc: {
  cleaner: { getMagicLink: { useMutation: () => ({ mutateAsync: vi.fn() }) } },
  leadflowJobs: { leaderboard: { history: {
    analysisStatus: { useQuery: (_input: unknown, options: unknown) => { state.statusOptions = options; return { ...state.status, refetch: vi.fn() }; } },
    liveFromRecords: { useQuery: () => ({ ...state.live, refetch: vi.fn() }) },
    qualityRecords: { useQuery: () => ({ ...state.records, refetch: vi.fn() }) },
    reviewRuns: { useQuery: () => ({ data: { runs: [] }, refetch: vi.fn() }) },
    qualityChoices: { useQuery: () => ({ data: undefined }) },
    startAnalysis: { useMutation: () => ({ mutateAsync: state.started }) },
    estimateAnalysis: { useQuery: () => ({ data: undefined, isError: false }) },
    qualityAction: { useMutation: () => ({ mutateAsync: vi.fn() }) }, qualityRetry: { useMutation: () => ({ mutateAsync: vi.fn() }) },
    publishFromRecords: { useMutation: () => ({ mutateAsync: vi.fn() }) }, importReviewToRecords: { useMutation: () => ({ mutateAsync: vi.fn() }) },
  } } },
} }));
// Open a team row for the detail test (React's useState is SSR-only here).
vi.mock("react", async original => {
  const actual = await original<typeof import("react")>();
  return { ...actual, default: actual, useState: (initial: unknown) => {
    const value = typeof initial === "function" ? (initial as () => unknown)() : initial;
    return [value === null && state.openTeam ? state.openTeam : value, vi.fn()];
  } };
});
import { TeamPerformanceAdmin, AnalysisPanel, weekLabel } from "../client/src/components/TeamPerformanceAdmin";

const team = (id: string, name: string, jobs: number, stars: number) => ({ id, name, eligibleJobs: jobs, metrics: Object.fromEntries(TEAM_SCORE_METRICS.map(({ key }) =>
  [key, key === "ratings" ? { successful: stars, eligible: jobs, complete: true } : { successful: jobs, eligible: jobs, complete: true }])) });
const detail = (cases: number) => ({ complaintCases: cases, refundRequests: 0, confirmedRecoveryCases: 0 });
const base = (state_: string, extra: object = {}) => ({ data: { agentId: 7, state: state_, runId: "run-1", scope: "week", percent: 0, processed: 0, total: 0, startedAtMs: null, lastProgressAtMs: null,
  finishedAtMs: null, days: [], error: null, runningHere: false, ...extra }, isError: false });
const render = () => renderToStaticMarkup(React.createElement(TeamPerformanceAdmin, { agentId: 7 }));
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-11-28T17:00:00Z"));
  vi.stubGlobal("React", React);
  state.openTeam = null;
  state.status = base("not_started", { runId: null, scope: null });
  state.live = { data: { agentId: 7, period: { weekStart: "2026-11-22" }, publication: { teams: [team("1", "Martha Calderon", 10, 9), team("2", "Consuelo Alba", 9, 8), team("3", "Idle Team", 0, 0)] },
    details: { "1": detail(2), "2": detail(0) }, teamAccounts: { "1": { cleanerProfileId: 5 }, "2": { cleanerProfileId: null, reason: "No account" } }, notes: [], expectedPublicationId: null }, isError: false };
  state.records = { data: { agentId: 7, teamNames: { "1": "Martha Calderon" }, unprocessed: [], incidents: [
    { id: 11, teamId: 1, leadflowJobId: 501, category: "cleaning_quality", attribution: "auto", status: "open", recleanStatus: "requested", refundStatus: "none", processingStatus: "ok",
      channel: "sms", reportedAtMs: Date.parse("2026-11-24T15:00:00Z"), customerName: "Fict Customer", evidenceQuote: "the bathroom was not cleaned", evidenceText: null, messages: [{ id: 12 }] },
    { id: 13, teamId: 1, leadflowJobId: 502, category: "pricing_billing", attribution: "auto", status: "open", recleanStatus: "none", refundStatus: "requested", processingStatus: "ok",
      channel: "call", reportedAtMs: Date.parse("2026-11-25T15:00:00Z"), customerName: null, evidenceQuote: "charged twice", evidenceText: null, messages: [] }] }, isError: false };
});

describe("Team performance card", () => {
  it("not started: says so, offers one Analyze button, and never shows unreviewed complaints as zero", () => {
    const html = render();
    expect(html).toContain("Team performance"); expect(html).toContain(weekLabel("2026-11-22"));
    expect(html).toContain("Not started"); expect(html).toContain("Analyze this week");
    expect(html).toContain("Team standings (provisional)");
    // Same scoring as before (Martha's 2 complaints so far lower her score); unchanged weights.
    expect(html).toContain("1. Consuelo Alba"); expect(html).toContain("2. Martha Calderon");
    expect((html.match(/>Pending</g) ?? []).length).toBe(2);
    expect(html).not.toMatch(/tp-pending">0</);
    expect(html).toContain("1 team had no jobs this week.");
    expect(state.started).not.toHaveBeenCalled();
  });
  it("running: percentage, progress bar, counts and times; no start button; refreshes every few seconds", () => {
    state.status = base("running", { percent: 42.3, processed: 1638, total: 3872, startedAtMs: Date.parse("2026-11-28T15:00:00Z"), lastProgressAtMs: Date.parse("2026-11-28T15:20:00Z") });
    const html = render();
    expect(html).toContain("In progress"); expect(html).toContain("Analyzing historical complaints"); expect(html).toContain("42.3%");
    expect(html).toContain('style="width:42.3%"'); expect(html).toContain("1,638 of 3,872 communications");
    expect(html).toContain("Started Nov 28, 10:00 AM · last progress Nov 28, 10:20 AM");
    expect(html).not.toContain("Analyze this week"); expect(html).toContain(">Pending<");
    expect(state.statusOptions.refetchInterval({ state: { data: { state: "running" } } })).toBe(4000);
  });
  it("complete: final standings with complaint counts", () => {
    state.status = base("complete", { percent: 100, processed: 3872, total: 3872, startedAtMs: 1, finishedAtMs: Date.parse("2026-11-28T16:00:00Z") });
    const html = render();
    expect(html).toContain("Analysis complete"); expect(html).toContain("3,872 communications analyzed");
    expect(html).toContain("Team standings<"); expect(html).not.toContain("(provisional)"); expect(html).not.toContain(">Pending<");
  });
  it.each([["incomplete", "Analysis incomplete: 1 day not finished"], ["failed", "Analysis failed"]])("%s: plain reason and one button to finish only the unfinished days", (s, title) => {
    state.status = base(s, { percent: 60, processed: 6, total: 10, error: s === "failed" ? "ANALYSIS_READ_FAILED" : null,
      days: [{ day: "2026-11-22", status: "done", eligible: 6, processed: 6, findings: 1, error: null }, { day: "2026-11-23", status: s === "failed" ? "pending" : "failed", eligible: 4, processed: 0, findings: 0, error: "WEEKLY_REVIEW_TIMED_OUT" }] });
    const html = render();
    expect(html).toContain(title); expect(html).toContain("Finish the analysis"); expect(html).toContain("only the unfinished days are analyzed again");
    expect(html).toContain(s === "failed" ? "could not be read" : "took longer than 20 minutes");
    expect(html).toContain(">Pending<");
  });
  it("a one-day test is labelled as such and offers the whole week", () => {
    state.status = base("complete", { scope: "day", percent: 100, processed: 540, total: 540, days: [{ day: "2026-11-24", status: "done", eligible: 540, processed: 540, findings: 3, error: null }] });
    const html = render();
    expect(html).toContain("Test day only"); expect(html).toContain("Test day analyzed (test: Tue, Nov 24 only)");
    expect(html).toContain("Analyze the whole week"); expect(html).toContain(">Pending<");
  });
  it("clicking a team shows its complaints with the customer's words, which ones count, and its magic link", () => {
    state.openTeam = "1";
    state.status = base("complete", { percent: 100, processed: 10, total: 10 });
    const html = render();
    expect(html).toContain("Cleaning quality</strong>"); expect(html).toContain("“the bathroom was not cleaned”"); expect(html).toContain("2 messages about it");
    expect(html).toContain("Reclean: requested");
    expect(html).toContain("Billing / pricing · not counted against the team");
    expect(html).toContain("Copy leaderboard magic link for Martha Calderon");
  });
  it("technical details are only inside the collapsed Advanced section", () => {
    const html = render();
    const advanced = html.indexOf('<details class="tp-advanced">');
    expect(advanced).toBeGreaterThan(0);
    for (const technical of ["Analysis run:", "Test one day first", "Quality records"]) {
      const at = html.indexOf(technical);
      if (at !== -1) expect(at).toBeGreaterThan(advanced);
    }
    expect(html).not.toMatch(/<details class="tp-advanced" open/);
  });
  it("ignores data cached for another staff member", () => {
    state.live.data.agentId = 8; state.status.data.agentId = 8;
    const html = render();
    expect(html).not.toContain("Martha Calderon"); expect(html).toContain("Loading the analysis status");
  });
  it("the panel alone renders every state", () => {
    for (const s of ["not_started", "running", "complete", "incomplete", "failed"]) {
      const html = renderToStaticMarkup(React.createElement(AnalysisPanel, { status: base(s).data as never, busy: false, onStart: () => {} }));
      expect(html).toContain(`data-state="${s}"`);
    }
  });
});
