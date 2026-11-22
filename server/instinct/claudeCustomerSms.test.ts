import { afterEach, describe, expect, it, vi } from "vitest";
import { claudeCustomerSmsConfig, createClaudeCustomerSmsService, customerHistoryHash, customerSmsInstant, isClaudeCustomerSmsPilotPhone, isClaudeCustomerSmsPhoneEligible, isClaudeCustomerSmsPilotCustomerOverride, type CustomerSmsInput, type CustomerSmsSession, type CustomerSmsConfig } from "./claudeCustomerSms";
import { dispatchClaudeCustomerSms } from "./claudeCustomerSmsApplication";
import type { CustomerSmsClaim } from "./claudeCustomerTasksStore";
import type { CustomerSmsStore } from "./claudeCustomerSms";
const database = vi.hoisted(() => ({ imported: vi.fn(), getDb: vi.fn(async () => null) }));
vi.mock("../db", () => { database.imported(); return { getDb: database.getDb }; });
const created = "2026-11-16T18:00:00Z", at = Date.parse(created);
const input: CustomerSmsInput = { sessionId: 71, providerMessageId: "inbound-real", fromPhone: "+12025550123", receivingPhoneNumberId: "PN-existing", inboundText: "Move my cleaning to Monday at 9", createdAt: created, receivedAt: at + 1000, isCleaner: false, direction: "incoming" };
const snapshot = (): CustomerSmsSession => ({ contact: { sessionId: "71", rawPhone: input.fromPhone, phone: input.fromPhone, displayName: "Jane Smith", contactGap: null },
  messageHistory: JSON.stringify([{ role: "user", content: "Previous question", opMsgId: "older" }, { role: "assistant", content: "Earlier staff reply" }, { role: "user", content: input.inboundText, opMsgId: input.providerMessageId }]),
  lastInboundPhoneNumberId: input.receivingPhoneNumberId, leadSource: "cs-inbound", smsOptOut: 0, csQueue: "Clients" });
