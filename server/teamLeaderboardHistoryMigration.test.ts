import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { DatabaseColumn, DatabaseIndex, ManagedMigrationManifest, MigrationDb, TablePostconditions } from "./migrations/contracts";
import { runManagedMigrations } from "./migrations/managedRunner";
import { evaluatePostconditions } from "./migrations/postconditions";

const directory = path.resolve(import.meta.dirname, "versioned-migrations");
const ids = ["0079_create_team_review_runs", "0080_create_team_review_weeks"];
const checksum = (text: string) => createHash("sha256").update(text).digest("hex");
const oldManifestSha256 = "e7a00d200985df359725bc3a48bed47d269a40e71c6a09f4521e7bdaaa857e98";

type Schema = { table: string; columns: DatabaseColumn[]; indexes: DatabaseIndex[] };
/** Parse the actual deliberately narrow one-table SQL, not postconditions, so
 * tests fail when either the DDL or the expected metadata independently drifts.
 */
function parseCreateSql(sql: string): Schema {
  const table = sql.match(/CREATE TABLE IF NOT EXISTS `([a-z_]+)`/)?.[1];
  if (!table) throw new Error("Expected one idempotent CREATE TABLE");
  const columns: DatabaseColumn[] = [];
  const indexes: DatabaseIndex[] = [];
  for (const line of sql.split("\n")) {
    const column = line.match(/^\s+(\w+)\s+(CHAR\(\d+\)|VARCHAR\(\d+\)|(?:INT|BIGINT) UNSIGNED|JSON)\s+(.*),?$/i);
    if (column) {
      columns.push({ name: column[1], columnType: column[2].toLowerCase(), nullable: !/NOT NULL/i.test(column[3]), autoIncrement: false, default: null });
      continue;
    }
    const index = line.match(/^\s+(PRIMARY KEY|KEY (\w+))\s*\(([^)]+)\)/);
    if (index) indexes.push({ name: index[1] === "PRIMARY KEY" ? "PRIMARY" : index[2], unique: index[1] === "PRIMARY KEY", columns: index[3].split(",").map(value => value.trim()) });
  }
  return { table, columns, indexes };
}
async function artifacts() {
  const manifestText = await readFile(path.join(directory, "manifest.json"), "utf8");
  const manifest = JSON.parse(manifestText) as ManagedMigrationManifest;
  const entries = manifest.migrations.filter(entry => ids.includes(entry.id));
  const migrations = await Promise.all(entries.map(async entry => ({
    entry, sql: await readFile(path.join(directory, entry.sqlFile), "utf8"),
    postconditions: JSON.parse(await readFile(path.join(directory, entry.postconditionsFile), "utf8")) as TablePostconditions,
  })));
  return { manifestText, manifest, migrations };
}
async function isolatedDirectory(options: { staleChecksum?: boolean } = {}) {
  const actual = await artifacts();
  const temporary = await mkdtemp(path.join(os.tmpdir(), "offline-team-history-migration-"));
  const entries = actual.migrations.map(({ entry }) => ({ ...entry }));
  if (options.staleChecksum) entries[0].sha256 = "0".repeat(64);
  await writeFile(path.join(temporary, "manifest.json"), JSON.stringify({ format: 1, migrations: entries }));
  for (const migration of actual.migrations) {
    await writeFile(path.join(temporary, migration.entry.sqlFile), migration.sql);
    await writeFile(path.join(temporary, migration.entry.postconditionsFile), JSON.stringify(migration.postconditions));
  }
  // Retain offline fixtures; no cleanup of project or live data is performed.
  return { directory: temporary, migrations: actual.migrations };
}
function migrationFake() {
  const tables = new Map<string, Schema>();
  const ledger = new Map<string, { migration_id: string; sha256: string; state: string; attempt_count: number }>();
  const calls: string[] = [];
  const db: MigrationDb = {
    async query(sql: string, params: unknown[] = []) {
      calls.push(sql);
      if (sql.includes("GET_LOCK")) return [[{ acquired: 1 }]];
      if (sql.includes("RELEASE_LOCK")) return [[{ released: 1 }]];
      if (sql.includes("CREATE TABLE IF NOT EXISTS `app_versioned_migration_ledger`")) return [[]];
      if (sql.includes("SELECT migration_id")) return [ledger.has(String(params[0])) ? [ledger.get(String(params[0]))] : []];
      if (sql.includes("INSERT INTO `app_versioned_migration_ledger`")) {
        const id = String(params[0]); ledger.set(id, { migration_id: id, sha256: String(params[1]), state: "started", attempt_count: (ledger.get(id)?.attempt_count ?? 0) + 1 }); return [[]];
      }
      if (sql.includes("SET state = 'applied'")) { ledger.get(String(params[0]))!.state = "applied"; return [[]]; }
      if (sql.includes("SET state = 'failed'")) { ledger.get(String(params[1]))!.state = "failed"; return [[]]; }
      const table = tables.get(String(params[0]));
      if (sql.includes("information_schema.tables")) return [table ? [{ table_name: table.table }] : []];
      if (sql.includes("information_schema.columns")) return [table?.columns.map(column => ({ column_name: column.name, column_type: column.columnType, is_nullable: column.nullable ? "YES" : "NO", extra: "", column_default: column.default })) ?? []];
      if (sql.includes("information_schema.statistics")) return [table?.indexes.flatMap(index => index.columns.map((column, n) => ({ index_name: index.name, non_unique: index.unique ? 0 : 1, seq_in_index: n + 1, column_name: column }))) ?? []];
      if (/CREATE TABLE IF NOT EXISTS `team_review_/.test(sql)) { const schema = parseCreateSql(sql); if (!tables.has(schema.table)) tables.set(schema.table, schema); return [[]]; }
      throw new Error(`Unexpected migration fake SQL: ${sql}`);
    },
  };
  return { db, calls, tables, ledger };
}
const logger = () => ({ info: vi.fn(), error: vi.fn() });

describe("weekly history migration contracts", () => {
  it("appends only the two entries while preserving all previous manifest bytes", async () => {
    const { manifestText, manifest } = await artifacts();
    const firstNewEntry = manifestText.indexOf(',\n    {\n      "id": "0079_create_team_review_runs"');
    expect(firstNewEntry).toBeGreaterThan(0);
    const reconstructedOriginal = manifestText.slice(0, firstNewEntry) + "\n  ]\n}\n";
    expect(checksum(reconstructedOriginal)).toBe(oldManifestSha256);
    expect(manifest.migrations.slice(-2).map(entry => entry.id)).toEqual(ids);
    const old = JSON.parse(reconstructedOriginal) as ManagedMigrationManifest;
    expect(old.migrations.at(-1)!.id).toBe("0078_add_booking_manual_amount_overrides");
    expect(manifest.migrations.slice(0, -2)).toEqual(old.migrations);
  });
  it("creates exactly two isolated tables with final SQL byte checksums", async () => {
    const { migrations } = await artifacts(); expect(migrations).toHaveLength(2);
    for (const { entry, sql, postconditions } of migrations) {
      expect(entry.mode).toBe("create-table"); expect(entry.replayMode).toBe("verified-idempotent");
      expect(entry.sqlFile).toBe(`${entry.id}.sql`); expect(entry.postconditionsFile).toBe(`${entry.id}.postconditions.json`);
      expect(checksum(sql)).toBe(entry.sha256); expect(sql.match(/CREATE TABLE IF NOT EXISTS/g)).toHaveLength(1);
      expect(sql).not.toMatch(/^\s*(?:ALTER|DROP|TRUNCATE|INSERT|UPDATE|DELETE|REPLACE)\b/im);
      expect(sql).not.toMatch(/REFERENCES|FOREIGN KEY/i);
      expect(sql.trim()).toMatch(/ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;$/);
      expect(postconditions.format).toBe(1); expect(postconditions.table).toMatch(/^team_review_(runs|weeks)$/);
      const schema = parseCreateSql(sql);
      expect(schema.table).toBe(postconditions.table);
      expect(schema.columns.map(column => column.name)).toEqual(postconditions.columns.map(column => column.name));
      expect(schema.indexes).toEqual(postconditions.indexes);
      expect(evaluatePostconditions(postconditions, true, schema.columns, schema.indexes)).toMatchObject({ valid: true, differences: [] });
    }
  });
  it("declares all immutable snapshot, mutable draft, publication audit and pointer fields", async () => {
    const { migrations } = await artifacts();
    expect(migrations[0].postconditions.columns.map(column => column.name)).toEqual([
      "id", "weekStart", "ownerId", "createdAtMs", "updatedAtMs", "status", "progress", "payload", "publication", "publishedAtMs", "publishedBy",
    ]);
    expect(migrations[0].postconditions.indexes).toEqual([
      { name: "PRIMARY", columns: ["id"], unique: true },
      { name: "idx_team_review_runs_week_created", columns: ["weekStart", "createdAtMs", "id"], unique: false },
    ]);
    expect(migrations[1].postconditions.columns.map(column => column.name)).toEqual(["weekStart", "latestPublicationId", "updatedAtMs"]);
    expect(migrations[1].postconditions.indexes).toEqual([{ name: "PRIMARY", columns: ["weekStart"], unique: true }]);
  });
  it("applies real SQL through the managed runner, validates metadata, and skips a verified replay", async () => {
    const fixture = await isolatedDirectory(); const fake = migrationFake(); const log = logger();
    const dependencies = { db: fake.db, migrationsDirectory: fixture.directory, logger: log };
    expect(await runManagedMigrations(dependencies)).toEqual(ids.map(id => ({ id, outcome: "applied" })));
    expect(fake.tables.size).toBe(2); expect(log.info.mock.calls.filter(call => call[0] === "migration_postconditions_passed")).toHaveLength(2);
    const createsBefore = fake.calls.filter(sql => /CREATE TABLE IF NOT EXISTS `team_review_/.test(sql)).length;
    expect(await runManagedMigrations(dependencies)).toEqual(ids.map(id => ({ id, outcome: "skipped" })));
    expect(fake.calls.filter(sql => /CREATE TABLE IF NOT EXISTS `team_review_/.test(sql))).toHaveLength(createsBefore);
  });
  it("recovers existing exact new tables without issuing DDL", async () => {
    const fixture = await isolatedDirectory(); const fake = migrationFake();
    for (const { sql } of fixture.migrations) { const schema = parseCreateSql(sql); fake.tables.set(schema.table, schema); }
    expect(await runManagedMigrations({ db: fake.db, migrationsDirectory: fixture.directory, logger: logger() })).toEqual(ids.map(id => ({ id, outcome: "recovered" })));
    expect(fake.calls.some(sql => /CREATE TABLE IF NOT EXISTS `team_review_/.test(sql))).toBe(false);
  });
  it("rejects stale checksums before any feature DDL or ledger start", async () => {
    const fixture = await isolatedDirectory({ staleChecksum: true }); const fake = migrationFake();
    await expect(runManagedMigrations({ db: fake.db, migrationsDirectory: fixture.directory, logger: logger() })).rejects.toThrow("Checksum mismatch for 0079_create_team_review_runs");
    expect(fake.tables.size).toBe(0); expect(fake.ledger.size).toBe(0);
    expect(fake.calls.at(-1)).toContain("RELEASE_LOCK");
  });
  it("rejects divergent existing schema rather than hiding it behind IF NOT EXISTS", async () => {
    const fixture = await isolatedDirectory(); const fake = migrationFake(); const schema = parseCreateSql(fixture.migrations[0].sql);
    schema.columns.find(column => column.name === "payload")!.nullable = true; fake.tables.set(schema.table, schema);
    await expect(runManagedMigrations({ db: fake.db, migrationsDirectory: fixture.directory, logger: logger() })).rejects.toThrow("payload nullability differs");
    expect(fake.calls.some(sql => /CREATE TABLE IF NOT EXISTS `team_review_/.test(sql))).toBe(false);
    expect(fake.ledger.get(ids[0])!.state).toBe("failed");
  });
  it("detects column type, nullability, index uniqueness and ordering drift", async () => {
    const { migrations } = await artifacts(); const { sql, postconditions } = migrations[0];
    const schema = parseCreateSql(sql);
    schema.columns.find(column => column.name === "createdAtMs")!.columnType = "int unsigned";
    schema.columns.find(column => column.name === "publication")!.nullable = false;
    schema.indexes[0].unique = false; schema.indexes[1].columns.reverse();
    const result = evaluatePostconditions(postconditions, true, schema.columns, schema.indexes);
    expect(result.valid).toBe(false); expect(result.differences).toHaveLength(4);
  });
});
