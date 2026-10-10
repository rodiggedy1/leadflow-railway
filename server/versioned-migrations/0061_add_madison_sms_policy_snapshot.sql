ALTER TABLE `madison_sms_drafts` ADD COLUMN IF NOT EXISTS `sendPolicyMode` varchar(32) NOT NULL DEFAULT 'approval_required';
--> statement-breakpoint
ALTER TABLE `madison_sms_drafts` ADD COLUMN IF NOT EXISTS `sendPolicyEnabled` tinyint NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE `madison_sms_drafts` ADD COLUMN IF NOT EXISTS `sendPolicyEvaluatedAt` datetime(3) NULL;
