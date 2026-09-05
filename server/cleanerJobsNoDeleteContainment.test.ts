import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./qualityRouter.ts", import.meta.url), "utf8");

describe("cleaner_jobs deletion audit", () => {
  it("executes the shared physical delete helper used by all four cleanup sites", () => {
    expect(source.match(/deleteCleanerJobWithAudit\(db, auditRun/g)).toHaveLength(4);
    expect(source).toContain("db.delete(cleanerJobs)");
    expect(source).toContain('event: "delete_attempt"');
    expect(source).toContain('event: "delete_result"');
    expect(source).toContain("getAffectedRows(result)");
  });

  it("retains the active-job sync create and update paths", () => {
    const standalone = source.slice(
      source.indexOf("export async function runSyncTodayJobs"),
      source.indexOf("export const qualityRouter = router({"),
    );
    const manual = source.slice(
      source.indexOf("syncTodayJobs: agentProcedure"),
      source.indexOf("/**\n   * Get all cleaner jobs for a specific date"),
    );

    for (const sync of [standalone, manual]) {
      expect(sync).toContain("getCompletedBookingsForDate");
      expect(sync).toContain("db.insert(cleanerJobs).values");
      expect(sync).toContain("db.update(cleanerJobs)");
      expect(sync).toContain("deleteCleanerJobWithAudit(db, auditRun");
    }
  });
});
