import { QueryClient, QueryObserver, QueryClientProvider, type QueryKey } from "@tanstack/react-query";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { createLeadListRefreshCoordinator } from "../client/src/lib/leadListRefreshCoordinator";
import {
  createCommandChatRefreshEntry,
  createCommandChatRefreshManager,
} from "../client/src/lib/commandChatRefresh";

// Before query-core loads, enable its actual browser observer interval branch.
// No DOM, application server, transport link, or network is used.
const browserTimerFixture = vi.hoisted(() => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { value: {}, configurable: true });
  return { previous };
});
afterAll(() => {
  if (browserTimerFixture.previous) {
    Object.defineProperty(globalThis, "window", browserTimerFixture.previous);
  } else {
    Reflect.deleteProperty(globalThis, "window");
  }
});

describe("coordinator mechanisms", () => {
const key = [["fixture", "inbox"], { type: "query" }] as const;
const selectedKey = (id: number): QueryKey => [
  ["fixture", "selectedHistory"],
  { input: { sessionId: id }, type: "query" },
];
type Row = { id: number; hasUnanswered: boolean };
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
async function flush() {
  for (let i = 0; i < 40; i++) await Promise.resolve();
}
const cleanups: Array<() => void> = [];
function setup(options: {
  cold?: boolean;
  enabled?: boolean;
  interval?: number;
  queryKey?: QueryKey;
  client?: QueryClient;
} = {}) {
  const client = options.client ?? new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  const queryKey = options.queryKey ?? key;
  const requests: ReturnType<typeof deferred<Row[]>>[] = [];
  const aborted = vi.fn();
  let active = 0;
  let maximum = 0;
  const queryFn = vi.fn(({ signal }: { signal: AbortSignal }) => {
    signal.addEventListener("abort", aborted);
    active++;
    maximum = Math.max(maximum, active);
    const request = deferred<Row[]>();
    requests.push(request);
    return request.promise.finally(() => { active--; });
  });
  const observer = new QueryObserver(client, {
    queryKey, queryFn, enabled: options.enabled ?? true, staleTime: Infinity,
    ...(options.cold ? {} : { initialData: [] as Row[] }),
    ...(options.interval ? {
      refetchInterval: options.interval, refetchIntervalInBackground: false,
    } : {}),
  });
  const stop = observer.subscribe(() => {});
  const entry = createCommandChatRefreshEntry(client, queryKey);
  const manager = createCommandChatRefreshManager(client);
  manager.sync([queryKey]);
  cleanups.push(() => {
    entry.dispose(); manager.dispose(); stop();
    if (!options.client) client.clear();
  });
  return {
    client, queryKey, observer, queryFn, requests, aborted, entry, manager,
    maximum: () => maximum,
  };
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Network forbidden"); }));
});
afterEach(() => {
  cleanups.splice(0).forEach(fn => fn());
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("Command Chat refresh entry: unchanged scheduling, actual cache", () => {
  it("starts the idle leading hint synchronously and coalesces a burst into one dirty follow-up", async () => {
    const h = setup();
    expect(h.entry.request()).toBeUndefined();
    expect(h.queryFn).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 50; i++) h.entry.request();
    h.requests[0].resolve([]); await flush();
    await vi.advanceTimersByTimeAsync(499);
    expect(h.queryFn).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(h.queryFn).toHaveBeenCalledTimes(2);
    h.requests[1].resolve([{ id: 1, hasUnanswered: true }]); await flush();
    await vi.advanceTimersByTimeAsync(3000);
    expect(h.queryFn).toHaveBeenCalledTimes(2);
    expect(h.maximum()).toBe(1);
    expect(h.aborted).not.toHaveBeenCalled();
    expect(h.client.getQueryData(key)).toEqual([{ id: 1, hasUnanswered: true }]);
  });
  it.each(["poll", "cold-initial"] as const)(
    "event during %s waits for idle then fetches a fresh snapshot without cancellation",
    async kind => {
      const h = setup({ cold: kind === "cold-initial" });
      if (kind === "poll") void h.observer.refetch({ cancelRefetch: false });
      for (let i = 0; i < 15; i++) h.entry.request();
      expect(h.queryFn).toHaveBeenCalledTimes(1);
      h.requests[0].resolve([]); await flush();
      expect(h.queryFn).toHaveBeenCalledTimes(2);
      h.requests[1].resolve([{ id: 2, hasUnanswered: true }]); await flush();
      expect(h.maximum()).toBe(1);
      expect(h.aborted).not.toHaveBeenCalled();
    }
  );
  it("retains a dirty follow-up when a poll wins the cooldown boundary", async () => {
    const h = setup();
    h.entry.request(); h.requests[0].resolve([]); await flush();
    await vi.advanceTimersByTimeAsync(100); h.entry.request();
    await vi.advanceTimersByTimeAsync(399);
    void h.observer.refetch({ cancelRefetch: false });
    await vi.advanceTimersByTimeAsync(1);
    expect(h.queryFn).toHaveBeenCalledTimes(2);
    h.requests[1].resolve([]); await flush();
    expect(h.queryFn).toHaveBeenCalledTimes(3);
    h.requests[2].resolve([]); await flush();
    expect(h.maximum()).toBe(1);
  });
  it("deduplicates a poll during an owned refresh without replacing its request", async () => {
    const h = setup(); h.entry.request();
    const poll = h.observer.refetch({ cancelRefetch: false });
    expect(h.queryFn).toHaveBeenCalledTimes(1);
    h.requests[0].resolve([]); await poll; await flush();
    expect(h.queryFn).toHaveBeenCalledTimes(1);
    expect(h.maximum()).toBe(1);
    expect(h.aborted).not.toHaveBeenCalled();
  });
  it("continuous hints cannot postpone the fixed leading-edge 500ms window", async () => {
    const h = setup(); h.entry.request(); h.requests[0].resolve([]); await flush();
    for (let i = 0; i < 4; i++) {
      await vi.advanceTimersByTimeAsync(100); h.entry.request();
    }
    await vi.advanceTimersByTimeAsync(100);
    expect(h.queryFn).toHaveBeenCalledTimes(2);
    h.requests[1].resolve([]); await flush();
  });
  it("failure releases the slot, retains last data/error, and adds no implicit retry loop", async () => {
    const h = setup(); h.entry.request(); h.entry.request();
    h.requests[0].reject(new Error("primary unavailable")); await flush();
    expect(h.client.getQueryData(key)).toEqual([]);
    expect(h.client.getQueryState(key)?.error?.message).toBe("primary unavailable");
    await vi.advanceTimersByTimeAsync(500);
    expect(h.queryFn).toHaveBeenCalledTimes(2);
    h.requests[1].reject(new Error("still unavailable")); await flush();
    await vi.advanceTimersByTimeAsync(30000);
    expect(h.queryFn).toHaveBeenCalledTimes(2);
    h.entry.request();
    expect(h.queryFn).toHaveBeenCalledTimes(3);
    h.requests[2].resolve([]); await flush();
  });
  it("immediate action bypasses only cooldown, never the in-flight slot", async () => {
    const h = setup(); h.entry.request(); h.requests[0].resolve([]); await flush();
    await vi.advanceTimersByTimeAsync(100);
    const first = h.entry.reconcile();
    expect(h.queryFn).toHaveBeenCalledTimes(2);
    h.entry.request(true); h.entry.request();
    expect(h.queryFn).toHaveBeenCalledTimes(2);
    h.requests[1].resolve([]); await first; await flush();
    expect(h.queryFn).toHaveBeenCalledTimes(3);
    h.requests[2].resolve([]); await flush();
    expect(h.maximum()).toBe(1);
    expect(h.aborted).not.toHaveBeenCalled();
  });
  it("dispose clears a trailing timer and suppresses future hints without aborting transport", async () => {
    const h = setup(); h.entry.request(); h.entry.request();
    h.requests[0].resolve([]); await flush();
    expect(vi.getTimerCount()).toBe(1);
    h.entry.dispose();
    expect(vi.getTimerCount()).toBe(0);
    h.entry.request(true); await h.entry.reconcile();
    await vi.advanceTimersByTimeAsync(1000);
    expect(h.queryFn).toHaveBeenCalledTimes(1);
    const next = createCommandChatRefreshEntry(h.client, key);
    next.request(); next.request(); next.dispose();
    h.requests[1].resolve([]); await flush();
    expect(h.queryFn).toHaveBeenCalledTimes(2);
    expect(h.aborted).not.toHaveBeenCalled();
  });
  it("unrelated cache settlement cannot drain an exact-key dirty slot", async () => {
    const h = setup(); void h.observer.refetch({ cancelRefetch: false }); h.entry.request();
    await h.client.fetchQuery({ queryKey: ["other-page"], queryFn: async () => "ok" });
    expect(h.queryFn).toHaveBeenCalledTimes(1);
    h.requests[0].resolve([]); await flush();
    expect(h.queryFn).toHaveBeenCalledTimes(2);
    h.requests[1].resolve([]); await flush();
  });
  it("default cancellation-capable invalidation overlaps ignored-abort work (negative control)", async () => {
    const h = setup(); void h.observer.refetch();
    const replacement = h.client.invalidateQueries({ queryKey: key, exact: true });
    expect(h.queryFn).toHaveBeenCalledTimes(2);
    expect(h.maximum()).toBe(2);
    h.requests[1].resolve([{ id: 4, hasUnanswered: false }]); await replacement;
    h.requests[0].resolve([]); await flush();
    expect(h.client.getQueryData(key)).toEqual([{ id: 4, hasUnanswered: false }]);
  });
  it("the original void scheduler cannot preserve optimistic Promise.all timing (negative control)", async () => {
    const h = setup();
    const coordinator = createLeadListRefreshCoordinator({
      queryClient: h.client, queryKey: key,
      refresh: () => h.client.invalidateQueries({ queryKey: key, exact: true }, { cancelRefetch: false }),
    });
    cleanups.push(() => coordinator.dispose());
    let removed = false;
    await Promise.all([coordinator.request({ immediate: true })]).finally(() => { removed = true; });
    expect(removed).toBe(true);
    expect(h.client.getQueryState(key)?.fetchStatus).toBe("fetching");
    h.requests[0].resolve([]); await flush();
  });
});

describe("post-action completion fences: actual query settlement is not success", () => {
  it.each(["claim", "unclaim", "book", "unbook"] as const)(
    "awaited %s during an older poll retains optimism until the post-mutation follow-up",
    async () => {
      const h = setup(); void h.observer.refetch({ cancelRefetch: false });
      let removed = false;
      const completion = Promise.all([h.manager.reconcile(key)]).finally(() => { removed = true; });
      h.manager.request(key);
      h.requests[0].resolve([]); await flush();
      expect(removed).toBe(false);
      expect(h.queryFn).toHaveBeenCalledTimes(2);
      h.requests[1].resolve([{ id: 5, hasUnanswered: false }]); await completion;
      expect(removed).toBe(true);
      expect(h.maximum()).toBe(1);
      expect(h.aborted).not.toHaveBeenCalled();
    }
  );
  it("mutation during first reconciliation waits for a second post-hint read", async () => {
    const h = setup(); const first = h.entry.reconcile();
    let secondDone = false;
    const second = h.entry.reconcile().finally(() => { secondDone = true; });
    h.requests[0].resolve([]); await first; await flush();
    expect(secondDone).toBe(false);
    expect(h.queryFn).toHaveBeenCalledTimes(2);
    h.requests[1].resolve([]); await second;
    expect(secondDone).toBe(true);
    expect(h.maximum()).toBe(1);
  });
  it("multiple waiters during an older fetch share exactly one fresh follow-up", async () => {
    const h = setup(); void h.observer.refetch({ cancelRefetch: false });
    const settled = vi.fn();
    const completions = Array.from({ length: 30 }, () => h.entry.reconcile().then(settled));
    h.requests[0].resolve([]); await flush();
    expect(settled).not.toHaveBeenCalled();
    expect(h.queryFn).toHaveBeenCalledTimes(2);
    h.requests[1].resolve([]); await Promise.all(completions);
    await vi.advanceTimersByTimeAsync(3000);
    expect(settled).toHaveBeenCalledTimes(30);
    expect(h.queryFn).toHaveBeenCalledTimes(2);
  });
  it("failed read settles the fence and finally without fabricating a successful cache snapshot", async () => {
    const h = setup(); let done = false;
    const completion = h.entry.reconcile().finally(() => { done = true; });
    h.requests[0].reject(new Error("refresh failed")); await completion; await flush();
    expect(done).toBe(true);
    expect(h.client.getQueryState(key)?.status).toBe("error");
    expect(h.client.getQueryState(key)?.error?.message).toBe("refresh failed");
    expect(h.client.getQueryData(key)).toEqual([]);
    await vi.advanceTimersByTimeAsync(5000);
    expect(h.queryFn).toHaveBeenCalledTimes(1);
  });
  it("a failed older poll cannot satisfy the mutation fence; its fresh follow-up still runs", async () => {
    const h = setup(); void h.observer.refetch({ cancelRefetch: false });
    let done = false;
    const completion = h.entry.reconcile().finally(() => { done = true; });
    h.requests[0].reject(new Error("older poll failed")); await flush();
    expect(done).toBe(false);
    expect(h.queryFn).toHaveBeenCalledTimes(2);
    h.requests[1].resolve([]); await completion;
    expect(done).toBe(true);
  });
  it.each(["reject", "throw"] as const)(
    "preserves a QueryClient invalidation %s and releases the scheduler for a later hint",
    async mode => {
      const h = setup(); const error = new Error("invalidation failed");
      const invalidate = vi.spyOn(h.client, "invalidateQueries");
      if (mode === "throw") invalidate.mockImplementationOnce(() => { throw error; });
      else invalidate.mockRejectedValueOnce(error);
      const final = vi.fn();
      await expect(h.entry.reconcile().finally(final)).rejects.toBe(error);
      expect(final).toHaveBeenCalledOnce();
      await flush();
      const completion = h.entry.reconcile();
      expect(h.queryFn).toHaveBeenCalledTimes(1);
      h.requests[0].resolve([]); await completion;
    }
  );
  it("logout/dispose releases both started and queued fences without an obsolete follow-up", async () => {
    const h = setup();
    const first = h.entry.reconcile(); const queued = h.entry.reconcile();
    h.entry.dispose(); h.entry.dispose(); await Promise.all([first, queued]);
    h.requests[0].resolve([]); await flush();
    await vi.advanceTimersByTimeAsync(1000);
    expect(h.queryFn).toHaveBeenCalledTimes(1);
    expect(h.aborted).not.toHaveBeenCalled();
  });
});

describe("exact-key manager lifecycle, selection retirement, and reconnect", () => {
  it("sync is read-free and structurally equal reordered keys retain a single cooldown owner", async () => {
    const firstKey = [["fixture", "equal"], { input: { a: 1, b: 2 }, type: "query" }] as const;
    const equalKey = [["fixture", "equal"], { type: "query", input: { b: 2, a: 1 } }] as const;
    const h = setup({ queryKey: firstKey });
    h.manager.sync([firstKey, equalKey]);
    expect(h.queryFn).not.toHaveBeenCalled();
    h.manager.request(firstKey); h.requests[0].resolve([]); await flush();
    await vi.advanceTimersByTimeAsync(100);
    h.manager.sync([equalKey]); h.manager.request(equalKey);
    expect(h.queryFn).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(400);
    expect(h.queryFn).toHaveBeenCalledTimes(2);
    h.requests[1].resolve([]); await flush();
  });
  it("same active keys retain queued waiters rather than disposing on sync", async () => {
    const h = setup(); void h.observer.refetch({ cancelRefetch: false });
    let done = false;
    const completion = h.manager.reconcile(key).finally(() => { done = true; });
    h.manager.sync([[...key]]); h.manager.sync([key]);
    expect(done).toBe(false);
    h.requests[0].resolve([]); await flush();
    expect(done).toBe(false);
    expect(h.queryFn).toHaveBeenCalledTimes(2);
    h.requests[1].resolve([]); await completion;
  });
  it("retiring a dynamic key releases its fence and suppresses old dirty work while preserving fixed keys", async () => {
    const h = setup();
    const old = setup({ client: h.client, queryKey: selectedKey(101) });
    const next = setup({ client: h.client, queryKey: selectedKey(102) });
    h.manager.sync([key, old.queryKey]);
    h.manager.request(key); h.requests[0].resolve([]); await flush();
    void old.observer.refetch({ cancelRefetch: false });
    const retired = h.manager.reconcile(old.queryKey);
    h.manager.sync([key, next.queryKey]); await retired;
    h.manager.request(old.queryKey, true); await h.manager.reconcile(old.queryKey);
    h.manager.request(next.queryKey);
    expect(next.queryFn).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(100); h.manager.request(key);
    expect(h.queryFn).toHaveBeenCalledTimes(1);
    old.requests[0].resolve([]); await flush();
    expect(old.queryFn).toHaveBeenCalledTimes(1);
    expect(old.aborted).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(400);
    expect(h.queryFn).toHaveBeenCalledTimes(2);
    h.requests[1].resolve([]); next.requests[0].resolve([]); await flush();
  });
  it("retiring a key cancels only its cooldown timer and old callbacks cannot resurrect it", async () => {
    const h = setup({ queryKey: selectedKey(201) });
    h.manager.request(h.queryKey); h.requests[0].resolve([]); await flush();
    h.manager.request(h.queryKey);
    expect(vi.getTimerCount()).toBe(1);
    h.manager.sync([]);
    expect(vi.getTimerCount()).toBe(0);
    h.manager.request(h.queryKey, true); await h.manager.reconcile(h.queryKey);
    await vi.advanceTimersByTimeAsync(3000);
    expect(h.queryFn).toHaveBeenCalledTimes(1);
  });
  it("disabled registered queries are marked stale but are not fetched", async () => {
    const h = setup({ enabled: false });
    h.manager.request(key); await h.manager.reconcile(key);
    expect(h.client.getQueryState(key)?.isInvalidated).toBe(true);
    expect(h.queryFn).not.toHaveBeenCalled();
    h.manager.dispose(); h.manager.request(key);
    expect(h.queryFn).not.toHaveBeenCalled();
  });
  it("auth-disabled disposal stays silent and a fresh login waits for the initial read then reconciles", async () => {
    const h = setup({ cold: true, enabled: false });
    h.manager.dispose(); h.manager.request(key); await h.manager.reconcile(key);
    expect(h.queryFn).not.toHaveBeenCalled();
    h.observer.setOptions({ ...h.observer.options, enabled: true });
    const next = createCommandChatRefreshManager(h.client);
    cleanups.push(() => next.dispose()); next.sync([key]); next.request(key, true);
    h.requests[0].resolve([]); await flush();
    expect(h.queryFn).toHaveBeenCalledTimes(2);
    h.requests[1].resolve([]); await flush();
    expect(h.maximum()).toBe(1);
  });
  it("a disposed old-auth manager cannot refresh a new principal even with the same cache key", async () => {
    const h = setup(); void h.observer.refetch({ cancelRefetch: false });
    const retired = h.manager.reconcile(key); h.manager.dispose(); await retired;
    const next = createCommandChatRefreshManager(h.client);
    cleanups.push(() => next.dispose()); next.sync([key]);
    h.manager.sync([key]); h.manager.request(key, true); h.manager.reconnect();
    await h.manager.reconcile(key);
    h.requests[0].resolve([]); await flush();
    expect(h.queryFn).toHaveBeenCalledTimes(1);
    const completion = next.reconcile(key);
    expect(h.queryFn).toHaveBeenCalledTimes(2);
    h.requests[1].resolve([]); await completion;
  });
  it("first connection is silent during cold load and subsequent reconnects coalesce behind a poll", async () => {
    const h = setup({ cold: true }); h.manager.reconnect();
    h.requests[0].resolve([]); await flush();
    expect(h.queryFn).toHaveBeenCalledTimes(1);
    void h.observer.refetch({ cancelRefetch: false });
    h.manager.reconnect(); h.manager.reconnect(); h.manager.reconnect();
    expect(h.queryFn).toHaveBeenCalledTimes(2);
    h.requests[1].resolve([]); await flush();
    expect(h.queryFn).toHaveBeenCalledTimes(3);
    h.requests[2].resolve([]); await flush(); await vi.advanceTimersByTimeAsync(2000);
    expect(h.queryFn).toHaveBeenCalledTimes(3);
    expect(h.maximum()).toBe(1);
  });
  it("reconnect recovers every current exact key once, omits retired selections, and resets on auth lifecycle", async () => {
    const h = setup();
    const old = setup({ client: h.client, queryKey: selectedKey(301) });
    const next = setup({ client: h.client, queryKey: selectedKey(302) });
    h.manager.sync([key, old.queryKey]); h.manager.reconnect();
    expect(h.queryFn).not.toHaveBeenCalled();
    h.manager.sync([key, next.queryKey, next.queryKey]); h.manager.reconnect();
    expect(h.queryFn).toHaveBeenCalledTimes(1);
    expect(next.queryFn).toHaveBeenCalledTimes(1);
    expect(old.queryFn).not.toHaveBeenCalled();
    h.requests[0].resolve([]); next.requests[0].resolve([]); await flush();
    h.manager.dispose();
    const fresh = createCommandChatRefreshManager(h.client);
    cleanups.push(() => fresh.dispose()); fresh.sync([key]); fresh.reconnect();
    expect(h.queryFn).toHaveBeenCalledTimes(1);
  });
  it("separate exact keys retain independent slots rather than serializing the entire page", async () => {
    const h = setup(); const selected = setup({ client: h.client, queryKey: selectedKey(401) });
    h.manager.sync([key, selected.queryKey]);
    h.manager.request(key); h.manager.request(selected.queryKey);
    expect(h.queryFn).toHaveBeenCalledTimes(1);
    expect(selected.queryFn).toHaveBeenCalledTimes(1);
    h.requests[0].resolve([]); selected.requests[0].resolve([]); await flush();
  });
  it("setup-cleanup-setup retains no stale owner or waiter (React-free lifecycle model, not mounted StrictMode)", async () => {
    const h = setup(); void h.observer.refetch({ cancelRefetch: false });
    const retired = h.manager.reconcile(key); h.manager.dispose(); await retired;
    const next = createCommandChatRefreshManager(h.client);
    cleanups.push(() => next.dispose()); next.sync([key]);
    const completion = next.reconcile(key);
    h.requests[0].resolve([]); await flush();
    expect(h.queryFn).toHaveBeenCalledTimes(2);
    h.requests[1].resolve([]); await completion;
    expect(h.maximum()).toBe(1);
  });
});

describe("actual QueryObserver timer polls share the exact cache slot", () => {
  it("repeated interval ticks deduplicate a held poll and one event hint causes one post-poll refresh", async () => {
    const h = setup({ interval: 30000 });
    await vi.advanceTimersByTimeAsync(30000);
    expect(h.queryFn).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(90000);
    expect(h.queryFn).toHaveBeenCalledTimes(1);
    h.manager.request(key); h.manager.request(key);
    h.requests[0].resolve([]); await flush();
    expect(h.queryFn).toHaveBeenCalledTimes(2);
    h.requests[1].resolve([]); await flush();
    await vi.advanceTimersByTimeAsync(30000);
    expect(h.queryFn).toHaveBeenCalledTimes(3);
    h.requests[2].resolve([]); await flush();
    expect(h.maximum()).toBe(1);
    expect(h.aborted).not.toHaveBeenCalled();
    expect(h.observer.options.refetchIntervalInBackground).toBe(false);
  });
  it("a mutation fence is not satisfied by the older interval poll and interval ticks cannot replace its follow-up", async () => {
    const h = setup({ interval: 30000 });
    await vi.advanceTimersByTimeAsync(30000);
    let done = false;
    const completion = h.manager.reconcile(key).finally(() => { done = true; });
    await vi.advanceTimersByTimeAsync(60000);
    expect(h.queryFn).toHaveBeenCalledTimes(1);
    h.requests[0].resolve([]); await flush();
    expect(done).toBe(false);
    expect(h.queryFn).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(60000);
    expect(done).toBe(false);
    expect(h.queryFn).toHaveBeenCalledTimes(2);
    h.requests[1].resolve([]); await completion;
    expect(done).toBe(true);
    expect(h.maximum()).toBe(1);
    expect(h.aborted).not.toHaveBeenCalled();
  });
});

describe("source preservation boundary", () => {
  it("uses the byte-unchanged shared scheduler with no React hook, application-server import, or transport", () => {
    const scheduler = readFileSync(resolve(import.meta.dirname, "../client/src/lib/leadListRefreshCoordinator.ts"));
    expect(createHash("sha256").update(scheduler).digest("hex")).toBe(
      "1da2785a80fba5471872a6b38dd1d4f3e58eedd36b8f2ce55e138c137bfe5df5"
    );
    const helper = readFileSync(resolve(import.meta.dirname, "../client/src/lib/commandChatRefresh.ts"), "utf8");
    expect(helper).toContain('from "./leadListRefreshCoordinator"');
    expect(helper).toContain("cancelRefetch: false");
    expect(helper).toContain("exact: true");
    expect(helper).toContain("hashKey(key)");
    expect(helper).not.toMatch(/from ["']react["']|fetch\(|httpBatch|refetchInterval|setInterval|\/server\//);
  });
});

});

// Mounted page coverage uses only a fake transport and test-only renderer.
// Actual CommandChatExactLive, actual tRPC hooks/provider, actual TanStack QueryClient.
import { createRequire } from 'node:module';
import { createElement, StrictMode, Suspense } from 'react';
import * as React from 'react';
import { createTRPCClient, TRPCClientError } from '@trpc/client';
import { observable } from '@trpc/server/observable';
import { getQueryKey } from '@trpc/react-query';
import { trpc } from '@/lib/trpc';
import CommandChatExactLive from '@/pages/CommandChatExactLive';

// The unchanged repository test compiler uses classic JSX; production Vite uses
// the React plugin. Supply its namespace only inside the isolated test fixture.
beforeEach(() => vi.stubGlobal('React', React));

const fixture = vi.hoisted(() => {
  if (Object.keys(process.env).some(key => /DATABASE_URL|MYSQL_URL|OPENAI_API_KEY|LAUNCH27|TWILIO|TOKEN|SECRET/.test(key))) throw new Error('Credential environment forbidden');
  const noop = () => {};
  const storage = new Map<string, string>();
  const browser = { addEventListener: noop, removeEventListener: noop, location: { origin: 'https://offline.invalid' }, matchMedia: () => ({ matches: false, addEventListener: noop, removeEventListener: noop }) };
  Object.defineProperty(globalThis, 'window', { value: browser, configurable: true });
  Object.defineProperty(globalThis, 'document', { value: { visibilityState: 'visible', addEventListener: noop, removeEventListener: noop, getElementById: () => null, hasFocus: () => true }, configurable: true });
  Object.defineProperty(globalThis, 'navigator', { value: { onLine: true, clipboard: { writeText: async () => {} } }, configurable: true });
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true, localStorage: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) }, requestAnimationFrame: () => 1, cancelAnimationFrame: noop });
  const fetch = vi.fn(() => { throw new Error('Real fetch forbidden'); });
  Object.assign(globalThis, { fetch, EventSource: class { constructor() { throw new Error('EventSource forbidden'); } }, WebSocket: class { constructor() { throw new Error('WebSocket forbidden'); } }, Audio: class { volume = 0; play() { return Promise.resolve(); } } });
  return { streams: [] as any[], fetch, playSound: vi.fn(), storage };
});
vi.mock('@/hooks/useOpsStream', () => ({ useOpsStream: (callbacks: any, options: any) => { fixture.streams.push({ callbacks, options }); return {}; } }));
vi.mock('@/hooks/useNotificationSound', () => ({ useNotificationSound: () => ({ playSound: fixture.playSound, muted: true }) }));
vi.mock('@/hooks/useTabLeader', () => ({ useTabLeader: () => ({ isLeader: false }) }));
vi.mock('@/components/AiConcierge', () => ({ default: () => null }));
vi.mock('@/components/IssueEngineOverlay', () => ({ IssueEngineOverlay: () => null }));
vi.mock('@/components/AllThreadsPanel', () => ({ default: () => null }));
vi.mock('@/pages/CommandChatEmailDetail', () => ({ default: () => null }));
const renderer: any = createRequire(import.meta.url)(process.env.COMMAND_CHAT_TEST_RENDERER_PATH || 'react-test-renderer');
const act = renderer.act;
const mounted: any[] = [];
const clients: QueryClient[] = [];
const range = (count: number, start = 1) => Array.from({ length: count }, (_, index) => start + index);
function deferred<T = any>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const statusRow = (id: number, booked = id % 2 === 0) => ({ id, isBooked: booked, bookedAt: booked ? 123456 : null, bookedByAgentName: booked ? 'Status Agent' : null, bookedAmount: booked ? 320 : null, stage: 'NEW', lostReason: null });
const smsRow = (id = 2, stamp = 100000) => ({ id, leadName: `Synthetic Lead ${id}`, leadPhone: '+12025550100', leadSource: 'quoteform', lastMessageText: `Inbox row ${id}`, lastMsgTs: stamp, lastMessageTs: stamp, lastSenderRole: 'assistant', hasUnanswered: false, aiSummary: null, personType: 'customer', lastInboundPhoneNumberId: null, receivedAt: 99000, calledAt: 99900, stage: 'NEW', isBooked: false, bookedByAgentName: null, bookedAt: null });
const message = (id: number, sessionId: number) => ({ id, ts: 100000 + id, from: 'Synthetic lead', role: 'system', body: 'New lead', mediaUrl: null, quickAction: 'new_lead', metadata: JSON.stringify({ sessionId, leadName: `Synthetic Lead ${id}`, leadPhone: '+12025550100', source: 'quoteform' }), replyToId: null, replyToBody: null, replyToAuthor: null, threadParentId: null, threadParentBody: null, threadParentFrom: null, replyCount: 0 });
function harness(args: { authenticated?: boolean; ids?: number[]; strict?: boolean; inbox?: ReturnType<typeof deferred>; status?: (ids: number[], call: number) => any; historyHeld?: boolean } = {}) {
  const ids = args.ids ?? [...range(65), 1, 2];
  const inbox = args.inbox ?? deferred();
  const history = deferred();
  const queryRecords: any[] = [], mutationRecords: any[] = [], statusInputs: number[][] = [];
  let activeStatus = 0, peakStatus = 0;
  let agent: any = args.authenticated === false ? null : { id: 70001, name: 'Synthetic Agent', awayStatus: null };
  const c = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity, staleTime: 120000, refetchOnWindowFocus: false, refetchOnReconnect: false } } });
  clients.push(c);
  // Stable unrelated cache fixtures avoid baseline default-[] notification effects
  // re-rendering before disabled queries can acquire data. Primary/status stay cold.
  c.setQueryData(getQueryKey(trpc.opsChat.listChannelMessages, { channel: 'command' }, 'query'), ids.map((id, index) => message(index + 1, id)));
  c.setQueryData(getQueryKey(trpc.thumbtackLead.listNative, undefined, 'query'), []);
  c.setQueryData(getQueryKey(trpc.commandCenter.listInboundTeamSmsEvents, { sessionIds: [] }, 'query'), []);
  for (const procedure of [trpc.opsChat.listIssues, trpc.opsChat.listActiveThreads, trpc.opsChat.getPendingSuperAlerts, trpc.opsChat.getSuperAlertMessageIds]) {
    const input = procedure === trpc.opsChat.listIssues ? { status: 'open', limit: 12 } : procedure === trpc.opsChat.getSuperAlertMessageIds ? { channel: 'command' } : undefined;
    c.setQueryData(getQueryKey(procedure, input as any, 'query'), []);
  }
  const rpc = createTRPCClient<any>({ links: [() => ({ op }) => observable((sink) => {
    const record = { path: op.path, input: op.input, type: op.type };
    let result: any;
    if (op.type === 'mutation') {
      const pending = deferred();
      mutationRecords.push({ ...record, pending });
      result = op.path === 'opsChat.getReactions' ? { reactions: [] } : pending.promise;
    } else {
      queryRecords.push(record);
      switch (op.path) {
        case 'agents.me': result = agent; break;
        case 'commandCenter.listCommandChatInbox': result = inbox.promise; break;
        case 'opsChat.listChannelMessages': result = ids.map((id, index) => message(index + 1, id)); break;
        case 'opsChat.getMyProfile': result = { name: agent?.name, photoUrl: null }; break;
        case 'opsChat.getAllAgentPhotoMap': result = { photos: {} }; break;
        case 'opsChat.getAgentStatusList': result = { agents: [] }; break;
        case 'bookings.todayStats': result = { bookedCount: 0, bookedRevenue: 0, bookingDetails: [] }; break;
        case 'opsChat.listEmailInboxThreads': result = { threads: [] }; break;
        case 'voice.listCalls': result = { calls: [] }; break;
        case 'opsChat.getChannelPin': result = null; break;
        case 'opsChat.getChannelCounts': result = {}; break;
        case 'opsChat.getTodayRevenue': result = { revenue: 0 }; break;
        case 'leadflowJobs.customerProfile': result = null; break;
        case 'leads.getCsConversation': result = args.historyHeld ? history.promise : { messageHistory: '[]' }; break;
        case 'opsChat.getLeadSessionStatuses': {
          const sessionIds = [...(op.input as any).sessionIds];
          const call = statusInputs.length;
          statusInputs.push(sessionIds); activeStatus++; peakStatus = Math.max(peakStatus, activeStatus);
          result = Promise.resolve().then(() => args.status ? args.status(sessionIds, call) : sessionIds.map(id => statusRow(id))).finally(() => { activeStatus--; });
          break;
        }
        default: result = []; break;
      }
    }
    Promise.resolve(result).then(data => { sink.next({ result: { data } }); sink.complete(); }, error => sink.error(error));
    return () => {}; // A deliberately ignored-abort transport, not a live link.
  })] });
  let root: any;
  const tree = () => createElement(args.strict ? StrictMode : Suspense, args.strict ? null : { fallback: 'FULL-PAGE-SUSPEND-FORBIDDEN' }, createElement(QueryClientProvider, { client: c }, createElement(trpc.Provider, { client: rpc, queryClient: c, children: createElement(CommandChatExactLive) })));
  const host = () => root.root;
  const find = (predicate: (node: any) => boolean) => host().findAll((node: any) => typeof node.type === 'string' && predicate(node));
  const rows = () => find(node => (node.props.className ?? '').split(' ').includes('ccc-live-sms-row'));
  const cards = () => find(node => (node.props.className ?? '').split(' ').includes('ccc-live-lead-primary'));
  const count = (path: string, sessionId?: number) => queryRecords.filter(record => record.path === path && (sessionId === undefined || record.input?.sessionId === sessionId)).length;
  return { c, inbox, history, queryRecords, mutationRecords, statusInputs, count, find, cards, rows,
    get root() { return root; }, get peakStatus() { return peakStatus; }, get activeStatus() { return activeStatus; },
    get sse() { return fixture.streams.at(-1).callbacks; },
    async start() { await act(async () => { root = renderer.create(tree()); }); mounted.push(root); },
    async stop() { await act(async () => { root.unmount(); }); mounted.splice(mounted.indexOf(root), 1); },
    async auth(id: number | null) { agent = id === null ? null : { id, name: 'Fresh Synthetic Agent' }; await act(async () => { c.setQueryData(getQueryKey(trpc.agents.me, undefined, 'query'), agent); }); },
  };
}
async function settle(condition: () => boolean) {
  for (let i = 0; i < 400; i++) {
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 2)); });
    if (condition()) return;
  }
  expect(condition()).toBe(true);
}
async function tick(ms = 10) { await act(async () => { await new Promise(resolve => setTimeout(resolve, ms)); }); }
const text = (node: any): string => node.children.map((child: any) => typeof child === 'string' ? child : text(child)).join('');
const click = async (node: any) => { await act(async () => { node.props.onClick({ stopPropagation() {}, preventDefault() {} }); }); };
afterEach(async () => {
  await act(async () => { mounted.splice(0).forEach(root => root.unmount()); });
  clients.splice(0).forEach(c => c.clear());
  expect(fixture.fetch).not.toHaveBeenCalled();
  fixture.streams.length = 0; fixture.storage.clear(); fixture.playSound.mockClear(); fixture.fetch.mockClear();
});

