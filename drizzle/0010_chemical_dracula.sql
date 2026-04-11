CREATE TABLE `issue_ownership` (
	`id` int AUTO_INCREMENT NOT NULL,
	`issueKey` varchar(128) NOT NULL,
	`claimedBy` varchar(128),
	`claimedAt` bigint,
	`resolvedAt` bigint,
	`resolvedBy` varchar(128),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `issue_ownership_id` PRIMARY KEY(`id`),
	CONSTRAINT `issue_ownership_issueKey_unique` UNIQUE(`issueKey`)
);
--> statement-breakpoint
CREATE INDEX `idx_io_key` ON `issue_ownership` (`issueKey`);--> statement-breakpoint
CREATE INDEX `idx_io_resolved` ON `issue_ownership` (`resolvedAt`);