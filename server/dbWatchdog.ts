/**
 * DB Watchdog — Phase 1A1
 *
 * Monitors database health and calls process.exit(1) when the server is
 * clearly unable to recover on its own. Railway auto-restarts the process,
 * turning a multi-hour degradation into a seconds-long one.
 *
 * Five independent signals:
 *   Signal 1: Dedicated SELECT 1 probe — 3 consecutive failures → exit
 *   Signal 2: Probe gap — no successful probe for 5 minutes → exit
 *   Signal 3: Acquisition failures — 5+ restart-worthy failures in 10 min → exit
 *   Signal 4: Event-loop lag tier 1 — single stall > 10s → immediate exit
 *   Signal 5: Event-loop lag tier 2 — p99 > 2s sustained for 60s → exit
 *
 * Lifecycle:
 *   - Started by index.ts after server.listen() in the non-preview path
 *   - Calls getPool() dynamically on each tick (survives resetDb() if ever called)
 *   - Singleton guard: startDbWatchdog() is a no-op if already started
 *
 * Known gap (Signal 3):
 *   PROTOCOL_CONNECTION_LOST fires during query execution after successful
 *   acquisition and is NOT captured by the getConnection wrapper in db.ts.
 *   Signal 3 therefore undercounts errors that occur post-acquisition.
 *   Signals 1 and 2 provide coverage for sustained DB unavailability regardless.
 */

import { monitorEventLoopDelay } from "perf_hooks";
import { getPool, dbAcquisitionFailures } from "./db";

// ── Configuration ─────────────────────────────────────────────────────────────

const PROBE_INTERVAL_MS          = 30_000;  // Run SELECT 1 every 30s
const PROBE_CONSECUTIVE_FAIL_MAX = 3;       // Exit after 3 consecutive probe failures
const PROBE_GAP_MAX_MS           = 5 * 60_000; // Exit if no successful probe for 5 min

const ACQUISITION_FAIL_WINDOW_MS = 10 * 60_000; // 10-minute rolling window
const ACQUISITION_FAIL_MAX       = 5;           // Exit if 5+ failures in window

const EL_SAMPLE_INTERVAL_MS      = 10_000;  // Sample event-loop lag every 10s
const EL_CATASTROPHIC_LAG_MS     = 10_000;  // Tier 1: single stall > 10s → immediate exit
const EL_SUSTAINED_LAG_MS        = 2_000;   // Tier 2: p99 > 2s
const EL_SUSTAINED_DURATION_MS   = 60_000;  // Tier 2: sustained for 60s → exit

// ── State ─────────────────────────────────────────────────────────────────────

let watchdogStarted = false;

// ── Helpers ───────────────────────────────────────────────────────────────────

function exitWithReason(reason: string): never {
  console.error(`[DB Watchdog] EXIT — ${reason}`);
  process.exit(1);
}

// ── Watchdog entry point ──────────────────────────────────────────────────────

export function startDbWatchdog(): void {
  if (watchdogStarted) {
    console.warn("[DB Watchdog] Already started — ignoring duplicate call");
    return;
  }
  watchdogStarted = true;
  console.log("[DB Watchdog] Started");

  // ── Signal 1 + 2: Dedicated probe ──────────────────────────────────────────

  let consecutiveProbeFailures = 0;
  let lastSuccessfulProbeAt    = Date.now();

  const runProbe = async () => {
    const pool = getPool();
    if (!pool) {
      // Pool not yet initialized — not a failure, just early startup
      return;
    }
    try {
      await pool.query("SELECT 1");
      consecutiveProbeFailures = 0;
      lastSuccessfulProbeAt    = Date.now();
    } catch (err: any) {
      consecutiveProbeFailures++;
      console.error("[DB Watchdog] Probe failed", {
        attempt:    consecutiveProbeFailures,
        error_code: err?.code ?? "UNKNOWN",
        message:    err?.message,
      });

      // Signal 1: consecutive probe failures
      if (consecutiveProbeFailures >= PROBE_CONSECUTIVE_FAIL_MAX) {
        exitWithReason(
          `Signal 1 — ${consecutiveProbeFailures} consecutive probe failures ` +
          `(last error: ${err?.code ?? err?.message})`
        );
      }

      // Signal 2: time since last successful probe
      const gapMs = Date.now() - lastSuccessfulProbeAt;
      if (gapMs >= PROBE_GAP_MAX_MS) {
        exitWithReason(
          `Signal 2 — no successful DB probe for ${Math.round(gapMs / 1000)}s`
        );
      }
    }
  };

  // Run immediately, then on interval
  runProbe().catch(console.error);
  setInterval(() => { runProbe().catch(console.error); }, PROBE_INTERVAL_MS);

  // ── Signal 3: Acquisition failures ─────────────────────────────────────────
  // dbAcquisitionFailures is maintained by db.ts and bounded independently.
  // We check it on the same interval as the probe.

  const checkAcquisitionFailures = () => {
    const cutoff = Date.now() - ACQUISITION_FAIL_WINDOW_MS;
    const recentFailures = dbAcquisitionFailures.filter(f => f.ts >= cutoff);
    if (recentFailures.length >= ACQUISITION_FAIL_MAX) {
      exitWithReason(
        `Signal 3 — ${recentFailures.length} restart-worthy acquisition failures ` +
        `in the last ${ACQUISITION_FAIL_WINDOW_MS / 60_000} minutes ` +
        `(codes: ${[...new Set(recentFailures.map(f => f.code))].join(", ")})`
      );
    }
  };

  setInterval(checkAcquisitionFailures, PROBE_INTERVAL_MS);

  // ── Signals 4 + 5: Event-loop lag ──────────────────────────────────────────

  const h = monitorEventLoopDelay({ resolution: 20 });
  h.enable();

  let sustainedLagSince: number | null = null;

  setInterval(() => {
    const maxLagMs  = h.max  / 1e6; // nanoseconds → milliseconds
    const p99LagMs  = h.percentile(99) / 1e6;
    h.reset();

    // Signal 4: single catastrophic stall
    if (maxLagMs > EL_CATASTROPHIC_LAG_MS) {
      exitWithReason(
        `Signal 4 — catastrophic event-loop stall: max=${Math.round(maxLagMs)}ms ` +
        `(threshold: ${EL_CATASTROPHIC_LAG_MS}ms)`
      );
    }

    // Signal 5: sustained elevated lag
    const lagMetric = Math.max(maxLagMs, p99LagMs);
    if (lagMetric > EL_SUSTAINED_LAG_MS) {
      if (sustainedLagSince === null) {
        sustainedLagSince = Date.now();
        console.warn("[DB Watchdog] Elevated event-loop lag detected", {
          max_ms: Math.round(maxLagMs),
          p99_ms: Math.round(p99LagMs),
        });
      } else {
        const sustainedMs = Date.now() - sustainedLagSince;
        if (sustainedMs >= EL_SUSTAINED_DURATION_MS) {
          exitWithReason(
            `Signal 5 — sustained event-loop lag for ${Math.round(sustainedMs / 1000)}s: ` +
            `max=${Math.round(maxLagMs)}ms, p99=${Math.round(p99LagMs)}ms ` +
            `(threshold: p99 > ${EL_SUSTAINED_LAG_MS}ms for ${EL_SUSTAINED_DURATION_MS / 1000}s)`
          );
        }
      }
    } else {
      sustainedLagSince = null;
    }
  }, EL_SAMPLE_INTERVAL_MS);
}
