import { createHash } from "crypto";
import { readFile } from "fs/promises";
import path from "path";
import { describe, expect, it } from "vitest";

const migrationsDirectory = path.resolve(process.cwd(), "server", "versioned-migrations");

const expectedMigrations = [
  { id: "0017_create_customer_portal_accounts", sqlFile: "0017_create_customer_portal_accounts.sql", table: "customer_portal_accounts" },
  { id: "0018_create_customer_portal_handoff_tokens", sqlFile: "0018_create_customer_portal_handoff_tokens.sql", table: "customer_portal_handoff_tokens" },
  { id: "0019_create_customer_portal_service_requests", sqlFile: "0019_create_customer_portal_service_requests.sql", table: "customer_portal_service_requests" },
] as const;

describe("customer portal standalone schema rollout", () => {
  it("registers all portal tables as immutable managed create-table migrations", async () => {
    const manifest = JSON.parse(await readFile(path.join(migrationsDirectory, "manifest.json"), "utf8")) as {
      migrations: Array<{ id: string; mode?: string; sqlFile: string; sha256: string; replayMode: string; postconditionsFile: string }>;
    };

    for (const expected of expectedMigrations) {
      const migration = manifest.migrations.find(candidate => candidate.id === expected.id);
      expect(migration).toMatchObject({
        id: expected.id,
        mode: "create-table",
        sqlFile: expected.sqlFile,
        replayMode: "verified-idempotent",
      });

      const sql = await readFile(path.join(migrationsDirectory, expected.sqlFile), "utf8");
      expect(createHash("sha256").update(sql).digest("hex")).toBe(migration?.sha256);
      expect(sql).toContain(`CREATE TABLE \`${expected.table}\``);
      expect(sql).not.toMatch(/\b(?:DROP|TRUNCATE|DELETE|UPDATE|INSERT|ALTER)\b/i);

      const postconditions = JSON.parse(await readFile(path.join(migrationsDirectory, migration!.postconditionsFile), "utf8")) as { table: string };
      expect(postconditions.table).toBe(expected.table);
    }
  });

  it("runs the established managed migration runner before the application starts", async () => {
    const railwayConfig = await readFile(path.resolve(process.cwd(), "railway.json"), "utf8");
    expect(railwayConfig).toContain("RUN_VERSIONED_MIGRATIONS=true node dist/runVersionedMigrations.js");
    expect(railwayConfig).toContain('"startCommand": "node dist/index.js"');
  });
});
