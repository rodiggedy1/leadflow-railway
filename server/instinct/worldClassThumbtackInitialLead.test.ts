import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
const mocks = vi.hoisted(() => ({ invoke: vi.fn(), claude: vi.fn(), prepareClaude: vi.fn(), getDb: vi.fn(),
  send: vi.fn(), oldSend: vi.fn(), estimate: vi.fn(), report: vi.fn(), createStore: vi.fn() }));
vi.mock("../_core/llm", () => ({ invokeLLM: mocks.invoke }));
vi.mock("../db", () => ({ getDb: mocks.getDb }));
vi.mock("../csReplyStream", () => ({ prepareCsReplyMessages: mocks.prepareClaude }));
vi.mock("./claudeAgentClient", async original => ({ ...await original<typeof import("./claudeAgentClient")>(), runInitialLeadDraft: mocks.claude }));
vi.mock("./claudeThumbtackFirstResponseStore", () => ({ createClaudeThumbtackFirstResponseStore: mocks.createStore,
  guardClaudeThumbtackManualSendInStore: vi.fn(), guardClaudeThumbtackLegacyDraftActionInStore: vi.fn() }));
vi.mock("./claudeThumbtackFirstResponseFailure", () => ({ createNativeIntroductionFailureReporter: () => mocks.report }));
vi.mock("../_core/notification", () => ({ notifyOwner: vi.fn() }));
vi.mock("../openphone", () => ({ sendSms: mocks.oldSend, estimatePrice: mocks.estimate }));
vi.mock("../_core/env", () => ({ ENV: { openPhoneApiKey: "offline-quo-key" } }));
vi.mock("./thumbtackDirectQuoSms", () => ({ sendThumbtackDirectQuoSms: mocks.send }));
import { generateWorldClassThumbtackInitialLeadContent } from "./worldClassThumbtackInitialLead";
import { generateClaudeInitialLeadContent, CLAUDE_INITIAL_LEAD_TIMEOUT_MS } from "./claudeInitialLead";
import { dispatchClaudeThumbtackFirstResponse } from "./claudeThumbtackFirstResponseApplication";
import { capturedThumbtackLead, thumbtackFirstResponseConfig, type CapturedLead, type FirstResponseStore } from "./claudeThumbtackFirstResponse";
import { THUMBTACK_FIRST_RESPONSE_PROMPT, buildThumbtackLeadDraftContext, type ClaudeInitialLeadInput } from "../../shared/claudeInitialLead";
import { prepareWorldClassCsReplyMessages } from "../worldClassCsReply";
const reply = "Hey Jane! Madison from Maids in Black here.\n\nHappy to help with your deep clean.\n\nWant pricing first?";
const nativeText = ["I've sent your quote.", "Your quote has been created.", "Quote code: Q-88.",
  "Want me to check our team's availability and text you a couple of time options, or send pricing first?",
  "Could you send over your phone number? We'll text you a quote and availability right away."];
const quoPhones = [["+44 (20) 5555-0123", "+442055550123"], ["+11", "+11"], ["12345", "12345"],
  ["111-555-0123", "+11115550123"]];
const capture: CapturedLead = { id: 7, source: "thumbtack", eventType: "NegotiationCreatedV4", receivedAt: new Date("2026-11-23T12:00:00Z"),
  rawPayload: JSON.stringify({ event: { eventType: "NegotiationCreatedV4" }, data: { negotiationID: "offline-new-lead",
    customer: { firstName: "Jane", lastName: "Native", phone: "+17035551234" },
    request: { category: "Deep Cleaning", description: "Skip office", location: { city: "Alexandria", state: "VA" },
      details: [{ question: "Extra requests", answer: "Fridge, oven" }] } } }) };
