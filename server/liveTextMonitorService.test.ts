import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import type { AuditCandidate, AuditMessage, AuditRecord } from "../shared/dailyActionAudit";
import type { LiveTextContext } from "../shared/liveTextMonitor";
const mocks = vi.hoisted(() => ({ agent: vi.fn(), feed: vi.fn(), context: vi.fn(), records: vi.fn(), model: vi.fn() }));
vi.mock("./_core/agentAuth", () => ({ getAgentFromRequest: mocks.agent }));
vi.mock("./liveTextMonitorData", () => ({ readLiveTextFeed: mocks.feed, readLiveTextContext: mocks.context }));
vi.mock("./dailyActionAuditData", () => ({ readLeadFlowAuditRecords: mocks.records }));
vi.mock("./_core/llm", () => ({ invokeLLM: mocks.model }));
import { checkLiveText, createLiveTextInterpretCache, getLiveTextFeed, type LiveTextMonitorDependencies } from "./liveTextMonitorService";
import { liveTextCheckInputSchema, liveTextMonitorRouter } from "./liveTextMonitorRouter";
import { interpretAuditThreads } from "./dailyActionAuditInterpret";
import { verifyAuditCandidates } from "./dailyActionAuditEngine";
import { checkAndSyncLiveText, createLiveTextAutoSyncCache } from "./liveTextMonitorAutoSync";
import { syncAndCheckLiveText, type LiveTextSyncDependencies } from "./liveTextMonitorSync";
import type { InvokeParams, InvokeResult } from "./_core/llm";

const now = new Date("2026-11-13T18:00:00.000Z");
const customerPhone = "+13015550123";
const sessionTextKey = (label: string) => `session-text:${createHash("sha256").update(label).digest("hex")}`;
const checkInput = { sessionId: 7, messageKey: sessionTextKey("target") };
function message(overrides: Partial<AuditMessage> = {}): AuditMessage {
  return { key: checkInput.messageKey, sessionId: 7, customerPhone, businessPhone: "+13015550456", direction: "inbound",
    text: "Please move booking LF-TEST to November 16, 2026 at 9am.", occurredAt: "2026-11-13T15:00:00.000Z",
    observedAt: null, timeBasis: "history", delivery: "received", source: "conversation_history", ...overrides };
}
function context(target = message(), messages = [target], partial = false): LiveTextContext {
  return { row: { key: target.key, sessionId: 7, revision: "revision-1", customerName: null, message: target, identityAmbiguous: false }, messages, partial };
}
function record(source: AuditRecord["source"], overrides: Partial<AuditRecord> = {}): AuditRecord {
  return { key: source === "bookings" ? "booking:1" : "job:2", source, bookingId: 1, jobId: source === "leadflow_jobs" ? 2 : null,
    publicBookingNumber: "LF-TEST", seriesId: null, customerPhone, customerName: "Fixture Customer", date: "2026-11-16", time: "09:00",
    timeZone: "America/New_York", status: "confirmed", address: "123 Fixture Street", serviceName: "Standard Cleaning", extras: [], teamName: "Fixture Team",
    recurrence: "one-time", paymentStatus: null, paidAmountCents: null, ...overrides };
}
const expected: AuditCandidate["expected"] = { bookingReference: "LF-TEST", date: "2026-11-16", originalDate: null,
  time: "09:00", timeKind: "exact", windowEnd: null, scope: "visit", address: null, serviceName: null, extras: null,
  extrasMode: "unspecified", teamName: null, amountCents: null };
function prediction(owner: any, overrides: Partial<Omit<AuditCandidate, "id">> = {}) {
  return { threadKey: owner.key, action: "reschedule", agreement: "requested", anchorMessageKey: owner.messages[0].key,
    evidenceKeys: [owner.messages[0].key], expected, explanation: "Move the cleaning to November 16 at 9am.", confidence: 0.95,
    supersededByMessageKey: null, ambiguous: false, ...overrides };
}
function response(actions: unknown[]): InvokeResult {
  return { id: "offline", created: 0, model: "offline-fixture", choices: [{ index: 0, finish_reason: "stop",
    message: { role: "assistant", content: JSON.stringify({ actions }) } }] };
}
function model(actions: (owner: any) => unknown[] = owner => [prediction(owner)]) {
  return vi.fn(async (params: InvokeParams) => {
    const payload = JSON.parse(params.messages[1].content as string);
    expect(payload.threads).toHaveLength(1);
    return response(actions(payload.threads[0]));
  });
}
function dependencies(source = context(), call = model()): LiveTextMonitorDependencies {
  return { now: () => now, cache: createLiveTextInterpretCache(),
    feed: vi.fn(async () => ({ rows: [source.row], checkedAt: now.toISOString(), partial: false, unavailable: false })),
    context: vi.fn(async () => source),
    records: vi.fn(async () => ({ records: [record("bookings"), record("leadflow_jobs")], warnings: [], truncated: false, incompleteThreadKeys: [] })),
    interpret: vi.fn(interpretAuditThreads), model: call, verify: vi.fn(verifyAuditCandidates) };
}
beforeEach(() => {
  vi.clearAllMocks(); mocks.agent.mockResolvedValue(null);
  const d = dependencies(); mocks.feed.mockImplementation(d.feed); mocks.context.mockImplementation(d.context);
  mocks.records.mockImplementation(d.records); mocks.model.mockImplementation(model());
});

