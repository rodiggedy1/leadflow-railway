import { sql, type SQL } from "drizzle-orm";
import { reviewEntrySchema, type ReviewEntry, type ReviewStore } from "../../shared/reviewResponses";
import type { getDb } from "../db";

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
type Executor = Pick<Db, "execute">;
const MAX_REVISION = 0xffffffff;
const MAX_LIST = 200;
const KEY = /^[a-f0-9]{64}$/;

/** Never retain the driver error/cause, SQL, payload, or credentials. */
export class StoreUnavailable extends Error {
  constructor() {
    super("Review response store unavailable");
    this.name = "StoreUnavailable";
  }
}

class InvalidStoreInput extends Error {
  constructor() {
    super("Invalid review response store input");
  }
}

function invalidInput(): never {
  throw new InvalidStoreInput();
}

function validKey(key: unknown): key is string {
  return typeof key === "string" && KEY.test(key);
}

function validRevision(revision: unknown): revision is number {
  return typeof revision === "number" && Number.isSafeInteger(revision) && revision > 0 && revision <= MAX_REVISION;
}

function validatedEntry(value: unknown): ReviewEntry {
  const parsed = reviewEntrySchema.safeParse(value);
  if (!parsed.success || !validRevision(parsed.data.revision)) invalidInput();
  return parsed.data;
}

function integer(value: unknown): number {
  // BIGINT may be returned as a decimal string or bigint; reject lossy coercion.
  if (typeof value === "string" && !/^(0|[1-9][0-9]*)$/.test(value)) throw new StoreUnavailable();
  if (!["number", "string", "bigint"].includes(typeof value)) throw new StoreUnavailable();
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw new StoreUnavailable();
  return number;
}

function resultRows(result: unknown): unknown[] {
  // Drizzle mysql2 execute returns [rows, fields], never a bare row array.
  if (!Array.isArray(result) || !Array.isArray(result[0])) throw new StoreUnavailable();
  return result[0];
}

function decodeRow(value: unknown): ReviewEntry {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new StoreUnavailable();
  const row = value as Record<string, unknown>;
  let payload: unknown;
  try {
    payload = typeof row.entry === "string" ? JSON.parse(row.entry) : row.entry;
  } catch {
    throw new StoreUnavailable();
  }
  const parsed = reviewEntrySchema.safeParse(payload);
  if (!parsed.success || !validKey(row.key) || !validRevision(parsed.data.revision)
    || parsed.data.key !== row.key || parsed.data.revision !== integer(row.revision)
    || parsed.data.updatedAt !== integer(row.updatedAtMs)) throw new StoreUnavailable();
  return parsed.data;
}

function sameIdentity(a: ReviewEntry, b: ReviewEntry): boolean {
  return a.review.platform === b.review.platform && a.review.accountId === b.review.accountId
    && a.review.businessId === b.review.businessId && a.review.reviewId === b.review.reviewId;
}

function preservesAudit(current: ReviewEntry, next: ReviewEntry): boolean {
  return next.events.length >= current.events.length && current.events.every((event, index) =>
    JSON.stringify(event) === JSON.stringify(next.events[index]));
}

function writeHeader(result: unknown): { affectedRows: number; warningStatus: number } {
  if (!Array.isArray(result) || !result[0] || typeof result[0] !== "object" || Array.isArray(result[0])) {
    throw new StoreUnavailable();
  }
  const header = result[0] as Record<string, unknown>;
  if ((header.affectedRows !== 0 && header.affectedRows !== 1)
    || typeof header.warningStatus !== "number" || !Number.isSafeInteger(header.warningStatus)
    || header.warningStatus < 0) throw new StoreUnavailable();
  return { affectedRows: header.affectedRows, warningStatus: header.warningStatus };
}

async function execute(executor: Executor, query: SQL): Promise<unknown> {
  try {
    return await executor.execute(query);
  } catch {
    throw new StoreUnavailable();
  }
}

