import type {
  MadisonShadowPrediction,
  MessageCategory,
  NextBestAction,
} from "./madisonMessageUnderstanding";

export type MadisonDecisionSeverity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export type MadisonDecisionDiagnostics = {
  validatorVersion: "madison-decision-policy-v1";
  speechAct: MadisonShadowPrediction["speechAct"];
  contractValid: boolean;
  severity: MadisonDecisionSeverity;
  reasonCodes: string[];
  allowedNextActions: NextBestAction[];
  blockedActions: NextBestAction[];
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

export function validateMadisonDecision(
  prediction: MadisonShadowPrediction,
  inboundText: string,
  conversationMessages: Array<{ role: "user" | "assistant"; content: string }> = [],
): MadisonDecisionDiagnostics {
  const current = inboundText.trim().toLowerCase();
  const reasons: string[] = [];
  const facts = prediction.factObservations;
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
  if (prediction.missionState === "WAITING_CUSTOMER" && prediction.nextBestAction === "CHECK_AVAILABILITY") {
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
  if (reasons.includes("SPEECH_ACT_MISSION_CONFLICT") || reasons.includes("CURRENT_TURN_AMBIGUOUS")) {
    allowed.push("HOLD_FOR_HUMAN");
    blocked.push(...OPERATIONAL_ACTIONS);
  } else if (missing) {
    allowed.push(prediction.nextBestAction === "CHECK_AVAILABILITY" ? "CLARIFY" : "ASK_CUSTOMER");
    blocked.push(...OPERATIONAL_ACTIONS);
  } else if (sensitive) {
    allowed.push("HOLD_FOR_HUMAN");
    if (OPERATIONAL_ACTIONS.includes(prediction.nextBestAction)) blocked.push(prediction.nextBestAction);
  } else {
    allowed.push(prediction.nextBestAction);
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
    validatorVersion: "madison-decision-policy-v1",
    speechAct: prediction.speechAct,
    contractValid: uniqueReasons.length === 0,
    severity,
    reasonCodes: uniqueReasons,
    allowedNextActions: unique(allowed),
    blockedActions: unique(blocked),
    evidenceValid,
    contextRisk: shortReply || priorAssistant ? "MEDIUM" : "LOW",
    humanReviewRequired: severity !== "LOW" || sensitive,
  };
}
