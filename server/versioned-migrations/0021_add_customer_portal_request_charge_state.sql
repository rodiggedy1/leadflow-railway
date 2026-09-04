ALTER TABLE `customer_portal_service_requests` ADD COLUMN IF NOT EXISTS `stripePaymentIntentId` varchar(255);
--> statement-breakpoint
ALTER TABLE `customer_portal_service_requests` ADD COLUMN IF NOT EXISTS `paymentChargedAt` bigint;
