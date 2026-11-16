import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import * as ts from "typescript";

vi.mock("./_core/agentAuth", () => ({ getAgentFromRequest: vi.fn(async () => null) }));
vi.mock("./db", () => ({ getDb: vi.fn(async () => null) }));
vi.mock("./instinct/claudeThumbtackFirstResponse", () => ({ guardClaudeThumbtackManualSend: vi.fn(async () => undefined),
  guardClaudeThumbtackLegacyDraftAction: vi.fn(async () => undefined) }));
import { router, publicProcedure, opsChatProcedure } from "./_core/trpc";
import { getAgentFromRequest } from "./_core/agentAuth";
import { guardClaudeThumbtackManualSend, guardClaudeThumbtackLegacyDraftAction } from "./instinct/claudeThumbtackFirstResponse";
import type { TrpcContext } from "./_core/context";

const handled = vi.fn(async ({ input }: { input: unknown }) => ({ preserved: input }));
const testRouter = router({
  leads: router({
    sendMessage: publicProcedure.input(z.unknown()).mutation(handled),
    sendWorkspaceMessage: publicProcedure.input(z.unknown()).mutation(handled),
    unrelated: publicProcedure.input(z.unknown()).mutation(handled),
    read: publicProcedure.input(z.unknown()).query(handled),
  }),
  opsChat: router({
    approveSmsDraft: opsChatProcedure.input(z.unknown()).mutation(handled),
    dismissSmsDraft: opsChatProcedure.input(z.unknown()).mutation(handled),
    retrySmsDraft: opsChatProcedure.input(z.unknown()).mutation(handled),
    unrelated: opsChatProcedure.input(z.unknown()).mutation(handled),
  }),
});
const context = (owner = true): TrpcContext => ({ user: owner ? { openId: "actual-test-owner" } : null,
  req: { headers: {}, protocol: "https" }, res: {} } as TrpcContext);
let originalEnabled: string | undefined;
let network: ReturnType<typeof vi.fn>;
beforeEach(() => {
  originalEnabled = process.env.THUMBTACK_CLAUDE_FIRST_RESPONSE_ENABLED;
  process.env.THUMBTACK_CLAUDE_FIRST_RESPONSE_ENABLED = "true";
  vi.clearAllMocks();
  vi.mocked(getAgentFromRequest).mockResolvedValue(null);
  vi.mocked(guardClaudeThumbtackManualSend).mockResolvedValue(undefined);
  vi.mocked(guardClaudeThumbtackLegacyDraftAction).mockResolvedValue(undefined);
  network = vi.fn(() => { throw new Error("OFFLINE_NO_PROVIDER"); });
  vi.stubGlobal("fetch", network);
});
afterEach(() => {
  if (originalEnabled === undefined) delete process.env.THUMBTACK_CLAUDE_FIRST_RESPONSE_ENABLED;
  else process.env.THUMBTACK_CLAUDE_FIRST_RESPONSE_ENABLED = originalEnabled;
  expect(network).not.toHaveBeenCalled(); vi.unstubAllGlobals();
});

