import {
  QueryClient, QueryObserver, QueryClientProvider, useQuery, type QueryKey,
} from "@tanstack/react-query";
import { createElement, StrictMode, useEffect, useMemo } from "react";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCommandChatRefreshManager } from "../client/src/lib/commandChatRefresh";

// Enable the installed QueryObserver's browser interval implementation BEFORE imports.
// No application server, HTTP link, SSE connection, database, or credentials are used.
const offline = vi.hoisted(() => {
  if (Object.keys(process.env).some(key => /DATABASE_URL|MYSQL_URL|API_KEY|TOKEN|SECRET/.test(key))) {
    throw new Error("Credential-bearing environment forbidden");
  }
  const priorWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { value: {}, configurable: true });
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  return { priorWindow };
});
const renderer: any = createRequire(import.meta.url)(
  process.env.COMMAND_CHAT_TEST_RENDERER_PATH || "react-test-renderer",
);
const act = renderer.act;
const key = [["offline", "inbox"], { type: "query" }] as const;
const payload = Array.from({ length: 20 }, (_, id) => ({ id, text: "Synthetic inbox payload only." }));
const payloadBytes = Buffer.byteLength(JSON.stringify(payload));
const cleanups: Array<() => void> = [];
const roots: any[] = [];
const measurements: any[] = [];
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
async function flush() { for (let i = 0; i < 40; i++) await Promise.resolve(); }
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(100000);
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Network forbidden"); }));
  vi.stubGlobal("EventSource", class { constructor() { throw new Error("Network forbidden"); } });
  vi.stubGlobal("WebSocket", class { constructor() { throw new Error("Network forbidden"); } });
});
afterEach(async () => {
  await act(async () => roots.splice(0).forEach(root => root.unmount()));
  cleanups.splice(0).forEach(fn => fn());
  expect(globalThis.fetch).not.toHaveBeenCalled();
  vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers();
});
afterAll(() => {
  if (process.env.COMMAND_CHAT_POLLING_RESULTS_PATH) {
    writeFileSync(process.env.COMMAND_CHAT_POLLING_RESULTS_PATH,
      JSON.stringify({ syntheticResponseBytesPerSuccessfulRead: payloadBytes, measurements }, null, 2) + "\n");
  }
  if (offline.priorWindow) Object.defineProperty(globalThis, "window", offline.priorWindow);
  else Reflect.deleteProperty(globalThis, "window");
});
function harness(options: {
  interval?: number | false | ((query: any) => number | false);
  held?: boolean; enabled?: boolean; cold?: boolean; queryKey?: QueryKey;
} = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const queryKey = options.queryKey ?? key;
  let calls = 0, aborted = 0, active = 0, peak = 0, bytes = 0;
  const requests: ReturnType<typeof deferred<typeof payload>>[] = [];
  const queryFn = ({ signal }: { signal: AbortSignal }) => {
    calls++; active++; peak = Math.max(peak, active);
    signal.addEventListener("abort", () => aborted++);
    const request = deferred<typeof payload>(); requests.push(request);
    if (!options.held) request.resolve(payload);
    return request.promise.then(rows => {
      bytes += Buffer.byteLength(JSON.stringify(rows)); return rows;
    }).finally(() => active--);
  };
  const observer = new QueryObserver(client, {
    queryKey, queryFn, enabled: options.enabled ?? true, staleTime: 30000,
    ...(options.cold ? {} : { initialData: payload }),
    refetchInterval: options.interval ?? 15000, refetchIntervalInBackground: false,
  });
  const stop = observer.subscribe(() => {});
  const manager = createCommandChatRefreshManager(client); manager.sync([queryKey]); manager.reconnect();
  cleanups.push(() => { manager.dispose(); stop(); client.clear(); });
  return { client, queryKey, observer, manager, requests,
    metrics: () => ({ admittedOperations: calls, syntheticResponseBytes: bytes, aborted, peak }),
  };
}

