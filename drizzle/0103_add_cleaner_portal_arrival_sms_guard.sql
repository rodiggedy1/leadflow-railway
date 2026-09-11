ALTER TABLE `cleaner_portal_job_progress` ADD COLUMN IF NOT EXISTS `arrivalSmsClaimedAt` datetime(3);
--> statement-breakpoint
ALTER TABLE `cleaner_portal_job_progress` ADD COLUMN IF NOT EXISTS `arrivalSmsSentAt` datetime(3);
--> statement-breakpoint
ALTER TABLE `cleaner_portal_job_progress` ADD COLUMN IF NOT EXISTS `arrivalSmsMessageId` varchar(128);
--> statement-breakpoint
ALTER TABLE `cleaner_portal_job_progress` ADD COLUMN IF NOT EXISTS `arrivalSmsError` text;
--> statement-breakpoint
ALTER TABLE `cleaner_portal_job_progress` ADD COLUMN IF NOT EXISTS `etaSmsClaimedMinutes` int;
--> statement-breakpoint
ALTER TABLE `cleaner_portal_job_progress` ADD COLUMN IF NOT EXISTS `etaSmsSentMinutes` int;
--> statement-breakpoint
ALTER TABLE `cleaner_portal_job_progress` ADD COLUMN IF NOT EXISTS `etaSmsMessageId` varchar(128);
--> statement-breakpoint
ALTER TABLE `cleaner_portal_job_progress` ADD COLUMN IF NOT EXISTS `etaSmsError` text;
