import { bigint, datetime, json, mysqlEnum, mysqlTable, text, uniqueIndex, varchar } from "drizzle-orm/mysql-core";

export const madisonGoldenReviewRatings = ["correct", "incorrect", "uncertain"] as const;

export type MadisonGoldenExpectedAnnotation = {
  intentCategory: string | null;
  mission: string | null;
  facts: Array<{ factKey: string; normalizedValue: string; evidenceExcerpt: string }>;
  extractionCompleteness: string | null;
  missingInformation: string[];
  taskCompleteness: string | null;
  replyReadiness: string | null;
  actionReadiness: string | null;
};

export const madisonGoldenCaseReviews = mysqlTable("madison_golden_case_reviews", {
  id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
  caseId: varchar("caseId", { length: 32 }).notNull(),
  rating: mysqlEnum("rating", madisonGoldenReviewRatings as unknown as [string, ...string[]]).notNull(),
  reviewer: varchar("reviewer", { length: 128 }).notNull(),
  notes: text("notes"),
  actualPrediction: json("actualPrediction"),
  expectedAnnotation: json("expectedAnnotation").$type<MadisonGoldenExpectedAnnotation | null>(),
  reviewedAt: datetime("reviewedAt", { mode: "date", fsp: 3 }).notNull(),
  updatedAt: datetime("updatedAt", { mode: "date", fsp: 3 }).notNull(),
}, (table) => [
  uniqueIndex("uq_madison_golden_case_review_case").on(table.caseId),
]);

export type MadisonGoldenCaseReview = typeof madisonGoldenCaseReviews.$inferSelect;
export type InsertMadisonGoldenCaseReview = typeof madisonGoldenCaseReviews.$inferInsert;
