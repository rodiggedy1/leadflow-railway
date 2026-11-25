#!/usr/bin/env node
// Builds the staging sanitization column map from a column inventory (no database access, no data).
// Input:  TSV with table, column, column_type, data_type, is_nullable, column_key, extra
//         + TSV of JSON-typed columns (table, column)
// Output: docs/claude/staging/sanitize/column-map.tsv (one row per column, every column has a rule)
// Rules are applied in order: table rules, explicit column overrides, then name/type patterns.
// Anything no rule covers is REVIEW, and the sanitizer will refuse to run while any REVIEW remains.
"use strict";
const fs = require("fs");
const path = require("path");
const [inventoryPath, jsonColsPath, outPath] = process.argv.slice(2);

const RULES = {
  KEEP: "keep as is (ids, numbers, dates, statuses, business settings)",
  PHONE: "deterministic fake phone +19992XXXXXX (same real number -> same fake number)",
  EMAIL: "deterministic fake email u<hash>@example.invalid",
  CONTACT: "if it contains @ -> same fake email as EMAIL; if it looks like a phone -> same fake phone as PHONE; else fake id",
  PERSON_NAME: "deterministic fake person name",
  TEAM_NAME: "deterministic fake team name (Team <word>)",
  ADDRESS: "fake street, keep city/state/ZIP when present",
  GEO_ROUND: "round coordinate to 2 decimals (~1 km)",
  FREE_TEXT: "replace with neutral placeholder text (keeps empty/NULL as is)",
  CONVERSATION: "replace with a synthetic conversation from the scenario library (keeps role/timestamps shape)",
  SECRET: "set to NULL (credentials, tokens, password hashes, codes)",
  PAYMENT_REF: "replace with fake STAGING reference (amounts kept elsewhere)",
  CARD_LAST4: "set to 4242",
  EXTERNAL_ID: "deterministic fake id with SIM_ prefix (keeps joins/uniqueness)",
  MEDIA_URL: "set to NULL (recordings, photos, videos, attachments)",
  JSON_EMPTY: "replace with empty JSON ({} or []) — may contain personal data",
  JSON_KEEP: "keep (business structure only: prices, extras, line items, counts)",
  NETWORK_ID: "set to NULL (IP addresses, user agents, device ids)",
  NEUTRALIZE: "pending state -> closed/cancelled so nothing can be sent or executed (exact values set in A2)",
  BLANK: "set to NULL / empty",
  TRUNCATE_TABLE: "delete all rows in this table",
};

// ---- Table-level decisions ---------------------------------------------------------------
const TRUNCATE = {
  // credentials, sessions, devices
  applicant_portal_handoff_tokens: "login tokens", card_auth_tokens: "card-on-file links", cash_app_payment_tokens: "payment links",
  cleaner_magic_link_tokens: "cleaner login links", customer_portal_handoff_tokens: "customer login links",
  customer_portal_login_codes: "customer login codes", customer_portal_login_rate_limits: "login rate limits",
  push_subscriptions: "real browsers/phones of staff (push endpoints)", users: "Manus OAuth user identities (not used on staging)",
  gbp_state: "Google Business OAuth state/tokens", gmail_state: "Gmail OAuth/watch state",
  // raw payloads, caches, transient locks, operational logs
  gmail_message_html_cache: "full email bodies", stripe_webhook_events: "raw payment webhook payloads",
  interview_chunks: "applicant interview recordings", page_views: "visitor analytics (IPs, agents)",
  ai_insights_cache: "AI text cache (regenerates)", command_center_cache: "cache (regenerates)", drive_time_cache: "cache (regenerates)",
  job_geo_cache: "geocoded real addresses (regenerates)", metrics_ai_alerts: "AI alert text", cron_heartbeats: "job heartbeats (staging writes its own)",
  schedule_job_locks: "transient locks", step_locks: "transient locks", team_day_lock: "transient locks",
  sync_runs: "sync logs with raw errors", message_integrity_checks: "integrity logs with phone data", google_api_usage: "API usage counters",
  // AI training / evaluation data built from real conversations
  cs_draft_examples: "real SMS pairs used as AI examples", madison_golden_case_reviews: "real messages in AI test set",
  madison_live_golden_reviews: "real messages in AI test set",
  // AI agent internal reasoning: dense personal data in JSON; staging has no AI keys to use it
  madison_decisions: "AI reasoning", madison_intents: "AI reasoning", madison_message_understanding: "AI reasoning",
  madison_conversation_fact_events: "facts extracted from customer messages", madison_customer_mission_facts: "facts extracted from customer messages",
  madison_conversation_context: "AI context", madison_action_proposals: "AI proposals", madison_actions: "AI executed actions",
  madison_action_approvals: "AI approvals", madison_sms_action_approvals: "AI approvals", madison_action_items: "AI items",
  madison_customer_missions: "AI missions", madison_missions: "AI missions", madison_sms_draft_edits: "edits of real drafts",
  chain_executions: "AI chain runs", chain_step_executions: "AI chain steps",
};

