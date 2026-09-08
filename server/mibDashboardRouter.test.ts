import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./mibDashboardRouter.ts", import.meta.url), "utf8");

describe("MIB dashboard router contract", () => {
  it("protects every dashboard read with the existing admin-agent boundary", () => {
    expect(source.match(/adminAgentProcedure\s*\.input/g)).toHaveLength(2);
    expect(source).not.toContain("publicProcedure");
  });

  it("uses the user-designated LeadFlow jobs table for dashboard booking data", () => {
    expect(source).toContain("leadflowJobs");
    expect(source).toContain("mapLeadflowJobsForMibDashboard(jobRows, firstJobDateByPhone)");
    expect(source).toContain("leadflowJobs.customerRating");
    expect(source).toContain("leadflowJobs.hasStripeCard");
  });

  it("stays read-only and does not adopt legacy cleaner-job storage", () => {
    for (const prohibited of [".insert(", ".update(", ".delete(", "cleanerJobs", "cleaner_jobs", "from(bookings)", "bookingFunnelRecords"]) {
      expect(source).not.toContain(prohibited);
    }
  });
});
