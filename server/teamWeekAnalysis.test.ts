// Day-by-day week analysis: progress, resume after restart, no duplicate runs or AI calls, automatic findings. No I/O.
import { describe, expect, it, vi } from "vitest";
import { createTeamWeekAnalysis, splitReadByDay, findingsToSignals, ANALYSIS_STALE_MS } from "./teamWeekAnalysis";
import { createMemoryTeamHistoryRepository } from "./teamLeaderboardHistoryRepository";
import { reviewTeamCommunicationSnapshot, type TeamWeeklyReviewStatus } from "./teamWeeklyReviewService";
import type { TeamEvidenceAuditRead } from "./teamLeaderboardEvidenceService";
import type { TeamEvidence } from "../shared/teamLeaderboardEvidence";
import type { WeeklyCommunicationReviewOptions } from "./instinct/claudeAgentClient";
import type { TeamWeeklyReviewPage } from "./teamWeeklyReviewContext";

const WEEK = "2026-11-15";
let n = 0;
function sms(atUtc: string, text = "The kitchen was dirty.", change: Partial<TeamEvidence> = {}): TeamEvidence {
  n++;
  return { id: `sms:${n}`, revision: String(n).padStart(64, "a"), sourceKind: "sms", store: "synthetic_messages", sourceRowId: String(n), providerId: `msg${n}`, sessionId: `session${n}`, threadId: null,
    originalText: text, occurredAtUtc: atUtc, observedAtUtc: atUtc, timeBasis: "original", bodyBasis: "original", speakerBasis: "customer",
    customerPhone: "+17035550101", customerEmail: null, customerName: "Synthetic Customer", businessLine: null, mailboxEmail: null, limitations: [], ...change };
}
function read(items: TeamEvidence[], through = "2026-11-19"): TeamEvidenceAuditRead {
  return { status: "unpublished_read", publication: null, scoreResults: null,
    sources: { window: { weekStart: WEEK, weekEnd: "2026-11-21", throughDate: through, timeZone: "America/New_York", startInclusiveUtc: "2026-11-15T05:00:00Z", endExclusiveUtc: "2026-11-22T05:00:00Z", capturedAtUtc: "2026-11-20T01:00:00Z" },
      evidence: items, families: [], collectionComplete: true, limitations: [] },
    history: { teams: [], assignments: [], complete: true, limitations: [], visits: [] } } as unknown as TeamEvidenceAuditRead;
}
// Mon 2, Tue 0, Wed 1 (one of them is 03:00 UTC = the evening before in Eastern time), plus staff text that is not eligible.
const items = () => [sms("2026-11-16T15:00:00Z"), sms("2026-11-16T20:00:00Z"), sms("2026-11-18T03:00:00Z"), sms("2026-11-18T15:00:00Z", "ok", { speakerBasis: "non_customer" })];
/** A fake AI review: reads every message of the day it is given, finds one complaint per day. */
function fakeReview(calls: string[], fail?: (day: string) => "throw" | "incomplete" | null) {
  return vi.fn(async (sub: TeamEvidenceAuditRead, options: { onProgress?: (s: TeamWeeklyReviewStatus) => Promise<void> | void } = {}) => {
    const eligible = sub.sources.evidence.filter(e => e.speakerBasis !== "non_customer");
    const day = eligible[0]?.occurredAtUtc ?? "none";
    calls.push(day);
    const mode = fail?.(day) ?? null;
    if (mode === "throw") throw new Error("WEEKLY_REVIEW_RUN_FAILED");
    await options.onProgress?.({ coverage: { deliveredEligibleCount: Math.ceil(eligible.length / 2) } } as TeamWeeklyReviewStatus);
    return { status: mode === "incomplete" ? "incomplete" : "completed", completeReview: mode !== "incomplete", error: null,
      coverage: { deliveredEligibleCount: mode === "incomplete" ? 0 : eligible.length },
      outcome: { matches: [{ candidate: { evidenceId: eligible[0].id, evidenceRevision: eligible[0].revision, summary: "Kitchen", category: "cleaning_quality", evidenceQuotes: ["The kitchen was dirty."], references: [] },
        status: "needs_review", visit: null, team: null, reportAtUtc: eligible[0].occurredAtUtc }] } } as unknown as TeamWeeklyReviewStatus;
  });
}
async function idle(service: { status(w: string): Promise<{ state: string }> }) {
  for (let i = 0; i < 200; i++) { await new Promise(resolve => setImmediate(resolve)); if ((await service.status(WEEK)).state !== "running") return; }
  throw new Error("did not finish");
}
function setup(options: { repo?: ReturnType<typeof createMemoryTeamHistoryRepository>; calls?: string[]; fail?: (day: string) => "throw" | "incomplete" | null; clock?: { t: number }; through?: string } = {}) {
  const repo = options.repo ?? createMemoryTeamHistoryRepository(), calls = options.calls ?? [], clock = options.clock ?? { t: Date.parse("2026-11-20T01:00:00Z") };
  const signals: string[] = [];
  const readWeek = vi.fn(async () => read(items(), options.through));
  const service = createTeamWeekAnalysis({ repository: repo, readWeek, review: fakeReview(calls, options.fail) as never, now: () => clock.t,
    record: async signal => { signals.push(signal.sourceKey); return { duplicate: false, processed: true }; } });
  return { repo, calls, signals, readWeek, service, clock };
}

