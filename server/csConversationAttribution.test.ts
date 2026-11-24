import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { projectAcceptedCustomerSmsSenders } from "./instinct/customerSmsAttribution";
import { smsSenderLabel, reviewedClaudeSmsProvenance, automaticClaudeSmsProvenance } from "../shared/smsSenderProvenance";

const PHONE = "+12025550123", BUSINESS = "+12025550999", LINE = "PN_SYNTHETIC";
const sessions = [{ id: 42, leadPhone: PHONE }];
const binding = { account: "openphone", sessionId: 42, providerMessageId: "OM_IN", fromPhone: PHONE,
  receivingPhoneNumberId: LINE, receivingPhoneNumber: BUSINESS, inboundText: "Wednesday in the morning" };
const receipt = (changes: Record<string, unknown> = {}) => ({ id: 9, sessionId: 42, fromPhone: PHONE,
  capability: "claude_customer_reply_v1", capabilityVersion: 1, status: "SENT", sentAt: new Date("2026-11-23T23:27:00Z"),
  inboundOpenPhoneId: "OM_IN", originalMessage: binding.inboundText, resolvedContext: binding,
  generatedDraft: "Wednesday morning works as your preference. What exact time?", approvedText: "Wednesday morning works as your preference. What exact time?",
  sendPolicyMode: "automatic", outboundOpenPhoneId: "OM_AUTO", ...changes });
const outgoing = (changes: Record<string, unknown> = {}) => ({ role: "assistant", content: receipt().generatedDraft,
  opMsgId: "OM_AUTO", senderName: "Rohan Gilkes", ts: 12345, media: ["synthetic.invalid/image"], notes: "untouched",
  fromNumberId: LINE, from: BUSINESS, to: [PHONE], ...changes });
function port(rows: unknown[]) {
  const queries: { sql: string; params: unknown[] }[] = [];
  const execute = vi.fn(async (query: Parameters<typeof projectAcceptedCustomerSmsSenders>[0] extends {execute: (q: infer Q) => any} ? Q : never) => {
    const parsed = new MySqlDialect().sqlToQuery(query); queries.push(parsed);
    expect(parsed.sql.trim()).toMatch(/^SELECT /); expect(parsed.sql).not.toMatch(/\bUPDATE\b|\bINSERT\b|\bDELETE\b/);
    return [rows, []];
  });
  return { execute, queries };
}
let network: ReturnType<typeof vi.spyOn>;
beforeEach(() => { network = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("OFFLINE_ONLY")); });
afterEach(() => { expect(network).not.toHaveBeenCalled(); vi.restoreAllMocks(); });

