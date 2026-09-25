import { datetime, index, int, mysqlTable, timestamp, uniqueIndex, varchar } from "drizzle-orm/mysql-core";

/**
 * Provider state for a LeadFlow invoice. Kept separate from the legacy shared
 * schema so payment-link work has no dependency on operational job storage.
 */
export const invoiceStripeLinks = mysqlTable("invoice_stripe_links", {
  id: int("id").autoincrement().primaryKey(),
  invoiceId: int("invoiceId").notNull(),
  stripeInvoiceId: varchar("stripeInvoiceId", { length: 255 }).notNull(),
  stripeCustomerId: varchar("stripeCustomerId", { length: 255 }).notNull(),
  stripeInvoiceStatus: varchar("stripeInvoiceStatus", { length: 32 }).notNull().default("draft"),
  hostedInvoiceUrl: varchar("hostedInvoiceUrl", { length: 1000 }),
  paidAt: datetime("paidAt", { mode: "date", fsp: 3 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (t) => [
  uniqueIndex("uq_invoice_stripe_links_invoice").on(t.invoiceId),
  uniqueIndex("uq_invoice_stripe_links_stripe_invoice").on(t.stripeInvoiceId),
  index("idx_invoice_stripe_links_status").on(t.stripeInvoiceStatus),
]);
