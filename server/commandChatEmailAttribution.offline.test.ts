import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import * as ts from "typescript";
import * as icons from "lucide-react";
import { describe, expect, it, vi } from "vitest";

// OFFLINE ONLY: execute actual client TSX with synthetic records and injected
// hooks/tRPC/sanitizer fixtures. Never import application/router/auth/DB/provider.
const BASELINE = "7970b1bc01f5f5e3fc9ed872cb226c39f6e7660d";
const componentPath = "client/src/pages/CommandChatEmailDetail.tsx";
const source = readFileSync(componentPath, "utf8");
const control = execFileSync("git", ["show", `${BASELINE}:${componentPath}`], { encoding: "utf8" });
const styles = readFileSync("client/src/pages/command-chat-email-detail.css", "utf8");
const INBOX = "office@example.test";
const CUSTOMER = "customer@example.test";
const NOW = 1_800_000_000_000;
const popupSanitizerOptions = { USE_PROFILES: { html: true }, FORBID_ATTR: ["style", "color", "bgcolor"] };
type Message = { id: string; from?: string; fromEmail?: string; replyToEmail?: string; date?: number; bodyText?: string; bodyHtml?: string; snippet?: string; sentBy?: { name: string; photoUrl: string | null } | null };
type Element = React.ReactElement<Record<string, any>>;
const nodes = (tree: unknown): Element[] => Array.isArray(tree) ? tree.flatMap(nodes) : React.isValidElement<Record<string, any>>(tree) ? [tree, ...nodes(tree.props.children)] : [];
const text = (tree: unknown): string => typeof tree === "string" || typeof tree === "number" ? String(tree) : Array.isArray(tree) ? tree.map(text).join("") : React.isValidElement<Record<string, any>>(tree) ? text(tree.props.children) : "";
const hasClass = (node: Element, className: string) => String(node.props.className ?? "").split(" ").includes(className);
const withClass = (tree: unknown, className: string) => nodes(tree).filter(node => hasClass(node, className));
const button = (tree: unknown, label: string) => nodes(tree).find(node => node.type === "button" && text(node) === label)!;
const inbound = (id = "received", extra: Partial<Message> = {}): Message => ({ id, from: "Synthetic Customer", fromEmail: CUSTOMER, replyToEmail: "replyto@example.test", date: NOW, bodyText: "Customer question", ...extra });
const outbound = (id: string, sentBy?: Message["sentBy"], extra: Partial<Message> = {}): Message => ({ id, from: "Shared Office", fromEmail: INBOX, date: NOW + 1, bodyText: "Same reply text: Instinct drafted this", sentBy, ...extra });
const saved = (name: string) => ({ name, photoUrl: null });

