import path from "path";
import { createHash } from "crypto";
import { mkdtemp, readFile, rm, writeFile } from "fs/promises";
import os from "os";
import { describe, expect, it } from "vitest";
import type { MigrationDb } from "./contracts.js";
import { evaluatePostconditions, normalizeColumnType, normalizeDefault } from "./postconditions.js";
import { ManagedMigrationError, runManagedMigrations } from "./managedRunner.js";

const migrationDirectory = path.resolve(process.cwd(), "server", "versioned-migrations");

const validColumns = [
  { column_name: "id", column_type: "int", is_nullable: "NO", extra: "auto_increment", column_default: null },
  { column_name: "agentName", column_type: "varchar(128)", is_nullable: "NO", extra: "", column_default: null },
  { column_name: "points", column_type: "int", is_nullable: "NO", extra: "", column_default: "0" },
  { column_name: "weekStart", column_type: "varchar(10)", is_nullable: "NO", extra: "", column_default: null },
  { column_name: "createdAt", column_type: "datetime(3)", is_nullable: "NO", extra: "", column_default: null },
  { column_name: "updatedAt", column_type: "datetime(3)", is_nullable: "NO", extra: "", column_default: null },
];

const validIndexes = [
  { index_name: "PRIMARY", non_unique: "0", seq_in_index: 1, column_name: "id" },
  { index_name: "uq_focus_points_agent_week", non_unique: "0", seq_in_index: 1, column_name: "agentName" },
  { index_name: "uq_focus_points_agent_week", non_unique: "0", seq_in_index: 2, column_name: "weekStart" },
  { index_name: "idx_focus_points_week", non_unique: "1", seq_in_index: 1, column_name: "weekStart" },
];

const additiveSql = "ALTER TABLE `conversation_sessions`\n  ADD COLUMN IF NOT EXISTS `lastInboundPhoneNumberId` varchar(64) NULL;\n";
const additiveSha256 = createHash("sha256").update(additiveSql).digest("hex");
const additivePostconditions = {
  format: 1,
  table: "conversation_sessions",
  columns: [{ name: "lastInboundPhoneNumberId", columnType: "varchar(64)", nullable: true }],
  indexes: [],
};

