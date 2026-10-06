CREATE TABLE IF NOT EXISTS `madison_customer_mission_facts` (
  `id` bigint AUTO_INCREMENT NOT NULL,
  `missionId` bigint NOT NULL,
  `factKey` varchar(96) NOT NULL,
  `value` json NOT NULL,
  `source` enum('customer_sms','leadflow_context') NOT NULL,
  `sourceRecordId` varchar(128),
  `sourceMessageId` varchar(128),
  `confidence` enum('verified','customer_stated') NOT NULL,
  `observedAt` datetime(3) NOT NULL,
  `verifiedAt` datetime(3),
  `expiresAt` datetime(3),
  `createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_madison_customer_mission_facts_key` (`missionId`,`factKey`),
  KEY `idx_madison_customer_mission_facts_source_message` (`sourceMessageId`),
  KEY `idx_madison_customer_mission_facts_expires` (`expiresAt`)
);
