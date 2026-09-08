import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./mibDashboardRouter.ts", import.meta.url), "utf8");

describe("MIB dashboard router contract", () => {
  it("protects every dashboard read with the existing admin-agent boundary", () => {
    expect(source.match(/adminAgentProcedure\s*\.input/g)).toHaveLength(2);
    expect(source).toContain("getPublicBookingMetrics: publicProcedure");
  });

  it("exposes only aggregate counts and totals through the same public model as Command Chat metrics", () => {
    expect(source).toContain("days: aggregateMibDashboardBookings");
    expect(source).toContain("services:");
    expect(source).not.toContain("customerPhone: bookings.customerPhone");
    expect(source).not.toContain("address: bookings.address");
  });

  it("uses the same native and unconverted non-lead funnel booking treatment as the Bookings workspace", () => {
    expect(source).toContain("mergeMibDashboardBookings(nativeRows, funnelRows)");
    expect(source).toContain("bookingFunnelRecords.bookingId");
    expect(source).toContain("bookingFunnelRecords.stage");
  });

  it("stays read-only and does not adopt legacy cleaner-job storage", () => {
    for (const prohibited of [".insert(", ".update(", ".delete(", "cleanerJobs", "cleaner_jobs"]) {
      expect(source).not.toContain(prohibited);
    }
  });
});
