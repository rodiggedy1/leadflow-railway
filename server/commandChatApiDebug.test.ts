import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import React, { createElement, StrictMode } from "react";
import { createTRPCClient, TRPCClientError, type TRPCLink } from "@trpc/client";
import { observable, type Observer } from "@trpc/server/observable";
import { CancelledError, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { AppRouter } from "./routers";
import {
  COMMAND_CHAT_DEBUG_ENDPOINTS as endpoints,
  COMMAND_CHAT_API_DEBUG_SUPPRESSED,
  createCommandChatApiDebugController,
  createCommandChatApiDebugLink,
  isCommandChatApiDebugSuppressed,
  captureCommandChatApiDebugEligibility,
  useCommandChatApiDebugServerEligibility,
  useCommandChatApiDebugScope,
  useCommandChatApiDebug,
  CommandChatApiDebugProvider,
  type CommandChatApiDebugController,
  type CommandChatDebugEndpoint,
} from "../client/src/lib/commandChatApiDebug";
import { statusQueryOptions, scopedStatusRetry } from "../client/src/hooks/useCommandChatLeadStatuses";

const fixture = vi.hoisted(() => {
  if (Object.keys(process.env).some(key => /DATABASE_URL|MYSQL_URL|OPENAI_API_KEY|LAUNCH27|TWILIO|TOKEN|SECRET/.test(key))) throw new Error("Credential environment forbidden; run this test with env -i");
  const storage = new Map<string, string>();
  const noop = () => {};
  const localStorage = { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) };
  const browser = { localStorage, sessionStorage: { getItem: () => null, setItem: noop }, addEventListener: noop, removeEventListener: noop, location: { origin: "https://offline.invalid" }, matchMedia: () => ({ matches: false, addEventListener: noop, removeEventListener: noop }) };
  Object.defineProperty(globalThis, "window", { value: browser, configurable: true });
  Object.defineProperty(globalThis, "document", { value: { visibilityState: "visible", addEventListener: noop, removeEventListener: noop, getElementById: () => null, hasFocus: () => true }, configurable: true });
  Object.defineProperty(globalThis, "navigator", { value: { onLine: true, clipboard: { writeText: async () => {} } }, configurable: true });
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true, localStorage, requestAnimationFrame: () => 1, cancelAnimationFrame: noop });
  const fetch = vi.fn(() => { throw new Error("Real fetch forbidden"); });
  Object.assign(globalThis, { fetch, EventSource: class { constructor() { throw new Error("Real EventSource forbidden"); } }, WebSocket: class { constructor() { throw new Error("Real WebSocket forbidden"); } }, Audio: class { volume = 0; play() { return Promise.resolve(); } } });
  return { storage, fetch, streams: [] as { callbacks: any; options: any }[], playSound: vi.fn() };
});
vi.mock("@/hooks/useOpsStream", () => ({ useOpsStream: (callbacks: any, options: any) => { fixture.streams.push({ callbacks, options }); return {}; } }));
vi.mock("@/hooks/useNotificationSound", () => ({ useNotificationSound: () => ({ playSound: fixture.playSound, muted: true }) }));
vi.mock("@/hooks/useTabLeader", () => ({ useTabLeader: () => ({ isLeader: false }) }));
vi.mock("@/components/AiConcierge", () => ({ default: () => null }));
vi.mock("@/components/IssueEngineOverlay", () => ({ IssueEngineOverlay: () => null }));
// Presentation-only Sheet primitive: actual AllThreadsPanel query owner still mounts.
vi.mock("@/components/ui/sheet", () => ({ Sheet: ({ children }: any) => children, SheetContent: ({ children }: any) => children, SheetHeader: ({ children }: any) => children, SheetTitle: ({ children }: any) => children }));
vi.mock("dompurify", () => ({ default: { sanitize: (value: string) => value } }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

// External test-only renderer: no application dependency or absolute path is shipped.
let renderer: any;
try { renderer = createRequire(import.meta.url)(process.env.COMMAND_CHAT_TEST_RENDERER_PATH || "react-test-renderer"); }
catch { throw new Error("Mounted debug-panel tests require react-test-renderer; provide COMMAND_CHAT_TEST_RENDERER_PATH in the external isolated test runtime (not an app dependency)."); }
const act = renderer.act;
const roots: any[] = [];
const clients: QueryClient[] = [];
const controllers: CommandChatApiDebugController[] = [];
beforeEach(() => { vi.stubGlobal("React", React); captureCommandChatApiDebugEligibility(new Response(null, { headers: { "X-Command-Chat-API-Debug": "0" } }), "/api/trpc/agents.me"); });
afterEach(async () => {
  await act(async () => { roots.splice(0).forEach(root => root.unmount()); });
  clients.splice(0).forEach(client => client.clear());
  controllers.splice(0).forEach(controller => controller.dispose());
  vi.useRealTimers();
  expect(fixture.fetch).not.toHaveBeenCalled();
  fixture.storage.clear(); fixture.streams.length = 0; fixture.playSound.mockClear(); fixture.fetch.mockClear();
  vi.unstubAllGlobals();
});
function memory() {
  const values = new Map<string, string>();
  const store = { getItem: vi.fn((key: string) => values.get(key) ?? null), setItem: vi.fn((key: string, value: string) => { values.set(key, value); }) };
  return { values, store };
}
function controller(extra: Partial<Parameters<typeof createCommandChatApiDebugController>[0]> = {}) {
  const result = createCommandChatApiDebugController({ eligible: true, agentId: 70001, origin: "https://offline.invalid", storage: null, baselineStorage: null, ...extra });
  controllers.push(result); return result;
}
function pausedMask(endpoint: CommandChatDebugEndpoint) { return Object.fromEntries(endpoints.map(name => [name, name !== endpoint])); }
function savedKey(id = 70001, origin = "https://offline.invalid") { return `command-chat-api-debug:v1:${encodeURIComponent(origin)}:${id}`; }
function flushMetrics() { vi.advanceTimersByTime(100); }
function transport(c: CommandChatApiDebugController, path: string = endpoints[0], type: "query" | "mutation" | "subscription" = "query", marked = true) {
  type Link = ReturnType<TRPCLink<AppRouter>>;
  type Envelope = Parameters<Parameters<Link>[0]["next"]>[0];
  type Value = Parameters<NonNullable<Parameters<ReturnType<Parameters<Link>[0]["next"]>["subscribe"]>[0]["next"]>>[0];
  let sink!: Observer<Value, TRPCClientError<AppRouter>>;
  const cleanup = vi.fn();
  const downstream = observable<Value, TRPCClientError<AppRouter>>(observer => { sink = observer; return cleanup; });
  const next = vi.fn<Parameters<Link>[0]["next"]>(() => downstream);
  const op: Envelope = { id: 1, type, path, input: { syntheticPrivatePayload: "FAKE_PRIVATE_INPUT" }, context: marked ? c.context : {}, signal: undefined };
  const linked = createCommandChatApiDebugLink()({})({ op, next });
  const received = { next: vi.fn(), error: vi.fn(), complete: vi.fn() };
  const subscription = linked.subscribe(received);
  return { c, op, next, downstream, linked, received, subscription, cleanup, get sink() { return sink; } };
}
function deferred<T = unknown>() {
  let resolve!: (value: T) => void, reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const range = (count: number, start = 1) => Array.from({ length: count }, (_, index) => start + index);

 describe("controller identity, storage and independent toggles", () => {
  it("uses the seven literal endpoints in user order and defaults all enabled", () => {
    const c = controller();
    expect(endpoints).toEqual(["commandCenter.listCommandChatInbox", "opsChat.getLeadSessionStatuses", "opsChat.getPendingSuperAlerts", "opsChat.listActiveThreads", "opsChat.listEmailInboxThreads", "voice.listCalls", "commandCenter.listInboundTeamSmsEvents"]);
    expect(Object.values(c.getSnapshot().enabled)).toEqual(Array(7).fill(true));
    expect(c.getSnapshot().totals).toEqual({ attempts: 0, inFlight: 0, errors: 0 });
  });
  it.each([null, undefined, 0, -1, 1.5, NaN, Infinity, "unknown", "70001-private", "01"])('rejects unverified identity %s without reading saved overrides', agentId => {
    const m = memory(); const c = controller({ agentId, storage: m.store });
    c.testOnly(endpoints[0]); expect(c.eligible).toBe(false); expect(c.isEnabled(endpoints[0])).toBe(true);
    expect(m.store.getItem).not.toHaveBeenCalled(); expect(m.store.setItem).not.toHaveBeenCalled();
  });
  it("ineligible users ignore saved overrides and setters", () => {
    const m = memory(); m.values.set(savedKey(), JSON.stringify(pausedMask(endpoints[0])));
    const c = controller({ eligible: false, storage: m.store });
    c.testOnly(endpoints[0]); c.startBaseline(); c.saveBaseline(); c.resetAll();
    expect(c.eligible).toBe(false); expect(Object.values(c.getSnapshot().enabled).every(Boolean)).toBe(true);
    expect(m.store.getItem).not.toHaveBeenCalled(); expect(m.store.setItem).not.toHaveBeenCalled();
  });
  it.each(endpoints)("%s changes only its own switch, immediately and live", endpoint => {
    const c = controller(); const listener = vi.fn(); c.subscribe(listener);
    c.setEnabled(endpoint, false);
    expect(c.isEnabled(endpoint)).toBe(false); expect(c.getSnapshot().enabled).toEqual(pausedMask(endpoint));
    expect(listener).toHaveBeenCalledTimes(1); expect(c.allowsQueryKey([endpoint.split("."), { input: { fake: "PRIVATE_QUERY_KEY" } }])).toBe(false);
    c.setEnabled(endpoint, false); expect(listener).toHaveBeenCalledTimes(1);
  });
  it.each(["not-json", "null", "[]", "{}", JSON.stringify({ ...pausedMask(endpoints[0]), privatePayload: "FAKE_PRIVATE_INPUT" }), JSON.stringify({ ...pausedMask(endpoints[0]), [endpoints[1]]: 0 }), JSON.stringify({ [endpoints[0]]: false })])("malformed/private storage %s fails open", raw => {
    const m = memory(); m.values.set(savedKey(), raw); const c = controller({ storage: m.store });
    expect(Object.values(c.getSnapshot().enabled).every(Boolean)).toBe(true); expect(m.store.setItem).not.toHaveBeenCalled();
  });
  it("persists exactly seven booleans; same admin reload restores before request admission", () => {
    const m = memory(); const first = controller({ storage: m.store }); first.testOnly(endpoints[4]);
    const raw = m.values.get(savedKey())!; expect(JSON.parse(raw)).toEqual(pausedMask(endpoints[4]));
    const second = controller({ storage: m.store }); expect(second.isEnabled(endpoints[4])).toBe(false);
    expect(transport(second, endpoints[4]).next).not.toHaveBeenCalled();
    expect(m.values.size).toBe(1); expect(raw).not.toMatch(/FAKE_PRIVATE|input|error|agent|token|cookie/i);
  });
  it("origin, admin and version isolate masks", () => {
    const m = memory(); controller({ storage: m.store }).testOnly(endpoints[0]);
    for (const options of [{ agentId: 70002 }, { origin: "https://other.invalid" }]) expect(Object.values(controller({ storage: m.store, ...options }).getSnapshot().enabled).every(Boolean)).toBe(true);
    m.values.set(savedKey().replace(":v1:", ":v2:"), JSON.stringify(pausedMask(endpoints[1])));
    expect(controller({ storage: m.store }).isEnabled(endpoints[1])).toBe(true);
  });
  it("storage failures and unsafe origin never write or throw", () => {
    const throwing = { getItem() { throw new Error("FAKE_PRIVATE_STORAGE"); }, setItem() { throw new Error("FAKE_PRIVATE_STORAGE"); } };
    const c = controller({ storage: throwing, baselineStorage: throwing }); expect(() => c.testOnly(endpoints[0])).not.toThrow();
    expect(() => { c.startBaseline(); c.saveBaseline(); }).not.toThrow();
    const m = memory(); controller({ storage: m.store, origin: "https://user:FAKE@offline.invalid/path?private=FAKE" }).testOnly(endpoints[0]);
    expect(m.store.getItem).not.toHaveBeenCalled(); expect(m.store.setItem).not.toHaveBeenCalled();
  });
  it("reset and one-off actions only change masks, never generate requests or clear metrics", () => {
    vi.useFakeTimers(); const c = controller(); const h = transport(c); h.sink.complete(); flushMetrics();
    c.testOnly(endpoints[4]); c.setEnabled(endpoints[1], false); c.resetAll();
    expect(Object.values(c.getSnapshot().enabled).every(Boolean)).toBe(true); expect(h.next).toHaveBeenCalledTimes(1);
    expect(c.getSnapshot().totals.attempts).toBe(1); expect(c.getSnapshot().measurement.kind).toBe("custom");
  });
  it("unknown/unrelated/malformed query keys are untouched; only first path inspected", () => {
    const c = controller(); c.testOnly(endpoints[0]);
    expect(c.allowsQueryKey([["commandCenter", "listCommandChatInbox"], {}])).toBe(false);
    expect(c.allowsQueryKey([endpoints[0]])).toBe(false);
    for (const key of [undefined, {}, [], [["opsChat", "listIssues"], { input: endpoints[0] }], [["commandCenter"], { input: endpoints[0] }], [["commandCenter", 1]], [null]]) expect(c.allowsQueryKey(key)).toBe(true);
  });
  it("deactivation is reversible; dispose permanently retires old mask and setters", () => {
    const m = memory(), c = controller({ storage: m.store }); c.testOnly(endpoints[0]); c.deactivate();
    expect(c.eligible).toBe(false); expect(c.isEnabled(endpoints[0])).toBe(true); c.setEnabled(endpoints[1], false);
    c.activate(); expect(c.isEnabled(endpoints[0])).toBe(false); expect(c.isEnabled(endpoints[1])).toBe(true);
    c.dispose(); c.activate(); c.testOnly(endpoints[1]); expect(c.eligible).toBe(false); expect(c.isEnabled(endpoints[0])).toBe(true);
    expect(m.store.setItem).toHaveBeenCalledTimes(1);
  });
});

describe("typed scoped tRPC transport admission and no-abort finishing", () => {
  beforeEach(() => vi.useFakeTimers());
  it.each(endpoints)("disabled marked %s rejects sentinel without downstream or invented success", endpoint => {
    const c = controller(); c.setEnabled(endpoint, false); const h = transport(c, endpoint); flushMetrics();
    expect(h.next).not.toHaveBeenCalled(); expect(h.received.next).not.toHaveBeenCalled(); expect(h.received.complete).not.toHaveBeenCalled();
    const error = h.received.error.mock.calls[0][0]; expect(error).toBeInstanceOf(TRPCClientError); expect(error.message).toBe(COMMAND_CHAT_API_DEBUG_SUPPRESSED);
    expect(isCommandChatApiDebugSuppressed(error)).toBe(true); expect(c.retry(endpoint, 0, error)).toBe(false);
    expect(c.getSnapshot().totals).toEqual({ attempts: 0, inFlight: 0, errors: 0 }); expect(c.getSnapshot().endpoints[endpoint].suppressed).toBe(1);
  });
  it.each(["mutation", "subscription", "untagged", "unknown", "ineligible", "retired"] as const)("%s passes through exact op/observable and original unsubscribe", kind => {
    const c = controller(); c.testOnly(endpoints[0]); if (kind === "ineligible") c.deactivate(); if (kind === "retired") c.dispose();
    const h = transport(c, kind === "unknown" ? "opsChat.getSuperAlertMessageIds" : endpoints[0], kind === "mutation" || kind === "subscription" ? kind : "query", kind !== "untagged");
    expect(h.linked).toBe(h.downstream); expect(h.next).toHaveBeenCalledWith(h.op); h.subscription.unsubscribe(); expect(h.cleanup).toHaveBeenCalledTimes(1);
    flushMetrics(); expect(c.getSnapshot().totals.attempts).toBe(0);
  });
  it("toggle OFF leaves admitted work alive; next attempt is blocked", () => {
    const c = controller(), h = transport(c); flushMetrics(); expect(c.getSnapshot().totals.inFlight).toBe(1);
    c.setEnabled(endpoints[0], false); expect(h.cleanup).not.toHaveBeenCalled(); expect(c.getSnapshot().endpoints[endpoints[0]].inFlight).toBe(1);
    expect(transport(c).next).not.toHaveBeenCalled(); h.sink.next({ result: { data: "FAKE_PRIVATE_OUTPUT" } }); h.sink.complete(); flushMetrics();
    expect(h.received.next).toHaveBeenCalledTimes(1); expect(c.getSnapshot().totals).toEqual({ attempts: 1, inFlight: 0, errors: 0 }); expect(c.getSnapshot().enabled[endpoints[0]]).toBe(false);
    expect(c.getSnapshot().endpoints[endpoints[0]].lastStatus).toBe("success");
  });
  it("consumer unsubscribe detaches only, finishes metrics exactly once and does not cancel backend", () => {
    const c = controller(), h = transport(c); h.subscription.unsubscribe(); h.subscription.unsubscribe(); flushMetrics();
    expect(h.cleanup).not.toHaveBeenCalled(); expect(c.getSnapshot().totals).toEqual({ attempts: 1, inFlight: 1, errors: 0 });
    h.sink.next({ result: { data: "FAKE_PRIVATE_OUTPUT" } }); h.sink.complete(); flushMetrics();
    expect(h.received.next).not.toHaveBeenCalled(); expect(h.received.complete).not.toHaveBeenCalled(); expect(h.cleanup).toHaveBeenCalledTimes(1);
    expect(c.getSnapshot().totals).toEqual({ attempts: 1, inFlight: 0, errors: 0 }); expect(c.getSnapshot().endpoints[endpoints[0]].lastStatus).toBe("success");
  });
  it("error then complete/unsubscribe increments failure once and retains only safe code/status", () => {
    const c = controller(), h = transport(c);
    const error = TRPCClientError.from<AppRouter>({ error: { code: -32603, message: "FAKE_PRIVATE_SERVER_SQL", data: { code: "INTERNAL_SERVER_ERROR", httpStatus: 500, input: "FAKE_PRIVATE_INPUT" } } });
    h.sink.error(error); h.sink.complete(); h.subscription.unsubscribe(); flushMetrics();
    expect(c.getSnapshot().totals).toEqual({ attempts: 1, inFlight: 0, errors: 1 });
    expect(c.getSnapshot().endpoints[endpoints[0]]).toMatchObject({ lastErrorCode: "INTERNAL_SERVER_ERROR", lastHttpStatus: 500, lastStatus: "error" });
    expect(JSON.stringify(c.getSnapshot())).not.toContain("FAKE_PRIVATE"); expect(h.received.error).toHaveBeenCalledWith(error);
  });
  it("invalid error codes/status and raw errors cannot leak", () => {
    const c = controller(), h = transport(c);
    h.sink.error(TRPCClientError.from<AppRouter>({ error: { code: -32603, message: "FAKE_PRIVATE_MESSAGE", data: { code: "FAKE_PRIVATE_CODE", httpStatus: 999, request: "FAKE_PRIVATE_INPUT" } } })); flushMetrics();
    expect(c.getSnapshot().endpoints[endpoints[0]]).toMatchObject({ lastErrorCode: null, lastHttpStatus: null, errors: 1 }); expect(JSON.stringify(c.getSnapshot())).not.toMatch(/FAKE_PRIVATE/);
  });
  it("source subscription throws settle as one error, not a stuck in-flight request", () => {
    const c = controller(); const link = createCommandChatApiDebugLink()({});
    link({ op: { id: 1, type: "query", path: endpoints[0], input: undefined, signal: undefined, context: c.context }, next: () => { throw new Error("FAKE_PRIVATE_SYNC"); } }).subscribe({ error: () => {} }); flushMetrics();
    expect(c.getSnapshot().totals).toEqual({ attempts: 1, inFlight: 0, errors: 1 }); expect(JSON.stringify(c.getSnapshot())).not.toContain("FAKE_PRIVATE");
  });
  it("admission rechecks live switch when observable is subscribed later", () => {
    const c = controller(); const next = vi.fn(() => observable(() => {}));
    const read = createCommandChatApiDebugLink()({})({ op: { id: 1, type: "query", path: endpoints[0], input: undefined, signal: undefined, context: c.context }, next });
    c.setEnabled(endpoints[0], false); const error = vi.fn(); read.subscribe({ error }); expect(next).not.toHaveBeenCalled(); expect(isCommandChatApiDebugSuppressed(error.mock.calls[0][0])).toBe(true);
  });
  it("each chunk/retry/operation is counted, not batches; durations include coupled client waiting", () => {
    let time = 100; const c = controller({ now: () => time }); const one = transport(c, endpoints[0]), two = transport(c, endpoints[1]);
    time = 600; one.sink.complete(); two.sink.complete(); flushMetrics();
    const retry = transport(c, endpoints[1]); time = 700; retry.sink.complete(); flushMetrics();
    expect(c.getSnapshot().totals.attempts).toBe(3); expect(c.getSnapshot().endpoints[endpoints[1]].attempts).toBe(2);
    expect(c.getSnapshot().endpoints[endpoints[0]].lastDurationMs).toBe(500); expect(c.getSnapshot().endpoints[endpoints[1]].lastDurationMs).toBe(100);
  });
  it("stable snapshots throttle only real activity, no timer polls or render counting", () => {
    const c = controller(), first = c.getSnapshot(), listener = vi.fn(); c.subscribe(listener);
    expect(c.getSnapshot()).toBe(first); expect(vi.getTimerCount()).toBe(0);
    const h = transport(c); expect(c.getSnapshot()).toBe(first); expect(vi.getTimerCount()).toBe(1);
    h.sink.complete(); flushMetrics(); expect(listener).toHaveBeenCalledTimes(1); const second = c.getSnapshot(); expect(second).not.toBe(first); expect(c.getSnapshot()).toBe(second);
    vi.advanceTimersByTime(5000); expect(listener).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
  });
  it("baseline preserves outstanding operation accounting and saves only sanitized summary", () => {
    let now = 50; const m = memory(), c = controller({ baselineStorage: m.store, now: () => now }); const h = transport(c);
    c.startBaseline(); expect(c.getSnapshot().measurement.mixedInFlight).toBe(true); now = 150; h.sink.complete(); const after = transport(c, endpoints[1]); after.sink.complete(); c.saveBaseline();
    expect(c.getSnapshot().totals).toEqual({ attempts: 2, inFlight: 0, errors: 0 }); expect(c.getSnapshot().baseline).toMatchObject({ durationMs: 100, mixedInFlight: true, totals: { attempts: 1, inFlight: 0, errors: 0 } });
    const raw = m.values.get(savedKey() + ":baseline")!; expect(raw).not.toMatch(/FAKE_PRIVATE|input|output|message|cookie|token/i); expect(controller({ baselineStorage: m.store }).getSnapshot().baseline).toEqual(c.getSnapshot().baseline);
  });
  it("private garbage baseline is rejected and cannot enter snapshots", () => {
    const m = memory(); m.values.set(savedKey() + ":baseline", JSON.stringify({ totals: { attempts: 1, inFlight: 0, errors: 0 }, endpoints: {}, durationMs: 5, private: "FAKE_PRIVATE_DATA" }));
    expect(controller({ baselineStorage: m.store }).getSnapshot().baseline).toBeNull();
  });
  it("suppression detection handles wrapped/cyclic causes without swallowing ordinary failures", () => {
    expect(isCommandChatApiDebugSuppressed(TRPCClientError.from(new Error(COMMAND_CHAT_API_DEBUG_SUPPRESSED)))).toBe(true);
    expect(isCommandChatApiDebugSuppressed({ message: "outer", cause: { message: COMMAND_CHAT_API_DEBUG_SUPPRESSED } })).toBe(true);
    const cyclic: any = {}; cyclic.cause = cyclic; expect(isCommandChatApiDebugSuppressed(cyclic)).toBe(false);
    expect(isCommandChatApiDebugSuppressed(new Error("server failed"))).toBe(false);
    expect(isCommandChatApiDebugSuppressed(new Error("prefix " + COMMAND_CHAT_API_DEBUG_SUPPRESSED))).toBe(false);
  });
  it("global-compatible retry preserves transient limit/auth/rate baseline and checks live OFF", () => {
    const c = controller(); expect(c.retry(endpoints[0], 0, new Error("transient"))).toBe(true); expect(c.retry(endpoints[0], 1, new Error("transient"))).toBe(false);
    for (const status of [429, 401, 403]) expect(c.retry(endpoints[0], 0, TRPCClientError.from({ error: { code: -1, message: "safe", data: { httpStatus: status } } }))).toBe(false);
    expect(c.retry(endpoints[0], 0, TRPCClientError.from(new Error("Rate exceeded.")))).toBe(false);
    c.setEnabled(endpoints[0], false); expect(c.retry(endpoints[0], 0, new Error("transient"))).toBe(false);
  });
});

describe("actual serial status loader live chunk and retry gates", () => {
  it("OFF between chunks finishes held transport but does not issue a second chunk or publish partial cohort", async () => {
    const c = controller(), client = new QueryClient(), held = deferred<{ id: number }[]>(); clients.push(client); const request = vi.fn((_input: { sessionIds: number[] }) => held.promise);
    const options = statusQueryOptions({ queryClient: client, baseKey: [["opsChat", "getLeadSessionStatuses"]], scope: { identity: 70001, epoch: 1 }, sessionIds: range(65), enabled: true, request, apiDebugController: c });
    const work = options.queryFn({ signal: new AbortController().signal }).catch(error => error); await Promise.resolve(); expect(request).toHaveBeenCalledTimes(1);
    c.setEnabled(endpoints[1], false); held.resolve(range(50).map(id => ({ id }))); expect(await work).toBeInstanceOf(CancelledError); expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0][0]).toEqual({ sessionIds: range(50) });
  });
  it.each([false, true])("real QueryClient settles interrupted status fetch without partial publication (warm=%s)", async warm => {
    const c = controller(), client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
    clients.push(client);
    const held = deferred<{ id: number }[]>();
    const request = vi.fn((_input: { sessionIds: number[] }) => held.promise);
    const options = statusQueryOptions({ queryClient: client, baseKey: [["opsChat", "getLeadSessionStatuses"]], scope: { identity: 70001, epoch: 112 }, sessionIds: range(65), enabled: true, request, apiDebugController: c });
    const cached = range(65).map(id => ({ id }));
    if (warm) client.setQueryData(options.queryKey, cached);
    const work = client.fetchQuery(options).catch(error => error);
    await Promise.resolve();
    expect(request).toHaveBeenCalledTimes(1);
    expect(client.getQueryState(options.queryKey)?.fetchStatus).toBe("fetching");
    c.setEnabled(endpoints[1], false);
    expect(client.getQueryState(options.queryKey)?.fetchStatus).toBe("fetching");
    held.resolve(range(50).map(id => ({ id })));
    expect(await work).toBeInstanceOf(CancelledError);
    const state = client.getQueryState(options.queryKey);
    expect(state?.fetchStatus).toBe("idle");
    expect(state?.status).toBe(warm ? "success" : "pending");
    expect(state?.error).toBeNull();
    expect(state?.fetchFailureCount).toBe(0);
    expect(state?.data).toEqual(warm ? cached : undefined);
    expect(request).toHaveBeenCalledTimes(1);
  });
  it("OFF before queued work enters serial gate prevents its first chunk", async () => {
    const c = controller(), client = new QueryClient(); clients.push(client); const request = vi.fn(async () => [] as { id: number }[]);
    const options = statusQueryOptions({ queryClient: client, baseKey: [], scope: { identity: 70001, epoch: 1 }, sessionIds: [1], enabled: true, request, apiDebugController: c });
    const work = options.queryFn({ signal: new AbortController().signal }).catch(error => error); c.setEnabled(endpoints[1], false);
    expect(await work).toBeInstanceOf(CancelledError); expect(request).not.toHaveBeenCalled();
  });
  it("normal status retry policies are unchanged; live OFF/sentinel/BAD_REQUEST prohibit future retry", () => {
    const c = controller(), retry = scopedStatusRetry(2, c); expect(retry(1, new Error("transient"))).toBe(true); expect(retry(2, new Error("transient"))).toBe(false);
    expect(retry(0, TRPCClientError.from(new Error(COMMAND_CHAT_API_DEBUG_SUPPRESSED)))).toBe(false);
    expect(retry(0, TRPCClientError.from({ error: { code: -32600, message: "safe", data: { code: "BAD_REQUEST" } } }))).toBe(false);
    c.setEnabled(endpoints[1], false); expect(retry(0, new Error("transient"))).toBe(false);
  });
});

describe("mounted owner/provider StrictMode external store lifecycle", () => {
  it("StrictMode setup-cleanup-setup keeps same live controller and persisted cold mask", async () => {
    fixture.storage.set(savedKey(), JSON.stringify(pausedMask(endpoints[0]))); const seen: CommandChatApiDebugController[] = []; let latest!: CommandChatApiDebugController; let renders = 0;
    function Child() { const { controller: c, snapshot } = useCommandChatApiDebug(); latest = c; renders++; return createElement("span", null, String(snapshot.enabled[endpoints[0]])); }
    function Owner() { const { controller: c } = useCommandChatApiDebugScope({ eligible: true, agentId: 70001 }); seen.push(c); return createElement(CommandChatApiDebugProvider, { controller: c, children: createElement(Child) }); }
    let root: any; await act(async () => { root = renderer.create(createElement(StrictMode, null, createElement(Owner))); }); roots.push(root);
    expect(latest.eligible).toBe(true); expect(latest.isEnabled(endpoints[0])).toBe(false);
    await act(async () => { latest.resetAll(); }); expect(root.toJSON().children).toEqual(["true"]); expect(renders).toBeLessThan(15);
    await act(async () => { latest.testOnly(endpoints[1]); }); expect(latest.isEnabled(endpoints[1])).toBe(false); expect(renders).toBeLessThan(20);
    const old = latest; await act(async () => root.unmount()); roots.splice(roots.indexOf(root), 1); expect(old.eligible).toBe(false); old.testOnly(endpoints[0]); expect(old.isEnabled(endpoints[0])).toBe(true);
  });
  it("auth replacement makes old setters harmless and new admin starts with own mask", async () => {
    let latest!: CommandChatApiDebugController;
    function Owner({ id }: { id: number }) { const { controller: c } = useCommandChatApiDebugScope({ eligible: true, agentId: id }); latest = c; return createElement("span", null, String(c.eligible)); }
    let root: any; await act(async () => { root = renderer.create(createElement(Owner, { id: 70001 })); }); roots.push(root); const old = latest;
    await act(async () => old.testOnly(endpoints[0])); await act(async () => root.update(createElement(Owner, { id: 70002 })));
    expect(latest).not.toBe(old); expect(latest.eligible).toBe(true); expect(latest.isEnabled(endpoints[0])).toBe(true); expect(old.eligible).toBe(false);
    old.testOnly(endpoints[1]); expect(latest.isEnabled(endpoints[1])).toBe(true); expect(transport(old).next).toHaveBeenCalledTimes(1);
  });
  it("outside provider remains pass-through and snapshot stable without requests", async () => {
    let result!: ReturnType<typeof useCommandChatApiDebug>; function Child() { result = useCommandChatApiDebug(); return null; }
    let root: any; await act(async () => { root = renderer.create(createElement(Child)); }); roots.push(root);
    expect(result.controller.eligible).toBe(false); const first = result.snapshot; await act(async () => root.update(createElement(Child))); expect(result.snapshot).toBe(first); expect(first.totals.attempts).toBe(0);
  });
});

// Actual page/children/panel, real tRPC + TanStack observers, purely synthetic transport.
import { getQueryKey } from "@trpc/react-query";
import { trpc } from "@/lib/trpc";
import CommandChatExactLive from "@/pages/CommandChatExactLive";
import CommandChatApiDebugPanel from "@/components/CommandChatApiDebugPanel";
import AllThreadsPanel from "@/components/AllThreadsPanel";
import CommandChatEmailDetail from "@/pages/CommandChatEmailDetail";
const statusRow = (id: number, booked = id % 2 === 0) => ({ id, isBooked: booked, bookedAt: booked ? 123456 : null, bookedByAgentName: booked ? "Synthetic Status Agent" : null, bookedAmount: booked ? 320 : null, stage: "NEW", lostReason: null });
const smsRow = (id = 2, personType = "customer") => ({ id, leadName: `Synthetic Lead ${id}`, leadPhone: "+12025550100", leadSource: "quoteform", lastMessageText: `Synthetic inbox row ${id}`, lastMsgTs: 100000, lastMessageTs: 100000, lastSenderRole: "assistant", hasUnanswered: false, aiSummary: null, personType, lastInboundPhoneNumberId: null, receivedAt: 99000, calledAt: 99900, stage: "NEW", isBooked: false, bookedByAgentName: null, bookedAt: null });
const message = (id: number, sessionId: number) => ({ id, ts: 100000 + id, from: "Synthetic lead", role: "system", body: "New lead", mediaUrl: null, quickAction: "new_lead", metadata: JSON.stringify({ sessionId, leadName: `Synthetic Lead ${id}`, leadPhone: "+12025550100", source: "quoteform" }), replyToId: null, replyToBody: null, replyToAuthor: null, threadParentId: null, threadParentBody: null, threadParentFrom: null, replyCount: 0 });
const emailRow = { threadId: "synthetic-thread", senderName: "Synthetic Sender", senderEmail: "synthetic@example.invalid", subject: "Synthetic subject", snippet: "Synthetic snippet", lastMessageAt: 100000, messageCount: 1, isUnread: true };
const emailDetail = { from: "Synthetic Sender", fromEmail: "synthetic@example.invalid", inboxEmail: "inbox@example.invalid", subject: "Synthetic subject", messages: [{ id: "synthetic-message", from: "Synthetic Sender", fromEmail: "synthetic@example.invalid", bodyText: "Synthetic private message", date: 100000 }] };
const threadRow = { parentId: 10, parentBody: "Synthetic thread", parentFrom: "Synthetic Author", parentTs: 100000, replyCount: 1, lastReplyFrom: "Synthetic Reply", lastReplyBody: "Synthetic reply body", lastReplyTs: 100001, lastReplyMsgId: 11, hasUnread: true };
function pageHarness(args: { eligible?: boolean; isAdmin?: boolean; authenticated?: boolean; ids?: number[]; strict?: boolean; inboxHeld?: boolean; status?: (ids: number[], call: number) => unknown; warm?: boolean } = {}) {
  const ids = args.ids ?? [1, 2]; const inbox = deferred<any>();
  const records: { path: string; input: any; type: string; tagged: boolean }[] = [];
  const mutations: { path: string; input: any; pending: ReturnType<typeof deferred<any>> }[] = [];
  const statusInputs: number[][] = []; let statusActive = 0, statusPeak = 0;
  let agent: any = args.authenticated === false ? null : { id: 70001, name: "Synthetic Agent", awayStatus: null, isAdmin: args.isAdmin ?? true, isActive: true };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity, staleTime: 120000, refetchOnWindowFocus: false, refetchOnReconnect: false }, mutations: { retry: false } } }); clients.push(client);
  const cache = (procedure: any, input: any, value: any) => client.setQueryData(getQueryKey(procedure, input, "query"), value);
  // Stable unrelated data avoids baseline default-array effects unrelated to the new panel.
  cache(trpc.opsChat.listChannelMessages, { channel: "command" }, ids.map((id, index) => message(index + 1, id)));
  cache(trpc.thumbtackLead.listNative, undefined, []);
  cache(trpc.commandCenter.listInboundTeamSmsEvents, { sessionIds: [] }, []);
  cache(trpc.opsChat.listIssues, { status: "open", limit: 12 }, []);
  cache(trpc.opsChat.getSuperAlertMessageIds, { channel: "command" }, []);
  if (args.warm) {
    cache(trpc.commandCenter.listCommandChatInbox, undefined, [smsRow(2), smsRow(900, "team")]);
    cache(trpc.opsChat.listActiveThreads, undefined, [threadRow]);
    cache(trpc.opsChat.listEmailInboxThreads, undefined, { threads: [emailRow] });
    cache(trpc.voice.listCalls, { limit: 50, offset: 0 }, { calls: [] });
    cache(trpc.opsChat.getPendingSuperAlerts, undefined, []);
    cache(trpc.commandCenter.listInboundTeamSmsEvents, { sessionIds: [900] }, []);
  }
  const tail: TRPCLink<AppRouter> = () => ({ op }) => observable(sink => {
    records.push({ path: op.path, input: op.input, type: op.type, tagged: op.context.commandChatApiDebug instanceof Object });
    let result: unknown;
    if (op.type === "mutation") {
      const pending = deferred<any>(); mutations.push({ path: op.path, input: op.input, pending });
      result = op.path === "opsChat.getReactions" ? { reactions: [] } : pending.promise;
    } else switch (op.path) {
      case "agents.me": captureCommandChatApiDebugEligibility(new Response(null, { headers: { "X-Command-Chat-API-Debug": args.eligible === false || !agent ? "0" : "1" } }), "/api/trpc/agents.me"); result = agent; break;
      case "commandCenter.listCommandChatInbox": result = args.inboxHeld ? inbox.promise : [smsRow(2), smsRow(900, "team")]; break;
      case "opsChat.listChannelMessages": result = ids.map((id, index) => message(index + 1, id)); break;
      case "thumbtackLead.listNative": result = []; break;
      case "opsChat.getMyProfile": result = { name: agent?.name, photoUrl: null }; break;
      case "opsChat.getAllAgentPhotoMap": result = { photos: {} }; break;
      case "opsChat.getAgentStatusList": result = { agents: [] }; break;
      case "bookings.todayStats": result = { bookedCount: 0, bookedRevenue: 0, bookingDetails: [] }; break;
      case "opsChat.listEmailInboxThreads": result = { threads: [emailRow] }; break;
      case "opsChat.listActiveThreads": result = [threadRow]; break;
      case "voice.listCalls": result = { calls: [] }; break;
      case "opsChat.getChannelPin": result = null; break;
      case "opsChat.getChannelCounts": result = {}; break;
      case "opsChat.getTodayRevenue": result = { revenue: 0 }; break;
      case "leadflowJobs.customerProfile": result = null; break;
      case "leads.getCsConversation": result = { messageHistory: "[]" }; break;
      case "gmail.getThread": result = emailDetail; break;
      case "gmail.getBookingContext": result = { booking: null }; break;
      case "opsChat.getEmailDraftByThreadId": result = null; break;
      case "opsChat.getLeadSessionStatuses": {
        const sessionIds = (op.input as { sessionIds: number[] }).sessionIds.slice(); const call = statusInputs.length;
        statusInputs.push(sessionIds); statusActive++; statusPeak = Math.max(statusPeak, statusActive);
        result = Promise.resolve().then(() => args.status ? args.status(sessionIds, call) : sessionIds.map(id => statusRow(id))).finally(() => { statusActive--; }); break;
      }
      default: result = []; break;
    }
    Promise.resolve(result).then(data => { sink.next({ result: { data } }); sink.complete(); }, error => sink.error(TRPCClientError.from<AppRouter>(error as Error)));
    return () => {}; // Never network; no actual transport cancellation.
  });
  const rpc = createTRPCClient<AppRouter>({ links: [createCommandChatApiDebugLink(), tail] });
  let root: any;
  const tree = () => createElement(args.strict ? StrictMode : React.Fragment, null, createElement(QueryClientProvider, { client }, createElement(trpc.Provider, { client: rpc, queryClient: client, children: createElement(CommandChatExactLive) })));
  const find = (predicate: (node: any) => boolean) => root.root.findAll((node: any) => typeof node.type === "string" && predicate(node));
  const count = (path: string) => records.filter(record => record.type === "query" && record.path === path).length;
  const panelController = () => root.root.findByType(CommandChatApiDebugPanel).props.controller as CommandChatApiDebugController;
  return { client, inbox, records, mutations, statusInputs, find, count, panelController,
    get root() { return root; }, get sse() { return fixture.streams[fixture.streams.length - 1]?.callbacks; }, get statusPeak() { return statusPeak; }, get statusActive() { return statusActive; },
    async start() { await act(async () => { root = renderer.create(tree()); }); roots.push(root); },
    async stop() { await act(async () => root.unmount()); roots.splice(roots.indexOf(root), 1); },
    async remount() { await act(async () => { root = renderer.create(tree()); }); roots.push(root); },
    async auth(id: number | null, eligible = true, isAdmin = true) { agent = id === null ? null : { id, name: "Fresh Synthetic Agent", isAdmin, isActive: true }; await act(async () => { captureCommandChatApiDebugEligibility(new Response(null, { headers: { "X-Command-Chat-API-Debug": eligible && agent ? "1" : "0" } }), "/api/trpc/agents.me"); cache(trpc.agents.me, undefined, agent); }); },
  };
}
async function tick(ms = 10) { await act(async () => { await new Promise(resolve => setTimeout(resolve, ms)); }); }
async function settle(condition: () => boolean) {
  for (let index = 0; index < 400 && !condition(); index++) await tick(2);
  expect(condition()).toBe(true);
}
const nodeText = (node: any): string => node.children.map((child: any) => typeof child === "string" ? child : nodeText(child)).join("");
async function click(node: any) { expect(node).toBeDefined(); await act(async () => { node.props.onClick({ stopPropagation() {}, preventDefault() {} }); }); }
async function allSSE(callbacks: any) { await act(async () => { Object.keys(callbacks).forEach(key => { if (typeof callbacks[key] === "function") callbacks[key](); }); }); await tick(550); }

