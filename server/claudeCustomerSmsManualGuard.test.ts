import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
vi.mock("./_core/agentAuth", () => ({ getAgentFromRequest: vi.fn(async () => null) }));
vi.mock("./db", () => ({ getDb: vi.fn(async () => null) }));
vi.mock("./instinct/claudeThumbtackFirstResponse", () => ({ guardClaudeThumbtackManualSend: vi.fn(async () => undefined), guardClaudeThumbtackLegacyDraftAction: vi.fn(async () => undefined) }));
vi.mock("./instinct/claudeCustomerSmsManualGuard", () => ({ guardClaudeCustomerManualSend: vi.fn(async () => undefined), guardClaudeCustomerLegacyDraftAction: vi.fn(async () => undefined), guardClaudeCustomerTaskCardAction: vi.fn(async () => undefined) }));
import { router, publicProcedure, opsChatProcedure } from "./_core/trpc";
import { getAgentFromRequest } from "./_core/agentAuth";
import { guardClaudeCustomerManualSend, guardClaudeCustomerLegacyDraftAction, guardClaudeCustomerTaskCardAction } from "./instinct/claudeCustomerSmsManualGuard";
const handled = vi.fn(async ({ input }: any) => input);
const app = router({ leads: router({ sendMessage: publicProcedure.input(z.unknown()).mutation(handled), sendWorkspaceMessage: publicProcedure.input(z.unknown()).mutation(handled), other: publicProcedure.input(z.unknown()).mutation(handled) }), opsChat: router({ approveSmsDraft: opsChatProcedure.input(z.unknown()).mutation(handled), dismissSmsDraft: opsChatProcedure.input(z.unknown()).mutation(handled), retrySmsDraft: opsChatProcedure.input(z.unknown()).mutation(handled), dismissSystemCard: opsChatProcedure.input(z.unknown()).mutation(handled) }) });
const ctx = (staff = true): any => ({ user: staff ? { openId: "staff-actual" } : null, req: { headers: {} }, res: {} });
beforeEach(() => { vi.clearAllMocks(); vi.stubEnv("CLAUDE_CUSTOMER_SMS_ENABLED", "true"); vi.stubEnv("CLAUDE_CUSTOMER_SMS_START_AT", "2026-11-16T18:00:00Z"); vi.stubEnv("CLAUDE_CUSTOMER_SMS_ALLOWED_PHONE", "+12025550123"); vi.stubEnv("CLAUDE_CUSTOMER_SMS_TEST_CUSTOMER_OVERRIDE", "false"); vi.stubEnv("THUMBTACK_CLAUDE_FIRST_RESPONSE_ENABLED", "false"); vi.mocked(getAgentFromRequest).mockResolvedValue(null); vi.mocked(guardClaudeCustomerManualSend).mockResolvedValue(undefined); vi.mocked(guardClaudeCustomerLegacyDraftAction).mockResolvedValue(undefined); vi.mocked(guardClaudeCustomerTaskCardAction).mockResolvedValue(undefined); });
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


