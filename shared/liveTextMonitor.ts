import type { AuditMessage, AuditRecord, AuditActionType } from "./dailyActionAudit";

export type LiveTextDecision = "yes" | "no" | "review";
export type LiveTextRow = {
  key: string;
  sessionId: number;
  revision: string;
  customerName: string | null;
  message: AuditMessage;
  identityAmbiguous: boolean;
};
export type LiveTextFeedFailure = "DB_UNAVAILABLE" | "DB_SCHEMA" | "DB_TIMEOUT" | "DB_READ_FAILED";
export type LiveTextFeed = {
  rows: LiveTextRow[];
  checkedAt: string;
  partial: boolean;
  unavailable: boolean;
  failure?: LiveTextFeedFailure;
};
export type LiveTextContext = {
  row: LiveTextRow;
  messages: AuditMessage[];
  partial: boolean;
};
export type LiveTextAction = {
  id: string;
  type: AuditActionType;
  summary: string;
  /** Explicit service date from the cited request; null/absent is never guessed. */
  syncServiceDate?: string | null;
  verified: LiveTextDecision;
  evidence: string;
  records: AuditRecord[];
  links: Array<{ label: string; href: string }>;
};
export type LiveTextCheck = {
  rowKey: string;
  revision: string;
  required: LiveTextDecision;
  verified: LiveTextDecision | "not_applicable";
  summary: string;
  evidence: string;
  actions: LiveTextAction[];
  conversation: AuditMessage[];
  checkedAt: string;
  /** Only present when the foreground monitor automatically refreshes explicit future dates. */
  syncs?: LiveTextSyncSummary[];
};

export type LiveTextSyncFailure = "SOURCE_UNAVAILABLE" | "SOURCE_INCOMPLETE" | "SYNC_UNAVAILABLE" | "PROTECTED_RECORDS" | "STALE_TEXT";
export type LiveTextSyncSummary = {
  date: string;
  complete: boolean;
  fetched: number;
  created: number;
  updated: number;
  protectedRecords: number;
  checkedAt: string;
  failure?: LiveTextSyncFailure;
};
export type LiveTextSyncInput = {
  sessionId: number;
  messageKey: string;
  revision: string;
  actionId: string;
  serviceDate: string;
};
export type LiveTextSyncResult = {
  sync: LiveTextSyncSummary;
  /** A fresh post-sync check, never a cached verification decision. */
  check: LiveTextCheck;
  /** Transient identity receipt; permits coalescing without trusting an untouched stale job. */
  refreshedJobIds?: number[];
};
