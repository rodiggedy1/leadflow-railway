import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const page = fs.readFileSync(path.join(root, "client/src/pages/CleanerPortalConnected.tsx"), "utf8");
const router = fs.readFileSync(path.join(root, "server/cleanerPortalReadOnlyRouter.ts"), "utf8");
const migration = fs.readFileSync(path.join(root, "drizzle/0098_cleaner_portal_job_progress.sql"), "utf8");

describe("isolated Cleaner Portal visibility and first operational step", () => {
  it("uses the narrow read-only source for every portal job read", () => {
    for (const procedure of ["getMyJobsToday", "getMyJobsWeek", "getMyTeamSchedule", "myJobsRange"]) {
      expect(page).toContain(`trpc.cleanerPortalReadOnly.${procedure}`);
    }
    for (const legacyProcedure of ["getMyJobsToday", "getMyJobsWeek", "getMyTeamSchedule", "myJobsRange", "getChecklistForLanguage", "getNotesForLanguage", "getProxyNumber", "toggleChecklistItem", "updateJobStatus", "uploadPhoto", "saveSignature", "saveNotHome", "markComplete", "submitWeeklySchedule"]) {
      expect(page).not.toContain(`trpc.cleaner.${legacyProcedure}`);
    }
  });

  it("uses the verified imported-job ownership rule without legacy job storage", () => {
    expect(router).toContain("eq(leadflowJobs.teamId, teamId)");
    expect(router).toContain("ACTIVE_LEADFLOW_FILTER");
    expect(router).toContain("ne(leadflowJobs.bookingStatus, \"cancelled\")");
    expect(router).toContain("ne(leadflowJobs.bookingStatus, \"rescheduled\")");
    for (const forbidden of ["cleanerJobs", "cleaner_jobs", "bookingAssignments", "cleanerPortalJobExecutions", "cleanerPortalJobPhotos", "storagePut"]) {
      expect(router).not.toContain(forbidden);
    }
  });

  it("makes a data-load failure visible rather than rendering it as an empty job list", () => {
    expect(page).toContain("if (todayQuery.isError)");
    expect(page).toContain("Your assigned jobs could not be loaded. Please try again.");
    expect(page).toContain("todayQuery.refetch()");
  });

  it("keeps the existing portal layout and enables only the three isolated progress actions", () => {
    expect(page).toContain('className="cp-topbar"');
    expect(page).toContain('className="cp-shell"');
    expect(page).toContain('className="cp-drawer"');
    for (const procedure of ["setEta", "markArrived", "startJob"]) {
      expect(page).toContain(`trpc.cleanerPortalReadOnly.${procedure}`);
    }
    expect(page).toContain("Photo actions will be enabled after portal visibility is confirmed.");
    expect(page).toContain("Customer sign-off will be enabled after portal visibility is confirmed.");
    expect(page).not.toContain("cleanerJobId");
    expect(page).not.toContain("completedJobId");
  });

  it("re-resolves opaque leadflow job ownership before each progress write and persists no legacy state", () => {
    expect(router).toContain("parseLeadflowPortalKey");
    expect(router).toContain("ownedProgressJob");
    expect(router).toContain("eq(leadflowJobs.id, leadflowJobId)");
    expect(router).toContain("eq(leadflowJobs.teamId, teamId)");
    expect(router).toContain("persistProgress");
    expect(router).toContain("input.arrivedAt === undefined");
    expect(router).toContain("input.etaTimestamp === undefined");
    expect(router).toContain("setEta: cleanerProcedure");
    expect(router).toContain("markArrived: cleanerProcedure");
    expect(router).toContain("startJob: cleanerProcedure");
    expect(router).toContain("sendSms({ to: job.customerPhone");
  });

  it("uses one additive migration for the progress table and contains no data-changing statement", () => {
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS `cleaner_portal_job_progress`");
    expect(migration).toContain("UNIQUE(`leadflowJobId`)");
    expect(migration).toContain("CREATE INDEX IF NOT EXISTS");
    expect(migration).not.toMatch(/^\s*(DELETE|UPDATE|INSERT|DROP|TRUNCATE)\b/im);
  });

  it("keeps photos, sign-off, completion, calls, and availability disabled for the next separately approved step", () => {
    for (const copy of ["Client calling will be enabled after portal visibility is confirmed.", "Photo actions will be enabled after portal visibility is confirmed.", "Customer sign-off will be enabled after portal visibility is confirmed.", "Availability changes will be enabled after portal visibility is confirmed."]) {
      expect(page).toContain(copy);
    }
  });
});
