import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("customer portal request payment snapshot migration", () => {
  it("registers an idempotent additive migration with only safe payment snapshot columns", async () => {
    const directory = path.resolve(process.cwd(), "server", "versioned-migrations");
    const manifest = JSON.parse(await readFile(path.join(directory, "manifest.json"), "utf8")) as { migrations: Array<{ id: string; mode: string; sqlFile: string; sha256: string; replayMode: string; postconditionsFile: string }> };
    const migration = manifest.migrations.find(item => item.id === "0020_add_customer_portal_request_payment_snapshot");
    expect(migration).toMatchObject({ mode: "additive-columns-existing-table", sqlFile: "0020_add_customer_portal_request_payment_snapshot.sql", replayMode: "verified-idempotent" });
    const sql = await readFile(path.join(directory, migration!.sqlFile), "utf8");
    expect(createHash("sha256").update(sql).digest("hex")).toBe(migration!.sha256);
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS `paymentBrand`");
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS `paymentLast4`");
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS `stripePaymentMethodId`");
    expect(sql).not.toMatch(/\b(?:DROP|TRUNCATE|DELETE|UPDATE|INSERT)\b/i);
  });
});
