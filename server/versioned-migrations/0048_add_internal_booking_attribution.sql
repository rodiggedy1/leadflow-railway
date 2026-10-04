ALTER TABLE `bookings` ADD COLUMN IF NOT EXISTS `bookedByAgentId` int NULL;
--> statement-breakpoint
ALTER TABLE `bookings` ADD COLUMN IF NOT EXISTS `bookedByAgentName` varchar(255) NULL;
