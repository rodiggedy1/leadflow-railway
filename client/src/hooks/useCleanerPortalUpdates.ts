import { useEffect, useRef } from "react";

type CleanerPortalUpdateCallbacks = {
  onJobsChanged?: () => void;
};

const MIN_RETRY_MS = 5_000;
const MAX_RETRY_MS = 60_000;

/**
 * Maintains the Cleaner Portal's dedicated, cookie-authenticated SSE connection.
 * The stream contains only a generic jobs-changed hint. A reconnect invokes the
 * same callback once to catch an update that may have occurred while disconnected.
 */
export function useCleanerPortalUpdates(
  callbacks: CleanerPortalUpdateCallbacks,
  options?: { enabled?: boolean },
): void {
  const callbacksRef = useRef(callbacks);
  callbacksRef.current = callbacks;
  const connectedOnceRef = useRef(false);
  const enabled = options?.enabled ?? true;

  useEffect(() => {
    if (!enabled) {
      connectedOnceRef.current = false;
      return;
    }
    if (typeof EventSource === "undefined") return;

    let stream: EventSource | null = null;
    let retryDelay = MIN_RETRY_MS;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;

    const connect = () => {
      if (disposed) return;
      stream = new EventSource("/api/cleaner-portal-stream", { withCredentials: true });

      stream.addEventListener("connected", () => {
        retryDelay = MIN_RETRY_MS;
        if (connectedOnceRef.current) callbacksRef.current.onJobsChanged?.();
        connectedOnceRef.current = true;
      });

      stream.addEventListener("cleaner_portal_update", (event: MessageEvent) => {
        try {
          const update = JSON.parse(event.data) as { type?: string };
          if (update.type === "jobs_changed") callbacksRef.current.onJobsChanged?.();
        } catch {
          // Ignore malformed refresh hints. The next valid update or reconnect re-syncs.
        }
      });

      stream.onerror = () => {
        stream?.close();
        stream = null;
        if (disposed) return;
        const jitter = retryDelay * 0.2 * (Math.random() * 2 - 1);
        const delay = Math.round(retryDelay + jitter);
        retryTimer = setTimeout(() => {
          retryDelay = Math.min(retryDelay * 2, MAX_RETRY_MS);
          connect();
        }, delay);
      };
    };

    connect();
    return () => {
      disposed = true;
      if (retryTimer) clearTimeout(retryTimer);
      stream?.close();
    };
  }, [enabled]);
}
