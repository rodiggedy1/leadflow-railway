import type { AiActionMode } from "./aiActionPolicy";

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

export type MadisonDecisionEvaluation = {
  confidence: number;
  confidenceBand: MadisonConfidenceBand;
  confidenceSource: "shadow" | "structured_decision" | "fallback";
  actionKey: MadisonDecisionActionKey;
  policyMode: AiActionMode;
  policyEnabled: boolean;
  targetResolution: "resolved" | "partial" | "unresolved";
  requiredFactsPresent: boolean;
  missingFacts: string[];
  currentStateVerified: boolean;
  riskLevel: "medium";
  outcome: MadisonDecisionOutcome;
  reasonCodes: string[];
  evaluatedAt: string;
  evaluatorVersion: "confidence-v1";
};

export type EvaluateMadisonDecisionInput = {
  actionKey: MadisonDecisionActionKey;
  confidence?: number | string | null;
  confidenceSource?: MadisonDecisionEvaluation["confidenceSource"];
  policyMode: AiActionMode;
  policyEnabled: boolean;
  targetResolution: MadisonDecisionEvaluation["targetResolution"];
  requiredFactsPresent: boolean;
  missingFacts?: string[];
  currentStateVerified: boolean;
  now?: Date;
};

function normalizeConfidence(value: EvaluateMadisonDecisionInput["confidence"]): number {
  const numeric = typeof value === "string" ? Number(value) : value;
  if (typeof numeric !== "number" || !Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.min(1, numeric));
}

export function getMadisonConfidenceBand(confidence: number): MadisonConfidenceBand {
  if (confidence >= 0.9) return "high";
  if (confidence >= 0.7) return "medium";
  return "low";
}

/**
 * Deterministic review routing only. This function never sends, mutates, or
 * creates an issue; the server approval mutation remains the execution gate.
 */
export function evaluateMadisonDecision(input: EvaluateMadisonDecisionInput): MadisonDecisionEvaluation {
  const confidence = normalizeConfidence(input.confidence);
  const confidenceBand = getMadisonConfidenceBand(confidence);
  const missingFacts = [...new Set((input.missingFacts ?? []).filter(Boolean))];
  const reasons: string[] = [];
  let outcome: MadisonDecisionOutcome;

  if (!input.policyEnabled) {
    outcome = "blocked_policy_disabled";
    reasons.push("policy_disabled");
  } else if (input.targetResolution === "unresolved") {
    outcome = "blocked_unresolved_target";
    reasons.push("target_unresolved");
  } else if (!input.currentStateVerified) {
    outcome = "blocked_confidence";
    reasons.push("current_state_not_verified");
  } else if (confidenceBand === "low") {
    outcome = "clarification_required";
    reasons.push("confidence_below_review_threshold");
  } else if (input.policyMode === "automatic") {
    outcome = "blocked_confidence";
    reasons.push(`automatic_execution_not_enabled_for_${input.actionKey === "send_sms_reply" ? "sms_replies" : "support_tasks"}`);
  } else if (input.policyMode === "suggest_only") {
    outcome = "recommendation_only";
    reasons.push("policy_suggest_only");
  } else {
    // Support-task proposals intentionally remain useful when a human must
    // look up a booking manually. Missing facts are recorded for the reviewer
    // but do not authorize a booking mutation.
    outcome = "ready_for_human_approval";
    if (input.targetResolution === "partial") reasons.push("manual_target_lookup_may_be_required");
    if (!input.requiredFactsPresent || missingFacts.length > 0) reasons.push("review_missing_facts");
  }

  return {
    confidence,
    confidenceBand,
    confidenceSource: input.confidenceSource ?? "fallback",
    actionKey: input.actionKey,
    policyMode: input.policyMode,
    policyEnabled: input.policyEnabled,
    targetResolution: input.targetResolution,
    requiredFactsPresent: input.requiredFactsPresent,
    missingFacts,
    currentStateVerified: input.currentStateVerified,
    riskLevel: "medium",
    outcome,
    reasonCodes: reasons,
    evaluatedAt: (input.now ?? new Date()).toISOString(),
    evaluatorVersion: "confidence-v1",
  };
}
