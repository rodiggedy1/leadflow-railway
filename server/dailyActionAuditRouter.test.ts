import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuditCandidate, AuditMessage, AuditRecord, AuditThread } from "../shared/dailyActionAudit";
const mocks = vi.hoisted(() => ({ agent: vi.fn(), messages: vi.fn(), records: vi.fn(), provider: vi.fn(), hydrate: vi.fn(), interpret: vi.fn() }));
vi.mock("./_core/agentAuth", () => ({ getAgentFromRequest: mocks.agent }));
vi.mock("./dailyActionAuditData", async original => ({ ...(await original() as any), readAuditMessages: mocks.messages, readAuditRecords: mocks.records }));
vi.mock("./dailyActionAuditEvidence", async original => ({ ...(await original() as any), readAuditProviderPage: mocks.provider, hydrateAuditEvidence: mocks.hydrate }));
vi.mock("./dailyActionAuditInterpret", async original => ({ ...(await original() as any), interpretAuditThreads: mocks.interpret }));
import { dailyActionAuditRouter, dailyAuditInputSchema, runDailyActionAudit, type DailyAuditDependencies } from "./dailyActionAuditRouter";
import { verifyAuditCandidates } from "./dailyActionAuditEngine";
import { AuditSnapshotError } from "./dailyActionAuditSnapshot";
import { auditFailureMessage, safeAuditFailureMessage } from "../shared/dailyActionAudit";
import { TRPCError } from "@trpc/server";

const now = new Date("2026-11-12T16:00:00.000Z");
const input = { auditDate: "2026-11-11", timeZone: "America/New_York" as const };
const customerPhone = "+13015550123";
const message: AuditMessage = { key: "m1", sessionId: 1, customerPhone, businessPhone: null, direction: "inbound", text: "Please move tomorrow's cleaning to 9am", occurredAt: "2026-11-11T15:00:00.000Z", observedAt: null, timeBasis: "provider", delivery: "received", source: "provider", providerMessageId: "ACfixture" };
const thread: AuditThread = { key: "t1", customerPhone, customerName: "Fixture Customer", truncated: false, messages: [message] };
const candidate: AuditCandidate = { id: "a1", threadKey: "t1", action: "reschedule", agreement: "requested", anchorMessageKey: "m1", evidenceKeys: ["m1"], explanation: "Request for 9am tomorrow", confidence: 0.95, supersededByMessageKey: null, ambiguous: false, expected: { bookingReference: "LF-FIXTURE", date: "2026-11-12", originalDate: null, time: "09:00", timeKind: "exact", windowEnd: null, scope: "visit", address: null, serviceName: null, extras: null, teamName: null, amountCents: null } };
function record(source: AuditRecord["source"], time = "09:00"): AuditRecord {
  return { key: source === "bookings" ? "booking:1" : "job:1", source, bookingId: 1, jobId: source === "leadflow_jobs" ? 1 : null, publicBookingNumber: "LF-FIXTURE", seriesId: null, customerPhone, customerName: "Fixture Customer", date: "2026-11-12", time, timeZone: "America/New_York", status: "confirmed", address: "123 Fixture Street", serviceName: "Standard Cleaning", extras: [], teamName: null, recurrence: "one-time", paymentStatus: null, paidAmountCents: null };
}
function deps(options: { time?: string; truncated?: boolean; providerWarning?: boolean; continuation?: boolean } = {}): DailyAuditDependencies {
  return {
    now: () => now,
    messages: vi.fn(async () => ({ threads: [thread], coverage: { status: "partial" as const, messagesRead: 1, threadsRead: 1, threadsAnalyzed: 0, truncated: false, warnings: [] }, nextCursor: options.continuation ? { sessionAfterId: 10, inboundAfterId: 20, asOf: now.toISOString() } : null })),
    records: vi.fn(async () => ({ records: [record("bookings"), record("leadflow_jobs", options.time)], truncated: options.truncated ?? false, warnings: [] })),
    provider: vi.fn(async () => ({ messages: [], complete: true, lineIndex: 1, after: null, available: !options.providerWarning, warnings: options.providerWarning ? ["Provider read unavailable"] : [] })),
    hydrate: vi.fn(async threads => ({ threads, warnings: [] })),
    interpret: vi.fn(async ({ threads }) => ({ candidates: [{ ...candidate, threadKey: threads[0].key, anchorMessageKey: threads[0].messages[0].key, evidenceKeys: [threads[0].messages[0].key] }], warnings: [], threadsAnalyzed: 1 })),
    verify: verifyAuditCandidates,
  };
}
const context = { req: {} as any, res: {} as any, user: null };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.agent.mockResolvedValue(null);
  const d = deps();
  mocks.messages.mockImplementation(d.messages); mocks.records.mockImplementation(d.records);
  mocks.provider.mockImplementation(d.provider); mocks.hydrate.mockImplementation(d.hydrate); mocks.interpret.mockImplementation(d.interpret);
});

