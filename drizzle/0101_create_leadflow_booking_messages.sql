CREATE TABLE IF NOT EXISTS `leadflow_booking_messages` (
  `id` int AUTO_INCREMENT NOT NULL,
  `leadflowJobId` int NOT NULL,
  `senderRole` varchar(16) NOT NULL,
  `body` text NOT NULL,
  `cleanerProfileId` int,
  `customerPortalAccountId` int,
  `notificationStatus` varchar(24) NOT NULL DEFAULT 'not_applicable',
  `notificationMessageId` varchar(255),
  `notificationError` text,
  `notificationSentAt` datetime(3),
  `createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_leadflow_booking_messages_job_created` (`leadflowJobId`, `createdAt`),
  KEY `idx_leadflow_booking_messages_account_created` (`customerPortalAccountId`, `createdAt`)
);
