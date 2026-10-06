CREATE TABLE IF NOT EXISTS `madison_sms_draft_edits` (
  `id` bigint AUTO_INCREMENT NOT NULL,
  `draftId` bigint NOT NULL,
  `originalText` text NOT NULL,
  `editedText` text NOT NULL,
  `editedBy` varchar(128) NOT NULL,
  `editedAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_madison_sms_draft_edits_draft` (`draftId`),
  KEY `idx_madison_sms_draft_edits_time` (`editedAt`)
);
