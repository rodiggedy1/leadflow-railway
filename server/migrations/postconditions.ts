import type {
  DatabaseColumn,
  DatabaseIndex,
  ExpectedColumn,
  ExpectedIndex,
  PostconditionResult,
  TablePostconditions,
} from "./contracts.js";

/**
 * TiDB and MySQL can represent equivalent metadata differently (for example,
 * INT versus INT(11), case, whitespace, and quoted CURRENT_TIMESTAMP values).
 * This intentionally normalizes display differences only; it never loosens a
 * semantic difference such as type family, length, nullability, or uniqueness.
 */
export function normalizeColumnType(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\b(integer)\b/g, "int")
    .replace(/\b(int|tinyint|smallint|mediumint|bigint)\(\d+\)/g, "$1")
    .replace(/\s+/g, " ");
}

export function normalizeDefault(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return value
    .trim()
    .replace(/^'(.*)'$/, "$1")
    .replace(/^\((.*)\)$/, "$1")
    .toLowerCase()
    .replace(/current_timestamp\(\)/g, "current_timestamp")
    .replace(/\s+/g, " ");
}

export function columnDifference(expected: ExpectedColumn, actual: DatabaseColumn | undefined): string[] {
  if (!actual) return [`missing column ${expected.name}`];
  const differences: string[] = [];
  if (normalizeColumnType(actual.columnType) !== normalizeColumnType(expected.columnType)) {
    differences.push(
      `column ${expected.name} type expected ${expected.columnType}, received ${actual.columnType}`,
    );
  }
  if (actual.nullable !== expected.nullable) {
    differences.push(`column ${expected.name} nullability differs`);
  }
  if (Boolean(expected.autoIncrement) !== actual.autoIncrement) {
    differences.push(`column ${expected.name} auto-increment differs`);
  }
  if (expected.default !== undefined && normalizeDefault(actual.default) !== normalizeDefault(expected.default)) {
    differences.push(`column ${expected.name} default expected ${expected.default}, received ${actual.default}`);
  }
  return differences;
}

export function indexDifference(expected: ExpectedIndex, actual: DatabaseIndex | undefined): string[] {
  if (!actual) return [`missing index ${expected.name}`];
  const differences: string[] = [];
  if (actual.unique !== expected.unique) differences.push(`index ${expected.name} uniqueness differs`);
  if (actual.columns.join("\u0000") !== expected.columns.join("\u0000")) {
    differences.push(
      `index ${expected.name} columns expected (${expected.columns.join(", ")}), received (${actual.columns.join(", ")})`,
    );
  }
  return differences;
}

export function evaluatePostconditions(
  expected: TablePostconditions,
  tableExists: boolean,
  columns: DatabaseColumn[],
  indexes: DatabaseIndex[],
): PostconditionResult {
  if (!tableExists) {
    return { tableExists: false, valid: false, differences: [`missing table ${expected.table}`] };
  }

  const columnsByName = new Map(columns.map(column => [column.name, column]));
  const indexesByName = new Map(indexes.map(index => [index.name, index]));
  const differences = [
    ...expected.columns.flatMap(column => columnDifference(column, columnsByName.get(column.name))),
    ...expected.indexes.flatMap(index => indexDifference(index, indexesByName.get(index.name))),
  ];
  return { tableExists: true, valid: differences.length === 0, differences };
}
