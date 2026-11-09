-- Invoice feature: new table only. No shared-database execution authorized.
CREATE TABLE IF NOT EXISTS `payable_invoice_manual_payments` (
  occurrenceKey VARCHAR(100) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  sourceServiceId VARCHAR(100) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  accountId INT NOT NULL,
  serviceDate VARCHAR(10) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  amountCents INT UNSIGNED NOT NULL,
  requestId CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  payloadHash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  reviewHash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  recordedByAgentId INT NOT NULL,
  recordedAtMs BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (occurrenceKey),
  UNIQUE KEY uq_payable_manual_request_occurrence (requestId, occurrenceKey),
  KEY idx_payable_manual_account_date (accountId, serviceDate),
  CONSTRAINT ck_payable_manual_amount CHECK (amountCents > 0 AND amountCents <= 99999999)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
