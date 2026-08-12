import path from "path";
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
    const fake = createFakeDb();
    const results = await runManagedMigrations({ db: fake.db, migrationsDirectory: migrationDirectory, logger: console });
    expect(results).toEqual([{ id: "0001_create_focus_points", outcome: "applied" }]);
    expect(fake.state()).toEqual({ tableExists: true, ledgerState: "applied" });
    expect(fake.calls.some(sql => sql.includes("RELEASE_LOCK"))).toBe(true);
  });

  it("recovers a correct existing table without rerunning CREATE TABLE", async () => {
    const fake = createFakeDb({ tableExists: true, ledgerState: "started" });
    const results = await runManagedMigrations({ db: fake.db, migrationsDirectory: migrationDirectory, logger: console });
    expect(results).toEqual([{ id: "0001_create_focus_points", outcome: "recovered" }]);
    expect(fake.calls.some(sql => sql.includes("CREATE TABLE IF NOT EXISTS `focus_points`"))).toBe(false);
    expect(fake.state().ledgerState).toBe("applied");
  });

  it("fails closed and releases the lock when an existing table is divergent", async () => {
    const fake = createFakeDb({ tableExists: true, divergent: true });
    await expect(runManagedMigrations({ db: fake.db, migrationsDirectory: migrationDirectory, logger: console }))
      .rejects.toBeInstanceOf(ManagedMigrationError);
    expect(fake.calls.some(sql => sql.includes("CREATE TABLE IF NOT EXISTS `focus_points`"))).toBe(false);
    expect(fake.state().ledgerState).toBe("failed");
    expect(fake.calls.some(sql => sql.includes("RELEASE_LOCK"))).toBe(true);
  });

  it("fails when an applied migration later drifts", async () => {
    const fake = createFakeDb({ tableExists: true, divergent: true, ledgerState: "applied" });
    await expect(runManagedMigrations({ db: fake.db, migrationsDirectory: migrationDirectory, logger: console }))
      .rejects.toThrow("schema drift");
    expect(fake.calls.some(sql => sql.includes("CREATE TABLE IF NOT EXISTS `focus_points`"))).toBe(false);
  });
});
