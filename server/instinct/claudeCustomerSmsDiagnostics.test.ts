import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createClaudeCustomerSmsService, customerHistoryHash, logClaudeCustomerSmsDiagnostic,
  type CustomerSmsConfig, type CustomerSmsInput, type CustomerSmsOptions, type CustomerSmsSession, type CustomerSmsStore,
} from "./claudeCustomerSms";
import { dispatchClaudeCustomerSms } from "./claudeCustomerSmsApplication";
import { customerSmsContextHash } from "./customerSmsFreshness";
import type { CustomerSmsBinding, CustomerSmsClaim } from "./claudeCustomerTasksStore";
import type { CustomerReplyPlan } from "../../shared/claudeCustomerTasks";

// Never load the actual DB or notification implementation, even on dynamic import.
const application = vi.hoisted(() => ({
  imported: vi.fn(),
  getDb: vi.fn<() => Promise<null>>(),
  notifyOwner: vi.fn<(_payload: { title: string; content: string }) => Promise<boolean>>(),
}));
vi.mock("../db", () => { application.imported(); return { getDb: application.getDb }; });
vi.mock("../_core/notification", () => ({ notifyOwner: application.notifyOwner }));

const createdAt = "2026-11-16T18:00:00Z", at = Date.parse(createdAt);
const input: CustomerSmsInput = {
  sessionId: 71, providerMessageId: "inbound-real", fromPhone: "+12025550123",
  receivingPhoneNumberId: "PN-existing", inboundText: "Move my cleaning to Monday at 9",
  createdAt, receivedAt: at + 1000, isCleaner: false, direction: "incoming",
};
const config: CustomerSmsConfig = { startAt: at - 1000, allowedPhone: "", testCustomerOverride: false };
const current = () => ({ role: "user", content: input.inboundText, opMsgId: input.providerMessageId });
const snapshot = (): CustomerSmsSession => ({
  contact: { sessionId: "71", rawPhone: input.fromPhone, phone: input.fromPhone, displayName: "Jane Smith", contactGap: null },
  messageHistory: JSON.stringify([
    { role: "user", content: "Previous question", opMsgId: "older" },
    { role: "assistant", content: "Earlier staff reply" }, current(),
  ]),
  lastInboundPhoneNumberId: input.receivingPhoneNumberId, leadSource: "cs-inbound", smsOptOut: 0, csQueue: "Clients",
});
const ownerFailure = { taskId: null, code: "GENERATION_OR_PERSISTENCE_FAILED", sessionId: 71 };

function fixture(withVerification = true) {
  const order: string[] = [], session = snapshot();
  const plan: CustomerReplyPlan = {
    replyText: "Absolutely, Jane—we'll take care of this and confirm once the change is made.",
    task: { title: "Reschedule Jane's cleaning", items: [{ title: "Move cleaning to Monday at 9", evidenceQuote: input.inboundText }] },
  };
  const readConfig = vi.fn<() => CustomerSmsConfig | null>(() => { order.push("config"); return { ...config }; });
  const readSession = vi.fn<CustomerSmsOptions["readSession"]>(async () => { order.push("session"); return session; });
  const readReceivingLine = vi.fn<CustomerSmsOptions["readReceivingLine"]>(async () => { order.push("line"); return "+12025550999"; });
  const generate = vi.fn<CustomerSmsOptions["generate"]>(async () => { order.push("generate"); return plan; });
  const verify = vi.fn<NonNullable<CustomerSmsStore["verifyBeforeSubmission"]>>(async () => { order.push("verify"); return true; });
  const store = {
    claim: vi.fn<CustomerSmsStore["claim"]>(async binding => { order.push("claim"); return { draftId: 5, key: "fixture-receipt", binding }; }),
    prepare: vi.fn<CustomerSmsStore["prepare"]>(async () => { order.push("prepare"); return true; }),
    recordAcceptance: vi.fn<CustomerSmsStore["recordAcceptance"]>(async () => { order.push("acceptance"); return true; }),
    markUncertain: vi.fn<CustomerSmsStore["markUncertain"]>(async () => { order.push("uncertain"); }),
    suppress: vi.fn<CustomerSmsStore["suppress"]>(async () => { order.push("suppress"); }),
    suppressBeforeSubmission: vi.fn<CustomerSmsStore["suppressBeforeSubmission"]>(async () => { order.push("suppress-before-send"); }),
    reportFailure: vi.fn<NonNullable<CustomerSmsStore["reportFailure"]>>(async () => { order.push("report-failure"); return { taskId: 101, notify: true }; }),
    ...(withVerification ? { verifyBeforeSubmission: verify } : {}),
  };
  const send = vi.fn<CustomerSmsOptions["send"]>(async () => { order.push("send"); return { success: true, messageId: "accepted-provider-id" }; });
  const onFailure = vi.fn<NonNullable<CustomerSmsOptions["onFailure"]>>(async () => { order.push("owner-alert"); });
  const onTaskChange = vi.fn<NonNullable<CustomerSmsOptions["onTaskChange"]>>(async () => { order.push("task-change"); });
  return {
    order, session, plan, config: readConfig, readSession, readReceivingLine, generate, verify, store, send, onFailure, onTaskChange,
    run: createClaudeCustomerSmsService({ config: readConfig, readSession, readReceivingLine, generate, store, send, onFailure, onTaskChange }),
  };
}
type Fixture = ReturnType<typeof fixture>;
const captureLog = () => vi.spyOn(console, "log").mockImplementation(() => undefined);
const blockFetch = () => vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Offline diagnostics test: fetch forbidden"));
let logSpy: ReturnType<typeof captureLog>, fetchSpy: ReturnType<typeof blockFetch>;