const config = { startAt: 0, fromNumberId: "PN-offline-lead" };
const facts = capturedThumbtackLead(capture, config)!.facts;
const context = buildThumbtackLeadDraftContext(facts);
const input: ClaudeInitialLeadInput = { sessionId: 42, customerPhone: "+17035551234", requestId: "00112233-4455-4677-8899-aabbccddeeff",
  leadDetails: facts, originalConversation: [], draftRequest: { conversationContext: "", customerName: facts.name, jobContext: context,
    scenario: `${THUMBTACK_FIRST_RESPONSE_PROMPT}\n\nThumbtack lead:\n${context}` } };
const completion = () => ({ id: "chatcmpl-offline-exact", model: "gpt-4o", created: 1,
  choices: [{ index: 0, message: { role: "assistant", content: reply }, finish_reason: "stop" }] });
let network: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.resetAllMocks(); network = vi.fn(() => { throw new Error("OFFLINE_NO_NETWORK"); }); vi.stubGlobal("fetch", network);
  vi.stubEnv("THUMBTACK_CLAUDE_FIRST_RESPONSE_ENABLED", "true"); vi.stubEnv("OPENPHONE_PHONE_NUMBER_ID", config.fromNumberId);
  mocks.invoke.mockResolvedValue(completion()); mocks.getDb.mockResolvedValue({}); mocks.report.mockResolvedValue(undefined);
  mocks.send.mockResolvedValue({ kind: "accepted", success: true, code: "QUO_ACCEPTED", messageId: "OM-offline-exact", providerStatus: "queued", httpStatus: 202 });
  vi.spyOn(console, "info").mockImplementation(() => {}); vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => { expect(network).not.toHaveBeenCalled(); expect(mocks.oldSend).not.toHaveBeenCalled();
  vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });
function dispatcher(loadedCapture: CapturedLead = capture) {
  let claimed = false;
  const store: FirstResponseStore = { loadCapture: vi.fn(async () => loadedCapture),
    claim: vi.fn(async (lead, cfg) => { if (claimed) return null; claimed = true;
      return { draftId: 71, sessionId: 42, cardId: 72, lead, fromNumberId: cfg.fromNumberId }; }),
    fresh: vi.fn(async () => true), beginSend: vi.fn(async () => true), accepted: vi.fn(async () => {}), blocked: vi.fn(async () => {}) };
  mocks.createStore.mockReturnValue(store); return store;
}
const settle = () => new Promise<void>(resolve => setImmediate(resolve));

