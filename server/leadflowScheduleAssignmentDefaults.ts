import { and, desc, eq, inArray } from "drizzle-orm";
import { bookingAssignments } from "../drizzle/schema";
import type { getDb } from "./db";

export type BookingTeamSnapshot = {
  teamId: number | null;
  bookingId?: number | null;
};

export type SchedulingTeamForBookingDefault = {
  id: number;
  name: string;
  launch27TeamId: number | null;
  isActive: number;
  isArchived: number;
};

/** Same active/latest ordering as the Bookings CRM, scoped to exact native booking IDs. */
export async function readBookingAssignmentsForSchedule(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  bookingIds: number[],
): Promise<Map<number, BookingTeamSnapshot>> {
  if (!bookingIds.length) return new Map();
  const rows = await db.select({
    bookingId: bookingAssignments.bookingId,
    teamId: bookingAssignments.teamId,
  }).from(bookingAssignments).where(and(
    inArray(bookingAssignments.bookingId, bookingIds),
    eq(bookingAssignments.status, "assigned"),
  )).orderBy(desc(bookingAssignments.assignedAt), desc(bookingAssignments.id));
  const assignments = new Map<number, BookingTeamSnapshot>();
  for (const row of rows) {
    if (!assignments.has(row.bookingId)) assignments.set(row.bookingId, { teamId: row.teamId });
  }
  return assignments;
}

/**
 * Native jobs use the linked booking's active assignment and local Schedule team
 * ID. Imported jobs retain their Launch27 snapshot mapping. Both are display
 * defaults only; existing day-specific Schedule assignments take precedence.
 */
export function bookingTeamDefault<T extends SchedulingTeamForBookingDefault>(
  booking: BookingTeamSnapshot,
  teams: T[],
  activeAssignment?: BookingTeamSnapshot,
): T | null {
  if (booking.bookingId != null) {
    if (activeAssignment?.teamId == null) return null;
    const matches = teams.filter(team => team.id === activeAssignment.teamId);
    return matches.length === 1 ? matches[0] : null;
  }
  if (booking.teamId == null) return null;
  const matches = teams.filter((team) => (
    team.launch27TeamId === booking.teamId
    && team.isActive === 1
    && team.isArchived !== 1
  ));
  return matches.length === 1 ? matches[0] : null;
}
