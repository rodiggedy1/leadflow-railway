ALTER TABLE `leadflow_jobs` ADD COLUMN IF NOT EXISTS `hasStripeCard` tinyint NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE `leadflow_jobs` ADD COLUMN IF NOT EXISTS `paymentBrand` varchar(50);
--> statement-breakpoint
ALTER TABLE `leadflow_jobs` ADD COLUMN IF NOT EXISTS `paymentLast4` varchar(4);
--> statement-breakpoint
ALTER TABLE `leadflow_jobs` ADD COLUMN IF NOT EXISTS `nextOccurrenceCreatedAt` datetime(3);
