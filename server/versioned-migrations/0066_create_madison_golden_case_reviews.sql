CREATE TABLE IF NOT EXISTS `madison_golden_case_reviews` (
  `id` bigint AUTO_INCREMENT NOT NULL,
  `caseId` varchar(32) NOT NULL,
  `rating` enum('correct','incorrect','uncertain') NOT NULL,
  `reviewer` varchar(128) NOT NULL,
  `notes` text,
  `actualPrediction` json,
  `reviewedAt` datetime(3) NOT NULL,
  `updatedAt` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_madison_golden_case_review_case` (`caseId`)
);
