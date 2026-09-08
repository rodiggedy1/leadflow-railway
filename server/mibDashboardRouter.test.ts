import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./mibDashboardRouter.ts", import.meta.url), "utf8");

describe("MIB dashboard router contract", () => {
  it("uses the user-approved public access model for every existing dashboard read", () => {
    expect(source.match(/publicProcedure\s*\.input/g)).toHaveLength(3);
    expect(source).not.toContain("adminAgentProcedure");
    expect(source).toContain("getPublicBookingMetrics: publicProcedure");
  });

  it("keeps the existing Booking-page data contract for aggregate metrics and scheduled rows", () => {
    expect(source).toContain("days: aggregateMibDashboardBookings");
    expect(source).toContain("services:");
    expect(source).toContain("customerName: bookings.customerName");
    expect(source).toContain("assignmentStatus: bookings.assignmentStatus");
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
