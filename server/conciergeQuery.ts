/**
 * conciergeQuery.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * General information-request architecture for the AI Operations Concierge.
 *
 * Pipeline:
 *   parseConciergeRequest(message)
 *   → QueryPlan
 *   → resolveEntities(entities, db)
 *       → EntityResolutionMap
 *   → if any ambiguous → return ClarificationResult, stop
 *   → normalizeFieldRequests(requestedFields, timeScope, userExplicitDate)
 *       → FieldRequest[] (each field has its own effective time scope)
 *   → loadSharedContexts(fieldRequests, entityResolutionMap, db)
 *       → SharedContextMap (keyed by entity+scope, queries run once per group)
 *   → Promise.all(fieldRequests.map(fr => RESOLVER_REGISTRY[fr.field](fr, sharedCtx, db)))
 *       → ResolvedField[] (discriminated union, typed per field)
 *   → if all ambiguous → ClarificationResult
 *   → projectForAnswerLLM(resolvedFields, question)
 *       → narrow JSON, no raw DB rows
 *   → answerLLM(question, requestedFields, projectedData)
 *       → prose answer
 *   → QueryResult
 */

// ── Time scope ────────────────────────────────────────────────────────────────

export type TimeScopeType =
  | "today"
  | "yesterday"
  | "tomorrow"
  | "this_week"
  | "last_week"
  | "next_week"
  | "this_month"
  | "last_month"
  | "specific_date"
  | "next_appointment"   // "next time", "upcoming"
  | "last_appointment"   // "last time", "most recent"
  | "all_time"           // no date constraint
  | null;                // not specified — resolver uses field default

export interface TimeScope {
  type: TimeScopeType;
  specificDate: string | null;   // YYYY-MM-DD, only when type = "specific_date"
  originalPhrase: string | null; // "last Tuesday", "this Friday" — for display
}

// ── Requested fields ──────────────────────────────────────────────────────────

export type RequestedField =
  | "assignment"      // who is assigned / which team / which cleaner
  | "scheduled_time"  // what time is the cleaning
  | "job_status"      // on_the_way / arrived / in_progress / completed / etc.
  | "eta"             // ETA timestamp + source
  | "address"         // job address
  | "access"          // entry code, lockbox, gate, key instructions from customerNotes
  | "notes"           // customer notes + staff notes (non-access)
  | "pricing"         // job revenue / price charged
  | "payment_status"  // paid / balance / refund — from completedJobs.lastBookingPrice + L27 status
  | "history"         // full booking history
  | "summary";        // broad profile summary (triggers handleCustomerProfile-equivalent)

/** Per-field default time scope when the user doesn't specify a date */
export const DEFAULT_TIME_SCOPE: Record<RequestedField, TimeScopeType> = {
  assignment:     "today",
  scheduled_time: "today",
  job_status:     "today",
  eta:            "today",
  address:        "today",
  access:         "today",
  notes:          "today",
  pricing:        "last_appointment",
  payment_status: "last_appointment",
  history:        "all_time",
  summary:        "all_time",
};

/** Job-property fields — if any of these appear in requestedFields, the query
 *  must be routed to resolveQuery, never to handleCustomerProfile. */
export const JOB_PROPERTY_FIELDS: RequestedField[] = [
  "assignment", "scheduled_time", "job_status", "eta", "address", "access", "notes", "pricing", "payment_status",
];

// ── Query plan (output of parseConciergeRequest) ──────────────────────────────

export interface QueryPlanEntities {
  customerName: string | null;
  cleanerName:  string | null;
  teamName:     string | null;
  jobId:        string | null;
}

export interface QueryPlan {
  /** "query" replaces both query_data and customer_profile */
  action:
    | "query"
    | "text_cleaners"
    | "text_client"
    | "send_payment_link"
    | "call_client"
    | "eta_update"
    | "get_eta_for_customer"
    | "card_status"
    | "unknown";

  entities: QueryPlanEntities;
  timeScope: TimeScope;
  requestedFields: RequestedField[];

  // Action-specific hints (only populated for non-query actions)
  messageHint:  string | null;
  questionHint: string | null;
  targetHint:   string | null;
  teamHint:     string | null;
  clientName:   string | null; // kept for backward compat with action handlers

  // Target type: explicit classification of who the action targets
  // Used by validateAndNormalizePlan() to detect and correct contradictions
  targetType: "customer" | "cleaner" | "team" | "unknown";
}

