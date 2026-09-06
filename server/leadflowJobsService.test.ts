import { describe, expect, it } from "vitest";
import {
  getConsecutiveBusinessDates,
  isActiveLaunch27Booking,
  launch27BookingToLeadflowJob,
  nextRecurringBusinessDate,
  shouldMarkImportedLaunch27JobMissing,
} from "./leadflowJobsService";

const booking = (overrides: Partial<Parameters<typeof isActiveLaunch27Booking>[0]> = {}) => ({
  id: 42,
  phone: "+12025550100",
  firstName: "Casey",
  lastName: "Smith",
  fullName: "Casey Smith",
  email: "casey@example.com",
  serviceDate: "2026-09-06T15:30:00Z",
  frequency: "Weekly",
  address: "100 Main St",
  city: "Washington",
  state: "DC",
  zip: "20001",
  totalRevenue: 145,
  baseRevenue: 145,
  bookingStatus: "assigned",
  completed: false,
  teams: [{ id: 9, title: "Team Casey", share: 55, bgColor: "#000000" }],
  serviceNames: ["2 bedroom"],
  bedrooms: 2,
  bathrooms: 1,
  extras: ["clean_inside_oven"],
  customerNotes: "Front desk will let you in",
  staffNotes: "",
  requestedTeam: null,
  hasStripeCard: false,
  stripeCustomerId: null,
  paymentBrand: null,
  paymentLast4: null,
  chargesOnHoldCents: 0,
  chargesOutstandingCents: 0,
  ...overrides,
});

describe("isolated LeadFlow jobs import", () => {
  it("builds exactly 30 consecutive calendar dates including the start date", () => {
    const dates = getConsecutiveBusinessDates("2026-09-06");
    expect(dates).toHaveLength(30);
    expect(dates[0]).toBe("2026-09-06");
    expect(dates[29]).toBe("2026-10-05");
  });

  it("imports assigned active bookings and excludes terminal or rescheduled ones", () => {
    expect(isActiveLaunch27Booking(booking())).toBe(true);
    expect(isActiveLaunch27Booking(booking({ bookingStatus: "cancelled" }))).toBe(false);
    expect(isActiveLaunch27Booking(booking({ bookingStatus: "rescheduled" }))).toBe(false);
    expect(isActiveLaunch27Booking(booking({ bookingStatus: "completed", completed: false }))).toBe(false);
    expect(isActiveLaunch27Booking(booking({ completed: true }))).toBe(false);
  });

  it("maps Launch27 team assignments and card-on-file details into an isolated job record", () => {
    const mapped = launch27BookingToLeadflowJob(booking({
      teams: [
        { id: 9, title: "Team Casey", share: 55, bgColor: "#000000" },
        { id: 10, title: "Team Jordan", share: 45, bgColor: "#111111" },
      ],
      hasStripeCard: true,
      paymentBrand: "Visa",
      paymentLast4: "4242",
    }), "2026-09-06");
    expect(mapped).toMatchObject({
      origin: "launch27_import",
      launch27BookingId: 42,
      bookingSeriesId: null,
      jobDate: "2026-09-06",
      teamName: "Team Casey, Team Jordan",
      jobTotalCents: 14500,
      hasStripeCard: 1,
      paymentBrand: "Visa",
      paymentLast4: "4242",
      missingFromLaunch27At: null,
    });
  });

  it("marks only an absent nonterminal imported Launch27 ID as source-missing", () => {
    const returned = new Set([1002]);
    expect(shouldMarkImportedLaunch27JobMissing({ launch27BookingId: 1001, bookingStatus: "assigned" }, returned)).toBe(true);
    expect(shouldMarkImportedLaunch27JobMissing({ launch27BookingId: 1002, bookingStatus: "completed" }, returned)).toBe(false);
    expect(shouldMarkImportedLaunch27JobMissing({ launch27BookingId: 1003, bookingStatus: "cancelled" }, returned)).toBe(false);
    expect(shouldMarkImportedLaunch27JobMissing({ launch27BookingId: 1004, bookingStatus: "canceled" }, returned)).toBe(false);
    expect(shouldMarkImportedLaunch27JobMissing({ launch27BookingId: 1005, bookingStatus: "rescheduled" }, returned)).toBe(false);
    expect(shouldMarkImportedLaunch27JobMissing({ launch27BookingId: null, bookingStatus: "assigned" }, returned)).toBe(false);
  });

  it("uses the displayed recurring interval and never creates a next date for one-time work", () => {
    expect(nextRecurringBusinessDate("2026-09-06", "Weekly (20%OFF)")).toBe("2026-09-13");
    expect(nextRecurringBusinessDate("2026-09-06", "Bi-weekly (15%OFF)")).toBe("2026-09-20");
    expect(nextRecurringBusinessDate("2026-09-06", "Tri-weekly (10%OFF)")).toBe("2026-09-27");
    expect(nextRecurringBusinessDate("2026-09-06", "Monthly (10%OFF)")).toBe("2026-10-06");
    expect(nextRecurringBusinessDate("2026-09-06", "One time")).toBeNull();
  });
});
