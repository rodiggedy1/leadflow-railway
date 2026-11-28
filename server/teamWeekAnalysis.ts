// The week's complaint analysis, run ONE DAY AT A TIME with the existing review (same agent, model and prompt).
// Each finished day is saved and its findings go straight into the quality records, so:
//   - progress is a real percentage of the week's communications, kept in the database (survives refresh/restart);
//   - a day is never sent to the AI twice (no duplicate spending), and a stopped run continues from the next day;
//   - only one analysis per week can be active at a time.
import { randomUUID } from "node:crypto";
import type { TeamEvidenceWeekInput, TeamComplaintMatch } from "../shared/teamLeaderboardEvidence";
import type { QualityCategory } from "../shared/teamQualityIncidents";
import { easternDateIso } from "../shared/easternTime";
import { shiftBookingDate } from "../shared/bookingReschedule";
import type { TeamEvidenceAuditRead } from "./teamLeaderboardEvidenceService";
import type { ReviewRecord, TeamHistoryRepository } from "./teamLeaderboardHistoryRepository";
import type { QualitySignal } from "./teamQualityIncidents";
import { createTeamWeeklyReviewContext } from "./teamWeeklyReviewContext";
import { reviewTeamCommunicationSnapshot, type TeamWeeklyReviewStatus } from "./teamWeeklyReviewService";

export type AnalysisDay = {
  day: string; eligible: number; processed: number; findings: number;
  status: "pending" | "running" | "done" | "incomplete" | "failed";
  error: string | null; startedAtMs: number | null; finishedAtMs: number | null; reusedFrom: string | null;
};
export type AnalysisState = {
  version: 2; scope: "week" | "day"; weekStart: string; days: AnalysisDay[]; total: number;
  startedAtMs: number; lastProgressAtMs: number; finishedAtMs: number | null; resumes: number; error: string | null;
};
export type AnalysisView = {
  state: "not_started" | "running" | "complete" | "incomplete" | "failed";
  runId: string | null; scope: "week" | "day" | null; percent: number; processed: number; total: number;
  startedAtMs: number | null; lastProgressAtMs: number | null; finishedAtMs: number | null;
  days: AnalysisDay[]; error: string | null; runningHere: boolean;
};

/** No progress for this long while not running in this server = the server stopped; the run is continued. */
export const ANALYSIS_STALE_MS = 6 * 60 * 1000;
export const ANALYSIS_MAX_RESUMES = 3;
const ACTIVE = new Set(["reading", "reviewing"]);
const fail = (code: string): never => { throw new Error(code); };
const safeCode = (error: unknown, fallback: string) => {
  const message = error instanceof Error ? error.message : "";
  return /^[A-Z][A-Z_]{2,60}$/.test(message) ? message : fallback;
};

/** Eastern date of an evidence item, by the same time the review uses to place it in the week. */
function evidenceDay(item: TeamEvidenceAuditRead["sources"]["evidence"][number], fallback: string): string {
  const at = item.occurredAtUtc ?? item.observedAtUtc;
  const ms = at ? Date.parse(at) : NaN;
  return Number.isFinite(ms) ? easternDateIso(new Date(ms)) : fallback;
}
/** The same captured read, split into one read per day (each item in exactly one day; undated ones in the first). */
export function splitReadByDay(read: TeamEvidenceAuditRead): Array<{ day: string; read: TeamEvidenceAuditRead; eligible: number }> {
  const window = read.sources.window, first = window.weekStart;
  const days = Array.from({ length: 7 }, (_, i) => shiftBookingDate(first, i)).filter(day => day <= window.throughDate);
  const buckets = new Map(days.map(day => [day, [] as typeof read.sources.evidence]));
  for (const item of read.sources.evidence) {
    const day = evidenceDay(item, first);
    (buckets.get(day) ?? buckets.get(first)!).push(item);
  }
  return days.map(day => {
    const sub: TeamEvidenceAuditRead = { ...read, sources: { ...read.sources, evidence: buckets.get(day)! } };
    return { day, read: sub, eligible: createTeamWeeklyReviewContext(sub).getCoverage().eligibleTotal };
  });
}

