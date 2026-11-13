import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import type { LiveTextCheck, LiveTextContext, LiveTextSyncInput } from "../shared/liveTextMonitor";
import type { AuditRecord } from "../shared/dailyActionAudit";
const mocks = vi.hoisted(() => ({ agent: vi.fn(), agentById: vi.fn(), source: vi.fn(), persist: vi.fn(), context: vi.fn(), check: vi.fn(), automatic: vi.fn() }));
vi.mock("./_core/agentAuth", () => ({ getAgentFromRequest: mocks.agent }));
vi.mock("./db", () => ({ getDb: vi.fn(), getAgentById: mocks.agentById }));
vi.mock("./liveTextMonitorSyncSource", () => ({ readLiveTextSyncSource: mocks.source }));
vi.mock("./liveTextMonitorSyncRepository", () => ({ persistLiveTextSyncDate: mocks.persist }));
vi.mock("./liveTextMonitorData", () => ({ readLiveTextContext: mocks.context }));
vi.mock("./liveTextMonitorService", () => ({ checkLiveText: mocks.check, getLiveTextFeed: vi.fn() }));
vi.mock("./liveTextMonitorAutoSync", () => ({ checkAndSyncLiveText: mocks.automatic }));
import { syncAndCheckLiveText } from "./liveTextMonitorSync";
import { liveTextMonitorRouter, liveTextSyncInputSchema } from "./liveTextMonitorRouter";

const key = `session-text:${createHash("sha256").update("synthetic exact text").digest("hex")}`;
const input: LiveTextSyncInput = { sessionId: 7, messageKey: key, revision: "revision-1", actionId: "action-1", serviceDate: "2026-11-16" };
const at = "2026-11-13T18:00:00.000Z";
const customerPhone = "+13015550123";
const job: AuditRecord = { key: "job:9", source: "leadflow_jobs", bookingId: null, jobId: 9, publicBookingNumber: null, seriesId: null,
  customerPhone, customerName: "Fixture Customer", date: "2026-11-16", time: "09:00", timeZone: "America/New_York", status: "assigned",
  address: null, serviceName: null, extras: [], teamName: null, recurrence: "one-time", paymentStatus: null, paidAmountCents: null };
function checked(verified: "yes" | "no" | "review" = "yes"): LiveTextCheck {
  return { rowKey: key, revision: input.revision, required: "yes", verified, summary: "Reschedule cleaning to Nov 16, 2026 at 9:00 AM",
    evidence: "Fresh job evidence", actions: [{ id: input.actionId, type: "reschedule", summary: "Move to Nov 16 at 9 AM",
      syncServiceDate: input.serviceDate, verified, evidence: "Fresh job evidence", records: [{ ...job }], links: [] }], conversation: [], checkedAt: at };
}
function context(): LiveTextContext {
  const message = { key, sessionId: 7, customerPhone, businessPhone: null, direction: "inbound" as const, text: "Please move my Nov 16 cleaning to 9am.",
    occurredAt: "2026-11-13T15:00:00.000Z", observedAt: null, timeBasis: "history" as const, delivery: "received" as const, source: "conversation_history" as const };
  return { row: { key, sessionId: 7, revision: input.revision, customerName: "Fixture Customer", message, identityAmbiguous: false }, messages: [message], partial: false };
}
function dependencies() {
  return { check: vi.fn(async (_input: { sessionId: number; messageKey: string }) => checked()), context: vi.fn(async (_sessionId: number, _key: string): Promise<LiveTextContext | null> => context()),
    source: vi.fn(async (_date: string) => ({ date: input.serviceDate, fetched: 1, bookings: [{ id: 101 }] as any[] })),
    persist: vi.fn(async () => ({ complete: true, created: 1, updated: 0, protectedRecords: 0, refreshedJobIds: [9] })),
    now: () => new Date(at), locks: new Set<string>() };
}
beforeEach(() => {
  vi.clearAllMocks(); mocks.agent.mockResolvedValue(null); mocks.agentById.mockResolvedValue(null);
  const d = dependencies(); mocks.source.mockImplementation(d.source); mocks.persist.mockImplementation(d.persist);
  mocks.context.mockImplementation(d.context); mocks.check.mockImplementation(d.check);
  mocks.automatic.mockImplementation(async params => {
    const result = await syncAndCheckLiveText({ ...input, ...params });
    return { ...result.check, syncs: [result.sync] };
  });
});

