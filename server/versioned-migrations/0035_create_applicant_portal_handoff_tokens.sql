CREATE TABLE IF NOT EXISTS `applicant_portal_handoff_tokens` (
  `id` int AUTO_INCREMENT NOT NULL,
  `candidateId` int NOT NULL,
  `tokenHash` varchar(64) NOT NULL,
  `expiresAt` bigint NOT NULL,
  `usedAt` datetime(3),
  `reusable` tinyint NOT NULL DEFAULT 0,
  `reusableToken` varchar(64),
  `createdAt` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_applicant_portal_handoff_hash` (`tokenHash`),
  KEY `idx_applicant_portal_handoff_candidate` (`candidateId`),
  KEY `idx_applicant_portal_handoff_expiry` (`expiresAt`)
);
