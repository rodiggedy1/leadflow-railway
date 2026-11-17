import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = readFileSync("server/gmailService.ts", "utf8");
function actualFunction(name: string, dependencies: Record<string, unknown>) {
  const ast = ts.createSourceFile("gmailService.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const declaration = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
  if (!declaration) throw new Error("Missing actual helper " + name);
  const js = ts.transpileModule(declaration.getText(ast), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports: Record<string, any> = {};
  vm.runInNewContext(js, { exports, Buffer, console: { log() {}, error() {} }, ...dependencies });
  return exports[name];
}
describe("existing Gmail transport reuse, isolated actual functions", () => {
  it("leaves the original human reply payload unchanged", async () => {
    const send = vi.fn(async (_request: unknown) => ({ data: { id: "sent-1", threadId: "real-thread" } }));
    const fn = actualFunction("sendGmailReply", { getGmailClient: async () => ({ users: { messages: { send } } }) });
    const input = { threadId: "real-thread", to: "customer@example.net", subject: "Cleaning", bodyHtml: "Hi &amp; welcome<br>🧹", inReplyToMessageId: "<original@example.net>" };
    expect(await fn(input)).toEqual({ messageId: "sent-1", threadId: "real-thread" });
    const request = send.mock.calls[0][0] as any;
    expect(request.userId).toBe("me"); expect(request.requestBody.threadId).toBe("real-thread");
    expect(Buffer.from(request.requestBody.raw, "base64url").toString()).toBe("To: customer@example.net\r\nSubject: Re: Cleaning\r\nContent-Type: text/html; charset=utf-8\r\nMIME-Version: 1.0\r\nIn-Reply-To: <original@example.net>\r\nReferences: <original@example.net>\r\n\r\nHi &amp; welcome<br>🧹");
  });
  it("only automatic sends add the loop-protection marker and retain the true RFC/header and Gmail IDs", async () => {
    const send = vi.fn(async (_request: unknown) => ({ data: { id: "outgoing-id", threadId: "gmail-thread" } }));
    const fn = actualFunction("sendGmailReply", { getGmailClient: async () => ({ users: { messages: { send } } }) });
    await fn({ threadId: "gmail-thread", to: "reply@example.net", subject: "Re: Cleaning", bodyHtml: "Thank you 🧹", inReplyToMessageId: "<actual-rfc-id@example.net>", automaticReply: true });
    const request = send.mock.calls[0][0] as any; const raw = Buffer.from(request.requestBody.raw, "base64url").toString();
    expect(raw).toContain("Auto-Submitted: auto-replied\r\n"); expect(raw).toContain("In-Reply-To: <actual-rfc-id@example.net>"); expect(raw).not.toContain("In-Reply-To: gmail-thread"); expect(request.requestBody.threadId).toBe("gmail-thread"); expect(raw.endsWith("Thank you 🧹")).toBe(true);
  });
  it("reuses the existing Gmail account and propagates a send failure without fallback", async () => {
    const send = vi.fn(async () => { throw new Error("Gmail rejected"); });
    const fn = actualFunction("sendGmailReply", { getGmailClient: async () => ({ users: { messages: { send } } }) });
    await expect(fn({ threadId: "real", to: "customer@example.net", subject: "Cleaning", bodyHtml: "Reply", automaticReply: true })).rejects.toThrow("Gmail rejected"); expect(send).toHaveBeenCalledTimes(1);
  });
  it("existing thread reads return their original shape, with raw complete source only when requested", async () => {
    const data = { id: "thread", messages: [{ id: "inbound" }], historyId: "unmodified" };
    const parsed = { id: "inbound", fromEmail: "customer@example.net", from: "Alex", subject: "Cleaning", snippet: "not a source body", date: 1000, isUnread: true };
    const get = vi.fn(async () => ({ data }));
    const fn = actualFunction("getThreadDetail", { getGmailClient: async () => ({ users: { threads: { get } } }), parseMessage: () => parsed, getInboxEmailAddress: async () => "office@example.com" });
    const original = await fn("thread", "existing-read"); expect(original).not.toHaveProperty("sourceSnapshot");
    const capture = await fn("thread", "new-adapter", true); const { sourceSnapshot, ...rest } = capture;
    expect(rest).toEqual(original); expect(sourceSnapshot).toEqual(data); expect(get).toHaveBeenCalledTimes(2);
  });
  it("does not alter attachment or new-email sender functions", () => {
    const from = source.indexOf("export async function sendGmailReplyWithAttachments"); const to = source.indexOf("export async function sendNewGmailEmail", from);
    const existingAttachments = source.slice(from, to);
    expect(existingAttachments).not.toContain("automaticReply"); expect(existingAttachments).not.toContain("claudeCustomerEmail");
  });
});
