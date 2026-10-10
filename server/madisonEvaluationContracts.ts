export const madisonPredictionStates = [
  "pending",
  "succeeded",
  "failed",
  "not_run",
  "legacy_missing",
] as const;
export type MadisonPredictionState = (typeof madisonPredictionStates)[number];

export const madisonReplyEvaluationStatuses = [
  "pending",
  "completed",
  "failed",
  "not_run",
] as const;
export type MadisonReplyEvaluationStatus = (typeof madisonReplyEvaluationStatuses)[number];

export const madisonReplyReadinessStates = [
  "not_evaluated",
  "reviewable",
  "clarification_needed",
  "unsafe_draft",
  "not_applicable",
] as const;
export type MadisonReplyReadiness = (typeof madisonReplyReadinessStates)[number];

export const madisonActionReadinessStates = [
  "not_evaluated",
  "not_ready_insufficient_evidence",
  "not_ready_missing_information",
  "not_ready_target_verification",
  "not_ready_policy",
  "ready_for_human_action_approval",
  "action_not_applicable",
] as const;
export type MadisonActionReadiness = (typeof madisonActionReadinessStates)[number];

export const madisonExtractionStatuses = [
  "not_available",
  "completed",
  "failed",
] as const;
export type MadisonExtractionStatus = (typeof madisonExtractionStatuses)[number];

export const madisonExtractionValidationStates = [
  "not_evaluated",
  "structurally_valid",
  "evidence_invalid",
  "schema_invalid",
] as const;
export type MadisonExtractionValidation = (typeof madisonExtractionValidationStates)[number];

export const madisonTaskCompletenessStates = [
  "not_evaluable",
  "sufficient_for_next_step",
  "insufficient_for_next_step",
  "conflicting_for_next_step",
] as const;
export type MadisonTaskCompleteness = (typeof madisonTaskCompletenessStates)[number];

export type MadisonEvaluationVersions = {
  modelVersion: string | null;
  classifierVersion: string | null;
  evaluationPolicyVersion: string;
  factSchemaVersion: string;
  contextAssemblyVersion: string;
  actionAuthorizationPolicyVersion: string;
};

export const CURRENT_MADISON_EVALUATION_VERSIONS: MadisonEvaluationVersions = {
  modelVersion: null,
  classifierVersion: "shadow-v2",
  evaluationPolicyVersion: "independent-readiness-v1",
  factSchemaVersion: "fact-observation-v2",
  contextAssemblyVersion: "active-exchange-v2",
  actionAuthorizationPolicyVersion: "approval-required-v1",
};

export type MadisonRegressionCase = {
  id: string;
  message: string;
  expectedIntent: string;
  extractionStatus: MadisonExtractionStatus;
  extractionValidation: MadisonExtractionValidation;
  taskCompleteness: MadisonTaskCompleteness;
  targetResolution: "resolved" | "partial" | "unresolved";
  expectedReplyReadiness: MadisonReplyReadiness;
  expectedActionReadiness: MadisonActionReadiness;
  requiresClarification: boolean;
};

/**
 * Small implementation contract. This is intentionally labeled by independent
 * dimensions; it is not the later accuracy/calibration golden dataset.
 */
