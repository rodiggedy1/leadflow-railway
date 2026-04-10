ALTER TABLE `conversation_sessions` ADD `csStatusTier` varchar(32);--> statement-breakpoint
ALTER TABLE `conversation_sessions` ADD `csStatusTieredAt` bigint;--> statement-breakpoint
ALTER TABLE `conversation_sessions` ADD `csStatusMsgLen` int;