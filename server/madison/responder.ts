/**
 * responder.ts
 *
 * Phrases the deterministic ReadinessProjection as a natural-language answer.
 * The LLM's role is ONLY to explain and summarize — it must not invent statuses,
 * calculate readiness, or change any business facts.
 */

import { invokeLLM } from "../_core/llm";
import type { ReadinessProjection } from "./types";

const RESPONDER_SYSTEM_PROMPT = `You are Madison, an AI operations assistant for a residential cleaning company.

You are given a structured readiness projection. Your job is to explain it clearly and concisely to the operations manager.

Critical rules:
- Do NOT invent, infer, or change any status in the data
- Do NOT calculate percentages or scores — they are already in the data
- Do NOT add information not present in the projection
- Be direct and actionable — the manager needs to act, not read an essay
- Use the exact customer names, times, and statuses from the data
- If there are no issues, say so clearly
- If a filter was applied, acknowledge it briefly
- Format as plain text — no markdown headers, no bullet symbols, just clear sentences
- Keep the response under 300 words unless there are many jobs to list`;

export async function projectResponse(
  projection: ReadinessProjection,
  originalMessage: string
): Promise<string> {
  const projectionJson = JSON.stringify(projection, null, 2);

  const userPrompt = `The operations manager asked: "${originalMessage}"

Here is the deterministic readiness projection:
${projectionJson}

Summarize this for the manager. Be direct and actionable.`;

  try {
    const response = await invokeLLM({
      messages: [
        { role: "system", content: RESPONDER_SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
    });

    return (
      response.choices?.[0]?.message?.content ??
      "I was unable to generate a summary. Please check the readiness drawer for full details."
    );
  } catch {
    // Fallback: generate a plain-text summary deterministically
    return buildFallbackSummary(projection);
  }
}

function buildFallbackSummary(p: ReadinessProjection): string {
  const dateStr = new Date(p.date + "T12:00:00").toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  if (p.filteredJobs === 0) {
    return `No jobs found for ${dateStr}${p.appliedFilter ? ` (${p.appliedFilter})` : ""}.`;
  }

  const parts: string[] = [];
  parts.push(
    `${dateStr}: ${p.filteredJobs} job${p.filteredJobs !== 1 ? "s" : ""}${p.appliedFilter ? ` (${p.appliedFilter})` : ""}.`
  );

  if (p.summary.unassigned > 0)
    parts.push(`${p.summary.unassigned} unassigned.`);
  if (p.summary.unconfirmed > 0)
    parts.push(`${p.summary.unconfirmed} unconfirmed.`);
  if (p.summary.noPayment > 0)
    parts.push(`${p.summary.noPayment} with no payment on file.`);
  if (p.summary.atRisk > 0)
    parts.push(`${p.summary.atRisk} at risk (2+ issues).`);

  if (
    p.summary.unassigned === 0 &&
    p.summary.unconfirmed === 0 &&
    p.summary.noPayment === 0
  ) {
    parts.push("No issues found.");
  }

  return parts.join(" ");
}
