import type {
  MadisonShadowPrediction,
  MessageCategory,
  NextBestAction,
} from "./madisonMessageUnderstanding";

export type MadisonDecisionSeverity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export type MadisonDecisionDiagnostics = {
  validatorVersion: "madison-decision-policy-v2";
  speechAct: MadisonShadowPrediction["speechAct"];
  contractValid: boolean;
  policyContractValid: boolean;
  severity: MadisonDecisionSeverity;
  reasonCodes: string[];
  allowedNextActions: NextBestAction[];
  blockedActions: NextBestAction[];
  modelProposedAction: NextBestAction;
  finalAction: NextBestAction;
  actionOverridden: boolean;
  evidenceValid: boolean;
  contextRisk: "LOW" | "MEDIUM" | "HIGH";
  humanReviewRequired: boolean;
};

const SENSITIVE_CATEGORIES: MessageCategory[] = [
  "CANCELLATION_REQUEST",
  "RESCHEDULE_REQUEST",
  "CHANGE_BOOKING_DETAILS",
  "PAYMENT_ISSUE",
  "PAYMENT_QUESTION",
  "REFUND_CREDIT_REQUEST",
  "SERVICE_ISSUE",
  "AVAILABILITY_REQUEST",
];

const OPERATIONAL_ACTIONS: NextBestAction[] = [
  "RESOLVE_CUSTOMER",
  "RESOLVE_BOOKING",
  "CHECK_AVAILABILITY",
  "LOOK_UP_ETA",
  "LOOK_UP_PAYMENT",
  "CREATE_REVIEW_TASK",
];

const unique = <T>(items: T[]) => Array.from(new Set(items));

/**
 * GPT proposes. Policy disposes.
 *
 * The model proposal is retained for audit, but the allowed/blocked action sets
 * are derived here from the normalized understanding and current-turn evidence.
 * They are not accepted from, or delegated back to, the model.
 */
