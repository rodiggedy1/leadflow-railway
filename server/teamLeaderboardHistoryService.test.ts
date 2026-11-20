import { describe, expect, it, vi } from "vitest";
import { createTeamLeaderboardHistoryService, LEGACY_TEAM_WEEK_ID } from "./teamLeaderboardHistoryService";
import type { ReviewRecord, TeamHistoryRepository } from "./teamLeaderboardHistoryRepository";
import type { TeamWeekCounts } from "./teamLeaderboardHistoryMetrics";
import type { TeamEvidenceAuditRead } from "./teamLeaderboardEvidenceService";
import type { TeamWeeklyReviewStatus } from "./teamWeeklyReviewService";
import baseline from "./teamLeaderboardWeeklySnapshot.json";

const id = "a22cf55f-d24a-4ab9-835a-479b57a6c040";
const another = "15a0287b-8427-4692-9d97-51362118dc38";
const stamp = Date.parse("2026-11-20T16:00:00Z");
const copy = <T>(value: T): T => structuredClone(value);
function memory() {
  const records = new Map<string, ReviewRecord>();
  const pointers = new Map<string, string>();
  const repository: TeamHistoryRepository = {
    async insert(value) { if (records.has(value.id)) return false; records.set(value.id, copy(value)); return true; },
    async get(key) { return records.has(key) ? copy(records.get(key)!) : null; },
    async listRuns(week) { return Array.from(records.values()).filter(value => value.weekStart === week).map(copy); },
    async update(key, patch) { const value = records.get(key)!; if (value.publishedAtMs !== null) throw new Error("PUBLISHED_IMMUTABLE"); Object.assign(value, copy(patch)); },
    async latestPublications() { return Array.from(pointers.values()).map(key => copy(records.get(key)!)); },
    async publish(key, snapshot, expected, actor, now, fallback) {
      const value = records.get(key)!;
      if (value.publishedAtMs !== null) return copy(value);
      if ((pointers.get(value.weekStart) ?? fallback ?? null) !== expected) throw new Error("PUBLICATION_CONFLICT");
      Object.assign(value, { publication: copy(snapshot), publishedAtMs: now, publishedBy: actor });
      pointers.set(value.weekStart, key); return copy(value);
    },
  };
  return { records, pointers, repository };
}
function setup() {
  const store = memory();
  const read = { status: "unpublished_read", publication: null, scoreResults: null,
    sources: { window: { weekStart: "2026-11-15", weekEnd: "2026-11-21", throughDate: "2026-11-19", timeZone: "America/New_York", startInclusiveUtc: "2026-11-15T05:00:00Z", endExclusiveUtc: "2026-11-22T05:00:00Z", capturedAtUtc: "2026-11-20T00:00:00Z" }, evidence: [], families: [], collectionComplete: true, limitations: [] },
    history: { visits: [], teams: [], assignments: [], complete: true, limitations: [] } } as TeamEvidenceAuditRead;
  const counts: TeamWeekCounts = { period: copy(baseline.period), teams: [], complete: true, warnings: [] };
  const result = { reviewId: id, weekStart: "2026-11-15", status: "completed", completeReview: true, provenanceComplete: true,
    outcome: { candidates: [], matches: [], visitGroups: [], validOutput: true, rejectedCandidateCount: 0, verifiedComplaintCount: null, verifiedRecleanRefundCount: null, publication: null, scoreResults: null },
    coverage: null, warnings: [], startedAtUtc: "2026-11-20T16:00:00Z", updatedAtUtc: "2026-11-20T16:00:00Z", durability: "process_local_only", progress: {}, run: {}, error: null } as unknown as TeamWeeklyReviewStatus;
  const readWeek = vi.fn(async () => copy(read));
  const readCounts = vi.fn(async () => copy(counts));
  const review = vi.fn(async () => copy(result));
  const service = createTeamLeaderboardHistoryService({ repository: store.repository, readWeek, readCounts, review, now: () => stamp });
  return { ...store, service, readWeek, readCounts, review, result, counts };
}
async function settled(env: ReturnType<typeof setup>, key = id) {
  for (let i = 0; i < 100; i++) {
    await new Promise(resolve => setImmediate(resolve));
    if (["completed", "incomplete", "failed"].includes(env.records.get(key)?.status ?? "")) return;
  }
  throw new Error("Synthetic worker did not settle");
}
const publish = (reviewId = id) => ({ reviewId, expectedPublicationId: LEGACY_TEAM_WEEK_ID, decisions: [], acknowledgeLimitations: true as const });

