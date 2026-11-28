import type { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import type { HistorySnapshot } from "../shared/teamLeaderboardHistory";
import type { TeamEvidenceAuditRead } from "./teamLeaderboardEvidenceService";
import type { TeamWeeklyReviewOutcome, TeamWeeklyReviewStatus } from "./teamWeeklyReviewService";
import type { TeamWeekCounts } from "./teamLeaderboardHistoryMetrics";
import type { AnalysisState } from "./teamWeekAnalysis";

/** Where a Run review stopped and a fixed, safe code (never a provider/database message). */
export type ReviewFailure = { stage: "reading_communications" | "counting_jobs" | "saving" | "ai_review"; code: string; atMs: number };
export type ReviewRecord = {
  id: string;
  weekStart: string;
  ownerId: number;
  createdAtMs: number;
  updatedAtMs: number;
  status: string;
  progress: TeamWeeklyReviewStatus | null;
  payload: { read?: TeamEvidenceAuditRead; counts?: TeamWeekCounts; outcome?: TeamWeeklyReviewOutcome; failure?: ReviewFailure; readOmitted?: true; source?: "quality_records"; analysis?: AnalysisState };
  publication: HistorySnapshot | null;
  publishedAtMs: number | null;
  publishedBy: number | null;
};
type ReviewPatch = Partial<Pick<ReviewRecord, "status" | "progress" | "payload" | "updatedAtMs">>;

export interface TeamHistoryRepository {
  insert(record: ReviewRecord): Promise<boolean>;
  get(id: string): Promise<ReviewRecord | null>;
  listRuns(weekStart: string): Promise<ReviewRecord[]>;
  update(id: string, patch: ReviewPatch): Promise<void>;
  /** Apply the patch only if the run is still exactly as read (updatedAtMs unchanged). True when applied. */
  claim?(id: string, expectedUpdatedAtMs: number, patch: ReviewPatch): Promise<boolean>;
  /** Only the day-by-day analysis runs of a week (small rows; older review runs carry large saved reads). */
  listAnalysisRuns?(weekStart: string): Promise<ReviewRecord[]>;
  latestPublications(): Promise<ReviewRecord[]>;
  publish(id: string, snapshot: HistorySnapshot, expectedPublicationId: string | null, actorId: number, nowMs: number, baselineId?: string): Promise<ReviewRecord>;
}

const RUN_COLUMNS = "id, weekStart, ownerId, createdAtMs, updatedAtMs, status, progress, payload, publication, publishedAtMs, publishedBy";
const PATCH_COLUMNS = ["status", "progress", "payload", "updatedAtMs"] as const;
type SqlClient = Pool | PoolConnection;
type Row = RowDataPacket & Record<string, unknown>;
const fail = (code: string): never => { throw new Error(code); };
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const newestFirst = (a: ReviewRecord, b: ReviewRecord) => b.createdAtMs - a.createdAtMs || b.id.localeCompare(a.id);

function integer(value: unknown): number {
  if ((typeof value !== "number" && typeof value !== "string") || value === "") return fail("WEEK_STORAGE_INVALID");
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) return fail("WEEK_STORAGE_INVALID");
  return number;
}
function json<T>(value: unknown): T {
  try { return (typeof value === "string" ? JSON.parse(value) : Buffer.isBuffer(value) ? JSON.parse(value.toString("utf8")) : clone(value)) as T; }
  catch { return fail("WEEK_STORAGE_INVALID"); }
}
function fromRow(row: Row): ReviewRecord {
  return {
    id: String(row.id), weekStart: String(row.weekStart), ownerId: integer(row.ownerId),
    createdAtMs: integer(row.createdAtMs), updatedAtMs: integer(row.updatedAtMs), status: String(row.status),
    progress: row.progress == null ? null : json<TeamWeeklyReviewStatus>(row.progress),
    payload: json<ReviewRecord["payload"]>(row.payload),
    publication: row.publication == null ? null : json<HistorySnapshot>(row.publication),
    publishedAtMs: row.publishedAtMs == null ? null : integer(row.publishedAtMs),
    publishedBy: row.publishedBy == null ? null : integer(row.publishedBy),
  };
}
async function rows(db: SqlClient, sql: string, values: Array<string | number | null> = []): Promise<Row[]> {
  const [result] = await db.execute<RowDataPacket[]>(sql, values);
  return result as Row[];
}
async function change(db: SqlClient, sql: string, values: Array<string | number | null>): Promise<ResultSetHeader> {
  const [result] = await db.execute<ResultSetHeader>(sql, values);
  return result;
}
async function readRun(db: SqlClient, id: string, lock = false): Promise<ReviewRecord | null> {
  const found = await rows(db, `SELECT ${RUN_COLUMNS} FROM team_review_runs WHERE id = ?${lock ? " FOR UPDATE" : ""}`, [id]);
  return found.length ? fromRow(found[0]) : null;
}
function isPublished(record: ReviewRecord): boolean {
  return record.publishedAtMs !== null || record.publication !== null || record.publishedBy !== null;
}
function requireDraft(record: ReviewRecord): void {
  if (isPublished(record)) fail("WEEK_REVIEW_ALREADY_PUBLISHED");
}
function validatePublication(record: ReviewRecord, snapshot: HistorySnapshot): void {
  if (!["completed", "incomplete"].includes(record.status) || !record.payload.outcome || !record.payload.counts || !snapshot) {
    fail("WEEK_REVIEW_NOT_READY");
  }
  if (!snapshot.period || snapshot.period.weekStart !== record.weekStart
    || record.payload.counts?.period.weekStart !== record.weekStart
    || (record.payload.read && record.payload.read.sources.window.weekStart !== record.weekStart)) {
    fail("WEEK_REVIEW_PERIOD_MISMATCH");
  }
}
function publicationRecord(record: ReviewRecord, snapshot: HistorySnapshot, actorId: number, nowMs: number): ReviewRecord {
  validatePublication(record, snapshot);
  return { ...record, status: "published", publication: clone(snapshot), publishedAtMs: nowMs, publishedBy: actorId, updatedAtMs: nowMs };
}

