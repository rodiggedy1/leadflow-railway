import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const root = new URL("../", import.meta.url);
const migrationId = "0063_create_madison_conversation_fact_events";

describe("Madison fact ledger migration contract", () => {
  it("uses an idempotent create-table migration with matching manifest checksum", async () => {
    const sql = await readFile(new URL(`versioned-migrations/${migrationId}.sql`, root), "utf8");
    const postconditions = JSON.parse(await readFile(new URL(`versioned-migrations/${migrationId}.postconditions.json`, root), "utf8"));
    const manifest = JSON.parse(await readFile(new URL("versioned-migrations/manifest.json", root), "utf8"));
    const entry = manifest.migrations.find((migration: { id: string }) => migration.id === migrationId);

    expect(sql).toContain("CREATE TABLE IF NOT EXISTS `madison_conversation_fact_events`");
    expect(sql).not.toMatch(/ALTER TABLE|DROP TABLE|MODIFY|CHANGE|RENAME/i);
    expect(postconditions.table).toBe("madison_conversation_fact_events");
    expect(postconditions.columns.map((column: { name: string }) => column.name)).toEqual([
      "id", "eventId", "sessionId", "draftId", "factKey", "value", "sourceType", "sourceMessageId",
      "sourceRecordId", "status", "confidence", "observedAt", "validUntil", "supersedesFactId", "createdAt",
    ]);
    expect(entry?.mode).toBe("create-table");
    expect(entry?.sha256).toBe(createHash("sha256").update(sql).digest("hex"));
  });
});
