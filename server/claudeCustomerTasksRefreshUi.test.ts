import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import * as ts from "typescript";
import DOMPurify from "dompurify";
import * as icons from "lucide-react";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import * as contract from "../shared/claudeCustomerTasks";
import type { CustomerTask } from "../shared/claudeCustomerTasks";
import { withoutApprovedStaffCallFeature } from "./staffCallSourceControl";

// Local-only VM/SSR seams: execute the actual provider/classifier and consumers.
// No application, DB, real customer, model, external provider, or live network imports.
const path = "client/src/components/ClaudeCustomerTasks.tsx";
const source = readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const output = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true } }).outputText;
const NOW = 1800000000000, actor = { id: "17", name: "Synthetic staff" };
type Element = React.ReactElement<Record<string, any>>;
type Ui = Record<"TaskCard" | "ClaudeCustomerTaskStreamCard" | "ClaudeCustomerTasksProvider" | "ClaudeCustomerTasksQueue" | "CustomerTaskQueue", React.ComponentType<any>>;
const text = (tree: any): string => typeof tree === "string" || typeof tree === "number" ? String(tree) : Array.isArray(tree) ? tree.map(text).join("") : React.isValidElement<Record<string, any>>(tree) ? text(tree.props.children) : "";
const nodes = (tree: any): Element[] => Array.isArray(tree) ? tree.flatMap(nodes) : React.isValidElement<Record<string, any>>(tree) ? [tree, ...nodes(tree.props.children)] : [];
const retry = (tree: Element) => nodes(tree).find(node => node.type === "button" && text(node) === "Retry")!;
const warning = "Task could not be refreshed. Showing the last loaded status. ";
function fixture(channel: "sms" | "email" | "call" = "sms", status: CustomerTask["status"] = "unclaimed"): CustomerTask {
  const base = {
    id: 101, version: 1, kind: "claude_customer_task", sessionId: 42, customerName: "Synthetic customer", customerPhone: "+13015550123",
    sourceMessageId: "SYNTHETIC_REQUEST", sourceText: "Please review this exact synthetic request.", receivedAt: NOW,
    receivingPhoneNumberId: "SYNTHETIC_LINE", receivingPhoneNumber: "+13015550987", title: "Review synthetic request",
    items: [{ id: "review", title: "Review request", evidenceQuote: "review this exact synthetic request", completedBy: null, completedAt: null }],
    status, owner: status === "unclaimed" ? null : actor, claimedAt: status === "unclaimed" ? null : NOW,
    completedBy: status === "done" ? actor : null, completedAt: status === "done" ? NOW : null, completionNote: status === "done" ? "Synthetic human confirmation" : null,
    reply: { text: "Staff will review this request.", status: "prepared", providerMessageId: null }, activity: [{ action: "created", actor: null, at: NOW, note: null }],
  };
  return contract.customerTaskSchema.parse(channel === "sms" ? base : channel === "email" ? { ...base,
    sessionId: null, customerPhone: null, receivingPhoneNumberId: null, receivingPhoneNumber: null,
    email: { mailboxEmail: "staff@example.test", threadId: "SYNTHETIC_THREAD", fromEmail: "customer@example.test", replyToEmail: null, recipientEmail: "staff@example.test", subject: "Synthetic request", rfcMessageId: "synthetic@example.test", bodyFormat: "text" },
  } : { ...base, receivingPhoneNumberId: null, receivingPhoneNumber: null, reply: { text: "", status: "not_applicable", providerMessageId: null },
    call: { provider: "vapi", providerCallId: "SYNTHETIC_CALL", voiceCallId: 77, transcript: base.sourceText, recordingUrl: null, callbackTaskIds: [] },
  });
}
const forbiddenRead = () => { throw new Error("Unexpected network or external UI dependency"); };
function load(react: typeof React, trpc: unknown): Ui {
  const module = { exports: {} as Ui };
  const div = (props: any) => React.createElement("div", null, props.children);
  runInNewContext(output, { module, exports: module.exports, Date, Intl, Map, Set, Error, Number, fetch: forbiddenRead,
    require: (id: string) => {
      if (id === "react") return react;
      if (id === "dompurify") return DOMPurify;
      if (id === "lucide-react") return icons;
      if (id === "@/lib/trpc") return { trpc };
      if (id === "@shared/claudeCustomerTasks") return contract;
      if (id === "@/components/ui/dialog") return { Dialog: (props: any) => props.open ? div(props) : null, DialogContent: div, DialogDescription: div, DialogTitle: div, DialogTrigger: div };
      if (id.endsWith(".css")) return {};
      throw new Error(`Unexpected UI import: ${id}`);
    },
  }, { timeout: 1500 });
  return module.exports;
}
const query = <T,>(data: T | undefined, error: unknown = null, isLoading = false) => ({ data, error, isLoading, isError: Boolean(error), refetch: vi.fn() });
const transientCodes = ["INTERNAL_SERVER_ERROR", "TIMEOUT", "TOO_MANY_REQUESTS", "BAD_GATEWAY", "SERVICE_UNAVAILABLE", "GATEWAY_TIMEOUT"];
const transient = [new Error("Synthetic network failure"), ...transientCodes.map(code => ({ data: { code } }))];
const sources = ["identity", "list"] as const;
let harnesses: ReturnType<typeof harness>[] = [];
function harness(rows: CustomerTask[] | undefined = [fixture()], pending = false) {
  const state = { list: query(rows), identity: query<typeof actor | undefined>(actor) };
  const invalidate = vi.fn(), get = vi.fn(forbiddenRead), mutations = { claim: vi.fn(forbiddenRead), completeItem: vi.fn(forbiddenRead), complete: vi.fn(forbiddenRead) };
  const cache = { getSet: vi.fn(), listSet: vi.fn(), getCancel: vi.fn(), listCancel: vi.fn() };
  const identityRead = vi.fn(() => state.identity), listRead = vi.fn(() => state.list), onOpenConversation = vi.fn();
  const api = { useUtils: () => ({ claudeCustomerTasks: { invalidate, get: { setData: cache.getSet, cancel: cache.getCancel }, list: { setData: cache.listSet, cancel: cache.listCancel } } }),
    claudeCustomerTasks: { identity: { useQuery: identityRead }, list: { useQuery: listRead }, get: { useQuery: get },
      ...Object.fromEntries(Object.entries(mutations).map(([name, mutateAsync]) => [name, { useMutation: () => ({ mutateAsync }) }])) } };
  let context: any; const slots: any[] = []; let cursor = 0;
  const react = { ...React, useContext: () => context,
    useState(initial: any) { const i = cursor++; if (!(i in slots)) slots[i] = pending ? new Set([101]) : typeof initial === "function" ? initial() : initial; return [slots[i], (next: any) => { slots[i] = typeof next === "function" ? next(slots[i]) : next; }]; },
    useRef(initial: any) { const i = cursor++; return slots[i] ??= { current: initial }; },
  } as unknown as typeof React;
  const ui = load(react, api), ssr = load({ ...React, useContext: () => context } as unknown as typeof React, api);
  const h = { ui, state, invalidate, get, mutations, cache, identityRead, listRead, onOpenConversation,
    get context() { return context; },
    provide() { cursor = 0; context = (ui.ClaudeCustomerTasksProvider as (props: any) => Element)({ callerId: "UNTRUSTED_COOKIE_ID", children: null, onOpenConversation }).props.value; return context; },
    render(taskId: number | null = 101) { return (ui.ClaudeCustomerTaskStreamCard as (props: any) => Element)({ taskId }); },
    queue() { return (ui.ClaudeCustomerTasksQueue as (props: any) => Element)({}); },
    html(taskId: number | null = 101) { return renderToStaticMarkup(React.createElement(ssr.ClaudeCustomerTaskStreamCard, { taskId })); },
    queueHtml() { return renderToStaticMarkup(React.createElement(ssr.ClaudeCustomerTasksQueue)); },
  };
  h.provide(); harnesses.push(h); return h;
}
function card(tree: Element, h: ReturnType<typeof harness>, task: CustomerTask) {
  expect(tree.type).toBe(React.Fragment);
  const first = tree.props.children[0] as Element;
  expect(first.type).toBe(h.ui.TaskCard); expect(first.key).toBe(String(task.id)); expect(first.props.task).toBe(task);
  expect(first.props).toEqual({ task, callerId: h.context.callerId, actions: h.context.actions, pending: h.context.pendingIds.has(task.id), onOpenConversation: h.context.onOpenConversation, placement: "stream" });
  return first;
}
function blocked(h: ReturnType<typeof harness>) {
  const tree = h.render(); expect(tree.type).toBe("p"); expect(tree.props.role).toBe("alert");
  expect(text(tree)).toBe("Task could not be refreshed. Retry"); expect(h.html()).not.toContain("data-task-id");
  retry(tree).props.onClick(); return tree;
}
beforeEach(() => { harnesses = []; vi.stubGlobal("fetch", vi.fn(forbiddenRead)); });
afterEach(() => {
  expect(globalThis.fetch).not.toHaveBeenCalled();
  for (const h of harnesses) {
    expect(h.get).not.toHaveBeenCalled(); expect(h.onOpenConversation).not.toHaveBeenCalled();
    [...Object.values(h.mutations), ...Object.values(h.cache)].forEach(action => expect(action).not.toHaveBeenCalled());
  }
  vi.unstubAllGlobals();
});