describe("Live text exact stored session row checks", () => {
  it("thanks is no action only after a complete actual interpretation", async () => {
    const source = context(message({ text: "Thanks!" })); const call = model(() => []); const d = dependencies(source, call);
    const result = await checkLiveText(checkInput, d);
    expect(result).toMatchObject({ required: "no", verified: "not_applicable", summary: "No action required.", actions: [] });
    expect(call).toHaveBeenCalledTimes(1); expect(d.records).not.toHaveBeenCalled();
  });
  it.each(["unknown", "failed"] as const)("%s outgoing informational stored texts require no action after actual interpretation", async delivery => {
    for (const text of ["Please leave us a review after your cleaning.", "I'm on my way.", "Thanks!"]) {
      const target = message({ direction: "outbound", delivery, text }); const d = dependencies(context(target), model(() => []));
      const result = await checkLiveText(checkInput, d);
      expect(result).toMatchObject({ required: "no", verified: "not_applicable", actions: [], analysis: { status: "complete" } });
      expect(d.interpret).toHaveBeenCalledWith(expect.objectContaining({ evidenceMode: "recorded", records: [] }), expect.any(Function));
      expect(d.model).toHaveBeenCalledTimes(1); expect(d.records).not.toHaveBeenCalled(); expect(d.verify).not.toHaveBeenCalled();
      expect(result.conversation).toEqual([target]); expect(target).toMatchObject({ delivery, direction: "outbound", timeBasis: "history", observedAt: null });
    }
  });
  it.each(["09:00", "11:00"])("compares requested 9 AM with actual fresh %s using the actual verifier", async time => {
    const d = dependencies(); d.records = vi.fn(async () => ({ records: [record("bookings"), record("leadflow_jobs", { time })], warnings: [], truncated: false, incompleteThreadKeys: [] }));
    const result = await checkLiveText(checkInput, d);
    expect(result.required).toBe("yes"); expect(result.verified).toBe(time === "09:00" ? "yes" : "no");
    expect(result.actions[0].summary).toBe("Reschedule cleaning to Nov 16, 2026 at 9:00 AM");
    expect(result.actions[0].syncServiceDate).toBe("2026-11-16");
    expect(result.evidence).toContain("Booking LF-TEST (booking:1)"); expect(result.evidence).toContain(`time ${time === "09:00" ? "9:00 AM" : "11:00 AM"}`);
    expect(result.evidence).not.toMatch(/historical completion|captured evidence identifies|when changes were made|charge events/i);
    expect(result.evidence).not.toMatch(/123 Fixture Street|Standard Cleaning|Fixture Team|payment state/);
    expect(d.verify).toHaveBeenCalledWith(expect.objectContaining({ evidenceMode: "recorded", records: expect.any(Array) }));
  });
  it("preserves exact stored history text, timestamp, and session metadata for recorded verification", async () => {
    const target = message({ businessPhone: null }); const source = context(target); const d = dependencies(source);
    const result = await checkLiveText(checkInput, d);
    expect(result).toMatchObject({ rowKey: checkInput.messageKey, required: "yes", verified: "yes" });
    expect(d.context).toHaveBeenCalledWith(checkInput.sessionId, checkInput.messageKey);
    expect(vi.mocked(d.interpret).mock.calls[0][0].threads[0].messages).toEqual([target]);
    expect(vi.mocked(d.verify).mock.calls[0][0].threads[0].messages).toEqual([target]);
    expect(result.conversation).toEqual([target]); expect(source.messages).toEqual([target]);
    expect(target).toMatchObject({ sessionId: 7, source: "conversation_history", timeBasis: "history", delivery: "received", observedAt: null });
  });
  it.each(["09:00", "11:00"])("explicit target in a long session's complete AI Team last-20 window compares fresh %s", async time => {
    const target = message();
    // The reader supplies the complete authorized recent window, not the older
    // history. A longer session alone does not make this context partial.
    const recent = Array.from({ length: 19 }, (_, index) => message({ key: sessionTextKey(`recent:${index}`), text: "Informational context." })).concat(target);
    const source = context(target, recent, false);
    const d = dependencies(source, model(owner => [prediction(owner, { anchorMessageKey: target.key, evidenceKeys: [target.key] })]));
    d.records = vi.fn(async () => ({ records: [record("bookings"), record("leadflow_jobs", { time })], warnings: [], truncated: false, incompleteThreadKeys: [] }));
    const result = await checkLiveText(checkInput, d);
    expect(result.required).toBe("yes"); expect(result.verified).toBe(time === "09:00" ? "yes" : "no");
    expect(result.summary).toContain("9:00 AM"); expect(result.conversation).toEqual(recent);
    expect(vi.mocked(d.interpret).mock.calls[0][0].threads[0]).toMatchObject({ truncated: false, messages: recent });
    expect(d.model).toHaveBeenCalledTimes(1);
  });
  it("contextual model ambiguity still needs review inside a complete recent session window", async () => {
    const target = message(); const prior = message({ key: sessionTextKey("ambiguous-context"), text: "I may mean a different visit." });
    const d = dependencies(context(target, [prior, target], false), model(owner => [prediction(owner, {
      anchorMessageKey: target.key, evidenceKeys: [prior.key, target.key], ambiguous: true,
    })]));
    const result = await checkLiveText(checkInput, d);
    expect(result).toMatchObject({ required: "review", verified: "review" });
    expect(result.summary).toContain("9:00 AM"); expect(result.actions[0].records).toHaveLength(2);
    expect(result.actions[0].syncServiceDate).toBeNull();
    expect(vi.mocked(d.verify).mock.calls[0][0].candidates[0].ambiguous).toBe(true);
  });
  it("one foreground future-date check retains usable partial analysis across all internal sync checks", async () => {
    const target = message({ direction: "outbound", delivery: "unknown", text: "LF-TEST is confirmed at 9 AM on November 16, 2026." });
    const source = context(target, [target], true), d = dependencies(source);
    let time = "09:00";
    d.records = vi.fn(async () => ({ records: [record("bookings"), record("leadflow_jobs", { time })], warnings: [], truncated: false, incompleteThreadKeys: [] }));
    const check: LiveTextSyncDependencies["check"] = input => checkLiveText(input, d);
    const fetchSource = vi.fn<LiveTextSyncDependencies["source"]>(async date => ({ date, fetched: 1,
      bookings: [{}] as Awaited<ReturnType<LiveTextSyncDependencies["source"]>>["bookings"] }));
    const persist = vi.fn<LiveTextSyncDependencies["persist"]>(async () => ({ complete: true, created: 0, updated: 1, protectedRecords: 0, refreshedJobIds: [2] }));
    const sync: typeof syncAndCheckLiveText = input => syncAndCheckLiveText(input, { check, context: d.context, source: fetchSource,
      persist, now: d.now, locks: new Set() });
    const result = await checkAndSyncLiveText(checkInput, { check, sync, now: d.now, cache: createLiveTextAutoSyncCache() });
    expect(result).toMatchObject({ required: "yes", verified: "yes", analysis: { status: "partial", failure: "PARTIAL_CONTEXT" },
      syncs: [expect.objectContaining({ date: "2026-11-16", complete: true })] });
    expect(d.model).toHaveBeenCalledTimes(1); expect(d.interpret).toHaveBeenCalledTimes(1); expect(d.cache.size).toBe(1);
    expect(d.records).toHaveBeenCalledTimes(4); expect(fetchSource).toHaveBeenCalledTimes(1); expect(persist).toHaveBeenCalledTimes(1);
    time = "11:00";
    expect(await check(checkInput)).toMatchObject({ required: "yes", verified: "no", analysis: { status: "partial" } });
    expect(d.records).toHaveBeenCalledTimes(5); expect(d.model).toHaveBeenCalledTimes(1); expect(d.interpret).toHaveBeenCalledTimes(1);
  });
  it("an explicit stored 9 AM target in partial context remains Yes/Yes with a partial-analysis caveat", async () => {
    const target = message({ direction: "outbound", delivery: "unknown", text: "LF-TEST is confirmed at 9 AM on November 16, 2026." });
    const d = dependencies(context(target, [target], true), model(owner => [prediction(owner, { agreement: "confirmed" })]));
    const result = await checkLiveText(checkInput, d);
    expect(result).toMatchObject({ required: "yes", verified: "yes", analysis: { status: "partial", failure: "PARTIAL_CONTEXT" }, conversation: [target] });
    expect(result.actions).toHaveLength(1); expect(result.actions[0].syncServiceDate).toBe("2026-11-16");
    await expect(vi.mocked(d.interpret).mock.results[0].value).resolves.toMatchObject({ threadsAnalyzed: 0, failedThreads: 1, failure: "PARTIAL_CONTEXT",
      candidates: [expect.objectContaining({ ambiguous: false, anchorMessageKey: target.key, expected: expect.objectContaining({ time: "09:00" }) })] });
    expect(d.records).toHaveBeenCalledTimes(1); expect(d.verify).toHaveBeenCalledTimes(1);
    expect(vi.mocked(d.verify).mock.calls[0][0].threads[0].messages).toEqual([target]);
  });
  it("known ambiguous outgoing meaning remains Review despite failed delivery and exact matching records", async () => {
    const target = message({ direction: "outbound", delivery: "failed", text: "We'll move LF-TEST to November 16 at 9, but I may mean another visit." });
    const d = dependencies(context(target), model(owner => [prediction(owner, { agreement: "confirmed", ambiguous: true })]));
    const result = await checkLiveText(checkInput, d);
    expect(result).toMatchObject({ required: "review", verified: "review", analysis: { status: "complete" } });
    expect(result.actions[0].records).toHaveLength(2); expect(result.actions[0].syncServiceDate).toBeNull();
  });
  it("changed job date is no, not a current match", async () => {
    const d = dependencies(); d.records = vi.fn(async () => ({ records: [record("bookings"), record("leadflow_jobs", { date: "2026-11-17" })], warnings: [], truncated: false, incompleteThreadKeys: [] }));
    const result = await checkLiveText(checkInput, d);
    expect(result.verified).toBe("no"); expect(result.evidence).toContain("Scheduled date differs from the request.");
    expect(result.evidence).toContain("Nov 17, 2026");
  });
  it("ignores context-only candidates instead of making another message this row's action", async () => {
    const target = message({ text: "Thanks!" }); const earlier = message({ key: sessionTextKey("earlier"), text: "Please move booking LF-TEST to November 16, 2026 at 9am." });
    const source = context(target, [earlier, target]); const call = model(owner => [prediction(owner, { anchorMessageKey: sessionTextKey("earlier"), evidenceKeys: [sessionTextKey("earlier")] })]);
    const d = dependencies(source, call); const result = await checkLiveText(checkInput, d);
    expect(result).toMatchObject({ required: "no", verified: "not_applicable", actions: [] }); expect(d.records).not.toHaveBeenCalled();
  });
  it("only returns target actions when several same-day messages have actions", async () => {
    const target = message(); const earlier = message({ key: sessionTextKey("earlier"), text: "Cancel another visit." });
    const d = dependencies(context(target, [earlier, target]), model(owner => [prediction(owner, { anchorMessageKey: sessionTextKey("earlier"), evidenceKeys: [sessionTextKey("earlier")], action: "cancel" }), prediction(owner, { anchorMessageKey: target.key, evidenceKeys: [target.key] })]));
    const result = await checkLiveText(checkInput, d); expect(result.actions).toHaveLength(1); expect(result.actions[0].type).toBe("reschedule");
    expect(d.records).toHaveBeenCalledWith(expect.objectContaining({ candidates: [expect.objectContaining({ anchorMessageKey: target.key })] }));
  });
  it("actual verifier rejects a wrong-customer linked job, even with the same booking reference", async () => {
    const d = dependencies(); d.records = vi.fn(async () => ({ records: [record("bookings"), record("leadflow_jobs", { customerPhone: "+13015550999" })], warnings: [], truncated: false, incompleteThreadKeys: [] }));
    const result = await checkLiveText(checkInput, d);
    expect(result.required).toBe("yes"); expect(result.verified).toBe("review"); expect(result.actions[0].records).toEqual([]);
    expect(result.evidence).toContain("Record customer does not match this text.");
  });
  it("conflicting names cannot be arbitrarily chosen for the same phone", async () => {
    const d = dependencies(); d.records = vi.fn(async () => ({ records: [record("bookings"), record("leadflow_jobs", { customerName: "Other Household" })], warnings: [], truncated: false, incompleteThreadKeys: [] }));
    const result = await checkLiveText(checkInput, d); expect(result.verified).toBe("review"); expect(result.evidence).toContain("Customer identity needs review."); expect(result.actions[0].records).toEqual([]);
  });
  it("unknown requested date is review, never false no or an invented date", async () => {
    const target = message({ text: "Please move my cleaning." });
    const d = dependencies(context(target), model(owner => [prediction(owner, { expected: { ...expected, date: null, time: null, timeKind: "unspecified" } })]));
    const result = await checkLiveText(checkInput, d); expect(result.required).toBe("yes"); expect(result.verified).toBe("review");
    expect(result.summary).toContain("date needs review"); expect(result.evidence).toContain("Requested date is unclear.");
  });
  it("unknown occurrence and observed date requires review before model use", async () => {
    const target = message({ occurredAt: "2026-11-13T10:00:00", observedAt: null, timeBasis: "unknown" }); const d = dependencies(context(target));
    const result = await checkLiveText(checkInput, d); expect(result).toMatchObject({ required: "review", verified: "review", summary: "Text timing needs review." }); expect(d.interpret).not.toHaveBeenCalled();
  });
  it("missing stored history timestamp stays review without inventing a model turn or date", async () => {
    const target = message({ occurredAt: null, observedAt: null, timeBasis: "unknown" }); const d = dependencies(context(target));
    const result = await checkLiveText(checkInput, d);
    expect(result).toMatchObject({ required: "review", verified: "review", summary: "Text timing needs review.", conversation: [target] });
    expect(d.model).not.toHaveBeenCalled(); expect(d.records).not.toHaveBeenCalled();
  });
  it("uses target observed UTC day zoned Eastern rather than today or a daily scan", async () => {
    const target = message({ occurredAt: null, observedAt: "2026-11-13T02:00:00.000Z", timeBasis: "received", text: "Thanks" });
    const d = dependencies(context(target), model(() => [])); await checkLiveText(checkInput, d);
    expect(d.interpret).toHaveBeenCalledWith(expect.objectContaining({ auditDate: "2026-11-12", timeZone: "America/New_York", records: [] }), expect.any(Function));
  });
  it("uses trustworthy occurrence rather than later observed day", async () => {
    const target = message({ occurredAt: "2026-11-12T15:00:00.000Z", observedAt: "2026-11-13T15:00:00.000Z", timeBasis: "provider" });
    const d = dependencies(context(target)); await checkLiveText(checkInput, d);
    expect(d.interpret).toHaveBeenCalledWith(expect.objectContaining({ auditDate: "2026-11-12" }), expect.any(Function));
  });
  it("inaccessible current DB preserves known action summary, not absence/no", async () => {
    const d = dependencies(); d.records = vi.fn(async () => { throw new Error("SELECT SECRET TOKEN SQL"); });
    const result = await checkLiveText(checkInput, d);
    expect(result).toMatchObject({ required: "yes", verified: "review", summary: "Reschedule cleaning to Nov 16, 2026 at 9:00 AM" });
    expect(result.evidence).toContain("Current records are unavailable."); expect(JSON.stringify(result)).not.toMatch(/SECRET|SELECT|TOKEN|No matching booking/);
  });
  it("reader's caught DB failure also remains review", async () => {
    const d = dependencies(); d.records = vi.fn(async () => ({ records: [], warnings: ["private source details"], truncated: true, incompleteThreadKeys: ["any"] }));
    const result = await checkLiveText(checkInput, d); expect(result.required).toBe("yes"); expect(result.verified).toBe("review"); expect(result.evidence).toContain("Current record coverage is incomplete."); expect(JSON.stringify(result)).not.toContain("private source details");
  });
  it("a genuine model error reports fixed unavailable analysis, never a no-action finding or private error", async () => {
    const call = vi.fn(async () => { throw new Error("PRIVATE LLM ERROR"); }); const d = dependencies(context(), call);
    const result = await checkLiveText(checkInput, d);
    expect(result).toMatchObject({ required: "review", verified: "review", actions: [], summary: "Text analysis is unavailable.",
      evidence: "The action has not been determined; current records were not checked.", analysis: { status: "unavailable", failure: "MODEL_UNAVAILABLE" } });
    expect(call).toHaveBeenCalledTimes(1); expect(d.records).not.toHaveBeenCalled(); expect(d.verify).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toMatch(/PRIVATE|No action required/); expect(d.cache.size).toBe(0);
  });
  it("discarded or omitted invalid source evidence cannot produce a successful no-action result", async () => {
    const d = dependencies(context(), model(owner => [prediction(owner, { evidenceKeys: ["fabricated"] })]));
    const result = await checkLiveText(checkInput, d);
    expect(result).toMatchObject({ required: "review", verified: "review", actions: [], analysis: { status: "unavailable", failure: "INVALID_SOURCE_REFERENCE" } });
    expect(d.records).not.toHaveBeenCalled(); expect(d.verify).not.toHaveBeenCalled();
  });
  it.each(["json", "envelope", "content", "length", "choices"])("malformed model %s remains unavailable, never no or private response prose", async malformed => {
    const reply = response([]);
    if (malformed === "json") reply.choices[0].message.content = "PRIVATE malformed JSON";
    if (malformed === "envelope") reply.choices[0].message.content = JSON.stringify({ private: "PRIVATE response" });
    if (malformed === "content") reply.choices[0].message.content = null as any;
    if (malformed === "length") reply.choices[0].finish_reason = "length";
    if (malformed === "choices") reply.choices = [];
    const d = dependencies(context(), vi.fn(async () => reply)); const result = await checkLiveText(checkInput, d);
    expect(result).toMatchObject({ required: "review", verified: "review", actions: [], summary: "The AI returned an unreadable analysis.",
      analysis: { status: "unavailable", failure: "INVALID_MODEL_RESPONSE" } });
    expect(JSON.stringify(result)).not.toMatch(/PRIVATE|No action required/); expect(d.cache.size).toBe(0);
    expect(d.records).not.toHaveBeenCalled(); expect(d.verify).not.toHaveBeenCalled();
  });
  it("an invalid model action stays safely undetermined instead of becoming no action", async () => {
    const d = dependencies(context(), model(owner => [prediction(owner, { expected: { ...expected, date: "2026-02-30" } })]));
    const result = await checkLiveText(checkInput, d);
    expect(result).toMatchObject({ required: "review", verified: "review", actions: [], analysis: { status: "unavailable", failure: "INVALID_ACTION" } });
    expect(d.records).not.toHaveBeenCalled(); expect(d.cache.size).toBe(0);
  });
  it.each(["anchor", "omittedAnchor", "correction", "thread"])("invalid %s source reference cannot become an action or no-action proof", async invalid => {
    const d = dependencies(context(), model(owner => [prediction(owner, invalid === "anchor" ? { anchorMessageKey: "fabricated" }
      : invalid === "omittedAnchor" ? { evidenceKeys: [sessionTextKey("context-only")] }
      : invalid === "correction" ? { supersededByMessageKey: "fabricated" } : { threadKey: "fabricated" })]));
    const result = await checkLiveText(checkInput, d);
    expect(result).toMatchObject({ required: "review", verified: "review", actions: [], analysis: { failure: "INVALID_SOURCE_REFERENCE" } });
    expect(d.records).not.toHaveBeenCalled(); expect(d.verify).not.toHaveBeenCalled();
  });
  it("duplicate cited evidence cannot verify an outgoing stored action even if the records match", async () => {
    const target = message({ direction: "outbound", delivery: "failed" });
    const d = dependencies(context(target), model(owner => [prediction(owner, { evidenceKeys: [target.key, target.key] })]));
    const result = await checkLiveText(checkInput, d);
    expect(result.required).toBe("yes"); expect(result.verified).toBe("review"); expect(result.actions[0].records).toEqual([]);
    expect(vi.mocked(d.verify).mock.results[0].value[0].verification).toContain("Duplicate evidence keys");
  });
  it("partial context never becomes no-action proof even when the recorded target is informational", async () => {
    const target = message({ text: "Thanks" }); const d = dependencies(context(target, [target], true), model(() => []));
    const result = await checkLiveText(checkInput, d);
    expect(result).toMatchObject({ required: "review", verified: "review", actions: [], analysis: { failure: "PARTIAL_CONTEXT" } });
    expect(d.records).not.toHaveBeenCalled();
  });
  it.each(["unknown", "failed", "sent", "delivered"])("%s recorded outbound context cannot fabricate confirmation or suppress the selected inbound target", async delivery => {
    const target = message(); const draft = message({ key: sessionTextKey("draft"), direction: "outbound",
      text: "Your booking LF-TEST has been moved to November 16, 2026 at 11am.",
      occurredAt: "2026-11-13T16:00:00.000Z", delivery: delivery as AuditMessage["delivery"] });
    const d = dependencies(context(target, [target, draft]), model(owner => [prediction(owner, {
      agreement: "confirmed", evidenceKeys: [target.key, draft.key], supersededByMessageKey: draft.key,
    }), prediction(owner, { anchorMessageKey: draft.key, evidenceKeys: [draft.key], agreement: "confirmed", expected: { ...expected, time: "11:00" } })]));
    d.records = vi.fn(async () => ({ records: [record("bookings"), record("leadflow_jobs", { time: "11:00" })], warnings: [], truncated: false, incompleteThreadKeys: [] }));
    const result = await checkLiveText(checkInput, d);
    expect(result.required).toBe("yes"); expect(result.verified).toBe("no"); expect(result.actions).toHaveLength(1);
    expect(result.summary).toContain("9:00 AM"); expect(result.evidence).toContain("Scheduled time differs from the request.");
    expect(result.conversation).toEqual([target, draft]);
    expect(vi.mocked(d.verify).mock.results[0].value[0]).toMatchObject({ agreement: "requested", status: "needs_action" });
  });
  it.each(["unknown", "failed"] as const)("%s outgoing scheduling confirmation is an action whose stored 9 AM target compares current records without metadata rewrites", async delivery => {
    for (const time of ["09:00", "11:00"]) {
      const target = message({ direction: "outbound", delivery, text: "LF-TEST is confirmed at 9 AM on November 16, 2026." });
      const source = context(target); const original = JSON.parse(JSON.stringify(source));
      const d = dependencies(source, model(owner => [prediction(owner, { agreement: "confirmed" })]));
      d.records = vi.fn(async () => ({ records: [record("bookings"), record("leadflow_jobs", { time })], warnings: [], truncated: false, incompleteThreadKeys: [] }));
      const result = await checkLiveText(checkInput, d);
      expect(result).toMatchObject({ required: "yes", verified: time === "09:00" ? "yes" : "no", analysis: { status: "complete" } });
      expect(result.actions).toHaveLength(1); expect(result.summary).toContain("9:00 AM"); expect(result.conversation).toEqual([target]);
      expect(d.model).toHaveBeenCalledTimes(1); expect(d.records).toHaveBeenCalledTimes(1); expect(d.verify).toHaveBeenCalledTimes(1);
      expect(vi.mocked(d.interpret).mock.calls[0][0].threads[0].messages).toEqual([target]);
      expect(vi.mocked(d.verify).mock.calls[0][0]).toMatchObject({ evidenceMode: "recorded", threads: [{ messages: [target] }] });
      const item = vi.mocked(d.verify).mock.results[0].value[0];
      expect(item).toMatchObject({ agreement: "requested", status: time === "09:00" ? "matches" : "needs_action", evidence: [target] });
      expect(item.verification).toContain("recorded text does not prove sent confirmation, historical completion");
      expect(source).toEqual(original); expect(target).toMatchObject({ direction: "outbound", delivery, timeBasis: "history", observedAt: null, source: "conversation_history" });
    }
  });
  it("does not claim a paid charge based on captured text or delivery", async () => {
    const target = message({ text: "I paid $100 for LF-TEST." });
    const d = dependencies(context(target), model(owner => [prediction(owner, { action: "payment", expected: { ...expected, time: null, timeKind: "unspecified", amountCents: 10000 } })]));
    const result = await checkLiveText(checkInput, d); expect(result.verified).toBe("review"); expect(result.summary).toContain("Check payment"); expect(result.evidence).toContain("paid amount unknown");
  });
  it("actual persisted amount and captured status, not an SMS claim, determine payment yes/no", async () => {
    const target = message({ text: "I paid $100 for LF-TEST." });
    const d = dependencies(context(target), model(owner => [prediction(owner, { action: "payment", expected: { ...expected, time: null, timeKind: "unspecified", amountCents: 10000 } })]));
    d.records = vi.fn(async () => ({ records: [record("bookings", { paymentStatus: "captured", paidAmountCents: 10000 })], warnings: [], truncated: false, incompleteThreadKeys: [] }));
    const result = await checkLiveText(checkInput, d); expect(result.verified).toBe("yes"); expect(result.evidence).toContain("payment state captured");
  });
  it.each([
    { paymentStatus: "paid", paidAmountCents: 10000, verified: "yes" },
    { paymentStatus: "captured", paidAmountCents: 10000, verified: "yes" },
    { paymentStatus: "paid", paidAmountCents: 11000, verified: "no" },
    { paymentStatus: "authorized", paidAmountCents: 10000, verified: "no" },
    { paymentStatus: "paid", paidAmountCents: null, verified: "review" },
    { paymentStatus: null, paidAmountCents: 10000, verified: "review" },
  ] as const)("outgoing payment claim uses only persisted status $paymentStatus and amount $paidAmountCents for $verified", async ({ paymentStatus, paidAmountCents, verified }) => {
    const target = message({ direction: "outbound", delivery: "failed", text: "We received your $100 payment for LF-TEST." });
    const d = dependencies(context(target), model(owner => [prediction(owner, { action: "payment", agreement: "confirmed",
      expected: { ...expected, time: null, timeKind: "unspecified", amountCents: 10000 } })]));
    d.records = vi.fn(async () => ({ records: [record("bookings", { paymentStatus, paidAmountCents })], warnings: [], truncated: false, incompleteThreadKeys: [] }));
    const result = await checkLiveText(checkInput, d);
    expect(result).toMatchObject({ required: "yes", verified }); expect(result.summary).toContain("$100.00");
    expect(vi.mocked(d.verify).mock.results[0].value[0].agreement).toBe("requested");
    expect(result.conversation[0].delivery).toBe("failed");
  });
  it("no model input contains more than 30 messages or 16K serialized messages and target is never clipped", async () => {
    const target = message(); const all = Array.from({ length: 40 }, (_, index) => message({ key: sessionTextKey(`context:${index}`), text: "Context " + "x".repeat(800) })); all.splice(20, 0, target);
    const call = model(owner => [prediction(owner, { anchorMessageKey: target.key, evidenceKeys: [target.key] })]);
    const d = dependencies(context(target, all), call); await checkLiveText(checkInput, d);
    const input = vi.mocked(d.interpret).mock.calls[0][0]; expect(input.threads).toHaveLength(1); expect(input.threads[0].messages.length).toBeLessThanOrEqual(30);
    expect(input.threads[0].messages.reduce((n, m) => n + JSON.stringify(m).length, 0)).toBeLessThanOrEqual(16000);
    expect(input.threads[0].messages.find(m => m.key === target.key)?.text).toBe(target.text); expect(call).toHaveBeenCalledTimes(1);
  });
  it("an over-budget target is review without calling the model or clipping text", async () => {
    const target = message({ text: "x".repeat(16001) }); const d = dependencies(context(target));
    const result = await checkLiveText(checkInput, d); expect(result.required).toBe("review"); expect(result.conversation[0].text).toBe(target.text); expect(d.interpret).not.toHaveBeenCalled();
  });
  it("UTF-8 byte budgets cannot send an oversized multibyte target", async () => {
    const target = message({ text: "界".repeat(6000) }); const d = dependencies(context(target));
    const result = await checkLiveText(checkInput, d); expect(result.required).toBe("review"); expect(result.conversation[0].text).toBe(target.text); expect(d.model).not.toHaveBeenCalled();
  });
  it("a different business endpoint cannot become context for this target", async () => {
    const target = message(); const otherLine = message({ key: sessionTextKey("other-line"), businessPhone: "+13015550777" });
    const d = dependencies(context(target, [target, otherLine])); const result = await checkLiveText(checkInput, d);
    expect(result.required).toBe("review"); expect(d.model).not.toHaveBeenCalled();
  });
  it("another session for the same customer cannot become this session's context", async () => {
    const target = message(); const foreign = message({ key: sessionTextKey("foreign-session"), sessionId: 8 });
    const d = dependencies(context(target, [target, foreign])); const result = await checkLiveText(checkInput, d);
    expect(result).toMatchObject({ required: "review", verified: "review", conversation: [target] });
    expect(d.model).not.toHaveBeenCalled(); expect(d.records).not.toHaveBeenCalled();
  });
  it("cross-customer or duplicate source keys cannot enter the model", async () => {
    const target = message(); const wrong = message({ key: sessionTextKey("wrong"), customerPhone: "+13015550999" });
    for (const messages of [[target, wrong], [target, { ...target }]]) {
      const d = dependencies(context(target, messages)); const result = await checkLiveText(checkInput, d); expect(result.required).toBe("review"); expect(d.interpret).not.toHaveBeenCalled();
    }
  });
  it.each(["text", "delivery", "timestamp"])("the exact target key cannot bind different stored %s metadata into recorded analysis", async field => {
    const target = message({ direction: "outbound", delivery: "unknown" }); const copied = { ...target };
    if (field === "text") copied.text = "Different same-key instruction";
    if (field === "delivery") copied.delivery = "sent";
    if (field === "timestamp") copied.occurredAt = "2026-11-13T16:00:00.000Z";
    const d = dependencies(context(target, [copied])); const result = await checkLiveText(checkInput, d);
    expect(result).toMatchObject({ required: "review", verified: "review", summary: "Exact text context could not be verified.", conversation: [target] });
    expect(d.interpret).not.toHaveBeenCalled(); expect(d.model).not.toHaveBeenCalled(); expect(d.records).not.toHaveBeenCalled();
  });
  it("unexpected verifier failure is short fixed review while preserving summary", async () => {
    const d = dependencies(); d.verify = () => { throw new Error("PRIVATE VERIFY SQL"); };
    const result = await checkLiveText(checkInput, d); expect(result.summary).toContain("9:00 AM"); expect(result.verified).toBe("review"); expect(JSON.stringify(result)).not.toContain("PRIVATE");
  });
});

