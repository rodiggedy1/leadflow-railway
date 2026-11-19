import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { runManagedMigrations } from "./managedRunner";
import type { MigrationDb } from "./contracts";
const directory = path.resolve(process.cwd(), "server/versioned-migrations");
const id = "0078_add_booking_manual_amount_overrides";
async function artifacts() {
  const manifest = JSON.parse(await readFile(path.join(directory, "manifest.json"), "utf8"));
  const entry = manifest.migrations.find((item: { id: string }) => item.id === id);
  const sql = await readFile(path.join(directory, entry.sqlFile), "utf8");
  const postconditions = await readFile(path.join(directory, entry.postconditionsFile), "utf8");
  return { manifest, entry, sql, postconditions };
}
async function isolated(run: (directory: string) => Promise<void>, mutate?: (item: Awaited<ReturnType<typeof artifacts>>) => void) {
  const files = await artifacts(); mutate?.(files);
  const temp = await mkdtemp(path.join(os.tmpdir(), "native-amount-migration-test-"));
  try {
    await Promise.all([
      writeFile(path.join(temp, "manifest.json"), JSON.stringify({ format: 1, migrations: [files.entry] })),
      writeFile(path.join(temp, files.entry.sqlFile), files.sql),
      writeFile(path.join(temp, files.entry.postconditionsFile), files.postconditions),
    ]);
    await run(temp);
  } finally { await rm(temp, { recursive: true, force: true }); }
}
function fakeDb(options: { table?: boolean; type?: string; nullable?: boolean; exists?: boolean } = {}) {
  let exists = options.exists ?? false;
  let ledger: string | null = null;
  const calls: string[] = [];
  const query = async (sql: string, params: unknown[] = []) => {
    calls.push(sql);
    if (sql.includes("GET_LOCK")) return [[{ acquired: 1 }]];
    if (sql.includes("RELEASE_LOCK")) return [[{ released: 1 }]];
    if (sql.includes("SELECT migration_id")) return [[]];
    if (sql.includes("information_schema.tables")) { expect(params).toEqual(["bookings"]); return [options.table === false ? [] : [{ table_name: "bookings" }]]; }
    if (sql.includes("information_schema.columns")) { expect(params).toEqual(["bookings"]); return [exists ? [{ column_name: "manualAmountOverrides", column_type: options.type ?? "json", is_nullable: options.nullable === false ? "NO" : "YES", extra: "", column_default: null }] : []]; }
    if (sql.includes("information_schema.statistics")) return [[]];
    if (/^ALTER TABLE/.test(sql)) {
      expect(sql).toBe("ALTER TABLE `bookings`\n  ADD COLUMN IF NOT EXISTS `manualAmountOverrides` json NULL;");
      exists = true; return [[]];
    }
    if (sql.includes("INSERT INTO `app_versioned_migration_ledger`")) { ledger = "started"; return [[]]; }
    if (sql.includes("SET state = 'applied'")) { ledger = "applied"; return [[]]; }
    if (sql.includes("SET state = 'failed'")) { ledger = "failed"; return [[]]; }
    if (sql.includes("CREATE TABLE IF NOT EXISTS `app_versioned_migration_ledger`")) return [[]];
    throw new Error(`Unknown managed runner SQL: ${sql}`);
  };
  return { db: { query } as MigrationDb, calls, state: () => ({ exists, ledger }) };
}
const logger = { info: vi.fn(), error: vi.fn() };
describe("native manual amount migration managed contracts", () => {
  it("appends exactly 0078 after 0077, declaring only nullable bookings JSON and final-byte checksum", async () => {
    const files = await artifacts();
    expect(files.manifest.migrations.slice(-2).map((entry: { id: string }) => entry.id)).toEqual(["0077_create_payable_invoice_deliveries", id]);
    expect(files.entry).toMatchObject({ id, mode: "additive-columns-existing-table", replayMode: "verified-idempotent" });
    expect(files.entry.sha256).toBe(createHash("sha256").update(files.sql).digest("hex"));
    expect(JSON.parse(files.postconditions)).toEqual({ format: 1, table: "bookings", columns: [{ name: "manualAmountOverrides", columnType: "json", nullable: true }], indexes: [] });
    expect(files.sql).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|DROP|MODIFY|CHANGE|RENAME)\b/i);
    expect(files.sql + files.postconditions).not.toMatch(/cleanerJ(?=obs)|cleaner_j(?=obs)/);
  });
  it("executes one additive statement through the actual runner and verifies postconditions", async () => {
    await isolated(async migrationsDirectory => {
      const fake = fakeDb();
      expect(await runManagedMigrations({ db: fake.db, migrationsDirectory, logger })).toEqual([{ id, outcome: "applied" }]);
      expect(fake.state()).toEqual({ exists: true, ledger: "applied" });
      expect(fake.calls.filter(sql => sql.startsWith("ALTER"))).toHaveLength(1);
    });
  });
  it("recovers verified existing nullable JSON without executing DDL", async () => {
    await isolated(async migrationsDirectory => {
      const fake = fakeDb({ exists: true });
      expect(await runManagedMigrations({ db: fake.db, migrationsDirectory, logger })).toEqual([{ id, outcome: "recovered" }]);
      expect(fake.calls.some(sql => sql.startsWith("ALTER"))).toBe(false);
    });
  });
  it("rejects removal of IF NOT EXISTS before any ALTER, even with a recomputed checksum", async () => {
    await isolated(async migrationsDirectory => {
      const fake = fakeDb();
      await expect(runManagedMigrations({ db: fake.db, migrationsDirectory, logger })).rejects.toThrow("IF NOT EXISTS");
      expect(fake.calls.some(sql => sql.startsWith("ALTER"))).toBe(false);
    }, files => { files.sql = files.sql.replace(" IF NOT EXISTS", ""); files.entry.sha256 = createHash("sha256").update(files.sql).digest("hex"); });
  });
  it("rejects stale checksum before schema or DDL inspection", async () => {
    await isolated(async migrationsDirectory => {
      const fake = fakeDb();
      await expect(runManagedMigrations({ db: fake.db, migrationsDirectory, logger })).rejects.toThrow("Checksum mismatch");
      expect(fake.calls.some(sql => sql.includes("information_schema") || sql.startsWith("ALTER"))).toBe(false);
    }, files => { files.sql += "\n"; });
  });
  it.each([{ table: false }, { exists: true, type: "text" }, { exists: true, nullable: false }])("rejects absent table or divergent JSON semantics %j", async options => {
    await isolated(async migrationsDirectory => {
      const fake = fakeDb(options);
      await expect(runManagedMigrations({ db: fake.db, migrationsDirectory, logger })).rejects.toThrow();
      expect(fake.calls.some(sql => sql.startsWith("ALTER"))).toBe(false);
    });
  });
});
