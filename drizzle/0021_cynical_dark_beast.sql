CREATE TABLE `push_subscriptions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`agentKey` varchar(128) NOT NULL,
	`endpoint` varchar(2048) NOT NULL,
	`keys` text NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`lastUsedAt` timestamp,
	CONSTRAINT `push_subscriptions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `idx_ps_agent` ON `push_subscriptions` (`agentKey`);--> statement-breakpoint
CREATE INDEX `idx_ps_endpoint` ON `push_subscriptions` (`endpoint`);