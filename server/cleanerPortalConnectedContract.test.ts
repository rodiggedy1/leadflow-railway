import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { cleanerPortalPayWeeks, payrollPercentFromCleanerProfile } from "./cleanerPortalReadOnlyRouter";
import { calculateEffectivePayroll } from "./payrollCalculator";

const root = path.resolve(import.meta.dirname, "..");
const page = fs.readFileSync(path.join(root, "client/src/pages/CleanerPortalConnected.tsx"), "utf8");
const listRouter = fs.readFileSync(path.join(root, "server/cleanerPortalReadOnlyRouter.ts"), "utf8");
const progressRouter = fs.readFileSync(path.join(root, "server/cleanerPortalProgressRouter.ts"), "utf8");
const migration = fs.readFileSync(path.join(root, "drizzle/0098_cleaner_portal_job_progress.sql"), "utf8");
const managedMigration = fs.readFileSync(path.join(root, "server/versioned-migrations/0027_create_cleaner_portal_job_progress.sql"), "utf8");
const managedManifest = JSON.parse(fs.readFileSync(path.join(root, "server/versioned-migrations/manifest.json"), "utf8")) as { migrations: Array<{ id: string; mode?: string; sqlFile: string; postconditionsFile: string; sha256: string }> };
const managedPostconditions = JSON.parse(fs.readFileSync(path.join(root, "server/versioned-migrations/0027_create_cleaner_portal_job_progress.postconditions.json"), "utf8")) as { columns: Array<{ name: string; default?: string }> };

