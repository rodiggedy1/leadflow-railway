import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AdminTeamLeaderboard from "../client/src/pages/AdminTeamLeaderboard";
import TeamLeaderboard from "../client/src/pages/TeamLeaderboard";
import { TeamLeaderboardView } from "../client/src/components/TeamLeaderboardView";
import { TeamLeaderboardHistoryControls, TeamLeaderboardAdminReviewControls, isSundayWeek, shiftSundayWeek, currentSundayWeek } from "../client/src/components/TeamLeaderboardHistoryControls";
import { TeamLeaderboardReviewDraft } from "../client/src/components/TeamLeaderboardReviewDraft";
// SSR controls hook values only; no browser, live query, provider or real link generation.
const state = vi.hoisted(() => ({ values: [], index: 0, me: {}, cleaner: {},
    weeksAdmin: {}, weeksMe: {}, resultsAdmin: {}, resultsMe: {},
    runs: {}, draft: {}, inputs: {}, options: {},
    started: vi.fn(), published: vi.fn(), generated: vi.fn(), refetched: vi.fn(), }));
vi.mock("react", async (original) => {
    const actual = await original();
    return { ...actual, useState: (initial) => {
            const index = state.index++;
            const fallback = typeof initial === "function" ? initial() : initial;
            return [Object.hasOwn(state.values, index) ? state.values[index] : fallback, vi.fn()];
        }, useRef: initial => ({ current: initial }) };
});
vi.mock("@/lib/trpc", () => {
    const query = (key, value) => ({ useQuery: (input, options) => {
            state.inputs[key] = input;
            state.options[key] = options;
            return { ...value(), refetch: state.refetched };
        } });
    return { trpc: {
            agents: { me: query("me", () => state.me) },
            cleaner: { me: query("cleaner", () => state.cleaner), getMagicLink: { useMutation: () => ({ mutateAsync: state.generated }) } },
            leadflowJobs: { leaderboard: { history: {
                        weeksForAdmin: query("weeksAdmin", () => state.weeksAdmin), weeksForMe: query("weeksMe", () => state.weeksMe),
                        forAdmin: query("resultsAdmin", () => state.resultsAdmin), forMe: query("resultsMe", () => state.resultsMe),
                        reviewRuns: query("runs", () => state.runs), reviewDraft: query("draft", () => state.draft),
                        startReview: { useMutation: () => ({ mutateAsync: state.started }) },
                        publishReview: { useMutation: () => ({ mutateAsync: state.published }) },
                        liveFromRecords: { useQuery: () => ({ data: undefined, isError: false, isLoading: false, refetch: state.refetched }) },
                        publishFromRecords: { useMutation: () => ({ mutateAsync: state.published }) },
                    } } },
        } };
});
const week = { id: "synthetic-publication", weekStart: "2026-11-22", weekEnd: "2026-11-28", coverageEnd: "2026-11-26", publishedAtMs: 100 };
const period = { weekStart: week.weekStart, weekEnd: week.weekEnd, weekConvention: "Sunday-start", coverageStart: week.weekStart, coverageEnd: week.coverageEnd };
const publication = {
    weekLabel: "2026-11-22 – 2026-11-28", nextWeekLabel: "", publishedLabel: "Synthetic reviewed results", ownIncidents: [],
    teams: [{ id: "710", name: "Synthetic Current Team", eligibleJobs: 4, metrics: {
                ratings: { successful: 1, eligible: 2, complete: true }, complaints: { successful: 3, eligible: 4, complete: true },
                recovery: { successful: 3, eligible: 4, complete: true }, eta: { successful: 4, eligible: 4, complete: true }, photos: { successful: 2, eligible: 4, complete: true },
            } }],
};
const details = { "710": {
        complaintCases: 1, refundRequests: 2, confirmedRecoveryCases: 1,
        metricNotes: { ratings: "Received ratings", complaints: "Affected jobs", recovery: "Explicit outcomes only", eta: "Persisted ETA", photos: "Saved photos" },
        metricDisplay: { ratings: { value: "1 / 2", unit: "received ratings", note: "Numeric ratings" }, complaints: { value: "1", unit: "affected jobs", note: "Reviewed cases" }, recovery: { value: "1", unit: "recorded recleans/refunds", note: "Explicit outcomes" }, eta: { value: "4 / 4", unit: "jobs with ETA", note: "Persisted ETA" }, photos: { value: "2 / 4", unit: "jobs with photos", note: "Saved photos" } },
    } };
