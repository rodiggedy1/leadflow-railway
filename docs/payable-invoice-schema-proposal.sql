-- Local prepared schema, mirrored by six managed create-table migrations.
-- No migration has been executed against shared data. All existing tables remain unchanged.

-- Invoice feature: new table only. No shared-database execution authorized.
CREATE TABLE IF NOT EXISTS `payable_invoices` (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  number VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  accountId INT NOT NULL,
  clientName VARCHAR(255) NOT NULL,
  clientPhone VARCHAR(20) NOT NULL,
  clientEmail VARCHAR(320) NOT NULL,
  periodFrom VARCHAR(10) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  periodTo VARCHAR(10) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  dueDate VARCHAR(10) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  currency CHAR(3) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'usd',
  status ENUM('open','partially_paid','paid','void','payment_review') NOT NULL DEFAULT 'open',
  requestId CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  payloadHash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  reviewHash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  tokenHash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  tokenExpiresAt BIGINT UNSIGNED NOT NULL,
  activeAttemptId CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  createdAtMs BIGINT UNSIGNED NOT NULL,
  paidAtMs BIGINT UNSIGNED NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_payable_invoice_number (number),
  UNIQUE KEY uq_payable_invoice_request (requestId),
  UNIQUE KEY uq_payable_invoice_token (tokenHash),
  UNIQUE KEY uq_payable_invoice_active_attempt (activeAttemptId),
  KEY idx_payable_invoice_account_period (accountId, periodFrom, periodTo),
  CONSTRAINT ck_payable_invoice_currency CHECK (currency = 'usd'),
  CONSTRAINT ck_payable_invoice_period CHECK (periodFrom <= periodTo),
  CONSTRAINT ck_payable_invoice_paid_at CHECK ((status = 'paid' AND paidAtMs IS NOT NULL) OR (status <> 'paid' AND paidAtMs IS NULL))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

--> statement-breakpoint
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

--> statement-breakpoint
-- Invoice feature: new table only. No shared-database execution authorized.
CREATE TABLE IF NOT EXISTS `payable_invoice_attempts` (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  invoiceId INT UNSIGNED NOT NULL,
  requestId CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  selectedLineIds JSON NOT NULL,
  amountCents INT UNSIGNED NOT NULL,
  currency CHAR(3) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'usd',
  state ENUM('pending','session_open','paid','expired') NOT NULL DEFAULT 'pending',
  sessionId VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin NULL,
  sessionUrl VARCHAR(2048) CHARACTER SET ascii COLLATE ascii_bin NULL,
  paymentId VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin NULL,
  createdAtMs BIGINT UNSIGNED NOT NULL,
  paidAtMs BIGINT UNSIGNED NULL,
  refundedCents INT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  UNIQUE KEY uq_payable_attempt_request (invoiceId, requestId),
  UNIQUE KEY uq_payable_attempt_invoice_id (invoiceId, id),
  UNIQUE KEY uq_payable_attempt_session (sessionId),
  UNIQUE KEY uq_payable_attempt_payment (paymentId),
  CONSTRAINT fk_payable_attempt_invoice FOREIGN KEY (invoiceId) REFERENCES payable_invoices (id) ON DELETE RESTRICT,
  CONSTRAINT ck_payable_attempt_selection CHECK (JSON_TYPE(selectedLineIds) = 'ARRAY' AND JSON_LENGTH(selectedLineIds) BETWEEN 1 AND 1000),
  CONSTRAINT ck_payable_attempt_amount CHECK (amountCents BETWEEN 50 AND 99999999),
  CONSTRAINT ck_payable_attempt_currency CHECK (currency = 'usd'),
  CONSTRAINT ck_payable_attempt_paid CHECK ((state = 'paid' AND paymentId IS NOT NULL AND sessionId IS NOT NULL AND paidAtMs IS NOT NULL) OR (state <> 'paid' AND paymentId IS NULL AND paidAtMs IS NULL))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

--> statement-breakpoint
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

--> statement-breakpoint
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

--> statement-breakpoint
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
