ALTER TABLE `bookings` ADD COLUMN IF NOT EXISTS `funnelStage` varchar(32) NOT NULL DEFAULT 'lead' AFTER `source`;
ALTER TABLE `bookings` ADD COLUMN IF NOT EXISTS `stripeCardAuthToken` varchar(64) NULL AFTER `priceSnapshot`;
ALTER TABLE `bookings` ADD COLUMN IF NOT EXISTS `stripeCustomerId` varchar(255) NULL AFTER `stripeCardAuthToken`;
ALTER TABLE `bookings` ADD COLUMN IF NOT EXISTS `stripePaymentMethodId` varchar(255) NULL AFTER `stripeCustomerId`;
ALTER TABLE `bookings` ADD COLUMN IF NOT EXISTS `cardBrand` varchar(40) NULL AFTER `stripePaymentMethodId`;
ALTER TABLE `bookings` ADD COLUMN IF NOT EXISTS `cardLast4` varchar(4) NULL AFTER `cardBrand`;
ALTER TABLE `bookings` ADD COLUMN IF NOT EXISTS `cardExpMonth` int NULL AFTER `cardLast4`;
ALTER TABLE `bookings` ADD COLUMN IF NOT EXISTS `cardExpYear` int NULL AFTER `cardExpMonth`;
ALTER TABLE `bookings` ADD COLUMN IF NOT EXISTS `cardSavedAt` bigint NULL AFTER `cardExpYear`;
