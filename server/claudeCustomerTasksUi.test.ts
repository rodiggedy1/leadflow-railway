import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import * as ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import * as existingIcons from "lucide-react";
import * as contract from "../shared/claudeCustomerTasks";
import type { CustomerTask } from "../shared/claudeCustomerTasks";

// LOCAL ONLY: execute actual client source with injected React/tRPC seams.
// No real app/router, DB, model, provider, auth, network, or customer imports.
const componentSource = readFileSync(new URL("../client/src/components/ClaudeCustomerTasks.tsx", import.meta.url), "utf8");
const pageSource = readFileSync(new URL("../client/src/pages/CommandChatExactLive.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../client/src/components/claude-customer-tasks.css", import.meta.url), "utf8");
const NOW = 1800000000000;
const actor = { id: "17", name: "Synthetic staff" };
const actions = () => ({ claim: vi.fn(async (_id: number) => {}), completeItem: vi.fn(async (_id: number, _itemId: string) => {}), complete: vi.fn(async (_id: number, _note?: string) => {}) });
function fixture(overrides: Partial<CustomerTask> = {}): CustomerTask {
  return contract.customerTaskSchema.parse({
    id: 101, version: 1, kind: "claude_customer_task", sessionId: 42,
    customerName: "Synthetic customer", customerPhone: "+13015550123",
    sourceMessageId: "OM_SYNTHETIC_EXACT_REQUEST", sourceText: "Please move Friday's visit and add the oven.\nPlease confirm once updated.",
    receivedAt: NOW - 1800000, receivingPhoneNumberId: "PN_SYNTHETIC_RECEIVING_LINE", receivingPhoneNumber: "+13015550987",
    title: "Review Friday visit and oven request", items: [
      { id: "move", title: "Handle Friday visit request", evidenceQuote: "move Friday's visit", completedBy: null, completedAt: null },
      { id: "oven", title: "Handle oven add-on request", evidenceQuote: "add the oven", completedBy: null, completedAt: null },
    ], status: "unclaimed", owner: null, claimedAt: null, completedAt: null, completedBy: null, completionNote: null,
    reply: { text: "Our staff will review the requested changes and confirm after updating them.", status: "prepared", providerMessageId: null },
    activity: [{ action: "created", actor: null, at: NOW - 1800000, note: null }], ...overrides,
  });
}
const icons = existingIcons;
const dialog = (props: { open?: boolean; children?: React.ReactNode }) => props.open ? React.createElement("div", { role: "dialog" }, props.children) : null;
const div = (props: { children?: React.ReactNode }) => React.createElement("div", null, props.children);
type Ui = {
  customerTaskIdFromMessage: (message: { quickAction: string | null; metadata: string | null }) => number | null;
  customerTaskIsMine: (task: CustomerTask, callerId: string) => boolean;
  customerTaskQueues: (tasks: CustomerTask[], callerId: string) => Record<"unclaimed" | "mine" | "done", CustomerTask[]>;
  customerTaskReplyStatus: (status: CustomerTask["reply"]["status"]) => string;
  TaskCard: React.ComponentType<any>;
  CustomerTaskQueue: React.ComponentType<any>;
  TaskCompletionConfirm: React.ComponentType<any>;
  ClaudeCustomerTasksProvider: React.ComponentType<any>;
  ClaudeCustomerTaskStreamCard: React.ComponentType<any>;
};
function load(react = React, trpc: unknown = {}): Ui {
  const module = { exports: {} as Ui };
  const output = ts.transpileModule(componentSource, { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true,
  } }).outputText;
  runInNewContext(output, {
    module, exports: module.exports, Date, Intl, Map, Set, Error, Number,
    require: (id: string) => {
      if (id === "react") return react;
      if (id === "lucide-react") return icons;
      if (id === "@/lib/trpc") return { trpc };
      if (id === "@shared/claudeCustomerTasks") return contract;
      if (id === "@/components/ui/dialog") return { Dialog: dialog, DialogContent: div, DialogDescription: div, DialogTitle: div };
      if (id.endsWith(".css")) return {};
      throw new Error(`Unexpected customer task UI import: ${id}`);
    },
  }, { timeout: 1500 });
  return module.exports;
}
const ui = load();
type Element = React.ReactElement<Record<string, any>>;
const elements = (tree: unknown): Element[] => Array.isArray(tree) ? tree.flatMap(elements) : React.isValidElement<Record<string, any>>(tree)
  ? [tree, ...elements(tree.props.children)] : [];
