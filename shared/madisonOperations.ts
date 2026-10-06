import { z } from "zod";

export const madisonDispositions = [
  "NO_ACTION",
  "REPLY_ONLY",
  "ACTION_REQUIRED",
  "CLARIFICATION_REQUIRED",
  "ANALYSIS_PENDING",
] as const;
export const madisonDispositionSchema = z.enum(madisonDispositions);
export type MadisonDisposition = z.infer<typeof madisonDispositionSchema>;

export const madisonIntentTypes = [
  "INFORMATIONAL",
  "NEW_BOOKING",
  "MODIFY_BOOKING",
  "CANCEL_BOOKING",
  "SERVICE_REQUEST",
  "SERVICE_COMPLAINT",
  "PAYMENT_ISSUE",
  "REFUND_CREDIT",
  "TEAM_ETA",
  "CUSTOMER_INFO_UPDATE",
  "OTHER_OPERATIONAL",
  "UNCLEAR",
] as const;
export const madisonIntentTypeSchema = z.enum(madisonIntentTypes);
export type MadisonIntentType = z.infer<typeof madisonIntentTypeSchema>;

export const madisonModificationOperations = [
  "CHANGE_DATE",
  "CHANGE_TIME",
  "ADD_EXTRA",
  "REMOVE_EXTRA",
  "CHANGE_SERVICE",
  "CHANGE_FREQUENCY",
  "CHANGE_ADDRESS",
  "CHANGE_ACCESS_INSTRUCTIONS",
  "CHANGE_ARRIVAL_INSTRUCTIONS",
  "OTHER_MODIFICATION",
] as const;
export const madisonModificationOperationSchema = z.enum(madisonModificationOperations);
export type MadisonModificationOperation = z.infer<typeof madisonModificationOperationSchema>;

export const madisonActionTypes = [
  "RESCHEDULE_BOOKING",
  "CANCEL_BOOKING",
  "SERVICE_ISSUE_REVIEW",
  "REFUND_CREDIT_REVIEW",
  "OTHER_OPERATION",
] as const;
export const madisonActionTypeSchema = z.enum(madisonActionTypes);
export type MadisonActionType = z.infer<typeof madisonActionTypeSchema>;

export const madisonActionReadiness = [
  "READY_FOR_HUMAN_REVIEW",
  "MISSING_PARAMETERS",
  "TARGET_UNRESOLVED",
  "POLICY_REVIEW_REQUIRED",
  "CONFLICTING_STATE",
] as const;
export const madisonActionReadinessSchema = z.enum(madisonActionReadiness);
export type MadisonActionReadiness = z.infer<typeof madisonActionReadinessSchema>;

export const madisonRiskLevels = [0, 1, 2, 3, 4] as const;
export const madisonRiskLevelSchema = z.union([
  z.literal(0),
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
]);
export type MadisonRiskLevel = z.infer<typeof madisonRiskLevelSchema>;

export const madisonProposalStatuses = [
  "PROPOSED",
  "NEEDS_REVIEW",
  "APPROVING",
  "APPROVED",
  "DISMISSED",
  "SUPERSEDED",
  "PENDING_EXECUTION",
  "EXECUTING",
  "COMPLETED",
  "FAILED",
] as const;
export const madisonProposalStatusSchema = z.enum(madisonProposalStatuses);
export type MadisonProposalStatus = z.infer<typeof madisonProposalStatusSchema>;

export const madisonApprovalDecisions = ["APPROVE", "DISMISS", "WRONG_ACTION"] as const;
export const madisonApprovalDecisionSchema = z.enum(madisonApprovalDecisions);
export type MadisonApprovalDecision = z.infer<typeof madisonApprovalDecisionSchema>;

export const madisonTargetSchema = z.object({
  customerId: z.string().nullable(),
  bookingId: z.string().nullable(),
  occurrenceKey: z.string().nullable(),
  resolutionStatus: z.enum(["RESOLVED", "PARTIAL", "UNRESOLVED"]),
  resolutionNotes: z.array(z.string()),
});
export type MadisonTarget = z.infer<typeof madisonTargetSchema>;

