ALTER TABLE `ops_chat_messages` ADD `threadParentId` int;--> statement-breakpoint
ALTER TABLE `cleaner_jobs` DROP COLUMN `proxySessionSid`;--> statement-breakpoint
ALTER TABLE `cleaner_jobs` DROP COLUMN `proxyNumber`;