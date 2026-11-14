import type { AuthorizedScope } from "../../shared/instinct";

/** The only database surface exposed to Instinct readers. No application bootstrap,
 * provider, ORM schema, source writer or operational router is imported here. */
export type SqlValue = string | number | boolean | null;
export type SqlRow = Readonly<Record<string, unknown>>;
export interface SelectPort {
  readonly select: (sql: string, params?: readonly SqlValue[]) => Promise<SqlRow[]>;
}
export interface ReadDb extends SelectPort {
  readonly snapshot: <T>(read: (port: SelectPort) => Promise<T>) => Promise<T>;
}
export type ReadDatabase = ReadDb;
export type InstinctSelectPort = SelectPort;
export type ReadDbReason = "DB_UNAVAILABLE" | "DB_SCHEMA" | "DB_TIMEOUT" | "DB_READ_FAILED";
export class ReadDbError extends Error {
  constructor(readonly reason: ReadDbReason) { super(reason); this.name = "ReadDbError"; }
}
const reasons: Readonly<Record<string, ReadDbReason>> = {
  ECONNREFUSED: "DB_UNAVAILABLE", ENOTFOUND: "DB_UNAVAILABLE", EAI_AGAIN: "DB_UNAVAILABLE",
  ECONNRESET: "DB_UNAVAILABLE", EPIPE: "DB_UNAVAILABLE", PROTOCOL_CONNECTION_LOST: "DB_UNAVAILABLE",
  ER_ACCESS_DENIED_ERROR: "DB_UNAVAILABLE", ER_CON_COUNT_ERROR: "DB_UNAVAILABLE",
  ER_NO_SUCH_TABLE: "DB_SCHEMA", ER_BAD_FIELD_ERROR: "DB_SCHEMA", ER_BAD_DB_ERROR: "DB_SCHEMA",
  ETIMEDOUT: "DB_TIMEOUT", ER_LOCK_WAIT_TIMEOUT: "DB_TIMEOUT", ER_QUERY_TIMEOUT: "DB_TIMEOUT",
  ER_QUERY_INTERRUPTED: "DB_TIMEOUT", PROTOCOL_SEQUENCE_TIMEOUT: "DB_TIMEOUT",
};
export function safeReadDbError(error: unknown): ReadDbError {
  const visited = new Set<object>();
  while (error && typeof error === "object" && !visited.has(error)) {
    visited.add(error);
    if (error instanceof ReadDbError) return new ReadDbError(error.reason);
    const value = error as { code?: unknown; cause?: unknown };
    if (typeof value.code === "string" && Object.hasOwn(reasons, value.code)) return new ReadDbError(reasons[value.code]);
    error = value.cause;
  }
  return new ReadDbError("DB_READ_FAILED");
}
const tables = new Set([
  "conversation_sessions", "inbound_sms", "gmail_thread_meta", "madison_email_drafts",
  "openphone_call_recordings", "voice_calls", "call_log", "field_mgmt_calls", "confirmation_calls",
  "bookings", "leadflow_jobs", "booking_series",
]);
/** Closed transport guard for our constant, parameterized projections, not a
 * general-purpose SQL executor. Bind values separately; identifiers stay literal. */
export function assertReadSelect(sql: string): void {
  if (!/^SELECT\s/i.test(sql) || /[;'"\\#@]|--|\/\*|\*\/|:=/.test(sql)
    || /\b(?:INSERT|UPDATE|DELETE|REPLACE|ALTER|DROP|CREATE|TRUNCATE|CALL|DO|SET|INTO|FOR|LOCK|UNLOCK|UNION|SLEEP|BENCHMARK|LOAD_FILE|GET_LOCK|RELEASE_LOCK)\b/i.test(sql)) throw new ReadDbError("DB_READ_FAILED");
  const matches = [...Array.from(sql.matchAll(/\b(?:FROM|JOIN)\s+`([a-z_]+)`/gi))];
  if (!matches.length || matches.some(match => !tables.has(match[1]))
    || /\b(?:FROM|JOIN)\s+(?!`)/i.test(sql)) throw new ReadDbError("DB_READ_FAILED");
}
export type InstallationReadScope = Pick<AuthorizedScope, "installationScope" | "sourceAccountKey" | "authorizationVersion">;

/** Narrow injectable driver seam. The default driver is imported only on first
 * authorized SELECT/snapshot, and DATABASE_URL is read only at that point. */
export interface ReadConnection {
  query(sql: string, params?: unknown[]): Promise<readonly [unknown, unknown]>;
  release(): void;
  destroy(): void;
}
export interface ReadPool {
  query(sql: string, params?: unknown[]): Promise<readonly [unknown, unknown]>;
  getConnection(): Promise<ReadConnection>;
  end(): Promise<void>;
}
export interface LazyReadDbOptions {
  readonly databaseUrl?: () => string | undefined;
  readonly driver?: (url: string) => Promise<ReadPool>;
}
export function createLazyReadDb(options: LazyReadDbOptions = {}): ReadDb & { close(): Promise<void> } {
  let poolPromise: Promise<ReadPool> | undefined;
  const pool = (): Promise<ReadPool> => {
    if (!poolPromise) {
      poolPromise = (async () => {
        const url = (options.databaseUrl ?? (() => process.env.DATABASE_URL))();
        if (!url) throw new ReadDbError("DB_UNAVAILABLE");
        if (options.driver) return options.driver(url);
        const mysql = await import("mysql2/promise");
        return mysql.createPool({ uri: url, supportBigNumbers: true, bigNumberStrings: true, dateStrings: false, timezone: "Z" }) as unknown as ReadPool;
      })().catch(error => { poolPromise = undefined; throw safeReadDbError(error); });
    }
    return poolPromise;
  };
  const query = async (transport: Pick<ReadPool, "query">, sql: string, params: readonly SqlValue[] = []): Promise<SqlRow[]> => {
    assertReadSelect(sql);
    try {
      const [rows] = await transport.query(sql, [...params]);
      if (!Array.isArray(rows) || rows.some(row => !row || typeof row !== "object" || Array.isArray(row))) throw new ReadDbError("DB_READ_FAILED");
      return rows as SqlRow[];
    } catch (error) { throw safeReadDbError(error); }
  };
  return Object.freeze({
    select: async (sql: string, params: readonly SqlValue[] = []) => {
      assertReadSelect(sql); // reject before acquiring a connection
      return query(await pool(), sql, params);
    },
    snapshot: async <T>(read: (port: SelectPort) => Promise<T>): Promise<T> => {
      let connection: ReadConnection | undefined;
      let active = false;
      let readPhase = false;
      try {
        connection = await (await pool()).getConnection();
        const owned = connection;
        await owned.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
        await owned.query("BEGIN");
        active = true; readPhase = true;
        const port: SelectPort = Object.freeze({ select: (sql: string, params?: readonly SqlValue[]) => {
          if (!active) return Promise.reject(new ReadDbError("DB_READ_FAILED"));
          return query(owned, sql, params);
        } });
        const result = await read(port);
        active = false; readPhase = false;
        await owned.query("COMMIT");
        owned.release(); connection = undefined;
        return result;
      } catch (error) {
        active = false;
        if (connection) {
          let reusable = false;
          if (readPhase) { try { await connection.query("ROLLBACK"); reusable = true; } catch { /* disposal below */ } }
          try { if (reusable) connection.release(); else connection.destroy(); } catch { try { connection.destroy(); } catch { /* disposed */ } }
        }
        throw safeReadDbError(error);
      }
    },
    close: async () => { if (poolPromise) { const current = poolPromise; poolPromise = undefined; await (await current).end(); } },
  });
}