export const madisonRequestSchema = z.object({
  operation: madisonModificationOperationSchema.nullable(),
  requestedDate: z.string().nullable(),
  requestedTime: z.string().nullable(),
  requestedOutcome: z.string().nullable(),
  requestedScope: z.enum(["ONE_OCCURRENCE", "SERIES", "UNKNOWN"]),
});
export type MadisonRequest = z.infer<typeof madisonRequestSchema>;

export const madisonRuntimeVersionsSchema = z.object({
  modelProvider: z.string().min(1),
  modelName: z.string().min(1),
  modelVersion: z.string().nullable(),
  promptVersion: z.string().min(1),
  schemaVersion: z.string().min(1),
  validatorVersion: z.string().min(1),
});
export type MadisonRuntimeVersions = z.infer<typeof madisonRuntimeVersionsSchema>;

export const madisonContextReferenceSchema = z.object({
  kind: z.enum([
    "latest_message",
    "recent_conversation",
    "customer",
    "active_booking",
    "upcoming_booking",
    "recent_completed_booking",
    "open_madison_proposal",
    "account_flag",
  ]),
  id: z.string().min(1),
  summary: z.string().min(1),
});
export type MadisonContextReference = z.infer<typeof madisonContextReferenceSchema>;

export const madisonActionProposalSchema = z.object({
  proposalKey: z.string().min(1),
  actionType: madisonActionTypeSchema,
  operation: madisonModificationOperationSchema.nullable(),
  parameters: z.record(z.string(), z.unknown()),
  target: madisonTargetSchema,
  riskLevel: madisonRiskLevelSchema,
  readiness: madisonActionReadinessSchema,
  missingParameters: z.array(z.string()),
  verificationSteps: z.array(z.string()),
  requiresHumanApproval: z.literal(true),
  expectedCurrentState: z.record(z.string(), z.unknown()),
  bookingVersion: z.string().nullable(),
  actionFingerprint: z.string().length(64),
  status: madisonProposalStatusSchema,
});
export type MadisonActionProposal = z.infer<typeof madisonActionProposalSchema>;

export const madisonIntentSchema = z.object({
  intentKey: z.string().min(1),
  type: madisonIntentTypeSchema,
  confidence: z.number().min(0).max(1).nullable(),
  evidence: z.array(z.string()),
  uncertainties: z.array(z.string()),
  target: madisonTargetSchema,
  request: madisonRequestSchema,
  actionProposal: madisonActionProposalSchema.nullable(),
});
export type MadisonIntent = z.infer<typeof madisonIntentSchema>;

export const madisonDecisionSchema = z.object({
  decisionId: z.string().min(1),
  sourceMessageId: z.string().min(1),
  sessionId: z.string().min(1),
  customerId: z.string().nullable(),
  summary: z.string().min(1),
  disposition: madisonDispositionSchema,
  reply: z.object({
    recommended: z.boolean(),
    draft: z.string().nullable(),
  }),
  intents: z.array(madisonIntentSchema),
  uncertainties: z.array(z.string()),
  contextUsed: z.array(madisonContextReferenceSchema),
  runtime: madisonRuntimeVersionsSchema,
  createdAt: z.string().datetime({ offset: true }),
});
export type MadisonDecision = z.infer<typeof madisonDecisionSchema>;

export const madisonActionApprovalSchema = z.object({
  proposalId: z.string().min(1),
  decision: madisonApprovalDecisionSchema,
  correctedActionType: madisonActionTypeSchema.nullable(),
  correctionReason: z.string().max(64).nullable(),
  correctedBy: z.string().min(1),
  createdIssueId: z.string().nullable(),
  createdAt: z.string().datetime({ offset: true }),
});
export type MadisonActionApproval = z.infer<typeof madisonActionApprovalSchema>;

export const MADISON_SCHEMA_VERSION = "decision-v1" as const;
export const MADISON_PROMPT_VERSION = "sms-operations-v1" as const;
export const MADISON_VALIDATOR_VERSION = "operations-validator-v1" as const;
