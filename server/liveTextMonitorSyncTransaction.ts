import { performance } from "node:perf_hooks";
import { sql } from "drizzle-orm";
import { drizzle, type MySql2Database } from "drizzle-orm/mysql2";
import type { Connection, QueryOptions } from "mysql2/promise";

export const LIVE_TEXT_SYNC_DB_BUDGET_MS = 15_000;
type Database = { readonly $client: unknown };
type Writer = Readonly<Pick<MySql2Database, "select" | "insert" | "update">>;
type Lease = {
  query: (options: QueryOptions) => Promise<unknown>;
  release: () => void;
  destroy: () => void;
};
const timeoutError = () =>
  new Error("Live text sync DB phase exceeded its safety budget; no refresh receipt.");
const transportError = () =>
  new Error("Live text sync DB transport failed; no refresh receipt.");

/**
 * A fresh Drizzle mapper on ONE owned public mysql2 promise lease, not a race
 * around poolDb.transaction(). Checkout, BEGIN, every SQL statement, callback,
 * COMMIT and rollback share one monotonic deadline. Driver query timeouts AND an
 * active destruction timer bound stalled/timeout-ignoring drivers. The pool and
 * original connection methods/settings are never modified.
 *
 * Timeout/fatal/invalid transport and uncertain BEGIN/COMMIT destroy the lease;
 * only confirmed COMMIT or a confirmed, still-in-budget rollback may release it.
 * Socket destruction rolls back an OPEN server transaction; an unacknowledged
 * COMMIT can already have committed, so it is never reported as a fresh receipt.
 */
