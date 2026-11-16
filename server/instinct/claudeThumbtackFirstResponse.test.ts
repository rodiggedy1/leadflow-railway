import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { capturedThumbtackLead, eligibleThumbtackLead, thumbtackFirstResponseConfig, thumbtackFirstResponseKey, createClaudeThumbtackFirstResponseService,
  type CapturedLead, type FirstResponseStore, type FirstResponseClaim } from "./claudeThumbtackFirstResponse";
import { THUMBTACK_FIRST_RESPONSE_PROMPT, buildThumbtackLeadDraftContext, type ClaudeInitialLeadInput } from "../../shared/claudeInitialLead";
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
  it("excludes old captured/new delivery, old native creation/trigger, wrong event, missing identity and replay delivery", () => {
    const c = fixture();
    for (const patch of [{ source: "email" }, { eventType: "MessageCreatedV4" }, { earliestId: 1 }, { earliestReceivedAt: new Date("2026-11-15T17:00:00Z") },
      { receivedAt: new Date("2026-11-15T17:00:00Z") }]) expect(eligibleThumbtackLead({ ...c, ...patch }, config)).toBeNull();
    for (const field of ["createdAt", "triggeredAt"]) {
      const p = JSON.parse(c.rawPayload); (field === "createdAt" ? p.data : p.event)[field] = "2026-11-15T00:00:00Z";
      expect(eligibleThumbtackLead({ ...c, rawPayload: JSON.stringify(p) }, config)).toBeNull();
    }
    const p = JSON.parse(c.rawPayload); delete p.data.negotiationID; expect(eligibleThumbtackLead({ ...c, rawPayload: JSON.stringify(p) }, config)).toBeNull();
  });
  it.each([undefined, "invalid", "2026-02-30T17:00:01Z", "2026-11-15T17:00:01Z", "2026-11-17T17:00:01Z"])("keeps first-capture intake with creation %s but never generates/sends, even after date-corrected replay", async createdAt => {
    const h = harness(), payload = JSON.parse(h.capture.rawPayload);
    payload.data.createdAt = createdAt; h.capture.rawPayload = JSON.stringify(payload);
    const intake = capturedThumbtackLead(h.capture, config)!;
    expect(intake.sendEligible).toBe(false); expect(intake.createdAt).toBe(h.capture.receivedAt.getTime());
    expect(eligibleThumbtackLead(h.capture, config)).toBeNull();
    await h.run(7);
    expect(h.store.claim).toHaveBeenCalledWith(expect.objectContaining({ sendEligible: false }), config);
    expect(h.status()).toBe("DISMISSED");
    expect(h.store.blocked).toHaveBeenCalledWith(expect.anything(), "SUPPRESSED_NATIVE_DATES", false);
    payload.data.createdAt = "2026-11-16T17:00:01Z"; h.capture.rawPayload = JSON.stringify(payload);
    await h.run(7); expect(h.generate).not.toHaveBeenCalled(); expect(h.send).not.toHaveBeenCalled();
  });
  it("missing/invalid trigger keeps intake; old retention/replay never creates intake or sends", async () => {
    for (const triggeredAt of [undefined, "invalid", "2026-11-15T17:00:02Z"]) {
      const h = harness(), payload = JSON.parse(h.capture.rawPayload); payload.event.triggeredAt = triggeredAt; h.capture.rawPayload = JSON.stringify(payload);
      await h.run(7); expect(h.store.claim).toHaveBeenCalledOnce();
      expect(h.status()).toBe("DISMISSED"); expect(h.generate).not.toHaveBeenCalled(); expect(h.send).not.toHaveBeenCalled();
    }
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
  it("suppresses observed optout/staff/customer activity before model and fresh activity/dismissal before send", async () => {
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
    for (const file of ["server/emailLeadWebhook.ts", "server/thumbtackWebhook.ts"]) expect(readFileSync(file, "utf8"))
      .toBe(execFileSync("git", ["show", `fe1f39700bc537b72c34ec1742ed4bf4c20042ef:${file}`], { encoding: "utf8" }));
    for (const file of ["server/instinct/claudeThumbtackFirstResponse.ts", "server/instinct/claudeThumbtackFirstResponseStore.ts", "server/instinct/claudeThumbtackFirstResponseApplication.ts", "shared/thumbtackNativeLead.ts"])
      expect(readFileSync(file, "utf8")).not.toMatch(new RegExp(["cleaner" + "_jobs", "cleaner" + "Jobs", "CREATE TABLE", "ALTER TABLE", "DRAFT_READY", 'status: "FAILED"', "setTimeout", "setInterval", "invokeLLM", "generateClaudeInitialLead\\("].join("|")));
  });
});
