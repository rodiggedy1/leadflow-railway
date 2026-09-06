import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), "utf8");

describe("isolated LeadFlow jobs contract", () => {
  it("uses a separate table and never imports through cleaner_jobs", () => {
    const schema = read("drizzle/schema.ts");
    const service = read("server/leadflowJobsService.ts");
    const router = read("server/leadflowJobsRouter.ts");
    expect(schema).toContain('mysqlTable("leadflow_jobs"');
    expect(schema).toContain('uniqueIndex("uq_leadflow_jobs_launch27_booking")');
    expect(service).toContain('getCompletedBookingsForDate(date, { includeAll: true })');
    expect(service).toContain("db.update(leadflowJobs)");
    expect(service).not.toContain("cleanerJobs");
    expect(service).not.toContain(".delete(");
    expect(router).not.toContain("cleanerJobs");
  });

  it("keeps the manual import fixed to 30 individual dates", () => {
    const service = read("server/leadflowJobsService.ts");
    expect(service).toContain("LEADFLOW_JOB_IMPORT_DAYS = 30");
    expect(service).toContain("getConsecutiveBusinessDates(startDate)");
  });

  it("renders the isolated jobs in the existing Bookings workspace", () => {
    const workspace = read("client/src/components/NativeBookingsWorkspace.tsx");
    expect(workspace).toContain("trpc.leadflowJobs.list.useQuery");
    expect(workspace).toContain("leadflow:job:");
    expect(workspace).toContain("Import next 30 days");
  });
});
