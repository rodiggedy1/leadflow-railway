import { and, eq, gt } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { InsertUser, users, agents, type Agent, cleanerMagicLinkTokens } from "../drizzle/schema";
import { ENV } from './_core/env';
import { randomBytes } from "crypto";

// ── Pool health tracking ──────────────────────────────────────────────────────

// Acquisition-time error codes that indicate pool-level health problems.
// PROTOCOL_CONNECTION_LOST is intentionally excluded: it fires during query execution
// after successful acquisition (on the TCP 'close' event → connection._notifyError →
// command.onResult) and will never reach the getConnection wrapper.
const RESTART_WORTHY_CODES = new Set([
  'ETIMEDOUT',     // TCP timeout during connection establishment
  'ECONNRESET',    // Connection reset during establishment
  'ECONNREFUSED',  // Connection refused during establishment
  'QUEUE_LIMIT',   // Pool queue full (synthetic code — not from mysql2)
]);

const ACQUISITION_FAILURE_WINDOW_MS = 10 * 60_000; // 10 minutes
const MAX_ACQUISITION_FAILURES = 200;               // hard cap: ~8KB max

// Tracks restart-worthy connection acquisition failures.
// Bounded independently of the watchdog: trimmed on every push.
// Exported for use by dbWatchdog.ts and tests.
export const dbAcquisitionFailures: Array<{ ts: number; code: string }> = [];

export function recordAcquisitionFailure(code: string): void {
  const now = Date.now();
  const cutoff = now - ACQUISITION_FAILURE_WINDOW_MS;
  // Time-based trim: remove entries older than 10 minutes
  while (dbAcquisitionFailures.length > 0 && dbAcquisitionFailures[0].ts < cutoff) {
    dbAcquisitionFailures.shift();
  }
  // Hard cap: if still over limit after trim, drop oldest
  while (dbAcquisitionFailures.length >= MAX_ACQUISITION_FAILURES) {
    dbAcquisitionFailures.shift();
  }
  dbAcquisitionFailures.push({ ts: now, code });
}

// ── Pool instrumentation ──────────────────────────────────────────────────────

// Version constant: log this at startup so you always know which monitoring
// implementation is running in production.
export const DB_POOL_MONITOR_VERSION = 1;

function wrapPoolInstrumentation(pool: mysql.Pool): void {
  // All query paths — pool.query(), db.execute(), pool.getConnection() — go through
  // corePool.getConnection (the underlying callback Pool). Verified at runtime against
  // mysql2 3.19.1: PromisePool.query() and drizzle db.execute() both call
  // corePool.getConnection, not PromisePool.getConnection.
  //
  // This relies on mysql2 PromisePool exposing .pool (the underlying callback Pool).
  // If a future mysql2 major release changes this internal structure, the guard below
  // will throw at startup — fail fast rather than silently losing all monitoring.
  const corePool = (pool as any).pool;
  if (typeof corePool?.getConnection !== 'function') {
    throw new Error(
      `DB Pool instrumentation v${DB_POOL_MONITOR_VERSION}: unsupported mysql2 PromisePool structure — ` +
      'pool.pool.getConnection is not a function. Update wrapPoolInstrumentation for this mysql2 version.'
    );
  }

  const originalGetConnection = corePool.getConnection.bind(corePool);

  corePool.getConnection = function (cb: (err: Error | null, conn: any) => void) {
    const startedAt = Date.now();
    originalGetConnection(function (err: any, conn: any) {
      const durationMs = Date.now() - startedAt;
      if (err) {
        const errorCode: string =
          err.code ??
          (err.message === 'Queue limit reached.' ? 'QUEUE_LIMIT' : 'UNKNOWN');
        console.error('[DB Pool] acquisition_failed', {
          error_code: errorCode,
          duration_ms: durationMs,
          pool_all:   corePool._allConnections?.length  ?? -1,
          pool_free:  corePool._freeConnections?.length ?? -1,
          pool_queue: corePool._connectionQueue?.length ?? -1,
        });
        if (RESTART_WORTHY_CODES.has(errorCode)) {
          recordAcquisitionFailure(errorCode);
        }
      } else {
        // Sample 10% of successful acquisitions to avoid log noise
        if (Math.random() < 0.1) {
          console.log('[DB Pool] acquisition_ok', {
            duration_ms: durationMs,
            pool_all:   corePool._allConnections?.length  ?? -1,
            pool_free:  corePool._freeConnections?.length ?? -1,
            pool_queue: corePool._connectionQueue?.length ?? -1,
          });
        }
      }
      cb(err, conn);
    });
  };

  // Log mysql2 version for operational clarity
  let mysql2Version = 'unknown';
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    mysql2Version = require('mysql2/package.json').version;
  } catch { /* ignore */ }
  console.log(`[DB Pool] instrumentation v${DB_POOL_MONITOR_VERSION} enabled — mysql2 ${mysql2Version}`);
}

