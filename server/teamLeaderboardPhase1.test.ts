// Leaderboard Phase 1 (owner-approved): bounded Run review, visible failure reasons, interrupted runs,
// saved-row size cap, and the 3-job ranking minimum. Synthetic data only; no network, database or AI.
import { describe, expect, it, vi } from "vitest";
import { createTeamLeaderboardHistoryService, MAX_SAVED_READ_BYTES, STALE_RUN_MS } from "./teamLeaderboardHistoryService";
import type { ReviewRecord, TeamHistoryRepository } from "./teamLeaderboardHistoryRepository";
import type { TeamWeekCounts } from "./teamLeaderboardHistoryMetrics";
import type { TeamEvidenceAuditRead } from "./teamLeaderboardEvidenceService";
import { reviewTeamCommunicationSnapshot, TEAM_WEEKLY_REVIEW_TIME_LIMIT_MS, type TeamWeeklyReviewStatus } from "./teamWeeklyReviewService";
import { ManagedAgentDemoError } from "./instinct/claudeAgentClient";
import { MIN_RANKED_JOBS, rankAssessedScores } from "../shared/teamLeaderboardReviewScores";
import type { TeamLeaderboardRow } from "../shared/teamLeaderboard";
import baseline from "./teamLeaderboardWeeklySnapshot.json";

const id = "a22cf55f-d24a-4ab9-835a-479b57a6c040";
const copy = <T>(value: T): T => structuredClone(value);
function memory() {
  const records = new Map<string, ReviewRecord>();
  const repository: TeamHistoryRepository = {
    async insert(value) { if (records.has(value.id)) return false; records.set(value.id, copy(value)); return true; },
    async get(key) { return records.has(key) ? copy(records.get(key)!) : null; },
    async listRuns(week) { return Array.from(records.values()).filter(value => value.weekStart === week).map(copy); },
    async update(key, patch) { Object.assign(records.get(key)!, copy(patch)); },
    async latestPublications() { return []; },
    async publish() { throw new Error("not used"); },
  };
  return { records, repository };
}
const read = () => ({ status: "unpublished_read", publication: null, scoreResults: null,
  sources: { window: { weekStart: "2026-11-15", weekEnd: "2026-11-21", throughDate: "2026-11-19", timeZone: "America/New_York", startInclusiveUtc: "2026-11-15T05:00:00Z", endExclusiveUtc: "2026-11-22T05:00:00Z", capturedAtUtc: "2026-11-20T00:00:00Z" }, evidence: [], families: [], collectionComplete: true, limitations: [] },
  history: { visits: [], teams: [], assignments: [], complete: true, limitations: [] } }) as unknown as TeamEvidenceAuditRead;
const counts = (): TeamWeekCounts => ({ period: copy(baseline.period), teams: [], complete: true, warnings: [] });
function setup(options: { review?: ReturnType<typeof vi.fn>; readWeek?: ReturnType<typeof vi.fn>; readCounts?: ReturnType<typeof vi.fn>; now?: () => number } = {}) {
  const store = memory();
  let clock = Date.parse("2026-11-20T16:00:00Z");
  const now = options.now ?? (() => clock);
  const service = createTeamLeaderboardHistoryService({ repository: store.repository,
    readWeek: options.readWeek ?? vi.fn(async () => read()), readCounts: options.readCounts ?? vi.fn(async () => counts()),
    review: (options.review ?? vi.fn(async () => ({ status: "completed", completeReview: true, error: null, outcome: null }) as unknown as TeamWeeklyReviewStatus)) as never,
    now });
  return { ...store, service, advance: (ms: number) => { clock += ms; } };
}
async function settled(records: Map<string, ReviewRecord>) {
  for (let i = 0; i < 100; i++) {
    await new Promise(resolve => setImmediate(resolve));
    if (["completed", "incomplete", "failed"].includes(records.get(id)?.status ?? "")) return;
  }
  throw new Error("Synthetic worker did not settle");
}
const start = (service: ReturnType<typeof setup>["service"]) => service.start(42, { requestId: id, weekStart: "2026-11-15" });

