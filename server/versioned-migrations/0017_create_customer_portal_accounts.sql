CREATE TABLE `customer_portal_accounts` (
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
