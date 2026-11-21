import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { type SQL } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { describe, expect, it, vi } from "vitest";
import type { ReviewEntry } from "../../shared/reviewResponses";
import type { getDb } from "../db";
import type { ManagedMigrationManifest, MigrationDb, TablePostconditions } from "../migrations/contracts";
import { evaluatePostconditions } from "../migrations/postconditions";
import { runManagedMigrations } from "../migrations/managedRunner";
import { createSqlReviewStore, StoreUnavailable } from "./store";

// A runtime import of the database module must fail rather than silently connect.
vi.mock("../db", () => { throw new Error("SQL store must use a type-only database import"); });

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
const KEY = "a".repeat(64);
const migrationId = "0081_create_public_review_responses";
const migrationDirectory = path.resolve(process.cwd(), "server/versioned-migrations");
const dialect = new MySqlDialect();

function fixture(overrides: Partial<ReviewEntry> = {}): ReviewEntry {
  return {
    key: KEY, revision: 1,
    review: { platform: "google", accountId: "account-1", businessId: "business-1", reviewId: "review-1", rating: 5,
      reviewerName: "Customer", text: "The kitchen was spotless. '); DROP TABLE private_table; --", createdAt: "2026-11-20T12:00:00Z",
      updatedAt: null, existingResponse: null, negotiationId: null, source: "manual" },
    status: "RECORDED", generatedDraft: null, approvedText: null, approvedBy: null, approvedAt: null,
    publishedResponse: null, publishedAt: null, generationRequestId: null, generationStartedAt: null,
    severityReasons: [], validationIssues: [], escalationStatus: "not_required", createdAt: 100, updatedAt: 100,
    events: [{ at: 100, actor: "admin", action: "ingest", text: null }], ...overrides,
  };
}

function row(entry = fixture()): Record<string, unknown> {
  return { key: entry.key, revision: entry.revision, entry: JSON.stringify(entry), updatedAtMs: entry.updatedAt };
}

function scripted(...results: unknown[]) {
  const queries: Array<{ sql: string; params: unknown[] }> = [];
  const execute = vi.fn(async (query: SQL) => {
    const compiled = dialect.sqlToQuery(query);
    queries.push({ sql: compiled.sql.replace(/\s+/g, " ").trim(), params: compiled.params });
    if (!results.length) throw new Error("Unmocked execute");
    const result = results.shift();
    if (result instanceof Error) throw result;
    return result;
  });
  const transaction = vi.fn(async (fn: (tx: Pick<Db, "execute">) => Promise<unknown>) => fn({ execute } as unknown as Pick<Db, "execute">));
  const store = createSqlReviewStore({ execute, transaction } as unknown as Db);
  return { store, execute, transaction, queries };
}

function durable(initial?: ReviewEntry) {
  let stored = initial ? row(initial) : undefined;
  let tail = Promise.resolve();
  let race = false;
  const queries: Array<{ sql: string; params: unknown[] }> = [];
  const db = {
    async transaction(fn: (tx: Pick<Db, "execute">) => Promise<unknown>) {
      const previous = tail;
      let release!: () => void;
      tail = new Promise<void>(resolve => { release = resolve; });
      await previous;
      const snapshot = structuredClone(stored);
      try { return await fn(db as unknown as Pick<Db, "execute">); }
      catch (error) { stored = snapshot; throw error; }
      finally { release(); }
    },
    async execute(query: SQL) {
      const q = dialect.sqlToQuery(query), s = q.sql.replace(/\s+/g, " ").trim(), p = q.params;
      queries.push({ sql: s, params: p });
      if (s.startsWith("SELECT")) return [[...(stored ? [structuredClone(stored)] : [])], []];
      if (s.startsWith("INSERT IGNORE")) {
        if (stored) return [{ affectedRows: 0, warningStatus: 1 }, []];
        stored = { key: p[0], revision: p[1], entry: p[2], updatedAtMs: p[3] };
        return [{ affectedRows: 1, warningStatus: 0 }, []];
      }
      if (s === "SHOW WARNINGS") return [[{ Level: "Warning", Code: 1062, Message: "sensitive duplicate message" }], []];
      if (s.startsWith("UPDATE")) {
        if (race) { race = false; stored = row(fixture({ revision: 2, updatedAt: 101 })); }
        if (!stored || stored.key !== p[3] || stored.revision !== p[4]) return [{ affectedRows: 0, warningStatus: 0 }, []];
        stored = { revision: p[0], entry: p[1], updatedAtMs: p[2], key: p[3] };
        return [{ affectedRows: 1, warningStatus: 0 }, []];
      }
      throw new Error("Unmocked statement");
    },
  };
  return { store: createSqlReviewStore(db as unknown as Db), queries, state: () => structuredClone(stored), race: () => { race = true; } };
}