describe("actual default-off manual-send arbitration", () => {
  it.each([undefined, "false", "1"])("leaves the current manual sender unchanged when enablement is %s", async enabled => {
    if (enabled === undefined) delete process.env.THUMBTACK_CLAUDE_FIRST_RESPONSE_ENABLED;
    else process.env.THUMBTACK_CLAUDE_FIRST_RESPONSE_ENABLED = enabled;
    const input = { sessionId: 71, message: "Human reply", fromNumberId: "the-existing-line" };
    expect(await testRouter.createCaller(context()).leads.sendMessage(input)).toEqual({ preserved: input });
    expect(guardClaudeThumbtackManualSend).not.toHaveBeenCalled(); expect(getAgentFromRequest).not.toHaveBeenCalled();
  });
  it("arbitrates the exact saved session before the original human sender and changes no request field", async () => {
    const order: string[] = [], input = { sessionId: 71, message: "Original human reply", fromNumberId: "the-existing-line", source: "cs_inbox" };
    vi.mocked(guardClaudeThumbtackManualSend).mockImplementationOnce(async () => { order.push("claim"); });
    handled.mockImplementationOnce(async ({ input }) => { order.push("original"); return { preserved: input }; });
    expect(await testRouter.createCaller(context()).leads.sendMessage(input)).toEqual({ preserved: input });
    expect(guardClaudeThumbtackManualSend).toHaveBeenCalledWith({ sessionId: 71, phone: undefined });
    expect(order).toEqual(["claim", "original"]);
  });
  it("arbitrates a workspace destination without inventing a canonical or newest session", async () => {
    const input = { phone: "+12025550123", message: "Human workspace reply", name: "Saved customer" };
    expect(await testRouter.createCaller(context()).leads.sendWorkspaceMessage(input)).toEqual({ preserved: input });
    expect(guardClaudeThumbtackManualSend).toHaveBeenCalledWith({ sessionId: undefined, phone: input.phone });
  });
  it.each(["AUTO_FIRST_RESPONSE_IN_FLIGHT", "AUTO_FIRST_RESPONSE_REVIEW_REQUIRED"])("prevents overlapping provider submission for %s", async reason => {
    vi.mocked(guardClaudeThumbtackManualSend).mockRejectedValueOnce(new Error(reason));
    await expect(testRouter.createCaller(context()).leads.sendMessage({ sessionId: 71, message: "Human reply" })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(handled).not.toHaveBeenCalled();
  });
  it("fails closed without exposing storage errors and never invokes the original sender", async () => {
    vi.mocked(guardClaudeThumbtackManualSend).mockRejectedValueOnce(new Error("PRIVATE_DATABASE_DETAILS"));
    await expect(testRouter.createCaller(context()).leads.sendWorkspaceMessage({ phone: "+12025550123", message: "Human reply" })).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR", message: "The lead's first-response status could not be checked. No SMS was sent.",
    });
    expect(handled).not.toHaveBeenCalled();
  });
  it("does not allow an unauthenticated public request to cancel an automatic first reply", async () => {
    const input = { sessionId: 71, message: "Original request" };
    expect(await testRouter.createCaller(context(false)).leads.sendMessage(input)).toEqual({ preserved: input });
    expect(guardClaudeThumbtackManualSend).not.toHaveBeenCalled();
  });
  it("reuses actual agent authentication rather than accepting a caller-supplied role", async () => {
    vi.mocked(getAgentFromRequest).mockResolvedValueOnce({ agentId: 5, agentName: "Existing agent", agentEmail: "staff@example.test", isAdmin: false } as never);
    await testRouter.createCaller(context(false)).leads.sendMessage({ sessionId: 71, message: "Human reply", isAdmin: true });
    expect(getAgentFromRequest).toHaveBeenCalledWith(expect.objectContaining({ headers: {} }));
    expect(guardClaudeThumbtackManualSend).toHaveBeenCalledTimes(1);
  });
  it.each([{ sessionId: -1, message: "Text" }, { sessionId: 71, message: "" }, { sessionId: 71, message: "Text", source: "other" },
    { sessionId: 71, message: "Text", fromNumberId: 3 }, { sessionId: 71, message: "Text", isVoiceCommand: "yes" },
    { sessionId: 71, message: "x".repeat(1601) }])("never changes pending state for invalid existing send input %#", async input => {
    await testRouter.createCaller(context()).leads.sendMessage(input);
    expect(guardClaudeThumbtackManualSend).not.toHaveBeenCalled();
  });
  it("leaves unrelated mutation and query paths alone, even while automatic first replies are enabled", async () => {
    const caller = testRouter.createCaller(context());
    await caller.leads.unrelated({ phone: "+12025550123", message: "Text" });
    await caller.leads.read({ sessionId: 71, message: "Text" });
    expect(guardClaudeThumbtackManualSend).not.toHaveBeenCalled(); expect(getAgentFromRequest).not.toHaveBeenCalled();
  });
  it.each(["sendMessage", "sendWorkspaceMessage"] as const)("forwards explicit Claude draft provenance unchanged through the existing %s guard", async route => {
    const claudeDraftSource = { requestId: "00112233-4455-4677-8899-aabbccddeeff", kind: "sms_reply" };
    const input = route === "sendMessage" ? { sessionId: 71, message: "Reviewed reply", claudeDraftSource }
      : { phone: "+12025550123", message: "Reviewed reply", claudeDraftSource };
    expect(await testRouter.createCaller(context()).leads[route](input)).toEqual({ preserved: input });
    expect(guardClaudeThumbtackManualSend).toHaveBeenCalledTimes(1);
  });
  it("keeps baseline manual guard schemas and all router bytes outside the two approved attribution seams", () => {
    const baseline = execFileSync("git", ["show", "fe1f39700bc537b72c34ec1742ed4bf4c20042ef:server/routers.ts"], { encoding: "utf8" });
    let mounted = readFileSync("server/routers.ts", "utf8")
      .replace('import { claudeCustomerTasksRouter } from "./claudeCustomerTasksRouter";\n', "")
      .replace('  claudeCustomerTasks: claudeCustomerTasksRouter,\n', "")
      .replace("import { claudeDraftSourceSchema, reviewedClaudeSmsProvenance, type SmsSenderProvenance } from '../shared/smsSenderProvenance';\n", "");
    const procedure = (text: string, name: string) => {
      const ast = ts.createSourceFile("routers.ts", text, ts.ScriptTarget.Latest, true);
      const matches: string[] = [];
      const visit = (node: ts.Node) => {
        if (ts.isPropertyAssignment(node) && node.name.getText(ast) === name && node.initializer.getText(ast).startsWith("publicProcedure")) matches.push(node.getText(ast));
        ts.forEachChild(node, visit);
      };
      visit(ast); expect(matches).toHaveLength(1); return matches[0];
    };
    for (const name of ["sendMessage", "sendWorkspaceMessage"]) mounted = mounted.replace(procedure(mounted, name), procedure(baseline, name));
    expect(mounted).toBe(baseline);
    const middleware = readFileSync("server/_core/trpc.ts", "utf8");
    const compact = (text: string) => text.replace(/\/\/[^\n]*/g, "").replace(/\s/g, "");
    for (const name of ["sendMessage", "sendWorkspaceMessage"]) {
      const existing = baseline.match(new RegExp(`${name}: publicProcedure\\s*\\.input\\(z\\.object\\((\\{[\\s\\S]*?\\})\\)\\)`))![1];
      const added = middleware.match(new RegExp(`"leads\\.${name}": z\\.object\\((\\{[\\s\\S]*?\\})\\)`))![1];
      expect(compact(added)).toBe(compact(existing));
    }
  });
});

