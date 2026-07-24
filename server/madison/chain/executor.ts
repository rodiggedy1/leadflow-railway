/**
 * server/madison/chain/executor.ts
 *
 * Generic Executor — completely domain-agnostic.
 * Runs: validate → execute → verify for each step in sequence.
 * Resolves data references from prior step outputs.
 * Persists step state to chain_step_executions for idempotency and audit.
 */

import type {
  ExecutionPlan,
  PlannedStep,
  StepExecutionResult,
  ChainExecutionResult,
  CapabilityContext,
  StepDataRef,
} from "./types";
import { getCapabilityHandler } from "./registry";
import { chainExecutions, chainStepExecutions } from "../../../drizzle/schema";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";

// ── Data reference resolver ───────────────────────────────────────────────────

function resolvePath(obj: unknown, path: string): unknown {
  const parts = path.split(".");
  let current: unknown = obj;
  for (const part of parts) {
    if (current == null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function resolveDataRefs(
  step: PlannedStep,
  stepResults: Map<string, unknown>,
): Record<string, unknown> {
  if (!step.dataRefs) return step.args;

  const resolved = { ...step.args };
  for (const [argKey, ref] of Object.entries(step.dataRefs)) {
    const priorResult = stepResults.get(ref.fromStep);
    if (priorResult !== undefined) {
      resolved[argKey] = resolvePath(priorResult, ref.path);
    }
  }
  return resolved;
}

// ── Step idempotency key ──────────────────────────────────────────────────────

function makeIdempotencyKey(chainExecutionId: string, stepId: string): string {
  return `${chainExecutionId}:${stepId}`;
}

// ── Main executor ─────────────────────────────────────────────────────────────

export async function executeChain(
  chainExecutionId: string,
  plan: ExecutionPlan,
  ctx: CapabilityContext,
): Promise<ChainExecutionResult> {
  const stepResults = new Map<string, unknown>();
  const executionResults: StepExecutionResult[] = [];

  // Mark chain as running
  await ctx.db
    .update(chainExecutions)
    .set({ status: "running" })
    .where(eq(chainExecutions.id, chainExecutionId));

  for (const step of plan.steps) {
    const handler = getCapabilityHandler(step.capabilityId);
    if (!handler) {
      executionResults.push({
        stepId: step.id,
        capabilityId: step.capabilityId,
        status: "failed",
        errorMessage: `Unknown capability: ${step.capabilityId}`,
        summary: `Unknown capability: ${step.capabilityId}`,
      });
      continue;
    }

    const idempotencyKey = makeIdempotencyKey(chainExecutionId, step.id);
    const stepRowId = randomUUID();

    // Check if this step was already executed (idempotency)
    const existing = await ctx.db
      .select()
      .from(chainStepExecutions)
      .where(eq(chainStepExecutions.idempotencyKey, idempotencyKey))
      .limit(1);

    if (existing.length > 0 && existing[0].status === "succeeded") {
      const prev = existing[0];
      const prevResult = prev.result as unknown;
      stepResults.set(step.id, prevResult);
      executionResults.push({
        stepId: step.id,
        capabilityId: step.capabilityId,
        status: "succeeded",
        result: prevResult,
        summary: `${step.label} (already completed)`,
      });
      continue;
    }

    // Insert step row
    await ctx.db.insert(chainStepExecutions).values({
      id: stepRowId,
      chainExecutionId,
      stepId: step.id,
      capabilityId: step.capabilityId,
      status: "running",
      idempotencyKey,
      createdAt: new Date(),
      startedAt: new Date(),
    });

    // Resolve data refs from prior steps
    const resolvedArgs = resolveDataRefs(step, stepResults);

    let stepResult: StepExecutionResult;

    try {
      // 1. Validate
      const validation = await handler.validate(resolvedArgs, ctx);
      if (!validation.ok) {
        stepResult = {
          stepId: step.id,
          capabilityId: step.capabilityId,
          status: "skipped",
          summary: `${step.label}: skipped — ${validation.reason ?? "validation failed"}`,
        };
        await ctx.db
          .update(chainStepExecutions)
          .set({ status: "skipped", errorMessage: validation.reason, completedAt: new Date() })
          .where(eq(chainStepExecutions.id, stepRowId));
        executionResults.push(stepResult);
        continue;
      }

      const effectiveArgs = validation.resolvedArgs ?? resolvedArgs;

      // 2. Execute
      const result = await handler.execute(effectiveArgs, ctx);

      // 3. Verify
      const verification = await handler.verify(effectiveArgs, result, ctx);

      // Persist result
      await ctx.db
        .update(chainStepExecutions)
        .set({
          status: "succeeded",
          resolvedArgs: effectiveArgs as any,
          result: result as any,
          verificationResult: verification as any,
          completedAt: new Date(),
        })
        .where(eq(chainStepExecutions.id, stepRowId));

      stepResults.set(step.id, result);

      // Build entity list for display
      const entities = buildEntityList(step.capabilityId, result);

      stepResult = {
        stepId: step.id,
        capabilityId: step.capabilityId,
        status: "succeeded",
        result,
        verificationResult: verification,
        summary: verification.summary,
        entities,
      };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      const onFailure = step.onFailure ?? handler.defaultOnFailure;

      await ctx.db
        .update(chainStepExecutions)
        .set({ status: "failed", errorMessage, completedAt: new Date() })
        .where(eq(chainStepExecutions.id, stepRowId));

      stepResult = {
        stepId: step.id,
        capabilityId: step.capabilityId,
        status: "failed",
        errorMessage,
        summary: `${step.label}: failed — ${errorMessage}`,
      };

      executionResults.push(stepResult);

      if (onFailure === "halt") {
        // Mark remaining steps as cancelled
        for (const remaining of plan.steps.slice(plan.steps.indexOf(step) + 1)) {
          executionResults.push({
            stepId: remaining.id,
            capabilityId: remaining.capabilityId,
            status: "cancelled",
            summary: `${remaining.label}: cancelled due to prior failure`,
          });
        }
        break;
      }
      continue;
    }

    executionResults.push(stepResult);
  }

  // Determine overall status
  const succeeded = executionResults.filter(r => r.status === "succeeded").length;
  const failed = executionResults.filter(r => r.status === "failed").length;
  const total = plan.steps.length;

  let overallStatus: ChainExecutionResult["status"];
  if (failed === 0) {
    overallStatus = "succeeded";
  } else if (succeeded === 0) {
    overallStatus = "failed";
  } else {
    overallStatus = "partial";
  }

  const overallSummary = buildOverallSummary(executionResults);

  await ctx.db
    .update(chainExecutions)
    .set({ status: overallStatus, completedAt: new Date() })
    .where(eq(chainExecutions.id, chainExecutionId));

  return {
    chainExecutionId,
    status: overallStatus,
    steps: executionResults,
    summary: overallSummary,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildEntityList(
  capabilityId: string,
  result: unknown,
): Array<{ name: string; success: boolean; detail?: string }> | undefined {
  if (!result || typeof result !== "object") return undefined;

  // payments.sendLink → SendLinkOutput[]
  if (capabilityId === "payments.sendLink" && Array.isArray(result)) {
    return result.map((r: any) => ({
      name: r.recipientName,
      success: r.smsSent,
      detail: r.smsSent ? undefined : "SMS failed",
    }));
  }

  // communications.sendBulkSms → SendBulkSmsOutput
  if (capabilityId === "communications.sendBulkSms") {
    const r = result as any;
    if (Array.isArray(r.results)) {
      return r.results.map((item: any) => ({
        name: item.name,
        success: item.success,
      }));
    }
  }

  // communications.sendSms → SendSmsOutput
  if (capabilityId === "communications.sendSms") {
    const r = result as any;
    return [{ name: r.name, success: r.success }];
  }

  return undefined;
}

function buildOverallSummary(steps: StepExecutionResult[]): string {
  const parts: string[] = [];
  for (const step of steps) {
    const icon = step.status === "succeeded" ? "✓" : step.status === "failed" ? "✗" : "—";
    parts.push(`${icon} ${step.summary}`);
  }
  return parts.join("\n");
}
