import type { AiActionMode } from "./aiActionPolicy";
import {
  CURRENT_MADISON_EVALUATION_VERSIONS,
  type MadisonActionReadiness,
  type MadisonEvaluationVersions,
  type MadisonExtractionStatus,
  type MadisonExtractionValidation,
  type MadisonPredictionState,
  type MadisonReplyEvaluationStatus,
  type MadisonReplyReadiness,
  type MadisonTaskCompleteness,
} from "./madisonEvaluationContracts";

export type MadisonConfidenceBand = "low" | "medium" | "high";
export type MadisonDecisionOutcome =
  | "recommendation_only"
  | "ready_for_human_approval"
  | "clarification_required"
  | "blocked_missing_facts"
  | "blocked_unresolved_target"
  | "blocked_policy_disabled"
  | "blocked_confidence";
export type MadisonDecisionActionKey = "create_support_task" | "send_sms_reply";
export type MadisonTargetResolution = "resolved" | "partial" | "unresolved";

export type MadisonDecisionEvaluation = {
  confidence: number | null;
  confidenceBand: MadisonConfidenceBand | null;
  confidenceSource: "shadow" | "structured_decision" | "fallback" | null;
  predictionState: MadisonPredictionState;
  actionKey: MadisonDecisionActionKey;
  policyMode: AiActionMode;
  policyEnabled: boolean;
  targetResolution: MadisonTargetResolution;
  requiredFactsPresent: boolean;
  missingFacts: string[];
  currentStateVerified: boolean;
  riskLevel: "medium";
  outcome: MadisonDecisionOutcome;
  actionReadiness: MadisonActionReadiness;
  replyEvaluationStatus: MadisonReplyEvaluationStatus;
  replyReadiness: MadisonReplyReadiness;
  extractionStatus: MadisonExtractionStatus;
  extractionValidation: MadisonExtractionValidation;
  taskCompleteness: MadisonTaskCompleteness;
  reasonCodes: string[];
  evaluatedAt: string;
  evaluatorVersion: "independent-readiness-v1";
  versions: MadisonEvaluationVersions;
};

export type EvaluateMadisonDecisionInput = {
  actionKey: MadisonDecisionActionKey;
  confidence?: number | string | null;
  confidenceSource?: Exclude<MadisonDecisionEvaluation["confidenceSource"], null>;
  predictionState?: MadisonPredictionState;
  policyMode: AiActionMode;
  policyEnabled: boolean;
  targetResolution: MadisonTargetResolution;
  requiredFactsPresent: boolean;
  missingFacts?: string[];
  currentStateVerified: boolean;
  replyEvaluationStatus?: MadisonReplyEvaluationStatus;
  replySafety?: "safe" | "unsafe";
  extractionStatus?: MadisonExtractionStatus;
  extractionValidation?: MadisonExtractionValidation;
  taskCompleteness?: MadisonTaskCompleteness;
  versions?: Partial<MadisonEvaluationVersions>;
  now?: Date;
};

function normalizeConfidence(value: EvaluateMadisonDecisionInput["confidence"]): number | null {
  const numeric = typeof value === "string" ? Number(value) : value;
  if (typeof numeric !== "number" || !Number.isFinite(numeric)) return null;
  return Math.max(0, Math.min(1, numeric));
}

export function getMadisonConfidenceBand(confidence: number): MadisonConfidenceBand {
  if (confidence >= 0.9) return "high";
  if (confidence >= 0.7) return "medium";
  return "low";
}

function mergeVersions(overrides?: Partial<MadisonEvaluationVersions>): MadisonEvaluationVersions {
  return { ...CURRENT_MADISON_EVALUATION_VERSIONS, ...(overrides ?? {}) };
}

/**
 * Deterministic review routing only. This function never sends, mutates, or
 * creates an issue; server approval mutations remain the execution gates.
 */
