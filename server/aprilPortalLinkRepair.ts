import { TRPCError } from "@trpc/server";
import { and, eq, isNull } from "drizzle-orm";
import { cleanerProfiles, schedulingTeams } from "../drizzle/schema";
import type { getDb } from "./db";
import { findCleanerPortalTeam } from "./cleanerPortalOwnership";

const PROFILE_ID = 300002;
const SCHEDULING_TEAM_ID = 13;
const LAUNCH27_TEAM_ID = 41996;

type Database = NonNullable<Awaited<ReturnType<typeof getDb>>>;

function conflict(message: string): never {
  throw new TRPCError({ code: "CONFLICT", message });
}

/** Manually invoked April-only repair. No account creation, merging or job writes. */
export async function repairAprilPortalLink(db: Database) {
  return db.transaction(async tx => {
    const profiles = await tx.select({
      id: cleanerProfiles.id,
      name: cleanerProfiles.name,
      isActive: cleanerProfiles.isActive,
      launch27TeamId: cleanerProfiles.launch27TeamId,
    }).from(cleanerProfiles)
      .where(eq(cleanerProfiles.id, PROFILE_ID))
      .for("update");
    const profile = profiles[0];
    if (profiles.length !== 1 || profile.id !== PROFILE_ID || profile.name !== "April" || profile.isActive !== 1) {
      conflict("April's expected active cleaner account could not be verified. No account was changed.");
    }
    if (profile.launch27TeamId !== null && profile.launch27TeamId !== LAUNCH27_TEAM_ID) {
      conflict("April's account is already linked to a different team. No account was changed.");
    }

    // The portal's existing join must resolve one exact scheduling team, not an
    // arbitrary first match. Include archived/inactive rows in this identity check.
    const teams = await tx.select({
      id: schedulingTeams.id,
      name: schedulingTeams.name,
      isActive: schedulingTeams.isActive,
      isArchived: schedulingTeams.isArchived,
      launch27TeamId: schedulingTeams.launch27TeamId,
    }).from(schedulingTeams)
      .where(eq(schedulingTeams.launch27TeamId, LAUNCH27_TEAM_ID))
      .for("update");
    const team = teams[0];
    if (teams.length !== 1 || team.id !== SCHEDULING_TEAM_ID || team.name !== "April" || team.isActive !== 1 || team.isArchived !== 0 || team.launch27TeamId !== LAUNCH27_TEAM_ID) {
      conflict("April's exact active scheduling team could not be verified. No account was changed.");
    }

    // Never take a link from another account, even an inactive/unconfigured one.
    const owners = await tx.select({ id: cleanerProfiles.id })
      .from(cleanerProfiles)
      .where(eq(cleanerProfiles.launch27TeamId, LAUNCH27_TEAM_ID))
      .for("update");
    if (owners.some(owner => owner.id !== PROFILE_ID)) {
      conflict("Another cleaner account already owns April's team link. No account was changed.");
    }

    const changed = profile.launch27TeamId === null;
    if (changed) {
      const [result] = await tx.update(cleanerProfiles)
        .set({ launch27TeamId: LAUNCH27_TEAM_ID })
        .where(and(
          eq(cleanerProfiles.id, PROFILE_ID),
          eq(cleanerProfiles.name, "April"),
          eq(cleanerProfiles.isActive, 1),
          isNull(cleanerProfiles.launch27TeamId),
        ));
      if (result.affectedRows !== 1) {
        conflict("April's account changed before the link could be saved. No repair was committed.");
      }
    }

    const verified = await findCleanerPortalTeam(tx, PROFILE_ID);
    if (!verified || verified.cleanerProfileId !== PROFILE_ID || verified.launch27TeamId !== LAUNCH27_TEAM_ID || verified.schedulingTeamId !== SCHEDULING_TEAM_ID) {
      conflict("April's saved portal team link could not be independently verified. No repair was committed.");
    }
    return {
      cleanerProfileId: PROFILE_ID,
      schedulingTeamId: SCHEDULING_TEAM_ID,
      launch27TeamId: LAUNCH27_TEAM_ID,
      changed,
    };
  });
}
