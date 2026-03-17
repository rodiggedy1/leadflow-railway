CREATE TABLE `activity_log` (
	`id` int AUTO_INCREMENT NOT NULL,
	`eventType` enum('lead_reply','ai_sms_sent','silence_nudge','scheduled_followup','always_on_batch','nightly_sync','booking','new_lead') NOT NULL,
	`title` varchar(255) NOT NULL,
	`body` text,
	`meta` text,
	`readAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `activity_log_id` PRIMARY KEY(`id`)
);