const success = [{ affectedRows: 1, warningStatus: 0 }, []];
const conflict = [{ affectedRows: 0, warningStatus: 0 }, []];

describe("isolated SQL review-response store (offline only)", () => {
  it("has no factory/database import side effects", () => {
    const f = scripted();
    expect(f.execute).not.toHaveBeenCalled();
    expect(f.transaction).not.toHaveBeenCalled();
  });

  it("gets JSON entries and binds key without string interpolation", async () => {
    const f = scripted([[row()], []]);
    expect(await f.store.get(KEY)).toEqual(fixture());
    expect(f.queries[0].sql).toMatch(/FROM `public_review_responses` WHERE `key` = \? LIMIT 1$/);
    expect(f.queries[0].sql).not.toContain(KEY);
    expect(f.queries[0].params).toEqual([KEY]);
    const object = row(); object.entry = fixture(); object.revision = "1"; object.updatedAtMs = BigInt(100);
    expect(await scripted([[object], []]).store.get(KEY)).toEqual(fixture());
  });

  it("returns null only for valid empty results", async () => {
    expect(await scripted([[], []]).store.get(KEY)).toBeNull();
    await expect(scripted(undefined).store.get(KEY)).rejects.toBeInstanceOf(StoreUnavailable);
    await expect(scripted([{}, []]).store.get(KEY)).rejects.toBeInstanceOf(StoreUnavailable);
    await expect(scripted([[row(), row()], []]).store.get(KEY)).rejects.toBeInstanceOf(StoreUnavailable);
  });

  it.each([
    { entry: "{" }, { entry: "null" }, { entry: {} }, { key: "b".repeat(64) },
    { revision: 2 }, { revision: "01" }, { revision: 1.5 }, { revision: null }, { revision: true },
    { updatedAtMs: 101 }, { updatedAtMs: "1e2" }, { updatedAtMs: "9007199254740992" },
    { entry: JSON.stringify({ ...fixture(), revision: 0x100000000 }) },
    { entry: JSON.stringify({ ...fixture(), unknownPrivateField: "must not survive" }) },
  ])("fails closed for invalid stored payload or DB binding %j", async change => {
    const f = scripted([[{ ...row(), ...change }], []]);
    await expect(f.store.get(KEY)).rejects.toEqual(new StoreUnavailable());
  });

  it.each([undefined, 1, 200, 999999])("bounds list SQL to 200 for limit %s", async limit => {
    const f = scripted([[row()], []]);
    expect(await f.store.list(limit)).toEqual([fixture()]);
    expect(f.queries[0].sql).toMatch(/ORDER BY `updatedAtMs` DESC, `key` ASC LIMIT \?$/);
    expect(f.queries[0].params).toEqual([limit === 1 ? 1 : 200]);
  });

  it("rejects one corrupt list member, duplicates, and over-limit results, without partial output", async () => {
    await expect(scripted([[row(), { ...row(), entry: "{" }], []]).store.list()).rejects.toBeInstanceOf(StoreUnavailable);
    await expect(scripted([[row(), row()], []]).store.list()).rejects.toBeInstanceOf(StoreUnavailable);
    await expect(scripted([[row(), row()], []]).store.list(1)).rejects.toBeInstanceOf(StoreUnavailable);
  });

  it.each([0, -1, 1.5, NaN, Infinity])("rejects invalid limits locally (%s)", async limit => {
    const f = scripted(); await expect(f.store.list(limit)).rejects.toThrow("Invalid review response store input");
    expect(f.execute).not.toHaveBeenCalled();
  });

  it.each(["", "A".repeat(64), "a".repeat(63), "'; DROP TABLE x; --"])("rejects invalid key locally (%s)", async key => {
    const f = scripted(); await expect(f.store.get(key)).rejects.toThrow("Invalid review response store input");
    expect(f.execute).not.toHaveBeenCalled();
  });

  it("inserts parameterized complete JSON including audit and verifies persistence", async () => {
    const f = scripted(success, [[row()], []]);
    expect(await f.store.insertIfAbsent(fixture())).toBe(true);
    expect(f.transaction).toHaveBeenCalledTimes(1);
    expect(f.queries[0].sql).toMatch(/^INSERT IGNORE INTO `public_review_responses`/);
    expect(f.queries[0].params).toEqual([KEY, 1, JSON.stringify(fixture()), 100]);
    expect(f.queries[0].sql).not.toContain("DROP TABLE");
    expect(JSON.parse(String(f.queries[0].params[2])).events).toEqual(fixture().events);
  });

  it("treats only a verified duplicate PK as an existing entry", async () => {
    const existing = fixture({ revision: 3, updatedAt: 103 });
    const f = scripted([{ affectedRows: 0, warningStatus: 1 }, []], [[{ Code: 1062, Message: "private data" }], []], [[row(existing)], []]);
    expect(await f.store.insertIfAbsent(fixture())).toBe(false);
    expect(f.queries[1]).toEqual({ sql: "SHOW WARNINGS", params: [] });
    expect(f.transaction).toHaveBeenCalledTimes(1);
    expect(await scripted(conflict, [[row()], []]).store.insertIfAbsent(fixture())).toBe(false);
    await expect(scripted(conflict, [[], []]).store.insertIfAbsent(fixture())).rejects.toBeInstanceOf(StoreUnavailable);
    const changed = fixture(); changed.review.reviewId = "different";
    await expect(scripted(conflict, [[row(changed)], []]).store.insertIfAbsent(fixture())).rejects.toBeInstanceOf(StoreUnavailable);
  });

  it.each([1048, 1265, 3819, "1062"])("never treats ignored nonduplicate/malformed warning %s as success", async code => {
    const f = scripted([{ affectedRows: 0, warningStatus: 1 }, []], [[{ Code: code }], []]);
    await expect(f.store.insertIfAbsent(fixture())).rejects.toEqual(new StoreUnavailable());
    expect(f.queries).toHaveLength(2);
  });

  it("fails closed for insert warnings on affectedRows=1, missing warnings, or coerced persistence", async () => {
    await expect(scripted([{ affectedRows: 1, warningStatus: 1 }, []], [[{ Code: 1062 }], []]).store.insertIfAbsent(fixture())).rejects.toBeInstanceOf(StoreUnavailable);
    await expect(scripted([{ affectedRows: 0, warningStatus: 1 }, []], [[], []]).store.insertIfAbsent(fixture())).rejects.toBeInstanceOf(StoreUnavailable);
    await expect(scripted(success, [[row(fixture({ status: "FAILED" }))], []]).store.insertIfAbsent(fixture())).rejects.toBeInstanceOf(StoreUnavailable);
  });

  it.each([undefined, {}, [{ affectedRows: 2, warningStatus: 0 }], [{ affectedRows: "1", warningStatus: 0 }], [{ affectedRows: 1 }]])("fails closed for malformed write headers (%j)", async header => {
    await expect(scripted(header).store.insertIfAbsent(fixture())).rejects.toBeInstanceOf(StoreUnavailable);
  });

  it.each([0, -1, 1.5, 0x100000000])("rejects out-of-storage-range revisions before insert (%s)", async revision => {
    const f = scripted(); await expect(f.store.insertIfAbsent(fixture({ revision }))).rejects.toThrow("Invalid review response store input");
    expect(f.execute).not.toHaveBeenCalled(); expect(f.transaction).not.toHaveBeenCalled();
  });

  it("CAS updates complete JSON/audit using key AND expected revision bindings", async () => {
    const current = fixture(), next = fixture({ revision: 2, status: "DRAFT_READY", generatedDraft: "Thanks for the kitchen feedback.", updatedAt: 101,
      events: [...current.events, { at: 101, actor: "admin", action: "generate", text: "draft" }] });
    const f = scripted([[row(current)], []], success);
    expect(await f.store.compareAndSwap(KEY, 1, next)).toBe(true);
    expect(f.queries[1].sql).toMatch(/WHERE `key` = \? AND `revision` = \?$/);
    expect(f.queries[1].params).toEqual([2, JSON.stringify(next), 101, KEY, 1]);
    expect(JSON.parse(String(f.queries[1].params[1])).events).toEqual(next.events);
    expect(f.transaction).toHaveBeenCalledTimes(1);
  });

  it("returns false for zero-row CAS without retry, and for missing/stale reads without update", async () => {
    const next = fixture({ revision: 2 });
    const f = scripted([[row()], []], conflict);
    expect(await f.store.compareAndSwap(KEY, 1, next)).toBe(false); expect(f.queries).toHaveLength(2);
    for (const rows of [[], [row(fixture({ revision: 2 }))]]) {
      const stale = scripted([rows, []]); expect(await stale.store.compareAndSwap(KEY, 1, next)).toBe(false);
      expect(stale.queries).toHaveLength(1);
    }
  });

  it.each([
    { key: "b".repeat(64), expected: 1, next: fixture({ revision: 2 }) },
    { key: KEY, expected: 0, next: fixture({ revision: 2 }) },
    { key: KEY, expected: 1.5, next: fixture({ revision: 2 }) },
    { key: KEY, expected: 1, next: fixture({ revision: 1 }) },
    { key: KEY, expected: 1, next: fixture({ revision: 3 }) },
    { key: KEY, expected: 0xffffffff, next: fixture({ revision: 0x100000000 }) },
  ])("rejects invalid next key/revision/expected binding locally (%j)", async input => {
    const f = scripted(); await expect(f.store.compareAndSwap(input.key, input.expected, input.next)).rejects.toThrow("Invalid review response store input");
    expect(f.execute).not.toHaveBeenCalled(); expect(f.transaction).not.toHaveBeenCalled();
  });

  it.each(["platform", "accountId", "businessId", "reviewId"] as const)("rejects changed review identity (%s) before SQL write", async field => {
    const next = fixture({ revision: 2 });
    if (field === "platform") next.review.platform = "thumbtack"; else next.review[field] = "different";
    const f = scripted([[row()], []]); await expect(f.store.compareAndSwap(KEY, 1, next)).rejects.toThrow("Invalid review response store input");
    expect(f.queries).toHaveLength(1);
  });

  it("rejects audit removal/mutation, but allows ordinary review text updates", async () => {
    for (const events of [[], [{ at: 100, actor: "other", action: "ingest", text: null }]]) {
      const f = scripted([[row()], []]);
      await expect(f.store.compareAndSwap(KEY, 1, fixture({ revision: 2, events }))).rejects.toThrow("Invalid review response store input");
      expect(f.queries).toHaveLength(1);
    }
    const next = fixture({ revision: 2 }); next.review.text = "Updated review";
    expect(await scripted([[row()], []], success).store.compareAndSwap(KEY, 1, next)).toBe(true);
  });

  it("fails closed for CAS warnings and corrupted current rows", async () => {
    await expect(scripted([[row()], []], [{ affectedRows: 1, warningStatus: 1 }, []]).store.compareAndSwap(KEY, 1, fixture({ revision: 2 }))).rejects.toBeInstanceOf(StoreUnavailable);
    const f = scripted([[{ ...row(), revision: 7 }], []]);
    await expect(f.store.compareAndSwap(KEY, 1, fixture({ revision: 2 }))).rejects.toBeInstanceOf(StoreUnavailable);
    expect(f.queries).toHaveLength(1);
  });

  it("sanitizes database/transaction errors without cause, credentials, payload, or logging", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const failure = new Error("mysql://secret-user:secret-password@private-host private review SQL");
      const f = scripted(failure);
      try { await f.store.get(KEY); throw new Error("must fail"); }
      catch (error) {
        expect(error).toEqual(new StoreUnavailable()); expect(error).not.toHaveProperty("cause");
        expect(String(error)).not.toContain("secret");
      }
      const badDb = { transaction: async () => { throw failure; } } as unknown as Db;
      await expect(createSqlReviewStore(badDb).insertIfAbsent(fixture())).rejects.toEqual(new StoreUnavailable());
      expect(log).not.toHaveBeenCalled();
    } finally { log.mockRestore(); }
  });

  it("persistent insert/CAS races have one winner and retain complete audit over reads", async () => {
    const f = durable();
    expect(await Promise.all([f.store.insertIfAbsent(fixture()), f.store.insertIfAbsent(fixture())])).toEqual([true, false]);
    const next = fixture({ revision: 2, updatedAt: 101, events: [...fixture().events, { at: 101, actor: "admin", action: "edit", text: "new" }] });
    expect(await Promise.all([f.store.compareAndSwap(KEY, 1, next), f.store.compareAndSwap(KEY, 1, next)])).toEqual([true, false]);
    expect(await f.store.get(KEY)).toEqual(next);
    const returned = await f.store.get(KEY); returned!.events[0].actor = "caller mutation";
    expect((await f.store.get(KEY))!.events).toEqual(next.events);
    expect(f.queries.every(q => q.sql.includes("public_review_responses") || q.sql === "SHOW WARNINGS")).toBe(true);
    const raced = durable(fixture()); raced.race();
    expect(await raced.store.compareAndSwap(KEY, 1, next)).toBe(false);
    expect(raced.state()!.revision).toBe(2);
  });
});

