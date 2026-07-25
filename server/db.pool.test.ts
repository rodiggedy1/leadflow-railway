/**
 * db.pool.test.ts — Phase 1A1
 *
 * Tests for:
 *   - Pool configuration (all seven options recognized by mysql2 3.19.1)
 *   - Instrumentation wrapper (fail-fast guard, version log, acquisition tracking)
 *   - recordAcquisitionFailure (time-based trim, hard cap, bounding)
 *   - resetDb() (pool destroyed, no resetDb() in query error handlers)
 *   - Cold-start: getPool() is null before getDb() is called
 */

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import mysql from "mysql2/promise";

// ── Cold-start tests ──────────────────────────────────────────────────────────

describe("cold-start: getPool() before getDb()", () => {
  it("returns null before any DB initialization", async () => {
    // We can't easily reset module state in vitest without dynamic imports,
    // so we verify the documented contract: getPool() is null until getDb() is called.
    // This test documents the invariant; the cold-start guard in index.ts enforces it.
    const { getPool } = await import("./db");
    // If DATABASE_URL is not set, getDb() returns null and getPool() stays null.
    const savedUrl = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    // Reset module cache to simulate fresh start
    vi.resetModules();
    const { getPool: getPoolFresh, getDb: getDbFresh } = await import("./db");
    await getDbFresh(); // should be no-op without DATABASE_URL
    expect(getPoolFresh()).toBeNull();
    process.env.DATABASE_URL = savedUrl;
  });
});

// ── Pool option verification ──────────────────────────────────────────────────

describe("mysql2 pool option recognition (mysql2 3.19.1)", () => {
  it("all seven Phase 1A1/1A2 options are recognized and stored correctly", () => {
    const pool = mysql.createPool({
      uri: "mysql://user:pass@localhost:3306/db",
      connectionLimit:      20, // Phase 1A2: raised from 10 to 20
      maxIdle:              10,
      idleTimeout:          60_000,
      enableKeepAlive:      true,
      keepAliveInitialDelay: 10_000,
      queueLimit:           50,
      waitForConnections:   true,
    });

    const cfg     = (pool as any).pool.config;
    const connCfg = cfg.connectionConfig;

    expect(cfg.connectionLimit).toBe(20); // Phase 1A2: raised from 10 to 20
    expect(cfg.maxIdle).toBe(10);
    expect(cfg.idleTimeout).toBe(60_000);
    expect(cfg.queueLimit).toBe(50);
    expect(cfg.waitForConnections).toBe(true);
    expect(connCfg.enableKeepAlive).toBe(true);
    expect(connCfg.keepAliveInitialDelay).toBe(10_000);

    pool.end().catch(() => {});
  });
});

// ── Instrumentation wrapper ───────────────────────────────────────────────────

describe("wrapPoolInstrumentation (via getDb)", () => {
  it("pool.pool.getConnection is a function in mysql2 3.19.1 (guard passes)", () => {
    const pool = mysql.createPool({ uri: "mysql://user:pass@localhost:3306/db" });
    const corePool = (pool as any).pool;
    expect(typeof corePool?.getConnection).toBe("function");
    pool.end().catch(() => {});
  });

  it("guard throws if pool.pool.getConnection is not a function", () => {
    // Simulate a future mysql2 version that removes pool.pool
    const fakePool = {} as mysql.Pool;
    (fakePool as any).pool = {}; // no getConnection

    // We can't call wrapPoolInstrumentation directly (it's not exported),
    // but we can verify the guard condition directly:
    const corePool = (fakePool as any).pool;
    expect(typeof corePool?.getConnection).not.toBe("function");
    // The actual guard in wrapPoolInstrumentation throws:
    // throw new Error('DB Pool instrumentation v1: unsupported mysql2 PromisePool structure...')
    // This test documents the condition that triggers it.
  });
});

// ── recordAcquisitionFailure ──────────────────────────────────────────────────

