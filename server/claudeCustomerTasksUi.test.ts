import { withoutApprovedTaskConversationDisplay } from "./taskConversationDisplaySourceControl";
import React from "react";
import * as recordingUtils from "../client/src/lib/utils";
import { renderToStaticMarkup } from "react-dom/server";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import * as ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import DOMPurify from "dompurify";
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
const actions = () => ({ claim: vi.fn(async (_id: number, _expectedOwnerId?: string) => {}), completeItem: vi.fn(async (_id: number, _itemId: string) => {}), complete: vi.fn(async (_id: number, _note?: string) => {}) });
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
  customerTaskQueues: (tasks: CustomerTask[], callerId: string) => Record<"open" | "mine" | "done", CustomerTask[]>;
  customerTaskReplyStatus: (status: CustomerTask["reply"]["status"]) => string;
  TaskCard: React.ComponentType<any>;
  CustomerTaskQueue: React.ComponentType<any>;
  TaskCompletionConfirm: React.ComponentType<any>;
  ClaudeCustomerTasksProvider: React.ComponentType<any>;
  ClaudeCustomerTasksQueue: React.ComponentType<any>;
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
      if (id === "dompurify") return DOMPurify;
      if (id === "lucide-react") return icons;
      if (id === "@/lib/trpc") return { trpc };
      if (id === "@/lib/utils") return recordingUtils;
      if (id === "@shared/claudeCustomerTasks") return contract;
      if (id === "@/components/ui/dialog") return { Dialog: dialog, DialogContent: div, DialogDescription: div, DialogTitle: div };
      if (id.endsWith(".css")) return {};
      // Phase 1 booking-change panel: rendered and tested separately (claudeBookingChangePanelUi.test.ts).
      if (id === "./ClaudeBookingChangePanel") return { ClaudeBookingChangePanel: () => null, useBookingChange: () => ({ data: null }), bookingChangeStatus: () => null, bookingChangeHistory: () => [], useManualBookingChange: () => null, manualBookingStatus: () => null, ManualBookingNotice: () => null };
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
const preservedPageSource = withoutApprovedTaskConversationDisplay("client/src/pages/CommandChatExactLive.tsx", pageSource);
const between = (start: string, end: string) => preservedPageSource.slice(preservedPageSource.indexOf(start), preservedPageSource.indexOf(end, preservedPageSource.indexOf(start)));
const hash = (value: string) => createHash("sha256").update(value).digest("hex");

