/**
 * usePollingInstrumentation
 *
 * Lightweight dev/preview instrumentation that tracks:
 * - Total requests fired during a session window
 * - Requests per minute per endpoint
 * - Active polling interval count
 * - React Query observer count per polled query key
 *
 * Usage: import and call once in App.tsx (or any top-level component).
 * Exposes window.__pollingStats for inspection in the browser console.
 *
 * Enabled only when VITE_POLLING_INSTRUMENTATION=true is set.
 */
import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";

interface EndpointStats {
  count: number;
  totalMs: number;
  lastFiredAt: number;
}

interface PollingStats {
  sessionStart: number;
  totalRequests: number;
  byEndpoint: Record<string, EndpointStats>;
  observerCounts: Record<string, number>;
  activeIntervals: number;
  report: () => void;
}

declare global {
  interface Window {
    __pollingStats?: PollingStats;
  }
}

const ENABLED = import.meta.env.VITE_POLLING_INSTRUMENTATION === "true";

export function usePollingInstrumentation() {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!ENABLED) return;

    const stats: PollingStats = {
      sessionStart: Date.now(),
      totalRequests: 0,
      byEndpoint: {},
      observerCounts: {},
      activeIntervals: 0,
      report() {
        const elapsed = (Date.now() - stats.sessionStart) / 1000;
        const rpmByEndpoint: Record<string, number> = {};
        let totalRpm = 0;

        for (const [key, ep] of Object.entries(stats.byEndpoint)) {
          const rpm = (ep.count / elapsed) * 60;
          rpmByEndpoint[key] = Math.round(rpm * 10) / 10;
          totalRpm += rpm;
        }

        console.group("📊 Polling Instrumentation Report");
        console.log(`Session duration: ${Math.round(elapsed)}s`);
        console.log(`Total requests: ${stats.totalRequests}`);
        console.log(`Total req/min: ${Math.round(totalRpm * 10) / 10}`);
        console.log("");
        console.log("Requests per endpoint (req/min):");
        const sorted = Object.entries(rpmByEndpoint).sort((a, b) => b[1] - a[1]);
        for (const [key, rpm] of sorted) {
          const ep = stats.byEndpoint[key];
          const avgMs = ep.count > 0 ? Math.round(ep.totalMs / ep.count) : 0;
          console.log(`  ${key}: ${rpm} req/min (${ep.count} total, avg ${avgMs}ms)`);
        }
        console.log("");
        console.log("React Query observer counts:");
        const cache = queryClient.getQueryCache();
        const queries = cache.getAll();
        const observerMap: Record<string, number> = {};
        for (const q of queries) {
          const key = JSON.stringify(q.queryKey);
          const observers = q.getObserversCount();
          if (observers > 0) {
            observerMap[key] = observers;
          }
        }
        const sortedObs = Object.entries(observerMap).sort((a, b) => b[1] - a[1]);
        for (const [key, count] of sortedObs) {
          console.log(`  ${key}: ${count} observer${count > 1 ? "s ⚠️" : ""}`);
        }
        console.groupEnd();
      },
    };

    window.__pollingStats = stats;

    // Intercept fetch to track requests
    const origFetch = window.fetch;
    window.fetch = async function (input, init) {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      const isTrpc = url.includes("/api/trpc");

      const start = Date.now();
      const result = await origFetch(input, init);
      const elapsed = Date.now() - start;

      if (isTrpc) {
        // Extract endpoint names from tRPC batch URL or body
        const urlStr = url.split("?")[0];
        const pathPart = urlStr.split("/api/trpc/")[1] ?? urlStr;
        const endpoints = pathPart.split(",").map((e) => e.split("?")[0].trim()).filter(Boolean);

        for (const ep of endpoints) {
          stats.totalRequests++;
          if (!stats.byEndpoint[ep]) {
            stats.byEndpoint[ep] = { count: 0, totalMs: 0, lastFiredAt: 0 };
          }
          stats.byEndpoint[ep].count++;
          stats.byEndpoint[ep].totalMs += elapsed;
          stats.byEndpoint[ep].lastFiredAt = Date.now();
        }
      }

      return result;
    };

    // Auto-report every 60s
    const interval = setInterval(() => {
      if (window.__pollingStats) {
        console.log(`[PollingInstrumentation] Auto-report at ${Math.round((Date.now() - stats.sessionStart) / 1000)}s`);
        window.__pollingStats.report();
      }
    }, 60_000);

    console.log("[PollingInstrumentation] Active. Run window.__pollingStats.report() in console to see stats.");

    return () => {
      window.fetch = origFetch;
      clearInterval(interval);
      delete window.__pollingStats;
    };
  }, [queryClient]);
}