describe("Internal exact-date sync and fresh check", () => {
  it("collects the explicit service date completely, validates current text, commits, then checks again", async () => {
    const d = dependencies(); const order: string[] = [];
    d.check.mockImplementation(async () => { order.push("check"); return checked(); });
    d.source.mockImplementation(async date => { order.push(`fetch:${date}`); return { date, fetched: 1, bookings: [{ id: 101 }] as any[] }; });
    d.context.mockImplementation(async () => { order.push("context"); return context(); });
    d.persist.mockImplementation(async () => { order.push("commit"); return { complete: true, created: 1, updated: 0, protectedRecords: 0, refreshedJobIds: [9] }; });
    const result = await syncAndCheckLiveText(input, d);
    expect(order).toEqual(["check", "fetch:2026-11-16", "context", "commit", "check"]);
    expect(result.sync).toMatchObject({ date: "2026-11-16", complete: true, fetched: 1, created: 1 });
    expect(result.check.verified).toBe("yes"); expect(d.locks.size).toBe(0);
  });
  it("returns the fresh 11 AM mismatch rather than the previous 9 AM match", async () => {
    const d = dependencies(); const fresh = checked("no"); fresh.actions[0].records[0].time = "11:00";
    d.check.mockResolvedValueOnce(checked("yes")).mockResolvedValueOnce(fresh);
    expect((await syncAndCheckLiveText(input, d)).check).toEqual(fresh);
  });
  it.each(["SOURCE_UNAVAILABLE", "SOURCE_INCOMPLETE"])("%s makes no database writes and shows Review, not old Yes", async code => {
    const d = dependencies(); d.source.mockRejectedValue(Object.assign(new Error("SECRET_TOKEN customer payload SQL"), { code }));
    const result = await syncAndCheckLiveText(input, d);
    expect(d.persist).not.toHaveBeenCalled(); expect(d.context).not.toHaveBeenCalled(); expect(d.check).toHaveBeenCalledTimes(1);
    expect(result.sync).toMatchObject({ complete: false, failure: code }); expect(result.check.verified).toBe("review");
    expect(result.check.actions[0].records).toEqual([]); expect(JSON.stringify(result)).not.toMatch(/SECRET_TOKEN|customer payload|SQL/);
    expect(d.locks.size).toBe(0);
  });
  it.each([
    { date: "2026-11-15", fetched: 1, bookings: [{ id: 101 }] },
    { date: "2026-11-16", fetched: 2, bookings: [{ id: 101 }] },
    { date: "2026-11-16", fetched: 0, bookings: [], error: "private response" },
  ])("refuses a returned wrong date, inconsistent count or provider error before persistence", async response => {
    const d = dependencies(); d.source.mockResolvedValue(response as any);
    const result = await syncAndCheckLiveText(input, d);
    expect(result.sync.failure).toBe("SOURCE_INCOMPLETE"); expect(d.persist).not.toHaveBeenCalled();
  });
  it("rejects a caller-selected date that is not the server-resolved action date", async () => {
    const d = dependencies(); await expect(syncAndCheckLiveText({ ...input, serviceDate: "2026-11-13" }, d)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(d.source).not.toHaveBeenCalled(); expect(d.persist).not.toHaveBeenCalled();
  });
  it.each([undefined, null, "2026-11-15"])("requires an explicit server sync target, not a displayed summary date (%s)", async target => {
    const d = dependencies(); const initial = checked(); initial.actions[0].syncServiceDate = target;
    d.check.mockResolvedValue(initial);
    await expect(syncAndCheckLiveText(input, d)).rejects.toMatchObject({ code: "BAD_REQUEST" }); expect(d.source).not.toHaveBeenCalled();
  });
  it("rejects duplicate action IDs rather than guessing", async () => {
    const d = dependencies(); const initial = checked(); initial.actions.push({ ...initial.actions[0] }); d.check.mockResolvedValue(initial);
    await expect(syncAndCheckLiveText(input, d)).rejects.toMatchObject({ code: "BAD_REQUEST" }); expect(d.source).not.toHaveBeenCalled();
  });
  it("rejects a stale initial revision before fetching", async () => {
    const d = dependencies(); const initial = checked(); initial.revision = "new"; d.check.mockResolvedValue(initial);
    await expect(syncAndCheckLiveText(input, d)).rejects.toMatchObject({ code: "CONFLICT" }); expect(d.source).not.toHaveBeenCalled();
  });
  it.each(["missing", "revision", "identity", "session"])("does not persist if %s changes during retrieval", async kind => {
    const d = dependencies(); const current = context();
    if (kind === "revision") current.row.revision = "new";
    if (kind === "identity") current.row.identityAmbiguous = true;
    if (kind === "session") current.row.sessionId = 8;
    d.context.mockResolvedValue(kind === "missing" ? null : current as any);
    const result = await syncAndCheckLiveText(input, d); expect(result.sync.failure).toBe("STALE_TEXT"); expect(d.persist).not.toHaveBeenCalled();
  });
  it("a precommit context read failure is not a successful sync", async () => {
    const d = dependencies(); d.context.mockRejectedValue(new Error("private SQL"));
    const result = await syncAndCheckLiveText(input, d); expect(result.sync.failure).toBe("STALE_TEXT"); expect(d.persist).not.toHaveBeenCalled();
  });
  it("a failed import returns Review without making the post-sync check", async () => {
    const d = dependencies(); d.persist.mockRejectedValue(new Error("private SQL"));
    const result = await syncAndCheckLiveText(input, d); expect(result.sync.failure).toBe("SYNC_UNAVAILABLE"); expect(d.check).toHaveBeenCalledTimes(1);
    expect(result.check.verified).toBe("review"); expect(d.locks.size).toBe(0);
  });
  it("protected native records are never portrayed as a fully refreshed date", async () => {
    const d = dependencies(); d.persist.mockResolvedValue({ complete: false, created: 0, updated: 0, protectedRecords: 1, refreshedJobIds: [] });
    const result = await syncAndCheckLiveText(input, d); expect(result.sync.failure).toBe("PROTECTED_RECORDS"); expect(result.check.verified).toBe("review");
    expect(d.check).toHaveBeenCalledTimes(1);
  });
  it("a successful empty source cannot prove an untouched stale local job", async () => {
    const d = dependencies(); d.source.mockResolvedValue({ date: input.serviceDate, fetched: 0, bookings: [] });
    d.persist.mockResolvedValue({ complete: true, created: 0, updated: 0, protectedRecords: 0, refreshedJobIds: [] });
    const result = await syncAndCheckLiveText(input, d); expect(result.sync.failure).toBe("SOURCE_INCOMPLETE"); expect(result.check.verified).toBe("review");
    expect(result.check.actions[0].records).toEqual([]);
  });
  it("an unrelated refreshed job cannot validate the selected job", async () => {
    const d = dependencies(); d.persist.mockResolvedValue({ complete: true, created: 0, updated: 1, protectedRecords: 0, refreshedJobIds: [10] });
    const result = await syncAndCheckLiveText(input, d); expect(result.sync.failure).toBe("SOURCE_INCOMPLETE");
  });
  it("a post-sync read failure clears the old verification but preserves the committed counts", async () => {
    const d = dependencies(); d.check.mockResolvedValueOnce(checked()).mockRejectedValueOnce(new Error("private SQL"));
    const result = await syncAndCheckLiveText(input, d);
    expect(result.sync).toMatchObject({ complete: false, created: 1, failure: "SYNC_UNAVAILABLE" }); expect(result.check.verified).toBe("review");
  });
  it.each(["revision", "action", "date"])("post-sync %s drift cannot install old proof", async kind => {
    const d = dependencies(); const fresh = checked();
    if (kind === "revision") fresh.revision = "new";
    if (kind === "action") fresh.actions = [];
    if (kind === "date") fresh.actions[0].syncServiceDate = "2026-11-17";
    d.check.mockResolvedValueOnce(checked()).mockResolvedValueOnce(fresh);
    expect((await syncAndCheckLiveText(input, d)).sync.failure).toBe("STALE_TEXT");
  });
  it("does not run another provider sync while the same date is in flight", async () => {
    const d = dependencies(); let finish!: (value: any) => void;
    d.source.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const first = syncAndCheckLiveText(input, d); await Promise.resolve(); await Promise.resolve();
    await expect(syncAndCheckLiveText(input, d)).rejects.toMatchObject({ code: "CONFLICT" }); expect(d.source).toHaveBeenCalledTimes(1);
    finish({ date: input.serviceDate, fetched: 1, bookings: [{ id: 101 }] }); await first; expect(d.locks.size).toBe(0);
  });
});

describe("Safe sync HTTP-contract and access boundary", () => {
  const caller = () => liveTextMonitorRouter.createCaller({ req: {} as any, res: {} as any, user: null });
  it.each(["2026-02-30", "2026-13-01", "11/16/2026"])("rejects invalid service date %s", date => {
    expect(liveTextSyncInputSchema.safeParse({ ...input, serviceDate: date }).success).toBe(false);
  });
  it.each(["phone", "jobId", "amountCents", "status"])("rejects caller-supplied %s", field => {
    expect(liveTextSyncInputSchema.safeParse({ ...input, [field]: "forged" }).success).toBe(false);
  });
  it("rejects unauthenticated callers without reaching any source or persistence", async () => {
    await expect(caller().checkAndSync({ sessionId: input.sessionId, messageKey: key })).rejects.toMatchObject({ code: "UNAUTHORIZED" }); expect(mocks.source).not.toHaveBeenCalled();
  });
  it("requires an active admin, not an inactive admin session", async () => {
    mocks.agent.mockResolvedValue({ agentId: 1, isAdmin: true }); mocks.agentById.mockResolvedValue({ id: 1, isActive: 0, isAdmin: 1 });
    await expect(caller().checkAndSync({ sessionId: input.sessionId, messageKey: key })).rejects.toMatchObject({ code: "UNAUTHORIZED" }); expect(mocks.source).not.toHaveBeenCalled();
  });
  it("rejects an active non-admin even with bookings permission", async () => {
    mocks.agent.mockResolvedValue({ agentId: 1, isAdmin: false }); mocks.agentById.mockResolvedValue({ id: 1, isActive: 1, isAdmin: 0, pagePermissions: JSON.stringify(["bookings"]) });
    await expect(caller().checkAndSync({ sessionId: input.sessionId, messageKey: key })).rejects.toMatchObject({ code: "FORBIDDEN" }); expect(mocks.source).not.toHaveBeenCalled();
  });
  it("admits the explicit active-admin action using actual router wiring", async () => {
    mocks.agent.mockResolvedValue({ agentId: 1, isAdmin: true }); mocks.agentById.mockResolvedValue({ id: 1, name: "Fixture Admin", isActive: 1, isAdmin: 1, pagePermissions: "[]" });
    const result = await caller().checkAndSync({ sessionId: input.sessionId, messageKey: key }); expect(result.syncs?.[0].complete).toBe(true); expect(mocks.source).toHaveBeenCalledWith(input.serviceDate);
    expect(mocks.automatic).toHaveBeenCalledWith({ sessionId: input.sessionId, messageKey: key });
  });
  it("never accepts an externally selected date, action or verification status", async () => {
    mocks.agent.mockResolvedValue({ agentId: 1, isAdmin: true }); mocks.agentById.mockResolvedValue({ id: 1, name: "Fixture Admin", isActive: 1, isAdmin: 1, pagePermissions: "[]" });
    await expect(caller().checkAndSync({ ...input } as any)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(mocks.automatic).not.toHaveBeenCalled(); expect(mocks.source).not.toHaveBeenCalled();
  });
});
