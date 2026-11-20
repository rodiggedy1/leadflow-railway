import { inArray } from "drizzle-orm";
import { cleanerProfiles, schedulingTeams } from "../drizzle/schema";
import { findCleanerPortalTeam } from "./cleanerPortalOwnership";
import type { getDb } from "./db";

export type TeamLeaderboardAdminAccount = { cleanerProfileId: number | null; reason?: string };
type Database = NonNullable<Awaited<ReturnType<typeof getDb>>>;
const positiveId = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value > 0;
const unavailable = (reason: string): TeamLeaderboardAdminAccount => ({ cleanerProfileId: null, reason });

/** Resolve only snapshot teams; related reverse links must include inactive duplicates. */
export async function readTeamLeaderboardAdminAccounts(
  db: Database,
  snapshotTeamIds: readonly string[],
): Promise<Record<string, TeamLeaderboardAdminAccount>> {
  const teamAccounts: Record<string, TeamLeaderboardAdminAccount> = {};
  const ids = Array.from(new Set(snapshotTeamIds)).map(Number).filter(positiveId);
  if (!ids.length) {
    for (const id of snapshotTeamIds) teamAccounts[id] = unavailable("unmapped_team");
    return teamAccounts;
  }
  const teams = await db.select({
    id: schedulingTeams.id, launch27TeamId: schedulingTeams.launch27TeamId,
    isActive: schedulingTeams.isActive, isArchived: schedulingTeams.isArchived,
  }).from(schedulingTeams).where(inArray(schedulingTeams.id, ids));
  const launch27TeamIds = Array.from(new Set(teams.map(team => team.launch27TeamId).filter(positiveId)));
  // Do not filter activity here: an inactive duplicate still makes identity ambiguous.
  const profiles = launch27TeamIds.length ? await db.select({
    id: cleanerProfiles.id, launch27TeamId: cleanerProfiles.launch27TeamId, isActive: cleanerProfiles.isActive,
  }).from(cleanerProfiles).where(inArray(cleanerProfiles.launch27TeamId, launch27TeamIds)) : [];
  const reverseTeams = launch27TeamIds.length ? await db.select({
    id: schedulingTeams.id, launch27TeamId: schedulingTeams.launch27TeamId,
  }).from(schedulingTeams).where(inArray(schedulingTeams.launch27TeamId, launch27TeamIds)) : [];

  for (const id of snapshotTeamIds) {
    const matchingTeams = teams.filter(team => String(team.id) === id);
    if (matchingTeams.length !== 1) {
      teamAccounts[id] = unavailable(matchingTeams.length ? "ambiguous_team_mapping" : "missing_scheduling_team");
      continue;
    }
    const team = matchingTeams[0];
    if (team.isActive !== 1 || team.isArchived !== 0) {
      teamAccounts[id] = unavailable("inactive_scheduling_team");
      continue;
    }
    if (!positiveId(team.launch27TeamId)) {
      teamAccounts[id] = unavailable("unmapped_team");
      continue;
    }
    const linkedTeams = reverseTeams.filter(row => row.launch27TeamId === team.launch27TeamId);
    if (linkedTeams.length !== 1 || linkedTeams[0].id !== team.id) {
      teamAccounts[id] = unavailable("ambiguous_team_mapping");
      continue;
    }
    const accounts = profiles.filter(profile => profile.launch27TeamId === team.launch27TeamId);
    if (accounts.length !== 1) {
      teamAccounts[id] = unavailable(accounts.length ? "ambiguous_cleaner_accounts" : "missing_cleaner_account");
      continue;
    }
    const account = accounts[0];
    if (account.isActive !== 1) {
      teamAccounts[id] = unavailable("inactive_cleaner_account");
      continue;
    }
    if (!positiveId(account.id)) {
      teamAccounts[id] = unavailable("unmapped_team");
      continue;
    }
    const resolved = await findCleanerPortalTeam(db, account.id);
    if (!resolved || resolved.cleanerProfileId !== account.id ||
      resolved.launch27TeamId !== team.launch27TeamId || resolved.schedulingTeamId !== team.id) {
      teamAccounts[id] = unavailable("unavailable_mapping");
      continue;
    }
    teamAccounts[id] = { cleanerProfileId: account.id };
  }
  return teamAccounts;
}