async function migrationFiles() {
  const manifest = JSON.parse(await readFile(path.join(migrationDirectory, "manifest.json"), "utf8")) as ManagedMigrationManifest;
  const matches = manifest.migrations.filter(entry => entry.id === migrationId);
  expect(matches).toHaveLength(1);
  const migration = matches[0];
  const sql = await readFile(path.join(migrationDirectory, migration.sqlFile), "utf8");
  const postconditionsText = await readFile(path.join(migrationDirectory, migration.postconditionsFile), "utf8");
  return { manifest, migration, sql, postconditionsText, postconditions: JSON.parse(postconditionsText) as TablePostconditions };
}

async function withOnlyActualMigration<T>(run: (directory: string, files: Awaited<ReturnType<typeof migrationFiles>>) => Promise<T>) {
  const files = await migrationFiles(), directory = await mkdtemp(path.join(os.tmpdir(), "review-response-migration-offline-"));
  try {
    await Promise.all([
      writeFile(path.join(directory, "manifest.json"), JSON.stringify({ format: 1, migrations: [files.migration] })),
      writeFile(path.join(directory, files.migration.sqlFile), files.sql),
      writeFile(path.join(directory, files.migration.postconditionsFile), files.postconditionsText),
    ]);
    return await run(directory, files);
  } finally { await rm(directory, { recursive: true, force: true }); }
}

