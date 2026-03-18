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
  email: varchar("email", { length: 320 }), // nullable — voice leads may not provide email
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
  "WIDGET_SIZING",
  "REACTIVATION",
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
  /**
   * REVIEW_REQUESTED → Feedback SMS sent 24h after cleaning, waiting for reply
   * REVIEW_DONE      → Review flow complete (positive or negative handled)
   */
  "REVIEW_REQUESTED",
  "REVIEW_DONE",
  /**
   * FUTURE_BOOKING → Lead expressed interest but for a future date (weeks/months away).
   * We acknowledge the timeline, stop the booking flow, and tag them for follow-up.
   */
  "FUTURE_BOOKING",
  /**
   * FOLLOW_UP_SCHEDULED → Agent has set a specific future date to re-engage this lead.
   * The system will automatically send a circle-back SMS on that date.
   */
  "FOLLOW_UP_SCHEDULED",
  /**
   * LANGUAGE_CONFIRM → AI detected a non-English message and sent a bilingual confirmation.
   * Waiting for the lead to confirm their preferred language before continuing.
   */
  "LANGUAGE_CONFIRM",
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
  /**
   * AI mode: 1 = AI auto-replies to inbound SMS (default), 0 = manual/agent takes over.
   * When an agent takes over, the AI stops responding and the agent replies from the app.
   */
  aiMode: int("aiMode").default(1).notNull(),
  /**
   * Actual booked/invoiced amount in dollars (integer cents-free).
   * If set, this overrides quotedPrice + extras for revenue calculations.
   * Admin can edit this after marking a lead as BOOKED.
   */
  bookedAmount: int("bookedAmount"),

  // ── UTM Attribution fields ──────────────────────────────────────────────────
  /** Traffic source (e.g. "google", "facebook", "instagram") */
  utmSource: varchar("utmSource", { length: 100 }),
  /** Medium (e.g. "cpc", "organic", "social") */
  utmMedium: varchar("utmMedium", { length: 100 }),
  /** Campaign name (e.g. "dc-deep-clean-spring") */
  utmCampaign: varchar("utmCampaign", { length: 255 }),
  /** Ad content variant */
  utmContent: varchar("utmContent", { length: 255 }),
  /** Google Ads click ID for exact ad attribution */
  gclid: varchar("gclid", { length: 255 }),
  /** Lead source: "form" = full quote form, "widget" = floating chat widget on maidsinblack.com, "reactivation" = reactivation campaign */
  leadSource: varchar("leadSource", { length: 20 }).$default(() => "form"),
  /** For reactivation leads: the last price they paid (dollars) */
  reactivationLastPrice: int("reactivationLastPrice"),
  /** For reactivation leads: discount percentage offered (e.g. 10 = 10%) */
  reactivationDiscountPct: int("reactivationDiscountPct"),

  // ── Follow-up fields ──────────────────────────────────────────────────────
  /**
   * Timestamp of the last outbound AI message sent to this lead.
   * Used to detect 5-minute silence and trigger an auto follow-up nudge.
   */
  lastAiMessageAt: timestamp("lastAiMessageAt"),
  /** Whether the 5-minute auto follow-up nudge has already been sent (prevents double-send) */
  autoFollowUpSent: int("autoFollowUpSent").default(0).notNull(),
  /** Date (YYYY-MM-DD ET) on which to send the manual circle-back SMS */
  followUpDate: varchar("followUpDate", { length: 20 }),
  /** Editable circle-back message to send on followUpDate */
  followUpMessage: text("followUpMessage"),
  /** Whether the scheduled follow-up SMS has already been sent */
  followUpSent: int("followUpSent").default(0).notNull(),

  // ── Language / Multilingual fields ────────────────────────────────────────
  /**
   * ISO 639-1 language code for this conversation (e.g. "en", "es", "fr", "zh").
   * Defaults to "en". Set after lead confirms language preference.
   */
  language: varchar("language", { length: 10 }).default("en").notNull(),
  /**
   * The stage the conversation was in before LANGUAGE_CONFIRM was triggered.
   * Used to resume the correct flow after language is confirmed.
   */
  preLangStage: varchar("preLangStage", { length: 50 }),

  /**
   * SMS opt-out flag. Set to 1 when the lead replies STOP/UNSUBSCRIBE.
   * When true, no outbound SMS should be sent to this number.
   */
  smsOptOut: int("smsOptOut").default(0).notNull(),

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

