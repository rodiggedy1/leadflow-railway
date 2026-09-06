import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const page = fs.readFileSync(path.join(root, "client/src/pages/CleanerPortalConnected.tsx"), "utf8");
const isolatedRouter = fs.readFileSync(path.join(root, "server/cleanerIsolatedRouter.ts"), "utf8");
const routerIndex = fs.readFileSync(path.join(root, "server/routers.ts"), "utf8");
const schema = fs.readFileSync(path.join(root, "drizzle/schema.ts"), "utf8");
const migration = fs.readFileSync(path.join(root, "drizzle/0098_cleaner_portal_isolated.sql"), "utf8");

describe("UI-preserving isolated Cleaner Portal contract", () => {
  it("keeps the established portal UI surface while changing its invisible job contract", () => {
    for (const token of ["cp-topbar", "cp-shell", "cp-hero", "cp-route-list", "cp-signoff", "cp-eta-options", "Before & after photos", "Customer sign-off", "Set availability"]) expect(page).toContain(token);
    expect(page).toContain('import "./cleaner-portal-connected.css"');
    expect(page).toContain('import "./cleaner-portal-login.css"');
    expect(page).toContain("portalJobKey");
    expect(page).not.toContain("cleanerJobId");
    expect(page).not.toContain("completedJobId");
  });

  it("uses isolated procedures for all booking-dependent reads and manual actions", () => {
    for (const procedure of ["getMyJobsToday", "getMyJobsWeek", "myJobsRange", "portalData", "getMyTeamSchedule", "submitWeeklySchedule", "getChecklistForLanguage", "getNotesForLanguage", "toggleChecklistItem", "getProxyNumber", "setEta", "markArrived", "markStarted", "uploadPhoto", "saveSignature", "saveNotHome", "markComplete"]) expect(page).toContain(`trpc.cleanerIsolated.${procedure}`);
    for (const forbiddenProcedure of ["trpc.cleaner.getMyJobsToday", "trpc.cleaner.getMyJobsWeek", "trpc.cleaner.myJobsRange", "trpc.cleaner.portalData", "trpc.cleaner.getMyTeamSchedule", "trpc.cleaner.submitWeeklySchedule", "trpc.cleaner.updateJobStatus", "trpc.cleaner.uploadPhoto", "trpc.cleaner.saveSignature", "trpc.cleaner.saveNotHome", "trpc.cleaner.markComplete", "trpc.cleaner.getProxyNumber", "trpc.cleaner.getChecklistForLanguage", "trpc.cleaner.getNotesForLanguage", "trpc.cleaner.toggleChecklistItem"]) expect(page).not.toContain(forbiddenProcedure);
  });

  it("admits imported and direct bookings only via exact active stored team ownership", () => {
    expect(routerIndex).toContain("cleanerIsolated: cleanerIsolatedRouter");
    expect(isolatedRouter).toContain("eq(leadflowJobs.teamId, teamId)");
    expect(isolatedRouter).toContain("eq(bookingAssignments.bookingId, bookings.id)");
    expect(isolatedRouter).toContain("eq(bookingAssignments.teamId, teamId)");
    expect(isolatedRouter).toContain('eq(bookingAssignments.status, "assigned")');
    expect(isolatedRouter).toContain("isNull(bookingAssignments.unassignedAt)");
    for (const exclusion of ['ne(leadflowJobs.bookingStatus, "cancelled")', 'ne(leadflowJobs.bookingStatus, "rescheduled")', 'ne(bookings.status, "cancelled")', 'ne(bookings.status, "rescheduled")']) expect(isolatedRouter).toContain(exclusion);
  });

  it("derives Today and My Jobs from one combined adapter and protects every operation with server-side ownership resolution", () => {
    expect(isolatedRouter).toContain("async function listPortalJobs");
    expect(isolatedRouter).toContain("await listPortalJobs(ctx.cleaner.cleanerId, today, today)");
    expect(isolatedRouter).toContain("await listPortalJobs(ctx.cleaner.cleanerId, today, etDate(7))");
    expect(isolatedRouter).toContain("parsePortalJobKey");
    expect(isolatedRouter).toContain("ownedPortalJob(cleanerId, reference)");
    expect(isolatedRouter).toContain("recordKind: reference.recordKind, sourceId: reference.sourceId");
  });

  it("keeps execution and photo writes isolated from legacy job storage", () => {
    for (const forbiddenToken of ["cleanerJobs", "cleaner_jobs", "jobPhotos", "leadflowJobExecutions", "leadflowJobPhotos"]) expect(isolatedRouter).not.toContain(forbiddenToken);
    expect(schema).toContain("export const cleanerPortalJobExecutions");
    expect(schema).toContain("uniqueIndex(\"uq_cleaner_portal_execution_source\").on(t.recordKind, t.sourceId)");
    expect(schema).toContain("export const cleanerPortalJobPhotos");
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS `cleaner_portal_job_executions`");
    expect(migration).toContain("UNIQUE(`recordKind`,`sourceId`)");
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS `cleaner_portal_job_photos`");
    expect(migration).not.toMatch(/^\s*(?:DROP|TRUNCATE|DELETE|UPDATE|INSERT)\b/im);
  });

  it("retains explicit ETA, arrival, photo-library, and sign-off interaction gates", () => {
    expect(page).toContain("The client will receive the selected arrival time.");
    expect(page).toContain("Tell the client you’ve arrived?");
    expect(page).toContain('accept="image/*"');
    expect(page).not.toContain('photoInputRef.current?.click()');
    expect(page).not.toContain('capture="environment"');
    expect(isolatedRouter).toContain("sendSms({ to: source.customerPhone");
    expect(isolatedRouter).toContain("cleaner-portal-photos/");
  });
});
