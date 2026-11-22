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
      latest = claim.draftId; states.set(latest, { status: lead.phone ? "TOOLS_RUNNING" : "DISMISSED", text: "" }); claims.push(claim); return claim;
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
  const onFailure = vi.fn(async () => {});
  const deps = { config: () => config, store, generate, send, onFailure };
  return { capture, store, claims, generate, send, onFailure, deps, run: createClaudeThumbtackFirstResponseService(deps),
    status: () => states.get(latest)?.status, dismiss: () => { states.get(latest)!.status = "DISMISSED"; } };
}
describe("native Thumbtack new-card introduction offline", () => {
  it("keeps the explicit feature toggle and sender, not a rollout-date eligibility requirement", () => {
    for (const patch of [{ THUMBTACK_CLAUDE_FIRST_RESPONSE_ENABLED: undefined }, { THUMBTACK_CLAUDE_FIRST_RESPONSE_ENABLED: "TRUE" }, { OPENPHONE_PHONE_NUMBER_ID: " " }])
      expect(thumbtackFirstResponseConfig({ ...env, ...patch })).toBeNull();
    for (const value of [undefined, "now", "2026-02-30T00:00:00Z", "2026-11-16"]) {
      expect(thumbtackFirstResponseConfig({ ...env, THUMBTACK_CLAUDE_FIRST_RESPONSE_START_AT: value })).toEqual({ startAt: 0, fromNumberId: "PN-lead" });
    }
  });
  it("disabled does not load storage/generate/send", async () => {
    const h = harness(); await createClaudeThumbtackFirstResponseService({ ...h.deps, config: () => null })(7);
    expect(h.store.loadCapture).not.toHaveBeenCalled(); expect(h.generate).not.toHaveBeenCalled(); expect(h.send).not.toHaveBeenCalled();
  });
  it("processes only genuine native lead events and keeps their identity", () => {
    const c = fixture();
    for (const patch of [{ source: "email" }, { eventType: "MessageCreatedV4" }]) expect(eligibleThumbtackLead({ ...c, ...patch }, config)).toBeNull();
    const p = JSON.parse(c.rawPayload); delete p.data.negotiationID;
    expect(eligibleThumbtackLead({ ...c, rawPayload: JSON.stringify(p) }, config)).toBeNull();
  });
  it.each([undefined, "invalid", "2026-02-30T17:00:01Z", "2026-11-15T17:00:01Z", "2026-11-17T17:00:01Z", "2026-11-16T17:01:00.999Z"])
    ("a new card's phone gets the unchanged introduction despite native timestamp %s", async value => {
      const h = harness(), payload = JSON.parse(h.capture.rawPayload);
      payload.data.createdAt = value; payload.event.triggeredAt = value; h.capture.rawPayload = JSON.stringify(payload);
      expect(capturedThumbtackLead(h.capture, config)!.sendEligible).toBe(true);
      await h.run(7); await h.run(7);
      expect(h.generate).toHaveBeenCalledOnce(); expect(h.send).toHaveBeenCalledOnce(); expect(h.status()).toBe("SENT");
      expect(h.store.blocked).not.toHaveBeenCalled();
    });
  it("capture age and configured cutoff do not block an explicitly dispatched new lead card", async () => {
    const h = harness(); h.capture.receivedAt = new Date("2026-11-15T17:00:00Z"); await h.run(7);
    expect(h.send).toHaveBeenCalledOnce();
    const later = harness();
    await createClaudeThumbtackFirstResponseService({ ...later.deps, config: () => ({ ...config, startAt: Date.parse("2030-01-01T00:00:00Z") }) })(7);
    expect(later.send).toHaveBeenCalledOnce();
  });
  it.each([undefined, "invalid", "+442071234567"])("missing/invalid phone %s retains intake but cannot submit SMS", async phone => {
    const h = harness(), payload = JSON.parse(h.capture.rawPayload); payload.data.customer.phone = phone; h.capture.rawPayload = JSON.stringify(payload);
    const first = capturedThumbtackLead(h.capture, config)!;
    expect(first.key).toBe("tt-first:v1:no-phone:7"); expect(first.sendEligible).toBe(false);
    expect(capturedThumbtackLead({ ...h.capture, id: 8 }, config)!.key).toBe("tt-first:v1:no-phone:8");
    await h.run(7); expect(h.store.claim).toHaveBeenCalledWith(expect.objectContaining({ phone: null }), config);
    expect(h.status()).toBe("DISMISSED"); expect(h.generate).not.toHaveBeenCalled(); expect(h.send).not.toHaveBeenCalled();
  });
  it("new-card identity normalizes phone punctuation, ignores delivery IDs and preserves the payload", () => {
    const c = fixture(), original = c.rawPayload, lead = eligibleThumbtackLead(c, config)!;
    expect(lead.key).toMatch(/^tt-first:v1:[a-f0-9]{64}$/);
    for (const phone of ["7035551234", "(703) 555-1234", "1-703-555-1234", "+17035551234"]) {
      const p = JSON.parse(original); p.data.customer.phone = phone; p.event.webhookID = "other-delivery";
      expect(eligibleThumbtackLead({ ...c, id: 8, rawPayload: JSON.stringify(p) }, config)!.key).toBe(lead.key);
    }
    const p = JSON.parse(original); p.data.negotiationID = "new-card-negotiation";
    expect(eligibleThumbtackLead({ ...c, rawPayload: JSON.stringify(p) }, config)!.key).not.toBe(lead.key);
    expect(() => thumbtackFirstResponseKey("invalid")).toThrow("PHONE_INVALID");
    expect(c.rawPayload).toBe(original);
  });
  it("uses unchanged native facts, approved prompt, exact generated text and sending line", async () => {
    const h = harness(); await h.run(7); await h.run(7);
    const input = h.generate.mock.calls[0][0], context = buildThumbtackLeadDraftContext(input.leadDetails);
    expect(input.originalConversation).toEqual([]); expect(input.sessionId).toBe(11);
    expect(input.leadDetails.extras).toEqual(["Fridge, oven", "Inside cabinets"]); expect(input.leadDetails.propertyType).toBeNull();
    expect(input.draftRequest).toEqual({ conversationContext: "", customerName: "Jane Native", jobContext: context,
      scenario: `${THUMBTACK_FIRST_RESPONSE_PROMPT}\n\nThumbtack lead:\n${context}` });
    expect(h.send).toHaveBeenCalledOnce();
    expect(h.send).toHaveBeenCalledWith({ to: "+17035551234", content: "Hey Jane! 👋\n\nExact approved generated response.", fromNumberId: "PN-lead" });
    expect(h.store.accepted).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 11 }), expect.objectContaining({ replyText: h.send.mock.calls[0][0].content }), "provider-1");
  });
  it("concurrent deliveries creating the same card introduce it only once", async () => {
    const h = harness(); await Promise.all([h.run(7), h.run(7)]);
    expect(h.generate).toHaveBeenCalledOnce(); expect(h.send).toHaveBeenCalledOnce(); expect(h.claims).toHaveLength(1);
  });
  it("a distinct new lead card receives its introduction even when the phone appeared before", async () => {
    const h = harness(); await h.run(7); const p = JSON.parse(h.capture.rawPayload);
    p.data.negotiationID = "neg-2"; p.data.customer.phone = "(703) 555-1234"; h.capture.id = 8; h.capture.rawPayload = JSON.stringify(p);
    await h.run(8); await h.run(8);
    expect(h.send).toHaveBeenCalledTimes(2); expect(h.claims).toHaveLength(2);
    expect(h.send.mock.calls.map(([input]) => input.to)).toEqual(["+17035551234", "+17035551234"]);
  });
  it("distinct phones sharing negotiation/delivery identity each get their new-card introduction", async () => {
    const h = harness(); await h.run(7); const p = JSON.parse(h.capture.rawPayload);
    p.data.customer.phone = "+12025559876"; h.capture.id = 8; h.capture.rawPayload = JSON.stringify(p); await h.run(8);
    expect(h.send).toHaveBeenCalledTimes(2); expect(h.claims[0].lead.key).not.toBe(h.claims[1].lead.key);
    expect(h.send.mock.calls.map(([input]) => input.to)).toEqual(["+17035551234", "+12025559876"]);
  });
  it("later native messages do not create a lead-card introduction", async () => {
    const h = harness(); await h.run(7); const p = JSON.parse(h.capture.rawPayload);
    p.event.eventType = "MessageCreatedV4"; h.capture.eventType = "MessageCreatedV4"; h.capture.rawPayload = JSON.stringify(p);
    await h.run(7); expect(h.generate).toHaveBeenCalledOnce(); expect(h.send).toHaveBeenCalledOnce();
  });
  it("keeps explicit opt-out and already-dismissed send-ownership protection", async () => {
    const h = harness(); vi.mocked(h.store.fresh).mockResolvedValue(false); await h.run(7);
    expect(h.generate).not.toHaveBeenCalled(); expect(h.send).not.toHaveBeenCalled();
    const late = harness(); late.generate.mockImplementation(async input => { late.dismiss(); return { ...await h.deps.generate(input), requestId: input.requestId }; });
    await late.run(7); expect(late.send).not.toHaveBeenCalled(); expect(late.status()).toBe("DISMISSED");
  });
  it.each(["missingId", "unsuccessful", "timeout", "postsend-save", "restart"])("uncertain %s does not resubmit the same card's introduction", async failure => {
    const h = harness();
    if (failure === "missingId") h.send.mockResolvedValue({ success: true, messageId: "" });
    if (failure === "unsuccessful") h.send.mockResolvedValue({ success: false, messageId: "" });
    if (failure === "timeout") h.send.mockRejectedValue(new Error("timeout"));
    if (["postsend-save", "restart"].includes(failure)) vi.mocked(h.store.accepted).mockRejectedValue(new Error("save failed"));
    await h.run(7); expect(h.status()).toBe("SENDING"); expect(h.send).toHaveBeenCalledOnce();
    await h.run(7); expect(h.send).toHaveBeenCalledOnce(); expect(h.status()).toBe("SENDING"); expect(h.claims).toHaveLength(1);
  });
  it("invalid model result or failed durable save is not submitted", async () => {
    const h = harness(); h.generate.mockRejectedValue(new Error("invalid")); await h.run(7); await h.run(7);
    expect(h.claims).toHaveLength(1); expect(h.send).not.toHaveBeenCalled();
    const b = harness(), originalGenerate = b.generate.getMockImplementation()!;
    b.generate.mockImplementation(async input => ({ ...await originalGenerate(input), sessionId: 999 })); await b.run(7); expect(b.send).not.toHaveBeenCalled();
    const s = harness(); vi.mocked(s.store.beginSend).mockRejectedValue(new Error("save failed")); await s.run(7); expect(s.send).not.toHaveBeenCalled();
  });
  it.each(["load", "claim"])("a %s failure before any receipt is explicit and escalated", async boundary => {
    const h = harness();
    vi.mocked(boundary === "load" ? h.store.loadCapture : h.store.claim).mockRejectedValue(new Error("offline storage failure"));
    const outcome = await h.run(7);
    expect(outcome.outcome).toBe("failed");
    expect(outcome.code).toBe(boundary === "load" ? "CAPTURE_LOAD_FAILED" : "CLAIM_FAILED");
    expect(h.onFailure).toHaveBeenCalledOnce(); expect(h.generate).not.toHaveBeenCalled(); expect(h.send).not.toHaveBeenCalled();
  });
  it("failed generation reports review, while an uncertain send is never retried", async () => {
    const h = harness(); h.generate.mockRejectedValue(new Error("offline model failure"));
    expect(await h.run(7)).toMatchObject({ outcome: "failed", code: "GENERATION_OR_SAVE_FAILED" });
    expect(h.onFailure).toHaveBeenCalledWith(expect.objectContaining({ stage: "generation", uncertain: false }));
    const uncertain = harness(); uncertain.send.mockResolvedValue({ success: false, messageId: "" });
    expect(await uncertain.run(7)).toMatchObject({ outcome: "uncertain", code: "SUBMISSION_UNCERTAIN" });
    expect(uncertain.onFailure).toHaveBeenCalledWith(expect.objectContaining({ stage: "submission", uncertain: true }));
    expect(await uncertain.run(7)).toMatchObject({ outcome: "duplicate" }); expect(uncertain.send).toHaveBeenCalledOnce();
  });
  it("a failed escalation does not hide the original failure outcome or submit a message", async () => {
    const h = harness(); h.generate.mockRejectedValue(new Error("offline model failure")); h.onFailure.mockRejectedValue(new Error("offline escalation failure"));
    expect(await h.run(7)).toMatchObject({ outcome: "failed", code: "GENERATION_OR_SAVE_FAILED" });
    expect(h.send).not.toHaveBeenCalled();
  });
  it("a hanging SMS submission becomes uncertain after its deadline without resubmitting", async () => {
    vi.useFakeTimers();
    try {
      const h = harness(); h.send.mockImplementation(() => new Promise(() => {}));
      const pending = h.run(7); await vi.advanceTimersByTimeAsync(30_001);
      expect(await pending).toMatchObject({ outcome: "uncertain", code: "SUBMISSION_UNCERTAIN" });
      expect(h.onFailure).toHaveBeenCalledWith(expect.objectContaining({ uncertain: true, stage: "submission" }));
      expect(await h.run(7)).toMatchObject({ outcome: "duplicate" });
      expect(h.send).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); }
  });
  it("legacy sequence files remain byte-equivalent and no forbidden operational dependency is added", () => {
    for (const file of ["server/emailLeadWebhook.ts", "server/thumbtackWebhook.ts"]) expect(readFileSync(file, "utf8"))
      .toBe(execFileSync("git", ["show", `fe1f39700bc537b72c34ec1742ed4bf4c20042ef:${file}`], { encoding: "utf8" }));
    for (const file of ["server/instinct/claudeThumbtackFirstResponse.ts", "server/instinct/claudeThumbtackFirstResponseStore.ts", "server/instinct/claudeThumbtackFirstResponseApplication.ts", "shared/thumbtackNativeLead.ts"])
      expect(readFileSync(file, "utf8")).not.toMatch(new RegExp(["cleaner" + "_jobs", "cleaner" + "Jobs", "CREATE TABLE", "ALTER TABLE", "DRAFT_READY", 'status: "FAILED"', "setInterval", "invokeLLM", "generateClaudeInitialLead\\("].join("|")));
  });
});