function harness(messages: Message[], options: { input?: string; popup?: boolean; inboxEmail?: string; htmlFixtures?: Map<string, string> } = {}) {
  const input = options.input ?? source;
  const popup = options.popup ?? true;
  const detail = { from: "Synthetic Customer", fromEmail: CUSTOMER, inboxEmail: options.inboxEmail ?? INBOX, subject: "[From: hidden] Synthetic subject", messages };
  const slots: any[] = [];
  let cursor = 0;
  let sendCallbacks: any;
  let resolveCallbacks: any;
  const send = vi.fn();
  const resolve = vi.fn();
  const dismiss = vi.fn();
  const close = vi.fn();
  const listInvalidate = vi.fn();
  const threadInvalidate = vi.fn();
  const refetch = vi.fn(async () => ({ data: detail }));
  const toastError = vi.fn();
  const draft = { id: 81, generatedDraft: "Entire existing Madison draft\nSecond line", intentSummary: "Existing intent" };
  const sanitize = vi.fn((html: string, config: unknown) => {
    expect(config).toEqual(popup ? popupSanitizerOptions : { USE_PROFILES: { html: true } });
    if (!options.htmlFixtures?.has(html)) throw new Error("HTML requires an explicit offline sanitizer fixture");
    return options.htmlFixtures.get(html)!;
  });
  const query = vi.fn(() => ({ data: detail, isLoading: false, error: null, refetch }));
  const inboxQuery = vi.fn(() => ({ data: { inboxEmail: INBOX, threads: [] }, isLoading: false }));
  const draftQuery = vi.fn(() => ({ data: draft }));
  const bookingQuery = vi.fn(() => ({ data: { booking: null }, isLoading: false }));
  const api = {
    useUtils: () => ({ opsChat: { listEmailInboxThreads: { invalidate: listInvalidate } }, gmail: { getThread: { invalidate: threadInvalidate } } }),
    opsChat: { listEmailInboxThreads: { useQuery: inboxQuery }, getEmailDraftByThreadId: { useQuery: draftQuery }, dismissEmailDraft: { useMutation: () => ({ mutate: dismiss }) } },
    gmail: {
      getThread: { useQuery: query }, getBookingContext: { useQuery: bookingQuery },
      sendReply: { useMutation: (callbacks: any) => { sendCallbacks = callbacks; return { mutate: send, isPending: false }; } },
      completeThread: { useMutation: (callbacks: any) => { resolveCallbacks = callbacks; return { mutate: resolve, isPending: false }; } },
    },
  };
  const react = { ...React,
    useState(initial: any) { const index = cursor++; if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial; return [slots[index], (next: any) => { slots[index] = typeof next === "function" ? next(slots[index]) : next; }]; },
    useMemo: (factory: () => unknown) => factory(),
  };
  const ast = ts.createSourceFile("CommandChatEmailDetail.tsx", input, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const functionNames = ast.statements.filter(ts.isFunctionDeclaration).map(node => node.name!.text);
  const compiled = ts.transpileModule(input + `\nexports.localFunctions = [${functionNames.join(",")}];`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true } }).outputText;
  const module = { exports: {} as { default: (props: any) => Element; localFunctions: Function[] } };
  runInNewContext(compiled, { module, exports: module.exports, React: react, Date, Set, Map, Intl, require: (id: string) => {
    if (id === "react") return react;
    if (id === "dompurify") return { sanitize };
    if (id === "lucide-react") return icons;
    if (id === "sonner") return { toast: { error: toastError } };
    if (id === "@/lib/trpc") return { trpc: api };
    if (id.endsWith(".css")) return {};
    throw new Error(`Forbidden offline client import: ${id}`);
  } });
  const expand = (tree: any, path = "root"): any => {
    if (Array.isArray(tree)) return tree.map((child, index) => {
      const expanded = expand(child, `${path}.${index}`);
      return React.isValidElement(expanded) ? React.cloneElement(expanded, { key: expanded.key ?? `${path}.${index}` }) : expanded;
    });
    if (!React.isValidElement<Record<string, any>>(tree)) return tree;
    if (module.exports.localFunctions.includes(tree.type as Function)) return expand((tree.type as Function)(tree.props), `${path}.component`);
    return React.cloneElement(tree, {}, expand(tree.props.children, `${path}.children`));
  };
  const render = () => { cursor = 0; return expand(module.exports.default({ initialThreadId: "synthetic-thread", detailOnly: popup, onCloseDetail: close })); };
  const edit = (value: string) => withClass(render(), "em2-compose-textarea")[0].props.onChange({ target: { value } });
  const html = () => renderToStaticMarkup(render());
  return { render, html, edit, send, resolve, dismiss, close, listInvalidate, threadInvalidate, refetch, sanitize, toastError, query, inboxQuery, draftQuery, bookingQuery, draft,
    sendSuccess: () => { sendCallbacks.onSuccess(); send.mock.calls.at(-1)![1].onSuccess(); },
    sendFailure: () => sendCallbacks.onError(new Error("Synthetic send failure")),
    resolveSuccess: () => resolveCallbacks.onSuccess(),
  };
}

