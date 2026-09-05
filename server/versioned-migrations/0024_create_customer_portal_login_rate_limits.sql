CREATE TABLE IF NOT EXISTS `customer_portal_login_rate_limits` (
  `id` int AUTO_INCREMENT NOT NULL,
  `scope` varchar(32) NOT NULL,
  `keyHash` varchar(64) NOT NULL,
  `windowStartedAt` bigint NOT NULL,
  `requestCount` int NOT NULL DEFAULT 0,
  `updatedAt` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_customer_portal_login_rate_limit` (`scope`, `keyHash`),
  KEY `idx_customer_portal_login_rate_window` (`windowStartedAt`)
);