describe("actual QueryObserver polling: measure, do not assume amplification", () => {
  it.each([10000, 20000])("measures existing 15s fallback with %ims event cadence at 10s/20s/60s", async cadence => {
    const h = harness(); const checkpoints: any[] = [];
    for (let time = 1000; time <= 60000; time += 1000) {
      await vi.advanceTimersByTimeAsync(1000);
      if (time % cadence === 0) { h.manager.request(key); await flush(); }
      if ([10000, 20000, 60000].includes(time)) checkpoints.push({ atMs: time, ...h.metrics() });
    }
    measurements.push({ scenario: "healthy events", cadenceMs: cadence, checkpoints });
    expect(checkpoints.map(row => row.admittedOperations)).toEqual(cadence === 10000 ? [1, 2, 6] : [0, 2, 6]);
    expect(h.metrics()).toMatchObject({ aborted: 0, peak: 1, admittedOperations: 6, syntheticResponseBytes: payloadBytes * 6 });
  });
  it("quiet connected stream retains four existing fallback reads; connection is not coverage", async () => {
    const h = harness(); const checkpoints: any[] = [];
    for (const delta of [10000, 10000, 40000]) {
      await vi.advanceTimersByTimeAsync(delta); checkpoints.push({ atMs: Date.now() - 100000, ...h.metrics() });
    }
    measurements.push({ scenario: "connected quiet fallback", checkpoints });
    expect(checkpoints.map(row => row.admittedOperations)).toEqual([0, 1, 4]);
    expect(h.metrics().syntheticResponseBytes).toBe(payloadBytes * 4);
  });
  it.each([3000, 15000, 30000])("native %ims ticks deduplicate one held event read, without cancellation or dirty followup", async interval => {
    const h = harness({ interval, held: true }); h.manager.request(key);
    await vi.advanceTimersByTimeAsync(60000);
    expect(h.metrics()).toEqual({ admittedOperations: 1, syntheticResponseBytes: 0, aborted: 0, peak: 1 });
    h.requests[0].resolve(payload); await flush();
    await vi.advanceTimersByTimeAsync(interval - 1);
    expect(h.metrics().admittedOperations).toBe(1);
    await vi.advanceTimersByTimeAsync(1); expect(h.metrics().admittedOperations).toBe(2);
    h.requests[1].resolve(payload); await flush();
    measurements.push({ scenario: "held event read then resumed fallback", intervalMs: interval, ...h.metrics() });
  });
  it("fetch and success updates re-arm the full interval from successful SSE data", async () => {
    const h = harness({ held: true });
    await vi.advanceTimersByTimeAsync(14000); h.manager.request(key);
    await vi.advanceTimersByTimeAsync(2000); expect(h.metrics().admittedOperations).toBe(1);
    h.requests[0].resolve(payload); await flush();
    expect(h.client.getQueryState(key)?.dataUpdatedAt).toBe(116000);
    await vi.advanceTimersByTimeAsync(14999); expect(h.metrics().admittedOperations).toBe(1);
    await vi.advanceTimersByTimeAsync(1); expect(h.metrics().admittedOperations).toBe(2);
    h.requests[1].resolve(payload); await flush();
    measurements.push({ scenario: "SSE at 14s settled at 16s, next poll at 31s", ...h.metrics() });
  });
  it.each(["scheduled-poll", "cold-initial"] as const)("an explicit event burst during %s retains exactly one REQUIRED followup", async kind => {
    const h = harness({ held: true, cold: kind === "cold-initial" });
    if (kind === "scheduled-poll") await vi.advanceTimersByTimeAsync(15000);
    for (let i = 0; i < 50; i++) h.manager.request(key);
    expect(h.metrics().admittedOperations).toBe(1);
    h.requests[0].resolve(payload); await flush(); expect(h.metrics().admittedOperations).toBe(2);
    h.requests[1].resolve(payload); await flush();
    await vi.advanceTimersByTimeAsync(1000); expect(h.metrics().admittedOperations).toBe(2);
    expect(h.metrics()).toMatchObject({ aborted: 0, peak: 1 });
    measurements.push({ scenario: "explicit event burst during " + kind, ...h.metrics() });
  });
  it("immediate reconnect behind a poll and mutation fences share exactly one fresh followup", async () => {
    const h = harness({ held: true }); await vi.advanceTimersByTimeAsync(15000);
    let completed = 0;
    const completions = Array.from({ length: 20 }, () => h.manager.reconcile(key).then(() => completed++));
    h.manager.reconnect(); h.manager.reconnect();
    await vi.advanceTimersByTimeAsync(60000); expect(h.metrics().admittedOperations).toBe(1);
    h.requests[0].resolve(payload); await flush(); expect(completed).toBe(0);
    expect(h.metrics().admittedOperations).toBe(2);
    h.requests[1].resolve(payload); await Promise.all(completions); expect(completed).toBe(20);
    expect(h.metrics()).toMatchObject({ aborted: 0, peak: 1 });
  });
  it("a failed older poll still requires fresh reconciliation; failures do not manufacture freshness", async () => {
    const h = harness({ held: true }); await vi.advanceTimersByTimeAsync(15000);
    let completed = false; const fence = h.manager.reconcile(key).then(() => completed = true);
    h.requests[0].reject(new Error("Synthetic failure")); await flush();
    expect(completed).toBe(false); expect(h.metrics().admittedOperations).toBe(2);
    h.requests[1].reject(new Error("Synthetic followup failure")); await fence; await flush();
    expect(completed).toBe(true); expect(h.client.getQueryState(key)?.status).toBe("error");
    expect(h.metrics().syntheticResponseBytes).toBe(0);
    await vi.advanceTimersByTimeAsync(15000); expect(h.metrics().admittedOperations).toBe(3);
    h.requests[2].resolve(payload); await flush();
  });
  it("disabled/API-debug-paused exact keys cannot be fetched by polls, events, reconcile or reconnect", async () => {
    const h = harness({ enabled: false });
    h.manager.request(key); await h.manager.reconcile(key); h.manager.reconnect();
    await vi.advanceTimersByTimeAsync(60000); expect(h.metrics().admittedOperations).toBe(0);
    // This is the page's allowsQueryKey-filtered retirement model, not an alternate debug gate.
    h.manager.sync([]); h.manager.request(key, true); await h.manager.reconcile(key);
    expect(h.metrics().admittedOperations).toBe(0);
  });
  it("negative control: false while recent data strands quiet fallback indefinitely", async () => {
    const h = harness({ interval: query => query.state.fetchStatus !== "idle" || Date.now() - query.state.dataUpdatedAt < 15000 ? false : 15000 });
    await vi.advanceTimersByTimeAsync(60000);
    expect(h.metrics().admittedOperations).toBe(0);
    measurements.push({ scenario: "rejected false-while-recent callback", ...h.metrics() });
  });
  it("negative control: false only while fetching resumes on success but does not reduce admitted operations", async () => {
    const h = harness({ held: true, interval: query => query.state.fetchStatus !== "idle" ? false : 15000 });
    h.manager.request(key); await vi.advanceTimersByTimeAsync(60000);
    expect(h.metrics().admittedOperations).toBe(1);
    h.requests[0].resolve(payload); await flush(); await vi.advanceTimersByTimeAsync(15000);
    expect(h.metrics().admittedOperations).toBe(2); h.requests[1].resolve(payload); await flush();
    measurements.push({ scenario: "no-benefit false-while-fetching callback", ...h.metrics() });
  });
});

