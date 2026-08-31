CREATE TABLE IF NOT EXISTS `stripe_webhook_events` (
  `id` int AUTO_INCREMENT NOT NULL,
  `stripeEventId` varchar(255) NOT NULL,
  `eventType` varchar(128) NOT NULL,
  `objectId` varchar(255) NOT NULL,
  `bookingPaymentProfileId` int,
  `status` varchar(32) NOT NULL DEFAULT 'received',
  `errorMessage` text,
  `receivedAt` datetime(3) NOT NULL,
  `processedAt` datetime(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_stripe_webhook_event_id` (`stripeEventId`),
  KEY `idx_stripe_webhook_payment_profile` (`bookingPaymentProfileId`),
  KEY `idx_stripe_webhook_object` (`objectId`)
);
