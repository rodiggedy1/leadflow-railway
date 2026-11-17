import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

/** Deliberate one-off invocation only. Never import this module from the app or managed runner. */
export const opsMetadataCapacitySqlSha256 = "3af7f7ee4c5f0508395593b40d94a795b684c08e7cad42141e4509da68cc2deb";
const APPROVED_STATEMENT = "ALTER TABLE `ops_chat_messages` MODIFY COLUMN `metadata` LONGTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL;";
const COLUMNS_SQL = "SHOW FULL COLUMNS FROM `ops_chat_messages`";
const INDEXES_SQL = "SHOW INDEX FROM `ops_chat_messages`";

type Attribute = string | number | null;
export type OpsMetadataSchemaRow = Readonly<Record<string, Attribute>>;
export interface OpsMetadataSchemaSnapshot {
  readonly columns: readonly OpsMetadataSchemaRow[];
  readonly indexes: readonly OpsMetadataSchemaRow[];
}
export interface OpsMetadataCapacityDependencies {
  /** Must be supplied deliberately; accepts mysql2 [rows, fields] or a rows-only adapter. */
  db: { query(sql: string): Promise<unknown> };
  /** Actual UTF-8 bytes read from opsMetadataCapacity.sql, including its final newline. */
  sql: string;
}
export interface OpsMetadataCapacityResult {
  outcome: "applied" | "skipped";
  sqlSha256: string;
  before: OpsMetadataSchemaSnapshot;
  after: OpsMetadataSchemaSnapshot;
}

type Phase = "validation" | "preflight" | "alter" | "postflight";
export class OpsMetadataCapacityError extends Error {
  constructor(
    message: string,
    readonly phase: Phase,
    readonly alterAttempted: boolean,
  ) {
    super(message);
    this.name = "OpsMetadataCapacityError";
  }
}

function rows(result: unknown, description: string): OpsMetadataSchemaRow[] {
  const raw = Array.isArray(result) && Array.isArray(result[0]) ? result[0] : result;
  if (!Array.isArray(raw)) throw new Error(`Uncertain ${description} response: expected rows`);
  return raw.map(row => {
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      throw new Error(`Uncertain ${description} row`);
    }
    const copy: Record<string, Attribute> = {};
    for (const [key, value] of Object.entries(row)) {
      if (value !== null && typeof value !== "string" && !(typeof value === "number" && Number.isFinite(value))) {
        throw new Error(`Uncertain ${description} attribute ${key}`);
      }
      copy[key] = value as Attribute;
    }
    return Object.freeze(copy);
  });
}

function requireAttributes(row: OpsMetadataSchemaRow, keys: readonly string[], description: string): void {
  for (const key of keys) {
    if (!Object.hasOwn(row, key)) throw new Error(`Missing ${description} attribute ${key}`);
  }
}

function inspectSnapshot(columns: OpsMetadataSchemaRow[], indexes: OpsMetadataSchemaRow[]): void {
  if (!columns.length) throw new Error("Missing table ops_chat_messages or metadata column");
  const names = new Set<string>();
  for (const column of columns) {
    requireAttributes(column, ["Field", "Type", "Collation", "Null", "Key", "Default", "Extra", "Privileges", "Comment"], "column");
    for (const key of ["Field", "Type", "Null", "Key", "Extra", "Privileges", "Comment"]) {
      if (typeof column[key] !== "string") throw new Error(`Uncertain column attribute ${key}`);
    }
    if (!column.Field || names.has(column.Field as string) || !column.Type || !["YES", "NO"].includes(column.Null as string)) {
      throw new Error("Uncertain or duplicate full column definition");
    }
    if (column.Collation !== null && typeof column.Collation !== "string") throw new Error("Uncertain column collation");
    names.add(column.Field as string);
  }
  const metadata = columns.find(column => column.Field === "metadata");
  if (!metadata) throw new Error("Missing metadata column");
  const expected: Record<string, Attribute> = {
    Collation: "utf8mb4_unicode_ci", Null: "YES", Key: "", Default: null, Extra: "", Comment: "",
  };
  if (metadata.Type !== "text" && metadata.Type !== "longtext") throw new Error("Unexpected metadata Type");
  for (const [key, value] of Object.entries(expected)) {
    if (metadata[key] !== value) throw new Error(`Unexpected metadata ${key}`);
  }
  if (!names.has("activeDedupKey")) throw new Error("Missing activeDedupKey column");

  const groups = new Map<string, OpsMetadataSchemaRow[]>();
  for (const index of indexes) {
    requireAttributes(index, ["Table", "Non_unique", "Key_name", "Seq_in_index", "Column_name", "Collation", "Cardinality", "Sub_part", "Packed", "Null", "Index_type", "Comment", "Index_comment"], "index");
    if (index.Table !== "ops_chat_messages" || typeof index.Key_name !== "string" || !index.Key_name
      || ![0, 1, "0", "1"].includes(index.Non_unique as string | number)
      || !Number.isSafeInteger(Number(index.Seq_in_index)) || Number(index.Seq_in_index) < 1
      || (index.Column_name !== null && (typeof index.Column_name !== "string" || !names.has(index.Column_name)))) {
      throw new Error("Uncertain full index definition");
    }
    const group = groups.get(index.Key_name) ?? [];
    group.push(index);
    groups.set(index.Key_name, group);
  }
  for (const group of Array.from(groups.values())) {
    group.sort((a, b) => Number(a.Seq_in_index) - Number(b.Seq_in_index));
    if (group.some((index, position) => Number(index.Seq_in_index) !== position + 1 || index.Non_unique !== group[0].Non_unique)) {
      throw new Error("Uncertain or duplicate index sequence");
    }
  }
  const dedup = groups.get("uq_ops_active_sms_card");
  if (!dedup || dedup.length !== 1 || Number(dedup[0].Non_unique) !== 0
    || dedup[0].Column_name !== "activeDedupKey" || dedup[0].Sub_part !== null
    || dedup[0].Index_type !== "BTREE"
    || (Object.hasOwn(dedup[0], "Expression") && dedup[0].Expression !== null)
    || (Object.hasOwn(dedup[0], "Visible") && dedup[0].Visible !== "YES")) {
    throw new Error("Missing or divergent unique full activeDedupKey index uq_ops_active_sms_card");
  }
}

