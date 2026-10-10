CREATE TABLE IF NOT EXISTS `ai_action_policies` (
  `id` bigint AUTO_INCREMENT NOT NULL,
  `merchantId` varchar(128) NOT NULL,
  `actionKey` varchar(96) NOT NULL,
  `label` varchar(160) NOT NULL,
  `description` text NOT NULL,
  `category` varchar(64) NOT NULL,
  `mode` enum('approval_required','suggest_only','automatic') NOT NULL DEFAULT 'approval_required',
  `enabled` tinyint NOT NULL DEFAULT 1,
  `updatedBy` varchar(128),
  `createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_ai_action_policies_merchant_action` (`merchantId`,`actionKey`),
  KEY `idx_ai_action_policies_merchant_category` (`merchantId`,`category`)
);