beforeEach(() => {
  application.imported.mockClear();
  application.getDb.mockReset().mockResolvedValue(null);
  application.notifyOwner.mockReset().mockResolvedValue(true);
  // All feature gates are local test values, never inherited operational configuration.
  vi.stubEnv("CLAUDE_CUSTOMER_SMS_ENABLED", "false");
  vi.stubEnv("CLAUDE_CUSTOMER_SMS_START_AT", createdAt);
  vi.stubEnv("CLAUDE_CUSTOMER_SMS_ALLOWED_PHONE", undefined);
  vi.stubEnv("CLAUDE_CUSTOMER_SMS_TEST_CUSTOMER_OVERRIDE", "false");
  vi.stubEnv("CLAUDE_CUSTOMER_SMS_SCOPE", undefined);
  logSpy = captureLog();
  fetchSpy = blockFetch();
});
afterEach(() => {
  try { expect(fetchSpy).not.toHaveBeenCalled(); }
  finally { vi.restoreAllMocks(); vi.unstubAllEnvs(); }
});

const allowedDiagnosticFields = new Set([
  "message", "sessionId", "inboundMessageId", "stage", "outcome", "reason",
  "receiptClaimAttempted", "generationReached", "replyOwned", "errorCode", "errorName",
]);
function diagnostics(): Record<string, unknown>[] {
  return logSpy.mock.calls.map(args => {
    expect(args).toHaveLength(1);
    expect(typeof args[0]).toBe("string");
    const record = JSON.parse(args[0] as string) as Record<string, unknown>;
    expect(record.message).toBe("[ClaudeCustomerSMS][Diagnostic]");
    for (const key of Object.keys(record)) expect(allowedDiagnosticFields.has(key)).toBe(true);
    return record;
  });
}
const base = { message: "[ClaudeCustomerSMS][Diagnostic]", sessionId: 71, inboundMessageId: input.providerMessageId };
const unclaimed = { receiptClaimAttempted: false, generationReached: false };
const attemptedUnclaimed = { receiptClaimAttempted: true, generationReached: false };
const generationFlags = { receiptClaimAttempted: true, generationReached: true };
function noReply(f: Fixture) {
  expect(f.generate).not.toHaveBeenCalled(); expect(f.store.prepare).not.toHaveBeenCalled();
  expect(f.verify).not.toHaveBeenCalled(); expect(f.send).not.toHaveBeenCalled();
  expect(f.store.recordAcceptance).not.toHaveBeenCalled(); expect(f.store.markUncertain).not.toHaveBeenCalled();
  expect(f.store.suppress).not.toHaveBeenCalled(); expect(f.store.suppressBeforeSubmission).not.toHaveBeenCalled();
  expect(f.onTaskChange).not.toHaveBeenCalled();
}
function preClaimFailure(f: Fixture) {
  noReply(f);
  expect(f.store.claim).not.toHaveBeenCalled(); expect(f.store.reportFailure).not.toHaveBeenCalled();
  expect(f.onFailure.mock.calls).toEqual([[ownerFailure]]);
}
async function successfulCalls(f: Fixture, withVerification = true) {
  expect(f.order).toEqual([
    "config", "session", "line", "claim", "generate", "config", "prepare", "task-change", "config",
    ...(withVerification ? ["verify"] : []), "send", "acceptance", "task-change",
  ]);
  const binding: CustomerSmsBinding = {
    sessionId: 71, providerMessageId: input.providerMessageId, fromPhone: input.fromPhone,
    receivingPhoneNumberId: input.receivingPhoneNumberId, receivingPhoneNumber: "+12025550999",
    inboundText: input.inboundText, createdAt: at, receivedAt: input.receivedAt,
    customerName: "Jane Smith", historyHash: customerHistoryHash(f.session.messageHistory),
    historyContextHash: customerSmsContextHash(f.session.messageHistory)!,
  };
  expect(f.config.mock.calls).toEqual([[], [], []]);
  expect(f.readSession.mock.calls).toEqual([[71]]);
  expect(f.readReceivingLine.mock.calls).toEqual([["PN-existing"]]);
  expect(f.store.claim.mock.calls).toEqual([[binding]]);
  const claimedBinding = f.store.claim.mock.calls[0][0];
  const claim = await f.store.claim.mock.results[0].value as CustomerSmsClaim;
  expect(f.generate).toHaveBeenCalledTimes(1);
  expect(f.generate.mock.calls[0]).toEqual([binding, f.session, expect.any(AbortSignal)]);
  expect(f.generate.mock.calls[0][0]).toBe(claimedBinding);
  expect(f.generate.mock.calls[0][1]).toBe(f.session);
  expect(f.generate.mock.calls[0][2]?.aborted).toBe(false);
  expect(f.store.prepare.mock.calls).toEqual([[claim, f.plan]]);
  if (withVerification) expect(f.verify.mock.calls).toEqual([[claim]]);
  else expect(f.verify).not.toHaveBeenCalled();
  expect(f.send.mock.calls).toEqual([[{ to: input.fromPhone, content: f.plan.replyText, fromNumberId: "PN-existing" }]]);
  expect(f.store.recordAcceptance.mock.calls).toEqual([[claim, "accepted-provider-id"]]);
  expect(f.onTaskChange.mock.calls).toEqual([[], []]);
  for (const action of [f.store.reportFailure, f.store.suppress, f.store.suppressBeforeSubmission, f.store.markUncertain, f.onFailure]) expect(action).not.toHaveBeenCalled();
}

