import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./qualityRouter.ts", import.meta.url), "utf8");
const internalCronSource = readFileSync(new URL("./internalCron.ts", import.meta.url), "utf8");

function sliceBetween(startMarker: string, endMarker: string) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

describe("Launch27 cleaner-job sync safety", () => {
  it("stops hourly TodaySync before mutations when Launch27 reports an error", () => {
    const helper = sliceBetween(
      "export async function runSyncTodayJobs",
      "export const qualityRouter = router({",
    );

    const errorGuard = helper.indexOf("if (result.error)");
    const bookings = helper.indexOf("const bookings = result.bookings");
    const staleCleanup = helper.indexOf("// ── Stale cleanup");

    expect(errorGuard).toBeGreaterThanOrEqual(0);
    expect(errorGuard).toBeLessThan(bookings);
    expect(errorGuard).toBeLessThan(staleCleanup);
    expect(helper).toContain("throw new Error(`Launch27 sync failed for ${dateStr}: ${result.error}`)");
  });

  it("stops manual sync before it can run team or stale cleanup on an upstream error", () => {
    const manual = sliceBetween(
      "syncTodayJobs: agentProcedure",
      "/**\n   * Get all cleaner jobs for a specific date",
    );

    const errorGuard = manual.indexOf("if (result.error)");
    const bookings = manual.indexOf("const bookings = result.bookings");
    const staleCleanup = manual.indexOf("// ── Stale cleanup");

    expect(errorGuard).toBeGreaterThanOrEqual(0);
    expect(errorGuard).toBeLessThan(bookings);
    expect(errorGuard).toBeLessThan(staleCleanup);
    expect(manual).toContain("message: `Launch27 sync failed: ${result.error}`");
  });

  it("does not change the valid empty-response path", () => {
    expect(source).not.toContain("if (result.bookings.length === 0) {\n        throw");
  });

  it("does not run any Launch27 job sync from scheduled cron jobs while preserving the manual active-job route", () => {
    expect(internalCronSource).not.toContain("runSyncTodayJobs(");
    expect(internalCronSource).not.toContain("runNightlySync(");
    expect(internalCronSource).toContain("Launch27 job sync:  manual only (all automatic schedules disabled)");
    expect(source).toContain("syncTodayJobs: agentProcedure");
  });

  it("temporarily audits both sync entries and all four cleaner-job delete sites without changing the cleanup branches", () => {
    expect(source).toContain('implementation: "runSyncTodayJobs"');
    expect(source).toContain('implementation: "quality.syncTodayJobs"');
    expect(source.match(/deleteCleanerJobWithAudit\(db, auditRun/g)).toHaveLength(4);
    expect(source).toContain('deletionReason: "team_cleanup"');
    expect(source).toContain('deletionReason: "stale_cleanup"');
    expect(source).toContain("[CleanerJobsAudit]");
    expect(source).toContain("deployed_commit_sha");
    expect(source).toContain("server_process_instance");
    expect(source).toContain("authenticated_actor_id");
    expect(source).toContain("delete_site_name");
    expect(source).toContain("candidate_cleaner_job_ids");
    expect(source).toContain("database_affected_rows");
    expect(source).toContain("stack_trace");
    expect(source).toContain('deleteSiteName: "standalone_team_reassignment"');
    expect(source).toContain('deleteSiteName: "standalone_stale"');
    expect(source).toContain('deleteSiteName: "manual_team_reassignment"');
    expect(source).toContain('deleteSiteName: "manual_stale"');
  });
});