describe("Run review failure reasons are saved and shown", () => {
  it.each([
    ["readWeek", "reading_communications", "WEEK_REVIEW_READ_FAILED"],
    ["readCounts", "counting_jobs", "WEEK_REVIEW_COUNTS_FAILED"],
    ["review", "ai_review", "WEEK_REVIEW_AI_FAILED"],
  ] as const)("a %s failure records the step and a fixed code, never the raw message", async (which, stage, code) => {
    const broken = vi.fn(async () => { throw new Error("secret-looking provider/database text sk-ant-xyz"); });
    const env = setup({ [which]: broken });
    await start(env.service); await settled(env.records);
    const draft = await env.service.draft(id);
    expect(draft.status).toBe("failed");
    expect(draft.failure).toEqual({ stage, code, atMs: expect.any(Number) });
    expect(JSON.stringify(draft)).not.toContain("sk-ant");
    expect(broken).toHaveBeenCalledTimes(1);
  });
  it("keeps our own fixed codes such as a period mismatch", async () => {
    const env = setup({ readCounts: vi.fn(async () => ({ ...counts(), period: { ...counts().period, weekStart: "2026-11-08" } })) });
    await start(env.service); await settled(env.records);
    expect((await env.service.draft(id)).failure).toMatchObject({ stage: "counting_jobs", code: "WEEK_REVIEW_PERIOD_MISMATCH" });
  });
  it("shows the AI step's own error code and safe transport detail (for example a missing key)", async () => {
    const review = vi.fn(async () => ({ status: "failed", completeReview: false, outcome: null,
      error: { code: "WEEKLY_REVIEW_RUN_FAILED", detail: "MISSING_API_KEY" } }) as unknown as TeamWeeklyReviewStatus);
    const env = setup({ review });
    await start(env.service); await settled(env.records);
    expect((await env.service.draft(id)).failure).toMatchObject({ stage: "ai_review", code: "WEEKLY_REVIEW_RUN_FAILED (MISSING_API_KEY)" });
  });
});

describe("runs left behind by a restart are shown as interrupted", () => {
  it("an old reading/reviewing run that is not running here reads as failed/INTERRUPTED; a recent one is left alone", async () => {
    const env = setup();
    const t0 = Date.parse("2026-11-20T16:00:00Z");
    env.records.set(id, { id, weekStart: "2026-11-15", ownerId: 42, createdAtMs: t0, updatedAtMs: t0, status: "reviewing",
      progress: null, payload: {}, publication: null, publishedAtMs: null, publishedBy: null });
    expect((await env.service.draft(id)).status).toBe("reviewing");
    expect((await env.service.draft(id)).failure).toBeNull();
    env.advance(STALE_RUN_MS + 1000);
    const draft = await env.service.draft(id);
    expect(draft.status).toBe("failed");
    expect(draft.failure).toMatchObject({ stage: "ai_review", code: "WEEK_REVIEW_INTERRUPTED" });
    expect((await env.service.runs("2026-11-15"))[0].status).toBe("failed");
    expect(env.records.get(id)!.status).toBe("reviewing"); // display only: nothing is rewritten or resumed
  });
  it("the stale threshold is longer than the AI time limit", () => {
    expect(TEAM_WEEKLY_REVIEW_TIME_LIMIT_MS).toBe(20 * 60 * 1000);
    expect(STALE_RUN_MS).toBeGreaterThan(TEAM_WEEKLY_REVIEW_TIME_LIMIT_MS);
  });
});

