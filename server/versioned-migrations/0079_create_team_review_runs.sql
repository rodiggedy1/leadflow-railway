-- Weekly history storage: isolated new table only; no operational data changes.
CREATE TABLE IF NOT EXISTS `team_review_runs` (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  weekStart CHAR(10) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  ownerId INT UNSIGNED NOT NULL,
  createdAtMs BIGINT UNSIGNED NOT NULL,
  updatedAtMs BIGINT UNSIGNED NOT NULL,
  status VARCHAR(32) NOT NULL,
  progress JSON NULL,
  payload JSON NOT NULL,
  publication JSON NULL,
  publishedAtMs BIGINT UNSIGNED NULL,
  publishedBy INT UNSIGNED NULL,
  PRIMARY KEY (id),
  KEY idx_team_review_runs_week_created (weekStart, createdAtMs, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
