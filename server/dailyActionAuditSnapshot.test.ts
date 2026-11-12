import { describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { int, mysqlTable } from "drizzle-orm/mysql-core";
import { drizzle } from "drizzle-orm/mysql2";
import { AuditSnapshotError, readAuditSnapshot } from "./dailyActionAuditSnapshot";

const fixture = mysqlTable("audit_fixture", { id: int("id").notNull() });
const SECRET = "SQL with +17035551234 and confidential parameters";
const failure = (code = "UNKNOWN", errno?: number) => Object.assign(new Error(SECRET), { code, errno });
const SET = "SET TRANSACTION ISOLATION LEVEL REPEATABLE READ";

type Fault = "acquire" | "set" | "begin" | "select" | "commit" | "rollback" | "release" | "destroy";
/** The only fake is mysql2 transport. Each lease consumes a one-slot pool until
 * release/destroy; all queries and row mapping use the installed actual Drizzle.
 */
function offlinePool(faults: Partial<Record<Fault, unknown>> = {}) {
  const events: string[] = [];
  const connections: Array<{ query: ReturnType<typeof vi.fn>; release: ReturnType<typeof vi.fn>; destroy: ReturnType<typeof vi.fn> }> = [];
  let occupied = false;
  const pool = {
    query: vi.fn(() => { throw new Error("Pool query is forbidden"); }),
    getConnection: vi.fn(async () => {
      events.push("acquire");
      if (faults.acquire) throw faults.acquire;
      if (occupied) throw new Error("Pool exhausted: leaked lease");
      occupied = true;
      const connection = {
        query: vi.fn(async (options: string | { sql: string }, _values?: unknown[]) => {
          const statement = typeof options === "string" ? options : options.sql;
          events.push(statement);
          if (statement === SET && faults.set) throw faults.set;
          if (statement === "BEGIN" && faults.begin) throw faults.begin;
          if (/^start transaction read only$/i.test(statement)) throw failure("ERR_NOT_SUPPORTED_YET", 1235);
          if (/^select /i.test(statement)) {
            if (faults.select) throw faults.select;
            return [[[7]], []];
          }
          if (statement === "COMMIT" && faults.commit) throw faults.commit;
          if (statement === "ROLLBACK" && faults.rollback) throw faults.rollback;
          if (!/^(set transaction isolation level repeatable read|begin|commit|rollback)$/i.test(statement)) throw new Error("Unexpected control SQL");
          return [{ affectedRows: 0 }, []];
        }),
        release: vi.fn(() => {
          events.push("release");
          if (faults.release) throw faults.release;
          occupied = false;
        }),
        destroy: vi.fn(() => {
          events.push("destroy");
          occupied = false;
          if (faults.destroy) throw faults.destroy;
        }),
      };
      connections.push(connection);
      return connection;
    }),
  };
  return { db: drizzle(pool as any), pool, connections, events, faults };
}
const read = (db: Parameters<typeof readAuditSnapshot>[0]) => readAuditSnapshot(db, reader => reader.select({ id: fixture.id }).from(fixture));
async function rejected(promise: Promise<unknown>, reason: AuditSnapshotError["reason"] = "DB_READ_FAILED") {
  const error = await promise.then(() => { throw new Error("Expected rejection"); }, error => error);
  expect(error).toBeInstanceOf(AuditSnapshotError);
  expect(error.reason).toBe(reason);
  expect(error.message).toBe(reason === "DB_UNAVAILABLE" ? "Audit database is unavailable; no verification was performed." : "Audit snapshot read failed; no verification was performed.");
  expect(error.message).not.toContain(SECRET);
  expect(error).not.toHaveProperty("cause");
  expect(error).not.toHaveProperty("sql");
  expect(error).not.toHaveProperty("params");
  return error;
}

describe("owned audit snapshot", () => {
  it("proves the old installed Drizzle path fails 1235 before SELECT and leaks its lease", async () => {
    const mock = offlinePool();
    await expect(mock.db.transaction(tx => tx.select({ id: fixture.id }).from(fixture), {
      isolationLevel: "repeatable read", accessMode: "read only",
    })).rejects.toMatchObject({ cause: { code: "ERR_NOT_SUPPORTED_YET", errno: 1235 } });
    expect(mock.events).toEqual(["acquire", "set transaction isolation level repeatable read", "start transaction read only"]);
    expect(mock.connections[0].release).not.toHaveBeenCalled();
    expect(mock.connections[0].destroy).not.toHaveBeenCalled();
    await expect(mock.pool.getConnection()).rejects.toThrow("Pool exhausted");
    // Dispose only the synthetic leaked transport after proving the regression.
    mock.connections[0].destroy();
    mock.events.length = 0;
    expect(await read(mock.db)).toEqual([{ id: 7 }]);
    expect(mock.events).toEqual(["acquire", SET, "BEGIN", "select `id` from `audit_fixture`", "COMMIT", "release"]);
    expect(mock.pool.query).not.toHaveBeenCalled();
  });
  it("returns mapped rows only after commit and releases exactly once", async () => {
    const mock = offlinePool();
    await expect(read(mock.db)).resolves.toEqual([{ id: 7 }]);
    expect(mock.pool.getConnection).toHaveBeenCalledTimes(1);
    expect(mock.connections[0].release).toHaveBeenCalledTimes(1);
    expect(mock.connections[0].destroy).not.toHaveBeenCalled();
    expect(mock.events).toEqual(["acquire", SET, "BEGIN", "select `id` from `audit_fixture`", "COMMIT", "release"]);
  });
  it("supports a public callback-pool promise adapter without mutating the pool", async () => {
    const mock = offlinePool();
    const promise = vi.fn(() => mock.pool);
    expect(await read({ $client: { promise } })).toEqual([{ id: 7 }]);
    expect(promise).toHaveBeenCalledTimes(1);
    expect(Object.keys(mock.pool).sort()).toEqual(["getConnection", "query"]);
  });
  it.each([undefined, {}, { query: vi.fn() }])("fails closed for an unsupported public client", async client => {
    const callback = vi.fn();
    await rejected(readAuditSnapshot({ $client: client }, callback), "DB_UNSUPPORTED");
    expect(callback).not.toHaveBeenCalled();
  });
  it("acquire failure has no lease to dispose and is never retried", async () => {
    const mock = offlinePool({ acquire: failure("ECONNREFUSED") });
    await rejected(read(mock.db), "DB_UNAVAILABLE");
    expect(mock.events).toEqual(["acquire"]);
    expect(mock.connections).toHaveLength(0);
    expect(mock.pool.getConnection).toHaveBeenCalledTimes(1);
    delete mock.faults.acquire;
    await expect(read(mock.db)).resolves.toEqual([{ id: 7 }]);
  });
  it.each(["set", "begin", "commit"] as const)("destroys an ambiguous %s failure without rollback, release, or retry", async stage => {
    const mock = offlinePool({ [stage]: failure() });
    await rejected(read(mock.db));
    const connection = mock.connections[0];
    expect(connection.destroy).toHaveBeenCalledTimes(1);
    expect(connection.release).not.toHaveBeenCalled();
    expect(mock.events).not.toContain("ROLLBACK");
    expect(mock.events.at(-1)).toBe("destroy");
    expect(mock.pool.getConnection).toHaveBeenCalledTimes(1);
    if (stage !== "commit") expect(mock.events.some(value => /^select /i.test(value))).toBe(false);
    delete mock.faults[stage];
    await expect(read(mock.db)).resolves.toEqual([{ id: 7 }]);
    expect(mock.pool.getConnection).toHaveBeenCalledTimes(2);
  });
  it("a SELECT failure rolls back then releases once and allows the next request", async () => {
    const mock = offlinePool({ select: failure("ER_BAD_FIELD_ERROR") });
    await rejected(read(mock.db), "DB_SCHEMA");
    expect(mock.events).toEqual(["acquire", SET, "BEGIN", "select `id` from `audit_fixture`", "ROLLBACK", "release"]);
    expect(mock.connections[0].release).toHaveBeenCalledTimes(1);
    expect(mock.connections[0].destroy).not.toHaveBeenCalled();
    expect(mock.pool.getConnection).toHaveBeenCalledTimes(1);
    delete mock.faults.select;
    await expect(read(mock.db)).resolves.toEqual([{ id: 7 }]);
  });
  it("callback failure rolls back and releases before a safe error is returned", async () => {
    const mock = offlinePool();
    await rejected(readAuditSnapshot(mock.db, async () => { throw failure(); }));
    expect(mock.events).toEqual(["acquire", SET, "BEGIN", "ROLLBACK", "release"]);
    expect(mock.connections[0].release).toHaveBeenCalledTimes(1);
  });
  it("rollback failure destroys once while preserving the original safe reason", async () => {
    const mock = offlinePool({ select: failure("ER_NO_SUCH_TABLE"), rollback: failure("ETIMEDOUT") });
    await rejected(read(mock.db), "DB_SCHEMA");
    expect(mock.events.slice(-2)).toEqual(["ROLLBACK", "destroy"]);
    expect(mock.connections[0].destroy).toHaveBeenCalledTimes(1);
    expect(mock.connections[0].release).not.toHaveBeenCalled();
    delete mock.faults.select; delete mock.faults.rollback;
    await expect(read(mock.db)).resolves.toEqual([{ id: 7 }]);
  });
  it.each([false, true])("release failure after successful commit/rollback destroys once (rollback=%s)", async rollback => {
    const mock = offlinePool({ release: failure(), ...(rollback ? { select: failure("ER_BAD_FIELD_ERROR") } : {}) });
    await rejected(read(mock.db), rollback ? "DB_SCHEMA" : "DB_READ_FAILED");
    expect(mock.events.slice(-3)).toEqual([rollback ? "ROLLBACK" : "COMMIT", "release", "destroy"]);
    expect(mock.connections[0].release).toHaveBeenCalledTimes(1);
    expect(mock.connections[0].destroy).toHaveBeenCalledTimes(1);
    delete mock.faults.release; delete mock.faults.select;
    await expect(read(mock.db)).resolves.toEqual([{ id: 7 }]);
  });
  it("a disposal exception is contained without repeated cleanup or raw details", async () => {
    const mock = offlinePool({ begin: failure("ERR_NOT_SUPPORTED_YET", 1235), destroy: failure() });
    await rejected(read(mock.db), "DB_UNSUPPORTED");
    expect(mock.connections[0].destroy).toHaveBeenCalledTimes(1);
    expect(mock.connections[0].release).not.toHaveBeenCalled();
    expect(mock.pool.getConnection).toHaveBeenCalledTimes(1);
  });
});

describe("runtime SELECT-only reader", () => {
  it("exposes exactly select, not transaction, execute, or write APIs", async () => {
    const mock = offlinePool();
    await readAuditSnapshot(mock.db, async reader => {
      expect(Object.keys(reader)).toEqual(["select"]);
      expect(Object.isFrozen(reader)).toBe(true);
      for (const key of ["execute", "insert", "update", "delete", "transaction", "$client"]) expect((reader as any)[key]).toBeUndefined();
      return reader.select({ id: fixture.id }).from(fixture);
    });
  });
  it.each(["update", "share"] as const)("blocks Drizzle FOR %s before transport", async lock => {
    const mock = offlinePool();
    await rejected(readAuditSnapshot(mock.db, reader => reader.select({ id: fixture.id }).from(fixture).for(lock)));
    expect(mock.events).toEqual(["acquire", SET, "BEGIN", "ROLLBACK", "release"]);
  });
  it.each([
    "1; DELETE FROM audit_fixture", "1 into outfile '/tmp/not-written'", "1 INTO @result", "1 lock in share mode",
    "get_lock('audit', 1)", "release_lock('audit')", "release_all_locks()", "1 /* hidden SQL */", "1 -- hidden SQL", "1 # hidden SQL",
    "1 for update", "1; select 2", "(@value := 1)", "'unterminated", "'escaped\\' INTO OUTFILE '/tmp/not-written'",
  ])("blocks unsafe raw SELECT expressions before transport: %s", async expression => {
    const mock = offlinePool();
    await rejected(readAuditSnapshot(mock.db, reader => reader.select({ value: sql.raw(expression) }).from(fixture)));
    expect(mock.events).toEqual(["acquire", SET, "BEGIN", "ROLLBACK", "release"]);
  });
  it("does not confuse quoted literals or parameter values with locking SQL", async () => {
    const mock = offlinePool();
    await readAuditSnapshot(mock.db, reader => reader.select({ value: sql`concat('for update; into', ${"; DELETE @private"})` }).from(fixture));
    expect(mock.events.at(-2)).toBe("COMMIT");
  });
  it("blocks a retained builder after commit without another SQL call", async () => {
    const mock = offlinePool();
    let retained: any;
    await readAuditSnapshot(mock.db, async reader => { retained = reader.select({ id: fixture.id }).from(fixture); });
    const before = [...mock.events];
    await expect(retained).rejects.toMatchObject({ cause: { reason: "DB_READ_FAILED" } });
    expect(mock.events).toEqual(before);
  });
});

describe("safe bounded driver classification", () => {
  it.each([
    ["ERR_NOT_SUPPORTED_YET", "DB_UNSUPPORTED"], ["ER_NOT_SUPPORTED_YET", "DB_UNSUPPORTED"],
    ["ER_NO_SUCH_TABLE", "DB_SCHEMA"], ["ER_BAD_FIELD_ERROR", "DB_SCHEMA"], ["ER_BAD_DB_ERROR", "DB_SCHEMA"],
    ["ETIMEDOUT", "DB_TIMEOUT"], ["ER_LOCK_WAIT_TIMEOUT", "DB_TIMEOUT"], ["ER_QUERY_TIMEOUT", "DB_TIMEOUT"],
    ["ER_QUERY_INTERRUPTED", "DB_TIMEOUT"], ["PROTOCOL_SEQUENCE_TIMEOUT", "DB_TIMEOUT"],
    ["ECONNREFUSED", "DB_UNAVAILABLE"], ["ECONNRESET", "DB_UNAVAILABLE"], ["PROTOCOL_CONNECTION_LOST", "DB_UNAVAILABLE"],
    ["ER_ACCESS_DENIED_ERROR", "DB_UNAVAILABLE"], ["ER_PARSE_ERROR", "DB_READ_FAILED"], ["constructor", "DB_READ_FAILED"],
  ] as const)("maps only allowlisted %s through Drizzle cause to %s", async (code, reason) => {
    const mock = offlinePool({ select: failure(code) });
    await rejected(read(mock.db), reason);
  });
  it("recognizes the explicit unsupported errno without message matching", async () => {
    await rejected(read(offlinePool({ begin: failure("OTHER", 1235) }).db), "DB_UNSUPPORTED");
    await rejected(read(offlinePool({ begin: new Error("ERR_NOT_SUPPORTED_YET 1235 SQL private") }).db));
  });
  it("does not use sqlState, SQL, arbitrary codes, or customer-bearing message heuristics", async () => {
    const error = Object.assign(new Error("timeout unavailable missing table " + SECRET), { sqlState: "42S02", sql: "ER_BAD_FIELD_ERROR", params: [SECRET] });
    await rejected(read(offlinePool({ select: error }).db));
  });
  it("bounds deep and cyclic causes", async () => {
    let deep: any = failure("ER_NO_SUCH_TABLE");
    for (let i = 0; i < 6; i++) deep = { cause: deep };
    await rejected(read(offlinePool({ begin: deep }).db));
    const cycle: any = { code: "UNKNOWN" }; cycle.cause = cycle;
    await rejected(read(offlinePool({ begin: cycle }).db));
  });
  it("normalizes a callback AuditSnapshotError without preserving a raw cause", async () => {
    const mock = offlinePool();
    await rejected(readAuditSnapshot(mock.db, async () => { throw new AuditSnapshotError("DB_SCHEMA"); }), "DB_SCHEMA");
  });
});
