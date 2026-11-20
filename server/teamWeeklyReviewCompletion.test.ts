import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("./instinct/claudeAgentClient", () => ({ runWeeklyCommunicationReview: vi.fn() }));
import type { RunResult, WeeklyCommunicationReviewOptions } from "./instinct/claudeAgentClient";
import type { TeamComplaintCandidate, TeamEvidence } from "../shared/teamLeaderboardEvidence";
import type { TeamEvidenceAuditRead } from "./teamLeaderboardEvidenceService";
import {
  createTeamWeeklyReviewContext, TEAM_WEEKLY_REVIEW_PAGE_BYTES, TEAM_WEEKLY_REVIEW_TOOL_NAMES,
  type TeamWeeklyReviewPage,
} from "./teamWeeklyReviewContext";
import { reviewTeamCommunicationSnapshot, type TeamWeeklyReviewStatus } from "./teamWeeklyReviewService";
import { matchTeamComplaintCandidates, groupTeamComplaintVisits } from "./teamLeaderboardComplaintMatch";

const now = () => new Date("2026-11-20T01:20:00Z");
function source(id = "sms:1", change: Partial<TeamEvidence> = {}): TeamEvidence {
  return { id, revision: "a".repeat(64), sourceKind: "sms", store: "synthetic_messages", sourceRowId: id,
    providerId: `provider-${id}`, sessionId: id, threadId: null,
    originalText: "The kitchen was dirty. Please arrange a reclean.",
    occurredAtUtc: "2026-11-18T15:00:00Z", observedAtUtc: "2026-11-18T15:01:00Z",
    timeBasis: "original", bodyBasis: "original", speakerBasis: "customer",
    customerPhone: "+17035550101", customerEmail: null, customerName: "Synthetic Customer",
    businessLine: null, mailboxEmail: null, limitations: [], ...change };
}
function snapshot(items: TeamEvidence[] = []): TeamEvidenceAuditRead {
  return { status: "unpublished_read", publication: null, scoreResults: null,
    sources: { window: { weekStart: "2026-11-15", weekEnd: "2026-11-21", throughDate: "2026-11-19",
      timeZone: "America/New_York", startInclusiveUtc: "2026-11-15T05:00:00Z",
      endExclusiveUtc: "2026-11-22T05:00:00Z", capturedAtUtc: now().toISOString() },
      evidence: items, families: [], collectionComplete: true, limitations: [] },
    history: { visits: [], teams: [], assignments: [], complete: true, limitations: [] } };
}
function candidate(item: TeamEvidence): TeamComplaintCandidate {
  return { evidenceId: item.id, evidenceRevision: item.revision, summary: "Reported kitchen problem",
    category: "cleaning_quality", evidenceQuotes: ["The kitchen was dirty."], references: [] };
}
function result(candidates: TeamComplaintCandidate[] = []): RunResult {
  return { sessionId: "sesn_Synthetic1", agentId: "agent_01Naiw8VvfB75yd2VWUtVP6v", agentVersion: 1,
    environmentId: "env_01U7m4FNwLv7iecyqyKfFFsW", agentMessages: [], toolCalls: [],
    finalSmsText: JSON.stringify({ candidates }) };
}
async function all(options: WeeklyCommunicationReviewOptions, manifest = true, omit?: string) {
  if (manifest) await options.backend.callTool(TEAM_WEEKLY_REVIEW_TOOL_NAMES[0], {}, "manifest");
  for (const name of TEAM_WEEKLY_REVIEW_TOOL_NAMES.slice(1)) {
    if (name === omit) continue;
    let offset = 0, continuation: string | undefined;
    for (let count = 0; count < 100; count++) {
      const page = await options.backend.callTool(name, { offset, limit: 100,
        ...(continuation ? { continuation } : {}) }, `${name}:${count}`) as TeamWeeklyReviewPage;
      if (page.exhausted) break;
      expect(page.nextOffset > offset || page.nextContinuation !== continuation).toBe(true);
      offset = page.nextOffset; continuation = page.nextContinuation;
      if (count === 99) throw new Error("SYNTHETIC_CONTINUATION_DID_NOT_EXHAUST");
    }
  }
}

