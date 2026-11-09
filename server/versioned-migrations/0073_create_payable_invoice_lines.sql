-- Invoice feature: new table only. No shared-database execution authorized.
CREATE TABLE IF NOT EXISTS `payable_invoice_lines` (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  invoiceId INT UNSIGNED NOT NULL,
  sourceServiceId VARCHAR(100) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  occurrenceKey VARCHAR(100) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  serviceDate VARCHAR(10) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  description VARCHAR(500) NOT NULL,
  address VARCHAR(500) NOT NULL,
  amountCents INT UNSIGNED NOT NULL,
  paidCents INT UNSIGNED NOT NULL DEFAULT 0,
  manualPaidCents INT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  UNIQUE KEY uq_payable_line_occurrence (occurrenceKey),
  UNIQUE KEY uq_payable_line_invoice_id (invoiceId, id),
  KEY idx_payable_line_invoice_date (invoiceId, serviceDate, id),
  CONSTRAINT fk_payable_line_invoice FOREIGN KEY (invoiceId) REFERENCES payable_invoices (id) ON DELETE RESTRICT,
  CONSTRAINT ck_payable_line_amount CHECK (amountCents > 0 AND amountCents <= 99999999 AND paidCents <= amountCents AND manualPaidCents <= paidCents)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
