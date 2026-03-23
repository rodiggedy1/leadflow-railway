import { bigint, index, int, mysqlEnum, mysqlTable, text, timestamp, varchar } from "drizzle-orm/mysql-core";

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
  "REACTIVATION_TIME", // waiting for time window reply after YES
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
  /**
   * QUALITY_RATING_REQUESTED → Post-job rating SMS sent, waiting for 1-5 star reply.
   * QUALITY_MISSED_FOLLOWUP  → Low rating received, asked "was anything missed?", waiting for YES/NO.
   */
  "QUALITY_RATING_REQUESTED",
  "QUALITY_MISSED_FOLLOWUP",
  /**
   * QUALITY_RATING_DONE → Rating flow complete (thank-you sent, conversation closed).
   */
  "QUALITY_RATING_DONE",
  /**
   * COLD → Lead received 2+ automated nudges with no reply. All automated follow-ups
   * are stopped. Surfaced in the "Dead Leads" column on the Kanban board.
   * Leads can be manually re-engaged by an agent at any time.
   */
  "COLD",
  /**
   * LOST → Manually marked as lost/dead by an agent via the 3-dot menu on the pipeline card.
   * Excluded from active pipeline view; visible via the "Show Lost" toggle.
   */
  "LOST",
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
  /** Lead source: "form" = full quote form, "widget" = floating chat widget on maidsinblack.com, "reactivation" = reactivation campaign, "bark" = Bark.com Zapier webhook */
  leadSource: varchar("leadSource", { length: 50 }).$default(() => "form"),
  /** For reactivation leads: the last price they paid (dollars) */
  reactivationLastPrice: int("reactivationLastPrice"),
  /** For reactivation leads: discount percentage offered (e.g. 10 = 10%) */
  reactivationDiscountPct: int("reactivationDiscountPct"),
  /**
   * For Bark.com leads: the full Q&A transcript extracted from the Bark display_text field.
   * Stored as a plain-text summary of the customer's answers (bedrooms, frequency, etc.).
   * Used to skip qualification questions in the AI conversation flow.
   */
  barkQA: text("barkQA"),

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
  /**
   * Number of automated silence nudges sent to this lead without a customer reply.
   * When this reaches 2, the lead is moved to COLD and all follow-ups stop.
   */
  nudgeCount: int("nudgeCount").default(0).notNull(),
  /**
   * Reason the lead was marked as lost. One of: price, timing, no_response, competitor, other.
   * Set when stage is changed to LOST via the pipeline card menu.
   */
  lostReason: varchar("lostReason", { length: 50 }),

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

  /**
   * Which SMS conversation flow was assigned to this lead at creation time.
   * "A" = Madison flow (price upfront + availability question)
   * "B" = Jade flow (greeting + day ask → price reveal → lock in)
   * Stored here so mid-conversation flow-setting changes don't disrupt active threads.
   */
  smsFlow: varchar("smsFlow", { length: 5 }).default("B"),

  /**
   * The OpenPhone message ID of the last inbound message that was processed.
   * Used as an idempotency key to prevent duplicate processing when OpenPhone
   * delivers the same webhook event more than once (at-least-once delivery).
   */
  lastProcessedMessageId: varchar("lastProcessedMessageId", { length: 100 }),

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
  /** Number of bedrooms from the booking (parsed from service name e.g. "2 bedrooms") */
  bedrooms: int("bedrooms"),
  /** Number of bathrooms from the booking (parsed from pricing_parameters) */
  bathrooms: int("bathrooms"),
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
  /**
   * When true, this job is permanently excluded from the review SMS flow.
   * Used to skip jobs imported before the review feature was activated (pre-2026-03-18)
   * without affecting their eligibility for other campaigns (reactivation, etc.).
   */
  reviewSkipped: int("reviewSkipped").default(0).notNull(),
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

// ── Cleaner Quality Management ────────────────────────────────────────────────

