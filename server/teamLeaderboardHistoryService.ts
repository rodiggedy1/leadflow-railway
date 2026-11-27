import type { HistorySelection, HistorySnapshot, PublishedWeek, ReviewPublish, WeekOption } from "../shared/teamLeaderboardHistory";
import { historySelectionSchema, reviewPublishSchema, reviewStartSchema } from "../shared/teamLeaderboardHistory";
import type { TeamEvidenceWeekInput, TeamEvidenceWindow } from "../shared/teamLeaderboardEvidence";
import type { TeamEvidenceAuditRead } from "./teamLeaderboardEvidenceService";
import type { ReviewFailure, ReviewRecord, TeamHistoryRepository } from "./teamLeaderboardHistoryRepository";
import { aggregateTeamPublications, buildTeamWeekPublication, type TeamWeekCounts } from "./teamLeaderboardHistoryMetrics";
import { reviewTeamCommunicationSnapshot, TEAM_WEEKLY_REVIEW_TIME_LIMIT_MS, type TeamWeeklyReviewStatus } from "./teamWeeklyReviewService";
import { resolveTeamEvidenceWindow } from "./teamLeaderboardEvidenceWindow";
import baseline from "./teamLeaderboardWeeklySnapshot.json";
import { legacyTeamSnapshotForSummary } from "./teamLeaderboardHistoryBaseline";

export const LEGACY_TEAM_WEEK_ID = "legacy-2026-11-15";
const clone = <T>(value: T): T => structuredClone(value);
const fail = (code: string): never => { throw new Error(code); };
/** The AI step is bounded (TEAM_WEEKLY_REVIEW_TIME_LIMIT_MS); allow reading/saving time on top. */
export const STALE_RUN_MS = TEAM_WEEKLY_REVIEW_TIME_LIMIT_MS + 10 * 60 * 1000;
/** TiDB rejects a row over 6 MB by default; keep the saved run well below it. */
export const MAX_SAVED_READ_BYTES = 4 * 1024 * 1024;
const FAILURE_CODES: Record<ReviewFailure["stage"], string> = {
  reading_communications: "WEEK_REVIEW_READ_FAILED", counting_jobs: "WEEK_REVIEW_COUNTS_FAILED",
  saving: "WEEK_REVIEW_SAVE_FAILED", ai_review: "WEEK_REVIEW_AI_FAILED",
};
/** Our own fixed codes are kept; database/provider messages are never stored or shown. */
function failureCode(error: unknown, stage: ReviewFailure["stage"]): string {
  const message = error instanceof Error ? error.message : "";
  return /^WEEK(LY)?_REVIEW_[A-Z_]{2,40}$/.test(message) ? message : FAILURE_CODES[stage];
}
/** The captured communications are only needed while the AI step runs; drop them from the saved row if too large. */
function boundedPayload(payload: ReviewRecord["payload"]): ReviewRecord["payload"] {
  if (!payload.read || Buffer.byteLength(JSON.stringify(payload), "utf8") <= MAX_SAVED_READ_BYTES) return payload;
  const { read: _read, ...rest } = payload;
  return { ...rest, readOmitted: true };
}
const seed: PublishedWeek = { id: LEGACY_TEAM_WEEK_ID, weekStart: baseline.period.weekStart,
  weekEnd: baseline.period.weekEnd, coverageEnd: baseline.period.coverageEnd,
  publishedAtMs: 0, snapshot: baseline };

