// team_weekly_reports on a REAL local TiDB (fictional rows only). Runs only when TEAM_REPORTS_TEST_DB points at a local
// throwaway database (mysql://root@127.0.0.1:<port>/<db>) that already has the 0084 table; skipped otherwise.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import mysql from "mysql2/promise";
import { createReportStore } from "./teamWeeklyReports";

const url = process.env.TEAM_REPORTS_TEST_DB;
const local = Boolean(url && /^mysql:\/\/[^@]*@127\.0\.0\.1:\d+\//.test(url));
const run = local ? describe : describe.skip;
let pool: mysql.Pool;
const base = { weekStart: "2026-11-22", teamId: 1, attempt: 1, teamName: "Team Alba", cleanerProfileId: 11, phone: "+13025550111", language: "en" as const,
  provisional: false, messageText: "Maids in Black weekly report for Team Alba", status: "pending" as const, error: null, providerMessageId: null, requestedBy: 7,
  createdAtMs: 1, updatedAtMs: 1, sentAtMs: null };

run("team_weekly_reports on a real local TiDB", () => {
  beforeAll(() => { pool = mysql.createPool({ uri: url!, connectionLimit: 8 }); });
  afterAll(async () => { await pool.end(); });
  it("one row per attempt; the same attempt can never be saved twice, even at the same moment", async () => {
    const store = createReportStore(pool);
    const results = await Promise.all(Array.from({ length: 6 }, () => store.reserve(base)));
    expect(results.filter(r => r === "duplicate")).toHaveLength(5);
    const id = results.find(r => r !== "duplicate") as number;
    await store.finish(id, { status: "sent", error: null, providerMessageId: "SIM-1", atMs: 5 });
    await store.finish(id, { status: "failed", error: "late", providerMessageId: null, atMs: 6 }); // a finished attempt never changes
    const second = await store.reserve({ ...base, attempt: 2 });
    expect(typeof second).toBe("number");
    expect(await store.reserve({ ...base, teamId: 2 })).not.toBe("duplicate"); // other teams are independent
    const rows = await store.list("2026-11-22");
    expect(rows.filter(r => r.teamId === 1).map(r => [r.attempt, r.status, r.providerMessageId, r.sentAtMs])).toEqual([[1, "sent", "SIM-1", 5], [2, "pending", null, null]]);
    expect(rows[0]).toMatchObject({ language: "en", provisional: false, phone: "+13025550111", requestedBy: 7 });
    expect(await store.list("2026-11-29")).toEqual([]);
  });
});
