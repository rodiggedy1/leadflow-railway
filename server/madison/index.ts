/**
 * server/madison/index.ts
 *
 * Main entry point for the Madison Readiness Domain planner.
 *
 * Usage in aiConciergeRouter.ts sendMessage handler:
 *
 *   import { isReadinessDomain } from "./madison/gate";
 *   import { handleMadisonReadiness } from "./madison";
 *   import { ENV } from "./_core/env";
 *
 *   if (ENV.MADISON_PLANNER_ENABLED && isReadinessDomain(input.message)) {
 *     const result = await handleMadisonReadiness(db, input.message, requestId, agentId);
 *     if (result.handled) return result.response;
 *     // else: fall through to legacy concierge
 *   }
 *
 * Context flow:
 *   Query: executePlan → projectResponse → saveQueryContext (stores item IDs)
 *   Action: getContext → resolveTargetIds → acknowledgeReadinessItems → saveActionContext
 */

import { randomBytes } from "crypto";
import { isReadinessDomain, evaluateReadinessGate, GateDiagnostics } from "./gate";
import { createReadinessPlan } from "./planner";
import { executePlan } from "./executor";
import { projectResponse } from "./responder";
import { logMadisonExecution } from "./logger";
import { acknowledgeReadinessItems } from "./acknowledgeService";
import {
  getContext,
  saveQueryContext,
  extractItemIdsFromProjection,
} from "./conversationContextService";
import { MadisonError } from "./types";

export { isReadinessDomain } from "./gate";

export interface MadisonDebugInfo {
  requestId: string;
  gate: GateDiagnostics;
  plannerType: "query" | "action" | null;
  plannerFailed: boolean;
  plannerError?: string;
  executorInvoked: boolean;
  executorError?: string;
  responseType: "query_result" | "action_result" | "needs_context" | "fallback" | null;
  /** Only set when responseType = needs_context */
  needsContextReason?: "NO_TARGET_IDS";
  /** Only set when responseType = action_result and executor succeeded */
  acknowledgedCount?: number;
  durationMs: number;
}

export interface MadisonResult {
  handled: boolean;
  response?: string;
  fallbackReason?: string;
  /** actionId for Undo — only present when an acknowledge_readiness action completed */
  undoActionId?: string;
  /** Only present when debug: true is passed */
  debug?: MadisonDebugInfo;
}

/**
 * Handle a readiness-domain message end-to-end.
 * Returns { handled: true, response } on success.
 * Returns { handled: false, fallbackReason } if planning or execution fails.
 * Never throws — always returns a result.
 *
 * @param agentId - The agent/user ID for context scoping and action audit trail.
 *                  Pass 0 for system-level calls without a user context.
 */
