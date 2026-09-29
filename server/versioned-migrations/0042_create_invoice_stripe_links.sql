CREATE TABLE IF NOT EXISTS `invoice_stripe_links` (
  `id` int AUTO_INCREMENT NOT NULL,
  `invoiceId` int NOT NULL,
  `stripeInvoiceId` varchar(255) NOT NULL,
  `stripeCustomerId` varchar(255) NOT NULL,
  `stripeInvoiceStatus` varchar(32) NOT NULL DEFAULT 'draft',
  `hostedInvoiceUrl` varchar(1000),
  `paidAt` datetime(3),
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_invoice_stripe_links_invoice` (`invoiceId`),
  UNIQUE KEY `uq_invoice_stripe_links_stripe_invoice` (`stripeInvoiceId`),
  KEY `idx_invoice_stripe_links_status` (`stripeInvoiceStatus`)
);
