ALTER TABLE `booking_notification_deliveries`
  ADD COLUMN IF NOT EXISTS `claimToken` varchar(64) NULL;
--> statement-breakpoint
ALTER TABLE `booking_notification_deliveries`
  ADD COLUMN IF NOT EXISTS `claimedAt` datetime(3) NULL;