// Queue / pending-action tables: rows kept for realism, but status neutralised (A2 sets the exact values).
const NEUTRALIZE_TABLES = new Set([
  "always_on_enrollments", "booking_notification_deliveries", "callback_tasks", "campaign_approval_batches", "campaign_blasts",
  "confirmation_calls", "follow_ups", "job_alerts", "lead_notification_deliveries", "madison_email_drafts", "madison_sms_drafts",
  "nurture_enrollments", "ops_reminders", "ops_tasks", "payable_invoice_deliveries", "payable_invoice_attempts", "payment_authorizations",
  "rating_sms_pending", "reactivation_campaigns", "reactivation_contacts", "sms_campaigns", "sms_campaign_recipients",
  "twilio_lead_bridges", "field_mgmt_calls", "voice_calls", "chat_super_alerts", "always_on_groups", "issue_engine",
]);
const NEUTRALIZE_COL = /^(status|state|sendStatus|deliveryStatus|callStatus|approvalStatus|stage_?status|status_\w+|isActive|isPaused|paused|enabled|scheduledAt|sendAt|nextRunAt|nextSendAt|dueAt|claimedAt|claimToken|claimedBy|retryAt|nextAttemptAt|attempts?|attemptCount)$/i;

// ---- Explicit column decisions (table.column -> rule [, note]) ----------------------------
const OVERRIDES = {
  "app_versioned_migration_ledger.last_error": ["FREE_TEXT", "database-update error text (can quote data values)"],
  "conversation_sessions.messageHistory": ["CONVERSATION", "full SMS history -> synthetic scenario conversation"],
  "conversation_sessions.lastMessageText": ["CONVERSATION", "kept consistent with the synthetic conversation"],
  "conversation_sessions.lastMessageRole": ["KEEP"],
  "conversation_sessions.extras": ["JSON_KEEP", "selected cleaning extras"],
  "conversation_sessions.barkQA": ["JSON_EMPTY", "lead-form answers (free text)"],
  "conversation_sessions.selectedSlot": ["KEEP", "booking slot text"],
  "conversation_sessions.preferredDates": ["KEEP"],
  "scheduling_teams.name": ["TEAM_NAME"],
  "scheduling_teams.homeAddress": ["ADDRESS"],
  "agents.name": ["PERSON_NAME"], "cleaner_profiles.name": ["PERSON_NAME"], "candidates.name": ["PERSON_NAME"],
  "agents.passwordHash": ["SECRET"], "cleaner_profiles.passwordHash": ["SECRET"],
  "agents.profilePhotoUrl": ["MEDIA_URL"],
  "agents.onCallCallId": ["EXTERNAL_ID"],
  "app_settings.value": ["KEEP", "business settings; A2 blanks any key named like token/secret/key/password/webhook"],
  "system_config.pausedServices": ["JSON_KEEP"],
  // --- manual review of first-pass REVIEW columns (2026-11-25) ---
  // people
  "always_on_enrollments.name": ["PERSON_NAME"], "completed_jobs.name": ["PERSON_NAME"], "quote_leads.name": ["PERSON_NAME"],
  "reactivation_contacts.name": ["PERSON_NAME"], "stripe_customers.name": ["PERSON_NAME"], "follow_ups.name": ["PERSON_NAME"],
  "follow_ups.owner": ["PERSON_NAME"], "call_log.clientName": ["PERSON_NAME"], "confirmation_calls.clientName": ["PERSON_NAME"],
  "payable_invoices.clientName": ["PERSON_NAME"], "sms_campaign_recipients.snapshotName": ["PERSON_NAME"],
  "call_log.firedBy": ["PERSON_NAME"], "campaign_blasts.firedBy": ["PERSON_NAME"], "confirmation_calls.firedBy": ["PERSON_NAME"],
  "confirmation_calls.manualOverrideBy": ["PERSON_NAME"], "conversation_sessions.csResolvedBy": ["PERSON_NAME"],
  "gmail_thread_meta.flaggedBy": ["PERSON_NAME"], "issue_flags.flaggedBy": ["PERSON_NAME"], "issue_flags.flaggedByName": ["PERSON_NAME"],
  "issue_engine_timeline.actor": ["PERSON_NAME"], "job_issues.raisedByName": ["PERSON_NAME"], "sms_campaign_send_log.triggeredBy": ["PERSON_NAME"],
  "sms_campaigns.sentByName": ["PERSON_NAME"],
  // teams (often named after cleaners)
  "booking_assignments.teamName": ["TEAM_NAME"], "call_log.teamName": ["TEAM_NAME"], "cleaner_jobs.teamName": ["TEAM_NAME"],
  "cleaner_jobs.requestedTeam": ["TEAM_NAME"], "leadflow_jobs.teamName": ["TEAM_NAME"], "schedule_assignments.teamName": ["TEAM_NAME"],
  // addresses / contacts
  "candidates.apt": ["ADDRESS", "apartment number"], "invoiceTemplates.billTo": ["FREE_TEXT", "billing name and address"],
  "payable_invoice_deliveries.recipient": ["CONTACT", "email or phone of invoice recipient"],
  "ops_chat_reactions.callerId": ["CONTACT", "staff id or email"], "ops_chat_reads.callerId": ["CONTACT", "staff id or email"],
  "ops_reminders.callerId": ["CONTACT", "staff id or email"], "gmail_sender_policies.senderDomain": ["FREE_TEXT", "customer email domains"],
  // free text that can contain personal details
  "call_log.resolvedScript": ["FREE_TEXT", "call script filled in with customer details"], "candidates.experience": ["FREE_TEXT"],
  "candidates.specialties": ["FREE_TEXT"], "cleaner_jobs.customerComplaint": ["FREE_TEXT"], "follow_ups.nextStep": ["FREE_TEXT"],
  "follow_ups.customerFacingMove": ["FREE_TEXT"], "conversation_sessions.aiClosingRecCache": ["FREE_TEXT"],
  "field_mgmt_log.smsSent": ["FREE_TEXT", "text of an SMS that was sent"], "issue_engine_timeline.event": ["FREE_TEXT"],
  "openphone_call_recordings.scoreData": ["FREE_TEXT"], "openphone_call_recordings.callDebrief": ["FREE_TEXT"],
  "voice_calls.structuredData": ["FREE_TEXT", "data extracted from calls"], "callback_tasks.preferredCallbackTime": ["KEEP"],
  "activity_log.meta": ["JSON_EMPTY"], "ops_chat_messages.metadata": ["JSON_EMPTY"], "sms_campaigns.plannerResult": ["JSON_EMPTY"],
  "team_review_runs.progress": ["JSON_EMPTY"], "team_review_runs.publication": ["JSON_EMPTY"],
  // payment links / ids
  "invoiceTemplates.stripeLink": ["PAYMENT_REF"], "invoices.stripeLink": ["PAYMENT_REF"],
  "payable_invoice_attempts.sessionId": ["PAYMENT_REF"], "payable_invoice_attempts.paymentId": ["PAYMENT_REF"],
  "payable_invoice_allocations.paymentId": ["PAYMENT_REF"], "payable_invoices.tokenHash": ["SECRET", "payment link token"],
  // ids that can embed phone numbers or third-party ids (deterministic so unique keys still hold)
  "cs_missions.activeDedupKey": ["EXTERNAL_ID"], "ops_chat_messages.activeDedupKey": ["EXTERNAL_ID"],
  "conversation_sessions.gclid": ["EXTERNAL_ID", "Google ad click id"], "conversation_sessions.quoteSlug": ["EXTERNAL_ID", "public quote link"],
  "gmail_sent_log.agentOpenId": ["EXTERNAL_ID"],
  // corrections after reading back every pattern-assigned rule
  "candidates.scheduledCallAt": ["KEEP", "a date, not a coordinate"],
  "sms_campaign_recipients.snapshotPreferredTeam": ["TEAM_NAME"],
  "cleaner_jobs.photoAdjustment": ["KEEP", "pay adjustment, not a photo"],
  "cleaner_portal_job_photos.photoType": ["KEEP", "before/after label"], "job_photos.photoType": ["KEEP", "before/after label"],
  "missed_calls.phoneNumberLabel": ["KEEP", "label of the business line"],
  "sms_campaigns.testPhones": ["BLANK", "list of staff test numbers"],
  // pricing / business structure kept for realism (A2 leak check still scans inside)
  "bookings.extras": ["JSON_KEEP"], "bookings.priceSnapshot": ["JSON_KEEP"], "booking_funnel_records.extras": ["JSON_KEEP"],
  "booking_funnel_records.priceSnapshot": ["JSON_KEEP"], "customer_portal_service_requests.scopeSelections": ["JSON_KEEP"],
  "invoices.lineItems": ["JSON_KEEP"], "invoiceTemplates.lineItems": ["JSON_KEEP"],
  // more "will send later" state, neutralised
  "conversation_sessions.followUpSent": ["NEUTRALIZE", "scheduled follow-up must not send"],
  "conversation_sessions.autoFollowUpSent": ["NEUTRALIZE", "automatic follow-up must not send"],
  "conversation_sessions.madisonDeferredUntil": ["NEUTRALIZE", "deferred AI reply must not send"],
  "inbound_sms.processingStatus": ["NEUTRALIZE", "unprocessed inbound texts must not be processed"],
  // storage keys of real photos
  "cleaner_portal_job_photos.thumbnailKey": ["MEDIA_URL"], "cleaner_portal_job_photos.filename": ["MEDIA_URL"],
  "job_photos.thumbnailKey": ["MEDIA_URL"], "job_photos.filename": ["MEDIA_URL"],
};
// Business wording (templates, scripts, labels, codes, hashes): no customer data; kept so staging behaves realistically.
// Phone/email-like text inside them is still caught by the A2 leak check.
const TEMPLATE_KEEP = new Set(`ai_action_policies.label ai_action_policies.description ai_call_templates.title ai_call_templates.body
always_on_groups.description always_on_groups.messageTemplate app_settings.label app_settings.description campaign_approval_batches.messageTemplate
campaign_blasts.campaignTitle campaign_blasts.batchLabel cleaner_job_custom_rules.appliedLabel custom_pay_rules.label custom_pay_rules.description
message_templates.label message_templates.triggerLabel message_templates.body nurture_step_scripts.body reactivation_campaigns.messageTemplate
response_templates.title response_templates.description response_templates.message sms_campaigns.messageTemplate scheduling_teams.tag
scheduling_teams.regionTags confirmation_calls.aiOutcomeLabel confirmation_calls.manualOutcomeLabel madison_email_drafts.messageType
madison_email_drafts.errorStage madison_email_drafts.errorCode madison_sms_drafts.messageType madison_sms_drafts.errorStage madison_sms_drafts.errorCode
call_log.transcriptLanguage conversation_sessions.csPriorityTag conversation_sessions.aiSummaryHash payable_invoices.payloadHash
payable_invoice_deliveries.payloadHash payable_invoice_manual_payments.payloadHash`.split(/\s+/).filter(Boolean));
// Every other first-pass REVIEW column was checked by hand and is business data
// (statuses, dates, prices stored as text, service names, enums, settings, template text).
const REVIEWED_KEEP = new Set(`app_versioned_migration_ledger.migration_id app_versioned_migration_ledger.sha256 app_versioned_migration_ledger.state activity_log.eventType agents.pagePermissions agents.awayStatus ai_action_policies.merchantId ai_action_policies.actionKey
ai_action_policies.category ai_action_policies.mode ai_call_templates.scenario ai_call_templates.audience always_on_enrollments.frequency
always_on_enrollments.jobDate always_on_groups.groupType always_on_groups.name app_settings.key app_settings.fieldType booking_assignments.status
booking_cash_app_payments.idempotencyKey booking_cash_app_payments.currency booking_cash_app_payments.status booking_cash_app_payments.cardBrand
booking_cash_app_payments.failureCode booking_funnel_records.publicFunnelNumber booking_funnel_records.idempotencyKey booking_funnel_records.commandHash
booking_funnel_records.source booking_funnel_records.stage booking_funnel_records.serviceId booking_funnel_records.serviceName
booking_funnel_records.requestedLocalDate booking_funnel_records.requestedLocalTime booking_funnel_records.requestedTimeZone booking_funnel_records.recurrence
booking_funnel_records.pricingVersion booking_funnel_records.paymentBrand booking_notification_deliveries.channel booking_payment_profiles.paymentStatus
booking_payment_profiles.cardBrand booking_payment_profiles.consentVersion booking_payment_profiles.failureCode booking_series.status booking_series.frequency
booking_series.anchorLocalDate booking_series.anchorLocalTime booking_series.timeZone bookings.publicBookingNumber bookings.idempotencyKey bookings.commandHash
bookings.source bookings.status bookings.availabilityStatus bookings.assignmentStatus bookings.paymentStatus bookings.serviceId bookings.serviceName
bookings.requestedLocalDate bookings.requestedLocalTime bookings.requestedTimeZone bookings.recurrence bookings.recurringIntentStatus bookings.pricingVersion
bookings.homeType bookings.manualAmountOverrides call_log.calledTarget call_log.templateName call_log.status call_log.jobDate call_templates.name
call_templates.triggerType call_templates.targetType call_templates.scriptTemplate campaign_approval_batches.groupType campaign_approval_batches.groupName
campaign_approval_batches.enrollmentIds campaign_blasts.campaignType campaign_blasts.script candidates.city candidates.state candidates.zip candidates.stage
channel_pins.channel chat_super_alerts.channel cleaner_job_custom_rules.appliedType cleaner_jobs.jobDate cleaner_jobs.serviceDateTime cleaner_jobs.serviceType
cleaner_jobs.extras cleaner_jobs.frequency cleaner_jobs.bookingStatus cleaner_jobs.jobRevenue cleaner_jobs.payPercent cleaner_jobs.basePay
cleaner_jobs.ratingAdjustment cleaner_jobs.streakBonus cleaner_jobs.finalPay cleaner_jobs.manualAdjustment cleaner_jobs.recleanPenalty
cleaner_jobs.googleReviewBonus cleaner_jobs.jobStatus cleaner_jobs.etaSource cleaner_jobs.etaTimeStr cleaner_jobs.checklistItems cleaner_jobs.reviewChipsSelected
cleaner_jobs.paymentBrand cleaner_portal_job_progress.jobStatus cleaner_portal_job_progress.etaTimeStr cleaner_profiles.payPercent cleaner_profiles.language
completed_job_batches.filename completed_job_batches.jobDate completed_jobs.serviceType completed_jobs.frequency completed_jobs.launch27BookingId
completed_jobs.jobDate completed_jobs.status confirmation_calls.jobDate confirmation_calls.aiOutcome confirmation_calls.aiFlexibility
confirmation_calls.manualOutcome conversation_sessions.stage conversation_sessions.quotedPrice conversation_sessions.serviceType conversation_sessions.bedrooms
conversation_sessions.bathrooms conversation_sessions.callPreference conversation_sessions.utmSource conversation_sessions.utmMedium
conversation_sessions.utmCampaign conversation_sessions.leadSource conversation_sessions.followUpDate conversation_sessions.language
conversation_sessions.preLangStage conversation_sessions.smsFlow conversation_sessions.csQueue conversation_sessions.csStatusTier cs_missions.emoji
cs_missions.status cs_missions.missionType custom_pay_rules.type customer_portal_service_requests.publicRequestNumber customer_portal_service_requests.serviceId
customer_portal_service_requests.serviceName customer_portal_service_requests.status customer_portal_service_requests.requestedLocalDate
customer_portal_service_requests.requestedLocalTime customer_portal_service_requests.paymentBrand field_mgmt_calls.step field_mgmt_calls.outcome
field_mgmt_log.step field_mgmt_log.deliveryStatus focus_points.weekStart follow_ups.type follow_ups.priority gmail_thread_meta.aiCategory
gmail_thread_meta.aiUrgency gmail_thread_meta.aiStatus inbound_sms.processingStatus inbound_sms.extractedIntent inbound_sms.extractedFlexibility
invoice_stripe_links.stripeInvoiceStatus invoices.serviceDate invoices.billingDate issue_comments.issue_key issue_comments.type issue_engine.issueType
issue_engine.severity issue_engine.waitingOn issue_ownership.issueKey job_alerts.alertType job_issues.jobDate job_issues.issueType job_issues.raisedBy
job_sms_replies.senderType job_sms_replies.deliveryStatus job_status_history.status job_status_history.source lead_call_logs.outcome
lead_notification_deliveries.channel leadflow_booking_messages.senderRole leadflow_booking_messages.notificationStatus leadflow_jobs.origin leadflow_jobs.jobDate
leadflow_jobs.serviceDateTime leadflow_jobs.serviceName leadflow_jobs.extras leadflow_jobs.frequency leadflow_jobs.bookingStatus leadflow_jobs.paymentBrand
leadflow_jobs.reviewChipsSelected madison_email_drafts.intent madison_email_drafts.capability madison_sms_drafts.senderType madison_sms_drafts.intent
madison_sms_drafts.capability madison_sms_drafts.sendPolicyMode message_templates.flowType message_templates.stepKey message_templates.variables
nurture_enrollments.serviceType openphone_call_recordings.direction openphone_call_recordings.status ops_chat_messages.channel ops_chat_messages.authorRole
ops_chat_messages.quickAction ops_chat_messages.dmThread ops_chat_messages.cardStatus ops_chat_reactions.emoji ops_chat_reads.channel ops_reminders.channel
ops_tasks.priority payable_invoice_allocations.attemptId payable_invoice_attempts.id payable_invoice_attempts.requestId payable_invoice_attempts.selectedLineIds
payable_invoice_attempts.currency payable_invoice_deliveries.requestId payable_invoice_lines.sourceServiceId payable_invoice_lines.occurrenceKey
payable_invoice_lines.serviceDate payable_invoice_manual_payments.occurrenceKey payable_invoice_manual_payments.sourceServiceId
payable_invoice_manual_payments.serviceDate payable_invoice_manual_payments.requestId payable_invoice_manual_payments.reviewHash payable_invoices.number
payable_invoices.periodFrom payable_invoices.periodTo payable_invoices.dueDate payable_invoices.currency payable_invoices.status payable_invoices.requestId
payable_invoices.reviewHash payable_invoices.activeAttemptId payment_authorizations.currency payment_authorizations.operation public_review_responses.key
quote_leads.serviceType quote_leads.bedrooms quote_leads.bathrooms quote_leads.extras rating_sms_pending.jobDate reactivation_campaigns.name
reactivation_campaigns.segment reactivation_campaigns.sourceType reactivation_contacts.lastBookingDate reactivation_contacts.segment
readiness_acknowledgements.jobId readiness_acknowledgements.issueType readiness_acknowledgements.actionId response_templates.category
schedule_assignments.jobDate scheduling_teams.skills scheduling_teams.color scheduling_teams.earliestStartTime sms_campaign_recipients.snapshotLastService
sms_campaign_recipients.snapshotCity sms_campaign_recipients.snapshotFrequency sms_campaign_send_log.action sms_campaigns.name sms_campaigns.audienceDefinition
sms_campaigns.definitionHash sms_opt_outs.source stripe_customers.cardBrand team_availability_checkins.submittedForDate team_availability_checkins.availabilityDate
team_day_config.date team_day_config.earliestStartTime team_day_override.date team_day_unavailability.date team_review_runs.id team_review_runs.weekStart
team_review_runs.status team_review_weeks.weekStart team_review_weeks.latestPublicationId twilio_lead_bridges.bridgeId twilio_lead_bridges.idempotencyKey
twilio_lead_bridges.failureCode voice_calls.outcome voice_calls.successEvaluation`.split(/\s+/).filter(Boolean));