describe("actual exact page plus real child owners and panel with synthetic transport", () => {
  it("unauthenticated page issues only existing agents.me and shows no diagnostic panel", async () => {
    const h = pageHarness({ authenticated: false }); await h.start(); await settle(() => h.find(n => n.type === "input" && n.props.type === "email").length === 1);
    expect(h.records.map(record => record.path)).toEqual(["agents.me"]); expect(h.find(n => n.type === "h2" && nodeText(n).includes("API Debug"))).toHaveLength(0);
  });
  it.each([{ eligible: false, isAdmin: true }, { eligible: true, isAdmin: false }])("capability/admin fail-open %j ignores saved mask and enables normal email/default seven", async flags => {
    fixture.storage.set(savedKey(), JSON.stringify(Object.fromEntries(endpoints.map(endpoint => [endpoint, false]))));
    const h = pageHarness(flags); await h.start(); await settle(() => h.statusInputs.length > 0 && h.count(endpoints[6]) > 0);
    endpoints.forEach(endpoint => expect(h.count(endpoint)).toBeGreaterThan(0)); expect(h.panelController().eligible).toBe(false);
    expect(h.find(n => n.type === "h2" && nodeText(n).includes("API Debug"))).toHaveLength(0); expect(h.count("agents.me")).toBe(1);
  });
  it("eligible normal all-enabled cold page observes every seven API, no extra config/auth query", async () => {
    const h = pageHarness(); await h.start(); await settle(() => h.statusInputs.length > 0 && h.count(endpoints[6]) > 0);
    endpoints.forEach(endpoint => { expect(h.count(endpoint)).toBeGreaterThan(0); expect(h.records.filter(record => record.path === endpoint).every(record => record.tagged)).toBe(true); });
    expect(h.count("agents.me")).toBe(1); expect(h.records.filter(record => /config|eligibility/i.test(record.path))).toEqual([]);
    expect(h.find(n => n.props["aria-label"] === "MIB Command workspace")).toHaveLength(1); expect(h.panelController().eligible).toBe(true);
  });
  it.each(endpoints)("cold persisted %s OFF blocks mount, child open, SSE/reconnect and same-browser remount", async endpoint => {
    fixture.storage.set(savedKey(), JSON.stringify(pausedMask(endpoint))); const h = pageHarness({ strict: true }); await h.start();
    await settle(() => h.find(n => n.props["aria-label"] === "MIB Command workspace").length === 1); await tick(30);
    expect(h.panelController().isEnabled(endpoint)).toBe(false); expect(h.count(endpoint)).toBe(0);
    if (endpoint === endpoints[3]) await click(h.find(n => n.props["aria-label"] === "Open all unread command threads")[0]);
    await allSSE(h.sse); expect(h.count(endpoint)).toBe(0);
    // Independent statuses run on canonical IDs when intentionally-paused cold inbox has no IDs.
    if (endpoint === endpoints[0]) { expect(h.statusInputs.length).toBeGreaterThan(0); expect(h.count(endpoints[6])).toBe(0); expect(h.find(n => nodeText(n).includes("Waiting for inbox team IDs")).length).toBeGreaterThan(0); }
    if (endpoint === endpoints[1]) expect(h.panelController().getSnapshot().enabled[endpoints[1]]).toBe(false);
    const oldSSE = h.sse; await h.stop(); const stopped = h.records.filter(record => record.type === "query").length; await allSSE(oldSSE); expect(h.records.filter(record => record.type === "query")).toHaveLength(stopped);
    await h.remount(); await tick(30); await allSSE(h.sse); expect(h.count(endpoint)).toBe(0);
  });
  it("warm inbox OFF retains team IDs and independently enabled status/team reads", async () => {
    fixture.storage.set(savedKey(), JSON.stringify(pausedMask(endpoints[0]))); const h = pageHarness({ warm: true }); await h.start(); await settle(() => h.statusInputs.length > 0);
    expect(h.count(endpoints[0])).toBe(0); await allSSE(h.sse); expect(h.count(endpoints[6])).toBeGreaterThan(0); expect(h.count(endpoints[1])).toBeGreaterThan(0);
    expect(h.find(n => n.props["aria-label"] === "Text message conversations").map(nodeText).join("")).toContain("Synthetic inbox row 2");
  });
  it("actual status sweep OFF after admitted chunk prevents later chunks without freezing workspace", async () => {
    const held = deferred<any>(), h = pageHarness({ ids: range(65), status: (ids, call) => call === 0 ? held.promise : ids.map(id => statusRow(id)) }); await h.start(); await settle(() => h.statusInputs.length === 1);
    await act(async () => h.panelController().setEnabled(endpoints[1], false)); held.resolve(range(50).map(id => statusRow(id))); await tick(40);
    expect(h.statusInputs).toHaveLength(1); expect(h.statusPeak).toBe(1); expect(h.find(n => n.props["aria-label"] === "MIB Command workspace")).toHaveLength(1);
    expect(h.client.getQueryCache().findAll().filter(query => (query.queryKey as any[]).at(-1)?.commandChatLeadStatuses && query.state.data !== undefined)).toHaveLength(0);
  });
  it("in-flight inbox completes while OFF and late result does not re-enable it", async () => {
    const h = pageHarness({ inboxHeld: true }); await h.start(); await settle(() => h.count(endpoints[0]) === 1);
    await act(async () => h.panelController().setEnabled(endpoints[0], false)); expect(h.panelController().getSnapshot().endpoints[endpoints[0]].inFlight).toBe(1);
    h.inbox.resolve([smsRow(2), smsRow(900, "team")]); await settle(() => h.find(n => n.props["aria-label"] === "Text message conversations").map(nodeText).join("").includes("Synthetic inbox row 2"));
    await allSSE(h.sse); expect(h.count(endpoints[0])).toBe(1); expect(h.panelController().isEnabled(endpoints[0])).toBe(false); expect(h.panelController().getSnapshot().endpoints[endpoints[0]].inFlight).toBe(0);
  });
  it("SMS send remains unchanged while inbox OFF; late mutation refresh only suppresses that read", async () => {
    fixture.storage.set(savedKey(), JSON.stringify(pausedMask(endpoints[0]))); const h = pageHarness({ warm: true }); await h.start(); await tick(25);
    const row = h.find(n => n.type === "button" && (n.props.className ?? "").split(" ").includes("ccc-live-sms-row"))[0]; await click(row);
    await settle(() => h.find(n => n.type === "textarea" && n.props.placeholder === "Write a text reply…").length === 1);
    const composer = h.find(n => n.type === "textarea" && n.props.placeholder === "Write a text reply…")[0]; await act(async () => composer.props.onChange({ target: { value: "Synthetic offline reply" } }));
    await click(h.find(n => n.props["aria-label"] === "Send text reply")[0]); const send = h.mutations.find(record => record.path === "leads.sendMessage")!;
    expect(send.input).toMatchObject({ sessionId: 2, message: "Synthetic offline reply", source: "cs_inbox" }); await click(h.find(n => n.props["aria-label"] === "Close text conversation")[0]); send.pending.resolve({ success: true, duplicate: false }); await tick(550);
    expect(h.count(endpoints[0])).toBe(0); expect(h.count("leads.getCsConversation")).toBeGreaterThan(0);
  });
  it("booking/unbooking optimism still settles with status OFF and no hydration read", async () => {
    const h = pageHarness({ ids: [2] }); await h.start(); await settle(() => h.find(n => (n.props.className ?? "").split(" ").includes("ccc-live-lead-primary") && nodeText(n).includes("Booked")).length === 1);
    await act(async () => h.panelController().setEnabled(endpoints[1], false)); const count = h.count(endpoints[1]);
    const card = h.find(n => (n.props.className ?? "").split(" ").includes("ccc-live-lead-primary"))[0]; await click(card.findAll((n: any) => n.type === "button" && n.props.className === "is-booked")[0]);
    const unbook = h.mutations.find(record => record.path === "opsChat.unbookLead")!; expect(unbook.input).toEqual({ sessionId: 2 }); unbook.pending.resolve({ success: true }); await tick(550);
    expect(h.count(endpoints[1])).toBe(count); expect(h.find(n => n.props.role === "status").map(nodeText).join("")).toContain("was unbooked");
  });
  it("actual warm AllThreads child mark-read mutation works with active-list OFF without a list refresh", async () => {
    fixture.storage.set(savedKey(), JSON.stringify(pausedMask(endpoints[3]))); const h = pageHarness({ warm: true }); await h.start(); await tick(25);
    await click(h.find(n => n.props["aria-label"] === "Open all unread command threads")[0]);
    await click(h.find(n => n.type === "button" && nodeText(n).includes("Mark all read"))[0]); const mark = h.mutations.find(record => record.path === "opsChat.markAllActiveThreadsRead")!;
    expect(mark).toBeDefined(); mark.pending.resolve({ success: true }); await tick(30); expect(h.count(endpoints[3])).toBe(0);
    expect(h.root.root.findAllByType(AllThreadsPanel)).toHaveLength(1);
  });
  it("actual nested email child retains thread/draft/booking/reply while list OFF", async () => {
    fixture.storage.set(savedKey(), JSON.stringify(pausedMask(endpoints[4]))); const h = pageHarness({ warm: true }); await h.start(); await tick(25);
    await click(h.find(n => n.type === "button" && nodeText(n) === "Email")[0]); await click(h.find(n => n.type === "button" && (n.props.className ?? "").includes("ccc-live-email-row"))[0]);
    await settle(() => h.root.root.findAllByType(CommandChatEmailDetail).length === 1 && h.count("gmail.getThread") > 0);
    expect(h.count(endpoints[4])).toBe(0); expect(h.count("opsChat.getEmailDraftByThreadId")).toBeGreaterThan(0); expect(h.count("gmail.getBookingContext")).toBeGreaterThan(0);
    const composer = h.find(n => n.type === "textarea" && (n.props.placeholder ?? "").startsWith("Reply to"))[0]; await act(async () => composer.props.onChange({ target: { value: "Synthetic email reply" } }));
    await click(h.find(n => n.type === "button" && nodeText(n).includes("Send Reply"))[0]); const send = h.mutations.find(record => record.path === "gmail.sendReply")!;
    expect(send.input).toMatchObject({ threadId: "synthetic-thread" }); send.pending.resolve({ success: true }); await tick(550); expect(h.count(endpoints[4])).toBe(0);
  });
  it("auth change immediately retires old controller and callbacks; new admin overrides isolated", async () => {
    const h = pageHarness({ strict: true }); await h.start(); await settle(() => h.statusInputs.length > 0); const old = h.panelController(), sse = h.sse;
    await act(async () => old.testOnly(endpoints[0])); await h.auth(70002); await tick(30); expect(old.eligible).toBe(false); expect(h.panelController()).not.toBe(old); expect(h.panelController().isEnabled(endpoints[0])).toBe(true);
    old.testOnly(endpoints[1]); const before = h.records.filter(record => record.type === "query").length; await allSSE(sse); expect(h.records.filter(record => record.type === "query")).toHaveLength(before); expect(h.panelController().isEnabled(endpoints[1])).toBe(true);
  });
});

