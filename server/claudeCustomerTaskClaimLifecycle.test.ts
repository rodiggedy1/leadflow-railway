import React from "react";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import * as ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import DOMPurify from "dompurify";
import * as icons from "lucide-react";
import * as contract from "../shared/claudeCustomerTasks";
import type { CustomerTask } from "../shared/claudeCustomerTasks";

// OFFLINE ONLY: compile the actual TSX, injecting React/tRPC seams as in
// claudeCustomerTasksUi.test.ts. Never import the app/router, DB, auth, model,
// provider clients, or customer data. Deferred reads below are explicit mocks,
// not assertions about real transport cancellation or backend races.
const source = readFileSync(new URL("../client/src/components/ClaudeCustomerTasks.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true,
} }).outputText;
const NOW = 1800000000000;
const actor = { id: "17", name: "Synthetic claimer" };
const teammate = { id: "18", name: "Synthetic teammate" };
function fixture(overrides: Partial<CustomerTask> = {}): CustomerTask {
  return contract.customerTaskSchema.parse({
    id: 101, version: 1, kind: "claude_customer_task", sessionId: 42,
    customerName: "Synthetic customer", customerPhone: "+13015550123",
    sourceMessageId: "OM_SYNTHETIC_LIFECYCLE", sourceText: "Please review the visit and oven request.",
    receivedAt: NOW - 1800000, receivingPhoneNumberId: "PN_SYNTHETIC_LINE", receivingPhoneNumber: "+13015550987",
    title: "Review synthetic visit request", items: [
      { id: "visit", title: "Review visit request", evidenceQuote: "review the visit", completedBy: null, completedAt: null },
      { id: "oven", title: "Review oven request", evidenceQuote: "oven request", completedBy: null, completedAt: null },
    ], status: "unclaimed", owner: null, claimedAt: null, completedAt: null, completedBy: null, completionNote: null,
    reply: { text: "Staff will review the request.", status: "prepared", providerMessageId: null },
    activity: [{ action: "created", actor: null, at: NOW - 1800000, note: null }], ...overrides,
  });
}
const claimed = (owner = actor) => fixture({ status: "claimed", owner, claimedAt: NOW,
  activity: [{ action: "claimed", actor: owner, at: NOW, note: null }] });
