import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const page = fs.readFileSync(path.join(root, "client/src/pages/CleanerPortalConnected.tsx"), "utf8");
const isolatedRouter = fs.readFileSync(path.join(root, "server/cleanerIsolatedRouter.ts"), "utf8");
const routerIndex = fs.readFileSync(path.join(root, "server/routers.ts"), "utf8");
const schema = fs.readFileSync(path.join(root, "drizzle/schema.ts"), "utf8");
const migration = fs.readFileSync(path.join(root, "drizzle/0098_cleaner_portal_isolated.sql"), "utf8");

describe("isolated Cleaner Portal contract", () => {
  it("uses the isolated router for every portal job read and manual action", () => {
    for (const procedure of ["getMyJobsToday", "getMyJobsWeek", "getTeamSchedule", "updateTeamSchedule", "setEta", "markArrived", "markStarted", "uploadPhoto", "saveSignature", "markComplete"]) {
      expect(page).toContain(`trpc.cleanerIsolated.${procedure}`);
    }
    for (const forbiddenCall of ["trpc.cleaner.getMyJobsToday", "trpc.cleaner.getMyJobsWeek", "trpc.cleaner.getProxyNumber", "trpc.cleaner.myJobsRange"]) expect(page).not.toContain(forbiddenCall);
    expect(page).toContain("portalJobKey");
    expect(page).not.toContain("leadflowJobId");
  });

  it("keeps the new runtime path separately registered and free of legacy cleaner job dependencies", () => {
    expect(routerIndex).toContain("cleanerIsolated: cleanerIsolatedRouter");
    expect(isolatedRouter).toContain("cleanerPortalJobExecutions");
    expect(isolatedRouter).toContain("cleanerPortalJobPhotos");
    for (const forbiddenToken of ["cleanerJobs", "cleaner_jobs", "leadflowJobExecutions", "leadflowJobPhotos"]) expect(isolatedRouter).not.toContain(forbiddenToken);
  });

  it("includes both sources through exact active stored team assignments and excludes inactive lifecycle states", () => {
    expect(isolatedRouter).toContain("eq(leadflowJobs.teamId, teamId)");
    expect(isolatedRouter).toContain("eq(bookingAssignments.bookingId, bookings.id)");
    expect(isolatedRouter).toContain("eq(bookingAssignments.teamId, teamId)");
    expect(isolatedRouter).toContain('eq(bookingAssignments.status, "assigned")');
    expect(isolatedRouter).toContain("isNull(bookingAssignments.unassignedAt)");
    expect(isolatedRouter).toContain('ne(leadflowJobs.bookingStatus, "cancelled")');
    expect(isolatedRouter).toContain('ne(leadflowJobs.bookingStatus, "rescheduled")');
    expect(isolatedRouter).toContain('ne(bookings.status, "cancelled")');
    expect(isolatedRouter).toContain('ne(bookings.status, "rescheduled")');
    expect(isolatedRouter).toContain("cleaner.launch27TeamId");
  });

  it("uses one source-agnostic adapter for Today and Schedule and namespaces every source key", () => {
    expect(isolatedRouter).toContain("async function listPortalJobs");
    expect(isolatedRouter).toContain("await listPortalJobs(ctx.cleaner.cleanerId, today, today)");
    expect(isolatedRouter).toContain("await listPortalJobs(ctx.cleaner.cleanerId, today, etDate(7))");
    expect(isolatedRouter).toContain("function portalJobKey(recordKind: PortalRecordKind, sourceId: number)");
    expect(isolatedRouter).toContain("recordKind: \"leadflow\"");
    expect(isolatedRouter).toContain("recordKind: \"direct\"");
  });

  it("re-resolves ownership and stores every action against an isolated normalized reference", () => {
    expect(isolatedRouter).toContain("parsePortalJobKey");
    expect(isolatedRouter).toContain("ownedPortalJob(cleanerId, reference)");
    expect(isolatedRouter).toContain("recordKind: reference.recordKind, sourceId: reference.sourceId");
    expect(isolatedRouter).toContain("cleanerPortalJobExecutionId: execution.id");
    expect(schema).toContain("export const cleanerPortalJobExecutions");
    expect(schema).toContain("uniqueIndex(\"uq_cleaner_portal_execution_source\").on(t.recordKind, t.sourceId)");
    expect(schema).toContain("export const cleanerPortalJobPhotos");
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS `cleaner_portal_job_executions`");
    expect(migration).toContain("UNIQUE(`recordKind`,`sourceId`)");
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS `cleaner_portal_job_photos`");
    expect(migration).not.toMatch(/^\s*(?:DROP|TRUNCATE|DELETE|UPDATE|INSERT)\b/im);
  });

  it("keeps customer-affecting ETA and arrival actions explicit and uses photo-library uploads", () => {
    expect(page).toContain("The client will receive the selected arrival time.");
    expect(page).toContain("Tell the client you’ve arrived?");
    expect(page).toContain('accept="image/*"');
    expect(page).not.toContain('capture="environment"');
    expect(isolatedRouter).toContain("sendSms({ to: job.customerPhone");
    expect(isolatedRouter).toContain("cleaner-portal-photos/");
  });
});
