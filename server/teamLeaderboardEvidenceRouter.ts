import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { teamEvidenceWeekInputSchema } from "../shared/teamLeaderboardEvidence";
import { adminAgentProcedure, router } from "./_core/trpc";
import { createTeamEvidenceService, type TeamEvidenceService } from "./teamLeaderboardEvidenceService";

/** Admin-only evidence. This is deliberately NOT the cleaner/team publication
 * API; raw customer text must never be returned to team-session callers. */
export function createTeamLeaderboardEvidenceRouter(options: {
  resolveService?: () => TeamEvidenceService;
} = {}) {
  let current: TeamEvidenceService | undefined;
  const service = () => options.resolveService?.() ?? (current ??= createTeamEvidenceService());
  const safeRead = async <T>(run: () => Promise<T>): Promise<T> => {
    try { return await run(); }
    catch { throw new TRPCError({ code: "PRECONDITION_FAILED", message: "TEAM_EVIDENCE_READ_UNAVAILABLE" }); }
  };
  return router({
    readWeek: adminAgentProcedure.input(teamEvidenceWeekInputSchema).query(({ input }) => safeRead(() => service().readWeek(input))),
    analyzeWeek: adminAgentProcedure.input(teamEvidenceWeekInputSchema.extend({
      mode: z.literal("unpublished_candidates"),
    }).strict()).mutation(({ input }) => safeRead(() => service().analyzeWeek({ weekStart: input.weekStart }))),
  });
}
export const teamLeaderboardEvidenceRouter = createTeamLeaderboardEvidenceRouter();
