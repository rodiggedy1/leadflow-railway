#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";

const input = path.resolve(process.env.MADISON_GOLDEN_DATASET ?? "golden-dataset/candidates.json");
const output = path.resolve(process.env.MADISON_GOLDEN_REVIEW ?? "golden-dataset/review-queue.md");
const dataset = JSON.parse(await fs.readFile(input, "utf8"));
const quote = (value) => String(value ?? "").replace(/\n/g, " ").trim();
const lines = [
  "# Madison Golden Dataset — Human Review Queue",
  "",
  "> **Do not edit the held-out cases (MADISON-041–MADISON-050).** The cases below are anonymized candidates. Your labels become ground truth only after you independently review and approve them.",
  "",
  `Generated: ${dataset.createdAt}`,
  `Total cases: ${dataset.scenarios.length} | Development: 40 | Held out: 10`,
  "",
  "## How to review each case",
  "",
  "1. Read the current inbound SMS first.",
  "2. Read context only when needed to interpret the current SMS.",
  "3. Record every explicit fact and copy exact evidence text from the current SMS.",
  "4. Record missing/conflicting information and both readiness decisions.",
  "5. Add forbidden operational actions; human approval remains required.",
  "6. After independent review, update the JSON case and set `approvalState` to `human_approved`.",
  "",
];

for (const scenario of dataset.scenarios) {
  lines.push(`---\n\n## ${scenario.caseId} — ${scenario.split === "held_out" ? "HELD OUT — DO NOT LABEL YET" : "DEVELOPMENT CASE"}`);
  lines.push("");
  lines.push(`- **Source draft:** ${scenario.sourceDraftId ?? "hidden"}`);
  lines.push(`- **Captured:** ${scenario.sourceCapturedAt}`);
  lines.push(`- **Observed message type:** ${scenario.sourceMetadataForLabeler?.observedMessageType ?? "unknown"}`);
  lines.push(`- **Observed draft status:** ${scenario.sourceMetadataForLabeler?.observedDraftStatus ?? "unknown"}`);
  lines.push("");
  lines.push("### Current inbound SMS");
  lines.push("");
  lines.push(`> ${quote(scenario.currentInboundMessage)}`);
  lines.push("");
  lines.push("### Bounded prior context");
  lines.push("");
  if (scenario.priorConversationContext.length === 0) {
    lines.push("_No bounded context captured._");
  } else {
    for (const message of scenario.priorConversationContext) {
      lines.push(`- **${message.role === "assistant" ? "Agent" : "Customer"}:** ${quote(message.content)}`);
    }
  }
  lines.push("");
  lines.push("### Human label — fill this in");
  lines.push("");
  lines.push("```text");
  lines.push("Intent/category:");
  lines.push("Mission:");
  lines.push("Facts (fact key | normalized value | exact evidence excerpt):");
  lines.push("- ");
  lines.push("Extraction completeness: COMPLETE / PARTIAL / NO_FACTS_PRESENT");
  lines.push("Task completeness:");
  lines.push("Missing information:");
  lines.push("Conflicting information:");
  lines.push("Target-resolution state:");
  lines.push("Reply readiness: READY / NOT_READY / UNKNOWN");
  lines.push("Action readiness: READY / NOT_READY / UNKNOWN");
  lines.push("Forbidden operational actions:");
  lines.push("Labeler ID:");
  lines.push("Review notes:");
  lines.push("Approval: candidate_unreviewed / human_approved / rejected");
  lines.push("```");
  lines.push("");
}

await fs.writeFile(output, `${lines.join("\n")}\n`, "utf8");
console.log(JSON.stringify({ output, cases: dataset.scenarios.length, development: dataset.scenarios.filter((s) => s.split === "development").length, heldOut: dataset.scenarios.filter((s) => s.split === "held_out").length }, null, 2));
