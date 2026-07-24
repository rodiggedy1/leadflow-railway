/**
 * server/madison/chain/index.ts
 *
 * Entry point for the Madison Command Chaining Engine.
 *
 * Called from aiConciergeRouter when the chain gate fires.
 * Returns either a chain_confirm card (for write plans) or
 * executes immediately and returns a chain_result card (for read-only plans).
 *
 * Special case: when the final write step is sendBulkSms, we skip the chain
 * confirm card entirely and return bulk_sms_confirm — the existing card that
 * already shows the draft message, editable text, and recipient list.
 */

import type { CapabilityContext, ExecutionPlan, ChainConfirmCard, ChainExecutionResult } from "./types";
import { planChainRouting } from "./planner";
import { executeChain } from "./executor";
import { getCapabilityHandler } from "./registry";
import { chainExecutions } from "../../../drizzle/schema";
import { randomUUID } from "crypto";
import { buildSmsPreview } from "../comms/smsService";
import type { CommsSmsPreview } from "../comms/smsService";

// ── Result types returned to aiConciergeRouter ────────────────────────────────

export interface ChainConfirmResult {
  type: "chain_confirm";
  chainExecutionId: string;
  card: ChainConfirmCard;
}

export interface ChainResultOutput {
  type: "chain_result";
  chainExecutionId: string;
  result: ChainExecutionResult;
}

export interface ChainLegacyResult {
  type: "chain_legacy";
}

export interface ChainBulkSmsConfirmResult {
  type: "bulk_sms_confirm";
  card: CommsSmsPreview;
}

export type ChainHandlerResult = ChainConfirmResult | ChainResultOutput | ChainLegacyResult | ChainBulkSmsConfirmResult;

// ── Main entry point ──────────────────────────────────────────────────────────

export async function handleMadisonChain(
  message: string,
  ctx: CapabilityContext & { plan?: ExecutionPlan },
): Promise<ChainHandlerResult> {
  // Use pre-computed plan if provided (avoids double LLM call when planner ran upstream)
  let plan: ExecutionPlan;
  if (ctx.plan) {
    plan = ctx.plan;
  } else {
    const routing = await planChainRouting(message);
    if (routing.mode !== "chain" || !routing.plan) {
      return { type: "chain_legacy" };
    }
    plan = routing.plan;
  }

  // Create chain execution record
  const chainExecutionId = randomUUID();
  await ctx.db.insert(chainExecutions).values({
    id: chainExecutionId,
    agentId: ctx.agentId,
    originalMessage: message,
    plan: plan as any,
    status: plan.hasWrites ? "awaiting_confirmation" : "running",
    createdAt: new Date(),
  });

  // Read-only plans execute immediately — no confirm card needed
  if (!plan.hasWrites) {
    const result = await executeChain(chainExecutionId, plan, ctx);
    return {
      type: "chain_result",
      chainExecutionId,
      result,
    };
  }

  // Special case: read-then-sendBulkSms chain → reuse existing bulk_sms_confirm card
  // This gives the agent the full draft + editable text + recipient list experience
  // instead of the generic chain confirm card.
  const bulkSmsCard = await tryBuildBulkSmsConfirm(chainExecutionId, plan, ctx);
  if (bulkSmsCard) {
    // Delete the chain execution record — it was just a planning artifact.
    // The actual send is handled by the existing sendBulkSms procedure.
    const { eq } = await import("drizzle-orm");
    await (ctx.db as any)
      .delete(chainExecutions)
      .where(eq(chainExecutions.id, chainExecutionId));
    return { type: "bulk_sms_confirm", card: bulkSmsCard };
  }

  // Write plans: build confirm card with previews
  const confirmCard = await buildConfirmCard(chainExecutionId, plan, ctx);
  return {
    type: "chain_confirm",
    chainExecutionId,
    card: confirmCard,
  };
}

// ── Execute a confirmed chain (called from the confirm procedure) ─────────────