// ---- Name/type patterns (first match wins) --------------------------------------------------
const isString = t => /char|text|enum|set/.test(t);
const PATTERNS = [
  [/(^|_)(ip|ipAddress|userAgent|deviceId|endpoint)$/i, () => "NETWORK_ID"],
  [/password|passwordHash|token$|Token$|secret|^otp|Otp|codeHash|loginCode|accessToken|refreshToken|apiKey|authCode|verificationCode|magic/i, () => "SECRET"],
  [/^(lat|lng|latitude|longitude)$|[a-z](Lat|Lng|Latitude|Longitude)$/, () => "GEO_ROUND"],
  [/last4$/i, () => "CARD_LAST4"],
  [/stripe\w*Id$|paymentMethodId$|paymentIntentId$|setupIntentId$|chargeId$|checkoutSessionId$|^cashtag$|cashApp\w*Id$|receiptUrl$/i, () => "PAYMENT_REF"],
  [/openPhone\w*Id$|phoneNumberId$|messageId$|^callId$|\w+CallId$|callSid$|\w+Sid$|vapi\w*Id$|threadId$|historyId$|gmail\w*Id$|negotiation\w*Id$|negotiationID$|thumbtack\w*Id$|webhook\w*Id$|externalId$|providerId$|recordingId$|assistantId$|inboundOpenPhoneId$|conversationId$/i,
    (c, t) => (isString(t) ? "EXTERNAL_ID" : "KEEP")],
  [/url$|Url$|recording|photo|image|video|attachment|avatar|media/i, (c, t) => (isString(t) ? "MEDIA_URL" : "KEEP")],
  [/phone|^from$|^to$|fromNumber|toNumber|callerNumber|msisdn|caller$|callee$/i, (c, t) => (isString(t) ? "PHONE" : "KEEP")],
  [/email(Address)?$|^email|recipientEmail|toEmail|fromEmail|senderEmail/i, (c, t) => (isString(t) && !/subject|body|id$|count|status|draft|sent|enabled/i.test(c) ? "EMAIL" : null)],
  [/address$|street|address1|address2|jobAddress|serviceAddress/i, (c, t) => (isString(t) ? "ADDRESS" : "KEEP")],
  [/(customer|lead|cleaner|agent|contact|sender|recipient|applicant|candidate|caller|owner|assignee|assigned\w*|created|updated|action|reviewer|author|claimed|resolved|booked|lastCalled\w*|dismissed|completed|approved|rejected|requested|reporter|from|to|display|first|last|full|user|staff|employee|manager)(By)?(Name|_name)$/i,
    (c, t) => (isString(t) ? "PERSON_NAME" : "KEEP")],
  [/^(firstName|lastName|fullName|name)$/i, (c, t) => (isString(t) ? "REVIEW" : "KEEP")],
  [/^(createdBy|updatedBy|actionBy|resolvedBy|claimedBy|assignedTo|reviewedBy|approvedBy|requestedBy|sentBy|dismissedBy|completedBy|ownerEmail|by)$/i,
    (c, t) => (isString(t) ? "PERSON_NAME" : "KEEP")],
  [/history|message|content|body|notes?$|Notes$|transcript|summary|Summary|text$|Text$|draft|Draft|comment|reply|Reply|replies|reason|Reason|description|instructions|feedback|snippet|subject|preview|html|error|Error|question|answer|response|Response|prompt|observation|evidence|explanation|rationale|detail|Details?$|memo|caption|label$|tags?$|context|Context|request$|issue$|entry$|payload|rawPayload|raw\w*$|title$/i,
    (c, t) => (isString(t) ? "FREE_TEXT" : "KEEP")],
];