export function evaluateMadisonDecision(input: EvaluateMadisonDecisionInput): MadisonDecisionEvaluation {
  const predictionState = input.predictionState ?? "succeeded";
  const hasPrediction = predictionState === "succeeded";
  const confidence = hasPrediction ? normalizeConfidence(input.confidence) : null;
  const confidenceBand = confidence === null ? null : getMadisonConfidenceBand(confidence);
  const missingFacts = Array.from(new Set((input.missingFacts ?? []).filter(Boolean)));
  const replyEvaluationStatus = input.replyEvaluationStatus ?? "completed";
  const extractionStatus = input.extractionStatus ?? (hasPrediction ? "completed" : "not_available");
  const extractionValidation = input.extractionValidation ?? (hasPrediction ? "structurally_valid" : "not_evaluated");
  const taskCompleteness = input.taskCompleteness ?? (missingFacts.length > 0 ? "insufficient_for_next_step" : "sufficient_for_next_step");
  const reasons: string[] = [];
  let outcome: MadisonDecisionOutcome;
  let actionReadiness: MadisonActionReadiness;
  let replyReadiness: MadisonReplyReadiness;

  if (!input.policyEnabled) {
    outcome = "blocked_policy_disabled";
    actionReadiness = "not_ready_policy";
    replyReadiness = "not_applicable";
    reasons.push("policy_disabled");
  } else if (input.actionKey === "send_sms_reply") {
    actionReadiness = "action_not_applicable";
    if (input.replySafety === "unsafe") {
      outcome = "blocked_confidence";
      replyReadiness = "unsafe_draft";
      reasons.push("unsafe_draft");
    } else if (replyEvaluationStatus !== "completed") {
      outcome = "recommendation_only";
      replyReadiness = "not_evaluated";
      reasons.push(`reply_evaluation_${replyEvaluationStatus}`);
    } else if (input.policyMode === "suggest_only") {
      outcome = "recommendation_only";
      replyReadiness = "reviewable";
      reasons.push("policy_suggest_only");
    } else if (input.policyMode === "automatic") {
      outcome = "blocked_confidence";
      replyReadiness = "reviewable";
      reasons.push("automatic_execution_not_enabled_for_sms_replies");
    } else if (input.targetResolution === "unresolved" && input.requiredFactsPresent === false) {
      outcome = "ready_for_human_approval";
      replyReadiness = "reviewable";
      reasons.push("reply_reviewable_target_unresolved");
    } else {
      outcome = "ready_for_human_approval";
      replyReadiness = taskCompleteness === "conflicting_for_next_step" ? "clarification_needed" : "reviewable";
      if (replyReadiness === "clarification_needed") reasons.push("conflicting_customer_information");
    }
  } else if (input.targetResolution === "unresolved") {
    outcome = "blocked_unresolved_target";
    actionReadiness = "not_ready_target_verification";
    replyReadiness = "not_applicable";
    reasons.push("target_unresolved");
  } else if (!hasPrediction && !input.currentStateVerified) {
    outcome = "blocked_confidence";
    actionReadiness = "not_ready_insufficient_evidence";
    replyReadiness = "not_applicable";
    reasons.push("prediction_unavailable", "current_state_not_verified");
  } else if (!input.currentStateVerified) {
    outcome = "blocked_confidence";
    actionReadiness = "not_ready_insufficient_evidence";
    replyReadiness = "not_applicable";
    reasons.push("current_state_not_verified");
  } else if (confidence === null || confidenceBand === "low") {
    outcome = "blocked_confidence";
    actionReadiness = "not_ready_insufficient_evidence";
    replyReadiness = "not_applicable";
    reasons.push(confidence === null ? "confidence_unavailable" : "confidence_below_review_threshold");
  } else if (!input.requiredFactsPresent || missingFacts.length > 0) {
    outcome = "blocked_missing_facts";
    actionReadiness = "not_ready_missing_information";
    replyReadiness = "not_applicable";
    reasons.push("review_missing_facts");
  } else if (input.policyMode === "automatic") {
    outcome = "blocked_confidence";
    actionReadiness = "not_ready_policy";
    replyReadiness = "not_applicable";
    reasons.push("automatic_execution_not_enabled_for_support_tasks");
  } else if (input.policyMode === "suggest_only") {
    outcome = "recommendation_only";
    actionReadiness = "not_ready_policy";
    replyReadiness = "not_applicable";
    reasons.push("policy_suggest_only");
  } else {
    outcome = "ready_for_human_approval";
    actionReadiness = "ready_for_human_action_approval";
    replyReadiness = "not_applicable";
    if (input.targetResolution === "partial") reasons.push("manual_target_lookup_may_be_required");
  }

  if (!hasPrediction) reasons.unshift(`prediction_${predictionState}`);
  if (hasPrediction && confidenceBand === "low" && input.actionKey === "create_support_task") {
    reasons.push("confidence_below_review_threshold");
  }

  return {
    confidence,
    confidenceBand,
    confidenceSource: hasPrediction ? input.confidenceSource ?? "fallback" : null,
    predictionState,
    actionKey: input.actionKey,
    policyMode: input.policyMode,
    policyEnabled: input.policyEnabled,
    targetResolution: input.targetResolution,
    requiredFactsPresent: input.requiredFactsPresent,
    missingFacts,
    currentStateVerified: input.currentStateVerified,
    riskLevel: "medium",
    outcome,
    actionReadiness,
    replyEvaluationStatus,
    replyReadiness,
    extractionStatus,
    extractionValidation,
    taskCompleteness,
    reasonCodes: Array.from(new Set(reasons)),
    evaluatedAt: (input.now ?? new Date()).toISOString(),
    evaluatorVersion: "independent-readiness-v1",
    versions: mergeVersions(input.versions),
  };
}
