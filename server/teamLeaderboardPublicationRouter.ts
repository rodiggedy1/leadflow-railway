import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { cleanerProfiles } from "../drizzle/schema";
import { agentPageProcedure, cleanerProcedure, router } from "./_core/trpc";
import { getDb } from "./db";
import { findCleanerPortalTeam } from "./cleanerPortalOwnership";
import { readTeamLeaderboardAdminPublication, readTeamLeaderboardPublication } from "./teamLeaderboardPublication";
import { readTeamLeaderboardAdminAccounts } from "./teamLeaderboardAdminAccounts";

export const teamLeaderboardPublicationRouter = router({
  forMe: cleanerProcedure.query(async ({ ctx }) => {
    const cleanerProfileId = ctx.cleaner.cleanerId;
    if (!Number.isSafeInteger(cleanerProfileId) || cleanerProfileId <= 0) {
      throw new TRPCError({ code: "UNAUTHORIZED", message: "Cleaner login required" });
    }
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Team results are temporarily unavailable." });
    const profiles = await db.select({ id: cleanerProfiles.id, isActive: cleanerProfiles.isActive })
      .from(cleanerProfiles)
      .where(and(eq(cleanerProfiles.id, cleanerProfileId), eq(cleanerProfiles.isActive, 1)))
      .limit(1);
    if (profiles[0]?.id !== cleanerProfileId || profiles[0]?.isActive !== 1) {
      throw new TRPCError({ code: "UNAUTHORIZED", message: "Active cleaner login required" });
    }
    const team = await findCleanerPortalTeam(db, cleanerProfileId);
    if (!team || team.cleanerProfileId !== cleanerProfileId ||
      !Number.isSafeInteger(team.schedulingTeamId) || (team.schedulingTeamId ?? 0) <= 0) {
      throw new TRPCError({ code: "FORBIDDEN", message: "Your cleaner account has no mapped scheduling team." });
    }
    return readTeamLeaderboardPublication(team, cleanerProfileId);
  }),
  forAdmin: agentPageProcedure("quality").query(async ({ ctx }) => {
    if (!ctx.agent.isAdmin) {
      throw new TRPCError({ code: "FORBIDDEN", message: "Admin access required" });
    }
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Team results are temporarily unavailable." });
    const result = readTeamLeaderboardAdminPublication();
    const teamAccounts = await readTeamLeaderboardAdminAccounts(db, result.publication.teams.map(team => team.id));
    return { ...result, agentId: ctx.agent.agentId, teamAccounts };
  }),
});
