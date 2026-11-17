import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
const mocks = vi.hoisted(() => ({ owns: vi.fn(async () => false), human: vi.fn(async (_thread: string) => {}), allowed: vi.fn(async () => true), mailbox: vi.fn(async () => "office@example.com") }));
vi.mock("./instinct/claudeCustomerEmailApplication", () => ({ ownsClaudeCustomerEmailThread: mocks.owns, guardClaudeCustomerEmailHumanReply: mocks.human, customerEmailSenderAllowed: mocks.allowed }));
vi.mock("./gmailService", () => ({ getInboxEmailAddress: mocks.mailbox }));
import { arbitrateCustomerEmailHumanReply, skipLegacyCustomerEmailDraft } from "./instinct/claudeCustomerEmailGuards";
import { createClaudeCustomerReplyGuards } from "./instinct/claudeCustomerSmsManualGuard";
import { CUSTOMER_EMAIL_RECEIPT_ACTION } from "./instinct/claudeCustomerEmail";
beforeEach(() => {
  vi.clearAllMocks(); vi.unstubAllEnvs(); mocks.owns.mockResolvedValue(false); mocks.allowed.mockResolvedValue(true); mocks.human.mockResolvedValue(undefined);
});
const cutoff = Date.parse("2026-11-17T01:00:00.000Z");
const enable = () => { vi.stubEnv("CLAUDE_CUSTOMER_EMAIL_ENABLED", "true"); vi.stubEnv("CLAUDE_CUSTOMER_EMAIL_START_AT", "2026-11-17T01:00:00.000Z"); };
const source = { threadId: "actual-thread", fromEmail: "customer@example.net", createdAt: cutoff + 1000 };
describe("email draft ownership and existing human send arbitration", () => {
  it("preserves legacy draft behavior when off and no receipt is outstanding", async () => {
    expect(await skipLegacyCustomerEmailDraft({} as any, source)).toBe(false); expect(mocks.allowed).not.toHaveBeenCalled(); expect(mocks.mailbox).not.toHaveBeenCalled();
  });
  it("a pending or uncertain existing receipt remains protected after disabling", async () => {
    mocks.owns.mockResolvedValue(true); expect(await skipLegacyCustomerEmailDraft({} as any, source)).toBe(true); expect(mocks.allowed).not.toHaveBeenCalled();
  });
  it("future customer messages reserve exactly one response owner", async () => {
    enable(); expect(await skipLegacyCustomerEmailDraft({} as any, source)).toBe(true);
    expect(mocks.allowed).toHaveBeenCalledWith({}, { fromEmail: source.fromEmail, recipientEmail: source.fromEmail });
  });
  it.each(["old", "missing-date", "missing-sender", "self", "no-reply", "staff"])("preserves legacy behavior for %s", async mode => {
    enable(); const input = { ...source } as any;
    if (mode === "old") input.createdAt = cutoff - 1;
    if (mode === "missing-date") input.createdAt = NaN;
    if (mode === "missing-sender") input.fromEmail = null;
    if (mode === "self") input.fromEmail = "office@example.com";
    if (mode === "no-reply") input.fromEmail = "no-reply@example.com";
    if (mode === "staff") mocks.allowed.mockResolvedValue(false);
    expect(await skipLegacyCustomerEmailDraft({} as any, input)).toBe(false);
  });
  it("an authenticated human can win without modifying the thread target", async () => {
    await arbitrateCustomerEmailHumanReply("actual-thread"); expect(mocks.human).toHaveBeenCalledWith("actual-thread");
  });
  it("a sending/uncertain result rejects a second email", async () => {
    mocks.human.mockRejectedValue(new Error("CUSTOMER_EMAIL_IN_FLIGHT_OR_UNCERTAIN"));
    await expect(arbitrateCustomerEmailHumanReply("actual-thread")).rejects.toMatchObject({ code: "CONFLICT" });
  });
  it("unavailable status fails closed without a sender fallback", async () => {
    mocks.human.mockRejectedValue(new Error("db unavailable")); await expect(arbitrateCustomerEmailHumanReply("actual-thread")).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
  });
  it("private automatic receipts cannot be dismissed by legacy generic card actions", async () => {
    const db = { execute: vi.fn(async () => [[{ quickAction: CUSTOMER_EMAIL_RECEIPT_ACTION }]]), transaction: vi.fn() };
    await expect(createClaudeCustomerReplyGuards({ getDatabase: async () => db as any }).taskCard(12)).rejects.toThrow("CUSTOMER_TASK_CARD_PROTECTED");
  });
  it("ordinary alert cards keep their original action behavior", async () => {
    const db = { execute: vi.fn(async () => [[{ quickAction: "ordinary_alert" }]]), transaction: vi.fn() };
    await expect(createClaudeCustomerReplyGuards({ getDatabase: async () => db as any }).taskCard(12)).resolves.toBeUndefined();
  });
  it("manual Gmail payloads and approval transitions stay in their existing authenticated handlers", () => {
    const gmail = readFileSync("server/gmailRouter.ts", "utf8"); const block = gmail.slice(gmail.indexOf("  sendReply: agentProcedure"), gmail.indexOf("  /** Compose and send a brand-new email */"));
    expect(block).toContain("await arbitrateCustomerEmailHumanReply(input.threadId)"); expect(block.indexOf("await arbitrateCustomerEmailHumanReply")).toBeLessThan(block.indexOf("await sendGmailReply"));
    expect(block).toContain("inReplyToMessageId: input.inReplyToMessageId"); expect(block).toContain("bodyHtml: input.bodyHtml");
    const ops = readFileSync("server/opsChatRouter.ts", "utf8"); const approve = ops.slice(ops.indexOf("  approveEmailDraft: opsChatProcedure"), ops.indexOf("  // Dismiss an email draft"));
    expect(approve).toContain("replyCandidate?.status === \"DRAFT_READY\""); expect(approve.indexOf("await arbitrateCustomerEmailHumanReply")).toBeLessThan(approve.indexOf("// Atomic transition"));
  });
});
