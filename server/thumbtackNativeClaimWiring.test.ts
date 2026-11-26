import { describe, expect, it, vi } from "vitest";
import { withoutApprovedCommandChatLoad } from "./commandChatLoadSourceControl";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { runInNewContext } from "node:vm";
import * as ts from "typescript";
import { z } from "zod";
import { initTRPC, TRPCError } from "@trpc/server";
const BASE = "aa29a0fbaaae49c1f3fcbf50ea057c77ef10115f";
function property(source: string, name: string) {
  const ast = ts.createSourceFile("router.ts", source, ts.ScriptTarget.Latest, true); const found: string[] = [];
  function visit(node: ts.Node) {
    if (ts.isPropertyAssignment(node) && node.name.getText(ast) === name) found.push(node.initializer.getText(ast));
    ts.forEachChild(node, visit);
  }
  visit(ast); expect(found).toHaveLength(1); return found[0];
}
function mounted() {
  const getDb = vi.fn(async () => ({}));
  const native = vi.fn(async () => ({ success: true, claimedBy: "Synthetic Agent", claimedAt: 1, messageId: 31, sessionId: 41 }));
  const broadcast = vi.fn();
  const t = initTRPC.context<{ opsCaller: { id: string; name: string; isOwner: boolean } }>().create();
  const initializer = property(readFileSync("server/opsChatRouter.ts", "utf8"), "claimLead");
  const code = ts.transpileModule(`exports.claim = ${initializer};`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const scope: any = { exports: {}, opsChatProcedure: t.procedure, getDb, z, TRPCError, broadcastOpsUpdate: broadcast,
    opsChatMessages: { metadata: "metadata", id: "id" }, eq: (left: unknown, right: unknown) => ({ left, right }),
    require: (id: string) => { if (id === "./thumbtackNativeClaim") return { claimNativeThumbtackLead: native }; throw Error("UNEXPECTED_IMPORT"); } };
  runInNewContext(code, scope);
  const router = t.router({ claim: scope.exports.claim });
  const caller = router.createCaller({ opsCaller: { id: "7", name: "Synthetic Agent", isOwner: false } }) as unknown as {
    claim: (input: { messageId: number; sessionId?: number; nativeNegotiationId?: string }) => Promise<any>;
  };
  return { getDb, native, broadcast, caller };
}

describe("native-only claim wiring, without importing the application router", () => {
  it("uses the negotiation identity even when the UI card ID is a synthetic negative number", async () => {
    const h = mounted();
    expect(await h.caller.claim({ messageId: -875044204, sessionId: 999, nativeNegotiationId: "offline-negotiation" })).toMatchObject({ success: true, messageId: 31, sessionId: 41 });
    expect(h.native).toHaveBeenCalledWith({}, "offline-negotiation", { id: "7", name: "Synthetic Agent", isOwner: false });
    expect(h.broadcast).toHaveBeenCalledWith("lead_update");
  });
  it("does not broadcast a successful claim when the native card is already owned", async () => {
    const h = mounted(); h.native.mockResolvedValueOnce({ success: false, alreadyClaimedBy: "Existing Agent" } as never);
    expect(await h.caller.claim({ messageId: -1, nativeNegotiationId: "offline-negotiation" })).toMatchObject({ success: false });
    expect(h.broadcast).not.toHaveBeenCalled();
  });
  it("rejects unavailable DB without running the native resolver", async () => {
    const h = mounted(); h.getDb.mockResolvedValueOnce(null as never);
    await expect(h.caller.claim({ messageId: -1, nativeNegotiationId: "offline-negotiation" })).rejects.toMatchObject({ message: "DB unavailable" });
    expect(h.native).not.toHaveBeenCalled();
  });
  it("does not let an ordinary claim invoke the native path", async () => {
    const h = mounted(); h.getDb.mockResolvedValueOnce({ select: () => ({ from: () => ({ where: () => ({ limit: async () => [] }) }) }) } as never);
    // Provide only the ordinary lookup symbols; no production router imports execute.
    await expect(h.caller.claim({ messageId: 31 })).rejects.toMatchObject({ code: "NOT_FOUND", message: "Message not found" });
    expect(h.native).not.toHaveBeenCalled();
  });
  it("retains the original ordinary claim body byte-for-byte", () => {
    const current = property(readFileSync("server/opsChatRouter.ts", "utf8"), "claimLead");
    const original = property(execFileSync("git", ["show", `${BASE}:server/opsChatRouter.ts`], { encoding: "utf8" }), "claimLead");
    const body = (s: string) => s.slice(s.indexOf("      const claimedAt = Date.now();"));
    expect(body(current)).toBe(body(original));
    expect(property(readFileSync("server/opsChatRouter.ts", "utf8"), "unclaimLead")).toBe(property(execFileSync("git", ["show", `${BASE}:server/opsChatRouter.ts`], { encoding: "utf8" }), "unclaimLead"));
  });
  it("leaves every other server router byte unchanged", () => {
    const current = withoutApprovedCommandChatLoad("server/opsChatRouter.ts", readFileSync("server/opsChatRouter.ts", "utf8"));
    const original = execFileSync("git", ["show", `${BASE}:server/opsChatRouter.ts`], { encoding: "utf8" });
    const repaired = current.replace(property(current, "claimLead"), property(original, "claimLead"));
    expect(repaired).toBe(original);
  });
  it("adds native identity only to the existing Claim action and changes no other client behavior", () => {
    const current = readFileSync("client/src/pages/CommandChatExactLive.tsx", "utf8");
    const original = execFileSync("git", ["show", `${BASE}:client/src/pages/CommandChatExactLive.tsx`], { encoding: "utf8" });
    const repaired = current.replace('claimCommandLead.mutate({ messageId: lead.id, ...(lead.sessionId ? { sessionId: lead.sessionId } : {}),\n      ...(lead.negotiationId ? { nativeNegotiationId: lead.negotiationId } : {}) });', 'claimCommandLead.mutate({ messageId: lead.id, ...(lead.sessionId ? { sessionId: lead.sessionId } : {}) });');
    expect(repaired).toBe(original);
  });
  it("does not include SMS, AI, migration, automatic replay, or job-data dependencies in the helper", () => {
    const source = readFileSync("server/thumbtackNativeClaim.ts", "utf8");
    expect(source).not.toMatch(/sendSms|invokeLLM|dispatchClaude|setInterval|setTimeout|cleanerJobs|cleaner_jobs|CREATE TABLE|ALTER TABLE/);
  });
});
