import { describe, expect, it, vi } from "vitest";
import { readCustomerEmailConfig, dispatchClaudeCustomerEmail, type CustomerEmailBinding, type CustomerEmailPorts } from "./claudeCustomerEmail";
import { customerEmailReplyHtml, customerEmailSenderAllowed } from "./claudeCustomerEmailApplication";

const binding = (): CustomerEmailBinding => ({
  mailboxEmail: "office@example.com", threadId: "thread-original", inboundMessageId: "gmail-original",
  fromEmail: "customer@example.net", replyToEmail: null, recipientEmail: "customer@example.net",
  senderName: "Alex", subject: "Cleaning request", rfcMessageId: "<original@example.net>",
  createdAt: 1000, receivedAt: 1100, inboundText: "Please add a key note.", snapshotHash: "a".repeat(64),
  snapshot: { mailboxEmail: "office@example.com", threadId: "thread-original", messages: [] },
});
function setup() {
  const events: string[] = []; const source = binding();
  const ports: CustomerEmailPorts = {
    readConfig: () => ({ enabled: true, startAt: 900 }),
    store: {
      claim: vi.fn(async b => { events.push("claim"); return { receiptId: 11, key: "immutable-receipt", binding: b }; }),
      prepare: vi.fn(async () => { events.push("persist-task-and-SENDING"); return true; }),
      recordAcceptance: vi.fn(async () => { events.push("acceptance"); return true; }),
      markUncertain: vi.fn(async () => { events.push("uncertain"); }),
      suppress: vi.fn(async () => { events.push("suppressed"); }),
      ownsThread: vi.fn(async () => false), guardHumanReply: vi.fn(async () => {}),
    },
    readCurrent: vi.fn(async () => true),
    generate: vi.fn(async () => { events.push("same-existing-agent"); return { replyText: "Hi Alex, we'll take care of that 🧹", task: { title: "Add key note", items: [{ title: "Record key note", evidenceQuote: "Please add a key note." }] } }; }),
    send: vi.fn(async () => { events.push("existing-Gmail-send"); return { messageId: "outbound-original", threadId: source.threadId }; }),
    broadcast: vi.fn(() => { events.push("task-update"); }),
  };
  return { source, ports, events };
}
describe("same-agent customer email lifecycle, offline", () => {
  it("requires explicit enablement and immutable UTC cutoff", () => {
    expect(readCustomerEmailConfig({})).toEqual({ enabled: false, startAt: NaN });
    for (const env of [{ CLAUDE_CUSTOMER_EMAIL_ENABLED: "TRUE" }, { CLAUDE_CUSTOMER_EMAIL_ENABLED: "true", CLAUDE_CUSTOMER_EMAIL_START_AT: "tomorrow" }]) expect(readCustomerEmailConfig(env).enabled).toBe(false);
    expect(readCustomerEmailConfig({ CLAUDE_CUSTOMER_EMAIL_ENABLED: "true", CLAUDE_CUSTOMER_EMAIL_START_AT: "2026-11-17T01:00:00.000Z" }).enabled).toBe(true);
  });
  it.each(["disabled", "old-creation", "old-observation", "invalid-time", "future-creation"])("does nothing for %s", async kind => {
    const { source, ports, events } = setup();
    if (kind === "disabled") ports.readConfig = () => ({ enabled: false, startAt: 900 });
    if (kind === "old-creation") source.createdAt = 800;
    if (kind === "old-observation") source.receivedAt = 800;
    if (kind === "invalid-time") source.createdAt = NaN;
    if (kind === "future-creation") source.createdAt = 1200;
    expect(await dispatchClaudeCustomerEmail(source, ports)).toBe("ineligible"); expect(events).toEqual([]);
  });
  it("claims and saves exact reply/task before existing sender acceptance", async () => {
    const { source, ports, events } = setup();
    expect(await dispatchClaudeCustomerEmail(source, ports)).toBe("sent");
    expect(events).toEqual(["claim", "same-existing-agent", "persist-task-and-SENDING", "task-update", "existing-Gmail-send", "acceptance", "task-update"]);
    expect(ports.send).toHaveBeenCalledWith(source, "Hi Alex, we'll take care of that 🧹");
    expect(ports.store.recordAcceptance).toHaveBeenCalledWith(expect.objectContaining({ binding: source }), "outbound-original");
  });
  it("a duplicate never generates or sends", async () => {
    const { source, ports } = setup(); vi.mocked(ports.store.claim).mockResolvedValue(null);
    expect(await dispatchClaudeCustomerEmail(source, ports)).toBe("duplicate"); expect(ports.generate).not.toHaveBeenCalled(); expect(ports.send).not.toHaveBeenCalled();
  });
  it.each(["generation", "freshness", "configuration", "prepare"])("does not submit on %s failure", async kind => {
    const { source, ports } = setup();
    if (kind === "generation") vi.mocked(ports.generate).mockRejectedValue(new Error("credit unavailable"));
    if (kind === "freshness") vi.mocked(ports.readCurrent).mockResolvedValue(false);
    if (kind === "configuration") { let reads = 0; ports.readConfig = () => ({ enabled: ++reads === 1, startAt: 900 }); }
    if (kind === "prepare") vi.mocked(ports.store.prepare).mockResolvedValue(false);
    expect(await dispatchClaudeCustomerEmail(source, ports)).toBe("suppressed"); expect(ports.send).not.toHaveBeenCalled(); expect(ports.store.markUncertain).not.toHaveBeenCalled();
  });
  it.each(["timeout", "missing-ID", "wrong-thread", "receipt-write"])("permanently blocks uncertainty for %s", async kind => {
    const { source, ports } = setup();
    if (kind === "timeout") vi.mocked(ports.send).mockRejectedValue(new Error("timeout"));
    if (kind === "missing-ID") vi.mocked(ports.send).mockResolvedValue({ messageId: "", threadId: source.threadId });
    if (kind === "wrong-thread") vi.mocked(ports.send).mockResolvedValue({ messageId: "accepted", threadId: "other" });
    if (kind === "receipt-write") vi.mocked(ports.store.recordAcceptance).mockRejectedValue(new Error("save failed"));
    expect(await dispatchClaudeCustomerEmail(source, ports)).toBe("uncertain"); expect(ports.send).toHaveBeenCalledTimes(1); expect(ports.store.markUncertain).toHaveBeenCalledTimes(1); expect(ports.store.suppress).not.toHaveBeenCalled();
  });
  it("a visibility failure cannot change acceptance or cause resend", async () => {
    const { source, ports } = setup(); ports.broadcast = vi.fn(() => { throw new Error("SSE failed"); });
    expect(await dispatchClaudeCustomerEmail(source, ports)).toBe("sent"); expect(ports.send).toHaveBeenCalledTimes(1);
  });
  it("answers no-task requests with the same durable send boundary", async () => {
    const { source, ports } = setup(); vi.mocked(ports.generate).mockResolvedValue({ replyText: "You're welcome!", task: null });
    expect(await dispatchClaudeCustomerEmail(source, ports)).toBe("sent"); expect(ports.store.prepare).toHaveBeenCalledWith(expect.anything(), { replyText: "You're welcome!", task: null });
  });
  it("escapes only the HTML representation while preserving wording/emojis/line breaks", () => {
    expect(customerEmailReplyHtml("Hi! 🧹\n<note> & \"key\" isn't changed")).toBe("Hi! 🧹<br>&lt;note&gt; &amp; &quot;key&quot; isn&#39;t changed");
  });
  it("uses exact stored sender policies and excludes staff/cleaners/applicants without resolving customers", async () => {
    const database = { execute: vi.fn(async () => [[]]) };
    expect(await customerEmailSenderAllowed(database as any, binding())).toBe(true);
    expect(database.execute).toHaveBeenCalledTimes(5);
    for (const index of [0, 1, 2, 3, 4]) {
      let count = 0; database.execute.mockImplementation(async () => [count++ === index ? [index < 2 ? { isActionable: 0 } : { email: "customer@example.net" }] : []]);
      expect(await customerEmailSenderAllowed(database as any, binding())).toBe(false);
    }
  });
});
