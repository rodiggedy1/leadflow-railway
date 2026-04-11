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
	`jobStatus` enum('on_the_way','arrived','running_late','in_progress','finishing_up','wrapping_up','completed','issue_at_property'),
	`issueNote` text,
	`etaTimestamp` bigint,
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
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `cleaner_jobs_id` PRIMARY KEY(`id`)
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
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `cleaner_profiles_id` PRIMARY KEY(`id`)
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
CREATE TABLE `conversation_sessions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`leadPhone` varchar(30) NOT NULL,
	`leadName` varchar(255),
	`stage` enum('WIDGET_SIZING','REACTIVATION','REACTIVATION_TIME','QUOTE_SENT','AVAILABILITY','SLOT_CHOICE','TIME_PREF','ADDRESS','CONFIRMATION','CALL_SCHEDULED','DONE','UNHANDLED','BOOKED','NOT_INTERESTED','REVIEW_REQUESTED','REVIEW_DONE','FUTURE_BOOKING','FOLLOW_UP_SCHEDULED','LANGUAGE_CONFIRM','QUALITY_RATING_REQUESTED','QUALITY_MISSED_FOLLOWUP','QUALITY_RATING_DONE','REVIEW_REBOOKING_REQUESTED','REVIEW_REBOOKING_DONE','COLD','LOST','VOICEMAIL','YELP_CONTACTED','INTERVIEW_LINK_SENT','INTERVIEW_NUDGE_1','INTERVIEW_NUDGE_2','INTERVIEW_LINK_DONE','OPEN','HIRING_OUTBOUND') NOT NULL DEFAULT 'QUOTE_SENT',
	`quotedPrice` varchar(20),
	`serviceType` varchar(100),
	`bedrooms` varchar(50),
	`bathrooms` varchar(50),
	`extras` text,
	`selectedSlot` varchar(100),
	`address` text,
	`callPreference` varchar(50),
	`messageHistory` text NOT NULL,
	`quoteLeadId` int,
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
CREATE TABLE `field_mgmt_calls` (
	`id` int AUTO_INCREMENT NOT NULL,
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
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `field_mgmt_calls_id` PRIMARY KEY(`id`),
	CONSTRAINT `field_mgmt_calls_vapiCallId_unique` UNIQUE(`vapiCallId`)
);
--> statement-breakpoint
CREATE TABLE `field_mgmt_log` (
	`id` int AUTO_INCREMENT NOT NULL,
	`cleanerJobId` int NOT NULL,
	`step` enum('assignment_sms','pre_job_reminder','client_pre_job','client_on_the_way','client_running_late','arrived_checkin','mid_job_nudge','completion_flow','exception_sms','exception_call','noshow_alert','noshow_call') NOT NULL,
	`success` int NOT NULL DEFAULT 0,
	`errorDetail` text,
	`smsSent` text,
	`recipientPhone` varchar(30),
	`firedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `field_mgmt_log_id` PRIMARY KEY(`id`),
	CONSTRAINT `uniq_field_mgmt_job_step` UNIQUE(`cleanerJobId`,`step`)
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
CREATE INDEX `idx_cand_phone` ON `candidates` (`phone`);--> statement-breakpoint
CREATE INDEX `idx_cand_stage` ON `candidates` (`stage`);--> statement-breakpoint
CREATE INDEX `idx_cand_created` ON `candidates` (`createdAt`);--> statement-breakpoint
CREATE INDEX `idx_cp_channel` ON `channel_pins` (`channel`);--> statement-breakpoint
CREATE INDEX `idx_cjcr_cleaner_job` ON `cleaner_job_custom_rules` (`cleanerJobId`);--> statement-breakpoint
CREATE INDEX `idx_cleaner_jobs_job_date` ON `cleaner_jobs` (`jobDate`);--> statement-breakpoint
CREATE INDEX `idx_cmlt_cleaner_profile` ON `cleaner_magic_link_tokens` (`cleanerProfileId`);--> statement-breakpoint
CREATE INDEX `idx_cmlt_token` ON `cleaner_magic_link_tokens` (`token`);--> statement-breakpoint
CREATE INDEX `idx_crsl_phone` ON `cleaner_rating_sms_log` (`cleanerPhone`);--> statement-breakpoint
CREATE INDEX `idx_crsl_job` ON `cleaner_rating_sms_log` (`cleanerJobId`);--> statement-breakpoint
CREATE INDEX `idx_fmc_cleaner_job_id` ON `field_mgmt_calls` (`cleanerJobId`);--> statement-breakpoint
CREATE INDEX `idx_fu_due_at` ON `follow_ups` (`dueAt`);--> statement-breakpoint
CREATE INDEX `idx_fu_completed_at` ON `follow_ups` (`completedAt`);--> statement-breakpoint
CREATE INDEX `idx_ichunk_session` ON `interview_chunks` (`sessionId`);--> statement-breakpoint
CREATE INDEX `idx_if_job` ON `issue_flags` (`cleanerJobId`);--> statement-breakpoint
CREATE INDEX `idx_if_open` ON `issue_flags` (`resolvedAt`);--> statement-breakpoint
CREATE INDEX `idx_io_key` ON `issue_ownership` (`issueKey`);--> statement-breakpoint
CREATE INDEX `idx_io_resolved` ON `issue_ownership` (`resolvedAt`);--> statement-breakpoint
CREATE INDEX `idx_jsr_cleaner_job_id` ON `job_sms_replies` (`cleanerJobId`);--> statement-breakpoint
CREATE INDEX `idx_jsh_cleaner_job_id` ON `job_status_history` (`cleanerJobId`);--> statement-breakpoint
CREATE INDEX `idx_ocr_session` ON `openphone_call_recordings` (`sessionId`);--> statement-breakpoint
CREATE INDEX `idx_ocr_call_id` ON `openphone_call_recordings` (`openphoneCallId`);--> statement-breakpoint
CREATE INDEX `idx_ocm_job` ON `ops_chat_messages` (`cleanerJobId`);--> statement-breakpoint
CREATE INDEX `idx_ocm_channel` ON `ops_chat_messages` (`channel`);--> statement-breakpoint
CREATE INDEX `idx_ocm_created_at` ON `ops_chat_messages` (`createdAt`);--> statement-breakpoint
CREATE INDEX `idx_ocreact_msg` ON `ops_chat_reactions` (`messageId`);--> statement-breakpoint
CREATE INDEX `idx_ocreact_caller` ON `ops_chat_reactions` (`callerId`);--> statement-breakpoint
CREATE INDEX `idx_ocr_caller` ON `ops_chat_reads` (`callerId`);--> statement-breakpoint
CREATE INDEX `idx_ocr_channel` ON `ops_chat_reads` (`channel`);--> statement-breakpoint
CREATE INDEX `idx_ocr_job` ON `ops_chat_reads` (`cleanerJobId`);--> statement-breakpoint
CREATE INDEX `idx_or_trigger` ON `ops_reminders` (`triggerAt`);--> statement-breakpoint
CREATE INDEX `idx_or_fired` ON `ops_reminders` (`firedAt`);--> statement-breakpoint
CREATE INDEX `idx_ps_agent` ON `push_subscriptions` (`agentKey`);--> statement-breakpoint
CREATE INDEX `idx_ps_endpoint` ON `push_subscriptions` (`endpoint`);