CREATE TABLE IF NOT EXISTS `booking_notification_deliveries` (
  `id` int AUTO_INCREMENT NOT NULL,
  `bookingId` int NOT NULL,
  `channel` varchar(32) NOT NULL,
  `status` varchar(32) NOT NULL DEFAULT 'pending',
  `providerMessageId` varchar(255),
  `errorMessage` text,
  `createdAt` datetime(3) NOT NULL,
  `updatedAt` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_booking_notification_delivery_channel` (`bookingId`, `channel`),
  KEY `idx_booking_notification_delivery_status` (`status`)
);
