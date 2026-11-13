import { performance } from "node:perf_hooks";
import { drizzle } from "drizzle-orm/mysql2";
import { int, mysqlTable } from "drizzle-orm/mysql-core";
import type { Pool, QueryOptions } from "mysql2/promise";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LIVE_TEXT_SYNC_DB_BUDGET_MS, runLiveTextSyncTransaction } from "./liveTextMonitorSyncTransaction";

const jobs = mysqlTable("leadflow_jobs", { id: int("id"), value: int("value") });
type Writer = Parameters<typeof runLiveTextSyncTransaction>[1] extends (writer: infer W) => unknown ? W : never;
function deferred<T = unknown>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const flush = async () => { for (let index = 0; index < 150; index++) await Promise.resolve(); };

beforeEach(() => {
  vi.useFakeTimers();
  // Aggregate deadline is monotonic, independent of wall-clock/DST changes.
  vi.spyOn(performance, "now").mockImplementation(() => Date.now());
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("No network/provider calls in offline tests"); }));
});
afterEach(() => {
  expect(fetch).not.toHaveBeenCalled();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function fixture() {
  const trace: QueryOptions[] = [];
  let disposed = false;
  let open = false;
  let tentative = 0;
  let committed = 0;
  let intercept: ((options: QueryOptions) => unknown) | undefined;
  const query = vi.fn((options: QueryOptions): Promise<unknown> => {
    if (disposed) throw new Error("Query reached a destroyed lease");
    expect(options).toMatchObject({ sql: expect.any(String), timeout: expect.any(Number) });
    expect(options.timeout).toBeGreaterThan(0);
    expect(options.timeout).toBeLessThanOrEqual(LIVE_TEXT_SYNC_DB_BUDGET_MS);
    trace.push(options);
    if (intercept) {
      const result = intercept(options);
      if (result !== undefined) return result as Promise<unknown>;
    }
    const command = options.sql.toLowerCase();
    if (command === "begin") open = true;
    else if (command === "commit") { committed += tentative; tentative = 0; open = false; }
    else if (command === "rollback") { tentative = 0; open = false; }
    else if (/^(update|insert)/.test(command)) {
      if (!open) throw new Error("Offline write outside transaction");
      tentative++;
    }
    // Real mysql2 sends undefined fields on an OK packet, not an array.
    return Promise.resolve(/^select/.test(command)
      ? [[[41]], [{ name: "id" }]]
      : [{ affectedRows: 1, insertId: 42 }, undefined]);
  });
  const destroy = vi.fn(() => { disposed = true; open = false; tentative = 0; });
  const release = vi.fn(() => { if (open) throw new Error("Open transaction released"); });
  const owned = { query, destroy, release };
  const getConnection = vi.fn(async () => owned);
  const pool = { getConnection, query: vi.fn(() => { throw new Error("Shared pool query forbidden"); }) };
  const db = drizzle(pool as unknown as Pool);
  return {
    db, pool, owned, getConnection, query, destroy, release, trace,
    sql: () => trace.map(options => options.sql),
    state: () => ({ disposed, open, tentative, committed }),
    hook: (next: typeof intercept) => { intercept = next; },
    commitWithoutAcknowledgment: () => { committed += tentative; tentative = 0; open = false; },
  };
}
async function write(writer: Writer) {
  const found = await writer.select({ id: jobs.id }).from(jobs).for("update");
  expect(found).toEqual([{ id: 41 }]);
  const updated = await writer.update(jobs).set({ value: 9 });
  expect(updated[0].affectedRows).toBe(1);
  const inserted = await writer.insert(jobs).values({ id: 42, value: 10 });
  return { refreshedJobIds: [found[0].id, inserted[0].insertId] };
}
function start(h: ReturnType<typeof fixture>, callback = write, budgetMs = 100) {
  const task = runLiveTextSyncTransaction(async () => h.db, callback, { budgetMs });
  // Observe rejection immediately; timing assertions must never create unhandled rejections.
  void task.catch(() => undefined);
  return task;
}
function assertDisposed(h: ReturnType<typeof fixture>) {
  expect(h.destroy).toHaveBeenCalledTimes(1);
  expect(h.release).not.toHaveBeenCalled();
  expect(h.state().open).toBe(false);
  expect(h.state().tentative).toBe(0);
  expect(h.pool.query).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
}

describe("live monitor finite owned public mysql2 transaction — offline", () => {
  it("returns stable receipt only after BEGIN/locked SELECT/UPDATE/INSERT/acknowledged COMMIT and release", async () => {
    const h = fixture();
    expect(await start(h)).toEqual({ refreshedJobIds: [41, 42] });
    expect(h.sql()).toEqual(["begin", expect.stringMatching(/^select.* for update$/), expect.stringMatching(/^update/), expect.stringMatching(/^insert/), "commit"]);
    expect(h.getConnection).toHaveBeenCalledTimes(1);
    expect(h.release).toHaveBeenCalledTimes(1);
    expect(h.destroy).not.toHaveBeenCalled();
    expect(h.state()).toMatchObject({ open: false, committed: 2 });
    expect(h.trace[2].values).toEqual([9]);
    expect(h.trace[3].values).toEqual([42, 10]);
    expect(h.pool.query).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("uses default aggregate 15s and per-query remaining budget for controls and mapper SQL", async () => {
    const h = fixture();
    h.hook(() => { vi.setSystemTime(Date.now() + 1_000); });
    await runLiveTextSyncTransaction(async () => h.db, write);
    expect(h.trace.map(query => query.timeout)).toEqual([15_000, 14_000, 13_000, 12_000, 11_000]);
    expect(h.release).toHaveBeenCalledTimes(1);
  });

  it.each([0, -1, 0.5, NaN, Infinity, 15_001])("rejects invalid/increased budget %s before database acquisition", async budgetMs => {
    const database = vi.fn();
    await expect(runLiveTextSyncTransaction(database, write, { budgetMs })).rejects.toThrow("transport failed");
    expect(database).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("active timer bounds unresolved getDb and prevents late checkout", async () => {
    const h = fixture();
    const pending = deferred<typeof h.db>();
    const task = runLiveTextSyncTransaction(() => pending.promise, write, { budgetMs: 100 });
    void task.catch(() => undefined);
    await vi.advanceTimersByTimeAsync(100);
    await expect(task).rejects.toThrow("safety budget");
    pending.resolve(h.db);
    await flush();
    expect(h.getConnection).not.toHaveBeenCalled();
    expect(h.trace).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["resolve", "reject"])("bounds checkout and disposes/observes late pool %s without ANY query", async settlement => {
    const h = fixture();
    const pending = deferred<typeof h.owned>();
    h.getConnection.mockReturnValueOnce(pending.promise);
    const task = start(h);
    await flush();
    await vi.advanceTimersByTimeAsync(100);
    await expect(task).rejects.toThrow("safety budget");
    if (settlement === "resolve") pending.resolve(h.owned);
    else pending.reject(new Error("Late checkout failure"));
    await flush();
    expect(h.trace).toEqual([]);
    expect(h.destroy).toHaveBeenCalledTimes(settlement === "resolve" ? 1 : 0);
    expect(h.release).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["begin", "select", "update", "insert", "commit"])("destroys stalled in-flight %s exactly once, returns no receipt and never queues extra SQL", async command => {
    const h = fixture();
    const pending = deferred();
    h.hook(options => options.sql.startsWith(command) ? pending.promise : undefined);
    const task = start(h);
    await flush();
    const count = h.trace.length;
    expect(h.sql().at(-1)).toMatch(new RegExp(`^${command}`));
    await vi.advanceTimersByTimeAsync(100);
    await expect(task).rejects.toThrow();
    assertDisposed(h);
    pending.resolve(command === "select" ? [[[41]], []] : [{ affectedRows: 1, insertId: 42 }, undefined]);
    await flush();
    await vi.advanceTimersByTimeAsync(500);
    expect(h.trace).toHaveLength(count);
    expect(h.sql()).not.toContain("rollback");
    assertDisposed(h);
  });

  it("unknown COMMIT may have committed but can NEVER yield a receipt or fresh verification/retry", async () => {
    const h = fixture();
    const pending = deferred();
    h.hook(options => {
      if (options.sql === "commit") { h.commitWithoutAcknowledgment(); return pending.promise; }
    });
    const task = start(h);
    await flush();
    expect(h.state().committed).toBe(2);
    const count = h.trace.length;
    await vi.advanceTimersByTimeAsync(100);
    await expect(task).rejects.toThrow("safety budget");
    pending.resolve([{ affectedRows: 0 }, undefined]);
    await flush();
    expect(h.trace).toHaveLength(count);
    expect(h.sql().at(-1)).toBe("commit");
    assertDisposed(h);
  });

  it("bounds a stalled callback and blocks its late writes using the revoked per-owned transport", async () => {
    const h = fixture();
    const wait = deferred();
    let lateError: unknown;
    const task = start(h, async writer => {
      await wait.promise;
      try { await writer.update(jobs).set({ value: 5 }); } catch (error) { lateError = error; }
      return { refreshedJobIds: [41] };
    });
    await flush();
    await vi.advanceTimersByTimeAsync(100);
    await expect(task).rejects.toThrow("safety budget");
    wait.resolve(undefined);
    await flush();
    expect(lateError).toBeInstanceOf(Error);
    expect(h.sql()).toEqual(["begin"]);
    assertDisposed(h);
  });

  it("a caught query failure remains failed; no later write or COMMIT can be sent", async () => {
    const h = fixture();
    h.hook(options => /^update/.test(options.sql) ? Promise.reject(new Error("First update rejected")) : undefined);
    const task = start(h, async writer => {
      try { await writer.update(jobs).set({ value: 1 }); } catch { /* User callback cannot un-fail owner. */ }
      try { await writer.insert(jobs).values({ id: 42 }); } catch { /* No queue. */ }
      return { refreshedJobIds: [42] };
    });
    await expect(task).rejects.toThrow();
    expect(h.sql()).toEqual(["begin", expect.stringMatching(/^update/), "rollback"]);
    expect(h.release).toHaveBeenCalledTimes(1);
    expect(h.destroy).not.toHaveBeenCalled();
    expect(h.state().committed).toBe(0);
  });

  it("refuses concurrent SQL before the second query can queue, then revokes the stalled first query", async () => {
    const h = fixture();
    const pending = deferred();
    h.hook(options => /^update/.test(options.sql) ? pending.promise : undefined);
    const task = start(h, async writer => {
      await Promise.all([
        writer.update(jobs).set({ value: 1 }),
        writer.insert(jobs).values({ id: 42 }),
      ]);
      return { refreshedJobIds: [42] };
    });
    await expect(task).rejects.toThrow();
    pending.reject(new Error("Destroyed connection settled late"));
    await flush();
    expect(h.sql()).toEqual(["begin", expect.stringMatching(/^update/)]);
    assertDisposed(h);
  });

  it.each(["begin", "commit"])("ambiguous %s rejection destroys instead of unsafe rollback/release", async command => {
    const h = fixture();
    h.hook(options => options.sql === command ? Promise.reject(new Error("Unknown control result")) : undefined);
    await expect(start(h)).rejects.toThrow();
    expect(h.sql().at(-1)).toBe(command);
    expect(h.sql()).not.toContain("rollback");
    assertDisposed(h);
  });

  it.each(["callback", "select", "update", "insert"])("ordinary %s error safely rolls back all writes, then releases once", async command => {
    const h = fixture();
    h.hook(options => options.sql.startsWith(command) ? Promise.reject(new Error("Ordinary failure")) : undefined);
    const task = start(h, command === "callback" ? async writer => { await writer.update(jobs).set({ value: 9 }); throw new Error("Callback failed"); } : write);
    await expect(task).rejects.toThrow();
    expect(h.sql().at(-1)).toBe("rollback");
    expect(h.release).toHaveBeenCalledTimes(1);
    expect(h.destroy).not.toHaveBeenCalled();
    expect(h.state()).toMatchObject({ open: false, tentative: 0, committed: 0 });
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["reject", "stall", "invalid"])("failed rollback %s destroys rather than returning an active/uncertain lease", async behavior => {
    const h = fixture();
    const pending = deferred();
    h.hook(options => {
      if (options.sql !== "rollback") return;
      return behavior === "reject" ? Promise.reject(new Error("Rollback failed"))
        : behavior === "stall" ? pending.promise : Promise.resolve("invalid result");
    });
    const task = start(h, async writer => { await writer.update(jobs).set({ value: 9 }); throw new Error("Original callback failure"); });
    await flush();
    if (behavior === "stall") await vi.advanceTimersByTimeAsync(100);
    await expect(task).rejects.toThrow("Original callback failure");
    const count = h.trace.length;
    pending.resolve([{ affectedRows: 0 }, undefined]);
    await flush();
    expect(h.trace).toHaveLength(count);
    expect(h.sql().at(-1)).toBe("rollback");
    assertDisposed(h);
  });

  it.each(["commit", "rollback"])("release failure after %s destroys exactly once and cannot produce a receipt", async command => {
    const h = fixture();
    h.release.mockImplementationOnce(() => { throw new Error("Release failure"); });
    const task = start(h, command === "rollback" ? async () => { throw new Error("Original callback failure"); } : write);
    await expect(task).rejects.toThrow(command === "commit" ? "Release failure" : "Original callback failure");
    expect(h.release).toHaveBeenCalledTimes(1);
    expect(h.destroy).toHaveBeenCalledTimes(1);
    expect(h.sql().at(-1)).toBe(command);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("destroy throwing is attempted once, never retried/released", async () => {
    const h = fixture();
    const pending = deferred();
    h.hook(() => pending.promise);
    h.destroy.mockImplementationOnce(() => { throw new Error("Close failed"); });
    const task = start(h);
    await flush();
    await vi.advanceTimersByTimeAsync(100);
    await expect(task).rejects.toThrow("safety budget");
    pending.reject(new Error("Late failure"));
    await flush();
    expect(h.destroy).toHaveBeenCalledTimes(1);
    expect(h.release).not.toHaveBeenCalled();
    expect(h.sql()).toEqual(["begin"]);
  });

  it.each(["begin", "select", "update", "insert", "commit"])("invalid %s result fails closed with no additional SQL", async command => {
    const h = fixture();
    h.hook(options => options.sql.startsWith(command) ? Promise.resolve({ wrong: "not a mysql2 result" }) : undefined);
    await expect(start(h)).rejects.toThrow();
    expect(h.sql().at(-1)).toMatch(new RegExp(`^${command}`));
    assertDisposed(h);
  });

  it.each(["PROTOCOL_SEQUENCE_TIMEOUT", "ETIMEDOUT", "ERR_NOT_SUPPORTED_YET"])("driver %s fails closed with destruction, never queues rollback", async code => {
    const h = fixture();
    h.hook(options => /^update/.test(options.sql) ? Promise.reject(Object.assign(new Error("Driver failure"), { code })) : undefined);
    await expect(start(h)).rejects.toThrow();
    expect(h.sql().at(-1)).toMatch(/^update/);
    assertDisposed(h);
  });

  it("callback-only/non-promise query driver is rejected, never begins further writes", async () => {
    const h = fixture();
    h.hook(() => ({ on: vi.fn() }));
    await expect(start(h)).rejects.toThrow("transport failed");
    expect(h.sql()).toEqual(["begin"]);
    assertDisposed(h);
  });

  it("driver refusing timeout query options is destroyed before further SQL", async () => {
    const h = fixture();
    h.hook(() => { throw new TypeError("Query timeout unsupported"); });
    await expect(start(h)).rejects.toThrow("Query timeout unsupported");
    expect(h.sql()).toEqual(["begin"]);
    assertDisposed(h);
  });

  it.each([null, {}, { $client: null }, { $client: {} }, { $client: { getConnection: 1 } }])("unavailable/unsupported public client %j does not run SQL", async db => {
    const h = fixture();
    await expect(runLiveTextSyncTransaction(async () => db as typeof h.db | null, write, { budgetMs: 100 })).rejects.toThrow();
    expect(h.getConnection).not.toHaveBeenCalled();
    expect(h.trace).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("public callback pool promise adapter is supported without mutating the pool or connection methods", async () => {
    const h = fixture();
    const promise = vi.fn(() => h.pool);
    const originalQuery = h.owned.query;
    await runLiveTextSyncTransaction(async () => ({ $client: { promise } }), write, { budgetMs: 100 });
    expect(promise).toHaveBeenCalledTimes(1);
    expect(h.owned.query).toBe(originalQuery);
    expect(h.pool.query).not.toHaveBeenCalled();
    expect(h.release).toHaveBeenCalledTimes(1);
  });

  it.each(["query", "release", "destroy"])("invalid acquired lease missing %s is disposed before BEGIN", async missing => {
    const h = fixture();
    const owned = { ...h.owned, [missing]: undefined };
    h.getConnection.mockResolvedValueOnce(owned as typeof h.owned);
    await expect(start(h)).rejects.toThrow("transport failed");
    expect(h.trace).toEqual([]);
    expect(missing === "destroy" ? h.release : h.destroy).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["begin", "select", "update", "insert", "commit"])("settled %s at the exact deadline is destroyed before any next query/receipt", async command => {
    const h = fixture();
    h.hook(options => {
      if (options.sql.startsWith(command)) vi.setSystemTime(Date.now() + 100);
    });
    await expect(start(h)).rejects.toThrow();
    expect(h.sql().at(-1)).toMatch(new RegExp(`^${command}`));
    assertDisposed(h);
  });

  it("late synchronous release cannot yield a success receipt or destroy a lease already returned to the pool", async () => {
    const h = fixture();
    h.release.mockImplementationOnce(() => { vi.setSystemTime(Date.now() + 100); });
    await expect(start(h)).rejects.toThrow("safety budget");
    expect(h.sql().at(-1)).toBe("commit");
    expect(h.release).toHaveBeenCalledTimes(1);
    expect(h.destroy).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["begin", "update", "insert", "commit", "rollback"])("invalid %s OK header is not accepted as an acknowledgment", async command => {
    const h = fixture();
    h.hook(options => options.sql.startsWith(command) ? Promise.resolve([{}, undefined]) : undefined);
    const task = start(h, command === "rollback" ? async () => { throw new Error("Original failure"); } : write);
    await expect(task).rejects.toThrow();
    expect(h.sql().at(-1)).toMatch(new RegExp(`^${command}`));
    assertDisposed(h);
  });

  it("synchronous UPDATE driver throw is uncertain and destroys without further SQL", async () => {
    const h = fixture();
    h.hook(options => { if (/^update/.test(options.sql)) throw new Error("Synchronous transport failure"); });
    await expect(start(h)).rejects.toThrow();
    expect(h.sql().at(-1)).toMatch(/^update/);
    assertDisposed(h);
  });

  it("synchronous pool checkout throw never runs BEGIN", async () => {
    const h = fixture();
    h.getConnection.mockImplementationOnce(() => { throw new Error("Checkout rejected"); });
    await expect(start(h)).rejects.toThrow("Checkout rejected");
    expect(h.trace).toEqual([]);
    expect(h.destroy).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("invalid synchronous checkout lease is disposed before any query", async () => {
    const h = fixture();
    h.getConnection.mockReturnValueOnce(h.owned as unknown as Promise<typeof h.owned>);
    await expect(start(h)).rejects.toThrow("transport failed");
    expect(h.trace).toEqual([]);
    assertDisposed(h);
  });

  it("late retained writer after SUCCESS is revoked, cannot destroy the returned pool lease or queue writes", async () => {
    const h = fixture();
    let retained!: Writer;
    await start(h, async writer => { retained = writer; return { refreshedJobIds: [] }; });
    const count = h.trace.length;
    await expect(retained.update(jobs).set({ value: 99 })).rejects.toThrow();
    expect(h.trace).toHaveLength(count);
    expect(h.release).toHaveBeenCalledTimes(1);
    expect(h.destroy).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
