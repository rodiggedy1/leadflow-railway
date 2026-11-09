-- Invoice feature: new table only. No shared-database execution authorized.
CREATE TABLE IF NOT EXISTS `payable_invoice_allocations` (
  invoiceId INT UNSIGNED NOT NULL,
  attemptId CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  lineId INT UNSIGNED NOT NULL,
  paymentId VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  amountCents INT UNSIGNED NOT NULL,
  paidAtMs BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (attemptId, lineId),
  UNIQUE KEY uq_payable_allocation_line (lineId),
  KEY idx_payable_allocation_invoice (invoiceId, paidAtMs, attemptId, lineId),
  KEY idx_payable_allocation_payment (paymentId),
  CONSTRAINT fk_payable_allocation_invoice FOREIGN KEY (invoiceId) REFERENCES payable_invoices (id) ON DELETE RESTRICT,
  CONSTRAINT fk_payable_allocation_attempt FOREIGN KEY (invoiceId, attemptId) REFERENCES payable_invoice_attempts (invoiceId, id) ON DELETE RESTRICT,
  CONSTRAINT fk_payable_allocation_line FOREIGN KEY (invoiceId, lineId) REFERENCES payable_invoice_lines (invoiceId, id) ON DELETE RESTRICT,
  CONSTRAINT ck_payable_allocation_amount CHECK (amountCents > 0 AND amountCents <= 99999999)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
