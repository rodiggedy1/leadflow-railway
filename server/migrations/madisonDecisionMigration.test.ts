import { createHash } from "crypto";
import { readFile } from "fs/promises";
import path from "path";
import { describe, expect, it } from "vitest";

describe("Madison decision evaluation migration contract", () => {
  it("uses one idempotent ADD COLUMN statement matching its manifest and postconditions", async () => {
    const directory = path.resolve(process.cwd(), "server", "versioned-migrations");
    const [manifestText, sql, postconditionsText] = await Promise.all([
      readFile(path.join(directory, "manifest.json"), "utf8"),
      readFile(path.join(directory, "0062_add_madison_decision_evaluation.sql"), "utf8"),
      readFile(path.join(directory, "0062_add_madison_decision_evaluation.postconditions.json"), "utf8"),
    ]);
    const manifest = JSON.parse(manifestText) as {
      migrations: Array<{ id: string; mode: string; sha256: string }>;
    };
    const postconditions = JSON.parse(postconditionsText) as {
      table: string;
      columns: Array<{ name: string }>;
    };
    const entry = manifest.migrations.find(({ id }) => id === "0062_add_madison_decision_evaluation");
    expect(entry).toMatchObject({
      mode: "additive-columns-existing-table",
      sha256: createHash("sha256").update(sql).digest("hex"),
    });

    const statements = sql.split(";").map(statement => statement.trim()).filter(Boolean);
    expect(statements).toHaveLength(postconditions.columns.length);
    for (const [index, column] of postconditions.columns.entries()) {
      expect(statements[index]).toMatch(
        new RegExp(
          "^ALTER\\s+TABLE\\s+`" +
            postconditions.table +
            "`\\s+ADD\\s+COLUMN\\s+IF\\s+NOT\\s+EXISTS\\s+`" +
            column.name +
            "`\\s+",
          "i",
        ),
      );
    }
  });
});