async function withAdditiveMigrationDirectory<T>(run: (directory: string) => Promise<T>): Promise<T> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "managed-additive-columns-"));
  try {
    await Promise.all([
      writeFile(
        path.join(directory, "manifest.json"),
        JSON.stringify({
          format: 1,
          migrations: [{
            id: "0002_last_inbound_phone_number_id",
            mode: "additive-columns-existing-table",
            sqlFile: "0002_last_inbound_phone_number_id.sql",
            sha256: additiveSha256,
            replayMode: "verified-idempotent",
            postconditionsFile: "0002_last_inbound_phone_number_id.postconditions.json",
          }],
        }),
      ),
      writeFile(path.join(directory, "0002_last_inbound_phone_number_id.sql"), additiveSql),
      writeFile(
        path.join(directory, "0002_last_inbound_phone_number_id.postconditions.json"),
        JSON.stringify(additivePostconditions),
      ),
    ]);
    return await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function withCreateTableMigrationDirectory<T>(run: (directory: string) => Promise<T>): Promise<T> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "managed-create-table-"));
  try {
    const [sql, postconditions] = await Promise.all([
      readFile(path.join(migrationDirectory, "0001_create_focus_points.sql"), "utf8"),
      readFile(path.join(migrationDirectory, "0001_create_focus_points.postconditions.json"), "utf8"),
    ]);
    const sha256 = createHash("sha256").update(sql).digest("hex");
    await Promise.all([
      writeFile(path.join(directory, "manifest.json"), JSON.stringify({
        format: 1,
        migrations: [{
          id: "0001_create_focus_points",
          sqlFile: "0001_create_focus_points.sql",
          sha256,
          replayMode: "verified-idempotent",
          postconditionsFile: "0001_create_focus_points.postconditions.json",
        }],
      })),
      writeFile(path.join(directory, "0001_create_focus_points.sql"), sql),
      writeFile(path.join(directory, "0001_create_focus_points.postconditions.json"), postconditions),
    ]);
    return await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function createAdditiveFakeDb(options: {
  tableExists?: boolean;
  columnState?: "missing" | "correct" | "wrong-type" | "wrong-nullability";
  ledgerState?: "started" | "applied" | "failed";
  interruptBeforeAppliedOnce?: boolean;
} = {}) {
  let tableExists = options.tableExists ?? true;
  let columnState = options.columnState ?? "missing";
  let ledgerState = options.ledgerState;
  let interruptBeforeAppliedOnce = options.interruptBeforeAppliedOnce ?? false;
  const calls: string[] = [];
  const db: MigrationDb = {
    async query(sql: string): Promise<any> {
      calls.push(sql);
      if (sql.includes("GET_LOCK")) return [[{ acquired: 1 }]];
      if (sql.includes("RELEASE_LOCK")) return [[{ released: 1 }]];
      if (sql.includes("SELECT migration_id")) {
        return [ledgerState ? [{
          migration_id: "0002_last_inbound_phone_number_id",
          sha256: additiveSha256,
          state: ledgerState,
          attempt_count: 1,
        }] : []];
      }
      if (sql.includes("information_schema.tables")) {
        return [tableExists ? [{ table_name: "conversation_sessions" }] : []];
      }
      if (sql.includes("information_schema.columns")) {
        if (columnState === "missing") return [[]];
        if (columnState === "wrong-type") {
          return [[{ column_name: "lastInboundPhoneNumberId", column_type: "varchar(32)", is_nullable: "YES", extra: "", column_default: null }]];
        }
        if (columnState === "wrong-nullability") {
          return [[{ column_name: "lastInboundPhoneNumberId", column_type: "varchar(64)", is_nullable: "NO", extra: "", column_default: null }]];
        }
        return [[{ column_name: "lastInboundPhoneNumberId", column_type: "varchar(64)", is_nullable: "YES", extra: "", column_default: null }]];
      }
      if (sql.includes("information_schema.statistics")) return [[]];
      if (sql.includes("ADD COLUMN IF NOT EXISTS `lastInboundPhoneNumberId`")) {
        columnState = "correct";
        return [[]];
      }
      if (sql.includes("INSERT INTO `app_versioned_migration_ledger`")) {
        ledgerState = "started";
        return [[]];
      }
      if (sql.includes("SET state = 'applied'")) {
        if (interruptBeforeAppliedOnce) {
          interruptBeforeAppliedOnce = false;
          throw new Error("simulated interruption after ALTER before ledger apply");
        }
        ledgerState = "applied";
        return [[]];
      }
      if (sql.includes("SET state = 'failed'")) {
        // Preserve started to model a process interruption before the ledger could be updated.
        return [[]];
      }
      return [[]];
    },
  };
  return { db, calls, state: () => ({ tableExists, columnState, ledgerState }) };
}

function createFakeDb(options: { tableExists?: boolean; divergent?: boolean; ledgerState?: "started" | "applied" | "failed" } = {}) {
  let tableExists = options.tableExists ?? false;
  let ledgerState = options.ledgerState;
  const calls: string[] = [];
  const db: MigrationDb = {
    async query(sql: string): Promise<any> {
      calls.push(sql);
      if (sql.includes("GET_LOCK")) return [[{ acquired: 1 }]];
      if (sql.includes("RELEASE_LOCK")) return [[{ released: 1 }]];
      if (sql.includes("SELECT migration_id")) {
        return [ledgerState ? [{ migration_id: "0001_create_focus_points", sha256: "5caaaf2b058c48caff1561e9e8d571a5fbad5f67f9888df037f93eff0b0cd5f4", state: ledgerState, attempt_count: 1 }] : []];
      }
      if (sql.includes("information_schema.tables")) return [tableExists ? [{ table_name: "focus_points" }] : []];
      if (sql.includes("information_schema.columns")) {
        const rows = options.divergent ? validColumns.filter(column => column.column_name !== "weekStart") : validColumns;
        return [rows];
      }
      if (sql.includes("information_schema.statistics")) return [validIndexes];
      if (sql.includes("CREATE TABLE IF NOT EXISTS `focus_points`")) {
        tableExists = true;
        return [[]];
      }
      if (sql.includes("INSERT INTO `app_versioned_migration_ledger`")) {
        ledgerState = "started";
        return [[]];
      }
      if (sql.includes("SET state = 'applied'")) {
        ledgerState = "applied";
        return [[]];
      }
      if (sql.includes("SET state = 'failed'")) {
        ledgerState = "failed";
        return [[]];
      }
      return [[]];
    },
  };
  return { db, calls, state: () => ({ tableExists, ledgerState }) };
}

function createApplied0001Pending0002FakeDb() {
  let phoneColumnState: "missing" | "correct" = "missing";
  const ledger = new Map<string, "started" | "applied" | "failed">([["0001_create_focus_points", "applied"]]);
  const calls: string[] = [];
  const db: MigrationDb = {
    async query(sql: string, params?: unknown[]): Promise<any> {
      calls.push(sql);
      if (sql.includes("GET_LOCK")) return [[{ acquired: 1 }]];
      if (sql.includes("RELEASE_LOCK")) return [[{ released: 1 }]];
      if (sql.includes("SELECT migration_id")) {
        const id = String(params?.[0]);
        const state = ledger.get(id);
        const sha256 = id === "0001_create_focus_points"
          ? "5caaaf2b058c48caff1561e9e8d571a5fbad5f67f9888df037f93eff0b0cd5f4"
          : additiveSha256;
        return [state ? [{ migration_id: id, sha256, state, attempt_count: 1 }] : []];
      }
      if (sql.includes("information_schema.tables")) return [[{ table_name: String(params?.[0]) }]];
      if (sql.includes("information_schema.columns")) {
        return [String(params?.[0]) === "focus_points"
          ? validColumns
          : phoneColumnState === "correct"
            ? [{ column_name: "lastInboundPhoneNumberId", column_type: "varchar(64)", is_nullable: "YES", extra: "", column_default: null }]
            : []];
      }
      if (sql.includes("information_schema.statistics")) {
        return [String(params?.[0]) === "focus_points" ? validIndexes : []];
      }
      if (sql.includes("ADD COLUMN IF NOT EXISTS `lastInboundPhoneNumberId`")) {
        phoneColumnState = "correct";
        return [[]];
      }
      if (sql.includes("INSERT INTO `app_versioned_migration_ledger`")) {
        ledger.set(String(params?.[0]), "started");
        return [[]];
      }
      if (sql.includes("SET state = 'applied'")) {
        ledger.set(String(params?.[0]), "applied");
        return [[]];
      }
      if (sql.includes("SET state = 'failed'")) {
        ledger.set(String(params?.[1]), "failed");
        return [[]];
      }
      return [[]];
    },
  };
  return { db, calls, state: () => ({ phoneColumnState, ledger: new Map(ledger) }) };
}

describe("managed versioned migration runner", () => {
  it("normalizes harmless TiDB/MySQL display differences but not schema semantics", () => {
    expect(normalizeColumnType(" INT(11)  UNSIGNED ")).toBe("int unsigned");
    expect(normalizeDefault("(CURRENT_TIMESTAMP())")).toBe("current_timestamp");
    const result = evaluatePostconditions(
      {
        format: 1,
        table: "example",
        columns: [{ name: "id", columnType: "int", nullable: false, autoIncrement: true }],
        indexes: [{ name: "PRIMARY", unique: true, columns: ["id"] }],
      },
      true,
      [{ name: "id", columnType: "int(11)", nullable: false, autoIncrement: true, default: null }],
      [{ name: "PRIMARY", unique: true, columns: ["id"] }],
    );
    expect(result.valid).toBe(true);
  });

  it("creates a missing focus_points table, verifies it, and records applied", async () => {
    await withCreateTableMigrationDirectory(async directory => {
      const fake = createFakeDb();
      const events: string[] = [];
      const logger = {
        info: (event: string) => events.push(event),
        error: () => undefined,
      };
      const results = await runManagedMigrations({ db: fake.db, migrationsDirectory: directory, logger });
      expect(results).toEqual([{ id: "0001_create_focus_points", outcome: "applied" }]);
      expect(fake.state()).toEqual({ tableExists: true, ledgerState: "applied" });
      expect(fake.calls.some(sql => sql.includes("RELEASE_LOCK"))).toBe(true);
      expect(events).toEqual([
        "migration_lock_acquired",
        "migration_started",
        "migration_postconditions_passed",
        "migration_applied",
        "migration_lock_released",
      ]);
    });
  });

  it("recovers a correct existing table without rerunning CREATE TABLE", async () => {
    await withCreateTableMigrationDirectory(async directory => {
      const fake = createFakeDb({ tableExists: true, ledgerState: "started" });
      const results = await runManagedMigrations({ db: fake.db, migrationsDirectory: directory, logger: console });
      expect(results).toEqual([{ id: "0001_create_focus_points", outcome: "recovered" }]);
      expect(fake.calls.some(sql => sql.includes("CREATE TABLE IF NOT EXISTS `focus_points`"))).toBe(false);
      expect(fake.state().ledgerState).toBe("applied");
    });
  });

  it("fails closed and releases the lock when an existing table is divergent", async () => {
    await withCreateTableMigrationDirectory(async directory => {
      const fake = createFakeDb({ tableExists: true, divergent: true });
      await expect(runManagedMigrations({ db: fake.db, migrationsDirectory: directory, logger: console }))
        .rejects.toBeInstanceOf(ManagedMigrationError);
      expect(fake.calls.some(sql => sql.includes("CREATE TABLE IF NOT EXISTS `focus_points`"))).toBe(false);
      expect(fake.state().ledgerState).toBe("failed");
      expect(fake.calls.some(sql => sql.includes("RELEASE_LOCK"))).toBe(true);
    });
  });

  it("fails when an applied migration later drifts", async () => {
    await withCreateTableMigrationDirectory(async directory => {
      const fake = createFakeDb({ tableExists: true, divergent: true, ledgerState: "applied" });
      await expect(runManagedMigrations({ db: fake.db, migrationsDirectory: directory, logger: console }))
        .rejects.toThrow("schema drift");
      expect(fake.calls.some(sql => sql.includes("CREATE TABLE IF NOT EXISTS `focus_points`"))).toBe(false);
    });
  });

  it("keeps unmodeled 0001 in create-table mode", async () => {
    await withCreateTableMigrationDirectory(async directory => {
      const fake = createFakeDb();
      await runManagedMigrations({ db: fake.db, migrationsDirectory: directory, logger: console });
      expect(fake.calls.some(sql => sql.includes("CREATE TABLE IF NOT EXISTS `focus_points`"))).toBe(true);
    });
  });

  it("skips and re-verifies applied 0001 before executing one additive ALTER for pending 0002", async () => {
    const fake = createApplied0001Pending0002FakeDb();
    const results = await runManagedMigrations({ db: fake.db, migrationsDirectory: migrationDirectory, logger: console });
    expect(results).toEqual([
      { id: "0001_create_focus_points", outcome: "skipped" },
      { id: "0002_last_inbound_phone_number_id", outcome: "applied" },
    ]);
    expect(fake.calls.some(sql => sql.includes("CREATE TABLE IF NOT EXISTS `focus_points`"))).toBe(false);
    expect(fake.calls.filter(sql => sql.includes("ADD COLUMN IF NOT EXISTS `lastInboundPhoneNumberId`")).length).toBe(1);
    expect(fake.state().phoneColumnState).toBe("correct");
    expect(fake.state().ledger.get("0001_create_focus_points")).toBe("applied");
    expect(fake.state().ledger.get("0002_last_inbound_phone_number_id")).toBe("applied");
  });

  it("executes additive SQL only for an existing table with a missing declared column", async () => {
    await withAdditiveMigrationDirectory(async directory => {
      const fake = createAdditiveFakeDb({ columnState: "missing" });
      const results = await runManagedMigrations({ db: fake.db, migrationsDirectory: directory, logger: console });
      expect(results).toEqual([{ id: "0002_last_inbound_phone_number_id", outcome: "applied" }]);
      expect(fake.calls.filter(sql => sql.includes("ADD COLUMN IF NOT EXISTS `lastInboundPhoneNumberId`")).length).toBe(1);
      expect(fake.state()).toEqual({ tableExists: true, columnState: "correct", ledgerState: "applied" });
    });
  });

  it("recovers a correct additive column without rerunning SQL", async () => {
    await withAdditiveMigrationDirectory(async directory => {
      const fake = createAdditiveFakeDb({ columnState: "correct", ledgerState: "started" });
      const results = await runManagedMigrations({ db: fake.db, migrationsDirectory: directory, logger: console });
      expect(results).toEqual([{ id: "0002_last_inbound_phone_number_id", outcome: "recovered" }]);
      expect(fake.calls.some(sql => sql.includes("ADD COLUMN IF NOT EXISTS `lastInboundPhoneNumberId`"))).toBe(false);
      expect(fake.state().ledgerState).toBe("applied");
    });
  });

  it.each(["wrong-type", "wrong-nullability"] as const)("fails closed for a %s additive column without SQL", async columnState => {
    await withAdditiveMigrationDirectory(async directory => {
      const fake = createAdditiveFakeDb({ columnState });
      await expect(runManagedMigrations({ db: fake.db, migrationsDirectory: directory, logger: console }))
        .rejects.toBeInstanceOf(ManagedMigrationError);
      expect(fake.calls.some(sql => sql.includes("ADD COLUMN IF NOT EXISTS `lastInboundPhoneNumberId`"))).toBe(false);
    });
  });

  it("fails closed without SQL when the additive target table is missing", async () => {
    await withAdditiveMigrationDirectory(async directory => {
      const fake = createAdditiveFakeDb({ tableExists: false });
      await expect(runManagedMigrations({ db: fake.db, migrationsDirectory: directory, logger: console }))
        .rejects.toBeInstanceOf(ManagedMigrationError);
      expect(fake.calls.some(sql => sql.includes("ADD COLUMN IF NOT EXISTS `lastInboundPhoneNumberId`"))).toBe(false);
    });
  });

  it("recovers after an interruption between successful ALTER and ledger apply without replaying SQL", async () => {
    await withAdditiveMigrationDirectory(async directory => {
      const fake = createAdditiveFakeDb({ columnState: "missing", interruptBeforeAppliedOnce: true });
      await expect(runManagedMigrations({ db: fake.db, migrationsDirectory: directory, logger: console }))
        .rejects.toThrow("simulated interruption");
      expect(fake.state()).toEqual({ tableExists: true, columnState: "correct", ledgerState: "started" });

      const results = await runManagedMigrations({ db: fake.db, migrationsDirectory: directory, logger: console });
      expect(results).toEqual([{ id: "0002_last_inbound_phone_number_id", outcome: "recovered" }]);
      expect(fake.calls.filter(sql => sql.includes("ADD COLUMN IF NOT EXISTS `lastInboundPhoneNumberId`")).length).toBe(1);
      expect(fake.state().ledgerState).toBe("applied");
    });
  });
});