describe("Thumbtack-only WorldClass ChatGPT generation offline", () => {
  it("uses the exact existing WorldClass prompt, context and GPT helper with no Claude call or customer action", async () => {
    const before = structuredClone(input); const result = await generateWorldClassThumbtackInitialLeadContent(input);
    expect(mocks.invoke).toHaveBeenCalledOnce();
    expect(mocks.invoke).toHaveBeenCalledWith({ messages: prepareWorldClassCsReplyMessages({ ...input.draftRequest!, history: [] }) });
    expect(result).toMatchObject({ replyText: reply, requestId: input.requestId, sessionId: 42, customerPhone: input.customerPhone,
      agentId: "openai:gpt-4o", agentSessionId: "chatcmpl-offline-exact", smsSent: false, actionsExecuted: false, mode: "review_only" });
    expect(result.contextHash).toMatch(/^[a-f0-9]{64}$/); expect(input).toEqual(before);
    expect(mocks.claude).not.toHaveBeenCalled(); expect(mocks.prepareClaude).not.toHaveBeenCalled(); expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.getDb).not.toHaveBeenCalled();
  });
  it("preserves exact paragraphs and emoji bullets in the generated message", async () => {
    const content = "Hey Jane! 👋 Madison from Maids in Black here.\n\n🍳 Fridge and oven\n🧺 Laundry\n\nWant pricing first?";
    const value = completion(); value.choices[0].message.content = content; mocks.invoke.mockResolvedValue(value);
    expect((await generateWorldClassThumbtackInitialLeadContent(input)).replyText).toBe(content);
  });
  it("binds original lead context and history to the result hash without changing inputs", async () => {
    const a = await generateWorldClassThumbtackInitialLeadContent(input);
    const b = await generateWorldClassThumbtackInitialLeadContent({ ...input, originalConversation: [{ role: "user", content: "Retained customer note" }] });
    expect(a.contextHash).not.toBe(b.contextHash);
  });
  it.each(["missing-id", "blank-id", "nonstring-id"])("allows %s without fabricating agent-session metadata", async kind => {
    const value: any = completion();
    if (kind === "missing-id") delete value.id;
    if (kind === "blank-id") value.id = " \n\t";
    if (kind === "nonstring-id") value.id = 123;
    mocks.invoke.mockResolvedValue(value);
    const result = await generateWorldClassThumbtackInitialLeadContent(input);
    expect(result.replyText).toBe(reply); expect(result).not.toHaveProperty("agentSessionId");
    expect(mocks.invoke).toHaveBeenCalledOnce(); expect(mocks.send).not.toHaveBeenCalled(); expect(mocks.claude).not.toHaveBeenCalled();
  });
  it("preserves genuine nonblank completion IDs without trimming or inventing them", async () => {
    const value = completion(); value.id = " chatcmpl-provider-id "; mocks.invoke.mockResolvedValue(value);
    expect((await generateWorldClassThumbtackInitialLeadContent(input)).agentSessionId).toBe(value.id);
  });
  it.each(["missing-finish", "null-finish", "other-finish", "tool-call-finish", "inert-tool-metadata"])("allows valid plain text with %s and executes no tool", async kind => {
    const value: any = completion();
    if (kind === "missing-finish") delete value.choices[0].finish_reason;
    if (kind === "null-finish") value.choices[0].finish_reason = null;
    if (kind === "other-finish") value.choices[0].finish_reason = "content_filter";
    if (kind === "tool-call-finish") value.choices[0].finish_reason = "tool_calls";
    if (kind === "inert-tool-metadata") value.choices[0].message.tool_calls = [{ id: "inert-tool", type: "function",
      function: { name: "sendSms", arguments: "{}" } }];
    mocks.invoke.mockResolvedValue(value);
    expect((await generateWorldClassThumbtackInitialLeadContent(input)).replyText).toBe(reply);
    expect(mocks.invoke).toHaveBeenCalledOnce();
    expect(mocks.invoke).toHaveBeenCalledWith({ messages: prepareWorldClassCsReplyMessages({ ...input.draftRequest!, history: [] }) });
    expect(mocks.send).not.toHaveBeenCalled(); expect(mocks.claude).not.toHaveBeenCalled(); expect(mocks.getDb).not.toHaveBeenCalled();
  });
  it.each(["empty", "nontext", "missing-content", "missing-message", "missing-choice", "missing-choices", "truncated"])("rejects %s output with no automatic apology fallback", async kind => {
    const value: any = completion();
    if (kind === "empty") value.choices[0].message.content = " ";
    if (kind === "nontext") value.choices[0].message.content = [{ type: "text", text: reply }];
    if (kind === "missing-content") delete value.choices[0].message.content;
    if (kind === "missing-message") delete value.choices[0].message;
    if (kind === "missing-choice") value.choices = [];
    if (kind === "missing-choices") delete value.choices;
    if (kind === "truncated") value.choices[0].finish_reason = "length";
    mocks.invoke.mockResolvedValue(value);
    await expect(generateWorldClassThumbtackInitialLeadContent(input)).rejects.toThrow("INVALID_RESPONSE");
    expect(mocks.invoke).toHaveBeenCalledOnce(); expect(mocks.send).not.toHaveBeenCalled(); expect(mocks.claude).not.toHaveBeenCalled();
  });
  it.each(nativeText)("returns exact native quote/invitation/promise bytes and surrounding whitespace: %s", async content => {
    const value = completion(); value.choices[0].message.content = ` \n\t${content}\n\n `; mocks.invoke.mockResolvedValue(value);
    expect((await generateWorldClassThumbtackInitialLeadContent(input)).replyText).toBe(value.choices[0].message.content);
    expect(mocks.send).not.toHaveBeenCalled(); expect(mocks.claude).not.toHaveBeenCalled();
  });
  it.each(quoPhones)("accepts native Quo-format phone %s as %s", async (customerPhone, normalized) => {
    expect((await generateWorldClassThumbtackInitialLeadContent({ ...input, customerPhone })).customerPhone).toBe(normalized);
    expect(mocks.invoke).toHaveBeenCalledOnce(); expect(mocks.send).not.toHaveBeenCalled();
  });
  it("does not retry a failed provider or fall back to Claude", async () => {
    mocks.invoke.mockRejectedValue(new Error("OFFLINE_PROVIDER_FAILURE"));
    await expect(generateWorldClassThumbtackInitialLeadContent(input)).rejects.toThrow("OFFLINE_PROVIDER_FAILURE");
    expect(mocks.invoke).toHaveBeenCalledOnce(); expect(mocks.claude).not.toHaveBeenCalled(); expect(mocks.send).not.toHaveBeenCalled();
  });
  it("keeps the original manual Claude content generator/default transport unchanged", async () => {
    mocks.prepareClaude.mockResolvedValue(prepareWorldClassCsReplyMessages({ ...input.draftRequest!, history: [] }));
    mocks.claude.mockResolvedValue({ finalSmsText: reply, agentId: "verified-claude", sessionId: "sesn_verified" });
    const result = await generateClaudeInitialLeadContent(input);
    expect(result.agentId).toBe("verified-claude"); expect(mocks.claude).toHaveBeenCalledOnce(); expect(mocks.invoke).not.toHaveBeenCalled();
  });
  it.each([["I've sent your quote.", "UNSAFE_REPLY_CLAIM"], ["Your quote has been created.", "UNSAFE_REPLY_CLAIM"],
    ["Quote code: Q-88.", "UNSAFE_REPLY_PRESENTATION"], ["We will send a quote right away.", "UNSAFE_REPLY_CLAIM"]])("retains manual-Claude validation: %s", async (content, code) => {
    mocks.prepareClaude.mockResolvedValue(prepareWorldClassCsReplyMessages({ ...input.draftRequest!, history: [] }));
    mocks.claude.mockResolvedValue({ finalSmsText: content, agentId: "verified-claude", sessionId: "sesn_verified" });
    await expect(generateClaudeInitialLeadContent(input)).rejects.toThrow(code);
    expect(mocks.invoke).not.toHaveBeenCalled(); expect(mocks.send).not.toHaveBeenCalled();
  });
  it("does not apply explicitly native validation overrides to manual Claude drafts", async () => {
    mocks.prepareClaude.mockResolvedValue(prepareWorldClassCsReplyMessages({ ...input.draftRequest!, history: [] }));
    mocks.claude.mockResolvedValue({ finalSmsText: "I've sent your quote.", agentId: "verified-claude", sessionId: "sesn_verified" });
    await expect(generateClaudeInitialLeadContent(input, { validateReply: text => text })).rejects.toThrow("UNSAFE_REPLY_CLAIM");
    await expect(generateClaudeInitialLeadContent({ ...input, customerPhone: "+11" }, { normalizeCustomerPhone: () => "+11" })).rejects.toThrow("INVALID_CUSTOMER_PHONE");
    expect(mocks.claude).toHaveBeenCalledOnce(); expect(mocks.invoke).not.toHaveBeenCalled(); expect(mocks.send).not.toHaveBeenCalled();
  });
  it("keeps a real agent-session ID required by the manual result parser", async () => {
    mocks.prepareClaude.mockResolvedValue(prepareWorldClassCsReplyMessages({ ...input.draftRequest!, history: [] }));
    mocks.claude.mockResolvedValue({ finalSmsText: reply, agentId: "verified-claude" });
    await expect(generateClaudeInitialLeadContent(input)).rejects.toThrow();
    expect(mocks.invoke).not.toHaveBeenCalled(); expect(mocks.send).not.toHaveBeenCalled();
  });
});
describe("actual native application generator wiring offline", () => {
  it("drafts through ChatGPT and submits exactly that text through the dedicated Quo sender once on repeated deliveries", async () => {
    const store = dispatcher();
    expect(await dispatchClaudeThumbtackFirstResponse(7)).toMatchObject({ outcome: "sent", messageId: "OM-offline-exact" });
    expect(await dispatchClaudeThumbtackFirstResponse(7)).toMatchObject({ outcome: "duplicate" });
    expect(mocks.invoke).toHaveBeenCalledOnce(); expect(mocks.send).toHaveBeenCalledOnce();
    expect(mocks.send).toHaveBeenCalledWith({ to: "+17035551234", content: reply, fromNumberId: config.fromNumberId },
      { apiKey: "offline-quo-key", signal: expect.any(AbortSignal), deadlineAt: expect.any(Number) });
    expect(store.accepted).toHaveBeenCalledWith(expect.objectContaining({ draftId: 71 }), expect.objectContaining({ agentId: "openai:gpt-4o", replyText: reply }),
      "OM-offline-exact", expect.objectContaining({ kind: "accepted", providerStatus: "queued" }));
    expect(mocks.claude).not.toHaveBeenCalled();
  });
  it.each([undefined, "", " \n\t"])("sends once on repeated deliveries when the completion ID is absent/blank (%s)", async id => {
    const value = { ...completion(), id }; mocks.invoke.mockResolvedValue(value);
    const store = dispatcher();
    expect(await dispatchClaudeThumbtackFirstResponse(7)).toMatchObject({ outcome: "sent" });
    expect(await dispatchClaudeThumbtackFirstResponse(7)).toMatchObject({ outcome: "duplicate" });
    expect(mocks.invoke).toHaveBeenCalledOnce(); expect(mocks.send).toHaveBeenCalledOnce();
    expect(vi.mocked(store.accepted).mock.calls[0][1]).not.toHaveProperty("agentSessionId");
    expect(mocks.claude).not.toHaveBeenCalled(); expect(mocks.report).not.toHaveBeenCalled();
  });
  it.each(nativeText)("submits exact native text with surrounding whitespace without inherited manual vetoes: %s", async content => {
    const value = completion(); value.choices[0].message.content = ` \n\t${content}\n\n `; mocks.invoke.mockResolvedValue(value);
    const store = dispatcher();
    expect(await dispatchClaudeThumbtackFirstResponse(7)).toMatchObject({ outcome: "sent" });
    expect(mocks.send).toHaveBeenCalledOnce();
    expect(mocks.send.mock.calls[0][0].content).toBe(value.choices[0].message.content);
    expect(vi.mocked(store.accepted).mock.calls[0][1].replyText).toBe(value.choices[0].message.content);
    expect(mocks.claude).not.toHaveBeenCalled(); expect(mocks.report).not.toHaveBeenCalled();
  });
  it.each(quoPhones)("generates and dispatches native Quo-format phone %s as %s", async (customerPhone, normalized) => {
    const payload = JSON.parse(capture.rawPayload); payload.data.customer.phone = customerPhone;
    const store = dispatcher({ ...capture, rawPayload: JSON.stringify(payload) });
    expect(await dispatchClaudeThumbtackFirstResponse(7)).toMatchObject({ outcome: "sent" });
    expect(await dispatchClaudeThumbtackFirstResponse(7)).toMatchObject({ outcome: "duplicate" });
    expect(mocks.invoke).toHaveBeenCalledOnce(); expect(mocks.send).toHaveBeenCalledOnce();
    expect(mocks.send.mock.calls[0][0]).toEqual({ to: normalized, content: reply, fromNumberId: config.fromNumberId });
    expect(vi.mocked(store.accepted).mock.calls[0][1].customerPhone).toBe(normalized);
    expect(mocks.claude).not.toHaveBeenCalled(); expect(mocks.report).not.toHaveBeenCalled();
  });
  it.each(["bark", "email", "form", "MessageCreatedV4"])("never sends this introduction for non-new-Thumbtack capture %s", async kind => {
    const store = dispatcher();
    vi.mocked(store.loadCapture).mockResolvedValue({ ...capture, ...(kind === "MessageCreatedV4" ? { eventType: kind } : { source: kind }) });
    expect(await dispatchClaudeThumbtackFirstResponse(7)).toMatchObject({ outcome: "failed" });
    expect(mocks.invoke).not.toHaveBeenCalled(); expect(mocks.send).not.toHaveBeenCalled();
  });
  it("keeps the existing enablement toggle: disabled performs no database, model or SMS operation", async () => {
    vi.stubEnv("THUMBTACK_CLAUDE_FIRST_RESPONSE_ENABLED", "false");
    expect(thumbtackFirstResponseConfig()).toBeNull();
    expect(await dispatchClaudeThumbtackFirstResponse(7)).toMatchObject({ outcome: "disabled" });
    expect(mocks.getDb).not.toHaveBeenCalled(); expect(mocks.invoke).not.toHaveBeenCalled(); expect(mocks.send).not.toHaveBeenCalled();
  });
  it("consent or manual ownership changes after generation still prevent SMS submission", async () => {
    const store = dispatcher(); vi.mocked(store.beginSend).mockResolvedValue(false);
    expect(await dispatchClaudeThumbtackFirstResponse(7)).toMatchObject({ outcome: "suppressed" });
    expect(mocks.invoke).toHaveBeenCalledOnce(); expect(mocks.send).not.toHaveBeenCalled();
  });
  it("a failed ChatGPT generation never prepares/submits an SMS and retains failure review", async () => {
    const store = dispatcher(); mocks.invoke.mockRejectedValue(new Error("OFFLINE_PROVIDER_FAILURE"));
    expect(await dispatchClaudeThumbtackFirstResponse(7)).toMatchObject({ outcome: "failed" });
    expect(store.beginSend).not.toHaveBeenCalled(); expect(mocks.send).not.toHaveBeenCalled(); expect(mocks.report).toHaveBeenCalledOnce();
  });
  it.each(["resolve", "reject"])("a non-cooperative late provider %s after the original 120-second deadline cannot prepare, send or accept SMS", async late => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    const store = dispatcher(); let resolve!: (value: ReturnType<typeof completion>) => void, reject!: (error: Error) => void;
    mocks.invoke.mockImplementation(() => new Promise((yes, no) => { resolve = yes; reject = no; }));
    const pending = dispatchClaudeThumbtackFirstResponse(7); await settle(); expect(mocks.invoke).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(CLAUDE_INITIAL_LEAD_TIMEOUT_MS);
    expect(await pending).toMatchObject({ outcome: "failed" });
    if (late === "resolve") resolve(completion()); else reject(new Error("OFFLINE_LATE_PROVIDER_FAILURE"));
    await settle();
    expect(store.beginSend).not.toHaveBeenCalled(); expect(mocks.send).not.toHaveBeenCalled(); expect(store.accepted).not.toHaveBeenCalled();
    expect(mocks.claude).not.toHaveBeenCalled(); expect(mocks.invoke).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
  });
  it("new generator uses only the existing helper and adds no database, scheduler, sender, alternate model or legacy operational dependency", () => {
    const source = readFileSync("server/instinct/worldClassThumbtackInitialLead.ts", "utf8");
    expect(source).not.toMatch(/fetch\s*\(|sendSms\s*\(|setInterval|\.\.\/db|CREATE TABLE|ALTER TABLE/);
    expect(source).not.toMatch(new RegExp(["cleaner" + "Jobs", "cleaner" + "_jobs"].join("|")));
  });
});
