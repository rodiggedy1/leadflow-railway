import type { QueryClient, QueryKey } from "@tanstack/react-query";

/** Coalesce list refresh hints without cancelling a fetch or delaying the first hint. */
export function createLeadListRefreshCoordinator({
  queryClient,
  queryKey,
  refresh,
  cooldownMs = 500,
}: {
  queryClient: QueryClient;
  queryKey: QueryKey;
  refresh: () => Promise<unknown>;
  cooldownMs?: number;
}) {
  let disposed = false;
  let dirty = false;
  let immediate = false;
  let inFlight = false;
  let lastStartedAt = -Infinity;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const query = () =>
    queryClient.getQueryCache().find({ queryKey, exact: true });

  function clearTimer() {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  }

  function settled() {
    inFlight = false;
    if (!disposed) drain();
  }

  function drain() {
    if (
      disposed ||
      !dirty ||
      inFlight ||
      (query()?.state.fetchStatus ?? "idle") !== "idle"
    )
      return;
    const wait = immediate
      ? 0
      : Math.max(0, lastStartedAt + cooldownMs - Date.now());
    if (wait > 0) {
      // Fixed leading-edge window, not a trailing debounce: later hints cannot postpone it.
      if (timer === undefined)
        timer = setTimeout(() => {
          timer = undefined;
          drain();
        }, wait);
      return;
    }
    clearTimer();
    dirty = false;
    immediate = false;
    inFlight = true;
    lastStartedAt = Date.now();
    try {
      // Both success and failure release the slot; only a new hint schedules another refresh.
      void Promise.resolve(refresh()).then(settled, settled);
    } catch {
      settled();
    }
  }

  const unsubscribe = queryClient.getQueryCache().subscribe(event => {
    if (
      event.type === "updated" &&
      event.query === query() &&
      event.query.state.fetchStatus === "idle"
    ) {
      // A poll/initial fetch that began before a hint is not assumed to include that change.
      drain();
    }
  });

  return {
    request(options?: { immediate?: boolean }) {
      if (disposed) return;
      dirty = true;
      immediate ||= options?.immediate ?? false;
      drain();
    },
    dispose() {
      disposed = true;
      dirty = false;
      immediate = false;
      clearTimer();
      unsubscribe();
      // The existing query owns its request; disable/unmount must not cancel it here.
    },
  };
}
