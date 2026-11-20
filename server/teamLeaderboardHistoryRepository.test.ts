import { describe, expect, it, vi } from "vitest";
import type { Pool } from "mysql2/promise";
import type { HistorySnapshot } from "../shared/teamLeaderboardHistory";
import { createMemoryTeamHistoryRepository, MysqlTeamHistoryRepository, type ReviewRecord, type TeamHistoryRepository } from "./teamLeaderboardHistoryRepository";

const copy = <T>(value: T): T => structuredClone(value);
const week = "2026-11-22";
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
function snapshot(weekStart = week, label = "synthetic"): HistorySnapshot {
  return {
    period: { weekStart, weekEnd: "2026-11-28", coverageStart: weekStart, coverageEnd: "2026-11-28", weekConvention: "Sunday" },
    publication: { weekLabel: label, nextWeekLabel: "next", publishedLabel: "synthetic", teams: [], ownIncidents: [] },
    details: {},
  };
}
function draft(n = 1, weekStart = week): ReviewRecord {
  return {
    id: uuid(n), weekStart, ownerId: 7, createdAtMs: n, updatedAtMs: n, status: "completed", progress: null,
    payload: {
      counts: { period: snapshot(weekStart).period!, teams: [], complete: true, warnings: [] },
      outcome: { candidates: [], matches: [], visitGroups: [], validOutput: true, rejectedCandidateCount: 0,
        verifiedComplaintCount: null, verifiedRecleanRefundCount: null, publication: null, scoreResults: null },
    },
    publication: null, publishedAtMs: null, publishedBy: null,
  };
}

type SqlRow = Record<string, unknown>;
type State = { runs: Map<string, SqlRow>; weeks: Map<string, SqlRow> };
function sqlRow(record: ReviewRecord): SqlRow {
  return { ...copy(record), createdAtMs: String(record.createdAtMs), updatedAtMs: String(record.updatedAtMs),
    progress: record.progress == null ? null : JSON.stringify(record.progress), payload: JSON.stringify(record.payload),
    publication: record.publication == null ? null : JSON.stringify(record.publication) };
}

/** Models repeatable-read snapshots, current FOR UPDATE reads, per-key locks,
 * transaction-private writes, and atomic commit. Unknown SQL fails loudly.
 * No mysql driver runtime, database, provider or network is used.
 */
