import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { getTableConfig } from "drizzle-orm/mysql-core";
import { leadflowLaunch27VisitNotes } from "../../drizzle/leadflowLaunch27VisitNotes";
import { runManagedMigrations } from "./managedRunner";

const id = "0082_create_leadflow_launch27_visit_notes";
const directory = path.resolve(process.cwd(), "server/versioned-migrations");
async function files() {
  const manifest = JSON.parse(await readFile(path.join(directory, "manifest.json"), "utf8"));
  const entry = manifest.migrations.find((value: any) => value.id === id);
  return { entry, sql: await readFile(path.join(directory, `${id}.sql`), "utf8"),
    postconditions: JSON.parse(await readFile(path.join(directory, `${id}.postconditions.json`), "utf8")) };
}
async function withFixture(run: (dir: string, sql: string) => Promise<void>, corruptChecksum = false) {
  const current = await files();
  const dir = await mkdtemp(path.join(tmpdir(), "launch27-notes-migration-test-"));
  try {
    await Promise.all([
      writeFile(path.join(dir, "manifest.json"), JSON.stringify({ format: 1, migrations: [current.entry] })),
      writeFile(path.join(dir, current.entry.sqlFile), current.sql + (corruptChecksum ? "\n" : "")),
      writeFile(path.join(dir, current.entry.postconditionsFile), JSON.stringify(current.postconditions)),
    ]);
    await run(dir, current.sql);
  } finally { await rm(dir, { recursive: true, force: true }); }
}
function fakeDb() {
  let exists = false;
  let ledger: { migration_id: string; sha256: string; state: string; attempt_count: number } | null = null;
  const calls: string[] = [];
  return { calls, db: { async query(sql: string, params?: any[]) {
    calls.push(sql);
    if (sql.includes("GET_LOCK")) return [[{ acquired: 1 }]];
    if (sql.includes("RELEASE_LOCK")) return [[{ released: 1 }]];
    if (sql.includes("SELECT migration_id")) return [ledger ? [ledger] : []];
    if (sql.includes("information_schema.tables")) return [exists ? [{ table_name: "leadflow_launch27_visit_notes" }] : []];
    if (sql.includes("information_schema.columns")) return [[
      { column_name: "launch27BookingId", column_type: "int", is_nullable: "NO", extra: "", column_default: null },
      { column_name: "staffNotes", column_type: "text", is_nullable: "YES", extra: "", column_default: null },
    ]];
    if (sql.includes("information_schema.statistics")) return [[{ index_name: "PRIMARY", non_unique: 0, seq_in_index: 1, column_name: "launch27BookingId" }]];
    if (sql.includes("CREATE TABLE IF NOT EXISTS `leadflow_launch27_visit_notes`")) exists = true;
    if (sql.includes("INSERT INTO `app_versioned_migration_ledger`")) ledger = { migration_id: params![0], sha256: params![1], state: "started", attempt_count: 1 };
    if (sql.includes("SET state = 'applied'") && ledger) ledger.state = "applied";
    return [[]];
  } } };
}

describe("owned Launch27 visit notes migration", () => {
  it("matches the actual SQL, manifest checksum, postconditions and isolated schema", async () => {
    const { entry, sql, postconditions } = await files();
    expect(entry).toMatchObject({ mode: "create-table", replayMode: "verified-idempotent", sha256: createHash("sha256").update(sql).digest("hex") });
    expect(sql.trim()).toMatch(/^CREATE TABLE IF NOT EXISTS `leadflow_launch27_visit_notes`/);
    expect(sql.match(/;/g)).toHaveLength(1);
    expect(sql).not.toMatch(/\b(?:DROP|DELETE|UPDATE|INSERT|TRUNCATE|ALTER)\b/i);
    expect(postconditions.columns.map((column: any) => column.name)).toEqual(["launch27BookingId", "staffNotes"]);
    const config = getTableConfig(leadflowLaunch27VisitNotes);
    expect(config.name).toBe(postconditions.table);
    expect(config.columns.map(column => ({ name: column.name, type: column.getSQLType(), nullable: !column.notNull }))).toEqual(
      postconditions.columns.map((column: any) => ({ name: column.name, type: column.columnType, nullable: column.nullable })),
    );
    for (const text of [sql, JSON.stringify(postconditions), await readFile(path.resolve(process.cwd(), "drizzle/leadflowLaunch27VisitNotes.ts"), "utf8")]) {
      expect(text).not.toContain(["cleaner", "Jobs"].join(""));
      expect(text).not.toContain(["cleaner", "jobs"].join("_"));
    }
  });
  it("applies and then skips the actual migration through the managed runner using no real database", async () => {
    await withFixture(async dir => {
      const fake = fakeDb();
      const logger = { info: vi.fn(), error: vi.fn() };
      expect(await runManagedMigrations({ db: fake.db, migrationsDirectory: dir, logger })).toEqual([{ id, outcome: "applied" }]);
      expect(await runManagedMigrations({ db: fake.db, migrationsDirectory: dir, logger })).toEqual([{ id, outcome: "skipped" }]);
      expect(fake.calls.filter(sql => sql.includes("CREATE TABLE IF NOT EXISTS `leadflow_launch27_visit_notes`"))).toHaveLength(1);
      expect(logger.info).toHaveBeenCalledWith("migration_postconditions_passed", { migrationId: id });
    });
  });
  it("rejects changed SQL bytes before creating the notes table", async () => {
    await withFixture(async dir => {
      const fake = fakeDb();
      await expect(runManagedMigrations({ db: fake.db, migrationsDirectory: dir, logger: { info: vi.fn(), error: vi.fn() } })).rejects.toThrow("Checksum mismatch");
      expect(fake.calls.some(sql => sql.includes("CREATE TABLE IF NOT EXISTS `leadflow_launch27_visit_notes`"))).toBe(false);
    }, true);
  });
});
