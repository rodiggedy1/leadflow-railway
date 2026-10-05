ALTER TABLE `booking_funnel_records` ADD COLUMN IF NOT EXISTS `bookedByAgentId` int NULL;
--> statement-breakpoint
ALTER TABLE `booking_funnel_records` ADD COLUMN IF NOT EXISTS `bookedByAgentName` varchar(255) NULL;
