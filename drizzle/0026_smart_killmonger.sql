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