function migrationMock(postconditions: TablePostconditions, existing = false, drift = false) {
  let exists = existing;
  const calls: string[] = [];
  const db: MigrationDb = { async query(sql: string) {
    calls.push(sql);
    if (sql.includes("GET_LOCK")) return [[{ acquired: 1 }]];
    if (sql.includes("RELEASE_LOCK") || sql.includes("SELECT migration_id")) return [[]];
    if (sql.includes("information_schema.tables")) return [exists ? [{ table_name: postconditions.table }] : []];
    if (sql.includes("information_schema.columns")) return [postconditions.columns.map(column => ({
      column_name: column.name, column_type: drift && column.name === "revision" ? "int" : column.columnType,
      is_nullable: column.nullable ? "YES" : "NO", extra: "", column_default: null,
    }))];
    if (sql.includes("information_schema.statistics")) return [postconditions.indexes.flatMap(index => index.columns.map((column, i) => ({
      index_name: index.name, non_unique: index.unique ? 0 : 1, seq_in_index: i + 1, column_name: column,
    })))];
    if (sql.includes("CREATE TABLE IF NOT EXISTS `public_review_responses`")) { exists = true; return [[]]; }
    if (sql.includes("app_versioned_migration_ledger")) return [[]];
    throw new Error("Unmocked migration query");
  } };
  return { db, calls };
}

