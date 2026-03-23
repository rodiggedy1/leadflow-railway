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
CREATE INDEX `idx_fmc_cleaner_job_id` ON `field_mgmt_calls` (`cleanerJobId`);--> statement-breakpoint
CREATE INDEX `idx_jsr_cleaner_job_id` ON `job_sms_replies` (`cleanerJobId`);