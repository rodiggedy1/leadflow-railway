CREATE TABLE IF NOT EXISTS `focus_points` (
	`id` int AUTO_INCREMENT NOT NULL,
	`agentName` varchar(128) NOT NULL,
	`points` int NOT NULL DEFAULT 0,
	`weekStart` varchar(10) NOT NULL,
	`createdAt` datetime(3) NOT NULL,
	`updatedAt` datetime(3) NOT NULL,
	CONSTRAINT `focus_points_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `uq_focus_points_agent_week` ON `focus_points` (`agentName`, `weekStart`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_focus_points_week` ON `focus_points` (`weekStart`);
