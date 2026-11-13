import { drizzle, type MySql2Database } from "drizzle-orm/mysql2";
import type { Connection, Pool, PoolConnection } from "mysql2/promise";

export type AuditSnapshotReason = "DB_UNAVAILABLE" | "DB_UNSUPPORTED" | "DB_SCHEMA" | "DB_TIMEOUT" | "DB_READ_FAILED";
export class AuditSnapshotError extends Error {
  constructor(readonly reason: AuditSnapshotReason) {
    super(reason === "DB_UNAVAILABLE"
      ? "Audit database is unavailable; no verification was performed."
      : "Audit snapshot read failed; no verification was performed.");
    this.name = "AuditSnapshotError";
  }
}

// Exact driver codes only, never message/SQL/parameter inspection. Drizzle wraps
// driver errors in cause; bound traversal also handles cycles without recursion.
const CODE_REASONS: Readonly<Record<string, AuditSnapshotReason>> = {
  ECONNREFUSED: "DB_UNAVAILABLE", ENOTFOUND: "DB_UNAVAILABLE", EAI_AGAIN: "DB_UNAVAILABLE",
  ECONNRESET: "DB_UNAVAILABLE", EPIPE: "DB_UNAVAILABLE", PROTOCOL_CONNECTION_LOST: "DB_UNAVAILABLE",
  ER_ACCESS_DENIED_ERROR: "DB_UNAVAILABLE", ER_CON_COUNT_ERROR: "DB_UNAVAILABLE",
  ERR_NOT_SUPPORTED_YET: "DB_UNSUPPORTED", ER_NOT_SUPPORTED_YET: "DB_UNSUPPORTED",
  ER_NO_SUCH_TABLE: "DB_SCHEMA", ER_BAD_FIELD_ERROR: "DB_SCHEMA", ER_BAD_DB_ERROR: "DB_SCHEMA",
  ETIMEDOUT: "DB_TIMEOUT", ER_LOCK_WAIT_TIMEOUT: "DB_TIMEOUT", ER_QUERY_TIMEOUT: "DB_TIMEOUT",
  ER_QUERY_INTERRUPTED: "DB_TIMEOUT", PROTOCOL_SEQUENCE_TIMEOUT: "DB_TIMEOUT",
};
function safeError(error: unknown): AuditSnapshotError {
  for (let depth = 0; depth < 5 && error && typeof error === "object"; depth++) {
    if (error instanceof AuditSnapshotError) return new AuditSnapshotError(error.reason);
    const value = error as { code?: unknown; errno?: unknown; cause?: unknown };
    const reason = typeof value.code === "string" && Object.hasOwn(CODE_REASONS, value.code) ? CODE_REASONS[value.code] : undefined;
    if (reason) return new AuditSnapshotError(reason);
    if (value.errno === 1235) return new AuditSnapshotError("DB_UNSUPPORTED");
    error = value.cause;
  }
  return new AuditSnapshotError("DB_READ_FAILED");
}

// This is a narrow guard for ORM-generated SELECTs, not a general SQL parser.
// Quoted literals/identifiers are skipped; comments, escapes, statements and
// locking/INTO clauses fail closed, including nested raw SQL expressions.
function assertSelect(statement: string): void {
  const tokens = statement.replace(/'(?:''|[^'\\])*'|"(?:""|[^"\\])*"|`(?:``|[^`\\])*`/g, " ");
  if (!/^\s*select\s/i.test(tokens) || /[;'"`\\#@]|--|\/\*|\*\/|:=/.test(tokens)
    || /\b(?:into|for|lock|unlock|get_lock|release_lock|release_all_locks)\b/i.test(tokens)) {
    throw new AuditSnapshotError("DB_READ_FAILED");
  }
}

type SnapshotDatabase = { readonly $client: unknown };
type SnapshotReader = Readonly<Pick<MySql2Database, "select">>;

/** One leased connection; the first SELECT establishes the REPEATABLE READ
 * snapshot. No READ ONLY/accessMode or TiDB noop setting, and no global settings.
 * All control SQL is constant and bypasses only the private SELECT transport.
 */
export async function readAuditSnapshot<T>(db: SnapshotDatabase, read: (reader: SnapshotReader) => Promise<T>): Promise<T> {
  let connection: PoolConnection | undefined;
  let phase: "setup" | "read" | "commit" | "release" = "setup";
  let active = false;
  try {
    const client = db?.$client;
    if (!client || typeof client !== "object") throw new AuditSnapshotError("DB_UNSUPPORTED");
    // Drizzle's public $client may be a callback pool; use its public adapter.
    const pool = "promise" in client && typeof client.promise === "function" ? client.promise() : client;
    if (!pool || typeof pool.getConnection !== "function") throw new AuditSnapshotError("DB_UNSUPPORTED");
    connection = await (pool as Pick<Pool, "getConnection">).getConnection();
    const owned = connection;
    await owned.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
    await owned.query("BEGIN");
    phase = "read";
    active = true;
    const transport = {
      query: ((options: string | { sql: string }, values?: unknown[]) => {
        if (!active) throw new AuditSnapshotError("DB_READ_FAILED");
        assertSelect(typeof options === "string" ? options : options.sql);
        return typeof options === "string" ? owned.query(options, values) : owned.query(options, values);
      }) as Connection["query"],
    };
    const readerDb = drizzle(transport as Connection, { logger: false });
    const reader: SnapshotReader = Object.freeze({ select: readerDb.select.bind(readerDb) });
    const result = await read(reader);
    active = false;
    phase = "commit";
    await owned.query("COMMIT");
    phase = "release";
    owned.release();
    connection = undefined;
    return result;
  } catch (error) {
    active = false;
    if (connection) {
      // SET is one-shot and BEGIN/COMMIT failures may have ambiguous state. Never
      // put such a connection back in the pool. Only a confirmed rollback is reusable.
      let reusable = false;
      if (phase === "read") {
        try { await connection.query("ROLLBACK"); reusable = true; } catch { /* destroy below */ }
      }
      if (reusable) {
        try { connection.release(); } catch {
          try { connection.destroy(); } catch { /* disposal attempted, never retried */ }
        }
      } else {
        try { connection.destroy(); } catch { /* disposal attempted, never retried */ }
      }
    }
    throw safeError(error);
  }
}
