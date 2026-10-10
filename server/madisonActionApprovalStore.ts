import { mysqlEnum, mysqlTable, bigint, datetime, int, json, text, varchar, uniqueIndex, index } from "drizzle-orm/mysql-core";
import { eq } from "drizzle-orm";
import { getDb } from "./db";

export const madisonActionApprovalStatuses = ["PROPOSED", "APPROVING", "APPROVED", "DISMISSED"] as const;
export type MadisonActionApprovalStatus = (typeof madisonActionApprovalStatuses)[number];

export const madisonSmsActionApprovals = mysqlTable("madison_sms_action_approvals", {
  id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
  draftId: bigint("draftId", { mode: "number" }).notNull(),
  sessionId: bigint("sessionId", { mode: "number" }).notNull(),
  fromPhone: varchar("fromPhone", { length: 30 }).notNull(),
  customerName: varchar("customerName", { length: 255 }),
  incomingMessage: text("incomingMessage").notNull(),
  proposalType: varchar("proposalType", { length: 64 }).notNull(),
  title: varchar("title", { length: 255 }).notNull(),
  task: text("task").notNull(),
	  recommendation: text("recommendation").notNull(),
	  /** Deterministic confidence/policy/facts snapshot used by the approval gate. */
	  decisionEvaluation: json("decisionEvaluation"),
	  status: mysqlEnum("status", madisonActionApprovalStatuses as unknown as [string, ...string[]]).notNull().default("PROPOSED"),
  approvedBy: varchar("approvedBy", { length: 128 }),
  approvedAt: datetime("approvedAt", { mode: "date", fsp: 3 }),
  issueId: int("issueId"),
  createdAt: datetime("createdAt", { mode: "date", fsp: 3 }).notNull(),
  updatedAt: datetime("updatedAt", { mode: "date", fsp: 3 }).notNull(),
}, (t) => [
  uniqueIndex("uq_madison_action_approval_draft").on(t.draftId),
  index("idx_madison_action_approval_status").on(t.status),
  index("idx_madison_action_approval_session").on(t.sessionId),
]);

export type MadisonSmsActionApproval = typeof madisonSmsActionApprovals.$inferSelect;

export type MadisonActionProposal = {
  proposalType: "cancellation" | "reschedule" | "customer_care";
  title: string;
  task: string;
  recommendation: string;
};

export function buildMadisonActionProposal(message: string): MadisonActionProposal | null {
  const normalized = message.toLowerCase().replace(/\s+/g, " ").trim();
  if (/(^|\b)(cancel|cancellation|call off|don'?t need the clean)(\b|$)/.test(normalized)) {
    return {
      proposalType: "cancellation",
      title: "Cancellation request",
      task: "Verify the customer’s request, then cancel the booking",
      recommendation: "Do not change the booking until the request is verified.",
    };
  }
  if (/(^|\b)(reschedule|reschedul|move my|change my|different date|different time|another day)(\b|$)/.test(normalized)) {
    return {
      proposalType: "reschedule",
      title: "Reschedule request",
      task: "Verify the requested date/time, check openings, then reschedule",
      recommendation: "Do not change the booking until availability is verified.",
    };
  }
  if (/(^|\b)(problem|issue|missed|complaint|not happy|broken|damaged|refund|credit|special request|extra instruction)(\b|$)/.test(normalized)) {
    return {
      proposalType: "customer_care",
      title: "Customer-care request",
      task: "Review the issue and decide the appropriate customer resolution",
      recommendation: "Human follow-up is required before offering a credit, refund, or return visit.",
    };
  }
  return null;
}

export async function persistMadisonActionProposal(input: {
  draftId: number;
  sessionId: number;
  fromPhone: string;
  customerName?: string | null;
  incomingMessage: string;
}): Promise<void> {
  const proposal = buildMadisonActionProposal(input.incomingMessage);
  if (!proposal) return;
  const db = await getDb();
  if (!db) return;
  const now = new Date();
  await db.insert(madisonSmsActionApprovals).values({
    draftId: input.draftId,
    sessionId: input.sessionId,
    fromPhone: input.fromPhone,
    customerName: input.customerName ?? null,
    incomingMessage: input.incomingMessage,
    ...proposal,
    status: "PROPOSED",
    createdAt: now,
    updatedAt: now,
  }).onDuplicateKeyUpdate({
    set: { updatedAt: now },
  });
}

export async function getMadisonActionApproval(draftId: number): Promise<MadisonSmsActionApproval | null> {
  const db = await getDb();
  if (!db) return null;
  const [row] = await db.select().from(madisonSmsActionApprovals).where(eq(madisonSmsActionApprovals.draftId, draftId)).limit(1);
  return row ?? null;
}