describe('whole actual CommandChatExactLive with real tRPC observers and fake transport', () => {
  it('unauthenticated disables all inbox/status reads while rendering actual login gate', async () => {
    const h = harness({ authenticated: false }); await h.start();
    await settle(() => h.find(n => n.type === 'input' && n.props.type === 'email').length === 1);
    expect(h.count('commandCenter.listCommandChatInbox')).toBe(0);
    expect(h.statusInputs).toEqual([]);
    expect(h.queryRecords.map(r => r.path)).toEqual(['agents.me']);
    expect(fixture.streams.at(-1).options.enabled).toBe(false);
  });
  it('deferred first inbox blocks status start only; usable SMS and all duplicate-mapped cards survive a held serial status sweep', async () => {
    const first = deferred(), middle = deferred();
    const h = harness({ status: (ids, call) => call === 0 ? first.promise : call === 1 ? middle.promise : ids.map(id => statusRow(id)) });
    await h.start(); await settle(() => h.cards().length === 67);
    expect(h.count('commandCenter.listCommandChatInbox')).toBe(1);
    expect(h.statusInputs).toEqual([]);
    expect(h.find(n => n.props['aria-label'] === 'MIB Command workspace')).toHaveLength(1);
    h.inbox.resolve([smsRow()]); await settle(() => h.statusInputs.length === 1);
    expect(h.find(n => n.type === 'button' && typeof n.props.onClick === 'function').length).toBeGreaterThan(0);
    expect(h.find(n => n.props['aria-label'] === 'Text message conversations').map(text).join('')).toContain('Inbox row 2');
    expect(h.cards()).toHaveLength(67);
    expect(h.cards().some(card => text(card).includes('Called'))).toBe(true);
    expect(h.find(n => (n.props.className ?? '').includes('ccc-live-loading'))).toHaveLength(0);
    expect(h.c.getQueryCache().findAll().filter(q => (q.queryKey as any[]).at(-1)?.commandChatLeadStatuses && q.state.data !== undefined)).toHaveLength(0);
    first.resolve(range(50).map(id => statusRow(id))); await settle(() => h.statusInputs.length === 2);
    expect(h.statusInputs.map(ids => ids.length)).toEqual([50,15]);
    expect(h.cards().some(card => (card.props.className ?? '').includes('is-booked'))).toBe(false);
    middle.resolve(range(15,51).map(id => statusRow(id))); await settle(() => h.cards().filter(card => (card.props.className ?? '').includes('is-booked')).length === 33);
    expect(h.statusInputs.flat()).toEqual(range(65)); expect(h.peakStatus).toBe(1);
    const complete: any = h.c.getQueryCache().findAll().find(q => (q.queryKey as any[]).at(-1)?.commandChatLeadStatuses && q.state.data !== undefined)?.state.data;
    expect(complete).toHaveLength(65);
    expect(Object.keys(complete[0]).sort()).toEqual(['id','isBooked','bookedAt','bookedByAgentName','bookedAmount','stage','lostReason'].sort());
    expect(h.cards()).toHaveLength(67); expect(h.cards().some(card => text(card).includes('Called'))).toBe(true);
    const search = h.find(n => n.props['aria-label'] === 'Search SMS conversations')[0];
    await act(async () => search.props.onChange({ target: { value: 'no-match' } }));
    expect(h.find(n => n.props['aria-label'] === 'Text message conversations').map(text).join('')).toContain('No conversations match');
  });
  it.each(['failure','never'] as const)('status %s does not replace or disable the rendered usable inbox', async kind => {
    const held = deferred();
    const h = harness({ status: () => kind === 'never' ? held.promise : Promise.reject(TRPCClientError.from({ error: { code: -32600, message: 'Synthetic BAD_REQUEST', data: { code: 'BAD_REQUEST', httpStatus: 400 } } })) });
    await h.start(); h.inbox.resolve([smsRow()]); await settle(() => h.statusInputs.length === 1); await tick();
    expect(h.find(n => n.props['aria-label'] === 'Text message conversations').map(text).join('')).toContain('Inbox row 2');
    expect(h.cards()).toHaveLength(67); expect(h.find(n => (n.props.className ?? '').includes('ccc-live-loading'))).toHaveLength(0);
    expect(h.statusInputs).toHaveLength(1);
    if (kind === 'failure') expect(h.c.getQueryCache().findAll().some(q => (q.queryKey as any[]).at(-1)?.commandChatLeadStatuses && q.state.status === 'error')).toBe(true);
    await h.stop(); held.resolve([]); await tick(); expect(h.statusInputs).toHaveLength(1);
  });
  it('StrictMode retiring a mounted auth scope suppresses old SSE callbacks and old future chunks while new identity waits for drain', async () => {
    const held = deferred(); const h = harness({ strict: true, status: (ids, call) => call === 0 ? held.promise : ids.map(id => statusRow(id)) });
    await h.start(); h.inbox.resolve([smsRow()]); await settle(() => h.statusInputs.length === 1);
    const oldSSE = h.sse, oldKeys = h.c.getQueryCache().findAll().filter(q => (q.queryKey as any[]).at(-1)?.commandChatLeadStatuses).map(q => q.queryKey);
    await h.auth(70002); await tick(); const counts = h.queryRecords.length;
    await act(async () => { oldSSE.onLeadUpdate(); oldSSE.onLeadAssignment(); oldSSE.onConnected(); oldSSE.onConnected(); }); await tick();
    expect(h.queryRecords).toHaveLength(counts); expect(h.statusInputs).toHaveLength(1);
    held.resolve(range(50).map(id => statusRow(id))); await settle(() => h.statusInputs.length === 3 && h.activeStatus === 0);
    expect(h.statusInputs.map(ids => ids[0])).toEqual([1,1,51]); expect(h.peakStatus).toBe(1);
    for (const key of oldKeys) expect(h.c.getQueryState(key)).toBeUndefined();
    const retiredSSE = h.sse; await h.stop(); const afterStop = h.queryRecords.length;
    await act(async () => { retiredSSE.onLeadUpdate(); retiredSSE.onLeadAssignment(); retiredSSE.onConnected(); retiredSSE.onConnected(); }); await tick(550);
    expect(h.queryRecords).toHaveLength(afterStop);
  });
  it('StrictMode pending sweep unmount drains only its started transport and never issues a retired chunk or SSE refresh', async () => {
    const held = deferred(); const h = harness({ strict: true, status: () => held.promise });
    await h.start(); h.inbox.resolve([smsRow()]); await settle(() => h.statusInputs.length === 1);
    const retiredSSE = h.sse; await act(async () => { retiredSSE.onLeadUpdate(); });
    await h.stop(); const count = h.queryRecords.length;
    held.resolve(range(50).map(id => statusRow(id))); await tick(550);
    retiredSSE.onLeadUpdate(); retiredSSE.onLeadAssignment(); retiredSSE.onConnected(); retiredSSE.onConnected(); await tick();
    expect(h.queryRecords).toHaveLength(count); expect(h.statusInputs).toHaveLength(1);
    expect(h.c.getQueryCache().findAll().filter(q => (q.queryKey as any[]).at(-1)?.commandChatLeadStatuses)).toHaveLength(0);
  });
  it('actual drawer send payload is unchanged and its late refresh cannot resurrect retired selected history', async () => {
    const h = harness({ ids: [1,2], historyHeld: true }); await h.start(); h.inbox.resolve([smsRow(2)]);
    await settle(() => h.find(n => n.props['aria-label'] === 'Text message conversations').map(text).join('').includes('Inbox row 2'));
    const row = h.find(n => n.type === 'button' && (n.props.className ?? '').split(' ').includes('ccc-live-sms-row'))[0];
    expect(row).toBeDefined(); await click(row); await settle(() => h.count('leads.getCsConversation',2) === 1);
    const composer = h.find(n => n.type === 'textarea' && n.props.placeholder === 'Write a text reply…')[0];
    await act(async () => composer.props.onChange({ target: { value: 'Synthetic offline reply' } }));
    await click(h.find(n => n.props['aria-label'] === 'Send text reply')[0]);
    const send = h.mutationRecords.find(r => r.path === 'leads.sendMessage'); expect(send).toBeDefined();
    expect(send.input).toMatchObject({ sessionId: 2, message: 'Synthetic offline reply', source: 'cs_inbox' });
    await click(h.find(n => n.props['aria-label'] === 'Close text conversation')[0]);
    send.pending.resolve({ success: true, duplicate: false }); h.history.resolve({ messageHistory: '[]' }); await tick(550);
    expect(h.count('leads.getCsConversation',2)).toBe(1);
    expect(h.count('commandCenter.listCommandChatInbox')).toBe(2);
  });
  it('unbook pending across same-auth cohort change keeps optimism until the current cohort post-hint follow-up settles', async () => {
    const currentCold = deferred(), currentFresh = deferred();
    const h = harness({ ids: [2], status: (ids, call) => call === 1 ? currentCold.promise : call === 2 ? currentFresh.promise : ids.map(id => statusRow(id)) });
    await h.start(); h.inbox.resolve([smsRow(2)]);
    await settle(() => h.cards().length === 1 && h.cards()[0].props.className.includes('is-booked'));
    await click(h.cards()[0].findAll((n: any) => n.type === 'button' && n.props.className === 'is-booked')[0]);
    const unbook = h.mutationRecords.find(r => r.path === 'opsChat.unbookLead');
    expect(unbook.input).toEqual({ sessionId: 2 });
    await act(async () => { h.c.setQueryData(getQueryKey(trpc.opsChat.listChannelMessages, { channel: 'command' }, 'query'), [message(1,2), message(2,3)]); });
    await settle(() => h.statusInputs.length === 2);
    unbook.pending.resolve({ success: true }); await tick();
    expect(h.statusInputs).toEqual([[2],[2,3]]);
    currentCold.resolve([statusRow(2,true), statusRow(3,false)]);
    await settle(() => h.statusInputs.length === 3);
    await tick();
    const target = () => h.cards().find(card => text(card).includes('Synthetic Lead 1'));
    expect(target().props.className.includes('is-booked')).toBe(false);
    expect(h.statusInputs).toEqual([[2],[2,3],[2,3]]);
    expect(h.peakStatus).toBe(1);
    currentFresh.resolve([statusRow(2,false), statusRow(3,false)]);
    await settle(() => h.activeStatus === 0 && h.find(n => n.props.role === 'status').map(text).join('').includes('was unbooked'));
    expect(target().props.className.includes('is-booked')).toBe(false);
  });
});