function transactionalPool() {
  const committed: State = { runs: new Map(), weeks: new Map() };
  const locks = new Map<string, Promise<void>>();
  const calls: Array<{ tx: number; sql: string; values: unknown[] }> = [];
  let sequence = 0;
  let released = 0;
  let rollbackCount = 0;
  let failSql: RegExp | undefined;
  let failCommit = false;
  let afterRunWrite: (() => Promise<void>) | undefined;
  let nextError: unknown;
  async function lock(key: string): Promise<() => void> {
    const previous = locks.get(key) ?? Promise.resolve();
    let unlock!: () => void;
    const held = new Promise<void>(resolve => { unlock = resolve; });
    locks.set(key, previous.then(() => held));
    await previous;
    return unlock;
  }
  type Tx = { id: number; snapshot: State; writes: State; unlock: Map<string, () => void> };
  const view = (tx: Tx | undefined, table: keyof State, current = false): Map<string, SqlRow> => {
    if (!tx) return committed[table];
    return new Map([...(current ? committed : tx.snapshot)[table], ...tx.writes[table]]);
  };
  const save = (tx: Tx | undefined, table: keyof State, id: string, row: SqlRow) => {
    (tx ? tx.writes : committed)[table].set(id, copy(row));
  };
  async function acquire(tx: Tx, key: string) {
    if (!tx.unlock.has(key)) tx.unlock.set(key, await lock(key));
  }
  async function execute(tx: Tx | undefined, raw: string, values: unknown[] = []): Promise<[unknown, unknown[]]> {
    const sql = raw.replace(/\s+/g, " ").trim();
    calls.push({ tx: tx?.id ?? 0, sql, values: copy(values) });
    if (nextError) { const error = nextError; nextError = undefined; throw error; }
    if (failSql?.test(sql)) { failSql = undefined; throw new Error("synthetic SQL failure"); }
    if (sql.startsWith("INSERT INTO team_review_runs")) {
      expect(sql).not.toMatch(/IGNORE|DUPLICATE|REPLACE/);
      const columns = sql.match(/\(([^)]+)\) VALUES/)![1].split(", ");
      const row = Object.fromEntries(columns.map((column, index) => [column, values[index]]));
      const id = String(row.id);
      if (view(tx, "runs", true).has(id)) throw Object.assign(new Error("duplicate UUID"), { code: "ER_DUP_ENTRY" });
      save(tx, "runs", id, row); return [{ affectedRows: 1 }, []];
    }
    if (sql.startsWith("INSERT INTO team_review_weeks")) {
      expect(sql).toContain("ON DUPLICATE KEY UPDATE weekStart = VALUES(weekStart)");
      expect(tx).toBeDefined();
      const key = String(values[0]); await acquire(tx!, `week:${key}`);
      if (!view(tx, "weeks", true).has(key)) save(tx, "weeks", key, { weekStart: key, latestPublicationId: null, updatedAtMs: values[1] });
      return [{ affectedRows: 1 }, []];
    }
    if (sql.startsWith("SELECT latestPublicationId FROM team_review_weeks")) {
      expect(sql).toMatch(/FOR UPDATE$/); expect(tx).toBeDefined();
      const key = String(values[0]); await acquire(tx!, `week:${key}`);
      const row = view(tx, "weeks", true).get(key); return [row ? [copy(row)] : [], []];
    }
    if (sql.startsWith("SELECT") && sql.includes("INNER JOIN team_review_runs")) {
      expect(sql).toContain("r.id = w.latestPublicationId AND r.weekStart = w.weekStart");
      expect(sql).toContain("r.status = 'published'");
      const result = [...view(tx, "weeks").values()].flatMap(pointer => {
        const row = view(tx, "runs").get(String(pointer.latestPublicationId));
        return row && row.weekStart === pointer.weekStart && row.status === "published" && row.publication != null
          && row.publishedAtMs != null && row.publishedBy != null ? [copy(row)] : [];
      }).sort((a, b) => String(b.weekStart).localeCompare(String(a.weekStart)));
      return [result, []];
    }
    if (sql.startsWith("SELECT") && sql.includes("FROM team_review_runs WHERE id = ?")) {
      const id = String(values[0]); const current = sql.endsWith("FOR UPDATE");
      if (current) { expect(tx).toBeDefined(); await acquire(tx!, `run:${id}`); }
      const row = view(tx, "runs", current).get(id); return [row ? [copy(row)] : [], []];
    }
    if (sql.startsWith("SELECT") && sql.includes("FROM team_review_runs WHERE weekStart = ?")) {
      expect(sql).toContain("ORDER BY createdAtMs DESC, id DESC"); expect(sql).not.toMatch(/LIMIT/);
      return [[...view(tx, "runs").values()].filter(row => row.weekStart === values[0]).sort((a, b) => Number(b.createdAtMs) - Number(a.createdAtMs) || String(b.id).localeCompare(String(a.id))).map(copy), []];
    }
    if (sql.startsWith("UPDATE team_review_runs SET")) {
      expect(tx).toBeDefined(); const id = String(values.at(-1));
      expect(tx!.unlock.has(`run:${id}`)).toBe(true);
      const row = copy(view(tx, "runs", true).get(id)!);
      const columns = sql.match(/SET (.+) WHERE id/)![1].split(", ").map(assignment => assignment.split(" = ")[0]);
      columns.forEach((column, index) => { row[column] = values[index]; });
      save(tx, "runs", id, row);
      if (afterRunWrite) { const callback = afterRunWrite; afterRunWrite = undefined; await callback(); }
      return [{ affectedRows: 1 }, []];
    }
    if (sql.startsWith("UPDATE team_review_weeks SET")) {
      expect(tx).toBeDefined(); const key = String(values[2]); expect(tx!.unlock.has(`week:${key}`)).toBe(true);
      const row = copy(view(tx, "weeks", true).get(key)!);
      save(tx, "weeks", key, { ...row, latestPublicationId: values[0], updatedAtMs: values[1] });
      return [{ affectedRows: 1 }, []];
    }
    throw new Error(`Unrecognized synthetic SQL: ${sql}`);
  }
  const pool = {
    execute: (sql: string, values: unknown[]) => execute(undefined, sql, values),
    async getConnection() {
      const tx: Tx = { id: ++sequence, snapshot: { runs: new Map(), weeks: new Map() }, writes: { runs: new Map(), weeks: new Map() }, unlock: new Map() };
      const releaseLocks = () => { for (const unlock of tx.unlock.values()) unlock(); tx.unlock.clear(); };
      return {
        async beginTransaction() { tx.snapshot = copy(committed); },
        execute: (sql: string, values: unknown[]) => execute(tx, sql, values),
        async commit() {
          if (failCommit) { failCommit = false; throw new Error("synthetic commit failure"); }
          for (const table of ["runs", "weeks"] as const) for (const [id, row] of tx.writes[table]) committed[table].set(id, copy(row));
          releaseLocks();
        },
        async rollback() { rollbackCount++; releaseLocks(); },
        release() { released++; releaseLocks(); },
      };
    },
  } as unknown as Pool;
  return {
    pool, calls, committed,
    stats: () => ({ released, rollbackCount }),
    failOnce: (pattern: RegExp) => { failSql = pattern; },
    failCommitOnce: () => { failCommit = true; },
    errorOnce: (error: unknown) => { nextError = error; },
    pauseAfterRunWrite: (callback: () => Promise<void>) => { afterRunWrite = callback; },
  };
}

