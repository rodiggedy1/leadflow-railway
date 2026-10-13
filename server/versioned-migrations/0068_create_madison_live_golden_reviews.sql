CREATE TABLE IF NOT EXISTS `madison_live_golden_reviews` (
  `id` bigint AUTO_INCREMENT NOT NULL,
  `reviewKey` varchar(64) NOT NULL,
  `sessionId` bigint NOT NULL,
  `inboundMessage` text NOT NULL,
  `standardResponse` text NOT NULL,
  `goldenResponse` text,
  `score` bigint NOT NULL,
  `failureTags` json NOT NULL,
  `notes` text,
  `reviewer` varchar(128) NOT NULL,
  `createdAt` datetime(3) NOT NULL,
  `updatedAt` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_madison_live_golden_review_key` (`reviewKey`),
  KEY `idx_madison_live_golden_review_session` (`sessionId`)
);
