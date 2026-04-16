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
CREATE INDEX `idx_ja_job` ON `job_alerts` (`cleanerJobId`);