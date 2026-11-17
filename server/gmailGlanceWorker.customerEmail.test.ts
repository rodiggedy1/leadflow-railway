import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  enabled: false, cached: false,
  dispatch: vi.fn(), skipLegacy: vi.fn(), legacyDraft: vi.fn(), enrichment: vi.fn(), threadsGet: vi.fn(), broadcast: vi.fn(), phase1: vi.fn(),
  calls: [] as string[], holdPhase1: null as Promise<void> | null,
}));
vi.mock("./instinct/claudeCustomerEmail", () => ({ readCustomerEmailConfig: () => ({ enabled: h.enabled, startAt: 1 }) }));
vi.mock("./instinct/claudeCustomerEmailApplication", () => ({ dispatchCapturedClaudeCustomerEmail: h.dispatch }));
vi.mock("./instinct/claudeCustomerEmailGuards", () => ({ skipLegacyCustomerEmailDraft: h.skipLegacy }));
vi.mock("./madisonEmailAgent", () => ({ triggerMadisonEmailDraft: h.legacyDraft }));
vi.mock("./sseBroadcast", () => ({ broadcastOpsUpdate: h.broadcast }));
vi.mock("./_core/env", () => ({ ENV: { gmailRefreshToken: "offline-placeholder" } }));
vi.mock("./_core/llm", () => ({ invokeLLM: h.enrichment }));
vi.mock("../drizzle/schema", () => ({ gmailThreadMeta: { threadId: "thread", aiHistoryId: "history" }, gmailSenderPolicies: {}, gmailState: {} }));
vi.mock("drizzle-orm", () => ({ eq: vi.fn(), isNull: vi.fn(), isNotNull: vi.fn(), and: vi.fn(), or: vi.fn() }));
vi.mock("googleapis", () => ({ google: { auth: { OAuth2: class { setCredentials() {} } }, gmail: () => ({ users: { threads: { get: h.threadsGet } } }) } }));
vi.mock("./db", () => ({ getDb: async () => ({
  select: () => ({ from: () => ({ where: () => {
    const rows = h.cached ? [{ aiHistoryId: "history", senderName: "Maya", senderEmail: "maya@example.net", subject: "Hello", snippet: "Preview", lastMessageAt: 1000, messageCount: 1 }] : [];
    return Object.assign(Promise.resolve(rows), { limit: async () => [] });
  } }) }),
  insert: () => ({ values: () => ({ onDuplicateKeyUpdate: async () => {
    h.calls.push("phase1"); h.phase1(); await h.holdPhase1;
  } }) }),
  update: () => ({ set: () => ({ where: async () => {} }) }),
}) }));
const rawThread = { id: "thread-actual", historyId: "history", messages: [{
  id: "inbound-actual", threadId: "thread-actual", internalDate: "1000", labelIds: ["INBOX", "UNREAD"], snippet: "Preview",
  payload: { mimeType: "text/plain", headers: [{ name: "From", value: "Maya <maya@example.net>" }, { name: "Subject", value: "Hello" }],
    body: { data: Buffer.from("Please add oven cleaning.").toString("base64url") } },
}] };
const anchor = { inboundMessageId: "inbound-actual", receivedAt: 2000 };
async function flush() { for (let count = 0; count < 30; count++) await Promise.resolve(); }

beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks(); vi.useFakeTimers();
  h.enabled = false; h.cached = false; h.calls = []; h.holdPhase1 = null;
  h.threadsGet.mockResolvedValue({ data: rawThread });
  h.dispatch.mockImplementation(async () => { h.calls.push("capture"); return true; });
  h.skipLegacy.mockResolvedValue(false);
  h.legacyDraft.mockResolvedValue(undefined);
  h.enrichment.mockImplementation(async () => { h.calls.push("phase2"); return { choices: [{ message: { content: JSON.stringify({ category: "general", summary: ["Offline fixture"], urgency: "low" }) } }] }; });
  vi.spyOn(console, "log").mockImplementation(() => {}); vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe("post-persistence customer email worker capture", () => {
  it("default-off does no feature dispatch and preserves legacy enrichment/draft behavior", async () => {
    const worker = await import("./gmailGlanceWorker");
    await worker.processThread("thread-actual", [anchor]);
    expect(h.dispatch).not.toHaveBeenCalled();
    expect(h.enrichment).toHaveBeenCalledTimes(1);
    expect(h.legacyDraft).toHaveBeenCalledTimes(1);
    expect(h.calls).toEqual(["phase1", "phase2"]);
  });

  it("dispatches the exact original raw thread after Phase 1, before unchanged Phase 2, suppressing only owned legacy draft", async () => {
    h.enabled = true;
    const worker = await import("./gmailGlanceWorker");
    await worker.processThread("thread-actual", [anchor]);
    expect(h.dispatch).toHaveBeenCalledTimes(1);
    expect(h.dispatch).toHaveBeenCalledWith({ ...anchor, rawThread });
    expect(h.dispatch.mock.calls[0][0].rawThread).toBe(rawThread);
    expect(h.calls).toEqual(["phase1", "capture", "phase2"]);
    expect(h.enrichment).toHaveBeenCalledTimes(1);
    expect(h.legacyDraft).not.toHaveBeenCalled();
  });

  it("runs eligible capture even on a full AI cache hit, without rerunning enrichment", async () => {
    h.enabled = true; h.cached = true;
    const worker = await import("./gmailGlanceWorker");
    await worker.processThread("thread-actual", [anchor]);
    expect(h.calls).toEqual(["phase1", "capture"]);
    expect(h.dispatch).toHaveBeenCalledTimes(1);
    expect(h.enrichment).not.toHaveBeenCalled(); expect(h.legacyDraft).not.toHaveBeenCalled();
  });

  it.each([false, "failure"])("preserves enrichment and legacy behavior if application does not own actual source: %s", disposition => {
    return (async () => {
      h.enabled = true;
      if (disposition === "failure") h.dispatch.mockRejectedValue(new Error("offline-capture-failure"));
      else h.dispatch.mockResolvedValue(false);
      const worker = await import("./gmailGlanceWorker");
      await worker.processThread("thread-actual", [anchor]);
      expect(h.enrichment).toHaveBeenCalledTimes(1); expect(h.legacyDraft).toHaveBeenCalledTimes(1);
    })();
  });

  it("does not suppress current legacy draft because a different historical anchor returned owned", async () => {
    h.enabled = true;
    const worker = await import("./gmailGlanceWorker");
    await worker.processThread("thread-actual", [{ ...anchor, inboundMessageId: "older-inbound" }]);
    expect(h.dispatch).toHaveBeenCalledTimes(1); expect(h.legacyDraft).toHaveBeenCalledTimes(1);
  });

  it.each(["manual", "backfill", "pubsub"] as const)("never captures %s queue events without an actual trusted anchor", async source => {
    h.enabled = true;
    const worker = await import("./gmailGlanceWorker");
    worker.enqueueThread("thread-actual", source);
    worker.startGlanceWorker();
    await vi.advanceTimersByTimeAsync(600); await flush();
    expect(h.threadsGet).toHaveBeenCalledTimes(1); expect(h.dispatch).not.toHaveBeenCalled();
  });

  it("a manual/backfill pass cannot create a competing legacy response for an owned future email", async () => {
    h.enabled = true; h.skipLegacy.mockResolvedValue(true);
    const worker = await import("./gmailGlanceWorker");
    await worker.processThread("thread-actual");
    expect(h.dispatch).not.toHaveBeenCalled(); expect(h.enrichment).toHaveBeenCalledTimes(1);
    expect(h.skipLegacy).toHaveBeenCalledWith(expect.anything(), { threadId: "thread-actual", fromEmail: "maya@example.net", createdAt: 1000 });
    expect(h.legacyDraft).not.toHaveBeenCalled();
  });

  it.each(["manual", "backfill"] as const)("ignores even supplied anchor for %s source", async source => {
    h.enabled = true;
    const worker = await import("./gmailGlanceWorker");
    worker.enqueueThread("thread-actual", source, anchor); worker.startGlanceWorker();
    await vi.advanceTimersByTimeAsync(600); await flush();
    expect(h.dispatch).not.toHaveBeenCalled();
  });

  it("retains every exact genuine anchor when a queued thread is deduplicated", async () => {
    h.enabled = true;
    const worker = await import("./gmailGlanceWorker");
    worker.enqueueThread("thread-actual", "pubsub", { ...anchor, inboundMessageId: "older" });
    worker.enqueueThread("thread-actual", "pubsub", anchor);
    worker.enqueueThread("thread-actual", "pubsub", anchor);
    worker.startGlanceWorker();
    await vi.advanceTimersByTimeAsync(600); await flush();
    expect(h.threadsGet).toHaveBeenCalledTimes(1);
    expect(h.dispatch.mock.calls.map(call => call[0].inboundMessageId)).toEqual(["older", "inbound-actual"]);
  });

  it("retains a newly received anchor during Phase 1 and re-enqueues once after the run ends", async () => {
    h.enabled = true;
    let release!: () => void;
    h.holdPhase1 = new Promise<void>(resolve => { release = resolve; });
    const worker = await import("./gmailGlanceWorker");
    worker.enqueueThread("thread-actual", "pubsub", anchor); worker.startGlanceWorker();
    await vi.advanceTimersByTimeAsync(600); await flush();
    expect(h.phase1).toHaveBeenCalledTimes(1);
    worker.enqueueThread("thread-actual", "pubsub", { ...anchor, inboundMessageId: "new-real-inbound", receivedAt: 3000 });
    await vi.advanceTimersByTimeAsync(600); await flush();
    expect(h.threadsGet).toHaveBeenCalledTimes(1);
    h.holdPhase1 = null; release(); await flush();
    await vi.advanceTimersByTimeAsync(600); await flush();
    expect(h.threadsGet).toHaveBeenCalledTimes(2);
    expect(h.dispatch.mock.calls.map(call => call[0].inboundMessageId)).toEqual(["inbound-actual", "new-real-inbound"]);
    await vi.advanceTimersByTimeAsync(600); await flush(); expect(h.threadsGet).toHaveBeenCalledTimes(2);
  });

  it("does not retain or capture a real anchor while configuration was disabled at enqueue", async () => {
    const worker = await import("./gmailGlanceWorker");
    worker.enqueueThread("thread-actual", "pubsub", anchor); h.enabled = true;
    worker.startGlanceWorker(); await vi.advanceTimersByTimeAsync(600); await flush();
    expect(h.dispatch).not.toHaveBeenCalled();
  });

  it("drops feature anchors when disabled after enqueue, without stopping inbox/enrichment", async () => {
    h.enabled = true;
    const worker = await import("./gmailGlanceWorker");
    worker.enqueueThread("thread-actual", "pubsub", anchor); h.enabled = false;
    worker.startGlanceWorker(); await vi.advanceTimersByTimeAsync(600); await flush();
    expect(h.dispatch).not.toHaveBeenCalled(); expect(h.phase1).toHaveBeenCalledTimes(1); expect(h.enrichment).toHaveBeenCalledTimes(1);
  });

  it("leaves the forbidden resolver module unchanged and gates the only application import after Phase 1", () => {
    const source = readFileSync(new URL("./gmailGlanceWorker.ts", import.meta.url), "utf8");
    expect(source.indexOf('if (captureRun && readCustomerEmailConfig().enabled)')).toBeGreaterThan(source.indexOf('processThread INBOX_WRITE'));
    expect(source.indexOf('dispatchCapturedClaudeCustomerEmail')).toBeLessThan(source.indexOf('// ── Phase 2:'));
    expect(source).not.toContain("createClaudeCustomerReplyGenerator");
  });
});