export async function runLiveTextSyncTransaction<T>(
  database: () => Promise<Database | null>,
  write: (writer: Writer) => Promise<T>,
  options: { budgetMs?: number } = {},
): Promise<T> {
  const budget = options.budgetMs ?? LIVE_TEXT_SYNC_DB_BUDGET_MS;
  if (!Number.isSafeInteger(budget) || budget <= 0 || budget > LIVE_TEXT_SYNC_DB_BUDGET_MS)
    throw transportError();
  const deadline = performance.now() + budget;
  const controller = new AbortController();
  let failure: unknown;
  let failed = false;
  let lease: Lease | undefined;
  let destroyed = false;
  let released = false;
  let querying = false;
  let phase: "checkout" | "begin" | "write" | "commit" | "rollback" | "release" | "closed" = "checkout";

  function destroy(): void {
    if (!lease || destroyed || released) return;
    destroyed = true; // Attempt exactly once, even if disposal itself throws.
    try { lease.destroy(); } catch { /* Never reuse after an uncertain close. */ }
  }
  function fail(error: unknown, dispose = false): void {
    if (!failed) { failed = true; failure = error; }
    if (dispose) destroy();
  }
  function expire(): void {
    fail(timeoutError(), true);
    controller.abort();
  }
  function requireBudget(): void {
    if (performance.now() >= deadline) expire();
    if (controller.signal.aborted || destroyed || released) throw failure ?? transportError();
  }
  function requireHealthy(): void {
    requireBudget();
    if (failed) throw failure;
  }
  // This timer remains active during checkout, callback and cleanup, not only SQL.
  const timer = setTimeout(expire, budget);

  /** Observe all late resolutions/rejections, but never grant an abandoned lease
   * or allow a detached callback to send SQL after the owner has failed/closed. */
  function bounded<V>(pending: PromiseLike<V>): Promise<V> {
    return new Promise((resolve, reject) => {
      const abort = () => reject(failure ?? timeoutError());
      controller.signal.addEventListener("abort", abort, { once: true });
      Promise.resolve(pending).then(value => {
        controller.signal.removeEventListener("abort", abort);
        try { requireBudget(); resolve(value); } catch (error) { reject(error); }
      }, error => {
        controller.signal.removeEventListener("abort", abort);
        reject(controller.signal.aborted ? failure : error);
      });
      if (controller.signal.aborted) abort();
    });
  }

  async function query(raw: string | QueryOptions, values?: unknown[]): Promise<unknown> {
    try {
      requireBudget();
      // A failed write may only issue the owner's one cleanup ROLLBACK, never
      // queued/late writes. Concurrent SQL is not supported by this finite owner.
      if (querying || !lease) {
        fail(transportError(), true);
        controller.abort();
        throw failure;
      }
      if (failed && phase !== "rollback") throw failure;
      const statement = typeof raw === "string" ? raw : raw?.sql;
      const command = typeof statement === "string" ? statement.trim() : "";
      const allowed = phase === "write" ? /^(?:select|insert|update)\s/i.test(command)
        : command.toLowerCase() === phase;
      if (!allowed || /;/.test(command)) {
        fail(transportError(), true);
        throw failure;
      }
      const remaining = Math.floor(deadline - performance.now());
      if (remaining < 1) { expire(); throw failure; }
      const queryOptions: QueryOptions = {
        ...(typeof raw === "string" ? { sql: raw } : raw),
        values: values ?? (typeof raw === "string" ? undefined : raw.values),
        timeout: remaining,
      };
      querying = true;
      let pending: Promise<unknown>;
      try {
        pending = lease.query(queryOptions);
        // Reject callback-only/invalid drivers before any next statement.
        if (!pending || typeof pending.then !== "function") {
          fail(transportError(), true);
          throw failure;
        }
      } catch (error) {
        fail(error, true);
        throw error;
      }
      const result = await bounded(pending);
      // mysql2 OK packets (BEGIN/COMMIT/ROLLBACK/INSERT/UPDATE) have undefined
      // fields; SELECT alone must carry its FieldPacket array.
      const selecting = phase === "write" && /^select\s/i.test(command);
      if (!Array.isArray(result) || result.length !== 2
        || (selecting ? !Array.isArray(result[1]) : result[1] !== undefined && !Array.isArray(result[1]))
        || (phase === "write" && /^select\s/i.test(command)
          ? !Array.isArray(result[0])
          : !result[0] || typeof result[0] !== "object" || Array.isArray(result[0]))) {
        fail(transportError(), true);
        throw failure;
      }
      if (!selecting) {
        const affectedRows = (result[0] as { affectedRows?: unknown }).affectedRows;
        if (typeof affectedRows !== "number" || !Number.isSafeInteger(affectedRows) || affectedRows < 0) {
          fail(transportError(), true);
          throw failure;
        }
      }
      requireBudget();
      if (failed && phase !== "rollback") throw failure;
      return result;
    } catch (error) {
      fail(error);
      // Transport timeout/fatal codes can mean the socket is unusable even when
      // the aggregate timer has not fired. Never queue rollback on that socket.
      const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
      if (typeof code === "string" && /^(?:ETIMEDOUT|ECONNRESET|EPIPE|PROTOCOL_|ERR_NOT_SUPPORTED_YET|ER_(?:NOT_SUPPORTED_YET|LOCK_WAIT_TIMEOUT|QUERY_TIMEOUT|QUERY_INTERRUPTED))/.test(code)) {
        destroy();
        controller.abort();
      }
      throw failure;
    } finally {
      querying = false;
    }
  }

  try {
    const db = await bounded(database());
    requireHealthy();
    if (!db) throw new Error("DB unavailable");
    const client = db.$client;
    if (!client || typeof client !== "object") throw transportError();
    const pool = "promise" in client && typeof client.promise === "function" ? client.promise() : client;
    if (!pool || typeof pool !== "object" || !("getConnection" in pool) || typeof pool.getConnection !== "function")
      throw transportError();
    // Explicit fulfillment handler disposes late checkout without running ANY SQL.
    const checkout = pool.getConnection();
    if (!checkout || typeof checkout.then !== "function") {
      try {
        if (typeof checkout?.destroy === "function") checkout.destroy();
        else if (typeof checkout?.release === "function") checkout.release();
      } catch { /* Invalid checkout never receives a query. */ }
      throw transportError();
    }
    const acquired = Promise.resolve(checkout).then(owned => {
      const candidate = owned as Partial<Lease> | null;
      const valid = candidate && typeof candidate.query === "function"
        && typeof candidate.release === "function" && typeof candidate.destroy === "function";
      if (failed || controller.signal.aborted || performance.now() >= deadline || !valid) {
        try {
          if (typeof candidate?.destroy === "function") candidate.destroy();
          else if (typeof candidate?.release === "function") candidate.release();
        } catch { /* Attempt once; no SQL. */ }
        if (performance.now() >= deadline) expire();
        if (!failed) fail(transportError());
        throw failure;
      }
      lease = candidate as Lease;
      return lease;
    });
    await bounded(acquired);
    requireHealthy();
    const mapper = drizzle({ query: query as Connection["query"] } as Connection, { logger: false });
    const writer: Writer = Object.freeze({
      select: mapper.select.bind(mapper),
      insert: mapper.insert.bind(mapper),
      update: mapper.update.bind(mapper),
    });
    phase = "begin";
    await mapper.execute(sql`begin`);
    requireHealthy();
    phase = "write";
    const result = await bounded(write(writer));
    requireHealthy();
    phase = "commit";
    await mapper.execute(sql`commit`);
    requireHealthy();
    phase = "release";
    lease!.release();
    released = true;
    // No SQL/fresh verification after COMMIT. If synchronous release consumed
    // the deadline, fail without destroying a lease already returned to the pool.
    if (performance.now() >= deadline) { fail(timeoutError()); throw failure; }
    return result;
  } catch (error) {
    fail(error);
    // An ordinary callback/query failure can still be rolled back safely. BEGIN
    // and COMMIT failures are ambiguous and must never return a reusable lease.
    if (lease && !destroyed && !released && !controller.signal.aborted && phase === "write") {
      phase = "rollback";
      try {
        await query("rollback");
        requireBudget();
        phase = "release";
        lease.release();
        released = true;
      } catch { destroy(); }
    } else destroy();
    throw failure;
  } finally {
    phase = "closed";
    clearTimeout(timer);
  }
}
