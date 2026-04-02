ALTER TABLE `conversation_sessions` ADD `csPriorityTag` varchar(32);--> statement-breakpoint
ALTER TABLE `conversation_sessions` ADD `csPriorityReason` varchar(200);--> statement-breakpoint
ALTER TABLE `conversation_sessions` ADD `csPriorityTaggedAt` bigint;--> statement-breakpoint
ALTER TABLE `conversation_sessions` ADD `csPriorityDismissedAt` bigint;