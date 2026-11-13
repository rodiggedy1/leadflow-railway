import type { AuditMessage, AuditRecord, AuditActionType } from "./dailyActionAudit";

export type LiveTextDecision = "yes" | "no" | "review";
export type LiveTextRow = {
  key: string;
  captureId: number;
  revision: string;
  customerName: string | null;
  message: AuditMessage;
  identityAmbiguous: boolean;
};
export type LiveTextFeed = {
  rows: LiveTextRow[];
  checkedAt: string;
  partial: boolean;
  unavailable: boolean;
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
};
