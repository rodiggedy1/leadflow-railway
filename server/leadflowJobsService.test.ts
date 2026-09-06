import { describe, expect, it } from "vitest";
import {
  getConsecutiveBusinessDates,
  isActiveLaunch27Booking,
  launch27BookingToLeadflowJob,
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

  it("maps one Launch27 booking into an isolated job record with its stable booking ID", () => {
    const mapped = launch27BookingToLeadflowJob(booking(), "2026-09-06");
    expect(mapped).toMatchObject({
      origin: "launch27_import",
      launch27BookingId: 42,
      bookingSeriesId: null,
      jobDate: "2026-09-06",
      teamName: "Team Casey",
      jobTotalCents: 14500,
    });
  });
});
