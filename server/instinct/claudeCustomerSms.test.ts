import { afterEach, describe, expect, it, vi } from "vitest";
import { claudeCustomerSmsConfig, createClaudeCustomerSmsService, customerHistoryHash, customerSmsInstant, type CustomerSmsInput, type CustomerSmsSession } from "./claudeCustomerSms";
import type { CustomerSmsClaim } from "./claudeCustomerTasksStore";
const created = "2026-11-16T18:00:00Z", at = Date.parse(created);
const input: CustomerSmsInput = { sessionId: 71, providerMessageId: "inbound-real", fromPhone: "+12025550123", receivingPhoneNumberId: "PN-existing", inboundText: "Move my cleaning to Monday at 9", createdAt: created, receivedAt: at + 1000, isCleaner: false, direction: "incoming" };
const snapshot = (): CustomerSmsSession => ({ contact: { sessionId: "71", rawPhone: input.fromPhone, phone: input.fromPhone, displayName: "Jane Smith", contactGap: null },
  messageHistory: JSON.stringify([{ role: "user", content: "Previous question", opMsgId: "older" }, { role: "assistant", content: "Earlier staff reply" }, { role: "user", content: input.inboundText, opMsgId: input.providerMessageId }]),
  lastInboundPhoneNumberId: input.receivingPhoneNumberId, leadSource: "cs-inbound", smsOptOut: 0, csQueue: "Clients" });
