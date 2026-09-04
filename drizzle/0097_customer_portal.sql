CREATE TABLE IF NOT EXISTS `customer_portal_accounts` (
  `id` int AUTO_INCREMENT NOT NULL,
  `customerName` varchar(255) NOT NULL,
  `customerPhone` varchar(20) NOT NULL,
  `customerEmail` varchar(320),
  `createdAt` datetime(3) NOT NULL,
  `updatedAt` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_customer_portal_account_phone` (`customerPhone`),
  KEY `idx_customer_portal_account_email` (`customerEmail`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `customer_portal_handoff_tokens` (
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
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `customer_portal_service_requests` (
  `id` int AUTO_INCREMENT NOT NULL,
  `publicRequestNumber` varchar(40) NOT NULL,
  `accountId` int NOT NULL,
  `serviceId` varchar(64) NOT NULL,
  `serviceName` varchar(120) NOT NULL,
  `status` varchar(32) NOT NULL DEFAULT 'requested',
  `customerName` varchar(255) NOT NULL,
  `customerPhone` varchar(20) NOT NULL,
  `customerEmail` varchar(320),
  `customerRequest` text NOT NULL,
  `scopeSelections` json NOT NULL,
  `address` varchar(500) NOT NULL,
  `requestedLocalDate` varchar(10) NOT NULL,
  `requestedLocalTime` varchar(80) NOT NULL,
  `estimatedTotalCents` int NOT NULL,
  `estimateRequiresReview` tinyint NOT NULL DEFAULT 1,
  `createdAt` datetime(3) NOT NULL,
  `updatedAt` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_customer_portal_service_request_number` (`publicRequestNumber`),
  KEY `idx_customer_portal_service_request_account` (`accountId`, `createdAt`),
  KEY `idx_customer_portal_service_request_schedule` (`requestedLocalDate`, `status`)
);
