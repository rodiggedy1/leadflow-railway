/**
 * server/madison/chain/planner.ts
 *
 * Chain Planner — uses the LLM to convert a natural-language message into an
 * ExecutionPlan (ordered list of capability steps with resolved args and data refs).
 *
 * The planner knows about capabilities but not about business logic.
 * It only produces a plan — it does not execute anything.
 */

import type { ExecutionPlan, PlannedStep, CapabilityId, ChainRoutingDecision } from "./types";
import { getAllCapabilities } from "./registry";
import { invokeLLM } from "../../_core/llm";
import { getTodayET } from "../../conciergeTime";
import { randomUUID } from "crypto";

// ── Capability catalog for the planner prompt ─────────────────────────────────

function buildCapabilityCatalog(): string {
  const caps = getAllCapabilities();
  return caps.map(c => {
    let argDocs = "";
    switch (c.id) {
      case "readiness.compute":
        argDocs = '{ date?: "YYYY-MM-DD" }';
        break;
      case "confirmations.queryStatus":
        argDocs = '{ date?: "YYYY-MM-DD" }';
        break;
      case "payments.queryCardStatus":
        argDocs = '{ date?: "YYYY-MM-DD" }';
        break;
      case "payments.sendLink":
        argDocs = '{ recipients?: [{phone, name, jobId?}], phone?: string, name?: string, date?: "YYYY-MM-DD" }';
        break;
      case "communications.sendSms":
        argDocs = '{ phone: string, name: string, message: string }';
        break;
      case "communications.sendBulkSms":
        argDocs = '{ recipients: [{phone, name}], message: string }';
        break;
    }
    return `- ${c.id} (${c.isWrite ? "WRITE" : "READ"}): ${c.label}\n  args: ${argDocs}`;
  }).join("\n");
}

// ── Routing decision (single LLM pass) ───────────────────────────────────────

/**
 * Determines whether the message is:
 * - "legacy": single-domain, route to existing concierge handler
 * - "single": single capability, route to existing handler (no chain needed)
 * - "chain": multiple capabilities, build an execution plan
 *
 * For "chain" mode, also returns the full ExecutionPlan.
 */
export async function planChainRouting(
  message: string,
  businessDate: string = getTodayET(),
): Promise<ChainRoutingDecision> {
  const catalog = buildCapabilityCatalog();

  const systemPrompt = `You are the Madison command planner for a cleaning business operations tool.
Today's date is ${businessDate}.

Your job is to analyze a message and decide how to route it:

1. If the message asks for a SINGLE capability from the registry below, return mode="single".
2. If the message asks for MULTIPLE capabilities (uses "and", "also", "both", "everyone without", or clearly implies multiple actions), return mode="chain" with a full plan.
3. If the message is a general question, lookup, or conversational (not a command to execute capabilities), return mode="legacy".

CAPABILITY REGISTRY:
${catalog}

DATA REFERENCES: Steps can reference prior step outputs using dataRefs.
Example: "send payment links to everyone without a card" requires:
  Step 1: payments.queryCardStatus → produces { noCard: [{phone, name}] }
  Step 2: payments.sendLink with dataRef: { recipients: { fromStep: "step-1", path: "noCard" } }

RULES:
- Only use capabilities from the registry. Never invent new ones.
- For "send payment links to no-card jobs", always chain queryCardStatus → sendLink.
- For "send confirmation reminders to unconfirmed jobs", chain confirmations.queryStatus → communications.sendBulkSms with a dataRef on unconfirmed.
- For read-only queries (card status, confirmation status, readiness), mode="single" unless combined with writes.
- If you're unsure, prefer mode="legacy".

Return ONLY valid JSON matching this schema:
{
  "mode": "legacy" | "single" | "chain",
  "plan": {  // only present when mode="chain"
    "summary": "string — one sentence describing what will happen",
    "hasWrites": boolean,
    "steps": [
      {
        "id": "step-1",
        "capabilityId": "capability.id",
        "label": "Human-readable step label",
        "args": { /* static args */ },
        "dataRefs": { /* optional: { argKey: { fromStep: "step-id", path: "dot.path" } } */ },
        "onFailure": "halt" | "continue"  // optional, defaults to capability default
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
          strict: true,
          schema: {
            type: "object",
            properties: {
              mode: { type: "string", enum: ["legacy", "single", "chain"] },
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

    console.log("[ChainPlanner] raw response:", content.slice(0, 500));
    const parsed = JSON.parse(content) as {
      mode: "legacy" | "single" | "chain";
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

    if (parsed.mode !== "chain" || !parsed.plan) {
      return { mode: parsed.mode };
    }

    // Validate capability IDs
    const validIds = new Set(getAllCapabilities().map(c => c.id));
    const validSteps = parsed.plan.steps.filter(s => validIds.has(s.capabilityId as CapabilityId));

    if (validSteps.length < 2) {
      // Not enough valid steps for a chain — fall back to legacy
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

// isObviouslyLegacy removed — the planner is the single source of truth for routing.
