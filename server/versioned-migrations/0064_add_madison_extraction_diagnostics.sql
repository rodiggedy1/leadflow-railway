ALTER TABLE `madison_message_understanding` ADD COLUMN IF NOT EXISTS `extractionStatus` enum('COMPLETE','PARTIAL','NO_FACTS_PRESENT','EXTRACTION_FAILED','VALIDATION_FAILED') NOT NULL DEFAULT 'NO_FACTS_PRESENT';
--> statement-breakpoint
ALTER TABLE `madison_message_understanding` ADD COLUMN IF NOT EXISTS `extractionQualityNote` text;
