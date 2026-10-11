import fs from "node:fs/promises";
import path from "node:path";
import { classifyMadisonMessageShadow } from "../server/madisonMessageUnderstanding";
import {
  type GoldenDataset,
  type GoldenCaseResult,
  createComparison,
  scoreGoldenCase,
  summarizeGoldenResults,
  validateGoldenDataset,
} from "../server/madisonGoldenDataset";

const args = new Set(process.argv.slice(2));
const datasetPath = path.resolve(process.env.MADISON_GOLDEN_DATASET ?? "golden-dataset/candidates.json");
const outputPath = path.resolve(process.env.MADISON_GOLDEN_OUTPUT ?? "golden-dataset/latest-evaluation.json");
const includeUnapproved = args.has("--include-unapproved");
const heldOutOnly = args.has("--held-out-only");
const developmentOnly = args.has("--development-only");

const dataset = JSON.parse(await fs.readFile(datasetPath, "utf8")) as GoldenDataset;
const validationErrors = validateGoldenDataset(dataset);
if (validationErrors.length > 0) {
  throw new Error(`Invalid Golden Dataset:\n${validationErrors.join("\n")}`);
}

const selected = dataset.scenarios.filter(scenario =>
  (!heldOutOnly || scenario.split === "held_out") &&
  (!developmentOnly || scenario.split === "development")
);
const results: GoldenCaseResult[] = [];

console.log(JSON.stringify({
  datasetPath,
  selectedCases: selected.length,
  includeUnapproved,
  developmentOnly,
  providerPath: "classifyMadisonMessageShadow -> invokeLLM -> direct OpenAI Chat Completions",
  modelContract: "gpt-4o",
  railwayIdentity: {
    environmentName: process.env.RAILWAY_ENVIRONMENT_NAME ?? null,
    serviceName: process.env.RAILWAY_SERVICE_NAME ?? null,
    deploymentId: process.env.RAILWAY_DEPLOYMENT_ID ?? null,
    commitSha: process.env.RAILWAY_GIT_COMMIT_SHA ?? null,
  },
  sideEffects: "none: no persistence, SMS, booking mutation, approval, or production fact events",
}, null, 2));

for (const scenario of selected) {
  if (scenario.approvalState !== "human_approved" && !includeUnapproved) {
    results.push({ caseId: scenario.caseId, status: "unscored_unapproved" });
    continue;
  }
  try {
    const actual = await classifyMadisonMessageShadow({
      inboundText: scenario.currentInboundMessage,
      conversationMessages: scenario.priorConversationContext,
    });
    const scored = scenario.approvalState === "human_approved" ? scoreGoldenCase(scenario.expected, actual) : null;
    results.push({
      caseId: scenario.caseId,
      status: scored ? "scored" : "unscored_unapproved",
      actual,
      comparisons: scored ? createComparison(scenario.expected, actual) : undefined,
      metrics: scored ?? undefined,
    });
    const lowConfidence = actual.confidence < 0.75 || actual.primaryCategory === "AMBIGUOUS" || actual.mission === "UNRESOLVED" || actual.extractionStatus !== "COMPLETE" || actual.factObservations.some(fact => !scenario.currentInboundMessage.toLowerCase().includes(fact.evidenceExcerpt.trim().toLowerCase()));
    console.log(JSON.stringify({ caseId: scenario.caseId, status: scored ? "scored" : "ai_proposal_unapproved", model: actual.model, confidence: actual.confidence, category: actual.primaryCategory, mission: actual.mission, speechAct: actual.speechAct, extractionStatus: actual.extractionStatus, factCount: actual.factObservations.length, severity: actual.decisionDiagnostics?.severity ?? "UNKNOWN", reasonCodes: actual.decisionDiagnostics?.reasonCodes ?? [], criticalUnsafeRecommendation: actual.decisionDiagnostics?.severity === "CRITICAL" && (actual.decisionDiagnostics?.allowedNextActions ?? []).some(action => action !== "HOLD_FOR_HUMAN"), reviewPriority: lowConfidence || actual.decisionDiagnostics?.humanReviewRequired ? "HIGH" : "NORMAL" }, null, 2));
  } catch (error) {
    results.push({
      caseId: scenario.caseId,
      status: "runner_error",
      error: error instanceof Error ? error.message : String(error),
    });
    console.error(JSON.stringify({ caseId: scenario.caseId, status: "runner_error", error: error instanceof Error ? error.message : String(error) }, null, 2));
  }
}

const report = {
  reportVersion: "madison-golden-evaluation-v1",
  generatedAt: new Date().toISOString(),
  datasetPath,
  approvalPolicy: "Only human_approved cases may be scored. Unapproved cases are never used for accuracy claims.",
  runtime: {
    model: "gpt-4o",
    providerPath: "classifyMadisonMessageShadow -> invokeLLM -> https://api.openai.com/v1/chat/completions",
    openAiKeyPresence: process.env.OPENAI_API_KEY ? "present" : "missing",
    environmentName: process.env.RAILWAY_ENVIRONMENT_NAME ?? "local",
    serviceName: process.env.RAILWAY_SERVICE_NAME ?? "unknown",
    deploymentId: process.env.RAILWAY_DEPLOYMENT_ID ?? "unknown",
    commitSha: process.env.RAILWAY_GIT_COMMIT_SHA ?? "unknown",
  },
  summary: summarizeGoldenResults(results),
  results,
};
await fs.writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ outputPath, summary: report.summary }, null, 2));
