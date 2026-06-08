CREATE TABLE `chat_super_alerts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`messageId` int NOT NULL,
	`channel` varchar(64) NOT NULL DEFAULT 'command',
	`targetAgentName` varchar(255) NOT NULL,
	`senderName` varchar(255) NOT NULL,
	`messageBody` text NOT NULL,
	`repliedAt` bigint,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `chat_super_alerts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `idx_csa_message` ON `chat_super_alerts` (`messageId`);--> statement-breakpoint
CREATE INDEX `idx_csa_target` ON `chat_super_alerts` (`targetAgentName`);