// These tests inject runners only; they never invoke the real provider client.
describe("captured weekly review verifiable completion", () => {
  it.each(["read_weekly_sms", "read_weekly_human_calls", "read_weekly_ai_calls", "read_weekly_emails"])(
    "requires an explicit read of empty channel %s", async omit => {
      const run = vi.fn(async options => { await all(options, true, omit); return result(); });
      const status = await reviewTeamCommunicationSnapshot(snapshot(), { run, now });
      expect(run).toHaveBeenCalledTimes(1);
      expect(status).toMatchObject({ status: "incomplete", completeReview: false,
        coverage: { manifestRequested: true, completeDelivery: true, eligibleTotal: 0 } });
      expect(Object.values(status.coverage!.channels).filter(channel => !channel.checked)).toHaveLength(1);
      expect(status.warnings).toContain("communication_channel_review_incomplete");
    });

  it("requires the manifest even after all four channels were fully delivered", async () => {
    const status = await reviewTeamCommunicationSnapshot(snapshot([source()]), {
      run: async options => { await all(options, false); return result(); }, now,
    });
    expect(status).toMatchObject({ status: "incomplete", completeReview: false,
      coverage: { completeDelivery: true, manifestRequested: false } });
    expect(status.warnings).toContain("review_manifest_not_requested");
  });

  it("does not let trace acknowledgments, terminal offset skipping, or empty output establish delivery", async () => {
    const status = await reviewTeamCommunicationSnapshot(snapshot([source()]), {
      run: async options => {
        await options.backend.callTool("get_weekly_review_manifest", {}, "manifest");
        await options.onTrace?.({ stage: "tool_result_acknowledged", toolName: "read_weekly_sms" });
        for (const name of TEAM_WEEKLY_REVIEW_TOOL_NAMES.slice(1))
          await options.backend.callTool(name, { offset: 100, limit: 1 }, name);
        return result();
      }, now,
    });
    expect(status).toMatchObject({ status: "incomplete", completeReview: false,
      coverage: { deliveredEligibleCount: 0, pendingCount: 1, channels: { sms: { checked: true, exhausted: false } } } });
  });

  it.each(["undelivered", "outside_week", "unknown_week", "wrong_revision"])(
    "rejects literal candidate bound to %s evidence", async kind => {
      const item = source("sms:1", kind === "outside_week" ? { occurredAtUtc: "2026-10-01T15:00:00Z" }
        : kind === "unknown_week" ? { occurredAtUtc: null, observedAtUtc: null, timeBasis: "unknown" } : {});
      const proposed = candidate(item);
      if (kind === "wrong_revision") proposed.evidenceRevision = "b".repeat(64);
      const status = await reviewTeamCommunicationSnapshot(snapshot([item]), {
        run: async options => {
          if (kind !== "undelivered") await all(options);
          return result([proposed]);
        }, now,
      });
      expect(status).toMatchObject({ status: "incomplete", completeReview: false,
        error: { code: "WEEKLY_REVIEW_INVALID_CANDIDATE" },
        outcome: { candidates: [], rejectedCandidateCount: 1, validOutput: false } });
    });

  it("validates only actually delivered exact revisions while preserving matcher conflicts over the full snapshot", async () => {
    const a = source("same", { sessionId: "a" });
    const b = source("same", { sessionId: "b", revision: "b".repeat(64) });
    const read = snapshot([a, b]);
    const status = await reviewTeamCommunicationSnapshot(read, {
      run: async options => {
        await options.backend.callTool("get_weekly_review_manifest", {}, "manifest");
        await options.backend.callTool("read_weekly_sms", { offset: 0, limit: 1 }, "first");
        return result([candidate(a), candidate(b)]);
      }, now,
    });
    expect(status.outcome!.candidates).toEqual([candidate(a)]);
    expect(status.outcome!.rejectedCandidateCount).toBe(1);
    expect(status.outcome!.matches).toEqual(matchTeamComplaintCandidates([candidate(a)], read.sources.evidence, read.history, read.sources.window));
    expect(status.outcome!.visitGroups).toEqual(groupTeamComplaintVisits(status.outcome!.matches));
    expect(status.coverage).toMatchObject({ eligibleTotal: 1, deliveredEligibleCount: 0, pendingCount: 1 });
  });

  it("captures immutable input before progress, awaits meaningful progress and never exposes raw event/tool text", async () => {
    const read = snapshot([source()]), before = structuredClone(read);
    const reports: TeamWeeklyReviewStatus[] = [];
    const run = vi.fn(async options => {
      expect(reports[0].status).toBe("reviewing");
      await options.onTrace?.({ stage: "http_response", path: "/PRIVATE/PATH", status: 200 });
      await options.onEvent?.({ id: "usage", type: "session.usage" });
      expect(reports).toHaveLength(1);
      await options.onTrace?.({ stage: "session_created", sessionId: "sesn_Synthetic1" });
      await all(options);
      await options.onTrace?.({ stage: "tool_result_acknowledged", sessionId: "sesn_Synthetic1", toolName: "read_weekly_sms" });
      await options.onEvent?.({ id: "answer", type: "agent.message", texts: ["RAW PRIVATE TEXT"] });
      return result([candidate(before.sources.evidence[0])]);
    });
    const status = await reviewTeamCommunicationSnapshot(read, { run, now, onProgress: async value => {
      reports.push(structuredClone(value));
      read.sources.evidence[0].originalText = "Changed after capture";
      value.status = "failed"; value.progress.toolsStarted = 999;
      await Promise.resolve();
    } });
    expect(run).toHaveBeenCalledTimes(1);
    expect(status.status).toBe("completed");
    expect(status.progress.toolsStarted).toBe(0);
    expect(status.outcome!.candidates).toEqual([candidate(before.sources.evidence[0])]);
    expect(reports.at(-1)).toEqual(status);
    expect(reports.slice(0, -1).every(report => report.outcome === null)).toBe(true);
    expect(JSON.stringify(reports)).not.toMatch(/RAW PRIVATE TEXT|PRIVATE\/PATH|Changed after capture/);
    expect(status.outcome).toMatchObject({ publication: null, scoreResults: null, verifiedComplaintCount: null, verifiedRecleanRefundCount: null });
  });

  it.each(["INCOMPLETE_TURN", "UNKNOWN_POST_OUTCOME"])("reports final stopped state once without retry (%s)", async code => {
    const reports: TeamWeeklyReviewStatus[] = [];
    const run = vi.fn(async options => {
      await options.onTrace?.({ stage: "session_created", sessionId: "sesn_Synthetic1" });
      throw Object.assign(new Error("PRIVATE provider error"), { code });
    });
    const status = await reviewTeamCommunicationSnapshot(snapshot([source()]), { run, now,
      onProgress: value => { reports.push(value); } });
    expect(run).toHaveBeenCalledTimes(1);
    expect(status.status).toBe(code === "INCOMPLETE_TURN" ? "incomplete" : "failed");
    expect(reports.at(-1)).toEqual(status);
    expect(status.run.sessionId).toBe("sesn_Synthetic1");
    expect(status.outcome).toBeNull(); expect(status.completeReview).toBe(false);
    expect(JSON.stringify(reports)).not.toContain("PRIVATE");
  });

  it.each(["sources", "history", "missing_original"])("permits reviewable complete delivery while preserving incomplete %s provenance", async gap => {
    const read = snapshot(gap === "missing_original" ? [source("missing", { originalText: null, bodyBasis: "missing" })] : [source()]);
    if (gap === "sources") read.sources.collectionComplete = false;
    if (gap === "history") read.history.complete = false;
    const status = await reviewTeamCommunicationSnapshot(read, { now,
      run: async options => { await all(options); return result(); } });
    expect(status).toMatchObject({ status: "incomplete", completeReview: true, provenanceComplete: false,
      coverage: { manifestRequested: true, completeDelivery: true, providerCoverageComplete: false },
      outcome: { validOutput: true, publication: null, scoreResults: null } });
    expect(Object.values(status.coverage!.channels).every(channel => channel.checked && channel.exhausted)).toBe(true);
  });

  it.each(["initial", "session", "final"])("stops on failed asynchronous progress persistence at %s without callback/model retry", async stage => {
    let rejected = false;
    const progress = vi.fn(async (status: TeamWeeklyReviewStatus) => {
      if (rejected) throw new Error("UNEXPECTED_CALLBACK_RETRY");
      if (stage === "initial" || stage === "session" && status.run.sessionId !== null
        || stage === "final" && status.status === "completed") {
        rejected = true;
        throw new Error("PRIVATE persistence failure");
      }
    });
    const run = vi.fn(async (options: WeeklyCommunicationReviewOptions) => {
      await options.onTrace?.({ stage: "session_created", sessionId: "sesn_Synthetic1" });
      await all(options); return result();
    });
    await expect(reviewTeamCommunicationSnapshot(snapshot(), { run, now, onProgress: progress }))
      .rejects.toThrow("WEEKLY_REVIEW_RUN_FAILED");
    expect(rejected).toBe(true);
    expect(run).toHaveBeenCalledTimes(stage === "initial" ? 0 : 1);
    expect(progress).toHaveBeenCalledTimes(stage === "initial" ? 1 : stage === "session" ? 2 : 3);
  });

  it("stops before a model session when synchronous progress persistence fails", async () => {
    const run = vi.fn();
    const progress = vi.fn(() => { throw new Error("PRIVATE persistence failure"); });
    await expect(reviewTeamCommunicationSnapshot(snapshot(), { run, now, onProgress: progress }))
      .rejects.toThrow("WEEKLY_REVIEW_RUN_FAILED");
    expect(progress).toHaveBeenCalledTimes(1); expect(run).not.toHaveBeenCalled();
  });
});

