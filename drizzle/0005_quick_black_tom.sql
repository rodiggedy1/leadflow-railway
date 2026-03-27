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
CREATE INDEX `idx_if_job` ON `issue_flags` (`cleanerJobId`);--> statement-breakpoint
CREATE INDEX `idx_if_open` ON `issue_flags` (`resolvedAt`);