CREATE TABLE `channel_pins` (
	`id` int AUTO_INCREMENT NOT NULL,
	`channel` varchar(64) NOT NULL,
	`body` text NOT NULL,
	`authorName` varchar(128) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`dismissedAt` timestamp,
	CONSTRAINT `channel_pins_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `ops_reminders` (
	`id` int AUTO_INCREMENT NOT NULL,
	`channel` varchar(64) NOT NULL,
	`body` text NOT NULL,
	`authorName` varchar(128) NOT NULL,
	`triggerAt` bigint NOT NULL,
	`firedAt` bigint,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `ops_reminders_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `idx_cp_channel` ON `channel_pins` (`channel`);--> statement-breakpoint
CREATE INDEX `idx_or_trigger` ON `ops_reminders` (`triggerAt`);--> statement-breakpoint
CREATE INDEX `idx_or_fired` ON `ops_reminders` (`firedAt`);