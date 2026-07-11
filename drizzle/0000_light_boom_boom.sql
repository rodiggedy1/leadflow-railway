CREATE TABLE `activity_log` (
	`id` int AUTO_INCREMENT NOT NULL,
	`eventType` enum('lead_reply','ai_sms_sent','silence_nudge','scheduled_followup','always_on_batch','nightly_sync','review_send','booking','new_lead') NOT NULL,
	`title` varchar(255) NOT NULL,
	`body` text,
	`meta` text,
	`readAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `activity_log_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `agents` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(255) NOT NULL,
	`email` varchar(320) NOT NULL,
	`passwordHash` varchar(255) NOT NULL,
	`isActive` int NOT NULL DEFAULT 1,
	`isAdmin` int NOT NULL DEFAULT 0,
	`pagePermissions` text,
	`profilePhotoUrl` varchar(1024),
	`lastSeenAt` timestamp,
	`awayStatus` varchar(32),
	`awaySetAt` timestamp,
	`openPhoneUserId` varchar(128),
	`openPhoneNumberId` varchar(128),
	`onCallSince` bigint,
	`onCallCallId` varchar(128),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `agents_id` PRIMARY KEY(`id`),
	CONSTRAINT `agents_email_unique` UNIQUE(`email`)
);
--> statement-breakpoint
CREATE TABLE `ai_call_templates` (
	`id` int AUTO_INCREMENT NOT NULL,
	`scenario` varchar(64) NOT NULL,
	`audience` varchar(16) NOT NULL,
	`title` varchar(128) NOT NULL,
	`body` text NOT NULL,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `ai_call_templates_id` PRIMARY KEY(`id`),
	CONSTRAINT `idx_act_scenario_audience` UNIQUE(`scenario`,`audience`)
);
--> statement-breakpoint
CREATE TABLE `ai_insights_cache` (
	`id` int AUTO_INCREMENT NOT NULL,
	`rangeKey` varchar(10) NOT NULL,
	`payload` text NOT NULL,
	`generatedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `ai_insights_cache_id` PRIMARY KEY(`id`),
	CONSTRAINT `ai_insights_cache_rangeKey_unique` UNIQUE(`rangeKey`)
);
--> statement-breakpoint
CREATE TABLE `always_on_enrollments` (
	`id` int AUTO_INCREMENT NOT NULL,
	`groupId` int NOT NULL,
	`completedJobId` int NOT NULL,
	`phone` varchar(20) NOT NULL,
	`firstName` varchar(100),
	`name` varchar(255),
	`frequency` varchar(100),
	`lastBookingPrice` int,
	`discountPct` int NOT NULL DEFAULT 10,
	`status` enum('PENDING','SENT','REPLIED','BOOKED','OPTED_OUT','SKIPPED') NOT NULL DEFAULT 'PENDING',
	`sentAt` timestamp,
	`repliedAt` timestamp,
	`sessionId` int,
	`jobDate` varchar(20),
	`openPhoneMessageId` varchar(100),
	`enrolledAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `always_on_enrollments_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `always_on_groups` (
	`id` int AUTO_INCREMENT NOT NULL,
	`groupType` varchar(30) NOT NULL,
	`name` varchar(100) NOT NULL,
	`description` text,
	`isActive` int NOT NULL DEFAULT 1,
	`messageTemplate` text NOT NULL,
	`batchSize` int NOT NULL DEFAULT 25,
	`totalEnrolled` int NOT NULL DEFAULT 0,
	`sentCount` int NOT NULL DEFAULT 0,
	`repliedCount` int NOT NULL DEFAULT 0,
	`bookedCount` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `always_on_groups_id` PRIMARY KEY(`id`),
	CONSTRAINT `always_on_groups_groupType_unique` UNIQUE(`groupType`)
);
--> statement-breakpoint
CREATE TABLE `app_settings` (
	`id` int AUTO_INCREMENT NOT NULL,
	`key` varchar(100) NOT NULL,
	`value` text NOT NULL,
	`label` varchar(200) NOT NULL,
	`description` text,
	`fieldType` varchar(20) NOT NULL DEFAULT 'text',
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `app_settings_id` PRIMARY KEY(`id`),
	CONSTRAINT `app_settings_key_unique` UNIQUE(`key`)
);
--> statement-breakpoint
CREATE TABLE `call_log` (
	`id` int AUTO_INCREMENT NOT NULL,
	`cleanerJobId` int,
	`teamId` int,
	`teamName` varchar(255),
	`clientName` varchar(255),
	`calledPhone` varchar(30),
	`calledTarget` enum('team','client') NOT NULL,
	`templateId` int,
	`templateName` varchar(255),
	`resolvedScript` text NOT NULL,
	`status` enum('pending','fired','completed','failed','no_answer') NOT NULL DEFAULT 'pending',
	`vapiCallId` varchar(128),
	`recordingUrl` varchar(1024),
	`transcript` longtext,
	`transcriptLanguage` varchar(10),
	`transcriptEnglish` longtext,
	`jobDate` varchar(20),
	`firedBy` varchar(64),
	`firedAt` bigint,
	`completedAt` bigint,
	`durationSeconds` int,
	`notes` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `call_log_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `call_templates` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(255) NOT NULL,
	`triggerType` enum('arrival_confirmation','late_team','no_access','parking','delay_update','checkin_reminder','lockout_warning','lockout_final','utility_issue','completion_walkthrough','manual') NOT NULL,
	`targetType` enum('team','client','both') NOT NULL,
	`scriptTemplate` text NOT NULL,
	`isActive` int NOT NULL DEFAULT 1,
	`sortOrder` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `call_templates_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `callback_tasks` (
	`id` int AUTO_INCREMENT NOT NULL,
	`voiceCallId` int,
	`sessionId` int,
	`callerPhone` varchar(30) NOT NULL,
	`callerName` varchar(128),
	`preferredCallbackTime` varchar(255),
	`notes` text,
	`completed` int NOT NULL DEFAULT 0,
	`completedByAgentName` varchar(128),
	`completedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `callback_tasks_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `campaign_approval_batches` (
	`id` int AUTO_INCREMENT NOT NULL,
	`groupId` int NOT NULL,
	`groupType` varchar(30) NOT NULL,
	`groupName` varchar(100) NOT NULL,
	`messageTemplate` text NOT NULL,
	`enrollmentIds` text NOT NULL,
	`recipientCount` int NOT NULL,
	`recipientPreview` text NOT NULL,
	`status` enum('pending','approved','rejected','sent') NOT NULL DEFAULT 'pending',
	`reviewedBy` varchar(255),
	`rejectionReason` varchar(500),
	`sentCount` int NOT NULL DEFAULT 0,
	`failedCount` int NOT NULL DEFAULT 0,
	`reviewedAt` timestamp,
	`sentAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `campaign_approval_batches_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `campaign_blasts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`campaignType` varchar(50) NOT NULL,
	`campaignTitle` varchar(200) NOT NULL,
	`batchLabel` varchar(100),
	`recipientCount` int NOT NULL,
	`sentCount` int NOT NULL DEFAULT 0,
	`failedCount` int NOT NULL DEFAULT 0,
	`script` text,
	`startedAt` timestamp,
	`firedAt` timestamp NOT NULL DEFAULT (now()),
	`firedBy` varchar(255) DEFAULT 'admin',
	CONSTRAINT `campaign_blasts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `candidates` (
	`id` int AUTO_INCREMENT NOT NULL,
	`firstName` varchar(128) NOT NULL,
	`lastName` varchar(128) NOT NULL,
	`email` varchar(320),
	`phone` varchar(30) NOT NULL,
	`streetAddress` varchar(255),
	`apt` varchar(64),
	`city` varchar(128),
	`state` varchar(8),
	`zip` varchar(16),
	`hasCleaning` tinyint,
	`hasBankAccount` tinyint,
	`isAuthorized` tinyint,
	`consentBackground` tinyint,
	`experience` text,
	`specialties` text,
	`stage` varchar(64) NOT NULL DEFAULT 'Application Submitted',
	`bioPhotoUrl` text,
	`videoUrl` text,
	`interviewVideoUrl` text,
	`aiScore` int,
	`aiSummary` text,
	`interviewCallId` varchar(128),
	`interviewTranscript` longtext,
	`interviewScore` int,
	`interviewSummary` text,
	`statusToken` varchar(64),
	`scheduledCallAt` timestamp,
	`archived` tinyint NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `candidates_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `card_auth_tokens` (
	`id` int AUTO_INCREMENT NOT NULL,
	`token` varchar(64) NOT NULL,
	`customerPhone` varchar(30) NOT NULL,
	`customerName` varchar(255),
	`jobDate` varchar(64),
	`jobAddress` varchar(512),
	`cleanerJobId` int,
	`used` tinyint NOT NULL DEFAULT 0,
	`expiresAt` bigint NOT NULL,
	`completedAt` bigint,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `card_auth_tokens_id` PRIMARY KEY(`id`),
	CONSTRAINT `card_auth_tokens_token_unique` UNIQUE(`token`)
);
--> statement-breakpoint
CREATE TABLE `channel_pins` (
	`id` int AUTO_INCREMENT NOT NULL,
	`channel` varchar(64) NOT NULL,
	`body` text NOT NULL,
	`authorName` varchar(128) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`dismissedAt` timestamp,
	CONSTRAINT `channel_pins_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `chat_super_alerts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`messageId` int NOT NULL,
	`channel` varchar(64) NOT NULL DEFAULT 'command',
	`targetAgentName` varchar(255) NOT NULL,
	`senderName` varchar(255) NOT NULL,
	`messageBody` text NOT NULL,
	`repliedAt` bigint,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `chat_super_alerts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `cleaner_job_custom_rules` (
	`id` int AUTO_INCREMENT NOT NULL,
	`cleanerJobId` int NOT NULL,
	`customPayRuleId` int NOT NULL,
	`appliedAmount` decimal(8,2) NOT NULL,
	`appliedLabel` varchar(128) NOT NULL,
	`appliedType` varchar(16) NOT NULL,
	`appliedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `cleaner_job_custom_rules_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `cleaner_jobs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`completedJobId` int NOT NULL,
	`bookingId` int,
	`cleanerProfileId` int NOT NULL,
	`cleanerName` varchar(255) NOT NULL,
	`teamName` varchar(255),
	`teamId` int,
	`jobDate` varchar(20) NOT NULL,
	`serviceDateTime` varchar(50),
	`customerName` varchar(255),
	`customerPhone` varchar(30),
	`jobAddress` varchar(500),
	`serviceType` varchar(500),
	`bedrooms` int,
	`bathrooms` int,
	`extras` text,
	`frequency` varchar(100),
	`bookingStatus` varchar(50),
	`customerNotes` text,
	`staffNotes` text,
	`jobRevenue` varchar(20),
	`payPercent` varchar(10),
	`basePay` varchar(20),
	`customerRating` int,
	`missedSomething` int,
	`photoSubmitted` int NOT NULL DEFAULT 0,
	`ratingAdjustment` varchar(20),
	`photoAdjustment` varchar(20),
	`streakBonus` varchar(20),
	`finalPay` varchar(20),
	`manualAdjustment` varchar(20),
	`manualAdjustmentNote` varchar(255),
	`recleanPenalty` varchar(20),
	`googleReviewBonus` varchar(20),
	`jobStatus` enum('on_the_way','arrived','running_late','in_progress','finishing_up','wrapping_up','completed','issue_at_property'),
	`issueNote` text,
	`etaTimestamp` bigint,
	`etaConfidence` int,
	`etaSource` varchar(32),
	`etaCallFiredAt` timestamp,
	`etaVerifiedAt` timestamp,
	`flagged` int NOT NULL DEFAULT 0,
	`adminNotes` text,
	`checklistItems` text,
	`trackerToken` varchar(64),
	`trackerSmsSentAt` timestamp,
	`delayMinutes` int,
	`completedAt` timestamp,
	`reviewChipsSelected` text,
	`reviewDraftPicked` int,
	`reviewDraftText` text,
	`reviewCopied` int NOT NULL DEFAULT 0,
	`noEtaArrival` int NOT NULL DEFAULT 0,
	`customerComplaint` text,
	`complaintChargeApplied` int NOT NULL DEFAULT 0,
	`scheduleConfirmed` int NOT NULL DEFAULT 0,
	`requestedTeam` varchar(255),
	`signatureUrl` varchar(1000),
	`customerResponse` varchar(50),
	`customerNotHome` tinyint NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `cleaner_jobs_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_cleaner_jobs_booking_profile` UNIQUE(`bookingId`,`cleanerProfileId`)
);
--> statement-breakpoint
CREATE TABLE `cleaner_magic_link_tokens` (
	`id` int AUTO_INCREMENT NOT NULL,
	`cleanerProfileId` int NOT NULL,
	`token` varchar(128) NOT NULL,
	`expiresAt` timestamp NOT NULL,
	`used` tinyint NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `cleaner_magic_link_tokens_id` PRIMARY KEY(`id`),
	CONSTRAINT `cleaner_magic_link_tokens_token_unique` UNIQUE(`token`)
);
--> statement-breakpoint
CREATE TABLE `cleaner_profiles` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(255) NOT NULL,
	`phone` varchar(20),
	`email` varchar(320),
	`payPercent` varchar(10),
	`isActive` int NOT NULL DEFAULT 1,
	`passwordHash` varchar(255),
	`language` varchar(5) NOT NULL DEFAULT 'en',
	`launch27TeamId` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `cleaner_profiles_id` PRIMARY KEY(`id`),
	CONSTRAINT `cleaner_profiles_launch27TeamId_unique` UNIQUE(`launch27TeamId`)
);
--> statement-breakpoint
CREATE TABLE `cleaner_rating_sms_log` (
	`id` int AUTO_INCREMENT NOT NULL,
	`cleanerPhone` varchar(20) NOT NULL,
	`cleanerJobId` int NOT NULL,
	`cleanerName` varchar(255),
	`rating` int NOT NULL,
	`sentAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `cleaner_rating_sms_log_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `cleaner_streaks` (
	`id` int AUTO_INCREMENT NOT NULL,
	`cleanerProfileId` int NOT NULL,
	`currentStreak` int NOT NULL DEFAULT 0,
	`bestStreak` int NOT NULL DEFAULT 0,
	`streakBonusCount` int NOT NULL DEFAULT 0,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `cleaner_streaks_id` PRIMARY KEY(`id`),
	CONSTRAINT `cleaner_streaks_cleanerProfileId_unique` UNIQUE(`cleanerProfileId`)
);
--> statement-breakpoint
CREATE TABLE `command_center_cache` (
	`id` int AUTO_INCREMENT NOT NULL,
	`cacheKey` varchar(50) NOT NULL,
	`rangeKey` varchar(10) NOT NULL DEFAULT 'none',
	`payload` text NOT NULL,
	`generatedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `command_center_cache_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `completed_job_batches` (
	`id` int AUTO_INCREMENT NOT NULL,
	`filename` varchar(255) NOT NULL,
	`jobDate` varchar(20),
	`totalCount` int NOT NULL DEFAULT 0,
	`sentCount` int NOT NULL DEFAULT 0,
	`positiveCount` int NOT NULL DEFAULT 0,
	`negativeCount` int NOT NULL DEFAULT 0,
	`reviewConfirmedCount` int NOT NULL DEFAULT 0,
	`uploadedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `completed_job_batches_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `completed_jobs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`batchId` int NOT NULL,
	`phone` varchar(20) NOT NULL,
	`name` varchar(255),
	`firstName` varchar(100),
	`email` varchar(320),
	`address` varchar(500),
	`serviceType` varchar(100),
	`frequency` varchar(100),
	`launch27BookingId` varchar(64),
	`bedrooms` int,
	`bathrooms` int,
	`lastBookingPrice` int,
	`jobDate` varchar(20),
	`status` enum('PENDING','SENT','REPLIED_POSITIVE','REPLIED_NEGATIVE','REVIEW_CONFIRMED','OPTED_OUT') NOT NULL DEFAULT 'PENDING',
	`smsSentAt` timestamp,
	`repliedAt` timestamp,
	`sessionId` int,
	`reactivationEligible` int NOT NULL DEFAULT 0,
	`reactivationEligibleAt` timestamp,
	`reviewSkipped` int NOT NULL DEFAULT 0,
	`phoneInvalid` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `completed_jobs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `confirmation_calls` (
	`id` int AUTO_INCREMENT NOT NULL,
	`cleanerJobId` int NOT NULL,
	`jobDate` varchar(20) NOT NULL,
	`clientName` varchar(255),
	`calledPhone` varchar(30) NOT NULL,
	`status` enum('pending','fired','completed','failed','no_answer') NOT NULL DEFAULT 'pending',
	`vapiCallId` varchar(128),
	`recordingUrl` varchar(1024),
	`transcript` longtext,
	`summary` text,
	`endedReason` varchar(100),
	`durationSeconds` int,
	`firedBy` varchar(64),
	`firedAt` bigint,
	`completedAt` bigint,
	`aiOutcome` varchar(32),
	`aiFlexibility` varchar(32),
	`aiNotes` text,
	`aiOutcomeLabel` varchar(128),
	`manualOutcome` varchar(32),
	`manualOutcomeLabel` varchar(128),
	`manualOverrideBy` varchar(64),
	`manualOverrideAt` bigint,
	`smsFollowupSent` tinyint NOT NULL DEFAULT 0,
	`smsFollowupAt` bigint,
	`smsFollowupBody` text,
	`smsReply` text,
	`sms_replies` json,
	`smsConfirmedAt` bigint,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `confirmation_calls_id` PRIMARY KEY(`id`),
	CONSTRAINT `confirmation_calls_vapiCallId_unique` UNIQUE(`vapiCallId`)
);
--> statement-breakpoint
CREATE TABLE `conversation_sessions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`leadPhone` varchar(30) NOT NULL,
	`leadName` varchar(255),
	`stage` enum('WIDGET_SIZING','REACTIVATION','REACTIVATION_TIME','QUOTE_SENT','AVAILABILITY','SLOT_CHOICE','TIME_PREF','ADDRESS','CONFIRMATION','CALL_SCHEDULED','DONE','RESOLVED','UNHANDLED','BOOKED','NOT_INTERESTED','REVIEW_REQUESTED','REVIEW_DONE','FUTURE_BOOKING','FOLLOW_UP_SCHEDULED','LANGUAGE_CONFIRM','QUALITY_RATING_REQUESTED','QUALITY_MISSED_FOLLOWUP','QUALITY_RATING_DONE','REVIEW_REBOOKING_REQUESTED','REVIEW_REBOOKING_DONE','COLD','LOST','VOICEMAIL','YELP_CONTACTED','INTERVIEW_LINK_SENT','INTERVIEW_NUDGE_1','INTERVIEW_NUDGE_2','INTERVIEW_LINK_DONE','OPEN','HIRING_OUTBOUND','FLOWC_ADDON','FLOWC_DATE','FLOWC_NOTES','FLOWC_QUOTE_SENT','SCHEDULE_CONFIRM_SENT','SCHEDULE_CONFIRM_DONE','CLIENT_STATUS_INQUIRY','CLIENT_STATUS_INQUIRY_DONE') NOT NULL DEFAULT 'QUOTE_SENT',
	`quotedPrice` varchar(20),
	`serviceType` varchar(100),
	`bedrooms` varchar(50),
	`bathrooms` varchar(50),
	`extras` text,
	`selectedSlot` varchar(100),
	`address` text,
	`callPreference` varchar(50),
	`messageHistory` mediumtext NOT NULL,
	`quoteLeadId` int,
	`quoteSlug` varchar(255),
	`assignedAgentId` int,
	`assignedAgentName` varchar(255),
	`lastCalledAt` timestamp,
	`lastCalledByAgentId` int,
	`lastCalledByAgentName` varchar(255),
	`isBooked` int NOT NULL DEFAULT 0,
	`bookedAt` timestamp,
	`bookedByAgentId` int,
	`bookedByAgentName` varchar(255),
	`internalNotes` text,
	`aiMode` int NOT NULL DEFAULT 1,
	`bookedAmount` int,
	`utmSource` varchar(100),
	`utmMedium` varchar(100),
	`utmCampaign` varchar(255),
	`utmContent` varchar(255),
	`gclid` varchar(255),
	`leadSource` varchar(50),
	`reactivationLastPrice` int,
	`reactivationDiscountPct` int,
	`barkQA` text,
	`lastAiMessageAt` timestamp,
	`autoFollowUpSent` int NOT NULL DEFAULT 0,
	`followUpDate` varchar(20),
	`followUpMessage` text,
	`followUpSent` int NOT NULL DEFAULT 0,
	`nudgeCount` int NOT NULL DEFAULT 0,
	`lostReason` varchar(50),
	`language` varchar(10) NOT NULL DEFAULT 'en',
	`preLangStage` varchar(50),
	`smsOptOut` int NOT NULL DEFAULT 0,
	`smsFlow` varchar(5) DEFAULT 'B',
	`lastProcessedMessageId` varchar(100),
	`csResolvedAt` bigint,
	`csQueue` varchar(32),
	`aiClosingRecCache` text,
	`aiClosingRecCachedAt` timestamp,
	`aiClosingRecMsgLen` int,
	`csPriorityTag` varchar(32),
	`csPriorityReason` varchar(200),
	`csPriorityTaggedAt` bigint,
	`csPriorityDismissedAt` bigint,
	`csMemoryCache` text,
	`csMemoryCachedMsgLen` int,
	`csStatusTier` varchar(32),
	`csStatusTieredAt` bigint,
	`csStatusMsgLen` int,
	`aiSummary` varchar(100),
	`aiSummaryHash` varchar(64),
	`preferredDates` text,
	`specialNotes` text,
	`respondedAt` bigint,
	`lastReadAt` bigint,
	`lastCustomerReplyAt` bigint,
	`lastMessageText` varchar(255),
	`lastMessageTs` bigint,
	`lastCustomerMessageTs` bigint,
	`lastMessageRole` varchar(16),
	`messageCount` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `conversation_sessions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `cron_heartbeats` (
	`id` int AUTO_INCREMENT NOT NULL,
	`jobName` varchar(50) NOT NULL,
	`resultSummary` varchar(500),
	`didWork` int NOT NULL DEFAULT 0,
	`ranAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `cron_heartbeats_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `custom_pay_rules` (
	`id` int AUTO_INCREMENT NOT NULL,
	`label` varchar(128) NOT NULL,
	`type` varchar(16) NOT NULL DEFAULT 'bonus',
	`amount` decimal(8,2) NOT NULL,
	`description` varchar(256),
	`isActive` tinyint NOT NULL DEFAULT 1,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `custom_pay_rules_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `drive_time_cache` (
	`id` int AUTO_INCREMENT NOT NULL,
	`routeKey` varchar(100) NOT NULL,
	`durationSeconds` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `drive_time_cache_id` PRIMARY KEY(`id`),
	CONSTRAINT `drive_time_cache_routeKey_unique` UNIQUE(`routeKey`)
);
--> statement-breakpoint
CREATE TABLE `field_mgmt_calls` (
	`id` int AUTO_INCREMENT NOT NULL,
	`clientStatusInquirySessionId` int,
	`cleanerJobId` int NOT NULL,
	`step` varchar(32) NOT NULL,
	`vapiCallId` varchar(128),
	`calledPhone` varchar(30) NOT NULL,
	`outcome` varchar(32) NOT NULL DEFAULT 'no_answer',
	`durationSeconds` int NOT NULL DEFAULT 0,
	`transcript` text,
	`summary` text,
	`endedReason` varchar(100),
	`recordingUrl` varchar(512),
	`smsFollowupSent` tinyint NOT NULL DEFAULT 0,
	`smsFollowupAt` timestamp,
	`smsFollowupBody` text,
	`smsReply` text,
	`smsConfirmed` tinyint NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `field_mgmt_calls_id` PRIMARY KEY(`id`),
	CONSTRAINT `field_mgmt_calls_vapiCallId_unique` UNIQUE(`vapiCallId`)
);
--> statement-breakpoint
CREATE TABLE `field_mgmt_log` (
	`id` int AUTO_INCREMENT NOT NULL,
	`cleanerJobId` int NOT NULL,
	`step` varchar(100) NOT NULL,
	`success` int NOT NULL DEFAULT 0,
	`errorDetail` text,
	`smsSent` text,
	`recipientPhone` varchar(30),
	`openPhoneMessageId` varchar(128),
	`deliveryStatus` varchar(16),
	`firedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `field_mgmt_log_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `follow_ups` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(255) NOT NULL,
	`nextStep` varchar(255) NOT NULL,
	`dueAt` bigint NOT NULL,
	`owner` varchar(100) NOT NULL,
	`type` enum('Lead callback','Customer issue','Reschedule','Voicemail','Team Issue') NOT NULL,
	`priority` enum('High','Normal','Low') NOT NULL DEFAULT 'Normal',
	`internalNote` text,
	`customerFacingMove` text,
	`history` text NOT NULL DEFAULT ('[]'),
	`reminderSentAt` bigint,
	`completedAt` bigint,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `follow_ups_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `gbp_state` (
	`id` int NOT NULL,
	`refreshToken` text NOT NULL,
	`accountName` varchar(128) DEFAULT '',
	`locationName` varchar(255) DEFAULT '',
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `gbp_state_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `gmail_sender_policies` (
	`id` int AUTO_INCREMENT NOT NULL,
	`senderEmail` varchar(255),
	`senderDomain` varchar(255),
	`isActionable` int NOT NULL DEFAULT 1,
	`label` varchar(100),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `gmail_sender_policies_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `gmail_sent_log` (
	`id` int AUTO_INCREMENT NOT NULL,
	`threadId` varchar(255) NOT NULL,
	`messageId` varchar(255) NOT NULL,
	`agentOpenId` varchar(64) NOT NULL,
	`agentName` text NOT NULL,
	`agentPhotoUrl` text,
	`sentAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `gmail_sent_log_id` PRIMARY KEY(`id`),
	CONSTRAINT `gmail_sent_log_messageId_unique` UNIQUE(`messageId`)
);
--> statement-breakpoint
CREATE TABLE `gmail_state` (
	`id` int NOT NULL,
	`refreshToken` text NOT NULL,
	`historyId` varchar(50) NOT NULL DEFAULT '0',
	`watchExpiration` bigint NOT NULL DEFAULT 0,
	`gmailBackfillCooldownUntil` bigint NOT NULL DEFAULT 0,
	`backfillPageToken` varchar(500),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `gmail_state_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `gmail_thread_meta` (
	`id` int AUTO_INCREMENT NOT NULL,
	`threadId` varchar(255) NOT NULL,
	`isIssue` int NOT NULL DEFAULT 0,
	`issueSummary` text,
	`flaggedBy` varchar(64),
	`flaggedAt` timestamp,
	`assignedToId` int,
	`assignedToName` varchar(255),
	`assignedToPhotoUrl` varchar(1024),
	`assignedAt` timestamp,
	`aiCategory` varchar(50),
	`aiSummary` text,
	`aiUrgency` varchar(10),
	`aiHistoryId` varchar(64),
	`aiProcessedAt` timestamp,
	`aiResolvedAt` timestamp,
	`isInInbox` int NOT NULL DEFAULT 1,
	`isUnread` int NOT NULL DEFAULT 0,
	`senderName` varchar(255),
	`senderEmail` varchar(255),
	`subject` varchar(500),
	`snippet` text,
	`lastMessageAt` bigint,
	`messageCount` int,
	`isActionable` int NOT NULL DEFAULT 1,
	`actionableReason` varchar(20) NOT NULL DEFAULT 'DEFAULT',
	`aiStatus` varchar(20) NOT NULL DEFAULT 'pending',
	`lastAiError` varchar(50),
	`lastAiAttemptAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `gmail_thread_meta_id` PRIMARY KEY(`id`),
	CONSTRAINT `gmail_thread_meta_threadId_unique` UNIQUE(`threadId`)
);
--> statement-breakpoint
CREATE TABLE `google_api_usage` (
	`id` int AUTO_INCREMENT NOT NULL,
	`date` varchar(10) NOT NULL,
	`geocodeCalls` int NOT NULL DEFAULT 0,
	`distanceCalls` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `google_api_usage_id` PRIMARY KEY(`id`),
	CONSTRAINT `google_api_usage_date_unique` UNIQUE(`date`)
);
--> statement-breakpoint
CREATE TABLE `inbound_sms` (
	`id` int AUTO_INCREMENT NOT NULL,
	`fromPhone` varchar(32) NOT NULL,
	`toPhone` varchar(32),
	`message` text NOT NULL,
	`openPhoneMessageId` varchar(128),
	`processingStatus` varchar(32) NOT NULL DEFAULT 'pending',
	`confirmationCallId` int,
	`extractedIntent` varchar(32),
	`extractedFlexibility` varchar(32),
	`extractedNotes` text,
	`extractedConfidence` int,
	`processingError` text,
	`receivedAt` bigint NOT NULL,
	`processedAt` bigint,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `inbound_sms_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `interview_chunks` (
	`id` int AUTO_INCREMENT NOT NULL,
	`sessionId` varchar(128) NOT NULL,
	`chunkIndex` int NOT NULL,
	`s3Key` varchar(512) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `interview_chunks_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `issue_comments` (
	`id` int AUTO_INCREMENT NOT NULL,
	`issue_key` varchar(255) NOT NULL,
	`author_name` varchar(255) NOT NULL,
	`body` text NOT NULL,
	`type` varchar(32) NOT NULL DEFAULT 'text',
	`created_at` bigint NOT NULL,
	CONSTRAINT `issue_comments_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `issue_engine` (
	`id` int AUTO_INCREMENT NOT NULL,
	`title` varchar(255) NOT NULL,
	`issueType` enum('late_team','refund_request','angry_customer','no_show','access_problem','payment_problem','reschedule_needed','broken_item','manager_review','internal_task','other') NOT NULL DEFAULT 'other',
	`severity` enum('critical','high','medium','low') NOT NULL DEFAULT 'medium',
	`status` enum('open','waiting','resolved') NOT NULL DEFAULT 'open',
	`ownerName` varchar(128),
	`waitingOn` varchar(128),
	`notes` text,
	`relatedSessionId` int,
	`relatedJobId` int,
	`createdByName` varchar(128) NOT NULL,
	`lastActivityAt` bigint NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`resolvedAt` bigint,
	CONSTRAINT `issue_engine_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `issue_engine_timeline` (
	`id` int AUTO_INCREMENT NOT NULL,
	`issueId` int NOT NULL,
	`event` varchar(512) NOT NULL,
	`actor` varchar(128) NOT NULL DEFAULT 'system',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `issue_engine_timeline_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `issue_flags` (
	`id` int AUTO_INCREMENT NOT NULL,
	`cleanerJobId` int NOT NULL,
	`issueNote` text NOT NULL,
	`flaggedAt` bigint NOT NULL,
	`flaggedBy` varchar(64) NOT NULL,
	`flaggedByName` varchar(255),
	`resolvedAt` bigint,
	`resolvedBy` varchar(64),
	`resolvedByName` varchar(255),
	`resolutionNote` text,
	`hasPhoto` int NOT NULL DEFAULT 0,
	CONSTRAINT `issue_flags_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `issue_ownership` (
	`id` int AUTO_INCREMENT NOT NULL,
	`issueKey` varchar(128) NOT NULL,
	`claimedBy` varchar(128),
	`claimedAt` bigint,
	`resolvedAt` bigint,
	`resolvedBy` varchar(128),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `issue_ownership_id` PRIMARY KEY(`id`),
	CONSTRAINT `issue_ownership_issueKey_unique` UNIQUE(`issueKey`)
);
--> statement-breakpoint
CREATE TABLE `job_alerts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`cleanerJobId` int NOT NULL,
	`alertType` varchar(50) NOT NULL,
	`postedMessageId` int,
	`resolvedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `job_alerts_id` PRIMARY KEY(`id`),
	CONSTRAINT `uniq_job_alert` UNIQUE(`cleanerJobId`,`alertType`)
);
--> statement-breakpoint
CREATE TABLE `job_geo_cache` (
	`id` int AUTO_INCREMENT NOT NULL,
	`addressKey` varchar(500) NOT NULL,
	`originalAddress` varchar(500) NOT NULL,
	`lat` double NOT NULL,
	`lng` double NOT NULL,
	`formattedAddress` varchar(500),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `job_geo_cache_id` PRIMARY KEY(`id`),
	CONSTRAINT `job_geo_cache_addressKey_unique` UNIQUE(`addressKey`)
);
--> statement-breakpoint
CREATE TABLE `job_issues` (
	`id` int AUTO_INCREMENT NOT NULL,
	`cleanerJobId` int NOT NULL,
	`jobDate` varchar(20) NOT NULL,
	`issueType` enum('late_team','no_access','parking','delay','lockout','utility_issue','no_checkin','completion','manual') NOT NULL,
	`raisedBy` enum('manual','auto') NOT NULL DEFAULT 'manual',
	`raisedByName` varchar(128),
	`raisedAt` bigint NOT NULL,
	`resolvedAt` bigint,
	`callLogId` int,
	`notes` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `job_issues_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `job_photos` (
	`id` int AUTO_INCREMENT NOT NULL,
	`cleanerJobId` int NOT NULL,
	`completedJobId` int NOT NULL,
	`cleanerProfileId` int NOT NULL,
	`photoUrl` varchar(1024) NOT NULL,
	`photoKey` varchar(512) NOT NULL,
	`thumbnailUrl` varchar(1024),
	`thumbnailKey` varchar(512),
	`filename` varchar(255),
	`photoType` varchar(20) NOT NULL DEFAULT 'general',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `job_photos_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `job_sms_replies` (
	`id` int AUTO_INCREMENT NOT NULL,
	`cleanerJobId` int NOT NULL,
	`senderType` varchar(16) NOT NULL,
	`senderPhone` varchar(30) NOT NULL,
	`body` text NOT NULL,
	`openPhoneMessageId` varchar(128),
	`deliveryStatus` varchar(16),
	`receivedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `job_sms_replies_id` PRIMARY KEY(`id`),
	CONSTRAINT `uniq_jsr_openphone_msg_id` UNIQUE(`openPhoneMessageId`)
);
--> statement-breakpoint
CREATE TABLE `job_status_history` (
	`id` int AUTO_INCREMENT NOT NULL,
	`cleanerJobId` int NOT NULL,
	`status` varchar(64) NOT NULL,
	`source` varchar(32) NOT NULL DEFAULT 'cleaner_app',
	`changedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `job_status_history_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `lead_assignments` (
	`id` int AUTO_INCREMENT NOT NULL,
	`sessionId` int NOT NULL,
	`agentId` int NOT NULL,
	`agentName` varchar(128) NOT NULL,
	`assignedByName` varchar(128) NOT NULL,
	`leadName` varchar(255),
	`leadPhone` varchar(30),
	`notes` text,
	`opsChatMessageId` int,
	`acknowledgedAt` bigint,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `lead_assignments_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `lead_call_logs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`sessionId` int NOT NULL,
	`agentId` int NOT NULL,
	`agentName` varchar(255) NOT NULL,
	`outcome` enum('ANSWERED','NO_ANSWER','VOICEMAIL','BUSY','BOOKED','CALLBACK') NOT NULL,
	`notes` text,
	`calledAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `lead_call_logs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `message_integrity_checks` (
	`id` int AUTO_INCREMENT NOT NULL,
	`sessionId` int NOT NULL,
	`leadName` varchar(255),
	`leadPhone` varchar(50),
	`dbCount` int NOT NULL DEFAULT 0,
	`openphoneCount` int NOT NULL DEFAULT 0,
	`delta` int NOT NULL DEFAULT 0,
	`reconciled` tinyint NOT NULL DEFAULT 0,
	`checkedAt` bigint NOT NULL,
	`firstDetectedAt` bigint,
	CONSTRAINT `message_integrity_checks_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `message_templates` (
	`id` int AUTO_INCREMENT NOT NULL,
	`flowType` enum('reactivation','review') NOT NULL,
	`stepKey` varchar(100) NOT NULL,
	`label` varchar(200) NOT NULL,
	`triggerLabel` varchar(200) NOT NULL,
	`body` text NOT NULL,
	`variables` text,
	`isEditable` int NOT NULL DEFAULT 1,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `message_templates_id` PRIMARY KEY(`id`),
	CONSTRAINT `message_templates_stepKey_unique` UNIQUE(`stepKey`)
);
--> statement-breakpoint
CREATE TABLE `metrics_ai_alerts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`range` varchar(10) NOT NULL DEFAULT '12m',
	`alertsJson` text NOT NULL,
	`generatedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `metrics_ai_alerts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `missed_calls` (
	`id` int AUTO_INCREMENT NOT NULL,
	`openphoneCallId` varchar(255) NOT NULL,
	`callerPhone` varchar(20) NOT NULL,
	`phoneNumberId` varchar(64) NOT NULL,
	`phoneNumberLabel` varchar(32) NOT NULL DEFAULT 'Unknown',
	`calledAt` timestamp NOT NULL,
	`smsSent` tinyint NOT NULL DEFAULT 0,
	`smsSentAt` timestamp,
	`calledBack` tinyint NOT NULL DEFAULT 0,
	`calledBackAt` timestamp,
	`calledBackByAgentName` varchar(128),
	`notes` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `missed_calls_id` PRIMARY KEY(`id`),
	CONSTRAINT `missed_calls_openphoneCallId_unique` UNIQUE(`openphoneCallId`)
);
--> statement-breakpoint
CREATE TABLE `nurture_enrollments` (
	`id` int AUTO_INCREMENT NOT NULL,
	`sessionId` int NOT NULL,
	`leadPhone` varchar(30) NOT NULL,
	`leadFirstName` varchar(100),
	`serviceType` varchar(100),
	`enrolledAt` timestamp NOT NULL DEFAULT (now()),
	`leadCreatedAt` timestamp NOT NULL,
	`nextStep` int NOT NULL DEFAULT 3,
	`nextSendAt` timestamp NOT NULL,
	`status` enum('active','paused','done') NOT NULL DEFAULT 'active',
	`endReason` varchar(32),
	`endedAt` timestamp,
	`deletedAt` timestamp,
	`bookedRevenue` int,
	`lastStepSent` int,
	`lastSentAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `nurture_enrollments_id` PRIMARY KEY(`id`),
	CONSTRAINT `nurture_enrollments_sessionId_unique` UNIQUE(`sessionId`)
);
--> statement-breakpoint
CREATE TABLE `nurture_step_scripts` (
	`step` int NOT NULL,
	`body` text NOT NULL,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `nurture_step_scripts_step` PRIMARY KEY(`step`)
);
--> statement-breakpoint
CREATE TABLE `openphone_call_recordings` (
	`id` int AUTO_INCREMENT NOT NULL,
	`sessionId` int NOT NULL,
	`openphoneCallId` varchar(255) NOT NULL,
	`callerPhone` varchar(20) NOT NULL,
	`direction` enum('incoming','outgoing') NOT NULL DEFAULT 'incoming',
	`durationSeconds` int,
	`recordingUrl` text NOT NULL,
	`status` varchar(50) NOT NULL DEFAULT 'completed',
	`callStartedAt` timestamp NOT NULL,
	`transcript` text,
	`callScore` int,
	`scoreData` text,
	`callDebrief` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `openphone_call_recordings_id` PRIMARY KEY(`id`),
	CONSTRAINT `openphone_call_recordings_openphoneCallId_unique` UNIQUE(`openphoneCallId`)
);
--> statement-breakpoint
CREATE TABLE `ops_chat_messages` (
	`id` int AUTO_INCREMENT NOT NULL,
	`cleanerJobId` int,
	`channel` varchar(64),
	`authorName` varchar(128) NOT NULL,
	`authorRole` varchar(32) NOT NULL DEFAULT 'office',
	`body` text NOT NULL,
	`mediaUrl` varchar(512),
	`quickAction` varchar(64),
	`metadata` text,
	`replyToId` int,
	`replyToBody` varchar(512),
	`replyToAuthor` varchar(128),
	`dmThread` varchar(256),
	`threadParentId` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `ops_chat_messages_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `ops_chat_reactions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`messageId` int NOT NULL,
	`callerId` varchar(128) NOT NULL,
	`callerName` varchar(128) NOT NULL,
	`emoji` varchar(8) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `ops_chat_reactions_id` PRIMARY KEY(`id`),
	CONSTRAINT `uniq_ocreact` UNIQUE(`messageId`,`callerId`,`emoji`)
);
--> statement-breakpoint
CREATE TABLE `ops_chat_reads` (
	`id` int AUTO_INCREMENT NOT NULL,
	`callerId` varchar(128) NOT NULL,
	`callerName` varchar(128) NOT NULL,
	`channel` varchar(64),
	`cleanerJobId` int,
	`lastReadMessageId` int NOT NULL,
	`updatedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `ops_chat_reads_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `ops_reminders` (
	`id` int AUTO_INCREMENT NOT NULL,
	`channel` varchar(64) NOT NULL,
	`body` text NOT NULL,
	`authorName` varchar(128) NOT NULL,
	`triggerAt` bigint NOT NULL,
	`callerId` varchar(128),
	`firedAt` bigint,
	`dismissedAt` bigint,
	`snoozedUntil` bigint,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `ops_reminders_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `ops_tasks` (
	`id` int AUTO_INCREMENT NOT NULL,
	`title` varchar(255) NOT NULL,
	`description` text,
	`priority` varchar(16) NOT NULL DEFAULT 'medium',
	`status` varchar(16) NOT NULL DEFAULT 'todo',
	`assigneeAgentId` int,
	`assigneeAgentName` varchar(128),
	`createdByAgentName` varchar(128),
	`createdByAgentId` int,
	`dueAt` bigint,
	`completedAt` bigint,
	`popupDismissedAt` bigint,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `ops_tasks_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `page_views` (
	`id` int AUTO_INCREMENT NOT NULL,
	`sessionKey` varchar(64) NOT NULL,
	`utmSource` varchar(100),
	`utmMedium` varchar(100),
	`utmCampaign` varchar(255),
	`timeOnPage` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `page_views_id` PRIMARY KEY(`id`),
	CONSTRAINT `page_views_sessionKey_unique` UNIQUE(`sessionKey`)
);
--> statement-breakpoint
CREATE TABLE `payment_authorizations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`cleanerJobId` int,
	`jobLabel` varchar(255),
	`customerPhone` varchar(30) NOT NULL,
	`customerName` varchar(255),
	`stripeCustomerId` varchar(64) NOT NULL,
	`stripePaymentMethodId` varchar(64) NOT NULL,
	`stripePaymentIntentId` varchar(64),
	`amountCents` int NOT NULL,
	`currency` varchar(8) NOT NULL DEFAULT 'usd',
	`status` varchar(32) NOT NULL DEFAULT 'authorized',
	`errorMessage` text,
	`createdBy` varchar(128),
	`actionBy` varchar(128),
	`notes` text,
	`authorizedAt` bigint,
	`capturedAt` bigint,
	`cancelledAt` bigint,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `payment_authorizations_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `push_subscriptions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`agentKey` varchar(128) NOT NULL,
	`endpoint` varchar(2048) NOT NULL,
	`keys` text NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`lastUsedAt` timestamp,
	CONSTRAINT `push_subscriptions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `quote_leads` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(255) NOT NULL,
	`email` varchar(320),
	`phone` varchar(30) NOT NULL,
	`serviceType` varchar(100) NOT NULL,
	`bedrooms` varchar(50) NOT NULL,
	`bathrooms` varchar(50) NOT NULL,
	`extras` text,
	`smsSent` int NOT NULL DEFAULT 0,
	`smsMessageId` varchar(128),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `quote_leads_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `rating_sms_pending` (
	`id` int AUTO_INCREMENT NOT NULL,
	`completedJobId` int NOT NULL,
	`cleanerJobId` int,
	`customerPhone` varchar(20) NOT NULL,
	`customerFirstName` varchar(100),
	`cleanerName` varchar(255),
	`jobDate` varchar(20) NOT NULL,
	`smsText` text NOT NULL,
	`status` enum('pending','approved','sent','skipped') NOT NULL DEFAULT 'pending',
	`approvedAt` timestamp,
	`sentAt` timestamp,
	`approvedBy` varchar(255),
	`skipReason` varchar(500),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `rating_sms_pending_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `reactivation_campaigns` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(255) NOT NULL,
	`messageTemplate` text NOT NULL,
	`segment` varchar(20) NOT NULL,
	`sourceType` varchar(20) NOT NULL DEFAULT 'csv',
	`status` enum('DRAFT','ACTIVE','PAUSED','COMPLETED') NOT NULL DEFAULT 'DRAFT',
	`batchSize` int NOT NULL DEFAULT 50,
	`totalContacts` int NOT NULL DEFAULT 0,
	`sentCount` int NOT NULL DEFAULT 0,
	`repliedCount` int NOT NULL DEFAULT 0,
	`bookedCount` int NOT NULL DEFAULT 0,
	`lastSentAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `reactivation_campaigns_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `reactivation_contacts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`campaignId` int NOT NULL,
	`phone` varchar(20) NOT NULL,
	`phoneRaw` varchar(30),
	`name` varchar(255),
	`firstName` varchar(100),
	`email` varchar(320),
	`lastBookingDate` varchar(20),
	`daysSince` int,
	`bookingCount` int NOT NULL DEFAULT 0,
	`lastPrice` int,
	`discountPct` int NOT NULL DEFAULT 10,
	`segment` varchar(20),
	`status` enum('PENDING','SENT','REPLIED','BOOKED','OPTED_OUT') NOT NULL DEFAULT 'PENDING',
	`sentAt` timestamp,
	`repliedAt` timestamp,
	`sessionId` int,
	`completedJobId` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `reactivation_contacts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `schedule_assignments` (
	`id` int AUTO_INCREMENT NOT NULL,
	`jobDate` varchar(20) NOT NULL,
	`cleanerJobId` int NOT NULL,
	`teamId` int NOT NULL,
	`teamName` varchar(255),
	`routeOrder` int NOT NULL DEFAULT 0,
	`estimatedArrivalMs` bigint,
	`estimatedDepartureMs` bigint,
	`driveTimeSecs` int,
	`isManual` int NOT NULL DEFAULT 0,
	`totalDistanceMeters` int,
	`rationale` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `schedule_assignments_id` PRIMARY KEY(`id`),
	CONSTRAINT `uniq_schedule_job_date` UNIQUE(`cleanerJobId`,`jobDate`)
);
--> statement-breakpoint
CREATE TABLE `schedule_job_locks` (
	`id` int AUTO_INCREMENT NOT NULL,
	`jobId` int NOT NULL,
	`date` varchar(10) NOT NULL,
	`cleanerId` int NOT NULL,
	`lockedPosition` int NOT NULL,
	`lockedAt` bigint NOT NULL,
	CONSTRAINT `schedule_job_locks_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `scheduling_teams` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(255) NOT NULL,
	`launch27TeamId` int,
	`homeAddress` varchar(500),
	`homeLat` double,
	`homeLng` double,
	`maxHoursPerDay` double DEFAULT 8,
	`skills` varchar(500),
	`isActive` int NOT NULL DEFAULT 1,
	`color` varchar(10) DEFAULT '#6366f1',
	`minJobs` int,
	`maxJobs` int,
	`earliestStartTime` varchar(5),
	`tag` varchar(20),
	`regionTags` varchar(50),
	`isArchived` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `scheduling_teams_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `sms_campaign_recipients` (
	`id` int AUTO_INCREMENT NOT NULL,
	`campaignId` int NOT NULL,
	`phone` varchar(30) NOT NULL,
	`phoneNormalized` varchar(20) NOT NULL,
	`snapshotFirstName` varchar(100),
	`snapshotName` varchar(255),
	`snapshotAddress` varchar(500),
	`snapshotLastService` varchar(100),
	`snapshotLastPrice` int,
	`snapshotCity` varchar(100),
	`snapshotFrequency` varchar(50),
	`snapshotBedrooms` int,
	`snapshotDaysSinceBooking` int,
	`snapshotPreferredTeam` varchar(100),
	`completedJobId` int NOT NULL,
	`personalizedMessage` text NOT NULL,
	`status` enum('PENDING','SENT','FAILED','SKIPPED','BOOKED') NOT NULL DEFAULT 'PENDING',
	`sentAt` bigint,
	`openPhoneMessageId` varchar(128),
	`sessionId` int,
	`errorMessage` varchar(500),
	`skipReason` varchar(255),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `sms_campaign_recipients_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_campaign_phone` UNIQUE(`campaignId`,`phoneNormalized`)
);
--> statement-breakpoint
CREATE TABLE `sms_campaign_send_log` (
	`id` int AUTO_INCREMENT NOT NULL,
	`campaignId` int NOT NULL,
	`recipientId` int NOT NULL,
	`phoneNormalized` varchar(20) NOT NULL,
	`action` enum('SENT','FAILED','SKIPPED','TEST_SENT') NOT NULL,
	`batchNumber` int NOT NULL DEFAULT 1,
	`attempt` int NOT NULL DEFAULT 1,
	`durationMs` int,
	`openPhoneMessageId` varchar(128),
	`errorMessage` varchar(500),
	`triggeredBy` varchar(255),
	`attemptedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `sms_campaign_send_log_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `sms_campaigns` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(255) NOT NULL,
	`status` enum('DRAFT','FROZEN','APPROVED','SENDING','PAUSED','COMPLETED','CANCELLED') NOT NULL DEFAULT 'DRAFT',
	`audienceDefinition` longtext NOT NULL,
	`messageTemplate` text NOT NULL,
	`plannerResult` longtext,
	`frozenAt` bigint,
	`frozenRecipientCount` int,
	`definitionHash` varchar(64),
	`approvedAt` bigint,
	`approvedByAgentId` int,
	`approvedByName` varchar(255),
	`sentCount` int NOT NULL DEFAULT 0,
	`failedCount` int NOT NULL DEFAULT 0,
	`repliedCount` int NOT NULL DEFAULT 0,
	`bookedCount` int NOT NULL DEFAULT 0,
	`sendStartedAt` bigint,
	`sendCompletedAt` bigint,
	`estimatedRevenue` int,
	`estimatedBookings` int,
	`estimatedReplies` int,
	`isDryRun` tinyint NOT NULL DEFAULT 0,
	`testPhones` text,
	`createdByAgentId` int,
	`createdByName` varchar(255) NOT NULL,
	`sentByAgentId` int,
	`sentByName` varchar(255),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `sms_campaigns_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `sms_opt_outs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`phone` varchar(20) NOT NULL,
	`optedOutAt` timestamp NOT NULL DEFAULT (now()),
	`source` varchar(50) NOT NULL DEFAULT 'reply_stop',
	`triggerMessage` varchar(255),
	CONSTRAINT `sms_opt_outs_id` PRIMARY KEY(`id`),
	CONSTRAINT `sms_opt_outs_phone_unique` UNIQUE(`phone`)
);
--> statement-breakpoint
CREATE TABLE `step_locks` (
	`id` int AUTO_INCREMENT NOT NULL,
	`cleanerJobId` int NOT NULL,
	`step` varchar(100) NOT NULL,
	`claimedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `step_locks_id` PRIMARY KEY(`id`),
	CONSTRAINT `uniq_step_locks_job_step` UNIQUE(`cleanerJobId`,`step`)
);
--> statement-breakpoint
CREATE TABLE `stripe_customers` (
	`id` int AUTO_INCREMENT NOT NULL,
	`phone` varchar(30) NOT NULL,
	`name` varchar(255),
	`stripeCustomerId` varchar(64) NOT NULL,
	`stripePaymentMethodId` varchar(64),
	`cardBrand` varchar(32),
	`cardLast4` varchar(4),
	`cardExpMonth` int,
	`cardExpYear` int,
	`cardSavedAt` bigint,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `stripe_customers_id` PRIMARY KEY(`id`),
	CONSTRAINT `stripe_customers_phone_unique` UNIQUE(`phone`)
);
--> statement-breakpoint
CREATE TABLE `sync_runs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`runType` enum('launch27-sync','always-on-send') NOT NULL,
	`status` enum('success','partial','error','skipped') NOT NULL,
	`message` text,
	`errorDetail` text,
	`recordsInserted` int DEFAULT 0,
	`recordsSkipped` int DEFAULT 0,
	`smsSent` int DEFAULT 0,
	`smsFailed` int DEFAULT 0,
	`groupBreakdown` text,
	`enrollmentBreakdown` text,
	`targetDate` varchar(20),
	`durationMs` int,
	`startedAt` timestamp NOT NULL DEFAULT (now()),
	`completedAt` timestamp,
	CONSTRAINT `sync_runs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `system_config` (
	`id` int AUTO_INCREMENT NOT NULL,
	`pausedServices` json NOT NULL DEFAULT ('[]'),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `system_config_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `team_availability_checkins` (
	`id` int AUTO_INCREMENT NOT NULL,
	`cleanerProfileId` int NOT NULL,
	`submittedForDate` varchar(20) NOT NULL,
	`availabilityDate` varchar(20) NOT NULL,
	`isAvailable` tinyint NOT NULL,
	`maxJobs` int,
	`note` text,
	`submittedAt` bigint NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `team_availability_checkins_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `team_day_config` (
	`id` int AUTO_INCREMENT NOT NULL,
	`teamId` int NOT NULL,
	`date` varchar(20) NOT NULL,
	`maxJobs` int,
	`earliestStartTime` varchar(5),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `team_day_config_id` PRIMARY KEY(`id`),
	CONSTRAINT `uniq_team_day_config` UNIQUE(`teamId`,`date`)
);
--> statement-breakpoint
CREATE TABLE `team_day_lock` (
	`id` int AUTO_INCREMENT NOT NULL,
	`teamId` int NOT NULL,
	`date` varchar(20) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `team_day_lock_id` PRIMARY KEY(`id`),
	CONSTRAINT `uniq_team_day_lock` UNIQUE(`teamId`,`date`)
);
--> statement-breakpoint
CREATE TABLE `team_day_override` (
	`id` int AUTO_INCREMENT NOT NULL,
	`teamId` int NOT NULL,
	`date` varchar(20) NOT NULL,
	`isAvailable` tinyint,
	`note` varchar(500),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `team_day_override_id` PRIMARY KEY(`id`),
	CONSTRAINT `uniq_tdo_team_date` UNIQUE(`teamId`,`date`)
);
--> statement-breakpoint
CREATE TABLE `team_day_unavailability` (
	`id` int AUTO_INCREMENT NOT NULL,
	`teamId` int NOT NULL,
	`date` varchar(20) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `team_day_unavailability_id` PRIMARY KEY(`id`),
	CONSTRAINT `uniq_team_day` UNIQUE(`teamId`,`date`)
);
--> statement-breakpoint
CREATE TABLE `team_work_schedule` (
	`id` int AUTO_INCREMENT NOT NULL,
	`teamId` int NOT NULL,
	`mon` tinyint NOT NULL DEFAULT 1,
	`tue` tinyint NOT NULL DEFAULT 1,
	`wed` tinyint NOT NULL DEFAULT 1,
	`thu` tinyint NOT NULL DEFAULT 1,
	`fri` tinyint NOT NULL DEFAULT 1,
	`sat` tinyint NOT NULL DEFAULT 0,
	`sun` tinyint NOT NULL DEFAULT 0,
	`note` varchar(500),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `team_work_schedule_id` PRIMARY KEY(`id`),
	CONSTRAINT `team_work_schedule_teamId_unique` UNIQUE(`teamId`)
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` int AUTO_INCREMENT NOT NULL,
	`openId` varchar(64) NOT NULL,
	`name` text,
	`email` varchar(320),
	`loginMethod` varchar(64),
	`role` enum('user','admin') NOT NULL DEFAULT 'user',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	`lastSignedIn` timestamp NOT NULL DEFAULT (now()),
	`profilePhotoUrl` text,
	CONSTRAINT `users_id` PRIMARY KEY(`id`),
	CONSTRAINT `users_openId_unique` UNIQUE(`openId`)
);
--> statement-breakpoint
CREATE TABLE `voice_calls` (
	`id` int AUTO_INCREMENT NOT NULL,
	`vapiCallId` varchar(128) NOT NULL,
	`sessionId` int,
	`callerPhone` varchar(30) NOT NULL,
	`durationSeconds` int NOT NULL DEFAULT 0,
	`transcript` text,
	`summary` text,
	`recordingUrl` varchar(512),
	`outcome` varchar(50) NOT NULL DEFAULT 'no_action',
	`structuredData` text,
	`endedReason` varchar(100),
	`successEvaluation` varchar(10),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `voice_calls_id` PRIMARY KEY(`id`),
	CONSTRAINT `voice_calls_vapiCallId_unique` UNIQUE(`vapiCallId`)
);
--> statement-breakpoint
CREATE INDEX `idx_cl_job_date` ON `call_log` (`jobDate`);--> statement-breakpoint
CREATE INDEX `idx_cl_job_id` ON `call_log` (`cleanerJobId`);--> statement-breakpoint
CREATE INDEX `idx_cl_vapi` ON `call_log` (`vapiCallId`);--> statement-breakpoint
CREATE INDEX `idx_cand_phone` ON `candidates` (`phone`);--> statement-breakpoint
CREATE INDEX `idx_cand_stage` ON `candidates` (`stage`);--> statement-breakpoint
CREATE INDEX `idx_cand_created` ON `candidates` (`createdAt`);--> statement-breakpoint
CREATE INDEX `idx_cp_channel` ON `channel_pins` (`channel`);--> statement-breakpoint
CREATE INDEX `idx_csa_message` ON `chat_super_alerts` (`messageId`);--> statement-breakpoint
CREATE INDEX `idx_csa_target` ON `chat_super_alerts` (`targetAgentName`);--> statement-breakpoint
CREATE INDEX `idx_cjcr_cleaner_job` ON `cleaner_job_custom_rules` (`cleanerJobId`);--> statement-breakpoint
CREATE INDEX `idx_cleaner_jobs_job_date` ON `cleaner_jobs` (`jobDate`);--> statement-breakpoint
CREATE INDEX `idx_cmlt_cleaner_profile` ON `cleaner_magic_link_tokens` (`cleanerProfileId`);--> statement-breakpoint
CREATE INDEX `idx_cmlt_token` ON `cleaner_magic_link_tokens` (`token`);--> statement-breakpoint
CREATE INDEX `idx_crsl_phone` ON `cleaner_rating_sms_log` (`cleanerPhone`);--> statement-breakpoint
CREATE INDEX `idx_crsl_job` ON `cleaner_rating_sms_log` (`cleanerJobId`);--> statement-breakpoint
CREATE INDEX `idx_cc_job_date` ON `confirmation_calls` (`jobDate`);--> statement-breakpoint
CREATE INDEX `idx_cc_job_id` ON `confirmation_calls` (`cleanerJobId`);--> statement-breakpoint
CREATE INDEX `idx_cc_vapi` ON `confirmation_calls` (`vapiCallId`);--> statement-breakpoint
CREATE INDEX `idx_dtc_route_key` ON `drive_time_cache` (`routeKey`);--> statement-breakpoint
CREATE INDEX `idx_fmc_cleaner_job_id` ON `field_mgmt_calls` (`cleanerJobId`);--> statement-breakpoint
CREATE INDEX `idx_fu_due_at` ON `follow_ups` (`dueAt`);--> statement-breakpoint
CREATE INDEX `idx_fu_completed_at` ON `follow_ups` (`completedAt`);--> statement-breakpoint
CREATE INDEX `idx_isms_from_phone` ON `inbound_sms` (`fromPhone`);--> statement-breakpoint
CREATE INDEX `idx_isms_status` ON `inbound_sms` (`processingStatus`);--> statement-breakpoint
CREATE INDEX `idx_isms_msg_id` ON `inbound_sms` (`openPhoneMessageId`);--> statement-breakpoint
CREATE INDEX `idx_ichunk_session` ON `interview_chunks` (`sessionId`);--> statement-breakpoint
CREATE INDEX `idx_ie_status` ON `issue_engine` (`status`);--> statement-breakpoint
CREATE INDEX `idx_ie_session` ON `issue_engine` (`relatedSessionId`);--> statement-breakpoint
CREATE INDEX `idx_iet_issue` ON `issue_engine_timeline` (`issueId`);--> statement-breakpoint
CREATE INDEX `idx_if_job` ON `issue_flags` (`cleanerJobId`);--> statement-breakpoint
CREATE INDEX `idx_if_open` ON `issue_flags` (`resolvedAt`);--> statement-breakpoint
CREATE INDEX `idx_io_key` ON `issue_ownership` (`issueKey`);--> statement-breakpoint
CREATE INDEX `idx_io_resolved` ON `issue_ownership` (`resolvedAt`);--> statement-breakpoint
CREATE INDEX `idx_ja_job` ON `job_alerts` (`cleanerJobId`);--> statement-breakpoint
CREATE INDEX `idx_ji_job_date` ON `job_issues` (`cleanerJobId`,`jobDate`);--> statement-breakpoint
CREATE INDEX `idx_jsr_cleaner_job_id` ON `job_sms_replies` (`cleanerJobId`);--> statement-breakpoint
CREATE INDEX `idx_jsh_cleaner_job_id` ON `job_status_history` (`cleanerJobId`);--> statement-breakpoint
CREATE INDEX `idx_la_session` ON `lead_assignments` (`sessionId`);--> statement-breakpoint
CREATE INDEX `idx_la_agent` ON `lead_assignments` (`agentId`);--> statement-breakpoint
CREATE INDEX `idx_mc_caller_phone` ON `missed_calls` (`callerPhone`);--> statement-breakpoint
CREATE INDEX `idx_mc_called_at` ON `missed_calls` (`calledAt`);--> statement-breakpoint
CREATE INDEX `idx_mc_called_back` ON `missed_calls` (`calledBack`);--> statement-breakpoint
CREATE INDEX `idx_ocr_session` ON `openphone_call_recordings` (`sessionId`);--> statement-breakpoint
CREATE INDEX `idx_ocr_call_id` ON `openphone_call_recordings` (`openphoneCallId`);--> statement-breakpoint
CREATE INDEX `idx_ocm_job` ON `ops_chat_messages` (`cleanerJobId`);--> statement-breakpoint
CREATE INDEX `idx_ocm_channel` ON `ops_chat_messages` (`channel`);--> statement-breakpoint
CREATE INDEX `idx_ocm_created_at` ON `ops_chat_messages` (`createdAt`);--> statement-breakpoint
CREATE INDEX `idx_ocm_channel_created_at` ON `ops_chat_messages` (`channel`,`createdAt`);--> statement-breakpoint
CREATE INDEX `idx_ocreact_msg` ON `ops_chat_reactions` (`messageId`);--> statement-breakpoint
CREATE INDEX `idx_ocreact_caller` ON `ops_chat_reactions` (`callerId`);--> statement-breakpoint
CREATE INDEX `idx_ocr_caller` ON `ops_chat_reads` (`callerId`);--> statement-breakpoint
CREATE INDEX `idx_ocr_channel` ON `ops_chat_reads` (`channel`);--> statement-breakpoint
CREATE INDEX `idx_ocr_job` ON `ops_chat_reads` (`cleanerJobId`);--> statement-breakpoint
CREATE INDEX `idx_or_trigger` ON `ops_reminders` (`triggerAt`);--> statement-breakpoint
CREATE INDEX `idx_or_fired` ON `ops_reminders` (`firedAt`);--> statement-breakpoint
CREATE INDEX `idx_ot_assignee` ON `ops_tasks` (`assigneeAgentId`);--> statement-breakpoint
CREATE INDEX `idx_ot_status` ON `ops_tasks` (`status`);--> statement-breakpoint
CREATE INDEX `idx_ot_due` ON `ops_tasks` (`dueAt`);--> statement-breakpoint
CREATE INDEX `idx_ps_agent` ON `push_subscriptions` (`agentKey`);--> statement-breakpoint
CREATE INDEX `idx_ps_endpoint` ON `push_subscriptions` (`endpoint`);--> statement-breakpoint
CREATE INDEX `idx_campaign_recipients_campaign_id` ON `sms_campaign_recipients` (`campaignId`);--> statement-breakpoint
CREATE INDEX `idx_campaign_recipients_status` ON `sms_campaign_recipients` (`campaignId`,`status`);--> statement-breakpoint
CREATE INDEX `idx_send_log_campaign` ON `sms_campaign_send_log` (`campaignId`);--> statement-breakpoint
CREATE INDEX `idx_send_log_phone` ON `sms_campaign_send_log` (`phoneNormalized`);--> statement-breakpoint
CREATE INDEX `idx_sms_campaigns_status` ON `sms_campaigns` (`status`);--> statement-breakpoint
CREATE INDEX `idx_sms_campaigns_created_at` ON `sms_campaigns` (`createdAt`);--> statement-breakpoint
CREATE INDEX `idx_tac_cleaner_date` ON `team_availability_checkins` (`cleanerProfileId`,`availabilityDate`);--> statement-breakpoint
CREATE INDEX `idx_tac_avail_date` ON `team_availability_checkins` (`availabilityDate`);