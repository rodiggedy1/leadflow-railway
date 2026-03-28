ALTER TABLE `agents` ADD `profilePhotoUrl` varchar(1024);--> statement-breakpoint
ALTER TABLE `ops_reminders` ADD `callerId` varchar(128);--> statement-breakpoint
ALTER TABLE `ops_reminders` ADD `dismissedAt` bigint;--> statement-breakpoint
ALTER TABLE `ops_reminders` ADD `snoozedUntil` bigint;