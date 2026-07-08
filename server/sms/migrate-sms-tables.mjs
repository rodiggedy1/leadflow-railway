/**
 * migrate-sms-tables.mjs
 *
 * ONE-TIME manual migration script for the 3 SMS campaign tables.
 *
 * USAGE (Railway preview only):
 *   railway run --environment preview node server/sms/migrate-sms-tables.mjs
 *
 * DO NOT:
 *   - Wire this to any API route
 *   - Add this to the app start command
 *   - Run against production without explicit approval
 *
 * Guarantees:
 *   - Idempotent: CREATE TABLE/INDEX IF NOT EXISTS throughout
 *   - Fail-fast: any error aborts immediately — no partial state
 *   - Reports each index as "created" or "already existed"
 *   - Explicitly verifies uq_campaign_phone unique constraint exists
 *   - Prints full SHOW CREATE TABLE DDL for each table
 *
 * Note on transactions: DDL statements (CREATE TABLE, CREATE INDEX) cause
 * an implicit commit in MySQL and cannot be rolled back inside a transaction.
 * The script uses fail-fast instead: it aborts on the first error and prints
 * exactly which statement failed so you can inspect and re-run safely.
 * All statements are IF NOT EXISTS, so a partial run leaves no broken state.
 */

import mysql from "mysql2/promise";
import * as dotenv from "dotenv";

dotenv.config();

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("❌  DATABASE_URL is not set. Aborting.");
  process.exit(1);
}

// ─── SQL statements ───────────────────────────────────────────────────────────

const CREATE_SMS_CAMPAIGNS = `
CREATE TABLE IF NOT EXISTS \`sms_campaigns\` (
  \`id\` int AUTO_INCREMENT NOT NULL,
  \`name\` varchar(255) NOT NULL,
  \`status\` enum('DRAFT','FROZEN','APPROVED','SENDING','PAUSED','COMPLETED','CANCELLED') NOT NULL DEFAULT 'DRAFT',
  \`audienceDefinition\` longtext NOT NULL,
  \`messageTemplate\` text NOT NULL,
  \`plannerResult\` longtext,
  \`frozenAt\` bigint,
  \`frozenRecipientCount\` int,
  \`definitionHash\` varchar(64),
  \`approvedAt\` bigint,
  \`approvedByAgentId\` int,
  \`approvedByName\` varchar(255),
  \`sentCount\` int NOT NULL DEFAULT 0,
  \`failedCount\` int NOT NULL DEFAULT 0,
  \`repliedCount\` int NOT NULL DEFAULT 0,
  \`bookedCount\` int NOT NULL DEFAULT 0,
  \`sendStartedAt\` bigint,
  \`sendCompletedAt\` bigint,
  \`estimatedRevenue\` int,
  \`estimatedBookings\` int,
  \`estimatedReplies\` int,
  \`isDryRun\` tinyint NOT NULL DEFAULT 0,
  \`testPhones\` text,
  \`createdByAgentId\` int,
  \`createdByName\` varchar(255) NOT NULL,
  \`sentByAgentId\` int,
  \`sentByName\` varchar(255),
  \`createdAt\` timestamp NOT NULL DEFAULT (now()),
  \`updatedAt\` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT \`sms_campaigns_id\` PRIMARY KEY(\`id\`)
)
`;

const CREATE_SMS_CAMPAIGN_RECIPIENTS = `
CREATE TABLE IF NOT EXISTS \`sms_campaign_recipients\` (
  \`id\` int AUTO_INCREMENT NOT NULL,
  \`campaignId\` int NOT NULL,
  \`phone\` varchar(30) NOT NULL,
  \`phoneNormalized\` varchar(20) NOT NULL,
  \`snapshotFirstName\` varchar(100),
  \`snapshotName\` varchar(255),
  \`snapshotAddress\` varchar(500),
  \`snapshotLastService\` varchar(100),
  \`snapshotLastPrice\` int,
  \`completedJobId\` int NOT NULL,
  \`personalizedMessage\` text NOT NULL,
  \`status\` enum('PENDING','SENT','FAILED','SKIPPED') NOT NULL DEFAULT 'PENDING',
  \`sentAt\` bigint,
  \`openPhoneMessageId\` varchar(128),
  \`sessionId\` int,
  \`errorMessage\` varchar(500),
  \`skipReason\` varchar(255),
  \`createdAt\` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT \`sms_campaign_recipients_id\` PRIMARY KEY(\`id\`),
  CONSTRAINT \`uq_campaign_phone\` UNIQUE(\`campaignId\`,\`phoneNormalized\`)
)
`;