describe("automatic send receipts are not legacy review drafts", () => {
  it.each(["approveSmsDraft", "dismissSmsDraft", "retrySmsDraft"] as const)("protects an automatic record from %s even after disablement", async action => {
    process.env.THUMBTACK_CLAUDE_FIRST_RESPONSE_ENABLED = "false";
    vi.mocked(guardClaudeThumbtackLegacyDraftAction).mockRejectedValueOnce(new Error("AUTO_FIRST_RESPONSE_PROTECTED"));
    await expect(testRouter.createCaller(context()).opsChat[action]({ draftId: 91 })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(guardClaudeThumbtackLegacyDraftAction).toHaveBeenCalledWith(91);
    expect(handled).not.toHaveBeenCalled();
  });
  it.each(["approveSmsDraft", "dismissSmsDraft", "retrySmsDraft"] as const)("preserves ordinary Madison input/output for %s", async action => {
    const input = { draftId: 91, approvedText: "Unchanged human draft", approvedBy: "Existing staff" };
    expect(await testRouter.createCaller(context()).opsChat[action](input)).toEqual({ preserved: input });
    expect(guardClaudeThumbtackLegacyDraftAction).toHaveBeenCalledWith(91);
  });
  it("authenticates before any protected-record read and rejects client-supplied staff flags", async () => {
    await expect(testRouter.createCaller(context(false)).opsChat.dismissSmsDraft({ draftId: 91, isOwner: true })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(guardClaudeThumbtackLegacyDraftAction).not.toHaveBeenCalled(); expect(handled).not.toHaveBeenCalled();
  });
  it("leaves session-only dismissal and unrelated staff actions unchanged", async () => {
    const caller = testRouter.createCaller(context());
    await caller.opsChat.dismissSmsDraft({ sessionId: 71, dismissedBy: "Existing staff" });
    await caller.opsChat.unrelated({ draftId: 91 });
    expect(guardClaudeThumbtackLegacyDraftAction).not.toHaveBeenCalled();
  });
});
