import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const page = fs.readFileSync(path.join(root, "client/src/pages/CleanerPortalConnected.tsx"), "utf8");
const router = fs.readFileSync(path.join(root, "server/cleanerPortalReadOnlyRouter.ts"), "utf8");

describe("read-only Cleaner Portal visibility contract", () => {
  it("uses the narrow read-only source for every portal job read", () => {
    for (const procedure of ["getMyJobsToday", "getMyJobsWeek", "getMyTeamSchedule", "myJobsRange"]) {
      expect(page).toContain(`trpc.cleanerPortalReadOnly.${procedure}`);
    }
    for (const legacyProcedure of ["getMyJobsToday", "getMyJobsWeek", "getMyTeamSchedule", "myJobsRange", "getChecklistForLanguage", "getNotesForLanguage", "getProxyNumber", "toggleChecklistItem", "updateJobStatus", "uploadPhoto", "saveSignature", "saveNotHome", "markComplete", "submitWeeklySchedule"]) {
      expect(page).not.toContain(`trpc.cleaner.${legacyProcedure}`);
    }
  });

  it("uses the verified imported-job ownership rule without legacy storage or new isolated tables", () => {
    expect(router).toContain("eq(leadflowJobs.teamId, teamId)");
    expect(router).toContain("ACTIVE_LEADFLOW_FILTER");
    expect(router).toContain("ne(leadflowJobs.bookingStatus, \"cancelled\")");
    expect(router).toContain("ne(leadflowJobs.bookingStatus, \"rescheduled\")");
    for (const forbidden of ["cleanerJobs", "cleaner_jobs", "bookingAssignments", "cleanerPortalJobExecutions", "cleanerPortalJobPhotos", "storagePut", "sendSms"]) {
      expect(router).not.toContain(forbidden);
    }
  });

  it("makes a data-load failure visible rather than rendering it as an empty job list", () => {
    expect(page).toContain("if (todayQuery.isError)");
    expect(page).toContain("Your assigned jobs could not be loaded. Please try again.");
    expect(page).toContain("todayQuery.refetch()");
  });

  it("keeps the existing portal layout while disabling every legacy booking operation during the visibility-only release", () => {
    expect(page).toContain('className="cp-topbar"');
    expect(page).toContain('className="cp-shell"');
    expect(page).toContain('className="cp-drawer"');
    expect(page).toContain("will be enabled after portal visibility is confirmed");
    expect(page).not.toContain("cleanerJobId");
    expect(page).not.toContain("completedJobId");
  });
});
