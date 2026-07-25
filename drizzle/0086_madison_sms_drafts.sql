-- Migration: 0086_madison_sms_drafts
-- Creates the madison_sms_drafts table for the Madison SMS Draft Agent pipeline.
-- Safe to run: CREATE TABLE IF NOT EXISTS means it's a no-op if the table already exists.
CREATE TABLE IF NOT EXISTS `madison_sms_drafts` (
  `id` bigint AUTO_INCREMENT NOT NULL,
  `inboundOpenPhoneId` varchar(128) NOT NULL,
  `sessionId` bigint NOT NULL,
  `fromPhone` varchar(30) NOT NULL,
  `senderName` varchar(255),
  `senderType` enum('customer','cleaner','unknown') NOT NULL DEFAULT 'unknown',
  `status` enum('RECEIVED','CLASSIFIED','TOOLS_RUNNING','DRAFT_READY','SENDING','SENT','DELIVERED','DISMISSED','FAILED') NOT NULL DEFAULT 'RECEIVED',
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
  `generatedDraft` text,
  `approvedText` text,
  `approvedBy` varchar(128),
  `approvedAt` datetime(3),
  `dismissedBy` varchar(128),
  `dismissedAt` datetime(3),
  `outboundOpenPhoneId` varchar(128),
  `sentAt` datetime(3),
  `deliveredAt` datetime(3),
  `errorStage` varchar(64),
  `errorCode` varchar(64),
  `errorMessage` text,
  `createdAt` datetime(3) NOT NULL,
  `updatedAt` datetime(3) NOT NULL,
  CONSTRAINT `madison_sms_drafts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `uq_sms_draft_inbound` ON `madison_sms_drafts` (`inboundOpenPhoneId`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_sms_draft_status` ON `madison_sms_drafts` (`status`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_sms_draft_session` ON `madison_sms_drafts` (`sessionId`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_sms_draft_capability` ON `madison_sms_drafts` (`capability`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_sms_draft_created` ON `madison_sms_drafts` (`createdAt`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_sms_draft_status_created` ON `madison_sms_drafts` (`status`, `createdAt`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_sms_draft_outbound` ON `madison_sms_drafts` (`outboundOpenPhoneId`);
