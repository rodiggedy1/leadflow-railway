import type { Launch27Booking, Launch27Team } from "./launch27";

export const PAYROLL_RECOVERY_WEEK_START = "2026-08-16";
export const PAYROLL_RECOVERY_DATES = [
  "2026-08-16",
  "2026-08-17",
  "2026-08-18",
  "2026-08-19",
  "2026-08-20",
  "2026-08-21",
  "2026-08-22",
] as const;

export type RecoveryProfile = {
  id: number;
  name: string;
  payPercent: string | null;
  launch27TeamId: number | null;
};

export type ExistingRecoveryJob = {
  bookingId: number | null;
  cleanerProfileId: number;
};

export type HistoricalPayrollRecoveryPlan = {
  dates: readonly string[];
  sourceBookingCount: number;
  activeBookingCount: number;
  existingJobCount: number;
  insertableJobCount: number;
  skippedInactiveBookingCount: number;
  skippedUnassignedBookingCount: number;
  blockedMissingProfileCount: number;
  blockedAmbiguousProfileCount: number;
  blockedProfileConflictCount: number;
  perDate: Array<{
    date: string;
    sourceBookings: number;
    insertableJobs: number;
    existingJobs: number;
    blockedJobs: number;
  }>;
};

type ProfileResolution =
  | { kind: "resolved"; profile: RecoveryProfile }
  | { kind: "missing" | "ambiguous" | "conflict" };

function normalizeName(value: string): string {
  return value.trim().toLowerCase();
}

function isPayrollActiveBooking(booking: Launch27Booking): boolean {
  return !["cancelled", "rescheduled"].includes(booking.bookingStatus.trim().toLowerCase());
}

function resolveProfile(team: Launch27Team, profiles: RecoveryProfile[]): ProfileResolution {
  if (team.id > 0) {
    const byLaunch27Id = profiles.find((profile) => profile.launch27TeamId === team.id);
    if (byLaunch27Id) return { kind: "resolved", profile: byLaunch27Id };
  }

  const nameMatches = profiles.filter((profile) => normalizeName(profile.name) === normalizeName(team.title));
  if (nameMatches.length === 0) return { kind: "missing" };
  if (nameMatches.length > 1) return { kind: "ambiguous" };

  const profile = nameMatches[0]!;
  if (team.id > 0 && profile.launch27TeamId !== null && profile.launch27TeamId !== team.id) {
    return { kind: "conflict" };
  }
  return { kind: "resolved", profile };
}

/**
 * Creates an auditable, read-only plan for the single approved historical
 * payroll week. It deliberately produces no database mutation instructions.
 */
export function buildHistoricalPayrollRecoveryPlan(params: {
  bookingsByDate: Map<string, Launch27Booking[]>;
  profiles: RecoveryProfile[];
  existingJobs: ExistingRecoveryJob[];
}): HistoricalPayrollRecoveryPlan {
  const existingKeys = new Set(
    params.existingJobs
      .filter((job) => job.bookingId !== null)
      .map((job) => `${job.bookingId}:${job.cleanerProfileId}`),
  );

  let sourceBookingCount = 0;
  let activeBookingCount = 0;
  let existingJobCount = 0;
  let insertableJobCount = 0;
  let skippedInactiveBookingCount = 0;
  let skippedUnassignedBookingCount = 0;
  let blockedMissingProfileCount = 0;
  let blockedAmbiguousProfileCount = 0;
  let blockedProfileConflictCount = 0;

  const perDate = PAYROLL_RECOVERY_DATES.map((date) => {
    const bookings = params.bookingsByDate.get(date) ?? [];
    sourceBookingCount += bookings.length;
    let dateInsertable = 0;
    let dateExisting = 0;
    let dateBlocked = 0;

    for (const booking of bookings) {
      if (!isPayrollActiveBooking(booking)) {
        skippedInactiveBookingCount++;
        continue;
      }
      activeBookingCount++;

      if (booking.teams.length === 0) {
        skippedUnassignedBookingCount++;
        continue;
      }

      for (const team of booking.teams) {
        if (team.id === 0 || normalizeName(team.title) === "unassigned") {
          skippedUnassignedBookingCount++;
          continue;
        }

        const profileResult = resolveProfile(team, params.profiles);
        if (profileResult.kind === "missing") {
          blockedMissingProfileCount++;
          dateBlocked++;
          continue;
        }
        if (profileResult.kind === "ambiguous") {
          blockedAmbiguousProfileCount++;
          dateBlocked++;
          continue;
        }
        if (profileResult.kind === "conflict") {
          blockedProfileConflictCount++;
          dateBlocked++;
          continue;
        }

        const jobKey = `${booking.id}:${profileResult.profile.id}`;
        if (existingKeys.has(jobKey)) {
          existingJobCount++;
          dateExisting++;
          continue;
        }
        insertableJobCount++;
        dateInsertable++;
      }
    }

    return {
      date,
      sourceBookings: bookings.length,
      insertableJobs: dateInsertable,
      existingJobs: dateExisting,
      blockedJobs: dateBlocked,
    };
  });

  return {
    dates: PAYROLL_RECOVERY_DATES,
    sourceBookingCount,
    activeBookingCount,
    existingJobCount,
    insertableJobCount,
    skippedInactiveBookingCount,
    skippedUnassignedBookingCount,
    blockedMissingProfileCount,
    blockedAmbiguousProfileCount,
    blockedProfileConflictCount,
    perDate,
  };
}
