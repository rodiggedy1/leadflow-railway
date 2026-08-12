import mysql from "mysql2/promise";
import path from "path";
import { runManagedMigrations } from "./migrations/managedRunner.js";

async function main(): Promise<void> {
  if (process.env.RUN_VERSIONED_MIGRATIONS !== "true") {
    console.info("migration_runner_skipped", { reason: "RUN_VERSIONED_MIGRATIONS is not true" });
    return;
  }
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required when migrations are enabled");

  const pool = mysql.createPool({ uri: process.env.DATABASE_URL, connectionLimit: 1 });
  const connection = await pool.getConnection();
  try {
    await runManagedMigrations({
      db: { query: (sql, params) => connection.query(sql, params) },
      migrationsDirectory: path.resolve(process.cwd(), "server", "versioned-migrations"),
    });
    console.info("migration_runner_completed");
  } finally {
    connection.release();
    await pool.end();
  }
}

main().catch(error => {
  console.error("migration_runner_failed", { error: error instanceof Error ? error.message : String(error) });
  process.exit(1);
});
