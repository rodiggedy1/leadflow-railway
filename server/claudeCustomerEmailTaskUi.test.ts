import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { execFileSync } from "node:child_process";
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { runInNewContext } from "node:vm";
import * as ts from "typescript";
import * as icons from "lucide-react";
import { describe, expect, it, vi } from "vitest";
import * as contract from "../shared/claudeCustomerTasks";
import type { CustomerTask } from "../shared/claudeCustomerTasks";

// LOCAL ONLY: actual client TSX, injected React/tRPC, synthetic records only.
// Never import the app/router, authentication, DB, Gmail, provider or model.
const BASELINE = "b463959d6573a1078fa27eb57c4d2b35280c0d10";
const componentPath = "client/src/components/ClaudeCustomerTasks.tsx";
const pagePath = "client/src/pages/CommandChatExactLive.tsx";
const source = readFileSync(componentPath, "utf8");
const page = readFileSync(pagePath, "utf8");
const baseline = (path: string) => execFileSync("git", ["show", `${BASELINE}:${path}`], { encoding: "utf8" });
const controlSource = baseline(componentPath);
const controlPage = baseline(pagePath);
const NOW = 1_800_000_000_000;
const actor = { id: "regular-agent-openid", name: "Synthetic nonadmin staff" };
const confirmer = { id: "confirming-agent", name: "Actual confirming staff" };
const actions = () => ({ claim: vi.fn(async (_id: number) => {}), completeItem: vi.fn(async (_id: number, _itemId: string) => {}), complete: vi.fn(async (_id: number, _note: string) => {}) });
type EmailTask = Extract<CustomerTask, { email: unknown }>;
type SmsTask = Extract<CustomerTask, { sessionId: number }>;
function sms(overrides: Partial<SmsTask> = {}): SmsTask {
  return contract.customerTaskSchema.parse({
    id: 701, version: 1, kind: "claude_customer_task", sessionId: 42,
    customerName: "Synthetic customer", customerPhone: "+13015550123",
    receivingPhoneNumberId: "PN_SYNTHETIC_LINE", receivingPhoneNumber: "+13015550987",
    sourceMessageId: "OM_SYNTHETIC_REQUEST", sourceText: "Please add the oven.\nKeep these exact words.", receivedAt: NOW - 60_000,
    title: "Review oven request", items: [{ id: "oven", title: "Handle oven request", evidenceQuote: "add the oven", completedBy: null, completedAt: null }],
    status: "unclaimed", owner: null, claimedAt: null, completedAt: null, completedBy: null, completionNote: null,
    reply: { text: "Our staff will review this request.", status: "prepared", providerMessageId: null },
    activity: [{ action: "created", actor: null, at: NOW - 60_000, note: null }], ...overrides,
  }) as SmsTask;
}
function email(overrides: Partial<EmailTask> = {}): EmailTask {
  return contract.customerTaskSchema.parse({
    ...sms(), id: 702, sessionId: null, customerPhone: null, receivingPhoneNumberId: null, receivingPhoneNumber: null,
    sourceMessageId: "19_SYNTHETIC_GMAIL_MESSAGE_ID",
    sourceText: "  Please add the oven.\n\n<script>literal customer text, not HTML</script>\nKeep my exact spacing.  ",
    email: { mailboxEmail: "office@example.test", threadId: "19_SYNTHETIC_EXACT_GMAIL_THREAD", fromEmail: "real.sender+request@example.test",
      replyToEmail: "different.replyto@example.test", recipientEmail: "different.recipient@example.test", subject: "Internal subject not a visible identity", rfcMessageId: "<SYNTHETIC_RFC_MESSAGE_ID@example.test>" },
    ...overrides,
  }) as EmailTask;
}
type Element = React.ReactElement<Record<string, any>>;
const nodes = (tree: unknown): Element[] => Array.isArray(tree) ? tree.flatMap(nodes) : React.isValidElement<Record<string, any>>(tree) ? [tree, ...nodes(tree.props.children)] : [];
const text = (tree: unknown): string => typeof tree === "string" || typeof tree === "number" ? String(tree) : Array.isArray(tree) ? tree.map(text).join("") : React.isValidElement<Record<string, any>>(tree) ? text(tree.props.children) : "";
const button = (tree: unknown, label: string) => nodes(tree).find(node => node.type === "button" && text(node) === label)!;
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
const dialog = ({ open, children }: any) => open ? React.createElement("div", { role: "dialog" }, children) : null;
const div = ({ children }: any) => React.createElement("div", null, children);
const popupSanitizerOptions = { USE_PROFILES: { html: true }, FORBID_ATTR: ["style", "color", "bgcolor"] };
const sanitizer = { sanitize: vi.fn((_value: string, _options: unknown): string => { throw new Error("HTML needs an explicitly injected sanitizer fixture"); }) };
function compile(code: string, scope: Record<string, unknown>) {
  const module = { exports: {} as Record<string, any> };
  runInNewContext(ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true } }).outputText,
    { module, exports: module.exports, Date, Intl, Map, Set, Error, Number, ...scope }, { timeout: 1500 });
  return module.exports;
}
function harness(api: any = {}, initialContext?: unknown, input = source) {
  const slots = new Map<string, unknown[]>();
  let key = ""; let cursor = 0; let context = initialContext;
  const react = { ...React,
    useState(initial: unknown) {
      const values = slots.get(key)!; const index = cursor++;
      if (!(index in values)) values[index] = typeof initial === "function" ? (initial as () => unknown)() : initial;
      return [values[index], (next: unknown) => { values[index] = typeof next === "function" ? (next as (value: unknown) => unknown)(values[index]) : next; }];
    },
    useRef(initial: unknown) { const values = slots.get(key)!; const index = cursor++; if (!(index in values)) values[index] = { current: initial }; return values[index]; },
    useContext: () => context,
  };
  const ui = compile(input, { require: (id: string) => {
    if (id === "react") return react;
    if (id === "dompurify") return sanitizer;
    if (id === "lucide-react") return icons;
    if (id === "@/lib/trpc") return { trpc: api };
    if (id === "@shared/claudeCustomerTasks") return contract;
    if (id === "@/components/ui/dialog") return { Dialog: dialog, DialogContent: div, DialogDescription: div, DialogTitle: div };
    if (id.endsWith(".css")) return {};
    throw new Error(`Forbidden offline UI import: ${id}`);
  } });
  const render = (name: string, props: Record<string, unknown>, instance = name): Element => {
    key = instance; cursor = 0; if (!slots.has(key)) slots.set(key, []); return ui[name](props);
  };
  const expand = (tree: any, path = "root"): any => {
    if (Array.isArray(tree)) return tree.map((child, index) => {
      const expanded = expand(child, `${path}.${index}`);
      return React.isValidElement(expanded) ? React.cloneElement(expanded, { key: expanded.key ?? `${path}.${index}` }) : expanded;
    });
    if (!React.isValidElement<Record<string, any>>(tree)) return tree;
    const name = Object.keys(ui).find(name => ui[name] === tree.type);
    if (name) return expand(render(name, tree.props, path), `${path}.${name}`);
    if (tree.type === dialog) return tree.props.open ? React.createElement("div", { role: "dialog" }, expand(tree.props.children, `${path}.dialog`)) : null;
    if (tree.type === div) return React.createElement("div", null, expand(tree.props.children, `${path}.div`));
    return React.cloneElement(tree, {}, expand(tree.props.children, `${path}.children`));
  };
  return { ui, render, expand, setContext: (value: unknown) => { context = value; } };
}
const ast = (input: string) => ts.createSourceFile("page.tsx", input, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function route(inbox: Record<string, unknown>[] = [], input = page) {
  const parsed = ast(input);
  const helper = parsed.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "taskConversation")!;
  const overlay = parsed.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "ExactEmailWorkspaceOverlay")!;
  let callback: ts.VariableDeclaration | undefined; let gate: ts.JsxSelfClosingElement | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(parsed) === "openSmsDrawerFromTask") callback = node;
    if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(parsed) === "ExactEmailWorkspaceOverlay") gate = node;
    ts.forEachChild(node, visit);
  }; visit(parsed);
  expect(callback).toBeDefined(); expect(gate).toBeDefined();
  const state = { selectedEmailThreadId: null as string | null, selectedSmsConversation: null as unknown };
  const setters = Object.fromEntries(["setSelectedLeadCardPhone", "setSelectedLeadCardDraft", "setSelectedLeadCardSnapshot", "setSelectedLeadDetail", "showNotice"].map(name => [name, vi.fn()]));
  const setSelectedEmailThreadId = vi.fn((value: string | null) => { state.selectedEmailThreadId = value; });
  const setSelectedSmsConversation = vi.fn((value: unknown) => { state.selectedSmsConversation = value; });
  const detail = vi.fn(({ initialThreadId, detailOnly }: any) => React.createElement("div", { "data-existing-email-detail": initialThreadId, "data-detail-only": detailOnly }));
  const exported = compile(helper.getText(parsed) + "\nconst " + callback!.getText(parsed) + ";\n" + overlay.getText(parsed)
    + `\nexports.open = openSmsDrawerFromTask; exports.overlay = (selectedEmailThreadId) => selectedEmailThreadId && (${gate!.getText(parsed)});`,
    { React, smsInbox: inbox, ...setters, setSelectedEmailThreadId, setSelectedSmsConversation, useCallback: (fn: unknown) => fn, CommandChatEmailDetail: detail });
  return { open: exported.open as (task: CustomerTask) => void, state, setters: { ...setters, setSelectedEmailThreadId, setSelectedSmsConversation }, detail,
    html: () => renderToStaticMarkup(exported.overlay(state.selectedEmailThreadId)) };
}
function rig(task: CustomerTask, input = source, inbox: Record<string, unknown>[] = [], routeInput = page) {
  const open = route(inbox, routeInput); const a = actions();
  const get = vi.fn(() => ({ data: task, isLoading: false, isError: false }));
  const api = { useUtils: () => ({}), claudeCustomerTasks: {
    identity: { useQuery: vi.fn(() => ({ data: actor, isLoading: false, isError: false })) },
    list: { useQuery: vi.fn(() => ({ data: [task], isLoading: false, isError: false })) }, get: { useQuery: get },
    ...Object.fromEntries(["claim", "completeItem", "complete"].map(name => [name, { useMutation: () => ({}) }])),
  } };
  const work = harness(api, undefined, input);
  const provider = work.render("ClaudeCustomerTasksProvider", { callerId: "DO_NOT_TRUST_NUMERIC_PROP", children: null, onOpenConversation: open.open });
  const context = { ...provider.props.value, actions: a };
  work.setContext(context);
  const render = (placement: "queue" | "stream", pending = false) => {
    context.pendingIds = pending ? new Set([task.id]) : new Set();
    let tree = work.expand(work.render(placement === "queue" ? "ClaudeCustomerTasksQueue" : "ClaudeCustomerTaskStreamCard", placement === "queue" ? {} : { taskId: task.id }), placement);
    if (placement === "queue" && task.status === "done" && !nodes(tree).some(node => node.props.className === "cct-card-status")) {
      button(tree, "Done1").props.onClick();
      tree = work.expand(work.render("ClaudeCustomerTasksQueue", {}), placement);
    }
    return tree;
  };
  return { ...work, open, a, context, api, get, render, html: (placement: "queue" | "stream", pending = false) => renderToStaticMarkup(render(placement, pending)) };
}

