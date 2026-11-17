import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import {
  OpsMetadataCapacityError,
  opsMetadataCapacitySqlSha256,
  runOpsMetadataCapacityMigration,
  type OpsMetadataSchemaRow,
} from "./opsMetadataCapacity.js";

vi.mock("node:crypto", async importOriginal => {
  const original = await importOriginal<typeof import("node:crypto")>();
  return { ...original, createHash: vi.fn(original.createHash) };
});

const SQL = "ALTER TABLE `ops_chat_messages` MODIFY COLUMN `metadata` LONGTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL;\n";
const COLUMNS_SQL = "SHOW FULL COLUMNS FROM `ops_chat_messages`";
const INDEXES_SQL = "SHOW INDEX FROM `ops_chat_messages`";
type Row = Record<string, string | number | null>;

// Full local fixture matching the schema block; no database acquisition or content query.
function fullColumns(): Row[] {
  const definitions: [string, string][] = [
    ["id", "int"], ["cleanerJobId", "int"], ["channel", "varchar(64)"],
    ["authorName", "varchar(128)"], ["authorRole", "varchar(32)"], ["body", "text"],
    ["mediaUrl", "varchar(512)"], ["quickAction", "varchar(64)"], ["metadata", "text"],
    ["replyToId", "int"], ["replyToBody", "varchar(512)"], ["replyToAuthor", "varchar(128)"],
    ["dmThread", "varchar(256)"], ["threadParentId", "int"], ["createdAt", "timestamp"],
    ["sessionId", "bigint"], ["lastActivityAt", "bigint"], ["cardStatus", "varchar(32)"],
    ["activeDedupKey", "varchar(128)"],
  ];
  return definitions.map(([Field, Type]) => ({
    Field, Type,
    Collation: /varchar|text/.test(Type) ? "utf8mb4_unicode_ci" : null,
    Null: ["id", "authorName", "authorRole", "body", "createdAt"].includes(Field) ? "NO" : "YES",
    Key: Field === "id" ? "PRI" : Field === "activeDedupKey" ? "UNI" : ["channel", "createdAt", "cleanerJobId"].includes(Field) ? "MUL" : "",
    Default: Field === "authorRole" ? "office" : Field === "cardStatus" ? "active" : Field === "createdAt" ? "CURRENT_TIMESTAMP" : null,
    Extra: Field === "id" ? "auto_increment" : "",
    Privileges: "select,insert,update,references",
    Comment: "",
  }));
}

function fullIndexes(): Row[] {
  const definitions: [string, number, string[]][] = [
    ["PRIMARY", 0, ["id"]],
    ["idx_ocm_job", 1, ["cleanerJobId"]],
    ["idx_ocm_channel", 1, ["channel"]],
    ["idx_ocm_created_at", 1, ["createdAt"]],
    ["idx_ocm_channel_created_at", 1, ["channel", "createdAt"]],
    ["uq_ops_active_sms_card", 0, ["activeDedupKey"]],
  ];
  return definitions.flatMap(([Key_name, Non_unique, names]) => names.map((Column_name, i) => ({
    Table: "ops_chat_messages", Non_unique, Key_name, Seq_in_index: i + 1, Column_name,
    Collation: "A", Cardinality: 3, Sub_part: null, Packed: null,
    Null: Column_name === "id" || Column_name === "createdAt" ? "" : "YES",
    Index_type: "BTREE", Comment: "", Index_comment: "", Visible: "YES", Expression: null,
  })));
}

function fakeDatabase(options: {
  alreadyLongtext?: boolean;
  directRows?: boolean;
  before?: (columns: Row[], indexes: Row[]) => void;
  after?: (columns: Row[], indexes: Row[]) => void;
  failCall?: number;
  noTypeChange?: boolean;
  malformedCall?: number;
} = {}) {
  const columns = fullColumns();
  const indexes = fullIndexes();
  if (options.alreadyLongtext) columns.find(row => row.Field === "metadata")!.Type = "longtext";
  options.before?.(columns, indexes);
  const records = [
    { id: 1, body: "Existing message", metadata: '{"note":"Unicode 🧹 and preserved card"}', activeDedupKey: "madison_sms_draft:1" },
    { id: 2, body: "Unrelated message", metadata: null, activeDedupKey: null },
    { id: 3, body: "Large existing fixture", metadata: JSON.stringify({ email: "x".repeat(65000), html: "é" }), activeDedupKey: null },
  ];
  const calls: string[] = [];
  let columnReads = 0;
  const db = {
    async query(sql: string): Promise<unknown> {
      calls.push(sql);
      if (calls.length === options.failCall) throw new Error("mock uncertain database failure");
      if (calls.length === options.malformedCall) return { uncertain: true };
      if (sql === COLUMNS_SQL) {
        columnReads++;
        if (columnReads === 2) options.after?.(columns, indexes);
        return options.directRows ? columns : [columns, []];
      }
      if (sql === INDEXES_SQL) return options.directRows ? indexes : [indexes, []];
      if (sql === SQL) {
        if (!options.noTypeChange) columns.find(row => row.Field === "metadata")!.Type = "longtext";
        return [{ affectedRows: 0 }, []];
      }
      throw new Error(`Forbidden unexpected query: ${sql}`);
    },
  };
  return { db, calls, columns, indexes, records };
}

