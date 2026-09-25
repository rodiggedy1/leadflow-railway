/**
 * Gmail message HTML cache.
 *
 * The cache retains the HTML Gmail already returned to the existing glance worker.
 * It supplies the Command Chat fallback only when live Gmail thread detail is unavailable.
 */
import { datetime, index, int, mediumtext, mysqlTable, uniqueIndex, varchar } from "drizzle-orm/mysql-core";

export const gmailMessageHtmlCache = mysqlTable("gmail_message_html_cache", {
  id: int("id").autoincrement().primaryKey(),
  threadId: varchar("threadId", { length: 255 }).notNull(),
  messageId: varchar("messageId", { length: 255 }).notNull(),
  bodyHtml: mediumtext("bodyHtml").notNull(),
  capturedAt: datetime("capturedAt", { mode: "date", fsp: 3 }).notNull(),
}, (table) => [
  uniqueIndex("uq_gmail_message_html_cache_message").on(table.messageId),
  index("idx_gmail_message_html_cache_thread").on(table.threadId),
]);