function fixture() {
  const order: string[] = [];
  const store = { claim: vi.fn(async (binding: any) => { order.push("claim"); return { draftId: 5, binding } as CustomerSmsClaim; }),
    prepare: vi.fn(async () => { order.push("task-and-text-durable"); return true; }), recordAcceptance: vi.fn(async () => { order.push("acceptance"); return true; }),
    markUncertain: vi.fn(async () => undefined), suppress: vi.fn(async () => undefined) };
  const config = vi.fn(() => ({ startAt: at - 1000 }));
  const readSession = vi.fn(async () => snapshot()), readReceivingLine = vi.fn(async () => "+12025550999");
  const generate = vi.fn(async () => { order.push("generate"); return { replyText: "Absolutely, Jane—we'll take care of this and confirm once the change is made.", task: { title: "Reschedule Jane's cleaning", items: [{ title: "Move cleaning to Monday at 9", evidenceQuote: input.inboundText }] } }; });
  const send = vi.fn(async () => { order.push("send"); return { success: true, messageId: "accepted-provider-id" }; });
  return { order, store, config, readSession, readReceivingLine, generate, send, run: createClaudeCustomerSmsService({ config, readSession, readReceivingLine, generate, store, send }) };
}
afterEach(() => vi.restoreAllMocks());
describe("customer replies and real human-task intent", () => {
  it("persists the task and exact acknowledgment before using the actual receiving line", async () => {
    const f = fixture(); expect(await f.run(input)).toEqual({ outcome: "accepted" });
    expect(f.order).toEqual(["claim", "generate", "task-and-text-durable", "send", "acceptance"]);
    expect(f.send).toHaveBeenCalledWith({ to: input.fromPhone, content: expect.stringContaining("we'll take care"), fromNumberId: "PN-existing" });
    expect(f.store.claim.mock.calls[0][0]).toMatchObject({ providerMessageId: input.providerMessageId, historyHash: customerHistoryHash(snapshot().messageHistory) });
  });
  it("is completely passive when disabled", async () => { const f = fixture(); f.config.mockReturnValue(null as never); expect(await f.run(input)).toEqual({ outcome: "disabled" }); expect(f.readSession).not.toHaveBeenCalled(); expect(f.generate).not.toHaveBeenCalled(); expect(f.send).not.toHaveBeenCalled(); });
  it.each([{ createdAt: "2026-11-15T18:00:00Z" }, { receivedAt: at - 2000 }, { createdAt: "2026-11-16" }, { createdAt: "2026-11-16T18:01:00Z" }, { direction: "outgoing" }, { direction: undefined }, { isCleaner: true }, { providerMessageId: "" }, { providerMessageId: "cs-fallback-123" }, { receivingPhoneNumberId: "" }, { sessionId: -1 }, { inboundText: "STOP" }, { inboundText: "unsubscribe" }, { fromPhone: "+16505164957" }, { fromPhone: "+16506469270" }])("excludes old, malformed or noncustomer event %# before reads", async patch => { const f = fixture(); expect(await f.run({ ...input, ...patch })).toEqual({ outcome: "excluded" }); expect(f.readSession).not.toHaveBeenCalled(); expect(f.store.claim).not.toHaveBeenCalled(); });
  it.each([{ leadSource: "hiring" }, { leadSource: "cs-inbound-cleaner" }, { leadSource: undefined }, { smsOptOut: 1 }, { csQueue: "Teams" }, { lastInboundPhoneNumberId: "wrong" }, { contact: { ...snapshot().contact, sessionId: "99" } }, { messageHistory: "invalid" }, { messageHistory: JSON.stringify([{ role: "user", content: input.inboundText }]) }])("rejects context contradiction %# without generation", async patch => { const f = fixture(); f.readSession.mockResolvedValue({ ...snapshot(), ...patch }); expect(await f.run(input)).toEqual({ outcome: "excluded" }); expect(f.generate).not.toHaveBeenCalled(); });
  it("rejects an already answered source and a contradictory source ID", async () => { const f = fixture(), s = snapshot(), h = JSON.parse(s.messageHistory as string); h.push({ role: "assistant", content: "Human already answered" }); f.readSession.mockResolvedValue({ ...s, messageHistory: JSON.stringify(h) }); expect(await f.run(input)).toEqual({ outcome: "excluded" }); h.pop(); h.at(-1).providerMessageId = "conflicting-id"; f.readSession.mockResolvedValue({ ...s, messageHistory: JSON.stringify(h) }); expect(await f.run(input)).toEqual({ outcome: "excluded" }); expect(f.send).not.toHaveBeenCalled(); });
  it("skips every duplicate receipt without generating, task creation or send", async () => { const f = fixture(); f.store.claim.mockResolvedValue(null as never); expect(await f.run(input)).toEqual({ outcome: "duplicate" }); expect(f.generate).not.toHaveBeenCalled(); expect(f.store.prepare).not.toHaveBeenCalled(); expect(f.send).not.toHaveBeenCalled(); });
  it("does not send an acknowledgment if durable task persistence fails", async () => { const f = fixture(); f.store.prepare.mockRejectedValue(new Error("storage failure")); expect(await f.run(input)).toEqual({ outcome: "failed" }); expect(f.send).not.toHaveBeenCalled(); expect(f.store.suppress).toHaveBeenCalled(); });
  it("does not send stale or human-won claims", async () => { const f = fixture(); f.store.prepare.mockResolvedValue(false); expect(await f.run(input)).toEqual({ outcome: "suppressed" }); expect(f.send).not.toHaveBeenCalled(); });
  it.each([{ success: false }, { success: true }, { success: true, messageId: " " }])("never treats provider result %# as confirmed acceptance", async response => { const f = fixture(); f.send.mockResolvedValue(response as never); expect(await f.run(input)).toEqual({ outcome: "uncertain" }); expect(f.send).toHaveBeenCalledTimes(1); expect(f.store.recordAcceptance).not.toHaveBeenCalled(); expect(f.store.markUncertain).toHaveBeenCalled(); });
  it("never retries a transport timeout or post-acceptance persistence uncertainty", async () => { const f = fixture(); f.send.mockRejectedValue(new Error("timeout")); expect(await f.run(input)).toEqual({ outcome: "uncertain" }); expect(f.send).toHaveBeenCalledTimes(1); const other = fixture(); other.store.recordAcceptance.mockRejectedValue(new Error("unknown commit")); expect(await other.run(input)).toEqual({ outcome: "uncertain" }); expect(other.send).toHaveBeenCalledTimes(1); expect(other.store.suppress).not.toHaveBeenCalled(); });
  it("checks enablement again after generation", async () => { const f = fixture(); f.config.mockReturnValueOnce({ startAt: at - 1000 }).mockReturnValue(null as never); expect(await f.run(input)).toEqual({ outcome: "suppressed" }); expect(f.send).not.toHaveBeenCalled(); });
});
describe("immutable activation cutoff", () => {
  it("requires literal enablement and a trusted fixed ISO timestamp", () => { expect(claudeCustomerSmsConfig({})).toBeNull(); expect(claudeCustomerSmsConfig({ CLAUDE_CUSTOMER_SMS_ENABLED: "1", CLAUDE_CUSTOMER_SMS_START_AT: created })).toBeNull(); expect(claudeCustomerSmsConfig({ CLAUDE_CUSTOMER_SMS_ENABLED: "true", CLAUDE_CUSTOMER_SMS_START_AT: created })).toEqual({ startAt: at }); });
  it.each(["now", "2026-02-30T00:00:00Z", "2026-11-16", "2026-11-16T18:00:00", "bad"])("rejects unsafe cutoff %s", value => expect(customerSmsInstant(value)).toBeNull());
});
