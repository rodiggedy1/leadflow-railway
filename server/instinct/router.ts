import { TRPCError } from "@trpc/server";
import { adminAgentProcedure, router } from "../_core/trpc";
import type { AgentSessionPayload } from "../_core/agentAuth";
import {
  authorizedScopeSchema, sourcesInputSchema, sourceInventorySchema, feedInputSchema, feedSchema,
  checkInputSchema, checkResultSchema, evidenceInputSchema, investigationSchema, reverifyInputSchema,
  reverifyResultSchema, dayReviewInputSchema, dayReviewResultSchema, askInputSchema, chatAnswerSchema,
  type AuthorizedScope,
} from "../../shared/instinct";
import { getRuntimeInstinctService, InstinctServiceError, safeInstinctFailure, type InstinctService } from "./service";

export interface InstinctRouterOptions {
  /** Invoked only after existing admin-agent authentication; never client input. */
  readonly resolve?: (agent: AgentSessionPayload) => { scope: AuthorizedScope; service: InstinctService } | Promise<{ scope: AuthorizedScope; service: InstinctService }>;
}
function runtimeFor(agent: AgentSessionPayload): { scope: AuthorizedScope; service: InstinctService } {
  if (!Number.isSafeInteger(agent.agentId) || agent.agentId <= 0 || !agent.isAdmin) throw new InstinctServiceError("UNAUTHORIZED");
  const runtime = getRuntimeInstinctService();
  return { scope: authorizedScopeSchema.parse({ ...runtime.scope, actor: { staffId: String(agent.agentId), role: "admin" } }), service: runtime.service };
}
/** Reuses the current admin-agent boundary without ops presence writes, broad
 * application router dispatch, sync, provider fetch or any operational mutation. */
export function createInstinctRouter(options: InstinctRouterOptions = {}) {
  const call = async <T>(agent: AgentSessionPayload, read: (service: InstinctService, scope: AuthorizedScope) => Promise<T>): Promise<T> => {
    try {
      if (!Number.isSafeInteger(agent.agentId) || agent.agentId <= 0 || !agent.isAdmin) throw new InstinctServiceError("UNAUTHORIZED");
      const resolved = await (options.resolve ?? runtimeFor)(agent);
      const scope = authorizedScopeSchema.parse(resolved.scope);
      if (scope.actor.staffId !== String(agent.agentId)) throw new InstinctServiceError("INVALID_SCOPE");
      return await read(resolved.service, scope);
    } catch (error) {
      const failure = safeInstinctFailure(error);
      const code = failure.code === "UNAUTHORIZED" ? "UNAUTHORIZED"
        : failure.code === "INVALID_SCOPE" || failure.code === "INVALID_SOURCE_REFERENCE" || failure.code === "INVALID_CITATION" ? "FORBIDDEN"
          : failure.code === "STALE_CONTEXT" || failure.code === "STALE_ISSUE" ? "CONFLICT" : "PRECONDITION_FAILED";
      throw new TRPCError({ code, message: failure.code });
    }
  };
  return router({
    sources: adminAgentProcedure.input(sourcesInputSchema).output(sourceInventorySchema).query(({ ctx, input }) => call(ctx.agent, (service, scope) => service.sources(scope, input))),
    feed: adminAgentProcedure.input(feedInputSchema).output(feedSchema).query(({ ctx, input }) => call(ctx.agent, (service, scope) => service.feed(scope, input))),
    check: adminAgentProcedure.input(checkInputSchema).output(checkResultSchema).mutation(({ ctx, input }) => call(ctx.agent, (service, scope) => service.check(scope, input))),
    evidence: adminAgentProcedure.input(evidenceInputSchema).output(investigationSchema).query(({ ctx, input }) => call(ctx.agent, (service, scope) => service.evidence(scope, input))),
    reverify: adminAgentProcedure.input(reverifyInputSchema).output(reverifyResultSchema).mutation(({ ctx, input }) => call(ctx.agent, (service, scope) => service.reverify(scope, input))),
    dayReview: adminAgentProcedure.input(dayReviewInputSchema).output(dayReviewResultSchema).mutation(({ ctx, input }) => call(ctx.agent, (service, scope) => service.dayReview(scope, input))),
    ask: adminAgentProcedure.input(askInputSchema).output(chatAnswerSchema).mutation(({ ctx, input }) => call(ctx.agent, (service, scope) => service.ask(scope, input))),
  });
}
export const instinctRouter = createInstinctRouter();
