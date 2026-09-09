ALTER TABLE `customer_portal_service_requests` ADD COLUMN IF NOT EXISTS `bookingId` int;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `uq_customer_portal_service_request_booking` ON `customer_portal_service_requests` (`bookingId`);
--> statement-breakpoint
ALTER TABLE `booking_payment_profiles` MODIFY COLUMN `funnelRecordId` int;
--> statement-breakpoint
ALTER TABLE `booking_payment_profiles` ADD COLUMN IF NOT EXISTS `serviceRequestId` int;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `uq_booking_payment_profile_service_request` ON `booking_payment_profiles` (`serviceRequestId`);
