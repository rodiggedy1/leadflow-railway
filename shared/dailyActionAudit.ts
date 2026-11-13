export type AuditActionType = "reschedule" | "cancel" | "book" | "address" | "service" | "assignment" | "payment";
export type AuditStatus = "matches" | "needs_action" | "conflict" | "superseded" | "cannot_verify";
export type AuditAgreement = "requested" | "confirmed" | "declined" | "unclear";
export type AuditMessage = {
  key: string;
  sessionId: number | null;
  customerPhone: string;
  businessPhone: string | null;
  direction: "inbound" | "outbound";
  text: string;
  occurredAt: string | null;
  providerMessageId?: string | null;
  observedAt: string | null;
  timeBasis: "provider" | "history" | "received" | "unknown";
  delivery: "received" | "sent" | "delivered" | "unknown";
  source: "inbound_sms" | "conversation_history" | "madison_sent" | "provider";
};
export type AuditThread = {
  key: string;
  customerPhone: string;
  customerName: string | null;
  messages: AuditMessage[];
  truncated: boolean;
};
export type AuditExpectation = {
  bookingReference: string | null;
  date: string | null;
  originalDate: string | null;
  time: string | null;
  timeKind: "exact" | "window" | "unspecified";
  windowEnd: string | null;
  scope: "visit" | "subsequent" | "unspecified";
  address: string | null;
  serviceName: string | null;
  extras: string[] | null;
  extrasMode?: "add" | "remove" | "replace" | "unspecified";
  teamName: string | null;
  amountCents: number | null;
};
export type AuditCandidate = {
  id: string;
  threadKey: string;
  action: AuditActionType;
  agreement: AuditAgreement;
  anchorMessageKey: string;
  evidenceKeys: string[];
  expected: AuditExpectation;
  explanation: string;
  confidence: number;
  supersededByMessageKey: string | null;
  ambiguous: boolean;
  contextOnly?: boolean;
};
export type AuditRecord = {
  key: string;
  source: "bookings" | "leadflow_jobs";
  bookingId: number | null;
  jobId: number | null;
  publicBookingNumber: string | null;
  seriesId: string | null;
  customerPhone: string;
  customerName: string | null;
  date: string | null;
  time: string | null;
  timeZone: string | null;
  status: string | null;
  address: string | null;
  serviceName: string | null;
  extras: string[] | null;
  teamName: string | null;
  recurrence: string | null;
  paymentStatus: string | null;
  paidAmountCents: number | null;
};
export type AuditItem = {
  id: string;
  action: AuditActionType;
  agreement: AuditAgreement;
  status: AuditStatus;
  customerPhone: string;
  customerName: string | null;
  affectedDate: string | null;
  expected: AuditExpectation;
  explanation: string;
  verification: string;
  evidence: AuditMessage[];
  records: AuditRecord[];
  recordLinks: Array<{ label: string; href: string }>;
  verifiedAt: string;
  evidenceBasis?: "captured" | "provider";
  evidenceWarnings?: string[];
};
export type AuditCoverage = {
  status: "partial";
  messagesRead: number;
  threadsRead: number;
  threadsAnalyzed: number;
  truncated: boolean;
  warnings: string[];
};
/** Source collection precedes identity/action eligibility. Raw SMS are transient, never stored. */
export type AuditDaySms = {
  id: string;
  from: string;
  to: string[];
  text: string;
  phoneNumberId: string | null;
  conversationId: string;
  direction: "incoming" | "outgoing";
  status: string;
  createdAt: string;
  updatedAt: string;
  media: Array<{ url: string; type?: string | null }>;
};
export const AUDIT_COLLECTION_FAILURES = {
  CONFIGURATION: "The existing SMS provider integration is unavailable in this environment. The day's SMS could not be collected.",
  ACCESS: "The SMS provider denied access. The day's SMS collection is incomplete.",
  RATE_LIMIT: "The SMS provider rate limit interrupted collection. The day's SMS collection is incomplete.",
  TIMEOUT: "The SMS provider collection timed out before all pages were retrieved.",
  RESPONSE: "The SMS provider returned invalid or inconsistent page evidence. The day's collection could not be verified.",
  CURSOR: "The SMS provider pagination did not advance safely. The day's collection is incomplete.",
  LIMIT: "The day's SMS exceeded this request's safety budget before collection finished. No analysis was performed.",
  FAILED: "The day's SMS collection failed before all pages were retrieved. No analysis was performed.",
} as const;
export type AuditCollectionFailure = keyof typeof AUDIT_COLLECTION_FAILURES;
export type AuditDayCollection = {
  status: "complete" | "failed";
  scope: "organization";
  start: string;
  end: string;
  messages: AuditDaySms[];
  pagesRead: number;
  incoming: number;
  outgoing: number;
  duplicates: number;
  outOfWindow: number;
  failure: AuditCollectionFailure | null;
};
export type AuditAnalysis = {
  status: "complete" | "partial" | "failed" | "not_run";
  threadsTotal: number;
  threadsAnalyzed: number;
  failedThreads: number;
  omittedMessages: number;
  unsupportedMessages: number;
};
export type AuditCursor = {
  sessionAfterId: number;
  inboundAfterId: number;
  asOf: string;
  providerLineIndex?: number;
  providerAfter?: string | null;
  providerComplete?: boolean;
  localComplete?: boolean;
};
/** Local capture is useful evidence, not proof of organization-wide SMS completeness. */
export type AuditLocalSource = {
  status: "captured" | "partial";
  sessionsRead: number;
  inboundRead: number;
  messagesRead: number;
  threadsRead: number;
  providerRequests: 0;
};
export type DailyActionAuditResult = {
  auditDate: string;
  timeZone: string;
  asOf: string;
  items: AuditItem[];
  coverage: AuditCoverage;
  totals: Record<AuditStatus, number>;
  nextCursor: AuditCursor | null;
  collection?: AuditDayCollection;
  analysis?: AuditAnalysis;
  localSource?: AuditLocalSource;
};

