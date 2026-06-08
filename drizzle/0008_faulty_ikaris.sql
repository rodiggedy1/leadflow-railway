CREATE TABLE `lead_assignments` (
	`id` int AUTO_INCREMENT NOT NULL,
	`sessionId` int NOT NULL,
	`agentId` int NOT NULL,
	`agentName` varchar(128) NOT NULL,
	`assignedByName` varchar(128) NOT NULL,
	`leadName` varchar(255),
	`leadPhone` varchar(30),
	`notes` text,
	`opsChatMessageId` int,
	`acknowledgedAt` bigint,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `lead_assignments_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `scheduling_teams` ADD `regionTags` varchar(50);--> statement-breakpoint
CREATE INDEX `idx_la_session` ON `lead_assignments` (`sessionId`);--> statement-breakpoint
CREATE INDEX `idx_la_agent` ON `lead_assignments` (`agentId`);