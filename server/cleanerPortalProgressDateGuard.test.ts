import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { canUpdatePortalProgress, currentEasternDate } from "./cleanerPortalProgressRouter";
import { cleanerRouter } from "./cleanerRouter";

const root = path.resolve(import.meta.dirname, "..");
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), "utf8");

describe("Cleaner Portal scheduled-date notification guard", () => {
  it("allows portal progress only for the scheduled Eastern service date", () => {
    const middayEastern = new Date("2026-09-18T16:00:00.000Z");
    expect(currentEasternDate(middayEastern)).toBe("2026-09-18");
    expect(canUpdatePortalProgress("2026-09-18", middayEastern)).toBe(true);
    expect(canUpdatePortalProgress("2026-09-19", middayEastern)).toBe(false);
    expect(canUpdatePortalProgress("2026-09-17", middayEastern)).toBe(false);
  });

  it("enforces team ownership, active booking state, and scheduled-date eligibility before any progress save or notification", () => {
    const progressRouter = read("server/cleanerPortalProgressRouter.ts");
    const ownershipCheck = progressRouter.slice(progressRouter.indexOf("async function ownedImportedJob"), progressRouter.indexOf("async function saveProgress"));
    expect(ownershipCheck).toContain("eq(leadflowJobs.teamId, cleaner.teamId)");
    expect(ownershipCheck).toContain('ne(leadflowJobs.bookingStatus, "cancelled")');
    expect(ownershipCheck).toContain("canUpdatePortalProgress(job.jobDate)");
    expect(ownershipCheck).toContain("Job progress can only be updated on the scheduled service date.");
  });

  it("rejects the retired status procedure before tRPC can dispatch its customer-notification handler", () => {
    const block = read("server/retiredStatusProcedureBlock.ts");
    expect(block).toContain("procedures.updateJobStatus = publicProcedure.mutation");
    expect(block).toContain("This retired job-status endpoint is unavailable.");
    expect(block).toContain("installRetiredStatusProcedureBlock();");
  });

  it("rejects a retired status request before it can read or write a job", async () => {
    const caller = (cleanerRouter as any).createCaller({});
    await expect(caller.updateJobStatus({ cleanerJobId: 1, status: "on_the_way" })).rejects.toThrow("This retired job-status endpoint is unavailable.");
  });
});
