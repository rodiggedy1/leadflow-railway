import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { buildHistoricalPayrollRecoveryPlan, PAYROLL_RECOVERY_DATES } from "./payrollHistoricalRecovery";
import type { Launch27Booking, Launch27Team } from "./launch27";

const routerSource = fs.readFileSync(path.join(import.meta.dirname, "teamPayRouter.ts"), "utf8");

function team(id: number, title: string): Launch27Team {
  return { id, title, share: 55, bgColor: "#000000" };
}

function booking(id: number, date: string, bookingStatus = "completed", teams: Launch27Team[] = [team(10, "Team Ana")]): Launch27Booking {
  return {
    id, phone: "", firstName: "", lastName: "", fullName: "", email: "", serviceDate: `${date}T12:00:00Z`,
    frequency: "One-time", address: "", city: "", state: "", zip: "", totalRevenue: 100, baseRevenue: 100,
    bookingStatus, completed: bookingStatus === "completed", teams, serviceNames: [], bedrooms: null, bathrooms: null,
    extras: [], customerNotes: "", staffNotes: "", requestedTeam: null, hasStripeCard: false,
    stripeCustomerId: null, paymentBrand: null, paymentLast4: null, chargesOnHoldCents: 0, chargesOutstandingCents: 0,
  };
}

const profiles = [{ id: 7, name: "Team Ana", payPercent: "55", launch27TeamId: 10 }];

describe("buildHistoricalPayrollRecoveryPlan", () => {
  it("permits only missing active, assigned job rows in the fixed approved week", () => {
    const plan = buildHistoricalPayrollRecoveryPlan({
      bookingsByDate: new Map([["2026-08-16", [booking(100, "2026-08-16")]]]),
      profiles,
      existingJobs: [],
    });

    expect(plan.dates).toEqual(PAYROLL_RECOVERY_DATES);
    expect(plan.sourceBookingCount).toBe(1);
    expect(plan.insertableJobCount).toBe(1);
    expect(plan.existingJobCount).toBe(0);
  });

  it("excludes cancelled, rescheduled, and unassigned bookings that payroll would not display", () => {
    const plan = buildHistoricalPayrollRecoveryPlan({
      bookingsByDate: new Map([["2026-08-16", [
        booking(100, "2026-08-16", "cancelled"),
        booking(101, "2026-08-16", "rescheduled"),
        booking(102, "2026-08-16", "completed", []),
      ]]]),
      profiles,
      existingJobs: [],
    });

    expect(plan.insertableJobCount).toBe(0);
    expect(plan.skippedInactiveBookingCount).toBe(2);
    expect(plan.skippedUnassignedBookingCount).toBe(1);
  });

  it("does not plan an insert for an existing booking and cleaner-profile pair", () => {
    const plan = buildHistoricalPayrollRecoveryPlan({
      bookingsByDate: new Map([["2026-08-16", [booking(100, "2026-08-16")]]]),
      profiles,
      existingJobs: [{ bookingId: 100, cleanerProfileId: 7 }],
    });

    expect(plan.insertableJobCount).toBe(0);
    expect(plan.existingJobCount).toBe(1);
  });

  it("blocks missing, ambiguous, and conflicting profile matches rather than altering profiles", () => {
    const plan = buildHistoricalPayrollRecoveryPlan({
      bookingsByDate: new Map([["2026-08-16", [
        booking(100, "2026-08-16", "completed", [team(11, "Team Missing")]),
        booking(101, "2026-08-16", "completed", [team(12, "Team Duplicate")]),
        booking(102, "2026-08-16", "completed", [team(13, "Team Conflict")]),
      ]]]),
      profiles: [
        ...profiles,
        { id: 8, name: "Team Duplicate", payPercent: "55", launch27TeamId: null },
        { id: 9, name: "Team Duplicate", payPercent: "55", launch27TeamId: null },
        { id: 10, name: "Team Conflict", payPercent: "55", launch27TeamId: 99 },
      ],
      existingJobs: [],
    });

    expect(plan.insertableJobCount).toBe(0);
    expect(plan.blockedMissingProfileCount).toBe(1);
    expect(plan.blockedAmbiguousProfileCount).toBe(1);
    expect(plan.blockedProfileConflictCount).toBe(1);
  });
});

describe("previewHistoricalPayrollRecovery contract", () => {
  it("is fixed to the approved week and makes no database writes", () => {
    const procedure = routerSource
      .split("previewHistoricalPayrollRecovery: agentProcedure")[1]!
      .split("setComplaint: agentProcedure")[0]!;

    expect(procedure).toContain('z.literal(PAYROLL_RECOVERY_WEEK_START)');
    expect(procedure).toContain("PAYROLL_RECOVERY_DATES");
    expect(procedure).toContain("getCompletedBookingsForDate(date, { includeAll: true })");
    expect(procedure).not.toContain(".insert(");
    expect(procedure).not.toContain(".update(");
    expect(procedure).not.toContain(".delete(");
    expect(procedure).toContain("writeEnabled: false as const");
  });
});