describe("read-only accepted automatic SMS attribution", () => {
  it.each(["webhook-first", "acceptance-first-late-webhook", "history-sync"])("labels exact accepted output as Instinct after %s without altering saved history", async () => {
    const turn = outgoing(), manual = outgoing({ opMsgId: "OM_MANUAL" }), inbound = { role: "user", content: "Hello", opMsgId: "OM_AUTO", senderName: "Customer" };
    const raw = JSON.stringify([turn, manual, inbound]); const db = port([receipt()]);
    const result = JSON.parse(await projectAcceptedCustomerSmsSenders(db, sessions, raw));
    expect(result).toEqual([{ ...turn, senderName: "Instinct" }, manual, inbound]);
    expect(smsSenderLabel(result[0], "Rohan Gilkes")).toBe("Instinct"); expect(smsSenderLabel(result[1], "Rohan Gilkes")).toBe("Rohan Gilkes");
    expect(turn.senderName).toBe("Rohan Gilkes"); expect(JSON.stringify([turn, manual, inbound])).toBe(raw);
    expect(db.execute).toHaveBeenCalledTimes(1);
    expect(db.queries[0].params).toEqual(["claude_customer_reply_v1", 42, "OM_AUTO", "OM_MANUAL"]);
  });
  it.each(["ordinary response", "Your first-cleaning quote is $275. Extras: No add-ons selected."])("uses receipts, never message wording: %s", async content => {
    const raw = JSON.stringify([outgoing({ content })]); const db = port([receipt({ generatedDraft: content, approvedText: content })]);
    expect(JSON.parse(await projectAcceptedCustomerSmsSenders(db, sessions, raw))[0].senderName).toBe("Instinct");
  });
  it("handles the actual minimal webhook shape after acceptance and preserves already-correct acceptance-first history byte-for-byte", async () => {
    const minimal = { role: "assistant", content: receipt().generatedDraft, ts: 12345, senderName: "Rohan Gilkes", opMsgId: "OM_AUTO" };
    const raw = JSON.stringify([minimal]);
    expect(await projectAcceptedCustomerSmsSenders(port([]), sessions, raw)).toBe(raw);
    expect(JSON.parse(await projectAcceptedCustomerSmsSenders(port([receipt()]), sessions, raw))).toEqual([{ ...minimal, senderName: "Instinct" }]);
    const alreadyCorrect = JSON.stringify([outgoing({ senderName: "Instinct" })]);
    expect(await projectAcceptedCustomerSmsSenders(port([receipt()]), sessions, alreadyCorrect)).toBe(alreadyCorrect);
  });
  it("projects a receipt owned only by an included sibling and sends all exact session IDs in one batch", async () => {
    const siblingBinding = { ...binding, sessionId: 43 };
    const db = port([receipt({ sessionId: 43, resolvedContext: siblingBinding })]);
    const raw = JSON.stringify([outgoing()]);
    expect(JSON.parse(await projectAcceptedCustomerSmsSenders(db, [...sessions, { id: 43, leadPhone: PHONE }], raw))[0].senderName).toBe("Instinct");
    expect(db.execute).toHaveBeenCalledTimes(1);
    expect(db.queries[0].params).toEqual(["claude_customer_reply_v1", 42, 43, "OM_AUTO"]);
  });
  it.each([
    { status: "SENDING" }, { status: "DISMISSED" }, { sentAt: null }, { capability: "thumbtack_first_response" },
    { capabilityVersion: 2 }, { sessionId: 43 }, { fromPhone: "+12025550124" }, { sendPolicyMode: "approval_required" },
    { inboundOpenPhoneId: "OM_OTHER_IN" }, { originalMessage: "different inbound" }, { outboundOpenPhoneId: "OM_OTHER_OUT" },
    { generatedDraft: "different draft" }, { approvedText: "edited manual text" }, { resolvedContext: "bad json" },
    { resolvedContext: { ...binding, sessionId: 43 } }, { resolvedContext: { ...binding, fromPhone: "+12025550124" } },
    { resolvedContext: { ...binding, receivingPhoneNumberId: "PN_OTHER" } },
    { resolvedContext: { ...binding, receivingPhoneNumber: "+12025550998" } }, { resolvedContext: { ...binding, account: "other" } },
  ])("does not relabel a receipt with conflicting or unaccepted evidence: %j", async changes => {
    const raw = JSON.stringify([outgoing()]); expect(await projectAcceptedCustomerSmsSenders(port([receipt(changes)]), sessions, raw)).toBe(raw);
  });
  it.each([
    { role: "user" }, { content: "same ID, different content" }, { providerMessageId: "OM_OTHER" }, { sessionId: 43 },
    { fromNumberId: "PN_OTHER" }, { from: "+12025550998" }, { to: ["+12025550124"] }, { to: [PHONE, "+12025550124"] },
    { direction: "incoming" }, { metadata: "bad json" }, { metadata: { receivingPhoneNumberId: "PN_OTHER" } },
    { smsProvenance: reviewedClaudeSmsProvenance({ requestId: "00000000-0000-4000-8000-000000000001", kind: "sms_reply" }, "Rohan Gilkes") },
    { smsProvenance: automaticClaudeSmsProvenance(9, "OM_AUTO") },
  ])("preserves conflicting routing and existing staff/provenance labels: %j", async changes => {
    const raw = JSON.stringify([outgoing(changes)]); expect(await projectAcceptedCustomerSmsSenders(port([receipt()]), sessions, raw)).toBe(raw);
  });
  it.each(["openPhoneId", "openPhoneMessageId", "providerMessageId"])("uses existing nested provider-ID convention: %s", async key => {
    const turn = outgoing(); delete (turn as any).opMsgId; (turn as any).metadata = JSON.stringify({ [key]: "OM_AUTO" });
    expect(JSON.parse(await projectAcceptedCustomerSmsSenders(port([receipt()]), sessions, JSON.stringify([turn])))[0]).toEqual({ ...turn, senderName: "Instinct" });
  });
  it("refuses ambiguous receipts, absent receipts and phone-only/same-text classification", async () => {
    const raw = JSON.stringify([outgoing()]);
    for (const rows of [[], [receipt(), receipt({ id: 10 })]]) expect(await projectAcceptedCustomerSmsSenders(port(rows), sessions, raw)).toBe(raw);
    expect(await projectAcceptedCustomerSmsSenders(port([receipt()]), [{ id: 43, leadPhone: PHONE }], raw)).toBe(raw);
  });
  it("preserves the conversation if optional attribution lookup fails; malformed/no-phone/no-provider histories query nothing", async () => {
    const raw = JSON.stringify([outgoing()]); const failed = { execute: vi.fn(async () => { throw Error("unavailable"); }) };
    expect(await projectAcceptedCustomerSmsSenders(failed, sessions, raw)).toBe(raw);
    for (const [history, scope] of [["bad json", sessions], ["[]", sessions], [raw, [{ id: 42, leadPhone: null }]], [JSON.stringify([{role: "assistant", content: "Manual", senderName: "Rohan"}]), sessions]] as const) {
      const db = port([]); expect(await projectAcceptedCustomerSmsSenders(db, [...scope], history)).toBe(history); expect(db.execute).not.toHaveBeenCalled();
    }
  });
  it("accepts serialized stored binding and delivered receipts without treating label changes as delivery writes", async () => {
    const db = port([receipt({ status: "DELIVERED", resolvedContext: JSON.stringify(binding) })]);
    expect(JSON.parse(await projectAcceptedCustomerSmsSenders(db, sessions, JSON.stringify([outgoing()])))[0].senderName).toBe("Instinct");
    expect(db.execute).toHaveBeenCalledTimes(1);
  });
});

