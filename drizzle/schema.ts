import { int, mysqlEnum, mysqlTable, text, timestamp, varchar } from "drizzle-orm/mysql-core";

/**
 * Core user table backing auth flow.
 * Extend this file with additional tables as your product grows.
 * Columns use camelCase to match both database fields and generated types.
 */
export const users = mysqlTable("users", {
  /**
   * Surrogate primary key. Auto-incremented numeric value managed by the database.
   * Use this for relations between tables.
   */
  id: int("id").autoincrement().primaryKey(),
  /** Manus OAuth identifier (openId) returned from the OAuth callback. Unique per user. */
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

// Quote leads table — stores every form submission
export const quoteLeads = mysqlTable("quote_leads", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  email: varchar("email", { length: 320 }).notNull(),
  phone: varchar("phone", { length: 30 }).notNull(),
  serviceType: varchar("serviceType", { length: 100 }).notNull(),
  bedrooms: varchar("bedrooms", { length: 50 }).notNull(),
  bathrooms: varchar("bathrooms", { length: 50 }).notNull(),
  extras: text("extras"), // JSON array of selected extra service keys
  smsSent: int("smsSent").default(0).notNull(), // 1 = sent, 0 = failed/pending
  smsMessageId: varchar("smsMessageId", { length: 128 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type QuoteLead = typeof quoteLeads.$inferSelect;
export type InsertQuoteLead = typeof quoteLeads.$inferInsert;

/**
 * Conversation stages for the AI SMS flow:
 * QUOTE_SENT     → Initial quote + price sent, waiting for any reply
 * AVAILABILITY   → Availability message sent, waiting for yes/no
 * SLOT_CHOICE    → Slot options sent (Thu 1PM / Sat 9AM), waiting for choice
 * ADDRESS        → Slot confirmed, waiting for address
 * CONFIRMATION   → Address captured, confirmation + call question sent
 * CALL_SCHEDULED → Lead said call now / in a few minutes
 * DONE           → Conversation complete
 * UNHANDLED      → AI couldn't parse the reply, needs human review
 * BOOKED         → Lead has been booked (admin/agent confirmed)
 * NOT_INTERESTED → Lead declined or is not a fit
 */
export const conversationStages = [
  "QUOTE_SENT",
  "AVAILABILITY",
  "SLOT_CHOICE",
  "TIME_PREF",
  "ADDRESS",
  "CONFIRMATION",
  "CALL_SCHEDULED",
  "DONE",
  "UNHANDLED",
  "BOOKED",
  "NOT_INTERESTED",
] as const;

export type ConversationStage = (typeof conversationStages)[number];

// Conversation sessions — one row per form submission; multiple rows allowed per phone number
export const conversationSessions = mysqlTable("conversation_sessions", {
  id: int("id").autoincrement().primaryKey(),
  leadPhone: varchar("leadPhone", { length: 30 }).notNull(), // E.164 format (no unique — same phone can submit again later)
  leadName: varchar("leadName", { length: 255 }),
  stage: mysqlEnum("stage", conversationStages as unknown as [string, ...string[]]).default("QUOTE_SENT").notNull(),
  // Collected data across the conversation
  quotedPrice: varchar("quotedPrice", { length: 20 }),
  serviceType: varchar("serviceType", { length: 100 }),
  bedrooms: varchar("bedrooms", { length: 50 }),
  bathrooms: varchar("bathrooms", { length: 50 }),
  extras: text("extras"), // JSON array of selected extra service keys
  selectedSlot: varchar("selectedSlot", { length: 100 }), // e.g. "Thursday 1PM"
  address: text("address"),
  callPreference: varchar("callPreference", { length: 50 }), // "now" | "few_minutes"
  // Full message history as JSON array for ChatGPT context (stored as JSON string)
  messageHistory: varchar("messageHistory", { length: 5000 }).default("[]").notNull(),
  // Link back to the original quote lead
  quoteLeadId: int("quoteLeadId"),

  // ── Agent activity fields ──────────────────────────────────────────────────
  /** ID of the agent (user.id) who has claimed this lead */
  assignedAgentId: int("assignedAgentId"),
  /** Denormalized name for fast display without joins */
  assignedAgentName: varchar("assignedAgentName", { length: 255 }),
  /** When an agent last called this lead */
  lastCalledAt: timestamp("lastCalledAt"),
  /** Agent who made the last call */
  lastCalledByAgentId: int("lastCalledByAgentId"),
  lastCalledByAgentName: varchar("lastCalledByAgentName", { length: 255 }),
  /** Booking status */
  isBooked: int("isBooked").default(0).notNull(), // 0 = not booked, 1 = booked
  bookedAt: timestamp("bookedAt"),
  bookedByAgentId: int("bookedByAgentId"),
  bookedByAgentName: varchar("bookedByAgentName", { length: 255 }),

  /** Internal notes visible only to admins and agents — not shown to leads */
  internalNotes: text("internalNotes"),

  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type ConversationSession = typeof conversationSessions.$inferSelect;
export type InsertConversationSession = typeof conversationSessions.$inferInsert;

/**
 * Call log outcomes:
 * ANSWERED   → Lead picked up, conversation happened
 * NO_ANSWER  → Rang but no answer
 * VOICEMAIL  → Left a voicemail
 * BUSY       → Line was busy
 * BOOKED     → Call resulted in a booking
 * CALLBACK   → Lead asked to call back later
 */
export const callOutcomes = [
  "ANSWERED",
  "NO_ANSWER",
  "VOICEMAIL",
  "BUSY",
  "BOOKED",
  "CALLBACK",
] as const;

export type CallOutcome = (typeof callOutcomes)[number];

/**
 * leadCallLogs — one row per call attempt by an agent
 */
export const leadCallLogs = mysqlTable("lead_call_logs", {
  id: int("id").autoincrement().primaryKey(),
  /** The conversation session this call is associated with */
  sessionId: int("sessionId").notNull(),
  /** Agent who made the call */
  agentId: int("agentId").notNull(),
  agentName: varchar("agentName", { length: 255 }).notNull(),
  /** Call outcome */
  outcome: mysqlEnum("outcome", callOutcomes as unknown as [string, ...string[]]).notNull(),
  /** Optional notes from the agent */
  notes: text("notes"),
  calledAt: timestamp("calledAt").defaultNow().notNull(),
});

export type LeadCallLog = typeof leadCallLogs.$inferSelect;
export type InsertLeadCallLog = typeof leadCallLogs.$inferInsert;

/**
 * agents — internal agent accounts (no Manus OAuth required)
 * Created by admins; agents log in with email + password.
 */
export const agents = mysqlTable("agents", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  email: varchar("email", { length: 320 }).notNull().unique(),
  passwordHash: varchar("passwordHash", { length: 255 }).notNull(),
  isActive: int("isActive").default(1).notNull(), // 1 = active, 0 = deactivated
  isAdmin: int("isAdmin").default(0).notNull(), // 1 = admin, 0 = regular agent
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Agent = typeof agents.$inferSelect;
export type InsertAgent = typeof agents.$inferInsert;