describe("Daily Action Audit authorization and schema", () => {
  it("rejects anonymous users before reading any messages, records or provider evidence", async () => {
    await expect(dailyActionAuditRouter.createCaller(context).run(input)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(mocks.messages).not.toHaveBeenCalled(); expect(mocks.provider).not.toHaveBeenCalled(); expect(mocks.records).not.toHaveBeenCalled();
  });
  it("rejects non-admin agents before reading customer evidence", async () => {
    mocks.agent.mockResolvedValue({ agentId: 1, agentName: "Fixture Agent", agentEmail: "fixture@example.test", isAdmin: false });
    await expect(dailyActionAuditRouter.createCaller(context).run(input)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mocks.messages).not.toHaveBeenCalled(); expect(mocks.provider).not.toHaveBeenCalled();
  });
  it("allows the existing admin session and does not invoke action policy initialization", async () => {
    mocks.agent.mockResolvedValue({ agentId: 1, agentName: "Fixture Admin", agentEmail: "fixture@example.test", isAdmin: true });
    await expect(dailyActionAuditRouter.createCaller(context).run(input)).resolves.toHaveProperty("items");
    expect(mocks.messages).toHaveBeenCalledTimes(1);
  });
  it.each([
    { ...input, auditDate: "2026-02-30" }, { ...input, timeZone: "America/Los_Angeles" }, { ...input, phone: customerPhone },
    { ...input, cursor: { sessionAfterId: -1, inboundAfterId: 0, asOf: now.toISOString() } },
    { ...input, cursor: { sessionAfterId: 0, inboundAfterId: 0, asOf: "invalid" } },
    { ...input, cursor: { sessionAfterId: 0, inboundAfterId: 0, asOf: now.toISOString(), providerAfter: "x".repeat(2_001) } },
  ])("rejects malformed dates, caller-supplied identities and unsafe cursors %j", value => {
    expect(dailyAuditInputSchema.safeParse(value).success).toBe(false);
  });
});

describe("Daily Action Audit read-only orchestration", () => {
  it("runs actual evidence interpretation and deterministic verification together with a mocked model only", async () => {
    const actual = await vi.importActual<typeof import("./dailyActionAuditInterpret")>("./dailyActionAuditInterpret");
    const d = deps({ time: "11:00" });
    d.interpret = async value => actual.interpretAuditThreads(value, async params => {
      const prepared = JSON.parse(params.messages[1].content as string).threads[0];
      const { id: _id, ...prediction } = candidate;
      return { id: "offline", created: 0, model: "fixture", choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: JSON.stringify({ actions: [{ ...prediction, threadKey: prepared.key, anchorMessageKey: prepared.messages[0].key, evidenceKeys: [prepared.messages[0].key] }] }) } }] };
    });
    const result = await runDailyActionAudit(input, d);
    expect(result.items).toHaveLength(1);
    expect(result.items[0].status).toBe("needs_action");
    expect(result.items[0].expected.time).toBe("09:00");
    expect(result.items[0].evidence[0].text).toBe(message.text);
  });
  it("verifies an already-matching 9am request without inventing a confirmation or system action", async () => {
    const d = deps();
    const result = await runDailyActionAudit(input, d);
    expect(result.items[0].status).toBe("matches");
    expect(result.items[0].agreement).toBe("requested");
    expect(result.items[0].verification).toContain("historical completion are not proven");
    expect(result.coverage.status).toBe("partial");
    expect(result.nextCursor).toBeNull();
    expect(d.provider).toHaveBeenCalledTimes(1); expect(d.records).toHaveBeenCalledTimes(1); expect(d.interpret).toHaveBeenCalledTimes(1);
  });
  it("flags an actual 11am job for a 9am customer request", async () => {
    const result = await runDailyActionAudit(input, deps({ time: "11:00" }));
    expect(result.items[0].status).toBe("needs_action");
    expect(result.items[0].records.find(record => record.source === "leadflow_jobs")?.time).toBe("11:00");
  });
  it("refuses matches when the required record snapshot was truncated", async () => {
    const result = await runDailyActionAudit(input, deps({ truncated: true }));
    expect(result.items[0].status).toBe("cannot_verify");
    expect(result.coverage.truncated).toBe(true);
  });
  it("stops further provider evidence reads after a page failure, without automatic retry", async () => {
    const d = deps({ providerWarning: true });
    const result = await runDailyActionAudit(input, d);
    expect(d.provider).toHaveBeenCalledTimes(1); expect(d.hydrate).not.toHaveBeenCalled();
    expect(result.coverage.warnings).toContain("Provider read unavailable");
  });
  it("returns independent local/provider cursor state only for manual continuation", async () => {
    const d = deps({ continuation: true });
    const result = await runDailyActionAudit(input, d);
    expect(result.nextCursor).toMatchObject({ sessionAfterId: 10, inboundAfterId: 20, providerComplete: true, localComplete: false, asOf: now.toISOString() });
    expect(d.messages).toHaveBeenCalledTimes(1);
  });
  it("does not restart completed local reads while continuing provider pages", async () => {
    const d = deps();
    const result = await runDailyActionAudit({ ...input, cursor: { sessionAfterId: 10, inboundAfterId: 20, asOf: now.toISOString(), localComplete: true } }, d);
    expect(d.messages).not.toHaveBeenCalled(); expect(d.records).not.toHaveBeenCalled();
    expect(result.items).toHaveLength(0);
  });
  it("reads and releases the snapshot before interpretation instead of holding a database connection during model work", async () => {
    const order: string[] = [];
    const d = deps();
    const originalRecords = d.records, originalInterpret = d.interpret;
    d.records = vi.fn(async input => { order.push("records-start"); const value = await originalRecords(input); order.push("records-released"); return value; });
    d.interpret = vi.fn(async input => { order.push("interpret-start"); return originalInterpret(input); });
    await runDailyActionAudit(input, d);
    expect(order).toEqual(["records-start", "records-released", "interpret-start"]);
  });
  it("fails closed on missing evidence with a safe error instead of an empty clean audit", async () => {
    const d = deps(); d.messages = vi.fn(async () => { throw new Error("SQL customer text +13015550123 secret"); });
    await expect(runDailyActionAudit(input, d)).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
    try { await runDailyActionAudit(input, d); } catch (error) { expect(String(error)).not.toMatch(/customer text|301555|SQL/); }
    expect(d.interpret).not.toHaveBeenCalled();
  });
  it.each(["DB_UNAVAILABLE", "DB_UNSUPPORTED", "DB_SCHEMA", "DB_TIMEOUT", "DB_READ_FAILED"] as const)("reports a fixed %s reason at the message-read stage without a raw cause", async reason => {
    const d = deps(); d.messages = vi.fn(async () => { throw new AuditSnapshotError(reason); });
    let thrown: any;
    try { await runDailyActionAudit(input, d); } catch (error) { thrown = error; }
    expect(thrown).toMatchObject({ code: "INTERNAL_SERVER_ERROR", message: auditFailureMessage("MESSAGE_READ", reason) });
    expect(thrown.cause).toBeUndefined();
    expect(safeAuditFailureMessage(thrown.message)).toBe(thrown.message);
    expect(d.records).not.toHaveBeenCalled(); expect(d.interpret).not.toHaveBeenCalled();
  });
  it("distinguishes current-record read failures from stored-message reads", async () => {
    const d = deps(); d.records = vi.fn(async () => { throw new AuditSnapshotError("DB_SCHEMA"); });
    await expect(runDailyActionAudit(input, d)).rejects.toMatchObject({ message: auditFailureMessage("RECORD_READ", "DB_SCHEMA") });
    expect(d.messages).toHaveBeenCalledTimes(1); expect(d.interpret).not.toHaveBeenCalled();
  });
  it("reports processing failures without mislabeling them as a database read", async () => {
    const d = deps(); d.verify = vi.fn(() => { throw new Error("SECRET CUSTOMER +13015550123 SQL"); });
    await expect(runDailyActionAudit(input, d)).rejects.toMatchObject({ message: auditFailureMessage("PROCESSING", "FAILED") });
  });
  it("sanitizes dependency-thrown tRPC exceptions rather than attaching their raw payload", async () => {
    const d = deps(); d.records = vi.fn(async () => { throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "SQL SECRET +13015550123", cause: new Error("raw query parameters") }); });
    let thrown: any;
    try { await runDailyActionAudit(input, d); } catch (error) { thrown = error; }
    expect(thrown.message).toBe(auditFailureMessage("RECORD_READ", "FAILED"));
    expect(thrown.cause).toBeUndefined();
  });
  it("allows only complete fixed failure messages, never secret text appended to a code", () => {
    const known = auditFailureMessage("MESSAGE_READ", "DB_SCHEMA");
    expect(safeAuditFailureMessage(known)).toBe(known);
    for (const unsafe of [known + " secret phone", "[DAA:MESSAGE_READ:DB_SCHEMA] SQL customer data", "UNKNOWN", null, { message: known }]) {
      expect(safeAuditFailureMessage(unsafe)).toBeNull();
    }
  });
  it.each(["2026-11-12", "2026-11-13"])("rejects today/future %s before reading evidence", async auditDate => {
    const d = deps(); await expect(runDailyActionAudit({ ...input, auditDate }, d)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(d.provider).not.toHaveBeenCalled(); expect(d.messages).not.toHaveBeenCalled();
  });
  it("rejects a future continuation cutoff before any reads", async () => {
    const d = deps();
    await expect(runDailyActionAudit({ ...input, cursor: { sessionAfterId: 0, inboundAfterId: 0, asOf: "2026-11-13T16:00:00.000Z" } }, d)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(d.provider).not.toHaveBeenCalled();
  });
  it("retains model-unavailable warnings and never calls an action executor", async () => {
    const d = deps(); d.interpret = vi.fn(async () => ({ candidates: [], warnings: ["Model interpretation unavailable"], threadsAnalyzed: 0 }));
    const result = await runDailyActionAudit(input, d);
    expect(result.items).toHaveLength(0); expect(result.coverage.threadsAnalyzed).toBe(0);
    expect(result.coverage.warnings).toContain("Model interpretation unavailable");
  });
});
