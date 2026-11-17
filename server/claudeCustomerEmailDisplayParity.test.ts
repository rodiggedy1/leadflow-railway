import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import * as ts from "typescript";
import { describe, expect, it, vi } from "vitest";

const BASELINE = "7970b1bc01f5f5e3fc9ed872cb226c39f6e7660d";
const PATH = "client/src/pages/CommandChatExactLive.tsx";
const source = readFileSync(PATH, "utf8");
const control = execFileSync("git", ["show", `${BASELINE}:${PATH}`], { encoding: "utf8" });
const parsed = ts.createSourceFile(PATH, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function declaredFunction(name: string) {
  const node = parsed.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
  if (!node) throw new Error(`Missing existing function: ${name}`);
  return node.getText(parsed);
}
function compile(code: string, scope: Record<string, unknown>) {
  const module = { exports: {} as Record<string, any> };
  const output = ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React } }).outputText;
  runInNewContext(output, { module, exports: module.exports, React, Date, ...scope }, { timeout: 1500 });
  return module.exports;
}
const elements = (tree: unknown): React.ReactElement<Record<string, any>>[] => Array.isArray(tree)
  ? tree.flatMap(elements)
  : React.isValidElement<Record<string, any>>(tree) ? [tree, ...elements(tree.props.children)] : [];

function row(thread: Record<string, unknown>) {
  const onOpen = vi.fn();
  const fn = compile(declaredFunction("EmailInboxRow") + "\nexports.row = EmailInboxRow;", {
    emailThreadName: () => "Synthetic email customer", emailThreadSubject: (value: string) => value,
    formatTime: () => "now", dateLabel: () => "today", customerPortraitFor: () => "data:image/png;base64,AAAA",
  }).row;
  const tree = fn({ thread: { threadId: "exact-thread", lastMessageAt: 1, subject: "Request", snippet: "Exact text", ...thread }, onOpen });
  return { tree, onOpen, dot: elements(tree).find(node => node.type === "i")!, html: renderToStaticMarkup(tree) };
}

describe("Email-only response indicator and navigation (offline)", () => {
  it.each([true, false])("an accepted reply is gray regardless of unread=%s", isUnread => {
    const work = row({ isUnread, hasUnanswered: false });
    expect(work.dot.props.className).toBe("");
    expect(work.dot.props["aria-label"]).toBe("Email replied to");
    expect(work.html).not.toContain('class="is-unread"');
  });
  it.each([true, false])("an unanswered or later customer message is green regardless of unread=%s", isUnread => {
    const work = row({ isUnread, hasUnanswered: true });
    expect(work.dot.props.className).toBe("is-unread");
    expect(work.dot.props["aria-label"]).toBe("Email awaiting reply");
  });
  it("does not claim an email was answered when an older cached row lacks response evidence", () => {
    expect(row({ isUnread: false }).dot.props.className).toBe("is-unread");
  });
  it("keeps the existing row click and opens it once without triggering a mutation", () => {
    const work = row({ isUnread: true, hasUnanswered: false });
    expect(work.onOpen).not.toHaveBeenCalled();
    work.tree.props.onClick();
    expect(work.onOpen).toHaveBeenCalledOnce();
  });
  it("keys the existing full email detail by the exact selected thread and preserves the existing close/body contract", () => {
    const Detail = () => null;
    const fn = compile(declaredFunction("ExactEmailWorkspaceOverlay") + "\nexports.overlay = ExactEmailWorkspaceOverlay;", { CommandChatEmailDetail: Detail }).overlay;
    const close = vi.fn();
    const first = fn({ threadId: "first-exact-thread", onClose: close });
    const second = fn({ threadId: "second-exact-thread", onClose: close });
    const again = fn({ threadId: "second-exact-thread", onClose: close });
    const child = (tree: unknown) => elements(tree).find(node => node.type === Detail)!;
    expect(child(first).key).toBe("first-exact-thread");
    expect(child(second).key).toBe("second-exact-thread");
    expect(child(again).key).toBe(child(second).key);
    expect(child(second).props).toEqual({ initialThreadId: "second-exact-thread", onCloseDetail: close, detailOnly: true });
    expect(close).not.toHaveBeenCalled();
    const modal = elements(second).find(node => node.props.role === "dialog")!;
    const stopPropagation = vi.fn(); modal.props.onMouseDown({ stopPropagation });
    expect(stopPropagation).toHaveBeenCalledOnce(); expect(close).not.toHaveBeenCalled();
    second.props.onMouseDown(); expect(close).toHaveBeenCalledOnce();
  });
  it("preserves every other Command Chat byte, including SMS rows, the full SMS drawer, all composer/send actions and stream callbacks", () => {
    const oldDot = '<i className={thread.isUnread ? "is-unread" : ""} />';
    const newDot = '<i className={thread.hasUnanswered !== false ? "is-unread" : ""} aria-label={thread.hasUnanswered === false ? "Email replied to" : "Email awaiting reply"} />';
    const newType = '  messageCount: number;\n  isUnread: boolean;\n  hasUnanswered: boolean;\n};';
    const oldType = '  messageCount: number;\n  isUnread: boolean;\n};';
    const newChild = '<CommandChatEmailDetail key={threadId} initialThreadId={threadId}';
    expect(source.split(newDot)).toHaveLength(2); expect(source.split(newType)).toHaveLength(2); expect(source.split(newChild)).toHaveLength(2);
    expect(source.replace(newDot, oldDot).replace(newType, oldType).replace(newChild, '<CommandChatEmailDetail initialThreadId={threadId}')).toBe(control);
  });
});