const text = (tree: unknown): string => typeof tree === "string" || typeof tree === "number" ? String(tree) : Array.isArray(tree)
  ? tree.map(text).join("") : React.isValidElement<Record<string, any>>(tree) ? text(tree.props.children) : "";
const button = (tree: unknown, label: string) => elements(tree).find((node) => node.type === "button" && text(node) === label)!;
const html = (Component: React.ComponentType<any>, props: Record<string, unknown>) => renderToStaticMarkup(React.createElement(Component, props));
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
function stateHarness(trpc: unknown = {}, context?: unknown) {
  const slots: unknown[] = [];
  let cursor = 0;
  const react = { ...React,
    useState(initial: unknown) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === "function" ? (initial as () => unknown)() : initial;
      return [slots[index], (next: unknown) => { slots[index] = typeof next === "function" ? (next as (value: unknown) => unknown)(slots[index]) : next; }];
    },
    useRef(initial: unknown) { const index = cursor++; if (!(index in slots)) slots[index] = { current: initial }; return slots[index]; },
    useContext: () => context,
  } as unknown as typeof React;
  const local = load(react, trpc);
  return { ui: local, render: (name: keyof Ui, props: Record<string, unknown>) => { cursor = 0; return (local[name] as (p: unknown) => Element)(props); } };
}
const between = (start: string, end: string) => pageSource.slice(pageSource.indexOf(start), pageSource.indexOf(end, pageSource.indexOf(start)));
const hash = (value: string) => createHash("sha256").update(value).digest("hex");

