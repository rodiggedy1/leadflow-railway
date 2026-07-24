/**
 * server/madison/chain/planner.ts
 *
 * Chain Planner — converts a natural-language message into an ExecutionPlan.
 *
 * Architecture:
 *   1. Deterministic pre-parser classifies the message as "chain" or "single".
 *      This decision is AUTHORITATIVE — the LLM cannot override it.
 *   2. The LLM's only job is to build the execution steps for the determined mode.
 *
 * The pre-parser fires on coordination signals (and, then, after, also, etc.).
 * If a coordination signal is present → mode is forced to "chain".
 * If not → mode is forced to "single" (or "legacy" if no capability matches).
 */

import type { ExecutionPlan, CapabilityId, ChainRoutingDecision } from "./types";
import { getAllCapabilities, getCapabilityHandler } from "./registry";
import { invokeLLM } from "../../_core/llm";
import { getTodayET } from "../../conciergeTime";

// ── Deterministic pre-parser ──────────────────────────────────────────────────

/**
 * Coordination signals that indicate the user intends multiple actions.
 * Matched case-insensitively against the full message.
 *
 * The pattern requires the keyword to appear as a standalone word (word boundary)
 * to avoid false positives inside other words (e.g. "Anderson").
 */
const COORDINATION_PATTERN = /\b(and|then|after|also|as well|plus)\b/i;

/**
 * Returns true if the message contains a coordination signal that indicates
 * two or more actions should be chained.
 */
export function hasCoordinationSignal(message: string): boolean {
  return COORDINATION_PATTERN.test(message);
}

// ── Capability catalog for the planner prompt ─────────────────────────────────

function buildCapabilityCatalog(): string {
  const caps = getAllCapabilities();
  return caps.map(c => {
    let contract = "";
    switch (c.id) {
      case "readiness.compute":
        contract = [
          '  inputs:  { date?: "YYYY-MM-DD" }',
          '  outputs: { overallPct: number, totalIssues: number, summary: string }',
        ].join("\n");
        break;
      case "confirmations.queryStatus":
        contract = [
          '  inputs:  { date?: "YYYY-MM-DD" }',
          '  outputs: { notYetConfirmed: [{phone, name, jobId}] — customers who have not yet confirmed (no text sent + text sent but no reply) }',
        ].join("\n");
        break;
      case "payments.queryCardStatus":
        contract = [
          '  inputs:  { date?: "YYYY-MM-DD" }',
          '  outputs: { noCard: [{phone, name, jobId}], onHold: [{phone, name, jobId}], noPreauth: [{phone, name, jobId}] }',
        ].join("\n");
        break;
      case "payments.sendLink":
        contract = [
          '  inputs:  { recipients: [{phone, name, jobId?}] }  — OR —  { phone: string, name: string }',
          '  outputs: { sent: [{name, success}], failed: [{name, reason}] }',
        ].join("\n");
        break;
      case "communications.sendSms":
        contract = [
          '  inputs:  { phone: string, name: string, message: string }',
          '  outputs: { success: boolean, messageId?: string }',
        ].join("\n");
        break;
      case "communications.sendBulkSms":
        contract = [
          '  inputs:  { recipients: Recipient[] (REQUIRED), message: string (REQUIRED) }',
          '  recipients must be satisfied by: (1) explicit user-provided list, (2) trusted resolved context, or (3) a dataRef from a prior step output.',
          '  The planner must NOT invent or omit recipients. If no source exists, add a capability that produces them.',
          '  outputs: { results: [{name, success}] }',
        ].join("\n");
        break;
    }
    return `### ${c.id} (${c.isWrite ? "WRITE" : "READ"})\n${c.label}\n${contract}`;
  }).join("\n\n");
}

// ── LLM prompt builders ───────────────────────────────────────────────────────

