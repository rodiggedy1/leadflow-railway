ALTER TABLE `customer_portal_service_requests` ADD COLUMN IF NOT EXISTS `paymentBrand` varchar(40);
ALTER TABLE `customer_portal_service_requests` ADD COLUMN IF NOT EXISTS `paymentLast4` varchar(4);
ALTER TABLE `customer_portal_service_requests` ADD COLUMN IF NOT EXISTS `stripePaymentMethodId` varchar(255);
