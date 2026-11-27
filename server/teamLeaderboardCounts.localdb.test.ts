// Local throwaway TiDB only (LB_COUNTS_TEST_DB=mysql://root@127.0.0.1:<port>/<db>); skipped otherwise.
// Runs the real count reader through the production allowlist against fictional rows.
import { describe, expect, it } from "vitest";
import mysql from "mysql2/promise";
import { readTeamLeaderboardCounts } from "./teamLeaderboardHistoryMetrics";
import { assertTeamHistoryCountSelect } from "./teamLeaderboardHistoryRuntime";
import { resolveTeamEvidenceWindow } from "./teamLeaderboardEvidenceWindow";
import { easternDateIso } from "../shared/easternTime";
import { shiftBookingDate } from "../shared/bookingReschedule";
import { rankAssessedScores } from "../shared/teamLeaderboardReviewScores";

const url = process.env.LB_COUNTS_TEST_DB ?? "";
const local = /^mysql:\/\/[^@]+@127\.0\.0\.1:\d+\/\w+$/.test(url);
describe.skipIf(!local)("leaderboard counts against a local database (fictional rows)", () => {
  it("counts done jobs, today's jobs only with a sign-off, missing portal record as missed ETA, unmapped flagged", async () => {
    const pool = mysql.createPool({ uri: url, connectionLimit: 2 });
    try {
      const port = { select: async (query: string, params: readonly unknown[] = []) => {
        assertTeamHistoryCountSelect(query);
        const [rows] = await pool.query(query, [...params]);
        return rows as Record<string, unknown>[];
      } };
      const today = easternDateIso(new Date());
      const weekStart = shiftBookingDate(today, -new Date(`${today}T12:00:00Z`).getUTCDay());
      const c = await readTeamLeaderboardCounts(port as never, resolveTeamEvidenceWindow({ weekStart }, new Date()));
      const team = (name: string) => c.teams.find(t => t.name.startsWith(name))!;
      expect(c.complete).toBe(true);
      // Alba: 3 completed imported jobs; 1 has an ETA, 1 has a null ETA, 1 has no portal record (missed ETA).
      expect(team("Team Alba").eligibleJobs).toBe(3);
      expect(team("Team Alba").metrics.eta).toEqual({ successful: 1, eligible: 3, complete: true });
      expect(team("Team Alba").metrics.photos).toEqual({ successful: 1, eligible: 3, complete: true });
      expect(team("Team Alba").metrics.ratings).toEqual({ successful: 1, eligible: 2, complete: true });
      // Bravo: 904 (done) + 909 (today, signed off) count; 905 (today, no sign-off) does not — unless today is the week's
      // first seeded day, when 904 is also dated today and has no sign-off.
      const bravo = team("Team Bravo").eligibleJobs;
      expect([1, 2]).toContain(bravo);
      expect(c.warnings.join(" ")).toMatch(/dated today or later have no completion evidence yet/);
      // Coral: cancelled job excluded; Delta: no jobs.
      expect(team("Team Coral").eligibleJobs).toBe(1); expect(team("Team Delta").eligibleJobs).toBe(0);
      expect(c.warnings.join(" ")).toMatch(/Unmapped job 906/);
      const ranked = rankAssessedScores(c.teams, Object.fromEntries(c.teams.map(t => [t.id, { complaintCases: 0, refundRequests: 0, confirmedRecoveryCases: 0 }])));
      expect(ranked.find(t => t.name.startsWith("Team Alba"))!.rank).toBe(1);
      expect(ranked.filter(t => t.unrankedReason).map(t => t.name.split(" ")[1]).sort()).toEqual(["Bravo", "Coral"]);
      console.log(JSON.stringify(ranked.map(t => [t.name, t.eligibleJobs, t.totalScore, t.rank, t.unrankedReason])));
    } finally { await pool.end(); }
  });
});