describe("actual panel rendering and gate-only subscriber negative controls", () => {
  it("full metrics updates rerender panel but not owner/child or enabled-object dependencies", async () => {
    const c = controller(); let childRenders = 0, ownerRenders = 0;
    function Child() { useCommandChatApiDebug(); childRenders++; return null; }
    function Owner() { ownerRenders++; return createElement(CommandChatApiDebugProvider, { controller: c, children: createElement(React.Fragment, null, createElement(Child), createElement(CommandChatApiDebugPanel, { controller: c })) }); }
    let root: any; await act(async () => { root = renderer.create(createElement(Owner)); }); roots.push(root);
    const gate = c.getControlSnapshot(), enabled = c.getSnapshot().enabled; const h = transport(c); h.sink.complete(); await tick(120);
    expect(c.getSnapshot().totals.attempts).toBe(1); expect(c.getSnapshot().enabled).toBe(enabled); expect(c.getControlSnapshot()).toBe(gate); expect(childRenders).toBe(1); expect(ownerRenders).toBe(1);
    expect(nodeText(root.root.findByType("aside"))).toContain("1 admitted attempts");
    await act(async () => c.testOnly(endpoints[0])); expect(childRenders).toBe(2);
  });
  it("real panel toggles, baseline/save, independent one-off, collapse summary and no synthetic API calls", async () => {
    const c = controller(); let root: any; await act(async () => { root = renderer.create(createElement(CommandChatApiDebugPanel, { controller: c, waitingFor: { [endpoints[6]]: "inbox IDs" } })); }); roots.push(root);
    const find = (label: string) => root.root.findAll((n: any) => n.props["aria-label"] === label)[0];
    expect(nodeText(root.root.findByType("aside"))).toContain("0 of 7 APIs OFF"); expect(nodeText(root.root.findByType("aside"))).toContain("not HTTP requests");
    await click(find(`Test only this API OFF: ${endpoints[0]}; enable the other six reads`)); expect(c.getSnapshot().enabled).toEqual(pausedMask(endpoints[0]));
    expect(nodeText(find("Disabled APIs"))).toContain("Command Chat inbox"); expect(nodeText(root.root.findByType("aside"))).toContain("Waiting for inbox IDs");
    await click(find("Start baseline: enable all seven API reads and start a measurement")); await click(find("Record baseline: save the current all-enabled measurement summary")); expect(c.getSnapshot().baseline).not.toBeNull();
    const checkbox = find(`${endpoints[4]}: enable API reads`); await act(async () => checkbox.props.onChange({ currentTarget: { checked: false } })); expect(c.isEnabled(endpoints[4])).toBe(false);
    await click(find("Reset All: enable all seven API reads")); expect(Object.values(c.getSnapshot().enabled).every(Boolean)).toBe(true); expect(c.getSnapshot().totals.attempts).toBe(0);
  });
  it("panel hidden for ineligible without requests or unsafe metric text", async () => {
    const c = controller({ eligible: false }); let root: any; await act(async () => { root = renderer.create(createElement(CommandChatApiDebugPanel, { controller: c })); }); roots.push(root); expect(root.toJSON()).toBeNull(); expect(c.getSnapshot().totals.attempts).toBe(0);
  });
});

