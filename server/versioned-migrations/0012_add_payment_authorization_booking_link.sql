ALTER TABLE `payment_authorizations`
  ADD COLUMN IF NOT EXISTS `bookingPaymentProfileId` int NULL;
--> statement-breakpoint
ALTER TABLE `payment_authorizations`
  ADD COLUMN IF NOT EXISTS `operation` varchar(32) NOT NULL DEFAULT 'authorization';
--> statement-breakpoint
ALTER TABLE `payment_authorizations`
  ADD COLUMN IF NOT EXISTS `captureBefore` bigint NULL;
