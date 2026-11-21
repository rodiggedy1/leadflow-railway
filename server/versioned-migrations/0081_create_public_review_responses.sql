CREATE TABLE IF NOT EXISTS `public_review_responses` (
  `key` CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `revision` INT UNSIGNED NOT NULL,
  `entry` JSON NOT NULL,
  `updatedAtMs` BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (`key`),
  KEY `idx_public_review_responses_updated` (`updatedAtMs`, `key`),
  CONSTRAINT `chk_public_review_responses_binding` CHECK (
    `key` REGEXP '^[a-f0-9]{64}$'
    AND `revision` > 0
    AND `updatedAtMs` <= 9007199254740991
    AND JSON_TYPE(`entry`) = 'OBJECT'
    AND JSON_CONTAINS_PATH(`entry`, 'all', '$.key', '$.revision', '$.updatedAt') = 1
    AND JSON_TYPE(JSON_EXTRACT(`entry`, '$.key')) = 'STRING'
    AND BINARY JSON_UNQUOTE(JSON_EXTRACT(`entry`, '$.key')) = BINARY `key`
    AND JSON_TYPE(JSON_EXTRACT(`entry`, '$.revision')) = 'INTEGER'
    AND JSON_EXTRACT(`entry`, '$.revision') = `revision`
    AND JSON_TYPE(JSON_EXTRACT(`entry`, '$.updatedAt')) = 'INTEGER'
    AND JSON_EXTRACT(`entry`, '$.updatedAt') = `updatedAtMs`
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