// Mounted React lifecycle fixture uses the actual useQuery observer and identical
// page ownership pattern. It is not represented as a mounted actual-page test;
// unchanged commandChatRefresh.test.ts already provides that coverage.
describe("mounted React useQuery/owner lifecycle, external test-only renderer", () => {
  function mountedHarness() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity, staleTime: Infinity } } });
    const requests: ReturnType<typeof deferred<typeof payload>>[] = [];
    const scopes: Array<{ manager: ReturnType<typeof createCommandChatRefreshManager> | null }> = [];
    let calls = 0, bytes = 0;
    const queryFn = () => { calls++; const request = deferred<typeof payload>(); requests.push(request); return request.promise.then(data => { bytes += Buffer.byteLength(JSON.stringify(data)); return data; }); };
    function Fixture({ identity, enabled }: { identity: number | null; enabled: boolean }) {
      const scope = useMemo(() => ({ manager: null as ReturnType<typeof createCommandChatRefreshManager> | null }), [identity]);
      useQuery({ queryKey: key, queryFn, initialData: payload, enabled: identity !== null && enabled,
        refetchInterval: enabled ? 15000 : false, refetchIntervalInBackground: false });
      useEffect(() => {
        if (identity === null) return;
        const manager = createCommandChatRefreshManager(client); scope.manager = manager; scopes.push(scope);
        return () => { if (scope.manager === manager) scope.manager = null; manager.dispose(); };
      }, [scope, identity]);
      useEffect(() => { scope.manager?.sync(identity !== null && enabled ? [key] : []); }, [scope, identity, enabled]);
      return null;
    }
    let root: any;
    const tree = (identity: number | null, enabled: boolean) => createElement(StrictMode, null,
      createElement(QueryClientProvider, { client, children: createElement(Fixture, { identity, enabled }) }));
    cleanups.push(() => client.clear());
    return { client, requests, scopes, metrics: () => ({ admittedOperations: calls, syntheticResponseBytes: bytes }),
      async mount(identity: number | null = 1, enabled = true) { await act(async () => { root = renderer.create(tree(identity, enabled)); }); roots.push(root); },
      async update(identity: number | null, enabled = true) { await act(async () => root.update(tree(identity, enabled))); },
      async stop() { await act(async () => root.unmount()); roots.splice(roots.indexOf(root), 1); },
    };
  }
  it("real React observer resets 15s timer on SSE success and old auth/unmount scopes cannot resurrect work", async () => {
    const h = mountedHarness(); await h.mount();
    expect(h.metrics().admittedOperations).toBe(0);
    const first = h.scopes.at(-1)!;
    await act(async () => { await vi.advanceTimersByTimeAsync(14000); first.manager!.request(key); });
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); h.requests[0].resolve(payload); await flush(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(14999); }); expect(h.metrics().admittedOperations).toBe(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); }); expect(h.metrics().admittedOperations).toBe(2);
    const retired = first.manager!; const fence = retired.reconcile(key);
    await h.update(2); await fence; expect(first.manager).toBeNull();
    const next = h.scopes.at(-1)!.manager!;
    retired.request(key, true); retired.reconnect(); await retired.reconcile(key);
    await act(async () => { h.requests[1].resolve(payload); await flush(); });
    expect(h.metrics().admittedOperations).toBe(2);
    await h.stop(); next.request(key, true); next.reconnect(); await next.reconcile(key);
    await act(async () => { await vi.advanceTimersByTimeAsync(60000); });
    expect(h.metrics().admittedOperations).toBe(2);
    measurements.push({ scenario: "mounted StrictMode SSE timer/auth/unmount", ...h.metrics() });
  });
  it("real disabled debug gate and logout silence polling while re-enable restores existing fallback", async () => {
    const h = mountedHarness(); await h.mount(1, false);
    const scope = h.scopes.at(-1)!;
    scope.manager!.request(key); scope.manager!.reconnect(); scope.manager!.reconnect();
    await act(async () => { await vi.advanceTimersByTimeAsync(60000); }); expect(h.metrics().admittedOperations).toBe(0);
    await h.update(1, true);
    await act(async () => { await vi.advanceTimersByTimeAsync(15000); }); expect(h.metrics().admittedOperations).toBe(1);
    await h.update(null);
    await act(async () => { h.requests[0].resolve(payload); await flush(); await vi.advanceTimersByTimeAsync(60000); });
    expect(h.metrics().admittedOperations).toBe(1);
  });
});

describe("no speculative production changes", () => {
  it("refresh helper and shared scheduler remain byte-identical to measured baseline", () => {
    const digest = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
    expect(digest(resolve(import.meta.dirname, "../client/src/lib/commandChatRefresh.ts"))).toBe("9a7b627316fddb90c7a96feb6b3bc33b6e8712fc214292c9e2ce608855a67295");
    expect(digest(resolve(import.meta.dirname, "../client/src/lib/leadListRefreshCoordinator.ts"))).toBe("1da2785a80fba5471872a6b38dd1d4f3e58eedd36b8f2ce55e138c137bfe5df5");
  });
});