export async function handleMadisonReadiness(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  message: string,
  requestId?: string,
  agentId?: number,
  options?: { debug?: boolean; clearContext?: boolean }
): Promise<MadisonResult> {
  const rid = requestId ?? randomBytes(4).toString("hex");
  const effectiveAgentId = agentId ?? 0;
  const debugMode = options?.debug ?? false;
  const clearContext = options?.clearContext ?? false;
  const startedAt = Date.now();

  // ── Optional context reset (for regression tests) ─────────────────────────
  if (clearContext && effectiveAgentId > 0) {
    try {
      const { madisonConversationContext } = await import("../../drizzle/schema");
      const { eq } = await import("drizzle-orm");
      await db.delete(madisonConversationContext).where(eq(madisonConversationContext.agentId, effectiveAgentId));
      console.log(`[Madison] clearContext: deleted context for agentId=${effectiveAgentId}`);
    } catch (clearErr) {
      console.warn("[Madison] clearContext failed (non-fatal):", clearErr instanceof Error ? clearErr.message : String(clearErr));
    }
  }

  // Always evaluate gate diagnostics (cheap, used for debug and double-check)
  const gateDiag = evaluateReadinessGate(message);

  // Double-check gate (caller should check first, but be defensive)
  if (!gateDiag.gateMatched) {
    const debug: MadisonDebugInfo | undefined = debugMode ? {
      requestId: rid,
      gate: gateDiag,
      plannerType: null,
      plannerFailed: false,
      executorInvoked: false,
      responseType: "fallback",
      durationMs: Date.now() - startedAt,
    } : undefined;
    return { handled: false, fallbackReason: "not_readiness_domain", debug };
  }

  // ── Load existing context (best-effort, non-blocking) ─────────────────────
  let existingContext = null;
  try {
    existingContext = await getContext(db, effectiveAgentId);
  } catch {
    // Context load failure is non-fatal
  }

  let plan;
  try {
    plan = await createReadinessPlan(message);
  } catch (err) {
    const reason =
      err instanceof MadisonError ? err.code : "PLAN_FAILED";
    const errMsg = err instanceof Error ? err.message : String(err);
    logMadisonExecution({
      requestId: rid,
      message,
      domain: "readiness",
      planCreatedAt: Date.now(),
      fallbackReason: reason,
      error: errMsg,
    });
    const debug: MadisonDebugInfo | undefined = debugMode ? {
      requestId: rid,
      gate: gateDiag,
      plannerType: null,
      plannerFailed: true,
      plannerError: errMsg,
      executorInvoked: false,
      responseType: "fallback",
      durationMs: Date.now() - startedAt,
    } : undefined;
    return { handled: false, fallbackReason: reason, debug };
  }

  const planCreatedAt = Date.now();
  console.log(
    `[Madison] plan created: requestId=${rid} type=${plan.type} ` +
    (plan.type === "query"
      ? `dateScope=${JSON.stringify(plan.dateScope)} filters=${JSON.stringify(plan.filters ?? {})} sort=${plan.sort ?? "default"}`
      : `action=${plan.action} targetReference=${JSON.stringify(plan.targetReference)} serviceDate=${plan.serviceDate ?? "null"}`)
  );

  // ── Action plan branch ────────────────────────────────────────────────────
  if (plan.type === "action") {
    if (plan.action === "acknowledge_readiness") {
      // Resolve targetIds from targetReference.
      // context_selection: use last shown items from conversation context.
      // explicit: LLM extracted IDs — validate against context before use.
      let resolvedTargetIds: string[] = [];

      if (plan.targetReference.kind === "context_selection") {
        resolvedTargetIds = existingContext?.lastSelectionItemIds ?? [];
        console.log(
          `[Madison] action: context_selection → ${resolvedTargetIds.length} items from context`
        );
      } else if (plan.targetReference.kind === "explicit") {
        // Validate explicit IDs against context (reject IDs not in last projection)
        const contextIds = new Set(existingContext?.lastSelectionItemIds ?? []);
        if (contextIds.size > 0) {
          resolvedTargetIds = plan.targetReference.itemIds.filter((id) => contextIds.has(id));
          const rejected = plan.targetReference.itemIds.length - resolvedTargetIds.length;
          if (rejected > 0) {
            console.warn(`[Madison] action: explicit targetReference had ${rejected} IDs not in context — rejected`);
          }
        } else {
          // No context available — use explicit IDs as-is (best effort)
          resolvedTargetIds = plan.targetReference.itemIds;
          console.warn(`[Madison] action: no context available, using explicit IDs as-is (${resolvedTargetIds.length} items)`);
        }
        console.log(`[Madison] action: explicit → ${resolvedTargetIds.length} validated items`);
      }

      if (resolvedTargetIds.length === 0) {
        const debug: MadisonDebugInfo | undefined = debugMode ? {
          requestId: rid,
          gate: gateDiag,
          plannerType: "action",
          plannerFailed: false,
          executorInvoked: false,
          responseType: "needs_context",
          needsContextReason: "NO_TARGET_IDS",
          durationMs: Date.now() - startedAt,
        } : undefined;
        return {
          handled: true,
          response: "I'm not sure which readiness items you mean. Show me the jobs first, then I can acknowledge them.",
          debug,
        };
      }

      let ackResult;
      try {
        ackResult = await acknowledgeReadinessItems(db, {
          targetIds: resolvedTargetIds,
          executedBy: effectiveAgentId,
        });
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        console.error("[Madison] acknowledgeReadinessItems failed:", errMsg);
        logMadisonExecution({
          requestId: rid,
          message,
          domain: "readiness",
          planCreatedAt,
          executionStartedAt: planCreatedAt,
          executionEndedAt: Date.now(),
          fallbackReason: "ACK_EXECUTION_ERROR",
          error: errMsg,
        });
        const debug: MadisonDebugInfo | undefined = debugMode ? {
          requestId: rid,
          gate: gateDiag,
          plannerType: "action",
          plannerFailed: false,
          executorInvoked: true,
          executorError: errMsg,
          responseType: "fallback",
          durationMs: Date.now() - startedAt,
        } : undefined;
        return { handled: false, fallbackReason: "ACK_EXECUTION_ERROR", debug };
      }

      const executionEndedAt = Date.now();

      // Build a human-readable response for the action result
      let responseText: string;
      if (ackResult.status === "completed") {
        const parts: string[] = [];
        if (ackResult.acknowledgedCount > 0) {
          parts.push(
            `Acknowledged ${ackResult.acknowledgedCount} item${ackResult.acknowledgedCount !== 1 ? "s" : ""}.`
          );
        }
        if (ackResult.alreadyAcknowledgedCount > 0) {
          parts.push(
            `${ackResult.alreadyAcknowledgedCount} item${ackResult.alreadyAcknowledgedCount !== 1 ? "s were" : " was"} already acknowledged.`
          );
        }
        if (ackResult.invalidCount > 0) {
          parts.push(
            `${ackResult.invalidCount} item ID${ackResult.invalidCount !== 1 ? "s were" : " was"} invalid and skipped.`
          );
        }
        parts.push(
          `You can undo this within 24 hours (action ID: \`${ackResult.actionId}\`).`
        );
        responseText = parts.join(" ");
      } else {
        responseText = `Could not acknowledge items: ${ackResult.failureMessage ?? ackResult.failureCode ?? "unknown error"}.`;
      }

      // Save updated context from the refreshed projection (best-effort)
      if (ackResult.status === "completed" && ackResult.updatedProjection) {
        try {
          // Build item IDs from updated projection for future context
          // We need to convert the ReadinessSummary to a minimal projection-like shape
          const updatedProjection = ackResult.updatedProjection;
          const updatedItemIds: string[] = [];
          for (const job of updatedProjection.jobs) {
            if (!job.acknowledgedIssues.includes("UNASSIGNED") && !job.cleanerProfileId) {
              updatedItemIds.push(`${job.id}:${updatedProjection.date}:UNASSIGNED`);
            }
          }
          // Update context with remaining unacknowledged items
          if (existingContext) {
            await db
              .update(
                (await import("../../drizzle/schema")).madisonConversationContext
              )
              .set({
                lastSelectionItemIds: updatedItemIds,
                lastRequestId: rid,
                version: existingContext.version + 1,
                updatedAt: new Date(),
              })
              .where(
                (await import("drizzle-orm")).and(
                  (await import("drizzle-orm")).eq(
                    (await import("../../drizzle/schema")).madisonConversationContext.agentId,
                    effectiveAgentId
                  ),
                  (await import("drizzle-orm")).eq(
                    (await import("../../drizzle/schema")).madisonConversationContext.version,
                    existingContext.version
                  )
                )
              );
          }
        } catch (ctxErr) {
          console.warn("[Madison] action context update failed (non-fatal):", ctxErr instanceof Error ? ctxErr.message : String(ctxErr));
        }
      }

      logMadisonExecution({
        requestId: rid,
        message,
        domain: "readiness",
        planCreatedAt,
        executionStartedAt: planCreatedAt,
        executionEndedAt,
      });

      const debugAction: MadisonDebugInfo | undefined = debugMode ? {
        requestId: rid,
        gate: gateDiag,
        plannerType: "action",
        plannerFailed: false,
        executorInvoked: true,
        responseType: "action_result",
        acknowledgedCount: ackResult.acknowledgedCount,
        durationMs: Date.now() - startedAt,
      } : undefined;
      return {
        handled: true,
        response: responseText,
        undoActionId: ackResult.status === "completed" ? ackResult.actionId : undefined,
        debug: debugAction,
      };
    }

    // Unknown action type — fall through
    const debugUnknown: MadisonDebugInfo | undefined = debugMode ? {
      requestId: rid,
      gate: gateDiag,
      plannerType: "action",
      plannerFailed: false,
      executorInvoked: false,
      responseType: "fallback",
      durationMs: Date.now() - startedAt,
    } : undefined;
    return { handled: false, fallbackReason: "UNKNOWN_ACTION", debug: debugUnknown };
  }

  // ── Query plan branch ─────────────────────────────────────────────────────
  let projection;
  try {
    projection = await executePlan(db, plan);
  } catch (err) {
    const reason =
      err instanceof MadisonError ? err.code : "EXECUTION_ERROR";
    const errMsg = err instanceof Error ? err.message : String(err);
    logMadisonExecution({
      requestId: rid,
      message,
      domain: "readiness",
      planCreatedAt,
      executionStartedAt: planCreatedAt,
      executionEndedAt: Date.now(),
      fallbackReason: reason,
      error: errMsg,
    });
    const debug: MadisonDebugInfo | undefined = debugMode ? {
      requestId: rid,
      gate: gateDiag,
      plannerType: "query",
      plannerFailed: false,
      executorInvoked: true,
      executorError: errMsg,
      responseType: "fallback",
      durationMs: Date.now() - startedAt,
    } : undefined;
    return { handled: false, fallbackReason: reason, debug };
  }

  const executionEndedAt = Date.now();

  let responseText;
  try {
    responseText = await projectResponse(projection, message);
  } catch (err) {
    // Responder failure is non-fatal — use fallback summary
    const errMsg = err instanceof Error ? err.message : String(err);
    console.warn("[Madison] Responder failed, using fallback:", errMsg);
    responseText = `I found ${projection.totalIssues} issue(s) for ${projection.date}. Please check the readiness drawer for details.`;
  }

  // ── Save context after successful query (best-effort) ─────────────────────
  try {
    await saveQueryContext(db, {
      agentId: effectiveAgentId,
      projection,
      requestId: rid,
      currentVersion: existingContext?.version,
    });
  } catch (ctxErr) {
    console.warn(
      "[Madison] saveQueryContext failed (non-fatal):",
      ctxErr instanceof Error ? ctxErr.message : String(ctxErr)
    );
  }

  logMadisonExecution({
    requestId: rid,
    message,
    domain: "readiness",
    planCreatedAt,
    executionStartedAt: planCreatedAt,
    executionEndedAt,
  });

  const debugFinal: MadisonDebugInfo | undefined = debugMode ? {
    requestId: rid,
    gate: gateDiag,
    plannerType: "query",
    plannerFailed: false,
    executorInvoked: true,
    responseType: "query_result",
    durationMs: Date.now() - startedAt,
  } : undefined;
  return {
    handled: true,
    response: responseText,
    debug: debugFinal,
  };
}
