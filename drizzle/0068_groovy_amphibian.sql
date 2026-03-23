CREATE TABLE `job_status_history` (
	`id` int AUTO_INCREMENT NOT NULL,
	`cleanerJobId` int NOT NULL,
	`status` varchar(64) NOT NULL,
	`source` varchar(32) NOT NULL DEFAULT 'cleaner_app',
	`changedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `job_status_history_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `idx_jsh_cleaner_job_id` ON `job_status_history` (`cleanerJobId`);