for (const kind of ["memory", "mysql transactional fake"] as const) {
  describe(`${kind} history contract`, () => {
    function repository(): TeamHistoryRepository {
      if (kind === "memory") return createMemoryTeamHistoryRepository();
      const fake = transactionalPool(); return new MysqlTeamHistoryRepository(async () => fake.pool);
    }
    it("returns false only on duplicate UUID and preserves the original draft", async () => {
      const repo = repository(); const original = draft();
      expect(await repo.get(original.id)).toBeNull();
      expect(await repo.insert(original)).toBe(true);
      expect(await repo.insert({ ...original, ownerId: 999, payload: {}, weekStart: "2026-11-29" })).toBe(false);
      expect(await repo.get(original.id)).toEqual(original);
      original.payload.counts!.warnings.push("mutated caller");
      expect((await repo.get(original.id))!.payload.counts!.warnings).toEqual([]);
    });
    it("lists all runs in newest-created order without a total-history cap", async () => {
      const repo = repository();
      for (let n = 1; n <= 1010; n++) await repo.insert(draft(n));
      await repo.insert(draft(2000, "2026-11-29"));
      const result = await repo.listRuns(week);
      expect(result).toHaveLength(1010); expect(result[0].id).toBe(uuid(1010)); expect(result.at(-1)!.id).toBe(uuid(1));
    });
    it("updates only mutable draft fields and rejects a missing run", async () => {
      const repo = repository(); await repo.insert(draft());
      await repo.update(uuid(1), { status: "incomplete", updatedAtMs: 23, progress: null });
      await repo.update(uuid(1), {});
      expect(await repo.get(uuid(1))).toMatchObject({ status: "incomplete", updatedAtMs: 23, ownerId: 7 });
      await expect(repo.update(uuid(9), {})).rejects.toThrow("WEEK_REVIEW_NOT_FOUND");
    });
    it("publishes atomically with actor/time and keeps old revisions immutable", async () => {
      const repo = repository(); await repo.insert(draft()); await repo.insert(draft(2));
      expect(await repo.latestPublications()).toEqual([]);
      const first = await repo.publish(uuid(1), snapshot(), null, 11, 100);
      expect(first).toMatchObject({ status: "published", publishedAtMs: 100, publishedBy: 11, updatedAtMs: 100 });
      const second = await repo.publish(uuid(2), snapshot(week, "revision 2"), uuid(1), 12, 200);
      expect(await repo.latestPublications()).toEqual([second]);
      await expect(repo.update(uuid(1), { status: "failed", payload: {} })).rejects.toThrow("WEEK_REVIEW_ALREADY_PUBLISHED");
      await expect(repo.update(uuid(2), {})).rejects.toThrow("WEEK_REVIEW_ALREADY_PUBLISHED");
      expect(await repo.get(uuid(1))).toEqual(first);
      expect(await repo.listRuns(week)).toHaveLength(2);
      // A replay after supersession ignores stale expectations and new arguments.
      expect(await repo.publish(uuid(1), snapshot("2026-11-29"), "stale", 999, 999)).toEqual(first);
      expect(await repo.latestPublications()).toEqual([second]);
    });
    it("serializes two first publishers from different admins and rejects the stale one", async () => {
      const repo = repository(); await repo.insert(draft()); await repo.insert(draft(2));
      const attempts = await Promise.allSettled([
        repo.publish(uuid(1), snapshot(), null, 11, 100), repo.publish(uuid(2), snapshot(), null, 12, 101),
      ]);
      expect(attempts.filter(result => result.status === "fulfilled")).toHaveLength(1);
      const rejected = attempts.find(result => result.status === "rejected") as PromiseRejectedResult;
      expect(rejected.reason.message).toBe("WEEK_PUBLICATION_CONFLICT");
      expect(await repo.latestPublications()).toHaveLength(1);
      expect((await repo.listRuns(week)).filter(record => record.publishedAtMs !== null)).toHaveLength(1);
    });
    it("replays concurrent publishing of the same draft with its original publication", async () => {
      const repo = repository(); await repo.insert(draft());
      const [a, b] = await Promise.all([repo.publish(uuid(1), snapshot(), null, 11, 100), repo.publish(uuid(1), snapshot(week, "changed"), null, 12, 200)]);
      expect(b).toEqual(a); expect(await repo.latestPublications()).toEqual([a]);
    });
    it("uses only caller-supplied seed fallback before the first stored revision", async () => {
      const repo = repository(); await repo.insert(draft(1, "2026-11-15")); await repo.insert(draft(2, "2026-11-15"));
      await expect(repo.publish(uuid(1), snapshot("2026-11-15"), null, 11, 100, "legacy-2026-11-15")).rejects.toThrow("WEEK_PUBLICATION_CONFLICT");
      const first = await repo.publish(uuid(1), snapshot("2026-11-15"), "legacy-2026-11-15", 11, 100, "legacy-2026-11-15");
      await expect(repo.publish(uuid(2), snapshot("2026-11-15"), "legacy-2026-11-15", 12, 200, "legacy-2026-11-15")).rejects.toThrow("WEEK_PUBLICATION_CONFLICT");
      expect(await repo.latestPublications()).toEqual([first]);
    });
    it("rejects unfinished, missing-outcome/count, and mismatched-period publications", async () => {
      const repo = repository();
      for (let n = 1; n <= 5; n++) await repo.insert(draft(n));
      await repo.update(uuid(1), { status: "failed" });
      await repo.update(uuid(2), { payload: { counts: draft().payload.counts } });
      await repo.update(uuid(3), { payload: { outcome: draft().payload.outcome } });
      await repo.update(uuid(5), { payload: { ...draft().payload, counts: draft(5, "2026-11-29").payload.counts } });
      for (const n of [1, 2, 3]) await expect(repo.publish(uuid(n), snapshot(), null, 11, 100)).rejects.toThrow("WEEK_REVIEW_NOT_READY");
      await expect(repo.publish(uuid(4), snapshot("2026-11-29"), null, 11, 100)).rejects.toThrow("WEEK_REVIEW_PERIOD_MISMATCH");
      await expect(repo.publish(uuid(5), snapshot(), null, 11, 100)).rejects.toThrow("WEEK_REVIEW_PERIOD_MISMATCH");
      expect(await repo.latestPublications()).toEqual([]);
    });
    it("allows incomplete review publication without inventing adjudication policy", async () => {
      const repo = repository(); const record = draft(); record.status = "incomplete"; record.payload.counts!.complete = false;
      await repo.insert(record); expect((await repo.publish(record.id, snapshot(), null, 11, 100)).status).toBe("published");
    });
    it("rejects inserting a pre-published row outside the pointer transaction", async () => {
      const repo = repository();
      await expect(repo.insert({ ...draft(), publication: snapshot(), publishedAtMs: 100, publishedBy: 11 })).rejects.toThrow("WEEK_REVIEW_ALREADY_PUBLISHED");
      expect(await repo.get(uuid(1))).toBeNull();
    });
  });
}