describe("Live text interpreter-only bounded cache", () => {
  it("evicts settled failed analysis and lets a later explicit Check succeed without an automatic retry", async () => {
    const call = model(); call.mockRejectedValueOnce(new Error("PRIVATE model failure")); const d = dependencies(context(), call);
    const first = await checkLiveText(checkInput, d);
    expect(first).toMatchObject({ required: "review", verified: "review", analysis: { status: "unavailable", failure: "MODEL_UNAVAILABLE" } });
    expect(d.cache.size).toBe(0); expect(call).toHaveBeenCalledTimes(1); expect(d.records).not.toHaveBeenCalled();
    await Promise.resolve(); expect(call).toHaveBeenCalledTimes(1);
    const next = await checkLiveText(checkInput, d);
    expect(next).toMatchObject({ required: "yes", verified: "yes", analysis: { status: "complete" } });
    expect(call).toHaveBeenCalledTimes(2); expect(d.records).toHaveBeenCalledTimes(1); expect(d.verify).toHaveBeenCalledTimes(1); expect(d.cache.size).toBe(1);
  });
  it("reuses interpretation but calls current records and verifier freshly on every check", async () => {
    const call = model(); const d = dependencies(context(), call); let reads = 0;
    d.records = vi.fn(async () => ({ records: [record("bookings"), record("leadflow_jobs", { time: ++reads === 1 ? "09:00" : "11:00" })], warnings: [], truncated: false, incompleteThreadKeys: [] }));
    expect((await checkLiveText(checkInput, d)).verified).toBe("yes"); expect((await checkLiveText(checkInput, d)).verified).toBe("no");
    expect(call).toHaveBeenCalledTimes(1); expect(d.context).toHaveBeenCalledTimes(2); expect(d.records).toHaveBeenCalledTimes(2); expect(d.verify).toHaveBeenCalledTimes(2);
  });
  it("coalesces concurrent tabs into one interpretation promise but no cached verification", async () => {
    let resolve!: (response: InvokeResult) => void; let parameters!: InvokeParams;
    const call = vi.fn((params: InvokeParams) => { parameters = params; return new Promise<InvokeResult>(done => { resolve = done; }); });
    const d = dependencies(context(), call); const first = checkLiveText(checkInput, d); const second = checkLiveText(checkInput, d);
    await vi.waitFor(() => expect(call).toHaveBeenCalledTimes(1));
    const owner = JSON.parse(parameters.messages[1].content as string).threads[0]; resolve(response([prediction(owner)]));
    const results = await Promise.all([first, second]); expect(results.map(r => r.verified)).toEqual(["yes", "yes"]);
    expect(call).toHaveBeenCalledTimes(1); expect(d.records).toHaveBeenCalledTimes(2);
  });
  it("a timed-out underlying model still in flight is never evicted or retried after the TTL", async () => {
    vi.useFakeTimers();
    let finish!: (result: InvokeResult) => void;
    try {
      const call = vi.fn(() => new Promise<InvokeResult>(done => { finish = done; })); const d = dependencies(context(), call);
      let clock = now.getTime(); d.now = () => new Date(clock);
      const first = checkLiveText(checkInput, d);
      await vi.advanceTimersByTimeAsync(20001);
      expect(await first).toMatchObject({ required: "review", verified: "review", analysis: { status: "unavailable", failure: "MODEL_TIMEOUT" } });
      expect(call).toHaveBeenCalledTimes(1); expect(d.cache.size).toBe(1); expect(Array.from(d.cache.values())[0].pending).toBe(true);
      clock += 6 * 60000;
      const duplicates = await Promise.all([checkLiveText(checkInput, d), checkLiveText(checkInput, d)]);
      for (const result of duplicates) expect(result).toMatchObject({ required: "review", verified: "review", analysis: { failure: "MODEL_TIMEOUT" } });
      expect(call).toHaveBeenCalledTimes(1); expect(d.records).not.toHaveBeenCalled();
      expect(d.cache.size).toBe(1); expect(Array.from(d.cache.values())[0].pending).toBe(true);
      finish(response([])); await vi.advanceTimersByTimeAsync(0);
      expect(d.cache.size).toBe(0); expect(call).toHaveBeenCalledTimes(1);
      call.mockImplementation(model());
      expect(await checkLiveText(checkInput, d)).toMatchObject({ required: "yes", verified: "yes", analysis: { status: "complete" } });
      expect(call).toHaveBeenCalledTimes(2); expect(d.records).toHaveBeenCalledTimes(1);
    } finally { vi.useRealTimers(); }
  });
  it("keeps immutable response revision/text even if stored context mutates while model is pending", async () => {
    const source = context(); let resolve!: (value: InvokeResult) => void; let parameters!: InvokeParams;
    const call = vi.fn((params: InvokeParams) => { parameters = params; return new Promise<InvokeResult>(done => { resolve = done; }); }); const d = dependencies(source, call);
    const resultPromise = checkLiveText(checkInput, d); await vi.waitFor(() => expect(call).toHaveBeenCalledTimes(1));
    source.row.revision = "changed-revision"; source.row.message.text = "Changed text";
    const owner = JSON.parse(parameters.messages[1].content as string).threads[0]; resolve(response([prediction(owner)]));
    const result = await resultPromise; expect(result.revision).toBe("revision-1"); expect(result.conversation[0].text).toContain("November 16");
  });
  it.each(["revision", "target", "context", "partial"])("full exact %s change invalidates interpretation", async change => {
    const source = context(); const call = model(); const d = dependencies(source, call); await checkLiveText(checkInput, d);
    if (change === "revision") source.row.revision = "revision-2";
    if (change === "target") source.row.message.text += " Please.";
    if (change === "context") source.messages.push(message({ key: sessionTextKey("new-context"), text: "A follow-up" }));
    if (change === "partial") source.partial = true;
    await checkLiveText(checkInput, d); expect(call).toHaveBeenCalledTimes(2);
  });
  it("expires interpretation after five minutes while never caching current records", async () => {
    const call = model(); const d = dependencies(context(), call); let clock = now.getTime(); d.now = () => new Date(clock);
    await checkLiveText(checkInput, d); clock += 299999; await checkLiveText(checkInput, d); expect(call).toHaveBeenCalledTimes(1);
    clock += 1; await checkLiveText(checkInput, d); expect(call).toHaveBeenCalledTimes(2); expect(d.records).toHaveBeenCalledTimes(3);
  });
  it("bounds the process-local interpretation map to 100 entries", async () => {
    const source = context(message({ text: "Thanks" })); const d = dependencies(source, model(() => []));
    for (let index = 0; index < 105; index++) { source.row.revision = `revision-${index}`; await checkLiveText(checkInput, d); }
    expect(d.cache.size).toBe(100);
  });
});

