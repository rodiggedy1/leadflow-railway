import { and, eq, isNotNull, isNull, or, sql } from "drizzle-orm";
import { bookingAssignments, cleanerProfiles, leadflowJobs, schedulingTeams } from "../drizzle/schema";
import type { SQL } from "drizzle-orm";

export type CleanerPortalTeam = {
  cleanerProfileId: number;
  launch27TeamId: number;
  schedulingTeamId: number | null;
  payPercent: string | null;
};

/**
 * Cleaner login identity remains the stable Launch27 team ID. Native jobs are
 * additionally owned through their active booking assignment, whose team ID
 * is the scheduling_teams primary key.
 */
export async function findCleanerPortalTeam(
  db: any,
  cleanerId: number,
): Promise<CleanerPortalTeam | null> {
  const rows = await db
    .select({
      cleanerProfileId: cleanerProfiles.id,
      launch27TeamId: cleanerProfiles.launch27TeamId,
      schedulingTeamId: schedulingTeams.id,
      payPercent: cleanerProfiles.payPercent,
    })
    .from(cleanerProfiles)
    .leftJoin(schedulingTeams, eq(schedulingTeams.launch27TeamId, cleanerProfiles.launch27TeamId))
    .where(eq(cleanerProfiles.id, cleanerId))
    .limit(1);
  const row = rows[0];
  if (!row || row.launch27TeamId === null || row.launch27TeamId === undefined) return null;
  return {
    cleanerProfileId: row.cleanerProfileId,
    launch27TeamId: row.launch27TeamId,
    schedulingTeamId: row.schedulingTeamId ?? null,
    payPercent: row.payPercent,
  };
}

/**
 * Ownership is deliberately additive:
 * - existing Launch27-imported jobs retain the exact Launch27-team predicate;
 * - native jobs require an active booking assignment to this scheduling team.
 * No job row, assignment row, or payroll value is changed by this resolver.
 */
export function cleanerPortalJobOwnership(team: CleanerPortalTeam): SQL<unknown> {
  const importedOwnership = and(
    isNull(leadflowJobs.bookingId),
    eq(leadflowJobs.teamId, team.launch27TeamId),
  );
  if (team.schedulingTeamId === null) return importedOwnership!;

  const nativeOwnership = and(
    isNotNull(leadflowJobs.bookingId),
    sql`EXISTS (
      SELECT 1
      FROM ${bookingAssignments} AS active_assignment
      WHERE active_assignment.bookingId = ${leadflowJobs.bookingId}
        AND active_assignment.teamId = ${team.schedulingTeamId}
        AND active_assignment.status = 'assigned'
    )`,
  );
  return or(importedOwnership, nativeOwnership)!;
}
