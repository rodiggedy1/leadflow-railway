ALTER TABLE `conversation_sessions` MODIFY COLUMN `stage` enum('WIDGET_SIZING','REACTIVATION','QUOTE_SENT','AVAILABILITY','SLOT_CHOICE','TIME_PREF','ADDRESS','CONFIRMATION','CALL_SCHEDULED','DONE','UNHANDLED','BOOKED','NOT_INTERESTED','REVIEW_REQUESTED','REVIEW_DONE','FUTURE_BOOKING','FOLLOW_UP_SCHEDULED') NOT NULL DEFAULT 'QUOTE_SENT';--> statement-breakpoint
ALTER TABLE `conversation_sessions` ADD `lastAiMessageAt` timestamp;--> statement-breakpoint
ALTER TABLE `conversation_sessions` ADD `autoFollowUpSent` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `conversation_sessions` ADD `followUpDate` varchar(20);--> statement-breakpoint
ALTER TABLE `conversation_sessions` ADD `followUpMessage` text;--> statement-breakpoint
ALTER TABLE `conversation_sessions` ADD `followUpSent` int DEFAULT 0 NOT NULL;