const authFixture = vi.hoisted(() => ({ authenticate: vi.fn(async () => null), signedAgent: vi.fn(async (): Promise<{ isAdmin: boolean } | null> => ({ isAdmin: true })) }));
vi.mock("./_core/sdk", () => ({ sdk: { authenticateRequest: authFixture.authenticate } }));
vi.mock("./_core/agentAuth", () => ({ getAgentFromRequest: authFixture.signedAgent }));
import { createContext } from "./_core/context";
import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";

describe("existing request context capability header without database or startup", () => {
  const cases = [
    { label: "all Preview gates and signed admin", environment: "preview", preview: "true", flag: "true", admin: true, expected: "1" },
    { label: "Production", environment: "production", preview: "true", flag: "true", admin: true, expected: "0" },
    { label: "missing environment", environment: undefined, preview: "true", flag: "true", admin: true, expected: "0" },
    { label: "missing Preview flag", environment: "preview", preview: undefined, flag: "true", admin: true, expected: "0" },
    { label: "false Preview flag", environment: "preview", preview: "false", flag: "true", admin: true, expected: "0" },
    { label: "missing diagnostic flag", environment: "preview", preview: "true", flag: undefined, admin: true, expected: "0" },
    { label: "false diagnostic flag", environment: "preview", preview: "true", flag: "false", admin: true, expected: "0" },
    { label: "ordinary signed agent", environment: "preview", preview: "true", flag: "true", admin: false, expected: "0" },
    { label: "anonymous", environment: "preview", preview: "true", flag: "true", admin: null, expected: "0" },
  ];
  it.each(cases)("$label", async row => {
    vi.stubEnv("RAILWAY_ENVIRONMENT_NAME", row.environment); vi.stubEnv("PREVIEW_MODE", row.preview); vi.stubEnv("COMMAND_CHAT_API_DEBUG_ENABLED", row.flag);
    authFixture.signedAgent.mockResolvedValue(row.admin === null ? null : { isAdmin: row.admin }); const setHeader = vi.fn();
    const req = { path: "/api/trpc/agents.me,opsChat.listIssues" }; const res = { setHeader };
    try {
      const result = await createContext({ req, res } as unknown as CreateExpressContextOptions);
      expect(setHeader).toHaveBeenCalledWith("X-Command-Chat-API-Debug", row.expected); expect(result).toEqual({ req, res, user: null });
      expect(authFixture.authenticate).toHaveBeenCalled();
    } finally { vi.unstubAllEnvs(); authFixture.signedAgent.mockReset(); authFixture.signedAgent.mockResolvedValue({ isAdmin: true }); authFixture.authenticate.mockClear(); }
  });
  it("unrelated path does not inspect signed agent or create header; invalid signature fails closed", async () => {
    vi.stubEnv("RAILWAY_ENVIRONMENT_NAME", "preview"); vi.stubEnv("PREVIEW_MODE", "true"); vi.stubEnv("COMMAND_CHAT_API_DEBUG_ENABLED", "true");
    const setHeader = vi.fn(); authFixture.signedAgent.mockClear();
    try {
      await createContext({ req: { path: "/api/trpc/notagents.me,opsChat.listIssues" }, res: { setHeader } } as unknown as CreateExpressContextOptions);
      expect(setHeader).not.toHaveBeenCalled(); expect(authFixture.signedAgent).not.toHaveBeenCalled();
      authFixture.signedAgent.mockRejectedValueOnce(new Error("FAKE_PRIVATE_INVALID_SIGNATURE"));
      await createContext({ req: { path: "/api/trpc/agents.me" }, res: { setHeader } } as unknown as CreateExpressContextOptions); expect(setHeader).toHaveBeenCalledWith("X-Command-Chat-API-Debug", "0");
    } finally { vi.unstubAllEnvs(); authFixture.signedAgent.mockClear(); }
  });
});