export async function executeConfirmedChain(
  chainExecutionId: string,
  ctx: CapabilityContext,
): Promise<ChainExecutionResult> {
  const { eq } = await import("drizzle-orm");

  // Load plan from DB
  const rows = await (ctx.db as any)
    .select({ plan: chainExecutions.plan, status: chainExecutions.status })
    .from(chainExecutions)
    .where(eq(chainExecutions.id, chainExecutionId));

  const row = rows[0];
  if (!row) throw new Error(`Chain execution ${chainExecutionId} not found`);
  if (row.status === "cancelled") throw new Error(`Chain execution ${chainExecutionId} was cancelled`);

  const plan = row.plan as ExecutionPlan;

  // Mark as running
  await (ctx.db as any)
    .update(chainExecutions)
    .set({ status: "running", confirmedAt: new Date() })
    .where(eq(chainExecutions.id, chainExecutionId));

  return executeChain(chainExecutionId, plan, ctx);
}

// ── Build confirm card with entity previews ───────────────────────────────────

async function buildConfirmCard(
  chainExecutionId: string,
  plan: ExecutionPlan,
  ctx: CapabilityContext,
): Promise<ChainConfirmCard> {
  const steps: ChainConfirmCard["steps"] = [];

  // For each step, try to compute a preview by running validation only
  // (validation is side-effect-free)
  const previewResults = new Map<string, unknown>();

  for (const step of plan.steps) {
    const handler = getCapabilityHandler(step.capabilityId);
    if (!handler) continue;

    // Resolve data refs from prior preview results
    const resolvedArgs = resolveDataRefsForPreview(step, previewResults);

    let preview: string | undefined;
    let entities: Array<{ name: string; phone?: string | null }> | undefined;

    try {
      // For read steps, execute them to get real entity lists for the preview
      if (!handler.isWrite) {
        const validation = await handler.validate(resolvedArgs, ctx);
        if (validation.ok) {
          const effectiveArgs = validation.resolvedArgs ?? resolvedArgs;
          const result = await handler.execute(effectiveArgs, ctx);
          previewResults.set(step.id, result);

          // Build preview from result
          const previewData = buildStepPreview(step.capabilityId, result);
          preview = previewData.preview;
          entities = previewData.entities;
        }
      } else {
        // For write steps, resolve args from prior results and build a count preview
        const validation = await handler.validate(resolvedArgs, ctx);
        if (validation.ok) {
          const effectiveArgs = validation.resolvedArgs ?? resolvedArgs;
          const previewData = buildWriteStepPreview(step.capabilityId, effectiveArgs);
          preview = previewData.preview;
          entities = previewData.entities;
        }
      }
    } catch {
      // Preview failure is non-fatal
    }

    steps.push({
      id: step.id,
      capabilityId: step.capabilityId,
      label: step.label,
      isWrite: handler.isWrite,
      preview,
      entities,
    });
  }

  return {
    chainExecutionId,
    summary: plan.summary,
    steps,
  };
}

// ── Preview helpers ───────────────────────────────────────────────────────────

function buildStepPreview(
  capabilityId: string,
  result: unknown,
): { preview?: string; entities?: Array<{ name: string; phone?: string | null }> } {
  if (!result || typeof result !== "object") return {};

  switch (capabilityId) {
    case "payments.queryCardStatus": {
      const r = result as any;
      return {
        preview: `${r.noCard?.length ?? 0} without card, ${r.onHold?.length ?? 0} on hold`,
        entities: r.noCard?.map((e: any) => ({ name: e.name, phone: e.phone })),
      };
    }
    case "confirmations.queryStatus": {
      const r = result as any;
      const list = r.notYetConfirmed ?? r.unconfirmed ?? [];
      return {
        preview: `${list.length} not yet confirmed`,
        entities: list.map((e: any) => ({ name: e.name, phone: e.phone })),
      };
    }
    case "readiness.compute": {
      const r = result as any;
      return { preview: r.summary };
    }
    default:
      return {};
  }
}

