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
 * This script is idempotent. It uses CREATE TABLE IF NOT EXISTS and
 * CREATE INDEX IF NOT EXISTS throughout. Running it twice is safe.
 *
 * Sequence:
 *   1. SHOW TABLES LIKE 'sms_campaign%'  — print what already exists
 *   2. CREATE TABLE IF NOT EXISTS for each of the 3 tables
 *   3. CREATE INDEX IF NOT EXISTS for each of the 6 indexes
 *   4. SHOW CREATE TABLE for each table — print for verification
 *   5. Exit 0 on success, Exit 1 on any error
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

// Indexes — use IF NOT EXISTS (MySQL 8.0+)
const INDEXES = [
  `CREATE INDEX IF NOT EXISTS \`idx_campaign_recipients_campaign_id\` ON \`sms_campaign_recipients\` (\`campaignId\`)`,
  `CREATE INDEX IF NOT EXISTS \`idx_campaign_recipients_status\` ON \`sms_campaign_recipients\` (\`campaignId\`,\`status\`)`,
  `CREATE INDEX IF NOT EXISTS \`idx_send_log_campaign\` ON \`sms_campaign_send_log\` (\`campaignId\`)`,
  `CREATE INDEX IF NOT EXISTS \`idx_send_log_phone\` ON \`sms_campaign_send_log\` (\`phoneNormalized\`)`,
  `CREATE INDEX IF NOT EXISTS \`idx_sms_campaigns_status\` ON \`sms_campaigns\` (\`status\`)`,
  `CREATE INDEX IF NOT EXISTS \`idx_sms_campaigns_created_at\` ON \`sms_campaigns\` (\`createdAt\`)`,
];

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("=".repeat(60));
  console.log("SMS Campaign Tables — Manual Migration");
  console.log("=".repeat(60));
  console.log(`DATABASE_URL: ${DATABASE_URL.replace(/:\/\/[^@]+@/, "://<redacted>@")}`);
  console.log();

  const conn = await mysql.createConnection(DATABASE_URL);

  try {
    // ── Step 1: Show existing sms_campaign* tables ──────────────────────────
    console.log("STEP 1 — Existing sms_campaign* tables:");
    const [existingTables] = await conn.query("SHOW TABLES LIKE 'sms_campaign%'");
    if (existingTables.length === 0) {
      console.log("  (none — all 3 tables will be created)");
    } else {
      for (const row of existingTables) {
        console.log("  ✓ already exists:", Object.values(row)[0]);
      }
    }
    console.log();

    // ── Step 2: Create tables ───────────────────────────────────────────────
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

    // ── Step 3: Create indexes ──────────────────────────────────────────────
    console.log("STEP 3 — Creating indexes (IF NOT EXISTS):");
    for (const idx of INDEXES) {
      const name = idx.match(/`([^`]+)`\s+ON/)?.[1] ?? "unknown";
      try {
        await conn.query(idx);
        console.log(`  ✓ ${name}`);
      } catch (err) {
        // MySQL <8.0 doesn't support IF NOT EXISTS on indexes — treat duplicate as OK
        if (err.code === "ER_DUP_KEYNAME") {
          console.log(`  ✓ ${name} (already exists)`);
        } else {
          throw err;
        }
      }
    }
    console.log();

    // ── Step 4: Verify with SHOW CREATE TABLE ───────────────────────────────
    console.log("STEP 4 — Verification (SHOW CREATE TABLE):");
    for (const table of ["sms_campaigns", "sms_campaign_recipients", "sms_campaign_send_log"]) {
      const [rows] = await conn.query(`SHOW CREATE TABLE \`${table}\``);
      const ddl = rows[0]["Create Table"];
      console.log(`\n--- ${table} ---`);
      console.log(ddl);
    }
    console.log();

    // ── Step 5: Final table list ────────────────────────────────────────────
    console.log("STEP 5 — Final SHOW TABLES LIKE 'sms_campaign%':");
    const [finalTables] = await conn.query("SHOW TABLES LIKE 'sms_campaign%'");
    for (const row of finalTables) {
      console.log("  ✓", Object.values(row)[0]);
    }

    console.log();
    console.log("=".repeat(60));
    console.log("✅  Migration complete. All 3 tables verified.");
    console.log("=".repeat(60));
  } catch (err) {
    console.error();
    console.error("❌  Migration failed:", err.message);
    console.error(err);
    process.exit(1);
  } finally {
    await conn.end();
  }
}

main();
