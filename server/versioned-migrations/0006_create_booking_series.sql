CREATE TABLE IF NOT EXISTS `booking_series` (
  `id` int AUTO_INCREMENT NOT NULL,
  `bookingId` int NOT NULL,
  `status` varchar(32) NOT NULL DEFAULT 'intent_pending',
  `frequency` varchar(32) NOT NULL,
  `anchorLocalDate` varchar(10) NOT NULL,
  `anchorLocalTime` varchar(5) NOT NULL,
  `timeZone` varchar(64) NOT NULL,
  `firstCleaningTotalCents` int NOT NULL,
  `futureVisitTotalCents` int NOT NULL,
  `createdAt` datetime(3) NOT NULL,
  `updatedAt` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_booking_series_booking` (`bookingId`),
  KEY `idx_booking_series_status` (`status`)
);
