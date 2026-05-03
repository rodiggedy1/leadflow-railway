import { createConnection } from "mysql2/promise";
import * as dotenv from "dotenv";
dotenv.config();

const DB_URL = process.env.DATABASE_URL;
if (!DB_URL) { console.error("No DATABASE_URL"); process.exit(1); }

// Parse the connection string
const url = new URL(DB_URL);
const conn = await createConnection({
  host: url.hostname,
  port: parseInt(url.port || "3306"),
  user: url.username,
  password: url.password,
  database: url.pathname.replace("/", ""),
  ssl: { rejectUnauthorized: false },
});

// Tables we care about based on the cron errors
const tablesToCheck = [
  "field_mgmt_log",
  "completed_job_batches",
  "cleaner_jobs",
  "cron_heartbeats",
  "ops_chat_messages",
];

console.log("=== LIVE DATABASE COLUMN AUDIT ===\n");

for (const table of tablesToCheck) {
  try {
    const [rows] = await conn.execute(
      `SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT
       FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
       ORDER BY ORDINAL_POSITION`,
      [table]
    );
    if (rows.length === 0) {
      console.log(`TABLE: ${table} — ❌ DOES NOT EXIST IN LIVE DB`);
    } else {
      console.log(`TABLE: ${table} (${rows.length} columns)`);
      for (const row of rows) {
        console.log(`  - ${row.COLUMN_NAME}: ${row.COLUMN_TYPE} ${row.IS_NULLABLE === "NO" ? "NOT NULL" : "NULL"}`);
      }
    }
    console.log();
  } catch (err) {
    console.log(`TABLE: ${table} — ERROR: ${err.message}`);
  }
}

await conn.end();