function buildChainPlanPrompt(catalog: string, businessDate: string): string {
  return `You are the Madison command planner for a cleaning business operations tool.
Today's date is ${businessDate}.

The user's message has been pre-classified as requiring MULTIPLE STEPS (chain mode).
Your job is ONLY to build the execution plan — do NOT change the mode.

CAPABILITY REGISTRY:
${catalog}

DATA REFERENCES:
A step can consume the output of a prior step using dataRefs.
Format: "dataRefs": { "<inputKey>": { "fromStep": "<step-id>", "path": "<dot.path.into.output>" } }

PLANNER CONSTRAINT:
Every required capability input must be satisfied by: (1) explicit arguments from the user, (2) trusted resolved context already supplied, or (3) a dataRef from an earlier step.
Do NOT invent or fabricate input values. Do NOT omit a requested action.
Each step must use a capability ID from the registry exactly as listed.

Return ONLY valid JSON:
{
  "summary": "one sentence describing the full chain",
  "hasWrites": boolean,
  "steps": [
    {
      "id": "step-1",
      "capabilityId": "<id from registry>",
      "label": "Human-readable label",
      "args": { /* static args from user input */ },
      "dataRefs": { /* optional: { "argKey": { "fromStep": "step-N", "path": "output.field" } } */ },
      "onFailure": "halt" | "continue"
    }
  ]
}`;
}

function buildSinglePlanPrompt(catalog: string, businessDate: string): string {
  return `You are the Madison command planner for a cleaning business operations tool.
Today's date is ${businessDate}.

The user's message has been pre-classified as requiring a SINGLE STEP.
Your job is ONLY to identify which capability to invoke and what args to pass.
If no capability in the registry matches the user's intent, return { "capabilityId": null }.

CAPABILITY REGISTRY:
${catalog}

Return ONLY valid JSON:
{
  "capabilityId": "<id from registry, or null if no match>",
  "args": { /* static args extracted from the user's message */ }
}`;
}

// ── Main planner entry point ──────────────────────────────────────────────────

export async function planChainRouting(
  message: string,
  businessDate: string = getTodayET(),
): Promise<ChainRoutingDecision> {
  const catalog = buildCapabilityCatalog();
  const isChain = hasCoordinationSignal(message);

  console.log(`[ChainPlanner] pre-parser: isChain=${isChain} msg=${JSON.stringify(message)}`);

  if (isChain) {
    return planChain(message, catalog, businessDate);
  } else {
    return planSingle(message, catalog, businessDate);
  }
}

// ── Chain planner ─────────────────────────────────────────────────────────────

