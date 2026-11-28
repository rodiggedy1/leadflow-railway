// Dry run of docs/claude/staging/quality-test-data.sql on a local throwaway TiDB (QUALITY_STAGING_DRYRUN_DB on 127.0.0.1;
// skipped otherwise): the server's own automatic upkeep and scoring, exactly as the staging page will run them.
import { describe, expect, it } from "vitest";
import mysql from "mysql2/promise";
import { refreshQualityWeek, readWeekIncidents } from "./teamQualityIncidents";
import { readTeamLeaderboardCounts, buildTeamWeekPublicationFromIncidents } from "./teamLeaderboardHistoryMetrics";
import { assertTeamHistoryCountSelect } from "./teamLeaderboardHistoryRuntime";
import { resolveTeamEvidenceWindow } from "./teamLeaderboardEvidenceWindow";
import { rankAssessedScores } from "../shared/teamLeaderboardReviewScores";

const url = process.env.QUALITY_STAGING_DRYRUN_DB ?? "";
const local = /^mysql:\/\/[^@]+@127\.0\.0\.1:\d+\/\w+$/.test(url);
describe.skipIf(!local)("staging quality test data — local dry run", () => {
  it("is matched, merged and scored automatically, then the unmatched one is retried", async () => {
    const pool = mysql.createPool({ uri: url, connectionLimit: 3 });
    try {
      const [[{ ws }]] = await pool.query("SELECT weekStart AS ws FROM team_quality_incidents WHERE sourceKey = 'sms:stgq-1'") as any;
      const port = { select: async (sql: string, params: readonly unknown[] = []) => { assertTeamHistoryCountSelect(sql); return (await pool.query(sql, [...params]) as any)[0]; } };
      const score = async () => {
        await refreshQualityWeek(pool, ws);
        const counts = await readTeamLeaderboardCounts(port as never, resolveTeamEvidenceWindow({ weekStart: ws }, new Date()));
        const snapshot = buildTeamWeekPublicationFromIncidents(counts, await readWeekIncidents(pool, ws));
        const ranked = rankAssessedScores(snapshot.publication.teams, snapshot.details);
        const team = (id: string) => ({ jobs: snapshot.publication.teams.find(t => t.id === id)!.eligibleJobs, complaints: snapshot.details[id]?.complaintCases,
          score: ranked.find(t => t.id === id)!.totalScore });
        return { alba: team("990001"), bravo: team("990002"), complete: counts.complete };
      };
      const first = await score();
      console.log("after load:", JSON.stringify(first));
      expect(first.alba).toMatchObject({ jobs: 5, complaints: 4 });
      expect(first.bravo).toMatchObject({ jobs: 4, complaints: 2 });
      const rows = (await pool.query("SELECT sourceKey, category, attribution, leadflowJobId, teamId, primaryId, processingStatus FROM team_quality_incidents WHERE sourceKey LIKE '%stgq-%' OR sourceKey IN ('signoff:job:99000013', 'rating:job:99000003') ORDER BY id") as any)[0];
      const by = (key: string) => rows.find((r: any) => r.sourceKey === key);
      expect(rows.every((r: any) => r.processingStatus === "ok")).toBe(true);
      expect(by("sms:stgq-10")).toMatchObject({ attribution: "unattributed", leadflowJobId: null });
      expect(by("sms:stgq-3")).toMatchObject({ category: "office_service", teamId: 990001, primaryId: null });
      expect(by("call:openphone:stgq-6")).toMatchObject({ category: "pricing_billing", teamId: 990002 });
      expect(by("call:callback:stgq-5").primaryId).not.toBeNull();
      expect(by("sms:stgq-8").primaryId).not.toBeNull(); // joined the rating's record, upgrading it to the AI's category
      expect(by("sms:stgq-9")).toMatchObject({ leadflowJobId: 99000004, teamId: 990001 });
      // STEP 2: the visit is entered later; the next recalculation matches the complaint automatically.
      await pool.query("INSERT INTO leadflow_jobs (id, origin, bookingId, launch27BookingId, jobDate, bookingStatus, teamId, customerName, customerPhone, serviceName, jobTotalCents) VALUES (99000016, 'native_booking', NULL, NULL, DATE_FORMAT(DATE(NOW() - INTERVAL 5 HOUR) - INTERVAL 1 DAY, '%Y-%m-%d'), 'assigned', 990002, 'Fict Customer 65', '+12025550165', 'Standard Cleaning', 16000)");
      const second = await score();
      console.log("after step 2:", JSON.stringify(second));
      expect(second.bravo).toMatchObject({ jobs: 5, complaints: 3 });
      expect(second.alba).toEqual(first.alba);
    } finally { await pool.end(); }
  });
});
