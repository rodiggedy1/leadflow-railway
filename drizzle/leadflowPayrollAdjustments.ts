import { sql } from "drizzle-orm";
import { datetime, index, int, mysqlTable, varchar } from "drizzle-orm/mysql-core";

/**
 * Append-only staff payroll corrections for LeadFlow-owned jobs. These affect
 * only the assigned Cleaner Portal's calculated payout; they never alter the
 * customer price, booking, team assignment, or payment collection state.
 */
export const leadflowJobPayrollAdjustments = mysqlTable("leadflow_job_payroll_adjustments", {
  id: int("id").autoincrement().primaryKey(),
  leadflowJobId: int("leadflowJobId").notNull(),
  /** Signed cents: positive raises the payout, negative reduces it. */
  amountCents: int("amountCents").notNull(),
  /** Required internal audit reason; never returned to the Cleaner Portal. */
  reason: varchar("reason", { length: 500 }).notNull(),
  createdByAgentId: int("createdByAgentId").notNull(),
  createdByAgentName: varchar("createdByAgentName", { length: 128 }).notNull(),
  createdAt: datetime("createdAt", { mode: "date", fsp: 3 }).default(sql`CURRENT_TIMESTAMP(3)`).notNull(),
}, (t) => [
  index("idx_lf_job_payroll_adjustments_job").on(t.leadflowJobId),
  index("idx_lf_job_payroll_adjustments_created").on(t.createdAt),
]);

export type LeadflowJobPayrollAdjustment = typeof leadflowJobPayrollAdjustments.$inferSelect;
export type InsertLeadflowJobPayrollAdjustment = typeof leadflowJobPayrollAdjustments.$inferInsert;
