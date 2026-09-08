import { describe, expect, it } from "vitest";
import {
  aggregateMibDashboardBookings,
  bookingMetricSummary,
  bookingsForMibDashboardDate,
  mergeMibDashboardBookings,
  percentChange,
  shiftMibDashboardDate,
} from "../shared/mibDashboard";

describe("MIB dashboard booking data", () => {
  const native = [{
    id: 1, customerName: "Native Customer", requestedLocalDate: "2026-09-08", requestedLocalTime: "09:00", serviceName: "Standard Cleaning", assignmentStatus: "assigned", paymentStatus: "card_on_file", firstCleaningTotalCents: 22000, status: "confirmed",
  }];
  const funnel = [
    { id: 2, bookingId: null, customerName: "Funnel Booking", requestedLocalDate: "2026-09-08", requestedLocalTime: "11:00", serviceName: "Deep Cleaning", paymentLast4: "4242", firstCleaningTotalCents: 33000, stage: "booked" },
    { id: 3, bookingId: null, customerName: "In-progress Lead", requestedLocalDate: "2026-09-08", requestedLocalTime: null, serviceName: null, paymentLast4: null, firstCleaningTotalCents: null, stage: "lead" },
    { id: 4, bookingId: 1, customerName: "Converted Funnel", requestedLocalDate: "2026-09-08", requestedLocalTime: "12:00", serviceName: "Standard Cleaning", paymentLast4: "4242", firstCleaningTotalCents: 22000, stage: "booked" },
  ];

  it("uses the same native-plus-unconverted-nonlead funnel treatment as Bookings", () => {
    const rows = mergeMibDashboardBookings(native, funnel);
    expect(rows.map((row) => row.key)).toEqual(["funnel:2", "booking:1"]);
    expect(rows[0]).toMatchObject({ assignmentStatus: "unassigned", paymentStatus: "card_on_file" });
  });

  it("summarizes only the selected date without dropping either booking source", () => {
    const rows = bookingsForMibDashboardDate(mergeMibDashboardBookings(native, funnel), "2026-09-08");
    expect(bookingMetricSummary(rows)).toEqual({ totalBookings: 2, revenueCents: 55000, assignedBookings: 1, cardsOnFile: 2 });
  });

  it("returns aggregate-only totals for every date in the requested dashboard range", () => {
    const days = aggregateMibDashboardBookings(mergeMibDashboardBookings(native, funnel), "2026-09-07", "2026-09-08");
    expect(days).toEqual([
      { date: "2026-09-07", totalBookings: 0, revenueCents: 0, assignedBookings: 0, cardsOnFile: 0 },
      { date: "2026-09-08", totalBookings: 2, revenueCents: 55000, assignedBookings: 1, cardsOnFile: 2 },
    ]);
  });

  it("uses calendar date arithmetic and honest no-baseline comparisons", () => {
    expect(shiftMibDashboardDate("2026-03-01", -1)).toBe("2026-02-28");
    expect(percentChange(12, 10)).toBe(20);
    expect(percentChange(4, 0)).toBeNull();
  });
});
