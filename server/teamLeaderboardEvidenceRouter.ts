import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { teamEvidenceWeekInputSchema } from "../shared/teamLeaderboardEvidence";
import { adminAgentProcedure, router } from "./_core/trpc";
import { createTeamEvidenceService, type TeamEvidenceService } from "./teamLeaderboardEvidenceService";
import { createTeamLeaderboardBatchService } from "./teamLeaderboardBatch";
import type { TeamBatchManifest, TeamBatchReceipt } from "../shared/teamLeaderboardBatch";
import type { TeamEvidence } from "../shared/teamLeaderboardEvidence";
import type { TeamEvidenceAuditRead } from "./teamLeaderboardEvidenceService";

/** Admin-only evidence. This is deliberately NOT the cleaner/team publication
 * API; raw customer text must never be returned to team-session callers. */
export function createTeamLeaderboardEvidenceRouter(options: {
  resolveService?: () => TeamEvidenceService;
  resolveBatchService?: () => ReturnType<typeof createTeamLeaderboardBatchService>;
} = {}) {
  let current: TeamEvidenceService | undefined;
  const service = () => options.resolveService?.() ?? (current ??= createTeamEvidenceService());
  let currentBatch: ReturnType<typeof createTeamLeaderboardBatchService> | undefined;
  const batch = () => options.resolveBatchService?.() ?? (currentBatch ??= createTeamLeaderboardBatchService({ readWeek: input => service().readWeek(input) }));
  const object = (value: unknown) => !!value && typeof value === "object" && !Array.isArray(value);
  const manifest = z.custom<TeamBatchManifest>(object);
  const receipt = z.custom<TeamBatchReceipt>(object);
  const safeBatch = async <T>(run: () => Promise<T> | T): Promise<T> => {
    try { return await run(); }
    catch { throw new TRPCError({ code: "PRECONDITION_FAILED", message: "TEAM_EVIDENCE_BATCH_NOT_COMPLETED" }); }
  };
  const safeRead = async <T>(run: () => Promise<T>): Promise<T> => {
    try { return await run(); }
    catch { throw new TRPCError({ code: "PRECONDITION_FAILED", message: "TEAM_EVIDENCE_READ_UNAVAILABLE" }); }
  };
  return router({
    readWeek: adminAgentProcedure.input(teamEvidenceWeekInputSchema).query(({ input }) => safeRead(() => service().readWeek(input))),
    analyzeWeek: adminAgentProcedure.input(teamEvidenceWeekInputSchema.extend({
      mode: z.literal("unpublished_candidates"),
    }).strict()).mutation(({ input }) => safeRead(() => service().analyzeWeek({ weekStart: input.weekStart }))),
    prepareBatch: adminAgentProcedure.input(teamEvidenceWeekInputSchema).query(({ ctx, input }) => safeBatch(() => batch().prepare(ctx.agent.agentId, input))),
    analyzeSource: adminAgentProcedure.input(z.object({
      mode: z.literal("unpublished_candidates"), manifest, source: z.custom<TeamEvidence>(object),
      completedReceipt: receipt.optional(),
    }).strict()).mutation(({ ctx, input }) => safeBatch(() => batch().analyzeSource(ctx.agent.agentId, input))),
    materializeBatch: adminAgentProcedure.input(z.object({
      mode: z.literal("unpublished_candidates"), manifest, read: z.custom<TeamEvidenceAuditRead>(object), receipts: z.array(receipt),
    }).strict()).mutation(({ ctx, input }) => safeBatch(() => batch().materialize(ctx.agent.agentId, input))),
  });
}
export const teamLeaderboardEvidenceRouter = createTeamLeaderboardEvidenceRouter();