describe("bounded retained original source-body continuation", () => {
  const longText = "The kitchen was dirty.\nEspañol 中文 😀 \\\"\t\r\n".repeat(13000) + "EXACT-END";

  it("preserves every character and original revision across bounded pages, with idempotent partial delivery", async () => {
    const originals = [source("long", { sourceKind: "human_call", sessionId: null, originalText: longText }),
      source("staff", { sourceKind: "human_call", sessionId: null, providerId: "provider-long", speakerBasis: "non_customer", originalText: "Exact staff response\n" }),
      source("tail", { sourceKind: "human_call", sessionId: null, providerId: "provider-long", originalText: "The kitchen was dirty. Exact later turn." })];
    const context = createTeamWeeklyReviewContext(snapshot(originals));
    expect(context.getCoverage().manifestRequested).toBe(false);
    expect(Object.values(context.getCoverage().channels).every(channel => !channel.checked && !channel.exhausted)).toBe(true);
    let page = await context.callTool("read_weekly_human_calls", { offset: 0, limit: 100 }, "first") as TeamWeeklyReviewPage;
    expect(page.nextContinuation).toBeTruthy(); expect(page.nextOffset).toBe(0); expect(page.exhausted).toBe(false);
    expect(page.returnedEligibleIds).toEqual([]);
    expect(context.getCoverage()).toMatchObject({ deliveredEligibleCount: 0, completeDelivery: false });
    expect(context.getDeliveredCandidateSources()).toEqual([]);
    expect(await context.callTool("read_weekly_human_calls", { offset: 0, limit: 100 }, "replay")).toEqual(page);
    const text = new Map<string, string>();
    const ranges = new Map<string, number>();
    for (let count = 0; count < 30; count++) {
      expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThanOrEqual(TEAM_WEEKLY_REVIEW_PAGE_BYTES);
      for (const entry of page.units.flatMap(unit => unit.sources)) {
        expect(entry.source.revision).toBe("a".repeat(64));
        if (entry.bodyRange) {
          expect(entry.bodyRange.start).toBe(ranges.get(entry.source.id) ?? 0);
          expect(entry.bodyRange.end - entry.bodyRange.start).toBe(entry.source.originalText!.length);
          ranges.set(entry.source.id, entry.bodyRange.end);
        }
        text.set(entry.source.id, (text.get(entry.source.id) ?? "") + entry.source.originalText);
      }
      if (page.exhausted) break;
      const input = { offset: page.nextOffset, limit: 100, ...(page.nextContinuation ? { continuation: page.nextContinuation } : {}) };
      page = await context.callTool("read_weekly_human_calls", input, `part-${count}`) as TeamWeeklyReviewPage;
      if (count === 29) throw new Error("SYNTHETIC_BODY_DID_NOT_EXHAUST");
    }
    expect(text).toEqual(new Map(originals.map(item => [item.id, item.originalText])));
    expect(page.nextOffset).toBe(1); expect(page.nextContinuation).toBeUndefined();
    expect(context.getCoverage()).toMatchObject({ eligibleTotal: 2, deliveredEligibleCount: 2, completeDelivery: true,
      channels: { human_calls: { checked: true, exhausted: true, deliveredGroups: 1 } } });
    expect(context.getDeliveredCandidateSources()).toEqual([originals[0], originals[2]]);
    expect(context.getSources()).toEqual(originals);
  });

  it("rejects unknown/cross-channel/mismatched-offset continuation and getter input without advancing delivery", async () => {
    const context = createTeamWeeklyReviewContext(snapshot([source("long", { originalText: longText })]));
    const page = await context.callTool("read_weekly_sms", { offset: 0, limit: 1 }, "first") as TeamWeeklyReviewPage;
    const before = context.getCoverage();
    for (const [name, input] of [
      ["read_weekly_sms", { offset: 0, limit: 1, continuation: "invented" }],
      ["read_weekly_sms", { offset: 1, limit: 1, continuation: page.nextContinuation }],
      ["read_weekly_emails", { offset: 0, limit: 1, continuation: page.nextContinuation }],
      ["get_weekly_review_manifest", { continuation: page.nextContinuation }],
    ] as const) await expect(context.callTool(name, input, "invalid")).rejects.toThrow(/WEEKLY_REVIEW_INVALID/);
    const getter = vi.fn(() => page.nextContinuation);
    await expect(context.callTool("read_weekly_sms", { offset: 0, limit: 1, get continuation() { return getter(); } }, "getter")).rejects.toThrow("WEEKLY_REVIEW_INVALID_INPUT");
    expect(getter).not.toHaveBeenCalled(); expect(context.getCoverage()).toEqual(before);
  });

  it.each([false, true])("accepts a long-body candidate only after all source slices were returned (complete %s)", async complete => {
    const item = source("long", { originalText: longText });
    const status = await reviewTeamCommunicationSnapshot(snapshot([item]), { now,
      run: async options => {
        if (complete) await all(options);
        else await options.backend.callTool("read_weekly_sms", { offset: 0, limit: 1 }, "partial");
        return result([candidate(item)]);
      } });
    expect(status.completeReview).toBe(complete);
    expect(status.outcome!.candidates).toEqual(complete ? [candidate(item)] : []);
    expect(status.outcome!.rejectedCandidateCount).toBe(complete ? 0 : 1);
    expect(status.coverage!.deliveredEligibleCount).toBe(complete ? 1 : 0);
  });

  it("bounds a huge same-session chronology without losing original turns or inventing a new tool", async () => {
    const items = Array.from({ length: 150 }, (_, i) => source(`turn-${i.toString().padStart(3, "0")}`,
      { sessionId: "one-session", originalText: `Exact turn ${i}\n` + "body ".repeat(600) }));
    const context = createTeamWeeklyReviewContext(snapshot(items));
    const delivered: TeamEvidence[] = [];
    let offset = 0, continuation: string | undefined;
    for (let count = 0; count < 30; count++) {
      const page = await context.callTool("read_weekly_sms", { offset, limit: 100, ...(continuation ? { continuation } : {}) }, `page-${count}`) as TeamWeeklyReviewPage;
      expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThanOrEqual(TEAM_WEEKLY_REVIEW_PAGE_BYTES);
      for (const entry of page.units.flatMap(unit => unit.sources)) {
        const previous = delivered.at(-1);
        if (previous?.id === entry.source.id) previous.originalText += entry.source.originalText!;
        else delivered.push(structuredClone(entry.source));
      }
      if (page.exhausted) break;
      expect(page.nextOffset).toBe(0);
      offset = page.nextOffset; continuation = page.nextContinuation;
      if (count === 29) throw new Error("SYNTHETIC_CHRONOLOGY_DID_NOT_EXHAUST");
    }
    expect(delivered).toEqual(items);
    expect(context.getCoverage()).toMatchObject({ eligibleTotal: 150, deliveredEligibleCount: 150, completeDelivery: true });
    expect(context.tools.map(tool => tool.name)).toEqual(TEAM_WEEKLY_REVIEW_TOOL_NAMES);
  });

  it("has no added runtime capabilities or legacy-table dependency", () => {
    for (const name of ["teamWeeklyReviewContext.ts", "teamWeeklyReviewService.ts", "teamWeeklyReviewCompletion.test.ts"]) {
      const implementation = readFileSync(new URL(name, import.meta.url), "utf8");
      expect(implementation).not.toContain(["cleaner", "jobs"].join("_"));
      expect(implementation).not.toContain(["cleaner", "Jobs"].join(""));
    }
  });
});
