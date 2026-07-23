/**
 * Madison Readiness Domain — shared types
 */

import { z } from "zod";

// ── ReadinessPlan ─────────────────────────────────────────────────────────────

export const ReadinessPlanSchema = z.object({
  dateScope: z.object({
    type: z.literal("service_date"),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  }),
  filters: z
    .object({
      timeOfDay: z.enum(["morning", "afternoon", "evening"]).optional(),
      startTime: z
        .string()
        .regex(/^\d{2}:\d{2}$/)
        .optional(), // "HH:MM" 24h
      endTime: z
        .string()
        .regex(/^\d{2}:\d{2}$/)
        .optional(),
      dimension: z
        .enum([
          "all",
          "assignment",
          "confirmation",
          "payment",
          "access",
          "schedule",
        ])
        .optional(),
      onlyNeedsAttention: z.boolean().optional(),
      minimumFlagCount: z.number().int().min(1).max(5).optional(),
    })
    .optional(),
  sort: z.enum(["service_time", "risk"]).optional(),
});

export type ReadinessPlan = z.infer<typeof ReadinessPlanSchema>;

// ── Projection ────────────────────────────────────────────────────────────────

export interface JobReadinessRow {
  jobId: number;
  customerName: string;
  jobTime: string | null;
  serviceType: string | null;
  teamName: string | null;
  assignment: {
    status: "assigned" | "unassigned";
    cleanerName: string | null;
  };
  confirmation: {
    status: "confirmed" | "pending";
    outcomeLabel: string | null;
  };
  payment: {
    cardOnFile: boolean;
    authorizationStatus:
      | "authorized"
      | "not_attempted"
      | "not_required"
      | "unknown";
    rawStatus: string; // exact source status — never interpreted by LLM
  };
  access: {
    status: "notes_present" | "no_notes" | "unknown";
    notes: string | null; // truncated to 200 chars
  };
  flags: Array<
    "unassigned" | "unconfirmed" | "no_payment" | "double_booked"
  >;
}

export interface ReadinessProjection {
  date: string;
  totalJobs: number;
  filteredJobs: number;
  appliedFilter: string | null;
  jobs: JobReadinessRow[];
  summary: {
    unassigned: number;
    unconfirmed: number;
    noPayment: number;
    atRisk: number; // jobs with 2+ flags
  };
  // Passed through from canonical service — never recalculated
  overallPct: number;
  totalIssues: number;
}

// ── Execution ─────────────────────────────────────────────────────────────────

export interface MadisonExecutionLog {
  requestId: string;
  message: string;
  domain: "readiness" | "legacy";
  planCreatedAt?: number;
  executionStartedAt?: number;
  executionEndedAt?: number;
  fallbackReason?: string;
  error?: string;
}

// ── Errors ────────────────────────────────────────────────────────────────────

export type MadisonErrorCode =
  | "PLAN_FAILED"
  | "PLAN_INVALID"
  | "EXECUTION_TIMEOUT"
  | "EXECUTION_ERROR"
  | "FEATURE_DISABLED";

export class MadisonError extends Error {
  constructor(
    public code: MadisonErrorCode,
    message: string,
    public fallback = true
  ) {
    super(message);
    this.name = "MadisonError";
  }
}
