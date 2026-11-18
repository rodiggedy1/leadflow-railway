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

// Local-only VM/SSR seams follow claudeCustomerTasksUi.test.ts; never import the app.
const path = "client/src/components/ClaudeCustomerTasks.tsx";
const source = readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const output = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true } }).outputText;
const NOW = 1800000000000, actor = { id: "17", name: "Synthetic staff" };
const actions = () => ({ claim: vi.fn(), completeItem: vi.fn(), complete: vi.fn() });
type Element = React.ReactElement<Record<string, any>>;
type Ui = Record<"TaskCard" | "ClaudeCustomerTaskStreamCard", React.ComponentType<any>>;
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
function load(react: typeof React, get: unknown): Ui {
  const module = { exports: {} as Ui };
  const div = (props: any) => React.createElement("div", null, props.children);
  runInNewContext(output, { module, exports: module.exports, Date, Intl, Map, Set, Error, Number, fetch: forbiddenRead,
    require: (id: string) => {
      if (id === "react") return react;
      if (id === "dompurify") return DOMPurify;
      if (id === "lucide-react") return icons;
      if (id === "@/lib/trpc") return { trpc: { claudeCustomerTasks: { get: { useQuery: get } } } };
      if (id === "@shared/claudeCustomerTasks") return contract;
      if (id === "@/components/ui/dialog") return { Dialog: (props: any) => props.open ? div(props) : null, DialogContent: div, DialogDescription: div, DialogTitle: div, DialogTrigger: div };
      if (id.endsWith(".css")) return {};
      throw new Error(`Unexpected UI import: ${id}`);
    },
  }, { timeout: 1500 });
  return module.exports;
}
function harness(get: any, pending = false) {
  const context = { callerId: actor.id, actions: actions(), pendingIds: new Set(pending ? [101] : []), onOpenConversation: vi.fn(), refresh: vi.fn(), tasks: [fixture()] };
  const slots: any[] = []; let cursor = 0;
  const react = { ...React, useContext: () => context,
    useState(initial: any) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === "function" ? initial() : initial; return [slots[i], (next: any) => { slots[i] = typeof next === "function" ? next(slots[i]) : next; }]; },
    useRef(initial: any) { const i = cursor++; return slots[i] ??= { current: initial }; },
  } as unknown as typeof React;
  const ui = load(react, get);
  const ssr = load({ ...React, useContext: () => context } as unknown as typeof React, get);
  return { ui, context, render(taskId: number | null = 101) { cursor = 0; return (ui.ClaudeCustomerTaskStreamCard as (props: any) => Element)({ taskId }); },
    html: () => renderToStaticMarkup(React.createElement(ssr.ClaudeCustomerTaskStreamCard, { taskId: 101 })),
  };
}
function card(tree: Element, h: ReturnType<typeof harness>, task: CustomerTask) {
  expect(tree.type).toBe(React.Fragment);
  const first = tree.props.children[0] as Element;
  expect(first.type).toBe(h.ui.TaskCard); expect(first.key).toBe(String(task.id)); expect(first.props.task).toBe(task);
  expect(first.props).toEqual({ task, callerId: h.context.callerId, actions: h.context.actions, pending: h.context.pendingIds.has(task.id), onOpenConversation: h.context.onOpenConversation, placement: "stream" });
  return first;
}
const query = (data: CustomerTask | null | undefined, error: unknown = null, isLoading = false) => ({ data, error, isLoading, isError: Boolean(error), refetch: vi.fn() });
const transient = [new Error("Synthetic network failure"), ...["INTERNAL_SERVER_ERROR", "TIMEOUT", "TOO_MANY_REQUESTS", "BAD_GATEWAY", "SERVICE_UNAVAILABLE", "GATEWAY_TIMEOUT"].map(code => ({ data: { code } }))];
beforeEach(() => { vi.stubGlobal("fetch", vi.fn(forbiddenRead)); });
afterEach(() => { expect(globalThis.fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals(); });

describe("Stream refresh display-only boundary", () => {
  it.each([null, 0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])("disables invalid task reference %s even with cached data", taskId => {
    const get = vi.fn(() => query(fixture())); const h = harness(get); const tree = h.render(taskId);
    expect(text(tree)).toBe("Task reference unavailable."); expect(nodes(tree).some(node => node.type === h.ui.TaskCard)).toBe(false);
    expect(get).toHaveBeenCalledWith({ id: taskId ?? 0 }, { enabled: false, staleTime: 0, refetchOnWindowFocus: true, retry: false });
  });

  it("keeps initial loading, missing records, initial error and Retry without borrowing the provider list", () => {
    let result = query(undefined, null, true); const get = vi.fn(() => result); const h = harness(get);
    expect(text(h.render())).toBe("Loading task…");
    for (const data of [undefined, null]) {
      result = query(data); expect(text(h.render())).toBe("Task record unavailable.");
      result = query(data, new Error("Synthetic initial failure")); const tree = h.render();
      expect(tree.type).toBe("p"); expect(tree.props.role).toBe("alert"); expect(text(tree)).toBe("Task could not be refreshed. Retry");
      retry(tree).props.onClick(); expect(result.refetch).toHaveBeenCalledTimes(1);
    }
    expect(get.mock.calls.every(call => JSON.stringify(call) === JSON.stringify([{ id: 101 }, { enabled: true, staleTime: 0, refetchOnWindowFocus: true, retry: false }]))).toBe(true);
    expect(h.context.refresh).not.toHaveBeenCalled(); Object.values(h.context.actions).forEach(action => expect(action).not.toHaveBeenCalled());
  });

  it.each(["sms", "email", "call"] as const)("retains %s records uniformly for every status and transient error, without changing flags or props", channel => {
    for (const status of ["unclaimed", "claimed", "done"] as const) {
      const task = fixture(channel, status), original = JSON.stringify(task); let result = query(task);
      const h = harness(() => result, true); const clean = card(h.render(), h, task);
      expect(h.html()).toContain(`data-task-status="${status}"`);
      for (const error of transient) {
        result = query(task, error); const tree = h.render(), retained = card(tree, h, task);
        expect([retained.type, retained.key]).toEqual([clean.type, clean.key]);
        expect(tree.props.children[1].type).toBe("p"); expect(text(tree.props.children[1])).toBe(`${warning}Retry`);
        expect(h.html()).toContain(warning); expect(h.html()).toContain(`data-task-status="${status}"`);
        retry(tree).props.onClick(); expect(result.refetch).toHaveBeenCalledTimes(1);
      }
      result = query(task); card(h.render(), h, task); expect(h.html()).not.toContain(warning);
      expect(JSON.stringify(task)).toBe(original); expect(h.context.onOpenConversation).not.toHaveBeenCalled(); expect(h.context.refresh).not.toHaveBeenCalled();
      Object.values(h.context.actions).forEach(action => expect(action).not.toHaveBeenCalled());
    }
  });

  it.each(["UNAUTHORIZED", "FORBIDDEN", "NOT_FOUND", "BAD_REQUEST", "PRECONDITION_FAILED", "CONFLICT", "UNPROCESSABLE_CONTENT", "NOT_IMPLEMENTED", "UNKNOWN_NONTRANSIENT_CODE"])("blocks cached display on authoritative/nontransient code %s", code => {
    for (const httpStatus of [undefined, 500]) {
      const result = query(fixture(), { data: { code, httpStatus } }); const h = harness(() => result); const tree = h.render();
      expect(tree.type).toBe("p"); expect(tree.props.role).toBe("alert"); expect(text(tree)).toBe("Task could not be refreshed. Retry"); expect(h.html()).not.toContain("data-task-id");
      retry(tree).props.onClick(); expect(result.refetch).toHaveBeenCalledTimes(1);
    }
  });

  it.each([400, 401, 403, 404, 409, 412, 422])("blocks HTTP %s even if its code says transient", httpStatus => {
    for (const code of [undefined, "INTERNAL_SERVER_ERROR"]) {
      const h = harness(() => query(fixture(), { data: { code, httpStatus } }));
      expect(h.render().type).toBe("p"); expect(h.html()).not.toContain("data-task-id"); expect(text(h.render())).not.toContain(warning);
    }
  });

  it.each([408, 429, 500, 502, 503, 504])("retains matching cached data for transient HTTP %s", httpStatus => {
    const task = fixture(); const h = harness(() => query(task, { data: { httpStatus } }));
    card(h.render(), h, task); expect(h.html()).toContain(warning);
  });

  it("never displays a different task and discards loaded data after successful null; fresh owner/completion wins", () => {
    const initial = fixture("email", "claimed"); let result = query(initial); const h = harness(() => result); card(h.render(), h, initial);
    const otherOwner = contract.customerTaskSchema.parse({ ...initial, owner: { id: "18", name: "Other synthetic staff" } });
    result = query(otherOwner); card(h.render(), h, otherOwner); expect(h.html()).toContain("Claimed by Other synthetic staff"); expect(h.html()).not.toContain("Mark done");
    const done = fixture("email", "done"); result = query(done); card(h.render(), h, done); expect(h.html()).toContain("Confirmed by Synthetic staff");
    result = query(null); expect(text(h.render())).toBe("Task record unavailable."); expect(h.html()).not.toContain("data-task-id");
    for (const error of [null, new Error("Synthetic cache mismatch")]) {
      result = query(contract.customerTaskSchema.parse({ ...initial, id: 102 }), error);
      expect(nodes(h.render()).some(node => node.type === h.ui.TaskCard)).toBe(false); expect(h.html()).not.toContain("data-task-id");
    }
    result = query(initial, new Error("Synthetic task switch")); expect(nodes(h.render(102)).some(node => node.type === h.ui.TaskCard)).toBe(false);
  });

  it.each(["sms", "email", "call"] as const)("uses installed QueryObserver for %s success → cached refetch failure → Retry success", async channel => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
    const initial = fixture(channel, "claimed"), updated = fixture(channel, "done"), before = JSON.stringify(initial); let count = 0;
    const queryFn = vi.fn(async () => { count++; if (count === 2) throw new Error("Synthetic offline refetch failure"); return count === 1 ? initial : updated; });
    const observer = new QueryObserver(client, { queryKey: ["synthetic-task-get", 101], queryFn, enabled: false, retry: false, gcTime: Infinity });
    const unsubscribe = observer.subscribe(() => {}); const refetch = vi.fn(() => observer.refetch());
    const h = harness(() => ({ ...observer.getCurrentResult(), refetch }));
    try {
      await observer.refetch(); const cached = observer.getCurrentResult().data!; const loaded = card(h.render(), h, cached); expect(h.html()).not.toContain(warning);
      await observer.refetch(); expect(observer.getCurrentResult().isRefetchError).toBe(true); expect(observer.getCurrentResult().data).toBe(cached);
      expect(client.getQueryData(["synthetic-task-get", 101])).toBe(cached); const failed = h.render(), retained = card(failed, h, cached);
      // Reconciliation inputs only: no ReactDOM mount or dialog-lifecycle claim.
      expect([failed.type, retained.type, retained.key]).toEqual([React.Fragment, loaded.type, loaded.key]); expect(h.html()).toContain(warning);
      retry(failed).props.onClick(); await refetch.mock.results[0].value;
      expect(queryFn).toHaveBeenCalledTimes(3); expect(refetch).toHaveBeenCalledTimes(1); expect(observer.getCurrentResult().isError).toBe(false);
      card(h.render(), h, observer.getCurrentResult().data!); expect(h.html()).not.toContain(warning); expect(h.html()).toContain('data-task-status="done"');
      expect(JSON.stringify(initial)).toBe(before); expect(h.context.refresh).not.toHaveBeenCalled(); Object.values(h.context.actions).forEach(action => expect(action).not.toHaveBeenCalled());
      expect(client.getMutationCache().getAll()).toHaveLength(0);
    } finally { unsubscribe(); observer.destroy(); client.clear(); }
  });

  it("preserves all component bytes outside the whole stream-function AST span and every other tracked source", () => {
    const cwd = new URL("../", import.meta.url).pathname;
    const baseline = execFileSync("git", ["show", `964db1830ac97ec8473fac0b3a7d00638d829aea:${path}`], { cwd, encoding: "utf8" });
    const normalize = (value: string) => {
      const ast = ts.createSourceFile(path, value, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      const matches = ast.statements.filter(node => ts.isFunctionDeclaration(node) && node.name?.text === "ClaudeCustomerTaskStreamCard");
      expect(matches).toHaveLength(1); const node = matches[0]; return value.slice(0, node.getStart(ast)) + "<stream-function>" + value.slice(node.end);
    };
    expect(normalize(source)).toBe(normalize(baseline));
    const allowed = [path, "server/claudeCustomerTasksUi.test.ts", "server/claudeCustomerEmailTaskUi.test.ts", "server/claudeCustomerTasksRefreshUi.test.ts"];
    const changed = execFileSync("git", ["diff", "--name-only", "HEAD"], { cwd, encoding: "utf8" }).trim().split("\n").filter(Boolean);
    expect(changed.filter(file => !allowed.includes(file))).toEqual([]);
  });
});