describe("real one-phone manual arbitration", () => {
  async function fixture(sessionRows: unknown[] = [{ leadPhone: "+12025550123" }], receipts: unknown[] = []) {
    const { createClaudeCustomerReplyGuards } = await vi.importActual<typeof import("./instinct/claudeCustomerSmsManualGuard")>("./instinct/claudeCustomerSmsManualGuard");
    const execute = vi.fn(async (_query: import("drizzle-orm").SQL): Promise<unknown> => [sessionRows]);
    const tx = { execute };
    const db = { execute: vi.fn(async (_query: import("drizzle-orm").SQL): Promise<unknown> => [[]]), transaction: vi.fn(async <T>(fn: (tx: { execute: typeof execute }) => Promise<T>): Promise<T> => fn(tx)) };
    const getDatabase = vi.fn(async () => db);
    execute.mockResolvedValueOnce([sessionRows]).mockResolvedValue([receipts]);
    return { execute, db, getDatabase, guards: createClaudeCustomerReplyGuards({ getDatabase }) };
  }
  it.each(["+13029816191", "+12025550124", "Jane +12025550123", "+12025550123,+13029816191", "bad"])("passes nonpilot workspace destination %s without acquiring database", async phone => {
    const f = await fixture(); f.getDatabase.mockRejectedValue(new Error("no database/key"));
    await expect(f.guards.humanSend({ phone })).resolves.toBeUndefined();
    expect(f.getDatabase).not.toHaveBeenCalled(); expect(f.db.transaction).not.toHaveBeenCalled();
  });
  it.each([{ CLAUDE_CUSTOMER_SMS_ENABLED: "false" }, { CLAUDE_CUSTOMER_SMS_ALLOWED_PHONE: undefined }, { CLAUDE_CUSTOMER_SMS_START_AT: undefined }, { CLAUDE_CUSTOMER_SMS_ALLOWED_PHONE: "+12025550123,+13029816191" }])("preserves normal manual behavior when configuration is disabled/incomplete %#", async patch => {
    const f = await fixture(); for (const [key, value] of Object.entries(patch)) vi.stubEnv(key, value);
    await expect(f.guards.humanSend({ sessionId: 71 })).resolves.toBeUndefined();
    await expect(f.guards.humanSend({ phone: "+12025550123" })).resolves.toBeUndefined();
    expect(f.getDatabase).not.toHaveBeenCalled();
  });
  it("looks up only the exact supplied session and returns before reading receipts for a nonpilot", async () => {
    const f = await fixture([{ leadPhone: "+13029816191" }]);
    await f.guards.humanSend({ sessionId: 71 }); expect(f.execute).toHaveBeenCalledTimes(1);
    const { MySqlDialect } = await import("drizzle-orm/mysql-core");
    const query = new MySqlDialect().sqlToQuery(f.execute.mock.calls[0][0]);
    expect(query.sql).toBe("SELECT leadPhone FROM conversation_sessions WHERE id = ?"); expect(query.params).toEqual([71]);
  });
  it.each([{ rows: [] }, { rows: [{ leadPhone: "+12025550123" }, { leadPhone: "+12025550124" }] }])("never picks a sibling or newest row from missing/ambiguous exact lookup %#", async ({ rows }) => {
    const f = await fixture(rows); await f.guards.humanSend({ sessionId: 71 }); expect(f.execute).toHaveBeenCalledTimes(1);
  });
  it("protects an in-flight pilot reply with no send or automatic retry", async () => {
    const f = await fixture([{ leadPhone: "+12025550123" }], [{ id: 5, status: "SENDING" }]);
    await expect(f.guards.humanSend({ sessionId: 71 })).rejects.toThrow("CUSTOMER_REPLY_IN_FLIGHT_OR_UNCERTAIN");
    expect(f.getDatabase).toHaveBeenCalledTimes(1); expect(f.execute).toHaveBeenCalledTimes(2);
  });
  it("lets the human win only the pilot pending receipt", async () => {
    const f = await fixture([{ leadPhone: "+12025550123" }], [{ id: 5, status: "TOOLS_RUNNING" }]);
    await f.guards.humanSend({ sessionId: 71 }); expect(f.execute).toHaveBeenCalledTimes(3);
    const { MySqlDialect } = await import("drizzle-orm/mysql-core");
    const query = new MySqlDialect().sqlToQuery(f.execute.mock.calls[2][0]);
    expect(query.sql).toContain("HUMAN_REPLY_WON"); expect(query.params).toContain(5);
  });
  it("keeps pilot session arbitration unchanged with the approved classification override", async () => {
    vi.stubEnv("CLAUDE_CUSTOMER_SMS_TEST_CUSTOMER_OVERRIDE", "true");
    const f = await fixture([{ leadPhone: "+12025550123" }], [{ id: 5, status: "SENDING" }]);
    await expect(f.guards.humanSend({ sessionId: 71 })).rejects.toThrow("CUSTOMER_REPLY_IN_FLIGHT_OR_UNCERTAIN");
  });
  it("retains legacy receipt and task-card protection after disablement", async () => {
    vi.stubEnv("CLAUDE_CUSTOMER_SMS_ENABLED", "false"); const f = await fixture();
    const { CLAUDE_CUSTOMER_REPLY_CAPABILITY, CLAUDE_CUSTOMER_TASK_ACTION } = await import("../shared/claudeCustomerTasks");
    f.db.execute.mockResolvedValueOnce([[{ capability: CLAUDE_CUSTOMER_REPLY_CAPABILITY }]] as never);
    await expect(f.guards.legacyDraft(5)).rejects.toThrow("CUSTOMER_REPLY_RECEIPT_PROTECTED");
    f.db.execute.mockResolvedValueOnce([[{ quickAction: CLAUDE_CUSTOMER_TASK_ACTION }]] as never);
    await expect(f.guards.taskCard(101)).rejects.toThrow("CUSTOMER_TASK_CARD_PROTECTED");
    expect(f.getDatabase).toHaveBeenCalledTimes(2);
  });
});