describe("memory-only existing agents.me response capability capture", () => {
  async function capabilityReader() {
    let value = false, renders = 0; function Read() { value = useCommandChatApiDebugServerEligibility(); renders++; return createElement("span", null, String(value)); }
    let root: any; await act(async () => { root = renderer.create(createElement(Read)); }); roots.push(root);
    return { get value() { return value; }, get renders() { return renders; } };
  }
  it("defaults false; exact agents.me batch header activates with one stable notification", async () => {
    const read = await capabilityReader(); expect(read.value).toBe(false);
    const response = new Response("FAKE_PRIVATE_RESPONSE_BODY", { headers: { "X-Command-Chat-API-Debug": "1" } }); const json = vi.spyOn(response, "json"); const text = vi.spyOn(response, "text");
    await act(async () => captureCommandChatApiDebugEligibility(response, "/api/trpc/opsChat.listIssues,agents.me?batch=1&input=FAKE_PRIVATE_INPUT")); expect(read.value).toBe(true);
    const before = read.renders; await act(async () => captureCommandChatApiDebugEligibility(response, new URL("https://offline.invalid/api/trpc/agents.me"))); expect(read.renders).toBe(before);
    expect(json).not.toHaveBeenCalled(); expect(text).not.toHaveBeenCalled(); expect(fixture.storage.size).toBe(0);
  });
  it.each(["/api/trpc/opsChat.listIssues", "/api/trpc/notagents.me", "/api/trpc/agents.me.extra", "/api/agents.me", "/api/trpc/opsChat.listIssues?input=agents.me"])("unrelated %s cannot grant capability", async input => {
    const read = await capabilityReader(); await act(async () => captureCommandChatApiDebugEligibility(new Response(null, { headers: { "X-Command-Chat-API-Debug": "1" } }), input)); expect(read.value).toBe(false);
  });
  it("missing/zero/malformed header and failing response reset capability; Request accepted without body reads", async () => {
    const read = await capabilityReader();
    for (const response of [new Response(null), new Response(null, { headers: { "X-Command-Chat-API-Debug": "0" } }), new Response(null, { headers: { "X-Command-Chat-API-Debug": "true" } }), new Response(null, { status: 403, headers: { "X-Command-Chat-API-Debug": "1" } })]) {
      await act(async () => captureCommandChatApiDebugEligibility(new Response(null, { headers: { "X-Command-Chat-API-Debug": "1" } }), "/api/trpc/agents.me")); expect(read.value).toBe(true);
      const request = new Request("https://offline.invalid/api/trpc/agents.me", { method: "POST", body: "FAKE_PRIVATE_REQUEST_BODY" });
      await act(async () => captureCommandChatApiDebugEligibility(response, request)); expect(read.value).toBe(false);
    }
  });
});

