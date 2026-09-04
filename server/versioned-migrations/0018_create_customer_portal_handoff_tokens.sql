CREATE TABLE `customer_portal_handoff_tokens` (
  `id` int AUTO_INCREMENT NOT NULL,
  `accountId` int NOT NULL,
  `tokenHash` varchar(64) NOT NULL,
  `expiresAt` bigint NOT NULL,
  `usedAt` datetime(3),
  `createdAt` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_customer_portal_handoff_hash` (`tokenHash`),
  KEY `idx_customer_portal_handoff_account` (`accountId`),
  KEY `idx_customer_portal_handoff_expiry` (`expiresAt`)
);