// ── Pool singleton ────────────────────────────────────────────────────────────

let _db: ReturnType<typeof drizzle> | null = null;
let _pool: mysql.Pool | null = null;

export function getPool(): mysql.Pool | null {
  return _pool;
}

/**
 * Reset the DB pool singleton.
 *
 * USE ONLY FOR: testing, and catastrophic scenarios where the pool must be
 * fully destroyed and recreated.
 *
 * DO NOT call from query-level error handlers (ETIMEDOUT, ECONNRESET, etc.).
 * The pool self-heals from individual connection errors — calling resetDb()
 * destroys all pool connections unnecessarily. The pool removes broken
 * connections automatically and creates new ones for subsequent requests.
 */
export function resetDb() {
  _db = null;
  _pool?.end().catch(() => {});
  _pool = null;
}

// Lazily create the drizzle instance so local tooling can run without a DB.
export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _pool = mysql.createPool({
        uri: process.env.DATABASE_URL,
        // Connection establishment timeout
        connectTimeout: 10_000,
        // Keep-alive: enabled by default in mysql2 3.x (enableKeepAlive: true).
        // keepAliveInitialDelay: 10s — defensive hardening against suspected
        // intermediate-network idle connection termination. TiDB wait_timeout = 8h
        // (server-side closure ruled out as root cause). Hypothesis: Railway NAT
        // gateway or load balancer closes idle TCP sockets before mysql2's default
        // keep-alive fires. Setting 10s ensures keep-alive probes fire well within
        // any reasonable NAT timeout. Confirmed fix requires observing whether
        // ETIMEDOUT errors disappear after deployment.
        enableKeepAlive: true,
        keepAliveInitialDelay: 10_000,
        // Pool sizing
        // Phase 1A2: raised from 10 → 20 after instrumentation confirmed sustained
        // pool saturation (pool_all: 10, pool_free: 0, pool_queue: 19–21) at normal
        // operating load. Steady-state demand is ~12–14 connections; burst demand
        // (cron tick + active users + webhook) is ~18–22. Measure after deploying
        // lastSeenAt throttle + PREVIEW_MODE=true; increase to 25 only if telemetry
        // shows sustained queues or acquisition waits > 50–100ms.
        connectionLimit: 20,
        maxIdle: 10,
        idleTimeout: 60_000,
        waitForConnections: true,
        // Back-pressure: reject new acquisitions when 50 are already queued.
        // Without this, queueLimit defaults to 0 (unlimited), allowing unbounded
        // memory growth and indefinite waits during DB outages.
        // Callers see: Error('Queue limit reached.') — fast-fail instead of hanging.
        queueLimit: 50,
        // timezone: preserved as 'local' (mysql2 default = America/New_York = UTC-4).
        // Changing to 'Z' requires Phase 1A2 audit of 171 timestamp() columns first.
      });
      wrapPoolInstrumentation(_pool);
      _db = drizzle(_pool);
    } catch (error) {
      console.warn("[Database] Failed to create pool:", error);
      _db = null;
      _pool = null;
    }
  }
  return _db;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) {
    throw new Error("User openId is required for upsert");
  }

  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }

  try {
    const values: InsertUser = {
      openId: user.openId,
    };
    const updateSet: Record<string, unknown> = {};

    const textFields = ["name", "email", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];

    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };

    textFields.forEach(assignNullable);

    if (user.lastSignedIn !== undefined) {
      values.lastSignedIn = user.lastSignedIn;
      updateSet.lastSignedIn = user.lastSignedIn;
    }
    if (user.role !== undefined) {
      values.role = user.role;
      updateSet.role = user.role;
    } else if (user.openId === ENV.ownerOpenId) {
      values.role = 'admin';
      updateSet.role = 'admin';
    }

    if (!values.lastSignedIn) {
      values.lastSignedIn = new Date();
    }

    if (Object.keys(updateSet).length === 0) {
      updateSet.lastSignedIn = new Date();
    }

    await db.insert(users).values(values).onDuplicateKeyUpdate({
      set: updateSet,
    });
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    // NOTE: resetDb() is intentionally NOT called here.
    // The pool self-heals from ETIMEDOUT/ECONNRESET — it removes the broken
    // connection and creates a new one for the next request. Calling resetDb()
    // would destroy all pool connections for a single query error.
    throw error;
  }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user: database not available");
    return undefined;
  }
  try {
    const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
    return result.length > 0 ? result[0] : undefined;
  } catch (error) {
    // NOTE: resetDb() is intentionally NOT called here.
    // The pool self-heals from individual connection errors.
    throw error;
  }
}

