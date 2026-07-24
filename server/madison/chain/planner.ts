/**
 * server/madison/chain/planner.ts
 *
 * Chain Planner — uses the LLM to convert a natural-language message into an
 * ExecutionPlan (ordered list of capability steps with resolved args and data refs).
 *
 * The planner knows about capabilities but not about business logic.
 * It only produces a plan — it does not execute anything.
 */

import type { ExecutionPlan, CapabilityId, ChainRoutingDecision } from "./types";
import { getAllCapabilities } from "./registry";
import { invokeLLM } from "../../_core/llm";
import { getTodayET } from "../../conciergeTime";

// ── Capability catalog for the planner prompt ─────────────────────────────────

/**
 * Builds a capability catalog that includes both input args AND output schemas,
 * so the LLM can reason about data flow between steps from contracts alone.
 */
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
          '  outputs: { unconfirmed: [{phone, name, jobId}], alreadySent: [{phone, name}] }',
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
          '  inputs:  { recipients: [{phone, name}], message: string }',
          '  outputs: { results: [{name, success}] }',
        ].join("\n");
        break;
    }
    return `### ${c.id} (${c.isWrite ? "WRITE" : "READ"})\n${c.label}\n${contract}`;
  }).join("\n\n");
}

// ── Routing decision (single LLM pass) ───────────────────────────────────────

export async function planChainRouting(
  message: string,
  businessDate: string = getTodayET(),
): Promise<ChainRoutingDecision> {
  const catalog = buildCapabilityCatalog();

  const systemPrompt = `You are the Madison command planner for a cleaning business operations tool.
Today's date is ${businessDate}.

Analyze the message and decide how to route it:

- mode="legacy"  — general question, lookup, or conversational; not a command to execute capabilities
- mode="single"  — exactly one capability from the registry is needed
- mode="chain"   — two or more capabilities are needed, possibly with data flowing between steps

CAPABILITY REGISTRY:
${catalog}

DATA REFERENCES:
A step can consume the output of a prior step using dataRefs.
Format: "dataRefs": { "<inputKey>": { "fromStep": "<step-id>", "path": "<dot.path.into.output>" } }
Use this when the user's intent requires the output of one capability as the input to another.

Return ONLY valid JSON:
{
  "mode": "legacy" | "single" | "chain",
  "capabilityId": "<id>",          // only when mode="single"
  "plan": {                         // only when mode="chain"
    "summary": "one sentence",
    "hasWrites": boolean,
    "steps": [
      {
        "id": "step-1",
        "capabilityId": "<id>",
        "label": "Human-readable label",
        "args": { /* static args */ },
        "dataRefs": { /* optional */ },
        "onFailure": "halt" | "continue"
      }
    ]
  }
}`;

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
          name: "chain_routing",
          strict: false,
          schema: {
            type: "object",
            properties: {
              mode: { type: "string", enum: ["legacy", "single", "chain"] },
              capabilityId: { type: "string" },
              plan: {
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
            required: ["mode"],
            additionalProperties: false,
          },
        },
      },
    });

    const rawContent = response.choices?.[0]?.message?.content;
    if (!rawContent) return { mode: "legacy" };
    const content = typeof rawContent === "string" ? rawContent : JSON.stringify(rawContent);

    console.log("[ChainPlanner] raw response:", content.slice(0, 600));

    const parsed = JSON.parse(content) as {
      mode: "legacy" | "single" | "chain";
      capabilityId?: string;
      plan?: {
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
    };

    if (parsed.mode === "single") {
      return { mode: "single", capabilityId: parsed.capabilityId };
    }

    if (parsed.mode !== "chain" || !parsed.plan) {
      return { mode: parsed.mode as "legacy" };
    }

    // Validate capability IDs — log any unrecognised ones
    const validIds = new Set(getAllCapabilities().map(c => c.id));
    const validSteps = parsed.plan.steps.filter(s => {
      const ok = validIds.has(s.capabilityId as CapabilityId);
      if (!ok) console.warn("[ChainPlanner] unknown capabilityId:", s.capabilityId);
      return ok;
    });

    if (validSteps.length < 2) {
      console.warn("[ChainPlanner] not enough valid steps, falling back to legacy. steps:", parsed.plan.steps.map(s => s.capabilityId));
      return { mode: "legacy" };
    }

    const plan: ExecutionPlan = {
      summary: parsed.plan.summary,
      hasWrites: parsed.plan.hasWrites,
      steps: validSteps.map(s => ({
        id: s.id,
        capabilityId: s.capabilityId as CapabilityId,
        label: s.label,
        args: s.args ?? {},
        dataRefs: s.dataRefs,
        onFailure: s.onFailure,
      })),
    };

    return { mode: "chain", plan };
  } catch (err) {
    console.error("[ChainPlanner] Error:", err);
    return { mode: "legacy" };
  }
}