describe("MySQL transaction and isolation proofs", () => {
  it("does not acquire a pool at import or construction and uses injected lazy acquisition only", async () => {
    const fake = transactionalPool(); const pool = vi.fn(async () => fake.pool);
    const repo = new MysqlTeamHistoryRepository(pool);
    expect(pool).not.toHaveBeenCalled();
    await repo.get(uuid(1)); expect(pool).toHaveBeenCalledOnce();
  });
  it("preserves private aggregation metadata through JSON publication and fresh adapter reads", async () => {
    const fake = transactionalPool(); const repo = new MysqlTeamHistoryRepository(async () => fake.pool);
    const publication = Object.assign(snapshot(), { reviewMetadata: { countsComplete: true, warnings: ["synthetic retained-source limitation"],
      unmatchedWarnings: ["synthetic unmatched association"], incidents: [{ id: "week-123:4", teamId: "4", includeComplaint: true, completedRecovery: false, refundRequest: true }] } });
    await repo.insert(draft()); await repo.publish(uuid(1), publication, null, 11, 100);
    const next = new MysqlTeamHistoryRepository(async () => fake.pool);
    expect((await next.get(uuid(1)))!.publication).toEqual(publication);
    expect((await next.latestPublications())[0].publication).toEqual(publication);
    expect(JSON.parse(String(fake.committed.runs.get(uuid(1))!.publication))).toEqual(publication);
  });
  it("propagates storage errors, including a duplicate error without an existing UUID", async () => {
    const fake = transactionalPool(); const repo = new MysqlTeamHistoryRepository(async () => fake.pool);
    const error = Object.assign(new Error("other unique constraint"), { code: "ER_DUP_ENTRY" });
    fake.errorOnce(error); await expect(repo.insert(draft())).rejects.toBe(error);
    fake.errorOnce(new Error("offline storage error")); await expect(repo.insert(draft())).rejects.toThrow("offline storage error");
  });
  it("rolls back both the run and first pointer on pointer failure and permits explicit retry", async () => {
    const fake = transactionalPool(); const repo = new MysqlTeamHistoryRepository(async () => fake.pool);
    await repo.insert(draft()); fake.failOnce(/^UPDATE team_review_weeks/);
    await expect(repo.publish(uuid(1), snapshot(), null, 11, 100)).rejects.toThrow("synthetic SQL failure");
    expect(await repo.get(uuid(1))).toEqual(draft()); expect(fake.committed.weeks.size).toBe(0);
    expect(fake.stats()).toEqual({ released: 1, rollbackCount: 1 });
    expect((await repo.publish(uuid(1), snapshot(), null, 11, 101)).publishedAtMs).toBe(101);
  });
  it("rolls back a replacement publication on commit failure, preserving the previous pointer", async () => {
    const fake = transactionalPool(); const repo = new MysqlTeamHistoryRepository(async () => fake.pool);
    await repo.insert(draft()); await repo.insert(draft(2));
    const first = await repo.publish(uuid(1), snapshot(), null, 11, 100);
    fake.failCommitOnce(); await expect(repo.publish(uuid(2), snapshot(), uuid(1), 12, 200)).rejects.toThrow("synthetic commit failure");
    expect(await repo.get(uuid(2))).toEqual(draft(2)); expect(await repo.latestPublications()).toEqual([first]);
    expect(fake.stats()).toEqual({ released: 2, rollbackCount: 1 });
  });
  it("never exposes uncommitted publication data through the weekly JOIN", async () => {
    const fake = transactionalPool(); const repo = new MysqlTeamHistoryRepository(async () => fake.pool);
    await repo.insert(draft());
    let resume!: () => void; let reached!: () => void;
    const paused = new Promise<void>(resolve => { reached = resolve; });
    const gate = new Promise<void>(resolve => { resume = resolve; });
    fake.pauseAfterRunWrite(async () => { reached(); await gate; });
    const pending = repo.publish(uuid(1), snapshot(), null, 11, 100);
    await paused;
    expect(await repo.latestPublications()).toEqual([]); expect((await repo.get(uuid(1)))!.publishedAtMs).toBeNull();
    resume(); const published = await pending; expect(await repo.latestPublications()).toEqual([published]);
  });
  it("locks the weekly pointer before the current draft and never rolls it back on superseded replay", async () => {
    const fake = transactionalPool(); const repo = new MysqlTeamHistoryRepository(async () => fake.pool);
    await repo.insert(draft()); await repo.insert(draft(2));
    await repo.publish(uuid(1), snapshot(), null, 11, 100); await repo.publish(uuid(2), snapshot(), uuid(1), 12, 200);
    const start = fake.calls.length;
    await repo.publish(uuid(1), snapshot(), null, 999, 300);
    const replay = fake.calls.slice(start);
    const pointerLock = replay.findIndex(call => call.sql.includes("FROM team_review_weeks") && call.sql.endsWith("FOR UPDATE"));
    const runLock = replay.findIndex(call => call.sql.includes("FROM team_review_runs") && call.sql.endsWith("FOR UPDATE"));
    expect(pointerLock).toBeGreaterThan(-1); expect(runLock).toBeGreaterThan(pointerLock);
    expect(replay.some(call => /^UPDATE/.test(call.sql))).toBe(false);
    expect(fake.committed.weeks.get(week)!.latestPublicationId).toBe(uuid(2));
  });
  it("does not return orphaned, draft, or unaudited pointer rows", async () => {
    const fake = transactionalPool(); const repo = new MysqlTeamHistoryRepository(async () => fake.pool);
    const row = sqlRow(draft()); fake.committed.runs.set(uuid(1), row);
    fake.committed.weeks.set(week, { weekStart: week, latestPublicationId: uuid(1), updatedAtMs: 1 });
    expect(await repo.latestPublications()).toEqual([]);
    row.status = "published"; row.publication = JSON.stringify(snapshot()); row.publishedAtMs = "100";
    expect(await repo.latestPublications()).toEqual([]);
    row.publishedBy = 11; expect(await repo.latestPublications()).toHaveLength(1);
    row.weekStart = "2026-11-29"; expect(await repo.latestPublications()).toEqual([]);
  });
});
