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
	`serviceType` varchar(100),
	`jobDate` varchar(20),
	`status` enum('PENDING','SENT','REPLIED_POSITIVE','REPLIED_NEGATIVE','REVIEW_CONFIRMED','OPTED_OUT') NOT NULL DEFAULT 'PENDING',
	`smsSentAt` timestamp,
	`repliedAt` timestamp,
	`sessionId` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `completed_jobs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `conversation_sessions` MODIFY COLUMN `stage` enum('WIDGET_SIZING','REACTIVATION','QUOTE_SENT','AVAILABILITY','SLOT_CHOICE','TIME_PREF','ADDRESS','CONFIRMATION','CALL_SCHEDULED','DONE','UNHANDLED','BOOKED','NOT_INTERESTED','REVIEW_REQUESTED','REVIEW_DONE') NOT NULL DEFAULT 'QUOTE_SENT';