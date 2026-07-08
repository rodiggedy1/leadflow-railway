/**
 * schemaCheck.ts
 *
 * Startup schema compatibility guard for SMS campaign tables.
 *
 * Run this once before the server starts accepting requests.  If any required
 * column, enum value, or index is missing the process exits with a clear,
 * actionable error message instead of letting MySQL throw a cryptic error
 * mid-request.
 *
 * Usage (in server/_core/index.ts, inside startServer(), before app.listen):
 *   import { checkSmsCampaignSchema } from "../sms/schemaCheck";
 *   await checkSmsCampaignSchema();
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * TODO: Migrate to version-based schema tracking (planned)
 *
 * As the app grows, column-by-column checks become hard to maintain.
 * The planned approach is:
 *
 *   1. Create an `app_schema_version` table:
 *        CREATE TABLE app_schema_version (
 *          version    INT       NOT NULL PRIMARY KEY,
 *          applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
 *        );
 *
 *   2. Each migration inserts its version number:
 *        INSERT INTO app_schema_version (version) VALUES (83);
 *
 *   3. Startup becomes a single comparison:
 *        const REQUIRED_SCHEMA_VERSION = 83;
 *        const current = SELECT MAX(version) FROM app_schema_version;
 *        if (current < REQUIRED_SCHEMA_VERSION) → fail with clear message
 *
 *   4. Success log becomes:
 *        [SchemaCheck] ✓ Schema version 83 verified.
 *
 * This makes the check trivially maintainable as migrations accumulate.
 * Until then, this file serves as the authoritative list of required columns.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { getDb } from "../db";
import { sql } from "drizzle-orm";

// ── Types ────────────────────────────────────────────────────────────────────

interface ColumnRow {
  COLUMN_NAME: string;
}

interface IndexRow {
  INDEX_NAME: string;
  COLUMN_NAME: string;
}

// ── Configuration ─────────────────────────────────────────────────────────────

/**
 * The migration that introduced the columns being checked here.
 * Printed verbatim in error messages so the fix is copy/pasteable.
 */
const MIGRATION_FILE = "drizzle/0083_sms_campaign_recipients_snapshot_columns.sql";

/**
 * Schema version this code requires.
 * Update this constant whenever a new migration adds columns checked below.
 * Once the version-table approach (see TODO above) is implemented, this
 * constant drives the startup check directly.
 */
const REQUIRED_SCHEMA_VERSION = 83;

/**
 * Required columns per table.
 * Add entries here whenever a migration adds columns that application code
 * depends on.  Each entry is { column, migration } so error messages are
 * always copy/pasteable.
 */
const REQUIRED_COLUMNS: Record<string, Array<{ column: string; migration: string }>> = {
  sms_campaign_recipients: [
    // Core columns (sanity check — these should always exist)
    { column: "id",                      migration: MIGRATION_FILE },
    { column: "campaignId",              migration: MIGRATION_FILE },
    { column: "customerId",              migration: MIGRATION_FILE },
    { column: "phone",                   migration: MIGRATION_FILE },
    { column: "status",                  migration: MIGRATION_FILE },
    // Snapshot columns added in migration 0083
    { column: "snapshotFirstName",       migration: MIGRATION_FILE },
    { column: "snapshotLastService",     migration: MIGRATION_FILE },
    { column: "snapshotLastPrice",       migration: MIGRATION_FILE },
    { column: "snapshotCity",            migration: MIGRATION_FILE },
    { column: "snapshotFrequency",       migration: MIGRATION_FILE },
    { column: "snapshotBedrooms",        migration: MIGRATION_FILE },
    { column: "snapshotDaysSinceBooking",migration: MIGRATION_FILE },
    { column: "snapshotPreferredTeam",   migration: MIGRATION_FILE },
  ],
  sms_campaigns: [
    { column: "id",                   migration: MIGRATION_FILE },
    { column: "name",                 migration: MIGRATION_FILE },
    { column: "status",               migration: MIGRATION_FILE },
    { column: "messageTemplate",      migration: MIGRATION_FILE },
    { column: "frozenRecipientCount", migration: MIGRATION_FILE },
    { column: "sentCount",            migration: MIGRATION_FILE },
    { column: "repliedCount",         migration: MIGRATION_FILE },
    { column: "bookedCount",          migration: MIGRATION_FILE },
  ],
};

/**
 * Exact expected enum values for specific columns.
 * The check fails if the live enum is missing any value OR has unexpected extras
 * that could indicate a botched migration.
 */
const REQUIRED_ENUMS: Array<{
  table: string;
  column: string;
  expectedValues: string[];
  migration: string;
}> = [
  {
    table: "sms_campaign_recipients",
    column: "status",
    expectedValues: ["PENDING", "SENT", "FAILED", "SKIPPED", "BOOKED"],
    migration: MIGRATION_FILE,
  },
];

/**
 * Critical indexes that must exist for correctness or performance.
 * Each entry lists the index name and the columns it covers.
 */
