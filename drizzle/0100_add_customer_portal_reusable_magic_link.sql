ALTER TABLE `customer_portal_handoff_tokens` ADD COLUMN IF NOT EXISTS `reusable` tinyint NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE `customer_portal_handoff_tokens` ADD COLUMN IF NOT EXISTS `reusableToken` varchar(64);