// Execute ONLY the actual existing query arrow, not the app/router module.
const routerSource = readFileSync(new URL("./routers.ts", import.meta.url), "utf8");
const ast = ts.createSourceFile("routers.ts", routerSource, ts.ScriptTarget.Latest, true);
const candidates: ts.ArrowFunction[] = [];
function visit(node: ts.Node) {
  if (ts.isPropertyAssignment(node) && node.name.getText(ast) === "getCsConversation" && ts.isCallExpression(node.initializer)) {
    const arrow = node.initializer.arguments[0]; if (ts.isArrowFunction(arrow)) candidates.push(arrow);
  }
  ts.forEachChild(node, visit);
}
visit(ast); if (candidates.length !== 1) throw Error("Expected exactly one getCsConversation query");
function query(db: any) {
  const exports = {} as { run: (args: { input: { sessionId: number } }) => Promise<any> };
  const code = ts.transpileModule(`exports.run = ${candidates[0].getText(ast)};`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  runInNewContext(code, { exports, getDb: async () => db, projectAcceptedCustomerSmsSenders, sql,
    conversationSessions: { id: "id", leadPhone: "phone", leadSource: "source", messageHistory: "history", updatedAt: "updatedAt" },
    eq: () => null, and: () => null, or: () => null, console: { log: vi.fn(), error: vi.fn() }, Date });
  return exports.run({ input: { sessionId: 42 } });
}
describe("actual getCsConversation display projection", () => {
  it.each(["no-phone", "single", "merged"])("projects only returned author metadata in the %s branch, with no writes", async branch => {
    const raw = JSON.stringify([outgoing()]); const primary = { id: 42, leadPhone: branch === "no-phone" ? null : PHONE, leadName: "Synthetic customer", messageHistory: raw };
    const sibling = { id: 43, messageHistory: JSON.stringify([outgoing({ senderName: "OpenPhone" }), { role: "user", content: "Second message", ts: 20000 }]) };
    const selections = [[primary], branch === "merged" ? [primary, sibling] : [primary]];
    const db: any = port([receipt()]); const originalExecute = db.execute;
    db.execute = vi.fn(async (q: any) => new MySqlDialect().sqlToQuery(q).sql.includes("FROM voice_calls") ? [[], []] : originalExecute(q));
    db.select = vi.fn(() => { const result = selections.shift()!; const chain: any = { from: () => chain, where: () => chain, limit: async () => result, then: (resolve: any) => Promise.resolve(result).then(resolve) }; return chain; });
    db.update = db.insert = db.transaction = vi.fn(() => { throw Error("READ_ONLY"); });
    const result = await query(db), turns = JSON.parse(result.messageHistory);
    expect(turns[0]).toEqual(branch === "no-phone" ? outgoing() : outgoing({ senderName: "Instinct" }));
    expect(result.sessionId).toBe(42); expect(result.leadPhone).toBe(primary.leadPhone); expect(result.calls).toEqual([]);
    expect(turns).toHaveLength(branch === "merged" ? 2 : 1); expect(primary.messageHistory).toBe(raw);
    expect(db.update).not.toHaveBeenCalled(); expect(originalExecute).toHaveBeenCalledTimes(branch === "no-phone" ? 0 : 1);
  });
});
