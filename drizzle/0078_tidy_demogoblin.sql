CREATE TABLE `cleaner_magic_link_tokens` (
	`id` int AUTO_INCREMENT NOT NULL,
	`cleanerProfileId` int NOT NULL,
	`token` varchar(128) NOT NULL,
	`expiresAt` timestamp NOT NULL,
	`used` tinyint NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `cleaner_magic_link_tokens_id` PRIMARY KEY(`id`),
	CONSTRAINT `cleaner_magic_link_tokens_token_unique` UNIQUE(`token`)
);
--> statement-breakpoint
CREATE INDEX `idx_cmlt_cleaner_profile` ON `cleaner_magic_link_tokens` (`cleanerProfileId`);--> statement-breakpoint
CREATE INDEX `idx_cmlt_token` ON `cleaner_magic_link_tokens` (`token`);