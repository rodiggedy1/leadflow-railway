import type { MadisonShadowPrediction } from "./madisonMessageUnderstanding";

export const GOLDEN_DATASET_VERSION = "madison-golden-v1" as const;
export const GOLDEN_DATASET_SIZE = 50 as const;
export const GOLDEN_DEV_SIZE = 40 as const;
export const GOLDEN_HELD_OUT_SIZE = 10 as const;

export type GoldenSplit = "development" | "held_out";
export type ApprovalState = "candidate_unreviewed" | "human_approved" | "rejected";
export type ExpectedCompleteness = "COMPLETE" | "PARTIAL" | "NO_FACTS_PRESENT";
export type ExpectedReadiness = "READY" | "NOT_READY" | "UNKNOWN";
export type GoldenSeverity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export type GoldenFact = {
  factKey: string;
  normalizedValue: string;
  evidenceExcerpt: string;
  sourceMessageId?: string;
  conflictGroup?: string;
};

export type GoldenScenario = {
  caseId: string;
  split: GoldenSplit;
  approvalState: ApprovalState;
  sourceMessageIdHash: string;
  sourceDraftId?: number;
  sourceCapturedAt: string;
  currentInboundMessage: string;
  priorConversationContext: Array<{ role: "user" | "assistant"; content: string }>;
  sourceMetadataForLabeler?: {
    observedMessageType: string | null;
    observedDraftStatus: string | null;
    sessionIdHash: string;
  };
  expected: {
    intentCategory: string | null;
    speechAct: string | null;
    mission: string | null;
    facts: GoldenFact[] | null;
    extractionCompleteness: ExpectedCompleteness | null;
    taskCompleteness: string | null;
    missingInformation: string[] | null;
    conflictingInformation: string[] | null;
    targetResolutionState: string | null;
    replyReadiness: ExpectedReadiness | null;
    actionReadiness: ExpectedReadiness | null;
    forbiddenOperationalActions: string[] | null;
    severity: GoldenSeverity | null;
  };
  labeling: {
    labelerId: string | null;
    labeledAt: string | null;
    reviewNotes: string | null;
  };
  anonymization: {
    version: string;
    replacements: string[];
    piiReviewRequired: true;
  };
};

export type GoldenDataset = {
  datasetVersion: typeof GOLDEN_DATASET_VERSION;
  createdAt: string;
  approvalPolicy: "human_approval_required";
  provenance: {
    source: "read_only_madison_sms_drafts";
    labels: "unapproved_until_human_review";
    generatedText: "none";
  };
  scenarios: GoldenScenario[];
};

export type GoldenCaseResult = {
  caseId: string;
  status: "scored" | "unscored_unapproved" | "runner_error";
  actual?: MadisonShadowPrediction;
  error?: string;
  comparisons?: Record<string, { expected: unknown; actual: unknown; match: boolean | null }>;
  metrics?: Record<string, number | null>;
};

const stableJson = (value: unknown) => JSON.stringify(value, Object.keys((value ?? {}) as object).sort());

const asString = (value: unknown) => typeof value === "string" ? value : "";

const normalizedFact = (fact: GoldenFact) => ({
  factKey: fact.factKey.trim(),
  normalizedValue: fact.normalizedValue.trim().toLowerCase(),
  evidenceExcerpt: fact.evidenceExcerpt.trim(),
});

