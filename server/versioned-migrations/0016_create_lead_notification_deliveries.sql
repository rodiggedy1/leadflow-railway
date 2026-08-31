CREATE TABLE IF NOT EXISTS `lead_notification_deliveries` (
  `id` int AUTO_INCREMENT NOT NULL,
  `funnelRecordId` int NOT NULL,
  `channel` varchar(32) NOT NULL,
  `status` varchar(32) NOT NULL DEFAULT 'pending',
  `claimToken` varchar(64) NULL,
  `claimedAt` datetime(3) NULL,
  `providerMessageId` varchar(255) NULL,
  `errorMessage` text NULL,
  `createdAt` datetime(3) NOT NULL,
  `updatedAt` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_lead_notification_delivery_channel` (`funnelRecordId`, `channel`),
  KEY `idx_lead_notification_delivery_status` (`status`)
);
