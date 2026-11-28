import type { Pool } from "mysql2/promise";
import { getDb, getPool } from "./db";
import { MysqlTeamHistoryRepository } from "./teamLeaderboardHistoryRepository";
import { createTeamLeaderboardHistoryService, type TeamLeaderboardHistoryService } from "./teamLeaderboardHistoryService";
import { createTeamEvidenceService } from "./teamLeaderboardEvidenceService";
import { readTeamLeaderboardCounts } from "./teamLeaderboardHistoryMetrics";
import { createTeamWeekAnalysis, type TeamWeekAnalysis } from "./teamWeekAnalysis";
import type { SelectPort, SqlRow, SqlValue } from "./instinct/readDb";

// Sign-offs are read-only completion evidence for jobs dated today (Phase 1).
const allowed = new Set(["leadflow_jobs", "cleaner_portal_job_progress", "cleaner_portal_job_photos", "cleaner_portal_job_signoffs", "scheduling_teams"]);
export function assertTeamHistoryCountSelect(query: string): void {
  if (!/^SELECT\s/i.test(query) || /[;'"\\#@]|--|\/\*|\*\/|:=/.test(query)
    || /\b(?:INSERT|UPDATE|DELETE|REPLACE|ALTER|DROP|CREATE|TRUNCATE|CALL|INTO|FOR|LOCK|UNION|SLEEP|LOAD_FILE)\b/i.test(query)) throw new Error("WEEK_COUNTS_INVALID_QUERY");
  const tables = Array.from(query.matchAll(/\b(?:FROM|JOIN)\s+`([a-z_]+)`/gi));
  if (!tables.length || tables.some(match => !allowed.has(match[1]))) throw new Error("WEEK_COUNTS_INVALID_QUERY");
}
async function pool(): Promise<Pool> {
  if (!await getDb()) throw new Error("WEEK_STORAGE_UNAVAILABLE");
  const value = getPool();
  if (!value) throw new Error("WEEK_STORAGE_UNAVAILABLE");
  return value;
}
const countPort: SelectPort = Object.freeze({
  async select(query: string, params: readonly SqlValue[] = []) {
    assertTeamHistoryCountSelect(query);
    const [rows] = await (await pool()).query(query, [...params]);
    if (!Array.isArray(rows) || rows.some(row => !row || typeof row !== "object")) throw new Error("WEEK_COUNTS_UNAVAILABLE");
    return rows as SqlRow[];
  },
});
let current: TeamLeaderboardHistoryService | undefined;
/** Lazy factory only. No DB, model, message or review work until an authorized call. */
export function teamLeaderboardHistoryService(): TeamLeaderboardHistoryService {
  if (!current) {
    const evidence = createTeamEvidenceService();
    current = createTeamLeaderboardHistoryService({ repository: new MysqlTeamHistoryRepository(pool),
      readWeek: input => evidence.readWeek(input), readCounts: window => readTeamLeaderboardCounts(countPort, window),
      // Phase 2 saved quality records (pool acquired only when an admin action uses them).
      quality: {
        readIncidents: async weekStart => (await import("./teamQualityIncidents")).readWeekIncidents(await pool(), weekStart),
        record: async signal => (await import("./teamQualityIncidents")).recordQualitySignal(await pool(), signal),
        refresh: async weekStart => (await import("./teamQualityIncidents")).refreshQualityWeek(await pool(), weekStart),
      } });
  }
  return current;
}
let analysis: TeamWeekAnalysis | undefined;
/** The week's day-by-day complaint analysis. Lazy: nothing runs until an admin starts or views it. */
export function teamWeekAnalysisService(): TeamWeekAnalysis {
  if (!analysis) {
    const evidence = createTeamEvidenceService();
    analysis = createTeamWeekAnalysis({ repository: new MysqlTeamHistoryRepository(pool), readWeek: input => evidence.readWeek(input),
      record: async signal => (await import("./teamQualityIncidents")).recordQualitySignal(await pool(), signal) });
  }
  return analysis;
}