describe("actual mounted read polling prevention", () => {
  it.each(endpoints)("live %s OFF blocks future poll attempts while unrelated schedules remain", async endpoint => {
    vi.useFakeTimers({ shouldAdvanceTime: true }); const h = pageHarness(); await h.start();
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    const c = h.panelController(); expect(c.eligible).toBe(true);
    await act(async () => c.setEnabled(endpoint, false)); const stopped = h.count(endpoint), unrelated = h.count("opsChat.listIssues");
    await act(async () => { await vi.advanceTimersByTimeAsync(61000); });
    expect(h.count(endpoint)).toBe(stopped); expect(h.count("opsChat.listIssues")).toBeGreaterThan(unrelated);
    expect(c.getSnapshot().enabled[endpoint]).toBe(false);
  });
});

describe("owned source scope and unchanged tRPC semantics", () => {
  it("core has type-only server import, no payload storage, polling service or query cancellation", () => {
    const core = readFileSync(resolve(import.meta.dirname, "../client/src/lib/commandChatApiDebug.tsx"), "utf8");
    expect(core).toContain('import type { AppRouter }'); expect(core).not.toMatch(/console\.|setInterval\(|cancelQueries\(|AbortController|queryClient|fetch\(/);
    expect(core).toContain('TRPCClientError<AppRouter>(COMMAND_CHAT_API_DEBUG_SUPPRESSED)');
  });
});