const successfulDiagnostics = [
  { ...base, stage: "session_read", reason: "SESSION_READ_REACHED", ...unclaimed },
  { ...base, stage: "receiving_line_read", reason: "RECEIVING_LINE_READ_REACHED", ...unclaimed },
  { ...base, stage: "receipt_claim", reason: "RECEIPT_CLAIM_REACHED", ...attemptedUnclaimed },
  { ...base, stage: "generation", reason: "GENERATION_REACHED", ...generationFlags },
];

describe("offline customer SMS diagnostics preserve the existing service decisions", () => {
  it("logs exactly four boundaries before their existing dependency calls and preserves the successful sequence and arguments", async () => {
    const f = fixture(), before = JSON.stringify(f.session), ordersAtLog: string[][] = [];
    logSpy.mockImplementation(() => { ordersAtLog.push([...f.order]); });
    expect(await f.run(input)).toEqual({ outcome: "accepted" });
    await successfulCalls(f);
    expect(diagnostics()).toEqual(successfulDiagnostics);
    expect(ordersAtLog).toEqual([["config"], ["config", "session"], ["config", "session", "line"], ["config", "session", "line", "claim"]]);
    expect(JSON.stringify(f.session)).toBe(before);
  });

  it("preserves acceptance when optional verifyBeforeSubmission is absent", async () => {
    const f = fixture(false);
    expect(f.store.verifyBeforeSubmission).toBeUndefined();
    expect(await f.run(input)).toEqual({ outcome: "accepted" });
    await successfulCalls(f, false);
    expect(diagnostics()).toEqual(successfulDiagnostics);
  });

  it("logs session entry then safe INVALID_SESSION_ROWS exception without claim, generation, outcome or a changed owner alert", async () => {
    const f = fixture();
    f.readSession.mockRejectedValue(Object.assign(new Error("Private SQL rows and customer text must not appear"), { code: "INVALID_SESSION_ROWS" }));
    expect(await f.run(input)).toEqual({ outcome: "failed" });
    expect(f.readSession.mock.calls).toEqual([[71]]); expect(f.readReceivingLine).not.toHaveBeenCalled();
    preClaimFailure(f);
    expect(diagnostics()).toEqual([
      successfulDiagnostics[0],
      { ...base, stage: "session_read", reason: "EXCEPTION", ...unclaimed, errorCode: "INVALID_SESSION_ROWS", errorName: "Error" },
    ]);
  });

  it("logs session and line entries then safe RECEIVING_LINE_UNAVAILABLE with both pre-claim flags false", async () => {
    const f = fixture();
    f.readReceivingLine.mockRejectedValue(Object.assign(new Error("Private receiving line response body"), { code: "RECEIVING_LINE_UNAVAILABLE" }));
    expect(await f.run(input)).toEqual({ outcome: "failed" });
    expect(f.readSession.mock.calls).toEqual([[71]]); expect(f.readReceivingLine.mock.calls).toEqual([["PN-existing"]]);
    preClaimFailure(f);
    expect(diagnostics()).toEqual([
      ...successfulDiagnostics.slice(0, 2),
      { ...base, stage: "receiving_line_read", reason: "EXCEPTION", ...unclaimed, errorCode: "RECEIVING_LINE_UNAVAILABLE", errorName: "Error" },
    ]);
  });

  it("records a typed PRECONDITION_FAILED claim attempt without reaching generation", async () => {
    const f = fixture();
    // Use the store error's observable shape without importing its runtime DB dependencies.
    f.store.claim.mockRejectedValue(Object.assign(new Error("Private receipt precondition detail"), { code: "PRECONDITION_FAILED", name: "CustomerTaskStoreError" }));
    expect(await f.run(input)).toEqual({ outcome: "failed" });
    noReply(f); expect(f.store.claim).toHaveBeenCalledTimes(1);
    expect(f.store.reportFailure).not.toHaveBeenCalled(); expect(f.onFailure.mock.calls).toEqual([[ownerFailure]]);
    expect(diagnostics()).toEqual([
      ...successfulDiagnostics.slice(0, 3),
      { ...base, stage: "receipt_claim", reason: "EXCEPTION", ...attemptedUnclaimed, errorCode: "PRECONDITION_FAILED", errorName: "CustomerTaskStoreError" },
    ]);
  });

  it("keeps a null claim duplicate with only three boundary records and no generation", async () => {
    const f = fixture(); f.store.claim.mockResolvedValue(null);
    expect(await f.run(input)).toEqual({ outcome: "duplicate" });
    noReply(f); expect(f.store.claim).toHaveBeenCalledTimes(1);
    expect(f.store.reportFailure).not.toHaveBeenCalled(); expect(f.onFailure).not.toHaveBeenCalled();
    expect(diagnostics()).toEqual(successfulDiagnostics.slice(0, 3));
  });

  it("uses safe SyntaxError typing after the four boundaries and keeps raw generated body out of logs and durable failure details", async () => {
    const f = fixture(), body = "Private generated JSON with +12025550123 and credential sk-secret-syntax";
    f.generate.mockRejectedValue(new SyntaxError(body));
    expect(await f.run(input)).toEqual({ outcome: "failed" });
    const claim = await f.store.claim.mock.results[0].value as CustomerSmsClaim;
    expect(f.store.claim).toHaveBeenCalledTimes(1); expect(f.generate).toHaveBeenCalledTimes(1);
    expect(f.store.prepare).not.toHaveBeenCalled(); expect(f.send).not.toHaveBeenCalled();
    expect(f.store.suppressBeforeSubmission.mock.calls).toEqual([[claim, "GENERATION_OR_PERSISTENCE_FAILED", {
      failures: [{ phase: "generation", code: "UNCLASSIFIED_ERROR", name: "SyntaxError", issues: [] }],
    }]]);
    expect(f.store.reportFailure.mock.calls).toEqual([[claim, "GENERATION_OR_PERSISTENCE_FAILED", false]]);
    expect(f.onFailure.mock.calls).toEqual([[{ ...ownerFailure, taskId: 101 }]]);
    expect(diagnostics()).toEqual([
      ...successfulDiagnostics,
      { ...base, stage: "generation", reason: "EXCEPTION", ...generationFlags, errorCode: "UNCLASSIFIED_ERROR", errorName: "SyntaxError" },
    ]);
    expect(JSON.stringify(logSpy.mock.calls)).not.toContain(body);
  });

  it("redacts unknown error messages, customer phones, credentials, stack and arbitrary custom fields", async () => {
    const f = fixture();
    const secrets = [input.inboundText, input.fromPhone, "+12025550999", "sk-secret-diagnostic-test", "postgres://private:password@host/db", "private-stack-frame", "private-custom-value"];
    const error = Object.assign(new Error(secrets.join(" ")), {
      code: "NOT_AN_APPROVED_ERROR_CODE", name: "PrivateVendorError", stack: "private-stack-frame",
      custom: "private-custom-value", credentials: { apiKey: secrets[3], url: secrets[4] },
    });
    f.readSession.mockRejectedValue(error);
    expect(await f.run(input)).toEqual({ outcome: "failed" }); preClaimFailure(f);
    expect(diagnostics()).toEqual([
      successfulDiagnostics[0],
      { ...base, stage: "session_read", reason: "EXCEPTION", ...unclaimed, errorCode: "UNCLASSIFIED_ERROR", errorName: "Error" },
    ]);
    const emitted = JSON.stringify(logSpy.mock.calls);
    for (const secret of secrets) expect(emitted).not.toContain(secret);
    for (const record of diagnostics()) {
      for (const key of ["stack", "custom", "credentials", "apiKey", "errorMessage", "error", "draftId", "receiptClaimed", "receiptCreationAttempted"]) expect(record).not.toHaveProperty(key);
    }
  });

  it.each(["code", "message", "name"])("a malicious error %s getter cannot throw from the helper or change a pre-claim failed outcome", async key => {
    const getter = vi.fn(() => { throw new Error("Private malicious getter body"); });
    const error = Object.defineProperty({}, key, { get: getter });
    expect(() => logClaudeCustomerSmsDiagnostic(input, { stage: "session_read", error })).not.toThrow();
    expect(getter).toHaveBeenCalled(); expect(logSpy).not.toHaveBeenCalled();
    const f = fixture(); f.readSession.mockRejectedValue(error);
    expect(await f.run(input)).toEqual({ outcome: "failed" }); preClaimFailure(f);
    expect(diagnostics()).toEqual([successfulDiagnostics[0]]);
    expect(JSON.stringify(logSpy.mock.calls)).not.toContain("Private malicious getter body");
  });

  it("a throwing console.log cannot change successful outcome, call order, arguments or counters", async () => {
    const control = fixture(); expect(await control.run(input)).toEqual({ outcome: "accepted" });
    logSpy.mockClear().mockImplementation(() => { throw new Error("Logger unavailable"); });
    const f = fixture(); expect(await f.run(input)).toEqual({ outcome: "accepted" });
    await successfulCalls(f); expect(f.order).toEqual(control.order); expect(logSpy).toHaveBeenCalledTimes(4);
  });

  it("a throwing console.log cannot change the pre-claim failed outcome, call order, counters or owner alert", async () => {
    const error = Object.assign(new Error("Private invalid rows"), { code: "INVALID_SESSION_ROWS" });
    const control = fixture(); control.readSession.mockRejectedValue(error);
    expect(await control.run(input)).toEqual({ outcome: "failed" });
    logSpy.mockClear().mockImplementation(() => { throw new Error("Logger unavailable"); });
    const f = fixture(); f.readSession.mockRejectedValue(error);
    expect(await f.run(input)).toEqual({ outcome: "failed" }); preClaimFailure(f);
    expect(f.order).toEqual(control.order); expect(f.config.mock.calls).toEqual([[]]);
    expect(f.readSession.mock.calls).toEqual([[71]]); expect(f.readReceivingLine).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledTimes(2);
  });

  const loggerOutcomes: { outcome: string; logs: number; setup: (f: Fixture) => void; event?: CustomerSmsInput }[] = [
    { outcome: "disabled", logs: 0, setup: f => { f.config.mockReturnValue(null); } },
    { outcome: "excluded", logs: 0, setup: () => undefined, event: { ...input, direction: "outgoing" } },
    { outcome: "duplicate", logs: 3, setup: f => { f.store.claim.mockResolvedValue(null); } },
    { outcome: "suppressed", logs: 4, setup: f => { f.store.prepare.mockResolvedValue(false); } },
    { outcome: "uncertain", logs: 4, setup: f => { f.send.mockResolvedValue({ success: false }); } },
    { outcome: "failed", logs: 5, setup: f => { f.generate.mockRejectedValue(new SyntaxError("Private generation response")); } },
  ];
  it.each(loggerOutcomes)("a throwing logger preserves $outcome and all dependency call counts", async ({ outcome, logs, setup, event = input }) => {
    const control = fixture(); setup(control);
    expect(await control.run(event)).toEqual({ outcome });
    expect(diagnostics()).toHaveLength(logs);
    logSpy.mockClear().mockImplementation(() => { throw new Error("Logger unavailable"); });
    const f = fixture(); setup(f);
    expect(await f.run(event)).toEqual({ outcome });
    expect(f.order).toEqual(control.order); expect(logSpy).toHaveBeenCalledTimes(logs);
    const actions = (value: Fixture) => [value.config, value.readSession, value.readReceivingLine, value.generate,
      value.verify, value.send, value.onFailure, value.onTaskChange, ...Object.values(value.store)];
    expect(actions(f).map(action => action.mock.calls.length)).toEqual(actions(control).map(action => action.mock.calls.length));
    expect(f.onFailure.mock.calls).toEqual(control.onFailure.mock.calls);
    expect(f.send.mock.calls).toEqual(control.send.mock.calls);
  });
});