/** Only the explicitly called methods acquire a pool. No imports, constructor,
 * reads or restarts invoke providers, resume workers, or synthesize a fallback.
 * The weekly pointer is the serialization point even before a first publication.
 */
export class MysqlTeamHistoryRepository implements TeamHistoryRepository {
  constructor(private readonly pool: () => Promise<Pool>) {}

  private async transaction<T>(work: (tx: PoolConnection) => Promise<T>): Promise<T> {
    const tx = await (await this.pool()).getConnection();
    let started = false;
    try {
      await tx.beginTransaction(); started = true;
      const result = await work(tx);
      await tx.commit();
      return result;
    } catch (error) {
      if (started) await tx.rollback();
      throw error;
    } finally { tx.release(); }
  }

  async insert(record: ReviewRecord): Promise<boolean> {
    requireDraft(record);
    const db = await this.pool();
    try {
      await change(db, `INSERT INTO team_review_runs (${RUN_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
        record.id, record.weekStart, record.ownerId, record.createdAtMs, record.updatedAtMs, record.status,
        record.progress === null ? null : JSON.stringify(record.progress), JSON.stringify(record.payload), null, null, null,
      ]);
      return true;
    } catch (error) {
      // The run UUID is the only unique run key. Never hide a different constraint
      // or storage failure and never replace the existing row on UUID replay.
      if ((error as { code?: string }).code === "ER_DUP_ENTRY" && await readRun(db, record.id)) return false;
      throw error;
    }
  }

  async get(id: string): Promise<ReviewRecord | null> { return readRun(await this.pool(), id); }

  async listRuns(weekStart: string): Promise<ReviewRecord[]> {
    return (await rows(await this.pool(), `SELECT ${RUN_COLUMNS} FROM team_review_runs WHERE weekStart = ? ORDER BY createdAtMs DESC, id DESC`, [weekStart])).map(fromRow);
  }

  async listAnalysisRuns(weekStart: string): Promise<ReviewRecord[]> {
    return (await rows(await this.pool(), `SELECT ${RUN_COLUMNS} FROM team_review_runs WHERE weekStart = ? AND JSON_EXTRACT(payload, '$.analysis.version') = 2
      ORDER BY createdAtMs DESC, id DESC`, [weekStart])).map(fromRow);
  }

  async update(id: string, patch: ReviewPatch): Promise<void> {
    await this.transaction(async tx => {
      const record = await readRun(tx, id, true);
      if (!record) return fail("WEEK_REVIEW_NOT_FOUND");
      requireDraft(record);
      const keys = PATCH_COLUMNS.filter(key => patch[key] !== undefined);
      if (!keys.length) return;
      const values = keys.map(key => {
        const value = patch[key];
        return key === "progress" || key === "payload" ? value === null ? null : JSON.stringify(value) : value as string | number;
      });
      await change(tx, `UPDATE team_review_runs SET ${keys.map(key => `${key} = ?`).join(", ")} WHERE id = ?`, [...values, id]);
    });
  }

  async claim(id: string, expectedUpdatedAtMs: number, patch: ReviewPatch): Promise<boolean> {
    const keys = PATCH_COLUMNS.filter(key => patch[key] !== undefined);
    if (!keys.length) return false;
    const values = keys.map(key => {
      const value = patch[key];
      return key === "progress" || key === "payload" ? value === null ? null : JSON.stringify(value) : value as string | number;
    });
    const result = await change(await this.pool(), `UPDATE team_review_runs SET ${keys.map(key => `${key} = ?`).join(", ")}
      WHERE id = ? AND updatedAtMs = ? AND publishedAtMs IS NULL`, [...values, id, expectedUpdatedAtMs]);
    return result.affectedRows === 1;
  }

  async latestPublications(): Promise<ReviewRecord[]> {
    const columns = RUN_COLUMNS.split(", ").map(column => `r.${column}`).join(", ");
    return (await rows(await this.pool(), `SELECT ${columns} FROM team_review_weeks w
      INNER JOIN team_review_runs r ON r.id = w.latestPublicationId AND r.weekStart = w.weekStart
      WHERE r.status = 'published' AND r.publication IS NOT NULL AND r.publishedAtMs IS NOT NULL AND r.publishedBy IS NOT NULL
      ORDER BY w.weekStart DESC`)).map(fromRow);
  }

  async publish(id: string, snapshot: HistorySnapshot, expectedPublicationId: string | null, actorId: number, nowMs: number, baselineId?: string): Promise<ReviewRecord> {
    return this.transaction(async tx => {
      // This first read supplies only immutable week identity, never publication
      // state. Read the draft again with a current locking read after the pointer.
      const captured = await readRun(tx, id);
      if (!captured) return fail("WEEK_REVIEW_NOT_FOUND");
      await change(tx, `INSERT INTO team_review_weeks (weekStart, latestPublicationId, updatedAtMs) VALUES (?, NULL, ?)
        ON DUPLICATE KEY UPDATE weekStart = VALUES(weekStart)`, [captured.weekStart, nowMs]);
      const pointers = await rows(tx, "SELECT latestPublicationId FROM team_review_weeks WHERE weekStart = ? FOR UPDATE", [captured.weekStart]);
      if (pointers.length !== 1) return fail("WEEK_STORAGE_INVALID");
      const record = await readRun(tx, id, true);
      if (!record) return fail("WEEK_REVIEW_NOT_FOUND");
      // Return the original revision even after it was superseded. In particular,
      // do not compare stale expectations or move the pointer back to this run.
      if (isPublished(record)) return record;
      const latestId = pointers[0].latestPublicationId == null ? null : String(pointers[0].latestPublicationId);
      if ((latestId ?? baselineId ?? null) !== expectedPublicationId) return fail("WEEK_PUBLICATION_CONFLICT");
      const published = publicationRecord(record, snapshot, actorId, nowMs);
      await change(tx, `UPDATE team_review_runs SET status = ?, publication = ?, publishedAtMs = ?, publishedBy = ?, updatedAtMs = ? WHERE id = ?`,
        [published.status, JSON.stringify(published.publication), nowMs, actorId, nowMs, id]);
      await change(tx, "UPDATE team_review_weeks SET latestPublicationId = ?, updatedAtMs = ? WHERE weekStart = ?", [id, nowMs, record.weekStart]);
      return published;
    });
  }
}

/** An explicitly selected synthetic repository for offline tests, never a
 * production fallback. Critical mutations contain no await/yield points.
 */
export function createMemoryTeamHistoryRepository(): TeamHistoryRepository {
  const records = new Map<string, ReviewRecord>();
  const weeks = new Map<string, string>();
  return {
    async insert(record) {
      requireDraft(record);
      if (records.has(record.id)) return false;
      records.set(record.id, clone(record)); return true;
    },
    async get(id) { return records.has(id) ? clone(records.get(id)!) : null; },
    async listRuns(weekStart) {
      return Array.from(records.values()).filter(record => record.weekStart === weekStart).sort(newestFirst).map(clone);
    },
    async update(id, patch) {
      const record = records.get(id);
      if (!record) return fail("WEEK_REVIEW_NOT_FOUND");
      requireDraft(record);
      const next = clone(record);
      for (const key of PATCH_COLUMNS) {
        if (patch[key] !== undefined) Object.assign(next, { [key]: clone(patch[key]) });
      }
      records.set(id, next);
    },
    async claim(id, expectedUpdatedAtMs, patch) {
      const record = records.get(id);
      if (!record || record.updatedAtMs !== expectedUpdatedAtMs || record.publishedAtMs !== null) return false;
      const next = clone(record);
      for (const key of PATCH_COLUMNS) if (patch[key] !== undefined) Object.assign(next, { [key]: clone(patch[key]) });
      records.set(id, next);
      return true;
    },
    async latestPublications() {
      return Array.from(weeks.entries()).sort(([a], [b]) => b.localeCompare(a)).map(([, id]) => clone(records.get(id)!));
    },
    async publish(id, snapshot, expectedPublicationId, actorId, nowMs, baselineId) {
      const record = records.get(id);
      if (!record) return fail("WEEK_REVIEW_NOT_FOUND");
      if (isPublished(record)) return clone(record);
      if ((weeks.get(record.weekStart) ?? baselineId ?? null) !== expectedPublicationId) return fail("WEEK_PUBLICATION_CONFLICT");
      const published = publicationRecord(record, snapshot, actorId, nowMs);
      records.set(id, published); weeks.set(record.weekStart, id);
      return clone(published);
    },
  };
}