describe("splitting the week into days", () => {
  it("puts each message in its Eastern day, only up to today, and counts only customer messages", () => {
    n = 0;
    const days = splitReadByDay(read(items()));
    expect(days.map(d => [d.day, d.read.sources.evidence.length, d.eligible])).toEqual([
      ["2026-11-15", 0, 0], ["2026-11-16", 2, 2], ["2026-11-17", 1, 1], ["2026-11-18", 1, 0], ["2026-11-19", 0, 0]]);
  });
});

describe("day-by-day analysis", () => {
  it("analyzes only days with messages (one AI call each), shows real progress, saves findings automatically", async () => {
    n = 0;
    const env = setup();
    expect((await env.service.status(WEEK)).state).toBe("not_started");
    const started = await env.service.start(9, { weekStart: WEEK });
    expect(started.state).toBe("running");
    await idle(env.service);
    const done = await env.service.status(WEEK);
    expect(done).toMatchObject({ state: "complete", percent: 100, processed: 3, total: 3, scope: "week" });
    expect(env.calls).toHaveLength(2); // Monday and Tuesday-evening; empty days cost nothing
    expect(done.days.map(d => [d.day, d.status, d.eligible, d.findings])).toEqual([
      ["2026-11-15", "done", 0, 0], ["2026-11-16", "done", 2, 1], ["2026-11-17", "done", 1, 1], ["2026-11-18", "done", 0, 0], ["2026-11-19", "done", 0, 0]]);
    expect(env.signals).toEqual(["sms:msg1", "sms:msg3"]);
    expect(done.startedAtMs).not.toBeNull(); expect(done.finishedAtMs).not.toBeNull();
  });
  it("never starts a second analysis while one runs, and never re-runs a finished week", async () => {
    n = 0;
    const env = setup();
    const first = await env.service.start(9, { weekStart: WEEK });
    const second = await env.service.start(10, { weekStart: WEEK });
    expect(second.runId).toBe(first.runId);
    await idle(env.service);
    expect(env.calls).toHaveLength(2);
    await expect(env.service.start(9, { weekStart: WEEK })).rejects.toThrow("ANALYSIS_ALREADY_COMPLETE");
    expect(env.calls).toHaveLength(2);
  });
  it("a one-day test is reused by the whole-week analysis (that day is not sent to the AI again)", async () => {
    n = 0;
    const env = setup();
    const test = await env.service.start(9, { weekStart: WEEK, day: "2026-11-16" });
    await idle(env.service);
    expect(await env.service.status(WEEK)).toMatchObject({ state: "complete", scope: "day", total: 2 });
    expect(env.calls).toEqual(["2026-11-16T15:00:00Z"]);
    const week = await env.service.start(9, { weekStart: WEEK });
    expect(week.runId).not.toBe(test.runId);
    await idle(env.service);
    const done = await env.service.status(WEEK);
    expect(done).toMatchObject({ state: "complete", scope: "week", processed: 3, total: 3 });
    expect(env.calls).toEqual(["2026-11-16T15:00:00Z", "2026-11-18T03:00:00Z"]);
    expect(done.days.find(d => d.day === "2026-11-16")).toMatchObject({ status: "done", reusedFrom: test.runId });
  });
  it("a failed or unfinished day leaves the analysis incomplete; finishing it re-runs only those days", async () => {
    n = 0;
    let failing = true;
    const env = setup({ fail: day => failing && day === "2026-11-18T03:00:00Z" ? "throw" : null });
    await env.service.start(9, { weekStart: WEEK });
    await idle(env.service);
    const stopped = await env.service.status(WEEK);
    expect(stopped).toMatchObject({ state: "incomplete", processed: 2, total: 3 });
    expect(stopped.days.find(d => d.day === "2026-11-17")).toMatchObject({ status: "failed", error: "WEEKLY_REVIEW_RUN_FAILED" });
    failing = false;
    const again = await env.service.start(9, { weekStart: WEEK });
    expect(again.runId).toBe(stopped.runId);
    await idle(env.service);
    expect(await env.service.status(WEEK)).toMatchObject({ state: "complete", processed: 3 });
    expect(env.calls).toEqual(["2026-11-16T15:00:00Z", "2026-11-18T03:00:00Z", "2026-11-18T03:00:00Z"]);
  });
  it("after a server restart the saved status is shown, and a stopped run is continued from the next day by one server only", async () => {
    n = 0;
    const repo = createMemoryTeamHistoryRepository(), clock = { t: Date.parse("2026-11-20T01:00:00Z") };
    // The first server stops forever inside Tuesday's AI call (a restart).
    const hang = createTeamWeekAnalysis({ repository: repo, readWeek: async () => read(items()), now: () => clock.t,
      record: async () => ({ duplicate: false, processed: true }),
      review: (async (sub: TeamEvidenceAuditRead) => sub.sources.evidence.some(e => e.occurredAtUtc === "2026-11-18T03:00:00Z")
        ? new Promise(() => {}) : fakeReview([])(sub)) as never });
    await hang.start(9, { weekStart: WEEK });
    for (let i = 0; i < 50; i++) await new Promise(resolve => setImmediate(resolve));
    // Two new servers read the status; nothing is lost, and only one continues it.
    const callsA: string[] = [], callsB: string[] = [];
    const a = setup({ repo, calls: callsA, clock }), b = setup({ repo, calls: callsB, clock });
    const before = await a.service.status(WEEK);
    expect(before).toMatchObject({ state: "running", processed: 2, total: 3 });
    expect(callsA).toEqual([]); // not stale yet: nothing restarted
    clock.t += ANALYSIS_STALE_MS + 1000;
    await Promise.all([a.service.status(WEEK), b.service.status(WEEK)]);
    await idle(a.service);
    expect(callsA.length + callsB.length).toBe(1); // only Tuesday, once
    expect([...callsA, ...callsB]).toEqual(["2026-11-18T03:00:00Z"]);
    expect(await a.service.status(WEEK)).toMatchObject({ state: "complete", processed: 3 });
  });
  it("refuses future weeks, invalid days and non-Sunday weeks before any work", async () => {
    const env = setup();
    await expect(env.service.start(9, { weekStart: "2026-11-29" })).rejects.toThrow("ANALYSIS_FUTURE_WEEK");
    await expect(env.service.start(9, { weekStart: "2026-11-16" })).rejects.toThrow("ANALYSIS_INVALID_WEEK");
    await expect(env.service.start(9, { weekStart: WEEK, day: "2026-11-25" })).rejects.toThrow("ANALYSIS_INVALID_DAY");
    expect(env.readWeek).not.toHaveBeenCalled();
  });
});

