ALTER TABLE `conversation_sessions` ADD `utmSource` varchar(100);--> statement-breakpoint
ALTER TABLE `conversation_sessions` ADD `utmMedium` varchar(100);--> statement-breakpoint
ALTER TABLE `conversation_sessions` ADD `utmCampaign` varchar(255);--> statement-breakpoint
ALTER TABLE `conversation_sessions` ADD `utmContent` varchar(255);--> statement-breakpoint
ALTER TABLE `conversation_sessions` ADD `gclid` varchar(255);