import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuditCandidate, AuditDayCollection, AuditDaySms, AuditRecord } from "../shared/dailyActionAudit";
const mocks = vi.hoisted(() => ({ agent: vi.fn(), collect: vi.fn(), records: vi.fn(), interpret: vi.fn() }));
vi.mock("./_core/agentAuth", () => ({ getAgentFromRequest: mocks.agent }));
vi.mock("./dailyActionAuditData", async original => ({ ...(await original() as any), readAuditRecords: mocks.records }));
vi.mock("./dailyActionAuditCollection", async original => ({ ...(await original() as any), collectAuditDaySms: mocks.collect }));
vi.mock("./dailyActionAuditInterpret", async original => ({ ...(await original() as any), interpretAuditThreads: mocks.interpret }));
import { dailyActionAuditRouter, dailyAuditInputSchema, runDailyActionAudit, type DailyAuditDependencies } from "./dailyActionAuditRouter";
import { prepareAuditDayThreads } from "./dailyActionAuditCollection";
import { verifyAuditCandidates } from "./dailyActionAuditEngine";
import { AuditSnapshotError } from "./dailyActionAuditSnapshot";
import { AUDIT_COLLECTION_FAILURES, auditFailureMessage, safeAuditFailureMessage } from "../shared/dailyActionAudit";
import { TRPCError } from "@trpc/server";

const now = new Date("2026-11-12T16:00:00.000Z");
const input = { auditDate: "2026-11-11", timeZone: "America/New_York" as const };
const customerPhone = "+13015550123";
function sms(index = 1): AuditDaySms {
  return { id: `ACfixture${index}`, from: customerPhone, to: ["+12025550123"], text: "Please move tomorrow's cleaning to 9am", phoneNumberId: "PNfixture", conversationId: "CNfixture", direction: "incoming", status: "received", createdAt: "2026-11-11T15:00:00.000Z", updatedAt: "2026-11-11T15:00:00.000Z", media: [] };
}
function collection(messages = [sms()]): AuditDayCollection {
  return { status: "complete", scope: "organization", start: "2026-11-11T05:00:00.000Z", end: "2026-11-12T05:00:00.000Z", messages, pagesRead: 1, incoming: messages.filter(m => m.direction === "incoming").length, outgoing: messages.filter(m => m.direction === "outgoing").length, duplicates: 0, outOfWindow: 0, failure: null };
}
const candidate: AuditCandidate = { id: "a1", threadKey: "t1", action: "reschedule", agreement: "requested", anchorMessageKey: "m1", evidenceKeys: ["m1"], explanation: "Request for 9am tomorrow", confidence: 0.95, supersededByMessageKey: null, ambiguous: false, expected: { bookingReference: "LF-FIXTURE", date: "2026-11-12", originalDate: null, time: "09:00", timeKind: "exact", windowEnd: null, scope: "visit", address: null, serviceName: null, extras: null, teamName: null, amountCents: null } };
function record(source: AuditRecord["source"], time = "09:00"): AuditRecord {
  return { key: source === "bookings" ? "booking:1" : "job:1", source, bookingId: 1, jobId: source === "leadflow_jobs" ? 1 : null, publicBookingNumber: "LF-FIXTURE", seriesId: null, customerPhone, customerName: "Fixture Customer", date: "2026-11-12", time, timeZone: "America/New_York", status: "confirmed", address: "123 Fixture Street", serviceName: "Standard Cleaning", extras: [], teamName: null, recurrence: "one-time", paymentStatus: null, paidAmountCents: null };
}
function deps(options: { time?: string; truncated?: boolean } = {}): DailyAuditDependencies {
  return {
    now: () => now,
    collect: vi.fn(async () => collection()), prepare: prepareAuditDayThreads,
    records: vi.fn(async () => ({ records: [record("bookings"), record("leadflow_jobs", options.time)], truncated: options.truncated ?? false, warnings: [] })),
    interpret: vi.fn(async ({ threads }) => ({ candidates: [{ ...candidate, threadKey: threads[0].key, anchorMessageKey: threads[0].messages[0].key, evidenceKeys: [threads[0].messages[0].key] }], warnings: [], threadsAnalyzed: threads.length, failedThreads: 0, omittedMessages: 0 })),
    verify: verifyAuditCandidates,
  };
}
const context = { req: {} as any, res: {} as any, user: null };
beforeEach(() => {
  vi.clearAllMocks(); mocks.agent.mockResolvedValue(null);
  const d = deps(); mocks.collect.mockImplementation(d.collect); mocks.records.mockImplementation(d.records); mocks.interpret.mockImplementation(d.interpret);
});

