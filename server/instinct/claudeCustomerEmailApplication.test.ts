import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createClaudeCustomerEmailApplication } from "./claudeCustomerEmailApplication";
import { CLAUDE_CUSTOMER_SMS_PLAN_INSTRUCTIONS } from "./claudeCustomerSmsGeneration";
import type { CustomerEmailBinding, CustomerEmailStore } from "./claudeCustomerEmail";
import { buildSystemPrompt } from "../csReplyStream";
function rawThread(text = "Please add a key note.") {
  return { id: "real-thread", messages: [{ id: "original-gmail-id", threadId: "real-thread", internalDate: "1000", labelIds: ["INBOX", "UNREAD"],
    payload: { mimeType: "text/plain", headers: [
      { name: "From", value: "Alex <customer@example.net>" }, { name: "To", value: "office@example.com" },
      { name: "Subject", value: "Cleaning request" }, { name: "Message-ID", value: "<original-rfc-id@example.net>" },
    ], body: { data: Buffer.from(text).toString("base64url"), size: Buffer.byteLength(text) } } }] };
}
function setup() {
  const raw = rawThread(); const trace: string[] = []; let bound: CustomerEmailBinding | undefined;
  const store: CustomerEmailStore = {
    claim: vi.fn(async binding => { bound = binding; trace.push("claim"); return { receiptId: 5, key: "immutable", binding }; }),
    prepare: vi.fn(async () => { trace.push("durable-task-and-reply"); return true; }),
    recordAcceptance: vi.fn(async () => { trace.push("receipt"); return true; }),
    markUncertain: vi.fn(async () => {}), suppress: vi.fn(async () => {}),
    ownsThread: vi.fn(async () => false), guardHumanReply: vi.fn(async () => {}),
  };
  const runner = vi.fn(async (_request: unknown) => { trace.push("existing-agent"); return { finalSmsText: JSON.stringify({ replyText: "Hi Alex! We'll take care of the key note 🧹", task: { title: "Add key note", items: [{ title: "Record key note", evidenceQuote: "Please add a key note." }] } }) }; });
  const config = vi.fn(() => ({ enabled: true, startAt: 900 }));
  const database = vi.fn(async () => ({} as any)); const mailbox = vi.fn(async () => "office@example.com");
  const readThread = vi.fn(async () => ({ inboxEmail: "office@example.com", sourceSnapshot: raw } as any));
  const send = vi.fn(async () => { trace.push("existing-Gmail-sender"); return { messageId: "accepted-id", threadId: "real-thread" }; });
  const readKnowledge = vi.fn(async () => "COMPLETE EXISTING APPROVED KNOWLEDGE");
  const app = createClaudeCustomerEmailApplication({ config, database, mailbox, readThread,
    senderAllowed: async () => true, store: () => store,
    replyGeneration: { runner, readKnowledge }, send, broadcast: () => {} });
  const event = { inboundMessageId: "original-gmail-id", receivedAt: 1100, rawThread: raw };
  return { app, event, raw, store, runner, readKnowledge, config, database, mailbox, readThread, send, trace, bound: () => bound };
}
describe("actual email counterpart application, no network", () => {
  let network: ReturnType<typeof vi.spyOn>;
  beforeEach(() => { network = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("OFFLINE_ONLY")); });
  afterEach(() => { expect(network).not.toHaveBeenCalled(); vi.restoreAllMocks(); });
  it("saves tasks before sending and uses the same complete instructions and real thread binding", async () => {
    const x = setup(); expect(await x.app.captured(x.event)).toBe(true);
    expect(x.trace).toEqual(["claim", "existing-agent", "durable-task-and-reply", "existing-Gmail-sender", "receipt"]);
    const request = x.runner.mock.calls[0][0] as any;
    expect(request.systemPrompt).toContain(CLAUDE_CUSTOMER_SMS_PLAN_INSTRUCTIONS); expect(request.systemPrompt.endsWith(buildSystemPrompt())).toBe(true);
    const input = JSON.parse(request.userPrompt);
    expect(input.incomingMessage).toBe("Please add a key note."); expect(input.context.knowledgeBase).toBe("COMPLETE EXISTING APPROVED KNOWLEDGE");
    expect(input.context.binding.threadId).toBe("real-thread"); expect(input.context.binding.inboundMessageId).toBe("original-gmail-id");
    expect(input.context.binding.rfcMessageId).toBe("<original-rfc-id@example.net>");
    expect(x.send).toHaveBeenCalledWith(x.bound(), "Hi Alex! We'll take care of the key note 🧹");
  });
  it.each(["provider", "strict-schema"])("recovers %s failure through the shared ordinary factory with one complete input, knowledge read and send", async failure => {
    const x = setup(), before = JSON.stringify(x.raw);
    const earlier = structuredClone(x.raw.messages[0]);
    const fullEarlier = "Complete historical context with no caps. ".repeat(5000);
    earlier.id = "earlier-gmail-id"; earlier.internalDate = "950";
    earlier.payload.body.data = Buffer.from(fullEarlier).toString("base64url"); x.raw.messages.unshift(earlier);
    const sourceBefore = JSON.stringify(x.raw);
    if (failure === "provider") x.runner.mockRejectedValueOnce(new Error("Synthetic provider unavailable"));
    else x.runner.mockResolvedValueOnce({ finalSmsText: JSON.stringify({ replyText: "Invalid first reply", task: null, extraField: true }) });
    expect(await x.app.captured(x.event)).toBe(true);
    expect(x.runner).toHaveBeenCalledTimes(2); expect(x.readKnowledge).toHaveBeenCalledTimes(1);
    const first = x.runner.mock.calls[0][0] as any, second = x.runner.mock.calls[1][0] as any;
    expect(second).toBe(first); expect(second.systemPrompt).toBe(first.systemPrompt); expect(second.userPrompt).toBe(first.userPrompt);
    expect(second.systemPrompt).toContain(CLAUDE_CUSTOMER_SMS_PLAN_INSTRUCTIONS);
    expect(second.systemPrompt.endsWith(buildSystemPrompt())).toBe(true);
    const input = JSON.parse(second.userPrompt);
    expect(input.incomingMessage).toBe("Please add a key note.");
    expect(input.context.knowledgeBase).toBe("COMPLETE EXISTING APPROVED KNOWLEDGE");
    expect(input.context.binding).toEqual(x.bound());
    expect(input.context.contact).toEqual({ displayName: "Alex", email: "customer@example.net" });
    expect(input.context.originalConversation).toHaveLength(2);
    expect(input.context.originalConversation[0].content).toBe(fullEarlier);
    expect(input.context.originalConversation[1]).toMatchObject({ role: "user", content: "Please add a key note.", providerMessageId: "original-gmail-id" });
    expect(JSON.stringify(x.raw)).toBe(sourceBefore); expect(sourceBefore).not.toBe(before);
    expect(x.store.claim).toHaveBeenCalledTimes(1); expect(x.store.prepare).toHaveBeenCalledTimes(1);
    expect(x.send).toHaveBeenCalledTimes(1); expect(x.store.recordAcceptance).toHaveBeenCalledTimes(1);
    expect(x.send).toHaveBeenCalledWith(x.bound(), "Hi Alex! We'll take care of the key note 🧹");
    expect(x.store.prepare).toHaveBeenCalledWith(expect.objectContaining({ binding: x.bound() }), {
      replyText: "Hi Alex! We'll take care of the key note 🧹", task: { title: "Add key note", items: [{ title: "Record key note", evidenceQuote: "Please add a key note." }] },
    });
    const ordered = [x.store.claim, x.runner, x.store.prepare, x.send, x.store.recordAcceptance].map(action => vi.mocked(action).mock.invocationCallOrder[0]);
    expect(ordered).toEqual([...ordered].sort((a, b) => a - b)); expect(x.store.suppress).not.toHaveBeenCalled();
  });
  it("the disabled path performs zero mailbox, DB, model or sender calls", async () => {
    const x = setup(); x.config.mockReturnValue({ enabled: false, startAt: 900 });
    expect(await x.app.captured(x.event)).toBe(false); expect(x.mailbox).not.toHaveBeenCalled(); expect(x.database).not.toHaveBeenCalled(); expect(x.runner).not.toHaveBeenCalled(); expect(x.send).not.toHaveBeenCalled();
  });
  it("an old captured event cannot backfill", async () => {
    const x = setup(); x.event.receivedAt = 800;
    expect(await x.app.captured(x.event)).toBe(false); expect(x.mailbox).not.toHaveBeenCalled(); expect(x.runner).not.toHaveBeenCalled();
  });
  it("a source message older than activation does not claim or generate", async () => {
    const x = setup(); x.raw.messages[0].internalDate = "800";
    expect(await x.app.captured(x.event)).toBe(false); expect(x.store.claim).not.toHaveBeenCalled(); expect(x.runner).not.toHaveBeenCalled();
  });
  it("reading the thread during generation does not invalidate immutable content", async () => {
    const x = setup(); x.readThread.mockImplementation(async () => ({ inboxEmail: "office@example.com", sourceSnapshot: { ...x.raw, messages: x.raw.messages.map(m => ({ ...m, labelIds: ["INBOX"] })) } } as any));
    expect(await x.app.captured(x.event)).toBe(true); expect(x.send).toHaveBeenCalledTimes(1);
  });
  it.each(["new-message", "changed-text", "different-mailbox"])("does not send if %s appears before submission", async mode => {
    const x = setup(); const changed = structuredClone(x.raw);
    if (mode === "new-message") changed.messages[0].id = "newer-gmail-id";
    if (mode === "changed-text") changed.messages[0].payload.body.data = Buffer.from("Changed message").toString("base64url");
    x.readThread.mockResolvedValue({ inboxEmail: mode === "different-mailbox" ? "other@example.com" : "office@example.com", sourceSnapshot: changed } as any);
    expect(await x.app.captured(x.event)).toBe(true); expect(x.send).not.toHaveBeenCalled(); expect(x.store.suppress).toHaveBeenCalled();
  });
  it("exhausted provider generation remains owned after exactly two content attempts and never prepares or sends", async () => {
    const x = setup(); x.runner.mockRejectedValue(new Error("no credit"));
    expect(await x.app.captured(x.event)).toBe(true); expect(x.runner).toHaveBeenCalledTimes(2); expect(x.readKnowledge).toHaveBeenCalledTimes(1);
    expect(x.store.claim).toHaveBeenCalledTimes(1); expect(x.store.prepare).not.toHaveBeenCalled(); expect(x.send).not.toHaveBeenCalled();
    expect(x.store.recordAcceptance).not.toHaveBeenCalled(); expect(x.store.suppress).toHaveBeenCalledWith(expect.anything(), "EMAIL_PRE_SUBMISSION_FAILED");
  });
  it("exhausted schema generation never prepares or sends", async () => {
    const x = setup(); x.runner.mockResolvedValue({ finalSmsText: JSON.stringify({ replyText: " ", task: null }) });
    expect(await x.app.captured(x.event)).toBe(true); expect(x.runner).toHaveBeenCalledTimes(2); expect(x.readKnowledge).toHaveBeenCalledTimes(1);
    expect(x.store.claim).toHaveBeenCalledTimes(1); expect(x.store.prepare).not.toHaveBeenCalled(); expect(x.send).not.toHaveBeenCalled();
    expect(x.store.recordAcceptance).not.toHaveBeenCalled();
  });
  it.each(["preparation", "submission", "acceptance"])("does not regenerate or retry %s after shared content recovery", async phase => {
    const x = setup(); x.runner.mockRejectedValueOnce(new Error("Synthetic provider unavailable"));
    if (phase === "preparation") vi.mocked(x.store.prepare).mockRejectedValue(new Error("Synthetic preparation unavailable"));
    if (phase === "submission") x.send.mockRejectedValue(new Error("Synthetic sender uncertainty"));
    if (phase === "acceptance") vi.mocked(x.store.recordAcceptance).mockRejectedValue(new Error("Synthetic acceptance uncertainty"));
    expect(await x.app.captured(x.event)).toBe(true);
    expect(x.runner).toHaveBeenCalledTimes(2); expect(x.readKnowledge).toHaveBeenCalledTimes(1); expect(x.store.claim).toHaveBeenCalledTimes(1);
    expect(x.store.prepare).toHaveBeenCalledTimes(1); expect(x.send).toHaveBeenCalledTimes(phase === "preparation" ? 0 : 1);
    expect(x.store.recordAcceptance).toHaveBeenCalledTimes(phase === "acceptance" ? 1 : 0);
    expect(x.store.markUncertain).toHaveBeenCalledTimes(phase === "preparation" ? 0 : 1);
  });
  it("retains full HTML-only historical bodies in the complete conversation supplied to the same agent", async () => {
    const x = setup(); const earlier = structuredClone(x.raw.messages[0]);
    earlier.id = "html-earlier-gmail-id"; earlier.internalDate = "950"; earlier.payload.mimeType = "text/html";
    const html = "<p>Complete earlier cleaning request.</p>".repeat(250);
    earlier.payload.body.data = Buffer.from(html).toString("base64url");
    x.raw.messages.unshift(earlier);
    expect(await x.app.captured(x.event)).toBe(true);
    const input = JSON.parse((x.runner.mock.calls[0][0] as any).userPrompt);
    expect(input.context.originalConversation[0].content).toBe(html);
  });
  it("preserves the complete source text and all historical messages without caps", async () => {
    const x = setup(); const long = "full history ".repeat(5000);
    const earlier = structuredClone(x.raw.messages[0]); earlier.id = "earlier-gmail-id"; earlier.internalDate = "950"; earlier.payload.body.data = Buffer.from(long).toString("base64url");
    x.raw.messages.unshift(earlier);
    expect(await x.app.captured(x.event)).toBe(true);
    const input = JSON.parse((x.runner.mock.calls[0][0] as any).userPrompt); expect(input.context.originalConversation).toHaveLength(2); expect(input.context.originalConversation[0].content).toBe(long);
  });
});