function draft(overrides = {}) {
    const matched = { candidate: { evidenceId: "synthetic-report", summary: "SUGGESTED SYNTHETIC COMPLAINT", category: "refund_request" },
        status: "matched", matchBasis: "explicit_visit", visit: { id: 501, serviceDate: "2026-11-20" }, team: { id: 710, name: "Synthetic Current Team" }, reviewReasons: [], limitations: ["speaker unverified"], reportAtUtc: "2026-11-23T12:00:00Z" };
    const unmatched = { candidate: { evidenceId: "unmatched-report", summary: "UNMATCHED SYNTHETIC REPORT", category: "cleaning_quality" }, status: "needs_review", reviewReasons: ["ambiguous service date"], limitations: ["original provenance limited"] };
    return { agentId: 44, id: "11111111-1111-4111-8111-111111111111", weekStart: week.weekStart, status: "completed",
        progress: { completeReview: true, warnings: ["retained snapshot only"], coverage: { deliveredEligibleCount: 2, eligibleTotal: 2, pendingCount: 0 } },
        counts: { complete: true, period, teams: publication.teams, warnings: ["current roster not historical proof"] },
        outcome: { validOutput: true, rejectedCandidateCount: 0, matches: [matched, unmatched], visitGroups: [{ visitId: 501, teamId: 710, serviceDate: "2026-11-20", matches: [matched], evidenceIds: ["synthetic-report"] }] },
        publishedAtMs: null, expectedPublicationId: week.id, runningHere: false, updatedAtMs: 100,
        ...overrides,
    };
}
function render(node, values = []) {
    state.values = values;
    state.index = 0;
    return renderToStaticMarkup(node);
}
const noWrites = () => { expect(state.started).not.toHaveBeenCalled(); expect(state.published).not.toHaveBeenCalled(); expect(state.generated).not.toHaveBeenCalled(); expect(state.refetched).not.toHaveBeenCalled(); };
afterEach(() => vi.useRealTimers());
beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-26T17:00:00Z"));
    vi.stubGlobal("React", React);
    vi.clearAllMocks();
    state.values = [];
    state.index = 0;
    state.inputs = {};
    state.options = {};
    state.me = { data: { id: 44, isAdmin: true }, isLoading: false, isError: false };
    state.cleaner = { data: { id: 13 }, isLoading: false, isError: false };
    state.weeksAdmin = { data: { agentId: 44, weeks: [week] }, isLoading: false, isError: false };
    state.weeksMe = { data: { cleanerProfileId: 13, weeks: [week] }, isLoading: false, isError: false };
    state.resultsAdmin = { data: { agentId: 44, selectionKey: week.weekStart, publication, details, period, teamAccounts: { "710": { cleanerProfileId: 13 } } }, isLoading: false, isError: false };
    state.resultsMe = { data: { cleanerProfileId: 13, selectionKey: week.weekStart, ownTeamId: "710", publication, details, period }, isLoading: false, isError: false };
    state.runs = { data: { agentId: 44, runs: [] }, isLoading: false, isError: false };
    state.draft = { data: draft(), isLoading: false, isError: false };
});
describe("weekly history UI — offline synthetic SSR only", () => {
    it("submits Run only once for two same-task callbacks before disabled state can rerender", async () => {
        state.refetched.mockResolvedValue({ data: state.me.data, isError: false });
        state.started.mockImplementation(async input => ({ agentId: 44, id: input.requestId, weekStart: input.weekStart, status: "reading" }));
        const root = TeamLeaderboardAdminReviewControls({ agentId: 44, weekStart: week.weekStart, accessReady: true, onPublished: async () => {} });
        let run;
        const visit = node => {
            if (!React.isValidElement(node)) return;
            if (node.type === "button" && node.props.children === "Run review") run = node;
            React.Children.forEach(node.props.children, visit);
        };
        visit(root); expect(run).toBeDefined();
        run.props.onClick(); run.props.onClick();
        await new Promise(resolve => setImmediate(resolve));
        expect(state.started).toHaveBeenCalledTimes(1);
        expect(state.published).not.toHaveBeenCalled();
    });
    it("submits Publish only once for two same-task callbacks before disabled state can rerender", async () => {
        const saved = draft(); state.values = [saved.id];
        state.refetched.mockResolvedValueOnce({ data: state.me.data, isError: false })
            .mockResolvedValueOnce({ data: saved, isError: false }).mockResolvedValue({ data: saved, isError: false });
        state.published.mockResolvedValue({ agentId: 44, id: saved.id, weekStart: saved.weekStart });
        const root = TeamLeaderboardAdminReviewControls({ agentId: 44, weekStart: week.weekStart, accessReady: true, onPublished: async () => {} });
        let selected;
        const visit = node => {
            if (!React.isValidElement(node)) return;
            if (node.type === TeamLeaderboardReviewDraft) selected = node;
            React.Children.forEach(node.props.children, visit);
        };
        visit(root); expect(selected).toBeDefined();
        const input = { reviewId: saved.id, expectedPublicationId: saved.expectedPublicationId, decisions: [], acknowledgeLimitations: true };
        await Promise.all([selected.props.onPublish(input), selected.props.onPublish(input)]);
        expect(state.published).toHaveBeenCalledTimes(1);
        expect(state.started).not.toHaveBeenCalled();
    });
    it("validates real Sunday dates and shifts calendar weeks without timezone drift", () => {
        expect(isSundayWeek("2026-11-22")).toBe(true);
        for (const invalid of ["2026-11-23", "2026-02-30", "11/22/2026", "", "2026-11-22T00:00:00Z"])
            expect(isSundayWeek(invalid)).toBe(false);
        expect(shiftSundayWeek("2026-12-27", 1)).toBe("2027-01-03");
        expect(shiftSundayWeek("2027-01-03", -1)).toBe("2026-12-27");
        expect(shiftSundayWeek("invalid", 1)).toBe("");
    });
    it("keeps only the selected week and Change week visible until explicitly opened", () => {
        const props = { weeks: [week], weekStart: week.weekStart, overall: false, onWeekChange: vi.fn(), admin: true };
        const closed = render(React.createElement(TeamLeaderboardHistoryControls, props));
        expect(closed).toContain("Current week"); expect(closed).toContain("Nov 22 – Nov 28, 2026");
        expect(closed).toContain('aria-expanded="false"'); expect(closed).toContain("Change week");
        expect(closed).not.toContain("Published history"); expect(closed).not.toContain("Previous week");
        expect(closed).not.toContain('type="text"'); expect(closed).not.toContain('aria-label="Published week"');
        const opened = render(React.createElement(TeamLeaderboardHistoryControls, props), [week.weekStart, false, true]);
        expect(opened).toContain('aria-label="Published week"'); expect(opened).toContain('type="text"');
        expect(opened).toContain("Show week"); expect(opened).not.toContain('type="date"');
        const invalid = render(React.createElement(TeamLeaderboardHistoryControls, props), ["2026-11-23", true, true]);
        expect(invalid).toContain("Use a valid Sunday date"); expect(invalid).toContain('aria-invalid="true"');
        noWrites();
    });
    it("defaults to the current Eastern Sunday rather than the latest stored week", () => {
        expect(currentSundayWeek(new Date("2026-11-22T04:59:59Z"))).toBe("2026-11-15");
        expect(currentSundayWeek(new Date("2026-11-22T05:00:00Z"))).toBe("2026-11-22");
        expect(currentSundayWeek(new Date("2027-01-01T17:00:00Z"))).toBe("2026-12-27");
        expect(currentSundayWeek(new Date("2026-03-08T07:00:00Z"))).toBe("2026-03-08");
        noWrites();
    });
    it("keeps team history published-only with no draft, staff links, Run or Publish controls", () => {
        const html = render(React.createElement(TeamLeaderboard, null));
        expect(html).toContain("Synthetic Current Team");
        expect(html).toContain("Change week");
        expect(html).toContain(">Summary</button>");
        expect(state.inputs.resultsMe).toEqual({ weekStart: week.weekStart });
        expect(html).not.toContain("Saved review");
        expect(html).not.toContain("Run review");
        expect(html).not.toContain("Publish reviewed results");
        expect(html).not.toContain("data-team-admin-link");
        expect(html).not.toContain('type="text"');
        expect(state.inputs.runs).toBeUndefined();
        expect(state.inputs.draft).toBeUndefined();
        noWrites();
    });
    it.each(["cleaner", "week", "error", "loading", "weeks identity", "weeks error"])("hides cached team standings during %s mismatch/failure", kind => {
        if (kind === "cleaner")
            state.resultsMe.data.cleanerProfileId = 99;
        if (kind === "week")
            state.resultsMe.data.selectionKey = "2026-11-15";
        if (kind === "error")
            state.resultsMe.isError = true;
        if (kind === "loading")
            state.resultsMe.isLoading = true;
        if (kind === "weeks identity")
            state.weeksMe.data.cleanerProfileId = 99;
        if (kind === "weeks error")
            state.weeksMe.isError = true;
        const html = render(React.createElement(TeamLeaderboard, null));
        expect(html).not.toContain("Synthetic Current Team");
        expect(html).not.toContain("tl-team-row");
        noWrites();
    });
    it("queries a real Summary selection from the parent, never a client score average", () => {
        state.resultsMe.data.selectionKey = "summary";
        const html = render(React.createElement(TeamLeaderboard, null), ["", true]);
        expect(state.inputs.resultsMe).toEqual({ summary: true });
        expect(html).toContain('aria-current="page">Summary</button>');
        expect(html).toContain("Summary · all published weeks");
        expect(html).toContain("not averages of weekly scores");
        expect(html).toContain("4 recorded jobs");
        expect(html).toContain("68.75");
        noWrites();
    });
    it("provides period-aware title/date/rules/footer and a real Summary tab while preserving old fallback copy", () => {
        const current = render(React.createElement(TeamLeaderboardView, { publication: publication, ownTeamId: "710", details: details, period: period, onOverallChange: vi.fn() }), ["rules", null]);
        expect(current).toContain("2026-11-22 – 2026-11-26");
        expect(current).toContain("Sunday-start · through 2026-11-26");
        expect(current).toContain("communications reviewed 2026-11-22 – 2026-11-26");
        expect(current).not.toContain("November 15–19");
        expect(current).toContain("Reviewed period · 2026-11-22 – 2026-11-26");
        const legacy = render(React.createElement(TeamLeaderboardView, { publication: publication, ownTeamId: "710" }));
        expect(legacy).toContain("November 15–19 results so far");
        expect(legacy).toContain("Sunday–Thursday · through November 19");
        expect(legacy).not.toContain(">Summary</button>");
    });
    it("labels nonzero confirmed recoveries instead of claiming no completed recovery", () => {
        const html = render(React.createElement(TeamLeaderboardView, { publication: publication, ownTeamId: "710", details: details, period: period }), ["standings", "710"]);
        expect(html).toContain("1 admin-recorded completed reclean/refund in this reviewed period");
        expect(html).toContain("2 refund request — not a completed refund");
        expect(html).not.toContain("No completed reclean/refund recorded in this reviewed period");
    });
    it("lists persisted runs after reload without restarting interrupted work", () => {
        state.runs.data.runs = [{ id: "22222222-2222-4222-8222-222222222222", weekStart: week.weekStart, status: "reviewing", createdAtMs: 100, publishedAtMs: null, runningHere: false }];
        const html = render(React.createElement(TeamLeaderboardAdminReviewControls, { agentId: 44, weekStart: week.weekStart, accessReady: true, onPublished: vi.fn() }), ["", null, null, null, false, true]);
        expect(html).toContain("Saved review");
        expect(html).toContain("not running here");
        expect(html).toContain("Run review");
        noWrites();
    });
    it.each(["identity", "week", "error"])("does not expose stale saved runs on %s mismatch", kind => {
        state.runs.data.runs = [{ id: "PRIVATE OTHER RUN", weekStart: kind === "week" ? "2026-11-15" : week.weekStart, status: "failed", createdAtMs: 100, publishedAtMs: null, runningHere: false }];
        if (kind === "identity")
            state.runs.data.agentId = 99;
        if (kind === "error")
            state.runs.isError = true;
        const html = render(React.createElement(TeamLeaderboardAdminReviewControls, { agentId: 44, weekStart: week.weekStart, accessReady: true, onPublished: vi.fn() }), ["", null, null, null, false, true]);
        expect(html).toContain("Review results");
        expect(html).not.toContain("PRIVATE OTHER RUN");
        noWrites();
    });
    it.each(["staff", "week", "review", "error", "loading"])("does not expose stale private drafts on %s mismatch/failure", kind => {
        if (kind === "staff")
            state.draft.data.agentId = 99;
        if (kind === "week")
            state.draft.data.weekStart = "2026-11-15";
        if (kind === "review")
            state.draft.data.id = "another-review";
        if (kind === "error")
            state.draft.isError = true;
        if (kind === "loading")
            state.draft.isLoading = true;
        const html = render(React.createElement(TeamLeaderboardAdminReviewControls, { agentId: 44, weekStart: week.weekStart, accessReady: true, onPublished: vi.fn() }), ["11111111-1111-4111-8111-111111111111"]);
        expect(html).not.toContain("SUGGESTED SYNTHETIC COMPLAINT");
        expect(html).not.toContain("Publish reviewed results");
        noWrites();
    });
});
describe("explicit draft adjudication — synthetic SSR only", () => {
    const publish = vi.fn();
    const decisions = [{ visitId: 501, teamId: 710, includeComplaint: true, completedRecovery: false, outcomeNote: "" }];
    it("defaults matched complaint inclusion to true but never recovery and requires explicit limitation acknowledgment", () => {
        const html = render(React.createElement(TeamLeaderboardReviewDraft, { draft: draft(), agentId: 44, onPublish: publish }));
        expect(html).toContain("Captured job and submission counts");
        expect(html).toContain("Five-star / received ratings");
        expect(html).toContain("1 / 2");
        expect(html).toContain("Suggested complaints");
        expect(html).toContain('type="checkbox" checked=""/>Include suggested complaint');
        expect(html).toContain('type="checkbox"/>Explicitly record a completed reclean/refund');
        expect(html).toContain("UNMATCHED SYNTHETIC REPORT");
        expect(html).toContain("ambiguous service date");
        expect(html).toContain("current roster not historical proof");
        expect(html).toContain("Provider-wide coverage is not verified");
        expect(html).toContain("not model verification");
        expect(html).toContain('type="submit" class="tl-history-primary" disabled=""');
        expect(publish).not.toHaveBeenCalled();
        noWrites();
    });
    it("permits only an acknowledged ready draft, including zero suggested groups", () => {
        const html = render(React.createElement(TeamLeaderboardReviewDraft, { draft: draft(), agentId: 44, onPublish: publish }), [decisions, true]);
        expect(html).toContain('type="submit" class="tl-history-primary">Publish reviewed results');
        const empty = draft();
        empty.outcome.matches = [];
        empty.outcome.visitGroups = [];
        const emptyHtml = render(React.createElement(TeamLeaderboardReviewDraft, { draft: empty, agentId: 44, onPublish: publish }), [[], true]);
        expect(emptyHtml).toContain('type="submit" class="tl-history-primary">Publish reviewed results');
        noWrites();
    });
    it("shows rejected AI suggestions as left out without blocking Publish", () => {
        const value = draft();
        value.outcome.validOutput = false;
        value.outcome.rejectedCandidateCount = 2;
        const html = render(React.createElement(TeamLeaderboardReviewDraft, { draft: value, agentId: 44, onPublish: publish }), [decisions, true]);
        expect(html).toContain("2 AI suggestions could not be checked against the original message and were left out.");
        expect(html).not.toContain("Publish unavailable");
        noWrites();
    });
    it.each(["counts", "review", "output", "failed", "recovery note", "missing decisions"])("blocks explicit Publish when %s is incomplete/invalid", kind => {
        const value = draft();
        let chosen = decisions;
        if (kind === "counts")
            value.counts.complete = false;
        if (kind === "review")
            value.progress.completeReview = false;
        if (kind === "output")
            value.outcome = null;
        if (kind === "failed")
            value.status = "failed";
        if (kind === "recovery note")
            chosen = [{ ...decisions[0], completedRecovery: true, outcomeNote: "  " }];
        if (kind === "missing decisions")
            chosen = [];
        const html = render(React.createElement(TeamLeaderboardReviewDraft, { draft: value, agentId: 44, onPublish: publish }), [chosen, true]);
        expect(html).toContain("Publish unavailable");
        expect(html).toContain('type="submit" class="tl-history-primary" disabled=""');
        noWrites();
    });
    it("requires an outcome note for completed recovery and accepts a nonempty explicit note", () => {
        const chosen = [{ ...decisions[0], completedRecovery: true, outcomeNote: "Admin confirmed completed reclean." }];
        const html = render(React.createElement(TeamLeaderboardReviewDraft, { draft: draft(), agentId: 44, onPublish: publish }), [chosen, true]);
        expect(html).toContain("required for completed recovery");
        expect(html).toContain('required=""');
        expect(html).toContain('type="submit" class="tl-history-primary">Publish reviewed results');
        noWrites();
    });
    it("hides private draft contents for a different current staff identity", () => {
        const html = render(React.createElement(TeamLeaderboardReviewDraft, { draft: draft({ agentId: 99 }), agentId: 44, onPublish: publish }));
        expect(html).not.toContain("SUGGESTED SYNTHETIC COMPLAINT");
        expect(html).not.toContain("Publish reviewed results");
    });
    it("keeps an interrupted run visible but unpublishable and never automatically resumes it", () => {
        const html = render(React.createElement(TeamLeaderboardReviewDraft, { draft: draft({ status: "reviewing", runningHere: false }), agentId: 44, onPublish: publish }), [decisions, true]);
        expect(html).toContain("This run is not running on this server.");
        expect(html).toContain("Publish unavailable");
        noWrites();
    });
    it("renders a published run without a new Publish form", () => {
        const html = render(React.createElement(TeamLeaderboardReviewDraft, { draft: draft({ publishedAtMs: 200 }), agentId: 44, onPublish: publish }));
        expect(html).toContain("Published review");
        expect(html).not.toContain("Publish reviewed results");
        noWrites();
    });
    it("keeps mutation calls click/submit-only, preserves fresh Copy validation, and leaves the view hook order intact", () => {
        const controls = readFileSync(new URL("../client/src/components/TeamLeaderboardHistoryControls.tsx", import.meta.url), "utf8");
        const view = readFileSync(new URL("../client/src/components/TeamLeaderboardView.tsx", import.meta.url), "utf8");
        const admin = readFileSync(new URL("../client/src/pages/AdminTeamLeaderboard.tsx", import.meta.url), "utf8");
        const cleaner = readFileSync(new URL("../client/src/pages/TeamLeaderboard.tsx", import.meta.url), "utf8");
        expect(controls).not.toMatch(/useEffect|setInterval|setTimeout|showPicker|type="date"|sendMessage|sendMagicLink/);
        expect(controls).toContain("requestId: crypto.randomUUID()");
        expect(controls).toContain("retrySameRequest && request?.weekStart === weekStart ? request");
        expect(controls).toContain("startReview.useMutation({ retry: false })");
        expect(controls).toContain("publishReview.useMutation({ retry: false })");
        expect(controls).toContain("await confirmStaff()");
        expect(controls).toContain("fresh.data.expectedPublicationId !== input.expectedPublicationId");
        expect((view.match(/= useState</g) ?? []).length).toBe(2);
        expect(view.indexOf("[tab, setTab]")).toBeLessThan(view.indexOf("[expandedTeam, setExpandedTeam]"));
        expect(view).toContain('if (value === "standings") onOverallChange?.(false)');
        expect(view).toContain('onOverallChange(true); setTab("standings")');
        // The admin page is now the single Team performance card; it only checks staff access and renders it.
        expect(admin).toContain("<TeamPerformanceAdmin key={meQuery.data.id} agentId={meQuery.data.id} />");
        expect(cleaner).not.toMatch(/startReview|publishReview|reviewDraft|reviewRuns|getMagicLink/);
        for (const source of [controls, view, admin, cleaner])
            expect(source).not.toMatch(new RegExp(["cleaner" + "Jobs", "cleaner" + "_jobs"].join("|")));
    });
});