const completed = (note = "Reviewed both requested actions.") => fixture({
  status: "done", owner: actor, claimedAt: NOW, completedBy: actor, completedAt: NOW + 1000, completionNote: note,
  items: fixture().items.map(item => ({ ...item, completedBy: actor, completedAt: NOW + 1000 })),
  activity: [{ action: "completed", actor, at: NOW + 1000, note }],
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const flush = async () => { for (let index = 0; index < 24; index++) await Promise.resolve(); };
type Element = React.ReactElement<Record<string, any>>;
type Ui = {
  customerTaskQueues: (tasks: readonly CustomerTask[], callerId: string) => Record<"open" | "mine" | "done", CustomerTask[]>;
  TaskCard: React.ComponentType<any>;
  CustomerTaskQueue: React.ComponentType<any>;
  TaskCompletionConfirm: React.ComponentType<any>;
  ClaudeCustomerTasksProvider: React.ComponentType<any>;
  ClaudeCustomerTasksQueue: React.ComponentType<any>;
  ClaudeCustomerTaskStreamCard: React.ComponentType<any>;
};
const dialog = (props: { open?: boolean; children?: React.ReactNode }) => props.open ? React.createElement("div", { role: "dialog" }, props.children) : null;
const div = (props: { children?: React.ReactNode }) => React.createElement("div", null, props.children);
function load(react: typeof React, trpc: unknown): Ui {
  const module = { exports: {} as Ui };
  runInNewContext(compiled, {
    module, exports: module.exports, Date, Intl, Map, Set, Error, Number,
    require(id: string) {
      if (id === "react") return react;
      if (id === "dompurify") return DOMPurify;
      if (id === "lucide-react") return icons;
      if (id === "@/lib/trpc") return { trpc };
      if (id === "@shared/claudeCustomerTasks") return contract;
      if (id === "@/components/ui/dialog") return { Dialog: dialog, DialogContent: div, DialogDescription: div, DialogTitle: div };
      if (id.endsWith(".css")) return {};
      throw new Error(`Unexpected lifecycle UI import: ${id}`);
    },
  }, { timeout: 1500 });
  return module.exports;
}
const elements = (tree: unknown): Element[] => Array.isArray(tree) ? tree.flatMap(elements)
  : React.isValidElement<Record<string, any>>(tree) ? [tree, ...elements(tree.props.children)] : [];
const text = (tree: unknown): string => typeof tree === "string" || typeof tree === "number" ? String(tree)
  : Array.isArray(tree) ? tree.map(text).join("") : React.isValidElement<Record<string, any>>(tree) ? text(tree.props.children) : "";
const button = (tree: unknown, label: string) => elements(tree).find(node => node.type === "button" && text(node) === label)!;
function stateHarness(trpc: unknown = {}, readContext: () => unknown = () => null) {
  // Independent hook slots model distinct queue and stream instances; refs are
  // stable across explicit rerenders and protect handlers from the same render.
  const instances = new Map<string, unknown[]>();
  let slots: unknown[] = [];
  let cursor = 0;
  const react = { ...React,
    useState(initial: unknown) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === "function" ? (initial as () => unknown)() : initial;
      const instance = slots;
      return [slots[index], (next: unknown) => { instance[index] = typeof next === "function" ? (next as (value: unknown) => unknown)(instance[index]) : next; }];
    },
    useRef(initial: unknown) { const index = cursor++; if (!(index in slots)) slots[index] = { current: initial }; return slots[index]; },
    useContext: readContext,
  } as unknown as typeof React;
  const ui = load(react, trpc);
  return { ui, render(name: keyof Ui, props: Record<string, unknown>, key = name as string): Element {
    if (!instances.has(key)) instances.set(key, []);
    slots = instances.get(key)!; cursor = 0;
    return (ui[name] as (props: unknown) => Element)(props);
  } };
}
type Placement = "queue" | "stream";
function providerHarness(...args: [] | [CustomerTask[] | undefined]) {
  let rows = args.length ? args[0] : [fixture()];
  const gets = new Map<number, CustomerTask>([[101, rows?.find(task => task.id === 101) ?? fixture()]]);
  const events: string[] = [];
  const listReads = new Set<{ cancelled: boolean }>();
  const getReads = new Map<number, Set<{ cancelled: boolean }>>();
  const cancelListReads = () => { for (const read of listReads) read.cancelled = true; };
  const cancelGetReads = (id: number) => { for (const read of getReads.get(id) ?? []) read.cancelled = true; };
  const listCancel = vi.fn(async (_input: {}) => { events.push("cancel:list"); cancelListReads(); });
  const getCancel = vi.fn(async (input: { id: number }) => { events.push("cancel:get"); cancelGetReads(input.id); });
  const getSet = vi.fn((input: { id: number }, record: CustomerTask) => { events.push("apply:get"); gets.set(input.id, record); });
  const listSet = vi.fn((_input: {}, update: (current: CustomerTask[] | undefined) => CustomerTask[] | undefined) => {
    events.push("apply:list"); rows = update(rows);
  });
  const invalidate = vi.fn(async () => { events.push("invalidate"); });
  const claimResult = deferred<CustomerTask>();
  const doneResult = deferred<CustomerTask>();
  const claim = vi.fn((_input: { id: number }) => { events.push("request:claim"); return claimResult.promise; });
  const complete = vi.fn((_input: { id: number; note?: string }) => { events.push("request:complete"); return doneResult.promise; });
  const completeItem = vi.fn(async (_input: { id: number; itemId: string }) => claimed());
  const getQuery = vi.fn((input: { id: number }) => ({ data: gets.get(input.id), isLoading: false, isError: false, refetch: vi.fn() }));
  const api = { useUtils: () => ({ claudeCustomerTasks: {
    invalidate, list: { cancel: listCancel, setData: listSet }, get: { cancel: getCancel, setData: getSet },
  } }), claudeCustomerTasks: {
    identity: { useQuery: () => ({ data: actor, isLoading: false, isError: false }) },
    list: { useQuery: () => ({ data: rows, isLoading: false, isError: false }) },
    get: { useQuery: getQuery },
    claim: { useMutation: () => ({ mutateAsync: claim }) },
    complete: { useMutation: () => ({ mutateAsync: complete }) },
    completeItem: { useMutation: () => ({ mutateAsync: completeItem }) },
  } };
  let currentContext: any;
  const harness = stateHarness(api, () => currentContext);
  const context = () => currentContext = harness.render("ClaudeCustomerTasksProvider", { callerId: actor.id, children: null }).props.value;
  const queue = () => {
    context();
    const wrapper = harness.render("ClaudeCustomerTasksQueue", {});
    expect(wrapper.type).toBe(harness.ui.CustomerTaskQueue);
    return harness.render("CustomerTaskQueue", wrapper.props);
  };
  const cardElement = (placement: Placement) => {
    if (placement === "queue") return elements(queue()).find(node => node.type === harness.ui.TaskCard && node.props.task.id === 101)!;
    context();
    const wrapper = harness.render("ClaudeCustomerTaskStreamCard", { taskId: 101 });
    expect(wrapper.type).toBe(harness.ui.TaskCard);
    return wrapper;
  };
  const card = (placement: Placement) => harness.render("TaskCard", cardElement(placement).props, `card:${placement}`);
  const confirmElement = (tree: Element) => elements(tree).find(node => node.type === harness.ui.TaskCompletionConfirm)!;
  const popup = (tree: Element) => harness.render("TaskCompletionConfirm", confirmElement(tree).props);
  const startRead = (target: "list" | "get", snapshot: CustomerTask) => {
    const read = { cancelled: false };
    if (target === "list") listReads.add(read);
    else { if (!getReads.has(snapshot.id)) getReads.set(snapshot.id, new Set()); getReads.get(snapshot.id)!.add(read); }
    return { get cancelled() { return read.cancelled; }, deliver: vi.fn(() => {
      if (read.cancelled) return false;
      if (target === "list") rows = [snapshot]; else gets.set(snapshot.id, snapshot);
      return true;
    }) };
  };
  return { ...harness, context, queue, cardElement, card, confirmElement, popup,
    rows: () => rows, gets, events, listCancel, getCancel, getSet, listSet, invalidate,
    claim, complete, completeItem, claimResult, doneResult, startRead, cancelListReads, cancelGetReads,
    refetch(record: CustomerTask) { rows = [record]; gets.set(record.id, record); },
  };
}
const cardIds = (harness: ReturnType<typeof stateHarness>, tree: Element) => elements(tree)
  .filter(node => node.type === harness.ui.TaskCard).map(node => node.props.task.id);
const isOpen = (tree: Element) => elements(tree).find(node => node.type === dialog)!.props.open;

describe("Customer task open retention and immediate claiming", () => {
  it("keeps the claimer and teammates inline in Open until status is done, while preserving Mine/Done", () => {
    const harness = stateHarness();
    let tasks = [fixture(), fixture({ ...claimed(), id: 102 }), fixture({ ...claimed(teammate), id: 103 }), fixture({ ...completed(), id: 104 })];
    const props = () => ({ tasks, callerId: actor.id, actions: {}, onRefresh: vi.fn() });
    let tree = harness.render("CustomerTaskQueue", props());
    expect(button(tree, "Open3").props["aria-pressed"]).toBe(true);
    expect(cardIds(harness, tree)).toEqual([103, 102, 101]);
    expect(elements(tree).filter(node => node.props.className === "cct-task-list")).toHaveLength(1);
    expect(text(tree)).not.toContain("Claimed by teammates");
    tasks = tasks.map(task => task.id === 101 ? claimed() : task);
    tree = harness.render("CustomerTaskQueue", props());
    expect(cardIds(harness, tree)).toEqual([103, 102, 101]);
    for (const caller of [actor.id, teammate.id]) expect(harness.ui.customerTaskQueues(tasks, caller).open.map(task => task.id)).toEqual([103, 102, 101]);
    button(tree, "Mine2").props.onClick(); tree = harness.render("CustomerTaskQueue", props());
    expect(cardIds(harness, tree)).toEqual([102, 101]);
    button(tree, "Done1").props.onClick(); tree = harness.render("CustomerTaskQueue", props());
    expect(cardIds(harness, tree)).toEqual([104]);
    button(tree, "Open3").props.onClick(); tasks = tasks.map(task => task.id === 101 ? completed() : task);
    tree = harness.render("CustomerTaskQueue", props());
    expect(cardIds(harness, tree)).toEqual([103, 102]);
    expect(button(tree, "Open2")).toBeDefined(); expect(button(tree, "Done2")).toBeDefined();
    expect(harness.ui.customerTaskQueues(tasks, teammate.id).open.map(task => task.id)).toEqual([103, 102]);
  });

  it.each(["queue", "stream"] as const)("uses local saving state and busyRef in %s even when provider pending has not updated", async placement => {
    const request = deferred<void>();
    const actions = { claim: vi.fn(() => request.promise), complete: vi.fn(), completeItem: vi.fn() };
    const harness = stateHarness(); const task = fixture();
    const props = { task, callerId: actor.id, pending: false, actions, placement, now: NOW };
    const click = button(harness.render("TaskCard", props), "Claim").props.onClick;
    click(); click();
    expect(actions.claim).toHaveBeenCalledTimes(1);
    const saving = button(harness.render("TaskCard", props), "Claiming…");
    expect(saving.props.disabled).toBe(true); saving.props.onClick();
    expect(actions.claim).toHaveBeenCalledTimes(1); expect(actions.claim).toHaveBeenCalledWith(101);
    expect(task.owner).toBeNull(); expect(task.status).toBe("unclaimed");
    request.resolve(); await flush();
    expect(button(harness.render("TaskCard", props), "Claim").props.disabled).toBe(false);
    expect(task.owner).toBeNull(); expect(task.status).toBe("unclaimed");
  });

  it.each(["queue", "stream"] as const)("shows immediate local Claiming and coalesces stale double clicks in %s before the RPC starts", async placement => {
    const rig = providerHarness();
    const click = button(rig.card(placement), "Claim").props.onClick;
    click(); click();
    expect(rig.claim).not.toHaveBeenCalled(); // pre-write cancellation is awaited
    const busy = button(rig.card(placement), "Claiming…");
    expect(busy.props.disabled).toBe(true); busy.props.onClick();
    expect(rig.context().pendingIds.has(101)).toBe(true);
    expect(rig.rows()![0].owner).toBeNull(); expect(rig.gets.get(101)!.status).toBe("unclaimed");
    await flush(); expect(rig.claim).toHaveBeenCalledTimes(1); expect(rig.claim).toHaveBeenCalledWith({ id: 101 });
    rig.claimResult.resolve(claimed()); await flush();
    expect(rig.context().pendingIds.has(101)).toBe(false);
    expect(text(rig.card(placement))).toContain("Claimed by Synthetic claimer");
    expect(cardIds(rig, rig.queue())).toContain(101);
  });

  it("shares the provider guard across distinct queue and stream cards, including stale handlers", async () => {
    const rig = providerHarness();
    const queueClick = button(rig.card("queue"), "Claim").props.onClick;
    const streamClick = button(rig.card("stream"), "Claim").props.onClick;
    queueClick(); queueClick(); streamClick(); streamClick();
    await flush(); expect(rig.claim).toHaveBeenCalledTimes(1);
    for (const placement of ["queue", "stream"] as const) {
      const busy = button(rig.card(placement), "Claiming…");
      expect(busy.props.disabled).toBe(true); busy.props.onClick();
    }
    await flush(); expect(rig.claim).toHaveBeenCalledTimes(1);
    rig.claimResult.resolve(claimed()); await flush();
    expect(rig.context().pendingIds.size).toBe(0);
    expect(rig.rows()![0]).toEqual(claimed()); expect(rig.gets.get(101)).toEqual(claimed());
  });
});

describe("Customer task canonical-cache reconciliation lifecycle", () => {
  it("keeps pending and the same-task guard until whole-router reconciliation resolves", async () => {
    const rig = providerHarness(); const refresh = deferred<void>();
    rig.invalidate.mockImplementation(() => refresh.promise);
    const saving = rig.context().actions.claim(101); let settled = false;
    void saving.then(() => { settled = true; });
    await flush(); rig.claimResult.resolve(claimed()); await flush();
    expect(rig.gets.get(101)).toEqual(claimed()); expect(rig.rows()![0]).toEqual(claimed());
    expect(rig.invalidate).toHaveBeenCalledTimes(1); expect(rig.invalidate).toHaveBeenCalledWith();
    expect(rig.context().pendingIds.has(101)).toBe(true); expect(settled).toBe(false);
    await expect(rig.context().actions.claim(101)).rejects.toThrow("already saving");
    expect(rig.claim).toHaveBeenCalledTimes(1);
    expect(button(rig.card("queue"), "Mark done").props.disabled).toBe(true);
    expect(button(rig.card("stream"), "Mark done").props.disabled).toBe(true);
    refresh.resolve(); await saving;
    expect(rig.context().pendingIds.has(101)).toBe(false); expect(settled).toBe(true);
    expect(button(rig.card("queue"), "Mark done").props.disabled).toBe(false);
  });

  it("awaits list/get cancellation before requesting and after response before applying; cancelled mock reads cannot overwrite", async () => {
    const rig = providerHarness();
    const beforeList = deferred<void>(); const beforeGet = deferred<void>();
    const afterList = deferred<void>(); const afterGet = deferred<void>();
    rig.listCancel.mockImplementation(() => {
      rig.events.push("cancel:list"); rig.cancelListReads();
      return rig.listCancel.mock.calls.length === 1 ? beforeList.promise : afterList.promise;
    });
    rig.getCancel.mockImplementation(input => {
      rig.events.push("cancel:get"); rig.cancelGetReads(input.id);
      return rig.getCancel.mock.calls.length === 1 ? beforeGet.promise : afterGet.promise;
    });
    const olderList = rig.startRead("list", fixture()); const olderGet = rig.startRead("get", fixture());
    const saving = rig.context().actions.claim(101);
    expect(olderList.cancelled).toBe(true); expect(olderGet.cancelled).toBe(true);
    expect(olderList.deliver()).toBe(false); expect(olderGet.deliver()).toBe(false);
    beforeList.resolve(); await flush(); expect(rig.claim).not.toHaveBeenCalled();
    beforeGet.resolve(); await flush(); expect(rig.claim).toHaveBeenCalledTimes(1);
    const duringList = rig.startRead("list", fixture()); const duringGet = rig.startRead("get", fixture());
    rig.claimResult.resolve(claimed()); await flush();
    expect(duringList.cancelled).toBe(true); expect(duringGet.cancelled).toBe(true);
    expect(rig.getSet).not.toHaveBeenCalled(); expect(rig.listSet).not.toHaveBeenCalled();
    afterList.resolve(); await flush(); expect(rig.getSet).not.toHaveBeenCalled();
    afterGet.resolve(); await saving;
    expect(rig.listCancel.mock.calls).toEqual([[{}], [{}]]);
    expect(rig.getCancel.mock.calls).toEqual([[{ id: 101 }], [{ id: 101 }]]);
    expect(rig.events).toEqual(["cancel:list", "cancel:get", "request:claim", "cancel:list", "cancel:get", "apply:get", "apply:list", "invalidate"]);
    expect(duringList.deliver()).toBe(false); expect(duringGet.deliver()).toBe(false);
    expect(rig.getSet).toHaveBeenCalledWith({ id: 101 }, claimed());
    expect(rig.listSet.mock.calls[0][0]).toEqual({});
    expect(rig.rows()![0]).toEqual(claimed()); expect(rig.gets.get(101)).toEqual(claimed());
  });

  it.each(["request failure", "claim conflict", "failed conflict refresh"] as const)("refreshes after %s, then clears pending without inventing a local owner", async kind => {
    const rig = providerHarness(); const refresh = deferred<void>();
    rig.invalidate.mockImplementation(() => refresh.promise);
    const failure = new Error(`Synthetic ${kind}`);
    const saving = rig.context().actions.claim(101);
    const outcome = saving.then(() => null, (error: unknown) => error);
    await flush(); rig.claimResult.reject(failure); await flush();
    expect(rig.invalidate).toHaveBeenCalledWith(); expect(rig.context().pendingIds.has(101)).toBe(true);
    expect(rig.rows()![0].owner).toBeNull(); expect(rig.gets.get(101)!.owner).toBeNull();
    expect(rig.getSet).not.toHaveBeenCalled(); expect(rig.listSet).not.toHaveBeenCalled();
    if (kind === "claim conflict") rig.refetch(claimed(teammate));
    if (kind === "failed conflict refresh") refresh.reject(new Error("Synthetic refresh unavailable")); else refresh.resolve();
    expect(await outcome).toBe(failure);
    expect(rig.context().pendingIds.has(101)).toBe(false);
    expect(rig.rows()![0].owner?.id).not.toBe(actor.id); expect(rig.gets.get(101)!.owner?.id).not.toBe(actor.id);
    if (kind === "claim conflict") {
      expect(text(rig.card("queue"))).toContain("Claimed by Synthetic teammate");
      expect(button(rig.card("stream"), "Mark done")).toBeUndefined();
    } else expect(button(rig.card("queue"), "Claim").props.disabled).toBe(false);
  });

  it("preserves a successful canonical record when the subsequent refetch fails, without reporting the save as failed", async () => {
    const rig = providerHarness(); rig.invalidate.mockRejectedValue(new Error("Synthetic refetch failure"));
    button(rig.card("queue"), "Claim").props.onClick(); await flush();
    rig.claimResult.resolve(claimed()); await flush();
    expect(rig.gets.get(101)).toEqual(claimed()); expect(rig.rows()![0]).toEqual(claimed());
    expect(rig.context().pendingIds.has(101)).toBe(false);
    expect(text(rig.card("queue"))).not.toContain("Task update failed");
    expect(text(rig.card("stream"))).toContain("Claimed by Synthetic claimer");
    expect(cardIds(rig, rig.queue())).toContain(101);
  });

  it.each(["missing from loaded list", "loaded empty list", "undefined list"] as const)("upserts the get record for %s without manufacturing a partial undefined list", async kind => {
    const other = fixture({ id: 202 });
    const initial = kind === "undefined list" ? undefined : kind === "loaded empty list" ? [] : [other];
    const rig = providerHarness(initial);
    const saving = rig.context().actions.claim(101); await flush(); rig.claimResult.resolve(claimed()); await saving;
    expect(rig.gets.get(101)).toEqual(claimed()); expect(rig.getSet).toHaveBeenCalledWith({ id: 101 }, claimed());
    expect(rig.listSet).toHaveBeenCalledTimes(1);
    if (kind === "undefined list") expect(rig.rows()).toBeUndefined();
    else {
      expect(rig.rows()!.filter(task => task.id === 101)).toEqual([claimed()]);
      expect(rig.rows()).toHaveLength(kind === "loaded empty list" ? 1 : 2);
      if (kind === "missing from loaded list") expect(rig.rows()![0]).toBe(other);
    }
  });
});

describe("Common queue/stream human-completion popup", () => {
  it.each(["queue", "stream"] as const)("requires a trimmed note and Cancel makes no mutation in %s", async placement => {
    const rig = providerHarness([claimed()]);
    expect(rig.cardElement(placement).type).toBe(rig.ui.TaskCard);
    button(rig.card(placement), "Mark done").props.onClick();
    let tree = rig.card(placement); expect(isOpen(tree)).toBe(true);
    expect(rig.confirmElement(tree).type).toBe(rig.ui.TaskCompletionConfirm);
    const popup = rig.popup(tree);
    expect(text(popup)).toContain("Completion note (required)");
    expect(text(popup)).toContain("human confirmation"); expect(text(popup)).toContain("not system verification");
    expect(elements(popup).find(node => node.type === "textarea")!.props.required).toBe(true);
    expect(button(popup, "Confirm done").props.disabled).toBe(true);
    rig.confirmElement(tree).props.onConfirm();
    rig.confirmElement(tree).props.onNote(" \n\t "); tree = rig.card(placement);
    expect(button(rig.popup(tree), "Confirm done").props.disabled).toBe(true);
    rig.confirmElement(tree).props.onConfirm(); await flush(); expect(rig.complete).not.toHaveBeenCalled();
    rig.confirmElement(tree).props.onNote("A valid note not confirmed"); tree = rig.card(placement);
    expect(button(rig.popup(tree), "Confirm done").props.disabled).toBe(false);
    button(rig.popup(tree), "Cancel").props.onClick(); await flush();
    expect(isOpen(rig.card(placement))).toBe(false);
    expect(rig.claim).not.toHaveBeenCalled(); expect(rig.complete).not.toHaveBeenCalled(); expect(rig.completeItem).not.toHaveBeenCalled();
    expect(rig.invalidate).not.toHaveBeenCalled(); expect(rig.rows()![0].status).toBe("claimed");
    button(rig.card(placement), "Mark done").props.onClick();
    expect(rig.confirmElement(rig.card(placement)).props.note).toBe("");
  });

  it.each(["queue", "stream"] as const)("failed explicit completion in %s leaves the canonical task claimed and the popup available", async placement => {
    const rig = providerHarness([claimed()]); const refresh = deferred<void>();
    rig.invalidate.mockImplementation(() => refresh.promise);
    button(rig.card(placement), "Mark done").props.onClick();
    rig.confirmElement(rig.card(placement)).props.onNote("  Attempted synthetic completion  ");
    rig.confirmElement(rig.card(placement)).props.onConfirm(); await flush();
    expect(rig.complete).toHaveBeenCalledWith({ id: 101, note: "Attempted synthetic completion" });
    rig.doneResult.reject(new Error("PRIVATE synthetic rejection")); await flush();
    expect(rig.context().pendingIds.has(101)).toBe(true);
    expect(button(rig.popup(rig.card(placement)), "Saving…").props.disabled).toBe(true);
    refresh.resolve(); await flush();
    const tree = rig.card(placement); expect(isOpen(tree)).toBe(true);
    expect(text(rig.popup(tree))).toContain("Task update failed"); expect(text(rig.popup(tree))).not.toContain("PRIVATE");
    expect(button(rig.popup(tree), "Confirm done").props.disabled).toBe(false);
    expect(rig.context().pendingIds.has(101)).toBe(false);
    expect(rig.rows()![0]).toEqual(claimed()); expect(rig.gets.get(101)).toEqual(claimed());
    expect(rig.rows()![0].completionNote).toBeNull(); expect(rig.getSet).not.toHaveBeenCalled();
    expect(rig.completeItem).not.toHaveBeenCalled(); expect(cardIds(rig, rig.queue())).toContain(101);
  });

  it.each(["queue", "stream"] as const)("only explicit valid confirmation completes %s, awaiting reconciliation before dismissing", async placement => {
    const rig = providerHarness([claimed()]); const refresh = deferred<void>();
    rig.invalidate.mockImplementation(() => refresh.promise);
    button(rig.card(placement), "Mark done").props.onClick();
    rig.confirmElement(rig.card(placement)).props.onNote("  Reviewed both requested actions.  ");
    let tree = rig.card(placement); const props = rig.cardElement(placement).props;
    expect(rig.complete).not.toHaveBeenCalled(); expect(rig.rows()![0].status).toBe("claimed");
    const confirm = button(rig.popup(tree), "Confirm done").props.onClick;
    confirm(); confirm();
    tree = rig.card(placement);
    expect(button(rig.popup(tree), "Saving…").props.disabled).toBe(true);
    expect(button(rig.popup(tree), "Cancel").props.disabled).toBe(true);
    await flush(); expect(rig.complete).toHaveBeenCalledTimes(1);
    expect(rig.complete).toHaveBeenCalledWith({ id: 101, note: "Reviewed both requested actions." });
    expect(rig.completeItem).not.toHaveBeenCalled();
    rig.doneResult.resolve(completed()); await flush();
    expect(rig.gets.get(101)).toEqual(completed()); expect(rig.rows()![0]).toEqual(completed());
    expect(rig.context().pendingIds.has(101)).toBe(true);
    const stillSaving = rig.render("TaskCard", { ...props, task: rig.gets.get(101), pending: true }, `card:${placement}`);
    expect(isOpen(stillSaving)).toBe(true); expect(rig.confirmElement(stillSaving).props.pending).toBe(true);
    expect(cardIds(rig, rig.queue())).not.toContain(101);
    refresh.resolve(); await flush();
    expect(rig.context().pendingIds.has(101)).toBe(false);
    const saved = rig.render("TaskCard", { ...props, task: rig.gets.get(101), pending: false }, `card:${placement}`);
    expect(isOpen(saved)).toBe(false); expect(text(saved)).toContain(`Confirmed by ${actor.name}`);
    expect(button(saved, "Mark done")).toBeUndefined(); expect(button(saved, "Claim")).toBeUndefined();
    expect(rig.ui.customerTaskQueues(rig.rows()!, actor.id).done.map(task => task.id)).toEqual([101]);
  });
});