async function planChain(
  message: string,
  catalog: string,
  businessDate: string,
): Promise<ChainRoutingDecision> {
  const systemPrompt = buildChainPlanPrompt(catalog, businessDate);
  const userPrompt = `Message: "${message}"`;

  try {
    const response = await invokeLLM({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "chain_plan",
          strict: false,
          schema: {
            type: "object",
            properties: {
              summary: { type: "string" },
              hasWrites: { type: "boolean" },
              steps: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    id: { type: "string" },
                    capabilityId: { type: "string" },
                    label: { type: "string" },
                    args: { type: "object", additionalProperties: true },
                    dataRefs: {
                      type: "object",
                      additionalProperties: {
                        type: "object",
                        properties: {
                          fromStep: { type: "string" },
                          path: { type: "string" },
                        },
                        required: ["fromStep", "path"],
                        additionalProperties: false,
                      },
                    },
                    onFailure: { type: "string", enum: ["halt", "continue"] },
                  },
                  required: ["id", "capabilityId", "label", "args"],
                  additionalProperties: false,
                },
              },
            },
            required: ["summary", "hasWrites", "steps"],
            additionalProperties: false,
          },
        },
      },
    });

    const rawContent = response.choices?.[0]?.message?.content;
    if (!rawContent) {
      console.error("[ChainPlanner] chain: empty LLM response");
      return { mode: "legacy" };
    }
    const content = typeof rawContent === "string" ? rawContent : JSON.stringify(rawContent);
    console.log("[ChainPlanner] chain raw response:", content.slice(0, 600));

    const parsed = JSON.parse(content) as {
      summary: string;
      hasWrites: boolean;
      steps: Array<{
        id: string;
        capabilityId: string;
        label: string;
        args: Record<string, unknown>;
        dataRefs?: Record<string, { fromStep: string; path: string }>;
        onFailure?: "halt" | "continue";
      }>;
    };

    const validIds = new Set(getAllCapabilities().map(c => c.id));
    const validSteps = parsed.steps.filter(s => {
      const ok = validIds.has(s.capabilityId as CapabilityId);
      if (!ok) console.warn("[ChainPlanner] chain: unknown capabilityId:", s.capabilityId);
      return ok;
    });

    // AUTHORITATIVE: pre-parser forced chain — do NOT silently downgrade.
    // If the LLM returned fewer than 2 valid steps, that is a planner error.
    if (validSteps.length < 2) {
      console.error(
        "[ChainPlanner] chain: LLM returned fewer than 2 valid steps for a forced-chain message.",
        "steps:", parsed.steps.map(s => s.capabilityId),
      );
      // Return legacy so the router can fall through to the legacy concierge,
      // which will surface a natural error to the user rather than silently doing nothing.
      return { mode: "legacy" };
    }

    const assembledSteps = validSteps.map(s => ({
      id: s.id,
      capabilityId: s.capabilityId as CapabilityId,
      label: s.label,
      args: s.args ?? {},
      dataRefs: s.dataRefs,
      onFailure: s.onFailure,
    }));

    // Compute hasWrites deterministically from the registry — do not trust the LLM's value.
    const hasWrites = assembledSteps.some(
      step => getCapabilityHandler(step.capabilityId)?.isWrite === true
    );

    const plan: ExecutionPlan = {
      summary: parsed.summary,
      hasWrites,
      steps: assembledSteps,
    };

    console.log(`[ChainPlanner] chain: hasWrites=${hasWrites} steps=${assembledSteps.map(s => s.capabilityId).join(" → ")}`);

    return { mode: "chain", plan };
  } catch (err) {
    console.error("[ChainPlanner] chain: Error:", err);
    return { mode: "legacy" };
  }
}

// ── Single planner ────────────────────────────────────────────────────────────

async function planSingle(
  message: string,
  catalog: string,
  businessDate: string,
): Promise<ChainRoutingDecision> {
  const systemPrompt = buildSinglePlanPrompt(catalog, businessDate);
  const userPrompt = `Message: "${message}"`;

  try {
    const response = await invokeLLM({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "single_plan",
          strict: false,
          schema: {
            type: "object",
            properties: {
              capabilityId: { type: ["string", "null"] },
              args: { type: "object", additionalProperties: true },
            },
            required: ["capabilityId"],
            additionalProperties: false,
          },
        },
      },
    });

    const rawContent = response.choices?.[0]?.message?.content;
    if (!rawContent) {
      console.error("[ChainPlanner] single: empty LLM response");
      return { mode: "legacy" };
    }
    const content = typeof rawContent === "string" ? rawContent : JSON.stringify(rawContent);
    console.log("[ChainPlanner] single raw response:", content.slice(0, 300));

    const parsed = JSON.parse(content) as {
      capabilityId: string | null;
      args?: Record<string, unknown>;
    };

    if (!parsed.capabilityId) {
      return { mode: "legacy" };
    }

    const validIds = new Set(getAllCapabilities().map(c => c.id));
    if (!validIds.has(parsed.capabilityId as CapabilityId)) {
      console.warn("[ChainPlanner] single: unknown capabilityId:", parsed.capabilityId);
      return { mode: "legacy" };
    }

    return { mode: "single", capabilityId: parsed.capabilityId };
  } catch (err) {
    console.error("[ChainPlanner] single: Error:", err);
    return { mode: "legacy" };
  }
}