/**
 * pageViews — lightweight visit tracking for the quote form.
 * One row per page load. Used to calculate visitor-to-lead conversion rate.
 * We deduplicate by sessionKey (random ID stored in sessionStorage) so
 * refreshes don't inflate the count.
 */
export const pageViews = mysqlTable("page_views", {
  id: int("id").autoincrement().primaryKey(),
  /** Random session key from the browser (sessionStorage) — prevents refresh inflation */
  sessionKey: varchar("sessionKey", { length: 64 }).notNull().unique(),
  /** UTM source at time of visit */
  utmSource: varchar("utmSource", { length: 100 }),
  utmMedium: varchar("utmMedium", { length: 100 }),
  utmCampaign: varchar("utmCampaign", { length: 255 }),
  /**
   * Seconds elapsed from page mount to first real interaction (mouse/touch/key/scroll).
   * Used as a bot filter: sessions with timeOnPage < 8 are excluded from visitor counts.
   * NULL means the row was recorded before this column was added (treated as valid).
   */
  timeOnPage: int("timeOnPage"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type PageView = typeof pageViews.$inferSelect;
export type InsertPageView = typeof pageViews.$inferInsert;

/**
 * Reactivation campaign statuses:
 * DRAFT     → Created but not yet launched
 * ACTIVE    → Currently sending (throttled)
 * PAUSED    → Manually paused mid-send
 * COMPLETED → All contacts have been messaged
 */
export const campaignStatuses = [
  "DRAFT",
  "ACTIVE",
  "PAUSED",
  "COMPLETED",
] as const;

export type CampaignStatus = (typeof campaignStatuses)[number];

/**
 * reactivationCampaigns — one row per campaign run.
 * Tracks the message template, target segment, and aggregate stats.
 */
export const reactivationCampaigns = mysqlTable("reactivation_campaigns", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  messageTemplate: text("messageTemplate").notNull(), // supports [Name] merge tag
  /** Target segment: "6-12mo" | "1-2yr" | "all" */
  segment: varchar("segment", { length: 20 }).notNull(),
  /** Source type: "csv" = uploaded CSV, "completed_jobs" = pulled from completedJobs DB */
  sourceType: varchar("sourceType", { length: 20 }).default("csv").notNull(),
  status: mysqlEnum("status", campaignStatuses as unknown as [string, ...string[]]).default("DRAFT").notNull(),
  /** Max SMS per hour (throttle rate) */
  batchSize: int("batchSize").default(50).notNull(),
  /** Aggregate counters — updated as campaign progresses */
  totalContacts: int("totalContacts").default(0).notNull(),
  sentCount: int("sentCount").default(0).notNull(),
  repliedCount: int("repliedCount").default(0).notNull(),
  bookedCount: int("bookedCount").default(0).notNull(),
  /** When the campaign was last sent/advanced */
  lastSentAt: timestamp("lastSentAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type ReactivationCampaign = typeof reactivationCampaigns.$inferSelect;
export type InsertReactivationCampaign = typeof reactivationCampaigns.$inferInsert;

/**
 * Reactivation contact statuses:
 * PENDING  → Not yet messaged
 * SENT     → SMS sent, awaiting reply
 * REPLIED  → Lead replied (conversation engine took over)
 * BOOKED   → Lead booked a clean
 * OPTED_OUT → Lead replied STOP or similar
 */
export const contactStatuses = [
  "PENDING",
  "SENT",
  "REPLIED",
  "BOOKED",
  "OPTED_OUT",
] as const;

export type ContactStatus = (typeof contactStatuses)[number];

/**
 * reactivationContacts — one row per customer per campaign.
 * Populated when a campaign is created from the imported CSV.
 */
export const reactivationContacts = mysqlTable("reactivation_contacts", {
  id: int("id").autoincrement().primaryKey(),
  campaignId: int("campaignId").notNull(),
  /** E.164 normalized phone number */
  phone: varchar("phone", { length: 20 }).notNull(),
  /** Raw phone as it appeared in the CSV */
  phoneRaw: varchar("phoneRaw", { length: 30 }),
  name: varchar("name", { length: 255 }),
  firstName: varchar("firstName", { length: 100 }),
  email: varchar("email", { length: 320 }),
  lastBookingDate: varchar("lastBookingDate", { length: 20 }), // YYYY-MM-DD
  daysSince: int("daysSince"),
  bookingCount: int("bookingCount").default(0).notNull(),
  /** Last service price from CSV (dollars) */
  lastPrice: int("lastPrice"),
  /** Discount percentage for this campaign (default 10) */
  discountPct: int("discountPct").default(10).notNull(),
  segment: varchar("segment", { length: 20 }), // "6-12mo" | "1-2yr"
  status: mysqlEnum("status", contactStatuses as unknown as [string, ...string[]]).default("PENDING").notNull(),
  /** When the SMS was sent */
  sentAt: timestamp("sentAt"),
  /** When the lead first replied */
  repliedAt: timestamp("repliedAt"),
  /** Link to the conversation session created when they reply */
  sessionId: int("sessionId"),
  /** Link back to the completedJobs row this contact was sourced from (null for CSV-sourced contacts) */
  completedJobId: int("completedJobId"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type ReactivationContact = typeof reactivationContacts.$inferSelect;
export type InsertReactivationContact = typeof reactivationContacts.$inferInsert;

/**
 * completedJobBatches — one row per CSV upload of completed jobs.
 * Tracks aggregate stats for each day's batch.
 */
export const completedJobBatches = mysqlTable("completed_job_batches", {
  id: int("id").autoincrement().primaryKey(),
  filename: varchar("filename", { length: 255 }).notNull(),
  /** Date the jobs were completed (from CSV or upload date) */
  jobDate: varchar("jobDate", { length: 20 }), // YYYY-MM-DD
  totalCount: int("totalCount").default(0).notNull(),
  sentCount: int("sentCount").default(0).notNull(),
  positiveCount: int("positiveCount").default(0).notNull(),
  negativeCount: int("negativeCount").default(0).notNull(),
  reviewConfirmedCount: int("reviewConfirmedCount").default(0).notNull(),
  uploadedAt: timestamp("uploadedAt").defaultNow().notNull(),
});

export type CompletedJobBatch = typeof completedJobBatches.$inferSelect;
export type InsertCompletedJobBatch = typeof completedJobBatches.$inferInsert;

/**
 * Completed job contact statuses:
 * PENDING           → Uploaded, SMS not yet sent (waiting 24h)
 * SENT              → Feedback SMS sent
 * REPLIED_POSITIVE  → Customer replied positively (Google link + 10% off sent)
 * REPLIED_NEGATIVE  → Customer replied negatively (flagged, manual mode)
 * REVIEW_CONFIRMED  → Customer confirmed they left a review (reactivation contact created)
 * OPTED_OUT         → Customer replied STOP
 */
export const completedJobStatuses = [
  "PENDING",
  "SENT",
  "REPLIED_POSITIVE",
  "REPLIED_NEGATIVE",
  "REVIEW_CONFIRMED",
  "OPTED_OUT",
] as const;

export type CompletedJobStatus = (typeof completedJobStatuses)[number];

/**
 * completedJobs — one row per customer per batch.
 * Populated when a completed jobs CSV is uploaded.
 */
export const completedJobs = mysqlTable("completed_jobs", {
  id: int("id").autoincrement().primaryKey(),
  batchId: int("batchId").notNull(),
  /** E.164 normalized phone number */
  phone: varchar("phone", { length: 20 }).notNull(),
  name: varchar("name", { length: 255 }),
  firstName: varchar("firstName", { length: 100 }),
  /** Customer email — captured from Launch27 or CSV */
  email: varchar("email", { length: 320 }),
  /** Full service address */
  address: varchar("address", { length: 500 }),
  /** Service type from CSV or Launch27 */
  serviceType: varchar("serviceType", { length: 100 }),
  /** Booking frequency (e.g. Monthly, Weekly, One-time) */
  frequency: varchar("frequency", { length: 100 }),
  /** Launch27 booking ID for deep-linking back to the original booking */
  launch27BookingId: varchar("launch27BookingId", { length: 64 }),
  /** Total price of the booking (for reactivation discount calculation) */
  lastBookingPrice: int("lastBookingPrice"),
  /** Date of the completed job (YYYY-MM-DD) */
  jobDate: varchar("jobDate", { length: 20 }),
  status: mysqlEnum("status", completedJobStatuses as unknown as [string, ...string[]]).default("PENDING").notNull(),
  /** When the feedback SMS was sent */
  smsSentAt: timestamp("smsSentAt"),
  /** When the customer replied */
  repliedAt: timestamp("repliedAt"),
  /** Link to the conversation session created for the review flow */
  sessionId: int("sessionId"),
  /**
   * Whether this customer is eligible for a reactivation campaign.
   * Set to 1 automatically 30 days after jobDate if no new booking is detected.
   * Campaigns query this field to build their contact lists.
   */
  reactivationEligible: int("reactivationEligible").default(0).notNull(),
  /** When reactivation eligibility was set */
  reactivationEligibleAt: timestamp("reactivationEligibleAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type CompletedJob = typeof completedJobs.$inferSelect;
export type InsertCompletedJob = typeof completedJobs.$inferInsert;

/**
 * messageTemplates — editable SMS copy for Reactivation and Post-Sale Review flows.
 * flowType: "reactivation" | "review"
 * stepKey: unique identifier for each step (e.g. "reactivation_initial", "review_positive")
 * label: human-readable step name shown in the UI timeline
 * triggerLabel: describes when this message fires (e.g. "Sent on campaign launch", "24h after job")
 * body: the SMS copy with [Name], [Price], [DiscountedPrice], [GoogleReviewUrl] placeholders
 * variables: JSON array of variable names used in the body (for hint display)
 * isEditable: false for opt-out/unsubscribe messages that should not be changed
 */
export const messageTemplates = mysqlTable("message_templates", {
  id: int("id").autoincrement().primaryKey(),
  flowType: mysqlEnum("flowType", ["reactivation", "review"]).notNull(),
  stepKey: varchar("stepKey", { length: 100 }).notNull().unique(),
  label: varchar("label", { length: 200 }).notNull(),
  triggerLabel: varchar("triggerLabel", { length: 200 }).notNull(),
  body: text("body").notNull(),
  variables: text("variables"), // JSON array: ["[Name]", "[Price]"]
  isEditable: int("isEditable").default(1).notNull(), // 0 = locked (opt-out messages)
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type MessageTemplate = typeof messageTemplates.$inferSelect;
export type InsertMessageTemplate = typeof messageTemplates.$inferInsert;

/**
 * Always-On Campaign Groups
 *
 * Four standing groups that run continuously:
 *   new-one-time     → First-time customers, messaged 3 days after job date
 *   lapsed-one-time  → One-time customers who haven't rebooked, messaged 21 days after job date
 *   lapsed-recurring → Recurring customers (monthly/biweekly/etc) who've gone past their
 *                      frequency window + 7-day buffer
 *   dormant          → Anyone (any frequency) whose last job was 6+ months ago
 *
 * Active recurring customers (last job within frequency window + 7 days) are NEVER enrolled.
 */
export const alwaysOnGroupTypes = [
  "new-one-time",
  "lapsed-one-time",
  "lapsed-recurring",
  "dormant",
] as const;

export type AlwaysOnGroupType = (typeof alwaysOnGroupTypes)[number];

export const alwaysOnGroups = mysqlTable("always_on_groups", {
  id: int("id").autoincrement().primaryKey(),
  /** Unique group identifier — matches AlwaysOnGroupType */
  groupType: varchar("groupType", { length: 30 }).notNull().unique(),
  /** Human-readable name shown in the UI */
  name: varchar("name", { length: 100 }).notNull(),
  /** Short description of who this group targets */
  description: text("description"),
  /** Whether this group is actively enrolling and sending */
  isActive: int("isActive").default(1).notNull(),
  /** SMS message template — supports [Name], [Price], [DiscountedPrice] placeholders */
  messageTemplate: text("messageTemplate").notNull(),
  /** Max SMS per hour for this group */
  batchSize: int("batchSize").default(25).notNull(),
  /** Aggregate counters */
  totalEnrolled: int("totalEnrolled").default(0).notNull(),
  sentCount: int("sentCount").default(0).notNull(),
  repliedCount: int("repliedCount").default(0).notNull(),
  bookedCount: int("bookedCount").default(0).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type AlwaysOnGroup = typeof alwaysOnGroups.$inferSelect;
export type InsertAlwaysOnGroup = typeof alwaysOnGroups.$inferInsert;

/**
 * Always-On Enrollment statuses:
 * PENDING   → Enrolled, SMS not yet sent
 * SENT      → SMS sent, awaiting reply
 * REPLIED   → Customer replied (conversation engine took over)
 * BOOKED    → Customer booked a clean
 * OPTED_OUT → Customer replied STOP
 * SKIPPED   → Skipped (e.g. active recurring detected at send time)
 */
export const alwaysOnEnrollmentStatuses = [
  "PENDING",
  "SENT",
  "REPLIED",
  "BOOKED",
  "OPTED_OUT",
  "SKIPPED",
] as const;

export type AlwaysOnEnrollmentStatus = (typeof alwaysOnEnrollmentStatuses)[number];

export const alwaysOnEnrollments = mysqlTable("always_on_enrollments", {
  id: int("id").autoincrement().primaryKey(),
  /** Which always-on group this enrollment belongs to */
  groupId: int("groupId").notNull(),
  /** The completed job that triggered this enrollment */
  completedJobId: int("completedJobId").notNull(),
  /** E.164 normalized phone */
  phone: varchar("phone", { length: 20 }).notNull(),
  firstName: varchar("firstName", { length: 100 }),
  name: varchar("name", { length: 255 }),
  /** Booking frequency at time of enrollment */
  frequency: varchar("frequency", { length: 100 }),
  /** Last booking price (for discount calculation) */
  lastBookingPrice: int("lastBookingPrice"),
  /** Discount percentage offered (default 10) */
  discountPct: int("discountPct").default(10).notNull(),
  status: mysqlEnum("status", alwaysOnEnrollmentStatuses as unknown as [string, ...string[]]).default("PENDING").notNull(),
  /** When the SMS was sent */
  sentAt: timestamp("sentAt"),
  /** When the customer first replied */
  repliedAt: timestamp("repliedAt"),
  /** Link to the conversation session created when they reply */
  sessionId: int("sessionId"),
  /** Date of the job that triggered eligibility (YYYY-MM-DD) */
  jobDate: varchar("jobDate", { length: 20 }),
  /** OpenPhone message ID returned after successful send */
  openPhoneMessageId: varchar("openPhoneMessageId", { length: 100 }),
  enrolledAt: timestamp("enrolledAt").defaultNow().notNull(),
});

export type AlwaysOnEnrollment = typeof alwaysOnEnrollments.$inferSelect;
export type InsertAlwaysOnEnrollment = typeof alwaysOnEnrollments.$inferInsert;

/**
 * syncRuns — one row per automated cron job execution.
 * Tracks success/failure, record counts, and timing for the health dashboard.
 *
 * runType:
 *   "launch27-sync"   → Nightly Launch27 booking import (10 PM ET)
 *   "always-on-send"  → Daily always-on SMS batch (10 AM ET Mon-Sat)
 *
 * status:
 *   "success" → Completed without errors
 *   "partial" → Completed but with some failures/warnings
 *   "error"   → Failed with an exception
 *   "skipped" → Nothing to do (e.g. no bookings, outside TCPA window)
 */
export const syncRunStatuses = ["success", "partial", "error", "skipped"] as const;
export type SyncRunStatus = (typeof syncRunStatuses)[number];

export const syncRunTypes = ["launch27-sync", "always-on-send"] as const;
export type SyncRunType = (typeof syncRunTypes)[number];

export const syncRuns = mysqlTable("sync_runs", {
  id: int("id").autoincrement().primaryKey(),
  /** Type of cron job that produced this run */
  runType: mysqlEnum("runType", syncRunTypes as unknown as [string, ...string[]]).notNull(),
  /** Overall result of the run */
  status: mysqlEnum("status", syncRunStatuses as unknown as [string, ...string[]]).notNull(),
  /** Human-readable summary message */
  message: text("message"),
  /** Error details if status = error */
  errorDetail: text("errorDetail"),
  /** For launch27-sync: number of new records inserted */
  recordsInserted: int("recordsInserted").default(0),
  /** For launch27-sync: number of records skipped (duplicates/invalid) */
  recordsSkipped: int("recordsSkipped").default(0),
  /** For always-on-send: total SMS sent across all groups */
  smsSent: int("smsSent").default(0),
  /** For always-on-send: total SMS that failed to send */
  smsFailed: int("smsFailed").default(0),
  /** For always-on-send: per-group breakdown as JSON { groupType: { sent, failed } } */
  groupBreakdown: text("groupBreakdown"),
  /** For launch27-sync: always-on enrollment counts as JSON { groupType: count } */
  enrollmentBreakdown: text("enrollmentBreakdown"),
  /** Target date for the sync (YYYY-MM-DD) — null for always-on-send */
  targetDate: varchar("targetDate", { length: 20 }),
  /** How long the run took in milliseconds */
  durationMs: int("durationMs"),
  startedAt: timestamp("startedAt").defaultNow().notNull(),
  completedAt: timestamp("completedAt"),
});

export type SyncRun = typeof syncRuns.$inferSelect;
export type InsertSyncRun = typeof syncRuns.$inferInsert;

// ── Activity Log ──────────────────────────────────────────────────────────────
// Unified feed of all notable events in the system for the notification widget.

export const activityEventTypes = [
  "lead_reply",        // Inbound SMS from a lead
  "ai_sms_sent",       // AI sent an outbound SMS during a conversation
  "silence_nudge",     // Auto 5-min silence nudge sent
  "scheduled_followup",// Manual scheduled follow-up SMS sent
  "always_on_batch",   // Always-On batch SMS send completed
  "nightly_sync",      // Nightly Launch27 sync completed
  "review_send",       // Review SMS batch sent (10 AM daily)
  "booking",           // Lead reached BOOKED stage
  "new_lead",          // New quote form / widget submission
] as const;

export const activityLog = mysqlTable("activity_log", {
  id: int("id").autoincrement().primaryKey(),
  /** Event category */
  eventType: mysqlEnum("eventType", activityEventTypes as unknown as [string, ...string[]]).notNull(),
  /** Short title shown in the notification feed */
  title: varchar("title", { length: 255 }).notNull(),
  /** Longer description / body */
  body: text("body"),
  /** JSON metadata (e.g. sessionId, leadPhone, leadName, smsSent) */
  meta: text("meta"),
  /** Null = unread, set to timestamp when admin marks read */
  readAt: timestamp("readAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type ActivityLog = typeof activityLog.$inferSelect;
export type InsertActivityLog = typeof activityLog.$inferInsert;

// ── Voice Calls (Vapi) ────────────────────────────────────────────────────────

/**
 * voiceCalls — one row per inbound call handled by the Vapi AI agent.
 * Linked to a conversationSession when a lead was created or matched mid-call.
 */
export const voiceCallOutcomes = [
  "booked",
  "quote_given",
  "faq_answered",
  "transferred",
  "no_action",
  "callback_requested",
] as const;

export type VoiceCallOutcome = (typeof voiceCallOutcomes)[number];

export const voiceCalls = mysqlTable("voice_calls", {
  id: int("id").autoincrement().primaryKey(),
  /** Vapi call ID (unique per call) */
  vapiCallId: varchar("vapiCallId", { length: 128 }).notNull().unique(),
  /** Linked conversation session (null if no lead was created/matched) */
  sessionId: int("sessionId"),
  /** Caller's E.164 phone number */
  callerPhone: varchar("callerPhone", { length: 30 }).notNull(),
  /** Call duration in seconds */
  durationSeconds: int("durationSeconds").default(0).notNull(),
  /** Full call transcript */
  transcript: text("transcript"),
  /** AI-generated summary of the call */
  summary: text("summary"),
  /** URL to the call recording audio file */
  recordingUrl: varchar("recordingUrl", { length: 512 }),
  /** Call outcome extracted from structured data */
  outcome: varchar("outcome", { length: 50 }).default("no_action").notNull(),
  /** Full structured data JSON from Vapi analysis */
  structuredData: text("structuredData"),
  /** Why the call ended (e.g. "customer-ended-call", "assistant-ended-call", "silence-timed-out") */
  endedReason: varchar("endedReason", { length: 100 }),
  /** Vapi's success evaluation ("true" | "false") */
  successEvaluation: varchar("successEvaluation", { length: 10 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type VoiceCall = typeof voiceCalls.$inferSelect;
export type InsertVoiceCall = typeof voiceCalls.$inferInsert;

// ── Callback Tasks ────────────────────────────────────────────────────────────
/**
 * callbackTasks — created when a caller requests a callback during a voice call.
 * Madison collects their preferred time and this record appears in the admin dashboard.
 */
export const callbackTasks = mysqlTable("callback_tasks", {
  id: int("id").autoincrement().primaryKey(),
  /** Linked voice call (if available) */
  voiceCallId: int("voiceCallId"),
  /** Linked conversation session (if lead was created) */
  sessionId: int("sessionId"),
  /** Caller's E.164 phone number */
  callerPhone: varchar("callerPhone", { length: 30 }).notNull(),
  /** Caller's name as collected by Madison */
  callerName: varchar("callerName", { length: 128 }),
  /** Preferred callback time as described by caller (e.g. "tomorrow morning", "Friday after 2pm") */
  preferredCallbackTime: varchar("preferredCallbackTime", { length: 255 }),
  /** Brief context note from Madison (e.g. "Interested in 3bd deep clean, wanted to speak to human") */
  notes: text("notes"),
  /** Whether an agent has completed this callback */
  completed: int("completed").default(0).notNull(),
  /** Agent who completed the callback */
  completedByAgentName: varchar("completedByAgentName", { length: 128 }),
  completedAt: timestamp("completedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type CallbackTask = typeof callbackTasks.$inferSelect;
export type InsertCallbackTask = typeof callbackTasks.$inferInsert;
