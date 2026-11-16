import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
vi.mock("./_core/agentAuth", () => ({ getAgentFromRequest: vi.fn(async () => null) }));
vi.mock("./db", () => ({ getDb: vi.fn(async () => null) }));
vi.mock("./instinct/claudeCustomerSmsManualGuard", () => ({ guardClaudeCustomerManualSend: vi.fn(async () => undefined), guardClaudeCustomerLegacyDraftAction: vi.fn(async () => undefined), guardClaudeCustomerTaskCardAction: vi.fn(async () => undefined) }));
import { router, publicProcedure, opsChatProcedure } from "./_core/trpc";
import { getAgentFromRequest } from "./_core/agentAuth";
import { guardClaudeCustomerManualSend, guardClaudeCustomerLegacyDraftAction, guardClaudeCustomerTaskCardAction } from "./instinct/claudeCustomerSmsManualGuard";
const handled = vi.fn(async ({ input }: any) => input);
const app = router({ leads: router({ sendMessage: publicProcedure.input(z.unknown()).mutation(handled), sendWorkspaceMessage: publicProcedure.input(z.unknown()).mutation(handled), other: publicProcedure.input(z.unknown()).mutation(handled) }), opsChat: router({ approveSmsDraft: opsChatProcedure.input(z.unknown()).mutation(handled), dismissSmsDraft: opsChatProcedure.input(z.unknown()).mutation(handled), retrySmsDraft: opsChatProcedure.input(z.unknown()).mutation(handled), dismissSystemCard: opsChatProcedure.input(z.unknown()).mutation(handled) }) });
const ctx = (staff = true): any => ({ user: staff ? { openId: "staff-actual" } : null, req: { headers: {} }, res: {} });
beforeEach(() => { vi.clearAllMocks(); vi.stubEnv("CLAUDE_CUSTOMER_SMS_ENABLED", "true"); vi.mocked(getAgentFromRequest).mockResolvedValue(null); vi.mocked(guardClaudeCustomerManualSend).mockResolvedValue(undefined); vi.mocked(guardClaudeCustomerLegacyDraftAction).mockResolvedValue(undefined); vi.mocked(guardClaudeCustomerTaskCardAction).mockResolvedValue(undefined); });
afterEach(() => vi.unstubAllEnvs());
describe("customer automation and unchanged manual send", () => {
  it.each(["false", "1", ""])("does no new guard work when disabled %s", async enabled => { vi.stubEnv("CLAUDE_CUSTOMER_SMS_ENABLED", enabled); const input = { sessionId: 71, message: "Human reply" }; expect(await app.createCaller(ctx()).leads.sendMessage(input)).toEqual(input); expect(guardClaudeCustomerManualSend).not.toHaveBeenCalled(); });
  it("arbitrates before human send without changing the original message or receiving line", async () => { const order: string[] = []; vi.mocked(guardClaudeCustomerManualSend).mockImplementationOnce(async () => { order.push("guard"); }); handled.mockImplementationOnce(async ({ input }) => { order.push("human"); return input; }); const input = { sessionId: 71, message: "Original human reply", fromNumberId: "actual-line" }; expect(await app.createCaller(ctx()).leads.sendMessage(input)).toEqual(input); expect(order).toEqual(["guard", "human"]); expect(guardClaudeCustomerManualSend).toHaveBeenCalledWith({ sessionId: 71, phone: undefined }); });
  it("does not accept fake staff authority from a public request", async () => { await app.createCaller(ctx(false)).leads.sendMessage({ sessionId: 71, message: "Text", isAdmin: true }); expect(guardClaudeCustomerManualSend).not.toHaveBeenCalled(); });
  it("uses the real existing agent login", async () => { vi.mocked(getAgentFromRequest).mockResolvedValueOnce({ agentId: 4 } as never); await app.createCaller(ctx(false)).leads.sendWorkspaceMessage({ phone: "+12025550123", message: "Text" }); expect(guardClaudeCustomerManualSend).toHaveBeenCalledWith({ sessionId: undefined, phone: "+12025550123" }); });
  it.each([{ sessionId: -1, message: "Text" }, { sessionId: 71, message: "" }, { sessionId: 71, message: "Text", source: "bad" }])("leaves invalid original input %# untouched", async input => { await app.createCaller(ctx()).leads.sendMessage(input); expect(guardClaudeCustomerManualSend).not.toHaveBeenCalled(); });
  it("never checks unrelated actions", async () => { await app.createCaller(ctx()).leads.other({ sessionId: 71 }); expect(guardClaudeCustomerManualSend).not.toHaveBeenCalled(); });
  it("blocks overlapping or uncertain submission without revealing storage details", async () => { vi.mocked(guardClaudeCustomerManualSend).mockRejectedValueOnce(new Error("CUSTOMER_REPLY_IN_FLIGHT_OR_UNCERTAIN")); await expect(app.createCaller(ctx()).leads.sendMessage({ sessionId: 71, message: "Text" })).rejects.toMatchObject({ code: "CONFLICT" }); expect(handled).not.toHaveBeenCalled(); });
});
describe("namespaced customer receipt is not a legacy review draft", () => {
  it.each(["approveSmsDraft", "dismissSmsDraft", "retrySmsDraft"] as const)("protects %s after feature disablement", async action => { vi.stubEnv("CLAUDE_CUSTOMER_SMS_ENABLED", "false"); vi.mocked(guardClaudeCustomerLegacyDraftAction).mockRejectedValueOnce(new Error("CUSTOMER_REPLY_RECEIPT_PROTECTED")); await expect(app.createCaller(ctx()).opsChat[action]({ draftId: 5 })).rejects.toMatchObject({ code: "CONFLICT" }); expect(handled).not.toHaveBeenCalled(); });
  it("does not read receipts for unauthenticated callers", async () => { await expect(app.createCaller(ctx(false)).opsChat.dismissSmsDraft({ draftId: 5 })).rejects.toMatchObject({ code: "UNAUTHORIZED" }); expect(guardClaudeCustomerLegacyDraftAction).not.toHaveBeenCalled(); });
  it("preserves ordinary Madison action payloads", async () => { const input = { draftId: 5, approvedText: "Same manual draft" }; expect(await app.createCaller(ctx()).opsChat.approveSmsDraft(input)).toEqual(input); });
});

describe("canonical tasks cannot be dismissed as generic alerts", () => {
  it("protects a task entry even when customer SMS is disabled", async () => {
    vi.stubEnv("CLAUDE_CUSTOMER_SMS_ENABLED", "false");
    vi.mocked(guardClaudeCustomerTaskCardAction).mockRejectedValueOnce(new Error("CUSTOMER_TASK_CARD_PROTECTED"));
    await expect(app.createCaller(ctx()).opsChat.dismissSystemCard({ messageId: 101 })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(handled).not.toHaveBeenCalled();
  });
  it("preserves ordinary system-alert dismissal", async () => {
    expect(await app.createCaller(ctx()).opsChat.dismissSystemCard({ messageId: 101 })).toEqual({ messageId: 101 });
    expect(guardClaudeCustomerTaskCardAction).toHaveBeenCalledWith(101);
  });
  it("authenticates before the task-card guard", async () => {
    await expect(app.createCaller(ctx(false)).opsChat.dismissSystemCard({ messageId: 101 })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(guardClaudeCustomerTaskCardAction).not.toHaveBeenCalled();
  });
});
