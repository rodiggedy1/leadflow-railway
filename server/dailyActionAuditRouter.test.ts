import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuditCandidate, AuditMessage, AuditRecord, AuditThread } from "../shared/dailyActionAudit";
const mocks = vi.hoisted(() => ({ agent: vi.fn(), messages: vi.fn(), records: vi.fn(), interpret: vi.fn() }));
vi.mock("./_core/agentAuth", () => ({ getAgentFromRequest: mocks.agent }));
vi.mock("./dailyActionAuditData", () => ({ readLeadFlowAuditDay: mocks.messages, readLeadFlowAuditRecords: mocks.records }));
vi.mock("./dailyActionAuditInterpret", async original => ({ ...(await original() as any), interpretAuditThreads: mocks.interpret }));
import { dailyActionAuditRouter, dailyAuditInputSchema, runDailyActionAudit, type DailyAuditDependencies } from "./dailyActionAuditRouter";
import { verifyAuditCandidates } from "./dailyActionAuditEngine";
import { AuditSnapshotError } from "./dailyActionAuditSnapshot";
import { auditFailureMessage, safeAuditFailureMessage } from "../shared/dailyActionAudit";
import { readFileSync } from "node:fs";

const now = new Date("2026-11-12T16:00:00.000Z");
const input = { auditDate: "2026-11-11", timeZone: "America/New_York" as const };
const customerPhone = "+13015550123";
const message: AuditMessage = { key: "m1", sessionId: 1, customerPhone, businessPhone: null, direction: "inbound", text: "Please move my November 12 cleaning to 9am", occurredAt: "2026-11-11T15:00:00.000Z", observedAt: "2026-11-11T15:00:00.000Z", timeBasis: "history", delivery: "received", source: "conversation_history" };
const thread: AuditThread = { key: "t1", customerPhone, customerName: "Fixture Customer", messages: [message], truncated: false };
const candidate: AuditCandidate = { id: "a1", threadKey: "t1", action: "reschedule", agreement: "requested", anchorMessageKey: "m1", evidenceKeys: ["m1"], explanation: "Request for November 12 at 9am", confidence: 0.95, supersededByMessageKey: null, ambiguous: false, expected: { bookingReference: "LF-FIXTURE", date: "2026-11-12", originalDate: null, time: "09:00", timeKind: "exact", windowEnd: null, scope: "visit", address: null, serviceName: null, extras: null, teamName: null, amountCents: null } };
function record(source: AuditRecord["source"], time = "09:00"): AuditRecord {
  return { key: source === "bookings" ? "booking:1" : "job:1", source, bookingId: 1, jobId: source === "leadflow_jobs" ? 1 : null, publicBookingNumber: "LF-FIXTURE", seriesId: null, customerPhone, customerName: "Fixture Customer", date: "2026-11-12", time, timeZone: "America/New_York", status: "confirmed", address: "123 Fixture Street", serviceName: "Standard Cleaning", extras: [], teamName: null, recurrence: "one-time", paymentStatus: null, paidAmountCents: null };
}
function source(threads = [thread], partial = false) {
  return { threads, coverage: { status: "partial" as const, messagesRead: threads.reduce((n, t) => n + t.messages.length, 0), threadsRead: threads.length, threadsAnalyzed: 0, truncated: partial, warnings: [] }, localSource: { status: partial ? "partial" as const : "captured" as const, sessionsRead: 12, inboundRead: 22, messagesRead: threads.reduce((n, t) => n + t.messages.length, 0), threadsRead: threads.length, providerRequests: 0 as const } };
}
function deps(options: { time?: string; incomplete?: boolean } = {}): DailyAuditDependencies {
  return {
    now: () => now,
    messages: vi.fn(async () => source()),
    records: vi.fn(async () => ({ records: [record("bookings"), record("leadflow_jobs", options.time)], truncated: options.incomplete ?? false, warnings: [], incompleteThreadKeys: options.incomplete ? [thread.key] : [] })),
    interpret: vi.fn(async ({ threads }) => ({ candidates: [{ ...candidate, threadKey: threads[0].key, anchorMessageKey: threads[0].messages[0].key, evidenceKeys: [threads[0].messages[0].key] }], warnings: [], threadsAnalyzed: threads.length, failedThreads: 0, omittedMessages: 0 })),
    verify: verifyAuditCandidates,
  };
}
const context = { req: {} as any, res: {} as any, user: null };
beforeEach(() => {
  vi.clearAllMocks(); mocks.agent.mockResolvedValue(null);
  const d = deps(); mocks.messages.mockImplementation(d.messages); mocks.records.mockImplementation(d.records); mocks.interpret.mockImplementation(d.interpret);
});