function buildWriteStepPreview(
  capabilityId: string,
  args: Record<string, unknown>,
): { preview?: string; entities?: Array<{ name: string; phone?: string | null }> } {
  switch (capabilityId) {
    case "payments.sendLink": {
      const recipients = (args.recipients as any[]) ?? [];
      const count = recipients.length;
      return {
        preview: count > 0 ? `${count} recipient${count !== 1 ? "s" : ""}` : undefined,
        entities: recipients.slice(0, 10).map((r: any) => ({ name: r.name, phone: r.phone })),
      };
    }
    case "communications.sendBulkSms": {
      const recipients = (args.recipients as any[]) ?? [];
      const count = recipients.length;
      return {
        preview: count > 0 ? `${count} recipient${count !== 1 ? "s" : ""}` : undefined,
        entities: recipients.slice(0, 10).map((r: any) => ({ name: r.name, phone: r.phone })),
      };
    }
    case "communications.sendSms": {
      return { preview: args.name as string };
    }
    default:
      return {};
  }
}

function resolveDataRefsForPreview(
  step: { args: Record<string, unknown>; dataRefs?: Record<string, { fromStep: string; path: string }> },
  previewResults: Map<string, unknown>,
): Record<string, unknown> {
  if (!step.dataRefs) return step.args;
  const resolved = { ...step.args };
  for (const [argKey, ref] of Object.entries(step.dataRefs)) {
    const prior = previewResults.get(ref.fromStep);
    if (prior !== undefined) {
      resolved[argKey] = getPath(prior, ref.path);
    }
  }
  return resolved;
}

function getPath(obj: unknown, path: string): unknown {
  const parts = path.split(".");
  let current: unknown = obj;
  for (const part of parts) {
    if (current == null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

// ── Bulk SMS shortcut ─────────────────────────────────────────────────────────
// When the chain is: [read step] → sendBulkSms, skip the generic chain confirm
// card and return the existing bulk_sms_confirm card instead. This reuses the
// full draft + editable text + recipient list UI that already exists.

async function tryBuildBulkSmsConfirm(
  chainExecutionId: string,
  plan: ExecutionPlan,
  ctx: CapabilityContext,
): Promise<CommsSmsPreview | null> {
  const steps = plan.steps;

  // Pattern: last step is sendBulkSms, all prior steps are read steps
  const lastStep = steps[steps.length - 1];
  if (!lastStep || lastStep.capabilityId !== "communications.sendBulkSms") return null;

  const readSteps = steps.slice(0, -1);
  if (readSteps.some(s => getCapabilityHandler(s.capabilityId)?.isWrite)) return null;

  // Execute the read steps to get the recipient list
  const previewResults = new Map<string, unknown>();
  for (const step of readSteps) {
    const handler = getCapabilityHandler(step.capabilityId);
    if (!handler) return null;

    const resolvedArgs = resolveDataRefsForPreview(step, previewResults);
    try {
      const validation = await handler.validate(resolvedArgs, ctx);
      if (!validation.ok) return null;
      const effectiveArgs = validation.resolvedArgs ?? resolvedArgs;
      const result = await handler.execute(effectiveArgs, ctx);
      previewResults.set(step.id, result);
    } catch {
      return null;
    }
  }

  // Resolve the sendBulkSms args (recipients come from a dataRef)
  const resolvedSmsArgs = resolveDataRefsForPreview(lastStep, previewResults);
  const rawRecipients = (resolvedSmsArgs.recipients as any[]) ?? [];

  if (rawRecipients.length === 0) return null;

  // Map to CommsRecipient shape for buildSmsPreview
  const commsRecipients = rawRecipients.map((r: any) => ({
    entityType: "customer" as const,
    entityId: `customer:${r.phone ?? r.name}`,
    displayName: r.name ?? r.phone,
    phone: r.phone ?? "",
    contextLabel: "",
  })).filter(r => r.phone);

  if (commsRecipients.length === 0) return null;

  const targetDescription = `${commsRecipients.length} unconfirmed customer${commsRecipients.length !== 1 ? "s" : ""}`;
  const messageHint = (resolvedSmsArgs.message as string | undefined) ?? plan.summary ?? "send confirmation reminder";

  try {
    return await buildSmsPreview(
      commsRecipients,
      targetDescription,
      messageHint,
      plan.summary,
      0,
      [],
    );
  } catch {
    return null;
  }
}
