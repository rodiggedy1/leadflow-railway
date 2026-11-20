import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("./instinct/claudeAgentClient", () => ({
  runWeeklyCommunicationReview: vi.fn(), runInitialLeadDraft: vi.fn(),
}));
import { runWeeklyCommunicationReview, type RunResult, type WeeklyCommunicationReviewOptions } from "./instinct/claudeAgentClient";
import {
  createTeamWeeklyReviewService, type TeamWeeklyReviewStatus,
} from "./teamWeeklyReviewService";
import type { TeamEvidenceAuditRead } from "./teamLeaderboardEvidenceService";
import type { TeamComplaintCandidate, TeamEvidence } from "../shared/teamLeaderboardEvidence";
import type { TeamWeeklyReviewPage } from "./teamWeeklyReviewContext";
import { matchTeamComplaintCandidates, groupTeamComplaintVisits } from "./teamLeaderboardComplaintMatch";

const input = { weekStart: "2026-11-15", mode: "unpublished_candidates" as const };
const now = () => new Date("2026-11-20T01:20:00Z");
const tools = ["get_weekly_review_manifest", "read_weekly_sms", "read_weekly_human_calls", "read_weekly_ai_calls", "read_weekly_emails"];
function source(change: Partial<TeamEvidence> = {}): TeamEvidence {
  return { id: "sms:1", revision: "a".repeat(64), sourceKind: "sms", store: "synthetic_messages", sourceRowId: "1", providerId: "msg1", sessionId: "session1", threadId: null,
    originalText: "The kitchen was dirty. Please arrange a reclean.", occurredAtUtc: "2026-11-18T15:00:00Z", observedAtUtc: "2026-11-18T15:01:00Z", timeBasis: "original", bodyBasis: "original", speakerBasis: "customer",
    customerPhone: "+17035550101", customerEmail: null, customerName: "Synthetic Customer", businessLine: null, mailboxEmail: null, limitations: [], ...change };
}
function candidate(evidence = source(), change: Partial<TeamComplaintCandidate> = {}): TeamComplaintCandidate {
  return { evidenceId: evidence.id, evidenceRevision: evidence.revision, summary: "Kitchen complaint", category: "cleaning_quality", evidenceQuotes: ["The kitchen was dirty."], references: [], ...change };
}
function snapshot(items = [source()]): TeamEvidenceAuditRead {
  return { status: "unpublished_read", publication: null, scoreResults: null,
    sources: { window: { weekStart: input.weekStart, weekEnd: "2026-11-21", throughDate: "2026-11-19", timeZone: "America/New_York", startInclusiveUtc: "2026-11-15T05:00:00Z", endExclusiveUtc: "2026-11-22T05:00:00Z", capturedAtUtc: now().toISOString() }, evidence: items, families: [], collectionComplete: true, limitations: [] },
    history: { teams: [{ id: 2, name: "Synthetic Team", launch27TeamId: 200 }], assignments: [], complete: true, limitations: [],
      visits: [{ id: 1, bookingId: null, launch27BookingId: 300, publicBookingNumber: null, jobDate: "2026-11-17", serviceStartUtc: "2026-11-17T13:00:00Z",
        bookingStatus: "completed", progressStatus: "completed", customerName: "Synthetic Customer", customerPhone: "+17035550101", customerEmail: null, address: "Synthetic address",
        storedTeamId: 2, storedTeamName: "Synthetic Team", progressTeamId: 2, signoffTeamId: 2, progressUpdatedAtUtc: "2026-11-17T16:00:00Z", signoffAtUtc: "2026-11-17T15:59:00Z", jobUpdatedAtUtc: "2026-11-17T16:00:00Z", customerRating: null, etaTimestamp: null }] } };
}
function result(text = '{"candidates":[]}'): RunResult {
  return { sessionId: "sesn_Synthetic1", agentId: "agent_01Naiw8VvfB75yd2VWUtVP6v", agentVersion: 1, environmentId: "env_01U7m4FNwLv7iecyqyKfFFsW",
    agentMessages: [{ providerEventId: "evtFinal", text }], finalSmsText: text, toolCalls: [] };
}
async function readAll(options: WeeklyCommunicationReviewOptions) {
  await options.backend.callTool(tools[0], {}, "manifest");
  for (const name of tools.slice(1)) {
    let offset = 0;
    while (true) {
      const eventId = `${name}:${offset}`;
      await options.onTrace?.({ stage: "tool_started", sessionId: "sesn_Synthetic1", providerEventId: eventId, toolName: name });
      const page = await options.backend.callTool(name, { offset, limit: 1 }, eventId) as TeamWeeklyReviewPage;
      await options.onTrace?.({ stage: "tool_result_acknowledged", sessionId: "sesn_Synthetic1", providerEventId: eventId, toolName: name });
      if (page.exhausted) break;
      offset = page.nextOffset;
    }
  }
}
const deferred = <T>() => {
  let resolve!: (value: T) => void; let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
async function settle(service: ReturnType<typeof createTeamWeeklyReviewService>, id: string): Promise<TeamWeeklyReviewStatus> {
  // Microtask-only wait, no timers or live calls.
  for (let index = 0; index < 200; index++) {
    const status = service.status(1, id);
    if (status.status !== "stale_run" && !["reading", "reviewing"].includes(status.status)) return status;
    await Promise.resolve();
  }
  throw new Error("SYNTHETIC_RUN_DID_NOT_SETTLE");
}
function fixture(read = snapshot(), output: unknown = { candidates: [] }, fullDelivery = true) {
  const readWeek = vi.fn(async () => read);
  const run = vi.fn(async (options: WeeklyCommunicationReviewOptions) => {
    if (fullDelivery) await readAll(options);
    return result(typeof output === "string" ? output : JSON.stringify(output));
  });
  const service = createTeamWeeklyReviewService({ readWeek, run, now });
  return { service, readWeek, run };
}

describe("process-local single-session weekly communication review", () => {
  it("returns an immediate tiny acknowledgment while read and agent are separately blocked", async () => {
    const readGate = deferred<TeamEvidenceAuditRead>(), runGate = deferred<RunResult>();
    const readWeek = vi.fn(() => readGate.promise), run = vi.fn(() => runGate.promise);
    const service = createTeamWeeklyReviewService({ readWeek, run, now });
    const started = service.start(1, input);
    expect(started).toEqual({ reviewId: expect.any(String), status: "reading", weekStart: input.weekStart });
    expect(JSON.stringify(started).length).toBeLessThan(200);
    expect(readWeek).not.toHaveBeenCalled(); expect(run).not.toHaveBeenCalled();
    await Promise.resolve(); expect(readWeek).toHaveBeenCalledTimes(1);
    expect(service.status(1, started.reviewId).status).toBe("reading");
    readGate.resolve(snapshot()); await Promise.resolve(); await Promise.resolve();
    expect(run).toHaveBeenCalledTimes(1); expect(service.status(1, started.reviewId).status).toBe("reviewing");
    expect(run.mock.calls[0][0]).not.toHaveProperty("signal");
    runGate.resolve(result());
    expect((await settle(service, started.reviewId)).status).toBe("incomplete");
  });

  it("deduplicates same-owner same-week in-flight starts, including the pre-read microtask", async () => {
    const gate = deferred<RunResult>();
    const run = vi.fn(() => gate.promise), readWeek = vi.fn(async () => snapshot());
    const service = createTeamWeeklyReviewService({ readWeek, run, now });
    const first = service.start(1, input);
    expect(service.start(1, input).reviewId).toBe(first.reviewId);
    await Promise.resolve(); await Promise.resolve();
    expect(service.start(1, input).reviewId).toBe(first.reviewId);
    const other = service.start(2, input);
    expect(other.reviewId).not.toBe(first.reviewId);
    await Promise.resolve(); await Promise.resolve();
    expect(run).toHaveBeenCalledTimes(2); expect(readWeek).toHaveBeenCalledTimes(2);
    gate.resolve(result()); await settle(service, first.reviewId);
  });

  it("strictly validates owner, Sunday date, and unpublished-only mode without reads", () => {
    const f = fixture();
    for (const owner of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, "1"]) {
      expect(() => f.service.start(owner as number, input)).toThrow("WEEKLY_REVIEW_INVALID_INPUT");
    }
    for (const change of [{ weekStart: "2026-11-16" }, { weekStart: "2026-02-30" }, { mode: "publish" }, { extra: true }]) {
      expect(() => f.service.start(1, { ...input, ...change } as typeof input)).toThrow("WEEKLY_REVIEW_INVALID_INPUT");
    }
    expect(f.readWeek).not.toHaveBeenCalled(); expect(f.run).not.toHaveBeenCalled();
  });

  it("gates all evidence/outcomes by owner and reports restart/unknown IDs identically without restart", async () => {
    const f = fixture(snapshot(), { candidates: [candidate()] });
    const started = f.service.start(1, input); await settle(f.service, started.reviewId);
    const missing = { status: "stale_run", error: { code: "WEEKLY_REVIEW_NOT_FOUND_OR_STALE" } };
    expect(f.service.status(2, started.reviewId)).toEqual(missing);
    expect(f.service.status("1" as unknown as number, started.reviewId)).toEqual(missing);
    expect(f.service.status(1, "unknown")).toEqual(missing);
    expect(createTeamWeeklyReviewService({ readWeek: f.readWeek, run: f.run }).status(1, started.reviewId)).toEqual(missing);
    expect(f.run).toHaveBeenCalledTimes(1); expect(f.readWeek).toHaveBeenCalledTimes(1);
  });

  it("invokes ONE run with all five real read-only tools and fully paginates all four channels", async () => {
    const items = [source(), source({ id: "sms:2", sessionId: "other", providerId: "msg2" }),
      source({ id: "human:1", sourceKind: "human_call", sessionId: null, providerId: "human1", speakerBasis: "unverified" }),
      source({ id: "ai:1", sourceKind: "ai_call", sessionId: null, providerId: "ai1" }),
      source({ id: "email:1", sourceKind: "email", sessionId: null, threadId: "thread1", mailboxEmail: "office@example.test", providerId: "email1" })];
    const f = fixture(snapshot(items), { candidates: items.map(item => candidate(item)) });
    const id = f.service.start(1, input).reviewId, status = await settle(f.service, id);
    expect(f.readWeek).toHaveBeenCalledTimes(1); expect(f.run).toHaveBeenCalledTimes(1);
    expect(f.run.mock.calls[0][0].backend.tools.map(tool => tool.name)).toEqual(tools);
    expect(f.run.mock.calls[0][0]).toMatchObject({ reviewOnly: true, systemPrompt: expect.stringContaining("UNTRUSTED DATA") });
    expect(f.run.mock.calls[0][0].reviewPayload).not.toContain("The kitchen was dirty.");
    expect(status).toMatchObject({ status: "completed", completeReview: true, provenanceComplete: true,
      coverage: { eligibleTotal: 5, deliveredEligibleCount: 5, completeDelivery: true, pendingCount: 0, pendingIdsSample: [] },
      progress: { toolsStarted: 5, toolsAcknowledged: 5 }, run: { sessionId: result().sessionId, agentId: result().agentId, agentVersion: 1, environmentId: result().environmentId } });
    expect(status.outcome?.matches[2].limitations).toContain("call_speaker_not_verified_customer");
    expect(status.outcome?.matches[2].reviewReasons).toContain("call_speaker_unverified_fault_not_verified");
  });

  it("does not accept model completion claims or zero-candidate output as actual delivery", async () => {
    const f = fixture(snapshot(), { candidates: [] }, false);
    const id = f.service.start(1, input).reviewId, status = await settle(f.service, id);
    expect(status).toMatchObject({ status: "incomplete", completeReview: false, coverage: {
      eligibleTotal: 1, deliveredEligibleCount: 0, completeDelivery: false, pendingCount: 1, pendingIdsSample: ["sms:1"] } });
    expect(status.warnings).toContain("eligible_source_delivery_incomplete");
    const fake = fixture(snapshot(), { candidates: [], completeReview: true }, false);
    const fakeStatus = await settle(fake.service, fake.service.start(1, input).reviewId);
    expect(fakeStatus.completeReview).toBe(false); expect(fakeStatus.error?.code).toBe("WEEKLY_REVIEW_INVALID_OUTPUT");
  });

  it("retains pending count/sample, not the huge raw source read, during partial pagination", async () => {
    const items = Array.from({ length: 50 }, (_, i) => source({ id: `sms:${i}`, sessionId: `session${i}`, originalText: "sensitive long source ".repeat(1000) }));
    const run = vi.fn(async (options: WeeklyCommunicationReviewOptions) => {
      await options.backend.callTool("read_weekly_sms", { offset: 0, limit: 1 }, "partial");
      return result();
    });
    const service = createTeamWeeklyReviewService({ readWeek: async () => snapshot(items), run, now });
    const status = await settle(service, service.start(1, input).reviewId);
    expect(status.coverage).toMatchObject({ eligibleTotal: 50, deliveredEligibleCount: 1, pendingCount: 49 });
    expect(status.coverage?.pendingIdsSample).toHaveLength(20);
    expect(JSON.stringify(status)).not.toContain("sensitive long source"); expect(JSON.stringify(status).length).toBeLessThan(5000);
    expect(status).not.toHaveProperty("sources"); expect(status).not.toHaveProperty("history");
  });

  it.each([
    { evidenceQuotes: ["Invented complaint"] }, { evidenceId: "fake:id" }, { evidenceRevision: "f".repeat(64) },
    { references: [{ kind: "booking", value: "LF-invented", quote: "The kitchen was dirty." }] },
    { evidenceQuotes: ["Translated kitchen complaint"] },
  ])("rejects invalid original quote/reference/source binding %j", async change => {
    const f = fixture(snapshot(), { candidates: [candidate(source(), change as Partial<TeamComplaintCandidate>)] });
    const status = await settle(f.service, f.service.start(1, input).reviewId);
    expect(status).toMatchObject({ status: "incomplete", completeReview: false, error: { code: "WEEKLY_REVIEW_INVALID_CANDIDATE" },
      outcome: { candidates: [], matches: [], validOutput: false, rejectedCandidateCount: 1 } });
  });

  it.each([
    { speakerBasis: "non_customer" }, { bodyBasis: "snippet" }, { bodyBasis: "missing" },
    { bodyBasis: "snapshot", limitations: ["Stored translation is a non-original variant"] },
  ] as Partial<TeamEvidence>[])("rejects staff/translated/snippet/missing evidence even with a literal quote %j", async change => {
    const evidence = source(change), f = fixture(snapshot([evidence]), { candidates: [candidate(evidence)] });
    const status = await settle(f.service, f.service.start(1, input).reviewId);
    expect(status.outcome?.rejectedCandidateCount).toBe(1); expect(status.completeReview).toBe(false);
  });

  it("preserves valid candidates when another candidate is hallucinated", async () => {
    const f = fixture(snapshot(), { candidates: [candidate(), candidate(source(), { evidenceQuotes: ["not in source"] })] });
    const status = await settle(f.service, f.service.start(1, input).reviewId);
    expect(status.status).toBe("incomplete"); expect(status.outcome?.candidates).toEqual([candidate()]);
    expect(status.outcome?.rejectedCandidateCount).toBe(1);
  });

  it("uses exact existing matching/grouping parity over the full snapshot and never publishes scores", async () => {
    const read = snapshot([source(), source({ id: "email:1", sourceKind: "email", providerId: "email1" })]);
    const candidates = [candidate(), candidate(source(), { category: "reclean_request" }), candidate(read.sources.evidence[1], { category: "refund_request" })];
    const before = JSON.stringify(read), f = fixture(read, { candidates });
    const status = await settle(f.service, f.service.start(1, input).reviewId);
    const matches = matchTeamComplaintCandidates(candidates, read.sources.evidence, read.history, read.sources.window);
    expect(status.outcome?.matches).toEqual(matches); expect(status.outcome?.visitGroups).toEqual(groupTeamComplaintVisits(matches));
    expect(status.outcome?.visitGroups).toHaveLength(1); expect(status.outcome?.visitGroups[0].matches).toHaveLength(3);
    expect(status.outcome).toMatchObject({ verifiedComplaintCount: null, verifiedRecleanRefundCount: null, publication: null, scoreResults: null });
    expect(JSON.stringify(read)).toBe(before);
    status.outcome!.candidates[0].summary = "mutated caller result";
    expect((f.service.status(1, status.reviewId) as TeamWeeklyReviewStatus).outcome?.candidates[0].summary).toBe("Kitchen complaint");
  });

  it.each(["sources", "history", "body"])("keeps delivery completeness separate from %s provenance gaps", async gap => {
    const read = snapshot(gap === "body" ? [source({ bodyBasis: "missing", originalText: null })] : undefined);
    if (gap === "sources") read.sources.collectionComplete = false;
    if (gap === "history") read.history.complete = false;
    const f = fixture(read), status = await settle(f.service, f.service.start(1, input).reviewId);
    expect(status.completeReview).toBe(true); expect(status.provenanceComplete).toBe(false); expect(status.status).toBe("incomplete");
    expect(status.warnings.length).toBeGreaterThan(0);
  });

  it.each(["not JSON and secret", "null", "[]", "{}", '{"candidates":"bad"}', '{"candidates":[],"secret":"raw secret"}'])("redacts malformed model output %s without marking zero verified complaints", async output => {
    const f = fixture(snapshot(), output), status = await settle(f.service, f.service.start(1, input).reviewId);
    expect(status.status).toBe("incomplete"); expect(status.error?.code).toBe("WEEKLY_REVIEW_INVALID_OUTPUT");
    expect(status.outcome).toBeNull(); expect(status.completeReview).toBe(false); expect(JSON.stringify(status)).not.toContain("secret");
  });

  it("stores safe asynchronous trace stages, session ID, event IDs and tool counters without raw content", async () => {
    const gate = deferred<RunResult>();
    const run = vi.fn(async (options: WeeklyCommunicationReviewOptions) => {
      await options.onTrace?.({ stage: "session_created", sessionId: "sesn_Synthetic1" });
      await options.onEvent?.({ id: "evtSafe", type: "agent.message", texts: ["RAW PRIVATE TEXT"], input: { apiKey: "SECRET" } });
      await options.onTrace?.({ stage: "tool_started", sessionId: "sesn_Synthetic1", providerEventId: "evtTool", toolName: "read_weekly_sms", path: "/SECRET/path" });
      await options.backend.callTool("read_weekly_sms", { offset: 0, limit: 1 }, "evtTool");
      await options.onTrace?.({ stage: "tool_result_acknowledged", sessionId: "sesn_Synthetic1", providerEventId: "evtTool", toolName: "read_weekly_sms" });
      return gate.promise;
    });
    const service = createTeamWeeklyReviewService({ readWeek: async () => snapshot(), run, now });
    const id = service.start(1, input).reviewId;
    for (let i = 0; i < 15; i++) await Promise.resolve();
    const status = service.status(1, id) as TeamWeeklyReviewStatus;
    expect(status).toMatchObject({ status: "reviewing", run: { sessionId: "sesn_Synthetic1", agentId: null },
      progress: { eventCount: 1, traceCount: 3, lastEventId: "evtSafe", toolsStarted: 1, toolsAcknowledged: 1, lastTrace: { stage: "tool_result_acknowledged", providerEventId: "evtTool" } } });
    expect(JSON.stringify(status)).not.toMatch(/RAW PRIVATE TEXT|SECRET|\/path/);
    gate.resolve(result()); await settle(service, id);
  });

  it.each([false, true])("preserves failed/incomplete session state without retry (early end %s)", async earlyEnd => {
    const run = vi.fn(async (options: WeeklyCommunicationReviewOptions) => {
      await options.onTrace?.({ stage: "session_created", sessionId: "sesn_Stopped" });
      throw Object.assign(new Error("provider error API_KEY secret source"), { code: earlyEnd ? "INCOMPLETE_TURN" : "UNKNOWN_POST_OUTCOME" });
    });
    const readWeek = vi.fn(async () => snapshot()), service = createTeamWeeklyReviewService({ readWeek, run, now });
    const id = service.start(1, input).reviewId, status = await settle(service, id);
    expect(status.status).toBe(earlyEnd ? "incomplete" : "failed"); expect(status.run.sessionId).toBe("sesn_Stopped");
    expect(status.error?.code).toBe(earlyEnd ? "WEEKLY_REVIEW_INCOMPLETE_TURN" : "WEEKLY_REVIEW_RUN_FAILED");
    expect(status.coverage?.pendingCount).toBe(1); expect(status.outcome).toBeNull(); expect(status.completeReview).toBe(false);
    for (let i = 0; i < 10; i++) service.status(1, id);
    expect(run).toHaveBeenCalledTimes(1); expect(readWeek).toHaveBeenCalledTimes(1); expect(JSON.stringify(status)).not.toContain("secret");
  });

  it("sanitizes a failed SELECT read and never starts a model session", async () => {
    const readWeek = vi.fn(async () => { throw new Error("database password and raw text"); }), run = vi.fn();
    const service = createTeamWeeklyReviewService({ readWeek, run, now });
    const status = await settle(service, service.start(1, input).reviewId);
    expect(status.status).toBe("failed"); expect(status.error?.code).toBe("WEEKLY_REVIEW_READ_FAILED");
    expect(run).not.toHaveBeenCalled(); expect(JSON.stringify(status)).not.toContain("password");
  });

  it("rejects unknown tool access through the real context without accepting fake model success", async () => {
    const run = vi.fn(async (options: WeeklyCommunicationReviewOptions) => {
      await options.backend.callTool("send_sms", {}, "unsafe"); return result();
    });
    const service = createTeamWeeklyReviewService({ readWeek: async () => snapshot(), run, now });
    const status = await settle(service, service.start(1, input).reviewId);
    expect(status.status).toBe("failed"); expect(status.completeReview).toBe(false); expect(status.error?.code).toBe("WEEKLY_REVIEW_RUN_FAILED");
  });

  it("has zero I/O at import/factory/status and uses only the injected run during tests", async () => {
    const fetch = vi.fn(() => { throw new Error("NO LIVE CALLS"); }); vi.stubGlobal("fetch", fetch);
    try {
      vi.resetModules();
      const module = await import("./teamWeeklyReviewService");
      const readWeek = vi.fn(), run = vi.fn(), clock = vi.fn(now);
      const service = module.createTeamWeeklyReviewService({ readWeek, run, now: clock });
      service.status(1, "unknown"); service.status(2, "unknown");
      expect(fetch).not.toHaveBeenCalled(); expect(readWeek).not.toHaveBeenCalled(); expect(run).not.toHaveBeenCalled(); expect(clock).not.toHaveBeenCalled();
      expect(runWeeklyCommunicationReview).not.toHaveBeenCalled();
      const implementation = readFileSync(new URL("./teamWeeklyReviewService.ts", import.meta.url), "utf8");
      expect(implementation).not.toMatch(/setTimeout|setInterval|node:fs|cron|createTeamComplaintDetector|process\.env|fetch\(/);
    } finally { vi.unstubAllGlobals(); }
  });
});