const REQUIRED_INDEXES: Array<{
  table: string;
  indexName: string;
  columns: string[];
  migration: string;
}> = [
  {
    table: "sms_campaign_recipients",
    indexName: "uq_campaign_phone",
    columns: ["campaignId", "phone"],
    migration: MIGRATION_FILE,
  },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

async function fetchColumns(
  db: Awaited<ReturnType<typeof getDb>>,
  tableName: string
): Promise<Set<string>> {
  const rows = await db.execute(sql.raw(`
    SELECT COLUMN_NAME
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = '${tableName}'
  `)) as unknown as [ColumnRow[]];
  return new Set((rows[0] ?? []).map((r) => r.COLUMN_NAME));
}

async function fetchEnumValues(
  db: Awaited<ReturnType<typeof getDb>>,
  tableName: string,
  columnName: string
): Promise<string[]> {
  const rows = await db.execute(sql.raw(`
    SELECT COLUMN_TYPE
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = '${tableName}'
      AND COLUMN_NAME  = '${columnName}'
  `)) as unknown as [Array<{ COLUMN_TYPE: string }>];

  const columnType: string = rows[0]?.[0]?.COLUMN_TYPE ?? "";
  // COLUMN_TYPE looks like: enum('PENDING','SENT','FAILED','SKIPPED','BOOKED')
  const matches = columnType.match(/'([^']+)'/g);
  if (!matches) return [];
  return matches.map((m) => m.replace(/'/g, ""));
}

async function fetchIndexes(
  db: Awaited<ReturnType<typeof getDb>>,
  tableName: string
): Promise<Map<string, string[]>> {
  const rows = await db.execute(sql.raw(`
    SELECT INDEX_NAME, COLUMN_NAME
    FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = '${tableName}'
    ORDER BY INDEX_NAME, SEQ_IN_INDEX
  `)) as unknown as [IndexRow[]];

  const map = new Map<string, string[]>();
  for (const row of rows[0] ?? []) {
    const cols = map.get(row.INDEX_NAME) ?? [];
    cols.push(row.COLUMN_NAME);
    map.set(row.INDEX_NAME, cols);
  }
  return map;
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function checkSmsCampaignSchema(): Promise<void> {
  const db = await getDb();
  const errors: string[] = [];

  // 1. Column checks
  for (const [tableName, requiredCols] of Object.entries(REQUIRED_COLUMNS)) {
    const existing = await fetchColumns(db, tableName);
    for (const { column, migration } of requiredCols) {
      if (!existing.has(column)) {
        errors.push(
          `Missing column ${tableName}.${column}\n` +
          `    → Run: ${migration}`
        );
      }
    }
  }

  // 2. Exact enum checks
  for (const { table, column, expectedValues, migration } of REQUIRED_ENUMS) {
    const actual = await fetchEnumValues(db, table, column);
    const actualSet = new Set(actual);
    const expectedSet = new Set(expectedValues);

    const missing = expectedValues.filter((v) => !actualSet.has(v));
    const unexpected = actual.filter((v) => !expectedSet.has(v));

    if (missing.length > 0) {
      errors.push(
        `Enum ${table}.${column} is missing values: ${missing.join(", ")}\n` +
        `    Expected: ${expectedValues.join(", ")}\n` +
        `    Actual:   ${actual.join(", ")}\n` +
        `    → Run: ${migration}`
      );
    }
    if (unexpected.length > 0) {
      // Warn but don't fail — unexpected enum values are usually additive and safe
      console.warn(
        `[SchemaCheck] ⚠ Enum ${table}.${column} has unexpected values: ${unexpected.join(", ")}. ` +
        `This may indicate a migration was applied out of order.`
      );
    }
  }

  // 3. Index checks
  for (const { table, indexName, columns, migration } of REQUIRED_INDEXES) {
    const indexMap = await fetchIndexes(db, table);
    const actualCols = indexMap.get(indexName);
    if (!actualCols) {
      errors.push(
        `Missing index ${table}.${indexName} (columns: ${columns.join(", ")})\n` +
        `    → Run: ${migration}`
      );
    } else {
      const missing = columns.filter((c) => !actualCols.includes(c));
      if (missing.length > 0) {
        errors.push(
          `Index ${table}.${indexName} is missing columns: ${missing.join(", ")}\n` +
          `    Expected columns: ${columns.join(", ")}\n` +
          `    Actual columns:   ${actualCols.join(", ")}\n` +
          `    → Run: ${migration}`
        );
      }
    }
  }

  // ── Report ────────────────────────────────────────────────────────────────

  if (errors.length > 0) {
    console.error(`\n[SchemaCheck] ❌ Schema compatibility check FAILED (required version: ${REQUIRED_SCHEMA_VERSION}):`);
    for (const err of errors) {
      console.error(`\n  • ${err}`);
    }
    console.error(
      `\n[SchemaCheck] The application cannot start safely. ` +
      `Apply the pending migration(s) listed above and redeploy.\n`
    );
    process.exit(1);
  }

  console.log(`[SchemaCheck] ✓ Schema version ${REQUIRED_SCHEMA_VERSION} verified.`);
}
