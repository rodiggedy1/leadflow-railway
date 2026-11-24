import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { capturedThumbtackLead, eligibleThumbtackLead, thumbtackFirstResponseConfig, thumbtackFirstResponseKey, createClaudeThumbtackFirstResponseService,
  type CapturedLead, type FirstResponseStore, type FirstResponseClaim } from "./claudeThumbtackFirstResponse";
import { THUMBTACK_FIRST_RESPONSE_PROMPT, buildThumbtackLeadDraftContext, type ClaudeInitialLeadInput } from "../../shared/claudeInitialLead";
import { generateClaudeInitialLeadContent, type ClaudeInitialLeadContentOptions, type InitialLeadRunner } from "./claudeInitialLead";
const env = { THUMBTACK_CLAUDE_FIRST_RESPONSE_ENABLED: "true", THUMBTACK_CLAUDE_FIRST_RESPONSE_START_AT: "2026-11-16T17:00:00Z", OPENPHONE_PHONE_NUMBER_ID: "PN-lead" };
const config = thumbtackFirstResponseConfig(env)!;
export function fixture(): CapturedLead {
  return { id: 7, source: "thumbtack", eventType: "NegotiationCreatedV4", receivedAt: new Date("2026-11-16T17:01:00Z"), earliestId: 7,
    earliestReceivedAt: new Date("2026-11-16T17:01:00Z"), rawPayload: JSON.stringify({ event: { eventType: "NegotiationCreatedV4", webhookID: "delivery-1", triggeredAt: "2026-11-16T17:00:02Z" },
      data: { negotiationID: "neg-1", createdAt: "2026-11-16T17:00:01Z", customer: { firstName: "Jane", lastName: "Native", phone: "+17035551234" },
        request: { category: { name: "Deep Cleaning" }, description: "Skip office", location: { city: "Alexandria", state: "VA" },
          details: [{ question: "Home size", answer: "2 bedrooms and 2 bathrooms" }, { question: "Extra requests", answer: "Fridge, oven" }, { question: "Anything else", answer: "Inside cabinets" }] } } }) };
}
function harness() {
  const capture = fixture();
  let claim: FirstResponseClaim | null = null, status = "", text = "";
  const store: FirstResponseStore = {
    loadCapture: vi.fn(async () => capture),
    claim: vi.fn(async (lead, cfg) => { if (claim) return null; status = "TOOLS_RUNNING"; return claim = { draftId: 2, sessionId: 11, cardId: 13, lead, fromNumberId: cfg.fromNumberId }; }),
    fresh: vi.fn(async () => status === "TOOLS_RUNNING"),
    beginSend: vi.fn(async (_, result) => { if (status !== "TOOLS_RUNNING") return false; text = result.replyText; status = "SENDING"; return true; }),
    accepted: vi.fn(async () => { status = "SENT"; }),
    blocked: vi.fn(async (_, __, uncertain) => { if (status === "TOOLS_RUNNING") status = "DISMISSED"; if (uncertain) expect(status).toBe("SENDING"); }),
  };
  const generate = vi.fn(async (input: ClaudeInitialLeadInput) => ({ kind: "initial_lead" as const, requestId: input.requestId, sessionId: input.sessionId, customerPhone: input.customerPhone,
    contextHash: "a".repeat(64), replyText: "Hey Jane! 👋\n\nExact approved generated response.", mode: "review_only" as const,
    smsSent: false as const, actionsExecuted: false as const, agentId: "existing-agent", agentSessionId: "existing-session" }));
  const send = vi.fn(async (input: { to: string; content: string; fromNumberId: string }) => { expect(status).toBe("SENDING"); expect(text).toBe(input.content); return { success: true, messageId: "provider-1" }; });
  const deps = { config: () => config, store, generate, send };
  return { capture, store, generate, send, deps, run: createClaudeThumbtackFirstResponseService(deps), status: () => status, dismiss: () => { status = "DISMISSED"; } };
}
describe("native Thumbtack first-response offline", () => {
  it("requires all explicit fixed activation fields; no permissive booleans/dates", () => {
    for (const patch of [{ THUMBTACK_CLAUDE_FIRST_RESPONSE_ENABLED: undefined }, { THUMBTACK_CLAUDE_FIRST_RESPONSE_ENABLED: "TRUE" },
      { THUMBTACK_CLAUDE_FIRST_RESPONSE_START_AT: "now" }, { THUMBTACK_CLAUDE_FIRST_RESPONSE_START_AT: "2026-02-30T00:00:00Z" },
      { THUMBTACK_CLAUDE_FIRST_RESPONSE_START_AT: "2026-11-16" }, { OPENPHONE_PHONE_NUMBER_ID: " " }]) expect(thumbtackFirstResponseConfig({ ...env, ...patch })).toBeNull();
  });
  it("disabled does not load storage/generate/send", async () => {
    const h = harness(); await createClaudeThumbtackFirstResponseService({ ...h.deps, config: () => null })(7);
    expect(h.store.loadCapture).not.toHaveBeenCalled(); expect(h.generate).not.toHaveBeenCalled(); expect(h.send).not.toHaveBeenCalled();
  });
  it("preserves old-capture, wrong-event, missing-identity and replay protections", () => {
    const c = fixture();
    for (const patch of [{ source: "email" }, { eventType: "MessageCreatedV4" }, { earliestId: 1 }, { earliestReceivedAt: new Date("2026-11-15T17:00:00Z") },
      { receivedAt: new Date("2026-11-15T17:00:00Z") }]) expect(eligibleThumbtackLead({ ...c, ...patch }, config)).toBeNull();
    const p = JSON.parse(c.rawPayload); delete p.data.negotiationID; expect(eligibleThumbtackLead({ ...c, rawPayload: JSON.stringify(p) }, config)).toBeNull();
  });
  it.each([undefined, null, "invalid", "2026-02-30T17:00:01Z", "2026-11-15T17:00:01Z", "2026-11-17T17:00:01Z"])("native timestamp %s never prevents the first introduction", async value => {
    for (const field of ["createdAt", "triggeredAt"]) {
      const h = harness(), payload = JSON.parse(h.capture.rawPayload);
      (field === "createdAt" ? payload.data : payload.event)[field] = value;
      h.capture.rawPayload = JSON.stringify(payload);
      expect(eligibleThumbtackLead(h.capture, config)).toMatchObject({ sendEligible: true });
      await h.run(7); await h.run(7);
      expect(h.generate).toHaveBeenCalledOnce(); expect(h.send).toHaveBeenCalledOnce();
      expect(h.store.blocked).not.toHaveBeenCalled(); expect(h.status()).toBe("SENT");
    }
  });
  it("both native dates may be absent; old retained captures and replay remain excluded", async () => {
    const current = harness(), payload = JSON.parse(current.capture.rawPayload);
    delete payload.data.createdAt; delete payload.event.triggeredAt; current.capture.rawPayload = JSON.stringify(payload);
    await current.run(7); expect(current.generate).toHaveBeenCalledOnce(); expect(current.send).toHaveBeenCalledOnce();
    for (const patch of [{ earliestId: 1 }, { earliestReceivedAt: new Date("2026-11-15T17:00:00Z") }, { receivedAt: new Date("2026-11-15T17:00:00Z") }]) {
      const h = harness(); Object.assign(h.capture, patch); await h.run(7);
      expect(h.store.claim).not.toHaveBeenCalled(); expect(h.generate).not.toHaveBeenCalled(); expect(h.send).not.toHaveBeenCalled();
    }
  });
  it("missing customer phone keeps intake but cannot submit a placeholder recipient", async () => {
    const h = harness(), payload = JSON.parse(h.capture.rawPayload); delete payload.data.customer.phone; h.capture.rawPayload = JSON.stringify(payload);
    await h.run(7); expect(h.store.claim).toHaveBeenCalledWith(expect.objectContaining({ phone: null }), config);
    expect(h.status()).toBe("DISMISSED"); expect(h.generate).not.toHaveBeenCalled(); expect(h.send).not.toHaveBeenCalled();
  });
  it("dedup key does not depend on phone/name/webhookID and preserves original payload", () => {
    const c = fixture(), original = c.rawPayload, lead = eligibleThumbtackLead(c, config)!;
    const p = JSON.parse(original); p.event.webhookID = "delivery-2"; p.data.customer.phone = "+12025559876"; p.data.customer.firstName = "Other";
    expect(eligibleThumbtackLead({ ...c, rawPayload: JSON.stringify(p) }, config)!.key).toBe(lead.key);
    expect(lead.key).toBe(thumbtackFirstResponseKey("neg-1")); expect(c.rawPayload).toBe(original);
  });
  it("uses exact native facts/extras and unchanged four-field request; sends exact text with explicit line once", async () => {
    const h = harness(); await h.run(7); await h.run(7);
    expect(h.send).toHaveBeenCalledTimes(1); const input = h.generate.mock.calls[0][0], context = buildThumbtackLeadDraftContext(input.leadDetails);
    expect(input.originalConversation).toEqual([]); expect(input.sessionId).toBe(11);
    expect(input.leadDetails.extras).toEqual(["Fridge, oven", "Inside cabinets"]); expect(input.leadDetails.propertyType).toBeNull();
    expect(input.draftRequest).toEqual({ conversationContext: "", customerName: "Jane Native", jobContext: context,
      scenario: `${THUMBTACK_FIRST_RESPONSE_PROMPT}\n\nThumbtack lead:\n${context}` });
    expect(h.send).toHaveBeenCalledWith({ to: "+17035551234", content: "Hey Jane! 👋\n\nExact approved generated response.", fromNumberId: "PN-lead" });
    expect(h.store.accepted).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 11 }), expect.objectContaining({ replyText: h.send.mock.calls[0][0].content }), "provider-1");
  });
  it("concurrent workers cannot generate twice on the same durable claim", async () => {
    const h = harness(); await Promise.all([h.run(7), h.run(7)]); expect(h.generate).toHaveBeenCalledTimes(1); expect(h.send).toHaveBeenCalledTimes(1);
  });
  it("preserves real opt-out/binding checks and explicit draft dismissal before send", async () => {
    const h = harness(); vi.mocked(h.store.fresh).mockResolvedValue(false); await h.run(7); expect(h.generate).not.toHaveBeenCalled(); expect(h.send).not.toHaveBeenCalled();
    const late = harness(); late.generate.mockImplementation(async input => { late.dismiss(); return { ...await h.deps.generate(input), requestId: input.requestId }; });
    await late.run(7); expect(late.send).not.toHaveBeenCalled(); expect(late.status()).toBe("DISMISSED");
  });
  it.each(["missingId", "unsuccessful", "timeout", "postsend-save", "restart"])("blocks uncertain %s forever without retry", async failure => {
    const h = harness();
    if (failure === "missingId") h.send.mockResolvedValue({ success: true, messageId: "" });
    if (failure === "unsuccessful") h.send.mockResolvedValue({ success: false, messageId: "" });
    if (failure === "timeout") h.send.mockRejectedValue(new Error("timeout"));
    if (failure === "postsend-save") vi.mocked(h.store.accepted).mockRejectedValue(new Error("db unavailable"));
    if (failure === "restart") vi.mocked(h.store.accepted).mockImplementation(async () => { throw new Error("crash"); });
    await h.run(7); await h.run(7); expect(h.send).toHaveBeenCalledTimes(1); expect(h.status()).toBe("SENDING");
  });
  it("generation/binding/save failure never dispatches or releases its claim", async () => {
    const h = harness(); h.generate.mockRejectedValue(new Error("invalid")); await h.run(7); await h.run(7); expect(h.send).not.toHaveBeenCalled();
    const b = harness(), originalGenerate = b.generate.getMockImplementation()!;
    b.generate.mockImplementation(async input => ({ ...await originalGenerate(input), sessionId: 999 }));
    await b.run(7); expect(b.send).not.toHaveBeenCalled();
    const s = harness(); vi.mocked(s.store.beginSend).mockRejectedValue(new Error("save failed")); await s.run(7); expect(s.send).not.toHaveBeenCalled();
  });
  it("application adds no staff SMS, notification or unrelated activity side effects", () => {
    const source = readFileSync("server/instinct/claudeThumbtackFirstResponseApplication.ts", "utf8");
    expect(source).not.toMatch(/notifyOwner|notifyNativeLeadStaff|logActivity|sendSms\s*\(/);
    expect(source).toContain("generate: generateClaudeInitialLeadContent, send: sendSms");
  });
  it("legacy sequence files are byte-equivalent baseline and no new forbidden dependencies exist", () => {
    for (const [file, expected] of Object.entries({"server/emailLeadWebhook.ts": "ee07dc2b13740de4ed34f16c359e2d9174a312d32d4983acab7b6a6cccb11296", "server/thumbtackWebhook.ts": "8cb96184f3dc98de9bcb4bcb2b0bcc3688fd51c6aba831110e0b6661aa4e1345"})) {
      expect(createHash("sha256").update(readFileSync(file)).digest("hex")).toBe(expected);
    }
    for (const file of ["server/instinct/claudeThumbtackFirstResponse.ts", "server/instinct/claudeThumbtackFirstResponseStore.ts", "server/instinct/claudeThumbtackFirstResponseApplication.ts", "shared/thumbtackNativeLead.ts"])
      expect(readFileSync(file, "utf8")).not.toMatch(new RegExp(["cleaner" + "_jobs", "cleaner" + "Jobs", "CREATE TABLE", "ALTER TABLE", "DRAFT_READY", 'status: "FAILED"', "setTimeout", "setInterval", "invokeLLM", "generateClaudeInitialLead\\("].join("|")));
  });
});

