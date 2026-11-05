import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createLeadListRefreshCoordinator } from "../client/src/lib/leadListRefreshCoordinator";

const queryKey = [
  ["commandCenter", "listIncomingLeads"],
  { type: "query" },
] as const;
type Lead = { id: number; phone: string };
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
async function flush() {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}
const cleanups: (() => void)[] = [];

function setup(initial = true, enabled = true) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  const requests: ReturnType<typeof deferred<Lead[]>>[] = [];
  const aborted = vi.fn();
  const queryFn = vi.fn(({ signal }: { signal: AbortSignal }) => {
    signal.addEventListener("abort", aborted);
    const request = deferred<Lead[]>();
    requests.push(request);
    return request.promise;
  });
  const observer = new QueryObserver(client, {
    queryKey,
    queryFn,
    enabled,
    staleTime: Infinity,
    ...(initial ? { initialData: [] as Lead[] } : {}),
  });
  const stop = observer.subscribe(() => {});
  const refresh = vi.fn(() =>
    client.invalidateQueries(
      { queryKey, exact: true },
      { cancelRefetch: false }
    )
  );
  const create = () =>
    createLeadListRefreshCoordinator({
      queryClient: client,
      queryKey,
      refresh,
    });
  const coordinator = create();
  cleanups.push(() => {
    coordinator.dispose();
    stop();
    client.clear();
  });
  return {
    client,
    observer,
    queryFn,
    requests,
    aborted,
    refresh,
    coordinator,
    create,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
});
afterEach(() => {
  cleanups.splice(0).forEach(cleanup => cleanup());
  vi.useRealTimers();
});

