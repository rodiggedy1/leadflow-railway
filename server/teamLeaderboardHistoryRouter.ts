import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { cleanerProfiles } from "../drizzle/schema";
import { agentPageProcedure, cleanerProcedure, router } from "./_core/trpc";
import { getDb } from "./db";
import { findCleanerPortalTeam } from "./cleanerPortalOwnership";
import { restrictTeamLeaderboardAdminPublication, restrictTeamLeaderboardPublication } from "./teamLeaderboardPublication";
import { readTeamLeaderboardAdminAccounts } from "./teamLeaderboardAdminAccounts";
import { historySelectionSchema, reviewPublishSchema, reviewStartSchema } from "../shared/teamLeaderboardHistory";
import { teamEvidenceWeekInputSchema } from "../shared/teamLeaderboardEvidence";
import { teamLeaderboardHistoryService } from "./teamLeaderboardHistoryRuntime";
import type { TeamLeaderboardHistoryService } from "./teamLeaderboardHistoryService";
import type { TrpcContext } from "./_core/context";

const admin = agentPageProcedure("quality").use(async ({ ctx, next }) => {
  if (!ctx.agent.isAdmin) throw new TRPCError({ code: "FORBIDDEN", message: "Admin access required" });
  return next({ ctx });
});
async function cleanerIdentity(ctx: TrpcContext & { cleaner: { cleanerId: number } }) {
  const id = ctx.cleaner.cleanerId;
  if (!Number.isSafeInteger(id) || id <= 0) throw new TRPCError({ code: "UNAUTHORIZED", message: "Cleaner login required" });
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Team results are temporarily unavailable." });
  const profiles = await db.select({ id: cleanerProfiles.id, isActive: cleanerProfiles.isActive }).from(cleanerProfiles)
    .where(and(eq(cleanerProfiles.id, id), eq(cleanerProfiles.isActive, 1))).limit(1);
  if (profiles[0]?.id !== id || profiles[0]?.isActive !== 1) throw new TRPCError({ code: "UNAUTHORIZED", message: "Active cleaner login required" });
  const team = await findCleanerPortalTeam(db, id);
  if (!team || team.cleanerProfileId !== id || !Number.isSafeInteger(team.schedulingTeamId) || (team.schedulingTeamId ?? 0) <= 0)
    throw new TRPCError({ code: "FORBIDDEN", message: "Your cleaner account has no mapped scheduling team." });
  return { team, id };
}
const safe = async <T>(fn: () => Promise<T>): Promise<T> => {
  try { return await fn(); }
  catch (error) {
    if (error instanceof TRPCError) throw error;
    const message = error instanceof Error ? error.message : "";
    if (/CONFLICT|STALE|CHANGED/.test(message)) throw new TRPCError({ code: "CONFLICT", message: "Published results changed. Reload the draft before publishing." });
    if (message === "WEEK_NOT_PUBLISHED") throw new TRPCError({ code: "NOT_FOUND", message: "No published results for this week. Choose a saved week or run a review." });
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "The weekly review could not be completed. Previous published results are unchanged." });
  }
};
export function createTeamLeaderboardHistoryRouter(options: { resolveService?: () => TeamLeaderboardHistoryService } = {}) {
  const service = () => options.resolveService?.() ?? teamLeaderboardHistoryService();
  return router({
    weeksForAdmin: admin.query(({ ctx }) => safe(async () => ({ agentId: ctx.agent.agentId, weeks: await service().weeks() }))),
    forAdmin: admin.input(historySelectionSchema).query(({ ctx, input }) => safe(async () => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Team results are temporarily unavailable." });
      const snapshot = await service().published(input);
      const result = restrictTeamLeaderboardAdminPublication(snapshot);
      const teamAccounts = await readTeamLeaderboardAdminAccounts(db, result.publication.teams.map(team => team.id));
      return { ...result, agentId: ctx.agent.agentId, teamAccounts, selectionKey: input.summary ? "summary" : snapshot.period?.weekStart ?? "latest" };
    })),
    weeksForMe: cleanerProcedure.query(({ ctx }) => safe(async () => {
      const identity = await cleanerIdentity(ctx);
      return { cleanerProfileId: identity.id, weeks: await service().weeks() };
    })),
    forMe: cleanerProcedure.input(historySelectionSchema).query(({ ctx, input }) => safe(async () => {
      const identity = await cleanerIdentity(ctx);
      const snapshot = await service().published(input);
      return { ...restrictTeamLeaderboardPublication(snapshot, identity.team, identity.id), selectionKey: input.summary ? "summary" : snapshot.period?.weekStart ?? "latest" };
    })),
    startReview: admin.input(reviewStartSchema).mutation(({ ctx, input }) => safe(async () => ({ agentId: ctx.agent.agentId, ...await service().start(ctx.agent.agentId, input) }))),
    reviewRuns: admin.input(teamEvidenceWeekInputSchema).query(({ ctx, input }) => safe(async () => ({ agentId: ctx.agent.agentId, runs: await service().runs(input.weekStart) }))),
    reviewDraft: admin.input(z.object({ reviewId: z.string().uuid() }).strict()).query(({ ctx, input }) => safe(async () => ({ agentId: ctx.agent.agentId, ...await service().draft(input.reviewId) }))),
    publishReview: admin.input(reviewPublishSchema).mutation(({ ctx, input }) => safe(async () => ({ agentId: ctx.agent.agentId, ...await service().publish(ctx.agent.agentId, input) }))),
  });
}
export const teamLeaderboardHistoryRouter = createTeamLeaderboardHistoryRouter();