export function createTeamLeaderboardHistoryService(options: {
  repository: TeamHistoryRepository;
  readWeek: (input: TeamEvidenceWeekInput) => Promise<TeamEvidenceAuditRead>;
  readCounts: (window: TeamEvidenceWindow) => Promise<TeamWeekCounts>;
  review?: typeof reviewTeamCommunicationSnapshot;
  now?: () => number;
}) {
  const repo = options.repository;
  const clock = options.now ?? Date.now;
  const running = new Set<string>();
  async function publications(): Promise<PublishedWeek[]> {
    const records = await repo.latestPublications();
    const weeks = records.map(record => {
      if (!record.publication?.period || record.publishedAtMs === null) return fail("WEEK_STORAGE_INVALID");
      const { weekStart, weekEnd, coverageEnd } = record.publication.period;
      if (weekStart !== record.weekStart) return fail("WEEK_STORAGE_INVALID");
      return { id: record.id, weekStart, weekEnd, coverageEnd, publishedAtMs: record.publishedAtMs, snapshot: record.publication };
    });
    if (!weeks.some(week => week.weekStart === seed.weekStart)) weeks.push(clone(seed));
    return weeks.sort((a, b) => b.weekStart.localeCompare(a.weekStart));
  }
  async function expectedId(weekStart: string): Promise<string | null> {
    return (await publications()).find(week => week.weekStart === weekStart)?.id ?? null;
  }
  async function worker(id: string, weekStart: string): Promise<void> {
    let stage: ReviewFailure["stage"] = "reading_communications";
    let saved: ReviewRecord["payload"] = {};
    try {
      const read = await options.readWeek({ weekStart });
      if (read.sources.window.weekStart !== weekStart) fail("WEEK_REVIEW_PERIOD_MISMATCH");
      stage = "counting_jobs";
      const counts = await options.readCounts(read.sources.window);
      if (counts.period.weekStart !== weekStart || counts.period.coverageEnd !== read.sources.window.throughDate) fail("WEEK_REVIEW_PERIOD_MISMATCH");
      stage = "saving";
      saved = boundedPayload({ read, counts });
      await repo.update(id, { status: "reviewing", updatedAtMs: clock(), payload: saved });
      stage = "ai_review";
      const result = await (options.review ?? reviewTeamCommunicationSnapshot)(read, {
        onProgress: async progress => { await repo.update(id, { status: progress.status, progress: clone(progress), updatedAtMs: clock() }); },
      });
      stage = "saving";
      saved = boundedPayload({ read, counts, ...(result.outcome ? { outcome: result.outcome } : {}) });
      await repo.update(id, { status: result.status, progress: result, updatedAtMs: clock(), payload: saved });
    } catch (error) {
      // Never retry an uncertain provider operation. Preserve all captured data and say where it stopped.
      const failure: ReviewFailure = { stage, code: failureCode(error, stage), atMs: clock() };
      console.warn(`[team-review] run ${id} failed at ${failure.stage}: ${failure.code}`);
      try { await repo.update(id, { status: "failed", updatedAtMs: failure.atMs, payload: { ...saved, failure } }); }
      catch { try { await repo.update(id, { status: "failed", updatedAtMs: clock() }); } catch { /* durable last-known status remains visible; no live action is repeated */ } }
    } finally { running.delete(id); }
  }
  /** A run that is still "reading"/"reviewing" but not running in this server process (for example after a
   * restart or deploy) and older than the bounded run time will never finish: show it as interrupted. */
  function interrupted(record: ReviewRecord): boolean {
    return ["reading", "reviewing"].includes(record.status) && !running.has(record.id) && clock() - record.updatedAtMs > STALE_RUN_MS;
  }
  function visibleStatus(record: ReviewRecord): string {
    return interrupted(record) ? "failed" : record.status;
  }
  function visibleFailure(record: ReviewRecord): ReviewFailure | null {
    if (record.payload.failure) return record.payload.failure;
    const error = record.progress?.error;
    if (error && record.status === "failed") return { stage: "ai_review", code: error.detail ? `${error.code} (${error.detail})` : error.code, atMs: record.updatedAtMs };
    if (interrupted(record)) return { stage: record.status === "reading" ? "reading_communications" : "ai_review", code: "WEEK_REVIEW_INTERRUPTED", atMs: record.updatedAtMs };
    return null;
  }
  return Object.freeze({
    async weeks(): Promise<WeekOption[]> {
      return (await publications()).map(({ snapshot: _snapshot, ...week }) => week);
    },
    async published(selection: HistorySelection = {}): Promise<HistorySnapshot> {
      const parsed = historySelectionSchema.parse(selection);
      const weeks = await publications();
      if (parsed.summary) return aggregateTeamPublications(weeks.map(week => week.id === LEGACY_TEAM_WEEK_ID
        ? { ...week, snapshot: legacyTeamSnapshotForSummary(week.snapshot) } : week));
      const week = parsed.weekStart ? weeks.find(item => item.weekStart === parsed.weekStart) : weeks[0];
      if (!week) return fail("WEEK_NOT_PUBLISHED");
      return clone(week.snapshot);
    },
    async start(ownerId: number, input: { requestId: string; weekStart: string }) {
      if (!Number.isSafeInteger(ownerId) || ownerId <= 0) fail("WEEK_REVIEW_INVALID_OWNER");
      const parsed = reviewStartSchema.parse(input);
      // Reuse the same date rules before any durable insert or source traversal.
      resolveTeamEvidenceWindow({ weekStart: parsed.weekStart }, new Date(clock()));
      const id = parsed.requestId;
      const timestamp = clock();
      const record: ReviewRecord = { id, weekStart: parsed.weekStart, ownerId, createdAtMs: timestamp, updatedAtMs: timestamp,
        status: "reading", progress: null, payload: {}, publication: null, publishedAtMs: null, publishedBy: null };
      const created = await repo.insert(record);
      if (!created) {
        const existing = await repo.get(id);
        if (!existing || existing.ownerId !== ownerId || existing.weekStart !== parsed.weekStart) return fail("WEEK_REVIEW_REQUEST_CONFLICT");
        return { id: existing.id, weekStart: existing.weekStart, status: existing.status };
      }
      running.add(id);
      // Only this explicit start owns a finite worker; imports, queries, page
      // loads and restarts never call Claude. UUID replay never submits twice.
      void Promise.resolve().then(() => worker(id, parsed.weekStart));
      return { id, weekStart: parsed.weekStart, status: "reading" };
    },
    async runs(weekStart: string) {
      reviewStartSchema.shape.weekStart.parse(weekStart);
      return (await repo.listRuns(weekStart)).map(record => ({ id: record.id, weekStart: record.weekStart, status: visibleStatus(record),
        createdAtMs: record.createdAtMs, publishedAtMs: record.publishedAtMs, runningHere: running.has(record.id) }));
    },
    async draft(id: string) {
      const record = await repo.get(id);
      if (!record) return fail("WEEK_REVIEW_NOT_FOUND");
      return { id: record.id, weekStart: record.weekStart, status: visibleStatus(record), progress: record.progress,
        failure: visibleFailure(record), readOmitted: record.payload.readOmitted === true, createdAtMs: record.createdAtMs,
        counts: record.payload.counts ?? null, outcome: record.payload.outcome ?? null,
        publishedAtMs: record.publishedAtMs, expectedPublicationId: await expectedId(record.weekStart),
        runningHere: running.has(id), updatedAtMs: record.updatedAtMs };
    },
    async publish(actorId: number, input: ReviewPublish) {
      const parsed = reviewPublishSchema.parse(input);
      if (!Number.isSafeInteger(actorId) || actorId <= 0) return fail("WEEK_REVIEW_INVALID_OWNER");
      const record = await repo.get(parsed.reviewId);
      if (!record) return fail("WEEK_REVIEW_NOT_FOUND");
      if (record.publishedAtMs !== null) return { id: record.id, weekStart: record.weekStart, publishedAtMs: record.publishedAtMs };
      // Rejected AI suggestions are excluded and shown as warnings; they no longer block publishing.
      if (!record.payload.counts?.complete || !record.payload.outcome || !record.progress?.completeReview
        || !["completed", "incomplete"].includes(record.status)) return fail("WEEK_REVIEW_NOT_READY");
      const snapshot = buildTeamWeekPublication(record.payload.counts, record.payload.outcome, parsed.decisions);
      const published = await repo.publish(record.id, snapshot, parsed.expectedPublicationId, actorId, clock(),
        record.weekStart === seed.weekStart ? seed.id : undefined);
      return { id: published.id, weekStart: published.weekStart, publishedAtMs: published.publishedAtMs };
    },
  });
}
export type TeamLeaderboardHistoryService = ReturnType<typeof createTeamLeaderboardHistoryService>;