describe("with the real review step (fake AI that reads everything)", () => {
  it("each day is a separate complete review of only that day's messages", async () => {
    n = 0;
    const tools = ["get_weekly_review_manifest", "read_weekly_sms", "read_weekly_human_calls", "read_weekly_ai_calls", "read_weekly_emails"];
    const sessions: number[] = [];
    const run = async (options: WeeklyCommunicationReviewOptions) => {
      let delivered = 0;
      await options.backend.callTool(tools[0], {}, "manifest");
      for (const name of tools.slice(1)) {
        let offset = 0;
        for (;;) {
          const page = await options.backend.callTool(name, { offset, limit: 1 }, `${name}:${offset}`) as TeamWeeklyReviewPage;
          delivered += page.units?.length ?? 0;
          if (page.exhausted) break;
          offset = page.nextOffset;
        }
      }
      sessions.push(delivered);
      return { sessionId: "sesn_x", agentId: "agent_x", agentVersion: 1, environmentId: "env_x", agentMessages: [], finalSmsText: '{"candidates":[]}', toolCalls: [] };
    };
    const repo = createMemoryTeamHistoryRepository();
    const service = createTeamWeekAnalysis({ repository: repo, readWeek: async () => read(items()), record: async () => ({ duplicate: false, processed: true }),
      now: () => Date.parse("2026-11-20T01:00:00Z"), review: ((sub: TeamEvidenceAuditRead, options: object) => reviewTeamCommunicationSnapshot(sub, { ...options, run: run as never })) as never });
    await service.start(9, { weekStart: WEEK });
    await idle(service);
    const done = await service.status(WEEK);
    expect(done).toMatchObject({ state: "complete", processed: 3, total: 3 });
    expect(sessions).toEqual([2, 1]);
  });
});

describe("findings to quality records", () => {
  it("keys a text finding to its message and never treats a refund request alone as a team complaint", () => {
    n = 0;
    const evidence = [sms("2026-11-16T15:00:00Z")];
    const match = (category: string) => ({ candidate: { evidenceId: evidence[0].id, evidenceRevision: evidence[0].revision, summary: "s", category, evidenceQuotes: ["q"], references: [] },
      status: "matched", visit: { id: 77, serviceDate: "2026-11-16" }, team: { id: 2 }, reportAtUtc: "2026-11-16T15:00:00Z" });
    const [a, b] = findingsToSignals([match("cleaning_quality"), match("refund_request")] as never, evidence, "run1", WEEK);
    expect(a).toMatchObject({ sourceKey: "sms:msg1", leadflowJobId: 77, category: "cleaning_quality", detector: "weekly_review" });
    expect(b).toMatchObject({ category: "unclassified", refundRequested: true });
  });
});