function attribution(tree: unknown, popup = true) {
  return withClass(tree, popup ? "em2-thread-entry" : "em2-email-message").map(entry => ({
    key: entry.key,
    name: text(withClass(entry, "em2-msg-name")[0]),
    initials: text(withClass(entry, "em2-small-avatar")[0]),
    outgoing: hasClass(entry, "outgoing"),
  }));
}

describe("Command Chat email saved outbound attribution (offline actual rendered TSX)", () => {
  it.each([true, false])("renders saved automatic Instinct and human names, retaining unknown You and incoming identity (popup=%s)", popup => {
    const messages = [inbound(), outbound("automatic", saved("Instinct")), outbound("human", saved("Alex Morgan")), outbound("unknown"), outbound("null", null), outbound("blank", saved("   ")), inbound("incoming-marker", { sentBy: saved("Instinct"), bodyText: "Instinct drafted this" })];
    const work = harness(messages, { popup });
    const rendered = work.render();
    const byId = new Map(attribution(rendered, popup).map(value => [value.key, value]));
    expect(byId.get("automatic")).toMatchObject({ name: "Instinct", initials: "I", outgoing: true });
    expect(byId.get("human")).toMatchObject({ name: "Alex Morgan", initials: "AM", outgoing: true });
    for (const key of ["unknown", "null", "blank"]) expect(byId.get(key)).toMatchObject({ name: "You", initials: "Y", outgoing: true });
    expect(byId.get("incoming-marker")).toMatchObject({ name: "Synthetic Customer", initials: "SC", outgoing: false });
    const html = renderToStaticMarkup(rendered);
    expect(html).toContain('<span class="em2-msg-name">Instinct</span>');
    expect(html).toContain('<span class="em2-msg-name">Alex Morgan</span>');
    expect(html).toContain('<span class="em2-msg-name">You</span>');
    expect(work.send).not.toHaveBeenCalled();
    expect(work.resolve).not.toHaveBeenCalled();
    expect(work.dismiss).not.toHaveBeenCalled();
  });

  it("does not infer Instinct from matching reply text, from name, missing address, or unproven inbox direction", () => {
    const messages = [inbound(), outbound("same-text", null, { from: "Instinct" }), inbound("no-address", { fromEmail: undefined, sentBy: saved("Instinct") }), outbound("case-insensitive", saved("Sam Rivera"), { fromEmail: INBOX.toUpperCase() })];
    const values = attribution(harness(messages).render());
    expect(values.find(value => value.key === "same-text")).toMatchObject({ name: "You", initials: "Y" });
    expect(values.find(value => value.key === "no-address")).toMatchObject({ name: "Synthetic Customer", outgoing: false });
    expect(values.find(value => value.key === "case-insensitive")).toMatchObject({ name: "Sam Rivera", initials: "SR", outgoing: true });
    const unproven = attribution(harness([outbound("no-inbox", saved("Instinct"), { from: "Shared Office" })], { inboxEmail: "" }).render());
    expect(unproven).toEqual([{ key: "no-inbox", name: "Shared Office", initials: "SO", outgoing: false }]);
  });

  it("proves the current-main control hardcodes both saved authors as You and the candidate changes attribution only", () => {
    const messages = [inbound(), outbound("automatic", saved("Instinct")), outbound("human", saved("Alex Morgan"))];
    const oldValues = attribution(harness(messages, { input: control }).render());
    const newValues = attribution(harness(messages).render());
    expect(oldValues.filter(value => value.outgoing).map(value => value.name)).toEqual(["You", "You"]);
    expect(newValues.filter(value => value.outgoing).map(value => value.name)).toEqual(["Instinct", "Alex Morgan"]);
    expect(newValues.map(({ name, initials, ...rest }) => rest)).toEqual(oldValues.map(({ name, initials, ...rest }) => rest));
  });

  it("retains every complete long HTML entry in the one popup body owner with unchanged ordering and sanitizer calls", () => {
    const htmlFixtures = new Map<string, string>();
    const messages = Array.from({ length: 8 }, (_, index) => {
      const paragraphs = Array.from({ length: 100 }, (_, paragraph) => `<p>Complete message ${index} paragraph ${paragraph}: retained customer history and full reply content.</p>`).join("");
      const raw = `<div style="color:black" bgcolor="#fff">${paragraphs}<hr><blockquote>Quoted history ${index}</blockquote><table><tbody><tr><td>Table ${index}</td></tr></tbody></table><a href="https://example.test/history/${index}">Link ${index}</a><script>unsafe fixture</script></div>`;
      const safe = `<div>${paragraphs}<hr><blockquote>Quoted history ${index}</blockquote><table><tbody><tr><td>Table ${index}</td></tr></tbody></table><a href="https://example.test/history/${index}">Link ${index}</a></div>`;
      htmlFixtures.set(raw, safe);
      return index % 2 ? outbound(`history-${index}`, saved(index === 1 ? "Instinct" : "Alex Morgan"), { bodyHtml: raw }) : inbound(`history-${index}`, { bodyHtml: raw });
    });
    const work = harness(messages, { htmlFixtures });
    const tree = work.render();
    const owners = withClass(tree, "em2-msg-body-scroll-owner");
    expect(owners).toHaveLength(1);
    expect(withClass(tree, "em2-email-message")).toHaveLength(0);
    expect(withClass(tree, "em2-main-tabs")).toHaveLength(0);
    const entries = withClass(owners[0], "em2-thread-entry");
    expect(entries).toHaveLength(messages.length);
    expect(entries.map(entry => entry.key)).toEqual(["history-6", "history-0", "history-1", "history-2", "history-3", "history-4", "history-5", "history-7"]);
    expect(work.sanitize).toHaveBeenCalledTimes(messages.length);
    const html = renderToStaticMarkup(tree);
    for (const [index, message] of messages.entries()) {
      const entry = entries.find(value => value.key === message.id)!;
      const body = withClass(entry, "em2-html-email-body")[0];
      expect(body.props.dangerouslySetInnerHTML.__html).toBe(htmlFixtures.get(message.bodyHtml!));
      expect(html).toContain(htmlFixtures.get(message.bodyHtml!)!);
      for (let paragraph = 0; paragraph < 100; paragraph++) expect(html).toContain(`Complete message ${index} paragraph ${paragraph}:`);
    }
    expect(html).not.toContain("unsafe fixture");
    expect(html).not.toContain('style="color:black"');
    expect(withClass(owners[0], "em2-composer")).toHaveLength(0);
    expect(withClass(tree, "em2-composer")).toHaveLength(1);
    const controlWork = harness(messages, { input: control, htmlFixtures });
    const controlTree = controlWork.render();
    expect(attribution(tree).map(value => value.key)).toEqual(attribution(controlTree).map(value => value.key));
    expect(work.sanitize.mock.calls).toEqual(controlWork.sanitize.mock.calls);
    const normalizedHtml = (value: string) => value.replace(/(<span class="em2-msg-name">)(Instinct|Alex Morgan)(<\/span>)/g, "$1You$3").replace(/(<div class="em2-small-avatar out">)(I|AM)(<\/div>)/g, "$1Y$3");
    expect(normalizedHtml(html)).toBe(renderToStaticMarkup(controlTree));
    expect(styles).toMatch(/\.ccc-live-email-workspace-modal \.em2-thread\s*\{[^}]*overflow:hidden/);
    expect(styles).toContain(".ccc-live-email-workspace-modal .em2-msg-body-scroll-owner{overflow-y:auto}");
    expect(styles).toContain("grid-template-rows:minmax(0,1fr)");
    expect(styles).toMatch(/\.ccc-live-email-workspace-modal \.em2-composer\s*\{[^}]*flex:0 0 auto/);
    expect(styles).toContain(".ccc-live-email-workspace-modal .em2-html-email-body,.ccc-live-email-workspace-modal .em2-html-email-body *{color:#dbe6ef!important}");
  });

  it.each([source, control])("keeps the same manual send payload, draft/composer callbacks, success celebration, and explicit resolve lifecycle", input => {
    const work = harness([inbound(), outbound("automatic", saved("Instinct"))], { input });
    let tree = work.render();
    expect(button(tree, "Send Reply").props.disabled).toBe(true);
    button(tree, "Insert Draft").props.onClick();
    expect(withClass(work.render(), "em2-compose-textarea")[0].props.value).toBe(work.draft.generatedDraft);
    work.edit("Manual reply\nSecond line");
    tree = work.render();
    expect(button(tree, "Send Reply").props.disabled).toBe(false);
    button(tree, "Send Reply").props.onClick();
    expect(work.send).toHaveBeenCalledTimes(1);
    expect(work.send.mock.calls[0][0]).toEqual({ threadId: "synthetic-thread", to: "replyto@example.test", subject: "Synthetic subject", bodyHtml: "Manual reply<br>Second line" });
    work.sendSuccess();
    expect(withClass(work.render(), "em2-compose-textarea")[0].props.value).toBe("");
    expect(work.listInvalidate).toHaveBeenCalledTimes(1);
    expect(work.threadInvalidate).toHaveBeenCalledWith({ threadId: "synthetic-thread" });
    expect(work.html()).toContain("Your reply is on its way.");
    button(work.render(), "Done").props.onClick();
    expect(work.html()).not.toContain("Your reply is on its way.");
    button(work.render(), "✓ Resolve").props.onClick();
    expect(work.resolve).toHaveBeenCalledWith({ threadId: "synthetic-thread" });
    work.resolveSuccess();
    expect(work.dismiss).toHaveBeenCalledWith({ draftId: 81, dismissedBy: "agent" });
    expect(work.close).toHaveBeenCalledTimes(1);
    expect(work.listInvalidate).toHaveBeenCalledTimes(2);
    expect(work.query.mock.calls[0]).toEqual([{ threadId: "synthetic-thread" }, { enabled: true, staleTime: 60_000, refetchOnWindowFocus: false }]);
  });

  it.each([source, control])("retains keyboard sending, error text/reply preservation, and draft dismissal", input => {
    const work = harness([inbound()], { input });
    work.edit("Kept on error");
    const preventDefault = vi.fn();
    withClass(work.render(), "em2-compose-textarea")[0].props.onKeyDown({ key: "Enter", ctrlKey: true, metaKey: false, preventDefault });
    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(work.send).toHaveBeenCalledTimes(1);
    work.sendFailure();
    expect(work.toastError).toHaveBeenCalledWith("Synthetic send failure");
    expect(withClass(work.render(), "em2-compose-textarea")[0].props.value).toBe("Kept on error");
    const dismiss = nodes(work.render()).find(node => node.props["aria-label"] === "Dismiss draft")!;
    dismiss.props.onClick();
    expect(withClass(work.render(), "em2-ai-draft")).toHaveLength(0);
    expect(work.dismiss).not.toHaveBeenCalled();
  });

  it("leaves all original source byte-for-byte intact outside the approved sender type/name/initials edits", () => {
    const restored = source
      .replace('  sentBy?: { name: string; photoUrl: string | null } | null;\n', "")
      .replace(/          const outboundName = message\.sentBy\?\.name\?\.trim\(\) \|\| "You";\n/g, "")
      .replace(/        const outboundName = message\.sentBy\?\.name\?\.trim\(\) \|\| "You";\n/g, "")
      .replaceAll('outbound ? initialsFor(outboundName) : messageInitials', 'outbound ? "Y" : messageInitials')
      .replaceAll('outbound ? outboundName : (message.from || senderName)', 'outbound ? "You" : (message.from || senderName)');
    expect(restored).toBe(control);
  });
});