describe("saved run size stays under the database row limit", () => {
  it("drops the captured messages (not the counts or results) when they are too large", async () => {
    const big = read() as unknown as { sources: { limitations: string[] } };
    big.sources.limitations = [ "x".repeat(MAX_SAVED_READ_BYTES + 10) ];
    const env = setup({ readWeek: vi.fn(async () => big) });
    await start(env.service); await settled(env.records);
    const saved = env.records.get(id)!;
    expect(saved.payload.read).toBeUndefined(); expect(saved.payload.readOmitted).toBe(true); expect(saved.payload.counts).toBeDefined();
    expect((await env.service.draft(id)).readOmitted).toBe(true);
  });
  it("keeps a normal-size read", async () => {
    const env = setup(); await start(env.service); await settled(env.records);
    expect(env.records.get(id)!.payload.read).toBeDefined(); expect(env.records.get(id)!.payload.readOmitted).toBeUndefined();
  });
});

describe("the AI review has a bounded execution time", () => {
  it("cancels the session at the time limit and reports TIMED_OUT", async () => {
    const run = vi.fn(options => new Promise((_, reject) => {
      options.signal.addEventListener("abort", () => reject(new ManagedAgentDemoError("CANCELLED")), { once: true });
    }));
    const status = await reviewTeamCommunicationSnapshot(read(), { run: run as never, timeLimitMs: 20 });
    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0][0].signal.aborted).toBe(true);
    expect(status).toMatchObject({ status: "failed", completeReview: false, error: { code: "WEEKLY_REVIEW_TIMED_OUT", detail: "CANCELLED" } });
  });
  it("keeps a transport's fixed error code as detail", async () => {
    const run = vi.fn(async () => { throw new ManagedAgentDemoError("MISSING_API_KEY", undefined, undefined, "not_started"); });
    const status = await reviewTeamCommunicationSnapshot(read(), { run: run as never });
    expect(status.error).toEqual({ code: "WEEKLY_REVIEW_RUN_FAILED", detail: "MISSING_API_KEY" });
  });
  it("never copies an arbitrary error message into the detail", async () => {
    const run = vi.fn(async () => { throw Object.assign(new Error("boom"), { code: "lower case or secret: abc" }); });
    const status = await reviewTeamCommunicationSnapshot(read(), { run: run as never });
    expect(status.error).toEqual({ code: "WEEKLY_REVIEW_RUN_FAILED" });
  });
});

describe("ranking: 3-job minimum and scores out of 100", () => {
  const team = (id: string, jobs: number, stars: number, ratings: number): TeamLeaderboardRow => ({ id, name: `Synthetic ${id}`, eligibleJobs: jobs, metrics: {
    ratings: { successful: stars, eligible: ratings, complete: true },
    complaints: { successful: jobs, eligible: jobs, complete: true }, recovery: { successful: jobs, eligible: jobs, complete: true },
    eta: { successful: jobs, eligible: jobs, complete: true }, photos: { successful: jobs, eligible: jobs, complete: true },
  } });
  const details = (ids: string[]) => Object.fromEntries(ids.map(id => [id, { complaintCases: 0, refundRequests: 0, confirmedRecoveryCases: 0 }]));
  it("teams below the minimum stay visible with a score but no rank, after the ranked teams", () => {
    expect(MIN_RANKED_JOBS).toBe(3);
    const rows = [team("zero", 0, 0, 0), team("two", 2, 2, 2), team("three", 3, 0, 3), team("ten", 10, 5, 10)];
    const ranked = rankAssessedScores(rows, details(["zero", "two", "three", "ten"]));
    expect(ranked.map(t => [t.id, t.rank, t.totalScore, t.unrankedReason])).toEqual([
      ["ten", 1, 85, null], ["three", 2, 70, null], ["two", null, 100, "Unranked: fewer than 3 completed jobs"], ["zero", null, null, null],
    ]);
  });
  it("a team with no received ratings is scored on the points that apply, not penalised 30 points", () => {
    const noRatings = team("none", 5, 0, 0), allFive = team("five", 5, 5, 5);
    const ranked = rankAssessedScores([noRatings, allFive], details(["none", "five"]));
    expect(ranked.find(t => t.id === "none")).toMatchObject({ availablePoints: 70, totalScore: 100 });
    expect(ranked.find(t => t.id === "five")).toMatchObject({ availablePoints: 100, totalScore: 100 });
  });
});