export function validateMadisonDecision(
  prediction: MadisonShadowPrediction,
  inboundText: string,
  conversationMessages: Array<{ role: "user" | "assistant"; content: string }> = [],
): MadisonDecisionDiagnostics {
  const current = inboundText.trim().toLowerCase();
  const reasons: string[] = [];
  const facts = prediction.factObservations;
  const modelProposedAction = prediction.modelProposedAction ?? prediction.nextBestAction;
  const evidenceValid = facts.every(fact =>
    fact.evidenceExcerpt.trim().length > 0 &&
    current.includes(fact.evidenceExcerpt.trim().toLowerCase())
  );
  if (!evidenceValid) reasons.push("EVIDENCE_NOT_IN_CURRENT_MESSAGE");
  if (facts.some(fact => prediction.missingFacts.some(missing => missing.toLowerCase() === fact.factKey.toLowerCase()))) {
    reasons.push("MISSING_FACTS_CONTRADICTION");
  }
  if (prediction.extractionStatus === "NO_FACTS_PRESENT" && facts.length > 0) {
    reasons.push("EXTRACTION_STATUS_CONTRADICTION");
  }
  if (prediction.missionState === "WAITING_CUSTOMER" && prediction.missingFacts.length === 0) {
    reasons.push("WAITING_CUSTOMER_WITHOUT_MISSING_INPUT");
  }
  if (prediction.missionState === "WAITING_CUSTOMER" && modelProposedAction === "CHECK_AVAILABILITY") {
    reasons.push("READINESS_ACTION_CONFLICT");
  }

  const shortReply = current.split(/\s+/).filter(Boolean).length <= 4;
  const priorAssistant = [...conversationMessages].reverse().find(message => message.role === "assistant");
  if (shortReply && priorAssistant) reasons.push("SHORT_REPLY_REQUIRES_CONTEXT");
  if (["ANSWER", "CONFIRMATION", "DENIAL", "ACKNOWLEDGMENT", "CORRECTION", "STATUS_UPDATE"].includes(prediction.speechAct) && ["CANCEL_BOOKING", "MODIFY_BOOKING", "BOOK_SERVICE"].includes(prediction.mission)) {
    reasons.push("SPEECH_ACT_MISSION_CONFLICT");
  }
  if (prediction.speechAct === "AMBIGUOUS" || prediction.mission === "UNRESOLVED" || prediction.primaryCategory === "AMBIGUOUS") {
    reasons.push("CURRENT_TURN_AMBIGUOUS");
  }

  const sensitive = SENSITIVE_CATEGORIES.includes(prediction.primaryCategory) || prediction.mission === "CANCEL_BOOKING";
  const critical = sensitive && (
    reasons.includes("SPEECH_ACT_MISSION_CONFLICT") ||
    reasons.includes("CURRENT_TURN_AMBIGUOUS") ||
    reasons.includes("EVIDENCE_NOT_IN_CURRENT_MESSAGE")
  );
  if (sensitive) reasons.push("SENSITIVE_OPERATION_REQUIRES_HUMAN");

  const missing = prediction.missingFacts.length > 0;
  const allowed: NextBestAction[] = [];
  const blocked: NextBestAction[] = [];
  if (reasons.includes("SPEECH_ACT_MISSION_CONFLICT") || reasons.includes("CURRENT_TURN_AMBIGUOUS") || !evidenceValid) {
    allowed.push("HOLD_FOR_HUMAN");
    blocked.push(...OPERATIONAL_ACTIONS);
  } else if (missing) {
    allowed.push(modelProposedAction === "CHECK_AVAILABILITY" ? "CLARIFY" : "ASK_CUSTOMER");
    blocked.push(...OPERATIONAL_ACTIONS);
  } else if (sensitive) {
    allowed.push("HOLD_FOR_HUMAN");
    blocked.push(...OPERATIONAL_ACTIONS);
  } else {
    allowed.push(modelProposedAction);
  }

  const allowedActions = unique(allowed);
  const blockedActions = unique(blocked);
  const actionSetConflict = allowedActions.some(action => blockedActions.includes(action));
  if (actionSetConflict) reasons.push("ACTION_SET_CONFLICT");

  const proposalBlocked = blockedActions.includes(modelProposedAction);
  const proposalOutsideAllowed = allowedActions.length > 0 && !allowedActions.includes(modelProposedAction);
  if (proposalBlocked) reasons.push("MODEL_ACTION_BLOCKED");
  if (proposalOutsideAllowed) reasons.push("MODEL_ACTION_NOT_ALLOWED");

  const policyContractValid = allowedActions.length > 0 && !actionSetConflict;
  if (!policyContractValid) reasons.push("NO_VALID_ACTION_DECLARED");

  // Fail closed. Never insert HOLD_FOR_HUMAN into the model's contract or claim
  // that the model contract was valid. The safety disposition is separate.
  const finalAction = !policyContractValid
    ? "HOLD_FOR_HUMAN"
    : !proposalBlocked && !proposalOutsideAllowed
      ? modelProposedAction
      : allowedActions.find(action => !blockedActions.includes(action)) ?? "HOLD_FOR_HUMAN";
  const actionOverridden = finalAction !== modelProposedAction;
  if (actionOverridden && !reasons.includes("MODEL_ACTION_BLOCKED") && !reasons.includes("MODEL_ACTION_NOT_ALLOWED")) {
    reasons.push("MODEL_ACTION_CONTRACT_INVALID");
  }

  const uniqueReasons = unique(reasons);
  const severity: MadisonDecisionSeverity = critical
    ? "CRITICAL"
    : sensitive || uniqueReasons.length >= 2
      ? "HIGH"
      : uniqueReasons.length === 1
        ? "MEDIUM"
        : "LOW";
  return {
    validatorVersion: "madison-decision-policy-v2",
    speechAct: prediction.speechAct,
    contractValid: uniqueReasons.length === 0,
    policyContractValid,
    severity,
    reasonCodes: uniqueReasons,
    allowedNextActions: allowedActions,
    blockedActions,
    modelProposedAction,
    finalAction,
    actionOverridden,
    evidenceValid,
    contextRisk: shortReply || priorAssistant ? "MEDIUM" : "LOW",
    humanReviewRequired: severity !== "LOW" || sensitive,
  };
}