describe("bounded diagnostic helper fields", () => {
  it.each(["INVALID_SESSION", "DATABASE_UNAVAILABLE", "INVALID_SESSION_ROWS", "SESSION_CONTACT_CONFLICT", "EXACT_SESSION_CONFLICT", "RECEIVING_LINE_UNAVAILABLE"])("preserves the allowlisted pre-claim code %s without raw error text", code => {
    logClaudeCustomerSmsDiagnostic(input, { stage: "session_read", error: Object.assign(new Error("Private pre-claim context"), { code }) });
    expect(diagnostics()).toEqual([{ ...base, stage: "session_read", errorCode: code, errorName: "Error" }]);
  });

  it("emits dispatch outcome and reply ownership but ignores legacy receipt fields and arbitrary details", () => {
    const detail = {
      stage: "dispatch" as const, outcome: "accepted" as const, replyOwned: true,
      receiptClaimAttempted: true, generationReached: true,
      draftId: 5, receiptClaimed: true, receiptCreationAttempted: true,
      customerPhone: input.fromPhone, inboundText: input.inboundText, credentials: "sk-private-field",
    };
    logClaudeCustomerSmsDiagnostic(input, detail);
    expect(diagnostics()).toEqual([{ ...base, stage: "dispatch", outcome: "accepted", replyOwned: true, ...generationFlags }]);
  });

  it("omits an unsafe reason and sanitizes identifiers without expanding the field set", () => {
    logClaudeCustomerSmsDiagnostic({ sessionId: 0, providerMessageId: "Private body +12025550123" }, { stage: "dispatch", reason: "private body +12025550123" });
    expect(diagnostics()).toEqual([{ message: base.message, sessionId: null, inboundMessageId: null, stage: "dispatch" }]);
  });
});