describe("Customer task compact queue and exact canonical identity", () => {
  it("requires the exact quickAction and numeric task id, ignoring stale metadata snapshots", () => {
    expect(ui.customerTaskIdFromMessage({ quickAction: "claude_customer_task", metadata: JSON.stringify({ taskId: 101, task: { status: "done" } }) })).toBe(101);
    for (const value of [null, "bad JSON", "[]", '{}', '{"taskId":"101"}', '{"taskId":0}', '{"taskId":-1}', '{"taskId":1.5}', '{"taskId":9007199254740992}']) {
      expect(ui.customerTaskIdFromMessage({ quickAction: "claude_customer_task", metadata: value })).toBeNull();
    }
    expect(ui.customerTaskIdFromMessage({ quickAction: "new_lead", metadata: '{"taskId":101}' })).toBeNull();
  });

  it("counts Unclaimed/Mine/Done without caps and matches owner id, never owner name", () => {
    const tasks = [fixture(), fixture({ id: 102, status: "claimed", owner: actor }), fixture({ id: 103, status: "claimed", owner: { id: "18", name: actor.name } }), fixture({ id: 104, status: "done", owner: actor })];
    const queues = ui.customerTaskQueues(tasks, "17");
    expect(queues.unclaimed.map((task) => task.id)).toEqual([101]);
    expect(queues.mine.map((task) => task.id)).toEqual([102]);
    expect(queues.done.map((task) => task.id)).toEqual([104]);
    expect(ui.customerTaskIsMine(tasks[2], "17")).toBe(false);
    expect(ui.customerTaskIsMine(tasks[1], "")).toBe(false);
    const many = Array.from({ length: 250 }, (_, index) => fixture({ id: index + 1 }));
    expect(ui.customerTaskQueues(many, "17").unclaimed).toHaveLength(250);
    const rendered = html(ui.CustomerTaskQueue, { tasks: many, callerId: "17", actions: actions(), onRefresh: vi.fn() });
    expect([...rendered.matchAll(/data-task-id=/g)]).toHaveLength(250);
    expect(rendered).toContain("Unclaimed<b>250</b>");
    expect(tasks[0].id).toBe(101);
  });

  it("switches concise queue views and keeps other staff's claimed requests inspectable", () => {
    const tasks = [fixture(), fixture({ id: 102, status: "claimed", owner: actor }), fixture({ id: 103, status: "claimed", owner: { id: "18", name: "Other staff" } }), fixture({ id: 104, status: "done" })];
    const harness = stateHarness();
    const props = { tasks, callerId: "17", actions: actions(), onRefresh: vi.fn() };
    let tree = harness.render("CustomerTaskQueue", props);
    expect(text(tree)).toContain("Claimed by teammates 1");
    button(tree, "Mine1").props.onClick(); tree = harness.render("CustomerTaskQueue", props);
    const cards = elements(tree).filter((node) => node.type === harness.ui.TaskCard);
    expect(cards.map((node) => node.props.task.id)).toEqual([102]);
    button(tree, "Done1").props.onClick(); tree = harness.render("CustomerTaskQueue", props);
    expect(elements(tree).filter((node) => node.type === harness.ui.TaskCard).map((node) => node.props.task.id)).toEqual([104]);
    expect(html(ui.CustomerTaskQueue, { ...props, tasks: [], failed: true })).not.toContain("No unclaimed tasks");
  });

  it.each(["prepared", "sent", "uncertain", "suppressed"] as const)("shows actual acknowledgment status %s, never delivery or operational verification", (status) => {
    const task = fixture({ reply: { text: "Synthetic acknowledgment", status, providerMessageId: status === "sent" ? "OM_SYNTHETIC_ACCEPTED" : null } });
    const rendered = html(ui.TaskCard, { task, callerId: "17", actions: actions(), now: NOW });
    expect(rendered).toContain(ui.customerTaskReplyStatus(status));
    if (status === "sent") { expect(rendered).toContain("provider accepted, delivery not verified"); expect(rendered).toContain("OM_SYNTHETIC_ACCEPTED"); }
    if (status === "prepared" || status === "suppressed") expect(rendered).toContain("not sent");
    if (status === "uncertain") { expect(rendered).toContain("sending not confirmed"); expect(rendered).not.toContain("Sent ·"); }
    expect(rendered).not.toContain("system-verified");
  });

  it("keeps compact summary, exact source/customer/session/receiving-line and all proposed items in a closed expander", () => {
    const task = fixture({ customerName: '<script>synthetic</script>' });
    const rendered = html(ui.TaskCard, { task, callerId: "17", actions: actions(), now: NOW });
    expect(rendered).toContain("30m"); expect(rendered).toContain('class="cct-details"'); expect(rendered).not.toContain('class="cct-details" open');
    for (const value of [task.customerPhone, String(task.sessionId), task.sourceMessageId, task.receivingPhoneNumber, task.receivingPhoneNumberId, "Handle Friday visit request", "Handle oven add-on request"]) expect(rendered).toContain(value);
    expect(rendered).toContain("Please move Friday&#x27;s visit and add the oven.\nPlease confirm once updated.");
    expect(rendered).toContain("&lt;script&gt;synthetic&lt;/script&gt;"); expect(rendered).not.toContain("<script>");
    expect(rendered).toContain("Completion log");
    const tree = stateHarness().render("TaskCard", { task, callerId: "17", actions: actions(), now: NOW });
    expect(button(tree, "Claim")).toBeDefined(); expect(button(tree, "Mark done")).toBeUndefined();
  });
});

