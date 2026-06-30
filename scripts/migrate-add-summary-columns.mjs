/**
 * migrate-add-summary-columns.mjs
 *
 * Phase 1: Add the 5 inbox summary columns to conversation_sessions.
 * Idempotent — uses IF NOT EXISTS / checks before adding.
 * Stops after schema change and SHOW COLUMNS verification.
 *
 * Usage:
 *   node scripts/migrate-add-summary-columns.mjs
 */

import { createConnection } from "mysql2/promise";
import * as dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "../.env") });

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("ERROR: DATABASE_URL env var is not set.");
  process.exit(1);
}

async function main() {
  const conn = await createConnection(DATABASE_URL);

  // ── Step 1: Verify we are connected to the correct Railway database ──────────
  const [[{ host, db }]] = await conn.execute(
    "SELECT @@hostname AS host, DATABASE() AS db"
  );
  console.log(`\nConnected to:`);
  console.log(`  Host: ${host}`);
  console.log(`  Database: ${db}`);

  // Confirm this is the Railway TiDB cluster (not the Manus sandbox DB)
  const [[{ tableCount }]] = await conn.execute(
    "SELECT COUNT(*) AS tableCount FROM information_schema.tables WHERE table_schema = DATABASE()"
  );
  const [[{ sessionCount }]] = await conn.execute(
    "SELECT COUNT(*) AS sessionCount FROM conversation_sessions"
  );
  console.log(`  Tables in schema: ${tableCount}`);
  console.log(`  Rows in conversation_sessions: ${sessionCount}`);
  console.log();

  // ── Step 2: Add columns (safe — each uses IF NOT EXISTS equivalent) ──────────
  console.log("Adding summary columns to conversation_sessions...");

  const columns = [
    { name: "lastMessageText",     ddl: "VARCHAR(255) NULL" },
    { name: "lastMessageTs",       ddl: "BIGINT NULL" },
    { name: "lastCustomerMessageTs", ddl: "BIGINT NULL" },
    { name: "lastMessageRole",     ddl: "VARCHAR(16) NULL" },
    { name: "messageCount",        ddl: "INT NOT NULL DEFAULT 0" },
  ];

  // Check which columns already exist
  const [existingCols] = await conn.execute(
    "SELECT COLUMN_NAME FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'conversation_sessions'"
  );
  const existingNames = new Set(existingCols.map(r => r.COLUMN_NAME));

  for (const col of columns) {
    if (existingNames.has(col.name)) {
      console.log(`  SKIP  ${col.name} — already exists`);
    } else {
      await conn.execute(
        `ALTER TABLE conversation_sessions ADD COLUMN ${col.name} ${col.ddl}`
      );
      console.log(`  ADDED ${col.name} ${col.ddl}`);
    }
  }

  // ── Step 3: Verify with SHOW COLUMNS ─────────────────────────────────────────
  console.log("\nVerifying columns with SHOW COLUMNS FROM conversation_sessions:\n");
  const [cols] = await conn.execute("SHOW COLUMNS FROM conversation_sessions");
  const summaryColNames = new Set(columns.map(c => c.name));
  for (const col of cols) {
    if (summaryColNames.has(col.Field)) {
      console.log(`  ✓  ${col.Field.padEnd(30)} ${col.Type.padEnd(20)} Null=${col.Null} Default=${col.Default ?? "NULL"}`);
    }
  }

  console.log("\nPhase 1 complete. Schema migration successful.");
  console.log("Run Phase 2 (backfill) when ready.");

  await conn.end();
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