/**
 * cleanerProfiles — one row per cleaner.
 * Populated from Launch27 staff data or manually by admin.
 * Stores the cleaner's pay percentage used for base pay calculation.
 */
export const cleanerProfiles = mysqlTable("cleaner_profiles", {
  id: int("id").autoincrement().primaryKey(),
  /** Cleaner's full name as it appears in Launch27 */
  name: varchar("name", { length: 255 }).notNull(),
  /** E.164 phone number for the cleaner (used for dashboard login later) */
  phone: varchar("phone", { length: 20 }),
  /** Email address */
  email: varchar("email", { length: 320 }),
  /** Pay percentage of job revenue (e.g. 0.45 = 45%) */
  payPercent: varchar("payPercent", { length: 10 }),
  /** Whether this cleaner is currently active */
  isActive: int("isActive").default(1).notNull(),
  /** Bcrypt hash of the cleaner's portal password (null = no portal access yet) */
  passwordHash: varchar("passwordHash", { length: 255 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type CleanerProfile = typeof cleanerProfiles.$inferSelect;
export type InsertCleanerProfile = typeof cleanerProfiles.$inferInsert;

/**
 * cleanerJobs — one row per cleaner assignment to a completed job.
 * Links a completedJob to a cleanerProfile and stores quality metrics.
 */
export const cleanerJobs = mysqlTable("cleaner_jobs", {
  id: int("id").autoincrement().primaryKey(),
  /** Link to completedJobs.id */
  completedJobId: int("completedJobId").notNull(),
  /** Launch27 booking ID (unique identifier from Launch27) */
  bookingId: int("bookingId"),
  /** Link to cleanerProfiles.id */
  cleanerProfileId: int("cleanerProfileId").notNull(),
  /** Cleaner name (denormalized for display) */
  cleanerName: varchar("cleanerName", { length: 255 }).notNull(),
  /** Team name from Launch27 (e.g. "Team Solange") */
  teamName: varchar("teamName", { length: 255 }),
  /** Launch27 team ID */
  teamId: int("teamId"),
  /** Job date (YYYY-MM-DD) */
  jobDate: varchar("jobDate", { length: 20 }).notNull(),
  /** Service date/time from Launch27 (ISO 8601) */
  serviceDateTime: varchar("serviceDateTime", { length: 50 }),
  /** Customer full name */
  customerName: varchar("customerName", { length: 255 }),
  /** Customer phone (for rating SMS) */
  customerPhone: varchar("customerPhone", { length: 30 }),
  /** Job address */
  jobAddress: varchar("jobAddress", { length: 500 }),
  /** Service type / names (comma-separated, e.g. "1 bedroom, 1 Bathroom") */
  serviceType: varchar("serviceType", { length: 500 }),
  /** Number of bedrooms from the booking (parsed from service name) */
  bedrooms: int("bedrooms"),
  /** Number of bathrooms from the booking (parsed from pricing_parameters) */
  bathrooms: int("bathrooms"),
  /** Booking status from Launch27 (assigned, completed, cancelled) */
  bookingStatus: varchar("bookingStatus", { length: 50 }),
  /** Customer notes from Launch27 */
  customerNotes: text("customerNotes"),
  /** Staff notes from Launch27 */
  staffNotes: text("staffNotes"),
  /** Total job revenue from Launch27 (summary.total) */
  jobRevenue: varchar("jobRevenue", { length: 20 }),
  /** Cleaner pay percentage at time of job (from team.share, e.g. "55") */
  payPercent: varchar("payPercent", { length: 10 }),
  /** Calculated base pay = jobRevenue * (payPercent/100) */
  basePay: varchar("basePay", { length: 20 }),
  /** Customer star rating (1–5), null until received */
  customerRating: int("customerRating"),
  /** Whether customer said something was missed (1=yes, 0=no, null=not asked) */
  missedSomething: int("missedSomething"),
  /** Whether the cleaner submitted a completion photo */
  photoSubmitted: int("photoSubmitted").default(0).notNull(),
  /** Rating adjustment applied (+10 for 5-star, -20 for ≤3 or complaint) */
  ratingAdjustment: varchar("ratingAdjustment", { length: 20 }),
  /** Photo adjustment: +5 if photo submitted, -10 if not (set when pay is finalized) */
  photoAdjustment: varchar("photoAdjustment", { length: 20 }),
  /** Streak bonus applied this job (0 or positive amount) */
  streakBonus: varchar("streakBonus", { length: 20 }),
  /** Final pay = basePay + ratingAdjustment + photoAdjustment + streakBonus + manualAdjustment */
  finalPay: varchar("finalPay", { length: 20 }),
  /** Admin-set one-time manual adjustment (positive or negative dollar amount, stored as string like "-15.00") */
  manualAdjustment: varchar("manualAdjustment", { length: 20 }),
  /** Reason for the manual adjustment (shown to cleaner) */
  manualAdjustmentNote: varchar("manualAdjustmentNote", { length: 255 }),
  /** Reclean penalty: -30.00 if admin marks job as requiring a reclean due to poor service (null = not applied) */
  recleanPenalty: varchar("recleanPenalty", { length: 20 }),
  /** Cleaner-reported job status */
  jobStatus: mysqlEnum("jobStatus", [
    "on_the_way",
    "arrived",
    "running_late",
    "in_progress",
    "completed",
    "issue_at_property",
  ]),
  /** Issue description when jobStatus = issue_at_property */
  issueNote: text("issueNote"),
  /** Absolute ETA as Unix ms timestamp — computed when cleaner picks an ETA option (now + duration) */
  etaTimestamp: bigint("etaTimestamp", { mode: "number" }),
  /** Whether this job has been flagged for admin review */
  flagged: int("flagged").default(0).notNull(),
  /** Admin notes on this job */
  adminNotes: text("adminNotes"),
  /** AI-parsed checklist from customerNotes. JSON array of {text: string, checked: boolean}. Null if no actionable tasks found. */
  checklistItems: text("checklistItems"),
  /** Unique public token for the customer-facing job tracker URL (e.g. /track/abc123) */
  trackerToken: varchar("trackerToken", { length: 64 }),
  /** When the tracker link SMS was sent to the customer */
  trackerSmsSentAt: timestamp("trackerSmsSentAt"),
  /** How many minutes late the cleaner is running (set when jobStatus = running_late) */
  delayMinutes: int("delayMinutes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (t) => [index("idx_cleaner_jobs_job_date").on(t.jobDate)]);
export type CleanerJob = typeof cleanerJobs.$inferSelect;
export type InsertCleanerJob = typeof cleanerJobs.$inferInsert;

/**
 * jobPhotos — completion photos uploaded by cleaners for a specific job.
 */
export const jobPhotos = mysqlTable("job_photos", {
  id: int("id").autoincrement().primaryKey(),
  /** Link to cleanerJobs.id */
  cleanerJobId: int("cleanerJobId").notNull(),
  /** Link to completedJobs.id (denormalized for easy querying) */
  completedJobId: int("completedJobId").notNull(),
  /** Cleaner profile ID */
  cleanerProfileId: int("cleanerProfileId").notNull(),
  /** S3 URL of the uploaded photo */
  photoUrl: varchar("photoUrl", { length: 1024 }).notNull(),
  /** S3 key for the photo */
  photoKey: varchar("photoKey", { length: 512 }).notNull(),
  /** S3 URL of the 200px thumbnail (generated on upload). Null for photos uploaded before this feature.) */
  thumbnailUrl: varchar("thumbnailUrl", { length: 1024 }),
  /** S3 key for the thumbnail */
  thumbnailKey: varchar("thumbnailKey", { length: 512 }),
  /** Original filename */
  filename: varchar("filename", { length: 255 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type JobPhoto = typeof jobPhotos.$inferSelect;
export type InsertJobPhoto = typeof jobPhotos.$inferInsert;

/**
 * ratingSmsPending — queue of post-job rating SMS messages awaiting admin approval.
 * Admin reviews and approves before 7pm EST; cron sends all approved at 7pm.
 */
export const ratingSmsPendingStatuses = ["pending", "approved", "sent", "skipped"] as const;
export type RatingSmsStatus = (typeof ratingSmsPendingStatuses)[number];

export const ratingSmsPending = mysqlTable("rating_sms_pending", {
  id: int("id").autoincrement().primaryKey(),
  /** Link to completedJobs.id */
  completedJobId: int("completedJobId").notNull(),
  /** Link to cleanerJobs.id (may be null if cleaner not yet assigned) */
  cleanerJobId: int("cleanerJobId"),
  /** Customer E.164 phone */
  customerPhone: varchar("customerPhone", { length: 20 }).notNull(),
  /** Customer first name for SMS greeting */
  customerFirstName: varchar("customerFirstName", { length: 100 }),
  /** Cleaner name for admin display */
  cleanerName: varchar("cleanerName", { length: 255 }),
  /** Job date (YYYY-MM-DD) */
  jobDate: varchar("jobDate", { length: 20 }).notNull(),
  /** The SMS message text to be sent */
  smsText: text("smsText").notNull(),
  /** Queue status */
  status: mysqlEnum("status", ratingSmsPendingStatuses as unknown as [string, ...string[]]).default("pending").notNull(),
  /** When admin approved this SMS */
  approvedAt: timestamp("approvedAt"),
  /** When the SMS was actually sent */
  sentAt: timestamp("sentAt"),
  /** Admin who approved (user name) */
  approvedBy: varchar("approvedBy", { length: 255 }),
  /** Reason for skipping (optional) */
  skipReason: varchar("skipReason", { length: 500 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type RatingSmsPending = typeof ratingSmsPending.$inferSelect;
export type InsertRatingSmsPending = typeof ratingSmsPending.$inferInsert;

/**
 * cleanerStreaks — tracks consecutive clean jobs per cleaner for streak bonus.
 */
export const cleanerStreaks = mysqlTable("cleaner_streaks", {
  id: int("id").autoincrement().primaryKey(),
  /** Link to cleanerProfiles.id */
  cleanerProfileId: int("cleanerProfileId").notNull().unique(),
  /** Current streak count (consecutive jobs with rating ≥4 and no complaint) */
  currentStreak: int("currentStreak").default(0).notNull(),
  /** All-time best streak */
  bestStreak: int("bestStreak").default(0).notNull(),
  /** Total streak bonuses earned (count of times streak hit 10) */
  streakBonusCount: int("streakBonusCount").default(0).notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type CleanerStreak = typeof cleanerStreaks.$inferSelect;
export type InsertCleanerStreak = typeof cleanerStreaks.$inferInsert;

// ── Cron Heartbeats ───────────────────────────────────────────────────────────
/**
 * cronHeartbeats — one row per internal cron job tick, even no-ops.
 * Lets the Sync Health page distinguish "ran and found nothing" from "never ran".
 *
 * jobName values:
 *   "nightly-sync"        → Launch27 booking import (noon ET daily)
 *   "always-on-send"      → Campaign SMS batch (10 AM ET Mon-Sat)
 *   "silence-followup"    → 5-min silence nudge (every 5 min)
 *   "scheduled-followup"  → Daily circle-back SMS (9 AM ET)
 */
export const cronHeartbeats = mysqlTable("cron_heartbeats", {
  id: int("id").autoincrement().primaryKey(),
  /** Which cron job fired */
  jobName: varchar("jobName", { length: 50 }).notNull(),
  /** Short result summary (e.g. "inserted 7", "sent 0 — no active groups", "sent 3 nudges") */
  resultSummary: varchar("resultSummary", { length: 500 }),
  /** Whether this tick did any meaningful work */
  didWork: int("didWork").default(0).notNull(),
  ranAt: timestamp("ranAt").defaultNow().notNull(),
});
export type CronHeartbeat = typeof cronHeartbeats.$inferSelect;
export type InsertCronHeartbeat = typeof cronHeartbeats.$inferInsert;

// ── Campaign Approval Batches ─────────────────────────────────────────────────
/**
 * campaignApprovalBatches — one row per pending Always-On send batch.
 * When the daily cron fires, instead of sending immediately it creates a
 * pending batch here. Admin reviews the recipient list and approves or rejects.
 * Only after approval does the actual SMS send happen.
 *
 * status:
 *   "pending"  → Awaiting admin review
 *   "approved" → Admin approved; SMS send in progress or complete
 *   "rejected" → Admin rejected; batch discarded
 *   "sent"     → All SMS sent successfully
 */
export const campaignApprovalStatuses = ["pending", "approved", "rejected", "sent"] as const;
export type CampaignApprovalStatus = (typeof campaignApprovalStatuses)[number];

export const campaignApprovalBatches = mysqlTable("campaign_approval_batches", {
  id: int("id").autoincrement().primaryKey(),
  /** Which always-on group this batch is for */
  groupId: int("groupId").notNull(),
  /** Snapshot of the group type at creation time */
  groupType: varchar("groupType", { length: 30 }).notNull(),
  /** Snapshot of the group name at creation time */
  groupName: varchar("groupName", { length: 100 }).notNull(),
  /** Snapshot of the message template at creation time */
  messageTemplate: text("messageTemplate").notNull(),
  /** JSON array of enrollment IDs included in this batch */
  enrollmentIds: text("enrollmentIds").notNull(),
  /** Number of recipients in this batch */
  recipientCount: int("recipientCount").notNull(),
  /** JSON array of preview objects: [{phone, firstName, name, message}] (first 5) */
  recipientPreview: text("recipientPreview").notNull(),
  /** Current status */
  status: mysqlEnum("status", campaignApprovalStatuses as unknown as [string, ...string[]]).default("pending").notNull(),
  /** Admin who approved or rejected */
  reviewedBy: varchar("reviewedBy", { length: 255 }),
  /** Optional rejection reason */
  rejectionReason: varchar("rejectionReason", { length: 500 }),
  /** How many SMS were actually sent after approval */
  sentCount: int("sentCount").default(0).notNull(),
  /** How many SMS failed after approval */
  failedCount: int("failedCount").default(0).notNull(),
  reviewedAt: timestamp("reviewedAt"),
  sentAt: timestamp("sentAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type CampaignApprovalBatch = typeof campaignApprovalBatches.$inferSelect;
export type InsertCampaignApprovalBatch = typeof campaignApprovalBatches.$inferInsert;

// ── App Settings ─────────────────────────────────────────────────────────────
/**
 * Key-value store for admin-configurable business settings.
 * Each row is a single setting identified by its key.
 */
export const appSettings = mysqlTable("app_settings", {
  id: int("id").primaryKey().autoincrement(),
  /** Unique setting key, e.g. "googleReviewUrl", "trackerSmsTemplate" */
  key: varchar("key", { length: 100 }).notNull().unique(),
  /** Setting value as text (booleans stored as "true"/"false") */
  value: text("value").notNull(),
  /** Human-readable label shown in the settings UI */
  label: varchar("label", { length: 200 }).notNull(),
  /** Optional description shown below the field */
  description: text("description"),
  /** Field type hint for the UI: "text" | "textarea" | "toggle" | "url" */
  fieldType: varchar("fieldType", { length: 20 }).default("text").notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type AppSetting = typeof appSettings.$inferSelect;
export type InsertAppSetting = typeof appSettings.$inferInsert;

// ── AI Insights Cache ─────────────────────────────────────────────────────────
/**
 * Caches LLM-generated AI insights (pulse cards + action feed) so the Command Center
 * loads instantly. Each row is keyed by range ("today" | "7d" | "30d").
 * The server refreshes stale entries (>30 min old) in the background.
 */
export const aiInsightsCache = mysqlTable("ai_insights_cache", {
  id: int("id").primaryKey().autoincrement(),
  /** Time range key: "today" | "7d" | "30d" */
  rangeKey: varchar("rangeKey", { length: 10 }).notNull().unique(),
  /** Full JSON payload: { pulseCards, actionFeed, generatedAt } */
  payload: text("payload").notNull(),
  /** UTC timestamp when this cache entry was last generated */
  generatedAt: timestamp("generatedAt").defaultNow().notNull(),
});
export type AiInsightsCache = typeof aiInsightsCache.$inferSelect;
export type InsertAiInsightsCache = typeof aiInsightsCache.$inferInsert;

// ── Campaign Blasts ───────────────────────────────────────────────────────────
/**
 * campaignBlasts — one row per Command Center campaign fire event.
 * Used to power the Campaign History tab and measure reply conversion.
 */
export const campaignBlasts = mysqlTable("campaign_blasts", {
  id: int("id").primaryKey().autoincrement(),
  /** Campaign type: "tomorrow_slots" | "reactivation" | "quote_followup" */
  campaignType: varchar("campaignType", { length: 50 }).notNull(),
  /** Human-readable label, e.g. "Fill Tomorrow's Open Slots" */
  campaignTitle: varchar("campaignTitle", { length: 200 }).notNull(),
  /** Batch label shown on the card, e.g. "#1–50 of 3,491" */
  batchLabel: varchar("batchLabel", { length: 100 }),
  /** Number of recipients targeted */
  recipientCount: int("recipientCount").notNull(),
  /** Number of SMS successfully sent */
  sentCount: int("sentCount").notNull().default(0),
  /** Number of SMS that failed */
  failedCount: int("failedCount").notNull().default(0),
  /** The SMS script that was sent (personalized template) */
  script: text("script"),
  /** When the blast started (first SMS sent) — used for session window matching */
  startedAt: timestamp("startedAt"),
  /** When the blast completed (last SMS sent) */
  firedAt: timestamp("firedAt").defaultNow().notNull(),
  /** Who fired it (admin user name or "system") */
  firedBy: varchar("firedBy", { length: 255 }).default("admin"),
});
export type CampaignBlast = typeof campaignBlasts.$inferSelect;
export type InsertCampaignBlast = typeof campaignBlasts.$inferInsert;

// ── SMS Opt-Outs ──────────────────────────────────────────────────────────────
/**
 * smsOptOuts — permanent STOP/opt-out registry.
 * Any phone in this table is excluded from ALL future campaign pools.
 */
export const smsOptOuts = mysqlTable("sms_opt_outs", {
  id: int("id").primaryKey().autoincrement(),
  /** E.164 normalized phone number */
  phone: varchar("phone", { length: 20 }).notNull().unique(),
  /** When the opt-out was recorded */
  optedOutAt: timestamp("optedOutAt").defaultNow().notNull(),
  /** Source: "reply_stop" | "manual" | "webhook" */
  source: varchar("source", { length: 50 }).notNull().default("reply_stop"),
  /** Optional: the raw message that triggered the opt-out */
  triggerMessage: varchar("triggerMessage", { length: 255 }),
});
export type SmsOptOut = typeof smsOptOuts.$inferSelect;
export type InsertSmsOptOut = typeof smsOptOuts.$inferInsert;

// ── Command Center Generic Cache ──────────────────────────────────────────────
/**
 * commandCenterCache — generic server-side cache for all slow Command Center queries.
 * Each row is keyed by (cacheKey, rangeKey) so any procedure can cache its result.
 * TTL is enforced by the consumer; this table just stores the payload + timestamp.
 */
export const commandCenterCache = mysqlTable("command_center_cache", {
  id: int("id").primaryKey().autoincrement(),
  /** Procedure identifier, e.g. "conv_intel" | "tomorrow_campaigns" */
  cacheKey: varchar("cacheKey", { length: 50 }).notNull(),
  /** Optional range key: "today" | "7d" | "30d" | "none" */
  rangeKey: varchar("rangeKey", { length: 10 }).notNull().default("none"),
  /** Full JSON payload */
  payload: text("payload").notNull(),
  /** UTC timestamp when this cache entry was last generated */
  generatedAt: timestamp("generatedAt").defaultNow().notNull(),
});
export type CommandCenterCache = typeof commandCenterCache.$inferSelect;
export type InsertCommandCenterCache = typeof commandCenterCache.$inferInsert;

// ── Field Management Log ──────────────────────────────────────────────────────
/**
 * fieldMgmtLog — one row per automation step fired per cleaner job.
 * Prevents double-sends: before firing any step, check if a row already exists
 * for (cleanerJobId, step). Insert atomically before sending SMS.
 *
 * step values (match FieldManagement.tsx step IDs):
 *   "pre_job_reminder"   → Step 1: T-2hr SMS to cleaner
 *   "client_on_the_way"  → Step 2: On the Way SMS to client
 *   "arrived_checkin"    → Step 3: ARRIVED auto-response to cleaner
 *   "mid_job_nudge"      → Step 4: Mid-job check SMS to cleaner
 *   "completion_flow"    → Step 5: Completion checklist SMS to cleaner
 *   "exception_sms"      → Step 6a: No check-in SMS to cleaner
 *   "exception_call"     → Step 6b: Auto-call escalation after no SMS reply
 *   "noshow_alert"       → Step 7: No-show CS team alert
 */
export const fieldMgmtSteps = [
  "pre_job_reminder",
  "client_pre_job",
  "client_on_the_way",
  "client_running_late",
  "arrived_checkin",
  "mid_job_nudge",
  "completion_flow",
  "exception_sms",
  "exception_call",
  "noshow_alert",
] as const;

export type FieldMgmtStep = (typeof fieldMgmtSteps)[number];

export const fieldMgmtLog = mysqlTable("field_mgmt_log", {
  id: int("id").autoincrement().primaryKey(),
  /** Link to cleanerJobs.id */
  cleanerJobId: int("cleanerJobId").notNull(),
  /** Which automation step fired */
  step: mysqlEnum("step", fieldMgmtSteps as unknown as [string, ...string[]]).notNull(),
  /** Whether the SMS/call was sent successfully */
  success: int("success").default(0).notNull(),
  /** Error message if failed */
  errorDetail: text("errorDetail"),
  /** The SMS content that was sent (for audit) */
  smsSent: text("smsSent"),
  /** Recipient phone (cleaner or client) */
  recipientPhone: varchar("recipientPhone", { length: 30 }),
  firedAt: timestamp("firedAt").defaultNow().notNull(),
});

export type FieldMgmtLog = typeof fieldMgmtLog.$inferSelect;
export type InsertFieldMgmtLog = typeof fieldMgmtLog.$inferInsert;

// ── Job Status History — audit log of every cleaner status tap ────────────────
// Written on every updateJobStatus call so the Field Management timeline can
// show the trigger event ("Cleaner set On the Way — 7:53 AM") before the
// resulting SMS ("On the Way Notification — Sent 7:54 AM").

export const jobStatusHistory = mysqlTable("job_status_history", {
  id: int("id").autoincrement().primaryKey(),
  /** Link to cleanerJobs.id */
  cleanerJobId: int("cleanerJobId").notNull(),
  /** The new status that was set */
  status: varchar("status", { length: 64 }).notNull(),
  /** Who/what triggered the change: "cleaner_app" | "admin" | "engine" */
  source: varchar("source", { length: 32 }).default("cleaner_app").notNull(),
  /** When the status was set */
  changedAt: timestamp("changedAt").defaultNow().notNull(),
}, (table) => ({
  idxCleanerJobId: index("idx_jsh_cleaner_job_id").on(table.cleanerJobId),
}));

export type JobStatusHistory = typeof jobStatusHistory.$inferSelect;
export type InsertJobStatusHistory = typeof jobStatusHistory.$inferInsert;
