-- Invoice feature: new table only. No shared-database execution authorized.
CREATE TABLE IF NOT EXISTS `payable_invoice_deliveries` (
  requestId CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  invoiceId INT UNSIGNED NOT NULL,
  recipient VARCHAR(320) NOT NULL,
  payloadHash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  state ENUM('pending','sent','unknown') NOT NULL DEFAULT 'pending',
  providerMessageId VARCHAR(255) NULL,
  createdAtMs BIGINT UNSIGNED NOT NULL,
  sentAtMs BIGINT UNSIGNED NULL,
  PRIMARY KEY (requestId),
  KEY idx_payable_delivery_invoice (invoiceId, createdAtMs),
  CONSTRAINT fk_payable_delivery_invoice FOREIGN KEY (invoiceId) REFERENCES payable_invoices (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
