import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const page = fs.readFileSync(path.join(root, "client/src/pages/CleanerPortalConnected.tsx"), "utf8");
const router = fs.readFileSync(path.join(root, "server/cleanerRouter.ts"), "utf8");

describe("connected Cleaner Portal contract", () => {
  it("uses existing authenticated cleaner procedures rather than introducing a parallel router", () => {
    for (const procedure of ["login", "me", "getMyJobsToday", "getMyJobsWeek", "getMyTeamSchedule", "getChecklistForLanguage", "getNotesForLanguage", "portalData", "myJobsRange", "getProxyNumber", "toggleChecklistItem", "updateJobStatus", "uploadPhoto", "saveSignature", "saveNotHome", "markComplete", "submitWeeklySchedule", "updateLanguage", "logout"]) {
      expect(page).toContain(`trpc.cleaner.${procedure}`);
    }
    expect(page).not.toContain("trpc.cleanerPortal");
  });

  it("keeps job state, photo storage, completion pay calculation, and client notifications in the existing server handlers", () => {
    expect(router).toContain("uploadPhoto: cleanerProcedure");
    expect(router).toContain("markComplete: cleanerProcedure");
    expect(router).toContain("updateJobStatus: cleanerProcedure");
    expect(router).toContain("saveSignature: cleanerProcedure");
    expect(page).not.toContain("calculateCleanerJobPayroll");
    expect(page).not.toContain("storagePut(");
  });

  it("confirms external client-affecting ETA, arrival, and completion actions before invoking their existing mutations", () => {
    expect(page).toContain("The client will receive the selected arrival time");
    expect(page).toContain("Tell the client you’ve arrived?");
    expect(page).toContain("Mark this job complete?");
    expect(page).toContain('status: "on_the_way"');
    expect(page).toContain('status: "arrived"');
  });

  it("uses native labeled file controls for explicit before and after uploads", () => {
    expect(page).toContain('htmlFor={photoInputId}');
    expect(page).toContain('setPendingPhotoType("before")');
    expect(page).toContain('setPendingPhotoType("after")');
    expect(page).toContain('photoType: index === 0 ? pendingPhotoType : "after"');
    expect(page).not.toContain('photoInputRef.current?.click()');
    expect(page).not.toContain('capture="environment"');
  });
});
