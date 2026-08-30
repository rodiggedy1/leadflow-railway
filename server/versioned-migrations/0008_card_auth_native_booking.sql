ALTER TABLE `card_auth_tokens` ADD COLUMN IF NOT EXISTS `nativeBookingId` int NULL AFTER `cleanerJobId`;
