import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { claudeCustomerSmsConfig, createClaudeCustomerSmsService, customerHistoryHash, customerSmsInstant, isClaudeCustomerSmsPilotPhone, isClaudeCustomerSmsPhoneEligible, isClaudeCustomerSmsPilotCustomerOverride, type CustomerSmsInput, type CustomerSmsSession, type CustomerSmsConfig } from "./claudeCustomerSms";
import { dispatchClaudeCustomerSms } from "./claudeCustomerSmsApplication";
import type { CustomerSmsClaim } from "./claudeCustomerTasksStore";
import type { CustomerSmsOptions, CustomerSmsStore } from "./claudeCustomerSms";
import { createClaudeCustomerSmsGeneratorWithReply } from "./claudeCustomerSmsGeneration";
import { createSmsBookingQuoteReplyGenerator, type SmsBookingQuoteGenerationOptions } from "./smsBookingQuoteGeneration";
const database = vi.hoisted(() => ({ notify: vi.fn(async (_payload: { title: string; content: string }): Promise<boolean> => true), imported: vi.fn(), getDb: vi.fn(async () => null) }));
vi.mock("../_core/notification", () => ({ notifyOwner: database.notify }));
vi.mock("../db", () => { database.imported(); return { getDb: database.getDb }; });
const created = "2026-11-16T18:00:00Z", at = Date.parse(created);
const input: CustomerSmsInput = { sessionId: 71, providerMessageId: "inbound-real", fromPhone: "+12025550123", receivingPhoneNumberId: "PN-existing", inboundText: "Move my cleaning to Monday at 9", createdAt: created, receivedAt: at + 1000, isCleaner: false, direction: "incoming" };
const snapshot = (): CustomerSmsSession => ({ contact: { sessionId: "71", rawPhone: input.fromPhone, phone: input.fromPhone, displayName: "Jane Smith", contactGap: null },
  messageHistory: JSON.stringify([{ role: "user", content: "Previous question", opMsgId: "older" }, { role: "assistant", content: "Earlier staff reply" }, { role: "user", content: input.inboundText, opMsgId: input.providerMessageId }]),
  lastInboundPhoneNumberId: input.receivingPhoneNumberId, leadSource: "cs-inbound", smsOptOut: 0, csQueue: "Clients" });
function fixture(onFailure = vi.fn(async (_detail: any) => undefined)) {
  const order: string[] = [];
  const store = { claim: vi.fn(async (binding: any) => { order.push("claim"); return { draftId: 5, binding } as CustomerSmsClaim; }),
    prepare: vi.fn<CustomerSmsStore["prepare"]>(async () => { order.push("task-and-text-durable"); return true; }), recordAcceptance: vi.fn(async () => { order.push("acceptance"); return true; }),
    verifyBeforeSubmission: vi.fn(async () => true), reportFailure: vi.fn(async () => ({ taskId: 101, notify: true })), markUncertain: vi.fn(async () => undefined), suppress: vi.fn(async () => undefined), suppressBeforeSubmission: vi.fn(async () => undefined) };
  const config = vi.fn<() => CustomerSmsConfig | null>(() => ({ startAt: at - 1000, allowedPhone: input.fromPhone, testCustomerOverride: false }));
  const readSession = vi.fn(async () => snapshot()), readReceivingLine = vi.fn(async () => "+12025550999");
  const generate = vi.fn(async () => { order.push("generate"); return { replyText: "Absolutely, Jane—we'll take care of this and confirm once the change is made.", task: { title: "Reschedule Jane's cleaning", items: [{ title: "Move cleaning to Monday at 9", evidenceQuote: input.inboundText }] } }; });
  const send = vi.fn(async () => { order.push("send"); return { success: true, messageId: "accepted-provider-id" }; });
  return { onFailure, order, store, config, readSession, readReceivingLine, generate, send, run: createClaudeCustomerSmsService({ config, readSession, readReceivingLine, generate, store, send, onFailure }) };
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });
/** Token trim: the model sees who/what/when per turn plus turnIndex; saved metadata stays out. */
const modelTurn = (turn: any, turnIndex: number) => ({ turnIndex, role: turn.role, content: turn.content,
  ...(turn.ts != null ? { ts: turn.ts } : {}), ...(typeof turn.senderName === "string" && turn.senderName.trim() ? { senderName: turn.senderName } : {}),
  ...(Array.isArray(turn.media) && turn.media.length ? { attachments: turn.media.length } : {}) });