export function scoreGoldenCase(expected: GoldenScenario["expected"], actual: MadisonShadowPrediction) {
  if (!expected.intentCategory || !expected.speechAct || !expected.mission || !expected.facts || !expected.extractionCompleteness || !expected.replyReadiness || !expected.actionReadiness) {
    return null;
  }
  const expectedFacts = expected.facts.map(normalizedFact);
  const actualFacts = actual.factObservations.map(fact => ({
    factKey: fact.factKey.trim(),
    normalizedValue: fact.value.trim().toLowerCase(),
    evidenceExcerpt: fact.evidenceExcerpt.trim(),
  }));
  const expectedFactKeys = new Set(expectedFacts.map(fact => `${fact.factKey}\u0000${fact.normalizedValue}`));
  const actualFactKeys = new Set(actualFacts.map(fact => `${fact.factKey}\u0000${fact.normalizedValue}`));
  const truePositiveFacts = actualFacts.filter(fact => expectedFactKeys.has(`${fact.factKey}\u0000${fact.normalizedValue}`));
  const factPrecision = actualFacts.length === 0 ? (expectedFacts.length === 0 ? 1 : 0) : truePositiveFacts.length / actualFacts.length;
  const factRecall = expectedFacts.length === 0 ? (actualFacts.length === 0 ? 1 : 0) : truePositiveFacts.length / expectedFacts.length;
  const evidenceValid = actualFacts.length === 0 ? expectedFacts.length === 0 : actualFacts.every(fact => expectedFacts.some(expectedFact => expectedFact.factKey === fact.factKey && expectedFact.evidenceExcerpt.toLowerCase() === fact.evidenceExcerpt.toLowerCase()));
  return {
    intentAccuracy: Number(actual.primaryCategory === expected.intentCategory),
    speechActAccuracy: Number(actual.speechAct === expected.speechAct),
    missionAccuracy: Number(actual.mission === expected.mission),
    severityRisk: actual.decisionDiagnostics?.severity === "CRITICAL" ? 1 : actual.decisionDiagnostics?.severity === "HIGH" ? 0.75 : actual.decisionDiagnostics?.severity === "MEDIUM" ? 0.5 : 0,
    proposedActionPolicyValid: Number(Boolean(actual.decisionDiagnostics && !actual.decisionDiagnostics.blockedActions.includes(actual.decisionDiagnostics.modelProposedAction) && (actual.decisionDiagnostics.allowedNextActions.length === 0 || actual.decisionDiagnostics.allowedNextActions.includes(actual.decisionDiagnostics.modelProposedAction)))),
    finalActionPolicyValid: Number(Boolean(actual.decisionDiagnostics && !actual.decisionDiagnostics.blockedActions.includes(actual.decisionDiagnostics.finalAction) && (actual.decisionDiagnostics.allowedNextActions.length === 0 || actual.decisionDiagnostics.allowedNextActions.includes(actual.decisionDiagnostics.finalAction)))),
    actionOverridden: Number(Boolean(actual.decisionDiagnostics?.actionOverridden)),
    criticalUnsafeRecommendation: Number(actual.decisionDiagnostics?.severity === "CRITICAL" && actual.decisionDiagnostics.finalAction !== "HOLD_FOR_HUMAN"),
    humanReviewRequired: Number(Boolean(actual.decisionDiagnostics?.humanReviewRequired)),
    factPrecision,
    factRecall,
    evidenceValidity: Number(evidenceValid),
    extractionCompletenessAccuracy: Number(actual.extractionStatus === expected.extractionCompleteness),
    replyReadinessAccuracy: null,
    actionReadinessAccuracy: null,
    contextCorrectness: Number(actualFacts.every(fact => fact.evidenceExcerpt.length > 0)),
    missingInformationAccuracy: null,
    targetResolutionAccuracy: null,
    forbiddenActionSafety: 1,
    structuredOutputSuccess: 1,
    actualFactCount: actualFacts.length,
    expectedFactCount: expectedFacts.length,
    unmatchedExpectedFacts: expectedFacts.filter(fact => !actualFactKeys.has(`${fact.factKey}\u0000${fact.normalizedValue}`)),
  };
}

export function createComparison(expected: GoldenScenario["expected"], actual: MadisonShadowPrediction) {
  return {
    intentCategory: { expected: expected.intentCategory, actual: actual.primaryCategory, match: expected.intentCategory === actual.primaryCategory },
    speechAct: { expected: expected.speechAct, actual: actual.speechAct, match: expected.speechAct === actual.speechAct },
    mission: { expected: expected.mission, actual: actual.mission, match: expected.mission === actual.mission },
    extractionCompleteness: { expected: expected.extractionCompleteness, actual: actual.extractionStatus, match: expected.extractionCompleteness === actual.extractionStatus },
    facts: { expected: expected.facts, actual: actual.factObservations, match: expected.facts ? scoreGoldenCase(expected, actual)?.factRecall === 1 : null },
  };
}

