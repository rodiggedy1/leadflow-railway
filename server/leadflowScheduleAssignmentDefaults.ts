export type BookingTeamSnapshot = {
  teamId: number | null;
};

export type SchedulingTeamForBookingDefault = {
  id: number;
  name: string;
  launch27TeamId: number | null;
  isActive: number;
  isArchived: number;
};

/**
 * Returns the one active Schedule team that represents the booking's imported
 * Launch27 team snapshot. This is a display default only: no schedule row is
 * written until an operator manually assigns or optimizes the job.
 */
export function bookingTeamDefault<T extends SchedulingTeamForBookingDefault>(
  booking: BookingTeamSnapshot,
  teams: T[],
): T | null {
  if (booking.teamId == null) return null;
  const matches = teams.filter((team) => (
    team.launch27TeamId === booking.teamId
    && team.isActive === 1
    && team.isArchived !== 1
  ));
  return matches.length === 1 ? matches[0] : null;
}
