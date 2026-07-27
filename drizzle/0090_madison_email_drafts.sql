CREATE TABLE IF NOT EXISTS `madison_email_drafts` (
  `id` bigint AUTO_INCREMENT NOT NULL,
  `threadId` varchar(255) NOT NULL,
  `inboundMessageId` varchar(255) NOT NULL,
  `sessionId` bigint,
  `fromEmail` varchar(320) NOT NULL,
  `senderName` varchar(255),
  `subject` varchar(998),
  `status` enum('RECEIVED','CLASSIFIED','TOOLS_RUNNING','DRAFT_READY','SENDING','SENT','DISMISSED','FAILED') NOT NULL DEFAULT 'RECEIVED',
  `messageType` enum('QUESTION','ACTION','INFORMATION','CONVERSATION','UNKNOWN'),
  `intent` varchar(64),
  `capability` varchar(64),
  `capabilityVersion` int,
  `resolvedContext` json,
  `capabilityArgs` json,
  `capabilityResult` json,
  `observations` json NOT NULL DEFAULT ('[]'),
  `suggestedActions` json NOT NULL DEFAULT ('[]'),
  `followUps` json NOT NULL DEFAULT ('[]'),
  `qualityScore` json,
  `originalMessage` text NOT NULL,
  `intentSummary` text,
  `generatedDraft` text,
  `approvedText` text,
  `approvedBy` varchar(128),
  `approvedAt` datetime(3),
  `dismissedBy` varchar(128),
  `dismissedAt` datetime(3),
  `outboundMessageId` varchar(255),
  `sentAt` datetime(3),
  `errorStage` varchar(64),
  `errorCode` varchar(64),
  `errorMessage` text,
  `createdAt` datetime(3) NOT NULL,
  `updatedAt` datetime(3) NOT NULL,
  CONSTRAINT `madison_email_drafts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `uq_email_draft_inbound` ON `madison_email_drafts` (`inboundMessageId`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_email_draft_status` ON `madison_email_drafts` (`status`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_email_draft_thread` ON `madison_email_drafts` (`threadId`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_email_draft_created` ON `madison_email_drafts` (`createdAt`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_email_draft_status_created` ON `madison_email_drafts` (`status`, `createdAt`);
