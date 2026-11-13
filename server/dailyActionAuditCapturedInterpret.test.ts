import { afterEach, describe, expect, it, vi } from "vitest";
import { interpretAuditThreads } from "./dailyActionAuditInterpret";
import type { AuditMessage, AuditThread } from "../shared/dailyActionAudit";
const message: AuditMessage = { key: "m1", sessionId: 1, customerPhone: "+13015550123", businessPhone: null, direction: "inbound", text: "Move my November 12 cleaning to 9am", occurredAt: "2026-11-11T16:00:00.000Z", observedAt: "2026-11-11T16:00:00.000Z", timeBasis: "history", delivery: "received", source: "conversation_history" };
const thread: AuditThread = { key: "t1", customerPhone: message.customerPhone, customerName: "Synthetic", messages: [message], truncated: false };
const input = { auditDate: "2026-11-11", timeZone: "America/New_York", threads: [thread], records: [], evidenceMode: "captured" as const };
const prediction = { threadKey: "t1", action: "reschedule", agreement: "requested", anchorMessageKey: "m1", evidenceKeys: ["m1"], expected: { bookingReference: null, date: "2026-11-12", originalDate: null, time: "09:00", timeKind: "exact", windowEnd: null, scope: "visit", address: null, serviceName: null, extras: null, extrasMode: "unspecified", teamName: null, amountCents: null }, explanation: "Captured request for November 12 at 9am", confidence: 0.95, supersededByMessageKey: null, ambiguous: false };
function output(actions: unknown[]) { return { id: "fixture", created: 0, model: "offline", choices: [{ index: 0, message: { role: "assistant" as const, content: JSON.stringify({ actions }) }, finish_reason: "stop" }] }; }
afterEach(() => vi.useRealTimers());
describe("captured-message interpretation", () => {
  it("keeps explicit captured inbound requests without claiming provider-time proof", async () => {
    const result = await interpretAuditThreads(input, async () => output([prediction]));
    expect(result.candidates[0]).toMatchObject({ ambiguous: false, agreement: "requested" });
    expect(input.threads[0].messages[0].timeBasis).toBe("history");
  });
  it("supports orphan inbound requests with observed-time caveats", async () => {
    const result = await interpretAuditThreads({ ...input, threads: [{ ...thread, messages: [{ ...message, occurredAt: null, timeBasis: "received", source: "inbound_sms" }] }] }, async () => output([prediction]));
    expect(result.candidates[0].ambiguous).toBe(false);
  });
  it("retains valid source-linked actions when another item is malformed", async () => {
    const result = await interpretAuditThreads(input, async () => output([prediction, { ...prediction, expected: { ...prediction.expected, time: "25:00" } }]));
    expect(result.candidates).toHaveLength(1); expect(result.threadsAnalyzed).toBe(0); expect(result.failedThreads).toBe(1);
    expect(result.warnings.join(" ")).toContain("valid referenced actions were retained");
  });
  it("does not lose another person's actions when one person's response is invalid", async () => {
    const second = { ...thread, key: "t2", customerPhone: "+13015550124", messages: [{ ...message, key: "m2", customerPhone: "+13015550124" }] };
    const batches: number[] = [];
    const result = await interpretAuditThreads({ ...input, threads: [thread, second] }, async params => {
      const payload = JSON.parse(params.messages[1].content as string); batches.push(payload.threads.length);
      if (payload.threads[0].key === "t1") return { ...output([]), choices: [{ ...output([]).choices[0], message: { role: "assistant", content: "invalid json" } }] };
      return output([{ ...prediction, threadKey: "t2", anchorMessageKey: "m2", evidenceKeys: ["m2"] }]);
    });
    expect(batches).toEqual([1, 1]); expect(result.candidates[0].threadKey).toBe("t2"); expect(result.threadsAnalyzed).toBe(1); expect(result.failedThreads).toBe(1);
  });
  it("never lets an unverified outbound draft anchor an action", async () => {
    const result = await interpretAuditThreads({ ...input, threads: [{ ...thread, messages: [{ ...message, direction: "outbound", delivery: "unknown" }] }] }, async () => output([prediction]));
    expect(result.candidates).toHaveLength(0); expect(result.warnings.join(" ")).toContain("unverified outbound draft");
  });
  it("rejects invented or cross-person source keys", async () => {
    const result = await interpretAuditThreads(input, async () => output([{ ...prediction, evidenceKeys: ["m1", "foreign-message"] }]));
    expect(result.candidates).toHaveLength(0); expect(result.failedThreads).toBe(1);
  });
  it("bounds the fully serialized request and keeps the existing exact catalog/model transport contract", async () => {
    await interpretAuditThreads(input, async params => {
      expect(JSON.stringify(params).length).toBeLessThanOrEqual(32_000);
      expect(params.messages[0].content).toContain("CAPTURED-CONVERSATION review");
      expect(params.tools).toBeUndefined(); expect(params.response_format?.type).toBe("json_schema");
      return output([]);
    });
  });
  it("finishes after a stalled call without launching another call or claiming cancellation", async () => {
    vi.useFakeTimers();
    const call = vi.fn(() => new Promise<any>(() => {}));
    const pending = interpretAuditThreads({ ...input, threads: [thread, { ...thread, key: "t2" }] }, call);
    await vi.advanceTimersByTimeAsync(20_000);
    const result = await pending;
    expect(call).toHaveBeenCalledTimes(1); expect(result.failedThreads).toBe(2); expect(result.candidates).toHaveLength(0); expect(vi.getTimerCount()).toBe(0);
  });
  it("does not label fragmented or omitted context as fully analyzed", async () => {
    const messages = Array.from({ length: 8 }, (_, i) => ({ ...message, key: `large-${i}`, text: "x".repeat(7000) }));
    const result = await interpretAuditThreads({ ...input, threads: [{ ...thread, messages }] }, async () => output([]));
    expect(result.threadsAnalyzed).toBe(0); expect(result.failedThreads).toBe(1); expect(result.warnings.join(" ")).toContain("Cross-chunk");
  });
});