describe("Email task in the existing queue and canonical command stream (offline)", () => {
  it.each(["queue", "stream"] as const)("shows the saved EMAIL or SMS source in the closed %s header in every task status", placement => {
    for (const channel of ["EMAIL", "SMS"] as const) for (const status of ["unclaimed", "claimed", "done"] as const) {
      const overrides = { status, sourceText: "The request mentions email and SMS, but its words do not choose the source.",
        owner: status === "unclaimed" ? null : actor, completedBy: status === "done" ? confirmer : null,
        completedAt: status === "done" ? NOW : null };
      const task = channel === "EMAIL" ? email(overrides) : sms(overrides);
      const work = rig(task); const tree = work.render(placement);
      const heading = nodes(tree).find(node => node.type === "header")!;
      expect(text(nodes(heading).find(node => node.props.className === "cct-task-label"))).toBe(`Customer task · ${channel}`);
      expect(nodes(tree).find(node => node.type === "details")!.props.open).toBeUndefined();
      for (const mutation of Object.values(work.a)) expect(mutation).not.toHaveBeenCalled();
      expect(task.status).toBe(status);
    }
  });

  it.each(["queue", "stream"] as const)("renders real fromEmail in the closed %s identity, exact source text first, and no invented phone or raw internal email IDs", placement => {
    const task = email(); const work = rig(task); const tree = work.render(placement);
    const heading = nodes(tree).find(node => node.type === "header")!;
    expect(text(nodes(heading).find(node => node.props.className === "cct-customer-phone"))).toBe(task.email.fromEmail);
    expect(text(heading)).toContain(task.customerName);
    const summary = nodes(tree).find(node => node.type === "summary")!;
    expect(text(summary)).toBe("Customer email & acknowledgment ");
    const body = nodes(tree).find(node => node.props.className === "cct-details-body")!;
    const sections = React.Children.toArray(body.props.children).filter(React.isValidElement) as Element[];
    expect(sections[0].props.className).toBe("cct-source-message");
    expect(text(nodes(sections[0]).find(node => node.type === "p"))).toBe(task.sourceText);
    const html = work.html(placement);
    expect(html).toContain("Customer email"); expect(html).not.toContain("Customer text");
    expect(html).toContain("&lt;script&gt;literal customer text, not HTML&lt;/script&gt;"); expect(html).not.toContain("<script>");
    for (const hidden of [task.sourceMessageId, task.email.threadId, task.email.rfcMessageId, task.email.mailboxEmail, task.email.replyToEmail!, task.email.recipientEmail, task.email.subject,
      "+13015550123", "+13015550987", "PN_SYNTHETIC_LINE", "0000000", "tel:", "mailto:"]) expect(html).not.toContain(hidden);
    expect(nodes(tree).find(node => node.type === "details")!.props.open).toBeUndefined();
    expect(work.context.callerId).toBe(actor.id);
    if (placement === "stream") expect(work.get).toHaveBeenCalledWith({ id: task.id }, { enabled: true, staleTime: 0, refetchOnWindowFocus: true, retry: false });
  });

  it.each(["queue", "stream"] as const)("clicks the actual %s link into the existing exact Gmail-thread overlay in every status, independent of task ownership/pending", placement => {
    for (const status of ["unclaimed", "claimed", "done"] as const) for (const pending of [false, true]) {
      const task = email({ status, owner: status === "unclaimed" ? null : { id: "other-staff", name: "Other staff" }, completedBy: status === "done" ? confirmer : null });
      const inbox = new Proxy([] as Record<string, unknown>[], { get: () => { throw new Error("Email must not touch the SMS inbox or match phone/name/email"); } });
      const work = rig(task, source, inbox); const tree = work.render(placement, pending);
      const link = button(tree, "Open full conversation"); expect(link.props.disabled).toBe(false);
      link.props.onClick();
      expect(work.open.setters.setSelectedEmailThreadId.mock.calls).toEqual([[task.email.threadId]]);
      expect(work.open.setters.setSelectedSmsConversation.mock.calls).toEqual([[null]]);
      for (const name of ["setSelectedLeadCardPhone", "setSelectedLeadCardDraft", "setSelectedLeadCardSnapshot", "setSelectedLeadDetail"]) expect(work.open.setters[name].mock.calls).toEqual([[null]]);
      expect(work.open.setters.showNotice).not.toHaveBeenCalled();
      expect(work.open.html()).toContain(`data-existing-email-detail="${task.email.threadId}"`);
      expect(work.open.detail.mock.calls[0][0]).toMatchObject({ initialThreadId: task.email.threadId, detailOnly: true });
      for (const mutation of Object.values(work.a)) expect(mutation).not.toHaveBeenCalled();
      expect(task.status).toBe(status);
    }
  });

  it.each(["queue", "stream"] as const)("keeps %s actions, actor badges, note confirmation and pending rules on email tasks", async placement => {
    const unclaimed = rig(email()); button(unclaimed.render(placement), "Claim").props.onClick(); await flush();
    expect(unclaimed.a.claim.mock.calls).toEqual([[702]]);
    expect(button(unclaimed.render(placement, true), "Claiming…").props.disabled).toBe(true);
    expect(unclaimed.context.tasks[0].status).toBe("unclaimed");
    const task = email({ customerName: null, status: "claimed", owner: actor, claimedAt: NOW }); const work = rig(task);
    let tree = work.render(placement); expect(text(tree)).toContain(`Claimed by ${actor.name}`);
    button(tree, "Confirm item").props.onClick(); await flush(); expect(work.a.completeItem).toHaveBeenCalledWith(702, "oven");
    button(work.render(placement), "Mark done").props.onClick(); tree = work.render(placement);
    expect(work.a.complete).not.toHaveBeenCalled(); expect(text(tree)).toContain("human confirmation");
    expect(text(tree)).toContain("No booking change, customer email, or conversation closure is performed.");
    const prompt = nodes(tree).find(node => node.props.className === "cct-confirm-task")!; expect(text(prompt)).toContain(task.email.fromEmail);
    expect(button(tree, "Confirm done").props.disabled).toBe(true);
    button(tree, "Confirm done").props.onClick(); await flush(); expect(work.a.complete).not.toHaveBeenCalled();
    nodes(tree).find(node => node.type === "textarea")!.props.onChange({ target: { value: "  Staff reviewed the oven request  " } });
    tree = work.render(placement); expect(button(tree, "Confirm done").props.disabled).toBe(false);
    button(tree, "Confirm done").props.onClick(); await flush(); expect(work.a.complete).toHaveBeenCalledWith(702, "Staff reviewed the oven request");
    expect(task.status).toBe("claimed");
    const other = rig(email({ status: "claimed", owner: { id: "different-openid", name: actor.name } }));
    expect(button(other.render(placement), "Mark done")).toBeUndefined(); expect(button(other.render(placement), "Confirm item")).toBeUndefined();
    const done = rig(email({ status: "done", owner: actor, completedBy: confirmer, completedAt: NOW, completionNote: "Actual staff confirmation note" }));
    const badge = nodes(done.render(placement)).find(node => node.props.className === "cct-card-status")!;
    expect(text(badge)).toBe(`Confirmed by ${confirmer.name}`);
    expect(done.html(placement)).toContain("Actual staff confirmation note"); expect(done.html(placement)).toContain("not system-verified");
  });

  it.each(["queue", "stream"] as const)("disables malformed email %s links without falling back to a valid SMS session", placement => {
    const valid = email(); const invalid = { ...valid, sessionId: 42, email: { ...valid.email, threadId: "" } } as unknown as CustomerTask;
    const work = rig(invalid); const link = button(work.render(placement), "Open full conversation");
    expect(link.props.disabled).toBe(true); link.props.onClick(); expect(work.open.setters.setSelectedEmailThreadId).not.toHaveBeenCalled();
    expect(work.open.setters.setSelectedSmsConversation).not.toHaveBeenCalled();
    work.open.open(invalid); expect(work.open.setters.showNotice).toHaveBeenCalledOnce();
    expect(work.open.setters.setSelectedSmsConversation).not.toHaveBeenCalled();
  });

  it.each(["prepared", "sent", "uncertain", "suppressed"] as const)("shows the unchanged acknowledgment status %s for email without leaking provider IDs", status => {
    const task = email({ reply: { text: "Exact acknowledgment\nSecond line", status, providerMessageId: "SYNTHETIC_GMAIL_REPLY_ID" } });
    const work = rig(task); const html = work.html("stream");
    expect(html).toContain(work.ui.customerTaskReplyStatus(status)); expect(html).toContain("Exact acknowledgment\nSecond line");
    expect(html).not.toContain("SYNTHETIC_GMAIL_REPLY_ID");
  });

  it("reuses authenticated provider pending/reconciliation and canonical list/get caches for email mutations", async () => {
    let rows: CustomerTask[] = [email()]; const gets = new Map<number, CustomerTask>();
    let release!: () => void; let first = true;
    const listCancel = vi.fn(async () => {}); const getCancel = vi.fn(async () => {});
    const invalidate = vi.fn(() => first ? new Promise<void>(resolve => { first = false; release = resolve; }) : Promise.resolve());
    const claimed = email({ status: "claimed", owner: actor, claimedAt: NOW });
    const completed = email({ status: "done", owner: actor, completedBy: actor, completedAt: NOW, completionNote: "Confirmed by staff" });
    const claim = vi.fn(async () => claimed); const completeItem = vi.fn(async () => claimed); const complete = vi.fn(async () => completed);
    const api = { useUtils: () => ({ claudeCustomerTasks: { invalidate,
      list: { cancel: listCancel, setData: (_input: unknown, update: (rows: CustomerTask[]) => CustomerTask[]) => { rows = update(rows); } },
      get: { cancel: getCancel, setData: ({ id }: { id: number }, record: CustomerTask) => gets.set(id, record) },
    } }), claudeCustomerTasks: {
      identity: { useQuery: () => ({ data: actor }) }, list: { useQuery: () => ({ data: rows }) },
      get: { useQuery: () => ({ data: gets.get(702), isLoading: false, isError: false }) },
      claim: { useMutation: () => ({ mutateAsync: claim }) }, completeItem: { useMutation: () => ({ mutateAsync: completeItem }) }, complete: { useMutation: () => ({ mutateAsync: complete }) },
    } };
    const work = harness(api); const provider = () => work.render("ClaudeCustomerTasksProvider", { callerId: "untrusted-prop", children: null }).props.value;
    let context = provider(); const saving = context.actions.claim(702); await flush(); context = provider();
    expect(context.pendingIds.has(702)).toBe(true); expect(rows[0]).toBe(claimed); expect(gets.get(702)).toBe(claimed);
    await expect(context.actions.claim(702)).rejects.toThrow("already saving"); expect(claim.mock.calls).toEqual([[{ id: 702 }]]);
    release(); await saving; context = provider(); expect(context.pendingIds.has(702)).toBe(false);
    await context.actions.completeItem(702, "oven"); expect(completeItem).toHaveBeenCalledWith({ id: 702, itemId: "oven" });
    await context.actions.complete(702, "  Confirmed by staff  "); expect(complete).toHaveBeenCalledWith({ id: 702, note: "Confirmed by staff" });
    expect(rows[0]).toBe(completed); expect(gets.get(702)).toBe(completed);
    work.setContext(provider()); const stream = work.render("ClaudeCustomerTaskStreamCard", { taskId: 702 }); expect(stream.props.task).toBe(completed);
    const before = invalidate.mock.calls.length; claim.mockRejectedValueOnce(new Error("Synthetic ownership conflict"));
    await expect(provider().actions.claim(702)).rejects.toThrow("Synthetic ownership conflict"); expect(invalidate.mock.calls.length).toBeGreaterThan(before);
    expect(rows[0]).toBe(completed); expect(provider().pendingIds.size).toBe(0);
    expect(listCancel).toHaveBeenCalledWith({}); expect(getCancel).toHaveBeenCalledWith({ id: 702 });
  });
});