describe("isolated ETA Cleaner Portal contract", () => {
  it("keeps every working job list read on the frozen read-only source", () => {
    for (const procedure of ["getMyJobsToday", "getMyJobsWeek", "getMyTeamSchedule", "getMyEarnings"]) {
      expect(page).toContain(`trpc.cleanerPortalReadOnly.${procedure}`);
    }
    for (const legacyProcedure of ["getMyJobsToday", "getMyJobsWeek", "getMyTeamSchedule", "myJobsRange", "getChecklistForLanguage", "getNotesForLanguage", "getProxyNumber", "toggleChecklistItem", "updateJobStatus", "uploadPhoto", "saveSignature", "saveNotHome", "markComplete", "submitWeeklySchedule"]) {
      expect(page).not.toContain(`trpc.cleaner.${legacyProcedure}`);
    }
  });

  it("freezes the verified imported-job list without a progress-table dependency", () => {
    const ownedJobListHelper = listRouter.slice(listRouter.indexOf("async function listOwnedImportedJobs"), listRouter.indexOf("export const cleanerPortalReadOnlyRouter"));
    const frozenJobListProcedures = listRouter.slice(listRouter.indexOf("getMyJobsToday:"), listRouter.indexOf("getMyEarnings:"));
    expect(ownedJobListHelper).toContain("eq(leadflowJobs.teamId, teamId)");
    expect(ownedJobListHelper).toContain("ACTIVE_LEADFLOW_FILTER");
    expect(listRouter).toContain("ne(leadflowJobs.bookingStatus, \"cancelled\")");
    expect(listRouter).toContain("ne(leadflowJobs.bookingStatus, \"rescheduled\")");
    expect(frozenJobListProcedures).toContain("listOwnedImportedJobs");
    for (const forbidden of ["cleanerJobs", "cleaner_jobs", "bookingAssignments", "cleanerPortalJobProgress", "storagePut", "sendSms"]) {
      expect(ownedJobListHelper).not.toContain(forbidden);
      expect(frozenJobListProcedures).not.toContain(forbidden);
    }
  });

  it("uses the established effective-payroll calculator and actual ET Sunday-to-Saturday pay weeks for isolated earnings", () => {
    expect(listRouter).toContain("calculateEffectivePayroll");
    expect(listRouter).toContain("getPayWeekStart");
    expect(listRouter).toContain("getMyEarnings");
    expect(listRouter).not.toContain("cleanerJobs");
    expect(listRouter).not.toContain("cleaner_jobs");
    expect(page).toContain("trpc.cleanerPortalReadOnly.getMyEarnings.useQuery");
    expect(page).toContain("Current pay week");
    expect(page).toContain("Previous pay week");
    expect(page).toContain("formatPayWeekDate(currentPayWeek.start)");
    expect(page).toContain("formatPayWeekDate(previousPayWeek.start)");

    expect(cleanerPortalPayWeeks(new Date("2026-09-06T16:00:00.000Z"))).toEqual({
      currentStart: "2026-09-06",
      currentEnd: "2026-09-12",
      previousStart: "2026-08-30",
      previousEnd: "2026-09-05",
    });
    expect(payrollPercentFromCleanerProfile("0.6")).toBe(60);
    expect(payrollPercentFromCleanerProfile("55")).toBe(55);
    expect(calculateEffectivePayroll({ jobDate: "2026-09-06", jobRevenue: 100, payPercent: payrollPercentFromCleanerProfile("0.6") }).finalPay).toBe(52.2);
  });

  it("makes a data-load failure visible rather than rendering it as an empty job list", () => {
    expect(page).toContain("if (todayQuery.isError)");
    expect(page).toContain("Your assigned jobs could not be loaded. Please try again.");
    expect(page).toContain("todayQuery.refetch()");
  });

  it("keeps the existing portal layout while enabling the isolated progress and restored photo controls", () => {
    expect(page).toContain('className="cp-topbar"');
    expect(page).toContain('className="cp-shell"');
    expect(page).toContain('className="cp-drawer"');
    expect(page).toContain("trpc.cleanerPortalProgress.getForJob.useQuery");
    expect(page).toContain("trpc.cleanerPortalProgress.setEta.useMutation");
    expect(page).toContain("trpc.cleanerPortalProgress.markArrived.useMutation");
    expect(page).toContain("trpc.cleanerPortalProgress.startJob.useMutation");
    expect(page).toContain("The client will receive the selected arrival time.");
    expect(page).toContain("This will record your arrival and message the client.");
    expect(page).toContain("Select visit-condition and finished-result images from your photo library.");
    expect(page).toContain("trpc.cleanerPortalPhotos.getForJob.useQuery");
    expect(page).toContain("trpc.cleanerPortalPhotos.uploadPhoto.useMutation");
    expect(page).toContain("trpc.cleanerPortalSignoff.getForJob.useQuery");
    expect(page).toContain("trpc.cleanerPortalSignoff.saveSignature.useMutation");
    expect(page).toContain("trpc.cleanerPortalSignoff.saveNotHome.useMutation");
    expect(page).toContain("Customer was not home");
    expect(page).not.toContain("cleanerJobId");
    expect(page).not.toContain("completedJobId");
  });

  it("re-checks team-owned imported jobs and preserves prior progress timestamps on every write", () => {
    expect(progressRouter).toContain("parseLeadflowJobId");
    expect(progressRouter).toContain("eq(leadflowJobs.teamId, cleaner.teamId)");
    expect(progressRouter).toContain("ne(leadflowJobs.bookingStatus, \"cancelled\")");
    expect(progressRouter).toContain("ne(leadflowJobs.bookingStatus, \"rescheduled\")");
    expect(progressRouter).toContain("existing?.etaTimestamp");
    expect(progressRouter).toContain("existing?.arrivedAt");
    expect(progressRouter).toContain("existing?.startedAt");
    expect(progressRouter).toContain("[10, 20, 30, 45, 60, 75, 90, 120]");
    for (const forbidden of ["cleanerJobs", "cleaner_jobs", "jobStatusHistory", "opsChatMessages", "jobAlerts", "sendClientOnTheWaySms", "sendArrivedCheckin"]) {
      expect(progressRouter).not.toContain(forbidden);
    }
  });

  it("uses one additive isolated progress migration with no data-changing statement", () => {
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS `cleaner_portal_job_progress`");
    expect(migration).toContain("UNIQUE KEY `uq_cleaner_portal_job_progress_job` (`leadflowJobId`)");
    expect(migration).toContain("KEY `idx_cleaner_portal_job_progress_team` (`teamId`)");
    expect(migration).not.toMatch(/^\s*(DELETE|UPDATE|INSERT|DROP|TRUNCATE)\b/im);
  });

  it("registers the ETA progress table in the production-managed migration manifest", () => {
    const entry = managedManifest.migrations.find(migrationEntry => migrationEntry.id === "0027_create_cleaner_portal_job_progress");
    expect(entry).toMatchObject({ mode: "create-table", sqlFile: "0027_create_cleaner_portal_job_progress.sql", postconditionsFile: "0027_create_cleaner_portal_job_progress.postconditions.json" });
    expect(managedMigration).toContain("CREATE TABLE IF NOT EXISTS `cleaner_portal_job_progress`");
    expect(managedMigration).not.toMatch(/^\s*(DELETE|UPDATE|INSERT|DROP|TRUNCATE)\b/im);
    expect(entry?.sha256).toBe(createHash("sha256").update(managedMigration).digest("hex"));
    expect(managedPostconditions.columns.find(column => column.name === "createdAt")?.default).toBe("current_timestamp(3)");
    expect(managedPostconditions.columns.find(column => column.name === "updatedAt")?.default).toBe("current_timestamp(3)");
  });
});