const withoutMetadataType = (columns: readonly OpsMetadataSchemaRow[]) => columns.map(row => {
  if (row.Field !== "metadata") return row;
  const { Type: _type, ...rest } = row;
  return rest;
});

async function expectPreflightFailure(fake: ReturnType<typeof fakeDatabase>) {
  await expect(runOpsMetadataCapacityMigration({ db: fake.db, sql: SQL })).rejects.toMatchObject({
    name: "OpsMetadataCapacityError", phase: "preflight", alterAttempted: false,
  });
  expect(fake.calls).not.toContain(SQL);
}

async function expectPostflightFailure(fake: ReturnType<typeof fakeDatabase>) {
  await expect(runOpsMetadataCapacityMigration({ db: fake.db, sql: SQL })).rejects.toMatchObject({
    name: "OpsMetadataCapacityError", phase: "postflight", alterAttempted: true,
  });
  expect(fake.calls.filter(call => call === SQL)).toHaveLength(1);
}

describe("deliberate ops metadata capacity migration (offline mocks only)", () => {
  it("pins the actual single-statement SQL bytes and checksum", async () => {
    const actual = await readFile(new URL("./opsMetadataCapacity.sql", import.meta.url), "utf8");
    expect(actual).toBe(SQL);
    expect(actual.match(/;/g)).toHaveLength(1);
    expect(createHash("sha256").update(actual).digest("hex")).toBe(opsMetadataCapacitySqlSha256);
    const fake = fakeDatabase();
    expect((await runOpsMetadataCapacityMigration({ db: fake.db, sql: actual })).outcome).toBe("applied");
    expect(fake.calls.filter(call => call === SQL)).toEqual([actual]);
  });

  it.each([false, true])("issues one exact ALTER and preserves all definitions, indexes and fixture records (direct rows %s)", async directRows => {
    const fake = fakeDatabase({ directRows });
    const existingColumns = structuredClone(fake.columns);
    const existingIndexes = structuredClone(fake.indexes).sort((a, b) => String(a.Key_name).localeCompare(String(b.Key_name)) || Number(a.Seq_in_index) - Number(b.Seq_in_index));
    const existingRecords = structuredClone(fake.records);
    const result = await runOpsMetadataCapacityMigration({ db: fake.db, sql: SQL });
    expect(result.outcome).toBe("applied");
    expect(result.sqlSha256).toBe(opsMetadataCapacitySqlSha256);
    expect(fake.calls).toEqual([COLUMNS_SQL, INDEXES_SQL, SQL, COLUMNS_SQL, INDEXES_SQL]);
    expect(result.before.columns).toEqual(existingColumns);
    expect(result.before.indexes).toEqual(existingIndexes);
    expect(withoutMetadataType(result.after.columns)).toEqual(withoutMetadataType(existingColumns));
    expect(result.after.indexes).toEqual(existingIndexes);
    expect(result.after.columns.find(row => row.Field === "metadata")).toEqual({
      ...existingColumns.find(row => row.Field === "metadata"), Type: "longtext",
    });
    expect(fake.records).toEqual(existingRecords);
    expect(Object.isFrozen(result.before.columns[0])).toBe(true);
  });

  it("skips already-correct LONGTEXT and re-verifies all attributes without ALTER", async () => {
    const fake = fakeDatabase({ alreadyLongtext: true });
    const result = await runOpsMetadataCapacityMigration({ db: fake.db, sql: SQL });
    expect(result.outcome).toBe("skipped");
    expect(result.before).toEqual(result.after);
    expect(fake.calls).toEqual([COLUMNS_SQL, INDEXES_SQL, COLUMNS_SQL, INDEXES_SQL]);
  });

  it("a subsequent deliberate invocation is idempotent, without a second ALTER", async () => {
    const fake = fakeDatabase();
    expect((await runOpsMetadataCapacityMigration({ db: fake.db, sql: SQL })).outcome).toBe("applied");
    expect((await runOpsMetadataCapacityMigration({ db: fake.db, sql: SQL })).outcome).toBe("skipped");
    expect(fake.calls.filter(call => call === SQL)).toHaveLength(1);
  });

  it.each([
    SQL.trim(), SQL + "\n", SQL + "SELECT 1;\n", SQL.replace("LONGTEXT", "MEDIUMTEXT"),
    SQL.replace(" NULL;", " NOT NULL;"), SQL.replace(" NULL;", " NULL DEFAULT NULL;"),
    SQL.replace("utf8mb4_unicode_ci", "utf8mb4_bin"), SQL.replace("metadata", "body"),
    SQL.replace("ops_chat_messages", "another_table"), SQL + "-- comment\n",
    "/* comment */" + SQL, SQL.replace("LONGTEXT", "longtext"),
  ])("rejects invalid SQL bytes before any query: %s", async sql => {
    const fake = fakeDatabase();
    await expect(runOpsMetadataCapacityMigration({ db: fake.db, sql })).rejects.toMatchObject({ phase: "validation", alterAttempted: false });
    expect(fake.calls).toEqual([]);
  });

  it("fails checksum validation independently before any query", async () => {
    const fake = fakeDatabase();
    vi.mocked(createHash).mockReturnValueOnce({
      update: () => ({ digest: () => "0".repeat(64) }),
    } as unknown as ReturnType<typeof createHash>);
    await expect(runOpsMetadataCapacityMigration({ db: fake.db, sql: SQL })).rejects.toThrow("checksum mismatch");
    expect(fake.calls).toEqual([]);
  });

  it("requires an explicit database adapter, never default acquisition", async () => {
    await expect(runOpsMetadataCapacityMigration({ sql: SQL } as never)).rejects.toMatchObject({ phase: "validation", alterAttempted: false });
  });

  it("rejects missing table, never creates it", async () => {
    await expectPreflightFailure(fakeDatabase({ before: columns => columns.splice(0) }));
    await expectPreflightFailure(fakeDatabase({ failCall: 1 }));
  });

  it("rejects an absent metadata column", async () => {
    await expectPreflightFailure(fakeDatabase({ before: columns => columns.splice(columns.findIndex(row => row.Field === "metadata"), 1) }));
  });

  it.each([
    ["Type", "mediumtext"], ["Type", "TEXT"], ["Collation", "utf8mb4_bin"], ["Collation", null],
    ["Null", "NO"], ["Default", "NULL"], ["Default", ""], ["Default", 0],
    ["Extra", "GENERATED"], ["Comment", "unapproved"], ["Key", "MUL"],
  ] as const)("rejects divergent metadata %s=%s before ALTER and after ALTER", async (key, value) => {
    const change = (columns: Row[]) => { columns.find(row => row.Field === "metadata")![key] = value; };
    await expectPreflightFailure(fakeDatabase({ before: change }));
    await expectPostflightFailure(fakeDatabase({ after: change }));
    await expectPreflightFailure(fakeDatabase({ alreadyLongtext: true, before: change }));
  });

  it.each(["Collation", "Null", "Default", "Extra", "Comment", "Privileges", "Type", "Key"])("rejects missing metadata attribute %s instead of assuming its value", async key => {
    await expectPreflightFailure(fakeDatabase({ before: columns => { delete columns.find(row => row.Field === "metadata")![key]; } }));
  });

  it.each([
    ["Non_unique", 1], ["Sub_part", 64], ["Seq_in_index", 2],
    ["Column_name", "channel"], ["Index_type", "HASH"], ["Visible", "NO"],
    ["Expression", "lower(activeDedupKey)"], ["Key_name", "different_name"],
  ] as const)("rejects non-full or divergent dedup index %s=%s", async (key, value) => {
    const change = (_columns: Row[], indexes: Row[]) => { indexes.find(row => row.Key_name === "uq_ops_active_sms_card")![key] = value; };
    await expectPreflightFailure(fakeDatabase({ before: change }));
    await expectPostflightFailure(fakeDatabase({ after: change }));
  });

  it("rejects missing or composite activeDedupKey unique index", async () => {
    await expectPreflightFailure(fakeDatabase({ before: (_columns, indexes) => indexes.splice(indexes.findIndex(row => row.Key_name === "uq_ops_active_sms_card"), 1) }));
    await expectPreflightFailure(fakeDatabase({ before: (_columns, indexes) => {
      const dedup = indexes.find(row => row.Key_name === "uq_ops_active_sms_card")!;
      indexes.push({ ...dedup, Seq_in_index: 2, Column_name: "channel" });
    } }));
  });

  it.each([
    ["Type", "mediumtext"], ["Collation", "utf8mb4_bin"], ["Null", "YES"],
    ["Key", "MUL"], ["Default", "unexpected"], ["Extra", "unexpected"],
    ["Privileges", "select"], ["Comment", "changed"], ["Unknown_future_attribute", "new"],
  ] as const)("rejects any other full column attribute change: %s", async (key, value) => {
    await expectPostflightFailure(fakeDatabase({ after: columns => { columns.find(row => row.Field === "body")![key] = value; } }));
  });

  it.each(["Privileges", "Unknown_future_attribute"])("preserves metadata attributes beyond Type, including %s", async key => {
    await expectPostflightFailure(fakeDatabase({ after: columns => { columns.find(row => row.Field === "metadata")![key] = "changed"; } }));
  });

  it.each([
    ["Table", "other_table"], ["Non_unique", 0], ["Key_name", "renamed"], ["Seq_in_index", 3],
    ["Column_name", "body"], ["Collation", "D"], ["Cardinality", 4], ["Sub_part", 32],
    ["Packed", "packed"], ["Null", ""], ["Index_type", "HASH"], ["Comment", "changed"],
    ["Index_comment", "changed"], ["Visible", "NO"], ["Expression", "body"], ["Future_attribute", "changed"],
  ] as const)("compares every full index attribute, including %s", async (key, value) => {
    await expectPostflightFailure(fakeDatabase({ after: (_columns, indexes) => { indexes.find(row => row.Key_name === "idx_ocm_channel")![key] = value; } }));
  });

  it.each(["remove-column", "add-column", "reorder-columns", "remove-index", "add-index"])("rejects schema topology drift: %s", async drift => {
    await expectPostflightFailure(fakeDatabase({ after: (columns, indexes) => {
      if (drift === "remove-column") columns.splice(columns.findIndex(row => row.Field === "mediaUrl"), 1);
      if (drift === "add-column") columns.push({ ...columns[0], Field: "unexpected" });
      if (drift === "reorder-columns") columns.reverse();
      if (drift === "remove-index") indexes.splice(indexes.findIndex(row => row.Key_name === "idx_ocm_job"), 1);
      if (drift === "add-index") indexes.push({ ...indexes[0], Key_name: "unexpected_index" });
    } }));
  });

  it("rejects a no-op ALTER that leaves metadata as TEXT without retrying", async () => {
    await expectPostflightFailure(fakeDatabase({ noTypeChange: true }));
  });

  it.each([1, 2, 3, 4, 5])("never retries a failed read or ALTER at call %s", async failCall => {
    const fake = fakeDatabase({ failCall });
    await expect(runOpsMetadataCapacityMigration({ db: fake.db, sql: SQL })).rejects.toMatchObject({
      name: "OpsMetadataCapacityError", alterAttempted: failCall >= 3,
    });
    expect(fake.calls).toHaveLength(failCall);
    expect(fake.calls.filter(call => call === SQL)).toHaveLength(failCall >= 3 ? 1 : 0);
  });

  it.each([1, 2, 4, 5])("rejects uncertain schema response at call %s without another ALTER", async malformedCall => {
    const fake = fakeDatabase({ malformedCall });
    await expect(runOpsMetadataCapacityMigration({ db: fake.db, sql: SQL })).rejects.toBeInstanceOf(OpsMetadataCapacityError);
    expect(fake.calls).toHaveLength(malformedCall);
    expect(fake.calls.filter(call => call === SQL)).toHaveLength(malformedCall > 3 ? 1 : 0);
  });

  it("does not import app/LLM/provider/DB behavior and is not wired into startup or managed migrations", async () => {
    const source = await readFile(new URL("./opsMetadataCapacity.ts", import.meta.url), "utf8");
    expect([...source.matchAll(/^import .* from "([^"]+)";/gm)].map(match => match[1])).toEqual(["node:crypto", "node:util"]);
    const executable = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
    expect(executable).not.toMatch(/getDb|mysql2|process\.env|fetch\(|setTimeout|setInterval|invokeLLM|openai|anthropic|gmail|INSERT INTO|UPDATE `|DELETE FROM|CREATE TABLE/i);
    for (const relative of ["./managedRunner.ts", "./contracts.ts", "./postconditions.ts", "../_core/index.ts", "../runVersionedMigrations.ts", "../versioned-migrations/manifest.json"]) {
      expect(await readFile(new URL(relative, import.meta.url), "utf8")).not.toContain("opsMetadataCapacity");
    }
    const schema = await readFile(new URL("../../drizzle/schema.ts", import.meta.url), "utf8");
    const block = schema.slice(schema.indexOf('export const opsChatMessages = mysqlTable("ops_chat_messages"'), schema.indexOf("export type OpsChatMessage"));
    expect(block).toContain('metadata: longtext("metadata"),');
    expect(block).toContain('uniqueIndex("uq_ops_active_sms_card").on(table.activeDedupKey)');
  });
});