describe("customer replies and real human-task intent", () => {
  it("responds to a cleaner in the Teams queue without requiring an override or changing the saved role", async () => {
    const f = fixture(), session = { ...snapshot(), csQueue: "Teams", leadSource: "hiring-cleaner" };
    f.config.mockReturnValue({ startAt: at - 1000, allowedPhone: "", testCustomerOverride: false });
    f.readSession.mockResolvedValue(session); const before = JSON.stringify(session);
    expect(await f.run({ ...input, isCleaner: true })).toEqual({ outcome: "accepted" });
    expect(JSON.stringify(session)).toBe(before); expect(f.send).toHaveBeenCalledTimes(1);
  });
  it.each([{ fromPhone: "+447911123456", isCleaner: true }, { inboundText: "STOP", isCleaner: true }, { direction: "outgoing", isCleaner: true }, { providerMessageId: "cs-fallback-bad", isCleaner: true }])("preserves phone and message safety guards for cleaner events %#", async patch => {
    const f = fixture(); f.config.mockReturnValue({ startAt: at - 1000, allowedPhone: input.fromPhone, testCustomerOverride: true });
    expect(await f.run({ ...input, ...patch })).toEqual({ outcome: "excluded" }); expect(f.readSession).not.toHaveBeenCalled(); expect(f.send).not.toHaveBeenCalled();
  });
  it.each([{ smsOptOut: 1 }, { lastInboundPhoneNumberId: "wrong" }, { contact: { ...snapshot().contact, sessionId: "99" } }, { messageHistory: "invalid" }])("preserves saved opt-out and exact context guards for cleaner sessions %#", async patch => {
    const f = fixture(); f.config.mockReturnValue({ startAt: at - 1000, allowedPhone: input.fromPhone, testCustomerOverride: true });
    f.readSession.mockResolvedValue({ ...snapshot(), csQueue: "Teams", leadSource: "hiring-cleaner", ...patch });
    expect(await f.run({ ...input, isCleaner: true })).toEqual({ outcome: "excluded" }); expect(f.generate).not.toHaveBeenCalled(); expect(f.send).not.toHaveBeenCalled();
  });
  it("ignores an override change after generation for cleaner events", async () => {
    const f = fixture(); f.config.mockReturnValueOnce({ startAt: at - 1000, allowedPhone: input.fromPhone, testCustomerOverride: true })
      .mockReturnValue({ startAt: at - 1000, allowedPhone: input.fromPhone, testCustomerOverride: false });
    expect(await f.run({ ...input, isCleaner: true })).toEqual({ outcome: "accepted" }); expect(f.store.prepare).toHaveBeenCalledTimes(1); expect(f.send).toHaveBeenCalledTimes(1);
    expect(f.store.suppress).not.toHaveBeenCalled(); expect(f.store.suppressBeforeSubmission).not.toHaveBeenCalled();
  });
  it("notifies only after a durable config-stop review, with no SMS", async () => {
    const f = fixture(); f.config.mockReturnValueOnce({ startAt: at - 1000, allowedPhone: input.fromPhone, testCustomerOverride: false }).mockReturnValue(null);
    expect(await f.run(input)).toEqual({ outcome: "suppressed" });
    expect(f.store.reportFailure).toHaveBeenCalledWith(expect.anything(), "CONFIG_CHANGED", false);
    expect(f.onFailure).toHaveBeenCalledWith({ taskId: 101, code: "CONFIG_CHANGED", sessionId: 71 }); expect(f.send).not.toHaveBeenCalled();
  });
  it("failed review persistence independently alerts without claiming a task exists", async () => {
    const f = fixture(); f.store.reportFailure.mockRejectedValue(new Error("offline"));
    f.config.mockReturnValueOnce({ startAt: at - 1000, allowedPhone: input.fromPhone, testCustomerOverride: false }).mockReturnValue(null);
    expect(await f.run(input)).toEqual({ outcome: "suppressed" }); expect(f.onFailure).toHaveBeenCalledWith({ taskId: null, code: "CONFIG_CHANGED", sessionId: 71 }); expect(f.send).not.toHaveBeenCalled();
  });
  it("does not notify a legitimate superseded stop when the store rejects escalation", async () => {
    const f = fixture(); f.store.prepare.mockResolvedValue(false); f.store.reportFailure.mockResolvedValue(null as never);
    expect(await f.run(input)).toEqual({ outcome: "suppressed" }); expect(f.onFailure).not.toHaveBeenCalled(); expect(f.send).not.toHaveBeenCalled();
  });
  it("bounds a hanging generation and ignores its late link plan without regeneration", async () => {
    vi.useFakeTimers();
    try {
      const f = fixture(); let resolve!: (plan: any) => void; f.generate.mockImplementation(() => new Promise(done => { resolve = done; }));
      const result = f.run(input); await vi.advanceTimersByTimeAsync(120_000);
      expect(await result).toEqual({ outcome: "failed" }); expect(f.generate).toHaveBeenCalledTimes(1);
      resolve({ replyText: "Late original link", task: null }); await Promise.resolve();
      expect(f.send).not.toHaveBeenCalled(); expect(f.store.prepare).not.toHaveBeenCalled();
      expect(f.store.suppressBeforeSubmission).toHaveBeenCalledWith(expect.anything(), "GENERATION_OR_PERSISTENCE_FAILED", { failures: [expect.objectContaining({ phase: "generation", code: "CUSTOMER_REPLY_GENERATION_TIMEOUT" })] });
    } finally { vi.useRealTimers(); }
  });
  it("bounds a hanging SMS submission at 30 seconds and never accepts or retries its late result", async () => {
    vi.useFakeTimers();
    try {
      const f = fixture(); let resolve!: (result: any) => void;
      f.send.mockImplementation(() => new Promise(done => { resolve = done; }));
      const result = f.run(input); await vi.advanceTimersByTimeAsync(30_000);
      expect(await result).toEqual({ outcome: "uncertain" });
      expect(f.store.markUncertain).toHaveBeenCalledTimes(1); expect(f.store.reportFailure).toHaveBeenCalledWith(expect.anything(), "SUBMISSION_UNCERTAIN", true);
      resolve({ success: true, messageId: "late-accepted" }); await Promise.resolve();
      expect(f.send).toHaveBeenCalledTimes(1); expect(f.store.recordAcceptance).not.toHaveBeenCalled(); expect(f.store.suppressBeforeSubmission).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });
  it("rechecks the actual unanswered turn after durable preparation and before SMS submission", async () => {
    const f = fixture(); f.store.verifyBeforeSubmission.mockResolvedValue(false); f.store.reportFailure.mockResolvedValue(null as never);
    expect(await f.run(input)).toEqual({ outcome: "suppressed" });
    expect(f.store.suppressBeforeSubmission).toHaveBeenCalledWith(expect.anything(), "STALE_CUSTOMER_MESSAGE");
    expect(f.send).not.toHaveBeenCalled(); expect(f.onFailure).not.toHaveBeenCalled();
  });
  it("independently alerts a pre-claim source failure without creating a fake task", async () => {
    const f = fixture(); f.readSession.mockRejectedValue(new Error("offline source"));
    expect(await f.run(input)).toEqual({ outcome: "failed" });
    expect(f.onFailure).toHaveBeenCalledWith({ taskId: null, code: "GENERATION_OR_PERSISTENCE_FAILED", sessionId: 71 });
    expect(f.store.claim).not.toHaveBeenCalled(); expect(f.send).not.toHaveBeenCalled();
  });
  it("persists the task and exact acknowledgment before using the actual receiving line", async () => {
    const f = fixture(); expect(await f.run(input)).toEqual({ outcome: "accepted" });
    expect(f.order).toEqual(["claim", "generate", "task-and-text-durable", "send", "acceptance"]);
    expect(f.send).toHaveBeenCalledWith({ to: input.fromPhone, content: expect.stringContaining("we'll take care"), fromNumberId: "PN-existing" });
    expect(f.store.claim.mock.calls[0][0]).toMatchObject({ providerMessageId: input.providerMessageId, historyHash: customerHistoryHash(snapshot().messageHistory) });
  });
  it("is completely passive when disabled", async () => { const f = fixture(); f.config.mockReturnValue(null as never); expect(await f.run(input)).toEqual({ outcome: "disabled" }); expect(f.readSession).not.toHaveBeenCalled(); expect(f.generate).not.toHaveBeenCalled(); expect(f.send).not.toHaveBeenCalled(); });
  it.each([{ createdAt: "2026-11-15T18:00:00Z" }, { receivedAt: at - 2000 }, { createdAt: "2026-11-16" }, { createdAt: "2026-11-16T18:01:00Z" }, { receivedAt: NaN }, { direction: "outgoing" }, { direction: undefined }, { providerMessageId: "" }, { providerMessageId: "cs-fallback-123" }, { receivingPhoneNumberId: "" }, { sessionId: -1 }, { inboundText: "" }, { inboundText: "STOP" }, { inboundText: "unsubscribe" }, { fromPhone: "+16505164957" }, { fromPhone: "+16506469270" }, { fromPhone: "+17259009272" }])("excludes old, malformed, opted-out or system event %# before reads", async patch => { const f = fixture(); expect(await f.run({ ...input, ...patch })).toEqual({ outcome: "excluded" }); expect(f.readSession).not.toHaveBeenCalled(); expect(f.store.claim).not.toHaveBeenCalled(); expect(f.send).not.toHaveBeenCalled(); });
  it.each([{ smsOptOut: 1 }, { lastInboundPhoneNumberId: "wrong" }, { contact: { ...snapshot().contact, sessionId: "99" } }, { contact: { ...snapshot().contact, phone: "+12025550124" } }, { contact: { ...snapshot().contact, rawPhone: "+12025550124" } }, { messageHistory: "invalid" }, { messageHistory: JSON.stringify([{ role: "user", content: input.inboundText }]) }])("rejects opt-out or exact-context contradiction %# without generation", async patch => { const f = fixture(); f.readSession.mockResolvedValue({ ...snapshot(), ...patch }); expect(await f.run(input)).toEqual({ outcome: "excluded" }); expect(f.generate).not.toHaveBeenCalled(); expect(f.send).not.toHaveBeenCalled(); });
  it("rejects an already answered source and a contradictory source ID", async () => { const f = fixture(), s = snapshot(), h = JSON.parse(s.messageHistory as string); h.push({ role: "assistant", content: "Human already answered" }); f.readSession.mockResolvedValue({ ...s, messageHistory: JSON.stringify(h) }); expect(await f.run(input)).toEqual({ outcome: "excluded" }); h.pop(); h.at(-1).providerMessageId = "conflicting-id"; f.readSession.mockResolvedValue({ ...s, messageHistory: JSON.stringify(h) }); expect(await f.run(input)).toEqual({ outcome: "excluded" }); expect(f.send).not.toHaveBeenCalled(); });
  it("skips every duplicate receipt without generating, task creation or send", async () => { const f = fixture(); f.store.claim.mockResolvedValue(null as never); expect(await f.run(input)).toEqual({ outcome: "duplicate" }); expect(f.generate).not.toHaveBeenCalled(); expect(f.store.prepare).not.toHaveBeenCalled(); expect(f.send).not.toHaveBeenCalled(); });
  it("does not send an acknowledgment if durable task persistence fails", async () => { const f = fixture(); f.store.prepare.mockRejectedValue(new Error("storage failure")); expect(await f.run(input)).toEqual({ outcome: "failed" }); expect(f.send).not.toHaveBeenCalled(); expect(f.store.suppressBeforeSubmission).toHaveBeenCalled(); });
  it.each(["SMS_QUOTE_MODEL_PRICE", "SMS_QUOTE_INVALID_EVIDENCE", "UNSAFE_REPLY_CLAIM", "ACKNOWLEDGMENT_REQUIRES_TASK", "CUSTOMER_REPLY_GENERATION_TIMEOUT"])("keeps generation failure %s internal and sends no canned SMS", async code => {
    const f = fixture(); f.generate.mockRejectedValue(new Error(code));
    expect(await f.run(input)).toEqual({ outcome: "failed" });
    expect(f.generate).toHaveBeenCalledTimes(1); expect(f.store.claim).toHaveBeenCalledTimes(1);
    expect(f.store.prepare).not.toHaveBeenCalled(); expect(f.send).not.toHaveBeenCalled();
    expect(f.store.suppressBeforeSubmission).toHaveBeenCalledWith(expect.anything(), "GENERATION_OR_PERSISTENCE_FAILED", {
      failures: [expect.objectContaining({ phase: "generation", code })],
    });
    expect(f.store.reportFailure).toHaveBeenCalledWith(expect.anything(), "GENERATION_OR_PERSISTENCE_FAILED", false);
    expect(f.onFailure).toHaveBeenCalledWith({ taskId: 101, code: "GENERATION_OR_PERSISTENCE_FAILED", sessionId: 71 });
  });
  it("does not substitute a second preparation or an error SMS after preparation fails", async () => {
    const f = fixture(); f.store.prepare.mockRejectedValueOnce(new Error("SMS_QUOTE_STATE_CONFLICT"));
    expect(await f.run(input)).toEqual({ outcome: "failed" });
    expect(f.store.prepare).toHaveBeenCalledTimes(1); expect(f.generate).toHaveBeenCalledTimes(1);
    expect(f.send).not.toHaveBeenCalled();
    expect(f.store.suppressBeforeSubmission).toHaveBeenCalledWith(expect.anything(), "GENERATION_OR_PERSISTENCE_FAILED", {
      failures: [expect.objectContaining({ phase: "preparation", code: "SMS_QUOTE_STATE_CONFLICT" })],
    });
    expect(f.store.reportFailure).toHaveBeenCalledTimes(1);
  });
  it("still attempts an independent owner alert when internal failure persistence fails", async () => {
    const f = fixture(); f.generate.mockRejectedValue(new Error("SMS_QUOTE_INVALID_EVIDENCE"));
    f.store.suppressBeforeSubmission.mockRejectedValue(new Error("storage offline"));
    f.store.reportFailure.mockRejectedValue(new Error("storage offline"));
    expect(await f.run(input)).toEqual({ outcome: "failed" }); expect(f.send).not.toHaveBeenCalled();
    expect(f.onFailure).toHaveBeenCalledWith({ taskId: null, code: "GENERATION_OR_PERSISTENCE_FAILED", sessionId: 71 });
  });
  it("does not send an error SMS even if internal escalation says the message was superseded", async () => {
    const f = fixture(); f.generate.mockRejectedValue(new Error("SMS_QUOTE_MODEL_PRICE")); f.store.reportFailure.mockResolvedValue(null as never);
    expect(await f.run(input)).toEqual({ outcome: "failed" });
    expect(f.send).not.toHaveBeenCalled(); expect(f.store.prepare).not.toHaveBeenCalled(); expect(f.onFailure).not.toHaveBeenCalled();
  });
  it.each(["Yes", "Yes that's fine", "That's fine"])("keeps the valid %j acknowledgment send path unchanged", async text => {
    const f = fixture(), event = { ...input, inboundText: text };
    f.readSession.mockResolvedValue({ ...snapshot(), messageHistory: JSON.stringify([
      { role: "agent", content: "The team would like to drop by tomorrow morning, if possible. Will you be available then?", ts: 1 },
      { role: "user", content: text, opMsgId: input.providerMessageId, ts: 2 },
    ]) });
    f.generate.mockResolvedValue({ replyText: "Great! Thank you!", task: null } as never);
    expect(await f.run(event)).toEqual({ outcome: "accepted" });
    expect(f.send).toHaveBeenCalledWith({ to: input.fromPhone, content: "Great! Thank you!", fromNumberId: input.receivingPhoneNumberId });
    expect(f.store.reportFailure).not.toHaveBeenCalled();
  });
  it("does not send stale or human-won claims", async () => { const f = fixture(); f.store.prepare.mockResolvedValue(false); expect(await f.run(input)).toEqual({ outcome: "suppressed" }); expect(f.send).not.toHaveBeenCalled(); });
  it.each([{ success: false }, { success: true }, { success: true, messageId: " " }])("never treats provider result %# as confirmed acceptance", async response => { const f = fixture(); f.send.mockResolvedValue(response as never); expect(await f.run(input)).toEqual({ outcome: "uncertain" }); expect(f.send).toHaveBeenCalledTimes(1); expect(f.store.recordAcceptance).not.toHaveBeenCalled(); expect(f.store.markUncertain).toHaveBeenCalled(); });
  it("never retries a transport timeout or post-acceptance persistence uncertainty", async () => { const f = fixture(); f.send.mockRejectedValue(new Error("timeout")); expect(await f.run(input)).toEqual({ outcome: "uncertain" }); expect(f.send).toHaveBeenCalledTimes(1); expect(f.store.suppressBeforeSubmission).not.toHaveBeenCalled(); const other = fixture(); other.store.recordAcceptance.mockRejectedValue(new Error("unknown commit")); expect(await other.run(input)).toEqual({ outcome: "uncertain" }); expect(other.send).toHaveBeenCalledTimes(1); expect(other.store.suppress).not.toHaveBeenCalled(); expect(other.store.suppressBeforeSubmission).not.toHaveBeenCalled(); });
  it("checks enablement again after generation", async () => { const f = fixture(); f.config.mockReturnValueOnce({ startAt: at - 1000, allowedPhone: input.fromPhone, testCustomerOverride: false }).mockReturnValue(null as never); expect(await f.run(input)).toEqual({ outcome: "suppressed" }); expect(f.store.prepare).not.toHaveBeenCalled(); expect(f.send).not.toHaveBeenCalled(); });
  it.each(["", "Jane +12025550123", "+12025550123,+13029816191", "202-555-0123", "+447911123456", "+11029816191", "+13021816191"])('rejects malformed, non-US or noncanonical sender %s before every I/O', async fromPhone => {
    const f = fixture(); expect(await f.run({ ...input, fromPhone })).toEqual({ outcome: "excluded" });
    for (const action of [f.readSession, f.readReceivingLine, f.store.claim, f.generate, f.store.prepare, f.send]) expect(action).not.toHaveBeenCalled();
  });
  it("accepts an injected start-only config without requiring legacy pilot metadata", async () => {
    const f = fixture(); f.config.mockReturnValue({ startAt: at - 1000 } as never);
    expect(await f.run(input)).toEqual({ outcome: "accepted" }); expect(f.store.prepare).toHaveBeenCalledTimes(1);
    expect(f.send).toHaveBeenCalledWith({ to: input.fromPhone, content: (await f.generate.mock.results[0].value).replyText, fromNumberId: input.receivingPhoneNumberId });
  });
  it.each([null, { startAt: at - 2000, allowedPhone: input.fromPhone, testCustomerOverride: false }, { startAt: at + 1000, allowedPhone: input.fromPhone, testCustomerOverride: false }])("suppresses disablement or cutoff changes after generation %#", async changed => {
    const f = fixture(); f.config.mockReturnValueOnce({ startAt: at - 1000, allowedPhone: input.fromPhone, testCustomerOverride: false }).mockReturnValue(changed as never);
    expect(await f.run(input)).toEqual({ outcome: "suppressed" }); expect(f.store.suppress).toHaveBeenCalledWith(expect.anything(), "CONFIG_CHANGED");
    expect(f.store.prepare).not.toHaveBeenCalled(); expect(f.send).not.toHaveBeenCalled();
  });
  it("ignores in-place legacy metadata mutation during generation", async () => {
    const f = fixture(), config = { startAt: at - 1000, allowedPhone: input.fromPhone, testCustomerOverride: false };
    f.config.mockReturnValue(config); const generate = f.generate.getMockImplementation()!;
    f.generate.mockImplementation(async () => { config.allowedPhone = "+13029816191"; config.testCustomerOverride = true; return generate(); });
    expect(await f.run(input)).toEqual({ outcome: "accepted" }); expect(f.store.prepare).toHaveBeenCalledTimes(1);
    expect(f.send).toHaveBeenCalledWith({ to: input.fromPhone, content: (await f.generate.mock.results[0].value).replyText, fromNumberId: input.receivingPhoneNumberId });
    expect(f.store.suppress).not.toHaveBeenCalled(); expect(f.store.suppressBeforeSubmission).not.toHaveBeenCalled();
  });
  it("retains the original cutoff when a shared config object is mutated during generation", async () => {
    const f = fixture(), config = { startAt: at - 1000, allowedPhone: "", testCustomerOverride: false };
    f.config.mockReturnValue(config); const generate = f.generate.getMockImplementation()!;
    f.generate.mockImplementation(async () => { config.startAt = at - 2000; return generate(); });
    expect(await f.run(input)).toEqual({ outcome: "suppressed" }); expect(f.store.suppress).toHaveBeenCalledWith(expect.anything(), "CONFIG_CHANGED");
    expect(f.store.prepare).not.toHaveBeenCalled(); expect(f.send).not.toHaveBeenCalled();
  });
  it.each([null, { startAt: at - 2000, allowedPhone: input.fromPhone, testCustomerOverride: false }, { startAt: at + 1000, allowedPhone: input.fromPhone, testCustomerOverride: false }])("rechecks enablement and cutoff immediately before sending %#", async changed => {
    const f = fixture(); f.config.mockReturnValueOnce({ startAt: at - 1000, allowedPhone: input.fromPhone, testCustomerOverride: false })
      .mockReturnValueOnce({ startAt: at - 1000, allowedPhone: input.fromPhone, testCustomerOverride: false }).mockReturnValue(changed as never);
    expect(await f.run(input)).toEqual({ outcome: "suppressed" }); expect(f.store.prepare).toHaveBeenCalledTimes(1);
    expect(f.store.suppressBeforeSubmission).toHaveBeenCalledWith(expect.anything(), "CONFIG_CHANGED"); expect(f.send).not.toHaveBeenCalled();
  });
});
const pilotEnv = { CLAUDE_CUSTOMER_SMS_ENABLED: "true", CLAUDE_CUSTOMER_SMS_START_AT: created, CLAUDE_CUSTOMER_SMS_ALLOWED_PHONE: "+13029816191" };
describe("literal activation and immutable cutoff with narrow operational pilot helpers", () => {
  it.each([undefined, "false", "1", "TRUE", " true "])("leaves the classification exception off unless the flag is literal true: %s", flag => {
    const env = { ...pilotEnv, CLAUDE_CUSTOMER_SMS_TEST_CUSTOMER_OVERRIDE: flag };
    expect(claudeCustomerSmsConfig(env)?.testCustomerOverride).toBe(false); expect(isClaudeCustomerSmsPilotCustomerOverride("+13029816191", env)).toBe(false);
  });
  it("requires the complete active pilot gate for the test-customer exception", () => {
    const env = { ...pilotEnv, CLAUDE_CUSTOMER_SMS_TEST_CUSTOMER_OVERRIDE: "true" };
    expect(isClaudeCustomerSmsPilotCustomerOverride("302-981-6191", env)).toBe(true);
    expect(isClaudeCustomerSmsPilotCustomerOverride(input.fromPhone, env)).toBe(false);
    expect(isClaudeCustomerSmsPilotCustomerOverride("+13029816191", { ...env, CLAUDE_CUSTOMER_SMS_ENABLED: "false" })).toBe(false);
    expect(isClaudeCustomerSmsPilotCustomerOverride("+13029816191", { ...env, CLAUDE_CUSTOMER_SMS_START_AT: undefined })).toBe(false);
  });
  it.each(["all", "*", "ALL_CUSTOMERS", "", " all_customers "])("does not widen operational pilot bypasses for unsupported legacy scope %j", scope => {
    const env = { ...pilotEnv, CLAUDE_CUSTOMER_SMS_SCOPE: scope, CLAUDE_CUSTOMER_SMS_TEST_CUSTOMER_OVERRIDE: "true" };
    expect(isClaudeCustomerSmsPhoneEligible("+13029816191", env)).toBe(true);
    expect(isClaudeCustomerSmsPhoneEligible(input.fromPhone, env)).toBe(true);
    expect(isClaudeCustomerSmsPilotPhone("+13029816191", env)).toBe(false);
    expect(isClaudeCustomerSmsPilotCustomerOverride("+13029816191", env)).toBe(false);
  });
  it("requires only literal enablement and a trusted fixed ISO timestamp", () => {
    expect(claudeCustomerSmsConfig({})).toBeNull();
    expect(claudeCustomerSmsConfig({ ...pilotEnv, CLAUDE_CUSTOMER_SMS_ENABLED: "1" })).toBeNull();
    expect(claudeCustomerSmsConfig(pilotEnv)).toEqual({ startAt: at, allowedPhone: "+13029816191", testCustomerOverride: false });
    expect(claudeCustomerSmsConfig({ CLAUDE_CUSTOMER_SMS_ENABLED: "true", CLAUDE_CUSTOMER_SMS_START_AT: created })).toEqual({ startAt: at, allowedPhone: "", testCustomerOverride: false });
  });
  it.each([undefined, "false", "1", "TRUE", " true ", ""])("does not activate unless enabled is literal true: %s", enabled => {
    const env = { ...pilotEnv, CLAUDE_CUSTOMER_SMS_ENABLED: enabled };
    expect(claudeCustomerSmsConfig(env)).toBeNull(); expect(isClaudeCustomerSmsPhoneEligible(input.fromPhone, env)).toBe(false);
  });
  it.each([undefined, "", "3029816191", "302-981-6191", "13029816191", " +13029816191", "+13029816191 ", "Jane +13029816191", "+13029816191,+12025550123", "+13029816191 +12025550123", "[\"+13029816191\"]", "*", "+447911123456", "+11029816191", "+13021816191"])("drops unusable pilot metadata without disabling the responder: %s", phone => {
    const env = { ...pilotEnv, CLAUDE_CUSTOMER_SMS_ALLOWED_PHONE: phone };
    expect(claudeCustomerSmsConfig(env)).toEqual({ startAt: at, allowedPhone: "", testCustomerOverride: false });
    expect(isClaudeCustomerSmsPhoneEligible(input.fromPhone, env)).toBe(true); expect(isClaudeCustomerSmsPhoneEligible("+13029816191", env)).toBe(true);
    expect(isClaudeCustomerSmsPilotPhone("+13029816191", env)).toBe(false);
    expect(isClaudeCustomerSmsPilotCustomerOverride("+13029816191", { ...env, CLAUDE_CUSTOMER_SMS_TEST_CUSTOMER_OVERRIDE: "true" })).toBe(false);
  });
  it.each(["+13029816191", "3029816191", "302-981-6191", "(302) 981-6191"])("normalizes one valid pilot destination %s", phone => expect(isClaudeCustomerSmsPilotPhone(phone, pilotEnv)).toBe(true));
  it.each([undefined, null, 13029816191, "", "+13029816192", "Jane +13029816191", "+13029816191,+12025550123", "3029816191 ext 1", "+447911123456"])("returns false rather than matching a malformed or different destination %s", phone => expect(isClaudeCustomerSmsPilotPhone(phone, pilotEnv)).toBe(false));
  it.each([{ CLAUDE_CUSTOMER_SMS_ENABLED: undefined }, { CLAUDE_CUSTOMER_SMS_ENABLED: "false" }, { CLAUDE_CUSTOMER_SMS_START_AT: undefined }, { CLAUDE_CUSTOMER_SMS_START_AT: "now" }, { CLAUDE_CUSTOMER_SMS_ALLOWED_PHONE: undefined }])("requires complete configuration for phone matching %#", patch => expect(isClaudeCustomerSmsPilotPhone("+13029816191", { ...pilotEnv, ...patch })).toBe(false));
  it("uses process.env by default without widening the recipient", () => {
    for (const [key, value] of Object.entries(pilotEnv)) vi.stubEnv(key, value);
    expect(isClaudeCustomerSmsPilotPhone("302-981-6191")).toBe(true); expect(isClaudeCustomerSmsPilotPhone(input.fromPhone)).toBe(false);
  });
  it.each(["now", "2026-02-30T00:00:00Z", "2026-11-16", "2026-11-16T18:00:00", "bad"])("rejects unsafe cutoff %s", value => expect(customerSmsInstant(value)).toBeNull());
});
describe("application entry is passive before database import", () => {
  it("rejects a malformed destination before importing or acquiring the database", async () => {
    database.imported.mockClear(); database.getDb.mockClear();
    for (const [key, value] of Object.entries(pilotEnv)) vi.stubEnv(key, value);
    expect(await dispatchClaudeCustomerSms({ ...input, fromPhone: "Jane +12025550123" })).toEqual({ outcome: "excluded" });
    expect(database.imported).not.toHaveBeenCalled(); expect(database.getDb).not.toHaveBeenCalled();
  });
  it("stays default off when literal enablement is missing", async () => {
    database.imported.mockClear(); database.getDb.mockClear();
    vi.stubEnv("CLAUDE_CUSTOMER_SMS_ENABLED", undefined); vi.stubEnv("CLAUDE_CUSTOMER_SMS_START_AT", created); vi.stubEnv("CLAUDE_CUSTOMER_SMS_ALLOWED_PHONE", undefined);
    expect(await dispatchClaudeCustomerSms(input)).toEqual({ outcome: "disabled" });
    expect(database.imported).not.toHaveBeenCalled(); expect(database.getDb).not.toHaveBeenCalled();
  });
  it.each([undefined, "now", "2026-02-30T00:00:00Z"])("stays passive with an absent or unsafe cutoff %s", async cutoff => {
    database.imported.mockClear(); database.getDb.mockClear();
    vi.stubEnv("CLAUDE_CUSTOMER_SMS_ENABLED", "true"); vi.stubEnv("CLAUDE_CUSTOMER_SMS_START_AT", cutoff);
    expect(await dispatchClaudeCustomerSms(input)).toEqual({ outcome: "disabled" });
    expect(database.imported).not.toHaveBeenCalled(); expect(database.getDb).not.toHaveBeenCalled();
  });
});

describe("future-only SMS replies for every valid recipient and role", () => {
  const allEnv = { ...pilotEnv, CLAUDE_CUSTOMER_SMS_SCOPE: "all_customers", CLAUDE_CUSTOMER_SMS_TEST_CUSTOMER_OVERRIDE: "true" };
  const allConfig: CustomerSmsConfig = { startAt: at - 1000, allowedPhone: "+13029816191", testCustomerOverride: true, scope: "all_customers" };
  it("retains recognized operational pilot metadata without making scope an activation gate", () => {
    expect(claudeCustomerSmsConfig(allEnv)).toEqual({ startAt: at, allowedPhone: "+13029816191", testCustomerOverride: true, scope: "all_customers" });
    expect(claudeCustomerSmsConfig({ ...pilotEnv, CLAUDE_CUSTOMER_SMS_SCOPE: "pilot" })).toEqual(claudeCustomerSmsConfig(pilotEnv));
    for (const scope of [undefined, "all", "*", "ALL_CUSTOMERS", "", " all_customers "]) {
      const env = { ...allEnv, CLAUDE_CUSTOMER_SMS_SCOPE: scope };
      expect(claudeCustomerSmsConfig(env)).toEqual({ startAt: at, allowedPhone: "+13029816191", testCustomerOverride: true });
      expect(isClaudeCustomerSmsPhoneEligible(input.fromPhone, env)).toBe(true);
    }
  });
  it.each(["+12025550123", "202-555-0123", "(202) 555-0123", "2025550123", "12025550123", "+12025550124", "+17035551234"])("admits a valid nonpilot destination %s regardless of pilot metadata", phone => {
    expect(isClaudeCustomerSmsPhoneEligible(phone, allEnv)).toBe(true);
    expect(isClaudeCustomerSmsPilotPhone(phone, allEnv)).toBe(false);
    expect(isClaudeCustomerSmsPhoneEligible(phone, pilotEnv)).toBe(true);
    expect(isClaudeCustomerSmsPhoneEligible(phone, { ...pilotEnv, CLAUDE_CUSTOMER_SMS_ALLOWED_PHONE: undefined, CLAUDE_CUSTOMER_SMS_SCOPE: "unknown-legacy" })).toBe(true);
    expect(isClaudeCustomerSmsPilotCustomerOverride(phone, allEnv)).toBe(false);
  });
  it.each([undefined, null, 12025550123, "", "Jane +12025550123", "+12025550123,+13029816191", "*", "+447911123456", "+11029816191", "+13021816191", "2025550123 ext 1"])("still rejects malformed or unsupported destination %j", phone => {
    expect(isClaudeCustomerSmsPhoneEligible(phone, allEnv)).toBe(false);
    expect(isClaudeCustomerSmsPhoneEligible(phone, { ...pilotEnv, CLAUDE_CUSTOMER_SMS_ALLOWED_PHONE: undefined, CLAUDE_CUSTOMER_SMS_SCOPE: "unknown-legacy" })).toBe(false);
  });
  it("retains the approved role exception only for the actual test number", () => {
    expect(isClaudeCustomerSmsPilotCustomerOverride("302-981-6191", allEnv)).toBe(true);
    expect(isClaudeCustomerSmsPilotCustomerOverride(input.fromPhone, { ...allEnv, CLAUDE_CUSTOMER_SMS_ALLOWED_PHONE: input.fromPhone })).toBe(false);
  });
  it("sends the same unmodified generated content through the exact receiving line for a nonpilot customer", async () => {
    const f = fixture(); f.config.mockReturnValue(allConfig);
    expect(await f.run(input)).toEqual({ outcome: "accepted" });
    expect(f.order).toEqual(["claim", "generate", "task-and-text-durable", "send", "acceptance"]);
    expect(f.send).toHaveBeenCalledWith({ to: input.fromPhone, content: (await f.generate.mock.results[0].value).replyText, fromNumberId: input.receivingPhoneNumberId });
  });
  it.each([{ direction: "outgoing" }, { inboundText: "STOP" }, { createdAt: "2026-11-15T18:00:00Z" }, { createdAt: "2026-11-16T18:01:00Z" }, { receivedAt: at - 2000 }, { providerMessageId: "cs-fallback-old" }, { fromPhone: "+16505164957" }, { fromPhone: "+17259009272" }])("retains all pre-read safety guards with legacy all-customer metadata %#", async patch => {
    const f = fixture(); f.config.mockReturnValue(allConfig);
    expect(await f.run({ ...input, ...patch })).toEqual({ outcome: "excluded" }); expect(f.readSession).not.toHaveBeenCalled(); expect(f.send).not.toHaveBeenCalled();
  });
  it.each([{ isCleaner: false, leadSource: "cs-inbound", csQueue: "Clients" }, { isCleaner: true, leadSource: "hiring", csQueue: "Teams" }, { isCleaner: true, leadSource: "hiring-cleaner", csQueue: "Teams" }, { isCleaner: false, leadSource: "cs-inbound-cleaner", csQueue: "Teams" }, { isCleaner: false, leadSource: "internal", csQueue: "Teams" }, { isCleaner: false, leadSource: "staff", csQueue: "Teams" }, { isCleaner: true, leadSource: undefined, csQueue: undefined }, { isCleaner: false, leadSource: undefined, csQueue: "Clients" }, { isCleaner: false, leadSource: "unknown-legacy", csQueue: "unknown-legacy" }])("replies without changing any saved role or queue %#", async ({ isCleaner, ...patch }) => {
    const f = fixture(), session = { ...snapshot(), ...patch }, before = JSON.stringify(session);
    f.config.mockReturnValue({ startAt: at - 1000, allowedPhone: "", testCustomerOverride: false }); f.readSession.mockResolvedValue(session);
    expect(await f.run({ ...input, isCleaner })).toEqual({ outcome: "accepted" });
    expect(f.generate).toHaveBeenCalledTimes(1); expect(f.store.prepare).toHaveBeenCalledTimes(1); expect(f.store.recordAcceptance).toHaveBeenCalledWith(expect.anything(), "accepted-provider-id");
    expect(f.send).toHaveBeenCalledWith({ to: input.fromPhone, content: (await f.generate.mock.results[0].value).replyText, fromNumberId: input.receivingPhoneNumberId });
    expect(f.send).toHaveBeenCalledTimes(1); expect(JSON.stringify(session)).toBe(before);
    expect(f.store.reportFailure).not.toHaveBeenCalled(); expect(f.store.suppress).not.toHaveBeenCalled(); expect(f.store.suppressBeforeSubmission).not.toHaveBeenCalled();
  });
  it("keeps saved opt-out protected regardless of role or all-customer metadata", async () => {
    const f = fixture(); f.config.mockReturnValue(allConfig); f.readSession.mockResolvedValue({ ...snapshot(), leadSource: "hiring", csQueue: "Teams", smsOptOut: 1 });
    expect(await f.run(input)).toEqual({ outcome: "excluded" }); expect(f.generate).not.toHaveBeenCalled(); expect(f.send).not.toHaveBeenCalled();
  });
  it.each(["+13029816191", "+12025550124", "+17035551234"])("responds to a different valid phone %s with exact matching context and no pilot phone", async fromPhone => {
    const f = fixture(); f.config.mockReturnValue({ ...allConfig, allowedPhone: "", testCustomerOverride: false });
    f.readSession.mockResolvedValue({ ...snapshot(), contact: { ...snapshot().contact, phone: fromPhone, rawPhone: fromPhone }, leadSource: "hiring", csQueue: "Teams" });
    expect(await f.run({ ...input, fromPhone, isCleaner: true })).toEqual({ outcome: "accepted" });
    expect(f.store.claim.mock.calls[0][0]).toMatchObject({ fromPhone, sessionId: input.sessionId, providerMessageId: input.providerMessageId });
    expect(f.send).toHaveBeenCalledWith({ to: fromPhone, content: (await f.generate.mock.results[0].value).replyText, fromNumberId: input.receivingPhoneNumberId }); expect(f.send).toHaveBeenCalledTimes(1);
  });
  it.each(["after-generation", "before-submission"])("ignores scope, phone and override replacement %s without altering the generated SMS", async stage => {
    const f = fixture(); f.config.mockReturnValueOnce(allConfig);
    if (stage === "before-submission") f.config.mockReturnValueOnce(allConfig);
    f.config.mockReturnValue({ ...allConfig, allowedPhone: "", testCustomerOverride: false, scope: "pilot" });
    expect(await f.run(input)).toEqual({ outcome: "accepted" }); expect(f.store.prepare).toHaveBeenCalledTimes(1); expect(f.send).toHaveBeenCalledTimes(1);
    expect(f.send).toHaveBeenCalledWith({ to: input.fromPhone, content: (await f.generate.mock.results[0].value).replyText, fromNumberId: input.receivingPhoneNumberId });
    expect(f.store.suppress).not.toHaveBeenCalled(); expect(f.store.suppressBeforeSubmission).not.toHaveBeenCalled(); expect(f.store.reportFailure).not.toHaveBeenCalled();
  });
  it("ignores in-place legacy metadata mutation after preparation and before submission", async () => {
    const f = fixture(), config = { ...allConfig }; f.config.mockReturnValue(config);
    const prepare = f.store.prepare.getMockImplementation()!;
    f.store.prepare.mockImplementation(async (...args) => { const result = await prepare(...args); config.allowedPhone = ""; config.testCustomerOverride = false; config.scope = "pilot"; return result; });
    expect(await f.run({ ...input, isCleaner: true })).toEqual({ outcome: "accepted" });
    expect(f.store.prepare).toHaveBeenCalledTimes(1); expect(f.send).toHaveBeenCalledTimes(1);
    expect(f.send).toHaveBeenCalledWith({ to: input.fromPhone, content: (await f.generate.mock.results[0].value).replyText, fromNumberId: input.receivingPhoneNumberId });
    expect(f.store.suppress).not.toHaveBeenCalled(); expect(f.store.suppressBeforeSubmission).not.toHaveBeenCalled();
  });
  it("rejects duplicate all-customer claims without regeneration, task creation or resend", async () => {
    const f = fixture(); f.config.mockReturnValue(allConfig); f.store.claim.mockResolvedValue(null as never);
    expect(await f.run(input)).toEqual({ outcome: "duplicate" }); expect(f.generate).not.toHaveBeenCalled(); expect(f.store.prepare).not.toHaveBeenCalled(); expect(f.send).not.toHaveBeenCalled();
  });
  it.each([{ CLAUDE_CUSTOMER_SMS_SCOPE: undefined }, { CLAUDE_CUSTOMER_SMS_SCOPE: "pilot" }, { CLAUDE_CUSTOMER_SMS_SCOPE: "unknown-legacy", CLAUDE_CUSTOMER_SMS_ALLOWED_PHONE: undefined }, { CLAUDE_CUSTOMER_SMS_SCOPE: "all_customers", CLAUDE_CUSTOMER_SMS_ALLOWED_PHONE: "bad" }])("opens the existing application for a valid nonpilot phone despite legacy metadata %#", async patch => {
    for (const [key, value] of Object.entries({ ...allEnv, ...patch })) vi.stubEnv(key, value);
    database.getDb.mockClear(); database.notify.mockClear();
    expect(await dispatchClaudeCustomerSms(input)).toEqual({ outcome: "failed" }); expect(database.getDb).toHaveBeenCalledTimes(1);
    expect(database.notify).toHaveBeenCalledWith({ title: "Customer SMS needs staff review", content: expect.stringContaining("Staff task could not be saved; review the conversation manually.") });
    expect(database.notify.mock.calls[0][0].content).toContain("CUSTOMER_REPLY_DATABASE_UNAVAILABLE");
  });
  it("alerts once if database acquisition rejects, without pretending a staff task was created", async () => {
    for (const [key, value] of Object.entries(allEnv)) vi.stubEnv(key, value);
    database.notify.mockClear(); database.getDb.mockRejectedValueOnce(new Error("synthetic unavailable"));
    expect(await dispatchClaudeCustomerSms(input)).toEqual({ outcome: "failed" });
    expect(database.notify).toHaveBeenCalledTimes(1);
    expect(database.notify.mock.calls[0][0].content).toContain("Session 71. Staff task could not be saved");
    expect(database.notify.mock.calls[0][0].content).not.toContain("synthetic unavailable");
  });
  it("preserves the explicit failure when the independent owner notification rejects", async () => {
    for (const [key, value] of Object.entries(allEnv)) vi.stubEnv(key, value);
    database.notify.mockRejectedValueOnce(new Error("synthetic alert unavailable"));
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(await dispatchClaudeCustomerSms(input)).toEqual({ outcome: "failed" });
    expect(warning).toHaveBeenCalledWith("[ClaudeCustomerSMS] Owner alert unavailable", { taskId: null, code: "CUSTOMER_REPLY_DATABASE_UNAVAILABLE", sessionId: 71 });
  });
  it("bounds an independent owner alert at ten seconds without retrying it", async () => {
    vi.useFakeTimers();
    try {
      for (const [key, value] of Object.entries(allEnv)) vi.stubEnv(key, value);
      database.notify.mockClear(); database.notify.mockImplementationOnce(() => new Promise<boolean>(() => undefined));
      vi.spyOn(console, "warn").mockImplementation(() => undefined);
      const pending = dispatchClaudeCustomerSms(input);
      await vi.advanceTimersByTimeAsync(10_000);
      expect(await pending).toEqual({ outcome: "failed" }); expect(database.notify).toHaveBeenCalledTimes(1);
    } finally { vi.useRealTimers(); }
  });
});

describe("one extra content attempt composed with the existing SMS coordinator", () => {
  let network: ReturnType<typeof vi.spyOn>;
  beforeEach(() => { network = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("OFFLINE_ONLY")); });
  afterEach(() => { expect(network).not.toHaveBeenCalled(); });
  const validPlan = {
    replyText: "Absolutely, Jane. We'll take care of this and confirm once the change is made.",
    task: { title: "Reschedule Jane's cleaning", items: [{ title: "Move cleaning to Monday at 9", evidenceQuote: input.inboundText }] },
    bookingQuote: null,
  };
  const validOutput = { finalSmsText: JSON.stringify(validPlan) };
  const quoteUpdate = { action: "collect", intentEvidenceQuote: input.inboundText,
    fields: { bedrooms: 2 }, evidence: { bedrooms: { turnIndex: 2, quote: input.inboundText } } };
  const invalidFirstOutputs = [
    { name: "syntax", output: "Not JSON" },
    { name: "blank reply", output: JSON.stringify({ ...validPlan, replyText: " " }) },
    { name: "strict schema", output: JSON.stringify({ ...validPlan, unexpected: true }) },
    { name: "task evidence", output: JSON.stringify({ ...validPlan, task: { title: "Invented work", items: [{ title: "Do work", evidenceQuote: "Not the current inbound" }] } }) },
    { name: "quote evidence", output: JSON.stringify({ ...validPlan, bookingQuote: { ...quoteUpdate, evidence: { bedrooms: { turnIndex: 1, quote: "Earlier staff reply" } } } }) },
    { name: "model price", output: JSON.stringify({ ...validPlan, replyText: "The price is $100.", bookingQuote: quoteUpdate }) },
  ];
  function recoveryFixture() {
    const f = fixture();
    const readKnowledge = vi.fn(async () => "Synthetic approved customer-service knowledge.");
    const readState = vi.fn(async () => null);
    const runner = vi.fn<NonNullable<SmsBookingQuoteGenerationOptions["runner"]>>(async () => validOutput);
    const generate = vi.fn<CustomerSmsOptions["generate"]>((binding, session, signal) =>
      createClaudeCustomerSmsGeneratorWithReply(createSmsBookingQuoteReplyGenerator({
        signal, readKnowledge, smsBookingQuote: { readState },
        runner,
      }))(binding, session));
    return { ...f, readKnowledge, readState, runner, generate,
      run: createClaudeCustomerSmsService({ ...f, generate }) };
  }
  it.each([{ name: "provider error", output: null }, ...invalidFirstOutputs])("recovers from $name once with the original context and only one preparation and send", async ({ output }) => {
    const f = recoveryFixture(), session = snapshot(), before = JSON.stringify(session);
    f.readSession.mockResolvedValue(session);
    if (output === null) f.runner.mockRejectedValueOnce(new Error("Synthetic provider unavailable"));
    else f.runner.mockResolvedValueOnce({ finalSmsText: output });
    expect(await f.run(input)).toEqual({ outcome: "accepted" });
    expect(f.runner).toHaveBeenCalledTimes(2); expect(f.generate).toHaveBeenCalledTimes(1);
    const first = f.runner.mock.calls[0][0], second = f.runner.mock.calls[1][0];
    expect(second).toBe(first);
    expect(second.systemPrompt).toBe(first.systemPrompt); expect(second.userPrompt).toBe(first.userPrompt);
    expect(second.signal).toBe(first.signal); expect(second.signal?.aborted).toBe(false);
    const payload = JSON.parse(second.userPrompt);
    expect(payload.incomingMessage).toBe(input.inboundText);
    expect(payload.context.contact).toEqual({ displayName: session.contact.displayName, phone: session.contact.phone });
    expect(Object.keys(payload.context.binding).sort()).toEqual(["customerName", "fromPhone"]);
    expect(payload.context.binding.fromPhone).toBe(input.fromPhone);
    expect(second.userPrompt).not.toContain(customerHistoryHash(session.messageHistory));
    expect(second.userPrompt).not.toContain(input.providerMessageId);
    expect(payload.context.originalConversation).toEqual(JSON.parse(session.messageHistory as string).map(modelTurn));
    expect(JSON.stringify(session)).toBe(before);
    expect(f.readKnowledge).toHaveBeenCalledTimes(1); expect(f.readState).toHaveBeenCalledTimes(1);
    expect(f.store.claim).toHaveBeenCalledTimes(1); expect(f.store.prepare).toHaveBeenCalledTimes(1);
    expect(f.send).toHaveBeenCalledTimes(1);
    expect(f.send).toHaveBeenCalledWith({ to: input.fromPhone, content: validPlan.replyText, fromNumberId: input.receivingPhoneNumberId });
    expect(f.store.recordAcceptance).toHaveBeenCalledTimes(1); expect(f.store.reportFailure).not.toHaveBeenCalled();
  });
  it("aborts during attempt two at the original deadline and ignores even a non-cooperative late valid result", async () => {
    vi.useFakeTimers();
    try {
      const f = recoveryFixture();
      let firstDone!: (output: { finalSmsText: string }) => void;
      let secondDone!: (output: { finalSmsText: string }) => void;
      f.runner.mockImplementationOnce(() => new Promise(resolve => { firstDone = resolve; }))
        .mockImplementationOnce(() => new Promise(resolve => { secondDone = resolve; }));
      const pending = f.run(input);
      await vi.advanceTimersByTimeAsync(119_000);
      expect(f.runner).toHaveBeenCalledTimes(1);
      firstDone({ finalSmsText: "Not JSON" }); await vi.advanceTimersByTimeAsync(0);
      expect(f.runner).toHaveBeenCalledTimes(2);
      const signal = f.runner.mock.calls[1][0].signal;
      expect(signal).toBe(f.runner.mock.calls[0][0].signal); expect(signal?.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(1_000);
      expect(await pending).toEqual({ outcome: "failed" }); expect(signal?.aborted).toBe(true);
      expect(f.store.prepare).not.toHaveBeenCalled(); expect(f.send).not.toHaveBeenCalled();
      expect(f.store.reportFailure).toHaveBeenCalledTimes(1);
      expect(f.store.suppressBeforeSubmission).toHaveBeenCalledWith(expect.anything(), "GENERATION_OR_PERSISTENCE_FAILED", {
        failures: [expect.objectContaining({ phase: "generation", code: "CUSTOMER_REPLY_GENERATION_TIMEOUT" })],
      });
      secondDone(validOutput);
      expect(await f.generate.mock.results[0].value).toEqual({ replyText: validPlan.replyText, task: validPlan.task });
      await vi.advanceTimersByTimeAsync(0);
      expect(f.runner).toHaveBeenCalledTimes(2); expect(f.generate).toHaveBeenCalledTimes(1);
      expect(f.store.prepare).not.toHaveBeenCalled(); expect(f.send).not.toHaveBeenCalled();
      expect(f.store.recordAcceptance).not.toHaveBeenCalled(); expect(f.store.reportFailure).toHaveBeenCalledTimes(1);
      expect(f.onFailure).toHaveBeenCalledTimes(1);
    } finally { vi.useRealTimers(); }
  });
  it("does not start recovery if attempt one returns malformed output only after timeout", async () => {
    vi.useFakeTimers();
    try {
      const f = recoveryFixture(); let done!: (output: { finalSmsText: string }) => void;
      f.runner.mockImplementationOnce(() => new Promise(resolve => { done = resolve; }));
      const pending = f.run(input); await vi.advanceTimersByTimeAsync(120_000);
      expect(await pending).toEqual({ outcome: "failed" });
      expect(f.runner.mock.calls[0][0].signal?.aborted).toBe(true);
      const late = expect(f.generate.mock.results[0].value).rejects.toBeInstanceOf(SyntaxError);
      done({ finalSmsText: "Not JSON" }); await late;
      expect(f.runner).toHaveBeenCalledTimes(1); expect(f.store.prepare).not.toHaveBeenCalled();
      expect(f.send).not.toHaveBeenCalled(); expect(f.store.reportFailure).toHaveBeenCalledTimes(1);
    } finally { vi.useRealTimers(); }
  });
  it.each(["provider", "schema", "nested-validation"])("exhausts %s content recovery at two attempts without preparation or SMS", async failure => {
    const f = recoveryFixture();
    if (failure === "provider") f.runner.mockRejectedValue(new Error("Synthetic provider unavailable"));
    else if (failure === "schema") f.runner.mockResolvedValue({ finalSmsText: "Not JSON" });
    else f.runner.mockResolvedValueOnce({ finalSmsText: "Not JSON" }).mockResolvedValue({ finalSmsText: invalidFirstOutputs.at(-1)!.output });
    expect(await f.run(input)).toEqual({ outcome: "failed" });
    expect(f.runner).toHaveBeenCalledTimes(2); expect(f.generate).toHaveBeenCalledTimes(1); expect(f.store.claim).toHaveBeenCalledTimes(1);
    expect(f.readKnowledge).toHaveBeenCalledTimes(1); expect(f.readState).toHaveBeenCalledTimes(1);
    expect(f.store.prepare).not.toHaveBeenCalled(); expect(f.send).not.toHaveBeenCalled();
    expect(f.store.recordAcceptance).not.toHaveBeenCalled();
    expect(f.store.reportFailure).toHaveBeenCalledTimes(1);
    expect(f.store.reportFailure).toHaveBeenCalledWith(expect.anything(), "GENERATION_OR_PERSISTENCE_FAILED", false);
    expect(f.onFailure).toHaveBeenCalledWith({ taskId: 101, code: "GENERATION_OR_PERSISTENCE_FAILED", sessionId: input.sessionId });
  });
  it("keeps concurrent duplicate receipts to one successful claim, recovered generation and send", async () => {
    const f = recoveryFixture(); let claimed = false;
    f.store.claim.mockImplementation(async binding => {
      if (claimed) return null as never;
      claimed = true; return { draftId: 5, binding } as CustomerSmsClaim;
    });
    f.runner.mockRejectedValueOnce(new Error("Synthetic provider unavailable"));
    expect(await Promise.all([f.run(input), f.run(input)])).toEqual([{ outcome: "accepted" }, { outcome: "duplicate" }]);
    expect(f.store.claim).toHaveBeenCalledTimes(2);
    expect((await Promise.all(f.store.claim.mock.results.map(result => result.value))).filter(Boolean)).toHaveLength(1);
    expect(f.generate).toHaveBeenCalledTimes(1); expect(f.runner).toHaveBeenCalledTimes(2);
    expect(f.readKnowledge).toHaveBeenCalledTimes(1); expect(f.readState).toHaveBeenCalledTimes(1);
    expect(f.store.prepare).toHaveBeenCalledTimes(1); expect(f.send).toHaveBeenCalledTimes(1);
    expect(f.store.recordAcceptance).toHaveBeenCalledTimes(1);
  });
  it.each(["duplicate", "config-disabled", "human-won", "stale"])("preserves the %s guard on the recovered path", async guard => {
    const f = recoveryFixture(); f.runner.mockResolvedValueOnce({ finalSmsText: "Not JSON" });
    if (guard === "duplicate") f.store.claim.mockResolvedValue(null as never);
    if (guard === "config-disabled") f.config.mockReturnValueOnce({ startAt: at - 1000, allowedPhone: input.fromPhone, testCustomerOverride: false }).mockReturnValue(null);
    if (guard === "human-won") { f.store.prepare.mockResolvedValue(false); f.store.reportFailure.mockResolvedValue(null as never); }
    if (guard === "stale") { f.store.verifyBeforeSubmission.mockResolvedValue(false); f.store.reportFailure.mockResolvedValue(null as never); }
    expect(await f.run(input)).toEqual({ outcome: guard === "duplicate" ? "duplicate" : "suppressed" });
    expect(f.runner).toHaveBeenCalledTimes(guard === "duplicate" ? 0 : 2);
    expect(f.store.prepare).toHaveBeenCalledTimes(["human-won", "stale"].includes(guard) ? 1 : 0);
    expect(f.send).not.toHaveBeenCalled(); expect(f.store.recordAcceptance).not.toHaveBeenCalled();
  });
  it("does not regenerate or retry preparation when persistence fails after recovery", async () => {
    const f = recoveryFixture(); f.runner.mockResolvedValueOnce({ finalSmsText: "Not JSON" });
    f.store.prepare.mockRejectedValue(new Error("SMS_QUOTE_STATE_CONFLICT"));
    expect(await f.run(input)).toEqual({ outcome: "failed" });
    expect(f.runner).toHaveBeenCalledTimes(2); expect(f.store.prepare).toHaveBeenCalledTimes(1);
    expect(f.send).not.toHaveBeenCalled(); expect(f.store.reportFailure).toHaveBeenCalledTimes(1);
  });
  it("does not regenerate or resend after a submission error on the recovered path", async () => {
    const f = recoveryFixture(); f.runner.mockResolvedValueOnce({ finalSmsText: "Not JSON" });
    f.send.mockRejectedValue(new Error("synthetic submission timeout"));
    expect(await f.run(input)).toEqual({ outcome: "uncertain" });
    expect(f.runner).toHaveBeenCalledTimes(2); expect(f.store.prepare).toHaveBeenCalledTimes(1);
    expect(f.send).toHaveBeenCalledTimes(1); expect(f.store.recordAcceptance).not.toHaveBeenCalled();
    expect(f.store.markUncertain).toHaveBeenCalledTimes(1);
  });
  it("does not regenerate, reprepare or resend after acceptance persistence fails on the recovered path", async () => {
    const f = recoveryFixture(); f.runner.mockRejectedValueOnce(new Error("Synthetic provider unavailable"));
    f.store.recordAcceptance.mockRejectedValue(new Error("Synthetic acceptance save uncertain"));
    expect(await f.run(input)).toEqual({ outcome: "uncertain" });
    expect(f.generate).toHaveBeenCalledTimes(1); expect(f.runner).toHaveBeenCalledTimes(2);
    expect(f.store.claim).toHaveBeenCalledTimes(1); expect(f.store.prepare).toHaveBeenCalledTimes(1);
    expect(f.send).toHaveBeenCalledTimes(1); expect(f.store.recordAcceptance).toHaveBeenCalledTimes(1);
    expect(f.store.markUncertain).toHaveBeenCalledTimes(1);
  });
});
