/**
 * DB Watchdog — Phase 1A2
 *
 * Monitors database health and sends SIGTERM when the server is clearly
 * unable to recover on its own. Railway auto-restarts the process,
 * turning a multi-hour degradation into a seconds-long one.
 *
 * Five independent signals:
 *   Signal 1: Dedicated SELECT 1 probe — 3 consecutive failures → SIGTERM
 *   Signal 2: Probe gap — no successful probe for 5 minutes → SIGTERM
 *   Signal 3: Sustained pool exhaustion — requires ALL of:
 *               • 10+ QUEUE_LIMIT failures in the last 60 seconds
 *               • pool_free === 0
 *               • pool_queue >= 80% of configured queueLimit
 *               • condition persists for 3 consecutive watchdog checks
 *             Historical failures alone cannot trigger exit.
 *             Pool metrics unavailable → fail safe (skip check, reset counter).
 *   Signal 4: Event-loop lag tier 1 — single stall > 10s → immediate SIGTERM
 *   Signal 5: Event-loop lag tier 2 — p99 > 2s sustained for 60s → SIGTERM
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

const PROBE_INTERVAL_MS          = 30_000;       // Run SELECT 1 every 30s
const PROBE_CONSECUTIVE_FAIL_MAX = 3;            // Exit after 3 consecutive probe failures
const PROBE_GAP_MAX_MS           = 5 * 60_000;  // Exit if no successful probe for 5 min

// Signal 3: compound pool-exhaustion check
// Must match the queueLimit configured in db.ts (currently 50).
const POOL_QUEUE_LIMIT           = 50;
// Failures must be recent — 10-minute window replaced with 60-second window.
const RECENT_FAIL_WINDOW_MS      = 60_000;
// Minimum recent failures required (in the 60s window) to consider the process unhealthy.
const RECENT_FAIL_THRESHOLD      = 10;
// pool_queue must be at or above this fraction of POOL_QUEUE_LIMIT.
// Math.ceil so the threshold rounds up if the limit changes to an odd number.
const QUEUE_UNHEALTHY_RATIO      = 0.8;
// Number of consecutive watchdog intervals the compound condition must hold before SIGTERM.
const CONSECUTIVE_CHECKS_REQUIRED = 3;

const EL_SAMPLE_INTERVAL_MS      = 10_000;  // Sample event-loop lag every 10s
const EL_CATASTROPHIC_LAG_MS     = 10_000;  // Tier 1: single stall > 10s → immediate exit
const EL_SUSTAINED_LAG_MS        = 2_000;   // Tier 2: p99 > 2s
const EL_SUSTAINED_DURATION_MS   = 60_000;  // Tier 2: sustained for 60s → exit

// ── State ─────────────────────────────────────────────────────────────────────

let watchdogStarted     = false;
let terminationRequested = false;

// ── Helpers ───────────────────────────────────────────────────────────────────

function gracefulExit(reason: string, extra?: Record<string, unknown>): void {
  if (terminationRequested) return;
  terminationRequested = true;
  if (extra) {
    console.error(`[DB Watchdog] EXIT — ${reason}`, extra);
  } else {
    console.error(`[DB Watchdog] EXIT — ${reason}`);
  }
  process.kill(process.pid, "SIGTERM");
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
        gracefulExit(
          `Signal 1 — ${consecutiveProbeFailures} consecutive probe failures ` +
          `(last error: ${err?.code ?? err?.message})`
        );
      }

      // Signal 2: time since last successful probe
      const gapMs = Date.now() - lastSuccessfulProbeAt;
      if (gapMs >= PROBE_GAP_MAX_MS) {
        gracefulExit(
          `Signal 2 — no successful DB probe for ${Math.round(gapMs / 1000)}s`
        );
      }
    }
  };

  // Run immediately, then on interval
  runProbe().catch(console.error);
  setInterval(() => { runProbe().catch(console.error); }, PROBE_INTERVAL_MS);

  // ── Signal 3: Sustained pool exhaustion ────────────────────────────────────
  //
  // Requires ALL of the following on every check:
  //   1. 10+ QUEUE_LIMIT failures in the last 60 seconds
  //   2. pool_free === 0 (no connections available)
  //   3. pool_queue >= 80% of POOL_QUEUE_LIMIT
  //
  // The condition must hold for CONSECUTIVE_CHECKS_REQUIRED intervals (90s at
  // 30s probe interval) before SIGTERM is sent. A single healthy check resets
  // the counter. If pool metrics are unavailable, the check is skipped and the
  // counter is reset (fail safe — do not assume unhealthy).

  const queueThreshold = Math.ceil(POOL_QUEUE_LIMIT * QUEUE_UNHEALTHY_RATIO);
  let consecutiveUnhealthyChecks = 0;

  const checkAcquisitionFailures = () => {
    const pool = getPool();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const corePool = (pool as any)?.pool;

    const poolFree  = corePool?._freeConnections?.length  as number | undefined;
    const poolQueue = corePool?._connectionQueue?.length  as number | undefined;
    const poolAll   = corePool?._allConnections?.length   as number | undefined;

    // Fail safe: if metrics are unavailable, skip this check and reset counter
    if (poolFree === undefined || poolQueue === undefined) {
      if (pool) {
        // Pool exists but metrics unavailable — unexpected, log a warning
        console.warn("[DB Watchdog] Pool metrics unavailable — skipping Signal 3 check");
      }
      consecutiveUnhealthyChecks = 0;
      return;
    }

    const cutoff         = Date.now() - RECENT_FAIL_WINDOW_MS;
    const recentFailures = dbAcquisitionFailures.filter(f => f.ts >= cutoff);

    const unhealthy =
      recentFailures.length >= RECENT_FAIL_THRESHOLD &&
      poolFree === 0 &&
      poolQueue >= queueThreshold;

    if (unhealthy) {
      consecutiveUnhealthyChecks++;
      console.warn("[DB Watchdog] Signal 3 unhealthy check", {
        consecutive:        consecutiveUnhealthyChecks,
        required:           CONSECUTIVE_CHECKS_REQUIRED,
        failures_last_60s:  recentFailures.length,
        pool_all:           poolAll,
        pool_free:          poolFree,
        pool_queue:         poolQueue,
        queue_threshold:    queueThreshold,
        queue_limit:        POOL_QUEUE_LIMIT,
      });

      if (consecutiveUnhealthyChecks >= CONSECUTIVE_CHECKS_REQUIRED) {
        gracefulExit("Signal 3 — sustained pool exhaustion", {
          pool_all:                    poolAll,
          pool_free:                   poolFree,
          pool_queue:                  poolQueue,
          failures_last_60s:           recentFailures.length,
          consecutive_unhealthy_checks: consecutiveUnhealthyChecks,
          queue_limit:                 POOL_QUEUE_LIMIT,
          queue_threshold:             queueThreshold,
        });
      }
    } else {
      if (consecutiveUnhealthyChecks > 0) {
        console.log("[DB Watchdog] Pool recovered — resetting Signal 3 counter", {
          pool_free:         poolFree,
          pool_queue:        poolQueue,
          failures_last_60s: recentFailures.length,
        });
      }
      consecutiveUnhealthyChecks = 0;
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
      gracefulExit(
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
          gracefulExit(
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