export const MADISON_REGRESSION_CASES: readonly MadisonRegressionCase[] = [
  { id: "ack-thanks", message: "Thanks!", expectedIntent: "casual_acknowledgment", extractionStatus: "completed", extractionValidation: "structurally_valid", taskCompleteness: "not_evaluable", targetResolution: "partial", expectedReplyReadiness: "reviewable", expectedActionReadiness: "action_not_applicable", requiresClarification: false },
  { id: "cancel-date", message: "Can you cancel my cleaning tomorrow?", expectedIntent: "cancellation_request", extractionStatus: "completed", extractionValidation: "structurally_valid", taskCompleteness: "insufficient_for_next_step", targetResolution: "partial", expectedReplyReadiness: "reviewable", expectedActionReadiness: "not_ready_target_verification", requiresClarification: false },
  { id: "cancel-vague", message: "Can you cancel service?", expectedIntent: "cancellation_request", extractionStatus: "completed", extractionValidation: "structurally_valid", taskCompleteness: "insufficient_for_next_step", targetResolution: "unresolved", expectedReplyReadiness: "reviewable", expectedActionReadiness: "not_ready_missing_information", requiresClarification: true },
  { id: "reschedule-no-time", message: "I need to reschedule my cleaning.", expectedIntent: "reschedule_request", extractionStatus: "completed", extractionValidation: "structurally_valid", taskCompleteness: "insufficient_for_next_step", targetResolution: "partial", expectedReplyReadiness: "clarification_needed", expectedActionReadiness: "not_ready_missing_information", requiresClarification: true },
  { id: "reschedule-date", message: "Saturday works.", expectedIntent: "reschedule_request", extractionStatus: "completed", extractionValidation: "structurally_valid", taskCompleteness: "insufficient_for_next_step", targetResolution: "partial", expectedReplyReadiness: "reviewable", expectedActionReadiness: "not_ready_missing_information", requiresClarification: false },
  { id: "service-issue", message: "The kitchen was missed.", expectedIntent: "service_issue", extractionStatus: "completed", extractionValidation: "structurally_valid", taskCompleteness: "sufficient_for_next_step", targetResolution: "partial", expectedReplyReadiness: "reviewable", expectedActionReadiness: "ready_for_human_action_approval", requiresClarification: false },
  { id: "payment-question", message: "Why was I charged twice?", expectedIntent: "payment_question", extractionStatus: "completed", extractionValidation: "structurally_valid", taskCompleteness: "sufficient_for_next_step", targetResolution: "partial", expectedReplyReadiness: "reviewable", expectedActionReadiness: "ready_for_human_action_approval", requiresClarification: false },
  { id: "booking-basic", message: "I need a cleaning for my apartment.", expectedIntent: "new_booking", extractionStatus: "completed", extractionValidation: "structurally_valid", taskCompleteness: "insufficient_for_next_step", targetResolution: "unresolved", expectedReplyReadiness: "reviewable", expectedActionReadiness: "not_ready_missing_information", requiresClarification: false },
  { id: "booking-details", message: "Two bedrooms and two bathrooms in Silver Spring.", expectedIntent: "new_booking", extractionStatus: "completed", extractionValidation: "structurally_valid", taskCompleteness: "sufficient_for_next_step", targetResolution: "partial", expectedReplyReadiness: "reviewable", expectedActionReadiness: "ready_for_human_action_approval", requiresClarification: false },
  { id: "extras", message: "Please clean inside the oven too.", expectedIntent: "booking_request", extractionStatus: "completed", extractionValidation: "structurally_valid", taskCompleteness: "sufficient_for_next_step", targetResolution: "partial", expectedReplyReadiness: "reviewable", expectedActionReadiness: "ready_for_human_action_approval", requiresClarification: false },
  { id: "confirmation", message: "Yes, that time works.", expectedIntent: "confirmation", extractionStatus: "completed", extractionValidation: "structurally_valid", taskCompleteness: "sufficient_for_next_step", targetResolution: "partial", expectedReplyReadiness: "reviewable", expectedActionReadiness: "action_not_applicable", requiresClarification: false },
  { id: "ambiguous", message: "Can you move it?", expectedIntent: "ambiguous_request", extractionStatus: "completed", extractionValidation: "structurally_valid", taskCompleteness: "insufficient_for_next_step", targetResolution: "unresolved", expectedReplyReadiness: "clarification_needed", expectedActionReadiness: "not_ready_missing_information", requiresClarification: true },
  { id: "correction", message: "Friday — actually Sunday.", expectedIntent: "reschedule_request", extractionStatus: "completed", extractionValidation: "structurally_valid", taskCompleteness: "sufficient_for_next_step", targetResolution: "partial", expectedReplyReadiness: "reviewable", expectedActionReadiness: "ready_for_human_action_approval", requiresClarification: false },
  { id: "conflict", message: "Tomorrow, no wait, next Friday.", expectedIntent: "reschedule_request", extractionStatus: "completed", extractionValidation: "structurally_valid", taskCompleteness: "conflicting_for_next_step", targetResolution: "partial", expectedReplyReadiness: "clarification_needed", expectedActionReadiness: "not_ready_missing_information", requiresClarification: true },
  { id: "no-facts", message: "Hello there.", expectedIntent: "casual_conversation", extractionStatus: "completed", extractionValidation: "structurally_valid", taskCompleteness: "not_evaluable", targetResolution: "partial", expectedReplyReadiness: "reviewable", expectedActionReadiness: "action_not_applicable", requiresClarification: false },
  { id: "eta", message: "How much longer until the team arrives?", expectedIntent: "eta_request", extractionStatus: "completed", extractionValidation: "structurally_valid", taskCompleteness: "sufficient_for_next_step", targetResolution: "partial", expectedReplyReadiness: "reviewable", expectedActionReadiness: "ready_for_human_action_approval", requiresClarification: false },
  { id: "no-prediction", message: "Can you cancel service?", expectedIntent: "unknown", extractionStatus: "not_available", extractionValidation: "not_evaluated", taskCompleteness: "not_evaluable", targetResolution: "partial", expectedReplyReadiness: "reviewable", expectedActionReadiness: "not_ready_insufficient_evidence", requiresClarification: false },
  { id: "failed-extraction", message: "I need a deep clean Friday.", expectedIntent: "new_booking", extractionStatus: "failed", extractionValidation: "schema_invalid", taskCompleteness: "not_evaluable", targetResolution: "partial", expectedReplyReadiness: "reviewable", expectedActionReadiness: "not_ready_insufficient_evidence", requiresClarification: false },
  { id: "historical-only", message: "Yes.", expectedIntent: "confirmation", extractionStatus: "completed", extractionValidation: "structurally_valid", taskCompleteness: "sufficient_for_next_step", targetResolution: "partial", expectedReplyReadiness: "reviewable", expectedActionReadiness: "action_not_applicable", requiresClarification: false },
  { id: "target-resolved", message: "Please cancel booking 12345 tomorrow.", expectedIntent: "cancellation_request", extractionStatus: "completed", extractionValidation: "structurally_valid", taskCompleteness: "sufficient_for_next_step", targetResolution: "resolved", expectedReplyReadiness: "reviewable", expectedActionReadiness: "ready_for_human_action_approval", requiresClarification: false },
  { id: "target-multiple", message: "Cancel my booking tomorrow.", expectedIntent: "cancellation_request", extractionStatus: "completed", extractionValidation: "structurally_valid", taskCompleteness: "insufficient_for_next_step", targetResolution: "unresolved", expectedReplyReadiness: "reviewable", expectedActionReadiness: "not_ready_target_verification", requiresClarification: false },
  { id: "quote", message: "How much for a two-bedroom cleaning?", expectedIntent: "quote_request", extractionStatus: "completed", extractionValidation: "structurally_valid", taskCompleteness: "sufficient_for_next_step", targetResolution: "partial", expectedReplyReadiness: "reviewable", expectedActionReadiness: "action_not_applicable", requiresClarification: false },
  { id: "quote-missing", message: "How much does cleaning cost?", expectedIntent: "quote_request", extractionStatus: "completed", extractionValidation: "structurally_valid", taskCompleteness: "insufficient_for_next_step", targetResolution: "partial", expectedReplyReadiness: "clarification_needed", expectedActionReadiness: "not_ready_missing_information", requiresClarification: true },
  { id: "payment-refund", message: "Can I get a refund?", expectedIntent: "payment_question", extractionStatus: "completed", extractionValidation: "structurally_valid", taskCompleteness: "insufficient_for_next_step", targetResolution: "partial", expectedReplyReadiness: "reviewable", expectedActionReadiness: "not_ready_insufficient_evidence", requiresClarification: false },
  { id: "opt-out", message: "Stop texting me.", expectedIntent: "opt_out", extractionStatus: "completed", extractionValidation: "structurally_valid", taskCompleteness: "sufficient_for_next_step", targetResolution: "resolved", expectedReplyReadiness: "not_applicable", expectedActionReadiness: "action_not_applicable", requiresClarification: false },
  { id: "address", message: "The cleaning is at 123 Main Street.", expectedIntent: "booking_request", extractionStatus: "completed", extractionValidation: "structurally_valid", taskCompleteness: "sufficient_for_next_step", targetResolution: "partial", expectedReplyReadiness: "reviewable", expectedActionReadiness: "ready_for_human_action_approval", requiresClarification: false },
  { id: "home-condition", message: "The house is a 7 out of 10 condition.", expectedIntent: "booking_request", extractionStatus: "completed", extractionValidation: "structurally_valid", taskCompleteness: "sufficient_for_next_step", targetResolution: "partial", expectedReplyReadiness: "reviewable", expectedActionReadiness: "ready_for_human_action_approval", requiresClarification: false },
  { id: "bathrooms", message: "Three bedrooms and two bathrooms.", expectedIntent: "booking_request", extractionStatus: "completed", extractionValidation: "structurally_valid", taskCompleteness: "sufficient_for_next_step", targetResolution: "partial", expectedReplyReadiness: "reviewable", expectedActionReadiness: "ready_for_human_action_approval", requiresClarification: false },
  { id: "date-time", message: "Friday at 10am works for me.", expectedIntent: "confirmation", extractionStatus: "completed", extractionValidation: "structurally_valid", taskCompleteness: "sufficient_for_next_step", targetResolution: "partial", expectedReplyReadiness: "reviewable", expectedActionReadiness: "action_not_applicable", requiresClarification: false },
  { id: "service-type", message: "I want a deep cleaning.", expectedIntent: "booking_request", extractionStatus: "completed", extractionValidation: "structurally_valid", taskCompleteness: "sufficient_for_next_step", targetResolution: "partial", expectedReplyReadiness: "reviewable", expectedActionReadiness: "ready_for_human_action_approval", requiresClarification: false },
  { id: "cancellation-reason", message: "I need to cancel because we are out of town.", expectedIntent: "cancellation_request", extractionStatus: "completed", extractionValidation: "structurally_valid", taskCompleteness: "insufficient_for_next_step", targetResolution: "partial", expectedReplyReadiness: "reviewable", expectedActionReadiness: "not_ready_target_verification", requiresClarification: false },
  { id: "service-followup", message: "Will do, thank you.", expectedIntent: "casual_acknowledgment", extractionStatus: "completed", extractionValidation: "structurally_valid", taskCompleteness: "not_evaluable", targetResolution: "partial", expectedReplyReadiness: "reviewable", expectedActionReadiness: "action_not_applicable", requiresClarification: false },
] as const;