describe("Stream shared-list refresh display-only boundary", () => {
  it.each([null, 0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])("rejects invalid task reference %s before loading/errors, without any get query", taskId => {
    const h = harness(); h.state.list = query(h.context.tasks, { data: { code: "UNAUTHORIZED", httpStatus: 401 } }, true); h.provide();
    expect(text(h.render(taskId))).toBe("Task reference unavailable."); expect(nodes(h.render(taskId)).some(node => node.type === h.ui.TaskCard)).toBe(false);
  });

  it("keeps initial list/identity loading, missing rows, initial read errors and Retry on the actual context refresh", () => {
    const h = harness(undefined);
    for (const side of sources) {
      h.state.list = query(undefined); h.state.identity = query(actor);
      h.state[side] = query(undefined, null, true) as any; h.provide();
      expect(h.context.loading).toBe(true); expect(text(h.render())).toBe("Loading task…");
      h.state.list = query([]); h.state.identity = query(actor); h.provide();
      expect(text(h.render())).toBe("Task record unavailable.");
      h.state[side] = query(undefined, new Error("Synthetic initial failure")) as any; h.provide();
      expect(h.context.failed).toBe(true); expect(h.context.transientFailure).toBe(true); blocked(h);
    }
    expect(h.invalidate).toHaveBeenCalledTimes(2);
    expect(h.context.callerId).not.toBe("UNTRUSTED_COOKIE_ID");
    expect(h.identityRead.mock.calls.every(call => JSON.stringify(call) === JSON.stringify([undefined, { staleTime: 300_000, retry: false, refetchOnWindowFocus: false }]))).toBe(true);
    expect(h.listRead.mock.calls.every(call => JSON.stringify(call) === JSON.stringify([{}, { staleTime: 0, refetchOnWindowFocus: true, retry: false }]))).toBe(true);
  });

  it.each(["sms", "email", "call"] as const)("retains %s shared records uniformly for every status and actual provider transient classification", channel => {
    for (const status of ["unclaimed", "claimed", "done"] as const) {
      const task = fixture(channel, status), rows = [task], original = JSON.stringify(task), h = harness(rows, true), clean = card(h.render(), h, task);
      expect(h.context.tasks).toBe(rows); expect(h.context.callerId).toBe(actor.id); expect(h.html()).toContain(`data-task-status="${status}"`);
      for (const side of sources) for (const error of transient) {
        h.state.list = query(rows); h.state.identity = query(actor);
        h.state[side] = query(side === "list" ? rows : actor, error) as any; h.provide();
        expect(h.context.failed).toBe(true); expect(h.context.transientFailure).toBe(true); expect(h.context.tasks).toBe(rows);
        const tree = h.render(), retained = card(tree, h, task);
        expect([retained.type, retained.key]).toEqual([clean.type, clean.key]);
        expect(tree.props.children[1].type).toBe("p"); expect(tree.props.children[1].props.role).toBe("alert"); expect(text(tree.props.children[1])).toBe(`${warning}Retry`);
        expect(h.html()).toContain(warning); expect(h.html()).toContain(`data-task-status="${status}"`);
        retry(tree).props.onClick(); expect(h.state[side].refetch).not.toHaveBeenCalled();
      }
      expect(h.invalidate).toHaveBeenCalledTimes(sources.length * transient.length);
      h.state.list = query(rows); h.state.identity = query(actor); h.provide(); card(h.render(), h, task);
      expect(h.html()).not.toContain(warning); expect(JSON.stringify(task)).toBe(original);
    }
  });

  it.each(["UNAUTHORIZED", "FORBIDDEN", "NOT_FOUND", "BAD_REQUEST", "PRECONDITION_FAILED", "CONFLICT", "UNPROCESSABLE_CONTENT", "NOT_IMPLEMENTED", "UNKNOWN_NONTRANSIENT_CODE"])("actual provider blocks authoritative/nontransient code %s from either read", code => {
    const rows = [fixture()], h = harness(rows);
    for (const side of sources) for (const httpStatus of [undefined, 500]) {
      h.state.list = query(rows); h.state.identity = query(actor);
      h.state[side] = query(side === "list" ? rows : actor, { data: { code, httpStatus } }) as any; h.provide();
      expect(h.context.transientFailure).toBe(false); blocked(h);
      // Queue keeps its existing error behavior and receives the identical list, not a fallback.
      expect(h.queue().props.tasks).toBe(rows); expect(h.queue().props.failed).toBe(true);
      expect(h.queueHtml()).toContain("Tasks could not be refreshed. Retry to get the latest status.");
      expect(h.queueHtml()).toContain('data-task-id="101"');
    }
    expect(h.invalidate).toHaveBeenCalledTimes(4);
  });

  it.each([400, 401, 403, 404, 409, 412, 422])("actual provider blocks HTTP %s including every accepted transient code", httpStatus => {
    const rows = [fixture()], h = harness(rows);
    for (const side of sources) for (const code of [undefined, ...transientCodes]) {
      h.state.list = query(rows); h.state.identity = query(actor);
      h.state[side] = query(side === "list" ? rows : actor, { data: { code, httpStatus } }) as any; h.provide();
      expect(h.context.transientFailure).toBe(false); blocked(h);
    }
  });

  it.each([408, 429, 500, 502, 503, 504])("actual provider retains matching shared data for transient HTTP %s", httpStatus => {
    const task = fixture(), rows = [task], h = harness(rows);
    for (const side of sources) {
      h.state.list = query(rows); h.state.identity = query(actor);
      h.state[side] = query(side === "list" ? rows : actor, { data: { httpStatus } }) as any; h.provide();
      expect(h.context.transientFailure).toBe(true); card(h.render(), h, task); expect(h.html()).toContain(warning);
    }
  });

  it("requires both actual read errors to be transient: identity500/list401 and identity401/list500 block", () => {
    const task = fixture(), rows = [task], h = harness(rows);
    for (const [identityStatus, listStatus] of [[500, 401], [401, 500], [403, 500], [500, 412]]) {
      h.state.identity = query(actor, { data: { httpStatus: identityStatus } }); h.state.list = query(rows, { data: { httpStatus: listStatus } }); h.provide();
      expect(h.context.failed).toBe(true); expect(h.context.transientFailure).toBe(false); blocked(h);
    }
    h.state.identity = query(actor, { data: { code: "TIMEOUT", httpStatus: 408 } }); h.state.list = query(rows, { data: { code: "SERVICE_UNAVAILABLE", httpStatus: 503 } }); h.provide();
    expect(h.context.transientFailure).toBe(true); card(h.render(), h, task); expect(h.html()).toContain(warning);
  });

  it("uses the same shared records for list task99/stream task70; former per-card get failure or different data cannot affect display", () => {
    const task70 = contract.customerTaskSchema.parse({ ...fixture("email", "claimed"), id: 70 });
    const task99 = contract.customerTaskSchema.parse({ ...fixture("call"), id: 99 });
    const rows = [task99, task70], h = harness(rows);
    h.get.mockImplementation(() => query(fixture("email", "done"), { data: { code: "UNAUTHORIZED", httpStatus: 401 } }));
    card(h.render(70), h, task70); expect(h.queue().props.tasks).toBe(rows);
    expect(h.html(70)).toContain('data-task-status="claimed"'); expect(h.html(70)).not.toContain(warning);
    h.state.list = query(rows, new Error("Synthetic shared70 refetch failure")); h.provide();
    card(h.render(70), h, task70); expect(h.html(70)).toContain(warning); expect(h.context.tasks).toBe(rows);
    expect(h.get).not.toHaveBeenCalled();
  });

  it("never borrows another exact id or removed row; fresh owner, completion and missing list win", () => {
    const initial = fixture("email", "claimed"), h = harness([initial]); card(h.render(), h, initial);
    const otherOwner = contract.customerTaskSchema.parse({ ...initial, owner: { id: "18", name: "Other synthetic staff" } });
    h.state.list = query([otherOwner]); h.provide(); card(h.render(), h, otherOwner); expect(h.html()).toContain("Claimed by Other synthetic staff"); expect(h.html()).not.toContain("Mark done");
    const done = fixture("email", "done"); h.state.list = query([done]); h.provide(); card(h.render(), h, done); expect(h.html()).toContain("Confirmed by Synthetic staff");
    for (const rows of [[], undefined]) {
      h.state.list = query(rows); h.provide(); expect(text(h.render())).toBe("Task record unavailable."); expect(h.html()).not.toContain("data-task-id");
      h.state.list = query(rows, new Error("Synthetic missing shared row failure")); h.provide(); blocked(h);
    }
    for (const error of [null, new Error("Synthetic exact-id mismatch")]) {
      h.state.list = query([contract.customerTaskSchema.parse({ ...initial, id: 102 })], error); h.provide();
      expect(nodes(h.render()).some(node => node.type === h.ui.TaskCard)).toBe(false); expect(h.html()).not.toContain("data-task-id");
    }
    h.state.list = query([initial], new Error("Synthetic task switch")); h.provide(); expect(nodes(h.render(102)).some(node => node.type === h.ui.TaskCard)).toBe(false);
  });

  it.each(["sms", "email", "call"] as const)("uses installed QueryObserver on the SHARED %s list: success → data+error → context Retry → fresh success → removal", async channel => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
    const initial = fixture(channel, "claimed"), updated = fixture(channel, "done"), before = JSON.stringify(initial); let count = 0;
    const queryFn = vi.fn(async () => { count++; if (count === 2) throw new Error("Synthetic offline shared-list refetch failure"); return count === 1 ? [initial] : count === 3 ? [updated] : []; });
    const key = ["synthetic-shared-task-list", {}];
    const observer = new QueryObserver(client, { queryKey: key, queryFn, enabled: false, retry: false, gcTime: Infinity });
    const unsubscribe = observer.subscribe(() => {}), h = harness(undefined);
    h.invalidate.mockImplementation(() => observer.refetch());
    const read = () => { h.state.list = observer.getCurrentResult() as any; h.provide(); };
    try {
      read(); expect(h.context.tasks).toEqual([]); expect(h.context.failed).toBe(false);
      await observer.refetch(); read(); const cached = observer.getCurrentResult().data!, loaded = card(h.render(), h, cached[0]);
      expect(h.context.tasks).toBe(cached); expect(h.html()).not.toContain(warning);
      await observer.refetch(); read(); expect(observer.getCurrentResult().isRefetchError).toBe(true); expect(observer.getCurrentResult().data).toBe(cached);
      expect(client.getQueryData(key)).toBe(cached); expect(h.context.failed).toBe(true); expect(h.context.transientFailure).toBe(true);
      const failed = h.render(), retained = card(failed, h, cached[0]);
      // Reconciliation inputs only: no ReactDOM mount or dialog-lifecycle claim.
      expect([failed.type, retained.type, retained.key]).toEqual([React.Fragment, loaded.type, loaded.key]); expect(h.html()).toContain(warning);
      retry(failed).props.onClick(); await h.invalidate.mock.results[0].value; read();
      expect(queryFn).toHaveBeenCalledTimes(3); expect(h.invalidate).toHaveBeenCalledTimes(1); expect(observer.getCurrentResult().isError).toBe(false);
      expect(h.context.failed).toBe(false); card(h.render(), h, observer.getCurrentResult().data![0]); expect(h.html()).not.toContain(warning); expect(h.html()).toContain('data-task-status="done"');
      await observer.refetch(); read(); expect(h.context.tasks).toEqual([]); expect(text(h.render())).toBe("Task record unavailable."); expect(h.html()).not.toContain("data-task-id");
      expect(JSON.stringify(initial)).toBe(before); expect(client.getMutationCache().getAll()).toHaveLength(0);
    } finally { unsubscribe(); observer.destroy(); client.clear(); }
  });

  it("does not cap 250 tasks and uses one list/identity provider read with zero per-stream gets", () => {
    const rows = Array.from({ length: 250 }, (_, index) => contract.customerTaskSchema.parse({ ...fixture(), id: index + 1 })), h = harness(rows);
    expect(h.context.tasks).toBe(rows); expect(h.queue().props.tasks).toBe(rows);
    for (const task of rows) card(h.render(task.id), h, task);
    expect([...h.queueHtml().matchAll(/data-task-id=/g)]).toHaveLength(250); expect(h.queueHtml()).toContain("Open<b>250</b>");
    expect(h.listRead).toHaveBeenCalledTimes(1); expect(h.identityRead).toHaveBeenCalledTimes(1); expect(h.get).not.toHaveBeenCalled();
  });

  it("preserves baseline85ae423e bytes except the transient context field, provider classifier/exposure and stream function", () => {
    const cwd = new URL("../", import.meta.url).pathname;
    const baseline = execFileSync("git", ["show", `85ae423e:${path}`], { cwd, encoding: "utf8" });
    const normalize = (value: string, changed: boolean) => {
      const ast = ts.createSourceFile(path, value, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX), edits: { start: number; end: number; replacement: string }[] = [];
      const context = ast.statements.find(node => ts.isTypeAliasDeclaration(node) && node.name.text === "TaskContextValue") as ts.TypeAliasDeclaration;
      expect(context).toBeDefined(); expect(ts.isTypeLiteralNode(context.type)).toBe(true);
      const fields = (context.type as ts.TypeLiteralNode).members.filter(member => member.name?.getText(ast) === "transientFailure");
      expect(fields).toHaveLength(changed ? 1 : 0);
      if (fields.length) { expect(fields[0].getText(ast)).toBe("transientFailure: boolean;"); edits.push({ start: fields[0].getFullStart(), end: fields[0].end, replacement: "" }); }
      const provider = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "ClaudeCustomerTasksProvider") as ts.FunctionDeclaration;
      expect(provider).toBeDefined();
      const classifiers = provider.body!.statements.filter(node => ts.isVariableStatement(node) && node.declarationList.declarations.some(decl => decl.name.getText(ast) === "transientFailure")) as ts.VariableStatement[];
      expect(classifiers).toHaveLength(changed ? 1 : 0);
      if (classifiers.length) {
        expect(classifiers[0].declarationList.declarations).toHaveLength(1);
        edits.push({ start: classifiers[0].getFullStart(), end: classifiers[0].end, replacement: "" });
      }
      const exposures: ts.ObjectLiteralElementLike[] = [];
      const visit = (node: ts.Node) => { if ((ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node)) && node.name.getText(ast) === "transientFailure") exposures.push(node); ts.forEachChild(node, visit); }; visit(provider);
      expect(exposures).toHaveLength(changed ? 1 : 0);
      if (exposures.length) {
        expect(exposures[0].getText(ast)).toBe("transientFailure"); expect(value[exposures[0].end]).toBe(",");
        edits.push({ start: exposures[0].getFullStart(), end: exposures[0].end + 1, replacement: "" });
      }
      const streams = ast.statements.filter(node => ts.isFunctionDeclaration(node) && node.name?.text === "ClaudeCustomerTaskStreamCard");
      expect(streams).toHaveLength(1); edits.push({ start: streams[0].getStart(ast), end: streams[0].end, replacement: "<stream-function>" });
      for (const edit of edits.sort((a, b) => b.start - a.start)) value = value.slice(0, edit.start) + edit.replacement + value.slice(edit.end);
      return value;
    };
    expect(normalize(withoutApprovedStaffCallFeature(path, source), true)).toBe(normalize(baseline, false));
    const allowed = [path, "server/claudeCustomerTasksUi.test.ts", "server/claudeCustomerEmailTaskUi.test.ts", "server/claudeCustomerCallTaskUi.test.ts", "server/claudeCustomerTasksRefreshUi.test.ts",
      "shared/claudeCustomerTasks.ts", "server/webhooks.ts", "server/claudeCustomerTasksRouter.ts", "server/claudeCustomerTasksRouter.test.ts", "server/claudeCustomerCallSafety.test.ts", "server/smsBookingQuoteIsolation.test.ts",
      "server/claudeCustomerTaskClaimLifecycle.test.ts", "server/instinct/smsBookingQuoteWritingStyle.test.ts", "server/callBookingQuoteIntegration.test.ts"];
    const changed = execFileSync("git", ["diff", "--name-only", "HEAD"], { cwd, encoding: "utf8" }).trim().split("\n").filter(Boolean);
    expect(changed.filter(file => !allowed.includes(file))).toEqual([]);
  });
});