describe("native first response composed with actual content recovery, no network", () => {
  let network: ReturnType<typeof vi.spyOn>;
  beforeEach(() => { network = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("OFFLINE_ONLY")); });
  afterEach(() => { expect(network).not.toHaveBeenCalled(); vi.restoreAllMocks(); });
  const output = { finalSmsText: "Hey Jane! Exact original native response.", agentId: "synthetic-agent", sessionId: "synthetic-agent-session" };
  function contentHarness() {
    const h = harness(); let optedOut = false;
    const currentConfig = vi.fn<() => typeof config | null>(() => ({ ...config }));
    const prepareMessages = vi.fn<NonNullable<ClaudeInitialLeadContentOptions["prepareMessages"]>>(async request => [
      { role: "system", content: "Complete synthetic approved initial-response instructions." },
      { role: "user", content: JSON.stringify(request) },
    ]);
    const runner = vi.fn<InitialLeadRunner>(async () => output);
    const generate = vi.fn((input: ClaudeInitialLeadInput) => generateClaudeInitialLeadContent(input, { prepareMessages, runner }));
    const beginSend = h.store.beginSend;
    h.store.beginSend = vi.fn(async (...args: Parameters<FirstResponseStore["beginSend"]>) =>
      !optedOut && await beginSend(...args));
    return { ...h, prepareMessages, runner, generate, currentConfig, optOut: () => { optedOut = true; },
      run: createClaudeThumbtackFirstResponseService({ ...h.deps, config: currentConfig, generate }) };
  }
  it.each(["provider", "blank", "result-schema"])("recovers %s content failure once under one original UUID, claim and send", async failure => {
    const h = contentHarness(), originalPayload = h.capture.rawPayload;
    if (failure === "provider") h.runner.mockRejectedValueOnce(new Error("Synthetic provider unavailable"));
    if (failure === "blank") h.runner.mockResolvedValueOnce({ ...output, finalSmsText: " " });
    if (failure === "result-schema") h.runner.mockResolvedValueOnce({ ...output, agentId: "" });
    await h.run(7);
    expect(h.runner).toHaveBeenCalledTimes(2); expect(h.generate).toHaveBeenCalledTimes(1);
    expect(h.prepareMessages).toHaveBeenCalledTimes(1);
    const first = h.runner.mock.calls[0][0], second = h.runner.mock.calls[1][0];
    expect(second).toBe(first); expect(second).toEqual(first);
    const request = h.generate.mock.calls[0][0];
    expect(request.requestId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(request).toMatchObject({ sessionId: 11, customerPhone: "+17035551234", originalConversation: [] });
    expect(h.prepareMessages).toHaveBeenCalledWith(request.draftRequest);
    expect(JSON.parse(second.userPrompt)).toEqual(request.draftRequest);
    expect(h.capture.rawPayload).toBe(originalPayload);
    expect(h.store.claim).toHaveBeenCalledTimes(1);
    expect((await Promise.all(vi.mocked(h.store.claim).mock.results.map(result => result.value))).filter(Boolean)).toHaveLength(1);
    expect(h.store.beginSend).toHaveBeenCalledTimes(1); expect(h.send).toHaveBeenCalledTimes(1); expect(h.store.accepted).toHaveBeenCalledTimes(1);
    const claim = vi.mocked(h.store.beginSend).mock.calls[0][0], result = vi.mocked(h.store.beginSend).mock.calls[0][1];
    expect(result).toMatchObject({ requestId: request.requestId, sessionId: request.sessionId, customerPhone: request.customerPhone,
      replyText: output.finalSmsText, mode: "review_only", smsSent: false, actionsExecuted: false });
    expect(h.send).toHaveBeenCalledWith({ to: request.customerPhone, content: output.finalSmsText, fromNumberId: "PN-lead" });
    expect(h.store.accepted).toHaveBeenCalledWith(claim, result, "provider-1"); expect(h.store.blocked).not.toHaveBeenCalled();
  });
  it("exhausts two content failures without beginning send or releasing the original claim", async () => {
    const h = contentHarness(); h.runner.mockRejectedValue(new Error("Synthetic provider unavailable"));
    await h.run(7); await h.run(7);
    expect(h.runner).toHaveBeenCalledTimes(2); expect(h.generate).toHaveBeenCalledTimes(1); expect(h.prepareMessages).toHaveBeenCalledTimes(1);
    expect(h.store.beginSend).not.toHaveBeenCalled(); expect(h.send).not.toHaveBeenCalled(); expect(h.store.accepted).not.toHaveBeenCalled();
    expect(h.store.blocked).toHaveBeenCalledWith(expect.anything(), "GENERATION_OR_SAVE_FAILED", false); expect(h.status()).toBe("DISMISSED");
  });
  it("keeps concurrent duplicates to one successful claim and one recovered response", async () => {
    const h = contentHarness(); h.runner.mockRejectedValueOnce(new Error("Synthetic provider unavailable"));
    await Promise.all([h.run(7), h.run(7)]);
    expect(h.store.claim).toHaveBeenCalledTimes(2);
    expect((await Promise.all(vi.mocked(h.store.claim).mock.results.map(result => result.value))).filter(Boolean)).toHaveLength(1);
    expect(h.generate).toHaveBeenCalledTimes(1); expect(h.prepareMessages).toHaveBeenCalledTimes(1); expect(h.runner).toHaveBeenCalledTimes(2);
    expect(h.store.beginSend).toHaveBeenCalledTimes(1); expect(h.send).toHaveBeenCalledTimes(1); expect(h.store.accepted).toHaveBeenCalledTimes(1);
  });
  it.each(["opt-out", "dismissal", "config-change"])("preserves the unchanged dispatcher/store %s stop during recovery", async guard => {
    const h = contentHarness(); h.runner.mockRejectedValueOnce(new Error("Synthetic provider unavailable"));
    h.runner.mockImplementationOnce(async () => {
      if (guard === "opt-out") h.optOut();
      if (guard === "dismissal") h.dismiss();
      if (guard === "config-change") h.currentConfig.mockReturnValue({ ...config, fromNumberId: "PN-changed" });
      return output;
    });
    await h.run(7);
    expect(h.runner).toHaveBeenCalledTimes(2); expect(h.generate).toHaveBeenCalledTimes(1); expect(h.prepareMessages).toHaveBeenCalledTimes(1);
    expect(h.store.beginSend).toHaveBeenCalledTimes(guard === "config-change" ? 0 : 1);
    expect(h.send).not.toHaveBeenCalled(); expect(h.store.accepted).not.toHaveBeenCalled();
    expect(h.store.blocked).toHaveBeenCalledWith(expect.anything(), "SUPPRESSED_BEFORE_SEND", false);
  });
  it.each(["preparation", "submission", "acceptance"])("never regenerates or retries %s after recovered content", async phase => {
    const h = contentHarness(); h.runner.mockRejectedValueOnce(new Error("Synthetic provider unavailable"));
    if (phase === "preparation") vi.mocked(h.store.beginSend).mockRejectedValue(new Error("Synthetic durable preparation failure"));
    if (phase === "submission") h.send.mockRejectedValue(new Error("Synthetic transport uncertainty"));
    if (phase === "acceptance") vi.mocked(h.store.accepted).mockRejectedValue(new Error("Synthetic acceptance save uncertainty"));
    await h.run(7); await h.run(7);
    expect(h.generate).toHaveBeenCalledTimes(1); expect(h.runner).toHaveBeenCalledTimes(2); expect(h.prepareMessages).toHaveBeenCalledTimes(1);
    expect(h.store.beginSend).toHaveBeenCalledTimes(1); expect(h.send).toHaveBeenCalledTimes(phase === "preparation" ? 0 : 1);
    expect(h.store.accepted).toHaveBeenCalledTimes(phase === "acceptance" ? 1 : 0);
    expect(h.status()).toBe(phase === "preparation" ? "DISMISSED" : "SENDING");
  });
});
