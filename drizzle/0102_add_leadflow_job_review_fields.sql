ALTER TABLE `leadflow_jobs` ADD COLUMN IF NOT EXISTS `customerRating` int;
--> statement-breakpoint
ALTER TABLE `leadflow_jobs` ADD COLUMN IF NOT EXISTS `reviewChipsSelected` text;
--> statement-breakpoint
ALTER TABLE `leadflow_jobs` ADD COLUMN IF NOT EXISTS `reviewFreeText` text;
--> statement-breakpoint
ALTER TABLE `leadflow_jobs` ADD COLUMN IF NOT EXISTS `reviewDrafts` text;
--> statement-breakpoint
ALTER TABLE `leadflow_jobs` ADD COLUMN IF NOT EXISTS `reviewDraftPicked` int;
--> statement-breakpoint
ALTER TABLE `leadflow_jobs` ADD COLUMN IF NOT EXISTS `reviewDraftText` text;
--> statement-breakpoint
ALTER TABLE `leadflow_jobs` ADD COLUMN IF NOT EXISTS `reviewCopied` tinyint NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE `leadflow_jobs` ADD COLUMN IF NOT EXISTS `reviewThumbtackOpenedAt` datetime(3);
--> statement-breakpoint
ALTER TABLE `leadflow_jobs` ADD COLUMN IF NOT EXISTS `reviewCompletionSmsClaimedAt` datetime(3);
--> statement-breakpoint
ALTER TABLE `leadflow_jobs` ADD COLUMN IF NOT EXISTS `reviewCompletionSmsSentAt` datetime(3);