async function snapshot(db: OpsMetadataCapacityDependencies["db"]): Promise<OpsMetadataSchemaSnapshot> {
  // Only schema metadata is read. All returned attributes (including unknown ones)
  // are retained and compared, including index cardinality; no drift is ignored.
  const columns = rows(await db.query(COLUMNS_SQL), "full columns");
  const indexes = rows(await db.query(INDEXES_SQL), "indexes");
  inspectSnapshot(columns, indexes);
  indexes.sort((a, b) => String(a.Key_name).localeCompare(String(b.Key_name)) || Number(a.Seq_in_index) - Number(b.Seq_in_index));
  return Object.freeze({ columns: Object.freeze(columns), indexes: Object.freeze(indexes) });
}

function assertPreserved(before: OpsMetadataSchemaSnapshot, after: OpsMetadataSchemaSnapshot): void {
  const withoutMetadataType = (columns: readonly OpsMetadataSchemaRow[]) => columns.map(column => {
    if (column.Field !== "metadata") return column;
    const { Type: _type, ...attributes } = column;
    return attributes;
  });
  if (!isDeepStrictEqual(withoutMetadataType(before.columns), withoutMetadataType(after.columns))) {
    throw new Error("Full column definitions changed beyond metadata Type");
  }
  if (!isDeepStrictEqual(before.indexes, after.indexes)) throw new Error("Full index attributes changed");
  if (after.columns.find(column => column.Field === "metadata")?.Type !== "longtext") {
    throw new Error("Postcondition failed: metadata Type is not longtext");
  }
}

/**
 * No default DB, file loading, ledger, startup hook, data query, DML, lock, or retry.
 * Caller must deliberately supply a dedicated query adapter and the pinned SQL.
 * An ALTER error or failed postflight may mean DDL already applied: stop and
 * investigate explicitly. This function never automatically retries or rolls back.
 * SQL NULL with no DEFAULT clause retains the verified nullable default of SQL NULL.
 */
export async function runOpsMetadataCapacityMigration(
  dependencies: OpsMetadataCapacityDependencies,
): Promise<OpsMetadataCapacityResult> {
  if (!dependencies || typeof dependencies.sql !== "string"
    || dependencies.sql !== `${APPROVED_STATEMENT}\n`) {
    throw new OpsMetadataCapacityError("Invalid SQL: only the exact approved single statement and final newline are permitted", "validation", false);
  }
  const sha256 = createHash("sha256").update(dependencies.sql, "utf8").digest("hex");
  if (sha256 !== opsMetadataCapacitySqlSha256) {
    throw new OpsMetadataCapacityError("SQL checksum mismatch", "validation", false);
  }
  if (!dependencies.db || typeof dependencies.db.query !== "function") {
    throw new OpsMetadataCapacityError("An explicit injected database query is required", "validation", false);
  }

  let phase: Phase = "preflight";
  let alterAttempted = false;
  try {
    const before = await snapshot(dependencies.db);
    const alreadyCorrect = before.columns.find(column => column.Field === "metadata")?.Type === "longtext";
    if (!alreadyCorrect) {
      phase = "alter";
      alterAttempted = true;
      await dependencies.db.query(dependencies.sql);
    }
    phase = "postflight";
    const after = await snapshot(dependencies.db);
    assertPreserved(before, after);
    return { outcome: alreadyCorrect ? "skipped" : "applied", sqlSha256: sha256, before, after };
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Uncertain database response";
    throw new OpsMetadataCapacityError(
      `${detail}. Stopped; do not retry automatically${alterAttempted ? "; ALTER was attempted and its outcome must be investigated" : ""}.`,
      phase,
      alterAttempted,
    );
  }
}
