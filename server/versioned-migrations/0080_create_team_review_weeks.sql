-- One transactional latest-publication pointer per week, including first publish.
CREATE TABLE IF NOT EXISTS `team_review_weeks` (
  weekStart CHAR(10) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  latestPublicationId CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  updatedAtMs BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (weekStart)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