function classify(table, col, type, isJson) {
  if (TRUNCATE[table]) return ["TRUNCATE_TABLE", TRUNCATE[table]];
  const key = `${table}.${col}`;
  if (OVERRIDES[key]) return OVERRIDES[key];
  if (NEUTRALIZE_TABLES.has(table) && NEUTRALIZE_COL.test(col)) return ["NEUTRALIZE", "pending/queue state"];
  if (REVIEWED_KEEP.has(key)) return ["KEEP", "checked by hand: business data"];
  if (TEMPLATE_KEEP.has(key)) return ["KEEP", "business template/label/code: no customer data"];
  if (isJson) return ["JSON_EMPTY", "structured data that may embed personal details"];
  for (const [re, fn] of PATTERNS) if (re.test(col)) { const r = fn(col, type); if (r) return [r, ""]; }
  if (!isString(type)) return ["KEEP", ""];
  return ["REVIEW", "no rule matched"];
}

const json = new Set(fs.readFileSync(jsonColsPath, "utf8").trim().split("\n").map(l => l.split("\t").join(".")));
const rows = fs.readFileSync(inventoryPath, "utf8").trim().split("\n").map(l => l.split("\t"));
const out = ["table\tcolumn\tcolumn_type\trule\tnote\tnullable"];
const counts = {};
for (const [table, col, columnType, dataType, isNullable] of rows) {
  const [rule, note] = classify(table, col, dataType, json.has(`${table}.${col}`));
  counts[rule] = (counts[rule] || 0) + 1;
  out.push([table, col, columnType, rule, note || "", isNullable].join("\t"));
}
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, out.join("\n") + "\n");
console.log(`columns: ${rows.length}`);
for (const r of Object.keys(RULES).concat(["REVIEW"])) if (counts[r]) console.log(`${r.padEnd(15)} ${counts[r]}`);
