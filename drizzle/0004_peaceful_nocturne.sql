CREATE TABLE `ops_chat_messages` (
	`id` int AUTO_INCREMENT NOT NULL,
	`cleanerJobId` int,
	`channel` varchar(64),
	`authorName` varchar(128) NOT NULL,
	`authorRole` varchar(32) NOT NULL DEFAULT 'office',
	`body` text NOT NULL,
	`mediaUrl` varchar(512),
	`quickAction` varchar(64),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `ops_chat_messages_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `idx_ocm_job` ON `ops_chat_messages` (`cleanerJobId`);--> statement-breakpoint
CREATE INDEX `idx_ocm_channel` ON `ops_chat_messages` (`channel`);--> statement-breakpoint
CREATE INDEX `idx_ocm_created_at` ON `ops_chat_messages` (`createdAt`);