describe("Customer task human completion and authoritative updates", () => {
  it("claims with one button, coalesces repeated same-card clicks, and does not claim locally", async () => {
    let resolve!: () => void;
    const a = actions(); a.claim.mockImplementation(() => new Promise<void>((done) => { resolve = done; }));
    const harness = stateHarness(); const task = fixture();
    const props = { task, callerId: "17", actions: a, now: NOW };
    const claim = button(harness.render("TaskCard", props), "Claim"); claim.props.onClick(); claim.props.onClick();
    expect(a.claim).toHaveBeenCalledTimes(1); expect(a.claim).toHaveBeenCalledWith(101);
    expect(task.owner).toBeNull(); expect(task.status).toBe("unclaimed");
    resolve(); await flush();
  });

  it("permits the whole-task popup before checking each item and completes only after explicit confirmation", async () => {
    const task = fixture({ status: "claimed", owner: actor, claimedAt: NOW });
    const a = actions(); const harness = stateHarness(); const props = { task, callerId: "17", actions: a, now: NOW };
    let tree = harness.render("TaskCard", props);
    const mark = button(tree, "Mark done"); expect(mark.props.disabled).toBe(false); mark.props.onClick();
    tree = harness.render("TaskCard", props);
    expect(elements(tree).find((node) => node.type === dialog)?.props.open).toBe(true);
    const confirm = elements(tree).find((node) => node.type === harness.ui.TaskCompletionConfirm)!;
    expect(confirm.props.allowed).toBe(true); expect(a.complete).not.toHaveBeenCalled();
    const prompt = html(ui.TaskCompletionConfirm, { ...confirm.props, note: "" });
    expect(prompt).toContain("I completed all the actions in this task.");
    expect(prompt).toContain("human confirmation"); expect(prompt).toContain("not system verification");
    expect(prompt).toContain("No booking change, customer text, or conversation closure");
    confirm.props.onNote("  Synthetic staff completion note  "); tree = harness.render("TaskCard", props);
    elements(tree).find((node) => node.type === harness.ui.TaskCompletionConfirm)!.props.onConfirm(); await flush();
    expect(a.complete).toHaveBeenCalledWith(101, "Synthetic staff completion note"); expect(a.completeItem).not.toHaveBeenCalled();
    expect(task.status).toBe("claimed");
  });

  it("individually confirms items and blocks non-owner completion despite identical display names", async () => {
    const a = actions(); const harness = stateHarness(); const task = fixture({ status: "claimed", owner: actor });
    const props = { task, callerId: "17", actions: a, now: NOW };
    const tree = harness.render("TaskCard", props);
    elements(tree).find((node) => node.props["aria-label"] === "Confirm completed item: Handle oven add-on request")!.props.onClick(); await flush();
    expect(a.completeItem).toHaveBeenCalledWith(101, "oven"); expect(a.complete).not.toHaveBeenCalled();
    const other = html(ui.TaskCard, { ...props, task: fixture({ status: "claimed", owner: { id: "18", name: actor.name } }) });
    expect(other).toContain("Claimed by Synthetic staff"); expect(other).not.toContain("Mark done"); expect(other).not.toContain("Confirm item");
    const saving = stateHarness().render("TaskCard", { ...props, pending: true });
    expect(button(saving, "Mark done").props.disabled).toBe(true);
  });

  it("claim conflicts render a failure without false success or leaking private backend messages", async () => {
    const a = actions(); a.claim.mockRejectedValue(new Error("PRIVATE provider credential"));
    const harness = stateHarness(); const props = { task: fixture(), callerId: "17", actions: a, now: NOW };
    button(harness.render("TaskCard", props), "Claim").props.onClick(); await flush();
    const tree = harness.render("TaskCard", props);
    expect(text(tree)).toContain("Task update failed"); expect(text(tree)).not.toContain("PRIVATE"); expect(button(tree, "Claim")).toBeDefined();
  });

  it("renders human-confirmed completion actor/time/note and log, never system verified", () => {
    const task = fixture({ status: "done", owner: actor, completedBy: actor, completedAt: NOW,
      completionNote: "Synthetic confirmation only", activity: [{ action: "completed", actor, at: NOW, note: "Synthetic confirmation only" }] });
    const rendered = html(ui.TaskCard, { task, callerId: "17", actions: actions(), now: NOW });
    expect(rendered).toContain("Done · human-confirmed"); expect(rendered).toContain("Human-confirmed by Synthetic staff");
    expect(rendered).toContain("not system-verified"); expect(rendered).toContain("Synthetic confirmation only");
    expect(rendered).not.toContain("Mark done"); expect(rendered).not.toContain(">Claim</button>");
  });

  it("uses server response in list/get caches, inputs contain no identity, errors invalidate, independent tasks are not capped", async () => {
    let rows = [fixture(), fixture({ id: 102 })];
    const invalidate = vi.fn(); const gets = new Map<number, CustomerTask>();
    const getSet = vi.fn((input: { id: number }, task: CustomerTask) => { gets.set(input.id, task); });
    const listSet = vi.fn((_input: unknown, update: (current: CustomerTask[]) => CustomerTask[]) => { rows = update(rows); });
    let resolveClaim!: (task: CustomerTask) => void;
    const claim = vi.fn((_input: unknown) => new Promise<CustomerTask>((resolve) => { resolveClaim = resolve; }));
    const completeItem = vi.fn(async () => fixture({ status: "claimed", owner: actor }));
    const complete = vi.fn(async () => fixture({ status: "done", owner: actor, completedBy: actor, completedAt: NOW }));
    const api = { useUtils: () => ({ claudeCustomerTasks: { invalidate, get: { setData: getSet }, list: { setData: listSet } } }),
      claudeCustomerTasks: {
        identity: { useQuery: () => ({ data: actor, isLoading: false, isError: false }) },
        list: { useQuery: () => ({ data: rows, isLoading: false, isError: false }) },
        claim: { useMutation: () => ({ mutateAsync: claim }) }, completeItem: { useMutation: () => ({ mutateAsync: completeItem }) },
        complete: { useMutation: () => ({ mutateAsync: complete }) },
      } };
    const harness = stateHarness(api); const props = { callerId: "17", children: null };
    let context = harness.render("ClaudeCustomerTasksProvider", props).props.value;
    const saving = context.actions.claim(101);
    context = harness.render("ClaudeCustomerTasksProvider", props).props.value;
    expect(context.pendingIds.has(101)).toBe(true);
    const parallel = context.actions.completeItem(102, "oven"); await parallel;
    expect(completeItem).toHaveBeenCalledWith({ id: 102, itemId: "oven" });
    const claimed = fixture({ status: "claimed", owner: actor }); resolveClaim(claimed); await saving;
    expect(claim).toHaveBeenCalledWith({ id: 101 }); expect(rows[0]).toEqual(claimed); expect(gets.get(101)).toEqual(claimed);
    context = harness.render("ClaudeCustomerTasksProvider", props).props.value;
    await context.actions.complete(101, "  Confirmed by staff  ");
    expect(complete).toHaveBeenCalledWith({ id: 101, note: "Confirmed by staff" }); expect(rows[0].status).toBe("done"); expect(gets.get(101)?.status).toBe("done");
    const before = invalidate.mock.calls.length;
    claim.mockRejectedValueOnce(new Error("Claim conflict"));
    await expect(context.actions.claim(101)).rejects.toThrow("Claim conflict");
    expect(invalidate.mock.calls.length).toBeGreaterThan(before);
    expect(rows[0].status).toBe("done");
  });

  it("uses exact authenticated OAuth owner id when Ops auth prefers it over the agent cookie", () => {
    const api = { useUtils: () => ({}),
      claudeCustomerTasks: { identity: { useQuery: () => ({ data: { id: "synthetic-owner-openid", name: "Synthetic owner" }, isLoading: false, isError: false }) },
        list: { useQuery: () => ({ data: [], isLoading: false, isError: false }) },
        ...Object.fromEntries(["claim", "completeItem", "complete"].map((name) => [name, { useMutation: () => ({}) }])) } };
    const harness = stateHarness(api);
    expect(harness.render("ClaudeCustomerTasksProvider", { callerId: "17", children: null }).props.value.callerId).toBe("synthetic-owner-openid");
    expect(componentSource).not.toContain("trpc.auth.me");
  });

  it("stream ignores stored snapshot and renders same TaskCard from get; invalid references disable get", () => {
    let result = fixture({ status: "claimed", owner: actor });
    const get = vi.fn(() => ({ data: result, isLoading: false, isError: false, refetch: vi.fn() }));
    const context = { callerId: "17", pendingIds: new Set(), actions: actions() };
    const harness = stateHarness({ claudeCustomerTasks: { get: { useQuery: get } } }, context);
    let tree = harness.render("ClaudeCustomerTaskStreamCard", { taskId: 101 });
    expect(tree.type).toBe(harness.ui.TaskCard); expect(tree.props.task).toEqual(result); expect(tree.props.placement).toBe("stream");
    result = fixture({ status: "done", owner: actor }); tree = harness.render("ClaudeCustomerTaskStreamCard", { taskId: 101 });
    expect(tree.props.task.status).toBe("done");
    harness.render("ClaudeCustomerTaskStreamCard", { taskId: null });
    expect(get.mock.calls.at(-1)).toEqual([{ id: 0 }, { enabled: false, staleTime: 0, refetchOnWindowFocus: true, retry: false }]);
  });
});

