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
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `confirmation_calls_id` PRIMARY KEY(`id`),
	CONSTRAINT `confirmation_calls_vapiCallId_unique` UNIQUE(`vapiCallId`)
);
--> statement-breakpoint
ALTER TABLE `gmail_thread_meta` ADD `isInInbox` int DEFAULT 1 NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_cc_job_date` ON `confirmation_calls` (`jobDate`);--> statement-breakpoint
CREATE INDEX `idx_cc_job_id` ON `confirmation_calls` (`cleanerJobId`);--> statement-breakpoint
CREATE INDEX `idx_cc_vapi` ON `confirmation_calls` (`vapiCallId`);