function fixture() {
  const order: string[] = [];
  const store = { claim: vi.fn(async (binding: any) => { order.push("claim"); return { draftId: 5, binding } as CustomerSmsClaim; }),
    prepare: vi.fn<CustomerSmsStore["prepare"]>(async () => { order.push("task-and-text-durable"); return true; }), recordAcceptance: vi.fn(async () => { order.push("acceptance"); return true; }),
    markUncertain: vi.fn(async () => undefined), suppress: vi.fn(async () => undefined), suppressBeforeSubmission: vi.fn(async () => undefined) };
  const config = vi.fn<() => CustomerSmsConfig | null>(() => ({ startAt: at - 1000, allowedPhone: input.fromPhone, testCustomerOverride: false }));
  const readSession = vi.fn(async () => snapshot()), readReceivingLine = vi.fn(async () => "+12025550999");
  const generate = vi.fn(async () => { order.push("generate"); return { replyText: "Absolutely, Jane—we'll take care of this and confirm once the change is made.", task: { title: "Reschedule Jane's cleaning", items: [{ title: "Move cleaning to Monday at 9", evidenceQuote: input.inboundText }] } }; });
  const send = vi.fn(async () => { order.push("send"); return { success: true, messageId: "accepted-provider-id" }; });
  return { order, store, config, readSession, readReceivingLine, generate, send, run: createClaudeCustomerSmsService({ config, readSession, readReceivingLine, generate, store, send }) };
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });
describe("customer replies and real human-task intent", () => {
  it("allows the explicitly configured pilot test-customer classification without changing the saved role", async () => {
    const f = fixture(), session = { ...snapshot(), csQueue: "Teams", leadSource: "hiring-cleaner" };
    f.config.mockReturnValue({ startAt: at - 1000, allowedPhone: input.fromPhone, testCustomerOverride: true });
    f.readSession.mockResolvedValue(session); const before = JSON.stringify(session);
    expect(await f.run({ ...input, isCleaner: true })).toEqual({ outcome: "accepted" });
    expect(JSON.stringify(session)).toBe(before); expect(f.send).toHaveBeenCalledTimes(1);
  });
  it.each([{ fromPhone: "+13029816191", isCleaner: true }, { inboundText: "STOP", isCleaner: true }, { direction: "outgoing", isCleaner: true }, { providerMessageId: "cs-fallback-bad", isCleaner: true }])("never extends the classification override beyond pilot identity and safety guards %#", async patch => {
    const f = fixture(); f.config.mockReturnValue({ startAt: at - 1000, allowedPhone: input.fromPhone, testCustomerOverride: true });
    expect(await f.run({ ...input, ...patch })).toEqual({ outcome: "excluded" }); expect(f.readSession).not.toHaveBeenCalled(); expect(f.send).not.toHaveBeenCalled();
  });
  it.each([{ smsOptOut: 1 }, { lastInboundPhoneNumberId: "wrong" }, { contact: { ...snapshot().contact, sessionId: "99" } }, { messageHistory: "invalid" }])("preserves saved opt-out and exact context guards with the override %#", async patch => {
    const f = fixture(); f.config.mockReturnValue({ startAt: at - 1000, allowedPhone: input.fromPhone, testCustomerOverride: true });
    f.readSession.mockResolvedValue({ ...snapshot(), csQueue: "Teams", leadSource: "hiring-cleaner", ...patch });
    expect(await f.run({ ...input, isCleaner: true })).toEqual({ outcome: "excluded" }); expect(f.generate).not.toHaveBeenCalled(); expect(f.send).not.toHaveBeenCalled();
  });
  it("suppresses a classification exception changed after generation", async () => {
    const f = fixture(); f.config.mockReturnValueOnce({ startAt: at - 1000, allowedPhone: input.fromPhone, testCustomerOverride: true })
      .mockReturnValue({ startAt: at - 1000, allowedPhone: input.fromPhone, testCustomerOverride: false });
    expect(await f.run({ ...input, isCleaner: true })).toEqual({ outcome: "suppressed" }); expect(f.store.prepare).not.toHaveBeenCalled(); expect(f.send).not.toHaveBeenCalled();
  });
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
  it("does not send an acknowledgment if durable task persistence fails", async () => { const f = fixture(); f.store.prepare.mockRejectedValue(new Error("storage failure")); expect(await f.run(input)).toEqual({ outcome: "failed" }); expect(f.send).not.toHaveBeenCalled(); expect(f.store.suppressBeforeSubmission).toHaveBeenCalled(); });
  it("uses a durable staff-task fallback after generation fails, without rerunning the model", async () => {
    const f = fixture(); f.generate.mockRejectedValue(new Error("SMS_QUOTE_MODEL_PRICE"));
    expect(await f.run(input)).toEqual({ outcome: "accepted" });
    expect(f.generate).toHaveBeenCalledTimes(1); expect(f.store.prepare).toHaveBeenCalledTimes(1);
    expect(f.store.prepare).toHaveBeenCalledWith(expect.anything(), {
      replyText: "Sorry—I couldn't finish that response. I've flagged your message for our team to review.",
      task: { title: "Review customer message after reply failure", items: [{ title: "Review the customer's message and follow up", evidenceQuote: input.inboundText }] },
    }, { failures: [expect.objectContaining({ phase: "generation", code: "SMS_QUOTE_MODEL_PRICE" })] });
    expect(f.send).toHaveBeenCalledTimes(1); expect(f.order.indexOf("task-and-text-durable")).toBeLessThan(f.order.indexOf("send"));
    expect(f.store.suppressBeforeSubmission).not.toHaveBeenCalled();
  });
  it("falls back once when quote preparation fails, using the same receipt and no new model call", async () => {
    const f = fixture(); f.store.prepare.mockRejectedValueOnce(new Error("SMS_QUOTE_STATE_CONFLICT"));
    expect(await f.run(input)).toEqual({ outcome: "accepted" });
    expect(f.generate).toHaveBeenCalledTimes(1); expect(f.store.claim).toHaveBeenCalledTimes(1);
    expect(f.store.prepare).toHaveBeenCalledTimes(2);
    expect(f.store.prepare.mock.calls[1]).toEqual([f.store.prepare.mock.calls[0][0], expect.objectContaining({ task: expect.anything() }),
      { failures: [expect.objectContaining({ phase: "preparation", code: "SMS_QUOTE_STATE_CONFLICT" })] }]);
    expect(f.send).toHaveBeenCalledTimes(1);
  });
  it("retains both failures and sends nothing when the fallback task cannot be persisted", async () => {
    const f = fixture(); f.generate.mockRejectedValue(new Error("SMS_QUOTE_INVALID_EVIDENCE"));
    f.store.prepare.mockRejectedValue(new Error("CUSTOMER_REPLY_PREPARE_FAILED"));
    expect(await f.run(input)).toEqual({ outcome: "failed" }); expect(f.send).not.toHaveBeenCalled();
    expect(f.store.suppressBeforeSubmission).toHaveBeenCalledWith(expect.anything(), "GENERATION_OR_PERSISTENCE_FAILED", {
      failures: [expect.objectContaining({ phase: "generation", code: "SMS_QUOTE_INVALID_EVIDENCE" }),
        expect.objectContaining({ phase: "fallback_preparation", code: "CUSTOMER_REPLY_PREPARE_FAILED" })],
    });
  });
  it("does not send a fallback when configuration changes during the failed generation", async () => {
    const f = fixture(); f.generate.mockRejectedValue(new Error("SMS_QUOTE_MODEL_PRICE"));
    f.config.mockReturnValueOnce({ startAt: at - 1000, allowedPhone: input.fromPhone, testCustomerOverride: false }).mockReturnValue(null);
    expect(await f.run(input)).toEqual({ outcome: "suppressed" });
    expect(f.store.prepare).not.toHaveBeenCalled(); expect(f.send).not.toHaveBeenCalled();
  });
  it("does not substitute a fallback for stale or human-won preparation", async () => {
    const f = fixture(); f.generate.mockRejectedValue(new Error("SMS_QUOTE_MODEL_PRICE")); f.store.prepare.mockResolvedValue(false);
    expect(await f.run(input)).toEqual({ outcome: "suppressed" });
    expect(f.store.prepare).toHaveBeenCalledTimes(1); expect(f.send).not.toHaveBeenCalled();
  });
  it("never replaces or retries an uncertain fallback submission", async () => {
    const f = fixture(); f.generate.mockRejectedValue(new Error("SMS_QUOTE_MODEL_PRICE")); f.send.mockRejectedValue(new Error("timeout"));
    expect(await f.run(input)).toEqual({ outcome: "uncertain" });
    expect(f.send).toHaveBeenCalledTimes(1); expect(f.store.prepare).toHaveBeenCalledTimes(1);
    expect(f.store.markUncertain).toHaveBeenCalledTimes(1); expect(f.store.suppressBeforeSubmission).not.toHaveBeenCalled();
  });
  it("does not prepare fallback if configuration is disabled by the failed quote preparation", async () => {
    const f = fixture(); f.store.prepare.mockImplementationOnce(async () => {
      f.config.mockReturnValue(null); throw new Error("SMS_QUOTE_STATE_CONFLICT");
    });
    expect(await f.run(input)).toEqual({ outcome: "suppressed" });
    expect(f.store.prepare).toHaveBeenCalledTimes(1); expect(f.store.suppress).toHaveBeenCalledWith(expect.anything(), "CONFIG_CHANGED");
    expect(f.send).not.toHaveBeenCalled();
  });
  it("rechecks configuration after the fallback is durable and before submission", async () => {
    const f = fixture(); f.generate.mockRejectedValue(new Error("SMS_QUOTE_MODEL_PRICE"));
    f.config.mockReturnValueOnce({ startAt: at - 1000, allowedPhone: input.fromPhone, testCustomerOverride: false })
      .mockReturnValueOnce({ startAt: at - 1000, allowedPhone: input.fromPhone, testCustomerOverride: false }).mockReturnValue(null);
    expect(await f.run(input)).toEqual({ outcome: "suppressed" }); expect(f.store.prepare).toHaveBeenCalledTimes(1);
    expect(f.store.suppressBeforeSubmission).toHaveBeenCalledWith(expect.anything(), "CONFIG_CHANGED"); expect(f.send).not.toHaveBeenCalled();
  });
  it("does not resend a fallback after provider acceptance persistence fails", async () => {
    const f = fixture(); f.generate.mockRejectedValue(new Error("SMS_QUOTE_MODEL_PRICE"));
    f.store.recordAcceptance.mockRejectedValue(new Error("unknown commit"));
    expect(await f.run(input)).toEqual({ outcome: "uncertain" }); expect(f.send).toHaveBeenCalledTimes(1);
    expect(f.store.prepare).toHaveBeenCalledTimes(1); expect(f.store.markUncertain).toHaveBeenCalledTimes(1);
    expect(f.store.suppressBeforeSubmission).not.toHaveBeenCalled();
  });
  it("does not send stale or human-won claims", async () => { const f = fixture(); f.store.prepare.mockResolvedValue(false); expect(await f.run(input)).toEqual({ outcome: "suppressed" }); expect(f.send).not.toHaveBeenCalled(); });
  it.each([{ success: false }, { success: true }, { success: true, messageId: " " }])("never treats provider result %# as confirmed acceptance", async response => { const f = fixture(); f.send.mockResolvedValue(response as never); expect(await f.run(input)).toEqual({ outcome: "uncertain" }); expect(f.send).toHaveBeenCalledTimes(1); expect(f.store.recordAcceptance).not.toHaveBeenCalled(); expect(f.store.markUncertain).toHaveBeenCalled(); });
  it("never retries a transport timeout or post-acceptance persistence uncertainty", async () => { const f = fixture(); f.send.mockRejectedValue(new Error("timeout")); expect(await f.run(input)).toEqual({ outcome: "uncertain" }); expect(f.send).toHaveBeenCalledTimes(1); expect(f.store.suppressBeforeSubmission).not.toHaveBeenCalled(); const other = fixture(); other.store.recordAcceptance.mockRejectedValue(new Error("unknown commit")); expect(await other.run(input)).toEqual({ outcome: "uncertain" }); expect(other.send).toHaveBeenCalledTimes(1); expect(other.store.suppress).not.toHaveBeenCalled(); expect(other.store.suppressBeforeSubmission).not.toHaveBeenCalled(); });
  it("checks enablement again after generation", async () => { const f = fixture(); f.config.mockReturnValueOnce({ startAt: at - 1000, allowedPhone: input.fromPhone, testCustomerOverride: false }).mockReturnValue(null as never); expect(await f.run(input)).toEqual({ outcome: "suppressed" }); expect(f.store.prepare).not.toHaveBeenCalled(); expect(f.send).not.toHaveBeenCalled(); });
  it.each(["+13029816191", "+12025550124", "", "Jane +12025550123", "+12025550123,+13029816191", "202-555-0123"])('rejects nonpilot or noncanonical sender %s before every I/O', async fromPhone => {
    const f = fixture(); expect(await f.run({ ...input, fromPhone })).toEqual({ outcome: "excluded" });
    for (const action of [f.readSession, f.readReceivingLine, f.store.claim, f.generate, f.store.prepare, f.send]) expect(action).not.toHaveBeenCalled();
  });
  it("does not treat an injected start-only config as unrestricted", async () => {
    const f = fixture(); f.config.mockReturnValue({ startAt: at - 1000 } as never);
    expect(await f.run(input)).toEqual({ outcome: "excluded" }); expect(f.readSession).not.toHaveBeenCalled(); expect(f.send).not.toHaveBeenCalled();
  });
  it.each([{ startAt: at - 2000, allowedPhone: input.fromPhone, testCustomerOverride: false }, { startAt: at - 1000, allowedPhone: "+13029816191", testCustomerOverride: false }, { startAt: at - 1000 }])("suppresses changed or incomplete config after generation %#", async changed => {
    const f = fixture(); f.config.mockReturnValueOnce({ startAt: at - 1000, allowedPhone: input.fromPhone, testCustomerOverride: false }).mockReturnValue(changed as never);
    expect(await f.run(input)).toEqual({ outcome: "suppressed" }); expect(f.store.suppress).toHaveBeenCalledWith(expect.anything(), "CONFIG_CHANGED");
    expect(f.store.prepare).not.toHaveBeenCalled(); expect(f.send).not.toHaveBeenCalled();
  });
  it("retains the original phone snapshot when a config object is mutated during generation", async () => {
    const f = fixture(), config = { startAt: at - 1000, allowedPhone: input.fromPhone, testCustomerOverride: false };
    f.config.mockReturnValue(config); const generate = f.generate.getMockImplementation()!;
    f.generate.mockImplementation(async () => { config.allowedPhone = "+13029816191"; return generate(); });
    expect(await f.run(input)).toEqual({ outcome: "suppressed" }); expect(f.store.prepare).not.toHaveBeenCalled(); expect(f.send).not.toHaveBeenCalled();
  });
  it.each([null, { startAt: at - 2000, allowedPhone: input.fromPhone, testCustomerOverride: false }, { startAt: at - 1000, allowedPhone: "+13029816191", testCustomerOverride: false }, { startAt: at - 1000, allowedPhone: input.fromPhone, testCustomerOverride: true }])("rechecks cutoff, phone, and override immediately before sending %#", async changed => {
    const f = fixture(); f.config.mockReturnValueOnce({ startAt: at - 1000, allowedPhone: input.fromPhone, testCustomerOverride: false })
      .mockReturnValueOnce({ startAt: at - 1000, allowedPhone: input.fromPhone, testCustomerOverride: false }).mockReturnValue(changed as never);
    expect(await f.run(input)).toEqual({ outcome: "suppressed" }); expect(f.store.prepare).toHaveBeenCalledTimes(1);
    expect(f.store.suppressBeforeSubmission).toHaveBeenCalledWith(expect.anything(), "CONFIG_CHANGED"); expect(f.send).not.toHaveBeenCalled();
  });
});
const pilotEnv = { CLAUDE_CUSTOMER_SMS_ENABLED: "true", CLAUDE_CUSTOMER_SMS_START_AT: created, CLAUDE_CUSTOMER_SMS_ALLOWED_PHONE: "+13029816191" };
describe("immutable activation cutoff and single approved phone", () => {
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
  it("requires literal enablement, a trusted fixed ISO timestamp, and exactly one canonical phone", () => {
    expect(claudeCustomerSmsConfig({})).toBeNull();
    expect(claudeCustomerSmsConfig({ ...pilotEnv, CLAUDE_CUSTOMER_SMS_ENABLED: "1" })).toBeNull();
    expect(claudeCustomerSmsConfig(pilotEnv)).toEqual({ startAt: at, allowedPhone: "+13029816191", testCustomerOverride: false });
  });
  it.each([undefined, "", "3029816191", "302-981-6191", "13029816191", " +13029816191", "+13029816191 ", "Jane +13029816191", "+13029816191,+12025550123", "+13029816191 +12025550123", "[\"+13029816191\"]", "*", "+447911123456", "+11029816191", "+13021816191"])("rejects missing, noncanonical, invalid, or multiple configured phone %s", phone => {
    const env = { ...pilotEnv, CLAUDE_CUSTOMER_SMS_ALLOWED_PHONE: phone };
    expect(claudeCustomerSmsConfig(env)).toBeNull(); expect(isClaudeCustomerSmsPilotPhone("+13029816191", env)).toBe(false);
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
  it("rejects a nonpilot event before importing or acquiring the database", async () => {
    database.imported.mockClear(); database.getDb.mockClear();
    for (const [key, value] of Object.entries(pilotEnv)) vi.stubEnv(key, value);
    expect(await dispatchClaudeCustomerSms(input)).toEqual({ outcome: "excluded" });
    expect(database.imported).not.toHaveBeenCalled(); expect(database.getDb).not.toHaveBeenCalled();
  });
  it("stays default off when the allowed phone is missing", async () => {
    database.imported.mockClear(); database.getDb.mockClear();
    vi.stubEnv("CLAUDE_CUSTOMER_SMS_ENABLED", "true"); vi.stubEnv("CLAUDE_CUSTOMER_SMS_START_AT", created); vi.stubEnv("CLAUDE_CUSTOMER_SMS_ALLOWED_PHONE", undefined);
    expect(await dispatchClaudeCustomerSms(input)).toEqual({ outcome: "disabled" });
    expect(database.imported).not.toHaveBeenCalled(); expect(database.getDb).not.toHaveBeenCalled();
  });
});

describe("explicit future-only all-customer recipient scope", () => {
  const allEnv = { ...pilotEnv, CLAUDE_CUSTOMER_SMS_SCOPE: "all_customers", CLAUDE_CUSTOMER_SMS_TEST_CUSTOMER_OVERRIDE: "true" };
  const allConfig: CustomerSmsConfig = { startAt: at - 1000, allowedPhone: "+13029816191", testCustomerOverride: true, scope: "all_customers" };
  it("requires explicit valid scope while retaining the exact default pilot config", () => {
    expect(claudeCustomerSmsConfig(allEnv)).toEqual({ startAt: at, allowedPhone: "+13029816191", testCustomerOverride: true, scope: "all_customers" });
    expect(claudeCustomerSmsConfig({ ...pilotEnv, CLAUDE_CUSTOMER_SMS_SCOPE: "pilot" })).toEqual(claudeCustomerSmsConfig(pilotEnv));
    for (const scope of ["all", "*", "ALL_CUSTOMERS", "", " all_customers "]) {
      expect(claudeCustomerSmsConfig({ ...allEnv, CLAUDE_CUSTOMER_SMS_SCOPE: scope })).toBeNull();
      expect(isClaudeCustomerSmsPhoneEligible(input.fromPhone, { ...allEnv, CLAUDE_CUSTOMER_SMS_SCOPE: scope })).toBe(false);
    }
  });
  it.each(["+12025550123", "202-555-0123", "+12025550124", "+17035551234"])("admits a valid nonpilot destination %s only in explicit all-customer mode", phone => {
    expect(isClaudeCustomerSmsPhoneEligible(phone, allEnv)).toBe(true);
    expect(isClaudeCustomerSmsPilotPhone(phone, allEnv)).toBe(false);
    expect(isClaudeCustomerSmsPhoneEligible(phone, pilotEnv)).toBe(false);
    expect(isClaudeCustomerSmsPilotCustomerOverride(phone, allEnv)).toBe(false);
  });
  it.each([undefined, null, "", "Jane +12025550123", "+12025550123,+13029816191", "*", "+447911123456"])("still rejects malformed or unsupported destination %j", phone => {
    expect(isClaudeCustomerSmsPhoneEligible(phone, allEnv)).toBe(false);
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
  it.each([{ isCleaner: true }, { direction: "outgoing" }, { inboundText: "STOP" }, { createdAt: "2026-11-15T18:00:00Z" }, { createdAt: "2026-11-16T18:01:00Z" }, { receivedAt: at - 2000 }, { providerMessageId: "cs-fallback-old" }, { fromPhone: "+16505164957" }, { fromPhone: "+17259009272" }])("retains all pre-read exclusion guards in all-customer scope %#", async patch => {
    const f = fixture(); f.config.mockReturnValue(allConfig);
    expect(await f.run({ ...input, ...patch })).toEqual({ outcome: "excluded" }); expect(f.readSession).not.toHaveBeenCalled(); expect(f.send).not.toHaveBeenCalled();
  });
  it.each([{ leadSource: "hiring" }, { leadSource: "cs-inbound-cleaner" }, { leadSource: "internal" }, { leadSource: "staff" }, { csQueue: "Teams" }, { smsOptOut: 1 }])("keeps exact saved noncustomer/opt-out flags protected %#", async patch => {
    const f = fixture(); f.config.mockReturnValue(allConfig); f.readSession.mockResolvedValue({ ...snapshot(), ...patch });
    expect(await f.run(input)).toEqual({ outcome: "excluded" }); expect(f.generate).not.toHaveBeenCalled(); expect(f.send).not.toHaveBeenCalled();
  });
  it("does not permit all-customer scope to create another cleaner test exception", async () => {
    const f = fixture(); f.config.mockReturnValue({ ...allConfig, allowedPhone: input.fromPhone });
    expect(await f.run({ ...input, isCleaner: true })).toEqual({ outcome: "excluded" }); expect(f.send).not.toHaveBeenCalled();
  });
  it.each(["after-generation", "before-submission"])("suppresses a scope change %s without sending", async stage => {
    const f = fixture(); f.config.mockReturnValueOnce(allConfig);
    if (stage === "before-submission") f.config.mockReturnValueOnce(allConfig);
    f.config.mockReturnValue({ ...allConfig, scope: "pilot" });
    expect(await f.run(input)).toEqual({ outcome: "suppressed" }); expect(f.send).not.toHaveBeenCalled();
    expect(stage === "after-generation" ? f.store.suppress : f.store.suppressBeforeSubmission).toHaveBeenCalledWith(expect.anything(), "CONFIG_CHANGED");
  });
  it("rejects duplicate all-customer claims without regeneration, task creation or resend", async () => {
    const f = fixture(); f.config.mockReturnValue(allConfig); f.store.claim.mockResolvedValue(null as never);
    expect(await f.run(input)).toEqual({ outcome: "duplicate" }); expect(f.generate).not.toHaveBeenCalled(); expect(f.send).not.toHaveBeenCalled();
  });
  it("opens the existing lazy application only for a valid explicit all-customer scope", async () => {
    for (const [key, value] of Object.entries(allEnv)) vi.stubEnv(key, value);
    database.getDb.mockClear();
    expect(await dispatchClaudeCustomerSms(input)).toEqual({ outcome: "failed" }); expect(database.getDb).toHaveBeenCalledTimes(1);
  });
});