// ── Entity resolution ─────────────────────────────────────────────────────────

export interface ResolvedCustomer {
  type: "customer";
  name: string;
  phone: string;          // E.164
  phone10: string;        // last 10 digits
  completedJobsId?: number; // most recent completedJobs.id for this customer
}

export interface ResolvedCleaner {
  type: "cleaner";
  name: string;
  cleanerProfileId: number;
  phone?: string;
}

export interface ResolvedTeam {
  type: "team";
  name: string;           // e.g. "Team 3", "Team Solange"
  teamId?: number;        // cleanerJobs.teamId if known
}

export interface ResolvedJob {
  type: "job";
  cleanerJobId: number;
  bookingId?: number;
}

export interface AmbiguousEntity {
  type: "ambiguous";
  query: string;          // the name that matched multiple records
  candidates: Array<{
    name: string;
    hint: string;         // e.g. "Oak St" or "Team 3" — for disambiguation display
    entityType: "customer" | "cleaner" | "team";
  }>;
}

export interface UnresolvedEntity {
  type: "unresolved";
  query: string;
}

export type EntityResolution =
  | ResolvedCustomer
  | ResolvedCleaner
  | ResolvedTeam
  | ResolvedJob
  | AmbiguousEntity
  | UnresolvedEntity;

/** Map of entity key → resolution result */
export interface EntityResolutionMap {
  customer: EntityResolution | null;  // null = not mentioned
  cleaner:  EntityResolution | null;
  team:     EntityResolution | null;
  job:      EntityResolution | null;
}

// ── Field request (one per requested field, with its own effective time scope) ─

export interface FieldRequest {
  field: RequestedField;
  effectiveTimeScope: TimeScope;  // user override OR field default
}

// ── Job status enum ───────────────────────────────────────────────────────────

export type JobStatusEnum =
  | "on_the_way"
  | "arrived"
  | "running_late"
  | "in_progress"
  | "finishing_up"
  | "wrapping_up"
  | "completed"
  | "issue_at_property"
  | "scheduled"   // not yet started (null in DB)
  | "unknown";

export function normalizeJobStatus(raw: string | null | undefined): JobStatusEnum {
  if (!raw) return "scheduled";
  const v = raw.toLowerCase().trim();
  const valid: JobStatusEnum[] = ["on_the_way","arrived","running_late","in_progress","finishing_up","wrapping_up","completed","issue_at_property"];
  return (valid as string[]).includes(v) ? (v as JobStatusEnum) : "unknown";
}

// ── Shared context (loaded once per entity+scope group) ───────────────────────

export interface CleanerJobRow {
  id: number;
  completedJobId: number;
  bookingId: number | null;
  cleanerProfileId: number;
  cleanerName: string;
  teamName: string | null;
  teamId: number | null;
  jobDate: string;
  serviceDateTime: string | null;
  customerName: string | null;
  customerPhone: string | null;
  jobAddress: string | null;
  serviceType: string | null;
  bookingStatus: string | null;
  customerNotes: string | null;
  staffNotes: string | null;
  jobRevenue: string | null;
  jobStatus: string | null;
  etaTimestamp: number | null;
  etaTimeStr: string | null;
  etaSource: string | null;
  delayMinutes: number | null;
  requestedTeam: string | null;
  frequency: string | null;
}

export interface CompletedJobRow {
  id: number;
  jobDate: string | null;
  name: string | null;
  address: string | null;
  lastBookingPrice: number | null;
  frequency: string | null;
  phone: string | null;
  serviceType: string | null;
}

export interface SharedContext {
  /** Resolved entity for this context group */
  entity: EntityResolution;
  /** Effective time scope for this context group */
  timeScope: TimeScope;
  /** Jobs from cleanerJobs matching entity+scope */
  cleanerJobRows: CleanerJobRow[];
  /** Jobs from completedJobs matching entity+scope (empty when scope=today) */
  completedJobRows: CompletedJobRow[];
  /** Deduplicated merged rows (cleanerJobs preferred over completedJobs) */
  mergedJobs: MergedJobRow[];
}