describe("Daily Action Audit complete-day authorization", () => {
  it("rejects anonymous users before collecting SMS or reading records", async () => {
    await expect(dailyActionAuditRouter.createCaller(context).run(input)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(mocks.collect).not.toHaveBeenCalled(); expect(mocks.records).not.toHaveBeenCalled(); expect(mocks.interpret).not.toHaveBeenCalled();
  });
  it("rejects non-admin agents before collecting evidence", async () => {
    mocks.agent.mockResolvedValue({ agentId: 1, agentName: "Fixture Agent", agentEmail: "fixture@example.test", isAdmin: false });
    await expect(dailyActionAuditRouter.createCaller(context).run(input)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mocks.collect).not.toHaveBeenCalled();
  });
  it("allows the existing admin session without initializing any action policy", async () => {
    mocks.agent.mockResolvedValue({ agentId: 1, agentName: "Fixture Admin", agentEmail: "fixture@example.test", isAdmin: true });
    await expect(dailyActionAuditRouter.createCaller(context).run(input)).resolves.toMatchObject({ collection: { status: "complete" } });
    expect(mocks.collect).toHaveBeenCalledTimes(1);
  });
  it.each([
    { ...input, auditDate: "2026-02-30" }, { ...input, timeZone: "America/Los_Angeles" }, { ...input, phone: customerPhone },
    { ...input, messages: [sms()] }, { ...input, collection: collection() },
    { ...input, cursor: { sessionAfterId: -1, inboundAfterId: 0, asOf: now.toISOString() } },
  ])("rejects invalid dates, caller identities and client-supplied source evidence %j", value => {
    expect(dailyAuditInputSchema.safeParse(value).success).toBe(false);
  });
});

describe("Daily Action Audit collection-first pipeline", () => {
  it("collects all three real-source pages before the actual interpreter/verifier can see a last-page request", async () => {
    const actualCollection = await vi.importActual<typeof import("./dailyActionAuditCollection")>("./dailyActionAuditCollection");
    const actualInterpret = await vi.importActual<typeof import("./dailyActionAuditInterpret")>("./dailyActionAuditInterpret");
    const order: string[] = [];
    const messages = Array.from({ length: 121 }, (_, i) => ({ ...sms(i), text: i === 120 ? sms().text : "Thank you" }));
    let page = 0;
    const d = deps({ time: "11:00" });
    d.collect = async window => actualCollection.collectAuditDaySms(window, { apiKey: "offline-fixture", request: async () => {
      order.push(`page-${page}`);
      const data = messages.slice(page * 50, (page + 1) * 50); page++;
      return new Response(JSON.stringify({ data, nextCursor: page < 3 ? `next-${page}` : null }));
    } });
    const recordRead = d.records;
    d.records = async value => { order.push("records"); return recordRead(value); };
    d.interpret = async value => actualInterpret.interpretAuditThreads(value, async params => {
      order.push("model"); const payload = JSON.parse(params.messages[1].content as string);
      const owner = payload.threads.find((t: any) => t.messages.some((m: any) => m.text.includes("9am")));
      const { id: _id, ...prediction } = candidate;
      const anchor = owner?.messages.find((m: any) => m.text.includes("9am"));
      return { id: "offline", created: 0, model: "fixture", choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: JSON.stringify({ actions: owner ? [{ ...prediction, threadKey: owner.key, anchorMessageKey: anchor.key, evidenceKeys: [anchor.key] }] : [] }) } }] };
    });
    const result = await runDailyActionAudit(input, d);
    expect(order.slice(0, 4)).toEqual(["page-0", "page-1", "page-2", "records"]);
    expect(order.indexOf("model")).toBeGreaterThan(order.indexOf("page-2"));
    expect(result.collection?.messages).toHaveLength(121); expect(result.collection?.status).toBe("complete");
    expect(result.items).toHaveLength(1); expect(result.items[0].expected.time).toBe("09:00");
    expect(result.items[0].status).toBe("needs_action"); expect(result.items[0].evidence[0].text).toContain("9am");
    expect(result.coverage.messagesRead).toBe(121); expect(result.nextCursor).toBeNull();
  });
  it("verifies a current 9am request without inventing confirmation or changing the booking", async () => {
    const d = deps(); const result = await runDailyActionAudit(input, d);
    expect(result.items[0].status).toBe("matches"); expect(result.items[0].agreement).toBe("requested");
    expect(result.items[0].verification).toContain("historical completion are not proven");
    expect(result.analysis?.status).toBe("complete"); expect(result.collection?.incoming).toBe(1);
    expect(d.records).toHaveBeenCalledTimes(1); expect(d.interpret).toHaveBeenCalledTimes(1);
  });
  it("flags an 11am job for the customer's exact 9am request", async () => {
    const result = await runDailyActionAudit(input, deps({ time: "11:00" }));
    expect(result.items[0].status).toBe("needs_action"); expect(result.items[0].records.find(r => r.source === "leadflow_jobs")?.time).toBe("11:00");
  });
  it("does not turn a truncated record snapshot into matches", async () => {
    const result = await runDailyActionAudit(input, deps({ truncated: true }));
    expect(result.items[0].status).toBe("cannot_verify"); expect(result.analysis?.status).toBe("partial");
  });
  it.each(Object.keys(AUDIT_COLLECTION_FAILURES) as Array<keyof typeof AUDIT_COLLECTION_FAILURES>)("blocks all analysis and DB reads after %s collection failure", async failure => {
    const d = deps(); d.collect = async () => ({ ...collection(), status: "failed", failure });
    const result = await runDailyActionAudit(input, d);
    expect(result.collection?.status).toBe("failed"); expect(result.collection?.messages).toHaveLength(1);
    expect(result.analysis?.status).toBe("not_run"); expect(result.coverage.warnings).toContain(AUDIT_COLLECTION_FAILURES[failure]);
    expect(d.records).not.toHaveBeenCalled(); expect(d.interpret).not.toHaveBeenCalled(); expect(result.nextCursor).toBeNull();
  });
  it("does not run a model or DB read on a successfully exhausted empty source day", async () => {
    const d = deps(); d.collect = async () => collection([]);
    const result = await runDailyActionAudit(input, d);
    expect(result.collection?.status).toBe("complete"); expect(result.collection?.messages).toHaveLength(0);
    expect(d.records).not.toHaveBeenCalled(); expect(d.interpret).not.toHaveBeenCalled();
  });
  it("retains group, media and non-US SMS in source collection without assigning them to an unrelated customer", async () => {
    const d = deps(); d.collect = async () => collection([{ ...sms(), to: ["+12025550123", "+13015550999"] }, { ...sms(2), text: "", media: [{ url: "https://example.test/image" }] }, { ...sms(3), from: "+442071234567" }]);
    const result = await runDailyActionAudit(input, d);
    expect(result.collection?.messages).toHaveLength(3); expect(result.analysis?.unsupportedMessages).toBe(3);
    expect(result.analysis?.status).toBe("partial"); expect(result.items).toHaveLength(0);
    expect(d.records).not.toHaveBeenCalled(); expect(d.interpret).not.toHaveBeenCalled();
  });
  it("releases records before model work and makes full source collection the first stage", async () => {
    const d = deps(); const order: string[] = [];
    const originalCollect = d.collect, originalRecords = d.records, originalInterpret = d.interpret;
    d.collect = async value => { order.push("collection"); return originalCollect(value); };
    d.records = async value => { const result = await originalRecords(value); order.push("records-released"); return result; };
    d.interpret = async value => { order.push("interpretation"); return originalInterpret(value); };
    await runDailyActionAudit(input, d); expect(order).toEqual(["collection", "records-released", "interpretation"]);
  });
  it("returns explicit failed analysis while retaining the complete source corpus", async () => {
    const d = deps(); d.interpret = async () => ({ candidates: [], warnings: ["Message interpretation unavailable"], threadsAnalyzed: 0, failedThreads: 1, omittedMessages: 0 });
    const result = await runDailyActionAudit(input, d);
    expect(result.analysis).toMatchObject({ status: "failed", threadsTotal: 1, threadsAnalyzed: 0, failedThreads: 1 });
    expect(result.collection?.messages[0].text).toContain("9am"); expect(result.coverage.warnings).toContain("Message interpretation unavailable");
  });
  it("distinguishes partially failed analysis from a completed day with no actions", async () => {
    const d = deps(); d.collect = async () => collection([sms(), { ...sms(2), from: "+13015550999", conversationId: "CNother" }]);
    d.interpret = async () => ({ candidates: [], warnings: ["One chunk failed"], threadsAnalyzed: 1, failedThreads: 1, omittedMessages: 0 });
    const result = await runDailyActionAudit(input, d); expect(result.analysis?.status).toBe("partial");
    expect(result.analysis?.threadsTotal).toBe(2); expect(result.collection?.messages).toHaveLength(2);
  });
  it("retains source-valid partial findings when another chunk of the same conversation failed", async () => {
    const d = deps(); const original = d.interpret;
    d.interpret = async value => ({ ...(await original(value)), threadsAnalyzed: 0, failedThreads: 1, warnings: ["One conversation chunk failed"] });
    const result = await runDailyActionAudit(input, d);
    expect(result.analysis).toMatchObject({ status: "partial", threadsAnalyzed: 0, failedThreads: 1 });
    expect(result.items).toHaveLength(1); expect(result.items[0].evidence[0].text).toContain("9am");
    expect(result.collection?.status).toBe("complete");
  });
  it.each(["2026-11-12", "2026-11-13"])("rejects today/future %s before collection", async auditDate => {
    const d = deps(); await expect(runDailyActionAudit({ ...input, auditDate }, d)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(d.collect).not.toHaveBeenCalled();
  });
  it("rejects old sampled cursors instead of treating them as a complete-day source", async () => {
    const d = deps(); await expect(runDailyActionAudit({ ...input, cursor: { sessionAfterId: 10, inboundAfterId: 20, asOf: now.toISOString() } }, d)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(d.collect).not.toHaveBeenCalled();
  });
  it.each(["DB_UNAVAILABLE", "DB_UNSUPPORTED", "DB_SCHEMA", "DB_TIMEOUT", "DB_READ_FAILED"] as const)("preserves sanitized %s current-record failures", async reason => {
    const d = deps(); d.records = async () => { throw new AuditSnapshotError(reason); };
    let thrown: any; try { await runDailyActionAudit(input, d); } catch (e) { thrown = e; }
    expect(thrown.message).toBe(auditFailureMessage("RECORD_READ", reason)); expect(thrown.cause).toBeUndefined();
    expect(d.interpret).not.toHaveBeenCalled();
  });
  it("sanitizes raw collection exceptions without retaining SQL, SMS or credentials", async () => {
    const d = deps(); d.collect = async () => { throw new Error("SQL SECRET +13015550123 customer text"); };
    await expect(runDailyActionAudit(input, d)).rejects.toMatchObject({ message: auditFailureMessage("MESSAGE_READ", "FAILED") });
    expect(d.records).not.toHaveBeenCalled();
  });
  it("sanitizes raw processing/tRPC exceptions instead of rendering source payloads", async () => {
    const d = deps(); d.verify = () => { throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "SECRET SQL CUSTOMER" }); };
    await expect(runDailyActionAudit(input, d)).rejects.toMatchObject({ message: auditFailureMessage("PROCESSING", "FAILED") });
  });
  it("allows only exact fixed error messages", () => {
    const known = auditFailureMessage("MESSAGE_READ", "DB_SCHEMA"); expect(safeAuditFailureMessage(known)).toBe(known);
    for (const unsafe of [known + " secret phone", "[DAA:MESSAGE_READ:DB_SCHEMA] SQL customer data", null, { message: known }]) expect(safeAuditFailureMessage(unsafe)).toBeNull();
  });
});
