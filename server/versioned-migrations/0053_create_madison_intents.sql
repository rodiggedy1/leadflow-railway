CREATE TABLE IF NOT EXISTS `madison_intents` (
  `id` bigint AUTO_INCREMENT NOT NULL,
  `decisionId` bigint NOT NULL,
  `intentKey` varchar(64) NOT NULL,
  `intentType` enum('INFORMATIONAL','NEW_BOOKING','MODIFY_BOOKING','CANCEL_BOOKING','SERVICE_REQUEST','SERVICE_COMPLAINT','PAYMENT_ISSUE','REFUND_CREDIT','TEAM_ETA','CUSTOMER_INFO_UPDATE','OTHER_OPERATIONAL','UNCLEAR') NOT NULL,
  `confidence` decimal(5,4),
  `evidence` json NOT NULL,
  `uncertainties` json NOT NULL,
  `target` json NOT NULL,
  `request` json NOT NULL,
  `createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_madison_intents_decision_key` (`decisionId`,`intentKey`),
  KEY `idx_madison_intents_decision` (`decisionId`),
  KEY `idx_madison_intents_type` (`intentType`)
);
