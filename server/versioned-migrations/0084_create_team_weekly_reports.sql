-- Phase 3 team weekly reports: one row per SMS report attempt to one team for one week.
-- (weekStart, teamId, attempt) is unique, so two clicks or two staff members can never send the same attempt twice;
-- a deliberate resend is a new attempt. Holds only the team's own report text and phone, no customer data.
CREATE TABLE IF NOT EXISTS `team_weekly_reports` (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  weekStart CHAR(10) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  teamId INT NOT NULL,
  attempt INT UNSIGNED NOT NULL,
  teamName VARCHAR(255) NOT NULL,
  cleanerProfileId INT NOT NULL,
  phone VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  language CHAR(2) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  provisional TINYINT UNSIGNED NOT NULL,
  messageText TEXT NOT NULL,
  status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  error VARCHAR(255) NULL,
  providerMessageId VARCHAR(128) NULL,
  requestedBy INT NOT NULL,
  createdAtMs BIGINT UNSIGNED NOT NULL,
  updatedAtMs BIGINT UNSIGNED NOT NULL,
  sentAtMs BIGINT UNSIGNED NULL,
  PRIMARY KEY (id),
  UNIQUE KEY team_weekly_reports_attempt (weekStart, teamId, attempt),
  KEY team_weekly_reports_week (weekStart)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
