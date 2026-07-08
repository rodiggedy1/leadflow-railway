import { bigint, decimal, double, index, int, json, longtext, mediumtext, mysqlEnum, mysqlTable, text, timestamp, tinyint, uniqueIndex, varchar } from "drizzle-orm/mysql-core";

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
  profilePhotoUrl: text("profilePhotoUrl"),
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
   * REVIEW_REBOOKING_REQUESTED → Post-review rebooking pitch sent (one-time customers), waiting for reply.
   * REVIEW_REBOOKING_DONE      → Rebooking conversation complete.
   */
  "REVIEW_REBOOKING_REQUESTED",
  "REVIEW_REBOOKING_DONE",
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
  /**
   * VOICEMAIL → Agent left a voicemail; waiting for callback.
   */
  "VOICEMAIL",
  /**
   * YELP_CONTACTED → Agent has contacted this Yelp lead via Yelp Biz.
   */
  "YELP_CONTACTED",
  /**
   * INTERVIEW_LINK_SENT  → Application submitted, interview link SMS sent, waiting for candidate to complete.
   * INTERVIEW_NUDGE_1    → 2-hour follow-up nudge sent, still waiting.
   * INTERVIEW_NUDGE_2    → Next-morning final nudge sent.
   * INTERVIEW_LINK_DONE  → Candidate completed the interview (terminal stage).
   */
  "INTERVIEW_LINK_SENT",
  "INTERVIEW_NUDGE_1",
  "INTERVIEW_NUDGE_2",
  "INTERVIEW_LINK_DONE",
  /**
   * OPEN → CS inbound session — customer texted the CS line (202-888-5362).
   * Agent handles manually; no AI auto-reply.
   */
  "OPEN",
  /**
   * HIRING_OUTBOUND → manual agent SMS sent to a job applicant from the hiring pipeline.
   * aiMode is always 0 (manual). No AI auto-reply.
   */
  "HIRING_OUTBOUND",
  /**
   * Flow C widget stages — 5-step enriched quote flow:
   * FLOWC_ADDON       → Rooms confirmed, add-on question sent, waiting for add-on reply
   * FLOWC_DATE        → Add-ons collected, date question sent, waiting for preferred date(s)
   * FLOWC_NOTES       → Date collected, notes question sent, waiting for special notes or "all good"
   * FLOWC_QUOTE_SENT  → Quote link sent, conversation complete (lead may reply to book)
   */
  "FLOWC_ADDON",
  "FLOWC_DATE",
  "FLOWC_NOTES",
  "FLOWC_QUOTE_SENT",
  /**
   * SCHEDULE_CONFIRM_SENT → Daily 5 PM schedule SMS sent to cleaner team, waiting for "CONFIRM" reply.
   * SCHEDULE_CONFIRM_DONE → Cleaner replied to confirm (or flow timed out). Terminal stage.
   */
  "SCHEDULE_CONFIRM_SENT",
  "SCHEDULE_CONFIRM_DONE",
  /**
   * CLIENT_STATUS_INQUIRY → Client texted asking about job status.
   * System texted "checking with your team" and placed a VAPI call to the cleaner.
   * Waiting for the call to complete so we can reply with the ETA.
   * CLIENT_STATUS_INQUIRY_DONE → ETA reply sent to client. Terminal stage.
   */
  "CLIENT_STATUS_INQUIRY",
  "CLIENT_STATUS_INQUIRY_DONE",
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
  messageHistory: mediumtext("messageHistory").notNull(),
  // Link back to the original quote lead
  quoteLeadId: int("quoteLeadId"),
  /** Slug from the quote app (e.g. "rohan-gilkessssss-jb8c") — used to update the quote when address is collected */
  quoteSlug: varchar("quoteSlug", { length: 255 }),

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
  /** Lead source: "form" = full quote form, "widget" = floating chat widget on maidsinblack.com, "reactivation" = reactivation campaign, "bark" = Bark.com Zapier webhook, "thumbtack" = Thumbtack Zapier webhook */
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
  /**
   * Timestamp (ms) when a CS agent resolved/archived this CS inbox session. NULL = open.
   * Only set for cs-inbound and cs-inbound-cleaner sessions.
   */
  csResolvedAt: bigint("csResolvedAt", { mode: "number" }),
  /**
   * CS inbox queue label — manually assigned by agents.
   * One of: "Needs attention" | "Follow up" | "Hot leads" | "Active jobs" | "Post-job" | "Teams"
   * NULL = unassigned (defaults to "Needs attention" in the UI).
   */
  csQueue: varchar("csQueue", { length: 32 }),
  /**
   * Cached JSON payload from the last AI closing recommendation.
   * Stored so the drawer loads instantly on re-open without re-calling the LLM.
   * Invalidated when new messages arrive (messageHistory length changes).
   */
  aiClosingRecCache: text("aiClosingRecCache"),
  /** UTC timestamp when aiClosingRecCache was last generated */
  aiClosingRecCachedAt: timestamp("aiClosingRecCachedAt"),
  /** messageHistory length at time of cache — used to detect staleness */
  aiClosingRecMsgLen: int("aiClosingRecMsgLen"),
  /**
   * AI-assigned priority tag for the CS priority queue.
   * One of: "angry" | "cancel" | "booking" | "urgent" | null
   * Set by the AI when it detects a high-priority situation in the conversation.
   */
  csPriorityTag: varchar("csPriorityTag", { length: 32 }),
  /** Reason text shown in the priority queue card (AI-generated, 1 short sentence) */
  csPriorityReason: varchar("csPriorityReason", { length: 200 }),
  /** Unix ms timestamp when the AI tagged this session as priority */
  csPriorityTaggedAt: bigint("csPriorityTaggedAt", { mode: "number" }),
  /** Unix ms timestamp when an agent dismissed this from the priority queue */
  csPriorityDismissedAt: bigint("csPriorityDismissedAt", { mode: "number" }),
  /**
   * Cached JSON array of conversation memory bullet strings (AI-generated).
   * Invalidated when message count changes (csMemoryCachedMsgLen !== current count).
   */
  csMemoryCache: text("csMemoryCache"),
  /** Message count at time csMemoryCache was generated — used for staleness check */
  csMemoryCachedMsgLen: int("csMemoryCachedMsgLen"),
  /**
   * LLM-scored conversation status tier (one of the 21 status keys).
   * Computed async after each new message; null = not yet scored or stale.
   * Examples: "new_inquiry", "waiting_on_you", "hot_lead", "solved", "job_at_risk", etc.
   */
  csStatusTier: varchar("csStatusTier", { length: 32 }),
  /** Unix ms timestamp when csStatusTier was last computed */
  csStatusTieredAt: bigint("csStatusTieredAt", { mode: "number" }),
  /** Message count at time csStatusTier was computed — used for staleness check */
  csStatusMsgLen: int("csStatusMsgLen"),
  /**
   * AI-generated 4-5 word status phrase shown on pipeline cards.
   * Cached to avoid re-calling the LLM on every load.
   */
  aiSummary: varchar("aiSummary", { length: 100 }),
  /**
   * SHA-256 hash of (stage + lastActivityText) at the time aiSummary was generated.
   * Used to detect staleness — if the hash changes, the summary is regenerated.
   */
  aiSummaryHash: varchar("aiSummaryHash", { length: 64 }),
  /**
   * Flow C: preferred date(s) the lead mentioned (e.g. "Monday or Tuesday").
   * Stored as plain text from the lead's reply.
   */
  preferredDates: text("preferredDates"),
  /**
   * Flow C: special notes from the lead (pets, areas to focus on, time of day, etc.).
   * Stored as plain text from the lead's reply. "all good" is stored as-is.
   */
  specialNotes: text("specialNotes"),
  /**
   * Unix ms timestamp set when an agent manually marks this lead as "handled".
   * Excludes the session from the unresponded attention queue until the customer
   * sends a new message with a timestamp newer than this value.
   */
  respondedAt: bigint("respondedAt", { mode: "number" }),
  /**
   * Unix ms timestamp set when an admin/agent opens the lead drawer.
   * A lead is "unread" when the most recent inbound message (role:"user") has
   * a ts newer than this value (or this is null).
   */
  lastReadAt: bigint("lastReadAt", { mode: "number" }),
  /**
   * Unix ms timestamp of the most recent inbound customer message.
   * Updated every time a customer SMS is received, regardless of AI response.
   * Used for the CommandChat lead-replies notification: shows whenever
   * lastCustomerReplyAt > lastReadAt (or lastReadAt is null), so agents
   * always see a notification when a lead has replied — even if the AI
   * already responded.
   */
  lastCustomerReplyAt: bigint("lastCustomerReplyAt", { mode: "number" }),

  // ── Inbox summary fields (denormalized for fast list queries) ─────────────
  /**
   * Preview text of the last message (any role), truncated to 255 chars.
   * Eliminates the need to parse messageHistory for inbox card rendering.
   */
  lastMessageText: varchar("lastMessageText", { length: 255 }),
  /** Unix ms timestamp of the last message (any role). */
  lastMessageTs: bigint("lastMessageTs", { mode: "number" }),
  /** Unix ms timestamp of the last customer (role:"user") message. */
  lastCustomerMessageTs: bigint("lastCustomerMessageTs", { mode: "number" }),
  /** Role of the last message: "user" | "assistant" | "note" | "system" */
  lastMessageRole: varchar("lastMessageRole", { length: 16 }),
  /** Total number of messages in messageHistory. */
  messageCount: int("messageCount").default(0).notNull(),

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
  /**
   * JSON array of page IDs this agent is allowed to access.
   * null = no restrictions (legacy / admin agents see everything).
   * [] = no pages allowed.
   * Example: '["leads","pipeline","field-management"]'
   */
  pagePermissions: text("pagePermissions"), // JSON string | null — null = no restrictions
  profilePhotoUrl: varchar("profilePhotoUrl", { length: 1024 }), // S3 CDN URL for profile photo
  lastSeenAt: timestamp("lastSeenAt"), // Updated on every authenticated request — used for online status
  /** Current away status: null = available, or one of: away_sec | lunch | back15 | eod */
  awayStatus: varchar("awayStatus", { length: 32 }),
  /** Timestamp when awayStatus was last set — used for auto-dismiss logic */
  awaySetAt: timestamp("awaySetAt"),
  /** OpenPhone user ID — maps call.answered/call.completed webhooks to this agent */
  openPhoneUserId: varchar("openPhoneUserId", { length: 128 }),
  /** OpenPhone phone number ID for this agent's personal number (e.g. PNylSKu3Hz) — used to identify agent on shared-number calls */
  openPhoneNumberId: varchar("openPhoneNumberId", { length: 128 }),
  /** Unix ms when the agent answered a call. Cleared on call.completed. Auto-expires after 2h. */
  onCallSince: bigint("onCallSince", { mode: "number" }),
  /** OpenPhone call ID of the active call — used to match call.completed events */
  onCallCallId: varchar("onCallCallId", { length: 128 }),
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
  /**
   * When 1, the phone number from Launch27 was not a valid US number.
   * The job is still stored so it appears in field management and reports,
   * but it will be excluded from all outbound SMS flows until corrected.
   */
  phoneInvalid: int("phoneInvalid").default(0).notNull(),
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
  /** Portal language: 'en' | 'es' | 'pt'. Default 'en'. */
  language: varchar("language", { length: 5 }).default("en").notNull(),
  /**
   * Launch27 team ID — the numeric ID from L27's teams array.
   * When set, the sync uses this as the primary key for matching instead of name.
   * This prevents ghost profile creation when L27 team titles don't exactly match
   * the cleanerProfiles.name (the root cause of jobs missing from the cleaner portal).
   */
  launch27TeamId: int("launch27TeamId").unique(),
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
  /** JSON array of extra service keys from the booking (e.g. ["clean_inside_oven", "sweep_garage"]) */
  extras: text("extras"),
  /** Booking frequency from Launch27 (e.g. "Monthly (10%OFF)", "Weekly", "One-time") */
  frequency: varchar("frequency", { length: 100 }),
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
  /** Google review bonus: +50.00 if admin marks this job as the one that earned a Google review (null = not applied) */
  googleReviewBonus: varchar("googleReviewBonus", { length: 20 }),
  /** Cleaner-reported job status */
  jobStatus: mysqlEnum("jobStatus", [
    "on_the_way",
    "arrived",
    "running_late",
    "in_progress",
    "finishing_up",
    "wrapping_up",
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
  /** When the cleaner marked the job complete (set by markComplete) */
  completedAt: timestamp("completedAt"),
  /** Review flow analytics: comma-separated chip labels the customer selected (e.g. "On time,Super thorough") */
  reviewChipsSelected: text("reviewChipsSelected"),
  /** Review flow analytics: which AI draft the customer picked (1, 2, or 3) */
  reviewDraftPicked: int("reviewDraftPicked"),
  /** Review flow analytics: the actual text of the AI draft the customer picked */
  reviewDraftText: text("reviewDraftText"),
  /** Review flow analytics: whether the customer copied the review text */
  reviewCopied: int("reviewCopied").default(0).notNull(),
  /** 1 if the cleaner tapped "arrived" without first tapping "on the way" — no ETA was sent to the customer */
  noEtaArrival: int("noEtaArrival").default(0).notNull(),
  /** Freeform complaint text from a customer (via CS chat SMS or manually entered by ops). Null = no complaint on this job. */
  customerComplaint: text("customerComplaint"),
  /** Whether the −$20 complaint charge has been applied to this job's pay (1 = yes) */
  complaintChargeApplied: int("complaintChargeApplied").default(0).notNull(),
  /** Whether the cleaner team confirmed their schedule for this job via SMS (1 = confirmed, 0 = not yet) */
  scheduleConfirmed: int("scheduleConfirmed").default(0).notNull(),
  /** Team requested by the customer in L27 (preferred cleaner/team name) */
  requestedTeam: varchar("requestedTeam", { length: 255 }),
  /** S3 URL of the customer signature captured at sign-off */
  signatureUrl: varchar("signatureUrl", { length: 1000 }),
  /** Customer satisfaction response from sign-off (e.g. 'great', 'touchup', 'issue') */
  customerResponse: varchar("customerResponse", { length: 50 }),
  /** Customer response notes from sign-off */
  customerNotes: text("customerNotes"),
  /** Set to 1 if cleaner bypassed sign-off because customer was not home */
  customerNotHome: tinyint("customerNotHome").default(0).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (t) => [
  index("idx_cleaner_jobs_job_date").on(t.jobDate),
  uniqueIndex("uq_cleaner_jobs_booking_profile").on(t.bookingId, t.cleanerProfileId),
]);
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
  /** Photo type: 'before' | 'after' | 'general' */
  photoType: varchar("photoType", { length: 20 }).default("general").notNull(),
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
 *   "assignment_sms"     → Step 0: Immediate SMS on new/re-assignment (any future job)
 *   "pre_job_reminder"   → Step 1: T-2hr SMS to cleaner
 *   "client_on_the_way"  → Step 2: On the Way SMS to client
 *   "arrived_checkin"    → Step 3: ARRIVED auto-response to cleaner
 *   "mid_job_nudge"      → Step 4: Mid-job check SMS to cleaner
 *   "completion_flow"    → Step 5: Completion checklist SMS to cleaner
 *   "exception_sms"      → Step 6a: No check-in SMS to cleaner
 *   "exception_call"     → Step 6b: Auto-call escalation after no SMS reply
 *   "noshow_alert"       → Step 7a: No-show CS team SMS alert
 *   "noshow_call"        → Step 7b: Auto-call to CS team 10min after noshow SMS
 */
export const fieldMgmtSteps = [
  "assignment_sms",
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
  "noshow_call",
  // T-58min VAPI check-in call attempts (3 attempts, 2 min apart)
  "checkin_call_attempt_1",
  "checkin_call_attempt_2",
  "checkin_call_attempt_3",
  // T-30min VAPI check-in call attempts (3 attempts, 2 min apart — second chance)
  "checkin_call_t30_attempt_1",
  "checkin_call_t30_attempt_2",
  "checkin_call_t30_attempt_3",
  // Post-start escalation steps
  "post_start_call_1",
  "post_start_cs_alert",
  "post_start_call_2",
  "post_start_noshow_flag",
] as const;

export type FieldMgmtStep = (typeof fieldMgmtSteps)[number];

export const fieldMgmtLog = mysqlTable("field_mgmt_log", {
  id: int("id").autoincrement().primaryKey(),
  /** Link to cleanerJobs.id */
  cleanerJobId: int("cleanerJobId").notNull(),
  /** Which automation step fired — varchar to support dynamic step names like eta_update_{ts} and client_running_late_{ts} */
  step: varchar("step", { length: 100 }).notNull(),
  /** Whether the SMS/call was sent successfully */
  success: int("success").default(0).notNull(),
  /** Error message if failed */
  errorDetail: text("errorDetail"),
  /** The SMS content that was sent (for audit) */
  smsSent: text("smsSent"),
  /** Recipient phone (cleaner or client) */
  recipientPhone: varchar("recipientPhone", { length: 30 }),
  /** OpenPhone message ID returned on send — used to match delivery webhook events */
  openPhoneMessageId: varchar("openPhoneMessageId", { length: 128 }),
  /** Delivery status updated by webhook: sent | delivered | failed */
  deliveryStatus: varchar("deliveryStatus", { length: 16 }),
  firedAt: timestamp("firedAt").defaultNow().notNull(),
});
// NOTE: The unique index uniq_field_mgmt_job_step was intentionally DROPPED from the DB.
// field_mgmt_log is an append-only audit log — steps like checkin_call_t30_attempt_N
// and client_running_late_{ts} must be allowed to fire multiple times per job.
// Dedup is handled in code via tryClaimStep (SELECT before INSERT), not at the DB level.

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

// ── Job SMS Replies — inbound SMS messages from clients or cleaners ────────────
// When OpenPhone receives an inbound SMS from a phone number that matches either
// the client phone or cleaner phone on a cleaner job, we store it here so the
// ops team can see the full conversation thread in the job detail panel.
export const jobSmsReplies = mysqlTable("job_sms_replies", {
  id: int("id").autoincrement().primaryKey(),
  /** Link to cleanerJobs.id */
  cleanerJobId: int("cleanerJobId").notNull(),
  /** "client" | "cleaner" — which party sent this */
  senderType: varchar("senderType", { length: 16 }).notNull(),
  /** Sender's E.164 phone number */
  senderPhone: varchar("senderPhone", { length: 30 }).notNull(),
  /** The message text */
  body: text("body").notNull(),
  /** OpenPhone message ID for idempotency */
  openPhoneMessageId: varchar("openPhoneMessageId", { length: 128 }),
  /** Delivery status for outbound messages: sent | delivered | failed */
  deliveryStatus: varchar("deliveryStatus", { length: 16 }),
  /** When the message was received */
  receivedAt: timestamp("receivedAt").defaultNow().notNull(),
}, (table) => ({
  idxCleanerJobId: index("idx_jsr_cleaner_job_id").on(table.cleanerJobId),
  idxOpenPhoneMessageId: uniqueIndex("uniq_jsr_openphone_msg_id").on(table.openPhoneMessageId),
}));
export type JobSmsReply = typeof jobSmsReplies.$inferSelect;
export type InsertJobSmsReply = typeof jobSmsReplies.$inferInsert;

// ── Field Mgmt Calls — VAPI calls made as part of field management escalations ─
// When the engine fires an exception_call or noshow_call step, we store the
// resulting call record here (linked to the job) so ops can see outcome,
// duration, and transcript in the job detail panel.
export const fieldMgmtCalls = mysqlTable("field_mgmt_calls", {
  id: int("id").autoincrement().primaryKey(),
  /** When step='client_status_inquiry', links back to the client's conversationSessions row
   * so the end-of-call webhook knows who to reply to.
   * Column already added via direct SQL migration. */
  clientStatusInquirySessionId: int("clientStatusInquirySessionId"),
  /** Link to cleanerJobs.id */
  cleanerJobId: int("cleanerJobId").notNull(),
  /** Which step triggered this call: "exception_call" | "noshow_call" */
  step: varchar("step", { length: 32 }).notNull(),
  /** Vapi call ID */
  vapiCallId: varchar("vapiCallId", { length: 128 }).unique(),
  /** Phone number that was called */
  calledPhone: varchar("calledPhone", { length: 30 }).notNull(),
  /** Call outcome: "answered" | "voicemail" | "no_answer" | "failed" */
  outcome: varchar("outcome", { length: 32 }).default("no_answer").notNull(),
  /** Call duration in seconds */
  durationSeconds: int("durationSeconds").default(0).notNull(),
  /** Full call transcript */
  transcript: text("transcript"),
  /** AI summary of the call */
  summary: text("summary"),
  /** Why the call ended */
  endedReason: varchar("endedReason", { length: 100 }),
  /** Recording URL */
  recordingUrl: varchar("recordingUrl", { length: 512 }),
  /** Whether an SMS fallback was sent after a no-answer call */
  smsFollowupSent: tinyint("smsFollowupSent").default(0).notNull(),
  /** When the SMS fallback was sent */
  smsFollowupAt: timestamp("smsFollowupAt"),
  /** Body of the SMS fallback message */
  smsFollowupBody: text("smsFollowupBody"),
  /** Customer's reply to the SMS fallback */
  smsReply: text("smsReply"),
  /** Whether the customer confirmed via SMS reply */
  smsConfirmed: tinyint("smsConfirmed").default(0).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  idxCleanerJobId: index("idx_fmc_cleaner_job_id").on(table.cleanerJobId),
}));
export type FieldMgmtCall = typeof fieldMgmtCalls.$inferSelect;
export type InsertFieldMgmtCall = typeof fieldMgmtCalls.$inferInsert;

