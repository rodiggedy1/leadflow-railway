ALTER TABLE `madison_conversation_fact_events` ADD COLUMN IF NOT EXISTS `validationStatus` enum('unverified','validated','rejected') NOT NULL DEFAULT 'unverified';
--> statement-breakpoint
ALTER TABLE `madison_conversation_fact_events` ADD COLUMN IF NOT EXISTS `evidenceExcerpt` text;
--> statement-breakpoint
ALTER TABLE `madison_conversation_fact_events` ADD COLUMN IF NOT EXISTS `normalizationContext` json;
