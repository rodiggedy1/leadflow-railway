CREATE TABLE IF NOT EXISTS `sms_shadow_evaluations` (
  `id` bigint AUTO_INCREMENT NOT NULL,
  `sessionId` bigint NOT NULL,
  `draftHash` char(64) NOT NULL,
  `policyVersion` varchar(64) NOT NULL,
  `source` varchar(32) NOT NULL,
  `decision` varchar(16) NOT NULL,
  `score` int NOT NULL,
  `confidence` decimal(5,4) NOT NULL,
  `reasonCode` varchar(96) NOT NULL,
  `rationale` varchar(512) NOT NULL,
  `preflight` json NOT NULL,
  `verifierResult` json,
  `outcome` varchar(24),
  `outcomeAt` datetime(3),
  `outcomeActor` varchar(255),
  `sentDraftHash` char(64),
  `createdAt` datetime(3) NOT NULL,
  `updatedAt` datetime(3) NOT NULL,
  CONSTRAINT `sms_shadow_evaluations_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `uq_sms_shadow_session_draft_policy`
  ON `sms_shadow_evaluations` (`sessionId`, `draftHash`, `policyVersion`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_sms_shadow_created`
  ON `sms_shadow_evaluations` (`createdAt`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_sms_shadow_decision`
  ON `sms_shadow_evaluations` (`decision`, `createdAt`);