export const AUDIT_FAILURE_STAGES = {
  MESSAGE_READ: "reading stored message evidence",
  RECORD_READ: "reading current booking and job records",
  PROCESSING: "processing audit evidence",
} as const;
export const AUDIT_FAILURE_REASONS = {
  DB_UNAVAILABLE: "The audit database connection is unavailable.",
  DB_UNSUPPORTED: "The database rejected an unsupported operation.",
  DB_SCHEMA: "A required audit table or field is unavailable.",
  DB_TIMEOUT: "The database read timed out or its connection was interrupted.",
  DB_READ_FAILED: "The required database snapshot could not be read.",
  FAILED: "The required evidence could not be processed.",
} as const;
export type AuditFailureStage = keyof typeof AUDIT_FAILURE_STAGES;
export type AuditFailureReason = keyof typeof AUDIT_FAILURE_REASONS;

/** Only fixed codes/text cross the transport; never SQL, parameters or source errors. */
export function auditFailureMessage(stage: AuditFailureStage, reason: AuditFailureReason): string {
  return `[DAA:${stage}:${reason}] Audit failed while ${AUDIT_FAILURE_STAGES[stage]}. ${AUDIT_FAILURE_REASONS[reason]} No changes were made.`;
}

/** Exact allowlist matching, not extraction or rendering of arbitrary error text. */
export function safeAuditFailureMessage(value: unknown): string | null {
  if (typeof value !== "string") return null;
  for (const stage of Object.keys(AUDIT_FAILURE_STAGES) as AuditFailureStage[]) {
    for (const reason of Object.keys(AUDIT_FAILURE_REASONS) as AuditFailureReason[]) {
      const safe = auditFailureMessage(stage, reason);
      if (value === safe) return safe;
    }
  }
  return null;
}