describe("Daily Action Audit captured-source authorization", () => {
  it("rejects anonymous users before reading messages or records", async () => {
    await expect(dailyActionAuditRouter.createCaller(context).run(input)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(mocks.messages).not.toHaveBeenCalled(); expect(mocks.records).not.toHaveBeenCalled(); expect(mocks.interpret).not.toHaveBeenCalled();
  });
  it("rejects non-admin agents before reading evidence", async () => {
    mocks.agent.mockResolvedValue({ agentId: 1, agentName: "Fixture Agent", agentEmail: "fixture@example.test", isAdmin: false });
    await expect(dailyActionAuditRouter.createCaller(context).run(input)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mocks.messages).not.toHaveBeenCalled();
  });
  it("uses the existing admin session without any provider integration", async () => {
    mocks.agent.mockResolvedValue({ agentId: 1, agentName: "Fixture Admin", agentEmail: "fixture@example.test", isAdmin: true });
    await expect(dailyActionAuditRouter.createCaller(context).run(input)).resolves.toMatchObject({ localSource: { providerRequests: 0 } });
    expect(mocks.messages).toHaveBeenCalledTimes(1);
  });
  it.each([
    { ...input, auditDate: "2026-02-30" }, { ...input, timeZone: "America/Los_Angeles" }, { ...input, phone: customerPhone },
    { ...input, messages: [message] }, { ...input, localSource: source().localSource },
    { ...input, cursor: { sessionAfterId: -1, inboundAfterId: 0, asOf: now.toISOString() } },
  ])("rejects invalid inputs and client-supplied identity/evidence %j", value => {
    expect(dailyAuditInputSchema.safeParse(value).success).toBe(false);
  });
});

describe("Daily Action Audit LeadFlow-first pipeline", () => {
  it("collects captured threads before interpretation, then reads only actionable current records", async () => {
    const d = deps({ time: "11:00" }); const order: string[] = [];
    const originalMessages = d.messages, originalRecords = d.records, originalInterpret = d.interpret;
    d.messages = async value => { order.push("captured-read-released"); return originalMessages(value); };
    d.interpret = async value => { order.push("interpret"); expect(value.records).toEqual([]); expect(value.evidenceMode).toBe("captured"); return originalInterpret(value); };
    d.records = async value => { order.push("actionable-record-read"); expect(value.candidates).toHaveLength(1); return originalRecords(value); };
    const result = await runDailyActionAudit(input, d);
    expect(order).toEqual(["captured-read-released", "interpret", "actionable-record-read"]);
    expect(result.items[0].status).toBe("needs_action"); expect(result.localSource?.providerRequests).toBe(0);
    expect(result.collection).toBeUndefined(); expect(result.nextCursor).toBeNull();
  });
  it.each([["09:00", "matches"], ["11:00", "needs_action"]] as const)("compares captured 9am request with actual %s and returns %s", async (time, status) => {
    const result = await runDailyActionAudit(input, deps({ time }));
    expect(result.items[0].status).toBe(status); expect(result.items[0].agreement).toBe("requested");
    expect(result.items[0].evidenceBasis).toBe("captured"); expect(result.items[0].records.find(r => r.source === "leadflow_jobs")?.time).toBe(time);
    expect(result.items[0].evidence[0].text).toContain("9am"); expect(result.coverage.status).toBe("partial");
  });
  it("keeps valid captured requests when some local message coverage is partial", async () => {
    const d = deps(); d.messages = async () => source([thread], true);
    const result = await runDailyActionAudit(input, d);
    expect(result.items).toHaveLength(1); expect(result.analysis?.status).toBe("partial"); expect(result.localSource?.status).toBe("partial");
  });
  it("does not turn incomplete customer records into matches", async () => {
    const result = await runDailyActionAudit(input, deps({ incomplete: true }));
    expect(result.items[0].status).toBe("cannot_verify"); expect(result.analysis?.status).toBe("partial");
  });
  it("one person's record gap does not downgrade another person's matched request", async () => {
    const other = { ...thread, key: "t2", customerPhone: "+13015550124", messages: [{ ...message, key: "m2", customerPhone: "+13015550124" }] };
    const d = deps(); d.messages = async () => source([thread, other]);
    d.interpret = async () => ({ candidates: [candidate, { ...candidate, id: "a2", threadKey: other.key, anchorMessageKey: "m2", evidenceKeys: ["m2"] }], warnings: [], threadsAnalyzed: 2 });
    d.records = async () => ({ records: [record("bookings"), record("leadflow_jobs")], truncated: true, warnings: [], incompleteThreadKeys: [other.key] });
    const result = await runDailyActionAudit(input, d);
    expect(result.items.find(i => i.id === "a1")?.status).toBe("matches"); expect(result.items.find(i => i.id === "a2")?.status).toBe("cannot_verify");
  });
  it.each(["DB_UNAVAILABLE", "DB_UNSUPPORTED", "DB_SCHEMA", "DB_TIMEOUT", "DB_READ_FAILED"] as const)("preserves captured action summaries when record lookup fails with %s", async reason => {
    const d = deps(); d.records = async () => { throw new AuditSnapshotError(reason); };
    const result = await runDailyActionAudit(input, d);
    expect(result.items).toHaveLength(1); expect(result.items[0]).toMatchObject({ status: "cannot_verify", records: [] });
    expect(result.items[0].verification).toContain("Current records are unavailable"); expect(result.items[0].verification).not.toContain("No matching persisted");
  });
  it("does not run a model or record read when no captured messages exist", async () => {
    const d = deps(); d.messages = async () => source([]);
    const result = await runDailyActionAudit(input, d);
    expect(result.localSource?.messagesRead).toBe(0); expect(d.records).not.toHaveBeenCalled(); expect(d.interpret).not.toHaveBeenCalled();
  });
  it("failed interpretation is not a successful zero-action result", async () => {
    const d = deps(); d.interpret = async () => ({ candidates: [], warnings: ["Interpretation unavailable"], threadsAnalyzed: 0, failedThreads: 1 });
    const result = await runDailyActionAudit(input, d);
    expect(result.analysis).toMatchObject({ status: "failed", threadsAnalyzed: 0, failedThreads: 1 }); expect(result.localSource?.messagesRead).toBe(1);
    expect(d.records).not.toHaveBeenCalled();
  });
  it("retains valid partial findings even when no entire conversation completed", async () => {
    const d = deps(); const original = d.interpret;
    d.interpret = async value => ({ ...(await original(value)), threadsAnalyzed: 0, failedThreads: 1 });
    const result = await runDailyActionAudit(input, d);
    expect(result.analysis?.status).toBe("partial"); expect(result.items).toHaveLength(1);
  });
  it("runs the actual interpreter then actual verifier with only a synthetic model response", async () => {
    const actual = await vi.importActual<typeof import("./dailyActionAuditInterpret")>("./dailyActionAuditInterpret");
    const d = deps({ time: "11:00" });
    d.interpret = value => actual.interpretAuditThreads(value, async params => {
      const payload = JSON.parse(params.messages[1].content as string); const owner = payload.threads[0];
      const { id: _id, ...prediction } = candidate;
      return { id: "fixture", created: 0, model: "offline", choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: JSON.stringify({ actions: [{ ...prediction, threadKey: owner.key, anchorMessageKey: owner.messages[0].key, evidenceKeys: [owner.messages[0].key] }] }) } }] };
    });
    const result = await runDailyActionAudit(input, d);
    expect(result.items[0].status).toBe("needs_action"); expect(result.items[0].expected.time).toBe("09:00");
  });
  it.each(["2026-11-12", "2026-11-13"])("rejects today/future %s before reading evidence", async auditDate => {
    const d = deps(); await expect(runDailyActionAudit({ ...input, auditDate }, d)).rejects.toMatchObject({ code: "BAD_REQUEST" }); expect(d.messages).not.toHaveBeenCalled();
  });
  it("rejects legacy sample cursors before reading evidence", async () => {
    const d = deps(); await expect(runDailyActionAudit({ ...input, cursor: { sessionAfterId: 10, inboundAfterId: 20, asOf: now.toISOString() } }, d)).rejects.toMatchObject({ code: "BAD_REQUEST" }); expect(d.messages).not.toHaveBeenCalled();
  });
  it("sanitizes raw message-read failures instead of retaining SQL/SMS/credentials", async () => {
    const d = deps(); d.messages = async () => { throw new Error("SECRET SQL +13015550123"); };
    await expect(runDailyActionAudit(input, d)).rejects.toMatchObject({ message: auditFailureMessage("MESSAGE_READ", "FAILED") }); expect(d.interpret).not.toHaveBeenCalled();
  });
  it("sanitizes raw processing exceptions", async () => {
    const d = deps(); d.verify = () => { throw new Error("SECRET SQL CUSTOMER"); };
    await expect(runDailyActionAudit(input, d)).rejects.toMatchObject({ message: auditFailureMessage("PROCESSING", "FAILED") });
  });
  it("allows only exact fixed error text", () => {
    const known = auditFailureMessage("MESSAGE_READ", "DB_SCHEMA"); expect(safeAuditFailureMessage(known)).toBe(known);
    for (const unsafe of [known + " secret", null, { message: known }]) expect(safeAuditFailureMessage(unsafe)).toBeNull();
  });
  it("has no provider collector, SMS sender, writer or parallel model path", () => {
    const sourceCode = readFileSync(new URL("./dailyActionAuditRouter.ts", import.meta.url), "utf8");
    expect(sourceCode).not.toMatch(/dailyActionAuditCollection|collectAuditDaySms|sendSms|notifyOwner|\.insert\(|\.update\(|\.delete\(|\bfetch\(/);
  });
});