describe("Live text feed and server authorization/input", () => {
  const requestContext = { req: {} as any, res: {} as any, user: null };
  it("feed never invokes model, context or current record reads", async () => {
    const d = dependencies(); const result = await getLiveTextFeed(d); expect(result.rows).toHaveLength(1);
    expect(d.interpret).not.toHaveBeenCalled(); expect(d.context).not.toHaveBeenCalled(); expect(d.records).not.toHaveBeenCalled();
  });
  it("feed failure returns fixed unavailable state without exposing SQL", async () => {
    const d = dependencies(); d.feed = async () => { throw new Error("SELECT PRIVATE SQL"); };
    expect(await getLiveTextFeed(d)).toEqual({ rows: [], partial: true, unavailable: true, failure: "DB_READ_FAILED", checkedAt: now.toISOString() });
  });
  it.each(["feed", "check"] as const)("rejects anonymous %s before any reader/model", async method => {
    const caller = liveTextMonitorRouter.createCaller(requestContext);
    await expect(method === "feed" ? caller.feed() : caller.check(checkInput)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(mocks.feed).not.toHaveBeenCalled(); expect(mocks.context).not.toHaveBeenCalled(); expect(mocks.model).not.toHaveBeenCalled();
  });
  it.each(["feed", "check"] as const)("rejects non-admin %s before any reader/model", async method => {
    mocks.agent.mockResolvedValue({ agentId: 1, isAdmin: false }); const caller = liveTextMonitorRouter.createCaller(requestContext);
    await expect(method === "feed" ? caller.feed() : caller.check(checkInput)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mocks.feed).not.toHaveBeenCalled(); expect(mocks.context).not.toHaveBeenCalled(); expect(mocks.model).not.toHaveBeenCalled();
  });
  it("existing admin feed reads stored session rows only", async () => {
    mocks.agent.mockResolvedValue({ agentId: 1, isAdmin: true });
    await expect(liveTextMonitorRouter.createCaller(requestContext).feed()).resolves.toMatchObject({ unavailable: false });
    expect(mocks.feed).toHaveBeenCalledTimes(1); expect(mocks.model).not.toHaveBeenCalled();
  });
  it("existing admin check passes only exact session and message identity to the server reader", async () => {
    mocks.agent.mockResolvedValue({ agentId: 1, isAdmin: true });
    const result = await liveTextMonitorRouter.createCaller(requestContext).check(checkInput);
    expect(result.required).toBe("yes"); expect(mocks.context).toHaveBeenCalledWith(checkInput.sessionId, checkInput.messageKey);
  });
  it.each([{ ...checkInput, sessionId: 0 }, { ...checkInput, sessionId: -1 }, { ...checkInput, sessionId: 1.5 }, { ...checkInput, sessionId: "7" },
    { ...checkInput, sessionId: Number.MAX_SAFE_INTEGER + 1 }, { sessionId: 7 }, { messageKey: checkInput.messageKey }, { captureId: 41 },
    { ...checkInput, messageKey: "session-text:abc" }, { ...checkInput, messageKey: `session-text:${"A".repeat(64)}` },
    { ...checkInput, messageKey: `session-text:${"a".repeat(65)}` }, { ...checkInput, messageKey: 41 },
    { ...checkInput, phone: customerPhone }, { ...checkInput, text: "Client instruction" }, { ...checkInput, candidate: {} },
    { ...checkInput, status: "matches" }, { ...checkInput, verified: "yes" }, { ...checkInput, messages: [] }])("strictly rejects untrusted client input %j", async input => {
    expect(liveTextCheckInputSchema.safeParse(input).success).toBe(false);
    mocks.agent.mockResolvedValue({ agentId: 1, isAdmin: true });
    await expect(liveTextMonitorRouter.createCaller(requestContext).check(input as any)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(mocks.context).not.toHaveBeenCalled();
  });
  it("feed rejects client-supplied objects, not just ignores them", async () => {
    mocks.agent.mockResolvedValue({ agentId: 1, isAdmin: true });
    await expect(liveTextMonitorRouter.createCaller(requestContext).feed({ phone: customerPhone } as any)).rejects.toMatchObject({ code: "BAD_REQUEST" }); expect(mocks.feed).not.toHaveBeenCalled();
  });
  it("session-read errors and missing messages cross transport only as fixed short messages", async () => {
    const d = dependencies(); d.context = async () => { throw new Error("SELECT PRIVATE SQL"); };
    await expect(checkLiveText(checkInput, d)).rejects.toMatchObject({ message: "Captured text could not be read." });
    d.context = async () => null; await expect(checkLiveText(checkInput, d)).rejects.toMatchObject({ message: "Captured text is unavailable." });
    expect(d.interpret).not.toHaveBeenCalled();
  });
  it("rejects a server reader returning a different session identity", async () => {
    const source = context(); source.row.sessionId = 99; const d = dependencies(source);
    await expect(checkLiveText(checkInput, d)).rejects.toMatchObject({ message: "Captured text identity could not be verified." }); expect(d.interpret).not.toHaveBeenCalled();
  });
  it.each(["rowKey", "messageKey", "messageSession"])("rejects misbound %s metadata before model use", async field => {
    const source = context();
    if (field === "rowKey") source.row.key = sessionTextKey("wrong-key");
    if (field === "messageKey") source.row.message.key = sessionTextKey("wrong-key");
    if (field === "messageSession") source.row.message.sessionId = 8;
    const d = dependencies(source);
    await expect(checkLiveText(checkInput, d)).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR", message: "Captured text identity could not be verified." });
    expect(d.model).not.toHaveBeenCalled(); expect(d.records).not.toHaveBeenCalled();
  });
  it.each([null, 41, { sessionId: 0, messageKey: checkInput.messageKey }, { sessionId: 7, messageKey: "wrong" }])("service rejects invalid direct input %j before the reader", async input => {
    const d = dependencies();
    await expect(checkLiveText(input as any, d)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(d.context).not.toHaveBeenCalled(); expect(d.model).not.toHaveBeenCalled();
  });
  it("malformed reader envelopes never expose arbitrary processing errors", async () => {
    const d = dependencies(); d.context = async () => ({ private: "SQL" } as any);
    await expect(checkLiveText(checkInput, d)).rejects.toMatchObject({ message: "Captured text identity could not be verified." });
    const source = context(); source.messages = [null as any]; d.context = async () => source;
    expect((await checkLiveText(checkInput, d)).summary).toBe("Exact text context could not be verified."); expect(d.model).not.toHaveBeenCalled();
  });
  it("is isolated from daily scans, persistence, provider downloads and outbound actions", () => {
    for (const name of ["liveTextMonitorService.ts", "liveTextMonitorRouter.ts"]) {
      const source = readFileSync(new URL(`./${name}`, import.meta.url), "utf8");
      const withoutLocalCache = source.replace(/deps\.cache\.delete\(/g, "localCacheRemove(");
      expect(withoutLocalCache).not.toMatch(/readLeadFlowAuditDay|collectAuditDaySms|dailyActionAuditCollection|sendSms|notifyOwner|\.insert\(|\.delete\(|\bfetch\(/);
      expect(source).not.toMatch(new RegExp(["cleaner", "Jobs"].join("") + "|" + ["cleaner", "jobs"].join("_")));
    }
  });
});
