ALTER TABLE `ops_chat_messages` ADD `replyToId` int;--> statement-breakpoint
ALTER TABLE `ops_chat_messages` ADD `replyToBody` varchar(512);--> statement-breakpoint
ALTER TABLE `ops_chat_messages` ADD `replyToAuthor` varchar(128);