const initialGuards: { name: string; patch: Partial<CustomerSmsInput> }[] = [
  { name: "outgoing event", patch: { direction: "outgoing" } },
  { name: "invalid session ID", patch: { sessionId: 0 } },
  { name: "fallback provider message ID", patch: { providerMessageId: "cs-fallback-old" } },
  { name: "empty receiving line ID", patch: { receivingPhoneNumberId: " " } },
  { name: "empty inbound text", patch: { inboundText: " " } },
  { name: "noncanonical customer phone", patch: { fromPhone: "202-555-0123" } },
  { name: "excluded sender", patch: { fromPhone: "+16505164957" } },
  { name: "STOP text", patch: { inboundText: " STOP " } },
  { name: "unsubscribe text", patch: { inboundText: "unsubscribe" } },
  { name: "invalid created timestamp", patch: { createdAt: "2026-11-16" } },
  { name: "invalid receipt timestamp", patch: { receivedAt: NaN } },
  { name: "created before start", patch: { createdAt: "2026-11-15T18:00:00Z" } },
  { name: "received before start", patch: { receivedAt: at - 2000 } },
  { name: "created after receipt", patch: { createdAt: "2026-11-16T18:01:00Z" } },
];
describe("original guard predicates without reason or outcome logs", () => {
  it("configuration disabled returns unchanged with zero logs or source, receipt or owner-alert work", async () => {
    const f = fixture(); f.config.mockReturnValue(null);
    expect(await f.run(input)).toEqual({ outcome: "disabled" });
    expect(f.config).toHaveBeenCalledTimes(1); expect(f.readSession).not.toHaveBeenCalled(); expect(f.readReceivingLine).not.toHaveBeenCalled();
    noReply(f); expect(f.store.claim).not.toHaveBeenCalled(); expect(f.store.reportFailure).not.toHaveBeenCalled(); expect(f.onFailure).not.toHaveBeenCalled();
    expect(logSpy).not.toHaveBeenCalled();
  });
  it.each(initialGuards)("initial event guard: $name stays excluded with zero logs before reads", async ({ patch }) => {
    const f = fixture(), event = { ...input, ...patch };
    expect(await f.run(event)).toEqual({ outcome: "excluded" });
    expect(f.config.mock.calls).toEqual([[]]); expect(f.readSession).not.toHaveBeenCalled(); expect(f.readReceivingLine).not.toHaveBeenCalled();
    noReply(f); expect(f.store.claim).not.toHaveBeenCalled(); expect(f.store.reportFailure).not.toHaveBeenCalled(); expect(f.onFailure).not.toHaveBeenCalled();
    expect(logSpy).not.toHaveBeenCalled();
  });

  const sessionGuards: { name: string; session: () => CustomerSmsSession | null }[] = [
    { name: "session missing", session: () => null },
    { name: "session ID mismatch", session: () => ({ ...snapshot(), contact: { ...snapshot().contact, sessionId: "99" } }) },
    { name: "session phone mismatch", session: () => ({ ...snapshot(), contact: { ...snapshot().contact, phone: "+12025550124" } }) },
    { name: "session raw phone mismatch", session: () => ({ ...snapshot(), contact: { ...snapshot().contact, rawPhone: "+12025550124" } }) },
    { name: "session line mismatch", session: () => ({ ...snapshot(), lastInboundPhoneNumberId: "wrong" }) },
    { name: "session opted out", session: () => ({ ...snapshot(), smsOptOut: 1 }) },
  ];
  it.each(sessionGuards)("session guard: $name stays excluded with only the prior read boundary", async ({ session }) => {
    const f = fixture(); f.readSession.mockResolvedValue(session());
    expect(await f.run(input)).toEqual({ outcome: "excluded" });
    expect(f.config.mock.calls).toEqual([[]]); expect(f.readSession.mock.calls).toEqual([[71]]); expect(f.readReceivingLine).not.toHaveBeenCalled();
    noReply(f); expect(f.store.claim).not.toHaveBeenCalled(); expect(f.store.reportFailure).not.toHaveBeenCalled(); expect(f.onFailure).not.toHaveBeenCalled();
    expect(diagnostics()).toEqual([successfulDiagnostics[0]]);
  });

  const currentTurnGuards: { name: string; history: () => unknown }[] = [
    { name: "history parse failure", history: () => "invalid private JSON" },
    { name: "history not array", history: () => JSON.stringify({ private: "not a history" }) },
    { name: "invalid history turn", history: () => JSON.stringify([null, current()]) },
    { name: "inbound ID not unique", history: () => JSON.stringify([current(), current()]) },
    { name: "newer inbound turn", history: () => JSON.stringify([current(), { role: "user", content: "New private question", opMsgId: "newer" }]) },
    { name: "inbound text mismatch", history: () => JSON.stringify([{ ...current(), content: "Different private text" }]) },
    { name: "inbound ID conflict", history: () => JSON.stringify([{ ...current(), providerMessageId: "conflicting" }]) },
    { name: "newer reply turn", history: () => JSON.stringify([current(), { role: "assistant", content: "Staff already answered" }]) },
    { name: "turn session mismatch", history: () => JSON.stringify([{ ...current(), metadata: { sessionId: 99 } }]) },
    { name: "turn line mismatch", history: () => JSON.stringify([{ ...current(), metadata: { receivingPhoneNumberId: "wrong" } }]) },
    { name: "turn phone mismatch", history: () => JSON.stringify([{ ...current(), metadata: { fromPhone: "+12025550124" } }]) },
  ];
  it.each(currentTurnGuards)("current-turn predicate: $name stays excluded without a reason log", async ({ history }) => {
    const f = fixture(); f.readSession.mockResolvedValue({ ...snapshot(), messageHistory: history() });
    expect(await f.run(input)).toEqual({ outcome: "excluded" });
    expect(f.config.mock.calls).toEqual([[]]); expect(f.readSession.mock.calls).toEqual([[71]]);
    expect(f.readReceivingLine).not.toHaveBeenCalled(); noReply(f);
    expect(f.store.claim).not.toHaveBeenCalled(); expect(f.store.reportFailure).not.toHaveBeenCalled(); expect(f.onFailure).not.toHaveBeenCalled();
    expect(diagnostics()).toEqual([successfulDiagnostics[0]]);
  });
});