const CREATE_SMS_CAMPAIGN_SEND_LOG = `
CREATE TABLE IF NOT EXISTS \`sms_campaign_send_log\` (
  \`id\` int AUTO_INCREMENT NOT NULL,
  \`campaignId\` int NOT NULL,
  \`recipientId\` int NOT NULL,
  \`phoneNormalized\` varchar(20) NOT NULL,
  \`action\` enum('SENT','FAILED','SKIPPED','TEST_SENT') NOT NULL,
  \`batchNumber\` int NOT NULL DEFAULT 1,
  \`attempt\` int NOT NULL DEFAULT 1,
  \`durationMs\` int,
  \`openPhoneMessageId\` varchar(128),
  \`errorMessage\` varchar(500),
  \`triggeredBy\` varchar(255),
  \`attemptedAt\` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT \`sms_campaign_send_log_id\` PRIMARY KEY(\`id\`)
)
`;

// Each index: { name, sql, table }
const INDEXES = [
  {
    name: "idx_campaign_recipients_campaign_id",
    table: "sms_campaign_recipients",
    sql: "CREATE INDEX IF NOT EXISTS `idx_campaign_recipients_campaign_id` ON `sms_campaign_recipients` (`campaignId`)",
  },
  {
    name: "idx_campaign_recipients_status",
    table: "sms_campaign_recipients",
    sql: "CREATE INDEX IF NOT EXISTS `idx_campaign_recipients_status` ON `sms_campaign_recipients` (`campaignId`,`status`)",
  },
  {
    name: "idx_send_log_campaign",
    table: "sms_campaign_send_log",
    sql: "CREATE INDEX IF NOT EXISTS `idx_send_log_campaign` ON `sms_campaign_send_log` (`campaignId`)",
  },
  {
    name: "idx_send_log_phone",
    table: "sms_campaign_send_log",
    sql: "CREATE INDEX IF NOT EXISTS `idx_send_log_phone` ON `sms_campaign_send_log` (`phoneNormalized`)",
  },
  {
    name: "idx_sms_campaigns_status",
    table: "sms_campaigns",
    sql: "CREATE INDEX IF NOT EXISTS `idx_sms_campaigns_status` ON `sms_campaigns` (`status`)",
  },
  {
    name: "idx_sms_campaigns_created_at",
    table: "sms_campaigns",
    sql: "CREATE INDEX IF NOT EXISTS `idx_sms_campaigns_created_at` ON `sms_campaigns` (`createdAt`)",
  },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Returns the set of index names that already exist on a given table.
 * Uses INFORMATION_SCHEMA so we can distinguish "created" vs "already existed".
 */
async function getExistingIndexes(conn, tableName) {
  const [rows] = await conn.query(
    `SELECT INDEX_NAME FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
     GROUP BY INDEX_NAME`,
    [tableName]
  );
  return new Set(rows.map((r) => r.INDEX_NAME));
}

/**
 * Verifies that the uq_campaign_phone unique constraint exists on
 * sms_campaign_recipients by querying INFORMATION_SCHEMA.TABLE_CONSTRAINTS.
 */
async function verifyUniqueConstraint(conn) {
  const [rows] = await conn.query(
    `SELECT CONSTRAINT_NAME, CONSTRAINT_TYPE
     FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'sms_campaign_recipients'
       AND CONSTRAINT_NAME = 'uq_campaign_phone'
       AND CONSTRAINT_TYPE = 'UNIQUE'`
  );
  return rows.length > 0;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("=".repeat(60));
  console.log("SMS Campaign Tables — Manual Migration");
  console.log("=".repeat(60));
  console.log(`DATABASE_URL: ${DATABASE_URL.replace(/:\/\/[^@]+@/, "://<redacted>@")}`);
  console.log();
  console.log("NOTE: MySQL DDL cannot be rolled back inside a transaction.");
  console.log("      This script uses fail-fast: it aborts on the first error.");
  console.log("      All statements use IF NOT EXISTS — re-running is safe.");
  console.log();

  const conn = await mysql.createConnection(DATABASE_URL);

  try {
    // ── Step 1: Show existing sms_campaign* tables ──────────────────────────
    console.log("STEP 1 — Existing sms_campaign* tables before migration:");
    const [existingTables] = await conn.query("SHOW TABLES LIKE 'sms_campaign%'");
    if (existingTables.length === 0) {
      console.log("  (none — all 3 tables will be created)");
    } else {
      for (const row of existingTables) {
        console.log("  ✓ already exists:", Object.values(row)[0]);
      }
    }
    console.log();

    // ── Step 2: Create tables (fail-fast on any error) ──────────────────────
    console.log("STEP 2 — Creating tables (IF NOT EXISTS):");

    console.log("  → sms_campaigns ...");
    await conn.query(CREATE_SMS_CAMPAIGNS);
    console.log("  ✓ sms_campaigns OK");

    console.log("  → sms_campaign_recipients ...");
    await conn.query(CREATE_SMS_CAMPAIGN_RECIPIENTS);
    console.log("  ✓ sms_campaign_recipients OK");

    console.log("  → sms_campaign_send_log ...");
    await conn.query(CREATE_SMS_CAMPAIGN_SEND_LOG);
    console.log("  ✓ sms_campaign_send_log OK");
    console.log();

    // ── Step 3: Create indexes — report created vs already existed ──────────
    console.log("STEP 3 — Creating indexes:");

    for (const idx of INDEXES) {
      // Check before attempting so we can report accurately
      const existingBefore = await getExistingIndexes(conn, idx.table);
      const alreadyExisted = existingBefore.has(idx.name);

      if (!alreadyExisted) {
        try {
          await conn.query(idx.sql);
          console.log(`  ✅ CREATED:         ${idx.name}`);
        } catch (err) {
          // ER_DUP_KEYNAME = index already exists (MySQL <8.0 IF NOT EXISTS gap)
          if (err.code === "ER_DUP_KEYNAME") {
            console.log(`  ✓  already existed: ${idx.name}`);
          } else {
            // Fail fast — do not continue
            throw new Error(`Failed to create index ${idx.name}: ${err.message}`);
          }
        }
      } else {
        console.log(`  ✓  already existed: ${idx.name}`);
      }
    }
    console.log();

    // ── Step 4: Verify uq_campaign_phone unique constraint ──────────────────
    console.log("STEP 4 — Verifying uq_campaign_phone unique constraint:");
    const constraintExists = await verifyUniqueConstraint(conn);
    if (constraintExists) {
      console.log("  ✅ uq_campaign_phone UNIQUE constraint confirmed on sms_campaign_recipients");
    } else {
      // This is a hard failure — the constraint is non-negotiable
      throw new Error(
        "uq_campaign_phone UNIQUE constraint NOT FOUND on sms_campaign_recipients. " +
        "The table may have been created without it. Inspect the DDL and fix manually."
      );
    }
    console.log();

    // ── Step 5: Verify with SHOW CREATE TABLE ───────────────────────────────
    console.log("STEP 5 — Full DDL verification (SHOW CREATE TABLE):");
    for (const table of ["sms_campaigns", "sms_campaign_recipients", "sms_campaign_send_log"]) {
      const [rows] = await conn.query(`SHOW CREATE TABLE \`${table}\``);
      const ddl = rows[0]["Create Table"];
      console.log(`\n--- ${table} ---`);
      console.log(ddl);
    }
    console.log();

    // ── Step 6: Final table list ────────────────────────────────────────────
    console.log("STEP 6 — Final SHOW TABLES LIKE 'sms_campaign%':");
    const [finalTables] = await conn.query("SHOW TABLES LIKE 'sms_campaign%'");
    for (const row of finalTables) {
      console.log("  ✓", Object.values(row)[0]);
    }
    if (finalTables.length !== 3) {
      throw new Error(`Expected 3 tables, found ${finalTables.length}. Something went wrong.`);
    }

    console.log();
    console.log("=".repeat(60));
    console.log("✅  Migration complete. All 3 tables and 6 indexes verified.");
    console.log("    uq_campaign_phone unique constraint confirmed.");
    console.log("=".repeat(60));
  } catch (err) {
    console.error();
    console.error("❌  Migration FAILED:", err.message);
    console.error(err);
    process.exit(1);
  } finally {
    await conn.end();
  }
}

main();