describe("incoming-lead refresh coordinator (real TanStack cache, no network)", () => {
  it("starts the leading event synchronously, keeps one fetch, and coalesces a burst into one dirty follow-up", async () => {
    const h = setup();
    h.coordinator.request();
    expect(h.queryFn).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 20; i++) h.coordinator.request();
    expect(h.queryFn).toHaveBeenCalledTimes(1);
    h.requests[0].resolve([]);
    await flush();
    await vi.advanceTimersByTimeAsync(499);
    expect(h.queryFn).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(h.queryFn).toHaveBeenCalledTimes(2);
    h.requests[1].resolve([{ id: 1, phone: "new" }]);
    await flush();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(h.client.getQueryData(queryKey)).toEqual([{ id: 1, phone: "new" }]);
    expect(h.queryFn).toHaveBeenCalledTimes(2);
    expect(h.aborted).not.toHaveBeenCalled();
  });

  it("uses a fixed window under continuous events rather than indefinitely trailing-debouncing", async () => {
    const h = setup();
    h.coordinator.request();
    h.requests[0].resolve([]);
    await flush();
    for (let i = 0; i < 4; i++) {
      await vi.advanceTimersByTimeAsync(100);
      h.coordinator.request();
    }
    await vi.advanceTimersByTimeAsync(100);
    expect(h.queryFn).toHaveBeenCalledTimes(2);
    h.requests[1].resolve([]);
    await flush();
    for (let i = 0; i < 4; i++) {
      await vi.advanceTimersByTimeAsync(100);
      h.coordinator.request();
    }
    await vi.advanceTimersByTimeAsync(100);
    expect(h.queryFn).toHaveBeenCalledTimes(3);
  });

  it.each(["initial", "poll"] as const)(
    "queues a fresh new-lead query after an already-running %s query",
    async kind => {
      const h = setup(kind !== "initial");
      if (kind === "poll") void h.observer.refetch();
      expect(h.queryFn).toHaveBeenCalledTimes(1);
      h.coordinator.request();
      h.coordinator.request();
      expect(h.queryFn).toHaveBeenCalledTimes(1);
      expect(h.refresh).not.toHaveBeenCalled();
      h.requests[0].resolve([]); // SQL result from before the incoming event.
      await flush();
      expect(h.queryFn).toHaveBeenCalledTimes(2);
      expect(h.aborted).not.toHaveBeenCalled();
      h.requests[1].resolve([{ id: 2, phone: "incoming" }]);
      await flush();
      expect(h.client.getQueryData(queryKey)).toEqual([
        { id: 2, phone: "incoming" },
      ]);
      await vi.advanceTimersByTimeAsync(1_000);
      expect(h.queryFn).toHaveBeenCalledTimes(2);
    }
  );

  it("cancelRefetch:false deduplicates an existing cached-null request without cancelling it", async () => {
    const h = setup();
    h.client.setQueryData(queryKey, null);
    const oldFetch = h.observer.refetch({ cancelRefetch: false });
    const invalidation = h.refresh();
    expect(h.queryFn).toHaveBeenCalledTimes(1);
    expect(h.aborted).not.toHaveBeenCalled();
    h.coordinator.request();
    h.requests[0].resolve([]);
    await oldFetch;
    await invalidation;
    await flush();
    expect(h.queryFn).toHaveBeenCalledTimes(2);
    h.requests[1].resolve([{ id: 3, phone: "after-null" }]);
    await flush();
    expect(h.client.getQueryData(queryKey)).toEqual([
      { id: 3, phone: "after-null" },
    ]);
    expect(h.aborted).not.toHaveBeenCalled();
  });

  it("releases a failed fetch, keeps existing data/error, and handles the dirty follow-up without looping", async () => {
    const h = setup();
    h.coordinator.request();
    h.coordinator.request();
    h.requests[0].reject(new Error("temporary failure"));
    await flush();
    expect(h.client.getQueryData(queryKey)).toEqual([]);
    expect(h.client.getQueryState(queryKey)?.error?.message).toBe(
      "temporary failure"
    );
    await vi.advanceTimersByTimeAsync(500);
    expect(h.queryFn).toHaveBeenCalledTimes(2);
    h.requests[1].reject(new Error("still failed"));
    await flush();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(h.queryFn).toHaveBeenCalledTimes(2);
    h.coordinator.request();
    expect(h.queryFn).toHaveBeenCalledTimes(3);
  });

  it("local edit reconciles immediately through the same slot and merges a simultaneous SSE hint", async () => {
    const h = setup();
    h.coordinator.request();
    h.requests[0].resolve([]);
    await flush();
    await vi.advanceTimersByTimeAsync(100);
    h.coordinator.request({ immediate: true });
    expect(h.queryFn).toHaveBeenCalledTimes(2); // bypasses only the cooldown, not the in-flight slot.
    h.coordinator.request();
    h.coordinator.request({ immediate: true });
    expect(h.queryFn).toHaveBeenCalledTimes(2);
    h.requests[1].resolve([]);
    await flush();
    expect(h.queryFn).toHaveBeenCalledTimes(3);
    h.requests[2].resolve([{ id: 4, phone: "edited" }]);
    await flush();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(h.queryFn).toHaveBeenCalledTimes(3);
    expect(h.aborted).not.toHaveBeenCalled();
  });

  it("cleans pending timers on disposal and never cancels or follows up an existing request", async () => {
    const h = setup();
    h.coordinator.request();
    h.coordinator.request();
    h.requests[0].resolve([]);
    await flush();
    expect(vi.getTimerCount()).toBe(1);
    h.coordinator.dispose();
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(1_000);
    h.coordinator.request();
    expect(h.queryFn).toHaveBeenCalledTimes(1);
    const next = h.create();
    cleanups.push(() => next.dispose());
    next.request();
    next.request();
    next.dispose();
    h.requests[1].resolve([]);
    await flush();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(h.queryFn).toHaveBeenCalledTimes(2);
    expect(h.aborted).not.toHaveBeenCalled();
  });

  it("disabled initial query stays unfetched; disable/re-enable gets a clean coordinator", async () => {
    const h = setup(false, false);
    expect(h.queryFn).not.toHaveBeenCalled();
    h.coordinator.dispose();
    h.coordinator.request();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(h.queryFn).not.toHaveBeenCalled();
    h.observer.setOptions({ ...h.observer.options, enabled: true });
    const next = h.create();
    cleanups.push(() => next.dispose());
    next.request();
    expect(h.queryFn).toHaveBeenCalledTimes(1);
    h.requests[0].resolve([]);
    await flush();
    expect(h.queryFn).toHaveBeenCalledTimes(2);
    h.requests[1].resolve([{ id: 5, phone: "enabled" }]);
    await flush();
    expect(h.client.getQueryData(queryKey)).toEqual([
      { id: 5, phone: "enabled" },
    ]);
  });

  it("does not drain for unrelated queries and introduces no unauthorised connected callback or changed polling", async () => {
    const h = setup();
    void h.observer.refetch();
    h.coordinator.request();
    await h.client.fetchQuery({
      queryKey: ["unrelated"],
      queryFn: async () => "value",
    });
    expect(h.refresh).not.toHaveBeenCalled();
    const page = readFileSync(
      resolve(import.meta.dirname, "../client/src/pages/LeadsCRMExactLive.tsx"),
      "utf8"
    );
    expect(page).toContain(
      "enabled: authenticated, refetchInterval: 30_000, refetchIntervalInBackground: false"
    );
    expect(page).toContain("[authenticated, queryClient]");
    expect(page).toContain("cancelRefetch: false");
    expect(page).toContain(
      "setDetailLead((current) => current ? { ...current, ...changes } : current)"
    );
    expect(page).not.toContain("onConnected:");
    const helper = readFileSync(
      resolve(
        import.meta.dirname,
        "../client/src/lib/leadListRefreshCoordinator.ts"
      ),
      "utf8"
    );
    for (const text of [page, helper]) {
      expect(text).not.toContain(["cleaner", "Jobs"].join(""));
      expect(text).not.toContain(["cleaner", "_jobs"].join(""));
    }
  });
});
