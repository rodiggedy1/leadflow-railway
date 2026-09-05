CREATE TABLE IF NOT EXISTS `customer_portal_login_codes` (
  `id` int AUTO_INCREMENT NOT NULL,
  `accountId` int NOT NULL,
  `codeHash` varchar(64) NOT NULL,
  `expiresAt` bigint NOT NULL,
  `usedAt` datetime(3),
  `failedAttempts` int NOT NULL DEFAULT 0,
  `lockedUntil` bigint,
  `createdAt` datetime(3) NOT NULL,
  `updatedAt` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_customer_portal_login_code_account` (`accountId`, `expiresAt`),
  KEY `idx_customer_portal_login_code_expiry` (`expiresAt`)
);
