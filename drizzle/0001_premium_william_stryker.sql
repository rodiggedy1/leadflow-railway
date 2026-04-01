CREATE TABLE `cs_threads` (
	`id` int AUTO_INCREMENT NOT NULL,
	`phone` varchar(30) NOT NULL,
	`customerName` varchar(128),
	`status` varchar(32) NOT NULL DEFAULT 'open',
	`messageHistory` longtext NOT NULL DEFAULT '[]',
	`aiDraft` text,
	`launch27Snapshot` longtext,
	`unreadCount` int NOT NULL DEFAULT 0,
	`flagged` tinyint NOT NULL DEFAULT 0,
	`agentNote` text,
	`sessionId` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	`lastMessageAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `cs_threads_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `conversation_sessions` MODIFY COLUMN `stage` enum('WIDGET_SIZING','REACTIVATION','REACTIVATION_TIME','QUOTE_SENT','AVAILABILITY','SLOT_CHOICE','TIME_PREF','ADDRESS','CONFIRMATION','CALL_SCHEDULED','DONE','UNHANDLED','BOOKED','NOT_INTERESTED','REVIEW_REQUESTED','REVIEW_DONE','FUTURE_BOOKING','FOLLOW_UP_SCHEDULED','LANGUAGE_CONFIRM','QUALITY_RATING_REQUESTED','QUALITY_MISSED_FOLLOWUP','QUALITY_RATING_DONE','REVIEW_REBOOKING_REQUESTED','REVIEW_REBOOKING_DONE','COLD','LOST','VOICEMAIL','YELP_CONTACTED','INTERVIEW_LINK_SENT','INTERVIEW_NUDGE_1','INTERVIEW_NUDGE_2','INTERVIEW_LINK_DONE','CS_OPEN','CS_PENDING_REPLY','CS_CLOSED') NOT NULL DEFAULT 'QUOTE_SENT';--> statement-breakpoint
CREATE INDEX `idx_cs_phone` ON `cs_threads` (`phone`);--> statement-breakpoint
CREATE INDEX `idx_cs_status` ON `cs_threads` (`status`);--> statement-breakpoint
CREATE INDEX `idx_cs_last_msg` ON `cs_threads` (`lastMessageAt`);