describe("Exact offline SMS control and protected source bytes", () => {
  it.each(["queue", "stream"] as const)("renders SMS %s byte-identically to the authorized baseline and clicks the identical exact-session drawer path", placement => {
    for (const status of ["unclaimed", "claimed", "done"] as const) for (const pending of [false, true]) {
      const task = sms({ status, owner: status === "unclaimed" ? null : actor, completedBy: status === "done" ? confirmer : null, completedAt: status === "done" ? NOW : null, completionNote: status === "done" ? "Original completion note" : null });
      const sibling = { id: 999, leadName: task.customerName, leadPhone: task.customerPhone, lastInboundPhoneNumberId: "WRONG_LINE" };
      const exact = { ...sibling, id: task.sessionId, lastInboundPhoneNumberId: "EXACT_LINE" };
      const candidate = rig(task, source, [sibling, exact]); const control = rig(task, controlSource, [sibling, exact], controlPage);
      expect(candidate.html(placement, pending).replace('<span class="cct-task-label">Customer task · SMS</span>', '<span class="cct-task-label">Customer task</span>')).toBe(control.html(placement, pending));
      button(candidate.render(placement, pending), "Open full conversation").props.onClick();
      button(control.render(placement, pending), "Open full conversation").props.onClick();
      for (const name of Object.keys(candidate.open.setters)) expect(candidate.open.setters[name].mock.calls).toEqual(control.open.setters[name].mock.calls);
      expect(candidate.open.setters.setSelectedSmsConversation).toHaveBeenCalledWith(exact);
      for (const mutation of Object.values(candidate.a)) expect(mutation).not.toHaveBeenCalled();
    }
  });

  it("limits page changes to the type annotation and leading email callback branch; preserves the entire SMS resolver body, drawer and email overlay", () => {
    const branch = '    if ("email" in task) {\n      if (!task.email.threadId) { showNotice("This task\'s linked conversation is unavailable."); return; }\n      setSelectedLeadCardPhone(null);\n      setSelectedLeadCardDraft(null);\n      setSelectedLeadCardSnapshot(null);\n      setSelectedLeadDetail(null);\n      setSelectedSmsConversation(null);\n      setSelectedEmailThreadId(task.email.threadId);\n      return;\n    }\n';
    expect(page).toContain(branch);
    const normalized = page.replace(branch, "").replace('function taskConversation(task: Extract<CustomerTask, { sessionId: number }>,', 'function taskConversation(task: CustomerTask,')
      .replace('  messageCount: number;\n  isUnread: boolean;\n  hasUnanswered: boolean;\n};', '  messageCount: number;\n  isUnread: boolean;\n};')
      .replace('<i className={thread.hasUnanswered !== false ? "is-unread" : ""} aria-label={thread.hasUnanswered === false ? "Email replied to" : "Email awaiting reply"} />', '<i className={thread.isUnread ? "is-unread" : ""} />')
      .replace('<CommandChatEmailDetail key={threadId} initialThreadId={threadId}', '<CommandChatEmailDetail initialThreadId={threadId}');
    expect(normalized).toBe(controlPage);
    const detailPath = "client/src/pages/CommandChatEmailDetail.tsx";
    const restoredDetail = readFileSync(detailPath, "utf8")
      .replace('  sentBy?: { name: string; photoUrl: string | null } | null;\n', "")
      .replace(/          const outboundName = message\.sentBy\?\.name\?\.trim\(\) \|\| "You";\n/g, "")
      .replace(/        const outboundName = message\.sentBy\?\.name\?\.trim\(\) \|\| "You";\n/g, "")
      .replaceAll('outbound ? initialsFor(outboundName) : messageInitials', 'outbound ? "Y" : messageInitials')
      .replaceAll('outbound ? outboundName : (message.from || senderName)', 'outbound ? "You" : (message.from || senderName)');
    expect(restoredDetail).toBe(baseline(detailPath));
    for (const path of ["client/src/pages/command-chat-email-detail.css", "client/src/components/claude-customer-tasks.css"]) expect(readFileSync(path, "utf8")).toBe(baseline(path));
  });

  it("limits compact task changes to approved identity/copy/conversation slots, preserving all original authentication, mutation, state, pending and button blocks", () => {
    const approved = [
      ['Customer task · {"email" in task ? "EMAIL" : "SMS"}', 'Customer task'],
      ['{task.customerName || ("email" in task ? task.email.fromEmail : task.customerPhone)}', '{task.customerName || task.customerPhone}'],
      ['{"email" in task ? "No booking change, customer email, or conversation closure is performed." : "No booking change, customer text, or conversation closure is performed."}', 'No booking change, customer text, or conversation closure is performed.'],
      ['{"email" in task ? task.email.fromEmail : task.customerPhone}', '{task.customerPhone}'],
      ['disabled={!onOpenConversation || !("email" in task ? Boolean(task.email.threadId) : Number.isSafeInteger(task.sessionId) && task.sessionId > 0)}', 'disabled={!onOpenConversation || !Number.isSafeInteger(task.sessionId) || task.sessionId <= 0}'],
      ['onOpenConversation && ("email" in task ? Boolean(task.email.threadId) : Number.isSafeInteger(task.sessionId) && task.sessionId > 0)', 'onOpenConversation && Number.isSafeInteger(task.sessionId) && task.sessionId > 0'],
      ['import DOMPurify from "dompurify";\n', ''],
      ['{"email" in task && task.email.bodyFormat === "html"\n        ? <div className="cct-verbatim" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(task.sourceText, { USE_PROFILES: { html: true }, FORBID_ATTR: ["style", "color", "bgcolor"] }) }} />\n        : <p className="cct-verbatim">{task.sourceText}</p>}', '<p className="cct-verbatim">{task.sourceText}</p>'],
      ['          {"email" in task && task.email.bodyFormat === "html" && <div className="cct-verbatim" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(item.evidenceQuote, { USE_PROFILES: { html: true }, FORBID_ATTR: ["style", "color", "bgcolor"] }) }} />}\n', ''],
    ];
    let normalized = source;
    for (const [candidate, original] of approved) { expect(normalized.split(candidate)).toHaveLength(2); normalized = normalized.replace(candidate, original); }
    expect(normalized.split('{"email" in task ? "Customer email" : "Customer text"}')).toHaveLength(3);
    normalized = normalized.replaceAll('{"email" in task ? "Customer email" : "Customer text"}', 'Customer text');
    expect(normalized).toBe(controlSource);
  });
});

