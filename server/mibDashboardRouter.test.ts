import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./mibDashboardRouter.ts", import.meta.url), "utf8");

describe("MIB dashboard router contract", () => {
  it("uses the user-approved public access model for every existing dashboard read", () => {
    expect(source.match(/publicProcedure\s*\.input/g)).toHaveLength(4);
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

  it("uses a minimal read-only Field Management schedule projection without its side effects", () => {
    for (const prohibited of [".insert(", ".update(", ".delete(", "geocodeWithCache", "invokeLLM", "confirmationCalls", "completedJobs"]) {
      expect(source).not.toContain(prohibited);
    }
    expect(source).toContain("getFieldSchedule: publicProcedure");
    expect(source).toContain("eq(cleanerJobs.jobDate, input.date)");
    expect(source).toContain('ne(cleanerJobs.bookingStatus, "cancelled")');
    expect(source).toContain('ne(cleanerJobs.bookingStatus, "rescheduled")');
    expect(source).toContain("scheduleAssignments");
    expect(source).toContain("schedulingTeams");
  });
});
