import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
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
import type { InvokeParams, InvokeResult } from "./_core/llm";

const now = new Date("2026-11-13T18:00:00.000Z");
const customerPhone = "+13015550123";
function message(overrides: Partial<AuditMessage> = {}): AuditMessage {
  return { key: "capture-message:41", sessionId: 7, customerPhone, businessPhone: "+13015550456", direction: "inbound",
    text: "Please move booking LF-TEST to November 16, 2026 at 9am.", occurredAt: null,
    observedAt: "2026-11-13T15:00:00.000Z", timeBasis: "received", delivery: "received", source: "inbound_sms", ...overrides };
}
function context(target = message(), messages = [target], partial = false): LiveTextContext {
  return { row: { key: "live-text:41", captureId: 41, revision: "revision-1", customerName: null, message: target, identityAmbiguous: false }, messages, partial };
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

describe("Live text exact captured row checks", () => {
  it("thanks is no action only after a complete actual interpretation", async () => {
    const source = context(message({ text: "Thanks!" })); const call = model(() => []); const d = dependencies(source, call);
    const result = await checkLiveText(41, d);
    expect(result).toMatchObject({ required: "no", verified: "not_applicable", summary: "No action required.", actions: [] });
    expect(call).toHaveBeenCalledTimes(1); expect(d.records).not.toHaveBeenCalled();
  });
  it.each(["09:00", "11:00"])("compares requested 9 AM with actual fresh %s using the actual verifier", async time => {
    const d = dependencies(); d.records = vi.fn(async () => ({ records: [record("bookings"), record("leadflow_jobs", { time })], warnings: [], truncated: false, incompleteThreadKeys: [] }));
    const result = await checkLiveText(41, d);
    expect(result.required).toBe("yes"); expect(result.verified).toBe(time === "09:00" ? "yes" : "no");
    expect(result.actions[0].summary).toBe("Reschedule cleaning to Nov 16, 2026 at 9:00 AM");
    expect(result.evidence).toContain("Booking LF-TEST (booking:1)"); expect(result.evidence).toContain(`time ${time === "09:00" ? "9:00 AM" : "11:00 AM"}`);
    expect(result.evidence).not.toMatch(/historical completion|captured evidence identifies|when changes were made|charge events/i);
    expect(result.evidence).not.toMatch(/123 Fixture Street|Standard Cleaning|Fixture Team|payment state/);
    expect(d.verify).toHaveBeenCalledWith(expect.objectContaining({ evidenceMode: "captured", records: expect.any(Array) }));
  });
  it("changed job date is no, not a current match", async () => {
    const d = dependencies(); d.records = vi.fn(async () => ({ records: [record("bookings"), record("leadflow_jobs", { date: "2026-11-17" })], warnings: [], truncated: false, incompleteThreadKeys: [] }));
    const result = await checkLiveText(41, d);
    expect(result.verified).toBe("no"); expect(result.evidence).toContain("Scheduled date differs from the request.");
    expect(result.evidence).toContain("Nov 17, 2026");
  });
  it("ignores context-only candidates instead of making another message this row's action", async () => {
    const target = message({ text: "Thanks!" }); const earlier = message({ key: "earlier", text: "Please move booking LF-TEST to November 16, 2026 at 9am." });
    const source = context(target, [earlier, target]); const call = model(owner => [prediction(owner, { anchorMessageKey: "earlier", evidenceKeys: ["earlier"] })]);
    const d = dependencies(source, call); const result = await checkLiveText(41, d);
    expect(result).toMatchObject({ required: "no", verified: "not_applicable", actions: [] }); expect(d.records).not.toHaveBeenCalled();
  });
  it("only returns target actions when several same-day messages have actions", async () => {
    const target = message(); const earlier = message({ key: "earlier", text: "Cancel another visit." });
    const d = dependencies(context(target, [earlier, target]), model(owner => [prediction(owner, { anchorMessageKey: "earlier", evidenceKeys: ["earlier"], action: "cancel" }), prediction(owner, { anchorMessageKey: target.key, evidenceKeys: [target.key] })]));
    const result = await checkLiveText(41, d); expect(result.actions).toHaveLength(1); expect(result.actions[0].type).toBe("reschedule");
    expect(d.records).toHaveBeenCalledWith(expect.objectContaining({ candidates: [expect.objectContaining({ anchorMessageKey: target.key })] }));
  });
  it("actual verifier rejects a wrong-customer linked job, even with the same booking reference", async () => {
    const d = dependencies(); d.records = vi.fn(async () => ({ records: [record("bookings"), record("leadflow_jobs", { customerPhone: "+13015550999" })], warnings: [], truncated: false, incompleteThreadKeys: [] }));
    const result = await checkLiveText(41, d);
    expect(result.required).toBe("yes"); expect(result.verified).toBe("review"); expect(result.actions[0].records).toEqual([]);
    expect(result.evidence).toContain("Record customer does not match this text.");
  });
  it("conflicting names cannot be arbitrarily chosen for the same phone", async () => {
    const d = dependencies(); d.records = vi.fn(async () => ({ records: [record("bookings"), record("leadflow_jobs", { customerName: "Other Household" })], warnings: [], truncated: false, incompleteThreadKeys: [] }));
    const result = await checkLiveText(41, d); expect(result.verified).toBe("review"); expect(result.evidence).toContain("Customer identity needs review."); expect(result.actions[0].records).toEqual([]);
  });
  it("unknown requested date is review, never false no or an invented date", async () => {
    const target = message({ text: "Please move my cleaning." });
    const d = dependencies(context(target), model(owner => [prediction(owner, { expected: { ...expected, date: null, time: null, timeKind: "unspecified" } })]));
    const result = await checkLiveText(41, d); expect(result.required).toBe("yes"); expect(result.verified).toBe("review");
    expect(result.summary).toContain("date needs review"); expect(result.evidence).toContain("Requested date is unclear.");
  });
  it("unknown occurrence and observed date requires review before model use", async () => {
    const target = message({ occurredAt: "2026-11-13T10:00:00", observedAt: null, timeBasis: "unknown" }); const d = dependencies(context(target));
    const result = await checkLiveText(41, d); expect(result).toMatchObject({ required: "review", verified: "review", summary: "Text timing needs review." }); expect(d.interpret).not.toHaveBeenCalled();
  });
  it("uses target observed UTC day zoned Eastern rather than today or a daily scan", async () => {
    const target = message({ observedAt: "2026-11-13T02:00:00.000Z", text: "Thanks" });
    const d = dependencies(context(target), model(() => [])); await checkLiveText(41, d);
    expect(d.interpret).toHaveBeenCalledWith(expect.objectContaining({ auditDate: "2026-11-12", timeZone: "America/New_York", records: [] }), expect.any(Function));
  });
  it("uses trustworthy occurrence rather than later observed day", async () => {
    const target = message({ occurredAt: "2026-11-12T15:00:00.000Z", observedAt: "2026-11-13T15:00:00.000Z", timeBasis: "provider" });
    const d = dependencies(context(target)); await checkLiveText(41, d);
    expect(d.interpret).toHaveBeenCalledWith(expect.objectContaining({ auditDate: "2026-11-12" }), expect.any(Function));
  });
  it("inaccessible current DB preserves known action summary, not absence/no", async () => {
    const d = dependencies(); d.records = vi.fn(async () => { throw new Error("SELECT SECRET TOKEN SQL"); });
    const result = await checkLiveText(41, d);
    expect(result).toMatchObject({ required: "yes", verified: "review", summary: "Reschedule cleaning to Nov 16, 2026 at 9:00 AM" });
    expect(result.evidence).toContain("Current records are unavailable."); expect(JSON.stringify(result)).not.toMatch(/SECRET|SELECT|TOKEN|No matching booking/);
  });
  it("reader's caught DB failure also remains review", async () => {
    const d = dependencies(); d.records = vi.fn(async () => ({ records: [], warnings: ["private source details"], truncated: true, incompleteThreadKeys: ["any"] }));
    const result = await checkLiveText(41, d); expect(result.required).toBe("yes"); expect(result.verified).toBe("review"); expect(result.evidence).toContain("Current record coverage is incomplete."); expect(JSON.stringify(result)).not.toContain("private source details");
  });
  it("failed LLM is review and cached without retry, never no", async () => {
    const call = vi.fn(async () => { throw new Error("PRIVATE LLM ERROR"); }); const d = dependencies(context(), call);
    const a = await checkLiveText(41, d); const b = await checkLiveText(41, d);
    expect(a.required).toBe("review"); expect(b.required).toBe("review"); expect(call).toHaveBeenCalledTimes(1); expect(d.records).not.toHaveBeenCalled(); expect(JSON.stringify(a)).not.toContain("PRIVATE");
  });
  it("discarded or omitted invalid source evidence cannot produce a successful no-action result", async () => {
    const d = dependencies(context(), model(owner => [prediction(owner, { evidenceKeys: ["fabricated"] })]));
    const result = await checkLiveText(41, d); expect(result.required).toBe("review"); expect(result.actions).toEqual([]);
  });
  it.each([true, false])("partial/no-delivery target (%s) never becomes no-action proof", async partial => {
    const target = message({ text: "Thanks", ...(partial ? {} : { direction: "outbound" as const, delivery: "unknown" as const }) });
    const d = dependencies(context(target, [target], partial), model(() => [])); const result = await checkLiveText(41, d);
    expect(result.required).toBe("review");
  });
  it("does not claim a paid charge based on captured text or delivery", async () => {
    const target = message({ text: "I paid $100 for LF-TEST." });
    const d = dependencies(context(target), model(owner => [prediction(owner, { action: "payment", expected: { ...expected, time: null, timeKind: "unspecified", amountCents: 10000 } })]));
    const result = await checkLiveText(41, d); expect(result.verified).toBe("review"); expect(result.summary).toContain("Check payment"); expect(result.evidence).toContain("paid amount unknown");
  });
  it("actual persisted amount and captured status, not an SMS claim, determine payment yes/no", async () => {
    const target = message({ text: "I paid $100 for LF-TEST." });
    const d = dependencies(context(target), model(owner => [prediction(owner, { action: "payment", expected: { ...expected, time: null, timeKind: "unspecified", amountCents: 10000 } })]));
    d.records = vi.fn(async () => ({ records: [record("bookings", { paymentStatus: "captured", paidAmountCents: 10000 })], warnings: [], truncated: false, incompleteThreadKeys: [] }));
    const result = await checkLiveText(41, d); expect(result.verified).toBe("yes"); expect(result.evidence).toContain("payment state captured");
  });
  it("no model input contains more than 30 messages or 16K serialized messages and target is never clipped", async () => {
    const target = message(); const all = Array.from({ length: 40 }, (_, index) => message({ key: `context:${index}`, text: "Context " + "x".repeat(800) })); all.splice(20, 0, target);
    const call = model(owner => [prediction(owner, { anchorMessageKey: target.key, evidenceKeys: [target.key] })]);
    const d = dependencies(context(target, all), call); await checkLiveText(41, d);
    const input = vi.mocked(d.interpret).mock.calls[0][0]; expect(input.threads).toHaveLength(1); expect(input.threads[0].messages.length).toBeLessThanOrEqual(30);
    expect(input.threads[0].messages.reduce((n, m) => n + JSON.stringify(m).length, 0)).toBeLessThanOrEqual(16000);
    expect(input.threads[0].messages.find(m => m.key === target.key)?.text).toBe(target.text); expect(call).toHaveBeenCalledTimes(1);
  });
  it("an over-budget target is review without calling the model or clipping text", async () => {
    const target = message({ text: "x".repeat(16001) }); const d = dependencies(context(target));
    const result = await checkLiveText(41, d); expect(result.required).toBe("review"); expect(result.conversation[0].text).toBe(target.text); expect(d.interpret).not.toHaveBeenCalled();
  });
  it("UTF-8 byte budgets cannot send an oversized multibyte target", async () => {
    const target = message({ text: "界".repeat(6000) }); const d = dependencies(context(target));
    const result = await checkLiveText(41, d); expect(result.required).toBe("review"); expect(result.conversation[0].text).toBe(target.text); expect(d.model).not.toHaveBeenCalled();
  });
  it("a different business endpoint cannot become context for this target", async () => {
    const target = message(); const otherLine = message({ key: "other-line", businessPhone: "+13015550777" });
    const d = dependencies(context(target, [target, otherLine])); const result = await checkLiveText(41, d);
    expect(result.required).toBe("review"); expect(d.model).not.toHaveBeenCalled();
  });
  it("cross-customer or duplicate source keys cannot enter the model", async () => {
    const target = message(); const wrong = message({ key: "wrong", customerPhone: "+13015550999" });
    for (const messages of [[target, wrong], [target, { ...target }]]) {
      const d = dependencies(context(target, messages)); const result = await checkLiveText(41, d); expect(result.required).toBe("review"); expect(d.interpret).not.toHaveBeenCalled();
    }
  });
  it("unexpected verifier failure is short fixed review while preserving summary", async () => {
    const d = dependencies(); d.verify = () => { throw new Error("PRIVATE VERIFY SQL"); };
    const result = await checkLiveText(41, d); expect(result.summary).toContain("9:00 AM"); expect(result.verified).toBe("review"); expect(JSON.stringify(result)).not.toContain("PRIVATE");
  });
});

describe("Live text interpreter-only bounded cache", () => {
  it("reuses interpretation but calls current records and verifier freshly on every check", async () => {
    const call = model(); const d = dependencies(context(), call); let reads = 0;
    d.records = vi.fn(async () => ({ records: [record("bookings"), record("leadflow_jobs", { time: ++reads === 1 ? "09:00" : "11:00" })], warnings: [], truncated: false, incompleteThreadKeys: [] }));
    expect((await checkLiveText(41, d)).verified).toBe("yes"); expect((await checkLiveText(41, d)).verified).toBe("no");
    expect(call).toHaveBeenCalledTimes(1); expect(d.context).toHaveBeenCalledTimes(2); expect(d.records).toHaveBeenCalledTimes(2); expect(d.verify).toHaveBeenCalledTimes(2);
  });
  it("coalesces concurrent tabs into one interpretation promise but no cached verification", async () => {
    let resolve!: (response: InvokeResult) => void; let parameters!: InvokeParams;
    const call = vi.fn((params: InvokeParams) => { parameters = params; return new Promise<InvokeResult>(done => { resolve = done; }); });
    const d = dependencies(context(), call); const first = checkLiveText(41, d); const second = checkLiveText(41, d);
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
      const first = checkLiveText(41, d);
      await vi.advanceTimersByTimeAsync(20001);
      expect((await first).required).toBe("review"); expect(call).toHaveBeenCalledTimes(1);
      clock += 6 * 60000;
      expect((await checkLiveText(41, d)).required).toBe("review");
      expect(call).toHaveBeenCalledTimes(1); expect(d.records).not.toHaveBeenCalled();
      finish(response([])); await vi.advanceTimersByTimeAsync(0);
    } finally { vi.useRealTimers(); }
  });
  it("keeps immutable response revision/text even if capture mutates while model is pending", async () => {
    const source = context(); let resolve!: (value: InvokeResult) => void; let parameters!: InvokeParams;
    const call = vi.fn((params: InvokeParams) => { parameters = params; return new Promise<InvokeResult>(done => { resolve = done; }); }); const d = dependencies(source, call);
    const resultPromise = checkLiveText(41, d); await vi.waitFor(() => expect(call).toHaveBeenCalledTimes(1));
    source.row.revision = "changed-revision"; source.row.message.text = "Changed text";
    const owner = JSON.parse(parameters.messages[1].content as string).threads[0]; resolve(response([prediction(owner)]));
    const result = await resultPromise; expect(result.revision).toBe("revision-1"); expect(result.conversation[0].text).toContain("November 16");
  });
  it.each(["revision", "target", "context", "partial"])("full exact %s change invalidates interpretation", async change => {
    const source = context(); const call = model(); const d = dependencies(source, call); await checkLiveText(41, d);
    if (change === "revision") source.row.revision = "revision-2";
    if (change === "target") source.row.message.text += " Please.";
    if (change === "context") source.messages.push(message({ key: "new-context", text: "A follow-up" }));
    if (change === "partial") source.partial = true;
    await checkLiveText(41, d); expect(call).toHaveBeenCalledTimes(2);
  });
  it("expires interpretation after five minutes while never caching current records", async () => {
    const call = model(); const d = dependencies(context(), call); let clock = now.getTime(); d.now = () => new Date(clock);
    await checkLiveText(41, d); clock += 299999; await checkLiveText(41, d); expect(call).toHaveBeenCalledTimes(1);
    clock += 1; await checkLiveText(41, d); expect(call).toHaveBeenCalledTimes(2); expect(d.records).toHaveBeenCalledTimes(3);
  });
  it("bounds the process-local interpretation map to 100 entries", async () => {
    const source = context(message({ text: "Thanks" })); const d = dependencies(source, model(() => []));
    for (let index = 0; index < 105; index++) { source.row.revision = `revision-${index}`; await checkLiveText(41, d); }
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
    expect(await getLiveTextFeed(d)).toEqual({ rows: [], partial: true, unavailable: true, checkedAt: now.toISOString() });
  });
  it.each(["feed", "check"] as const)("rejects anonymous %s before any reader/model", async method => {
    const caller = liveTextMonitorRouter.createCaller(requestContext);
    await expect(method === "feed" ? caller.feed() : caller.check({ captureId: 41 })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(mocks.feed).not.toHaveBeenCalled(); expect(mocks.context).not.toHaveBeenCalled(); expect(mocks.model).not.toHaveBeenCalled();
  });
  it.each(["feed", "check"] as const)("rejects non-admin %s before any reader/model", async method => {
    mocks.agent.mockResolvedValue({ agentId: 1, isAdmin: false }); const caller = liveTextMonitorRouter.createCaller(requestContext);
    await expect(method === "feed" ? caller.feed() : caller.check({ captureId: 41 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mocks.feed).not.toHaveBeenCalled(); expect(mocks.context).not.toHaveBeenCalled(); expect(mocks.model).not.toHaveBeenCalled();
  });
  it("existing admin feed reads captured rows only", async () => {
    mocks.agent.mockResolvedValue({ agentId: 1, isAdmin: true });
    await expect(liveTextMonitorRouter.createCaller(requestContext).feed()).resolves.toMatchObject({ unavailable: false });
    expect(mocks.feed).toHaveBeenCalledTimes(1); expect(mocks.model).not.toHaveBeenCalled();
  });
  it("existing admin check passes only numeric capture identity to the server reader", async () => {
    mocks.agent.mockResolvedValue({ agentId: 1, isAdmin: true });
    const result = await liveTextMonitorRouter.createCaller(requestContext).check({ captureId: 41 });
    expect(result.required).toBe("yes"); expect(mocks.context).toHaveBeenCalledWith(41);
  });
  it.each([{ captureId: 0 }, { captureId: -1 }, { captureId: 1.5 }, { captureId: "41" }, { captureId: Number.MAX_SAFE_INTEGER + 1 },
    { captureId: 41, phone: customerPhone }, { captureId: 41, text: "Client instruction" }, { captureId: 41, candidate: {} },
    { captureId: 41, status: "matches" }, { captureId: 41, verified: "yes" }, { captureId: 41, messages: [] }])("strictly rejects untrusted client input %j", async input => {
    expect(liveTextCheckInputSchema.safeParse(input).success).toBe(false);
    mocks.agent.mockResolvedValue({ agentId: 1, isAdmin: true });
    await expect(liveTextMonitorRouter.createCaller(requestContext).check(input as any)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(mocks.context).not.toHaveBeenCalled();
  });
  it("feed rejects client-supplied objects, not just ignores them", async () => {
    mocks.agent.mockResolvedValue({ agentId: 1, isAdmin: true });
    await expect(liveTextMonitorRouter.createCaller(requestContext).feed({ phone: customerPhone } as any)).rejects.toMatchObject({ code: "BAD_REQUEST" }); expect(mocks.feed).not.toHaveBeenCalled();
  });
  it("capture-read errors and missing captures cross transport only as fixed short messages", async () => {
    const d = dependencies(); d.context = async () => { throw new Error("SELECT PRIVATE SQL"); };
    await expect(checkLiveText(41, d)).rejects.toMatchObject({ message: "Captured text could not be read." });
    d.context = async () => null; await expect(checkLiveText(41, d)).rejects.toMatchObject({ message: "Captured text is unavailable." });
    expect(d.interpret).not.toHaveBeenCalled();
  });
  it("rejects a server reader returning a different capture identity", async () => {
    const source = context(); source.row.captureId = 99; const d = dependencies(source);
    await expect(checkLiveText(41, d)).rejects.toMatchObject({ message: "Captured text identity could not be verified." }); expect(d.interpret).not.toHaveBeenCalled();
  });
  it("malformed reader envelopes never expose arbitrary processing errors", async () => {
    const d = dependencies(); d.context = async () => ({ private: "SQL" } as any);
    await expect(checkLiveText(41, d)).rejects.toMatchObject({ message: "Captured text identity could not be verified." });
    const source = context(); source.messages = [null as any]; d.context = async () => source;
    expect((await checkLiveText(41, d)).summary).toBe("Exact text context could not be verified."); expect(d.model).not.toHaveBeenCalled();
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