// ── Custom Pay Rules ──────────────────────────────────────────────────────────
// Admin-created bonus and deduction rules beyond the 7 fixed system rules.
export const customPayRules = mysqlTable("custom_pay_rules", {
  id: int("id").autoincrement().primaryKey(),
  label: varchar("label", { length: 128 }).notNull(),
  type: varchar("type", { length: 16 }).notNull().default("bonus"),
  amount: decimal("amount", { precision: 8, scale: 2 }).notNull(),
  description: varchar("description", { length: 256 }),
  isActive: tinyint("isActive").notNull().default(1),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type CustomPayRule = typeof customPayRules.$inferSelect;
export type InsertCustomPayRule = typeof customPayRules.$inferInsert;

// ── Custom Pay Rule Applications ──────────────────────────────────────────────
export const cleanerJobCustomRules = mysqlTable("cleaner_job_custom_rules", {
  id: int("id").autoincrement().primaryKey(),
  cleanerJobId: int("cleanerJobId").notNull(),
  customPayRuleId: int("customPayRuleId").notNull(),
  appliedAmount: decimal("appliedAmount", { precision: 8, scale: 2 }).notNull(),
  appliedLabel: varchar("appliedLabel", { length: 128 }).notNull(),
  appliedType: varchar("appliedType", { length: 16 }).notNull(),
  appliedAt: timestamp("appliedAt").defaultNow().notNull(),
}, (table) => ({
  idxCleanerJob: index("idx_cjcr_cleaner_job").on(table.cleanerJobId),
}));
export type CleanerJobCustomRule = typeof cleanerJobCustomRules.$inferSelect;

// ── Cleaner Magic Link Tokens ─────────────────────────────────────────────────
/**
 * cleanerMagicLinkTokens — one-time login tokens for cleaner SMS magic links.
 * Admin sends a text with a link; cleaner taps it to log in without a password.
 * Token is single-use and expires after 15 minutes.
 */
export const cleanerMagicLinkTokens = mysqlTable("cleaner_magic_link_tokens", {
  id: int("id").autoincrement().primaryKey(),
  /** The cleaner this token belongs to */
  cleanerProfileId: int("cleanerProfileId").notNull(),
  /** Cryptographically random token (hex string, 32 bytes = 64 chars) */
  token: varchar("token", { length: 128 }).notNull().unique(),
  /** When this token expires (15 minutes from creation) */
  expiresAt: timestamp("expiresAt").notNull(),
  /** Whether this token has already been used */
  used: tinyint("used").notNull().default(0),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  idxCleanerProfile: index("idx_cmlt_cleaner_profile").on(table.cleanerProfileId),
  idxToken: index("idx_cmlt_token").on(table.token),
}));
export type CleanerMagicLinkToken = typeof cleanerMagicLinkTokens.$inferSelect;
export type InsertCleanerMagicLinkToken = typeof cleanerMagicLinkTokens.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────────
// openphone_call_recordings — one row per inbound/outbound call recording
// received via the call.recording.completed OpenPhone webhook.
// Transcript is populated separately via the call.transcript.completed webhook.
// ─────────────────────────────────────────────────────────────────────────────
export const openphoneCallRecordings = mysqlTable("openphone_call_recordings", {
  id: int("id").autoincrement().primaryKey(),
  /** The conversation session this recording belongs to (matched by leadPhone) */
  sessionId: int("sessionId").notNull(),
  /** OpenPhone's call ID — UNIQUE to prevent duplicate inserts if webhook fires twice */
  openphoneCallId: varchar("openphoneCallId", { length: 255 }).notNull().unique(),
  /** Caller phone in E.164 format */
  callerPhone: varchar("callerPhone", { length: 20 }).notNull(),
  /** Call direction from the lead's perspective */
  direction: mysqlEnum("direction", ["incoming", "outgoing"]).notNull().default("incoming"),
  /** Duration of the recording in seconds */
  durationSeconds: int("durationSeconds"),
  /** Direct MP3 URL from OpenPhone — playable in <audio> */
  recordingUrl: text("recordingUrl").notNull(),
  /** Processing status from OpenPhone */
  status: varchar("status", { length: 50 }).notNull().default("completed"),
  /** When the call actually happened (used for chronological sorting in thread) */
  callStartedAt: timestamp("callStartedAt").notNull(),
  /**
   * Full call transcript as JSON array of dialogue turns.
   * Each turn: { identifier: string, content: string, start: number, end: number }
   * Populated by the call.transcript.completed webhook.
   */
  transcript: text("transcript"),
  /**
   * AI-generated overall score (0–100) based on home services sales rubric.
   * Null until scoreCall procedure is run.
   */
  callScore: int("callScore"),
  /**
   * Full AI scoring breakdown as JSON.
   * Shape: { categories: [{name, score, maxScore, feedback}], strengths: string[], improvements: string[], coachingTips: string[], summary: string }
   */
  scoreData: text("scoreData"),
  /**
   * AI-generated post-call debrief as JSON.
   * Shape: { wentWell: string, improve: string, nextLine: string, generatedAt: number }
   * Populated ~60s after call.transcript.completed webhook fires.
   */
  callDebrief: text("callDebrief"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  idxSession: index("idx_ocr_session").on(table.sessionId),
  idxCallId: index("idx_ocr_call_id").on(table.openphoneCallId),
}));
export type OpenphoneCallRecording = typeof openphoneCallRecordings.$inferSelect;
export type InsertOpenphoneCallRecording = typeof openphoneCallRecordings.$inferInsert;

// ── Ops Chat Messages — internal ops team messages tied to a job or a channel ──
// Used by the OpsChat internal communication tool. Each message belongs to
// either a specific job thread (cleanerJobId set) or a named channel (channel set).
// Author is identified by their user id (admin/agent) or a cleaner profile id.
export const opsChatMessages = mysqlTable("ops_chat_messages", {
  id: int("id").autoincrement().primaryKey(),
  /** Job thread — link to cleanerJobs.id (null for channel messages) */
  cleanerJobId: int("cleanerJobId"),
  /** Channel name for non-job messages: "urgent" | "dispatch" | "general" | "cleaners" */
  channel: varchar("channel", { length: 64 }),
  /** Author display name */
  authorName: varchar("authorName", { length: 128 }).notNull(),
  /** Author role: "office" | "cleaner" | "agent" | "system" */
  authorRole: varchar("authorRole", { length: 32 }).notNull().default("office"),
  /** The message body */
  body: text("body").notNull(),
  /** Optional media URL (photo, voice note) */
  mediaUrl: varchar("mediaUrl", { length: 512 }),
  /** Quick action tag if this message was sent via a quick-action button */
  quickAction: varchar("quickAction", { length: 64 }),
  /** JSON metadata for structured cards (e.g. lead claim state, sessionId) */
  metadata: text("metadata"),
  /** Quote-reply: the ID of the message being replied to */
  replyToId: int("replyToId"),
  /** Quote-reply: snapshot of the replied-to message body (truncated) */
  replyToBody: varchar("replyToBody", { length: 512 }),
  /** Quote-reply: display name of the replied-to message author */
  replyToAuthor: varchar("replyToAuthor", { length: 128 }),
  /**
   * DM thread key — present only for private 1-on-1 direct messages.
   * Format: "<senderSlug>::<recipientSlug>" sorted alphabetically so both
   * participants query the same key. e.g. "ianique::rohan_g"
   * When set, channel and cleanerJobId are both null.
   */
  dmThread: varchar("dmThread", { length: 256 }),
  /**
   * Slack-style thread parent: when set, this message is a reply in the thread
   * started by the message with this ID. null = root/parent message.
   * Only used for Command Chat channel messages (not job threads or DMs).
   */
  threadParentId: int("threadParentId"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  idxJob: index("idx_ocm_job").on(table.cleanerJobId),
  idxChannel: index("idx_ocm_channel").on(table.channel),
  idxCreatedAt: index("idx_ocm_created_at").on(table.createdAt),
  // Composite index for the listChannelMessages query pattern:
  // WHERE channel = ? ORDER BY createdAt DESC LIMIT N
  idxChannelCreatedAt: index("idx_ocm_channel_created_at").on(table.channel, table.createdAt),
}));
export type OpsChatMessage = typeof opsChatMessages.$inferSelect;
export type InsertOpsChatMessage = typeof opsChatMessages.$inferInsert;

// ── OpsChat Read Receipts ─────────────────────────────────────────────────────
/**
 * Tracks the last message ID each user has seen per channel or job thread.
 * Used for unread badge counts and "Seen by X" read receipts.
 */
export const opsChatReads = mysqlTable("ops_chat_reads", {
  id: int("id").autoincrement().primaryKey(),
  /** Caller identity key: "owner:{openId}" or "agent:{agentId}" */
  callerId: varchar("callerId", { length: 128 }).notNull(),
  /** Display name of the reader */
  callerName: varchar("callerName", { length: 128 }).notNull(),
  /** Channel name (null if job thread) */
  channel: varchar("channel", { length: 64 }),
  /** Job ID (null if channel) */
  cleanerJobId: int("cleanerJobId"),
  /** The last ops_chat_messages.id this user has seen */
  lastReadMessageId: int("lastReadMessageId").notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull().$onUpdate(() => new Date()),
}, (table) => ({
  idxCaller: index("idx_ocr_caller").on(table.callerId),
  idxChannel: index("idx_ocr_channel").on(table.channel),
  idxJob: index("idx_ocr_job").on(table.cleanerJobId),
}));
export type OpsChatRead = typeof opsChatReads.$inferSelect;

// ── OpsChat Reactions ─────────────────────────────────────────────────────────
/**
 * Stores emoji reactions on ops chat messages.
 * One row per (messageId, callerId, emoji) — toggle by inserting/deleting.
 */
export const opsChatReactions = mysqlTable("ops_chat_reactions", {
  id: int("id").autoincrement().primaryKey(),
  /** The message being reacted to */
  messageId: int("messageId").notNull(),
  /** Caller identity key: "owner:{openId}" or "agent:{agentId}" */
  callerId: varchar("callerId", { length: 128 }).notNull(),
  /** Display name of the reactor */
  callerName: varchar("callerName", { length: 128 }).notNull(),
  /** The emoji character: 👍 ❤️ ✅ 🔥 */
  emoji: varchar("emoji", { length: 8 }).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  idxMsg: index("idx_ocreact_msg").on(table.messageId),
  idxCaller: index("idx_ocreact_caller").on(table.callerId),
  uniqReaction: uniqueIndex("uniq_ocreact").on(table.messageId, table.callerId, table.emoji),
}));
export type OpsChatReaction = typeof opsChatReactions.$inferSelect;