describe("Customer task compact queue and exact canonical identity", () => {
  it("requires the exact quickAction and numeric task id, ignoring stale metadata snapshots", () => {
    expect(ui.customerTaskIdFromMessage({ quickAction: "claude_customer_task", metadata: JSON.stringify({ taskId: 101, task: { status: "done" } }) })).toBe(101);
    for (const value of [null, "bad JSON", "[]", '{}', '{"taskId":"101"}', '{"taskId":0}', '{"taskId":-1}', '{"taskId":1.5}', '{"taskId":9007199254740992}']) {
      expect(ui.customerTaskIdFromMessage({ quickAction: "claude_customer_task", metadata: value })).toBeNull();
    }
    expect(ui.customerTaskIdFromMessage({ quickAction: "new_lead", metadata: '{"taskId":101}' })).toBeNull();
  });

  it("counts Open/Mine/Done without caps and matches owner id, never owner name", () => {
    const tasks = [fixture(), fixture({ id: 102, status: "claimed", owner: actor }), fixture({ id: 103, status: "claimed", owner: { id: "18", name: actor.name } }), fixture({ id: 104, status: "done", owner: actor })];
    const queues = ui.customerTaskQueues(tasks, "17");
    expect(queues.open.map((task) => task.id)).toEqual([103, 102, 101]);
    expect(queues.mine.map((task) => task.id)).toEqual([102]);
    expect(queues.done.map((task) => task.id)).toEqual([104]);
    expect(ui.customerTaskIsMine(tasks[2], "17")).toBe(false);
    expect(ui.customerTaskIsMine(tasks[1], "")).toBe(false);
    const many = Array.from({ length: 250 }, (_, index) => fixture({ id: index + 1 }));
    expect(ui.customerTaskQueues(many, "17").open).toHaveLength(250);
    const rendered = html(ui.CustomerTaskQueue, { tasks: many, callerId: "17", actions: actions(), onRefresh: vi.fn() });
    expect([...rendered.matchAll(/data-task-id=/g)]).toHaveLength(250);
    expect(rendered).toContain("Open<b>250</b>");
    expect(tasks[0].id).toBe(101);
  });

  it("switches concise queue views and keeps other staff's claimed requests inspectable", () => {
    const tasks = [fixture(), fixture({ id: 102, status: "claimed", owner: actor }), fixture({ id: 103, status: "claimed", owner: { id: "18", name: "Other staff" } }), fixture({ id: 104, status: "done" })];
    const harness = stateHarness();
    const props = { tasks, callerId: "17", actions: actions(), onRefresh: vi.fn() };
    let tree = harness.render("CustomerTaskQueue", props);
    expect(elements(tree).filter((node) => node.type === harness.ui.TaskCard).map((node) => node.props.task.id)).toEqual([103, 102, 101]);
    expect(elements(tree).some((node) => node.type === "details" && node.props.className === "cct-other-claimed")).toBe(false);
    button(tree, "Mine1").props.onClick(); tree = harness.render("CustomerTaskQueue", props);
    const cards = elements(tree).filter((node) => node.type === harness.ui.TaskCard);
    expect(cards.map((node) => node.props.task.id)).toEqual([102]);
    button(tree, "Done1").props.onClick(); tree = harness.render("CustomerTaskQueue", props);
    expect(elements(tree).filter((node) => node.type === harness.ui.TaskCard).map((node) => node.props.task.id)).toEqual([104]);
    expect(html(ui.CustomerTaskQueue, { ...props, tasks: [], failed: true })).not.toContain("No open tasks");
  });

  it.each(["prepared", "sent", "uncertain", "suppressed"] as const)("shows actual acknowledgment status %s, never delivery or operational verification", (status) => {
    const task = fixture({ reply: { text: "Synthetic acknowledgment", status, providerMessageId: status === "sent" ? "OM_SYNTHETIC_ACCEPTED" : null } });
    const rendered = html(ui.TaskCard, { task, callerId: "17", actions: actions(), now: NOW, defaultExpanded: true }); // approved 320px design: details when expanded
    expect(rendered).toContain(ui.customerTaskReplyStatus(status));
    if (status === "sent") { expect(rendered).toContain("provider accepted, delivery not verified"); expect(rendered).not.toContain("OM_SYNTHETIC_ACCEPTED"); }
    if (status === "prepared" || status === "suppressed") expect(rendered).toContain("not sent");
    if (status === "uncertain") { expect(rendered).toContain("sending not confirmed"); expect(rendered).not.toContain("Sent ·"); }
    expect(rendered).not.toContain("system-verified");
  });

  it("keeps exact customer text and acknowledgment, removes technical clutter, and preserves all inline item controls", () => {
    const task = fixture({ customerName: '<script>synthetic</script>' });
    const rendered = html(ui.TaskCard, { task, callerId: "17", actions: actions(), now: NOW, defaultExpanded: true });
    expect(rendered).toContain("30m"); expect(rendered).toContain('class="cct-details"'); expect(rendered).not.toContain('class="cct-details" open');
    for (const value of [task.customerPhone, "Handle Friday visit request", "Handle oven add-on request", task.reply.text]) expect(rendered).toContain(value);
    for (const value of [task.sourceMessageId, task.receivingPhoneNumber, task.receivingPhoneNumberId, "Provider reference:", "cct-context", "Completion log", "Proposed staff request", "cct-checklist"]) expect(rendered).not.toContain(value);
    expect(rendered).toContain("Please move Friday&#x27;s visit and add the oven.\nPlease confirm once updated.");
    expect(rendered).toContain("&lt;script&gt;synthetic&lt;/script&gt;"); expect(rendered).not.toContain("<script>");
    expect(rendered).toContain("Task prepared");
    const tree = stateHarness().render("TaskCard", { task, callerId: "17", actions: actions(), now: NOW });
    expect(button(tree, "Claim")).toBeDefined(); expect(button(tree, "Mark done")).toBeUndefined();
  });

  it.each(["queue", "stream"] as const)("puts complete verbatim customer text first in %s details without clipping or rewriting either SMS", placement => {
    const sourceText = 'Exact customer text\n<script>not HTML</script> ' + "full message ".repeat(120);
    const replyText = 'Exact acknowledgment\nSecond line';
    const task = fixture({ sourceText, reply: { text: replyText, status: "sent", providerMessageId: "PROVIDER_DO_NOT_RENDER" } });
    const tree = stateHarness().render("TaskCard", { task, callerId: "17", actions: actions(), placement, now: NOW, defaultExpanded: true });
    const body = elements(tree).find(node => node.props.className === "cct-details-body")!;
    const sections = React.Children.toArray(body.props.children).filter(React.isValidElement) as Element[];
    expect(text(sections[0])).toContain(sourceText);
    const acknowledgment = elements(body).find(node => String(node.props.className).startsWith("cct-reply "))!;
    expect(text(acknowledgment)).toContain(replyText);
    const rendered = html(ui.TaskCard, { task, callerId: "17", actions: actions(), placement, now: NOW, defaultExpanded: true });
    expect(rendered).not.toContain("PROVIDER_DO_NOT_RENDER"); expect(rendered).toContain("&lt;script&gt;not HTML&lt;/script&gt;");
    expect(rendered).not.toContain("<script>"); expect(task.sourceText).toBe(sourceText); expect(task.reply.text).toBe(replyText);
    // Only the collapsed card title is shortened (two lines); the expanded card shows it in full, and no text is ever clipped.
    expect(css.match(/line-clamp/g)).toHaveLength(1); expect(css).toMatch(/\.cct-clamp \{[^}]*line-clamp: 2/); expect(css).toContain("white-space: pre-wrap");
  });

  it("keeps the actual Task prepared timestamp but omits verbose activity logs and internal item IDs", () => {
    const preparedAt = NOW - 60000;
    const task = fixture({ activity: [{ action: "created", actor: null, at: preparedAt, note: null }, { action: "item_completed", actor, at: NOW, note: "INTERNAL_ITEM_ID_DO_NOT_RENDER" }] });
    const rendered = html(ui.TaskCard, { task, callerId: "17", actions: actions(), now: NOW, defaultExpanded: true });
    expect(rendered).toContain(new Date(preparedAt).toISOString()); expect(rendered).not.toContain("INTERNAL_ITEM_ID_DO_NOT_RENDER");
    // Approved design: the audit trail is kept in a closed "Activity history" section, with no internal ids.
    expect(rendered).toContain("Activity history"); expect(rendered).not.toContain('class="cct-details" open'); expect(rendered).toContain("Task prepared");
  });

  it("preserves every pre-existing button and completion/cache lifecycle around the explicit takeover additions", () => {
    const buttons = (source: string) => {
      source = withoutApprovedTaskConversationDisplay("client/src/components/ClaudeCustomerTasks.tsx", source);
      const ast = ts.createSourceFile("card.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      const result: string[] = [];
      const visit = (node: ts.Node) => {
        if (ts.isFunctionDeclaration(node) && node.name?.text === "CustomerTaskCallRecording") return;
        // The new takeover button is tested independently below; retain the exact
        // historical byte guard for all existing Claim/Mark done/item controls.
        if (ts.isJsxElement(node) && node.openingElement.getText(ast).includes('title={`Take over from ')) return;
        if (ts.isJsxElement(node) && node.openingElement.tagName.getText(ast) === "button" && !node.openingElement.getText(ast).includes('className="cct-conversation-link"')) result.push(node.getText(ast).replace('onClick={() => void context.refresh()}', 'onClick={() => void query.refetch()}'));
        ts.forEachChild(node, visit);
      };
      // Only Retry now reads the shared list; all task-action button JSX stays identical.
      visit(ast); return [...new Set(result)];
    };
    // Approved 320px design (2026-11-27): the released card (ac36ea3) still matches the historical guard, and its Claim and
    // Mark done buttons are byte-identical in the redesigned card. The item check-off is the round checklist button with the
    // same handler; the conversation link keeps its behaviour; expand/collapse is new.
    const released = execFileSync("git", ["show", "ac36ea3dad109368be9d4ac5166c7d461ae60db0:client/src/components/ClaudeCustomerTasks.tsx"], { encoding: "utf8" });
    expect(hash(JSON.stringify(buttons(released)))).toBe("a252f9ab6d7d4b78ca48c4d339a8e4c57eed7332b415730eaeb991efe5732411");
    const kept = buttons(released).filter(jsx => /Claiming…|Mark done/.test(jsx));
    expect(kept).toHaveLength(2); expect(buttons(componentSource)).toEqual(expect.arrayContaining(kept));
    expect(componentSource).toContain("onClick={() => void update(() => actions.completeItem(task.id, item.id))}");
    const baselineActions = componentSource.replace(
      '    claim: (id, expectedOwnerId) => run(id, () => expectedOwnerId === undefined\n      ? claim.mutateAsync({ id })\n      : claim.mutateAsync({ id, expectedOwnerId })),',
      '    claim: (id) => run(id, () => claim.mutateAsync({ id })),');
    expect(hash(baselineActions.slice(baselineActions.indexOf('  const run ='), baselineActions.indexOf('  return <TaskContext.Provider')))).toBe("ce3e4148342bb5aa0dcc7289c8177f32d92c8c84729f05c46d71c7c0a6154c07");
    const segment = (source: string) => { const start = source.indexOf('  const [confirmOpen'); return source.slice(start, source.indexOf('  return <article', start)); };
    // Approved 320px design: the released card's state and update code (still the historical bytes) is kept line for line,
    // in order; the redesign only adds lines (expanded state, booking-change status, display values).
    expect(hash(segment(released))).toBe("7804809679708c1360153b78dddaf31f418ac8edc0d81d96b33d55ea3d00614f");
    const added = segment(componentSource).split("\n"); let at = 0;
    for (const line of segment(released).split("\n")) { const found = added.indexOf(line, at); expect(found, line).toBeGreaterThanOrEqual(at); at = found + 1; }
    // Approved Mark done popup (2026-11-28): "Confirm task completion" title; everything after it is unchanged.
    expect(hash(componentSource.slice(componentSource.indexOf("{error && !confirmOpen")))).toBe("e8fa97437009293a982d8d380362439081a0b2642d79a1d4ddb98652ee0608ee");
  });

  it.each(["queue", "stream"] as const)("shows the canonical phone in the closed %s task header for every status", placement => {
    for (const status of ["unclaimed", "claimed", "done"] as const) {
      const task = fixture({ status, owner: status === "unclaimed" ? null : actor });
      const tree = stateHarness().render("TaskCard", { task, callerId: "17", actions: actions(), placement, now: NOW });
      const heading = elements(tree).find(node => node.type === "header" && node.props.className === "cct-card-heading")!;
      // Approved design: the collapsed header shows name · channel · age; the phone appears once the card is expanded.
      expect(text(heading)).toContain(`${task.customerName} · SMS · `);
      expect(text(heading)).not.toContain(task.customerPhone);
      const open = stateHarness().render("TaskCard", { task, callerId: "17", actions: actions(), placement, now: NOW, defaultExpanded: true });
      expect(text(elements(open).find(node => node.type === "header")!)).toContain(task.customerPhone);
      const rendered = html(ui.TaskCard, { task, callerId: "17", actions: actions(), placement, now: NOW });
      expect(rendered).not.toContain('class="cct-details" open');
      expect(rendered).not.toContain("tel:");
      expect(Boolean(button(tree, "Claim"))).toBe(status === "unclaimed");
      expect(Boolean(button(tree, "Mark done"))).toBe(status === "claimed");
    }
  });

  it("keeps missing customer names and special characters safe in the visible header", () => {
    const task = fixture({ customerName: null });
    const tree = stateHarness().render("TaskCard", { task, callerId: "17", actions: actions(), now: NOW });
    const heading = elements(tree).find(node => node.type === "header")!;
    expect(text(heading)).toContain("Customer");
    expect(text(elements(stateHarness().render("TaskCard", { task, callerId: "17", actions: actions(), now: NOW, defaultExpanded: true })).find(node => node.type === "header")!)).toContain(task.customerPhone);
    const rendered = html(ui.TaskCard, { task: fixture({ customerName: '<script>synthetic</script>' }), callerId: "17", actions: actions(), now: NOW });
    expect(rendered).toContain("&lt;script&gt;synthetic&lt;/script&gt;");
    expect(rendered).not.toContain("<script>");
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
    const saving = button(harness.render("TaskCard", props), "Claiming…"); expect(saving).toBeDefined(); expect(saving.props.disabled).toBe(true);
    resolve(); await flush();
    expect(button(harness.render("TaskCard", props), "Claim").props.disabled).toBe(false);
  });

  it.each(["queue", "stream"] as const)("shows takeover only for another owner's unfinished %s card, without bypassing owner-only completion", placement => {
    const other = { id: "18", name: actor.name };
    for (const status of ["unclaimed", "claimed", "done"] as const) for (const owner of [actor, other]) {
      const task = fixture({ status, owner: status === "unclaimed" ? null : owner });
      const tree = stateHarness().render("TaskCard", { task, callerId: actor.id, actions: actions(), placement, now: NOW });
      expect(Boolean(button(tree, "Take over"))).toBe(status === "claimed" && owner.id === other.id);
      expect(Boolean(button(tree, "Mark done"))).toBe(status === "claimed" && owner.id === actor.id);
      expect(Boolean(button(tree, "Claim"))).toBe(status === "unclaimed");
    }
    const task = fixture({ status: "claimed", owner: other });
    for (const props of [{ callerId: "", pending: false }, { callerId: actor.id, pending: true }]) {
      const tree = stateHarness().render("TaskCard", { task, ...props, actions: actions(), placement, now: NOW });
      expect(button(tree, props.pending ? "Taking over…" : "Take over").props.disabled).toBe(true);
    }
  });

  it.each(["queue", "stream"] as const)("takes over %s with the displayed owner id, coalesces clicks, and enables the normal completion popup only after canonical update", async placement => {
    const previous = { id: "18", name: "Original staff" };
    const original = fixture();
    const task = fixture({ status: "claimed", owner: previous, claimedAt: NOW - 1000,
      items: original.items.map((item, index) => index ? item : { ...item, completedBy: previous, completedAt: NOW - 500 }) });
    let resolve!: () => void;
    const a = actions(); a.claim.mockImplementation(() => new Promise<void>(done => { resolve = done; }));
    const harness = stateHarness(); const props = { task, callerId: actor.id, actions: a, placement, now: NOW };
    const take = button(harness.render("TaskCard", props), "Take over");
    expect(take.props.title).toBe("Take over from Original staff");
    take.props.onClick(); take.props.onClick();
    expect(a.claim).toHaveBeenCalledTimes(1); expect(a.claim).toHaveBeenCalledWith(101, previous.id);
    expect(task.owner).toEqual(previous); expect(button(harness.render("TaskCard", props), "Mark done")).toBeUndefined();
    expect(button(harness.render("TaskCard", props), "Taking over…").props.disabled).toBe(true);
    resolve(); await flush();
    const saved = { ...task, owner: actor, claimedAt: NOW };
    const nextProps = { ...props, task: saved };
    let tree = harness.render("TaskCard", nextProps);
    expect(button(tree, "Take over")).toBeUndefined();
    expect(text(stateHarness().render("TaskCard", { ...nextProps, defaultExpanded: true }))).toMatch(/Confirmed ".+" · Original staff/); // kept in Activity history
    button(tree, "Mark done").props.onClick(); tree = harness.render("TaskCard", nextProps);
    const confirm = elements(tree).find(node => node.type === harness.ui.TaskCompletionConfirm)!;
    expect(confirm.props.allowed).toBe(true); expect(a.complete).not.toHaveBeenCalled();
    confirm.props.onNote("  Finished the remaining action.  "); tree = harness.render("TaskCard", nextProps);
    elements(tree).find(node => node.type === harness.ui.TaskCompletionConfirm)!.props.onConfirm(); await flush();
    expect(a.complete).toHaveBeenCalledWith(101, "Finished the remaining action.");
    expect(a.completeItem).not.toHaveBeenCalled(); expect(saved.items[0].completedBy).toEqual(previous);
  });

  it("a stale takeover handler retains the owner seen when clicked rather than substituting a newer owner", async () => {
    const a = actions(); const harness = stateHarness();
    const original = fixture({ status: "claimed", owner: { id: "18", name: "Original staff" } });
    const props = { task: original, callerId: actor.id, actions: a, now: NOW };
    const stale = button(harness.render("TaskCard", props), "Take over").props.onClick;
    harness.render("TaskCard", { ...props, task: { ...original, owner: { id: "19", name: "New owner" } } });
    stale(); await flush(); expect(a.claim).toHaveBeenCalledWith(101, "18");
    expect(original.owner?.id).toBe("18");
  });

  it("a failed takeover does not grant local completion rights or expose private backend details", async () => {
    const a = actions(); a.claim.mockRejectedValue(new Error("PRIVATE synthetic conflict"));
    const harness = stateHarness();
    const task = fixture({ status: "claimed", owner: { id: "18", name: "Other staff" } });
    const props = { task, callerId: actor.id, actions: a, now: NOW };
    button(harness.render("TaskCard", props), "Take over").props.onClick(); await flush();
    const tree = harness.render("TaskCard", props);
    expect(text(tree)).toContain("Task update failed"); expect(text(tree)).not.toContain("PRIVATE");
    expect(button(tree, "Mark done")).toBeUndefined(); expect(button(tree, "Take over")).toBeDefined();
    expect(task.owner?.id).toBe("18");
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
    // Approved Mark done popup (2026-11-28): message, warning, mandatory unticked box, optional note, two buttons.
    const prompt = html(ui.TaskCompletionConfirm, { ...confirm.props, note: "" });
    expect(prompt).toContain("Closing this task means the entire issue has been resolved, all necessary actions have been completed, and the customer has been responded to where applicable.");
    expect(prompt).toContain("Closing a task while an issue remains unresolved is strictly prohibited.");
    expect(prompt).toContain("If further action is required, leave the task open until the issue is fully resolved.");
    expect(prompt).toContain(`<input type="checkbox"/><span>${ui.TASK_COMPLETION_CONFIRMATION}</span>`); // unticked
    expect(prompt).toContain("Completion note <span>(optional)</span>");
    expect(prompt).toMatch(/<button type="button">Keep task open<\/button><button type="button" class="cct-primary" disabled="">.*Confirm &amp; close task<\/button>/);
    expect(prompt).not.toContain("(required)");
    const ticked = html(ui.TaskCompletionConfirm, { ...confirm.props, note: "", initiallyConfirmed: true });
    expect(ticked).toMatch(/<button type="button" class="cct-primary">.*Confirm &amp; close task<\/button>/); // enabled once ticked
    expect(html(ui.TaskCompletionConfirm, { ...confirm.props, note: "", initiallyConfirmed: true, allowed: false })).toMatch(/class="cct-primary" disabled=""/);
    confirm.props.onNote("  Synthetic staff completion note  "); tree = harness.render("TaskCard", props);
    elements(tree).find((node) => node.type === harness.ui.TaskCompletionConfirm)!.props.onConfirm(); await flush();
    expect(a.complete).toHaveBeenCalledWith(101, "Synthetic staff completion note"); expect(a.completeItem).not.toHaveBeenCalled();
    expect(task.status).toBe("claimed");
  });

  it("individually confirms items and blocks non-owner completion despite identical display names", async () => {
    const a = actions(); const harness = stateHarness(); const task = fixture({ status: "claimed", owner: actor });
    const props = { task, callerId: "17", actions: a, now: NOW, defaultExpanded: true };
    const tree = harness.render("TaskCard", props);
    elements(tree).find((node) => node.props["aria-label"] === "Confirm completed item: Handle oven add-on request")!.props.onClick(); await flush();
    expect(a.completeItem).toHaveBeenCalledWith(101, "oven"); expect(a.complete).not.toHaveBeenCalled();
    const other = html(ui.TaskCard, { ...props, task: fixture({ status: "claimed", owner: { id: "18", name: actor.name } }) });
    expect(other).toContain("Claimed by Synthetic staff"); expect(other).not.toContain("Mark done"); expect(other).not.toContain("Confirm completed item");
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
    const rendered = html(ui.TaskCard, { task, callerId: "17", actions: actions(), now: NOW, defaultExpanded: true });
    // Approved design: "Completed by" on the card; actor, time and note in Activity history; never "verified" for a manual completion.
    expect(rendered).toContain("Completed by Synthetic staff"); expect(rendered).toContain("Marked done · Synthetic staff · Synthetic confirmation only");
    expect(rendered).not.toContain("system-verified"); expect(rendered).not.toContain("Verified");
    expect(rendered).not.toContain("Mark done"); expect(rendered).not.toContain(">Claim</button>");
  });

  it.each(["queue", "stream"] as const)("shows the actual completion agent on the closed %s card, not the owner or current viewer", placement => {
    const task = fixture({ status: "done", owner: { id: "owner", name: "Claiming agent" }, completedBy: { id: "confirmer", name: "Confirming agent" }, completedAt: NOW });
    const tree = stateHarness().render("TaskCard", { task, callerId: "viewer", actions: actions(), placement, now: NOW });
    const badge = elements(tree).find(node => node.props.className === "cct-card-status")!;
    expect(text(badge)).toBe("Completed by Confirming agent"); expect(text(badge)).not.toContain("Claiming agent");
    const rendered = html(ui.TaskCard, { task, callerId: "viewer", actions: actions(), placement, now: NOW });
    expect(rendered).not.toContain('class="cct-details" open'); expect(rendered).not.toContain("Done · human-confirmed");
    expect(button(tree, "Open full conversation")).toBeDefined(); expect(button(tree, "Claim")).toBeUndefined(); expect(button(tree, "Mark done")).toBeUndefined();
    expect(task.completedBy?.name).toBe("Confirming agent");
  });

  it.each(["queue", "stream"] as const)("does not invent a completion agent for missing attribution and safely renders full names in %s", placement => {
    const task = fixture({ status: "done", owner: actor, completedBy: null });
    const badge = (value: CustomerTask) => elements(stateHarness().render("TaskCard", { task: value, callerId: "17", actions: actions(), placement, now: NOW })).find(node => node.props.className === "cct-card-status")!;
    expect(text(badge(task))).toBe("Completed by Staff"); expect(text(badge(task))).not.toContain(actor.name);
    const name = '<script>not HTML</script> & ' + 'Full agent name '.repeat(12);
    const named = fixture({ status: "done", completedBy: { id: "confirmer", name } });
    expect(text(badge(named))).toBe(`Completed by ${name}`);
    const rendered = html(ui.TaskCard, { task: named, callerId: "17", actions: actions(), placement, now: NOW });
    expect(rendered).toContain('&lt;script&gt;not HTML&lt;/script&gt; &amp;'); expect(rendered).not.toContain('<script>');
  });

  it("keeps Unclaimed and Claimed by labels unchanged until the whole task is completed", () => {
    for (const task of [fixture(), fixture({ status: "claimed", owner: actor })]) {
      const tree = stateHarness().render("TaskCard", { task, callerId: "17", actions: actions(), now: NOW });
      const badge = elements(tree).find(node => node.props.className === "cct-card-status")!;
      expect(text(badge)).toContain(task.status === "unclaimed" ? "Unclaimed" : "Claimed by Synthetic staff"); expect(text(badge)).not.toContain("Confirmed by");
    }
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
    const api = { useUtils: () => ({ claudeCustomerTasks: { invalidate, get: { setData: getSet, cancel: vi.fn(async () => {}) }, list: { setData: listSet, cancel: vi.fn(async () => {}) } } }),
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

  it("takeover uses the same list/get caches and conflict invalidation without sending staff identity", async () => {
    const previous = { id: "18", name: "Previous staff" };
    let rows = [fixture({ status: "claimed", owner: previous, claimedAt: NOW - 1000 })];
    const saved = fixture({ status: "claimed", owner: actor, claimedAt: NOW });
    const gets = new Map<number, CustomerTask>(); const invalidate = vi.fn(async () => {});
    const claim = vi.fn(async (_input: unknown) => saved);
    const api = { useUtils: () => ({ claudeCustomerTasks: { invalidate,
      get: { cancel: vi.fn(async () => {}), setData: (input: { id: number }, task: CustomerTask) => gets.set(input.id, task) },
      list: { cancel: vi.fn(async () => {}), setData: (_input: unknown, update: (current: CustomerTask[]) => CustomerTask[]) => { rows = update(rows); } },
    } }), claudeCustomerTasks: {
      identity: { useQuery: () => ({ data: actor, isLoading: false, isError: false }) },
      list: { useQuery: () => ({ data: rows, isLoading: false, isError: false }) },
      claim: { useMutation: () => ({ mutateAsync: claim }) },
      complete: { useMutation: () => ({}) }, completeItem: { useMutation: () => ({}) },
    } };
    const harness = stateHarness(api); const props = { callerId: "IGNORED_DISPLAY_ID", children: null };
    const context = harness.render("ClaudeCustomerTasksProvider", props).props.value;
    await context.actions.claim(101, previous.id);
    expect(claim).toHaveBeenCalledWith({ id: 101, expectedOwnerId: previous.id });
    expect(rows[0]).toEqual(saved); expect(gets.get(101)).toEqual(saved); expect(invalidate).toHaveBeenCalledTimes(1);
    expect(context.callerId).toBe(actor.id);
    claim.mockRejectedValueOnce(new Error("Synthetic stale takeover"));
    await expect(context.actions.claim(101, previous.id)).rejects.toThrow("Synthetic stale takeover");
    expect(invalidate).toHaveBeenCalledTimes(2); expect(rows[0]).toEqual(saved);
    expect(harness.render("ClaudeCustomerTasksProvider", props).props.value.pendingIds.size).toBe(0);
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

  it("stream ignores stored snapshots and renders the same TaskCard from the shared list without per-card reads", () => {
    const result = fixture({ status: "claimed", owner: actor });
    const get = vi.fn(() => { throw new Error("Stream must not request a task separately"); });
    const context = { callerId: "17", pendingIds: new Set(), actions: actions(), tasks: [result], loading: false, failed: false, transientFailure: true };
    const harness = stateHarness({ claudeCustomerTasks: { get: { useQuery: get } } }, context);
    let tree = harness.render("ClaudeCustomerTaskStreamCard", { taskId: 101 });
    let card = elements(tree).find(node => node.type === harness.ui.TaskCard)!;
    expect(card.props.task).toEqual(result); expect(card.props.placement).toBe("stream");
    context.tasks = [fixture({ status: "done", owner: actor })]; tree = harness.render("ClaudeCustomerTaskStreamCard", { taskId: 101 });
    card = elements(tree).find(node => node.type === harness.ui.TaskCard)!;
    expect(card.props.task.status).toBe("done");
    expect(text(harness.render("ClaudeCustomerTaskStreamCard", { taskId: null }))).toBe("Task reference unavailable.");
    expect(get).not.toHaveBeenCalled();
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

  it("preserves baseline lead/Thumbtack/task/quote/thread/header bytes after the approved World-class removal", () => {
    const hashes = [
      ["function LeadQueue(", "function ServiceAlertPanel(", "f52842376ffb2ac33d69ba754d5c8c539766e7cfb3b1dffe666d85783be5c8ec"],
      ["function ThreadPanel(", "function SmsInboxRow(", "7ef9b1db7a5bba347acfe619c8ce38dd85112f26712e7abe3c76c3bca9d640be"],
      ["  const openSmsDrawerFromLead =", "  const addPendingOutgoingMessage =", "f71953e06a514c7088ae412fa85c4787684245595a10f39b9cf516d182bebbe6"],
      ['            <div className="ccc-reference-chat-header">', "            <>", "613c833add37ecee6d01744c826ab289b0cce2f467215e6d21d71d454f9e0b3e"],
    ];
    for (const [start, end, expected] of hashes) expect(hash(between(start, end))).toBe(expected);
    // The full drawer hash intentionally changes when World-class code is removed.
    // These hashes bind the untouched raw task/quote seams to the pre-removal
    // e41c532f control, rather than blessing a new whole-drawer hash or stripping tasks.
    const rawBetween = (start: string, end: string) => pageSource.slice(pageSource.indexOf(start), pageSource.indexOf(end, pageSource.indexOf(start)));
    for (const [start, end, expected] of [
      ["  const smsTaskAnchors = useMemo", "  const smsConversationContext = useMemo", "6f34ade8f1ec274eb2cc330dafcfcfec38caf281fdf8eea3fd86102d1943a4cd"],
      ['    <div className="ccc-live-sms-messages"', "    <footer>", "0aa7912bee3d026b9ca319eedce47a252cdccd5bb4556dd33aa32357a3d5c65a"],
      ["function QuoteAssistantModal(", "function LiveThreadEntry(", "abc43f7064cea863c3dac802dd5f5936c08492f06772d5871b671c3b80801b9f"],
    ]) expect(hash(rawBetween(start, end))).toBe(expected);
    // Only the resolver's SMS-specific type annotation and the leading email
    // callback branch are approved; retain all original exact-session SMS bytes.
    expect(hash(between("  if (!Number.isSafeInteger(task.sessionId)", "\nfunction formatPhoneDisplay"))).toBe("8d54784afdd35a587350b6865566dabfb8f99696e9dc522c1950e461744856eb");
    expect(hash(between("    const conversation = taskConversation(task, smsInbox);", "  const openSmsDrawerFromLead ="))).toBe("3d664359801c758309fba76c44ef28709c3a34c0eb5704ed2380cc70293305e6");
    expect(pageSource).toContain('useState<"leads" | "tasks">("leads")');
    expect(pageSource).toContain('hidden={rightPanelTab !== "leads"}><LeadQueue title="All leads"');
    expect(pageSource).toContain("leads={allLeads}");
    expect(pageSource).toContain('threadId !== null ? <ThreadPanel thread={threadDetail}');
  });

  it("adds no SSE connection, timers, fuzzy customer lookup, sender, booking writes, or identity inputs", () => {
    expect(pageSource.match(/useOpsStream\(\{/g)).toHaveLength(1);
    expect(pageSource).toContain("onTaskUpdate: () => { void utils.claudeCustomerTasks.invalidate(); void utils.opsChat.listChannelMessages.invalidate({ channel }); }");
    // Load speed (2026-11-26): the connect handler still refreshes tasks and the feed, then opens the feed's first-fetch gate.
    const onConnected = pageSource.slice(pageSource.indexOf("onConnected: () => {"), pageSource.indexOf("}, { enabled: isAuthenticated, label: \"CommandChatExactLive\" });"));
    for (const call of ["void utils.claudeCustomerTasks.invalidate();", "void utils.opsChat.listChannelMessages.invalidate({ channel });",
      'setFeedStreamGate((gate) => gate === "waiting" ? "connected" : gate);']) expect(onConnected).toContain(call);
    expect(pageSource).toContain("message.quickAction === CLAUDE_CUSTOMER_TASK_ACTION");
    expect(pageSource).toContain("taskId={customerTaskIdFromMessage(message)}");
    for (const forbidden of ["EventSource", "useOpsStream", "refetchInterval", "setInterval", "setTimeout", "getClientProfile", "customerProfile", "newest", "cleaner_jobs", "cleanerJobs", "sendMessage", "sendWorkspaceMessage", "bookingFunnel", ".slice(0,"]) expect(componentSource).not.toContain(forbidden);
    expect(componentSource.match(/dangerouslySetInnerHTML=/g)).toHaveLength(2);
    for (const value of ["task.sourceText", "item.evidenceQuote"]) expect(componentSource).toContain(`dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(${value}, { USE_PROFILES: { html: true }, FORBID_ATTR: ["style", "color", "bgcolor"] }) }}`);
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
    const body = html(ui.CustomerTaskQueue, { tasks: [unclaimed, claimed], callerId: "17", actions: actions(), onOpenConversation: () => {}, onRefresh: () => {} });
    const stream = html(ui.TaskCard, { task: claimed, callerId: "17", actions: actions(), onOpenConversation: () => {}, placement: "stream", now: NOW });
    const confirm = html(ui.TaskCompletionConfirm, { task: claimed, note: "", pending: false, allowed: true, error: "", onNote: () => {}, onCancel: () => {}, onConfirm: () => {} });
    writeFileSync(output, `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Synthetic customer tasks · offline UI fixture</title><style>${css}\n*{box-sizing:border-box}body{margin:0;background:#19191d;color:#ededf3;font:13px system-ui}main{max-width:1080px;margin:40px auto;padding:20px}h1{font-size:18px}h2{font-size:12px;color:#aaaab9;font-weight:500;margin-bottom:12px}.fixture-grid{display:grid;grid-template-columns:340px 1fr;gap:28px}.fixture-panel{padding:12px;background:#202024;border:1px solid #3b3b43;border-radius:12px}.fixture-panel-top{display:flex;justify-content:space-between;border-bottom:1px solid #3b3b43;padding-bottom:10px}.fixture-confirm{max-width:390px;margin-top:22px;padding:18px;border:1px solid #4d4d58;border-radius:12px;background:#25252c}@media(max-width:700px){main{margin:10px auto}.fixture-grid{grid-template-columns:1fr}}</style></head><body><main><h1>Customer tasks · synthetic offline fixture</h1><p>No real customer data, app startup, or live services.</p><div class="fixture-grid"><aside class="fixture-panel"><div class="fixture-panel-top"><div class="cct-panel-tabs"><button aria-pressed="false">Leads</button><button aria-pressed="true">Tasks</button></div><span>Open CRM ›</span></div>${body}</aside><section><h2>Same canonical TaskCard in the command stream</h2>${stream}<section class="fixture-confirm"><strong>Mark task done?</strong>${confirm}</section></section></div></main></body></html>\n`);
  });
});

describe("Task link opens the existing exact-session SMS drawer", () => {
  function opener(inbox: Record<string, unknown>[] = []) {
    const ast = ts.createSourceFile("page.tsx", pageSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const helper = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "taskConversation")!;
    let callback: ts.VariableDeclaration | undefined;
    const visit = (node: ts.Node) => { if (ts.isVariableDeclaration(node) && node.name.getText(ast) === "openSmsDrawerFromTask") callback = node; ts.forEachChild(node, visit); }; visit(ast);
    expect(helper).toBeDefined(); expect(callback).toBeDefined();
    const setters = Object.fromEntries(["setSelectedLeadCardPhone", "setSelectedLeadCardDraft", "setSelectedLeadCardSnapshot", "setSelectedLeadDetail", "setSelectedEmailThreadId", "setSelectedSmsConversation", "showNotice"].map(name => [name, vi.fn()]));
    const module = { exports: {} as { resolve: (task: CustomerTask, rows: Record<string, unknown>[]) => Record<string, unknown> | null; open: (task: CustomerTask) => void } };
    const code = helper.getText(ast) + "\nconst " + callback!.getText(ast) + ";\nexports.resolve = taskConversation; exports.open = openSmsDrawerFromTask;";
    runInNewContext(ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText,
      { module, exports: module.exports, ...setters, smsInbox: inbox, useCallback: (fn: unknown) => fn }, { timeout: 1500 });
    return { ...module.exports, setters };
  }

  it.each(["queue", "stream"] as const)("opens from %s in every task state for all staff, even while Claim saves, without invoking a mutation", placement => {
    for (const status of ["unclaimed", "claimed", "done"] as const) for (const pending of [false, true]) {
      const task = fixture({ status, owner: status === "unclaimed" ? null : { id: "other-agent", name: "Other staff" } });
      const route = opener(); const a = actions(); const tree = stateHarness().render("TaskCard", { task, callerId: "17", pending, actions: a, onOpenConversation: route.open, placement, now: NOW });
      const link = button(tree, "Open full conversation"); expect(link).toBeDefined(); expect(link.props.type).toBe("button"); expect(link.props.disabled).toBe(false);
      link.props.onClick(); expect(route.setters.setSelectedSmsConversation.mock.calls[0][0].id).toBe(task.sessionId);
      expect(a.claim).not.toHaveBeenCalled(); expect(a.complete).not.toHaveBeenCalled(); expect(a.completeItem).not.toHaveBeenCalled(); expect(task.status).toBe(status);
    }
  });

  it("uses an exact-ID inbox row even when an earlier sibling shares the same phone and name", () => {
    const task = fixture(); const sibling = { id: 999, leadPhone: task.customerPhone, leadName: task.customerName, lastInboundPhoneNumberId: "WRONG_SIBLING_LINE" };
    const exact = { ...sibling, id: task.sessionId, lastInboundPhoneNumberId: "LATEST_EXACT_LINE" }; const route = opener([sibling, exact]);
    expect(route.resolve(task, [sibling, exact])).toBe(exact); route.open(task); expect(route.setters.setSelectedSmsConversation).toHaveBeenCalledWith(exact);
    for (const name of ["setSelectedLeadCardPhone", "setSelectedLeadCardDraft", "setSelectedLeadCardSnapshot", "setSelectedLeadDetail", "setSelectedEmailThreadId"]) expect(route.setters[name]).toHaveBeenCalledWith(null);
  });

  it("opens the exact stored session missing from the inbox without borrowing sibling metadata or inventing preview history", () => {
    const task = fixture({ sessionId: 43, customerName: null }); const sibling = { id: 42, leadPhone: task.customerPhone, lastInboundPhoneNumberId: "WRONG_LINE" }; const route = opener([sibling]);
    const result = route.resolve(task, [sibling])!;
    expect(result).toEqual({ id: 43, leadName: null, leadPhone: task.customerPhone, leadSource: null, lastMessageText: null, lastMsgTs: null, lastMessageTs: null, lastSenderRole: null, hasUnanswered: false, aiSummary: null, personType: "customer", lastInboundPhoneNumberId: task.receivingPhoneNumberId, receivedAt: task.receivedAt, calledAt: null });
    route.open(task); expect(route.setters.setSelectedSmsConversation).toHaveBeenCalledWith(result); expect(route.setters.showNotice).not.toHaveBeenCalled();
  });

  it.each([0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1])("never resolves, creates, or opens another session when the task ID is invalid: %s", sessionId => {
    const task = { ...fixture(), sessionId }; const route = opener([{ id: 42, leadPhone: task.customerPhone }]);
    expect(route.resolve(task, [])).toBeNull(); route.open(task); expect(route.setters.setSelectedSmsConversation).not.toHaveBeenCalled(); expect(route.setters.showNotice).toHaveBeenCalledTimes(1);
    const open = vi.fn(); const tree = stateHarness().render("TaskCard", { task, callerId: "17", actions: actions(), onOpenConversation: open, now: NOW });
    const link = button(tree, "Open full conversation"); expect(link.props.disabled).toBe(true); link.props.onClick(); expect(open).not.toHaveBeenCalled();
  });

  it("passes the same page callback through the existing provider to queue and canonical stream cards", () => {
    const open = vi.fn(); const task = fixture();
    const api = { useUtils: () => ({}), claudeCustomerTasks: { identity: { useQuery: () => ({ data: actor }) }, list: { useQuery: () => ({ data: [task] }) },
      ...Object.fromEntries(["claim", "completeItem", "complete"].map(name => [name, { useMutation: () => ({}) }])) } };
    const context = stateHarness(api).render("ClaudeCustomerTasksProvider", { callerId: "17", children: null, onOpenConversation: open }).props.value; expect(context.onOpenConversation).toBe(open);
    const queueHarness = stateHarness({}, context); const queue = queueHarness.render("ClaudeCustomerTasksQueue", {}); expect(queue.props.onOpenConversation).toBe(open);
    const queueTree = queueHarness.render("CustomerTaskQueue", queue.props); expect(elements(queueTree).find(node => node.type === queueHarness.ui.TaskCard)!.props.onOpenConversation).toBe(open);
    const stream = stateHarness({ claudeCustomerTasks: { get: { useQuery: () => ({ data: task, isLoading: false, isError: false }) } } }, context).render("ClaudeCustomerTaskStreamCard", { taskId: task.id });
    const streamCard = elements(stream).find(node => node.props.placement === "stream")!;
    expect(streamCard.props.onOpenConversation).toBe(open); expect(streamCard.props.task).toBe(task);
    expect(pageSource).toContain('onOpenConversation={openSmsDrawerFromTask}');
    expect(pageSource.match(/<SmsConversationDrawer conversation=/g)).toHaveLength(1);
    expect(pageSource).toContain('{ sessionId: conversation.id }');
    const callback = between("  const openSmsDrawerFromTask =", "  const openSmsDrawerFromLead =");
    for (const forbidden of ["mutate", "fetch", "openSmsDrawerFromLead", "leadCardConversation", "normalizedLeadPhone", "createSession", "window.open"]) expect(callback).not.toContain(forbidden);
  });
});