describe("HTML-only email source representation with the existing popup sanitizer", () => {
  // Run the declared DOMPurify package in the preinstalled local Chromium only.
  // No server, app, provider, customer, new dependency or external URL is used.
  function sanitizeInLocalDom(values: string[]) {
    const directory = mkdtempSync(join(tmpdir(), "customer-email-html-test-"));
    try {
      const require = createRequire(import.meta.url);
      const purify = readFileSync(join(dirname(require.resolve("dompurify")), "purify.min.js"), "utf8");
      const payload = JSON.stringify(values).replace(/</g, "\\u003c");
      writeFileSync(join(directory, "test.html"), `<!doctype html><meta charset="utf-8"><body><script>${purify}</script><script>window.__xss=0;const options=${JSON.stringify(popupSanitizerOptions)};const results=${payload}.map(value=>DOMPurify.sanitize(value,options));for(const value of results){const node=document.createElement('div');node.innerHTML=value;document.body.append(node);}setTimeout(()=>{const result=document.createElement('pre');result.id='result';result.textContent=btoa(JSON.stringify({results,xss:window.__xss}));document.body.append(result);},50);</script>\n`);
      const dom = execFileSync("chromium", ["--headless", "--no-sandbox", "--disable-gpu", "--disable-background-networking", "--disable-component-update", "--no-first-run", "--host-resolver-rules=MAP * ~NOTFOUND", `--user-data-dir=${join(directory, "profile")}`, "--virtual-time-budget=200", "--dump-dom", `file://${join(directory, "test.html")}`], { encoding: "utf8", timeout: 20_000, stdio: ["ignore", "pipe", "ignore"] });
      const encoded = dom.match(/<pre id="result">([A-Za-z0-9+/=]+)<\/pre>/)?.[1]; expect(encoded).toBeDefined();
      return JSON.parse(Buffer.from(encoded!, "base64").toString("utf8")) as { results: string[]; xss: number };
    } finally { rmSync(directory, { recursive: true, force: true }); }
  }

  it.each(["queue", "stream"] as const)("renders the complete sanitized HTML-only source and evidence in %s, preserving stored raw source and controls", placement => {
    const raw = '<div style="color:black" color="black" bgcolor="black"><p>Please <b>add the oven</b>.</p><script>window.__xss=1</script><img src="data:image/png;base64,AAAA" onerror="window.__xss=2"><a href="javascript:window.__xss=3">Unsafe link</a><svg onload="window.__xss=4"></svg>' + '<p>Full retained paragraph</p>'.repeat(130) + '<p>Final original request paragraph</p></div>';
    const evidence = '<b style="color:black" onclick="window.__xss=5">add the oven</b><script>window.__xss=6</script>';
    const purified = sanitizeInLocalDom([raw, evidence]); expect(purified.xss).toBe(0);
    for (const safe of purified.results) { expect(safe).not.toMatch(/<script|onerror|onclick|onload|javascript:|style=|color=|bgcolor=|<svg/i); }
    expect(purified.results[0]).toContain('<b>add the oven</b>'); expect(purified.results[0]).toContain('Final original request paragraph');
    expect(purified.results[0].match(/Full retained paragraph/g)).toHaveLength(130);
    sanitizer.sanitize.mockClear(); sanitizer.sanitize.mockImplementation((value, options) => {
      expect(options).toEqual(popupSanitizerOptions);
      if (value === raw) return purified.results[0]; if (value === evidence) return purified.results[1];
      throw new Error("Unexpected sanitizer input: no source rewrite is approved");
    });
    const base = email(); const task = email({ sourceText: raw, email: { ...base.email, bodyFormat: "html" }, items: [{ ...base.items[0], evidenceQuote: evidence }], status: "claimed", owner: actor });
    const work = rig(task); const tree = work.render(placement);
    const sourceSection = nodes(tree).find(node => node.props.className === "cct-source-message")!;
    const original = nodes(sourceSection).find(node => node.props.dangerouslySetInnerHTML)!;
    expect(original.type).toBe("div"); expect(original.props.dangerouslySetInnerHTML.__html).toBe(purified.results[0]);
    const checklist = nodes(tree).find(node => node.props.className === "cct-items")!;
    expect(nodes(checklist).find(node => node.props.dangerouslySetInnerHTML)!.props.dangerouslySetInnerHTML.__html).toBe(purified.results[1]);
    const html = renderToStaticMarkup(tree); expect(html).toContain('<b>add the oven</b>'); expect(html).not.toContain('&lt;b&gt;');
    expect(html).not.toMatch(/<script|onerror=|onclick=|javascript:/); expect(button(tree, "Mark done")).toBeDefined(); expect(button(tree, "Confirm item")).toBeDefined();
    expect(task.sourceText).toBe(raw); expect(task.items[0].evidenceQuote).toBe(evidence);
    expect(sanitizer.sanitize.mock.calls).toEqual([[raw, popupSanitizerOptions], [evidence, popupSanitizerOptions]]);
  });

  it("never interprets markup in SMS or plain email, absent or explicit text bodyFormat", () => {
    sanitizer.sanitize.mockClear(); sanitizer.sanitize.mockImplementation(() => { throw new Error("Plain source must not call the sanitizer"); });
    const raw = '<script>window.__xss=1</script>\n  <b>Exact literal source</b>  ';
    const base = email();
    for (const task of [sms({ sourceText: raw }), email({ sourceText: raw }), email({ sourceText: raw, email: { ...base.email, bodyFormat: "text" } })]) for (const placement of ["queue", "stream"] as const) {
      const tree = rig(task).render(placement); const section = nodes(tree).find(node => node.props.className === "cct-source-message")!;
      expect(nodes(section).find(node => node.type === "p")!.props.children).toBe(raw);
      expect(nodes(tree).some(node => node.props.dangerouslySetInnerHTML)).toBe(false);
      const html = renderToStaticMarkup(tree); expect(html).toContain('&lt;script&gt;'); expect(html).not.toContain('<script>');
    }
    expect(sanitizer.sanitize).not.toHaveBeenCalled();
  });
});
