CREATE TABLE `ops_chat_reactions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`messageId` int NOT NULL,
	`callerId` varchar(128) NOT NULL,
	`callerName` varchar(128) NOT NULL,
	`emoji` varchar(8) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `ops_chat_reactions_id` PRIMARY KEY(`id`),
	CONSTRAINT `uniq_ocreact` UNIQUE(`messageId`,`callerId`,`emoji`)
);
--> statement-breakpoint
CREATE INDEX `idx_ocreact_msg` ON `ops_chat_reactions` (`messageId`);--> statement-breakpoint
CREATE INDEX `idx_ocreact_caller` ON `ops_chat_reactions` (`callerId`);