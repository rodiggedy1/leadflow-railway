import { createHash } from "crypto";
import { readFile } from "fs/promises";
import path from "path";
import type {
  DatabaseColumn,
  DatabaseIndex,
  LedgerRow,
  ManagedMigration,
  ManagedMigrationManifest,
  MigrationDb,
  MigrationState,
  PostconditionResult,
  TablePostconditions,
} from "./contracts.js";
import { evaluatePostconditions } from "./postconditions.js";

const LEDGER_TABLE = "app_versioned_migration_ledger";
const LOCK_NAME = "leadflow:versioned-migrations";

export class ManagedMigrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ManagedMigrationError";
  }
}

export interface RunnerDependencies {
  db: MigrationDb;
  migrationsDirectory: string;
  logger?: Pick<Console, "info" | "error">;
  lockTimeoutSeconds?: number;
}

export interface MigrationRunResult {
  id: string;
  outcome: "applied" | "recovered" | "skipped";
}

function asRows<T>(result: unknown): T[] {
  if (Array.isArray(result) && Array.isArray(result[0])) return result[0] as T[];
  return result as T[];
}

function splitStatements(sql: string): string[] {
  return sql
    .split(/^\s*-->\s*statement-breakpoint\s*$/m)
    .map(statement => statement.trim())
    .filter(Boolean);
}

function validateManifest(manifest: ManagedMigrationManifest): void {
  if (manifest.format !== 1 || !Array.isArray(manifest.migrations)) {
    throw new ManagedMigrationError("Invalid managed migration manifest format");
  }
  const ids = new Set<string>();
  for (const migration of manifest.migrations) {
    if (!/^[a-z0-9][a-z0-9_-]*$/.test(migration.id)) {
      throw new ManagedMigrationError(`Invalid migration id ${migration.id}`);
    }
    if (ids.has(migration.id)) throw new ManagedMigrationError(`Duplicate migration id ${migration.id}`);
    if (!/^[a-f0-9]{64}$/.test(migration.sha256)) {
      throw new ManagedMigrationError(`Invalid SHA-256 for ${migration.id}`);
    }
    if (migration.replayMode !== "verified-idempotent") {
      throw new ManagedMigrationError(`Unsupported replay mode for ${migration.id}`);
    }
    ids.add(migration.id);
  }
}

async function readManifest(migrationsDirectory: string): Promise<ManagedMigrationManifest> {
  const content = await readFile(path.join(migrationsDirectory, "manifest.json"), "utf8");
  const manifest = JSON.parse(content) as ManagedMigrationManifest;
  validateManifest(manifest);
  return manifest;
}

async function readMigrationFiles(
  migrationsDirectory: string,
  migration: ManagedMigration,
): Promise<{ sql: string; postconditions: TablePostconditions }> {
  const [sql, postconditionContent] = await Promise.all([
    readFile(path.join(migrationsDirectory, migration.sqlFile), "utf8"),
    readFile(path.join(migrationsDirectory, migration.postconditionsFile), "utf8"),
  ]);
  const sha256 = createHash("sha256").update(sql).digest("hex");
  if (sha256 !== migration.sha256) {
    throw new ManagedMigrationError(`Checksum mismatch for ${migration.id}`);
  }
  const postconditions = JSON.parse(postconditionContent) as TablePostconditions;
  if (postconditions.format !== 1 || !postconditions.table) {
    throw new ManagedMigrationError(`Invalid postconditions for ${migration.id}`);
  }
  return { sql, postconditions };
}

async function ensureLedger(db: MigrationDb): Promise<void> {
  await db.query(`
    CREATE TABLE IF NOT EXISTS \`${LEDGER_TABLE}\` (
      \`migration_id\` varchar(255) NOT NULL,
      \`sha256\` char(64) NOT NULL,
      \`state\` varchar(16) NOT NULL,
      \`started_at\` datetime(3) NOT NULL,
      \`applied_at\` datetime(3) NULL,
      \`attempt_count\` int NOT NULL DEFAULT 0,
      \`last_attempt_at\` datetime(3) NOT NULL,
      \`last_error\` text NULL,
      PRIMARY KEY (\`migration_id\`)
    )
  `);
}

