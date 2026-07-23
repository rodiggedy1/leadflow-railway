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
import { isReadinessDomain } from "./gate";
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

export interface MadisonResult {
  handled: boolean;
  response?: string;
  fallbackReason?: string;
  /** actionId for Undo — only present when an acknowledge_readiness action completed */
  undoActionId?: string;
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
  agentId?: number
): Promise<MadisonResult> {
  const rid = requestId ?? randomBytes(4).toString("hex");
  const effectiveAgentId = agentId ?? 0;

  // Double-check gate (caller should check first, but be defensive)
  if (!isReadinessDomain(message)) {
    return { handled: false, fallbackReason: "not_readiness_domain" };
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
    return { handled: false, fallbackReason: reason };
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
        return {
          handled: false,
          fallbackReason: "NO_TARGET_IDS",
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
        return { handled: false, fallbackReason: "ACK_EXECUTION_ERROR" };
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

      return {
        handled: true,
        response: responseText,
        undoActionId: ackResult.status === "completed" ? ackResult.actionId : undefined,
      };
    }

    // Unknown action type — fall through
    return { handled: false, fallbackReason: "UNKNOWN_ACTION" };
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
    return { handled: false, fallbackReason: reason };
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

  return {
    handled: true,
    response: responseText,
  };
}
