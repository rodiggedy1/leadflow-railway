import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { capturedThumbtackLead, eligibleThumbtackLead, thumbtackFirstResponseConfig, thumbtackFirstResponseKey, createClaudeThumbtackFirstResponseService,
  type CapturedLead, type FirstResponseStore, type FirstResponseClaim } from "./claudeThumbtackFirstResponse";
import { THUMBTACK_FIRST_RESPONSE_PROMPT, buildThumbtackLeadDraftContext, type ClaudeInitialLeadInput } from "../../shared/claudeInitialLead";
const env = { THUMBTACK_CLAUDE_FIRST_RESPONSE_ENABLED: "true", THUMBTACK_CLAUDE_FIRST_RESPONSE_START_AT: "2026-11-16T17:00:00Z", OPENPHONE_PHONE_NUMBER_ID: "PN-lead" };
const config = thumbtackFirstResponseConfig(env)!;
export function fixture(): CapturedLead {
  return { id: 7, source: "thumbtack", eventType: "NegotiationCreatedV4", receivedAt: new Date("2026-11-16T17:01:00Z"),
    rawPayload: JSON.stringify({ event: { eventType: "NegotiationCreatedV4", webhookID: "delivery-1", triggeredAt: "2026-11-16T17:00:02Z" },
      data: { negotiationID: "neg-1", createdAt: "2026-11-16T17:00:01Z", customer: { firstName: "Jane", lastName: "Native", phone: "+17035551234" },
        request: { category: { name: "Deep Cleaning" }, description: "Skip office", location: { city: "Alexandria", state: "VA" },
          details: [{ question: "Home size", answer: "2 bedrooms and 2 bathrooms" }, { question: "Extra requests", answer: "Fridge, oven" }, { question: "Anything else", answer: "Inside cabinets" }] } } }) };
}
function harness() {
  const capture = fixture();
  const claims: FirstResponseClaim[] = [], states = new Map<number, { status: string; text: string }>();
  let latest = 0;
  const state = (claim: FirstResponseClaim) => states.get(claim.draftId)!;
  const store: FirstResponseStore = {
    loadCapture: vi.fn(async () => capture),
    claim: vi.fn(async (lead, cfg) => {
      if (claims.some(claim => claim.lead.key === lead.key)) return null;
      const n = claims.length, claim = { draftId: 2 + n, sessionId: 11 + n, cardId: 13 + n, lead, fromNumberId: cfg.fromNumberId };
      latest = claim.draftId; states.set(latest, { status: "TOOLS_RUNNING", text: "" }); claims.push(claim); return claim;
    }),
    fresh: vi.fn(async claim => state(claim).status === "TOOLS_RUNNING"),
    beginSend: vi.fn(async (claim, result) => { const s = state(claim); if (s.status !== "TOOLS_RUNNING") return false; s.text = result.replyText; s.status = "SENDING"; return true; }),
    accepted: vi.fn(async claim => { state(claim).status = "SENT"; }),
    blocked: vi.fn(async (claim, _, uncertain) => { const s = state(claim); if (s.status === "TOOLS_RUNNING") s.status = "DISMISSED"; if (uncertain) expect(s.status).toBe("SENDING"); }),
  };
  const generate = vi.fn(async (input: ClaudeInitialLeadInput) => ({ kind: "initial_lead" as const, requestId: input.requestId, sessionId: input.sessionId, customerPhone: input.customerPhone,
    contextHash: "a".repeat(64), replyText: "Hey Jane! 👋\n\nExact approved generated response.", mode: "review_only" as const,
    smsSent: false as const, actionsExecuted: false as const, agentId: "existing-agent", agentSessionId: "existing-session" }));
  const send = vi.fn(async (input: { to: string; content: string; fromNumberId: string }) => {
    expect([...states.values()].some(s => s.status === "SENDING" && s.text === input.content)).toBe(true);
    return { success: true, messageId: "provider-1" };
  });
  const deps = { config: () => config, store, generate, send };
  return { capture, store, claims, generate, send, deps, run: createClaudeThumbtackFirstResponseService(deps),
    status: () => states.get(latest)?.status, dismiss: () => { states.get(latest)!.status = "DISMISSED"; } };
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
  it("retains source/event/activation/native-date/identity validation without earliest-capture rejection", () => {
    const c = fixture();
    for (const patch of [{ source: "email" }, { eventType: "MessageCreatedV4" }, { receivedAt: new Date("2026-11-15T17:00:00Z") }])
      expect(eligibleThumbtackLead({ ...c, ...patch }, config)).toBeNull();
    expect(eligibleThumbtackLead({ ...c, id: 8 }, config)).not.toBeNull();
    for (const field of ["createdAt", "triggeredAt"]) {
      const p = JSON.parse(c.rawPayload); (field === "createdAt" ? p.data : p.event)[field] = "2026-11-15T00:00:00Z";
      expect(eligibleThumbtackLead({ ...c, rawPayload: JSON.stringify(p) }, config)).toBeNull();
    }
    const p = JSON.parse(c.rawPayload); delete p.data.negotiationID; expect(eligibleThumbtackLead({ ...c, rawPayload: JSON.stringify(p) }, config)).toBeNull();
  });
  it.each([
    ["createdAt", "2026-11-16T17:01:00.001Z"], ["createdAt", "2026-11-16T17:01:00.500Z"], ["createdAt", "2026-11-16T17:01:00.999Z"],
    ["triggeredAt", "2026-11-16T17:01:00.001Z"], ["triggeredAt", "2026-11-16T17:01:00.500Z"], ["triggeredAt", "2026-11-16T17:01:00.999Z"],
  ])("same-second fractional %s=%s is eligible despite whole-second capture storage", (field, value) => {
    const capture = fixture(), payload = JSON.parse(capture.rawPayload);
    (field === "createdAt" ? payload.data : payload.event)[field] = value; capture.rawPayload = JSON.stringify(payload);
    const lead = capturedThumbtackLead(capture, config)!;
    expect(lead.sendEligible).toBe(true); expect(eligibleThumbtackLead(capture, config)).not.toBeNull();
    expect(lead.createdAt).toBe(Date.parse(payload.data.createdAt));
  });
  it.each(["createdAt", "triggeredAt"])("a %s in the next second remains future-dated", field => {
    const capture = fixture(), payload = JSON.parse(capture.rawPayload);
    (field === "createdAt" ? payload.data : payload.event)[field] = "2026-11-16T17:01:01.000Z";
    capture.rawPayload = JSON.stringify(payload); expect(capturedThumbtackLead(capture, config)!.sendEligible).toBe(false);
  });
  it.each(["createdAt", "triggeredAt"])("%s before a fractional activation cutoff stays ineligible at millisecond precision", field => {
    const capture = fixture(), payload = JSON.parse(capture.rawPayload), cfg = { ...config, startAt: Date.parse("2026-11-16T17:00:00.500Z") };
    payload.data.createdAt = "2026-11-16T17:00:00.500Z"; payload.event.triggeredAt = "2026-11-16T17:00:00.750Z";
    capture.rawPayload = JSON.stringify(payload); expect(capturedThumbtackLead(capture, cfg)!.sendEligible).toBe(true);
    (field === "createdAt" ? payload.data : payload.event)[field] = "2026-11-16T17:00:00.499Z";
    capture.rawPayload = JSON.stringify(payload); expect(capturedThumbtackLead(capture, cfg)!.sendEligible).toBe(false);
  });
  it("the exact fractional-trigger failure now introduces once on the first capture, not a later delivery", async () => {
    const h = harness(), payload = JSON.parse(h.capture.rawPayload);
    payload.data.createdAt = "2026-11-21T22:00:01.000Z"; payload.event.triggeredAt = "2026-11-21T22:00:02.500Z";
    h.capture.receivedAt = new Date("2026-11-21T22:00:02.000Z"); h.capture.rawPayload = JSON.stringify(payload);
    await h.run(7); expect(h.generate).toHaveBeenCalledOnce(); expect(h.send).toHaveBeenCalledOnce(); expect(h.status()).toBe("SENT");
    expect(h.store.blocked).not.toHaveBeenCalled();
    h.capture.id = 8; h.capture.receivedAt = new Date("2026-11-21T22:00:03.000Z"); await h.run(8);
    expect(h.generate).toHaveBeenCalledOnce(); expect(h.send).toHaveBeenCalledOnce(); expect(h.claims).toHaveLength(1);
  });
  it.each([undefined, "invalid", "2026-02-30T17:00:01Z", "2026-11-15T17:00:01Z", "2026-11-17T17:00:01Z"])("retains native-date policy for %s and does not restart the same phone's introduction", async createdAt => {
    const h = harness(), payload = JSON.parse(h.capture.rawPayload);
    payload.data.createdAt = createdAt; h.capture.rawPayload = JSON.stringify(payload);
    const intake = capturedThumbtackLead(h.capture, config)!;
    expect(intake.sendEligible).toBe(false); expect(intake.createdAt).toBe(h.capture.receivedAt.getTime());
    await h.run(7); expect(h.status()).toBe("DISMISSED");
    expect(h.store.blocked).toHaveBeenCalledWith(expect.anything(), "SUPPRESSED_NATIVE_DATES", false);
    expect(h.generate).not.toHaveBeenCalled(); expect(h.send).not.toHaveBeenCalled();
    payload.data.createdAt = "2026-11-16T17:00:01Z"; h.capture.rawPayload = JSON.stringify(payload);
    await h.run(7); expect(h.generate).not.toHaveBeenCalled(); expect(h.send).not.toHaveBeenCalled(); expect(h.claims).toHaveLength(1);
  });
  it("missing/invalid trigger still prevents generation; older retained capture cannot send", async () => {
    for (const triggeredAt of [undefined, "invalid", "2026-11-15T17:00:02Z"]) {
      const h = harness(), payload = JSON.parse(h.capture.rawPayload); payload.event.triggeredAt = triggeredAt; h.capture.rawPayload = JSON.stringify(payload);
      await h.run(7); expect(h.store.claim).toHaveBeenCalledOnce(); expect(h.status()).toBe("DISMISSED");
      expect(h.generate).not.toHaveBeenCalled(); expect(h.send).not.toHaveBeenCalled();
    }
    const old = harness(); old.capture.receivedAt = new Date("2026-11-15T17:00:00Z"); await old.run(7);
    expect(old.store.claim).not.toHaveBeenCalled(); expect(old.send).not.toHaveBeenCalled();
  });
  it.each([undefined, "invalid", "+442071234567"])("missing/invalid phone %s retains a per-capture no-send identity, not a valid phone slot", async phone => {
    const h = harness(), payload = JSON.parse(h.capture.rawPayload); payload.data.customer.phone = phone; h.capture.rawPayload = JSON.stringify(payload);
    const first = capturedThumbtackLead(h.capture, config)!;
    expect(first.key).toBe("tt-first:v1:no-phone:7"); expect(capturedThumbtackLead(h.capture, config)!.key).toBe(first.key);
    expect(capturedThumbtackLead({ ...h.capture, id: 8 }, config)!.key).toBe("tt-first:v1:no-phone:8");
    await h.run(7); expect(h.store.claim).toHaveBeenCalledWith(expect.objectContaining({ phone: null }), config);
    expect(h.status()).toBe("DISMISSED"); expect(h.generate).not.toHaveBeenCalled(); expect(h.send).not.toHaveBeenCalled();
  });
  it("phone identity normalizes punctuation/country code, ignores event identity, and preserves the payload", () => {
    const c = fixture(), original = c.rawPayload, a = eligibleThumbtackLead(c, config)!, b = eligibleThumbtackLead(c, config)!;
    expect(a.key).toMatch(/^tt-first:v1:[a-f0-9]{64}$/); expect(b.key).toBe(a.key);
    for (const phone of ["7035551234", "(703) 555-1234", "1-703-555-1234", "+17035551234"]) expect(thumbtackFirstResponseKey(phone)).toBe(a.key);
    expect(thumbtackFirstResponseKey("+12025559876")).not.toBe(a.key);
    const p = JSON.parse(original); p.data.negotiationID = "other-negotiation"; p.event.webhookID = "other-webhook"; p.data.customer.firstName = "Changed";
    expect(eligibleThumbtackLead({ ...c, id: 8, rawPayload: JSON.stringify(p) }, config)!.key).toBe(a.key);
    expect(() => thumbtackFirstResponseKey("invalid")).toThrow("PHONE_INVALID");
    expect(c.rawPayload).toBe(original);
  });
  it("uses unchanged native facts/prompt/sending line and introduces the same phone only once", async () => {
    const h = harness(); await h.run(7); await h.run(7);
    expect(h.send).toHaveBeenCalledOnce(); expect(h.claims).toHaveLength(1);
    const input = h.generate.mock.calls[0][0], context = buildThumbtackLeadDraftContext(input.leadDetails);
    expect(input.originalConversation).toEqual([]); expect(input.sessionId).toBe(11);
    expect(input.leadDetails.extras).toEqual(["Fridge, oven", "Inside cabinets"]); expect(input.leadDetails.propertyType).toBeNull();
    expect(input.draftRequest).toEqual({ conversationContext: "", customerName: "Jane Native", jobContext: context,
      scenario: `${THUMBTACK_FIRST_RESPONSE_PROMPT}\n\nThumbtack lead:\n${context}` });
    expect(h.send).toHaveBeenCalledWith({ to: "+17035551234", content: "Hey Jane! 👋\n\nExact approved generated response.", fromNumberId: "PN-lead" });
    expect(h.store.accepted).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 11 }), expect.objectContaining({ replyText: h.send.mock.calls[0][0].content }), "provider-1");
  });
  it("concurrent arrivals for one phone create only one introduction", async () => {
    const h = harness(); await Promise.all([h.run(7), h.run(7)]);
    expect(h.generate).toHaveBeenCalledOnce(); expect(h.send).toHaveBeenCalledOnce(); expect(h.claims).toHaveLength(1);
  });
  it("different negotiations and formatted copies of the same phone cannot restart an introduction", async () => {
    const h = harness(); await h.run(7); const p = JSON.parse(h.capture.rawPayload);
    p.data.negotiationID = "neg-2"; p.data.customer.phone = "(703) 555-1234"; h.capture.id = 8; h.capture.rawPayload = JSON.stringify(p);
    await h.run(8); expect(h.send).toHaveBeenCalledOnce(); expect(h.claims).toHaveLength(1);
  });
  it("distinct phones each receive an introduction despite identical webhook and negotiation IDs", async () => {
    const h = harness(); await h.run(7); const p = JSON.parse(h.capture.rawPayload);
    p.data.customer.phone = "+12025559876"; h.capture.id = 8; h.capture.rawPayload = JSON.stringify(p); await h.run(8);
    expect(h.send).toHaveBeenCalledTimes(2); expect(h.claims[0].lead.key).not.toBe(h.claims[1].lead.key);
    expect(h.send.mock.calls.map(([input]) => input.to)).toEqual(["+17035551234", "+12025559876"]);
  });
  it("later native messages do not invoke the introduction generator again", async () => {
    const h = harness(); await h.run(7); const p = JSON.parse(h.capture.rawPayload);
    p.event.eventType = "MessageCreatedV4"; h.capture.eventType = "MessageCreatedV4"; h.capture.rawPayload = JSON.stringify(p);
    await h.run(7); expect(h.generate).toHaveBeenCalledOnce(); expect(h.send).toHaveBeenCalledOnce();
  });
  it("retains consent and current-claim dismissal checks before model/send", async () => {
    const h = harness(); vi.mocked(h.store.fresh).mockResolvedValue(false); await h.run(7);
    expect(h.generate).not.toHaveBeenCalled(); expect(h.send).not.toHaveBeenCalled();
    const late = harness(); late.generate.mockImplementation(async input => { late.dismiss(); return { ...await h.deps.generate(input), requestId: input.requestId }; });
    await late.run(7); expect(late.send).not.toHaveBeenCalled(); expect(late.status()).toBe("DISMISSED");
  });
  it.each(["missingId", "unsuccessful", "timeout", "postsend-save", "restart"])("records uncertain %s and does not resubmit an introduction for the same phone", async failure => {
    const h = harness();
    if (failure === "missingId") h.send.mockResolvedValue({ success: true, messageId: "" });
    if (failure === "unsuccessful") h.send.mockResolvedValue({ success: false, messageId: "" });
    if (failure === "timeout") h.send.mockRejectedValue(new Error("timeout"));
    if (["postsend-save", "restart"].includes(failure)) vi.mocked(h.store.accepted).mockRejectedValue(new Error("save failed"));
    await h.run(7); expect(h.status()).toBe("SENDING"); expect(h.send).toHaveBeenCalledOnce();
    await h.run(7); expect(h.send).toHaveBeenCalledOnce(); expect(h.status()).toBe("SENDING"); expect(h.claims).toHaveLength(1);
  });
  it("generation, binding and durable-save failures still prevent that attempt's submission", async () => {
    const h = harness(); h.generate.mockRejectedValue(new Error("invalid")); await h.run(7); await h.run(7);
    expect(h.claims).toHaveLength(1); expect(h.send).not.toHaveBeenCalled();
    const b = harness(), originalGenerate = b.generate.getMockImplementation()!;
    b.generate.mockImplementation(async input => ({ ...await originalGenerate(input), sessionId: 999 })); await b.run(7); expect(b.send).not.toHaveBeenCalled();
    const s = harness(); vi.mocked(s.store.beginSend).mockRejectedValue(new Error("save failed")); await s.run(7); expect(s.send).not.toHaveBeenCalled();
  });
  it("application adds no staff SMS, notification or unrelated activity side effects", () => {
    const source = readFileSync("server/instinct/claudeThumbtackFirstResponseApplication.ts", "utf8");
    expect(source).not.toMatch(/notifyOwner|notifyNativeLeadStaff|logActivity|sendSms\s*\(/);
    expect(source).toContain("generate: generateClaudeInitialLeadContent, send: sendSms");
  });
  it("legacy sequence files remain byte-equivalent and no forbidden dependencies were added", () => {
    for (const file of ["server/emailLeadWebhook.ts", "server/thumbtackWebhook.ts"]) expect(readFileSync(file, "utf8"))
      .toBe(execFileSync("git", ["show", `fe1f39700bc537b72c34ec1742ed4bf4c20042ef:${file}`], { encoding: "utf8" }));
    for (const file of ["server/instinct/claudeThumbtackFirstResponse.ts", "server/instinct/claudeThumbtackFirstResponseStore.ts", "server/instinct/claudeThumbtackFirstResponseApplication.ts", "shared/thumbtackNativeLead.ts"])
      expect(readFileSync(file, "utf8")).not.toMatch(new RegExp(["cleaner" + "_jobs", "cleaner" + "Jobs", "CREATE TABLE", "ALTER TABLE", "DRAFT_READY", 'status: "FAILED"', "setTimeout", "setInterval", "invokeLLM", "generateClaudeInitialLead\\("].join("|")));
  });
});
