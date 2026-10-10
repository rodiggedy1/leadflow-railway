import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const root = new URL("../", import.meta.url);

const cases = [
  {
    id: "0064_add_madison_extraction_diagnostics",
    table: "madison_message_understanding",
    columns: ["extractionStatus", "extractionQualityNote"],
  },
  {
    id: "0065_add_madison_fact_evidence_metadata",
    table: "madison_conversation_fact_events",
    columns: ["validationStatus", "evidenceExcerpt", "normalizationContext"],
  },
] as const;

describe("Madison fact diagnostics migration contracts", () => {
  for (const migration of cases) {
    it(`${migration.id} is idempotent and checksum-registered`, async () => {
      const sql = await readFile(new URL(`versioned-migrations/${migration.id}.sql`, root), "utf8");
      const postconditions = JSON.parse(await readFile(new URL(`versioned-migrations/${migration.id}.postconditions.json`, root), "utf8"));
      const manifest = JSON.parse(await readFile(new URL("versioned-migrations/manifest.json", root), "utf8"));
      const entry = manifest.migrations.find((item: { id: string }) => item.id === migration.id);

      expect(sql).toContain("ALTER TABLE");
      expect(sql.match(/ADD COLUMN IF NOT EXISTS/g)?.length).toBe(migration.columns.length);
      expect(sql).not.toMatch(/DROP|MODIFY|CHANGE|RENAME|,\s*ADD COLUMN/i);
      expect(postconditions.table).toBe(migration.table);
      expect(postconditions.columns.map((column: { name: string }) => column.name)).toEqual(migration.columns);
      expect(entry?.mode).toBe("additive-columns-existing-table");
      expect(entry?.sha256).toBe(createHash("sha256").update(sql).digest("hex"));
    });
  }
});