async function acquireLock(db: MigrationDb, timeoutSeconds: number): Promise<void> {
  const rows = asRows<{ acquired: number | null }>(
    await db.query("SELECT GET_LOCK(?, ?) AS acquired", [LOCK_NAME, timeoutSeconds]),
  );
  if (rows[0]?.acquired !== 1) {
    throw new ManagedMigrationError("Could not acquire versioned migration advisory lock");
  }
}

async function releaseLock(db: MigrationDb): Promise<void> {
  await db.query("SELECT RELEASE_LOCK(?)", [LOCK_NAME]);
}

async function getLedgerRow(db: MigrationDb, id: string): Promise<LedgerRow | undefined> {
  const rows = asRows<{
    migration_id: string;
    sha256: string;
    state: MigrationState;
    attempt_count: number;
  }>(
    await db.query(
      `SELECT migration_id, sha256, state, attempt_count FROM \`${LEDGER_TABLE}\` WHERE migration_id = ?`,
      [id],
    ),
  );
  const row = rows[0];
  return row
    ? { migrationId: row.migration_id, sha256: row.sha256, state: row.state, attemptCount: row.attempt_count }
    : undefined;
}

async function markStarted(db: MigrationDb, migration: ManagedMigration): Promise<void> {
  await db.query(
    `INSERT INTO \`${LEDGER_TABLE}\`
      (migration_id, sha256, state, started_at, attempt_count, last_attempt_at, last_error)
     VALUES (?, ?, 'started', CURRENT_TIMESTAMP(3), 1, CURRENT_TIMESTAMP(3), NULL)
     ON DUPLICATE KEY UPDATE
       sha256 = VALUES(sha256),
       state = 'started',
       attempt_count = attempt_count + 1,
       last_attempt_at = CURRENT_TIMESTAMP(3),
       last_error = NULL`,
    [migration.id, migration.sha256],
  );
}

async function markApplied(db: MigrationDb, migration: ManagedMigration): Promise<void> {
  await db.query(
    `UPDATE \`${LEDGER_TABLE}\`
        SET state = 'applied', applied_at = CURRENT_TIMESTAMP(3),
            last_attempt_at = CURRENT_TIMESTAMP(3), last_error = NULL
      WHERE migration_id = ? AND sha256 = ?`,
    [migration.id, migration.sha256],
  );
}

async function markFailed(db: MigrationDb, migration: ManagedMigration, error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  await db.query(
    `UPDATE \`${LEDGER_TABLE}\`
        SET state = 'failed', last_attempt_at = CURRENT_TIMESTAMP(3), last_error = ?
      WHERE migration_id = ? AND sha256 = ?`,
    [message.slice(0, 4000), migration.id, migration.sha256],
  );
}

