ALTER TABLE `conversation_sessions` MODIFY COLUMN `leadSource` varchar(50);--> statement-breakpoint
ALTER TABLE `conversation_sessions` ADD `barkQA` text;