describe("offline application database-acquisition diagnostics", () => {
  const unavailable = { ...base, stage: "database_acquisition", outcome: "failed", reason: "CUSTOMER_REPLY_DATABASE_UNAVAILABLE", ...unclaimed };
  const notification = {
    title: "Customer SMS needs staff review",
    content: "Session 71. Staff task could not be saved; review the conversation manually. CUSTOMER_REPLY_DATABASE_UNAVAILABLE.",
  };
  it("getDb null stays failed with both flags false and exactly the unchanged one owner alert", async () => {
    vi.stubEnv("CLAUDE_CUSTOMER_SMS_ENABLED", "true");
    expect(await dispatchClaudeCustomerSms(input)).toEqual({ outcome: "failed" });
    expect(application.getDb.mock.calls).toEqual([[]]); expect(application.notifyOwner.mock.calls).toEqual([[notification]]);
    expect(diagnostics()).toEqual([unavailable]);
  });
  it("getDb throwing logs safe typed error then unavailable and preserves exactly one owner alert", async () => {
    vi.stubEnv("CLAUDE_CUSTOMER_SMS_ENABLED", "true");
    const body = "Private connection password +12025550123";
    application.getDb.mockRejectedValue(Object.assign(new Error(body), { code: "CUSTOMER_REPLY_DATABASE_UNAVAILABLE" }));
    expect(await dispatchClaudeCustomerSms(input)).toEqual({ outcome: "failed" });
    expect(application.getDb.mock.calls).toEqual([[]]); expect(application.notifyOwner.mock.calls).toEqual([[notification]]);
    expect(diagnostics()).toEqual([
      { ...base, stage: "database_acquisition", reason: "DATABASE_ACQUISITION_THREW", ...unclaimed, errorCode: "CUSTOMER_REPLY_DATABASE_UNAVAILABLE", errorName: "Error" },
      unavailable,
    ]);
    expect(JSON.stringify(logSpy.mock.calls)).not.toContain(body);
  });
  it("disabled application entry has zero logs and does not acquire the DB or alert the owner", async () => {
    expect(await dispatchClaudeCustomerSms(input)).toEqual({ outcome: "disabled" });
    expect(application.imported).not.toHaveBeenCalled(); expect(application.getDb).not.toHaveBeenCalled(); expect(application.notifyOwner).not.toHaveBeenCalled();
    expect(logSpy).not.toHaveBeenCalled();
  });
  it("invalid application phone is excluded with zero logs, no DB acquisition and no owner alert", async () => {
    vi.stubEnv("CLAUDE_CUSTOMER_SMS_ENABLED", "true");
    expect(await dispatchClaudeCustomerSms({ ...input, fromPhone: "Jane +12025550123" })).toEqual({ outcome: "excluded" });
    expect(application.imported).not.toHaveBeenCalled(); expect(application.getDb).not.toHaveBeenCalled(); expect(application.notifyOwner).not.toHaveBeenCalled();
    expect(logSpy).not.toHaveBeenCalled();
  });
  it.each([false, true])("a throwing logger preserves DB-null/throw outcome and one owner alert (throw=%s)", async throws => {
    vi.stubEnv("CLAUDE_CUSTOMER_SMS_ENABLED", "true");
    if (throws) application.getDb.mockRejectedValue(new Error("CUSTOMER_REPLY_DATABASE_UNAVAILABLE"));
    logSpy.mockImplementation(() => { throw new Error("Logger unavailable"); });
    expect(await dispatchClaudeCustomerSms(input)).toEqual({ outcome: "failed" });
    expect(application.getDb.mock.calls).toEqual([[]]); expect(application.notifyOwner.mock.calls).toEqual([[notification]]);
    expect(logSpy).toHaveBeenCalledTimes(throws ? 2 : 1);
  });
});
