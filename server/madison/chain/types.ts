/**
 * server/madison/chain/types.ts
 *
 * Core types for the Madison Command Chaining Engine.
 * The executor is completely domain-agnostic — it only knows about these types.
 */

import type { getDb } from "../../db";

// ── DB context ────────────────────────────────────────────────────────────────

export type ChainDb = NonNullable<Awaited<ReturnType<typeof getDb>>>;

export interface CapabilityContext {
  db: ChainDb;
  agentId: number;
  agentName?: string;
}

// ── Capability IDs ────────────────────────────────────────────────────────────

export type CapabilityId =
  | "readiness.compute"
  | "confirmations.queryStatus"
  | "payments.queryCardStatus"
  | "payments.sendLink"
  | "communications.sendSms"
  | "communications.sendBulkSms";

// ── Shared data types ─────────────────────────────────────────────────────────

export interface Recipient {
  phone: string | null;
  name: string;
  jobId?: number;
}

// ── Capability output types ───────────────────────────────────────────────────

export interface ReadinessOutput {
  date: string;
  overallPct: number;
  totalIssues: number;
  summary: string;
}

export interface ConfirmationStatusOutput {
  date: string;
  dateLabel: string;
  unconfirmed: Recipient[];
  alreadySent: Recipient[];
  confirmed: Recipient[];
}

export interface CardStatusOutput {
  date: string;
  noCard: Recipient[];
  onHold: Recipient[];
  hasCard: Recipient[];
}

export interface SendLinkOutput {
  recipientPhone: string;
  recipientName: string;
  tokenId: number;
  url: string;
  smsSent: boolean;
  openPhoneMessageId: string | null;
}

export interface SendSmsOutput {
  phone: string;
  name: string;
  success: boolean;
  openPhoneMessageId: string | null;
}

export interface SendBulkSmsOutput {
  results: SendSmsOutput[];
  successCount: number;
  failCount: number;
}

// ── Validation / Verification ─────────────────────────────────────────────────

export interface ValidationResult {
  ok: boolean;
  reason?: string;
  /** Resolved/enriched args to use for execution (replaces original args if provided) */
  resolvedArgs?: Record<string, unknown>;
}

export interface VerificationResult {
  ok: boolean;
  summary: string;
}

// ── Capability Handler ────────────────────────────────────────────────────────

export interface CapabilityHandler<TArgs, TResult> {
  id: CapabilityId;
  label: string;
  /** Whether this capability performs a write (send SMS, create token, etc.) */
  isWrite: boolean;
  /** What to do if this step fails: "halt" = stop chain, "continue" = record failure and continue */
  defaultOnFailure: "halt" | "continue";

  validate(args: TArgs, ctx: CapabilityContext): Promise<ValidationResult>;
  execute(args: TArgs, ctx: CapabilityContext): Promise<TResult>;
  verify(args: TArgs, result: TResult, ctx: CapabilityContext): Promise<VerificationResult>;
}

// ── Execution Plan ────────────────────────────────────────────────────────────

export interface StepDataRef {
  /** ID of the step whose output to pull from */
  fromStep: string;
  /** Dot-notation path into that step's result, e.g. "noCard" */
  path: string;
}

export interface PlannedStep {
  id: string;
  capabilityId: CapabilityId;
  /** Human-readable label for the confirm card */
  label: string;
  /** Static args (provided directly by the planner) */
  args: Record<string, unknown>;
  /** Dynamic args resolved from prior step outputs */
  dataRefs?: Record<string, StepDataRef>;
  /** Override defaultOnFailure for this specific step */
  onFailure?: "halt" | "continue";
}

export interface ExecutionPlan {
  steps: PlannedStep[];
  /** Whether any step is a write operation (determines if confirm card is needed) */
  hasWrites: boolean;
  /** Human-readable summary for the confirm card header */
  summary: string;
}

// ── Step execution result ─────────────────────────────────────────────────────

export type StepStatus = "planned" | "running" | "succeeded" | "failed" | "skipped" | "cancelled";

export interface StepExecutionResult {
  stepId: string;
  capabilityId: CapabilityId;
  status: StepStatus;
  result?: unknown;
  verificationResult?: VerificationResult;
  errorMessage?: string;
  /** Human-readable summary for the result card */
  summary: string;
  /** Entities affected (for display in result card) */
  entities?: Array<{ name: string; success: boolean; detail?: string }>;
}

// ── Chain execution result ────────────────────────────────────────────────────

export type ChainStatus = "planned" | "awaiting_confirmation" | "running" | "succeeded" | "partial" | "failed" | "cancelled";

export interface ChainExecutionResult {
  chainExecutionId: string;
  status: ChainStatus;
  steps: StepExecutionResult[];
  /** Overall human-readable summary */
  summary: string;
}

// ── Confirm card data (sent to UI before executing writes) ────────────────────

export interface ChainConfirmCard {
  chainExecutionId: string;
  summary: string;
  steps: Array<{
    id: string;
    capabilityId: CapabilityId;
    label: string;
    isWrite: boolean;
    /** Preview of what will be done (e.g. "5 customers: Mary, Anna, ...") */
    preview?: string;
    /** Expandable entity list */
    entities?: Array<{ name: string; phone?: string | null }>;
  }>;
}

// ── Chain routing mode ────────────────────────────────────────────────────────

export type ChainRoutingMode = "legacy" | "single" | "chain";

export interface ChainRoutingDecision {
  mode: ChainRoutingMode;
  plan?: ExecutionPlan;
  capabilityId?: string; // present when mode="single"
}
