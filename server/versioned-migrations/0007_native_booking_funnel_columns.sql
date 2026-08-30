ALTER TABLE `bookings` ADD COLUMN `funnelStage` varchar(32) NOT NULL DEFAULT 'lead' AFTER `source`;
ALTER TABLE `bookings` ADD COLUMN `stripeCardAuthToken` varchar(64) NULL AFTER `priceSnapshot`;
ALTER TABLE `bookings` ADD COLUMN `stripeCustomerId` varchar(255) NULL AFTER `stripeCardAuthToken`;
ALTER TABLE `bookings` ADD COLUMN `stripePaymentMethodId` varchar(255) NULL AFTER `stripeCustomerId`;
ALTER TABLE `bookings` ADD COLUMN `cardBrand` varchar(40) NULL AFTER `stripePaymentMethodId`;
ALTER TABLE `bookings` ADD COLUMN `cardLast4` varchar(4) NULL AFTER `cardBrand`;
ALTER TABLE `bookings` ADD COLUMN `cardExpMonth` int NULL AFTER `cardLast4`;
ALTER TABLE `bookings` ADD COLUMN `cardExpYear` int NULL AFTER `cardExpMonth`;
ALTER TABLE `bookings` ADD COLUMN `cardSavedAt` bigint NULL AFTER `cardExpYear`;
