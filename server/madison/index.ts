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
 *     const result = await handleMadisonReadiness(db, input.message, requestId);
 *     if (result.handled) return result.response;
 *     // else: fall through to legacy concierge
 *   }
 */

import { randomBytes } from "crypto";
import { isReadinessDomain } from "./gate";
import { createReadinessPlan } from "./planner";
import { executePlan } from "./executor";
import { projectResponse } from "./responder";
import { logMadisonExecution } from "./logger";
import { MadisonError } from "./types";

export { isReadinessDomain } from "./gate";

export interface MadisonResult {
  handled: boolean;
  response?: string;
  fallbackReason?: string;
}

/**
 * Handle a readiness-domain message end-to-end.
 * Returns { handled: true, response } on success.
 * Returns { handled: false, fallbackReason } if planning or execution fails.
 * Never throws — always returns a result.
 */
export async function handleMadisonReadiness(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  message: string,
  requestId?: string
): Promise<MadisonResult> {
  const rid = requestId ?? randomBytes(4).toString("hex");
  const startedAt = Date.now();

  // Double-check gate (caller should check first, but be defensive)
  if (!isReadinessDomain(message)) {
    return { handled: false, fallbackReason: "not_readiness_domain" };
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