/** The review's findings → quality-record signals (keyed to the original message, so live labels are not duplicated). */
export function findingsToSignals(matches: TeamComplaintMatch[], evidence: TeamEvidenceAuditRead["sources"]["evidence"], runId: string, weekStart: string): QualitySignal[] {
  const byId = new Map(evidence.map(item => [item.id, item]));
  return matches.map(match => {
    const candidate = match.candidate, source = byId.get(candidate.evidenceId);
    const sourceKey = source?.sourceKind === "sms" && source.providerId ? `sms:${source.providerId}`
      : source?.sourceKind === "email" && source.threadId ? `email:thread:${source.threadId}` : `review:${candidate.evidenceId}`;
    // A refund request alone is never a team complaint; reclean requests are about the cleaning.
    const category: QualityCategory = candidate.category === "team_service" ? "team_service"
      : candidate.category === "refund_request" ? "unclassified" : "cleaning_quality";
    return {
      sourceKey, channel: "review", detector: "weekly_review",
      reportedAtMs: Date.parse(match.reportAtUtc ?? "") || Date.parse(`${weekStart}T17:00:00Z`),
      customerPhone: source?.customerPhone ?? null, customerEmail: source?.customerEmail ?? null, customerName: source?.customerName ?? null,
      evidenceQuote: candidate.evidenceQuotes.join(" … "), evidenceText: candidate.summary,
      sourceRef: { runId, evidenceId: candidate.evidenceId, matchStatus: match.status }, category, severity: "medium",
      leadflowJobId: match.status === "matched" && match.visit ? match.visit.id : null,
      recleanRequested: candidate.category === "reclean_request", refundRequested: candidate.category === "refund_request",
    } satisfies QualitySignal;
  });
}

function view(record: ReviewRecord | null, runningHere: boolean): AnalysisView {
  const analysis = record?.payload.analysis;
  if (!record || !analysis) return { state: "not_started", runId: null, scope: null, percent: 0, processed: 0, total: 0, startedAtMs: null,
    lastProgressAtMs: null, finishedAtMs: null, days: [], error: null, runningHere: false };
  const processed = analysis.days.reduce((sum, day) => sum + Math.min(day.processed, day.eligible), 0);
  const state = ACTIVE.has(record.status) ? "running" : record.status === "completed" ? "complete" : record.status === "failed" ? "failed" : "incomplete";
  const percent = analysis.total > 0 ? Math.round((processed / analysis.total) * 1000) / 10 : state === "complete" ? 100 : 0;
  return { state, runId: record.id, scope: analysis.scope, percent: state === "complete" ? 100 : Math.min(percent, 99.9), processed, total: analysis.total,
    startedAtMs: analysis.startedAtMs, lastProgressAtMs: analysis.lastProgressAtMs, finishedAtMs: analysis.finishedAtMs,
    days: analysis.days, error: analysis.error, runningHere };
}

