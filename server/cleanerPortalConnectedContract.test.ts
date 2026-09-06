import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const page = fs.readFileSync(path.join(root, "client/src/pages/CleanerPortalConnected.tsx"), "utf8");
const listRouter = fs.readFileSync(path.join(root, "server/cleanerPortalReadOnlyRouter.ts"), "utf8");
const progressRouter = fs.readFileSync(path.join(root, "server/cleanerPortalProgressRouter.ts"), "utf8");
const migration = fs.readFileSync(path.join(root, "drizzle/0098_cleaner_portal_job_progress.sql"), "utf8");

describe("isolated ETA Cleaner Portal contract", () => {
  it("keeps every working job list read on the frozen read-only source", () => {
    for (const procedure of ["getMyJobsToday", "getMyJobsWeek", "getMyTeamSchedule", "myJobsRange"]) {
      expect(page).toContain(`trpc.cleanerPortalReadOnly.${procedure}`);
    }
    for (const legacyProcedure of ["getMyJobsToday", "getMyJobsWeek", "getMyTeamSchedule", "myJobsRange", "getChecklistForLanguage", "getNotesForLanguage", "getProxyNumber", "toggleChecklistItem", "updateJobStatus", "uploadPhoto", "saveSignature", "saveNotHome", "markComplete", "submitWeeklySchedule"]) {
      expect(page).not.toContain(`trpc.cleaner.${legacyProcedure}`);
    }
  });

  it("freezes the verified imported-job list without a progress-table dependency", () => {
    expect(listRouter).toContain("eq(leadflowJobs.teamId, teamId)");
    expect(listRouter).toContain("ACTIVE_LEADFLOW_FILTER");
    expect(listRouter).toContain("ne(leadflowJobs.bookingStatus, \"cancelled\")");
    expect(listRouter).toContain("ne(leadflowJobs.bookingStatus, \"rescheduled\")");
    for (const forbidden of ["cleanerJobs", "cleaner_jobs", "bookingAssignments", "cleanerPortalJobProgress", "storagePut", "sendSms"]) {
      expect(listRouter).not.toContain(forbidden);
    }
  });

  it("makes a data-load failure visible rather than rendering it as an empty job list", () => {
    expect(page).toContain("if (todayQuery.isError)");
    expect(page).toContain("Your assigned jobs could not be loaded. Please try again.");
    expect(page).toContain("todayQuery.refetch()");
  });

  it("keeps the existing portal layout while enabling only the three isolated progress controls", () => {
    expect(page).toContain('className="cp-topbar"');
    expect(page).toContain('className="cp-shell"');
    expect(page).toContain('className="cp-drawer"');
    expect(page).toContain("trpc.cleanerPortalProgress.getForJob.useQuery");
    expect(page).toContain("trpc.cleanerPortalProgress.setEta.useMutation");
    expect(page).toContain("trpc.cleanerPortalProgress.markArrived.useMutation");
    expect(page).toContain("trpc.cleanerPortalProgress.startJob.useMutation");
    expect(page).toContain("The client will receive the selected arrival time.");
    expect(page).toContain("This will record your arrival and message the client.");
    expect(page).toContain("Photo actions will be enabled after portal visibility is confirmed.");
    expect(page).toContain("Customer sign-off will be enabled after portal visibility is confirmed.");
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
    expect(migration).toContain("UNIQUE(`leadflowJobId`)");
    expect(migration).toContain("CREATE INDEX IF NOT EXISTS");
    expect(migration).not.toMatch(/^\s*(DELETE|UPDATE|INSERT|DROP|TRUNCATE)\b/im);
  });
});