// ── Agent DB helpers ──────────────────────────────────────────────────────────

export async function getAgentByEmail(email: string): Promise<Agent | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(agents).where(eq(agents.email, email)).limit(1);
  return result[0];
}

export async function getAgentById(id: number): Promise<Agent | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(agents).where(eq(agents.id, id)).limit(1);
  return result[0];
}

export async function getAllAgents(): Promise<Agent[]> {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(agents).orderBy(agents.createdAt);
}

export async function createAgent(data: {
  name: string;
  email: string;
  passwordHash: string;
}): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  await db.insert(agents).values({
    name: data.name,
    email: data.email,
    passwordHash: data.passwordHash,
    isActive: 1,
  });
}

export async function setAgentActive(id: number, isActive: 0 | 1): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  await db.update(agents).set({ isActive }).where(eq(agents.id, id));
}

// ── Magic Link helpers ────────────────────────────────────────────────────────

const BASE_URL = "https://quote.maidinblack.com";
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Returns the magic login URL for a cleaner.
 * Reuses the existing valid 30-day token if one exists; otherwise creates a new one.
 * Safe to call from any server-side code (fieldMgmtEngine, cleanerRouter, etc.).
 */
export async function getOrCreateCleanerMagicLink(cleanerProfileId: number): Promise<string> {
  const db = await getDb();
  if (!db) {
    // Fallback: return the plain portal URL if DB is unavailable
    return `${BASE_URL}/cleaner`;
  }

  const now = new Date();

  // Look for an existing valid (non-expired) token for this cleaner
  const existing = await db
    .select({ token: cleanerMagicLinkTokens.token })
    .from(cleanerMagicLinkTokens)
    .where(
      and(
        eq(cleanerMagicLinkTokens.cleanerProfileId, cleanerProfileId),
        gt(cleanerMagicLinkTokens.expiresAt, now)
      )
    )
    .orderBy(cleanerMagicLinkTokens.createdAt)
    .limit(1);

  if (existing[0]) {
    return `${BASE_URL}/auth/cleaner-callback?token=${existing[0].token}`;
  }

  // No valid token — create a new one
  const rawToken = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + THIRTY_DAYS_MS);

  await db.insert(cleanerMagicLinkTokens).values({
    cleanerProfileId,
    token: rawToken,
    expiresAt,
  });

  console.log(`[MagicLink] Created new token for cleanerProfileId=${cleanerProfileId}, expires ${expiresAt.toISOString()}`);
  return `${BASE_URL}/auth/cleaner-callback?token=${rawToken}`;
}