const quietLogger = { info: () => undefined, error: () => undefined };

describe("actual 0081 migration draft contract (mocked runner, no database)", () => {
  it("has exactly one final manifest entry and byte-accurate checksum; earlier manifests remain intact", async () => {
    const { manifest, migration, sql } = await migrationFiles();
    expect(manifest.migrations.at(-1)).toEqual(migration);
    expect(migration).toEqual({ id: migrationId, mode: "create-table", sqlFile: `${migrationId}.sql`,
      sha256: createHash("sha256").update(sql).digest("hex"), replayMode: "verified-idempotent", postconditionsFile: `${migrationId}.postconditions.json` });
    expect(manifest.migrations.at(-2)!.id).toBe("0080_create_team_review_weeks");
    expect(sql.trim().split(";")).toHaveLength(2);
    expect(sql.match(/CREATE\s+TABLE/gi)).toHaveLength(1);
    expect(sql).toMatch(/^CREATE TABLE IF NOT EXISTS `public_review_responses`/);
    expect(sql).not.toMatch(/\b(ALTER|DROP|INSERT|UPDATE|DELETE|TRUNCATE|REFERENCES)\b/i);
  });

  it("declares exact new column/index metadata and explicit JSON key/revision/time checks", async () => {
    const { sql, postconditions } = await migrationFiles();
    expect(postconditions).toEqual({ format: 1, table: "public_review_responses", columns: [
      { name: "key", columnType: "char(64)", nullable: false },
      { name: "revision", columnType: "int unsigned", nullable: false },
      { name: "entry", columnType: "json", nullable: false },
      { name: "updatedAtMs", columnType: "bigint unsigned", nullable: false },
    ], indexes: [{ name: "PRIMARY", columns: ["key"], unique: true },
      { name: "idx_public_review_responses_updated", columns: ["updatedAtMs", "key"], unique: false }] });
    expect(sql).toMatch(/`key` CHAR\(64\) CHARACTER SET ascii COLLATE ascii_bin NOT NULL/);
    expect(sql).toContain("`revision` INT UNSIGNED NOT NULL");
    expect(sql).toContain("`entry` JSON NOT NULL");
    expect(sql).toContain("CHECK (");
    expect(sql).toContain("JSON_CONTAINS_PATH(`entry`, 'all', '$.key', '$.revision', '$.updatedAt') = 1");
    expect(sql).toContain("BINARY JSON_UNQUOTE(JSON_EXTRACT(`entry`, '$.key')) = BINARY `key`");
    expect(sql).toContain("JSON_EXTRACT(`entry`, '$.revision') = `revision`");
    expect(sql).toContain("JSON_EXTRACT(`entry`, '$.updatedAt') = `updatedAtMs`");
    for (const field of ["key", "revision", "updatedAt"]) expect(sql).toContain(`JSON_TYPE(JSON_EXTRACT(\`entry\`, '$.${field}'))`);
    const columns = postconditions.columns.map(c => ({ name: c.name, columnType: c.columnType, nullable: c.nullable, autoIncrement: false, default: null }));
    expect(evaluatePostconditions(postconditions, true, columns, postconditions.indexes).valid).toBe(true);
    expect(evaluatePostconditions(postconditions, true, columns.slice(1), postconditions.indexes).valid).toBe(false);
    expect(evaluatePostconditions(postconditions, true, columns, []).valid).toBe(false);
  });

  it("runs actual draft SQL through managed create-table flow with a fake DB only", async () => {
    await withOnlyActualMigration(async (directory, files) => {
      const mock = migrationMock(files.postconditions);
      expect(await runManagedMigrations({ db: mock.db, migrationsDirectory: directory, logger: quietLogger })).toEqual([{ id: migrationId, outcome: "applied" }]);
      expect(mock.calls.filter(q => q.includes("CREATE TABLE IF NOT EXISTS `public_review_responses`"))).toHaveLength(1);
      expect(mock.calls.some(q => q.includes("RELEASE_LOCK"))).toBe(true);
      const recovered = migrationMock(files.postconditions, true);
      expect(await runManagedMigrations({ db: recovered.db, migrationsDirectory: directory, logger: quietLogger })).toEqual([{ id: migrationId, outcome: "recovered" }]);
      expect(recovered.calls.some(q => q.includes("CREATE TABLE IF NOT EXISTS `public_review_responses`"))).toBe(false);
      const divergent = migrationMock(files.postconditions, true, true);
      await expect(runManagedMigrations({ db: divergent.db, migrationsDirectory: directory, logger: quietLogger })).rejects.toThrow("divergent");
      expect(divergent.calls.some(q => q.includes("CREATE TABLE IF NOT EXISTS `public_review_responses`"))).toBe(false);
    });
  });

  it("runner rejects a stale final checksum before the target SQL is executed", async () => {
    await withOnlyActualMigration(async (directory, files) => {
      await writeFile(path.join(directory, files.migration.sqlFile), files.sql + "\n-- changed bytes\n");
      const mock = migrationMock(files.postconditions);
      await expect(runManagedMigrations({ db: mock.db, migrationsDirectory: directory, logger: quietLogger })).rejects.toThrow("Checksum mismatch");
      expect(mock.calls.some(q => q.includes("CREATE TABLE IF NOT EXISTS `public_review_responses`"))).toBe(false);
    });
  });
});