describe("durable weekly review lifecycle — no real I/O", () => {
  it("reads existing baseline and weeks repeatedly without writes or Claude", async () => {
    const env = setup();
    expect(await env.service.published()).toEqual(baseline);
    expect(await env.service.published({ weekStart: "2026-11-15" })).toEqual(baseline);
    expect((await env.service.weeks())[0]).toMatchObject({ id: LEGACY_TEAM_WEEK_ID, coverageEnd: "2026-11-19" });
    await env.service.published({ summary: true });
    expect(env.records.size).toBe(0); expect(env.review).not.toHaveBeenCalled(); expect(env.readWeek).not.toHaveBeenCalled();
  });
  it("rejects unknown publication and mutually conflicting selection without starting review", async () => {
    const env = setup();
    await expect(env.service.published({ weekStart: "2026-11-08" })).rejects.toThrow("WEEK_NOT_PUBLISHED");
    await expect(env.service.published({ summary: true, weekStart: "2026-11-15" })).rejects.toThrow();
    expect(env.records.size).toBe(0); expect(env.review).not.toHaveBeenCalled();
  });
  it("starts once for a repeated request UUID and stores its draft, leaving the published baseline unchanged", async () => {
    const env = setup();
    await env.service.start(42, { requestId: id, weekStart: "2026-11-15" });
    await env.service.start(42, { requestId: id, weekStart: "2026-11-15" });
    await settled(env);
    expect(env.review).toHaveBeenCalledTimes(1);
    expect(env.readCounts).toHaveBeenCalledWith(expect.objectContaining({ weekStart: "2026-11-15" }));
    expect(await env.service.published()).toEqual(baseline);
    const draft = await env.service.draft(id);
    expect(draft).toMatchObject({ status: "completed", expectedPublicationId: LEGACY_TEAM_WEEK_ID, runningHere: false });
    expect(draft).not.toHaveProperty("read");
    expect(env.records.get(id)?.payload.read).toBeDefined();
  });
  it("publishes explicitly and a new rerun cannot erase or mutate the previous publication", async () => {
    const env = setup();
    await env.service.start(42, { requestId: id, weekStart: "2026-11-15" }); await settled(env);
    await env.service.publish(42, publish());
    const before = copy(env.records.get(id)!);
    const published = await env.service.published();
    await env.service.start(42, { requestId: another, weekStart: "2026-11-15" }); await settled(env, another);
    expect(await env.service.published()).toEqual(published);
    expect(env.records.get(id)).toEqual(before);
    expect((await env.service.runs("2026-11-15")).length).toBe(2);
    expect((await env.service.weeks()).filter(week => week.weekStart === "2026-11-15")).toHaveLength(1);
  });
  it("keeps publication idempotent and stops stale draft publication", async () => {
    const env = setup();
    await env.service.start(42, { requestId: id, weekStart: "2026-11-15" }); await settled(env);
    const first = await env.service.publish(42, publish());
    expect(await env.service.publish(42, publish())).toEqual(first);
    await env.service.start(42, { requestId: another, weekStart: "2026-11-15" }); await settled(env, another);
    await expect(env.service.publish(42, publish(another))).rejects.toThrow("PUBLICATION_CONFLICT");
    expect(env.pointers.get("2026-11-15")).toBe(id);
  });
  it.each(["counts", "delivery", "output"])("blocks publication for incomplete %s and preserves prior results", async reason => {
    const env = setup();
    if (reason === "counts") env.counts.complete = false;
    if (reason === "delivery") env.result.completeReview = false;
    if (reason === "output") env.result.outcome!.validOutput = false;
    await env.service.start(42, { requestId: id, weekStart: "2026-11-15" }); await settled(env);
    await expect(env.service.publish(42, publish())).rejects.toThrow("WEEK_REVIEW_NOT_READY");
    expect(await env.service.published()).toEqual(baseline);
  });
  it("a read/provider failure is recorded once, not retried or published", async () => {
    const env = setup(); env.review.mockRejectedValueOnce(new Error("unknown provider outcome"));
    await env.service.start(42, { requestId: id, weekStart: "2026-11-15" }); await settled(env);
    expect((await env.service.draft(id)).status).toBe("failed");
    await env.service.start(42, { requestId: id, weekStart: "2026-11-15" });
    expect(env.review).toHaveBeenCalledTimes(1);
    expect(await env.service.published()).toEqual(baseline);
  });
  it("a restarted service reads stored drafts without resubmitting any work", async () => {
    const env = setup(); await env.service.start(42, { requestId: id, weekStart: "2026-11-15" }); await settled(env);
    const next = createTeamLeaderboardHistoryService({ repository: env.repository, readWeek: env.readWeek, readCounts: env.readCounts, review: env.review });
    expect((await next.draft(id)).status).toBe("completed");
    expect((await next.runs("2026-11-15"))[0].runningHere).toBe(false);
    expect(env.review).toHaveBeenCalledTimes(1);
  });
  it("rejects future/non-Sunday and invalid owners before storage or reads", async () => {
    const env = setup();
    for (const [owner, week] of [[42, "2026-11-22"], [42, "2026-11-16"], [0, "2026-11-15"]] as const)
      await expect(env.service.start(owner, { requestId: id, weekStart: week })).rejects.toThrow();
    expect(env.records.size).toBe(0); expect(env.review).not.toHaveBeenCalled();
  });
  it("rejects UUID reuse across owners and never exposes the other request", async () => {
    const env = setup(); await env.service.start(42, { requestId: id, weekStart: "2026-11-15" }); await settled(env);
    await expect(env.service.start(43, { requestId: id, weekStart: "2026-11-15" })).rejects.toThrow("WEEK_REVIEW_REQUEST_CONFLICT");
    expect(env.review).toHaveBeenCalledTimes(1);
  });
});
