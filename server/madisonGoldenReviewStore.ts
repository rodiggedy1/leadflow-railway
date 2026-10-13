import { bigint, datetime, index, json, mysqlEnum, mysqlTable, text, uniqueIndex, varchar } from "drizzle-orm/mysql-core";

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

/** Human review of a live AI Team SMS comparison. One review per live inbound turn. */
export const madisonLiveGoldenReviews = mysqlTable("madison_live_golden_reviews", {
  id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
  reviewKey: varchar("reviewKey", { length: 64 }).notNull(),
  sessionId: bigint("sessionId", { mode: "number" }).notNull(),
  inboundMessage: text("inboundMessage").notNull(),
  standardResponse: text("standardResponse").notNull(),
  goldenResponse: text("goldenResponse"),
  score: bigint("score", { mode: "number" }).notNull(),
  failureTags: json("failureTags").$type<string[]>().notNull(),
  notes: text("notes"),
  reviewer: varchar("reviewer", { length: 128 }).notNull(),
  createdAt: datetime("createdAt", { mode: "date", fsp: 3 }).notNull(),
  updatedAt: datetime("updatedAt", { mode: "date", fsp: 3 }).notNull(),
}, (table) => [
  uniqueIndex("uq_madison_live_golden_review_key").on(table.reviewKey),
  index("idx_madison_live_golden_review_session").on(table.sessionId),
]);

export type MadisonLiveGoldenReview = typeof madisonLiveGoldenReviews.$inferSelect;
export type InsertMadisonLiveGoldenReview = typeof madisonLiveGoldenReviews.$inferInsert;