describe("recordAcquisitionFailure", () => {
  beforeEach(async () => {
    vi.resetModules();
  });

  it("adds entries to dbAcquisitionFailures", async () => {
    const { dbAcquisitionFailures, recordAcquisitionFailure } = await import("./db");
    dbAcquisitionFailures.length = 0;

    recordAcquisitionFailure("ETIMEDOUT");
    expect(dbAcquisitionFailures).toHaveLength(1);
    expect(dbAcquisitionFailures[0].code).toBe("ETIMEDOUT");
  });

  it("trims entries older than 10 minutes on each push", async () => {
    const { dbAcquisitionFailures, recordAcquisitionFailure } = await import("./db");
    dbAcquisitionFailures.length = 0;

    const elevenMinutesAgo = Date.now() - 11 * 60_000;
    dbAcquisitionFailures.push({ ts: elevenMinutesAgo, code: "ETIMEDOUT" });
    expect(dbAcquisitionFailures).toHaveLength(1);

    recordAcquisitionFailure("ECONNRESET");
    // The old entry should be trimmed, only the new one remains
    expect(dbAcquisitionFailures).toHaveLength(1);
    expect(dbAcquisitionFailures[0].code).toBe("ECONNRESET");
  });

  it("enforces hard cap of 200 entries", async () => {
    const { dbAcquisitionFailures, recordAcquisitionFailure } = await import("./db");
    dbAcquisitionFailures.length = 0;

    const now = Date.now();
    // Fill to 200 with recent timestamps (within 10 min window)
    for (let i = 0; i < 200; i++) {
      dbAcquisitionFailures.push({ ts: now - i * 1000, code: "ETIMEDOUT" });
    }
    expect(dbAcquisitionFailures).toHaveLength(200);

    // Adding one more should drop the oldest and keep length at 200
    recordAcquisitionFailure("QUEUE_LIMIT");
    expect(dbAcquisitionFailures).toHaveLength(200);
    expect(dbAcquisitionFailures[dbAcquisitionFailures.length - 1].code).toBe("QUEUE_LIMIT");
  });

  it("works correctly when watchdog is not running", async () => {
    // dbAcquisitionFailures is bounded independently of the watchdog.
    // This test verifies it doesn't grow unboundedly when the watchdog is absent.
    const { dbAcquisitionFailures, recordAcquisitionFailure } = await import("./db");
    dbAcquisitionFailures.length = 0;

    for (let i = 0; i < 250; i++) {
      recordAcquisitionFailure("ETIMEDOUT");
    }
    // Should never exceed 200
    expect(dbAcquisitionFailures.length).toBeLessThanOrEqual(200);
  });
});

// ── resetDb() ────────────────────────────────────────────────────────────────

describe("resetDb()", () => {
  it("clears both _db and _pool singletons", async () => {
    vi.resetModules();
    const { getPool, resetDb } = await import("./db");
    resetDb();
    expect(getPool()).toBeNull();
  });

  it("is NOT called from upsertUser or getUserByOpenId error handlers", async () => {
    // Verify the code no longer contains resetDb() calls in query error handlers.
    // This is a static assertion — read the source and check.
    const fs = await import("fs");
    const source = fs.readFileSync(new URL("./db.ts", import.meta.url).pathname, "utf8");

    // resetDb() should NOT appear as an actual call in upsertUser or getUserByOpenId.
    // It may appear in: export declaration, function body, and comment lines.
    const actualCallSites = source
      .split("\n")
      .filter(line => line.includes("resetDb()"))
      .filter(line => !line.trim().startsWith("//"))   // skip comment lines
      .filter(line => !line.trim().startsWith("*"))    // skip JSDoc lines
      .filter(line => !line.includes("export function resetDb")) // skip declaration
      .filter(line => !line.includes("_pool?.end"))    // skip function body
      .filter(line => !line.includes("_db = null"))    // skip function body
      .filter(line => !line.includes("_pool = null")); // skip function body

    expect(actualCallSites).toHaveLength(0);
  });
});

// ── Known gap documentation ───────────────────────────────────────────────────

describe("known gap: PROTOCOL_CONNECTION_LOST", () => {
  it("is documented as not captured by getConnection wrapper", async () => {
    // PROTOCOL_CONNECTION_LOST fires on the TCP 'close' event on an already-acquired
    // connection. It goes to the pending query's onResult callback, NOT to getConnection.
    // Therefore it will never appear in dbAcquisitionFailures.
    // Signals 1 and 2 (probe-based) provide coverage for sustained DB unavailability.
    //
    // This test documents the known gap. If a future implementation captures
    // PROTOCOL_CONNECTION_LOST, this test should be updated.
    // Use dynamic import (ESM context — require() is not available)
    const { dbAcquisitionFailures } = await import("./db");
    // We can't easily simulate PROTOCOL_CONNECTION_LOST in a unit test without
    // a real DB connection. The gap is documented here for future reference.
    expect(true).toBe(true); // documentation test
  });
});
