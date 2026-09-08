import { describe, expect, it } from "vitest";
import {
  bookingMetricSummary,
  bookingsForMibDashboardDate,
  mapLeadflowJobsForMibDashboard,
  percentChange,
  shiftMibDashboardDate,
} from "../shared/mibDashboard";

describe("MIB dashboard jobs data", () => {
  const jobs = [
    { id: 1, customerName: "New Customer", customerPhone: "+1 (202) 555-0101", jobDate: "2026-09-08", serviceDateTime: "2026-09-08T09:00:00", serviceName: "Standard Cleaning", bookingStatus: "assigned", teamName: "Team Maya", jobTotalCents: 22000, hasStripeCard: 1, customerRating: 5 },
    { id: 2, customerName: "Returning Customer", customerPhone: "+12025550102", jobDate: "2026-09-08", serviceDateTime: "2026-09-08T11:00:00", serviceName: "Deep Cleaning", bookingStatus: "assigned", teamName: null, jobTotalCents: 33000, hasStripeCard: 0, customerRating: null },
  ];

  it("normalizes only LeadFlow-owned jobs into dashboard rows", () => {
    const rows = mapLeadflowJobsForMibDashboard(jobs, { "2025550101": "2026-09-08", "2025550102": "2026-07-01" });
    expect(rows.map((row) => row.key)).toEqual(["job:1", "job:2"]);
    expect(rows[0]).toMatchObject({ assignmentStatus: "assigned", paymentStatus: "card_on_file", isNewCustomer: true });
    expect(rows[1]).toMatchObject({ assignmentStatus: "unassigned", paymentStatus: "not_started", isNewCustomer: false });
  });

  it("summarizes the selected jobs date with real payment, customer, and rating fields", () => {
    const rows = bookingsForMibDashboardDate(mapLeadflowJobsForMibDashboard(jobs, { "2025550101": "2026-09-08", "2025550102": "2026-07-01" }), "2026-09-08");
    expect(bookingMetricSummary(rows)).toEqual({ totalBookings: 2, revenueCents: 55000, assignedBookings: 1, cardsOnFile: 1, newCustomers: 1, averageRating: 5 });
  });

  it("uses calendar date arithmetic and honest no-baseline comparisons", () => {
    expect(shiftMibDashboardDate("2026-03-01", -1)).toBe("2026-02-28");
    expect(percentChange(12, 10)).toBe(20);
    expect(percentChange(4, 0)).toBeNull();
  });
});