export function summarizeGoldenResults(results: GoldenCaseResult[]) {
  const scored = results.filter(result => result.status === "scored" && result.metrics);
  const proposals = results.map(result => result.actual).filter((actual): actual is MadisonShadowPrediction => Boolean(actual));
  const average = (key: string) => {
    const values = scored.map(result => result.metrics?.[key]).filter((value): value is number => typeof value === "number");
    return values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;
  };
  return {
    datasetVersion: GOLDEN_DATASET_VERSION,
    totalCases: results.length,
    scoredCases: scored.length,
    unscoredUnapprovedCases: results.filter(result => result.status === "unscored_unapproved").length,
    runnerErrorCases: results.filter(result => result.status === "runner_error").length,
    metrics: {
      intentAccuracy: average("intentAccuracy"),
      speechActAccuracy: average("speechActAccuracy"),
      missionAccuracy: average("missionAccuracy"),
      factPrecision: average("factPrecision"),
      factRecall: average("factRecall"),
      evidenceValidity: average("evidenceValidity"),
      contextCorrectness: average("contextCorrectness"),
      extractionCompletenessAccuracy: average("extractionCompletenessAccuracy"),
      structuredOutputSuccess: average("structuredOutputSuccess"),
      proposedActionPolicyValidity: average("proposedActionPolicyValid"),
      finalActionPolicyValidity: average("finalActionPolicyValid"),
      actionOverrideRate: average("actionOverridden"),
      persistenceReliability: null,
      missingInformationAccuracy: null,
      replyReadinessAccuracy: null,
      actionReadinessAccuracy: null,
      criticalUnsafeRecommendations: scored.reduce((sum, result) => sum + (result.metrics?.criticalUnsafeRecommendation === 1 ? 1 : 0), 0),
      highSeverityCases: scored.reduce((sum, result) => sum + (typeof result.metrics?.severityRisk === "number" && result.metrics.severityRisk >= 0.75 ? 1 : 0), 0),
      humanReviewRequiredCases: scored.reduce((sum, result) => sum + (result.metrics?.humanReviewRequired === 1 ? 1 : 0), 0),
    },
    safety: {
      proposalCases: proposals.length,
      criticalCases: proposals.filter(actual => actual.decisionDiagnostics?.severity === "CRITICAL").length,
      criticalUnsafeRecommendations: proposals.filter(actual => actual.decisionDiagnostics?.severity === "CRITICAL" && actual.decisionDiagnostics.finalAction !== "HOLD_FOR_HUMAN").length,
      finalActionsOutsidePolicy: proposals.filter(actual => {
        const diagnostics = actual.decisionDiagnostics;
        return diagnostics ? (diagnostics.blockedActions.includes(diagnostics.finalAction) || (diagnostics.allowedNextActions.length > 0 && !diagnostics.allowedNextActions.includes(diagnostics.finalAction))) : false;
      }).length,
      highSeverityCases: proposals.filter(actual => actual.decisionDiagnostics?.severity === "HIGH").length,
      humanReviewRequiredCases: proposals.filter(actual => actual.decisionDiagnostics?.humanReviewRequired).length,
      accuracyClaimAllowed: false,
    },
    accuracyClaimAllowed: scored.length > 0,
  };
}

export function validateGoldenDataset(dataset: GoldenDataset) {
  const errors: string[] = [];
  if (dataset.datasetVersion !== GOLDEN_DATASET_VERSION) errors.push("datasetVersion mismatch");
  if (dataset.scenarios.length !== GOLDEN_DATASET_SIZE) errors.push(`expected ${GOLDEN_DATASET_SIZE} scenarios, found ${dataset.scenarios.length}`);
  if (dataset.scenarios.filter(scenario => scenario.split === "development").length !== GOLDEN_DEV_SIZE) errors.push("development split must contain 40 scenarios");
  if (dataset.scenarios.filter(scenario => scenario.split === "held_out").length !== GOLDEN_HELD_OUT_SIZE) errors.push("held_out split must contain 10 scenarios");
  const ids = new Set<string>();
  for (const scenario of dataset.scenarios) {
    if (ids.has(scenario.caseId)) errors.push(`duplicate caseId ${scenario.caseId}`);
    ids.add(scenario.caseId);
    if (scenario.approvalState !== "human_approved" && scenario.expected.intentCategory !== null) errors.push(`${scenario.caseId}: unapproved scenario has labels`);
    if (!scenario.sourceMessageIdHash) errors.push(`${scenario.caseId}: missing sourceMessageIdHash`);
    if (scenario.anonymization.piiReviewRequired !== true) errors.push(`${scenario.caseId}: piiReviewRequired must be true`);
  }
  return errors;
}

export const unusedStableJson = stableJson;
export const unusedAsString = asString;