describe("Customer task additive integration and style contract", () => {
  it("keeps canonical task entries in the command stream even when free text resembles a legacy service/sync alert", () => {
    const ast = ts.createSourceFile("CommandChatExactLive.tsx", pageSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const nodes = ast.statements.filter((node) => ts.isFunctionDeclaration(node) && ["isHiddenCommandNotification", "isServiceAlert"].includes(node.name?.text ?? ""));
    const module = { exports: {} as { hidden: (message: unknown) => boolean; alert: (message: unknown) => boolean } };
    const source = nodes.map((node) => node.getText(ast)).join("\n") + "\nexports.hidden = isHiddenCommandNotification; exports.alert = isServiceAlert;";
    runInNewContext(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText,
      { module, exports: module.exports, CLAUDE_CUSTOMER_TASK_ACTION: contract.CLAUDE_CUSTOMER_TASK_ACTION, HIDDEN_COMMAND_QUICK_ACTIONS: ["new_lead"] }, { timeout: 1500 });
    const message = { role: "system", quickAction: "claude_customer_task", body: "Sync Alert · no check-in request" };
    expect(module.exports.hidden(message)).toBe(false); expect(module.exports.alert(message)).toBe(false);
    expect(module.exports.hidden({ ...message, quickAction: null })).toBe(true);
    expect(module.exports.alert({ ...message, quickAction: null })).toBe(true);
  });

  it("preserves baseline lead/Thumbtack/draft/thread/header owning bytes and all lead queue props", () => {
    const hashes = [
      ["function LeadQueue(", "function ServiceAlertPanel(", "f52842376ffb2ac33d69ba754d5c8c539766e7cfb3b1dffe666d85783be5c8ec"],
      // Released sender labels are already in actual main; this pilot preserves them.
      ["function SmsConversationDrawer(", "function LiveThreadEntry(", "69923a8dd870c53efda032482acf723fab312bce1249cab20f38e68f9bcdb636"],
      ["function ThreadPanel(", "function SmsInboxRow(", "7ef9b1db7a5bba347acfe619c8ce38dd85112f26712e7abe3c76c3bca9d640be"],
      ["  const openSmsDrawerFromLead =", "  const addPendingOutgoingMessage =", "f71953e06a514c7088ae412fa85c4787684245595a10f39b9cf516d182bebbe6"],
      ['            <div className="ccc-reference-chat-header">', "            <>", "613c833add37ecee6d01744c826ab289b0cce2f467215e6d21d71d454f9e0b3e"],
    ];
    for (const [start, end, expected] of hashes) expect(hash(between(start, end))).toBe(expected);
    expect(pageSource).toContain('useState<"leads" | "tasks">("leads")');
    expect(pageSource).toContain('hidden={rightPanelTab !== "leads"}><LeadQueue title="All leads"');
    expect(pageSource).toContain("leads={allLeads}");
    expect(pageSource).toContain('threadId !== null ? <ThreadPanel thread={threadDetail}');
  });

  it("adds no SSE connection, timers, fuzzy customer lookup, sender, booking writes, or identity inputs", () => {
    expect(pageSource.match(/useOpsStream\(\{/g)).toHaveLength(1);
    expect(pageSource).toContain("onTaskUpdate: () => { void utils.claudeCustomerTasks.invalidate(); void utils.opsChat.listChannelMessages.invalidate({ channel }); }");
    expect(pageSource).toContain("onConnected: () => { void utils.claudeCustomerTasks.invalidate(); void utils.opsChat.listChannelMessages.invalidate({ channel }); }");
    expect(pageSource).toContain("message.quickAction === CLAUDE_CUSTOMER_TASK_ACTION");
    expect(pageSource).toContain("taskId={customerTaskIdFromMessage(message)}");
    for (const forbidden of ["EventSource", "useOpsStream", "setInterval", "setTimeout", "getClientProfile", "customerProfile", "newest", "cleaner_jobs", "cleanerJobs", "sendMessage", "sendWorkspaceMessage", "bookingFunnel", "dangerouslySetInnerHTML", ".slice(0,"]) expect(componentSource).not.toContain(forbidden);
    expect(componentSource).not.toMatch(/\bfetch\(/);
    expect(componentSource).toContain("claim.mutateAsync({ id })");
    expect(componentSource).toContain("completeItem.mutateAsync({ id, itemId })");
  });

  it("keeps concise controls, responsive fit, native closed details, isolated selectors and accessible completion dialog", () => {
    for (const marker of ["cct-queue-controls", "cct-card-heading", "cct-details", "cct-confirm-dialog", ':focus-visible', 'minmax(0, 1fr)', "calc(100vw - 32px)"]) expect(css).toContain(marker);
    expect(css).not.toMatch(/(?:^|\n)(?:body|html|button|\.ccc-right-panel|\.ccc-live-thread|\.ccc-reference-chat)/);
    expect(componentSource).toContain('<Dialog open={confirmOpen}'); expect(componentSource).toContain("<DialogTitle>"); expect(componentSource).toContain("<DialogDescription>");
    expect(componentSource).not.toContain("stats-card"); expect(componentSource).not.toContain("dashboard");
  });

  it("optionally writes a neutral offline synthetic SSR visual fixture without starting the application", () => {
    const output = process.env.CUSTOMER_TASK_UI_FIXTURE;
    if (!output) return;
    const unclaimed = fixture();
    const claimed = fixture({ id: 102, status: "claimed", owner: actor, title: "Review access instructions", customerName: "Synthetic customer B",
      reply: { text: "Our staff will review this request and follow up after the change.", status: "sent", providerMessageId: "OM_SYNTHETIC_ACCEPTED" } });
    const body = html(ui.CustomerTaskQueue, { tasks: [unclaimed, claimed], callerId: "17", actions: actions(), onRefresh: () => {} });
    const stream = html(ui.TaskCard, { task: claimed, callerId: "17", actions: actions(), placement: "stream", now: NOW });
    const confirm = html(ui.TaskCompletionConfirm, { task: claimed, note: "", pending: false, allowed: true, error: "", onNote: () => {}, onCancel: () => {}, onConfirm: () => {} });
    writeFileSync(output, `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Synthetic customer tasks · offline UI fixture</title><style>${css}\n*{box-sizing:border-box}body{margin:0;background:#19191d;color:#ededf3;font:13px system-ui}main{max-width:1080px;margin:40px auto;padding:20px}h1{font-size:18px}h2{font-size:12px;color:#aaaab9;font-weight:500;margin-bottom:12px}.fixture-grid{display:grid;grid-template-columns:340px 1fr;gap:28px}.fixture-panel{padding:12px;background:#202024;border:1px solid #3b3b43;border-radius:12px}.fixture-panel-top{display:flex;justify-content:space-between;border-bottom:1px solid #3b3b43;padding-bottom:10px}.fixture-confirm{max-width:390px;margin-top:22px;padding:18px;border:1px solid #4d4d58;border-radius:12px;background:#25252c}@media(max-width:700px){main{margin:10px auto}.fixture-grid{grid-template-columns:1fr}}</style></head><body><main><h1>Customer tasks · synthetic offline fixture</h1><p>No real customer data, app startup, or live services.</p><div class="fixture-grid"><aside class="fixture-panel"><div class="fixture-panel-top"><div class="cct-panel-tabs"><button aria-pressed="false">Leads</button><button aria-pressed="true">Tasks</button></div><span>Open CRM ›</span></div>${body}</aside><section><h2>Same canonical TaskCard in the command stream</h2>${stream}<section class="fixture-confirm"><strong>Mark task done?</strong>${confirm}</section></section></div></main></body></html>\n`);
  });
});