export function createTeamWeekAnalysis(options: {
  repository: TeamHistoryRepository;
  readWeek: (input: TeamEvidenceWeekInput) => Promise<TeamEvidenceAuditRead>;
  record: (signal: QualitySignal) => Promise<{ duplicate: boolean; processed: boolean }>;
  review?: typeof reviewTeamCommunicationSnapshot;
  now?: () => number;
  newId?: () => string;
}) {
  const repo = options.repository, clock = options.now ?? Date.now, newId = options.newId ?? randomUUID;
  const running = new Set<string>();
  // Week analyses only; a start that lost a race (stopped before any AI call) is not shown.
  const runsFor = async (weekStart: string) => (await (repo.listAnalysisRuns ?? repo.listRuns).call(repo, weekStart))
    .filter(run => run.payload.analysis?.version === 2 && run.payload.analysis.error !== "ANALYSIS_ALREADY_RUNNING")
    .sort((a, b) => b.createdAtMs - a.createdAtMs);
  const save = (record: ReviewRecord, status: string) => repo.update(record.id, { status, updatedAtMs: record.payload.analysis!.lastProgressAtMs, payload: record.payload });

  async function worker(record: ReviewRecord): Promise<void> {
    const analysis = record.payload.analysis!;
    let status = "reviewing";
    try {
      const read = await options.readWeek({ weekStart: analysis.weekStart });
      const chunks = new Map(splitReadByDay(read).map(chunk => [chunk.day, chunk]));
      // First time: fill in each day's size. A day another finished run already reviewed is reused, never re-sent.
      const earlier = new Map<string, { runId: string; day: AnalysisDay }>();
      for (const run of await runsFor(analysis.weekStart)) {
        if (run.id === record.id) continue;
        for (const day of run.payload.analysis!.days) if (day.status === "done" && !earlier.has(day.day)) earlier.set(day.day, { runId: run.id, day });
      }
      for (const day of analysis.days) {
        const chunk = chunks.get(day.day);
        if (day.status === "done") continue;
        day.eligible = chunk?.eligible ?? 0;
        const reused = earlier.get(day.day);
        if (reused && day.status === "pending") Object.assign(day, { status: "done", processed: reused.day.processed, eligible: reused.day.eligible, findings: reused.day.findings, reusedFrom: reused.runId });
      }
      analysis.total = analysis.days.reduce((sum, day) => sum + day.eligible, 0);
      analysis.lastProgressAtMs = clock();
      await save(record, status);
      for (const day of analysis.days) {
        if (day.status === "done") continue;
        const chunk = chunks.get(day.day);
        Object.assign(day, { status: "running", processed: 0, error: null, startedAtMs: clock(), finishedAtMs: null });
        if (!chunk || chunk.eligible === 0) {
          Object.assign(day, { status: "done", finishedAtMs: clock() }); analysis.lastProgressAtMs = clock(); await save(record, status); continue;
        }
        analysis.lastProgressAtMs = clock(); await save(record, status);
        let result: TeamWeeklyReviewStatus;
        try {
          result = await (options.review ?? reviewTeamCommunicationSnapshot)(chunk.read, {
            onProgress: async progress => {
              day.processed = progress.coverage?.deliveredEligibleCount ?? day.processed;
              analysis.lastProgressAtMs = clock();
              await save(record, status);
            },
          });
        } catch (error) {
          Object.assign(day, { status: "failed", error: safeCode(error, "ANALYSIS_DAY_FAILED"), finishedAtMs: clock() });
          analysis.lastProgressAtMs = clock(); await save(record, status); continue;
        }
        day.processed = result.coverage?.deliveredEligibleCount ?? day.processed;
        // Findings go straight into the quality records; the leaderboard picks them up automatically.
        let saved = 0;
        for (const signal of findingsToSignals(result.outcome?.matches ?? [], chunk.read.sources.evidence, record.id, analysis.weekStart)) {
          try { await options.record(signal); saved++; } catch { /* the record is retried by the automatic upkeep */ }
        }
        day.findings = saved;
        const ok = result.status !== "failed" && result.completeReview;
        Object.assign(day, { status: ok ? "done" : result.status === "failed" ? "failed" : "incomplete",
          error: ok ? null : result.error ? [result.error.code, result.error.detail].filter(Boolean).join(" ") : "ANALYSIS_DAY_INCOMPLETE",
          finishedAtMs: clock() });
        analysis.lastProgressAtMs = clock();
        await save(record, status);
      }
      status = analysis.days.every(day => day.status === "done") ? "completed" : "incomplete";
      analysis.finishedAtMs = clock(); analysis.lastProgressAtMs = clock();
      await save(record, status);
    } catch (error) {
      analysis.error = safeCode(error, "ANALYSIS_READ_FAILED");
      analysis.finishedAtMs = clock(); analysis.lastProgressAtMs = clock();
      try { await save(record, "failed"); } catch { /* shown as stopped; it is continued automatically */ }
    } finally { running.delete(record.id); }
  }
  function launch(record: ReviewRecord) {
    running.add(record.id);
    void Promise.resolve().then(() => worker(record));
  }
  /** Continue a run that stopped (a server restart) without repeating finished days. Only one server wins the claim. */
  async function continueIfStopped(record: ReviewRecord): Promise<ReviewRecord> {
    const analysis = record.payload.analysis!;
    if (!ACTIVE.has(record.status) || running.has(record.id) || clock() - record.updatedAtMs <= ANALYSIS_STALE_MS) return record;
    if (analysis.resumes >= ANALYSIS_MAX_RESUMES || !repo.claim) {
      analysis.error = "ANALYSIS_INTERRUPTED"; analysis.finishedAtMs = clock(); analysis.lastProgressAtMs = clock();
      if (repo.claim && !await repo.claim(record.id, record.updatedAtMs, { status: "incomplete", updatedAtMs: clock(), payload: record.payload })) return (await repo.get(record.id)) ?? record;
      if (!repo.claim) return record;
      return { ...record, status: "incomplete" };
    }
    analysis.resumes++; analysis.lastProgressAtMs = clock();
    for (const day of analysis.days) if (day.status === "running") day.status = "pending";
    if (!await repo.claim(record.id, record.updatedAtMs, { status: "reviewing", updatedAtMs: analysis.lastProgressAtMs, payload: record.payload })) return (await repo.get(record.id)) ?? record;
    const claimed = { ...record, status: "reviewing", updatedAtMs: analysis.lastProgressAtMs };
    launch(claimed);
    return claimed;
  }

  return Object.freeze({
    /** Free size check before any AI spending: reads the week (no AI) and returns each day's communications and text size. */
    async estimate(weekStart: string): Promise<Array<{ day: string; communications: number; characters: number }>> {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStart) || new Date(`${weekStart}T12:00:00Z`).getUTCDay() !== 0) return fail("ANALYSIS_INVALID_WEEK");
      const read = await options.readWeek({ weekStart });
      return splitReadByDay(read).map(chunk => {
        const context = createTeamWeeklyReviewContext(chunk.read), ids = new Set(context.getCoverage().pendingIds);
        const characters = chunk.read.sources.evidence.filter(item => ids.has(item.id)).reduce((sum, item) => sum + (item.originalText?.length ?? 0), 0);
        return { day: chunk.day, communications: chunk.eligible, characters };
      });
    },
    /** The one status for the week. Reading it never starts a new analysis; it only continues one that a restart stopped. */
    async status(weekStart: string): Promise<AnalysisView> {
      // The whole-week analysis is the authoritative one; a one-day test is shown only until a week run exists.
      const runs = await runsFor(weekStart);
      const latest = runs.find(run => run.payload.analysis!.scope === "week") ?? runs[0];
      if (!latest) return view(null, false);
      const current = await continueIfStopped(latest);
      return view(current, running.has(current.id));
    },
    /** Start (or continue) the week's analysis. Never a second one while one is active; a finished week is not re-run. */
    async start(ownerId: number, input: { weekStart: string; day?: string | null }): Promise<AnalysisView> {
      if (!Number.isSafeInteger(ownerId) || ownerId <= 0) return fail("ANALYSIS_INVALID_OWNER");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(input.weekStart) || new Date(`${input.weekStart}T12:00:00Z`).getUTCDay() !== 0) return fail("ANALYSIS_INVALID_WEEK");
      const today = easternDateIso(new Date(clock()));
      if (input.weekStart > today) return fail("ANALYSIS_FUTURE_WEEK");
      const scope = input.day ? "day" : "week";
      if (input.day && (input.day < input.weekStart || input.day > shiftBookingDate(input.weekStart, 6) || input.day > today)) return fail("ANALYSIS_INVALID_DAY");
      const runs = await runsFor(input.weekStart);
      const active = runs.find(run => ACTIVE.has(run.status));
      if (active) return view(await continueIfStopped(active), running.has(active.id));
      const days = scope === "day" ? [input.day!] : Array.from({ length: 7 }, (_, i) => shiftBookingDate(input.weekStart, i)).filter(day => day <= today);
      const done = new Set(runs.flatMap(run => run.payload.analysis!.days.filter(day => day.status === "done").map(day => day.day)));
      if (days.every(day => done.has(day))) return fail("ANALYSIS_ALREADY_COMPLETE");
      // An unfinished earlier run of the same scope is continued instead of starting a new one.
      const unfinished = runs.find(run => run.payload.analysis!.scope === scope && run.payload.analysis!.days.map(d => d.day).join() === days.join() && run.status !== "completed");
      const now = clock();
      if (unfinished) {
        const analysis = unfinished.payload.analysis!;
        Object.assign(analysis, { error: null, finishedAtMs: null, lastProgressAtMs: now });
        for (const day of analysis.days) if (day.status !== "done") Object.assign(day, { status: "pending", error: null });
        if (repo.claim && !await repo.claim(unfinished.id, unfinished.updatedAtMs, { status: "reviewing", updatedAtMs: now, payload: unfinished.payload })) return fail("ANALYSIS_CHANGED");
        if (!repo.claim) await repo.update(unfinished.id, { status: "reviewing", updatedAtMs: now, payload: unfinished.payload });
        const record = { ...unfinished, status: "reviewing", updatedAtMs: now };
        launch(record);
        return view(record, true);
      }
      const analysis: AnalysisState = { version: 2, scope, weekStart: input.weekStart, total: 0, startedAtMs: now, lastProgressAtMs: now, finishedAtMs: null, resumes: 0, error: null,
        days: days.map(day => ({ day, eligible: 0, processed: 0, findings: 0, status: "pending", error: null, startedAtMs: null, finishedAtMs: null, reusedFrom: null })) };
      const record: ReviewRecord = { id: newId(), weekStart: input.weekStart, ownerId, createdAtMs: now, updatedAtMs: now, status: "reading",
        progress: null, payload: { analysis }, publication: null, publishedAtMs: null, publishedBy: null };
      if (!await repo.insert(record)) return fail("ANALYSIS_CHANGED");
      // Two people pressing at once: the earlier run wins; this one stops before any AI call.
      const winner = (await runsFor(input.weekStart)).filter(run => ACTIVE.has(run.status)).sort((a, b) => a.createdAtMs - b.createdAtMs || a.id.localeCompare(b.id))[0];
      if (winner && winner.id !== record.id) {
        analysis.error = "ANALYSIS_ALREADY_RUNNING"; analysis.finishedAtMs = now;
        await repo.update(record.id, { status: "failed", updatedAtMs: now, payload: record.payload });
        return view(winner, running.has(winner.id));
      }
      launch(record);
      return view(record, true);
    },
  });
}
export type TeamWeekAnalysis = ReturnType<typeof createTeamWeekAnalysis>;