// ── Issue Flags ───────────────────────────────────────────────────────────────
/**
 * Tracks issue flags raised on jobs (from cleaners or agents).
 * An open flag (resolvedAt IS NULL) drives the escalation countdown in OpsChat.
 * Agents resolve flags with a note; this feeds into cleaner performance scoring.
 */
export const issueFlags = mysqlTable("issue_flags", {
  id: int("id").primaryKey().autoincrement(),
  /** The job this issue is attached to */
  cleanerJobId: int("cleanerJobId").notNull(),
  /** Short description of the issue (from cleaner or agent) */
  issueNote: text("issueNote").notNull(),
  /** When the flag was raised (UTC ms) */
  flaggedAt: bigint("flaggedAt", { mode: "number" }).notNull(),
  /** openId of the user who flagged it (cleaner magic-link user or agent) */
  flaggedBy: varchar("flaggedBy", { length: 64 }).notNull(),
  /** Display name of who flagged it */
  flaggedByName: varchar("flaggedByName", { length: 255 }),
  /** When the flag was resolved (UTC ms); NULL = still open */
  resolvedAt: bigint("resolvedAt", { mode: "number" }),
  /** openId of the agent who resolved it */
  resolvedBy: varchar("resolvedBy", { length: 64 }),
  /** Display name of resolver */
  resolvedByName: varchar("resolvedByName", { length: 255 }),
  /** Agent's resolution note */
  resolutionNote: text("resolutionNote"),
  /** Whether at least one photo was attached when flagging */
  hasPhoto: int("hasPhoto").default(0).notNull(),
}, (table) => ({
  idxJob: index("idx_if_job").on(table.cleanerJobId),
  idxOpen: index("idx_if_open").on(table.resolvedAt),
}));

export type IssueFlag = typeof issueFlags.$inferSelect;
export type InsertIssueFlag = typeof issueFlags.$inferInsert;

// ── Channel Pins ──────────────────────────────────────────────────────────────
/**
 * One active sticky note per channel. Only one pin can be active at a time
 * (dismissedAt IS NULL = active). Dismissed pins are kept for history.
 */
export const channelPins = mysqlTable("channel_pins", {
  id: int("id").autoincrement().primaryKey(),
  /** Channel name (e.g. "command") */
  channel: varchar("channel", { length: 64 }).notNull(),
  /** The note body */
  body: text("body").notNull(),
  /** Who pinned it */
  authorName: varchar("authorName", { length: 128 }).notNull(),
  /** When it was pinned */
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  /** When it was dismissed (NULL = still active) */
  dismissedAt: timestamp("dismissedAt"),
}, (table) => ({
  idxChannel: index("idx_cp_channel").on(table.channel),
}));
export type ChannelPin = typeof channelPins.$inferSelect;
export type InsertChannelPin = typeof channelPins.$inferInsert;

// ── Ops Reminders ─────────────────────────────────────────────────────────────
/**
 * Scheduled reminders set from Command Chat. The per-minute cron checks for
 * rows where triggerAt <= now AND firedAt IS NULL, posts a reminder card to
 * the channel, then marks firedAt.
 */
export const opsReminders = mysqlTable("ops_reminders", {
  id: int("id").autoincrement().primaryKey(),
  /** Channel to post the reminder into */
  channel: varchar("channel", { length: 64 }).notNull(),
  /** Reminder message body */
  body: text("body").notNull(),
  /** Who set the reminder */
  authorName: varchar("authorName", { length: 128 }).notNull(),
  /** When to fire (UTC epoch ms) */
  triggerAt: bigint("triggerAt", { mode: "number" }).notNull(),
  /** Who set the reminder (agent email or owner openId) */
  callerId: varchar("callerId", { length: 128 }),
  /** When it was actually posted (NULL = not yet fired) */
  firedAt: bigint("firedAt", { mode: "number" }),
  /** When the user dismissed the popup (NULL = not dismissed) */
  dismissedAt: bigint("dismissedAt", { mode: "number" }),
  /** When snoozed until (NULL = not snoozed) */
  snoozedUntil: bigint("snoozedUntil", { mode: "number" }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  idxTrigger: index("idx_or_trigger").on(table.triggerAt),
  idxFired: index("idx_or_fired").on(table.firedAt),
}));
export type OpsReminder = typeof opsReminders.$inferSelect;
export type InsertOpsReminder = typeof opsReminders.$inferInsert;

// ── Cleaner Rating SMS Log ────────────────────────────────────────────────────
/**
 * Tracks which cleaner job triggered each rating SMS sent to a cleaner.
 * Used to route cleaner replies back to the correct job thread and command chat.
 * One row per SMS sent; most recent row for a given cleanerPhone is the active one.
 */
export const cleanerRatingSmsLog = mysqlTable("cleaner_rating_sms_log", {
  id: int("id").autoincrement().primaryKey(),
  /** Cleaner phone in E.164 format */
  cleanerPhone: varchar("cleanerPhone", { length: 20 }).notNull(),
  /** The cleanerJobs.id that triggered this SMS */
  cleanerJobId: int("cleanerJobId").notNull(),
  /** Cleaner display name */
  cleanerName: varchar("cleanerName", { length: 255 }),
  /** Star rating that triggered the SMS (1-5) */
  rating: int("rating").notNull(),
  /** When the SMS was sent */
  sentAt: timestamp("sentAt").defaultNow().notNull(),
}, (table) => ({
  idxPhone: index("idx_crsl_phone").on(table.cleanerPhone),
  idxJob: index("idx_crsl_job").on(table.cleanerJobId),
}));
export type CleanerRatingSmsLog = typeof cleanerRatingSmsLog.$inferSelect;
export type InsertCleanerRatingSmsLog = typeof cleanerRatingSmsLog.$inferInsert;

// ── Web Push Subscriptions ────────────────────────────────────────────────────
/**
 * Stores browser push subscriptions for ops agents.
 * One row per browser/device per agent. Used to send Web Push notifications
 * when new messages arrive, even when the tab is closed.
 */
export const pushSubscriptions = mysqlTable("push_subscriptions", {
  id: int("id").autoincrement().primaryKey(),
  /** Agent identifier (callerName slug) */
  agentKey: varchar("agentKey", { length: 128 }).notNull(),
  /** The push endpoint URL (unique per browser/device) */
  endpoint: varchar("endpoint", { length: 2048 }).notNull(),
  /** JSON: { p256dh: string, auth: string } */
  keys: text("keys").notNull(),
  /** When this subscription was registered */
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  /** When this subscription was last used successfully */
  lastUsedAt: timestamp("lastUsedAt"),
}, (table) => ({
  idxAgent: index("idx_ps_agent").on(table.agentKey),
  idxEndpoint: index("idx_ps_endpoint").on(table.endpoint),
}));
export type PushSubscription = typeof pushSubscriptions.$inferSelect;
export type InsertPushSubscription = typeof pushSubscriptions.$inferInsert;

// ── Hiring Pipeline — Candidates ──────────────────────────────────────────────
/**
 * Stores job applications submitted via the public /apply form.
 * Each row represents one applicant moving through the 7-stage hiring pipeline.
 */
export const candidates = mysqlTable("candidates", {
  id: int("id").autoincrement().primaryKey(),
  // Basic info
  firstName: varchar("firstName", { length: 128 }).notNull(),
  lastName: varchar("lastName", { length: 128 }).notNull(),
  email: varchar("email", { length: 320 }),
  phone: varchar("phone", { length: 30 }).notNull(),
  // Address
  streetAddress: varchar("streetAddress", { length: 255 }),
  apt: varchar("apt", { length: 64 }),
  city: varchar("city", { length: 128 }),
  state: varchar("state", { length: 8 }),
  zip: varchar("zip", { length: 16 }),
  // Requirements
  hasCleaning: tinyint("hasCleaning"),        // 1=yes, 0=no, null=unanswered
  hasBankAccount: tinyint("hasBankAccount"),
  isAuthorized: tinyint("isAuthorized"),
  consentBackground: tinyint("consentBackground"),
  experience: text("experience"),
  // Specialties (JSON array of strings)
  specialties: text("specialties"),
  // Pipeline stage
  stage: varchar("stage", { length: 64 }).notNull().default("Application Submitted"),
  bioPhotoUrl: text("bioPhotoUrl"),
  videoUrl: text("videoUrl"),
  interviewVideoUrl: text("interviewVideoUrl"),
  // AI evaluation
  aiScore: int("aiScore"),
  aiSummary: text("aiSummary"),
  // AI interview
  interviewCallId: varchar("interviewCallId", { length: 128 }),
  interviewTranscript: longtext("interviewTranscript"),
  interviewScore: int("interviewScore"),
  interviewSummary: text("interviewSummary"),
  // Status page magic link token
  statusToken: varchar("statusToken", { length: 64 }),
  // Manually scheduled interview call time
  scheduledCallAt: timestamp("scheduledCallAt"),
  // Archived (hidden from pipeline but not deleted)
  archived: tinyint("archived").notNull().default(0),
  // Metadata
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  idxPhone: index("idx_cand_phone").on(table.phone),
  idxStage: index("idx_cand_stage").on(table.stage),
  idxCreated: index("idx_cand_created").on(table.createdAt),
}));

export type Candidate = typeof candidates.$inferSelect;
export type InsertCandidate = typeof candidates.$inferInsert;

// Interview video chunks — persisted so finalize survives server restarts
export const interviewChunks = mysqlTable("interview_chunks", {
  id: int("id").autoincrement().primaryKey(),
  sessionId: varchar("sessionId", { length: 128 }).notNull(),
  chunkIndex: int("chunkIndex").notNull(),
  s3Key: varchar("s3Key", { length: 512 }).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  idxSession: index("idx_ichunk_session").on(table.sessionId),
}));
export type InterviewChunk = typeof interviewChunks.$inferSelect;