export interface MergedJobRow {
  source: "cleaner_jobs" | "completed_jobs";
  id: number;
  jobDate: string | null;
  teamName: string | null;
  cleanerName: string | null;
  customerName: string | null;
  jobAddress: string | null;
  serviceDateTime: string | null;
  jobStatus: JobStatusEnum;
  jobRevenue: string | null;
  lastBookingPrice: number | null;
  customerNotes: string | null;
  staffNotes: string | null;
  etaTimestamp: number | null;
  etaTimeStr: string | null;
  etaSource: string | null;
  delayMinutes: number | null;
  frequency: string | null;
  serviceType: string | null;
  bookingId: number | null;
  completedJobId: number | null;
}

// ── Resolved field types (discriminated union) ────────────────────────────────

interface ResolvedFieldBase {
  field: RequestedField;
  status: "resolved" | "not_found" | "partial" | "error";
}

export interface AssignmentData {
  matches: Array<{
    customerName: string | null;
    cleanerName: string | null;
    teamName: string | null;
    scheduledTime: string | null;
    jobDate: string | null;
  }>;
}

export interface ScheduleData {
  matches: Array<{
    customerName: string | null;
    scheduledTime: string | null;
    jobDate: string | null;
    serviceType: string | null;
  }>;
}

export interface JobStatusData {
  matches: Array<{
    customerName: string | null;
    jobDate: string | null;
    status: JobStatusEnum;
    delayMinutes: number | null;
    issueNote?: string | null;
  }>;
}

export interface EtaData {
  matches: Array<{
    customerName: string | null;
    jobDate: string | null;
    etaTimestamp: number | null;
    etaTimeStr: string | null;
    etaSource: string | null;
    jobStatus: JobStatusEnum;
  }>;
}

export interface AddressData {
  matches: Array<{
    customerName: string | null;
    jobDate: string | null;
    address: string | null;
  }>;
}

export interface AccessData {
  matches: Array<{
    customerName: string | null;
    jobDate: string | null;
    accessInstructions: string | null; // extracted from customerNotes
    rawNotes: string | null;
  }>;
}

export interface NotesData {
  matches: Array<{
    customerName: string | null;
    jobDate: string | null;
    customerNotes: string | null;
    staffNotes: string | null;
  }>;
}

export interface PricingData {
  matches: Array<{
    customerName: string | null;
    jobDate: string | null;
    price: number | null;
    currency: "USD";
  }>;
}

export interface PaymentStatusData {
  matches: Array<{
    customerName: string | null;
    jobDate: string | null;
    price: number | null;
    frequency: string | null;
    note: string; // "Pricing data only — live payment status not available in this system"
  }>;
}

export interface HistoryData {
  jobs: Array<{
    jobDate: string | null;
    serviceType: string | null;
    price: number | null;
    teamName: string | null;
    jobStatus: JobStatusEnum;
  }>;
  totalCount: number;
  ltv: number;
}

export interface SummaryData {
  name: string;
  phone: string;
  totalBookings: number;
  ltv: number;
  avgPrice: number | null;
  usualTeam: string | null;
  frequency: string | null;
  lastJobDate: string | null;
  upcomingJob: {
    jobDate: string | null;
    scheduledTime: string | null;
    teamName: string | null;
    jobStatus: JobStatusEnum;
  } | null;
  aiSummary: string;
}

export type ResolvedField =
  | (ResolvedFieldBase & { field: "assignment";     data: AssignmentData | null })
  | (ResolvedFieldBase & { field: "scheduled_time"; data: ScheduleData | null })
  | (ResolvedFieldBase & { field: "job_status";     data: JobStatusData | null })
  | (ResolvedFieldBase & { field: "eta";            data: EtaData | null })
  | (ResolvedFieldBase & { field: "address";        data: AddressData | null })
  | (ResolvedFieldBase & { field: "access";         data: AccessData | null })
  | (ResolvedFieldBase & { field: "notes";          data: NotesData | null })
  | (ResolvedFieldBase & { field: "pricing";        data: PricingData | null })
  | (ResolvedFieldBase & { field: "payment_status"; data: PaymentStatusData | null })
  | (ResolvedFieldBase & { field: "history";        data: HistoryData | null })
  | (ResolvedFieldBase & { field: "summary";        data: SummaryData | null });

// ── Query result ──────────────────────────────────────────────────────────────

export type QueryResultStatus = "complete" | "partial" | "not_found" | "ambiguous" | "error";

export interface ClarificationResult {
  type: "clarification";
  question: string;   // prose question for the user
  candidates: AmbiguousEntity["candidates"];
}

export interface QueryResult {
  type: "query_result";
  answer: string;
  resolvedFields: ResolvedField[];
  status: QueryResultStatus;
}
