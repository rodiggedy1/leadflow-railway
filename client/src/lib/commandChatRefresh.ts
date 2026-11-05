import { hashKey, type QueryClient, type QueryKey } from "@tanstack/react-query";
import { createLeadListRefreshCoordinator } from "./leadListRefreshCoordinator";

/** Completion means invalidation settled, not that a fresh read succeeded. */
export function createCommandChatRefreshEntry(
  queryClient: QueryClient,
  queryKey: QueryKey
) {
  type Waiter = { resolve: () => void; reject: (error: unknown) => void };
  let disposed = false;
  const outstanding = new Set<Waiter>();
  let pending: Waiter[] = [];
  const coordinator = createLeadListRefreshCoordinator({
    queryClient,
    queryKey,
    refresh: () => {
      // A hint during an older poll or refresh belongs to the next refresh,
      // never to the request already in progress when the hint arrived.
      const thisRefresh = pending.splice(0);
      const settle = (failed: boolean, error?: unknown) => {
        for (const waiter of thisRefresh) {
          if (!outstanding.delete(waiter)) continue;
          if (failed) waiter.reject(error);
          else waiter.resolve();
        }
      };
      try {
        return queryClient
          .invalidateQueries(
            { queryKey, exact: true },
            { cancelRefetch: false }
          )
          .then(
            () => settle(false),
            error => {
              settle(true, error);
              throw error;
            }
          );
      } catch (error) {
        settle(true, error);
        throw error;
      }
    },
  });

  return {
    request(immediate = false): void {
      if (!disposed) coordinator.request({ immediate });
    },
    reconcile(): Promise<void> {
      if (disposed) return Promise.resolve();
      return new Promise<void>((resolve, reject) => {
        const waiter = { resolve, reject };
        outstanding.add(waiter);
        pending.push(waiter);
        coordinator.request({ immediate: true });
      });
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      coordinator.dispose();
      // Retirement releases fences but cannot assert success or cancel work
      // owned by the query. The page still owns its guarded action cleanup.
      for (const waiter of Array.from(outstanding)) waiter.resolve();
      outstanding.clear();
      pending = [];
    },
  };
}

/** One page owner per QueryClient/auth lifecycle; the page supplies exact keys. */
export function createCommandChatRefreshManager(queryClient: QueryClient) {
  const entries = new Map<
    string,
    ReturnType<typeof createCommandChatRefreshEntry>
  >();
  let disposed = false;
  let connectedOnce = false;

  return {
    /** Registration only: preserve equal keys and retire obsolete selections. */
    sync(activeKeys: readonly QueryKey[]): void {
      if (disposed) return;
      const active = new Map(activeKeys.map(key => [hashKey(key), key]));
      for (const [hash, entry] of Array.from(entries)) {
        if (active.has(hash)) continue;
        entry.dispose();
        entries.delete(hash);
      }
      for (const [hash, key] of Array.from(active)) {
        if (!entries.has(hash)) {
          entries.set(hash, createCommandChatRefreshEntry(queryClient, key));
        }
      }
    },
    request(key: QueryKey, immediate = false): void {
      if (!disposed) entries.get(hashKey(key))?.request(immediate);
    },
    reconcile(key: QueryKey): Promise<void> {
      if (disposed) return Promise.resolve();
      return entries.get(hashKey(key))?.reconcile() ?? Promise.resolve();
    },
    /** The first connection is silent; later connections recover current keys. */
    reconnect(): void {
      if (disposed) return;
      if (!connectedOnce) {
        connectedOnce = true;
        return;
      }
      for (const entry of Array.from(entries.values())) entry.request(true);
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      for (const entry of Array.from(entries.values())) entry.dispose();
      entries.clear();
    },
  };
}
