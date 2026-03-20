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
CREATE TABLE `cron_heartbeats` (
	`id` int AUTO_INCREMENT NOT NULL,
	`jobName` varchar(50) NOT NULL,
	`resultSummary` varchar(500),
	`didWork` int NOT NULL DEFAULT 0,
	`ranAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `cron_heartbeats_id` PRIMARY KEY(`id`)
);