async function read(executor: Executor, key: string): Promise<ReviewEntry | null> {
  const rows = resultRows(await execute(executor, sql`SELECT \`key\`, \`revision\`, \`entry\`, \`updatedAtMs\`
    FROM \`public_review_responses\` WHERE \`key\` = ${key} LIMIT 1`));
  if (rows.length > 1) throw new StoreUnavailable();
  if (!rows.length) return null;
  const entry = decodeRow(rows[0]);
  if (entry.key !== key) throw new StoreUnavailable();
  return entry;
}

/** Constructing/importing this adapter performs no I/O. It never creates tables. */
export function createSqlReviewStore(db: NonNullable<Awaited<ReturnType<typeof getDb>>>): ReviewStore {
  async function transaction<T>(work: (executor: Executor) => Promise<T>): Promise<T> {
    try {
      return await db.transaction(work);
    } catch (error) {
      if (error instanceof InvalidStoreInput) throw error;
      throw new StoreUnavailable();
    }
  }

  return {
    async get(key) {
      if (!validKey(key)) invalidInput();
      return read(db, key);
    },
    async list(limit = MAX_LIST) {
      if (!Number.isSafeInteger(limit) || limit < 1) invalidInput();
      const bounded = Math.min(limit, MAX_LIST);
      const rows = resultRows(await execute(db, sql`SELECT \`key\`, \`revision\`, \`entry\`, \`updatedAtMs\`
        FROM \`public_review_responses\` ORDER BY \`updatedAtMs\` DESC, \`key\` ASC LIMIT ${bounded}`));
      if (rows.length > bounded) throw new StoreUnavailable();
      const entries = rows.map(decodeRow);
      if (new Set(entries.map(entry => entry.key)).size !== entries.length) throw new StoreUnavailable();
      return entries;
    },
    async insertIfAbsent(value) {
      const entry = validatedEntry(value);
      const encoded = JSON.stringify(entry);
      return transaction(async tx => {
        const header = writeHeader(await execute(tx, sql`INSERT IGNORE INTO \`public_review_responses\`
          (\`key\`, \`revision\`, \`entry\`, \`updatedAtMs\`)
          VALUES (${entry.key}, ${entry.revision}, ${encoded}, ${entry.updatedAt})`));
        // Inspect warnings on this transaction's connection, not a pooled SHOW WARNINGS.
        // INSERT IGNORE may otherwise silently coerce or drop invalid data.
        if (header.warningStatus > 0) {
          const warnings = resultRows(await execute(tx, sql`SHOW WARNINGS`));
          if (header.affectedRows !== 0 || warnings.length !== header.warningStatus
            || !warnings.every(warning => warning && typeof warning === "object"
              && !Array.isArray(warning) && (warning as Record<string, unknown>).Code === 1062)) {
            throw new StoreUnavailable();
          }
        }
        const stored = await read(tx, entry.key);
        if (!stored || !sameIdentity(stored, entry)) throw new StoreUnavailable();
        if (header.affectedRows === 0) return false; // verified existing PK only
        if (JSON.stringify(stored) !== encoded) throw new StoreUnavailable();
        return true;
      });
    },
    async compareAndSwap(key, expectedRevision, value) {
      const next = validatedEntry(value);
      if (!validKey(key) || !validRevision(expectedRevision) || expectedRevision === MAX_REVISION
        || next.key !== key || next.revision !== expectedRevision + 1) invalidInput();
      return transaction(async tx => {
        const current = await read(tx, key);
        if (!current || current.revision !== expectedRevision) return false;
        if (!sameIdentity(current, next) || !preservesAudit(current, next)) invalidInput();
        const header = writeHeader(await execute(tx, sql`UPDATE \`public_review_responses\`
          SET \`revision\` = ${next.revision}, \`entry\` = ${JSON.stringify(next)}, \`updatedAtMs\` = ${next.updatedAt}
          WHERE \`key\` = ${key} AND \`revision\` = ${expectedRevision}`));
        if (header.warningStatus !== 0) throw new StoreUnavailable();
        return header.affectedRows === 1;
      });
    },
  };
}