async function verifyPostconditions(db: MigrationDb, expected: TablePostconditions): Promise<PostconditionResult> {
  const tableRows = asRows<{ table_name: string }>(
    await db.query(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = DATABASE() AND table_name = ?`,
      [expected.table],
    ),
  );
  if (!tableRows.length) return evaluatePostconditions(expected, false, [], []);

  const [columnsResult, indexesResult] = await Promise.all([
    db.query(
      `SELECT column_name, column_type, is_nullable, extra, column_default
         FROM information_schema.columns
        WHERE table_schema = DATABASE() AND table_name = ?
        ORDER BY ordinal_position`,
      [expected.table],
    ),
    db.query(
      `SELECT index_name, non_unique, seq_in_index, column_name
         FROM information_schema.statistics
        WHERE table_schema = DATABASE() AND table_name = ?
        ORDER BY index_name, seq_in_index`,
      [expected.table],
    ),
  ]);
  const columns = asRows<{
    column_name: string;
    column_type: string;
    is_nullable: string;
    extra: string;
    column_default: string | null;
  }>(columnsResult).map<DatabaseColumn>(row => ({
    name: row.column_name,
    columnType: row.column_type,
    nullable: row.is_nullable.toUpperCase() === "YES",
    autoIncrement: row.extra.toLowerCase().includes("auto_increment"),
    default: row.column_default,
  }));
  const rawIndexes = asRows<{
    index_name: string;
    non_unique: number | string;
    seq_in_index: number;
    column_name: string;
  }>(indexesResult);
  const indexMap = new Map<string, DatabaseIndex>();
  for (const row of rawIndexes) {
    const current = indexMap.get(row.index_name) ?? {
      name: row.index_name,
      unique: Number(row.non_unique) === 0,
      columns: [],
    };
    current.columns[row.seq_in_index - 1] = row.column_name;
    indexMap.set(row.index_name, current);
  }
  return evaluatePostconditions(expected, true, columns, [...indexMap.values()]);
}

async function executeMigrationSql(db: MigrationDb, sql: string): Promise<void> {
  for (const statement of splitStatements(sql)) await db.query(statement);
}

async function runOneMigration(
  db: MigrationDb,
  migration: ManagedMigration,
  migrationsDirectory: string,
  logger: Pick<Console, "info" | "error">,
): Promise<MigrationRunResult> {
  const { sql, postconditions } = await readMigrationFiles(migrationsDirectory, migration);
  const existing = await getLedgerRow(db, migration.id);
  if (existing && existing.sha256 !== migration.sha256) {
    throw new ManagedMigrationError(`Immutable checksum mismatch in ledger for ${migration.id}`);
  }

  const before = await verifyPostconditions(db, postconditions);
  if (existing?.state === "applied") {
    if (!before.valid) {
      throw new ManagedMigrationError(
        `Applied migration ${migration.id} has schema drift: ${before.differences.join("; ")}`,
      );
    }
    logger.info("migration_skipped", { migrationId: migration.id, reason: "already_applied" });
    return { id: migration.id, outcome: "skipped" };
  }

  if (before.tableExists) {
    if (!before.valid) {
      const error = new ManagedMigrationError(
        `Existing table for ${migration.id} is divergent; refusing CREATE TABLE retry: ${before.differences.join("; ")}`,
      );
      await markStarted(db, migration);
      await markFailed(db, migration, error);
      throw error;
    }
    await markStarted(db, migration);
    await markApplied(db, migration);
    logger.info("migration_recovered", { migrationId: migration.id, reason: "existing_schema_verified" });
    return { id: migration.id, outcome: "recovered" };
  }

  await markStarted(db, migration);
  try {
    logger.info("migration_started", { migrationId: migration.id });
    await executeMigrationSql(db, sql);
    const after = await verifyPostconditions(db, postconditions);
    if (!after.valid) {
      throw new ManagedMigrationError(
        `Postconditions failed for ${migration.id}: ${after.differences.join("; ")}`,
      );
    }
    logger.info("migration_postconditions_passed", { migrationId: migration.id });
    await markApplied(db, migration);
    logger.info("migration_applied", { migrationId: migration.id });
    return { id: migration.id, outcome: "applied" };
  } catch (error) {
    await markFailed(db, migration, error);
    logger.error("migration_failed", { migrationId: migration.id, error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}

export async function runManagedMigrations(dependencies: RunnerDependencies): Promise<MigrationRunResult[]> {
  const logger = dependencies.logger ?? console;
  const timeoutSeconds = dependencies.lockTimeoutSeconds ?? 30;
  const manifest = await readManifest(dependencies.migrationsDirectory);
  let locked = false;
  try {
    await acquireLock(dependencies.db, timeoutSeconds);
    locked = true;
    logger.info("migration_lock_acquired", { lock: LOCK_NAME });
    await ensureLedger(dependencies.db);
    const results: MigrationRunResult[] = [];
    for (const migration of manifest.migrations) {
      results.push(await runOneMigration(dependencies.db, migration, dependencies.migrationsDirectory, logger));
    }
    return results;
  } finally {
    if (locked) {
      await releaseLock(dependencies.db);
      logger.info("migration_lock_released", { lock: LOCK_NAME });
    }
  }
}
