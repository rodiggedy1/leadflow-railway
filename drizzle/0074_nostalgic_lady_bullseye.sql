ALTER TABLE `conversation_sessions` ADD `aiClosingRecCache` text;--> statement-breakpoint
ALTER TABLE `conversation_sessions` ADD `aiClosingRecCachedAt` timestamp;--> statement-breakpoint
ALTER TABLE `conversation_sessions` ADD `aiClosingRecMsgLen` int;