CREATE TABLE IF NOT EXISTS `cash_app_payment_tokens` (
  `id` int NOT NULL AUTO_INCREMENT,
  `token` varchar(64) NOT NULL,
  `customerPhone` varchar(30) NOT NULL,
  `customerName` varchar(255),
  `amountCents` int NOT NULL,
  `description` varchar(255) NOT NULL,
  `status` varchar(24) NOT NULL DEFAULT 'open',
  `stripePaymentIntentId` varchar(255),
  `expiresAt` bigint NOT NULL,
  `paidAt` bigint,
  `createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_cash_app_payment_tokens_token` (`token`),
  KEY `idx_cash_app_payment_tokens_status` (`status`),
  KEY `idx_cash_app_payment_tokens_expires` (`expiresAt`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