// Single-row config table for runtime feature flags
// pausedServices: JSON array of serviceType strings currently paused
// e.g. ["Carpet Cleaning", "Window Cleaning"]
// To unpause: remove the entry from the array in the DB panel — no deploy needed
export const systemConfig = mysqlTable("system_config", {
  id: int("id").autoincrement().primaryKey(),
  pausedServices: json("pausedServices").$type<string[]>().notNull().default([]),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type SystemConfig = typeof systemConfig.$inferSelect;

/**
 * followUpPriorities / followUpTypes — enums for the follow-up table
 */
export const followUpPriorities = ["High", "Normal", "Low"] as const;
export type FollowUpPriority = (typeof followUpPriorities)[number];

export const followUpTypes = [
  "Lead callback",
  "Customer issue",
  "Reschedule",
  "Voicemail",
  "Team Issue",
] as const;
export type FollowUpType = (typeof followUpTypes)[number];

/**
 * followUps — one row per ops follow-up item created in CommandChat.
 *
 * dueAt       → Unix ms timestamp for when the follow-up is due (used by cron reminders)
 * completedAt → Set when agent marks it done; NULL = active
 * reminderSentAt → Set when the due-time reminder notification has been sent (prevents double-send)
 */
export const followUps = mysqlTable("follow_ups", {
  id: int("id").autoincrement().primaryKey(),
  /** Display name — customer name or job label */
  name: varchar("name", { length: 255 }).notNull(),
  /** What the agent needs to do next */
  nextStep: varchar("nextStep", { length: 255 }).notNull(),
  /** Unix ms timestamp for when this follow-up is due */
  dueAt: bigint("dueAt", { mode: "number" }).notNull(),
  /** Owner name (agent name) */
  owner: varchar("owner", { length: 100 }).notNull(),
  /** Follow-up type */
  type: mysqlEnum("type", followUpTypes as unknown as [string, ...string[]]).notNull(),
  /** Priority level */
  priority: mysqlEnum("priority", followUpPriorities as unknown as [string, ...string[]]).default("Normal").notNull(),
  /** Internal ops note — not shown to customer */
  internalNote: text("internalNote"),
  /** What the agent will say or do with the customer */
  customerFacingMove: text("customerFacingMove"),
  /** JSON array of history entries: [{text: string, time: string, ts: number}] */
  history: text("history").default("[]").notNull(),
  /** Unix ms timestamp when a due-time reminder notification was sent (null = not yet sent) */
  reminderSentAt: bigint("reminderSentAt", { mode: "number" }),
  /** Unix ms timestamp when agent marked this complete (null = still active) */
  completedAt: bigint("completedAt", { mode: "number" }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  idxDueAt: index("idx_fu_due_at").on(table.dueAt),
  idxCompletedAt: index("idx_fu_completed_at").on(table.completedAt),
}));

export type FollowUp = typeof followUps.$inferSelect;
export type InsertFollowUp = typeof followUps.$inferInsert;

// ── Issue Ownership ───────────────────────────────────────────────────────────
/**
 * Persists claim/resolve state for Command Chat issues.
 * issueKey is a stable string: e.g. "stale_eta:123", "noshow:456", "manual:789", "issue:321"
 */
export const issueOwnership = mysqlTable("issue_ownership", {
  id: int("id").primaryKey().autoincrement(),
  /** Stable key identifying the issue (type:jobId or type:messageId) */
  issueKey: varchar("issueKey", { length: 128 }).notNull().unique(),
  /** Display name of the agent who claimed this issue */
  claimedBy: varchar("claimedBy", { length: 128 }),
  /** UTC ms when claimed */
  claimedAt: bigint("claimedAt", { mode: "number" }),
  /** UTC ms when resolved (null = still open) */
  resolvedAt: bigint("resolvedAt", { mode: "number" }),
  /** Display name of the agent who resolved it */
  resolvedBy: varchar("resolvedBy", { length: 128 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  idxKey: index("idx_io_key").on(table.issueKey),
  idxResolved: index("idx_io_resolved").on(table.resolvedAt),
}));
export type IssueOwnership = typeof issueOwnership.$inferSelect;
export type InsertIssueOwnership = typeof issueOwnership.$inferInsert;

export const issueComments = mysqlTable("issue_comments", {
  id: int("id").autoincrement().primaryKey(),
  issueKey: varchar("issue_key", { length: 255 }).notNull(),
  authorName: varchar("author_name", { length: 255 }).notNull(),
  body: text("body").notNull(),
  type: varchar("type", { length: 32 }).notNull().default("text"), // "text" | "system"
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
});

/**
 * job_alerts — one row per (cleanerJobId, alertType).
 * Used as an atomic state store for cron-raised alerts (stale_eta, noshow_alert, etc.)
 * to prevent duplicate ops_chat_messages from SELECT-then-INSERT race conditions.
 * The UNIQUE constraint on (cleanerJobId, alertType) makes INSERT ... ON DUPLICATE KEY
 * UPDATE a no-op, guaranteeing exactly-once message posting regardless of concurrency.
 */
export const jobAlerts = mysqlTable("job_alerts", {
  id: int("id").autoincrement().primaryKey(),
  cleanerJobId: int("cleanerJobId").notNull(),
  alertType: varchar("alertType", { length: 50 }).notNull(), // 'stale_eta' | 'noshow_alert'
  /** FK to ops_chat_messages — set after the chat message is posted */
  postedMessageId: int("postedMessageId"),
  /** Set when the alert is cleared (cleaner arrived, issue resolved, etc.) */
  resolvedAt: timestamp("resolvedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  uniqJobAlert: uniqueIndex("uniq_job_alert").on(table.cleanerJobId, table.alertType),
  idxJobId: index("idx_ja_job").on(table.cleanerJobId),
}));
export type JobAlert = typeof jobAlerts.$inferSelect;
export type InsertJobAlert = typeof jobAlerts.$inferInsert;

/**
 * metrics_ai_alerts — pre-generated AI growth alerts for the Metrics page.
 * A cron job regenerates these every hour so page load reads a DB row instead
 * of blocking on an LLM call.
 */
export const metricsAiAlerts = mysqlTable("metrics_ai_alerts", {
  id: int("id").autoincrement().primaryKey(),
  range: varchar("range", { length: 10 }).notNull().default("12m"),
  alertsJson: text("alertsJson").notNull(),
  generatedAt: timestamp("generatedAt").defaultNow().notNull(),
});
export type MetricsAiAlert = typeof metricsAiAlerts.$inferSelect;

/**
 * nurture_enrollments — one row per lead enrolled in the 30-day SMS nurture sequence.
 *
 * The sequence starts at message 3 (Phase 1 · +50 min) because messages 1 and 2
 * are already handled by the existing speed-to-lead flow.
 *
 * nextStep: 3–17 (message number to send next). When nextStep > 17, the sequence is done.
 *
 * status:
 *   active   → sequence is running, cron will fire due messages
 *   paused   → human takeover; cron skips this lead until re-enrolled
 *   done     → sequence completed (day 30 reached or lead booked/opted-out)
 */
export const nurtureEnrollments = mysqlTable("nurture_enrollments", {
  id: int("id").autoincrement().primaryKey(),
  /** FK to conversation_sessions.id */
  sessionId: int("sessionId").notNull().unique(),
  /** E.164 phone — denormalized for fast cron queries without joins */
  leadPhone: varchar("leadPhone", { length: 30 }).notNull(),
  /** Lead first name (extracted from leadName at enrollment time) */
  leadFirstName: varchar("leadFirstName", { length: 100 }),
  /** Service type (from conversation_sessions.serviceType) — used in message templates */
  serviceType: varchar("serviceType", { length: 100 }),
  /** UTC timestamp when this lead was enrolled */
  enrolledAt: timestamp("enrolledAt").defaultNow().notNull(),
  /**
   * UTC timestamp of the original lead submission (conversation_sessions.createdAt).
   * All day-based offsets (Day 2, Day 3, Day 10…) are calculated from this anchor.
   */
  leadCreatedAt: timestamp("leadCreatedAt").notNull(),
  /** Next message step number to send (3–17). >17 = sequence done. */
  nextStep: int("nextStep").default(3).notNull(),
  /** UTC timestamp when nextStep is scheduled to fire */
  nextSendAt: timestamp("nextSendAt").notNull(),
  /** status: active | paused | done */
  status: mysqlEnum("status", ["active", "paused", "done"]).default("active").notNull(),
  /** Reason the sequence ended (booked | opted_out | day30 | manual) */
  endReason: varchar("endReason", { length: 32 }),
  /** UTC timestamp when status was set to done */
  endedAt: timestamp("endedAt"),
  /**
   * Soft-delete timestamp. When set, the enrollment is hidden from the UI and the cron
   * will never re-enroll this session — the row acts as a permanent block record.
   */
  deletedAt: timestamp("deletedAt"),
  /** Revenue captured at booking time (session.bookedAmount or parsed quotedPrice). NULL if not booked via sequence. */
  bookedRevenue: int("bookedRevenue"),
  /** Last step that was successfully sent */
  lastStepSent: int("lastStepSent"),
  /** UTC timestamp of last successful send */
  lastSentAt: timestamp("lastSentAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type NurtureEnrollment = typeof nurtureEnrollments.$inferSelect;
export type InsertNurtureEnrollment = typeof nurtureEnrollments.$inferInsert;

/**
 * nurture_step_scripts — custom overrides for nurture step message bodies.
 * If a row exists for a given step number, the cron uses that body instead of
 * the default in nurtureSequence.ts.
 */
export const nurtureStepScripts = mysqlTable("nurture_step_scripts", {
  step: int("step").primaryKey(), // step number (3–17)
  body: text("body").notNull(),   // custom message body
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type NurtureStepScript = typeof nurtureStepScripts.$inferSelect;
export type InsertNurtureStepScript = typeof nurtureStepScripts.$inferInsert;

/**
 * stepLocks — atomic mutex for field management automation steps.
 *
 * field_mgmt_log is intentionally append-only (no unique constraint) because
 * dynamic steps like client_running_late_{ts} and eta_update_{ts} must insert
 * multiple rows per job. This means INSERT IGNORE on field_mgmt_log cannot
 * serve as a race guard — there is no unique constraint to trigger the IGNORE.
 *
 * stepLocks is a separate, minimal table whose ONLY purpose is deduplication.
 * The UNIQUE index on (cleanerJobId, step) makes INSERT IGNORE truly atomic:
 * exactly one concurrent caller wins the race; all others get affectedRows=0.
 *
 * Workflow (inside tryClaimStep):
 *   1. INSERT IGNORE into step_locks → affectedRows=1 means "I own this step"
 *   2. Winner fires SMS/call
 *   3. Winner writes full audit row to field_mgmt_log (append-only, no constraint)
 *
 * Rows are never deleted — they serve as a permanent "this step fired" record.
 */
export const stepLocks = mysqlTable("step_locks", {
  id: int("id").autoincrement().primaryKey(),
  cleanerJobId: int("cleanerJobId").notNull(),
  /** Same step name used in field_mgmt_log. Max 100 chars matches field_mgmt_log.step. */
  step: varchar("step", { length: 100 }).notNull(),
  /** UTC timestamp when the lock was claimed. */
  claimedAt: timestamp("claimedAt").defaultNow().notNull(),
}, (t) => ({
  uniqJobStep: uniqueIndex("uniq_step_locks_job_step").on(t.cleanerJobId, t.step),
}));
export type StepLock = typeof stepLocks.$inferSelect;

// ─────────────────────────────────────────────────────────────────────────────
// SCHEDULING SYSTEM
// ─────────────────────────────────────────────────────────────────────────────

/**
 * schedulingTeams — one row per cleaning team (used for route optimization).
 * Teams are derived from Launch27 but enriched with a home base address and
 * geocoordinates so the VRP solver can compute drive times from home to first job.
 */
export const schedulingTeams = mysqlTable("scheduling_teams", {
  id: int("id").autoincrement().primaryKey(),
  /** Team name (matches teamName in cleanerJobs, e.g. "Team Solange") */
  name: varchar("name", { length: 255 }).notNull(),
  /** Launch27 team ID (optional, for syncing) */
  launch27TeamId: int("launch27TeamId"),
  /** Home base / starting address for route optimization */
  homeAddress: varchar("homeAddress", { length: 500 }),
  /** Geocoded latitude of home base */
  homeLat: double("homeLat"),
  /** Geocoded longitude of home base */
  homeLng: double("homeLng"),
  /** Max billable hours per day (default 8) */
  maxHoursPerDay: double("maxHoursPerDay").default(8),
  /** Comma-separated skill tags (e.g. "deep_clean,move_out") */
  skills: varchar("skills", { length: 500 }),
  /** Whether this team is currently active */
  isActive: int("isActive").default(1).notNull(),
  /** Color hex for map display (e.g. "#FF6B35") */
  color: varchar("color", { length: 10 }).default("#6366f1"),
  /** Min jobs per day — optimizer tries to guarantee at least this many jobs (null = no floor) */
  minJobs: int("minJobs"),
  /** Max jobs per day — optimizer hard cap (null = no limit) */
  maxJobs: int("maxJobs"),
  /** Earliest start time HH:MM — optimizer skips jobs before this time (null = no restriction) */
  earliestStartTime: varchar("earliestStartTime", { length: 5 }),
  /** Short display tag shown in the scheduling header (e.g. "VIP", "Flex", "AM") */
  tag: varchar("tag", { length: 20 }),
  /** Comma-separated DC/MD/VA region tags for first-job preference (e.g. "DC,MD") */
  regionTags: varchar("regionTags", { length: 50 }),
  /** Archived teams are hidden from the schedule view but retained for history */
  isArchived: int("isArchived").default(0).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type SchedulingTeam = typeof schedulingTeams.$inferSelect;
export type InsertSchedulingTeam = typeof schedulingTeams.$inferInsert;

/**
 * scheduleAssignments — one row per job-to-team assignment for a given date.
 * Stores the optimized (or manually overridden) assignment, route order,
 * and estimated arrival time for each job.
 *
 * When the optimizer runs for a date, all existing rows for that date are
 * replaced with the new solution. Manual overrides set isManual=1 and are
 * preserved across re-optimizations.
 */
export const scheduleAssignments = mysqlTable("schedule_assignments", {
  id: int("id").autoincrement().primaryKey(),
  /** Job date (YYYY-MM-DD) */
  jobDate: varchar("jobDate", { length: 20 }).notNull(),
  /** Link to cleanerJobs.id */
  cleanerJobId: int("cleanerJobId").notNull(),
  /** Link to schedulingTeams.id */
  teamId: int("teamId").notNull(),
  /** Team name (denormalized for display) */
  teamName: varchar("teamName", { length: 255 }),
  /** Position in this team's route for the day (0-indexed) */
  routeOrder: int("routeOrder").default(0).notNull(),
  /** Estimated arrival time at this job (Unix ms UTC) */
  estimatedArrivalMs: bigint("estimatedArrivalMs", { mode: "number" }),
  /** Estimated departure time from this job (Unix ms UTC) */
  estimatedDepartureMs: bigint("estimatedDepartureMs", { mode: "number" }),
  /** Estimated drive time from previous job/home (seconds) */
  driveTimeSecs: int("driveTimeSecs"),
  /** Whether this assignment was manually set by an admin (overrides optimizer) */
  isManual: int("isManual").default(0).notNull(),
  /** Total route distance for this team on this day (meters) */
  totalDistanceMeters: int("totalDistanceMeters"),
  /** JSON blob storing the rationale for this assignment (factors weighed by the optimizer) */
  rationale: text("rationale"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (t) => ({
  uniqJobDate: uniqueIndex("uniq_schedule_job_date").on(t.cleanerJobId, t.jobDate),
}));
export type ScheduleAssignment = typeof scheduleAssignments.$inferSelect;
export type InsertScheduleAssignment = typeof scheduleAssignments.$inferInsert;

/**
 * jobGeoCache — cached geocoding results for job addresses.
 * Avoids re-geocoding the same address on every optimizer run.
 */
export const jobGeoCache = mysqlTable("job_geo_cache", {
  id: int("id").autoincrement().primaryKey(),
  /** Normalized address string (trimmed, lowercased) */
  addressKey: varchar("addressKey", { length: 500 }).notNull().unique(),
  /** Original address as provided */
  originalAddress: varchar("originalAddress", { length: 500 }).notNull(),
  /** Geocoded latitude */
  lat: double("lat").notNull(),
  /** Geocoded longitude */
  lng: double("lng").notNull(),
  /** Full formatted address returned by geocoder */
  formattedAddress: varchar("formattedAddress", { length: 500 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type JobGeoCache = typeof jobGeoCache.$inferSelect;
export type InsertJobGeoCache = typeof jobGeoCache.$inferInsert;

/**
 * messageIntegrityChecks — stores the result of nightly OpenPhone message count comparisons.
 * Each row represents the last check for a given session.
 * A delta > 0 means OpenPhone has more messages than the LeadFlow DB — potential missing messages.
 */
export const messageIntegrityChecks = mysqlTable("message_integrity_checks", {
  id: int("id").autoincrement().primaryKey(),
  /** FK to conversation_sessions.id */
  sessionId: int("sessionId").notNull(),
  /** Lead name at time of check */
  leadName: varchar("leadName", { length: 255 }),
  /** Lead phone at time of check */
  leadPhone: varchar("leadPhone", { length: 50 }),
  /** Number of messages in LeadFlow DB (messageHistory JSON array length) */
  dbCount: int("dbCount").notNull().default(0),
  /** Number of messages in OpenPhone for this phone number */
  openphoneCount: int("openphoneCount").notNull().default(0),
  /** openphoneCount - dbCount. Positive = missing messages in DB */
  delta: int("delta").notNull().default(0),
  /** Whether this session was reconciled after the gap was detected */
  reconciled: tinyint("reconciled").notNull().default(0),
  /** When the check was last run */
  checkedAt: bigint("checkedAt", { mode: "number" }).notNull(),
  /** When the gap was first detected (null if no gap) */
  firstDetectedAt: bigint("firstDetectedAt", { mode: "number" }),
});
export type MessageIntegrityCheck = typeof messageIntegrityChecks.$inferSelect;
export type InsertMessageIntegrityCheck = typeof messageIntegrityChecks.$inferInsert;

/**
 * scheduleJobLocks — persists locked positions in the schedule optimization.
 * When a job is locked, its position in the optimized route is fixed and
 * subsequent optimization runs route around it.
 * Locks persist until explicitly unlocked by the user.
 */
export const scheduleJobLocks = mysqlTable("schedule_job_locks", {
  id: int("id").autoincrement().primaryKey(),
  /** Launch27 job ID */
  jobId: int("jobId").notNull(),
  /** Date string YYYY-MM-DD — the day this lock applies to */
  date: varchar("date", { length: 10 }).notNull(),
  /** Cleaner ID this lock belongs to (so locks are per-cleaner per-day) */
  cleanerId: int("cleanerId").notNull(),
  /** The locked position index (0-based) in the optimized sequence */
  lockedPosition: int("lockedPosition").notNull(),
  /** When the lock was created */
  lockedAt: bigint("lockedAt", { mode: "number" }).notNull(),
});
export type ScheduleJobLock = typeof scheduleJobLocks.$inferSelect;
export type InsertScheduleJobLock = typeof scheduleJobLocks.$inferInsert;

/**
 * teamDayUnavailability — marks a team as unavailable for a specific date.
 * When a row exists for (teamId, date), the optimizer skips that team entirely.
 */
export const teamDayUnavailability = mysqlTable("team_day_unavailability", {
  id: int("id").autoincrement().primaryKey(),
  /** Link to schedulingTeams.id */
  teamId: int("teamId").notNull(),
  /** Date string YYYY-MM-DD */
  date: varchar("date", { length: 20 }).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (t) => ({
  uniqTeamDate: uniqueIndex("uniq_team_day").on(t.teamId, t.date),
}));
export type TeamDayUnavailability = typeof teamDayUnavailability.$inferSelect;

/**
 * teamDayLock — locks a team's entire assignment for a specific date.
 * When a row exists for (teamId, date), the optimizer preserves all existing
 * job assignments for that team exactly as-is (no reassignment in or out).
 */
export const teamDayLock = mysqlTable("team_day_lock", {
  id: int("id").autoincrement().primaryKey(),
  /** Link to schedulingTeams.id */
  teamId: int("teamId").notNull(),
  /** Date string YYYY-MM-DD */
  date: varchar("date", { length: 20 }).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (t) => ({
  uniqTeamDateLock: uniqueIndex("uniq_team_day_lock").on(t.teamId, t.date),
}));
export type TeamDayLock = typeof teamDayLock.$inferSelect;

/**
 * teamDayConfig — per-team daily overrides that persist until changed.
 * Stores max jobs cap and earliest start time for a team on a specific date.
 * One row per (teamId, date). Upserted when dispatcher changes settings.
 */
export const teamDayConfig = mysqlTable("team_day_config", {
  id: int("id").autoincrement().primaryKey(),
  /** Link to schedulingTeams.id */
  teamId: int("teamId").notNull(),
  /** Date string YYYY-MM-DD */
  date: varchar("date", { length: 20 }).notNull(),
  /** Max number of jobs this team can take on this day (null = no cap) */
  maxJobs: int("maxJobs"),
  /** Earliest start time as HH:MM (24h), e.g. "14:30" (null = no restriction) */
  earliestStartTime: varchar("earliestStartTime", { length: 5 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (t) => ({
  uniqTeamDateConfig: uniqueIndex("uniq_team_day_config").on(t.teamId, t.date),
}));
export type TeamDayConfig = typeof teamDayConfig.$inferSelect;
export type InsertTeamDayConfig = typeof teamDayConfig.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────────
// AI CALL COMMAND CENTER
// ─────────────────────────────────────────────────────────────────────────────

/**
 * callTemplates — library of AI voice call scripts for operational issues.
 * Each template has a script with {{variable}} placeholders that are resolved
 * at fire-time from schedule data (overridable by dispatcher before firing).
 *
 * triggerType: what kind of issue this template is used for
 * targetType: who the call is placed to (team = cleaner, client, or both)
 */
export const callTemplateTriggerTypes = [
  "arrival_confirmation",
  "late_team",
  "no_access",
  "parking",
  "delay_update",
  "checkin_reminder",
  "lockout_warning",
  "lockout_final",
  "utility_issue",
  "completion_walkthrough",
  "manual",
] as const;
export type CallTemplateTriggerType = (typeof callTemplateTriggerTypes)[number];

export const callTemplateTargetTypes = ["team", "client", "both"] as const;
export type CallTemplateTargetType = (typeof callTemplateTargetTypes)[number];

export const callTemplates = mysqlTable("call_templates", {
  id: int("id").autoincrement().primaryKey(),
  /** Human-readable name shown in the UI */
  name: varchar("name", { length: 255 }).notNull(),
  /** What kind of operational issue this template addresses */
  triggerType: mysqlEnum("triggerType", callTemplateTriggerTypes as unknown as [string, ...string[]]).notNull(),
  /** Who to call: team (cleaner), client, or both */
  targetType: mysqlEnum("targetType", callTemplateTargetTypes as unknown as [string, ...string[]]).notNull(),
  /**
   * The voice script with {{variable}} placeholders.
   * Supported variables: {{team_name}}, {{client_name}}, {{address}},
   * {{time}}, {{new_eta}}, {{water_power_access}}
   */
  scriptTemplate: text("scriptTemplate").notNull(),
  /** Whether this template appears in the dispatcher UI */
  isActive: int("isActive").default(1).notNull(),
  /** Display sort order */
  sortOrder: int("sortOrder").default(0).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type CallTemplate = typeof callTemplates.$inferSelect;
export type InsertCallTemplate = typeof callTemplates.$inferInsert;

/**
 * callLog — one row per AI call fired from the Command Center.
 * Tracks the full lifecycle: pending → fired → completed | failed.
 * vapiCallId links back to the VAPI call for recording/transcript retrieval.
 */
export const callLogStatuses = ["pending", "fired", "completed", "failed", "no_answer"] as const;
export type CallLogStatus = (typeof callLogStatuses)[number];

export const callLog = mysqlTable("call_log", {
  id: int("id").autoincrement().primaryKey(),
  /** The job this call is about (cleanerJobs.id) */
  cleanerJobId: int("cleanerJobId"),
  /** The scheduling team involved */
  teamId: int("teamId"),
  /** Denormalized team name for display */
  teamName: varchar("teamName", { length: 255 }),
  /** Client name (denormalized for display) */
  clientName: varchar("clientName", { length: 255 }),
  /** Phone number called (E.164) */
  calledPhone: varchar("calledPhone", { length: 30 }),
  /** Who the call was placed to: team or client */
  calledTarget: mysqlEnum("calledTarget", ["team", "client"]).notNull(),
  /** Which template was used */
  templateId: int("templateId"),
  /** Template name at time of firing (denormalized) */
  templateName: varchar("templateName", { length: 255 }),
  /** The fully resolved script (variables substituted) */
  resolvedScript: text("resolvedScript").notNull(),
  /** Current lifecycle status */
  status: mysqlEnum("status", callLogStatuses as unknown as [string, ...string[]]).default("pending").notNull(),
  /** VAPI call ID returned from the VAPI API */
  vapiCallId: varchar("vapiCallId", { length: 128 }),
  /** URL to the call recording (populated from VAPI end-of-call webhook) */
  recordingUrl: varchar("recordingUrl", { length: 1024 }),
  /** Full call transcript — canonical/original transcript, always the source of truth (populated from VAPI end-of-call webhook) */
  transcript: longtext("transcript"),
  /** Language of the call, e.g. "en" or "es" (populated on call completion) */
  transcriptLanguage: varchar("transcriptLanguage", { length: 10 }),
  /** English translation of the transcript (null for English calls, populated after non-English calls) */
  transcriptEnglish: longtext("transcriptEnglish"),
  /** Job date this call relates to (YYYY-MM-DD) */
  jobDate: varchar("jobDate", { length: 20 }),
  /** Who fired the call: "dispatcher" | "auto" */
  firedBy: varchar("firedBy", { length: 64 }),
  /** When the call was placed */
  firedAt: bigint("firedAt", { mode: "number" }),
  /** When the call ended (from VAPI webhook) */
  completedAt: bigint("completedAt", { mode: "number" }),
  /** Duration in seconds (from VAPI webhook) */
  durationSeconds: int("durationSeconds"),
  /** Dispatcher notes (optional, added after the call) */
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (t) => ({
  idxJobDate: index("idx_cl_job_date").on(t.jobDate),
  idxJobId: index("idx_cl_job_id").on(t.cleanerJobId),
  idxVapi: index("idx_cl_vapi").on(t.vapiCallId),
}));
export type CallLog = typeof callLog.$inferSelect;
export type InsertCallLog = typeof callLog.$inferInsert;

/**
 * jobIssues — tracks operational issues raised against a specific job+date.
 * Issues can be raised manually by a dispatcher or automatically by the system
 * (e.g. no check-in after scheduled time). Each issue can link to a callLog row
 * once a call has been fired.
 */
export const jobIssueTypes = [
  "late_team",
  "no_access",
  "parking",
  "delay",
  "lockout",
  "utility_issue",
  "no_checkin",
  "completion",
  "manual",
] as const;
export type JobIssueType = (typeof jobIssueTypes)[number];

export const jobIssues = mysqlTable("job_issues", {
  id: int("id").autoincrement().primaryKey(),
  /** The job this issue is about (cleanerJobs.id) */
  cleanerJobId: int("cleanerJobId").notNull(),
  /** The date this issue applies to (YYYY-MM-DD) */
  jobDate: varchar("jobDate", { length: 20 }).notNull(),
  /** What kind of issue this is */
  issueType: mysqlEnum("issueType", jobIssueTypes as unknown as [string, ...string[]]).notNull(),
  /** How the issue was raised */
  raisedBy: mysqlEnum("raisedBy", ["manual", "auto"]).default("manual").notNull(),
  /** Who raised it (agent name or "system") */
  raisedByName: varchar("raisedByName", { length: 128 }),
  /** When the issue was raised (Unix ms) */
  raisedAt: bigint("raisedAt", { mode: "number" }).notNull(),
  /** When the issue was resolved (null = still open) */
  resolvedAt: bigint("resolvedAt", { mode: "number" }),
  /** Link to the callLog row if a call was fired for this issue */
  callLogId: int("callLogId"),
  /** Optional dispatcher note */
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (t) => ({
  idxJobDate: index("idx_ji_job_date").on(t.cleanerJobId, t.jobDate),
}));
export type JobIssue = typeof jobIssues.$inferSelect;
export type InsertJobIssue = typeof jobIssues.$inferInsert;

// ── End-of-day availability check-in ────────────────────────────────────────
// Submitted by cleaners after completing their last job of the day.
// Records whether they're available tomorrow and how many jobs they can take.
export const teamAvailabilityCheckins = mysqlTable("team_availability_checkins", {
  id: int("id").autoincrement().primaryKey(),
  /** The cleanerProfiles.id of the team that submitted this */
  cleanerProfileId: int("cleanerProfileId").notNull(),
  /** The date the check-in was submitted (YYYY-MM-DD — today's date) */
  submittedForDate: varchar("submittedForDate", { length: 20 }).notNull(),
  /** The date this availability applies to (YYYY-MM-DD — tomorrow) */
  availabilityDate: varchar("availabilityDate", { length: 20 }).notNull(),
  /** Whether the team is available tomorrow */
  isAvailable: tinyint("isAvailable").notNull(),
  /** How many jobs they can do (null if not available) */
  maxJobs: int("maxJobs"),
  /** Optional note from the cleaner */
  note: text("note"),
  /** Unix ms when submitted */
  submittedAt: bigint("submittedAt", { mode: "number" }).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (t) => ({
  idxCleanerDate: index("idx_tac_cleaner_date").on(t.cleanerProfileId, t.availabilityDate),
  idxAvailDate: index("idx_tac_avail_date").on(t.availabilityDate),
}));
export type TeamAvailabilityCheckin = typeof teamAvailabilityCheckins.$inferSelect;
export type InsertTeamAvailabilityCheckin = typeof teamAvailabilityCheckins.$inferInsert;

/**
 * lead_assignments — one row per lead assignment action.
 * Created when an admin assigns a lead to an agent from Lead Ops.
 * Drives the blocking Command Chat overlay for the assigned agent.
 */
export const leadAssignments = mysqlTable("lead_assignments", {
  id: int("id").autoincrement().primaryKey(),
  /** FK to conversationSessions.id */
  sessionId: int("sessionId").notNull(),
  /** Agent ID being assigned */
  agentId: int("agentId").notNull(),
  /** Agent display name (denormalized for fast reads) */
  agentName: varchar("agentName", { length: 128 }).notNull(),
  /** Name of the admin who made the assignment */
  assignedByName: varchar("assignedByName", { length: 128 }).notNull(),
  /** Lead name at time of assignment */
  leadName: varchar("leadName", { length: 255 }),
  /** Lead phone at time of assignment */
  leadPhone: varchar("leadPhone", { length: 30 }),
  /** Notes captured at time of assignment */
  notes: text("notes"),
  /** FK to ops_chat_messages.id — the Command Chat card posted for this assignment */
  opsChatMessageId: int("opsChatMessageId"),
  /** Set when the assigned agent clicks "Got it" */
  acknowledgedAt: bigint("acknowledgedAt", { mode: "number" }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (t) => ({
  idxSession: index("idx_la_session").on(t.sessionId),
  idxAgent: index("idx_la_agent").on(t.agentId),
}));
export type LeadAssignment = typeof leadAssignments.$inferSelect;
export type InsertLeadAssignment = typeof leadAssignments.$inferInsert;

// ── chat_super_alerts ─────────────────────────────────────────────────────────
// One row per (message, target agent) for every super-alert (double-tag).
// The overlay persists until the agent clicks Reply (sets repliedAt).
export const chatSuperAlerts = mysqlTable("chat_super_alerts", {
  id:              int("id").autoincrement().primaryKey(),
  /** FK to ops_chat_messages.id — the message that triggered the super-alert */
  messageId:       int("messageId").notNull(),
  /** Channel the message was posted in (e.g. "command") */
  channel:         varchar("channel", { length: 64 }).notNull().default("command"),
  /** The agent name being alerted (matches agents.name; "everyone" for broadcast) */
  targetAgentName: varchar("targetAgentName", { length: 255 }).notNull(),
  /** Denormalised sender name for the overlay */
  senderName:      varchar("senderName", { length: 255 }).notNull(),
  /** The message body shown in the overlay */
  messageBody:     text("messageBody").notNull(),
  /** Set when the agent clicks Reply */
  repliedAt:       bigint("repliedAt", { mode: "number" }),
  createdAt:       timestamp("createdAt").defaultNow().notNull(),
}, (t) => ({
  idxMessage: index("idx_csa_message").on(t.messageId),
  idxTarget:  index("idx_csa_target").on(t.targetAgentName),
}));
export type ChatSuperAlert = typeof chatSuperAlerts.$inferSelect;
export type InsertChatSuperAlert = typeof chatSuperAlerts.$inferInsert;

/**
 * driveTimeCache — cached driving duration results from Google Distance Matrix API.
 * Key is "fromLat,fromLng->toLat,toLng" (coords rounded to 5 decimal places).
 * Avoids re-calling the API for the same origin/destination pair on every page load.
 */
export const driveTimeCache = mysqlTable("drive_time_cache", {
  id: int("id").autoincrement().primaryKey(),
  /** Cache key: "fromLat,fromLng->toLat,toLng" (coords rounded to 5dp) */
  routeKey: varchar("routeKey", { length: 100 }).notNull().unique(),
  /** Driving duration in seconds */
  durationSeconds: int("durationSeconds").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (t) => ({
  idxRouteKey: index("idx_dtc_route_key").on(t.routeKey),
}));
export type DriveTimeCache = typeof driveTimeCache.$inferSelect;
export type InsertDriveTimeCache = typeof driveTimeCache.$inferInsert;

/**
 * teamWorkSchedule — weekly availability template per team.
 * Defines which days of the week a team normally works.
 * One row per team; upserted when the schedule is changed.
 */
export const teamWorkSchedule = mysqlTable("team_work_schedule", {
  id: int("id").autoincrement().primaryKey(),
  /** FK to schedulingTeams.id */
  teamId: int("teamId").notNull().unique(),
  /** Which days the team works (1 = works, 0 = off) */
  mon: tinyint("mon").notNull().default(1),
  tue: tinyint("tue").notNull().default(1),
  wed: tinyint("wed").notNull().default(1),
  thu: tinyint("thu").notNull().default(1),
  fri: tinyint("fri").notNull().default(1),
  sat: tinyint("sat").notNull().default(0),
  sun: tinyint("sun").notNull().default(0),
  /** Optional note from the cleaner about their weekly schedule */
  note: varchar("note", { length: 500 }),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type TeamWorkSchedule = typeof teamWorkSchedule.$inferSelect;
export type InsertTeamWorkSchedule = typeof teamWorkSchedule.$inferInsert;

/**
 * teamDayOverride — date-specific override for a team's availability.
 * Can force a team to be available on an off day, or unavailable on a work day,
 * and optionally attach a note (e.g. "only after 12:30 PM").
 * Takes precedence over the weekly template.
 */
export const teamDayOverride = mysqlTable("team_day_override", {
  id: int("id").autoincrement().primaryKey(),
  /** FK to schedulingTeams.id */
  teamId: int("teamId").notNull(),
  /** Date string YYYY-MM-DD */
  date: varchar("date", { length: 20 }).notNull(),
  /**
   * null = no override (use weekly template)
   * 1    = force available (override off day)
   * 0    = force unavailable (override work day)
   */
  isAvailable: tinyint("isAvailable"),
  /** Optional note shown on the schedule card, e.g. "Only after 12:30 PM" */
  note: varchar("note", { length: 500 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (t) => ({
  uniqTeamDate: uniqueIndex("uniq_tdo_team_date").on(t.teamId, t.date),
}));
export type TeamDayOverride = typeof teamDayOverride.$inferSelect;
export type InsertTeamDayOverride = typeof teamDayOverride.$inferInsert;

// ── Gmail integration state ────────────────────────────────────────────────────
export const gmailState = mysqlTable("gmail_state", {
  id: int("id").primaryKey(),
  refreshToken: text("refreshToken").notNull(),
  historyId: varchar("historyId", { length: 50 }).notNull().default("0"),
  watchExpiration: bigint("watchExpiration", { mode: "number" }).notNull().default(0),
  // Persistent cooldown for startup backfill only — set when threads.list gets a 429.
  // Unix timestamp (ms). Backfill is skipped until Date.now() exceeds this value.
  // Does NOT affect Pub/Sub processing or manual inbox actions.
  gmailBackfillCooldownUntil: bigint("gmailBackfillCooldownUntil", { mode: "number" }).notNull().default(0),
  // Resumable inbox backfill page token — stored by backfill-inbox-db.mjs so the script
  // can resume from where it left off if interrupted by a 429 or manual stop.
  backfillPageToken: varchar("backfillPageToken", { length: 500 }),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type GmailState = typeof gmailState.$inferSelect;

/**
 * gmail_sent_log — tracks which agent sent each outgoing Gmail reply.
 * Purely internal — no effect on email deliverability.
 */
export const gmailSentLog = mysqlTable("gmail_sent_log", {
  id: int("id").autoincrement().primaryKey(),
  /** Gmail thread ID */
  threadId: varchar("threadId", { length: 255 }).notNull(),
  /** Gmail message ID of the sent message */
  messageId: varchar("messageId", { length: 255 }).notNull().unique(),
  /** Agent's Manus openId */
  agentOpenId: varchar("agentOpenId", { length: 64 }).notNull(),
  /** Agent's display name at time of send */
  agentName: text("agentName").notNull(),
  /** Agent's profile photo URL at time of send */
  agentPhotoUrl: text("agentPhotoUrl"),
  /** UTC timestamp of when the reply was sent */
  sentAt: timestamp("sentAt").defaultNow().notNull(),
});
export type GmailSentLog = typeof gmailSentLog.$inferSelect;

/**
 * gmail_thread_meta — stores per-thread metadata that lives outside Gmail.
 * One row per thread ID. Created on first flag; upserted on updates.
 */
export const gmailThreadMeta = mysqlTable("gmail_thread_meta", {
  id: int("id").autoincrement().primaryKey(),
  /** Gmail thread ID */
  threadId: varchar("threadId", { length: 255 }).notNull().unique(),
  /** Whether this thread is flagged as an issue (1 = yes, 0 = no) */
  isIssue: int("isIssue").default(0).notNull(),
  /** AI-generated one-line summary of why it's an issue */
  issueSummary: text("issueSummary"),
  /** Agent openId who flagged it */
  flaggedBy: varchar("flaggedBy", { length: 64 }),
  /** When it was flagged */
  flaggedAt: timestamp("flaggedAt"),
  /** Agent ID (agents.id) this thread is assigned to — null = unassigned */
  assignedToId: int("assignedToId"),
  /** Cached display name of the assigned agent */
  assignedToName: varchar("assignedToName", { length: 255 }),
  /** Cached profile photo URL of the assigned agent */
  assignedToPhotoUrl: varchar("assignedToPhotoUrl", { length: 1024 }),
  /** When the assignment was made */
  assignedAt: timestamp("assignedAt"),
  // ── AI Glance columns ──────────────────────────────────────────────────────
  /** AI-classified category for the glance panel */
  aiCategory: varchar("aiCategory", { length: 50 }),
  /** AI-generated summary stored as JSON string: string[] of bullet points */
  aiSummary: text("aiSummary"),
  /** AI-assessed urgency: 'high' | 'medium' | 'low' */
  aiUrgency: varchar("aiUrgency", { length: 10 }),
  /** Gmail historyId at the time AI last ran — used for cache invalidation */
  aiHistoryId: varchar("aiHistoryId", { length: 64 }),
  /** When AI last processed this thread */
  aiProcessedAt: timestamp("aiProcessedAt"),
  /** When this glance item was marked resolved by an agent */
  aiResolvedAt: timestamp("aiResolvedAt"),
  /** Whether this thread is currently in the INBOX label (not archived). Updated by listThreads. */
  isInInbox: int("isInInbox").default(1).notNull(),
  /** Whether this thread has unread messages. 1 = unread, 0 = read. Updated by glance worker and Pub/Sub webhook. */
  isUnread: int("isUnread").default(0).notNull(),
  // ── Inbox display fields (written by worker, canonical source for listThreads) ──
  /** Display name of the other party. Written by worker on every processThread. */
  senderName: varchar("senderName", { length: 255 }),
  /** Email address of the other party. Written by worker on every processThread. */
  senderEmail: varchar("senderEmail", { length: 255 }),
  /** Thread subject line. Written by worker on every processThread. */
  subject: varchar("subject", { length: 500 }),
  /** Latest message snippet. Written by worker on every processThread. */
  snippet: text("snippet"),
  /** Unix ms timestamp of the latest message. Written by worker on every processThread. */
  lastMessageAt: bigint("lastMessageAt", { mode: "number" }),
  /** Total number of messages in the thread. Written by worker on every processThread. */
  messageCount: int("messageCount"),
  /**
   * Whether this thread is actionable (1) or should be hidden from the default inbox view (0).
   * Resolved by the worker against gmail_sender_policies: email rule > domain rule > default (1).
   */
  isActionable: int("isActionable").default(1).notNull(),
  /**
   * Why isActionable was set to its current value.
   * Values: 'DEFAULT' | 'EMAIL_RULE' | 'DOMAIN_RULE'
   * Application-validated varchar — not a DB enum so new sources can be added without migrations.
   */
  actionableReason: varchar("actionableReason", { length: 20 }).default("DEFAULT").notNull(),
  /**
   * AI enrichment pipeline status.
   * 'pending'   — not yet attempted
   * 'completed' — AI ran successfully
   * 'retry'     — AI failed; eligible for retry on next worker cycle
   */
  aiStatus: varchar("aiStatus", { length: 20 }).default("pending").notNull(),
  /**
   * Short error code from the last failed AI attempt.
   * Values: 'JSON_PARSE' | 'TIMEOUT' | 'RATE_LIMIT' | 'LLM_500' | null
   */
  lastAiError: varchar("lastAiError", { length: 50 }),
  /** When AI last attempted enrichment on this thread (for operational visibility). */
  lastAiAttemptAt: timestamp("lastAiAttemptAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type GmailThreadMeta = typeof gmailThreadMeta.$inferSelect;

// ── Confirmation Calls ────────────────────────────────────────────────────────
/**
 * confirmation_calls — one row per AI confirmation call placed from the
 * Confirmation Calls page. Tracks the full lifecycle and links back to the
 * VAPI call via vapiCallId (which also gates the fieldMgmtCalls guard row).
 */
export const confirmationCallStatuses = ["pending", "fired", "completed", "failed", "no_answer"] as const;
export type ConfirmationCallStatus = (typeof confirmationCallStatuses)[number];

export const confirmationCalls = mysqlTable("confirmation_calls", {
  id: int("id").autoincrement().primaryKey(),
  /** The job this call is about (cleanerJobs.id) */
  cleanerJobId: int("cleanerJobId").notNull(),
  /** Job date (YYYY-MM-DD) */
  jobDate: varchar("jobDate", { length: 20 }).notNull(),
  /** Client name (denormalized for display) */
  clientName: varchar("clientName", { length: 255 }),
  /** Phone number called (E.164) */
  calledPhone: varchar("calledPhone", { length: 30 }).notNull(),
  /** Current lifecycle status */
  status: mysqlEnum("status", confirmationCallStatuses as unknown as [string, ...string[]]).default("pending").notNull(),
  /** VAPI call ID returned from the VAPI API */
  vapiCallId: varchar("vapiCallId", { length: 128 }).unique(),
  /** URL to the call recording (populated from VAPI end-of-call webhook) */
  recordingUrl: varchar("recordingUrl", { length: 1024 }),
  /** Full call transcript (populated from VAPI end-of-call webhook) */
  transcript: longtext("transcript"),
  /** AI-generated summary of call outcome */
  summary: text("summary"),
  /** Why the call ended (from VAPI webhook) */
  endedReason: varchar("endedReason", { length: 100 }),
  /** Call duration in seconds (from VAPI webhook) */
  durationSeconds: int("durationSeconds"),
  /** Who fired the call */
  firedBy: varchar("firedBy", { length: 64 }),
  /** When the call was placed */
  firedAt: bigint("firedAt", { mode: "number" }),
  /** When the call ended (from VAPI webhook) */
  completedAt: bigint("completedAt", { mode: "number" }),
  // ── AI-structured fields (populated by LLM parsing of transcript on end-of-call) ──
  /** AI-determined outcome: confirmed | reschedule | cancel | no_answer | voicemail | unknown */
  aiOutcome: varchar("aiOutcome", { length: 32 }),
  /** AI-determined flexibility: exact | one_hour | anytime | unknown */
  aiFlexibility: varchar("aiFlexibility", { length: 32 }),
  /** AI-extracted special notes (dog home, lockbox, WFH, baby sleeping, etc.) as JSON array */
  aiNotes: text("aiNotes"),
  /** Short human-readable outcome label from AI (e.g. "Confirmed ✓", "Wants to Reschedule") */
  aiOutcomeLabel: varchar("aiOutcomeLabel", { length: 128 }),
  /** Manual override outcome set by an agent — overrides AI outcome in all displays */
  manualOutcome: varchar("manualOutcome", { length: 32 }),
  /** Human-readable label for the manual override (e.g. "Manually Confirmed ✓") */
  manualOutcomeLabel: varchar("manualOutcomeLabel", { length: 128 }),
  /** Agent name who set the manual override */
  manualOverrideBy: varchar("manualOverrideBy", { length: 64 }),
  /** Timestamp (ms) when the manual override was set */
  manualOverrideAt: bigint("manualOverrideAt", { mode: "number" }),
  /** Whether an SMS fallback was sent after a no-answer call */
  smsFollowupSent: tinyint("smsFollowupSent").default(0).notNull(),
  /** When the SMS fallback was sent (ms epoch) */
  smsFollowupAt: bigint("smsFollowupAt", { mode: "number" }),
  /** Body of the SMS fallback message */
  smsFollowupBody: text("smsFollowupBody"),
  /** Customer's most recent reply to the SMS fallback (kept for backwards compat) */
  smsReply: text("smsReply"),
  /** All customer replies as a JSON array [{text, receivedAt}] */
  smsReplies: json("sms_replies").$type<Array<{text: string; receivedAt: number}>>(),
  /** When the customer confirmed via SMS reply (ms epoch) */
  smsConfirmedAt: bigint("smsConfirmedAt", { mode: "number" }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (t) => ({
  idxJobDate: index("idx_cc_job_date").on(t.jobDate),
  idxJobId: index("idx_cc_job_id").on(t.cleanerJobId),
  idxVapi: index("idx_cc_vapi").on(t.vapiCallId),
}));
export type ConfirmationCall = typeof confirmationCalls.$inferSelect;
export type InsertConfirmationCall = typeof confirmationCalls.$inferInsert;

// ── Missed Calls ──────────────────────────────────────────────────────────────
/**
 * missed_calls — one row per missed inbound OpenPhone call.
 * Inserted by the call.completed webhook handler when direction=incoming
 * and answeredAt is null (call was never answered).
 */
export const missedCalls = mysqlTable("missed_calls", {
  id: int("id").autoincrement().primaryKey(),
  /** OpenPhone's call ID — UNIQUE to prevent duplicate inserts on webhook retry */
  openphoneCallId: varchar("openphoneCallId", { length: 255 }).notNull().unique(),
  /** Caller's phone number in E.164 format */
  callerPhone: varchar("callerPhone", { length: 20 }).notNull(),
  /** OpenPhone phone number ID that was called (main / CS / Bark) */
  phoneNumberId: varchar("phoneNumberId", { length: 64 }).notNull(),
  /** Human-readable label: "Main" | "CS" | "Bark" | "Unknown" */
  phoneNumberLabel: varchar("phoneNumberLabel", { length: 32 }).notNull().default("Unknown"),
  /** When the call was placed (from call.createdAt in the webhook payload) */
  calledAt: timestamp("calledAt").notNull(),
  /** Whether the auto-SMS was sent to the caller */
  smsSent: tinyint("smsSent").default(0).notNull(),
  /** When the auto-SMS was sent */
  smsSentAt: timestamp("smsSentAt"),
  /** Whether an agent has marked this call as called back / resolved */
  calledBack: tinyint("calledBack").default(0).notNull(),
  /** When the call-back was marked complete */
  calledBackAt: timestamp("calledBackAt"),
  /** Agent who marked the call-back complete */
  calledBackByAgentName: varchar("calledBackByAgentName", { length: 128 }),
  /** Optional agent note added when marking as called back */
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (t) => ({
  idxCallerPhone: index("idx_mc_caller_phone").on(t.callerPhone),
  idxCalledAt: index("idx_mc_called_at").on(t.calledAt),
  idxCalledBack: index("idx_mc_called_back").on(t.calledBack),
}));
export type MissedCall = typeof missedCalls.$inferSelect;
export type InsertMissedCall = typeof missedCalls.$inferInsert;

// ─── AI Call Templates ────────────────────────────────────────────────────────
/**
 * Stores editable call scripts for the AI Call Matrix.
 * Each row is keyed by (scenario, audience) — one template per scenario+audience combo.
 * Merge fields like {{firstName}}, {{jobTime}}, {{eta}} are resolved at call time.
 */
export const aiCallTemplates = mysqlTable("ai_call_templates", {
  id: int("id").autoincrement().primaryKey(),
  /** Scenario slug matching the scenario card keys in the UI, e.g. "running_late" */
  scenario: varchar("scenario", { length: 64 }).notNull(),
  /** "customer" | "cleaner" */
  audience: varchar("audience", { length: 16 }).notNull(),
  /** Human-readable title shown in the Templates tab */
  title: varchar("title", { length: 128 }).notNull(),
  /** The script body with optional merge fields: {{firstName}}, {{jobTime}}, {{eta}}, {{address}}, {{serviceType}}, {{teamName}}, {{jobCount}} */
  body: text("body").notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (t) => ({
  idxScenarioAudience: uniqueIndex("idx_act_scenario_audience").on(t.scenario, t.audience),
}));
export type AiCallTemplate = typeof aiCallTemplates.$inferSelect;
export type InsertAiCallTemplate = typeof aiCallTemplates.$inferInsert;

/**
 * Google API daily usage counter.
 * One row per calendar date (YYYY-MM-DD). Incremented on each live API call.
 * Used to show a warning banner on the schedule page when limits are approached.
 * Limits: 1000 geocodes/day, 300 distance matrix calls/day.
 */
export const googleApiUsage = mysqlTable("google_api_usage", {
  id: int("id").autoincrement().primaryKey(),
  /** Calendar date in YYYY-MM-DD format — unique, one row per day */
  date: varchar("date", { length: 10 }).notNull().unique(),
  /** Number of Geocoding API calls made today */
  geocodeCalls: int("geocodeCalls").notNull().default(0),
  /** Number of Distance Matrix API calls made today */
  distanceCalls: int("distanceCalls").notNull().default(0),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type GoogleApiUsage = typeof googleApiUsage.$inferSelect;
export type InsertGoogleApiUsage = typeof googleApiUsage.$inferInsert;

/**
 * gbp_state — stores the Google Business Profile OAuth refresh token.
 * One row (id=1). Written by /api/gbp/oauth/callback.
 */
export const gbpState = mysqlTable("gbp_state", {
  id: int("id").primaryKey(),
  refreshToken: text("refreshToken").notNull(),
  /** GBP account name, e.g. "accounts/123456789" */
  accountName: varchar("accountName", { length: 128 }).default(""),
  /** GBP location name, e.g. "accounts/123456789/locations/987654321" */
  locationName: varchar("locationName", { length: 255 }).default(""),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type GbpState = typeof gbpState.$inferSelect;

// ── Stripe: card-on-file tables ───────────────────────────────────────────────

/**
 * card_auth_tokens — one-time-use tokens for the /pay/:token card collection page.
 */
export const cardAuthTokens = mysqlTable("card_auth_tokens", {
  id: int("id").autoincrement().primaryKey(),
  token: varchar("token", { length: 64 }).notNull().unique(),
  customerPhone: varchar("customerPhone", { length: 30 }).notNull(),
  customerName: varchar("customerName", { length: 255 }),
  jobDate: varchar("jobDate", { length: 64 }),
  jobAddress: varchar("jobAddress", { length: 512 }),
  cleanerJobId: int("cleanerJobId"),
  used: tinyint("used").notNull().default(0),
  expiresAt: bigint("expiresAt", { mode: "number" }).notNull(),
  completedAt: bigint("completedAt", { mode: "number" }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type CardAuthToken = typeof cardAuthTokens.$inferSelect;
export type InsertCardAuthToken = typeof cardAuthTokens.$inferInsert;

/**
 * stripe_customers — one row per customer phone number.
 */
export const stripeCustomers = mysqlTable("stripe_customers", {
  id: int("id").autoincrement().primaryKey(),
  phone: varchar("phone", { length: 30 }).notNull().unique(),
  name: varchar("name", { length: 255 }),
  stripeCustomerId: varchar("stripeCustomerId", { length: 64 }).notNull(),
  stripePaymentMethodId: varchar("stripePaymentMethodId", { length: 64 }),
  cardBrand: varchar("cardBrand", { length: 32 }),
  cardLast4: varchar("cardLast4", { length: 4 }),
  cardExpMonth: int("cardExpMonth"),
  cardExpYear: int("cardExpYear"),
  cardSavedAt: bigint("cardSavedAt", { mode: "number" }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type StripeCustomer = typeof stripeCustomers.$inferSelect;
export type InsertStripeCustomer = typeof stripeCustomers.$inferInsert;

/**
 * payment_authorizations — one row per preauth/capture attempt.
 */
export const paymentAuthorizations = mysqlTable("payment_authorizations", {
  id: int("id").autoincrement().primaryKey(),
  cleanerJobId: int("cleanerJobId"),
  jobLabel: varchar("jobLabel", { length: 255 }),
  customerPhone: varchar("customerPhone", { length: 30 }).notNull(),
  customerName: varchar("customerName", { length: 255 }),
  stripeCustomerId: varchar("stripeCustomerId", { length: 64 }).notNull(),
  stripePaymentMethodId: varchar("stripePaymentMethodId", { length: 64 }).notNull(),
  stripePaymentIntentId: varchar("stripePaymentIntentId", { length: 64 }),
  amountCents: int("amountCents").notNull(),
  currency: varchar("currency", { length: 8 }).notNull().default("usd"),
  status: varchar("status", { length: 32 }).notNull().default("authorized"),
  errorMessage: text("errorMessage"),
  createdBy: varchar("createdBy", { length: 128 }),
  actionBy: varchar("actionBy", { length: 128 }),
  notes: text("notes"),
  authorizedAt: bigint("authorizedAt", { mode: "number" }),
  capturedAt: bigint("capturedAt", { mode: "number" }),
  cancelledAt: bigint("cancelledAt", { mode: "number" }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type PaymentAuthorization = typeof paymentAuthorizations.$inferSelect;
export type InsertPaymentAuthorization = typeof paymentAuthorizations.$inferInsert;

// ── Ops Tasks ─────────────────────────────────────────────────────────────────
/**
 * ops_tasks — internal task management for ops agents.
 * Admin can create tasks, assign to agents, set priority/due date.
 * Agents see their own tasks; admin sees all.
 */
export const opsTasks = mysqlTable("ops_tasks", {
  id: int("id").autoincrement().primaryKey(),
  /** Short title of the task */
  title: varchar("title", { length: 255 }).notNull(),
  /** Optional longer description */
  description: text("description"),
  /** Priority level: urgent | high | medium | low */
  priority: varchar("priority", { length: 16 }).notNull().default("medium"),
  /** Status: todo | in_progress | done */
  status: varchar("status", { length: 16 }).notNull().default("todo"),
  /** Assigned agent id (FK → agents.id) */
  assigneeAgentId: int("assigneeAgentId"),
  /** Assigned agent name (denormalized for display) */
  assigneeAgentName: varchar("assigneeAgentName", { length: 128 }),
  /** Who created this task (agent name) */
  createdByAgentName: varchar("createdByAgentName", { length: 128 }),
  /** Who created this task (agent id) */
  createdByAgentId: int("createdByAgentId"),
  /** Due date (UTC epoch ms) */
  dueAt: bigint("dueAt", { mode: "number" }),
  /** When task was marked done */
  completedAt: bigint("completedAt", { mode: "number" }),
  /** When the due-date popup was dismissed by the assignee */
  popupDismissedAt: bigint("popupDismissedAt", { mode: "number" }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  idxAssignee: index("idx_ot_assignee").on(table.assigneeAgentId),
  idxStatus: index("idx_ot_status").on(table.status),
  idxDue: index("idx_ot_due").on(table.dueAt),
}));
export type OpsTask = typeof opsTasks.$inferSelect;
export type InsertOpsTask = typeof opsTasks.$inferInsert;

// ── Inbound SMS Log ───────────────────────────────────────────────────────────
/**
 * inbound_sms — permanent log of every inbound SMS received via OpenPhone webhook.
 * Written immediately before any processing so no customer reply is ever lost.
 * processing_status tracks whether the message was matched to a confirmation call.
 */
export const inboundSms = mysqlTable("inbound_sms", {
  id: int("id").autoincrement().primaryKey(),
  fromPhone: varchar("fromPhone", { length: 32 }).notNull(),
  toPhone: varchar("toPhone", { length: 32 }),
  message: text("message").notNull(),
  openPhoneMessageId: varchar("openPhoneMessageId", { length: 128 }),
  processingStatus: varchar("processingStatus", { length: 32 }).notNull().default("pending"),
  confirmationCallId: int("confirmationCallId"),
  extractedIntent: varchar("extractedIntent", { length: 32 }),
  extractedFlexibility: varchar("extractedFlexibility", { length: 32 }),
  extractedNotes: text("extractedNotes"),
  extractedConfidence: int("extractedConfidence"),
  processingError: text("processingError"),
  receivedAt: bigint("receivedAt", { mode: "number" }).notNull(),
  processedAt: bigint("processedAt", { mode: "number" }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  idxFromPhone: index("idx_isms_from_phone").on(table.fromPhone),
  idxStatus: index("idx_isms_status").on(table.processingStatus),
  idxMsgId: index("idx_isms_msg_id").on(table.openPhoneMessageId),
}));
export type InboundSms = typeof inboundSms.$inferSelect;
export type InsertInboundSms = typeof inboundSms.$inferInsert;

// ── Gmail Sender Policies ─────────────────────────────────────────────────────
/**
 * gmail_sender_policies — per-sender or per-domain rules that control whether
 * threads from a given sender are treated as "actionable" (shown in inbox) or
 * "ignored" (hidden from default view, excluded from unread badge).
 *
 * Priority order when resolving a thread's isActionable:
 *   1. Exact senderEmail match
 *   2. senderDomain match
 *   3. Default → isActionable = 1
 *
 * Only one of senderEmail or senderDomain should be set per row.
 */
export const gmailSenderPolicies = mysqlTable("gmail_sender_policies", {
  id: int("id").autoincrement().primaryKey(),
  /** Exact sender email address to match, e.g. "notifications@thumbtack.com" */
  senderEmail: varchar("senderEmail", { length: 255 }),
  /** Domain to match, e.g. "thumbtack.com" */
  senderDomain: varchar("senderDomain", { length: 255 }),
  /** 1 = actionable (show in inbox), 0 = ignored (hide from inbox) */
  isActionable: int("isActionable").default(1).notNull(),
  /** Human-readable label, e.g. "Thumbtack notifications" */
  label: varchar("label", { length: 100 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type GmailSenderPolicy = typeof gmailSenderPolicies.$inferSelect;
export type InsertGmailSenderPolicy = typeof gmailSenderPolicies.$inferInsert;

// ── Issue Engine (Phase 1) ────────────────────────────────────────────────────
/**
 * issues — operational issues created manually (Phase 1) or by AI (Phase 2+).
 * Standalone table, separate from the legacy issueOwnership/chat-message issues.
 */
export const issueEngineTypes = [
  "late_team",
  "refund_request",
  "angry_customer",
  "no_show",
  "access_problem",
  "payment_problem",
  "reschedule_needed",
  "broken_item",
  "manager_review",
  "internal_task",
  "other",
] as const;
export type IssueEngineType = (typeof issueEngineTypes)[number];

export const issueEngineSeverities = ["critical", "high", "medium", "low"] as const;
export type IssueEngineSeverity = (typeof issueEngineSeverities)[number];

export const issueEngineStatuses = ["open", "waiting", "resolved"] as const;
export type IssueEngineStatus = (typeof issueEngineStatuses)[number];

export const issueEngineTable = mysqlTable("issue_engine", {
  id: int("id").autoincrement().primaryKey(),
  title: varchar("title", { length: 255 }).notNull(),
  issueType: mysqlEnum("issueType", issueEngineTypes as unknown as [string, ...string[]]).notNull().default("other"),
  severity: mysqlEnum("severity", issueEngineSeverities as unknown as [string, ...string[]]).notNull().default("medium"),
  status: mysqlEnum("status", issueEngineStatuses as unknown as [string, ...string[]]).notNull().default("open"),
  /** Display name of the owner agent (null = unassigned) */
  ownerName: varchar("ownerName", { length: 128 }),
  /** Optional "waiting on" label — free text e.g. "Customer", "Office", "Cleaner" */
  waitingOn: varchar("waitingOn", { length: 128 }),
  /** Optional notes / reason */
  notes: text("notes"),
  /** Related CS session id (conversationSessions.id) */
  relatedSessionId: int("relatedSessionId"),
  /** Related cleaner job id */
  relatedJobId: int("relatedJobId"),
  /** Name of the agent who created this issue */
  createdByName: varchar("createdByName", { length: 128 }).notNull(),
  lastActivityAt: bigint("lastActivityAt", { mode: "number" }).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  resolvedAt: bigint("resolvedAt", { mode: "number" }),
}, (t) => ({
  idxStatus: index("idx_ie_status").on(t.status),
  idxSession: index("idx_ie_session").on(t.relatedSessionId),
}));
export type IssueEngine = typeof issueEngineTable.$inferSelect;
export type InsertIssueEngine = typeof issueEngineTable.$inferInsert;

/**
 * issue_engine_timeline — immutable activity log for each issue.
 */
export const issueEngineTimeline = mysqlTable("issue_engine_timeline", {
  id: int("id").autoincrement().primaryKey(),
  issueId: int("issueId").notNull(),
  /** Short description of what happened */
  event: varchar("event", { length: 512 }).notNull(),
  /** Who triggered this event */
  actor: varchar("actor", { length: 128 }).notNull().default("system"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (t) => ({
  idxIssue: index("idx_iet_issue").on(t.issueId),
}));
export type IssueEngineTimeline = typeof issueEngineTimeline.$inferSelect;
export type InsertIssueEngineTimeline = typeof issueEngineTimeline.$inferInsert;

// ── SMS Campaign Control Center ───────────────────────────────────────────────
//
// INVARIANT: THE AUDIENCE QUERY IS NEVER RE-RUN AFTER FREEZE.
// Once a campaign moves to FROZEN, the recipient list in sms_campaign_recipients
// is the single source of truth for all sends. No live queries. No re-evaluation.
//
// Architecture: AudiencePlanner → AudienceValidator → FreezeAudience
//   Planner   — "Who matches?" — returns count + stats, never IDs
//   Validator — "Is this a good idea?" — returns warnings + estimates
//   Freeze    — "Lock it forever." — writes sms_campaign_recipients, sets definitionHash
//
// Note on definitionHash: computed from canonically sorted JSON (keys sorted
// alphabetically at every level) — NOT raw JSON.stringify — so key insertion
// order differences in the AudienceDefinition object do not produce different hashes.

export const smsCampaignStatuses = [
  "DRAFT",      // Being built — audience definition editable
  "FROZEN",     // Recipient list frozen — awaiting admin review
  "APPROVED",   // Admin explicitly reviewed and approved the frozen list
  "SENDING",    // Batch send in progress
  "PAUSED",     // Mid-send pause (manual or rate-limit)
  "COMPLETED",  // All recipients processed
  "CANCELLED",  // Discarded before send
] as const;

export type SmsCampaignStatus = (typeof smsCampaignStatuses)[number];

/**
 * smsCampaigns — one row per SMS campaign.
 *
 * The audienceDefinition JSON is editable only while status = DRAFT.
 * Once frozen, definitionHash permanently links the frozen recipient list
 * to the exact audience version that produced it.
 */
export const smsCampaigns = mysqlTable("sms_campaigns", {
  id: int("id").autoincrement().primaryKey(),

  /** Human-readable campaign name (e.g. "Win Back — June 2026") */
  name: varchar("name", { length: 255 }).notNull(),

  status: mysqlEnum("status", smsCampaignStatuses as unknown as [string, ...string[]]).default("DRAFT").notNull(),

  /**
   * Full AudienceDefinition JSON — the object the UI edits.
   * Contains: presets[], includeRules[], excludeRules[], geography, metadata.
   * Editable only while status = DRAFT.
   */
  audienceDefinition: longtext("audienceDefinition").notNull(),

  /** SMS message template — supports {{first_name}}, {{area}} placeholders */
  messageTemplate: text("messageTemplate").notNull(),

  /**
   * Lightweight planner output: { recipientCount, stats, ruleHash, generatedAt }.
   * Does NOT store sample blobs. Samples are returned by a separate preview
   * endpoint and are never persisted here.
   * Updated on every planner run while status = DRAFT.
   */
  plannerResult: longtext("plannerResult"),

  // ── Freeze ────────────────────────────────────────────────────────────────
  /** UTC ms when the recipient list was frozen */
  frozenAt: bigint("frozenAt", { mode: "number" }),
  /** Exact count of rows written to sms_campaign_recipients at freeze time */
  frozenRecipientCount: int("frozenRecipientCount"),
  /**
   * SHA-256 of the canonically sorted audienceDefinition JSON at freeze time.
   * Proves exactly which audience version produced the frozen recipient list.
   * Computed with keys sorted alphabetically at every nesting level to ensure
   * hash stability regardless of object key insertion order.
   *
   * THE AUDIENCE QUERY IS NEVER RE-RUN AFTER THIS IS SET.
   */
  definitionHash: varchar("definitionHash", { length: 64 }),

  // ── Approval ──────────────────────────────────────────────────────────────
  /** UTC ms when admin explicitly approved the frozen list */
  approvedAt: bigint("approvedAt", { mode: "number" }),
  /** FK to agents.id — stored as int so it survives name changes */
  approvedByAgentId: int("approvedByAgentId"),
  /** Denormalized name snapshot at approval time — for display only */
  approvedByName: varchar("approvedByName", { length: 255 }),

  // ── Send ──────────────────────────────────────────────────────────────────
  sentCount: int("sentCount").default(0).notNull(),
  failedCount: int("failedCount").default(0).notNull(),
  repliedCount: int("repliedCount").default(0).notNull(),
  bookedCount: int("bookedCount").default(0).notNull(),
  /** UTC ms when the first batch was sent */
  sendStartedAt: bigint("sendStartedAt", { mode: "number" }),
  /** UTC ms when the last batch completed */
  sendCompletedAt: bigint("sendCompletedAt", { mode: "number" }),

  // ── Estimated metrics (set by AudienceValidator) ──────────────────────────
  /** Estimated revenue from this campaign (dollars) */
  estimatedRevenue: int("estimatedRevenue"),
  /** Estimated number of bookings this campaign will generate */
  estimatedBookings: int("estimatedBookings"),
  /** Estimated number of replies this campaign will receive */
  estimatedReplies: int("estimatedReplies"),

  // ── Test / dry run ────────────────────────────────────────────────────────
  /**
   * When 1: sends only to testPhones[], never writes to conversationSessions,
   * does not count toward opt-out suppression windows.
   */
  isDryRun: tinyint("isDryRun").default(0).notNull(),
  /** JSON array of phone numbers for test/dry-run sends */
  testPhones: text("testPhones"),

  // ── Audit ─────────────────────────────────────────────────────────────────
  /** FK to agents.id who created this campaign */
  createdByAgentId: int("createdByAgentId"),
  /** Denormalized name snapshot at creation time */
  createdByName: varchar("createdByName", { length: 255 }).notNull(),
  /** FK to agents.id who initiated the send */
  sentByAgentId: int("sentByAgentId"),
  /** Denormalized name snapshot at send time */
  sentByName: varchar("sentByName", { length: 255 }),

  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (t) => [
  index("idx_sms_campaigns_status").on(t.status),
  index("idx_sms_campaigns_created_at").on(t.createdAt),
]);

export type SmsCampaign = typeof smsCampaigns.$inferSelect;
export type InsertSmsCampaign = typeof smsCampaigns.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────────

export const smsCampaignRecipientStatuses = [
  "PENDING",   // Frozen, not yet sent
  "SENT",      // OpenPhone accepted the message
  "FAILED",    // OpenPhone returned an error
  "SKIPPED",   // Opted out between freeze and send time (last-moment safety check)
  "BOOKED",    // Manually marked as converted to a booking
] as const;

export type SmsCampaignRecipientStatus = (typeof smsCampaignRecipientStatuses)[number];

/**
 * smsCampaignRecipients — one row per frozen recipient per campaign.
 *
 * ONLY included recipients appear here. Excluded people are never written.
 * Exclusion samples and breakdown live in smsCampaigns.plannerResult only.
 *
 * All snapshot fields are frozen at freeze time and never updated afterward.
 * This ensures historical reports remain accurate even after customer data changes.
 */
export const smsCampaignRecipients = mysqlTable("sms_campaign_recipients", {
  id: int("id").autoincrement().primaryKey(),
  campaignId: int("campaignId").notNull(),

  /** Raw phone as it came from completedJobs */
  phone: varchar("phone", { length: 30 }).notNull(),
  /**
   * E.164-normalized phone — used for deduplication, opt-out checks,
   * and the unique constraint. Always starts with +1 for US numbers.
   */
  phoneNormalized: varchar("phoneNormalized", { length: 20 }).notNull(),

  // ── Recipient snapshot (frozen at freeze time — never updated after) ───────
  snapshotFirstName: varchar("snapshotFirstName", { length: 100 }),
  snapshotName: varchar("snapshotName", { length: 255 }),
  snapshotAddress: varchar("snapshotAddress", { length: 500 }),
  snapshotLastService: varchar("snapshotLastService", { length: 100 }),
  snapshotLastPrice: int("snapshotLastPrice"),

  /** FK to completedJobs.id — the specific job row this recipient came from */
  completedJobId: int("completedJobId").notNull(),

  /**
   * Fully personalized message rendered at freeze time.
   * Stored so sends never re-render from a live template.
   */
  personalizedMessage: text("personalizedMessage").notNull(),

  status: mysqlEnum("status", smsCampaignRecipientStatuses as unknown as [string, ...string[]]).default("PENDING").notNull(),

  /** UTC ms when the SMS was sent */
  sentAt: bigint("sentAt", { mode: "number" }),
  /** OpenPhone message ID returned on success — idempotency key */
  openPhoneMessageId: varchar("openPhoneMessageId", { length: 128 }),
  /** Link to the conversationSession created when they reply */
  sessionId: int("sessionId"),
  /** Error message if status = FAILED */
  errorMessage: varchar("errorMessage", { length: 500 }),
  /** If SKIPPED: reason (e.g. "opted out after freeze") */
  skipReason: varchar("skipReason", { length: 255 }),

  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (t) => [
  /**
   * PRIMARY SAFETY CONSTRAINT: prevents duplicate sends to the same
   * normalized phone within a campaign. This is the hard guard against
   * the 5,000 SMS incident pattern.
   */
  uniqueIndex("uq_campaign_phone").on(t.campaignId, t.phoneNormalized),
  index("idx_campaign_recipients_campaign_id").on(t.campaignId),
  index("idx_campaign_recipients_status").on(t.campaignId, t.status),
]);

export type SmsCampaignRecipient = typeof smsCampaignRecipients.$inferSelect;
export type InsertSmsCampaignRecipient = typeof smsCampaignRecipients.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────────

/**
 * smsCampaignSendLog — immutable audit trail.
 * Rows are NEVER updated or deleted.
 * Every send attempt (success or failure) produces exactly one row.
 */
export const smsCampaignSendLog = mysqlTable("sms_campaign_send_log", {
  id: int("id").autoincrement().primaryKey(),
  campaignId: int("campaignId").notNull(),
  recipientId: int("recipientId").notNull(),
  phoneNormalized: varchar("phoneNormalized", { length: 20 }).notNull(),

  action: mysqlEnum("action", ["SENT", "FAILED", "SKIPPED", "TEST_SENT"]).notNull(),

  /** Which batch this send was part of (1-indexed) */
  batchNumber: int("batchNumber").default(1).notNull(),
  /** Attempt number for this recipient (1 = first try, 2+ = retry) */
  attempt: int("attempt").default(1).notNull(),
  /** How long the OpenPhone API call took in ms */
  durationMs: int("durationMs"),

  openPhoneMessageId: varchar("openPhoneMessageId", { length: 128 }),
  errorMessage: varchar("errorMessage", { length: 500 }),
  /** Agent name or system process that triggered this action */
  triggeredBy: varchar("triggeredBy", { length: 255 }),

  attemptedAt: timestamp("attemptedAt").defaultNow().notNull(),
}, (t) => [
  index("idx_send_log_campaign").on(t.campaignId),
  index("idx_send_log_phone").on(t.phoneNormalized),
]);

export type SmsCampaignSendLog = typeof smsCampaignSendLog.$inferSelect;
export type InsertSmsCampaignSendLog = typeof smsCampaignSendLog.$inferInsert;
